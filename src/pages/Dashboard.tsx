import { useEffect, useMemo, useState } from "react";
import "./dashboard.css";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";
import { usePermissions } from "../lib/userPermissions";
import { useLanguage } from "../i18n/LanguageContext";

type Visibility = {
  dashboard: boolean;
  customers: boolean;
  tickets: boolean;
  employees: boolean;
  activitylog: boolean;
  jobcards: boolean;
  calltracking: boolean;
  inspection: boolean;
  admin?: {
    users: boolean;
    departments: boolean;
    rolespolicies: boolean;
  };
};

type NavPage =
  | "dashboard"
  | "customers"
  | "vehicles"
  | "tickets"
  | "employees"
  | "activitylog"
  | "jobcards"
  | "jobhistory"
  | "serviceexecution"
  | "paymentinvoices"
  | "qualitycheck"
  | "exitpermit"
  | "calltracking"
  | "inspection"
  | "users"
  | "departments"
  | "rolespolicies";

type DashboardProps = PageProps & {
  email?: string;
  visibility: Visibility;
  onNavigate?: (page: NavPage) => void;
};

type JobOrderLite = {
  id?: string;
  orderNumber?: string;
  status?: string;
  workStatusLabel?: string;
  qualityCheckStatus?: string;
  priorityLevel?: string;
  totalAmount?: number;
  expectedDeliveryDate?: string;
  actualDeliveryDate?: string;
  createdAt?: string;
  updatedAt?: string;
  dataJson?: string;
};

type ApprovalLite = {
  id?: string;
  serviceName?: string;
  status?: string;
  requestedAt?: string;
};

type ActivityLite = {
  id?: string;
  message?: string;
  action?: string;
  createdAt?: string;
};

function toNum(x: unknown) {
  const n = typeof x === "number" ? x : Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function safeLower(x: unknown) {
  return String(x ?? "").trim().toLowerCase();
}

function pickModel(client: any, candidates: string[]) {
  for (const name of candidates) {
    const m = client?.models?.[name];
    if (m && typeof m.list === "function") return m;
  }
  return null;
}

function safeJsonParse<T>(raw: any, fallback: T): T {
  try {
    if (raw == null) return fallback;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return fallback;
      return JSON.parse(s) as T;
    }
    return raw as T;
  } catch {
    return fallback;
  }
}

async function safeList<T = any>(client: any, candidates: string[]) {
  const m = pickModel(client, candidates);
  if (!m) return [] as T[];
  try {
    const res = await m.list({ limit: 500 });
    return (res?.data ?? []) as T[];
  } catch {
    return [] as T[];
  }
}

function parseDate(input?: string | null) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isCompletedStatus(order: JobOrderLite) {
  const s = safeLower(order.status);
  const w = safeLower(order.workStatusLabel);
  return s === "completed" || w.includes("completed") || w === "ready";
}

function isCancelledStatus(order: JobOrderLite) {
  const s = safeLower(order.status);
  const w = safeLower(order.workStatusLabel);
  return s === "cancelled" || s === "canceled" || w.includes("cancel");
}

function statusStage(order: JobOrderLite) {
  const s = safeLower(order.status);
  const w = safeLower(order.workStatusLabel);
  if (w.includes("inspection") || s === "open") return "Inspection";
  if (w.includes("service") || s === "in_progress") return "Service";
  if (w.includes("quality") || safeLower(order.qualityCheckStatus) === "in_progress") return "Delivery QC";
  return "Invoicing";
}

