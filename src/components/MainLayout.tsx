import { useState } from "react";

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

export default function MainLayout({ signOut }: { signOut: () => void }) {
  const [page, setPage] = useState<Page>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { loading, email, isAdminGroup, can } = usePermissions();

  const go = (p: Page) => {
    setPage(p);
    setSidebarOpen(false);
  };

  const show = {
    dashboard: can("DASHBOARD").canRead,
    customers: can("CUSTOMERS").canRead,
    tickets: can("TICKETS").canRead,
    employees: can("EMPLOYEES").canRead,
    activitylog: can("ACTIVITY_LOG").canRead,
    jobcards: can("JOB_CARDS").canRead,
    calltracking: can("CALL_TRACKING").canRead,
    inspection: can("INSPECTION_APPROVALS").canRead,
  };

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

          {isAdminGroup && (
            <>
              <button onClick={() => go("users")}>Users</button>
              <button onClick={() => go("departments")}>Departments</button>
              <button onClick={() => go("rolespolicies")}>Roles & Policies</button>
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
          {page === "dashboard" && show.dashboard && <Dashboard permissions={can("DASHBOARD")} />}
          {page === "customers" && show.customers && <Customers permissions={can("CUSTOMERS")} />}
          {page === "jobcards" && show.jobcards && <JobCards permissions={can("JOB_CARDS")} />}
          {page === "calltracking" && show.calltracking && <CallTracking permissions={can("CALL_TRACKING")} />}
          {page === "inspection" && show.inspection && <InspectionApprovals permissions={can("INSPECTION_APPROVALS")} />}

          {page === "tickets" && show.tickets && <Tickets permissions={can("TICKETS")} />}
          {page === "employees" && show.employees && <Employees permissions={can("EMPLOYEES")} />}
          {page === "activitylog" && show.activitylog && <ActivityLog permissions={can("ACTIVITY_LOG")} />}

          {page === "users" && isAdminGroup && <Users />}
          {page === "departments" && isAdminGroup && <DepartmentsAdmin />}
          {page === "rolespolicies" && isAdminGroup && <RolesPoliciesAdmin />}
        </section>
      </main>
    </div>
  );
}
