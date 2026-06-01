import { useEffect, useMemo, useState } from "react";
import { getCurrentUser } from "aws-amplify/auth";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import type { PageProps } from "../lib/PageProps";
import { useLanguage } from "../i18n/LanguageContext";
import { getDataClient } from "../lib/amplifyClient";
import { usePermissions } from "../lib/userPermissions";
import "./ScheduledReportsPage.css";

type AnyObj = Record<string, unknown>;
type ReportFormat = "PDF" | "EXCEL";
type ModelKey = "JobOrder" | "Customer" | "Vehicle" | "Employee" | "ServiceCatalog" | "UserProfile" | "Ticket";

type UserOption = { label: string; value: string };

type QueueItem = {
  id: string;
  title: string;
  recipientEmail: string;
  reportFormat: ReportFormat;
  status: string;
  sendAt: string;
  createdAt: string;
  reportModel: string;
  errorMessage?: string;
};

type FilterState = {
  search: string;
  dateFrom: string;
  dateTo: string;
  field1: string;
  value1: string;
  field2: string;
  value2: string;
  field3: string;
  value3: string;
};

const MODELS: Array<{ key: ModelKey; label: string }> = [
  { key: "JobOrder", label: "Job Orders" },
  { key: "Customer", label: "Customers" },
  { key: "Vehicle", label: "Vehicles" },
  { key: "Employee", label: "Employees" },
  { key: "ServiceCatalog", label: "Service Catalog" },
  { key: "UserProfile", label: "User Profiles" },
  { key: "Ticket", label: "Tickets" },
];

const EMPTY_FILTERS: FilterState = {
  search: "",
  dateFrom: "",
  dateTo: "",
  field1: "",
  value1: "",
  field2: "",
  value2: "",
  field3: "",
  value3: "",
};

function txt(value: unknown): string {
  return String(value ?? "").trim();
}

