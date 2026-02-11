import { useEffect, useMemo, useState } from "react";
import "./dashboard.css";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";

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
  | "tickets"
  | "employees"
  | "activitylog"
  | "jobcards"
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

type StatKey =
  | "jobcards"
  | "customers"
  | "tickets"
  | "employees"
  | "calltracking"
  | "inspection"
  | "activitylog"
  | "users"
  | "departments"
  | "rolespolicies";

type Stats = Record<StatKey, number> & {
  revenueQar: number; // sum(totalAmount)
  paidQar: number; // sum(amountPaid)
  balanceQar: number; // sum(balanceDue)
};

type JobOrderLite = {
  createdAt?: string;
  updatedAt?: string;
  totalAmount?: number;
  amountPaid?: number;
  balanceDue?: number;
  status?: string;
  paymentStatus?: string;
};

function toNum(x: unknown) {
  const n = typeof x === "number" ? x : Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function formatInt(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function formatMoneyQAR(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(d: Date) {
  return d.toLocaleString("en-US", { month: "short" }).toUpperCase();
}

function lastNMonths(n: number) {
  const out: Date[] = [];
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(base.getFullYear(), base.getMonth() - i, 1));
  }
  return out;
}

function buildCalendar(year: number, monthIndex0: number) {
  const first = new Date(year, monthIndex0, 1);
  const last = new Date(year, monthIndex0 + 1, 0);
  const startDay = first.getDay(); // 0 Sun .. 6 Sat
  const daysInMonth = last.getDate();

  const cells: { day: number | null; isToday: boolean }[] = [];
  const today = new Date();
  const isSameMonth = today.getFullYear() === year && today.getMonth() === monthIndex0;

  for (let i = 0; i < startDay; i++) cells.push({ day: null, isToday: false });
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = isSameMonth && today.getDate() === d;
    cells.push({ day: d, isToday });
  }
  while (cells.length < 42) cells.push({ day: null, isToday: false });

  return cells;
}

function pickModel(client: any, candidates: string[]) {
  for (const name of candidates) {
    const m = client?.models?.[name];
    if (m && typeof m.list === "function") return m;
  }
  return null;
}

async function safeCount(client: any, candidates: string[]) {
  const m = pickModel(client, candidates);
  if (!m) return 0;
  try {
    const res = await m.list({ limit: 2000 });
    return (res?.data ?? []).length;
  } catch {
    return 0;
  }
}

async function safeList<T = any>(client: any, candidates: string[]) {
  const m = pickModel(client, candidates);
  if (!m) return [] as T[];
  try {
    const res = await m.list({ limit: 2000 });
    return (res?.data ?? []) as T[];
  } catch {
    return [] as T[];
  }
}

