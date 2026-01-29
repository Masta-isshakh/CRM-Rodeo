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

import DepartmentsAdmin from "../pages/DepartmentsAdmin";
import RolesPoliciesAdmin from "../pages/RolesPoliciesAdmin";

import logo from "../assets/logo.jpeg";
import "./mainLayout.css";

import { usePermissions } from "../lib/userPermissions";

type Page =
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

const EMPTY = { canRead: false, canCreate: false, canUpdate: false, canDelete: false, canApprove: false };

export default function MainLayout({ signOut }: { signOut: () => void }) {
  const [page, setPage] = useState<Page>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { loading, email, isAdminGroup, can } = usePermissions();

  // allow calling can() with either "USERS_ADMIN" or "USERS" without TS issues
  const canAny = (key: string) => ((can as any)(key) ?? EMPTY) as typeof EMPTY;

  const go = (p: Page) => {
    setPage(p);
    setSidebarOpen(false);
  };

  // Regular pages
  const show = useMemo(() => {
    return {
      dashboard: canAny("DASHBOARD").canRead,
      customers: canAny("CUSTOMERS").canRead,
      tickets: canAny("TICKETS").canRead,
      employees: canAny("EMPLOYEES").canRead,
      activitylog: canAny("ACTIVITY_LOG").canRead,
      jobcards: canAny("JOB_CARDS").canRead,
      calltracking: canAny("CALL_TRACKING").canRead,
      inspection: canAny("INSPECTION_APPROVALS").canRead,
    };
  }, [can]);

  // Admin pages (must be admin group AND policy read)
  const adminPerms = useMemo(() => {
    const usersP = canAny("USERS_ADMIN").canRead ? canAny("USERS_ADMIN") : canAny("USERS");
    const deptP = canAny("DEPARTMENTS_ADMIN").canRead ? canAny("DEPARTMENTS_ADMIN") : canAny("DEPARTMENTS");
    const rpP = canAny("ROLES_POLICIES_ADMIN").canRead ? canAny("ROLES_POLICIES_ADMIN") : canAny("ROLES_POLICIES");

    return { usersP, deptP, rpP };
  }, [can]);

  const showAdmin = useMemo(() => {
    return {
      users: isAdminGroup && adminPerms.usersP.canRead,
      departments: isAdminGroup && adminPerms.deptP.canRead,
      rolespolicies: isAdminGroup && adminPerms.rpP.canRead,
    };
  }, [isAdminGroup, adminPerms]);

  // If user somehow lands on a page they can't read, auto-redirect to first allowed page
  useEffect(() => {
    if (loading) return;

    const allowedPages: Page[] = [];
    if (show.dashboard) allowedPages.push("dashboard");
    if (show.customers) allowedPages.push("customers");
    if (show.jobcards) allowedPages.push("jobcards");
    if (show.calltracking) allowedPages.push("calltracking");
    if (show.inspection) allowedPages.push("inspection");
    if (show.tickets) allowedPages.push("tickets");
    if (show.employees) allowedPages.push("employees");
    if (show.activitylog) allowedPages.push("activitylog");
    if (showAdmin.users) allowedPages.push("users");
    if (showAdmin.departments) allowedPages.push("departments");
    if (showAdmin.rolespolicies) allowedPages.push("rolespolicies");

    const isCurrentAllowed =
      (page === "dashboard" && show.dashboard) ||
      (page === "customers" && show.customers) ||
      (page === "jobcards" && show.jobcards) ||
      (page === "calltracking" && show.calltracking) ||
      (page === "inspection" && show.inspection) ||
      (page === "tickets" && show.tickets) ||
      (page === "employees" && show.employees) ||
      (page === "activitylog" && show.activitylog) ||
      (page === "users" && showAdmin.users) ||
      (page === "departments" && showAdmin.departments) ||
      (page === "rolespolicies" && showAdmin.rolespolicies);

    if (!isCurrentAllowed) {
      setPage(allowedPages[0] ?? "dashboard");
    }
  }, [loading, page, show, showAdmin]);

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
          {show.dashboard && <button onClick={() => go("dashboard")}>Dashboard</button>}
          {show.customers && <button onClick={() => go("customers")}>Customers</button>}
          {show.jobcards && <button onClick={() => go("jobcards")}>Job Cards</button>}
          {show.calltracking && <button onClick={() => go("calltracking")}>Call Tracking</button>}
          {show.inspection && <button onClick={() => go("inspection")}>Inspection Approvals</button>}

          {show.tickets && <button onClick={() => go("tickets")}>Tickets</button>}
          {show.employees && <button onClick={() => go("employees")}>Employees</button>}
          {show.activitylog && <button onClick={() => go("activitylog")}>Activity Log</button>}

          {(showAdmin.users || showAdmin.departments || showAdmin.rolespolicies) && (
            <>
              {showAdmin.users && <button onClick={() => go("users")}>Users</button>}
              {showAdmin.departments && <button onClick={() => go("departments")}>Departments</button>}
              {showAdmin.rolespolicies && <button onClick={() => go("rolespolicies")}>Roles & Policies</button>}
            </>
          )}

          <button className="danger" onClick={signOut}>
            Sign out
          </button>
        </nav>
      </aside>

      <main className="main-content">
        <header className="main-header">
          <button className="menu-btn" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          <div className="header-text">
            <h1>Welcome</h1>
            <p className="sub">{loading ? "Loading..." : `Signed in as: ${email}`}</p>
          </div>
        </header>

        <section className="page-content">
          {page === "dashboard" && show.dashboard && (
            <Dashboard
              permissions={canAny("DASHBOARD")}
              showEmployeesKpi={show.employees}
              showCustomersKpi={show.customers}
            />
          )}

          {page === "customers" && show.customers && <Customers permissions={canAny("CUSTOMERS")} />}
          {page === "jobcards" && show.jobcards && <JobCards permissions={canAny("JOB_CARDS")} />}
          {page === "calltracking" && show.calltracking && <CallTracking permissions={canAny("CALL_TRACKING")} />}
          {page === "inspection" && show.inspection && <InspectionApprovals permissions={canAny("INSPECTION_APPROVALS")} />}

          {page === "tickets" && show.tickets && <Tickets permissions={canAny("TICKETS")} />}
          {page === "employees" && show.employees && <Employees permissions={canAny("EMPLOYEES")} />}
          {page === "activitylog" && show.activitylog && <ActivityLog permissions={canAny("ACTIVITY_LOG")} />}

          {page === "users" && showAdmin.users && <Users permissions={adminPerms.usersP} />}
          {page === "departments" && showAdmin.departments && <DepartmentsAdmin permissions={adminPerms.deptP} />}
          {page === "rolespolicies" && showAdmin.rolespolicies && <RolesPoliciesAdmin permissions={adminPerms.rpP} />}
        </section>
      </main>
    </div>
  );
}
