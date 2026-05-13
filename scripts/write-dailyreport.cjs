const fs = require("fs");
const path = require("path");

const content = `import { useEffect, useMemo, useState } from "react";
import { FiDownload } from "react-icons/fi";
import type { PageProps } from "../lib/PageProps";
import { useLanguage } from "../i18n/LanguageContext";
import { getDataClient } from "../lib/amplifyClient";
import "./DailyReport.css";

type MetricState = {
  jobsCreated: number;
  jobsCompleted: number;
  totalRevenue: number;
  newCustomers: number;
  activeEmployees: number;
  incidents: number;
};

type FeedItem = {
  id: string;
  time: string;
  date: string;
  type: string;
  title: string;
  detail: string;
};

type JobOrderDetail = {
  id: string;
  dateTime: string;
  jobOrderId: string;
  status: string;
  customerName: string;
  customerPhone: string;
  vehicleInfo: string;
  services: string[];
  products: string[];
  totalAmount: number;
  customerSources: string[];
  vehicleSources: string[];
  serviceSources: string[];
  raw: Record<string, unknown>;
};

type CustomerDetail = {
  id: string;
  name: string;
  phone: string;
  dateTime: string;
};

type VehicleDetail = {
  id: string;
  plate: string;
  make: string;
  model: string;
  color: string;
  customerName: string;
  dateTime: string;
};

type SnapshotRow = {
  id: string;
  branch: string;
  vehicleModel: string;
  advisor: string;
  customer: string;
  phone: string;
  brand: string;
  color: string;
  jobCardId: string;
  serviceDescription: string;
  amount: number;
  invoiceNo: string;
  dateTime: string;
};

type ReportFlavor = "executive" | "technical" | "luxury";

type ListModel = {
  list?: (params: { limit: number }) => Promise<{ data?: unknown[] }>;
};

function toNum(x: unknown) {
  const n = typeof x === "number" ? x : Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function safeText(x: unknown) {
  return String(x ?? "").trim();
}

function parseDate(value: unknown): Date | null {
  const s = safeText(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inDateRange(date: Date, fromDate: string, toDate: string): boolean {
  const day = date.toISOString().slice(0, 10);
  return day >= fromDate && day <= toDate;
}

function firstText(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = safeText(obj?.[key]);
    if (value) return value;
  }
  return "";
}

function firstTextWithSource(
  obj: Record<string, unknown>,
  keys: string[]
): { value: string; source: string } {
  for (const key of keys) {
    const value = safeText(obj?.[key]);
    if (value) return { value, source: key };
  }
  return { value: "", source: "" };
}

function collectTextItems(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => collectTextItems(item))
      .map((item) => safeText(item))
      .filter(Boolean);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const direct = ["name", "serviceName", "title", "label", "productName", "description"]
      .map((k) => safeText(obj[k]))
      .filter(Boolean);
    if (direct.length > 0) return direct;
    return Object.values(obj)
      .flatMap((v) => collectTextItems(v))
      .map((item) => safeText(item))
      .filter(Boolean);
  }
  const text = safeText(value);
  return text ? [text] : [];
}

function collectTextFromKeysWithSources(
  obj: Record<string, unknown>,
  keys: string[]
): { items: string[]; sources: string[] } {
  const items = new Set<string>();
  const sources = new Set<string>();
  for (const key of keys) {
    const values = collectTextItems(obj?.[key]).filter(Boolean);
    if (values.length === 0) continue;
    values.forEach((entry) => items.add(entry));
    sources.add(key);
  }
  return { items: [...items], sources: [...sources] };
}

function pickModel(client: unknown, candidates: string[]) {
  const c = client as { models?: Record<string, ListModel> };
  for (const name of candidates) {
    const m = c?.models?.[name];
    if (m && typeof m.list === "function") return m;
  }
  return null;
}

async function safeList(client: unknown, candidates: string[], limit = 2000): Promise<unknown[]> {
  const model = pickModel(client, candidates);
  if (!model) return [];
  try {
    const out = await model.list?.({ limit });
    return out?.data ?? [];
  } catch {
    return [];
  }
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-QA", {
    style: "currency",
    currency: "QAR",
    maximumFractionDigits: 0,
  }).format(Math.max(0, value));
}

export default function DailyReport({ permissions }: PageProps) {
  const { t } = useLanguage();
  const client = useMemo(() => getDataClient(), []);

  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [flavor, setFlavor] = useState<ReportFlavor>("technical");
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState<MetricState>({
    jobsCreated: 0,
    jobsCompleted: 0,
    totalRevenue: 0,
    newCustomers: 0,
    activeEmployees: 0,
    incidents: 0,
  });
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [jobOrders, setJobOrders] = useState<JobOrderDetail[]>([]);
  const [customerDetails, setCustomerDetails] = useState<CustomerDetail[]>([]);
  const [vehicleDetails, setVehicleDetails] = useState<VehicleDetail[]>([]);
  const [rawInspectorState, setRawInspectorState] = useState<
    Record<string, { open: boolean; focusKeys: string[] }>
  >({});

  const openRawInspectorWithKey = (orderId: string, key: string, appendSelection: boolean) => {
    if (!key) return;
    setRawInspectorState((prev) => {
      const previousKeys = prev[orderId]?.focusKeys ?? [];
      const nextKeys = appendSelection
        ? previousKeys.includes(key)
          ? previousKeys.filter((existing) => existing !== key)
          : [...previousKeys, key]
        : [key];
      return { ...prev, [orderId]: { open: true, focusKeys: nextKeys } };
    });
  };

  useEffect(() => {
    if (!permissions?.canRead) return;

    const normalizedFrom = dateFrom <= dateTo ? dateFrom : dateTo;
    const normalizedTo = dateFrom <= dateTo ? dateTo : dateFrom;
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const [ordersRaw, customersRaw, employeesRaw, logsRaw] = await Promise.all([
          safeList(client, ["JobOrder", "JobOrders"], 2000),
          safeList(client, ["Customer", "Customers"], 2000),
          safeList(client, ["Employee", "Employees"], 2000),
          safeList(client, ["ActivityLog", "ActivityLogs"], 1200),
        ]);

        const orders = ordersRaw as Array<Record<string, unknown>>;
        const customers = customersRaw as Array<Record<string, unknown>>;
        const employees = employeesRaw as Array<Record<string, unknown>>;
        const logs = logsRaw as Array<Record<string, unknown>>;

        const rangedOrders = orders.filter((o) => {
          const d = parseDate(o?.createdAt ?? o?.updatedAt ?? o?.createDate);
          return d ? inDateRange(d, normalizedFrom, normalizedTo) : false;
        });

        const jobsCompleted = rangedOrders.filter((o) => {
          const s = safeText(o?.status ?? o?.workStatus ?? o?.workStatusLabel).toLowerCase();
          return s.includes("completed") || s === "ready";
        }).length;

        const jobsCreated = rangedOrders.length;

        const totalRevenue = rangedOrders.reduce((sum, o) => {
          const billing = o?.billing as Record<string, unknown> | undefined;
          const total =
            toNum(o?.totalAmount) ||
            toNum(billing?.totalAmount) ||
            toNum(billing?.netAmount) ||
            0;
          return sum + Math.max(0, total);
        }, 0);

        const rangedCustomers = customers.filter((c) => {
          const d = parseDate(c?.createdAt ?? c?.updatedAt ?? c?.registeredAt);
          return d ? inDateRange(d, normalizedFrom, normalizedTo) : false;
        });
        const newCustomers = rangedCustomers.length;

        const activeEmployees = employees.filter((e) => {
          const status = safeText(e?.status ?? e?.employmentStatus ?? e?.active).toLowerCase();
          return status === "active" || status === "true" || status === "1";
        }).length;

        type LogEntry = { raw: Record<string, unknown>; date: Date | null };
        const rangedLogs: LogEntry[] = logs
          .map((l) => ({
            raw: l,
            date: parseDate(l?.createdAt ?? l?.timestamp ?? l?.updatedAt),
          }))
          .filter((x): x is LogEntry & { date: Date } =>
            x.date !== null && inDateRange(x.date, normalizedFrom, normalizedTo)
          );

        const incidents = rangedLogs.filter((x) => {
          const text = \`\${safeText(x.raw?.action)} \${safeText(x.raw?.message)} \${safeText(x.raw?.type)}\`.toLowerCase();
          return text.includes("error") || text.includes("failed") || text.includes("warning");
        }).length;

        const feedItems: FeedItem[] = rangedLogs
          .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
          .slice(0, 80)
          .map((x, idx) => ({
            id: String(x.raw?.id ?? idx),
            time: x.date
              ? x.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "--:--",
            date: x.date ? x.date.toLocaleDateString() : "",
            type: safeText(x.raw?.action ?? x.raw?.type ?? "Event"),
            title: safeText(x.raw?.message ?? x.raw?.title ?? "System activity"),
            detail: safeText(x.raw?.details ?? x.raw?.module ?? "Operations stream"),
          }));

        const orderDetails: JobOrderDetail[] = [...rangedOrders]
          .sort((a, b) => {
            const ta = parseDate(a?.createdAt ?? a?.updatedAt ?? a?.createDate)?.getTime() ?? 0;
            const tb = parseDate(b?.createdAt ?? b?.updatedAt ?? b?.createDate)?.getTime() ?? 0;
            return tb - ta;
          })
          .map((o, idx) => {
            const created = parseDate(o?.createdAt ?? o?.updatedAt ?? o?.createDate);
            const serviceExtraction = collectTextFromKeysWithSources(o, [
              "services",
              "serviceLines",
              "selectedServices",
              "serviceName",
            ]);
            const services = serviceExtraction.items;
            const products = Array.from(
              new Set(
                [
                  ...collectTextItems(o?.products),
                  ...collectTextItems(o?.productLines),
                  ...collectTextItems(o?.items),
                  ...collectTextItems(o?.inventoryItems),
                ].filter(Boolean)
              )
            );
            const customerNameExt = firstTextWithSource(o, ["customerName", "customer", "clientName", "ownerName"]);
            const customerPhoneExt = firstTextWithSource(o, ["customerPhone", "mobileNumber", "phone", "contactNumber"]);
            const plateExt = firstTextWithSource(o, ["vehiclePlateNumber", "plateNumber", "plate"]);
            const makeExt = firstTextWithSource(o, ["vehicleMake", "make", "vehicleBrand"]);
            const modelExt = firstTextWithSource(o, ["vehicleModel", "model"]);
            const colorExt = firstTextWithSource(o, ["vehicleColor", "color"]);
            const vehicleInfo = [plateExt.value, makeExt.value, modelExt.value, colorExt.value]
              .filter(Boolean)
              .join(" • ");
            const billing = o?.billing as Record<string, unknown> | undefined;

            return {
              id: String(o?.id ?? idx),
              dateTime: created
                ? \`\${created.toLocaleDateString()} \${created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}\`
                : "—",
              jobOrderId: firstText(o, ["jobOrderId", "jobCardNumber", "orderNumber", "id"]),
              status: firstText(o, ["status", "workStatus", "workStatusLabel"]) || "—",
              customerName: customerNameExt.value || "—",
              customerPhone: customerPhoneExt.value || "—",
              vehicleInfo: vehicleInfo || "—",
              services,
              products,
              totalAmount:
                toNum(o?.totalAmount) ||
                toNum(billing?.totalAmount) ||
                toNum(billing?.netAmount) ||
                0,
              customerSources: Array.from(new Set([customerNameExt.source, customerPhoneExt.source].filter(Boolean))),
              vehicleSources: Array.from(
                new Set([plateExt.source, makeExt.source, modelExt.source, colorExt.source].filter(Boolean))
              ),
              serviceSources: serviceExtraction.sources,
              raw: o,
            };
          });

        const customersDetails: CustomerDetail[] = [...rangedCustomers]
          .sort((a, b) => {
            const ta = parseDate(a?.createdAt ?? a?.updatedAt ?? a?.registeredAt)?.getTime() ?? 0;
            const tb = parseDate(b?.createdAt ?? b?.updatedAt ?? b?.registeredAt)?.getTime() ?? 0;
            return tb - ta;
          })
          .map((c, idx) => {
            const d = parseDate(c?.createdAt ?? c?.updatedAt ?? c?.registeredAt);
            return {
              id: String(c?.id ?? idx),
              name: firstText(c, ["name", "customerName", "fullName"]) || "—",
              phone: firstText(c, ["mobileNumber", "phone", "whatsapp", "contactNumber"]) || "—",
              dateTime: d
                ? \`\${d.toLocaleDateString()} \${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}\`
                : "—",
            };
          });

        const vehicles: VehicleDetail[] = orderDetails
          .map((order, idx) => {
            const parts = order.vehicleInfo.split(" • ");
            return {
              id: \`\${order.id}-\${idx}\`,
              plate: parts[0] || "—",
              make: parts[1] || "—",
              model: parts[2] || "—",
              color: parts[3] || "—",
              customerName: order.customerName,
              dateTime: order.dateTime,
            };
          })
          .filter((v) => v.plate !== "—" || v.make !== "—" || v.model !== "—");

        if (!cancelled) {
          setMetrics({ jobsCreated, jobsCompleted, totalRevenue, newCustomers, activeEmployees, incidents });
          setFeed(feedItems);
          setJobOrders(orderDetails);
          setCustomerDetails(customersDetails);
          setVehicleDetails(vehicles);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => { cancelled = true; };
  }, [client, dateFrom, dateTo, permissions?.canRead]);

  const completionRate =
    metrics.jobsCreated > 0
      ? Math.round((metrics.jobsCompleted / metrics.jobsCreated) * 100)
      : 0;
  const qualityScore = Math.max(0, Math.min(100, Math.round(100 - metrics.incidents * 7)));

  const cards = [
    { label: t("Jobs Created"), value: String(metrics.jobsCreated), tone: "blue" },
    { label: t("Jobs Completed"), value: String(metrics.jobsCompleted), tone: "green" },
    { label: t("Revenue"), value: formatMoney(metrics.totalRevenue), tone: "amber" },
    { label: t("New Customers"), value: String(metrics.newCustomers), tone: "violet" },
    { label: t("Active Employees"), value: String(metrics.activeEmployees), tone: "teal" },
    { label: t("Incidents"), value: String(metrics.incidents), tone: "rose" },
  ];

  const flavorOptions: Array<{ key: ReportFlavor; label: string }> = [
    { key: "executive", label: t("Executive") },
    { key: "technical", label: t("Technical") },
    { key: "luxury", label: t("Luxury") },
  ];

  const snapshotRows = useMemo<SnapshotRow[]>(() => {
    return jobOrders.map((order, index) => {
      const raw = order.raw;
      const branch = firstText(raw, ["branch", "branchName", "location", "site", "department"]);
      const vehicleModel = firstText(raw, ["vehicleModel", "model"]);
      const advisor = firstText(raw, ["serviceAdvisor", "advisor", "assignedTo", "assignedEmployee", "employeeName", "createdBy"]);
      const brand = firstText(raw, ["vehicleMake", "make", "vehicleBrand"]);
      const color = firstText(raw, ["vehicleColor", "color"]);
      const billing = raw?.billing as Record<string, unknown> | undefined;
      const invoiceNo =
        firstText(raw, ["invoiceNumber", "invoiceNo", "billId", "billingId"]) ||
        safeText(billing?.billId ?? billing?.invoiceNumber ?? billing?.invoiceNo);

      return {
        id: \`\${order.id}-\${index}\`,
        branch: branch || "—",
        vehicleModel: vehicleModel || "—",
        advisor: advisor || "—",
        customer: order.customerName || "—",
        phone: order.customerPhone || "—",
        brand: brand || "—",
        color: color || "—",
        jobCardId: order.jobOrderId || order.id || "—",
        serviceDescription:
          order.services.length > 0
            ? order.services.join(" / ")
            : order.products.length > 0
              ? order.products.join(" / ")
              : "—",
        amount: Math.max(0, order.totalAmount),
        invoiceNo: invoiceNo || "—",
        dateTime: order.dateTime || "—",
      };
    });
  }, [jobOrders]);

  const snapshotTotal = useMemo(
    () => snapshotRows.reduce((sum, row) => sum + Math.max(0, toNum(row.amount)), 0),
    [snapshotRows]
  );

  if (!permissions?.canRead) {
    return <div className="dr2-page"><p style={{ padding: 24, color: "#2B3674" }}>{t("You don't have access to this page.")}</p></div>;
  }

  return (
    <div className={\`dr2-page flavor-\${flavor}\`}>
      {/* ── HEADER ── */}
      <header className="dr2-header">
        <div className="dr2-header-left">
          <p className="dr2-kicker">{t("Executive Operations")}</p>
          <h1 className="dr2-main-title">{t("Daily Report")}</h1>
          <p className="dr2-sub">{t("Unified daily brief for service, quality, finance, and staffing.")}</p>
        </div>
        <div className="dr2-actions">
          <label className="dr2-date-label">
            {t("From")}
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="dr2-date-input"
            />
          </label>
          <label className="dr2-date-label">
            {t("To")}
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="dr2-date-input"
            />
          </label>
          <fieldset className="dr2-flavor" aria-label={t("Visual Flavor")}>
            <legend className="dr2-flavor-legend">{t("Style")}</legend>
            {flavorOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={\`dr2-flavor-btn\${option.key === flavor ? " is-active" : ""}\`}
                onClick={() => setFlavor(option.key)}
                aria-pressed={option.key === flavor}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            className="dr2-export-btn"
            onClick={() => {
              const lines = [
                \`\${t("Daily Report")} - \${dateFrom} \${t("to")} \${dateTo}\`,
                \`\${t("Jobs Created")}: \${metrics.jobsCreated}\`,
                \`\${t("Jobs Completed")}: \${metrics.jobsCompleted}\`,
                \`\${t("Revenue")}: \${formatMoney(metrics.totalRevenue)}\`,
                \`\${t("New Customers")}: \${metrics.newCustomers}\`,
                \`\${t("Active Employees")}: \${metrics.activeEmployees}\`,
                \`\${t("Incidents")}: \${metrics.incidents}\`,
              ].join("\\n");
              const blob = new Blob([lines], { type: "text/plain;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = \`daily-report-\${dateFrom}-to-\${dateTo}.txt\`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <FiDownload /> {t("Export Snapshot")}
          </button>
        </div>
      </header>

      {/* ── KPI CARDS ── */}
      <section className="dr2-summary-grid" aria-label={t("Daily KPIs")}>
        {cards.map((card) => (
          <article key={card.label} className={\`dr2-summary-card tone-\${card.tone}\`}>
            <div>
              <p className="dr2-card-label">{card.label}</p>
              <p className="dr2-card-value">{card.value}</p>
            </div>
          </article>
        ))}
      </section>

      {/* ── OPERATIONAL HEALTH + ACTIVITY FEED ── */}
      <section className="dr2-two-col">
        <article className="dr2-panel">
          <h2 className="dr2-panel-title">{t("Operational Health")}</h2>
          <div className="dr2-metric-line">
            <span>{t("Completion Rate")}</span>
            <strong>{completionRate}%</strong>
          </div>
          <div className="dr2-progress"><span style={{ width: \`\${completionRate}%\` }} /></div>

          <div className="dr2-metric-line">
            <span>{t("Quality Score")}</span>
            <strong>{qualityScore}/100</strong>
          </div>
          <div className="dr2-progress quality"><span style={{ width: \`\${qualityScore}%\` }} /></div>

          <ul className="dr2-highlights">
            <li>{t("Top priority: keep rework and incident count under control before shift handoff.")}</li>
            <li>{t("Finance watch: verify invoice alignment for all completed orders.")}</li>
            <li>{t("Service focus: maintain throughput while preserving quality checkpoints.")}</li>
          </ul>
        </article>

        <article className="dr2-panel">
          <h2 className="dr2-panel-title">{t("Activity Feed")}</h2>
          {loading ? (
            <p className="dr2-loading">{t("Loading...")}</p>
          ) : feed.length === 0 ? (
            <p className="dr2-loading">{t("No activity captured for this date range.")}</p>
          ) : (
            <div className="dr2-feed">
              {feed.map((item) => (
                <div key={item.id} className="dr2-feed-row">
                  <span className="dr2-feed-time">{item.time}</span>
                  <span className="dr2-feed-type">{item.type || t("Event")}</span>
                  <div className="dr2-feed-body">
                    <p className="dr2-feed-date">{item.date}</p>
                    <p className="dr2-feed-title">{item.title}</p>
                    <p className="dr2-feed-detail">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      {/* ── JOB ORDER DETAILS ── */}
      <section className="dr2-details-grid">
        <article className="dr2-panel dr2-wide-panel">
          <h2 className="dr2-panel-title">{t("Job Order Details")}</h2>
          {loading ? (
            <p className="dr2-loading">{t("Loading...")}</p>
          ) : jobOrders.length === 0 ? (
            <p className="dr2-loading">{t("No job orders found for this date range.")}</p>
          ) : (
            <div className="dr2-detail-list">
              {jobOrders.map((order) => (
                <details key={order.id} className="dr2-detail-item" open={false}>
                  <summary className="dr2-detail-summary">
                    <span>{order.jobOrderId || order.id}</span>
                    <span className="dr2-detail-status">{order.status}</span>
                    <span className="dr2-detail-date">{order.dateTime}</span>
                  </summary>
                  <div className="dr2-detail-body">
                    <div className="dr2-detail-grid">
                      <div><strong>{t("Customer")}</strong><p>{order.customerName}</p></div>
                      <div><strong>{t("Phone")}</strong><p>{order.customerPhone}</p></div>
                      <div><strong>{t("Vehicle")}</strong><p>{order.vehicleInfo}</p></div>
                      <div><strong>{t("Revenue")}</strong><p>{formatMoney(order.totalAmount)}</p></div>
                      <div className="dr2-span-2"><strong>{t("Services")}</strong><p>{order.services.length > 0 ? order.services.join(" | ") : "—"}</p></div>
                      <div className="dr2-span-2"><strong>{t("Products")}</strong><p>{order.products.length > 0 ? order.products.join(" | ") : "—"}</p></div>
                    </div>
                    <div className="dr2-source-trace">
                      <strong>{t("Detected source columns used now")}:</strong>
                      <div className="dr2-source-row">
                        <span>{t("Customer source")}</span>
                        <div className="dr2-source-pills">
                          {order.customerSources.length > 0
                            ? order.customerSources.map((key) => (
                                <button
                                  key={\`\${order.id}-customer-\${key}\`}
                                  type="button"
                                  className={(rawInspectorState[order.id]?.focusKeys ?? []).includes(key) ? "is-active" : ""}
                                  onClick={(e) => openRawInspectorWithKey(order.id, key, e.ctrlKey || e.metaKey)}
                                >
                                  {key}
                                </button>
                              ))
                            : <em>{t("Unknown source")}</em>}
                        </div>
                      </div>
                      <div className="dr2-source-row">
                        <span>{t("Vehicle source")}</span>
                        <div className="dr2-source-pills">
                          {order.vehicleSources.length > 0
                            ? order.vehicleSources.map((key) => (
                                <button
                                  key={\`\${order.id}-vehicle-\${key}\`}
                                  type="button"
                                  className={(rawInspectorState[order.id]?.focusKeys ?? []).includes(key) ? "is-active" : ""}
                                  onClick={(e) => openRawInspectorWithKey(order.id, key, e.ctrlKey || e.metaKey)}
                                >
                                  {key}
                                </button>
                              ))
                            : <em>{t("Unknown source")}</em>}
                        </div>
                      </div>
                      <div className="dr2-source-row">
                        <span>{t("Service source")}</span>
                        <div className="dr2-source-pills">
                          {order.serviceSources.length > 0
                            ? order.serviceSources.map((key) => (
                                <button
                                  key={\`\${order.id}-service-\${key}\`}
                                  type="button"
                                  className={(rawInspectorState[order.id]?.focusKeys ?? []).includes(key) ? "is-active" : ""}
                                  onClick={(e) => openRawInspectorWithKey(order.id, key, e.ctrlKey || e.metaKey)}
                                >
                                  {key}
                                </button>
                              ))
                            : <em>{t("Unknown source")}</em>}
                        </div>
                      </div>
                      <small>{t("Click a source label to open and highlight it in Raw Details. Use Ctrl/Cmd + click to multi-select.")}</small>
                    </div>
                    <details
                      className="dr2-raw-json"
                      open={Boolean(rawInspectorState[order.id]?.open)}
                      onToggle={(e) => {
                        const nextOpen = (e.currentTarget as HTMLDetailsElement).open;
                        setRawInspectorState((prev) => ({
                          ...prev,
                          [order.id]: { open: nextOpen, focusKeys: prev[order.id]?.focusKeys ?? [] },
                        }));
                      }}
                    >
                      <summary>{t("Raw Details")}</summary>
                      <div className="dr2-json-view">
                        {JSON.stringify(order.raw, null, 2)
                          .split("\\n")
                          .map((line, idx) => {
                            const focusedKeys = rawInspectorState[order.id]?.focusKeys ?? [];
                            const isHit = focusedKeys.some((key) => line.includes(\`"\${key}"\`));
                            return (
                              <div
                                key={\`\${order.id}-json-\${idx}\`}
                                className={\`dr2-json-line\${isHit ? " is-hit" : ""}\`}
                              >
                                {line || " "}
                              </div>
                            );
                          })}
                      </div>
                    </details>
                  </div>
                </details>
              ))}
            </div>
          )}
        </article>

        {/* ── DAILY SALES SNAPSHOT ── */}
        <article className="dr2-panel dr2-wide-panel">
          <h2 className="dr2-panel-title">{t("Daily Sales Snapshot")}</h2>
          {loading ? (
            <p className="dr2-loading">{t("Loading...")}</p>
          ) : snapshotRows.length === 0 ? (
            <p className="dr2-loading">{t("No records in selected date range.")}</p>
          ) : (
            <div className="dr2-table-wrap">
              <table className="dr2-table dr2-snapshot-table">
                <thead>
                  <tr>
                    <th>{t("Branch")}</th>
                    <th>{t("Vehicle Model")}</th>
                    <th>{t("Advisor")}</th>
                    <th>{t("Customer")}</th>
                    <th>{t("Phone")}</th>
                    <th>{t("Brand")}</th>
                    <th>{t("Color")}</th>
                    <th>{t("Job Card ID")}</th>
                    <th>{t("Service Description")}</th>
                    <th>{t("Amount")}</th>
                    <th>{t("Invoice No")}</th>
                    <th>{t("Date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshotRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.branch}</td>
                      <td>{row.vehicleModel}</td>
                      <td>{row.advisor}</td>
                      <td>{row.customer}</td>
                      <td>{row.phone}</td>
                      <td>{row.brand}</td>
                      <td>{row.color}</td>
                      <td>{row.jobCardId}</td>
                      <td>{row.serviceDescription}</td>
                      <td className="dr2-amount-cell">{formatMoney(row.amount)}</td>
                      <td>{row.invoiceNo}</td>
                      <td>{row.dateTime}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={9} className="dr2-total-label">{t("Total")}</td>
                    <td className="dr2-amount-cell dr2-total-amount">{formatMoney(snapshotTotal)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </article>

        {/* ── CUSTOMERS IN RANGE ── */}
        <article className="dr2-panel">
          <h2 className="dr2-panel-title">{t("Customers In Range")}</h2>
          {loading ? (
            <p className="dr2-loading">{t("Loading...")}</p>
          ) : customerDetails.length === 0 ? (
            <p className="dr2-loading">{t("No customers found for this date range.")}</p>
          ) : (
            <div className="dr2-simple-table">
              {customerDetails.map((c) => (
                <div key={c.id} className="dr2-simple-row">
                  <span>{c.name}</span>
                  <span>{c.phone}</span>
                  <span>{c.dateTime}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        {/* ── VEHICLES IN RANGE ── */}
        <article className="dr2-panel">
          <h2 className="dr2-panel-title">{t("Vehicles In Range")}</h2>
          {loading ? (
            <p className="dr2-loading">{t("Loading...")}</p>
          ) : vehicleDetails.length === 0 ? (
            <p className="dr2-loading">{t("No vehicles found for this date range.")}</p>
          ) : (
            <div className="dr2-simple-table">
              {vehicleDetails.map((v) => (
                <div key={v.id} className="dr2-simple-row">
                  <span>{[v.plate, v.make, v.model].filter((x) => x && x !== "—").join(" • ") || "—"}</span>
                  <span>{v.customerName}</span>
                  <span>{v.dateTime}</span>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
`;

const outPath = path.join(__dirname, "..", "src", "pages", "DailyReport.tsx");
fs.writeFileSync(outPath, content, "utf8");
console.log("DailyReport.tsx written:", outPath);
console.log("Size:", fs.statSync(outPath).size, "bytes");
