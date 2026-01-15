import { useEffect, useMemo, useState } from "react";
import Dashboard from "../pages/Dashboard";
import Customers from "../pages/Customer";
import Tickets from "../pages/Tickets";
import Employees from "../pages/Employees";
import ActivityLog from "../pages/ActivityLogs";
import Users from "../pages/UserAdmin";

import JobCards from "../pages/JobCards";
import CallTracking from "../pages/CallTracking";
import InspectionApprovals from "../pages/InspectionApprovals";

import {
  fetchAuthSession,
  getCurrentUser,
  GetCurrentUserOutput,
} from "aws-amplify/auth";

import logo from "../assets/logo.jpeg";
import "./mainLayout.css";

interface Props {
  user: GetCurrentUserOutput | null;
  signOut: () => void;
}

type Page =
  | "dashboard"
  | "employees"
  | "customers"
  | "tickets"
  | "activitylogger"
  | "users"
  | "jobcards"
  | "calltracking"
  | "inspection";

type Group = "ADMIN" | "SALES" | "SALES_MANAGER" | "SUPPORT";

function pickPrimaryRole(groups: string[]): Group | null {
  // precedence if user belongs to multiple groups
  if (groups.includes("ADMIN")) return "ADMIN";
  if (groups.includes("SALES_MANAGER")) return "SALES_MANAGER";
  if (groups.includes("SALES")) return "SALES";
  if (groups.includes("SUPPORT")) return "SUPPORT";
  return null;
}

export default function MainLayout({ signOut }: Props) {
  const [page, setPage] = useState<Page>("dashboard");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const u = await getCurrentUser();
        setUserEmail(u.signInDetails?.loginId || null);

        const session = await fetchAuthSession();
        const g =
          (session.tokens?.idToken?.payload["cognito:groups"] as string[]) ?? [];
        setGroups(g);
      } catch (err) {
        console.error(err);
        setUserEmail(null);
        setGroups([]);
      }
    };
    load();
  }, []);

  const primaryRole = useMemo(() => pickPrimaryRole(groups), [groups]);

  const isAdmin = primaryRole === "ADMIN";
  const isSalesManager = primaryRole === "SALES_MANAGER";
  const isSales = primaryRole === "SALES";
  const isSupport = primaryRole === "SUPPORT";

  // Page permissions (menu + hard guard)
  const canSee = useMemo(() => {
    const allow: Record<Page, boolean> = {
      dashboard: true,

      // default false, then enable per role
      employees: false,
      customers: false,
      tickets: false,
      activitylogger: false,
      users: false,
      jobcards: false,
      calltracking: false,
      inspection: false,
    };

    if (isAdmin) {
      // Admin sees everything
      (Object.keys(allow) as Page[]).forEach((k) => (allow[k] = true));
      return allow;
    }

    if (isSalesManager) {
      // SALES_MANAGER: ONLY these pages
      allow.customers = true;
      allow.jobcards = true;
      allow.calltracking = true;
      allow.inspection = true;
      // dashboard already true
      return allow;
    }

    if (isSales) {
      // You can tune this as you want. Example:
      allow.customers = true;
      allow.tickets = true; // read-only is enforced by backend model auth
      allow.jobcards = true;
      allow.calltracking = true;
      allow.inspection = true; // read-only enforced in Inspection model auth + UI
      return allow;
    }

    if (isSupport) {
      // Example support permissions
      allow.tickets = true;
      allow.activitylogger = true;
      return allow;
    }

    return allow;
  }, [isAdmin, isSalesManager, isSales, isSupport]);

  // Hard guard (if someone forces setPage)
  const isPageAllowed = canSee[page];

  // If role changes or current page becomes forbidden, fallback to dashboard
  useEffect(() => {
    if (!isPageAllowed) setPage("dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryRole]);

  const go = (p: Page) => {
    setPage(p);
    setSidebarOpen(false);
  };

  const canApproveInspection = useMemo(() => {
    // Only ADMIN + SALES_MANAGER approve
    return isAdmin || isSalesManager;
  }, [isAdmin, isSalesManager]);

  return (
    <div className="layout-container">
      <div
        className={`overlay ${sidebarOpen ? "show" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-logo">
          <img src={logo} alt="Rodeo Drive CRM Logo" className="logo-img" />
          <span className="logo-text">Rodeo Drive CRM</span>
        </div>

        <nav className="sidebar-nav">
          {canSee.dashboard && (
            <button className={page === "dashboard" ? "active" : ""} onClick={() => go("dashboard")}>
              Dashboard
            </button>
          )}

          {canSee.employees && (
            <button className={page === "employees" ? "active" : ""} onClick={() => go("employees")}>
              Employees
            </button>
          )}

          {canSee.customers && (
            <button className={page === "customers" ? "active" : ""} onClick={() => go("customers")}>
              Customers
            </button>
          )}

          {canSee.tickets && (
            <button className={page === "tickets" ? "active" : ""} onClick={() => go("tickets")}>
              Tickets
            </button>
          )}

          {canSee.activitylogger && (
            <button
              className={page === "activitylogger" ? "active" : ""}
              onClick={() => go("activitylogger")}
            >
              Activity Logger
            </button>
          )}

          {canSee.jobcards && (
            <button className={page === "jobcards" ? "active" : ""} onClick={() => go("jobcards")}>
              Job Cards
            </button>
          )}

          {canSee.calltracking && (
            <button
              className={page === "calltracking" ? "active" : ""}
              onClick={() => go("calltracking")}
            >
              Call Tracking
            </button>
          )}

          {canSee.inspection && (
            <button
              className={page === "inspection" ? "active" : ""}
              onClick={() => go("inspection")}
            >
              Inspection Approval
            </button>
          )}

          {canSee.users && (
            <button className={page === "users" ? "active" : ""} onClick={() => go("users")}>
              Users
            </button>
          )}

          <button className="danger" onClick={signOut}>
            Sign out
          </button>
        </nav>
      </aside>

      <main className="main-content">
        <header className="main-header">
          <button className="menu-btn" aria-label="Open menu" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>

          <div className="header-text">
            <h1>Welcome</h1>
            <p className="sub">{userEmail ? `Signed in as: ${userEmail}` : "Loading user..."}</p>
            <p className="sub" style={{ opacity: 0.7 }}>
              Role: {primaryRole ?? "none"} {groups.length ? `(${groups.join(", ")})` : ""}
            </p>
          </div>
        </header>

        <section className="page-content">
          {!isPageAllowed ? (
            <div style={{ padding: 16, border: "1px solid #ddd", borderRadius: 8, background: "#fff" }}>
              <h3>Access denied</h3>
              <p>You don’t have permission to view this page.</p>
            </div>
          ) : (
            <>
              {page === "dashboard" && <Dashboard />}
              {page === "employees" && <Employees />}
              {page === "customers" && <Customers />}
              {page === "tickets" && <Tickets />}
              {page === "activitylogger" && <ActivityLog />}
              {page === "users" && isAdmin && <Users />}

              {page === "jobcards" && <JobCards />}
              {page === "calltracking" && <CallTracking />}
              {page === "inspection" && (
                <InspectionApprovals canApprove={canApproveInspection} />
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
