import { useMemo, useState, useEffect, type ComponentType } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { FiChevronDown, FiGlobe, FiLogOut, FiCalendar } from "react-icons/fi";
import { MdTune } from "react-icons/md";
import {
  HiOutlineViewGrid,
  HiOutlineChartBar,
  HiOutlineClock,
  HiOutlineUsers,
  HiOutlineTruck,
  HiOutlineClipboardList,
  HiOutlineDocumentAdd,
  HiOutlineArchive,
  HiOutlineDocumentText,
  HiOutlineCog,
  HiOutlineCreditCard,
  HiOutlineShieldCheck,
} from "react-icons/hi";
import {
  HiMiniClipboardDocumentList,
  HiMiniCheckCircle,
  HiMiniStar,
  HiMiniChatBubbleLeftRight,
  HiMiniWrench,
  HiMiniCalendar,
  HiMiniClock,
  HiMiniCog8Tooth,
  HiMiniWrenchScrewdriver,
} from "react-icons/hi2";
import "./dashboard-v2.css";
import type { PageProps } from "../lib/PageProps";
import logoImg from "../assets/logo.jpeg";
import { getDashboardStats, type DashboardStats } from "./jobOrderRepo";
import { usePermissions } from "../lib/userPermissions";

type DashboardProps = PageProps & {
  email?: string;
  employeeName?: string;
  currentPage?: DashboardNavPage;
  onNavigate?: (page: DashboardNavPage) => void;
  onSignOut?: () => void;
};

type DashboardNavPage =
  | "dashboard"
  | "dailyreport"
  | "activitylog"
  | "customers"
  | "vehicles"
  | "jobcards"
  | "servicecreation"
  | "jobhistory"
  | "quotation"
  | "serviceexecution"
  | "paymentinvoices"
  | "qualitycheck";

/* ── Sidebar nav data ──────────────────────────────────────────── */
const NAV_OVERVIEW: Array<{ key: DashboardNavPage; label: string; Icon: ComponentType }> = [
  { key: "dashboard", label: "Dashboard", Icon: HiOutlineViewGrid },
  { key: "dailyreport", label: "Daily Report", Icon: HiOutlineChartBar },
  { key: "activitylog", label: "Activity Log", Icon: HiOutlineClock },
];

const NAV_OPERATIONS: Array<{ key: DashboardNavPage; label: string; Icon: ComponentType }> = [
  { key: "customers",       label: "Customers",          Icon: HiOutlineUsers },
  { key: "vehicles",        label: "Vehicles",            Icon: HiOutlineTruck },
  { key: "jobcards",        label: "Job Cards",           Icon: HiOutlineClipboardList },
  { key: "servicecreation", label: "Service Creation",    Icon: HiOutlineDocumentAdd },
  { key: "jobhistory",      label: "Job History",         Icon: HiOutlineArchive },
  { key: "quotation",       label: "Quotations",          Icon: HiOutlineDocumentText },
  { key: "serviceexecution",label: "Service Execution",   Icon: HiOutlineCog },
  { key: "paymentinvoices", label: "Payment & Invoices",  Icon: HiOutlineCreditCard },
  { key: "qualitycheck",    label: "Quality Check",       Icon: HiOutlineShieldCheck },
];

/* ── Service category icon map ─────────────────────────────────── */
const SERVICE_CAT_ICONS: Record<string, ComponentType> = {
  "General Service": HiMiniCog8Tooth,
  "Engine Repair":   HiMiniWrenchScrewdriver,
  "Body & Paint":    HiOutlineTruck,
  "AC Service":      HiMiniClock,
  "Electrical":      HiMiniWrench,
  "Detailing":       HiMiniCog8Tooth,
  "Tires & Wheels":  HiMiniWrenchScrewdriver,
};

function resolveEmployeeName(employeeName: string | undefined): string {
  const normalized = String(employeeName ?? "").trim();
  return normalized || "Employee";
}

/* ── SVG Sparkline ─────────────────────────────────────────────── */
type Pt = [number, number];

