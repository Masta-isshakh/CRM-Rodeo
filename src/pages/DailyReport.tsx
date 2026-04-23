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
  type: string;
  title: string;
  detail: string;
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

function isSameDay(target: Date, date: Date) {
  return (
    target.getFullYear() === date.getFullYear() &&
    target.getMonth() === date.getMonth() &&
    target.getDate() === date.getDate()
  );
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
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
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

  useEffect(() => {
    if (!permissions?.canRead) return;

    const targetDate = parseDate(selectedDate) ?? new Date();
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

        const todaysOrders = orders.filter((o: any) => {
          const d = parseDate(o?.createdAt ?? o?.updatedAt ?? o?.createDate);
          return d ? isSameDay(targetDate, d) : false;
        });

        const jobsCompleted = todaysOrders.filter((o: any) => {
          const s = safeText(o?.status ?? o?.workStatus ?? o?.workStatusLabel).toLowerCase();
          return s.includes("completed") || s === "ready";
        }).length;

        const jobsCreated = todaysOrders.length;
        const totalRevenue = todaysOrders.reduce((sum: number, o: any) => {
          const orderTotal =
            toNum(o?.totalAmount) ||
            toNum(o?.billing?.totalAmount) ||
            toNum(o?.billing?.netAmount) ||
            0;
          return sum + Math.max(0, orderTotal);
        }, 0);

        const newCustomers = customers.filter((c: any) => {
          const d = parseDate(c?.createdAt ?? c?.updatedAt ?? c?.registeredAt);
          return d ? isSameDay(targetDate, d) : false;
        }).length;

        const activeEmployees = employees.filter((e: any) => {
          const status = safeText(e?.status ?? e?.employmentStatus ?? e?.active).toLowerCase();
          return status === "active" || status === "true" || status === "1";
        }).length;

        const todaysLogs = logs
          .map((l: any) => {
            const d = parseDate(l?.createdAt ?? l?.timestamp ?? l?.updatedAt);
            return {
              raw: l,
              date: d,
            };
          })
          .filter((x: any) => (x.date ? isSameDay(targetDate, x.date) : false));

        const incidents = todaysLogs.filter((x: any) => {
          const text = `${safeText(x.raw?.action)} ${safeText(x.raw?.message)} ${safeText(x.raw?.type)}`.toLowerCase();
          return text.includes("error") || text.includes("failed") || text.includes("warning");
        }).length;

        const feedItems: FeedItem[] = todaysLogs
          .sort((a: any, b: any) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
          .slice(0, 16)
          .map((x: any, idx: number) => ({
            id: String(x.raw?.id ?? idx),
            time: x.date ? x.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--",
            type: safeText(x.raw?.action || x.raw?.type || "Event"),
            title: safeText(x.raw?.message || x.raw?.title || "System activity"),
            detail: safeText(x.raw?.details || x.raw?.module || "Operations stream"),
          }));

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
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [client, permissions?.canRead, selectedDate]);

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
            {t("Report Date")}
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
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
                `${t("Daily Report")} - ${selectedDate}`,
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
              a.download = `daily-report-${selectedDate}.txt`;
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
          <h2>{t("Today Feed")}</h2>
          {loading ? (
            <div className="dr-loading">{t("Loading...")}</div>
          ) : feed.length === 0 ? (
            <div className="dr-loading">{t("No activity captured for this date.")}</div>
          ) : (
            <div className="dr-feed">
              {feed.map((item) => (
                <div key={item.id} className="dr-feed-row">
                  <span className="dr-time">{item.time}</span>
                  <span className="dr-type">{item.type || t("Event")}</span>
                  <div>
                    <p className="dr-title">{item.title}</p>
                    <p className="dr-detail">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
