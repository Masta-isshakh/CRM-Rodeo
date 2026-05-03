import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentUser } from "aws-amplify/auth";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";
import { matchesSearchQuery } from "../lib/searchUtils";
import { useLanguage } from "../i18n/LanguageContext";
import { logActivity } from "../utils/activityLogger";
import "./PushNotifications.css";

type SmsType = "Transactional" | "Promotional";

type PhoneContact = {
  id: string;
  phone: string;
  name: string;
  company?: string;
  email?: string;
  source: "customer" | "employee" | "userprofile";
};

type SendResult = {
  phone: string;
  normalised: string | null;
  status: "SENT" | "FAILED" | "SKIPPED";
  messageId?: string;
  error?: string;
  fanoutPublished?: boolean;
  fanoutError?: string;
};

type SmsLogRow = {
  id: string;
  batchId?: string;
  sentBy: string;
  message: string;
  smsType?: string;
  status?: string;
  recipientCount?: number;
  sentCount?: number;
  failedCount?: number;
  queueProcessedCount?: number;
  deadLetterCount?: number;
  lastEventAt?: string;
  lastEventType?: string;
  recipientsJson?: string;
  resultsJson?: string;
  createdAt: string;
};

type SmsDeliveryEventRow = {
  id: string;
  smsLogId?: string;
  batchId?: string;
  phone?: string;
  normalizedPhone?: string;
  eventType: string;
  status: string;
  errorMessage?: string;
  processedAt?: string;
  createdAt: string;
};

type SmsDeliveryStatusRow = {
  id: string;
  snsMessageId?: string;
  phone?: string;
  normalizedPhone?: string;
  status: string;
  statusMessage?: string;
  createdAt: string;
  processedAt?: string;
};

const MAX_MESSAGE_CHARS = 160;
const MAX_BATCH_RECIPIENTS = Number(import.meta.env.VITE_SMS_MAX_BATCH_RECIPIENTS ?? 250);
const SEND_COOLDOWN_SECONDS = Number(import.meta.env.VITE_SMS_BATCH_COOLDOWN_SECONDS ?? 20);
const LAST_BATCH_SEND_AT_KEY = "crm.pushnotifications.lastBatchSendAt";

function normalizePhone(raw: string | null | undefined) {
  return String(raw ?? "")
    .replace(/[\s\-().]/g, "")
    .trim();
}

function makeBatchId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sms-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function statusTone(status: string | null | undefined) {
  const value = String(status ?? "PENDING").toUpperCase();
  if (["TRACKED", "SENT", "SUBMITTED", "DELIVERED", "SUCCESSFUL"].includes(value)) return "ok";
  if (["PARTIAL", "PROCESSING"].includes(value)) return "warn";
  if (["FAILED", "DEAD_LETTER", "DELIVERY_FAILED", "PERMANENT_FAILED", "TRANSIENT_FAILED", "UNDELIVERABLE", "OPT_OUT", "SPAM"].includes(value)) return "error";
  return "neutral";
}

function normalizeCarrierStatus(status: string | null | undefined) {
  const value = String(status ?? "").trim().toUpperCase();
  if (value === "SUCCESSFUL") return "DELIVERED";
  if (value === "FAILED") return "DELIVERY_FAILED";
  return value;
}

function isCarrierDelivered(status: string | null | undefined) {
  return normalizeCarrierStatus(status) === "DELIVERED";
}

function isCarrierFailed(status: string | null | undefined) {
  return ["DELIVERY_FAILED", "PERMANENT_FAILED", "TRANSIENT_FAILED", "UNDELIVERABLE", "OPT_OUT", "SPAM"].includes(normalizeCarrierStatus(status));
}

function submissionStatusLabel(status: string | null | undefined, t: (value: string) => string) {
  const value = String(status ?? "").trim().toUpperCase();
  if (value === "SENT") return t("Submitted to provider");
  if (value === "FAILED") return t("Submission failed");
  if (value === "SKIPPED") return t("Skipped");
  return value || t("Pending");
}