function buildSparkPath(points: Pt[], w: number, h: number): string {
  if (points.length < 2) return "";
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const px = (x: number) =>
    maxX === minX ? w / 2 : ((x - minX) / (maxX - minX)) * w;
  const py = (y: number) =>
    maxY === minY ? h / 2 : h - ((y - minY) / (maxY - minY)) * h * 0.85;
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${px(x).toFixed(1)} ${py(y).toFixed(1)}`)
    .join(" ");
}

const SPARK_BLUE:   Pt[] = [[0,20],[1,28],[2,22],[3,35],[4,28],[5,40],[6,33],[7,45],[8,38],[9,52],[10,44]];
const SPARK_TEAL:   Pt[] = [[0,30],[1,22],[2,35],[3,28],[4,42],[5,34],[6,48],[7,40],[8,55],[9,42],[10,58]];
const SPARK_PURPLE: Pt[] = [[0,25],[1,32],[2,20],[3,38],[4,30],[5,44],[6,35],[7,50],[8,40],[9,55],[10,45]];
const SPARK_CYAN:   Pt[] = [[0,40],[1,30],[2,45],[3,32],[4,50],[5,38],[6,55],[7,42],[8,60],[9,48],[10,65]];

interface SparklineProps {
  points: Pt[];
  color: string;
  className?: string;
}

function Sparkline({ points, color, className }: SparklineProps) {
  const W = 400, H = 52;
  const linePath = buildSparkPath(points, W, H);
  const fillPath = linePath + ` L ${W} ${H} L 0 ${H} Z`;
  const gid = `sg-${color.replace("#", "")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gid})`} />
      <path d={linePath} stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Custom line-chart tooltip ─────────────────────────────────── */
function LineTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="crm-db__chart-tooltip">
      <div className="crm-db__chart-tooltip-date">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="crm-db__chart-tooltip-row">
          <span className="crm-db__chart-tooltip-dot" style={{ background: p.color }} />
          <span style={{ color: "#A3AED0", fontWeight: 500, marginRight: 4 }}>
            {p.dataKey === "thisWeek" ? "This Week" : "Last Week"}
          </span>
          {p.value}
        </div>
      ))}
    </div>
  );
}

/* ── Stars ─────────────────────────────────────────────────────── */
function Stars({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <div className="crm-db__stat-stars">
      {Array.from({ length: max }).map((_, i) => (
        <HiMiniStar key={i} className={i < Math.floor(rating) ? "crm-db__star" : "crm-db__star--half"} />
      ))}
    </div>
  );
}

function QarCurrencyMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="18" height="18" rx="6" fill="#8D153A" />
      <path
        d="M7.2 2 L9.1 4.05 L7.2 6.1 L9.1 8.15 L7.2 10.2 L9.1 12.25 L7.2 14.3 L9.1 16.35 L7.2 18.4 L2 18.4 L2 2 Z"
        fill="#FFFFFF"
      />
      <path
        d="M11.4 8.1C12.7 8.1 13.55 8.9 13.55 10.05C13.55 11.25 12.7 12.1 11.4 12.1H10.65V13.85H9.3V8.1H11.4ZM11.28 11.03C11.84 11.03 12.15 10.68 12.15 10.11C12.15 9.56 11.84 9.22 11.28 9.22H10.65V11.03H11.28Z"
        fill="#FFFFFF"
      />
      <path
        d="M14.25 13.85V8.1H16.63C18.3 8.1 19.4 9.22 19.4 10.97C19.4 12.73 18.31 13.85 16.63 13.85H14.25ZM15.6 12.69H16.53C17.4 12.69 17.98 12.01 17.98 10.97C17.98 9.93 17.39 9.25 16.53 9.25H15.6V12.69Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

/* ================================================================
   MAIN EXPORT
   ================================================================ */
export default function Dashboard({ permissions, employeeName, currentPage, onNavigate, onSignOut }: DashboardProps) {
  const { canOption } = usePermissions();
  const activeNav = useMemo<DashboardNavPage>(() => currentPage ?? "jobcards", [currentPage]);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getDashboardStats()
      .then((s) => { if (!cancelled) { setStats(s); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const totalJobs      = stats?.totalJobs ?? 0;
  const completedJobs  = stats?.completedJobs ?? 0;
  const inProgressJobs = stats?.inProgressJobs ?? 0;
  const newRequestJobs = stats?.newRequestJobs ?? 0;
  const upcomingDeliveries = stats?.upcomingDeliveries ?? 0;
  const totalRevenue   = stats?.totalRevenue ?? 0;

  const jobStatusData  = stats?.statusBreakdown ?? [];
  const weeklyData     = stats?.jobsByDay ?? [];

  const topServiceCatCount = stats?.serviceCategoryBreakdown?.[0]?.count ?? 1;
  const serviceCategories  = (stats?.serviceCategoryBreakdown ?? []).map(({ name, count }) => ({
    name,
    pct: Math.round((count / topServiceCatCount) * 100),
    Icon: (SERVICE_CAT_ICONS[name] ?? HiMiniCog8Tooth) as ComponentType,
  }));

  const formatQar = (n: number) =>
    `QAR ${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const displayName = useMemo(() => resolveEmployeeName(employeeName), [employeeName]);
  const avatarInitial = useMemo(() => displayName.charAt(0).toUpperCase() || "U", [displayName]);

  const handleNavClick = (key: DashboardNavPage) => {
    onNavigate?.(key);
  };

  const showDashboardKpis = canOption("dashboard", "dashboard_kpis", true);
  const showDashboardQuickNav = canOption("dashboard", "dashboard_quicknav", true);
  const showDashboardRevenue = canOption("dashboard", "dashboard_revenue", true);
  const showDashboardActivity = canOption("dashboard", "dashboard_activity", true);
  const showDashboardCalendar = canOption("dashboard", "dashboard_calendar", true);

  if (!permissions.canRead) {
    return <div style={{ padding: 24, color: "#2B3674" }}>You don't have access to this page.</div>;
  }

  return (
    <div className="crm-db">
      {/* ── Sidebar ── */}
      <aside className="crm-db__sidebar">
        <div className="crm-db__logo">
          <div className="crm-db__logo-icon">
            <img src={logoImg} alt="Rodeo Drive CRM" />
          </div>
          <div className="crm-db__logo-text">
            <strong>Rodeo Drive</strong>
            <span>CRM Console</span>
          </div>
        </div>

        {showDashboardQuickNav && (
          <div className="crm-db__banner">
            <div className="crm-db__banner-icon"><FiCalendar /></div>
            <div className="crm-db__banner-text">
              <strong>Today at a glance</strong>
              <p>Track performance, incidents, and delivery flow in one place.</p>
            </div>
          </div>
        )}

        {showDashboardQuickNav && (
          <>
            <div className="crm-db__nav-section">
              <div className="crm-db__nav-label">Overview</div>
              {NAV_OVERVIEW.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  className={`crm-db__nav-item${activeNav === key ? " crm-db__nav-item--active" : ""}`}
                  onClick={() => handleNavClick(key)}
                >
                  <span className="crm-db__nav-icon"><Icon /></span>
                  {label}
                </button>
              ))}
            </div>

            <div className="crm-db__nav-section">
              <div className="crm-db__nav-label">Operations</div>
              {NAV_OPERATIONS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  className={`crm-db__nav-item${activeNav === key ? " crm-db__nav-item--active" : ""}`}
                  onClick={() => handleNavClick(key)}
                >
                  <span className="crm-db__nav-icon"><Icon /></span>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="crm-db__signout">
          <button className="crm-db__signout-btn" onClick={onSignOut}>
            <FiLogOut />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="crm-db__main">
        {/* Header */}
        <header className="crm-db__header">
          <div className="crm-db__header-left">
            <div className="crm-db__header-user">
              <span className="crm-db__user-name">{displayName}</span>
              <div className="crm-db__user-avatar">{avatarInitial}</div>
              <FiChevronDown size={14} style={{ color: "#A3AED0" }} />
            </div>
          </div>
          <div className="crm-db__header-right">
            <button className="crm-db__header-filters">
              <MdTune />
              Filters
            </button>
          </div>
        </header>

        {/* Scrollable body */}
        <div className="crm-db__body">

          {/* Top Stats Row */}
          {(showDashboardKpis || showDashboardRevenue) && <div className="crm-db__stats-row">
            {/* Total Jobs */}
            {showDashboardKpis && <div className="crm-db__stat-card">
              <div className="crm-db__stat-top">
                <span className="crm-db__stat-title">Total Jobs</span>
                <div className="crm-db__stat-icon crm-db__stat-icon--blue"><HiMiniClipboardDocumentList /></div>
              </div>
              <div className="crm-db__stat-value">{loading ? "—" : totalJobs.toLocaleString()}</div>
              <div className="crm-db__stat-change crm-db__stat-change--up">
                <span>↑</span>
                &nbsp;<span style={{ color: "#A3AED0", fontWeight: 400 }}>all time</span>
              </div>
              <Sparkline points={SPARK_BLUE} color="#4318FF" className="crm-db__sparkline" />
            </div>}

            {/* Completed Jobs */}
            {showDashboardKpis && <div className="crm-db__stat-card">
              <div className="crm-db__stat-top">
                <span className="crm-db__stat-title">Completed Jobs</span>
                <div className="crm-db__stat-icon crm-db__stat-icon--teal"><HiMiniCheckCircle /></div>
              </div>
              <div className="crm-db__stat-value">{loading ? "—" : completedJobs.toLocaleString()}</div>
              <div className="crm-db__stat-change crm-db__stat-change--up">
                <span>↑</span>
                &nbsp;<span style={{ color: "#A3AED0", fontWeight: 400 }}>all time</span>
              </div>
              <Sparkline points={SPARK_TEAL} color="#05CD99" className="crm-db__sparkline" />
            </div>}

            {/* Revenue */}
            {showDashboardRevenue && <div className="crm-db__stat-card">
              <div className="crm-db__stat-top">
                <span className="crm-db__stat-title">Revenue (QAR)</span>
                <div className="crm-db__stat-icon crm-db__stat-icon--purple"><QarCurrencyMark /></div>
              </div>
              <div className="crm-db__stat-value">{loading ? "—" : formatQar(totalRevenue)}</div>
              <div className="crm-db__stat-change crm-db__stat-change--up">
                <span>↑</span>
                &nbsp;<span style={{ color: "#A3AED0", fontWeight: 400 }}>collected</span>
              </div>
              <Sparkline points={SPARK_PURPLE} color="#7551FF" className="crm-db__sparkline" />
            </div>}

            {/* Customer Satisfaction */}
            {showDashboardKpis && <div className="crm-db__stat-card">
              <div className="crm-db__stat-top">
                <span className="crm-db__stat-title">Customer Satisfaction</span>
                <div className="crm-db__stat-icon crm-db__stat-icon--blue2"><HiMiniStar /></div>
              </div>
              <div className="crm-db__stat-value">
                4.8&nbsp;<span style={{ fontSize: 16, fontWeight: 500, color: "#A3AED0" }}>/ 5</span>
              </div>
              <div className="crm-db__stat-change crm-db__stat-change--up">
                <span>↑</span>
                6.2%&nbsp;<span style={{ color: "#A3AED0", fontWeight: 400 }}>vs last 7 days</span>
              </div>
              <Stars rating={4.5} />
            </div>}
          </div>}

          {/* Charts Row */}
          {showDashboardActivity && <div className="crm-db__charts-row">
            {/* Donut */}
            <div className="crm-db__chart-card">
              <div className="crm-db__chart-card-header">
                <span className="crm-db__chart-card-title">Job Status Overview</span>
                <button className="crm-db__view-all">View all</button>
              </div>
              <div className="crm-db__donut-body">
                <div className="crm-db__donut-chart-wrap" style={{ width: 160, height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={jobStatusData}
                        cx="50%" cy="50%"
                        innerRadius={52} outerRadius={76}
                        dataKey="value"
                        startAngle={90} endAngle={-270}
                        strokeWidth={2} stroke="#fff"
                      >
                        {jobStatusData.map((e) => <Cell key={e.name} fill={e.color} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="crm-db__donut-center">
                    <span className="crm-db__donut-center-value">{loading ? "—" : totalJobs.toLocaleString()}</span>
                    <span className="crm-db__donut-center-label">Total Jobs</span>
                  </div>
                </div>
                <div className="crm-db__donut-legend">
                  {jobStatusData.map((item) => (
                    <div key={item.name} className="crm-db__legend-row">
                      <span className="crm-db__legend-dot" style={{ background: item.color }} />
                      <span className="crm-db__legend-name">{item.name}</span>
                      <span className="crm-db__legend-val">{item.value}</span>
                      <span className="crm-db__legend-pct">{item.pct}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Line chart */}
            <div className="crm-db__chart-card">
              <div className="crm-db__chart-card-header">
                <span className="crm-db__chart-card-title">Jobs Over Time</span>
                <div className="crm-db__chart-dropdown">Daily <FiChevronDown size={12} /></div>
              </div>
              <div className="crm-db__line-legend">
                <div className="crm-db__line-legend-item">
                  <span className="crm-db__line-legend-dash crm-db__line-legend-dash--solid" />
                  This Week
                </div>
                <div className="crm-db__line-legend-item">
                  <span className="crm-db__line-legend-dash crm-db__line-legend-dash--dashed" />
                  Last Week
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weeklyData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f3fa" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "#A3AED0", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 280]} ticks={[0, 70, 140, 210, 280]} tick={{ fill: "#A3AED0", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<LineTooltip />} />
                    <Line type="monotone" dataKey="thisWeek" stroke="#4318FF" strokeWidth={2.5}
                      dot={{ r: 4, fill: "#4318FF", strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="lastWeek" stroke="#39BFFF" strokeWidth={2} strokeDasharray="6 4"
                      dot={{ r: 4, fill: "#39BFFF", strokeWidth: 2, stroke: "#fff" }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Service categories */}
            <div className="crm-db__chart-card">
              <div className="crm-db__chart-card-header">
                <span className="crm-db__chart-card-title">Top Service Categories</span>
                <button className="crm-db__view-all">View all</button>
              </div>
              <div className="crm-db__service-list">
                {serviceCategories.map(({ name, pct, Icon }) => (
                  <div key={name} className="crm-db__service-row">
                    <div className="crm-db__service-icon"><Icon /></div>
                    <div className="crm-db__service-info">
                      <div className="crm-db__service-name">{name}</div>
                      <div className="crm-db__service-bar-track">
                        <div className="crm-db__service-bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <span className="crm-db__service-pct">{pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>}

          {/* Bottom Stats Row */}
          {(showDashboardKpis || showDashboardCalendar) && <div className="crm-db__bottom-row">
            {/* New Requests */}
            {showDashboardKpis && <div className="crm-db__bottom-card">
              <div className="crm-db__bottom-card-top">
                <span className="crm-db__bottom-card-title">New Requests</span>
                <div className="crm-db__bottom-icon crm-db__bottom-icon--blue"><HiMiniChatBubbleLeftRight /></div>
              </div>
              <div className="crm-db__bottom-value">{loading ? "—" : newRequestJobs.toLocaleString()}</div>
              <div className="crm-db__bottom-change"><span>↑ 14.6%</span></div>
              <div className="crm-db__bottom-sub">vs last 7 days</div>
              <Sparkline points={SPARK_BLUE} color="#4318FF" className="crm-db__bottom-sparkline" />
            </div>}

            {/* In Progress */}
            {showDashboardKpis && <div className="crm-db__bottom-card">
              <div className="crm-db__bottom-card-top">
                <span className="crm-db__bottom-card-title">In Progress</span>
                <div className="crm-db__bottom-icon crm-db__bottom-icon--teal"><HiMiniWrench /></div>
              </div>
              <div className="crm-db__bottom-value">{loading ? "—" : inProgressJobs.toLocaleString()}</div>
              <div className="crm-db__bottom-change"><span>↑ 10.1%</span></div>
              <div className="crm-db__bottom-sub">vs last 7 days</div>
              <Sparkline points={SPARK_TEAL} color="#05CD99" className="crm-db__bottom-sparkline" />
            </div>}

            {/* Upcoming Deliveries */}
            {showDashboardCalendar && <div className="crm-db__bottom-card">
              <div className="crm-db__bottom-card-top">
                <span className="crm-db__bottom-card-title">Upcoming Deliveries</span>
                <div className="crm-db__bottom-icon crm-db__bottom-icon--purple"><HiMiniCalendar /></div>
              </div>
              <div className="crm-db__bottom-value">{loading ? "—" : upcomingDeliveries.toLocaleString()}</div>
              <div className="crm-db__bottom-change"><span>↑ 8.3%</span></div>
              <div className="crm-db__bottom-sub">vs last 7 days</div>
              <Sparkline points={SPARK_PURPLE} color="#7551FF" className="crm-db__bottom-sparkline" />
            </div>}

            {/* Avg Turnaround */}
            {showDashboardKpis && <div className="crm-db__bottom-card">
              <div className="crm-db__bottom-card-top">
                <span className="crm-db__bottom-card-title">Avg. Turnaround Time</span>
                <div className="crm-db__bottom-icon crm-db__bottom-icon--cyan"><HiMiniClock /></div>
              </div>
              <div className="crm-db__bottom-value">
                2.6&nbsp;<span style={{ fontSize: 14, fontWeight: 600, color: "#A3AED0" }}>Days</span>
              </div>
              <div className="crm-db__bottom-change crm-db__bottom-change--down"><span>↓ 12.4%</span></div>
              <div className="crm-db__bottom-sub">vs last 7 days</div>
              <Sparkline points={SPARK_CYAN} color="#39BFFF" className="crm-db__bottom-sparkline" />
            </div>}
          </div>}

          {/* Footer */}
          <footer className="crm-db__footer">
            <span className="crm-db__footer-copy">
              Service Management System © 2026 | Rodeo Drive CRM Console
            </span>
            <div className="crm-db__footer-lang">
              <FiGlobe />
              EN English (United States)
              <FiChevronDown size={13} />
            </div>
          </footer>

        </div>{/* end body */}
      </main>
    </div>
  );
}