export default function Dashboard({ permissions, email, visibility, onNavigate }: DashboardProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const client = getDataClient();

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({
    jobcards: 0,
    customers: 0,
    tickets: 0,
    employees: 0,
    calltracking: 0,
    inspection: 0,
    activitylog: 0,
    users: 0,
    departments: 0,
    rolespolicies: 0,
    revenueQar: 0,
    paidQar: 0,
    balanceQar: 0,
  });

  const [jobOrders, setJobOrders] = useState<JobOrderLite[]>([]);

  const displayName = useMemo(() => {
    const e = String(email ?? "").trim();
    if (!e) return "DASHBOARD USER";
    const base = e.split("@")[0] || e;
    return base.replace(/[._-]+/g, " ").trim().toUpperCase();
  }, [email]);

  const initials = useMemo(() => {
    const e = String(email ?? "").trim();
    if (!e) return "R";
    return e[0].toUpperCase();
  }, [email]);

  const canSee = useMemo(() => {
    return {
      jobcards: !!visibility.jobcards,
      customers: !!visibility.customers,
      tickets: !!visibility.tickets,
      employees: !!visibility.employees,
      calltracking: !!visibility.calltracking,
      inspection: !!visibility.inspection,
      activitylog: !!visibility.activitylog,
      users: !!visibility.admin?.users,
      departments: !!visibility.admin?.departments,
      rolespolicies: !!visibility.admin?.rolespolicies,
    };
  }, [visibility]);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const tasks: Promise<any>[] = [];

      tasks.push(canSee.customers ? safeCount(client, ["Customer", "Customers"]) : Promise.resolve(0));
      tasks.push(canSee.employees ? safeCount(client, ["Employee", "Employees"]) : Promise.resolve(0));
      tasks.push(canSee.tickets ? safeCount(client, ["Ticket", "Tickets"]) : Promise.resolve(0));
      tasks.push(
        canSee.calltracking
          ? safeCount(client, ["CallTracking", "CallLog", "CallRecord"])
          : Promise.resolve(0)
      );
      tasks.push(
        canSee.inspection
          ? safeCount(client, ["InspectionApproval", "InspectionApprovals", "InspectionRequest"])
          : Promise.resolve(0)
      );
      tasks.push(
        canSee.activitylog ? safeCount(client, ["ActivityLog", "ActivityLogs", "AuditLog"]) : Promise.resolve(0)
      );
      tasks.push(canSee.users ? safeCount(client, ["User", "Users", "AppUser"]) : Promise.resolve(0));
      tasks.push(canSee.departments ? safeCount(client, ["Department", "Departments"]) : Promise.resolve(0));
      tasks.push(
        canSee.rolespolicies ? safeCount(client, ["RolePolicy", "RolesPolicies", "Role", "Policy"]) : Promise.resolve(0)
      );

      const jobOrdersTask = canSee.jobcards ? safeList<any>(client, ["JobOrder", "JobOrders"]) : Promise.resolve([]);

      const [
        customers,
        employees,
        tickets,
        calls,
        inspections,
        activity,
        users,
        departments,
        rolespolicies,
        joRows,
      ] = await Promise.all([...tasks, jobOrdersTask]);

      const joLite: JobOrderLite[] = (joRows ?? []).map((r: any) => ({
        createdAt: r?.createdAt,
        updatedAt: r?.updatedAt,
        totalAmount: r?.totalAmount,
        amountPaid: r?.amountPaid,
        balanceDue: r?.balanceDue,
        status: r?.status,
        paymentStatus: r?.paymentStatus,
      }));

      const revenueQar = joLite.reduce((s, x) => s + toNum(x.totalAmount), 0);
      const paidQar = joLite.reduce((s, x) => s + toNum(x.amountPaid), 0);
      const balanceQar = joLite.reduce((s, x) => s + toNum(x.balanceDue), 0);

      setJobOrders(joLite);

      setStats({
        jobcards: (joRows ?? []).length,
        customers,
        employees,
        tickets,
        calltracking: calls,
        inspection: inspections,
        activitylog: activity,
        users,
        departments,
        rolespolicies,
        revenueQar,
        paidQar,
        balanceQar,
      });
    } finally {
      setLoading(false);
    }
  };

  const go = (page: NavPage) => {
    if (onNavigate) onNavigate(page);
  };

  const topKpis = useMemo(() => {
    const items: { key: StatKey; label: string; value: string; hint?: string; page?: NavPage }[] = [];

    if (canSee.jobcards) {
      items.push({
        key: "jobcards",
        label: "Earning",
        value: `${formatMoneyQAR(stats.revenueQar)}`,
        hint: "QAR",
        page: "jobcards",
      });
    } else {
      const totalRecords =
        stats.customers +
        stats.employees +
        stats.tickets +
        stats.calltracking +
        stats.inspection +
        stats.activitylog +
        stats.users +
        stats.departments +
        stats.rolespolicies;

      items.push({ key: "activitylog", label: "Records", value: formatInt(totalRecords), hint: "Total" });
    }

    if (canSee.customers) items.push({ key: "customers", label: "Customers", value: formatInt(stats.customers), page: "customers" });
    if (canSee.tickets) items.push({ key: "tickets", label: "Tickets", value: formatInt(stats.tickets), page: "tickets" });
    if (canSee.employees) items.push({ key: "employees", label: "Employees", value: formatInt(stats.employees), page: "employees" });
    if (canSee.calltracking) items.push({ key: "calltracking", label: "Calls", value: formatInt(stats.calltracking), page: "calltracking" });
    if (canSee.inspection) items.push({ key: "inspection", label: "Approvals", value: formatInt(stats.inspection), page: "inspection" });
    if (canSee.activitylog) items.push({ key: "activitylog", label: "Activity", value: formatInt(stats.activitylog), page: "activitylog" });

    if (canSee.users) items.push({ key: "users", label: "Users", value: formatInt(stats.users), page: "users" });
    if (canSee.departments) items.push({ key: "departments", label: "Departments", value: formatInt(stats.departments), page: "departments" });
    if (canSee.rolespolicies) items.push({ key: "rolespolicies", label: "Policies", value: formatInt(stats.rolespolicies), page: "rolespolicies" });

    return items.slice(0, 4);
  }, [canSee, stats]);

  const quickActions = useMemo(() => {
    const actions: {
      page: NavPage;
      label: string;
      sub: string;
      icon: string;
      tone: "blue" | "gold" | "mint" | "slate";
      enabled: boolean;
    }[] = [
      {
        page: "jobcards",
        label: "Job Orders",
        sub: "Create & manage billing",
        icon: "🧾",
        tone: "blue",
        enabled: canSee.jobcards,
      },
      {
        page: "customers",
        label: "Customers",
        sub: "Profiles & history",
        icon: "👤",
        tone: "mint",
        enabled: canSee.customers,
      },
      {
        page: "tickets",
        label: "Tickets",
        sub: "Support & follow-up",
        icon: "🎫",
        tone: "gold",
        enabled: canSee.tickets,
      },
      {
        page: "employees",
        label: "Employees",
        sub: "Team & roles",
        icon: "👥",
        tone: "slate",
        enabled: canSee.employees,
      },
      {
        page: "calltracking",
        label: "Call Tracking",
        sub: "Calls & outcomes",
        icon: "📞",
        tone: "mint",
        enabled: canSee.calltracking,
      },
      {
        page: "inspection",
        label: "Inspections",
        sub: "Approvals queue",
        icon: "✅",
        tone: "blue",
        enabled: canSee.inspection,
      },
      {
        page: "activitylog",
        label: "Activity Log",
        sub: "Audits & actions",
        icon: "🧠",
        tone: "slate",
        enabled: canSee.activitylog,
      },
      {
        page: "users",
        label: "Users",
        sub: "Admin management",
        icon: "🛡️",
        tone: "gold",
        enabled: canSee.users,
      },
      {
        page: "departments",
        label: "Departments",
        sub: "Structure & teams",
        icon: "🏢",
        tone: "slate",
        enabled: canSee.departments,
      },
      {
        page: "rolespolicies",
        label: "Roles & Policies",
        sub: "RBAC rules",
        icon: "🔐",
        tone: "blue",
        enabled: canSee.rolespolicies,
      },
    ];

    return actions.filter((a) => a.enabled);
  }, [canSee]);

  const months = useMemo(() => lastNMonths(6), []);
  const barData = useMemo(() => {
    const buckets = months.map((m) => {
      const key = monthKey(m);
      return { key, label: monthLabel(m), total: 0, paid: 0 };
    });

    if (!canSee.jobcards) return buckets;

    for (const o of jobOrders) {
      const dStr = o.createdAt || o.updatedAt;
      if (!dStr) continue;
      const d = new Date(dStr);
      if (Number.isNaN(d.getTime())) continue;

      const k = monthKey(new Date(d.getFullYear(), d.getMonth(), 1));
      const b = buckets.find((x) => x.key === k);
      if (!b) continue;

      b.total += 1;
      if (String(o.paymentStatus ?? "").toUpperCase() === "PAID") b.paid += 1;
    }

    return buckets;
  }, [months, jobOrders, canSee.jobcards]);

  const donutPct = useMemo(() => {
    if (!canSee.jobcards) return 0;
    const total = stats.revenueQar;
    if (total <= 0.00001) return 0;
    const pct = Math.round((stats.paidQar / total) * 100);
    return Math.max(0, Math.min(100, pct));
  }, [canSee.jobcards, stats]);

  const wavePoints = useMemo(() => {
    const vals = barData.map((b) => b.total);
    const max = Math.max(1, ...vals);
    return vals.map((v, i) => {
      const x = (i / Math.max(1, vals.length - 1)) * 100;
      const y = 100 - (v / max) * 80 - 10;
      return { x, y };
    });
  }, [barData]);

  const calendar = useMemo(() => {
    const now = new Date();
    return buildCalendar(now.getFullYear(), now.getMonth());
  }, []);

  const nothingToShow =
    !loading &&
    quickActions.length === 0 &&
    !canSee.jobcards &&
    !canSee.customers &&
    !canSee.tickets &&
    !canSee.employees &&
    !canSee.calltracking &&
    !canSee.inspection &&
    !canSee.activitylog &&
    !canSee.users &&
    !canSee.departments &&
    !canSee.rolespolicies;

  return (
    <div className="dash-stage">
      <div className="dash-frame no-side">
        <section className="dash-main solo">
          <div className="dash-top">
            <div className="dash-titleblock">
              <div className="dash-title">Dashboard</div>
              <div className="dash-subtitle">Overview of your company activity</div>
            </div>

            <div className="dash-top-right">
              <div className="dash-user">
                <div className="dash-user-avatar">{initials}</div>
                <div className="dash-user-meta">
                  <div className="dash-user-name">{displayName}</div>
                  <div className="dash-user-mail">{email || "—"}</div>
                </div>
              </div>

              <button className="dash-kebab" type="button" aria-label="Menu">
                <span />
                <span />
                <span />
              </button>
            </div>
          </div>

          {/* KPI row */}
          <div className="dash-kpis">
            {loading ? (
              <>
                <div className="kpi kpi-dark skeleton" />
                <div className="kpi skeleton" />
                <div className="kpi skeleton" />
                <div className="kpi skeleton" />
              </>
            ) : (
              topKpis.map((k, idx) => {
                const isDark = idx === 0;
                return (
                  <button
                    key={k.key + k.label}
                    className={`kpi ${isDark ? "kpi-dark" : ""}`}
                    type="button"
                    onClick={() => k.page && go(k.page)}
                    disabled={!k.page}
                    title={k.page ? "Open page" : ""}
                  >
                    <div className="kpi-head">
                      <div className="kpi-label">{k.label}</div>
                      {isDark ? <div className="kpi-badge">Q</div> : <div className="kpi-mini" />}
                    </div>

                    <div className="kpi-value">
                      {isDark ? (
                        <>
                          <span className="kpi-currency">QAR</span> <span>{k.value}</span>
                        </>
                      ) : (
                        <span>{k.value}</span>
                      )}
                    </div>

                    {isDark ? (
                      <div className="kpi-foot">
                        <span className="kpi-foot-muted">
                          Paid: {formatMoneyQAR(stats.paidQar)} • Balance: {formatMoneyQAR(stats.balanceQar)}
                        </span>
                      </div>
                    ) : (
                      <div className="kpi-foot">
                        <span className="kpi-foot-muted">{k.hint || " "}</span>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* ✅ Quick Actions (permission-based) */}
          {!loading && quickActions.length > 0 && (
            <div className="dash-actions-card">
              <div className="dash-actions-head">
                <div className="dash-actions-title">Quick Actions</div>
                <div className="dash-actions-sub">Only what you’re authorized to access</div>
              </div>

              <div className="dash-actions-grid">
                {quickActions.map((a) => (
                  <button
                    key={a.page}
                    className={`dash-action tone-${a.tone}`}
                    type="button"
                    onClick={() => go(a.page)}
                  >
                    <span className="dash-action-ico" aria-hidden>
                      {a.icon}
                    </span>

                    <span className="dash-action-text">
                      <span className="dash-action-title">{a.label}</span>
                      <span className="dash-action-sub">{a.sub}</span>
                    </span>

                    <span className="dash-action-arrow" aria-hidden>
                      →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Row 2: bar chart + donut */}
          <div className="dash-row">
            <div className="dash-card">
              <div className="dash-card-head">
                <div className="dash-card-title">Result</div>
                <button
                  className="dash-card-cta"
                  type="button"
                  onClick={() => canSee.jobcards && go("jobcards")}
                  disabled={!canSee.jobcards}
                >
                  Check Now
                </button>
              </div>

              <div className="bar-wrap">
                {!canSee.jobcards && <div className="dash-empty">No job orders permission → charts hidden.</div>}

                {canSee.jobcards && (
                  <div className="bar-chart">
                    {barData.map((b) => {
                      const max = Math.max(1, ...barData.map((x) => x.total));
                      const h1 = Math.round((b.total / max) * 100);
                      const h2 = Math.round((b.paid / max) * 100);

                      return (
                        <div className="bar-col" key={b.key}>
                          <div className="bar-stack" aria-hidden>
                            <div className="bar bar-a" style={{ height: `${h1}%` }} />
                            <div className="bar bar-b" style={{ height: `${h2}%` }} />
                          </div>
                          <div className="bar-label">{b.label}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="dash-card dash-card-mini">
              <div className="donut">
                <div className="donut-ring" style={{ ["--p" as any]: donutPct }}>
                  <div className="donut-center">
                    <div className="donut-pct">{donutPct}%</div>
                  </div>
                </div>

                <div className="donut-list">
                  <div className="donut-item">
                    <span className="dot dot-a" />
                    <span>Paid</span>
                    <b>{formatMoneyQAR(stats.paidQar)}</b>
                  </div>
                  <div className="donut-item">
                    <span className="dot dot-b" />
                    <span>Balance</span>
                    <b>{formatMoneyQAR(stats.balanceQar)}</b>
                  </div>
                  <button
                    className="dash-card-cta wide"
                    type="button"
                    onClick={() => canSee.jobcards && go("jobcards")}
                    disabled={!canSee.jobcards}
                  >
                    Check Now
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: wave + calendar */}
          <div className="dash-row">
            <div className="dash-card">
              <div className="dash-card-head">
                <div className="dash-card-title">Trend</div>
                <div className="dash-card-note">Last 6 months</div>
              </div>

              {!canSee.jobcards ? (
                <div className="dash-empty">No job orders permission → trend hidden.</div>
              ) : (
                <div className="wave">
                  <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="wave-svg" aria-hidden>
                    <path
                      d={[
                        `M 0 40`,
                        `L ${wavePoints.map((p) => `${p.x} ${p.y}`).join(" L ")}`,
                        `L 100 40`,
                        `Z`,
                      ].join(" ")}
                      className="wave-area"
                    />
                    <path
                      d={`M ${wavePoints.map((p) => `${p.x} ${p.y}`).join(" L ")}`}
                      className="wave-line"
                      fill="none"
                    />
                  </svg>

                  <div className="wave-legend">
                    <span className="dot dot-a" /> Orders <span className="sp" /> <span className="dot dot-b" /> Paid Orders
                  </div>
                </div>
              )}
            </div>

            <div className="dash-card dash-card-mini">
              <div className="dash-card-head">
                <div className="dash-card-title">Calendar</div>
              </div>

              <div className="cal">
                <div className="cal-head">
                  <div className="cal-week">S</div>
                  <div className="cal-week">M</div>
                  <div className="cal-week">T</div>
                  <div className="cal-week">W</div>
                  <div className="cal-week">T</div>
                  <div className="cal-week">F</div>
                  <div className="cal-week">S</div>
                </div>

                <div className="cal-grid">
                  {calendar.map((c, i) => (
                    <div key={i} className={`cal-cell ${c.isToday ? "today" : ""} ${c.day ? "" : "empty"}`}>
                      {c.day ?? ""}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {nothingToShow && <div className="dash-no-kpi">No widgets available for your current permissions.</div>}
        </section>
      </div>
    </div>
  );
}