function carrierStatusLabel(status: string | null | undefined, t: (value: string) => string) {
  const value = normalizeCarrierStatus(status);
  if (value === "SENT") return t("Submitted to provider");
  if (value === "FAILED") return t("Submission failed");
  if (value === "SKIPPED") return t("Skipped");
  if (value === "DELIVERED") return t("Delivered");
  if (value === "DELIVERY_FAILED") return t("Delivery failed");
  if (value === "PERMANENT_FAILED") return t("Permanent failure");
  if (value === "TRANSIENT_FAILED") return t("Transient failure");
  if (value === "UNDELIVERABLE") return t("Undeliverable");
  if (value === "OPT_OUT") return t("Opted out");
  if (value === "SPAM") return t("Marked as spam");
  return value || t("Pending");
}

function parseResultsJson(raw: string | null | undefined): SendResult[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SendResult[]) : [];
  } catch {
    return [];
  }
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export default function PushNotifications({ permissions }: PageProps) {
  const { t } = useLanguage();
  const client = useMemo(() => getDataClient(), []);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [selfEmail, setSelfEmail] = useState("");

  const [contacts, setContacts] = useState<PhoneContact[]>([]);
  const [logs, setLogs] = useState<SmsLogRow[]>([]);
  const [events, setEvents] = useState<SmsDeliveryEventRow[]>([]);
  const [deliveryStatuses, setDeliveryStatuses] = useState<SmsDeliveryStatusRow[]>([]);
  const [contactQuery, setContactQuery] = useState("");

  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [smsType, setSmsType] = useState<SmsType>("Transactional");
  const [status, setStatus] = useState<{ type: "success" | "error" | "partial"; text: string } | null>(null);
  const [lastResults, setLastResults] = useState<SendResult[] | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [showUnresolvedOnly, setShowUnresolvedOnly] = useState(false);

  const composerRef = useRef<HTMLTextAreaElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const auth = await getCurrentUser();
      setSelfEmail(String(auth?.signInDetails?.loginId ?? auth?.username ?? "").trim().toLowerCase());

      const [custRes, empRes, profileRes, logRes, eventRes, deliveryRes] = await Promise.all([
        (client.models as any).Customer.list({ limit: 5000 }),
        (client.models as any).Employee.list({ limit: 5000 }),
        (client.models as any).UserProfile.list({ limit: 5000 }),
        (client.models as any).SmsLog.list({ limit: 200 }),
        (client.models as any).SmsDeliveryEvent.list({ limit: 2000 }),
        (client.models as any).SmsDeliveryStatus.list({ limit: 5000 }),
      ]);

      const customerContacts: PhoneContact[] = ((custRes?.data ?? []) as any[])
        .filter((c: any) => !!c?.phone)
        .map((c: any) => ({
          id: String(c.id),
          phone: normalizePhone(c.phone),
          name: [String(c.name ?? ""), String(c.lastname ?? "")].filter(Boolean).join(" ") || c.phone,
          company: c.company ? String(c.company) : undefined,
          email: c.email ? String(c.email) : undefined,
          source: "customer" as const,
        }))
        .filter((c) => !!c.phone);

      const employeeContacts: PhoneContact[] = ((empRes?.data ?? []) as any[])
        .filter((e: any) => !!e?.phone)
        .map((e: any) => ({
          id: `employee-${String(e.id)}`,
          phone: normalizePhone(e.phone),
          name: [String(e.firstName ?? ""), String(e.lastName ?? "")].filter(Boolean).join(" ") || String(e.phone),
          company: e.position ? String(e.position) : undefined,
          email: e.email ? String(e.email) : undefined,
          source: "employee" as const,
        }))
        .filter((e) => !!e.phone);

      const profileContacts: PhoneContact[] = ((profileRes?.data ?? []) as any[])
        .filter((p: any) => !!p?.mobileNumber)
        .map((p: any) => ({
          id: `profile-${String(p.id ?? p.email ?? p.mobileNumber)}`,
          phone: normalizePhone(p.mobileNumber),
          name: String(p.fullName ?? p.email ?? p.mobileNumber),
          company: p.departmentName ? String(p.departmentName) : undefined,
          email: p.email ? String(p.email) : undefined,
          source: "userprofile" as const,
        }))
        .filter((p) => !!p.phone);

      const seen = new Set<string>();
      const deduped = [...customerContacts, ...employeeContacts, ...profileContacts].filter((c) => {
        if (seen.has(c.phone)) return false;
        seen.add(c.phone);
        return true;
      });

      setContacts(deduped.sort((a, b) => a.name.localeCompare(b.name)));
      setLogs(((((logRes?.data ?? []) as any[]) as SmsLogRow[]).sort((a, b) => String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? "")))));
      setEvents(((((eventRes?.data ?? []) as any[]) as SmsDeliveryEventRow[]).sort((a, b) => String(b?.processedAt ?? b?.createdAt ?? "").localeCompare(String(a?.processedAt ?? a?.createdAt ?? "")))));
      setDeliveryStatuses(((((deliveryRes?.data ?? []) as any[]) as SmsDeliveryStatusRow[]).sort((a, b) => String(b?.processedAt ?? b?.createdAt ?? "").localeCompare(String(a?.processedAt ?? a?.createdAt ?? "")))));
    } catch (err: any) {
      setStatus({ type: "error", text: err?.message || t("Failed to load data.") });
    } finally {
      setLoading(false);
    }
  }, [client, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadData();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  const filteredContacts = useMemo(
    () => contacts.filter((c) => matchesSearchQuery([c.name, c.phone, c.company ?? "", c.email ?? ""], contactQuery)),
    [contacts, contactQuery]
  );

  const selectedContacts = useMemo(() => contacts.filter((c) => selectedPhones.has(c.phone)), [contacts, selectedPhones]);
  const contactByPhone = useMemo(() => {
    const map = new Map<string, PhoneContact>();
    for (const c of contacts) map.set(c.phone, c);
    return map;
  }, [contacts]);

  const eventsByLogId = useMemo(() => {
    const map = new Map<string, SmsDeliveryEventRow[]>();
    for (const event of events) {
      const key = String(event.smsLogId ?? "").trim();
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [events]);

  const deliveryByMessageId = useMemo(() => {
    const map = new Map<string, SmsDeliveryStatusRow[]>();
    for (const status of deliveryStatuses) {
      const id = String(status.snsMessageId ?? "").trim();
      if (!id) continue;
      const list = map.get(id) ?? [];
      list.push(status);
      map.set(id, list);
    }
    return map;
  }, [deliveryStatuses]);

  const historyRows = useMemo(() => {
    return logs.map((log) => {
      const recipients: { name: string; phone: string }[] = (() => {
        try { return JSON.parse(log.recipientsJson ?? "[]"); } catch { return []; }
      })();
      const linkedEvents = eventsByLogId.get(log.id) ?? [];
      const previewEvents = linkedEvents.slice(0, 6);
      const resultRows = parseResultsJson(log.resultsJson);
      const failedOnly = resultRows.filter((r) => String(r.status).toUpperCase() === "FAILED");
      const submittedRows = resultRows.filter((r) => String(r.status).toUpperCase() === "SENT");
      const submittedCount = submittedRows.length;
      const carrierFeedback = submittedRows.flatMap((r) => {
        const msgId = String(r.messageId ?? "").trim();
        return msgId ? (deliveryByMessageId.get(msgId) ?? []) : [];
      });
      const deliveredCount = carrierFeedback.filter((s) => isCarrierDelivered(s.status)).length;
      const deliveryFailedCount = carrierFeedback.filter((s) => isCarrierFailed(s.status)).length;
      const awaitingCarrierCount = Math.max(submittedCount - carrierFeedback.length, 0);
      return {
        log,
        recipients,
        previewEvents,
        failedOnly,
        submittedCount,
        deliveredCount,
        deliveryFailedCount,
        awaitingCarrierCount,
      };
    });
  }, [logs, eventsByLogId, deliveryByMessageId]);

  const visibleHistoryRows = useMemo(
    () => historyRows.filter((row) => !showUnresolvedOnly || row.awaitingCarrierCount > 0),
    [historyRows, showUnresolvedOnly]
  );

  const hasSubmittedMessages = useMemo(
    () => historyRows.some((row) => row.submittedCount > 0),
    [historyRows]
  );

  const showSetupIncompleteWarning = hasSubmittedMessages && deliveryStatuses.length === 0;

  const togglePhone = (phone: string) => {
    setSelectedPhones((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  };

  const toggleAll = () => {
    const visible = filteredContacts.map((c) => c.phone);
    const allSelected = visible.every((p) => selectedPhones.has(p));
    setSelectedPhones((prev) => {
      const next = new Set(prev);
      if (allSelected) visible.forEach((p) => next.delete(p));
      else visible.forEach((p) => next.add(p));
      return next;
    });
  };

  const executeSendBatch = async ({
    phones,
    messageText,
    smsTypeValue,
    clearComposer,
  }: {
    phones: string[];
    messageText: string;
    smsTypeValue: SmsType;
    clearComposer: boolean;
  }) => {
    const nowMs = Date.now();
    const lastSentMs = Number(window.localStorage.getItem(LAST_BATCH_SEND_AT_KEY) ?? "0");
    if (Number.isFinite(lastSentMs) && lastSentMs > 0) {
      const elapsedSec = Math.floor((nowMs - lastSentMs) / 1000);
      if (elapsedSec < SEND_COOLDOWN_SECONDS) {
        const waitSec = SEND_COOLDOWN_SECONDS - elapsedSec;
        setStatus({ type: "error", text: `${t("Please wait before sending another batch.")} ${waitSec}s` });
        return;
      }
    }

    if (phones.length > MAX_BATCH_RECIPIENTS) {
      setStatus({
        type: "error",
        text: `${t("Batch recipient limit exceeded.")} ${t("Maximum allowed:")} ${MAX_BATCH_RECIPIENTS}.`,
      });
      return;
    }

    setSending(true);
    setStatus(null);
    setLastResults(null);

    const now = new Date().toISOString();
    const batchId = makeBatchId();
    const recipientsPayload = phones.map((phone) => ({
      name: contactByPhone.get(phone)?.name ?? phone,
      phone,
    }));
    let smsLogId = "";

    try {
      const created = await (client.models as any).SmsLog.create({
        batchId,
        sentBy: selfEmail,
        message: messageText.trim(),
        smsType: smsTypeValue,
        status: "PENDING",
        recipientCount: phones.length,
        sentCount: 0,
        failedCount: 0,
        queueProcessedCount: 0,
        deadLetterCount: 0,
        recipientsJson: JSON.stringify(recipientsPayload),
        resultsJson: JSON.stringify([]),
        createdAt: now,
        lastEventAt: now,
        lastEventType: "BATCH_CREATED",
      });

      smsLogId = String(created?.data?.id ?? "").trim();
      if (!smsLogId) throw new Error("Failed to create SMS batch record.");

      const res = await (client.mutations as any).sendSms({
        phones,
        message: messageText.trim(),
        smsType: smsTypeValue,
        batchId,
        smsLogId,
      });

      const data = res?.data ? (typeof res.data === "string" ? JSON.parse(res.data) : res.data) : res;
      const results: SendResult[] = Array.isArray(data?.results) ? data.results : [];
      const sentCount = Number(data?.sentCount ?? 0);
      const failedCount = Number(data?.failedCount ?? 0);
      const fanoutFailures = results.filter((r) => r.fanoutPublished === false).length;

      setLastResults(results);

      await (client.models as any).SmsLog.update({
        id: smsLogId,
        sentCount,
        failedCount,
        status: failedCount === 0 ? "SUBMITTED" : sentCount > 0 ? "PARTIAL" : "FAILED",
        resultsJson: JSON.stringify(results),
        lastEventAt: new Date().toISOString(),
        lastEventType: "SMS_SUBMISSION_RESULT",
      });

      await logActivity("SmsNotification", smsLogId, "CREATE", `${selfEmail} sent SMS batch ${smsLogId} to ${sentCount}/${phones.length} recipients`);
      window.localStorage.setItem(LAST_BATCH_SEND_AT_KEY, String(Date.now()));

      if (fanoutFailures > 0) {
        setStatus({ type: "partial", text: `⚠️ ${sentCount} ${t("sent,")} ${failedCount} ${t("failed.")} ${fanoutFailures} ${t("fanout event(s) could not be published.")}` });
      } else if (failedCount === 0) {
        setStatus({ type: "success", text: `✅ ${t("SMS submitted to provider for all")} ${sentCount} ${t("recipients.")}` });
      } else if (sentCount > 0) {
        setStatus({ type: "partial", text: `⚠️ ${sentCount} ${t("submitted to provider,")} ${failedCount} ${t("failed. See results below.")}` });
      } else {
        setStatus({ type: "error", text: `❌ ${t("All messages failed. Check numbers below.")}` });
      }

      if (clearComposer) {
        setMessage("");
        setSelectedPhones(new Set());
      }
      await loadData();
    } catch (err: any) {
      if (smsLogId) {
        try {
          await (client.models as any).SmsLog.update({
            id: smsLogId,
            status: "FAILED",
            failedCount: phones.length,
            resultsJson: JSON.stringify([{ phone: phones.join(", "), normalised: null, status: "FAILED", error: err?.message ?? String(err) }]),
            lastEventAt: new Date().toISOString(),
            lastEventType: "SEND_FAILED",
          });
        } catch {
          // best effort
        }
      }
      setStatus({ type: "error", text: err?.message || t("Failed to send SMS.") });
    } finally {
      setSending(false);
    }
  };

  const sendMessages = async () => {
    if (!message.trim()) {
      setStatus({ type: "error", text: t("Please write a message before sending.") });
      return;
    }
    if (selectedPhones.size === 0) {
      setStatus({ type: "error", text: t("Please select at least one recipient.") });
      return;
    }

    const phones = Array.from(selectedPhones);
    if (!window.confirm(`${t("Send SMS to")} ${phones.length} ${t("recipient(s)?")}\n\n"${message.slice(0, 80)}${message.length > 80 ? "…" : ""}"`)) {
      return;
    }

    await executeSendBatch({
      phones,
      messageText: message,
      smsTypeValue: smsType,
      clearComposer: true,
    });
  };

  const retryFailedRecipients = async (log: SmsLogRow) => {
    if (sending) return;
    const parsed = parseResultsJson(log.resultsJson);
    const failedPhones = Array.from(
      new Set(
        parsed
          .filter((r) => String(r.status).toUpperCase() === "FAILED")
          .map((r) => normalizePhone(r.normalised || r.phone))
          .filter(Boolean)
      )
    );

    if (failedPhones.length === 0) {
      setStatus({ type: "error", text: t("No failed recipients found for this batch.") });
      return;
    }

    const confirmRetry = window.confirm(
      `${t("Retry failed recipients only?")}\n${t("Recipients")}: ${failedPhones.length}\n${t("Message")}: "${String(log.message || "").slice(0, 80)}${String(log.message || "").length > 80 ? "…" : ""}"`
    );
    if (!confirmRetry) return;

    setSelectedPhones(new Set(failedPhones));
    setMessage(String(log.message || ""));
    setSmsType((String(log.smsType || "Transactional") === "Promotional" ? "Promotional" : "Transactional"));

    await executeSendBatch({
      phones: failedPhones,
      messageText: String(log.message || ""),
      smsTypeValue: String(log.smsType || "Transactional") === "Promotional" ? "Promotional" : "Transactional",
      clearComposer: false,
    });
  };

  const exportSendHistoryCsv = () => {
    if (!logs.length) {
      setStatus({ type: "error", text: t("No send history available to export.") });
      return;
    }

    setExportingCsv(true);
    try {
      const header = [
        "batchId",
        "smsLogId",
        "createdAt",
        "sentBy",
        "smsType",
        "batchStatus",
        "recipientCount",
        "sentCount",
        "failedCount",
        "queueProcessedCount",
        "deadLetterCount",
        "lastEventAt",
        "lastEventType",
        "phone",
        "normalizedPhone",
        "resultStatus",
        "messageId",
        "error",
        "fanoutPublished",
        "fanoutError",
        "message",
      ];

      const rows: string[] = [];
      rows.push(header.map(csvEscape).join(","));

      for (const log of logs) {
        const parsed = parseResultsJson(log.resultsJson);
        if (parsed.length === 0) {
          rows.push([
            log.batchId,
            log.id,
            log.createdAt,
            log.sentBy,
            log.smsType,
            log.status,
            log.recipientCount,
            log.sentCount,
            log.failedCount,
            log.queueProcessedCount,
            log.deadLetterCount,
            log.lastEventAt,
            log.lastEventType,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            log.message,
          ].map(csvEscape).join(","));
          continue;
        }

        for (const r of parsed) {
          rows.push([
            log.batchId,
            log.id,
            log.createdAt,
            log.sentBy,
            log.smsType,
            log.status,
            log.recipientCount,
            log.sentCount,
            log.failedCount,
            log.queueProcessedCount,
            log.deadLetterCount,
            log.lastEventAt,
            log.lastEventType,
            r.phone,
            r.normalised,
            r.status,
            r.messageId,
            r.error,
            r.fanoutPublished,
            r.fanoutError,
            log.message,
          ].map(csvEscape).join(","));
        }
      }

      const blob = new Blob(["\ufeff", rows.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sms-send-history-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setStatus({ type: "success", text: t("SMS send history exported successfully.") });
    } catch (err: any) {
      setStatus({ type: "error", text: err?.message || t("Failed to export SMS send history.") });
    } finally {
      setExportingCsv(false);
    }
  };

  if (!permissions.canRead) {
    return <div className="pn-page"><div className="pn-empty">{t("You do not have access to this page.")}</div></div>;
  }

  const visibleAllSelected = filteredContacts.length > 0 && filteredContacts.every((c) => selectedPhones.has(c.phone));

  return (
    <div className="pn-page">
      <div className="pn-hero">
        <div className="pn-hero-icon"><i className="fas fa-comment-sms" /></div>
        <div>
          <h1>{t("Push Notifications")}</h1>
          <p>{t("Send SMS messages directly to customers and track the queue fanout pipeline end-to-end.")}</p>
        </div>
      </div>

      <div className="pn-layout">
        <section className="pn-panel pn-contacts-panel">
          <div className="pn-panel-header">
            <span className="pn-panel-title">
              <i className="fas fa-users" /> {t("Recipients")}
              <span className="pn-badge">{contacts.length}</span>
            </span>
            <span className="pn-selected-count">{selectedPhones.size > 0 ? `${selectedPhones.size} ${t("selected")}` : ""}</span>
          </div>

          <div className="pn-search-row">
            <input type="text" value={contactQuery} onChange={(e) => setContactQuery(e.target.value)} placeholder={t("Search by name, phone, company…")} />
            {filteredContacts.length > 0 && (
              <button type="button" className="pn-select-all-btn" onClick={toggleAll}>
                {visibleAllSelected ? t("Deselect all") : t("Select all")}
              </button>
            )}
          </div>

          <div className="pn-contact-list">
            {loading && <div className="pn-empty">{t("Loading…")}</div>}
            {!loading && filteredContacts.length === 0 && <div className="pn-empty">{t("No contacts found.")}</div>}
            {filteredContacts.map((c) => {
              const checked = selectedPhones.has(c.phone);
              const sourceLabel = c.source === "customer"
                ? t("Customer")
                : c.source === "employee"
                  ? t("Employee")
                  : t("User");
              return (
                <label key={c.phone} className={`pn-contact${checked ? " selected" : ""}`}>
                  <input type="checkbox" checked={checked} onChange={() => togglePhone(c.phone)} />
                  <div className="pn-contact-avatar">{(c.name[0] ?? "?").toUpperCase()}</div>
                  <div className="pn-contact-info">
                    <div className="pn-contact-name">{c.name}</div>
                    <div className="pn-contact-phone">{c.phone}</div>
                    {c.company && <div className="pn-contact-company">{c.company}</div>}
                    <div className="pn-contact-company">{sourceLabel}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        <div className="pn-right-col">
          <section className="pn-panel pn-composer-panel">
            <div className="pn-panel-header">
              <span className="pn-panel-title"><i className="fas fa-pen-to-square" /> {t("Message")}</span>
              <span className="pn-selected-count">{t("Max batch")}: {MAX_BATCH_RECIPIENTS}</span>
            </div>

            {selectedPhones.size > 0 && (
              <div className="pn-recipients-chips">
                {selectedContacts.slice(0, 10).map((c) => (
                  <span key={c.phone} className="pn-chip">
                    {c.name}
                    <button type="button" onClick={() => togglePhone(c.phone)}>✕</button>
                  </span>
                ))}
                {selectedContacts.length > 10 && <span className="pn-chip pn-chip-more">+{selectedContacts.length - 10} {t("more")}</span>}
              </div>
            )}

            <textarea ref={composerRef} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("Write your SMS message here…")} rows={5} maxLength={MAX_MESSAGE_CHARS * 3} />
            <div className="pn-char-bar">
              <span className={message.length > MAX_MESSAGE_CHARS ? "pn-char-warn" : ""}>
                {message.length} {t("chars")}
                {message.length > MAX_MESSAGE_CHARS ? ` (${Math.ceil(message.length / MAX_MESSAGE_CHARS)} ${t("SMS parts")})` : ` / ${MAX_MESSAGE_CHARS}`}
              </span>
              <select value={smsType} onChange={(e) => setSmsType(e.target.value as SmsType)}>
                <option value="Transactional">{t("Transactional")}</option>
                <option value="Promotional">{t("Promotional")}</option>
              </select>
            </div>

            {status && <div className={`pn-status pn-status-${status.type}`}>{status.text}</div>}

            <button type="button" className="pn-send-btn" onClick={() => void sendMessages()} disabled={sending || !permissions.canUpdate || selectedPhones.size === 0 || !message.trim()}>
              {sending ? <><i className="fas fa-circle-notch fa-spin" /> {t("Sending…")}</> : <><i className="fas fa-paper-plane" /> {t("Send SMS")} {selectedPhones.size > 0 ? `(${selectedPhones.size})` : ""}</>}
            </button>
          </section>

          {lastResults && lastResults.length > 0 && (
            <section className="pn-panel pn-results-panel">
              <div className="pn-panel-header">
                <span className="pn-panel-title"><i className="fas fa-list-check" /> {t("Send Results")}</span>
              </div>
              <div className="pn-results-list">
                {lastResults.map((r, i) => (
                  <div key={i} className={`pn-result-row pn-result-${r.status.toLowerCase()}`}>
                    <i className={r.status === "SENT" ? "fas fa-circle-check" : r.status === "FAILED" ? "fas fa-circle-xmark" : "fas fa-circle-minus"} />
                    <span className="pn-result-phone">{r.normalised || r.phone}</span>
                    <span className="pn-result-status">{submissionStatusLabel(r.status, t)}</span>
                    {r.fanoutPublished === false && <span className="pn-result-fanout">{t("fanout failed")}</span>}
                    {(r.error || r.fanoutError) && <span className="pn-result-error">{r.error || r.fanoutError}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {permissions.canRead && logs.length > 0 && (
            <section className="pn-panel pn-logs-panel">
              {showSetupIncompleteWarning && (
                <div className="pn-setup-warning" role="status" aria-live="polite">
                  <i className="fas fa-triangle-exclamation" />
                  <div>
                    <div className="pn-setup-warning-title">{t("Setup incomplete: no carrier delivery feedback is being ingested yet.")}</div>
                    <div className="pn-setup-warning-text">{t("Enable SNS SMS delivery status logging to CloudWatch and attach the log group subscription to the delivery-status Lambda.")}</div>
                  </div>
                </div>
              )}
              <div className="pn-panel-header">
                <span className="pn-panel-title">
                  <i className="fas fa-clock-rotate-left" /> {t("Send History")}
                  <span className="pn-badge">{visibleHistoryRows.length}</span>
                </span>
                <div className="pn-log-toolbar">
                  <label className="pn-filter-toggle">
                    <input type="checkbox" checked={showUnresolvedOnly} onChange={(e) => setShowUnresolvedOnly(e.target.checked)} />
                    <span>{t("Unresolved only")}</span>
                  </label>
                  <button type="button" className="pn-log-action-btn" onClick={exportSendHistoryCsv} disabled={exportingCsv}>
                    <i className="fas fa-file-csv" /> {exportingCsv ? t("Exporting…") : t("Export CSV")}
                  </button>
                </div>
              </div>
              <div className="pn-logs-list">
                {visibleHistoryRows.length === 0 && <div className="pn-empty">{t("No matching SMS history found.")}</div>}
                {visibleHistoryRows.map(({ log, recipients, previewEvents, failedOnly, submittedCount, deliveredCount, deliveryFailedCount, awaitingCarrierCount }) => {
                  return (
                    <div key={log.id} className="pn-log-row">
                      <div className="pn-log-meta">
                        <span className="pn-log-date">{new Date(log.createdAt).toLocaleString()}</span>
                        <span className="pn-log-by">{log.sentBy}</span>
                        <span className={`pn-log-status ${statusTone(log.status)}`}>{log.status || "PENDING"}</span>
                        <span className={`pn-log-counts ${(log.failedCount ?? 0) > 0 ? "warn" : "ok"}`}>✅ {log.sentCount ?? 0} / {log.recipientCount ?? 0}</span>
                        <span className="pn-log-track">📥 {log.queueProcessedCount ?? 0} / {log.recipientCount ?? 0}</span>
                        <span className="pn-log-carrier">📤 {t("Submitted to provider")}: {submittedCount}</span>
                        <span className="pn-log-delivered">📬 {t("Delivered")}: {deliveredCount}</span>
                        {deliveryFailedCount > 0 && <span className="pn-log-carrier-failed">❌ {t("Delivery failed")}: {deliveryFailedCount}</span>}
                        {awaitingCarrierCount > 0 && <span className="pn-log-awaiting">⏳ {t("Awaiting carrier feedback")}: {awaitingCarrierCount}</span>}
                        {(log.deadLetterCount ?? 0) > 0 && <span className="pn-log-dead">DLQ {log.deadLetterCount}</span>}
                        <span className="pn-log-type">{log.smsType}</span>
                      </div>
                      <div className="pn-log-message">"{log.message}"</div>
                      <div className="pn-log-actions">
                        <button
                          type="button"
                          className="pn-log-action-btn"
                          disabled={sending || failedOnly.length === 0 || !permissions.canUpdate}
                          onClick={() => void retryFailedRecipients(log)}
                        >
                          <i className="fas fa-rotate-right" /> {t("Retry failed only")} ({failedOnly.length})
                        </button>
                      </div>
                      {previewEvents.length > 0 && (
                        <div className="pn-log-events">
                          {previewEvents.map((event) => (
                            <span key={event.id} className={`pn-event-chip ${statusTone(event.status)}`}>
                              {event.normalizedPhone || event.phone || "unknown"} • {carrierStatusLabel(event.status, t)}
                            </span>
                          ))}
                        </div>
                      )}
                      {recipients.length > 0 && (
                        <div className="pn-log-recipients">
                          {recipients.slice(0, 5).map((r, i) => <span key={i} className="pn-chip pn-chip-sm">{r.name}</span>)}
                          {recipients.length > 5 && <span className="pn-chip pn-chip-sm pn-chip-more">+{recipients.length - 5}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