function dt(value: unknown): Date | null {
  const t = txt(value);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateLabel(value: string): string {
  const d = dt(value);
  if (!d) return "-";
  return d.toLocaleString();
}

function normalizeRow(row: AnyObj): AnyObj {
  const out: AnyObj = {};
  for (const [key, value] of Object.entries(row ?? {})) {
    if (key === "__typename") continue;
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else {
      out[key] = JSON.stringify(value);
    }
  }
  return out;
}

function valueMatches(value: unknown, expected: string): boolean {
  if (!expected) return true;
  return txt(value) === expected;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function pickModel(client: unknown, name: string): any {
  return (client as any)?.models?.[name] ?? null;
}

async function safeList(client: unknown, modelName: string, limit = 3000): Promise<AnyObj[]> {
  const model = pickModel(client, modelName);
  if (!model?.list) return [];
  try {
    const res = await model.list({ limit });
    return (res?.data ?? []) as AnyObj[];
  } catch {
    return [];
  }
}

export default function ScheduledReportsPage({ permissions }: PageProps) {
  const { t } = useLanguage();
  const { isAdminGroup, canOption } = usePermissions();
  const client = useMemo(() => getDataClient(), []);

  const canExportPdf = isAdminGroup || canOption("scheduledreports", "scheduledreports_export_pdf", true);
  const canExportExcel = isAdminGroup || canOption("scheduledreports", "scheduledreports_export_excel", true);
  const canCreateSchedule = isAdminGroup || canOption("scheduledreports", "scheduledreports_create", true);
  const canCancelSchedule = isAdminGroup || canOption("scheduledreports", "scheduledreports_cancel", true);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [selectedModel, setSelectedModel] = useState<ModelKey>("JobOrder");
  const [allData, setAllData] = useState<Record<ModelKey, AnyObj[]>>({
    JobOrder: [],
    Customer: [],
    Vehicle: [],
    Employee: [],
    ServiceCatalog: [],
    UserProfile: [],
    Ticket: [],
  });

  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterState>(() => {
    const today = dateInput(new Date());
    return { ...EMPTY_FILTERS, dateFrom: today.slice(0, 8) + "01", dateTo: today };
  });

  const [recipientEmail, setRecipientEmail] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleFormat, setScheduleFormat] = useState<ReportFormat>("PDF");
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);

  const [users, setUsers] = useState<UserOption[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  useEffect(() => {
    if (!permissions?.canRead) return;
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setMessage("");
      try {
        const [jobOrders, jobServices, customers, vehicles, employees, serviceCatalog, userProfiles, tickets, schedules] = await Promise.all([
          safeList(client, "JobOrder", 3000),
          safeList(client, "JobOrderServiceItem", 6000),
          safeList(client, "Customer", 3000),
          safeList(client, "Vehicle", 3000),
          safeList(client, "Employee", 3000),
          safeList(client, "ServiceCatalog", 3000),
          safeList(client, "UserProfile", 3000),
          safeList(client, "Ticket", 3000),
          safeList(client, "ScheduledReport", 3000),
        ]);

        if (cancelled) return;

        const serviceMap = new Map<string, string[]>();
        for (const row of jobServices) {
          const id = txt(row.jobOrderId);
          const name = txt(row.name);
          if (!id || !name) continue;
          const list = serviceMap.get(id) ?? [];
          list.push(name);
          serviceMap.set(id, list);
        }

        const normalizedJobs = jobOrders.map((r) =>
          normalizeRow({
            ...r,
            services: (serviceMap.get(txt(r.id)) ?? []).join(", "),
          })
        );

        const nextData: Record<ModelKey, AnyObj[]> = {
          JobOrder: normalizedJobs,
          Customer: customers.map(normalizeRow),
          Vehicle: vehicles.map(normalizeRow),
          Employee: employees.map(normalizeRow),
          ServiceCatalog: serviceCatalog.map(normalizeRow),
          UserProfile: userProfiles.map(normalizeRow),
          Ticket: tickets.map(normalizeRow),
        };

        const userOptions = Array.from(new Set(userProfiles.map((u) => txt(u.email).toLowerCase()).filter(Boolean))).map((email) => {
          const row = userProfiles.find((u) => txt(u.email).toLowerCase() === email);
          const name = txt(row?.fullName);
          return { value: email, label: name ? `${name} (${email})` : email };
        });

        const queueRows: QueueItem[] = (schedules as AnyObj[])
          .map((s) => ({
            id: txt(s.id),
            title: txt(s.title),
            recipientEmail: txt(s.recipientEmail),
            reportFormat: (txt(s.reportFormat).toUpperCase() === "EXCEL" ? "EXCEL" : "PDF") as ReportFormat,
            status: txt(s.status) || "PENDING",
            sendAt: txt(s.sendAt),
            createdAt: txt(s.createdAt),
            reportModel: txt(s.reportModel) || "JobOrder",
            errorMessage: txt(s.errorMessage),
          }))
          .filter((r) => r.id)
          .sort((a, b) => (dt(b.sendAt)?.getTime() ?? 0) - (dt(a.sendAt)?.getTime() ?? 0));

        setAllData(nextData);
        setUsers(userOptions);
        setQueue(queueRows);
      } catch (err) {
        console.error("[ScheduledReports] load failed", err);
        if (!cancelled) setMessage(t("Failed to load scheduled report data."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [client, permissions?.canRead, t]);

  const modelRows = useMemo(() => allData[selectedModel] ?? [], [allData, selectedModel]);

  const fieldOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of modelRows) {
      Object.keys(row).forEach((k) => set.add(k));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [modelRows]);

  useEffect(() => {
    if (fieldOptions.length === 0) {
      setSelectedFields([]);
      return;
    }
    setSelectedFields((prev) => {
      const kept = prev.filter((f) => fieldOptions.includes(f));
      if (kept.length > 0) return kept;
      return fieldOptions.slice(0, Math.min(fieldOptions.length, 10));
    });
  }, [fieldOptions]);

  const fieldValueOptions = (field: string) => {
    if (!field) return [] as string[];
    return Array.from(new Set(modelRows.map((r) => txt(r[field])).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  };

  const filteredRows = useMemo(() => {
    const search = txt(filters.search).toLowerCase();
    const f1 = txt(filters.field1);
    const v1 = txt(filters.value1);
    const f2 = txt(filters.field2);
    const v2 = txt(filters.value2);
    const f3 = txt(filters.field3);
    const v3 = txt(filters.value3);

    return modelRows.filter((row) => {
      if (f1 && !valueMatches(row[f1], v1)) return false;
      if (f2 && !valueMatches(row[f2], v2)) return false;
      if (f3 && !valueMatches(row[f3], v3)) return false;

      if (filters.dateFrom || filters.dateTo) {
        const dateValue = txt(row.createdAt) || txt(row.updatedAt) || txt(row.date);
        const day = dateValue ? dateInput(new Date(dateValue)) : "";
        if (!day) return false;
        if (filters.dateFrom && day < filters.dateFrom) return false;
        if (filters.dateTo && day > filters.dateTo) return false;
      }

      if (search) {
        const haystack = (selectedFields.length > 0 ? selectedFields : fieldOptions)
          .map((f) => txt(row[f]).toLowerCase())
          .join(" | ");
        if (!haystack.includes(search)) return false;
      }

      return true;
    });
  }, [filters, modelRows, selectedFields, fieldOptions]);

  const exportPdf = () => {
    if (!canExportPdf) {
      setMessage(t("You do not have access to export PDF reports."));
      return;
    }
    if (filteredRows.length === 0 || selectedFields.length === 0) {
      setMessage(t("No records match the current filters."));
      return;
    }

    const fields = selectedFields.slice(0, 9);
    const colWidth = 30;

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    let y = 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(`${t("Scheduled Report")} - ${selectedModel}`, 10, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`${t("Generated at")}: ${new Date().toLocaleString()}`, 10, y);
    y += 8;

    let x = 8;
    doc.setFont("helvetica", "bold");
    for (const field of fields) {
      doc.rect(x, y, colWidth, 7);
      doc.text(field.slice(0, 16), x + 1, y + 4.6);
      x += colWidth;
    }
    y += 7;

    doc.setFont("helvetica", "normal");
    for (const row of filteredRows.slice(0, 120)) {
      if (y > 188) {
        doc.addPage("a4", "landscape");
        y = 12;
      }
      x = 8;
      for (const field of fields) {
        doc.rect(x, y, colWidth, 6.6);
        doc.text(txt(row[field]).slice(0, 24) || "-", x + 1, y + 4.1);
        x += colWidth;
      }
      y += 6.6;
    }

    doc.save(`scheduled-report-${selectedModel}-${Date.now()}.pdf`);
    setMessage(t("PDF report generated successfully."));
  };

  const exportExcel = () => {
    if (!canExportExcel) {
      setMessage(t("You do not have access to export Excel reports."));
      return;
    }
    if (filteredRows.length === 0 || selectedFields.length === 0) {
      setMessage(t("No records match the current filters."));
      return;
    }

    const rows = filteredRows.map((row) => {
      const out: AnyObj = {};
      selectedFields.forEach((f) => {
        out[f] = row[f] ?? "";
      });
      return out;
    });

    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, sheet, "Report");

    const summary = XLSX.utils.json_to_sheet([
      {
        model: selectedModel,
        records: rows.length,
        fields: selectedFields.join(", "),
        generatedAt: new Date().toISOString(),
      },
    ]);
    XLSX.utils.book_append_sheet(wb, summary, "Summary");

    const array = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    downloadBlob(
      new Blob([array], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `scheduled-report-${selectedModel}-${Date.now()}.xlsx`
    );

    setMessage(t("Excel report generated successfully."));
  };

  const saveSchedule = async () => {
    if (!canCreateSchedule) {
      setMessage(t("You do not have access to schedule reports."));
      return;
    }

    const recipient = txt(recipientEmail).toLowerCase();
    if (!recipient) {
      setMessage(t("Please select a recipient email."));
      return;
    }

    const sender = txt(senderEmail);
    if (!sender) {
      setMessage(t("Please enter a verified SES sender email."));
      return;
    }

    const selectedTime = scheduleAt ? new Date(scheduleAt) : null;
    if (!selectedTime || Number.isNaN(selectedTime.getTime())) {
      setMessage(t("Please choose a valid schedule date and time."));
      return;
    }

    if (selectedFields.length === 0) {
      setMessage(t("Please select at least one field to include in the report."));
      return;
    }

    const model = pickModel(client, "ScheduledReport");
    if (!model?.create) {
      setMessage(t("Scheduled report model is not available yet. Please deploy backend changes."));
      return;
    }

    setSavingSchedule(true);
    setMessage("");
    try {
      let actor = "";
      try {
        const user = await getCurrentUser();
        actor = txt(user?.signInDetails?.loginId || user?.username).toLowerCase();
      } catch {
        actor = "";
      }

      const payload = {
        title: txt(scheduleTitle) || `${selectedModel} ${new Date().toLocaleDateString()} ${scheduleFormat}`,
        senderEmail: sender,
        recipientEmail: recipient,
        reportFormat: scheduleFormat,
        reportModel: selectedModel,
        selectedFieldsJson: JSON.stringify(selectedFields),
        filtersJson: JSON.stringify({
          modelKey: selectedModel,
          selectedFields,
          filters,
        }),
        sendAt: selectedTime.toISOString(),
        status: "PENDING",
        createdBy: actor,
        createdAt: new Date().toISOString(),
      };

      const res: any = await model.create(payload);
      const row = (res?.data ?? payload) as AnyObj;

      setQueue((prev) => [
        {
          id: txt(row.id) || `${Date.now()}`,
          title: txt(row.title || payload.title),
          recipientEmail: txt(row.recipientEmail || payload.recipientEmail),
          reportFormat: txt(row.reportFormat).toUpperCase() === "EXCEL" ? "EXCEL" : "PDF",
          status: txt(row.status || "PENDING"),
          sendAt: txt(row.sendAt || payload.sendAt),
          createdAt: txt(row.createdAt || payload.createdAt),
          reportModel: txt(row.reportModel || selectedModel),
          errorMessage: txt(row.errorMessage),
        },
        ...prev,
      ]);

      setScheduleTitle("");
      setRecipientEmail("");
      setSenderEmail("");
      setScheduleAt("");
      setScheduleFormat("PDF");
      setMessage(t("Report schedule saved successfully."));
    } catch (error) {
      console.error("[ScheduledReports] save schedule failed", error);
      setMessage(t("Failed to save report schedule."));
    } finally {
      setSavingSchedule(false);
    }
  };

  const cancelSchedule = async (id: string) => {
    if (!canCancelSchedule) {
      setMessage(t("You do not have access to cancel schedules."));
      return;
    }
    const model = pickModel(client, "ScheduledReport");
    if (!model?.update) {
      setMessage(t("Scheduled report model is not available yet. Please deploy backend changes."));
      return;
    }

    try {
      await model.update({ id, status: "CANCELLED", updatedAt: new Date().toISOString() });
      setQueue((prev) => prev.map((r) => (r.id === id ? { ...r, status: "CANCELLED" } : r)));
      setMessage(t("Schedule cancelled."));
    } catch (error) {
      console.error("[ScheduledReports] cancel failed", error);
      setMessage(t("Failed to cancel schedule."));
    }
  };

  if (!permissions?.canRead) {
    return (
      <section className="sr-page">
        <div className="sr-shell">
          <div className="sr-empty">{t("You do not have access to view this page.")}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="sr-page">
      <div className="sr-shell">
        <header className="sr-header">
          <div className="sr-head-main">
            <div className="sr-head-title-row">
              <div className="sr-head-icon" aria-hidden>
                <i className="fas fa-chart-line" />
              </div>
              <h1>{t("Scheduled Reports")}</h1>
            </div>
            <p className="sr-kicker">{t("Reports & Delivery")}</p>
            <p>{t("Build a report, keep the filters simple, and send it by email on a schedule.")}</p>
          </div>
          <div className="sr-metrics">
            <div><span>{t("Model")}</span><strong>{selectedModel}</strong></div>
            <div><span>{t("Records")}</span><strong>{filteredRows.length}</strong></div>
            <div><span>{t("Scheduled")}</span><strong>{queue.length}</strong></div>
          </div>
        </header>

        <section className="sr-meta-row">
          <p>
            <span className="sr-meta-rail" aria-hidden />
            <span>{t("Manage report filters, exports, and scheduled email delivery in one place.")}</span>
          </p>
        </section>

        <section className="sr-card">
          <div className="sr-card-title">{t("Report Scope")}</div>
          <p className="sr-help">{t("Start with the model, then use the optional filters if you need to narrow the report further.")}</p>
          <div className="sr-grid">
            <label>
              <span>{t("Data Model")}</span>
              <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as ModelKey)}>
                {MODELS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </label>

            <label>
              <span>{t("Search")}</span>
              <input value={filters.search} onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} placeholder={t("Search") as string} />
            </label>

            <label>
              <span>{t("From Date")}</span>
              <input type="date" value={filters.dateFrom} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
            </label>

            <label>
              <span>{t("To Date")}</span>
              <input type="date" value={filters.dateTo} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
            </label>

          </div>

          <details className="sr-disclosure">
            <summary>{t("Advanced filters")}</summary>
            <p className="sr-help">{t("Use these only when the simple search and date range are not enough.")}</p>
            <div className="sr-grid sr-grid-advanced">
              <label>
                <span>{t("Filter Field 1")}</span>
                <select value={filters.field1} onChange={(e) => setFilters((p) => ({ ...p, field1: e.target.value, value1: "" }))}>
                  <option value="">{t("All")}</option>
                  {fieldOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label>
                <span>{t("Filter Value 1")}</span>
                <select value={filters.value1} onChange={(e) => setFilters((p) => ({ ...p, value1: e.target.value }))}>
                  <option value="">{t("All")}</option>
                  {fieldValueOptions(filters.field1).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label>
                <span>{t("Filter Field 2")}</span>
                <select value={filters.field2} onChange={(e) => setFilters((p) => ({ ...p, field2: e.target.value, value2: "" }))}>
                  <option value="">{t("All")}</option>
                  {fieldOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label>
                <span>{t("Filter Value 2")}</span>
                <select value={filters.value2} onChange={(e) => setFilters((p) => ({ ...p, value2: e.target.value }))}>
                  <option value="">{t("All")}</option>
                  {fieldValueOptions(filters.field2).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label>
                <span>{t("Filter Field 3")}</span>
                <select value={filters.field3} onChange={(e) => setFilters((p) => ({ ...p, field3: e.target.value, value3: "" }))}>
                  <option value="">{t("All")}</option>
                  {fieldOptions.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label>
                <span>{t("Filter Value 3")}</span>
                <select value={filters.value3} onChange={(e) => setFilters((p) => ({ ...p, value3: e.target.value }))}>
                  <option value="">{t("All")}</option>
                  {fieldValueOptions(filters.field3).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            </div>
          </details>

          <details className="sr-disclosure">
            <summary>{t("Choose columns")}</summary>
            <div className="sr-fields">
              {fieldOptions.map((field) => {
                const checked = selectedFields.includes(field);
                return (
                  <label key={field} className="sr-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setSelectedFields((prev) => {
                          if (on) return [...prev, field];
                          return prev.filter((f) => f !== field);
                        });
                      }}
                    />
                    <span>{field}</span>
                  </label>
                );
              })}
            </div>
          </details>

          <div className="sr-actions">
            <button type="button" className="sr-btn sr-btn-ghost" onClick={() => setFilters({ ...EMPTY_FILTERS })}>{t("Reset Filters")}</button>
            <button type="button" className="sr-btn sr-btn-primary" onClick={exportPdf} disabled={!canExportPdf}>{t("Generate PDF")}</button>
            <button type="button" className="sr-btn sr-btn-primary" onClick={exportExcel} disabled={!canExportExcel}>{t("Generate Excel")}</button>
          </div>
        </section>

        <section className="sr-card">
          <div className="sr-card-title">{t("Schedule Delivery")}</div>
          <p className="sr-help">{t("The sender must be a verified SES identity in eu-west-1.")}</p>
          <div className="sr-schedule-grid">
            <label>
              <span>{t("Report Title")}</span>
              <input value={scheduleTitle} onChange={(e) => setScheduleTitle(e.target.value)} placeholder={t("Scheduled Reports") as string} />
            </label>
            <label>
              <span>{t("Sender Email")}</span>
              <input value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} placeholder={t("Verified SES identity") as string} />
            </label>
            <label>
              <span>{t("Recipient Email")}</span>
              <select value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)}>
                <option value="">{t("Select recipient")}</option>
                {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </label>
            <label>
              <span>{t("Date & Time")}</span>
              <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
            </label>
            <label>
              <span>{t("Format")}</span>
              <select value={scheduleFormat} onChange={(e) => setScheduleFormat(e.target.value as ReportFormat)}>
                <option value="PDF">PDF</option>
                <option value="EXCEL">Excel</option>
              </select>
            </label>
            <button type="button" className="sr-btn sr-btn-schedule" onClick={() => void saveSchedule()} disabled={savingSchedule || !canCreateSchedule}>
              {savingSchedule ? t("Saving...") : t("Schedule Report")}
            </button>
          </div>
        </section>

        <section className="sr-card">
          <div className="sr-card-title">{t("Filtered Report Preview")}</div>
          <div className="sr-table-wrap">
            <table className="sr-table">
              <thead>
                <tr>
                  {selectedFields.map((f) => <th key={f}>{f}</th>)}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={Math.max(selectedFields.length, 1)}>{t("Loading...")}</td>
                  </tr>
                )}
                {!loading && filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={Math.max(selectedFields.length, 1)}>{t("No records match the current filters.")}</td>
                  </tr>
                )}
                {!loading && filteredRows.slice(0, 250).map((row, idx) => (
                  <tr key={idx}>
                    {selectedFields.map((f) => (
                      <td key={`${idx}-${f}`} className="sr-services" data-label={f}>
                        {txt(row[f]) || "-"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="sr-card">
          <div className="sr-card-title">{t("Scheduled Reports Queue")}</div>
          <div className="sr-table-wrap">
            <table className="sr-table">
              <thead>
                <tr>
                  <th>{t("Title")}</th>
                  <th>{t("Model")}</th>
                  <th>{t("Recipient")}</th>
                  <th>{t("Format")}</th>
                  <th>{t("Send At")}</th>
                  <th>{t("Status")}</th>
                  <th>{t("Error")}</th>
                  <th>{t("Created")}</th>
                  <th>{t("Action")}</th>
                </tr>
              </thead>
              <tbody>
                {queue.length === 0 && (
                  <tr><td colSpan={9}>{t("No schedules found.")}</td></tr>
                )}
                {queue.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t("Title")}>{row.title || "-"}</td>
                    <td data-label={t("Model")}>{row.reportModel || "JobOrder"}</td>
                    <td data-label={t("Recipient")}>{row.recipientEmail || "-"}</td>
                    <td data-label={t("Format")}>{row.reportFormat}</td>
                    <td data-label={t("Send At")}>{dateLabel(row.sendAt)}</td>
                    <td data-label={t("Status")}><span className={`sr-badge sr-${row.status.toLowerCase()}`}>{row.status}</span></td>
                    <td data-label={t("Error")} title={row.errorMessage || ""}>{row.errorMessage || "-"}</td>
                    <td data-label={t("Created")}>{dateLabel(row.createdAt)}</td>
                    <td data-label={t("Action")}>
                      <button
                        type="button"
                        className="sr-btn sr-btn-ghost sr-btn-mini"
                        disabled={!canCancelSchedule || row.status === "CANCELLED" || row.status === "SENT"}
                        onClick={() => void cancelSchedule(row.id)}
                      >
                        {t("Cancel")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {message && <div className="sr-status">{message}</div>}
      </div>
    </section>
  );
}
