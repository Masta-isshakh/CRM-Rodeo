import { useEffect, useMemo, useState } from "react";
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

type ReportFlavor = "executive" | "technical" | "luxury";

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

function firstText(obj: any, keys: string[]): string {
  for (const key of keys) {
    const value = safeText(obj?.[key]);
    if (value) return value;
  }
  return "";
}

function firstTextWithSource(obj: any, keys: string[]): { value: string; source: string } {
  for (const key of keys) {
    const value = safeText(obj?.[key]);
    if (value) return { value, source: key };
  }
  return { value: "", source: "" };
}

function collectTextFromKeysWithSources(
  obj: Record<string, unknown>,
  keys: string[]
): { items: string[]; sources: string[] } {
  const items = new Set<string>();
  const sources = new Set<string>();

  for (const key of keys) {
    const value = obj?.[key];
    const values = collectTextItems(value).filter(Boolean);
    if (values.length === 0) continue;
    values.forEach((entry) => items.add(entry));
    sources.add(key);
  }

  return { items: [...items], sources: [...sources] };
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

function pickModel(client: any, candidates: string[]) {
  for (const name of candidates) {
    const m = client?.models?.[name];
    if (m && typeof m.list === "function") return m;
  }
  return null;
}

async function safeList(client: any, candidates: string[], limit = 1000): Promise<any[]> {
  const model = pickModel(client, candidates);
  if (!model) return [];
  try {
    const out = await model.list({ limit });
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
  const [rawInspectorState, setRawInspectorState] = useState<Record<string, { open: boolean; focusKeys: string[] }>>({});

  const openRawInspectorWithKey = (orderId: string, key: string, appendSelection: boolean) => {
    if (!key) return;
    setRawInspectorState((prev) => {
      const previousKeys = prev[orderId]?.focusKeys ?? [];
      const nextKeys = appendSelection
        ? (previousKeys.includes(key) ? previousKeys.filter((existing) => existing !== key) : [...previousKeys, key])
        : [key];

      return {
        ...prev,
        [orderId]: {
          open: true,
          focusKeys: nextKeys,
        },
      };
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
        const [orders, customers, employees, logs] = await Promise.all([
          safeList(client, ["JobOrder", "JobOrders"], 2000),
          safeList(client, ["Customer", "Customers"], 2000),
          safeList(client, ["Employee", "Employees"], 2000),
          safeList(client, ["ActivityLog", "ActivityLogs"], 1200),
        ]);

        const rangedOrders = orders.filter((o: any) => {
          const d = parseDate(o?.createdAt ?? o?.updatedAt ?? o?.createDate);
          return d ? inDateRange(d, normalizedFrom, normalizedTo) : false;
        });

        const jobsCompleted = rangedOrders.filter((o: any) => {
          const s = safeText(o?.status ?? o?.workStatus ?? o?.workStatusLabel).toLowerCase();
          return s.includes("completed") || s === "ready";
        }).length;

        const jobsCreated = rangedOrders.length;
        const totalRevenue = rangedOrders.reduce((sum: number, o: any) => {
          const orderTotal =
            toNum(o?.totalAmount) ||
            toNum(o?.billing?.totalAmount) ||
            toNum(o?.billing?.netAmount) ||
            0;
          return sum + Math.max(0, orderTotal);
        }, 0);

        const rangedCustomers = customers.filter((c: any) => {
          const d = parseDate(c?.createdAt ?? c?.updatedAt ?? c?.registeredAt);
          return d ? inDateRange(d, normalizedFrom, normalizedTo) : false;
        });
        const newCustomers = rangedCustomers.length;

        const activeEmployees = employees.filter((e: any) => {
          const status = safeText(e?.status ?? e?.employmentStatus ?? e?.active).toLowerCase();
          return status === "active" || status === "true" || status === "1";
        }).length;

        const rangedLogs = logs
          .map((l: any) => {
            const d = parseDate(l?.createdAt ?? l?.timestamp ?? l?.updatedAt);
            return {
              raw: l,
              date: d,
            };
          })
          .filter((x: any) => (x.date ? inDateRange(x.date, normalizedFrom, normalizedTo) : false));

        const incidents = rangedLogs.filter((x: any) => {
          const text = `${safeText(x.raw?.action)} ${safeText(x.raw?.message)} ${safeText(x.raw?.type)}`.toLowerCase();
          return text.includes("error") || text.includes("failed") || text.includes("warning");
        }).length;

        const feedItems: FeedItem[] = rangedLogs
          .sort((a: any, b: any) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
          .slice(0, 80)
          .map((x: any, idx: number) => ({
            id: String(x.raw?.id ?? idx),
            time: x.date ? x.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--",
            date: x.date ? x.date.toLocaleDateString() : "",
            type: safeText(x.raw?.action || x.raw?.type || "Event"),
            title: safeText(x.raw?.message || x.raw?.title || "System activity"),
            detail: safeText(x.raw?.details || x.raw?.module || "Operations stream"),
          }));

        const orderDetails: JobOrderDetail[] = [...rangedOrders]
          .sort((a: any, b: any) => {
            const ta = parseDate(a?.createdAt ?? a?.updatedAt ?? a?.createDate)?.getTime() ?? 0;
            const tb = parseDate(b?.createdAt ?? b?.updatedAt ?? b?.createDate)?.getTime() ?? 0;
            return tb - ta;
          })
          .map((o: any, idx: number) => {
            const created = parseDate(o?.createdAt ?? o?.updatedAt ?? o?.createDate);
            const serviceExtraction = collectTextFromKeysWithSources(o, [
              "services",
              "serviceLines",
              "selectedServices",
              "serviceName",
            ]);
            const services = serviceExtraction.items;
            const products = Array.from(
              new Set([
                ...collectTextItems(o?.products),
                ...collectTextItems(o?.productLines),
                ...collectTextItems(o?.items),
                ...collectTextItems(o?.inventoryItems),
              ].filter(Boolean))
            );
            const customerNameExtraction = firstTextWithSource(o, ["customerName", "customer", "clientName", "ownerName"]);
            const customerPhoneExtraction = firstTextWithSource(o, ["customerPhone", "mobileNumber", "phone", "contactNumber"]);
            const plateExtraction = firstTextWithSource(o, ["vehiclePlateNumber", "plateNumber", "plate"]);
            const makeExtraction = firstTextWithSource(o, ["vehicleMake", "make", "vehicleBrand"]);
            const modelExtraction = firstTextWithSource(o, ["vehicleModel", "model"]);
            const colorExtraction = firstTextWithSource(o, ["vehicleColor", "color"]);
            const customerName = customerNameExtraction.value;
            const customerPhone = customerPhoneExtraction.value;
            const plate = plateExtraction.value;
            const make = makeExtraction.value;
            const model = modelExtraction.value;
            const color = colorExtraction.value;
            const vehicleInfo = [plate, make, model, color].filter(Boolean).join(" • ");
            const customerSources = [customerNameExtraction.source, customerPhoneExtraction.source].filter(Boolean);
            const vehicleSources = [
              plateExtraction.source,
              makeExtraction.source,
              modelExtraction.source,
              colorExtraction.source,
            ].filter(Boolean);

            return {
              id: String(o?.id ?? idx),
              dateTime: created ? `${created.toLocaleDateString()} ${created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "—",
              jobOrderId: firstText(o, ["jobOrderId", "jobCardNumber", "orderNumber", "id"]),
              status: firstText(o, ["status", "workStatus", "workStatusLabel"]) || "—",
              customerName: customerName || "—",
              customerPhone: customerPhone || "—",
              vehicleInfo: vehicleInfo || "—",
              services,
              products,
              totalAmount: toNum(o?.totalAmount) || toNum(o?.billing?.totalAmount) || toNum(o?.billing?.netAmount) || 0,
              customerSources: Array.from(new Set(customerSources)),
              vehicleSources: Array.from(new Set(vehicleSources)),
              serviceSources: serviceExtraction.sources,
              raw: o,
            };
          });

        const customersDetails: CustomerDetail[] = [...rangedCustomers]
          .sort((a: any, b: any) => {
            const ta = parseDate(a?.createdAt ?? a?.updatedAt ?? a?.registeredAt)?.getTime() ?? 0;
            const tb = parseDate(b?.createdAt ?? b?.updatedAt ?? b?.registeredAt)?.getTime() ?? 0;
            return tb - ta;
          })
          .map((c: any, idx: number) => {
            const d = parseDate(c?.createdAt ?? c?.updatedAt ?? c?.registeredAt);
            return {
              id: String(c?.id ?? idx),
              name: firstText(c, ["name", "customerName", "fullName"]) || "—",
              phone: firstText(c, ["mobileNumber", "phone", "whatsapp", "contactNumber"]) || "—",
              dateTime: d ? `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "—",
            };
          });

        const vehicles = orderDetails
          .map((order, idx) => ({
            id: `${order.id}-${idx}`,
            plate: order.vehicleInfo.split(" • ")[0] || "—",
            make: order.vehicleInfo.split(" • ")[1] || "—",
            model: order.vehicleInfo.split(" • ")[2] || "—",
            color: order.vehicleInfo.split(" • ")[3] || "—",
            customerName: order.customerName,
            dateTime: order.dateTime,
          }))
          .filter((v) => v.plate !== "—" || v.make !== "—" || v.model !== "—");

        if (!cancelled) {
          setMetrics({
            jobsCreated,
            jobsCompleted,
            totalRevenue,
            newCustomers,
            activeEmployees,
            incidents,
          });
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

    return () => {
      cancelled = true;
    };
  }, [client, dateFrom, dateTo, permissions?.canRead]);

  const completionRate = metrics.jobsCreated > 0 ? Math.round((metrics.jobsCompleted / metrics.jobsCreated) * 100) : 0;
  const qualityScore = Math.max(0, Math.min(100, Math.round(100 - metrics.incidents * 7)));

  const cards = [
    { label: t("Jobs Created"), value: String(metrics.jobsCreated), icon: "fa-briefcase", tone: "blue" },
    { label: t("Jobs Completed"), value: String(metrics.jobsCompleted), icon: "fa-check-circle", tone: "green" },
    { label: t("Revenue"), value: formatMoney(metrics.totalRevenue), icon: "fa-coins", tone: "amber" },
    { label: t("New Customers"), value: String(metrics.newCustomers), icon: "fa-user-plus", tone: "violet" },
    { label: t("Active Employees"), value: String(metrics.activeEmployees), icon: "fa-user-tie", tone: "teal" },
    { label: t("Incidents"), value: String(metrics.incidents), icon: "fa-triangle-exclamation", tone: "rose" },
  ];

  const flavorOptions: Array<{ key: ReportFlavor; label: string }> = [
    { key: "executive", label: t("Executive") },
    { key: "technical", label: t("Technical") },
    { key: "luxury", label: t("Luxury") },
  ];

  return (
    <div className={`daily-report-page flavor-${flavor}`}>
      <header className="dr-header">
        <div>
          <p className="dr-kicker">{t("Executive Operations")}</p>
          <h1>{t("Daily Report")}</h1>
          <p className="dr-sub">{t("Unified daily brief for service, quality, finance, and staffing.")}</p>
        </div>
        <div className="dr-actions">
          <label>
            {t("From Date")}
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label>
            {t("To Date")}
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <fieldset className="dr-flavor" aria-label={t("Visual Flavor")}>
            <legend>{t("Style")}</legend>
            {flavorOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={option.key === flavor ? "is-active" : ""}
                onClick={() => setFlavor(option.key)}
                aria-pressed={option.key === flavor}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            onClick={() => {
              const content = [
                `${t("Daily Report")} - ${dateFrom} ${t("to")} ${dateTo}`,
                `${t("Jobs Created")}: ${metrics.jobsCreated}`,
                `${t("Jobs Completed")}: ${metrics.jobsCompleted}`,
                `${t("Revenue")}: ${formatMoney(metrics.totalRevenue)}`,
                `${t("New Customers")}: ${metrics.newCustomers}`,
                `${t("Active Employees")}: ${metrics.activeEmployees}`,
                `${t("Incidents")}: ${metrics.incidents}`,
              ].join("\n");
              const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `daily-report-${dateFrom}-to-${dateTo}.txt`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <i className="fas fa-file-export" aria-hidden="true" /> {t("Export Snapshot")}
          </button>
        </div>
      </header>

      <section className="dr-cards" aria-label={t("Daily KPIs")}>
        {cards.map((card) => (
          <article key={card.label} className={`dr-card tone-${card.tone}`}>
            <span className="dr-card-icon"><i className={`fas ${card.icon}`} aria-hidden="true" /></span>
            <div>
              <p className="dr-card-label">{card.label}</p>
              <p className="dr-card-value">{card.value}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="dr-grid">
        <article className="dr-panel">
          <h2>{t("Operational Health")}</h2>
          <div className="dr-metric-line">
            <span>{t("Completion Rate")}</span>
            <strong>{completionRate}%</strong>
          </div>
          <div className="dr-progress"><span style={{ width: `${completionRate}%` }} /></div>

          <div className="dr-metric-line">
            <span>{t("Quality Score")}</span>
            <strong>{qualityScore}/100</strong>
          </div>
          <div className="dr-progress quality"><span style={{ width: `${qualityScore}%` }} /></div>

          <ul className="dr-highlights">
            <li>{t("Top priority: keep rework and incident count under control before shift handoff.")}</li>
            <li>{t("Finance watch: verify invoice alignment for all completed orders.")}</li>
            <li>{t("Service focus: maintain throughput while preserving quality checkpoints.")}</li>
          </ul>
        </article>

        <article className="dr-panel">
          <h2>{t("Activity Feed")}</h2>
          {loading ? (
            <div className="dr-loading">{t("Loading...")}</div>
          ) : feed.length === 0 ? (
            <div className="dr-loading">{t("No activity captured for this date range.")}</div>
          ) : (
            <div className="dr-feed">
              {feed.map((item) => (
                <div key={item.id} className="dr-feed-row">
                  <span className="dr-time">{item.time}</span>
                  <span className="dr-type">{item.type || t("Event")}</span>
                  <div>
                    <p className="dr-detail">{item.date}</p>
                    <p className="dr-title">{item.title}</p>
                    <p className="dr-detail">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="dr-details-grid">
        <article className="dr-panel dr-wide-panel">
          <h2>{t("Job Order Details")}</h2>
          {loading ? (
            <div className="dr-loading">{t("Loading...")}</div>
          ) : jobOrders.length === 0 ? (
            <div className="dr-loading">{t("No job orders found for this date range.")}</div>
          ) : (
            <div className="dr-detail-list">
              {jobOrders.map((order) => (
                <details key={order.id} className="dr-detail-item" open={false}>
                  <summary>
                    <span>{order.jobOrderId || order.id}</span>
                    <span>{order.status}</span>
                    <span>{order.dateTime}</span>
                  </summary>
                  <div className="dr-detail-body">
                    <div className="dr-detail-grid">
                      <div><strong>{t("Customer")}</strong><p>{order.customerName}</p></div>
                      <div><strong>{t("Phone")}</strong><p>{order.customerPhone}</p></div>
                      <div><strong>{t("Vehicle")}</strong><p>{order.vehicleInfo}</p></div>
                      <div><strong>{t("Revenue")}</strong><p>{formatMoney(order.totalAmount)}</p></div>
                      <div className="dr-span-2"><strong>{t("Services")}</strong><p>{order.services.length > 0 ? order.services.join(" | ") : "—"}</p></div>
                      <div className="dr-span-2"><strong>{t("Products")}</strong><p>{order.products.length > 0 ? order.products.join(" | ") : "—"}</p></div>
                    </div>
                    <div className="dr-source-trace">
                      <strong>{t("Detected source columns used now")}:</strong>
                      <div className="dr-source-row">
                        <span>{t("Customer source")}</span>
                        <div className="dr-source-pills">
                          {order.customerSources.length > 0 ? order.customerSources.map((key) => (
                            <button
                              key={`${order.id}-customer-${key}`}
                              type="button"
                              className={(rawInspectorState[order.id]?.focusKeys ?? []).includes(key) ? "is-active" : ""}
                              onClick={(e) => openRawInspectorWithKey(order.id, key, e.ctrlKey || e.metaKey)}
                            >
                              {key}
                            </button>
                          )) : <em>{t("Unknown source")}</em>}
                        </div>
                      </div>
                      <div className="dr-source-row">
                        <span>{t("Vehicle source")}</span>
                        <div className="dr-source-pills">
                          {order.vehicleSources.length > 0 ? order.vehicleSources.map((key) => (
                            <button
                              key={`${order.id}-vehicle-${key}`}
                              type="button"
                              className={(rawInspectorState[order.id]?.focusKeys ?? []).includes(key) ? "is-active" : ""}
                              onClick={(e) => openRawInspectorWithKey(order.id, key, e.ctrlKey || e.metaKey)}
                            >
                              {key}
                            </button>
                          )) : <em>{t("Unknown source")}</em>}
                        </div>
                      </div>
                      <div className="dr-source-row">
                        <span>{t("Service source")}</span>
                        <div className="dr-source-pills">
                          {order.serviceSources.length > 0 ? order.serviceSources.map((key) => (
                            <button
                              key={`${order.id}-service-${key}`}
                              type="button"
                              className={(rawInspectorState[order.id]?.focusKeys ?? []).includes(key) ? "is-active" : ""}
                              onClick={(e) => openRawInspectorWithKey(order.id, key, e.ctrlKey || e.metaKey)}
                            >
                              {key}
                            </button>
                          )) : <em>{t("Unknown source")}</em>}
                        </div>
                      </div>
                      <small>{t("Click a source label to open and highlight it in Raw Details. Use Ctrl/Cmd + click to multi-select.")}</small>
                    </div>
                    <details
                      className="dr-raw-json"
                      open={Boolean(rawInspectorState[order.id]?.open)}
                      onToggle={(e) => {
                        const nextOpen = (e.currentTarget as HTMLDetailsElement).open;
                        setRawInspectorState((prev) => ({
                          ...prev,
                          [order.id]: {
                            open: nextOpen,
                            focusKeys: prev[order.id]?.focusKeys ?? [],
                          },
                        }));
                      }}
                    >
                      <summary>{t("Raw Details")}</summary>
                      <div className="dr-json-view">
                        {JSON.stringify(order.raw, null, 2)
                          .split("\n")
                          .map((line, idx) => {
                            const focusedKeys = rawInspectorState[order.id]?.focusKeys ?? [];
                            const isHit = focusedKeys.some((key) => line.includes(`"${key}"`));
                            return (
                              <div key={`${order.id}-json-${idx}`} className={`dr-json-line${isHit ? " is-hit" : ""}`}>
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

        <article className="dr-panel">
          <h2>{t("Customers In Range")}</h2>
          {loading ? (
            <div className="dr-loading">{t("Loading...")}</div>
          ) : customerDetails.length === 0 ? (
            <div className="dr-loading">{t("No customers found for this date range.")}</div>
          ) : (
            <div className="dr-simple-table">
              {customerDetails.map((c) => (
                <div key={c.id} className="dr-simple-row">
                  <span>{c.name}</span>
                  <span>{c.phone}</span>
                  <span>{c.dateTime}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="dr-panel">
          <h2>{t("Vehicles In Range")}</h2>
          {loading ? (
            <div className="dr-loading">{t("Loading...")}</div>
          ) : vehicleDetails.length === 0 ? (
            <div className="dr-loading">{t("No vehicles found for this date range.")}</div>
          ) : (
            <div className="dr-simple-table">
              {vehicleDetails.map((v) => (
                <div key={v.id} className="dr-simple-row">
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
