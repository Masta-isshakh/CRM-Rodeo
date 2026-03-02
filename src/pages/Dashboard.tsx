import { useEffect, useMemo, useState } from "react";
import "./dashboard.css";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";
import { usePermissions } from "../lib/userPermissions";

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

function detectDepartment(order: JobOrderLite) {
  const parsed = safeJsonParse<any>(order.dataJson, {});
  const fromParsed =
    parsed?.departmentName ??
    parsed?.department ??
    parsed?.jobOrderSummary?.department ??
    parsed?.jobOrderSummary?.departmentName ??
    parsed?.customer?.department;

  const raw = String(fromParsed ?? "").trim();
  if (!raw) return "Other";
  return raw;
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

export default function Dashboard({ permissions, email, visibility, onNavigate }: DashboardProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const client = getDataClient();
  const { canOption } = usePermissions();

  const [loading, setLoading] = useState(true);
  const [momentumRangeDays, setMomentumRangeDays] = useState(30);
  const [revenueMixRangeDays, setRevenueMixRangeDays] = useState(30);
  const [deptRangeDays, setDeptRangeDays] = useState(30);
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

  const revenueByDepartment = useMemo(() => {
    const map = new Map<string, number>();
    for (const order of deptOrders) {
      const key = detectDepartment(order);
      map.set(key, (map.get(key) ?? 0) + toNum(order.totalAmount));
    }
    return Array.from(map.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [deptOrders]);

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
        title: `${inspectionQueue} vehicles awaiting inspection`,
        subtitle: "Next in line: by created date",
        tag: "Urgent",
      },
      {
        title: `${pendingApprovals} approvals pending decision`,
        subtitle: "Finance and service review",
        tag: "Review",
      },
      {
        title: `${stalePending} service approvals aging >24h`,
        subtitle: "Escalate decision queue",
        tag: "Attention",
      },
      {
        title: `${qcMisses} delivery QC misses`,
        subtitle: "Re-check and close quality gaps",
        tag: "Flag",
      },
    ];
  }, [summaryOrders, approvals]);

  const recentActivity = useMemo(() => {
    const fromActivity = [...activityRows]
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
      .slice(0, 4)
      .map((a) => ({
        title: a.message || a.action || "Activity update",
        actor: a.action || "System",
        when: compactTimeAgo(a.createdAt),
      }));

    if (fromActivity.length) return fromActivity;

    return [...summaryOrders]
      .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")))
      .slice(0, 4)
      .map((o) => ({
        title: `Job order ${o.orderNumber ?? o.id ?? "—"} updated`,
        actor: o.workStatusLabel || o.status || "Job order",
        when: compactTimeAgo(o.updatedAt ?? o.createdAt),
      }));
  }, [activityRows, summaryOrders]);

  const maxMomentum = Math.max(1, ...momentumSeries.map((p) => p.count));
  const maxDeptAmount = Math.max(1, ...revenueByDepartment.map((x) => x.amount));

  const go = (page: NavPage) => onNavigate?.(page);
  const canShowKpis = canOption("dashboard", "dashboard_kpis", true);
  const canShowQuickNav = canOption("dashboard", "dashboard_quicknav", true);
  const canShowRevenue = canOption("dashboard", "dashboard_revenue", true);
  const canShowActivity = canOption("dashboard", "dashboard_activity", true);
  const canShowCalendar = canOption("dashboard", "dashboard_calendar", true);

  return (
    <div className="od-stage">
      <section className="od-hero">
        <div>
          <div className="od-kicker">WELCOME BACK, {displayName}</div>
          <h1 className="od-title">Overview Dashboard</h1>
          <p className="od-subtitle">A live pulse of operations, approvals, and revenue health.</p>
        </div>

        {canShowKpis && (
          <div className="od-summary">
            <div className="od-summary-item">
              <span>Active job orders</span>
              <b>{loading ? "—" : activeJobOrders}</b>
            </div>
            <div className="od-summary-item">
              <span>On-time delivery</span>
              <b>{loading ? "—" : `${onTimeDelivery}%`}</b>
            </div>
            <div className="od-summary-item">
              <span>Open approvals</span>
              <b>{loading ? "—" : openApprovals}</b>
            </div>
          </div>
        )}
      </section>

      <section className="od-grid od-grid-3">
        <article className="od-card">
          <div className="od-card-head">
            <div>
              <h3>{`Job Order Momentum · ${rangeLabel(momentumRangeDays)}`}</h3>
              <p>Daily intake trend with completion velocity.</p>
            </div>
            <select value={momentumRangeDays} onChange={(e) => setMomentumRangeDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
          <div className="od-linechart">
            {momentumSeries.map((p) => (
              <div key={p.key} className="od-line-col" style={{ height: `${(p.count / maxMomentum) * 100}%` }} />
            ))}
          </div>
          <div className="od-line-foot">
            <span>Peak day {Math.max(...momentumSeries.map((p) => p.count))} orders</span>
            <span>Avg duration {momentumRangeDays} days</span>
          </div>
        </article>

        {canShowRevenue && (
          <article className="od-card">
            <div className="od-card-head">
              <div>
                <h3>{`Revenue Mix · ${rangeLabel(revenueMixRangeDays)}`}</h3>
                <p>Share of revenue by workflow stage.</p>
              </div>
              <select value={revenueMixRangeDays} onChange={(e) => setRevenueMixRangeDays(Number(e.target.value))}>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </div>

            <div className="od-donut-wrap">
              <div className="od-donut" />
              <div className="od-legend">
                {revenueMix.map((m, i) => (
                  <div key={m.name} className="od-legend-row">
                    <span className={`od-dot od-dot-${i + 1}`} />
                    <span>{m.name}</span>
                    <small>{m.pct}%</small>
                  </div>
                ))}
              </div>
            </div>
          </article>
        )}

        {canShowRevenue && (
          <article className="od-card">
            <div className="od-card-head">
              <div>
                <h3>{`Revenue by Department · ${rangeLabel(deptRangeDays)}`}</h3>
                <p>Top earning areas this period.</p>
              </div>
              <select value={deptRangeDays} onChange={(e) => setDeptRangeDays(Number(e.target.value))}>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </div>

            <div className="od-total">Total <b>${Math.round(totalRevenue).toLocaleString("en-US")}</b></div>
            <div className="od-dept-list">
              {revenueByDepartment.map((d) => (
                <div key={d.name} className="od-dept-item">
                  <div className="od-dept-label">
                    <span>{d.name}</span>
                    <b>${Math.round(d.amount).toLocaleString("en-US")}</b>
                  </div>
                  <div className="od-dept-track">
                    <div className="od-dept-fill" style={{ width: `${(d.amount / maxDeptAmount) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </article>
        )}
      </section>

      <section className="od-grid od-grid-3">
        {canShowQuickNav && (
          <article className="od-card">
          <div className="od-card-head simple">
            <div>
              <h3>Quick Actions</h3>
              <p>Jump straight to high impact tasks.</p>
            </div>
          </div>

          <div className="od-quick-grid">
            <button type="button" onClick={() => go("jobcards")}>New Job Order</button>
            <button type="button" onClick={() => go("paymentinvoices")}>Create Invoice</button>
            <button type="button" onClick={() => go("inspection")}>Start Inspection</button>
            <button type="button" onClick={() => go("exitpermit")}>Prepare Exit Permit</button>
            <button type="button" onClick={() => go("customers")}>Add Customer</button>
            <button type="button" onClick={() => go("serviceexecution")}>Service Execution</button>
          </div>
          </article>
        )}

        {canShowCalendar && (
          <article className="od-card">
          <div className="od-card-head simple">
            <div>
              <h3>Priority List</h3>
              <p>Keep urgent tasks visible to the team.</p>
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

        {canShowActivity && (
          <article className="od-card">
          <div className="od-card-head simple">
            <div>
              <h3>Recent Activity</h3>
              <p>Latest team movements in real-time.</p>
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
    </div>
  );
}
