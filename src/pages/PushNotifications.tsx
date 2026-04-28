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
  source: "customer" | "employee";
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

const MAX_MESSAGE_CHARS = 160;

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
  if (["TRACKED", "SENT", "SUBMITTED"].includes(value)) return "ok";
  if (["PARTIAL", "PROCESSING"].includes(value)) return "warn";
  if (["FAILED", "DEAD_LETTER"].includes(value)) return "error";
  return "neutral";
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
  const [contactQuery, setContactQuery] = useState("");

  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [smsType, setSmsType] = useState<SmsType>("Transactional");
  const [status, setStatus] = useState<{ type: "success" | "error" | "partial"; text: string } | null>(null);
  const [lastResults, setLastResults] = useState<SendResult[] | null>(null);

  const composerRef = useRef<HTMLTextAreaElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const auth = await getCurrentUser();
      setSelfEmail(String(auth?.signInDetails?.loginId ?? auth?.username ?? "").trim().toLowerCase());

      const [custRes, logRes, eventRes] = await Promise.all([
        (client.models as any).Customer.list({ limit: 5000 }),
        (client.models as any).SmsLog.list({ limit: 200 }),
        (client.models as any).SmsDeliveryEvent.list({ limit: 2000 }),
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

      const seen = new Set<string>();
      const deduped = customerContacts.filter((c) => {
        if (seen.has(c.phone)) return false;
        seen.add(c.phone);
        return true;
      });

      setContacts(deduped.sort((a, b) => a.name.localeCompare(b.name)));
      setLogs(((((logRes?.data ?? []) as any[]) as SmsLogRow[]).sort((a, b) => String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? "")))));
      setEvents(((((eventRes?.data ?? []) as any[]) as SmsDeliveryEventRow[]).sort((a, b) => String(b?.processedAt ?? b?.createdAt ?? "").localeCompare(String(a?.processedAt ?? a?.createdAt ?? "")))));
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

  const sendMessages = async () => {
    if (!message.trim()) {
      setStatus({ type: "error", text: t("Please write a message before sending.") });
      return;
    }
    if (selectedPhones.size === 0) {
      setStatus({ type: "error", text: t("Please select at least one recipient.") });
      return;
    }

    if (!window.confirm(`${t("Send SMS to")} ${selectedPhones.size} ${t("recipient(s)?")}\n\n"${message.slice(0, 80)}${message.length > 80 ? "…" : ""}"`)) {
      return;
    }

    setSending(true);
    setStatus(null);
    setLastResults(null);

    const phones = Array.from(selectedPhones);
    const now = new Date().toISOString();
    const batchId = makeBatchId();
    const recipientsPayload = selectedContacts.map((c) => ({ name: c.name, phone: c.phone }));
    let smsLogId = "";

    try {
      const created = await (client.models as any).SmsLog.create({
        batchId,
        sentBy: selfEmail,
        message: message.trim(),
        smsType,
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
        message: message.trim(),
        smsType,
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

      if (fanoutFailures > 0) {
        setStatus({ type: "partial", text: `⚠️ ${sentCount} ${t("sent,")} ${failedCount} ${t("failed.")} ${fanoutFailures} ${t("fanout event(s) could not be published.")}` });
      } else if (failedCount === 0) {
        setStatus({ type: "success", text: `✅ ${t("SMS sent to all")} ${sentCount} ${t("recipients.")}` });
      } else if (sentCount > 0) {
        setStatus({ type: "partial", text: `⚠️ ${sentCount} ${t("sent,")} ${failedCount} ${t("failed. See results below.")}` });
      } else {
        setStatus({ type: "error", text: `❌ ${t("All messages failed. Check numbers below.")}` });
      }

      setMessage("");
      setSelectedPhones(new Set());
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
              return (
                <label key={c.phone} className={`pn-contact${checked ? " selected" : ""}`}>
                  <input type="checkbox" checked={checked} onChange={() => togglePhone(c.phone)} />
                  <div className="pn-contact-avatar">{(c.name[0] ?? "?").toUpperCase()}</div>
                  <div className="pn-contact-info">
                    <div className="pn-contact-name">{c.name}</div>
                    <div className="pn-contact-phone">{c.phone}</div>
                    {c.company && <div className="pn-contact-company">{c.company}</div>}
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
                    <span className="pn-result-status">{r.status}</span>
                    {r.fanoutPublished === false && <span className="pn-result-fanout">{t("fanout failed")}</span>}
                    {(r.error || r.fanoutError) && <span className="pn-result-error">{r.error || r.fanoutError}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {permissions.canRead && logs.length > 0 && (
            <section className="pn-panel pn-logs-panel">
              <div className="pn-panel-header">
                <span className="pn-panel-title">
                  <i className="fas fa-clock-rotate-left" /> {t("Send History")}
                  <span className="pn-badge">{logs.length}</span>
                </span>
              </div>
              <div className="pn-logs-list">
                {logs.map((log) => {
                  const recipients: { name: string; phone: string }[] = (() => {
                    try { return JSON.parse(log.recipientsJson ?? "[]"); } catch { return []; }
                  })();
                  const linkedEvents = eventsByLogId.get(log.id) ?? [];
                  const previewEvents = linkedEvents.slice(0, 6);
                  return (
                    <div key={log.id} className="pn-log-row">
                      <div className="pn-log-meta">
                        <span className="pn-log-date">{new Date(log.createdAt).toLocaleString()}</span>
                        <span className="pn-log-by">{log.sentBy}</span>
                        <span className={`pn-log-status ${statusTone(log.status)}`}>{log.status || "PENDING"}</span>
                        <span className={`pn-log-counts ${(log.failedCount ?? 0) > 0 ? "warn" : "ok"}`}>✅ {log.sentCount ?? 0} / {log.recipientCount ?? 0}</span>
                        <span className="pn-log-track">📥 {log.queueProcessedCount ?? 0} / {log.recipientCount ?? 0}</span>
                        {(log.deadLetterCount ?? 0) > 0 && <span className="pn-log-dead">DLQ {log.deadLetterCount}</span>}
                        <span className="pn-log-type">{log.smsType}</span>
                      </div>
                      <div className="pn-log-message">"{log.message}"</div>
                      {previewEvents.length > 0 && (
                        <div className="pn-log-events">
                          {previewEvents.map((event) => (
                            <span key={event.id} className={`pn-event-chip ${statusTone(event.status)}`}>
                              {event.normalizedPhone || event.phone || "unknown"} • {event.status}
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
