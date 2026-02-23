// src/layout/MainLayout.tsx
import { useEffect, useMemo, useState } from "react";

import Dashboard from "../pages/Dashboard";
import Customers from "../pages/Customer";
import Vehicles from "../pages/Vehicule";
import Tickets from "../pages/Tickets";
import Employees from "../pages/Employees";
import ActivityLog from "../pages/ActivityLogs";

import JobCards from "../pages/JobCards";
import CallTracking from "../pages/CallTracking";
import ServiceExecution from "../pages/ServiceExecutionModule";
import Users from "../pages/UserAdmin";
import DepartmentsAdmin from "../pages/DepartmentsAdmin";
import RolesPoliciesAdmin from "../pages/RolesPoliciesAdmin";

import JobOrderHistory from "../pages/JobOrderHistory";
import QualityCheckModule from "../pages/QualityCheckModule";
import ExitPermitManagement from "../pages/ExitPermitManagement";

import InspectionModule from "../pages/InspectionModule";
import PaymentInvoiceManagment from "../pages/PaymentInvoiceManagment";

import RoleAccessControl from "../pages/RoleAccessControl"; // ✅ ADD THIS

import logo from "../assets/logo.jpeg";
import "./mainLayout.css";

import { usePermissions } from "../lib/userPermissions";
import { ApprovalRequestsProvider } from "../pages/ApprovalRequestsContext";

type Page =
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
  | "rolespolicies"
  | "roleaccesscontrol"; // ✅ ADD THIS

const EMPTY = {
  canRead: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canApprove: false,
};