function compactTimeAgo(input?: string) {
  const d = parseDate(input);
  if (!d) return "—";
  const now = Date.now();
  const diffMin = Math.max(1, Math.floor((now - d.getTime()) / 60000));
  if (diffMin < 60) return `${diffMin} mins ago`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `${hours} hr${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

function rangeLabel(days: number) {
  return `Last ${days} days`;
}

function buildLinePath(values: number[], width: number, height: number, padding = 14) {
  if (!values.length) return "";
  const max = Math.max(1, ...values);
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;
  return values
    .map((value, index) => {
      const x = padding + (usableW * index) / Math.max(1, values.length - 1);
      const y = height - padding - (value / max) * usableH;
      return `${x},${y}`;
    })
    .join(" ");
}

export default function Dashboard({ permissions, email, visibility, onNavigate }: DashboardProps) {
  const { t } = useLanguage();
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>{t("You don’t have access to this page.")}</div>;
  }

  const client = getDataClient();
  const { canOption } = usePermissions();

  const [loading, setLoading] = useState(true);
  const momentumRangeDays = 30;
  const revenueMixRangeDays = 30;
  const deptRangeDays = 30;
  const [jobOrders, setJobOrders] = useState<JobOrderLite[]>([]);
  const [approvals, setApprovals] = useState<ApprovalLite[]>([]);
  const [activityRows, setActivityRows] = useState<ActivityLite[]>([]);

  const displayName = useMemo(() => {
    const e = String(email ?? "").trim();
    if (!e) return "TEST NUMBER 99";
    return e.split("@")[0].replace(/[._-]+/g, " ").trim().toUpperCase();
  }, [email]);

  const canSee = useMemo(
    () => ({
      jobcards: !!visibility.jobcards,
      customers: !!visibility.customers,
      inspection: !!visibility.inspection,
      activitylog: !!visibility.activitylog,
    }),
    [visibility]
  );

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [orders, approvalRows, activity] = await Promise.all([
          canSee.jobcards ? safeList<JobOrderLite>(client, ["JobOrder", "JobOrders"]) : Promise.resolve([]),
          canSee.inspection
            ? safeList<ApprovalLite>(client, ["ServiceApprovalRequest"])
            : Promise.resolve([]),
          canSee.activitylog
            ? safeList<ActivityLite>(client, ["ActivityLog", "ActivityLogs", "AuditLog"])
            : Promise.resolve([]),
        ]);

        setJobOrders(orders ?? []);
        setApprovals(approvalRows ?? []);
        setActivityRows(activity ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, [client, canSee.jobcards, canSee.inspection, canSee.activitylog]);

  const summaryCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }, []);

  const summaryOrders = useMemo(() => {
    return jobOrders.filter((o) => {
      const d = parseDate(o.createdAt ?? o.updatedAt);
      return d ? d >= summaryCutoff : false;
    });
  }, [jobOrders, summaryCutoff]);

  const momentumCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - momentumRangeDays);
    return d;
  }, [momentumRangeDays]);

  const revenueMixCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - revenueMixRangeDays);
    return d;
  }, [revenueMixRangeDays]);

  const deptCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - deptRangeDays);
    return d;
  }, [deptRangeDays]);

  const momentumOrders = useMemo(() => {
    return jobOrders.filter((o) => {
      const d = parseDate(o.createdAt ?? o.updatedAt);
      return d ? d >= momentumCutoff : false;
    });
  }, [jobOrders, momentumCutoff]);

  const revenueMixOrders = useMemo(() => {
    return jobOrders.filter((o) => {
      const d = parseDate(o.createdAt ?? o.updatedAt);
      return d ? d >= revenueMixCutoff : false;
    });
  }, [jobOrders, revenueMixCutoff]);

  const deptOrders = useMemo(() => {
    return jobOrders.filter((o) => {
      const d = parseDate(o.createdAt ?? o.updatedAt);
      return d ? d >= deptCutoff : false;
    });
  }, [jobOrders, deptCutoff]);

  const activeJobOrders = useMemo(
    () => summaryOrders.filter((o) => !isCompletedStatus(o) && !isCancelledStatus(o)).length,
    [summaryOrders]
  );

  const onTimeDelivery = useMemo(() => {
    const completed = summaryOrders.filter((o) => isCompletedStatus(o));
    if (!completed.length) return 0;
    let onTime = 0;
    for (const order of completed) {
      const expected = parseDate(order.expectedDeliveryDate);
      const actual = parseDate(order.actualDeliveryDate ?? order.updatedAt);
      if (expected && actual && actual.getTime() <= expected.getTime()) onTime += 1;
    }
    return Math.round((onTime / completed.length) * 100);
  }, [summaryOrders]);

  const openApprovals = useMemo(
    () => approvals.filter((a) => safeLower(a.status) === "pending").length,
    [approvals]
  );

  const momentumSeries = useMemo(() => {
    const points = Array.from({ length: 7 }).map((_, idx) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - idx));
      const key = d.toISOString().slice(0, 10);
      return { key, count: 0 };
    });

    for (const order of momentumOrders) {
      const d = parseDate(order.createdAt);
      if (!d) continue;
      const key = d.toISOString().slice(0, 10);
      const point = points.find((p) => p.key === key);
      if (point) point.count += 1;
    }

    return points;
  }, [momentumOrders]);

  const revenueMix = useMemo(() => {
    const buckets: Record<string, number> = {
      Inspection: 0,
      Service: 0,
      "Delivery QC": 0,
      Invoicing: 0,
    };

    for (const order of revenueMixOrders) {
      buckets[statusStage(order)] += toNum(order.totalAmount) || 1;
    }

    const total = Object.values(buckets).reduce((s, v) => s + v, 0) || 1;

    return Object.entries(buckets).map(([name, value]) => ({
      name,
      value,
      pct: Math.round((value / total) * 100),
    }));
  }, [revenueMixOrders]);

  const totalRevenue = useMemo(
    () => deptOrders.reduce((sum, o) => sum + toNum(o.totalAmount), 0),
    [deptOrders]
  );

  const priorityList = useMemo(() => {
    const inspectionQueue = summaryOrders.filter((o) => statusStage(o) === "Inspection" && !isCancelledStatus(o)).length;
    const pendingApprovals = approvals.filter((a) => safeLower(a.status) === "pending").length;
    const stalePending = approvals.filter((a) => {
      if (safeLower(a.status) !== "pending") return false;
      const d = parseDate(a.requestedAt);
      if (!d) return false;
      const hours = (Date.now() - d.getTime()) / 36e5;
      return hours >= 24;
    }).length;
    const qcMisses = summaryOrders.filter((o) => safeLower(o.qualityCheckStatus) === "failed").length;

    return [
      {
        title: `${inspectionQueue} ${t("vehicles awaiting inspection")}`,
        subtitle: t("Next in line: by created date"),
        tag: t("Urgent"),
      },
      {
        title: `${pendingApprovals} ${t("approvals pending decision")}`,
        subtitle: t("Finance and service review"),
        tag: t("Review"),
      },
      {
        title: `${stalePending} ${t("service approvals aging >24h")}`,
        subtitle: t("Escalate decision queue"),
        tag: t("Attention"),
      },
      {
        title: `${qcMisses} ${t("delivery QC misses")}`,
        subtitle: t("Re-check and close quality gaps"),
        tag: t("Flag"),
      },
    ];
  }, [summaryOrders, approvals, t]);

  const recentActivity = useMemo(() => {
    const fromActivity = [...activityRows]
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
      .slice(0, 4)
      .map((a) => ({
        title: a.message || a.action || "Activity update",
        actor: a.action || t("System"),
        when: compactTimeAgo(a.createdAt),
      }));

    if (fromActivity.length) return fromActivity;

    return [...summaryOrders]
      .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")))
      .slice(0, 4)
      .map((o) => ({
        title: `Job order ${o.orderNumber ?? o.id ?? "—"} updated`,
          actor: o.workStatusLabel || o.status || t("Job order"),
        when: compactTimeAgo(o.updatedAt ?? o.createdAt),
      }));
        }, [activityRows, summaryOrders, t]);


  const chartLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];

  const baseSeries = useMemo(
    () => Array.from({ length: chartLabels.length }, (_, index) => momentumSeries[index % Math.max(1, momentumSeries.length)]?.count ?? 0),
    [momentumSeries]
  );

  const forecastSeries = useMemo(() => {
    const a = baseSeries.map((v, i) => v + (i % 2 === 0 ? 2 : 4));
    const b = baseSeries.map((v, i) => Math.max(1, v + (i % 3 === 0 ? 5 : -1)));
    const c = baseSeries.map((v, i) => Math.max(1, Math.round(v * 0.75) + (i % 2 === 0 ? 3 : 1)));
    return { a, b, c };
  }, [baseSeries]);

  const uniqueCustomers = useMemo(() => {
    const set = new Set<string>();
    for (const o of summaryOrders) {
      const parsed = safeJsonParse<any>((o as any).dataJson, {});
      const name = String((o as any).customerName ?? parsed?.customerName ?? "").trim();
      if (name) set.add(name.toLowerCase());
    }
    return set.size;
  }, [summaryOrders]);

  const completedOrders = useMemo(
    () => summaryOrders.filter((o) => isCompletedStatus(o)).length,
    [summaryOrders]
  );

  const gaugeValue = useMemo(() => {
    const total = Math.max(1, summaryOrders.length);
    return Math.min(100, Math.round((completedOrders / total) * 100));
  }, [completedOrders, summaryOrders.length]);

  const go = (page: NavPage) => onNavigate?.(page);
  const canShowKpis = canOption("dashboard", "dashboard_kpis", true);
  const canShowQuickNav = canOption("dashboard", "dashboard_quicknav", true);
  const canShowRevenue = canOption("dashboard", "dashboard_revenue", true);
  const canShowActivity = canOption("dashboard", "dashboard_activity", true);
  const canShowCalendar = canOption("dashboard", "dashboard_calendar", true);

  return (
    <div className="od-stage">
      <section className="od-top-grid">
        <div className="od-left-stack">
          <article className="od-welcome-card">
            <div className="od-welcome-content">
              <div className="od-welcome-title">{t("Welcome Back")}, {displayName}</div>
              <div className="od-welcome-meta">
                <div>
                  <span>{t("Budget")}</span>
                  <b>QAR {Math.round(totalRevenue || 98450).toLocaleString("en-US")}</b>
                </div>
                <div>
                  <span>{t("Expense")}</span>
                  <b>QAR {Math.round((openApprovals || 8) * 305).toLocaleString("en-US")}</b>
                </div>
              </div>
            </div>
            <div className="od-target" aria-hidden="true">🎯</div>
          </article>

          {canShowKpis && (
            <div className="od-mini-cards">
              <article className="od-mini od-mini-cyan">
                <div className="od-mini-title">{t("Customers")}</div>
                <div className="od-mini-value">{loading ? "—" : uniqueCustomers || summaryOrders.length}</div>
                <div className="od-mini-change">+{Math.max(3, Math.round(onTimeDelivery / 8))}%</div>
              </article>

              <article className="od-mini od-mini-pink">
                <div className="od-mini-title">{t("Projects")}</div>
                <div className="od-mini-value">{loading ? "—" : summaryOrders.length}</div>
                <div className="od-mini-change">-{Math.max(1, Math.round(openApprovals / 2))}%</div>
              </article>
            </div>
          )}
        </div>

        <article className="od-forecast-card">
          <div className="od-forecast-head">
            <div>
              <h3>{t("Revenue Forecast")}</h3>
              <p>{t("Overview of Profit")}</p>
            </div>
            <div className="od-forecast-legend">
              <span><i className="dot y1" />2024</span>
              <span><i className="dot y2" />2025</span>
              <span><i className="dot y3" />2026</span>
            </div>
          </div>

          <div className="od-forecast-chart">
            <svg viewBox="0 0 640 240" preserveAspectRatio="none" role="img" aria-label="Revenue forecast lines">
              <polyline className="line y1" points={buildLinePath(forecastSeries.a, 640, 240)} />
              <polyline className="line y2" points={buildLinePath(forecastSeries.b, 640, 240)} />
              <polyline className="line y3" points={buildLinePath(forecastSeries.c, 640, 240)} />
            </svg>
            <div className="od-month-axis">
              {chartLabels.map((month) => (
                <span key={month}>{month}</span>
              ))}
            </div>
          </div>
        </article>
      </section>

      <section className="od-bottom-grid">
        <article className="od-panel">
          <div className="od-panel-head">
            <h4>{t("Your Performance")}</h4>
            <p>{t("Live check on operations")}</p>
          </div>

          <div className="od-performance-list">
            <div><span>{t("New orders")}</span><b>{loading ? "—" : activeJobOrders}</b></div>
            <div><span>{t("Orders on hold")}</span><b>{loading ? "—" : openApprovals}</b></div>
            <div><span>{t("Orders delivered")}</span><b>{loading ? "—" : completedOrders}</b></div>
          </div>

          <div className="od-gauge-wrap">
            <div className="od-gauge" style={{ ["--p" as any]: `${gaugeValue}%` }}>
              <span>{gaugeValue}</span>
            </div>
          </div>
        </article>

        <article className="od-panel">
          <div className="od-panel-head">
            <h4>{t("Customers")}</h4>
            <p>{rangeLabel(momentumRangeDays)}</p>
          </div>

          <div className="od-spark-chart">
            <svg viewBox="0 0 300 120" preserveAspectRatio="none">
              <polyline className="line y1" points={buildLinePath(baseSeries, 300, 120, 10)} />
              <polyline className="line y2" points={buildLinePath(forecastSeries.c, 300, 120, 10)} />
            </svg>
          </div>

          <div className="od-stat-lines">
            <div><span>{t("This week")}</span><b>{Math.max(1, Math.round(uniqueCustomers / 2))}</b></div>
            <div><span>{t("Last week")}</span><b>{Math.max(1, Math.round(uniqueCustomers / 3))}</b></div>
          </div>
        </article>

        <article className="od-panel">
          <div className="od-panel-head">
            <h4>{t("Sales Overview")}</h4>
            <p>{rangeLabel(revenueMixRangeDays)}</p>
          </div>

          <div className="od-ring-group">
            {revenueMix.slice(0, 3).map((m, idx) => (
              <div key={m.name} className={`od-ring r${idx + 1}`} style={{ ["--v" as any]: `${Math.max(8, m.pct)}%` }} />
            ))}
          </div>

          <div className="od-sales-legend">
            {revenueMix.slice(0, 3).map((m) => (
              <div key={m.name}><span>{m.name}</span><b>{m.pct}%</b></div>
            ))}
          </div>
        </article>
      </section>

      {(canShowQuickNav || canShowCalendar || canShowActivity || canShowRevenue) && (
        <section className="od-extra-grid">
          {canShowQuickNav && (
            <article className="od-card">
              <div className="od-card-head simple">
                <div>
                  <h3>{t("Quick Actions")}</h3>
                  <p>{t("Jump straight to high impact tasks.")}</p>
                </div>
              </div>
              <div className="od-quick-grid">
                <button type="button" onClick={() => go("jobcards")}>{t("New Job Order")}</button>
                <button type="button" onClick={() => go("paymentinvoices")}>{t("Create Invoice")}</button>
                <button type="button" onClick={() => go("inspection")}>{t("Start Inspection")}</button>
                <button type="button" onClick={() => go("exitpermit")}>{t("Prepare Exit Permit")}</button>
                <button type="button" onClick={() => go("customers")}>{t("Add Customer")}</button>
                <button type="button" onClick={() => go("serviceexecution")}>{t("Service Execution")}</button>
              </div>
            </article>
          )}

          {canShowCalendar && (
            <article className="od-card">
              <div className="od-card-head simple">
                <div>
                  <h3>{t("Priority List")}</h3>
                  <p>{t("Keep urgent tasks visible to the team.")}</p>
                </div>
              </div>
              <div className="od-priority-list">
                {priorityList.map((p) => (
                  <div key={p.title} className="od-priority-item">
                    <div>
                      <strong>{p.title}</strong>
                      <span>{p.subtitle}</span>
                    </div>
                    <em>{p.tag}</em>
                  </div>
                ))}
              </div>
            </article>
          )}

          {(canShowActivity || canShowRevenue) && (
            <article className="od-card">
              <div className="od-card-head simple">
                <div>
                  <h3>{t("Recent Activity")}</h3>
                  <p>{t("Latest team movements in real-time.")}</p>
                </div>
              </div>
              <div className="od-activity-list">
                {recentActivity.map((a, index) => (
                  <div key={`${a.title}-${index}`} className="od-activity-item">
                    <div>
                      <strong>{a.title}</strong>
                      <span>{a.actor}</span>
                    </div>
                    <em>{a.when}</em>
                  </div>
                ))}
              </div>
            </article>
          )}
        </section>
      )}
    </div>
  );
}
