import { useEffect, useMemo, useState } from "react";
import Dashboard from "../pages/Dashboard";
import Customers from "../pages/Customer";
import Tickets from "../pages/Tickets";
import Employees from "../pages/Employees";
import ActivityLog from "../pages/ActivityLogs";
import AdminUsers from "../pages/UserAdmin";

// New pages (create these files in ../pages/)
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

function hasAnyGroup(groups: string[], required: string[]) {
  return required.some((g) => groups.includes(g));
}

export default function MainLayout({ signOut }: Props) {
  const [page, setPage] = useState<Page>("dashboard");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [groups, setGroups] = useState<string[]>([]);

  // Mobile drawer state
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

  const isAdmin = useMemo(() => groups.includes("ADMIN"), [groups]);

  // Allowed viewers for the new pages:
  const canViewSalesPages = useMemo(
    () => hasAnyGroup(groups, ["ADMIN", "SALES", "SALES_MANAGER"]),
    [groups]
  );

  // Only ADMIN + SALES_MANAGER can approve inspections:
  const canApproveInspection = useMemo(
    () => hasAnyGroup(groups, ["ADMIN", "SALES_MANAGER"]),
    [groups]
  );

  // Guard: prevent access even if someone forces the page state
  const isPageAllowed = useMemo(() => {
    if (page === "users") return isAdmin;
    if (page === "jobcards" || page === "calltracking" || page === "inspection")
      return canViewSalesPages;
    return true;
  }, [page, isAdmin, canViewSalesPages]);

  // Close sidebar on page change (mobile)
  const go = (p: Page) => {
    setPage(p);
    setSidebarOpen(false);
  };

  return (
    <div className="layout-container">
      {/* Mobile overlay */}
      <div
        className={`overlay ${sidebarOpen ? "show" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar (desktop + drawer on mobile) */}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-logo">
          <img src={logo} alt="Rodeo Drive CRM Logo" className="logo-img" />
          <span className="logo-text">Rodeo Drive CRM</span>
        </div>

        <nav className="sidebar-nav">
          <button
            className={page === "dashboard" ? "active" : ""}
            onClick={() => go("dashboard")}
          >
            Dashboard
          </button>

          <button
            className={page === "employees" ? "active" : ""}
            onClick={() => go("employees")}
          >
            Employees
          </button>

          <button
            className={page === "customers" ? "active" : ""}
            onClick={() => go("customers")}
          >
            Customers
          </button>

          <button
            className={page === "tickets" ? "active" : ""}
            onClick={() => go("tickets")}
          >
            Tickets
          </button>

          <button
            className={page === "activitylogger" ? "active" : ""}
            onClick={() => go("activitylogger")}
          >
            Activity Logger
          </button>

          {/* New pages - only for ADMIN/SALES/SALES_MANAGER */}
          {canViewSalesPages && (
            <>
              <button
                className={page === "jobcards" ? "active" : ""}
                onClick={() => go("jobcards")}
              >
                Job Cards
              </button>

              <button
                className={page === "calltracking" ? "active" : ""}
                onClick={() => go("calltracking")}
              >
                Call Tracking
              </button>

              <button
                className={page === "inspection" ? "active" : ""}
                onClick={() => go("inspection")}
              >
                Inspection Approval
              </button>
            </>
          )}

          {isAdmin && (
            <button
              className={page === "users" ? "active" : ""}
              onClick={() => go("users")}
            >
              Users
            </button>
          )}

          <button className="danger" onClick={signOut}>
            Sign out
          </button>
        </nav>
      </aside>

      {/* Main */}
      <main className="main-content">
        <header className="main-header">
          <button
            className="menu-btn"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>

          <div className="header-text">
            <h1>Welcome</h1>
            <p className="sub">
              {userEmail ? `Signed in as: ${userEmail}` : "Loading user..."}
            </p>
            <p className="sub" style={{ opacity: 0.7 }}>
              {groups.length ? `Groups: ${groups.join(", ")}` : "Groups: none"}
            </p>
          </div>
        </header>

        <section className="page-content">
          {!isPageAllowed ? (
            <div
              style={{
                padding: 16,
                border: "1px solid #ddd",
                borderRadius: 8,
                background: "#fff",
              }}
            >
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
              {page === "users" && isAdmin && <AdminUsers />}

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