export default function MainLayout({ signOut }: { signOut: () => void }) {
  const [page, setPage] = useState<Page>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { loading, email, isAdminGroup, can, canOption } = usePermissions();
  const canAny = (key: string) => ((can as any)(key) ?? EMPTY) as typeof EMPTY;

  const go = (p: Page) => {
    setPage(p);
    setSidebarOpen(false);
  };

  // ✅ helper: sidebar “list” toggle gate (defaults to true if key not stored)
  const listOn = (moduleId: string, listOptionId: string) => {
    if (isAdminGroup) return true;
    return canOption(moduleId, listOptionId, true);
  };

  /**
   * Policy-level visibility + option-level sidebar list toggles
   */
  const show = useMemo(() => {
    const jobCardsRead = isAdminGroup || canAny("JOB_CARDS").canRead;

    return {
      // Core
      dashboard: (isAdminGroup || canAny("DASHBOARD").canRead) && listOn("dashboard", "dashboard_list"),
      customers: (isAdminGroup || canAny("CUSTOMERS").canRead) && listOn("customers", "customers_list"),
      vehicles: (isAdminGroup || canAny("VEHICLES").canRead) && listOn("vehicles", "vehicles_list"),
      tickets: (isAdminGroup || canAny("TICKETS").canRead) && listOn("tickets", "tickets_list"),
      employees: (isAdminGroup || canAny("EMPLOYEES").canRead) && listOn("employees", "employees_list"),
      activitylog: (isAdminGroup || canAny("ACTIVITY_LOG").canRead) && listOn("activitylog", "activitylog_list"),
      calltracking: (isAdminGroup || canAny("CALL_TRACKING").canRead) && listOn("calltracking", "calltracking_list"),

      // Job ecosystem (policy JOB_CARDS)
      jobcards: jobCardsRead && listOn("joborder", "joborder_list"),
      jobhistory: jobCardsRead && listOn("jobhistory", "jobhistory_list"),
      serviceexecution: jobCardsRead && listOn("serviceexec", "serviceexec_list"),
      paymentinvoices: jobCardsRead && listOn("payment", "payment_list"),
      qualitycheck: jobCardsRead && listOn("qualitycheck", "qualitycheck_list"),
      exitpermit: jobCardsRead && listOn("exitpermit", "exitpermit_list"),
      inspection: jobCardsRead && listOn("inspection", "inspection_list"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminGroup, can, canOption]);

  const showAdmin = useMemo(() => {
    return {
      users: isAdminGroup,
      departments: isAdminGroup,
      rolespolicies: isAdminGroup,
      roleaccesscontrol: isAdminGroup, // ✅ add
    };
  }, [isAdminGroup]);

  const nothingVisible =
    !loading &&
    !show.dashboard &&
    !show.customers &&
    !show.vehicles &&
    !show.tickets &&
    !show.employees &&
    !show.activitylog &&
    !show.calltracking &&
    !show.jobcards &&
    !show.jobhistory &&
    !show.serviceexecution &&
    !show.paymentinvoices &&
    !show.qualitycheck &&
    !show.exitpermit &&
    !show.inspection &&
    !showAdmin.users &&
    !showAdmin.departments &&
    !showAdmin.rolespolicies &&
    !showAdmin.roleaccesscontrol;

  useEffect(() => {
    if (loading) return;

    const allowedPages: Page[] = [];
    if (show.dashboard) allowedPages.push("dashboard");
    if (show.customers) allowedPages.push("customers");
    if (show.vehicles) allowedPages.push("vehicles");
    if (show.jobcards) allowedPages.push("jobcards");
    if (show.jobhistory) allowedPages.push("jobhistory");
    if (show.serviceexecution) allowedPages.push("serviceexecution");
    if (show.paymentinvoices) allowedPages.push("paymentinvoices");
    if (show.qualitycheck) allowedPages.push("qualitycheck");
    if (show.exitpermit) allowedPages.push("exitpermit");
    if (show.inspection) allowedPages.push("inspection");
    if (show.calltracking) allowedPages.push("calltracking");
    if (show.tickets) allowedPages.push("tickets");
    if (show.employees) allowedPages.push("employees");
    if (show.activitylog) allowedPages.push("activitylog");

    if (showAdmin.users) allowedPages.push("users");
    if (showAdmin.departments) allowedPages.push("departments");
    if (showAdmin.rolespolicies) allowedPages.push("rolespolicies");
    if (showAdmin.roleaccesscontrol) allowedPages.push("roleaccesscontrol");

    const isCurrentAllowed =
      (page === "dashboard" && show.dashboard) ||
      (page === "customers" && show.customers) ||
      (page === "vehicles" && show.vehicles) ||
      (page === "jobcards" && show.jobcards) ||
      (page === "jobhistory" && show.jobhistory) ||
      (page === "serviceexecution" && show.serviceexecution) ||
      (page === "paymentinvoices" && show.paymentinvoices) ||
      (page === "qualitycheck" && show.qualitycheck) ||
      (page === "exitpermit" && show.exitpermit) ||
      (page === "inspection" && show.inspection) ||
      (page === "calltracking" && show.calltracking) ||
      (page === "tickets" && show.tickets) ||
      (page === "employees" && show.employees) ||
      (page === "activitylog" && show.activitylog) ||
      (page === "users" && showAdmin.users) ||
      (page === "departments" && showAdmin.departments) ||
      (page === "rolespolicies" && showAdmin.rolespolicies) ||
      (page === "roleaccesscontrol" && showAdmin.roleaccesscontrol);

    if (!isCurrentAllowed) {
      setPage(allowedPages[0] ?? "dashboard");
    }
  }, [loading, page, show, showAdmin]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    if (sidebarOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = prev || "";
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [sidebarOpen]);

  const title = "Rodeo Drive CRM";

  const initials = useMemo(() => {
    const e = (email || "").trim();
    if (!e) return "R";
    return e[0].toUpperCase();
  }, [email]);

  const currentUser = useMemo(() => {
    const e = (email || "").trim();
    return { name: e, email: e };
  }, [email]);

  return (
    <ApprovalRequestsProvider>
      <div className="layout-root">
        <div className={`drawer-overlay ${sidebarOpen ? "show" : ""}`} onClick={() => setSidebarOpen(false)} />

        <aside className={`drawer ${sidebarOpen ? "open" : ""}`} aria-hidden={!sidebarOpen}>
          <div className="drawer-head">
            <div className="drawer-brand">
              <img src={logo} alt="Rodeo Drive CRM Logo" className="brand-logo" />
              <div className="brand-text">
                <div className="brand-title">Rodeo Drive</div>
                <div className="brand-sub">CRM Console</div>
              </div>
            </div>

            <button className="drawer-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
              ✕
            </button>
          </div>

          <nav className="drawer-nav">
            {show.dashboard && (
              <button className={page === "dashboard" ? "active" : ""} onClick={() => go("dashboard")}>
                Dashboard
              </button>
            )}

            {show.customers && (
              <button className={page === "customers" ? "active" : ""} onClick={() => go("customers")}>
                Customers
              </button>
            )}

            {show.vehicles && (
              <button className={page === "vehicles" ? "active" : ""} onClick={() => go("vehicles")}>
                Vehicles
              </button>
            )}

            {show.jobcards && (
              <button className={page === "jobcards" ? "active" : ""} onClick={() => go("jobcards")}>
                Job Cards
              </button>
            )}

            {show.jobhistory && (
              <button className={page === "jobhistory" ? "active" : ""} onClick={() => go("jobhistory")}>
                Job History
              </button>
            )}

            {show.serviceexecution && (
              <button className={page === "serviceexecution" ? "active" : ""} onClick={() => go("serviceexecution")}>
                Service Execution
              </button>
            )}

            {show.paymentinvoices && (
              <button className={page === "paymentinvoices" ? "active" : ""} onClick={() => go("paymentinvoices")}>
                Payment & Invoices
              </button>
            )}

            {show.qualitycheck && (
              <button className={page === "qualitycheck" ? "active" : ""} onClick={() => go("qualitycheck")}>
                Quality Check
              </button>
            )}

            {show.exitpermit && (
              <button className={page === "exitpermit" ? "active" : ""} onClick={() => go("exitpermit")}>
                Exit Permit
              </button>
            )}

            {show.calltracking && (
              <button className={page === "calltracking" ? "active" : ""} onClick={() => go("calltracking")}>
                Call Tracking
              </button>
            )}

            {show.inspection && (
              <button className={page === "inspection" ? "active" : ""} onClick={() => go("inspection")}>
                Inspection
              </button>
            )}

            {show.tickets && (
              <button className={page === "tickets" ? "active" : ""} onClick={() => go("tickets")}>
                Tickets
              </button>
            )}

            {show.employees && (
              <button className={page === "employees" ? "active" : ""} onClick={() => go("employees")}>
                Employees
              </button>
            )}

            {show.activitylog && (
              <button className={page === "activitylog" ? "active" : ""} onClick={() => go("activitylog")}>
                Activity Log
              </button>
            )}

            {(showAdmin.users || showAdmin.departments || showAdmin.rolespolicies || showAdmin.roleaccesscontrol) && (
              <div className="drawer-section">
                <div className="drawer-section-label">Admin</div>

                {showAdmin.users && (
                  <button className={page === "users" ? "active" : ""} onClick={() => go("users")}>
                    Users
                  </button>
                )}
                {showAdmin.departments && (
                  <button className={page === "departments" ? "active" : ""} onClick={() => go("departments")}>
                    Departments
                  </button>
                )}
                {showAdmin.rolespolicies && (
                  <button className={page === "rolespolicies" ? "active" : ""} onClick={() => go("rolespolicies")}>
                    Roles & Policies
                  </button>
                )}
                {showAdmin.roleaccesscontrol && (
                  <button className={page === "roleaccesscontrol" ? "active" : ""} onClick={() => go("roleaccesscontrol")}>
                    Role Access Control
                  </button>
                )}
              </div>
            )}

            <div className="drawer-spacer" />

            <button className="danger" onClick={signOut}>
              Sign out
            </button>
          </nav>
        </aside>

        <div className="layout-main">
          <header className="topbar">
            <div className="topbar-inner">
              <button className="menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open menu" type="button">
                <span className="menu-toggle-icon" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              </button>

              <div className="topbar-center">
                <div className="topbar-title">{title}</div>
                <div className="topbar-sub">{loading ? "Loading..." : `Signed in as: ${email || "-"}`}</div>
              </div>

              <div className="topbar-right">
                <div className="avatar" title={email || ""}>
                  {initials}
                </div>
              </div>
            </div>
          </header>

          <main className="content">
            {nothingVisible && (
              <div className="no-access">
                <h3>No access configured</h3>
                <p>
                  You are signed in, but no department → role → policy permissions were resolved for your account. Ask an Admin to
                  assign a Department role + Role policies.
                </p>
              </div>
            )}

            {page === "dashboard" && show.dashboard && (
              <Dashboard
                permissions={canAny("DASHBOARD")}
                email={email}
                visibility={{ ...show, admin: showAdmin }}
                onNavigate={(p: any) => setPage(p)}
              />
            )}

            {page === "customers" && show.customers && <Customers permissions={canAny("CUSTOMERS")} />}
            {page === "vehicles" && show.vehicles && <Vehicles permissions={canAny("VEHICLES")} />}

            {page === "jobcards" && show.jobcards && <JobCards permissions={canAny("JOB_CARDS")} />}
            {page === "jobhistory" && show.jobhistory && <JobOrderHistory currentUser={currentUser} />}

            {page === "serviceexecution" && show.serviceexecution && (
              <ServiceExecution permissions={canAny("JOB_CARDS")} currentUser={currentUser} />
            )}

            {page === "paymentinvoices" && show.paymentinvoices && (
              <PaymentInvoiceManagment permissions={canAny("JOB_CARDS")} currentUser={currentUser} />
            )}

            {page === "qualitycheck" && show.qualitycheck && <QualityCheckModule currentUser={currentUser} />}
            {page === "exitpermit" && show.exitpermit && <ExitPermitManagement currentUser={currentUser} />}

            {page === "calltracking" && show.calltracking && <CallTracking permissions={canAny("CALL_TRACKING")} />}
            {page === "inspection" && show.inspection && <InspectionModule permissions={canAny("JOB_CARDS")} />}

            {page === "tickets" && show.tickets && <Tickets permissions={canAny("TICKETS")} />}
            {page === "employees" && show.employees && <Employees permissions={canAny("EMPLOYEES")} />}
            {page === "activitylog" && show.activitylog && <ActivityLog permissions={canAny("ACTIVITY_LOG")} />}

            {page === "users" && showAdmin.users && (
              <Users permissions={{ ...EMPTY, canRead: true, canCreate: true, canUpdate: true, canDelete: true, canApprove: true }} />
            )}
            {page === "departments" && showAdmin.departments && (
              <DepartmentsAdmin permissions={{ ...EMPTY, canRead: true, canCreate: true, canUpdate: true, canDelete: true, canApprove: true }} />
            )}
            {page === "rolespolicies" && showAdmin.rolespolicies && <RolesPoliciesAdmin />}
            {page === "roleaccesscontrol" && showAdmin.roleaccesscontrol && <RoleAccessControl />}
          </main>
        </div>
      </div>
    </ApprovalRequestsProvider>
  );
}