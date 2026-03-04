// src/layout/MainLayout.tsx
import { useEffect, useMemo, useState } from "react";

import Dashboard from "../pages/Dashboard";
import Customers from "../pages/Customer";
import Vehicles from "../pages/Vehicule";
import Tickets from "../pages/Tickets";
import Employees from "../pages/Employees";
import ActivityLog from "../pages/ActivityLogs";

import JobCards from "../pages/JobCards";
import ServiceCreation from "../pages/ServiceCreation";
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
import PermissionGate from "../pages/PermissionGate";


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
  | "servicecreation"
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

const EMPTY = {
  canRead: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canApprove: false,
};

type CrudPerm = typeof EMPTY;

function mergePerms(...items: CrudPerm[]): CrudPerm {
  return {
    canRead: items.some((p) => !!p?.canRead),
    canCreate: items.some((p) => !!p?.canCreate),
    canUpdate: items.some((p) => !!p?.canUpdate),
    canDelete: items.some((p) => !!p?.canDelete),
    canApprove: items.some((p) => !!p?.canApprove),
  };
}

export default function MainLayout({ signOut }: { signOut: () => void }) {
  const [page, setPage] = useState<Page>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { loading, email, isAdminGroup, can, canOption, refresh } = usePermissions();
  const canAny = (key: string) => ((can as any)(key) ?? EMPTY) as CrudPerm;

  // ✅ Customer permission resolver (supports both CUSTOMER and CUSTOMERS keys safely)
  const customerPerms = useMemo(
    () => mergePerms(canAny("CUSTOMERS"), canAny("CUSTOMER")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can]
  );

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

      // ✅ Customers now uses normalized customerPerms
      customers: (isAdminGroup || customerPerms.canRead) && listOn("customers", "customers_list"),

      vehicles: (isAdminGroup || canAny("VEHICLES").canRead) && listOn("vehicles", "vehicles_list"),
      tickets: (isAdminGroup || canAny("TICKETS").canRead) && listOn("tickets", "tickets_list"),
      employees: (isAdminGroup || canAny("EMPLOYEES").canRead) && listOn("employees", "employees_list"),
      activitylog: (isAdminGroup || canAny("ACTIVITY_LOG").canRead) && listOn("activitylog", "activitylog_list"),
      calltracking: (isAdminGroup || canAny("CALL_TRACKING").canRead) && listOn("calltracking", "calltracking_list"),

      // Job ecosystem (policy JOB_CARDS)
      jobcards: jobCardsRead && listOn("joborder", "joborder_list"),
      servicecreation: jobCardsRead && listOn("joborder", "joborder_list"),
      jobhistory: jobCardsRead && listOn("jobhistory", "jobhistory_list"),
      serviceexecution: jobCardsRead && listOn("serviceexec", "serviceexec_list"),
      paymentinvoices: jobCardsRead && listOn("payment", "payment_list"),
      qualitycheck: jobCardsRead && listOn("qualitycheck", "qualitycheck_list"),
      exitpermit: jobCardsRead && listOn("exitpermit", "exitpermit_list"),
      inspection: jobCardsRead && listOn("inspection", "inspection_list"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminGroup, can, canOption, customerPerms]);

  const showAdmin = useMemo(() => {
    const usersListAllowed = canOption("users", "users_list", true);
    const usersViewAllowed = canOption("users", "users_view", true);
    const usersRead = isAdminGroup || canAny("USERS_ADMIN").canRead || usersListAllowed || usersViewAllowed;
    const departmentsListAllowed = canOption("departments", "departments_list", true);
    const departmentsRead = isAdminGroup || canAny("DEPARTMENTS_ADMIN").canRead || departmentsListAllowed;
    const rolesRead = isAdminGroup || canAny("ROLES_POLICIES_ADMIN").canRead;

    return {
      users: usersRead,
      departments: departmentsRead,
      rolespolicies: rolesRead && listOn("rolespolicies", "rolespolicies_list"),
    };
  }, [isAdminGroup, can, canOption]);

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
    !show.servicecreation &&
    !show.jobhistory &&
    !show.serviceexecution &&
    !show.paymentinvoices &&
    !show.qualitycheck &&
    !show.exitpermit &&
    !show.inspection &&
    !showAdmin.users &&
    !showAdmin.departments &&
    !showAdmin.rolespolicies;

  useEffect(() => {
    if (loading) return;

    const allowedPages: Page[] = [];
    if (show.dashboard) allowedPages.push("dashboard");
    if (show.customers) allowedPages.push("customers");
    if (show.vehicles) allowedPages.push("vehicles");
    if (show.jobcards) allowedPages.push("jobcards");
    if (show.servicecreation) allowedPages.push("servicecreation");
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

    const isCurrentAllowed =
      (page === "dashboard" && show.dashboard) ||
      (page === "customers" && show.customers) ||
      (page === "vehicles" && show.vehicles) ||
      (page === "jobcards" && show.jobcards) ||
      (page === "servicecreation" && show.servicecreation) ||
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
      (page === "rolespolicies" && showAdmin.rolespolicies);

    if (!isCurrentAllowed) {
      setPage(allowedPages[0] ?? "dashboard");
    }
  }, [loading, page, show, showAdmin]);

  useEffect(() => {
    if (page === "users" || page === "departments") {
      refresh();
    }
  }, [page, refresh]);

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

            {show.servicecreation && (
              <button className={page === "servicecreation" ? "active" : ""} onClick={() => go("servicecreation")}>
                Service Creation
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

            {(showAdmin.users || showAdmin.departments || showAdmin.rolespolicies) && (
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
              <PermissionGate moduleId="dashboard" optionId="dashboard_list">
                <Dashboard
                  permissions={canAny("DASHBOARD")}
                  email={email}
                  visibility={{ ...show, admin: showAdmin }}
                  onNavigate={(p: Page) => setPage(p)}
                />
              </PermissionGate>
            )}

            {/* ✅ Customers uses normalized customer perms */}
            {page === "customers" && show.customers && (
              <PermissionGate moduleId="customers" optionId="customers_list">
                <Customers permissions={customerPerms} />
              </PermissionGate>
            )}

            {page === "vehicles" && show.vehicles && (
              <PermissionGate moduleId="vehicles" optionId="vehicles_list">
                <Vehicles permissions={canAny("VEHICLES")} />
              </PermissionGate>
            )}

            {page === "jobcards" && show.jobcards && (
              <PermissionGate moduleId="joborder" optionId="joborder_list">
                <JobCards permissions={canAny("JOB_CARDS")} currentUser={currentUser} />
              </PermissionGate>
            )}
            {page === "servicecreation" && show.servicecreation && (
              <PermissionGate moduleId="joborder" optionId="joborder_list">
                <ServiceCreation />
              </PermissionGate>
            )}
            {page === "jobhistory" && show.jobhistory && (
              <PermissionGate moduleId="jobhistory" optionId="jobhistory_list">
                <JobOrderHistory currentUser={currentUser} />
              </PermissionGate>
            )}

            {page === "serviceexecution" && show.serviceexecution && (
              <PermissionGate moduleId="serviceexec" optionId="serviceexec_list">
                <ServiceExecution permissions={canAny("JOB_CARDS")} currentUser={currentUser} />
              </PermissionGate>
            )}

            {page === "paymentinvoices" && show.paymentinvoices && (
              <PermissionGate moduleId="payment" optionId="payment_list">
                <PaymentInvoiceManagment permissions={canAny("JOB_CARDS")} currentUser={currentUser} />
              </PermissionGate>
            )}

            {page === "qualitycheck" && show.qualitycheck && (
              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_list">
                <QualityCheckModule currentUser={currentUser} />
              </PermissionGate>
            )}
            {page === "exitpermit" && show.exitpermit && (
              <PermissionGate moduleId="exitpermit" optionId="exitpermit_list">
                <ExitPermitManagement currentUser={currentUser} />
              </PermissionGate>
            )}

            {page === "calltracking" && show.calltracking && (
              <PermissionGate moduleId="calltracking" optionId="calltracking_list">
                <CallTracking permissions={canAny("CALL_TRACKING")} />
              </PermissionGate>
            )}
            {page === "inspection" && show.inspection && (
              <PermissionGate moduleId="inspection" optionId="inspection_list">
                <InspectionModule permissions={canAny("JOB_CARDS")} currentUser={currentUser} />
              </PermissionGate>
            )}

            {page === "tickets" && show.tickets && (
              <PermissionGate moduleId="tickets" optionId="tickets_list">
                <Tickets permissions={canAny("TICKETS")} />
              </PermissionGate>
            )}
            {page === "employees" && show.employees && (
              <PermissionGate moduleId="employees" optionId="employees_list">
                <Employees permissions={canAny("EMPLOYEES")} />
              </PermissionGate>
            )}
            {page === "activitylog" && show.activitylog && (
              <PermissionGate moduleId="activitylog" optionId="activitylog_list">
                <ActivityLog permissions={canAny("ACTIVITY_LOG")} />
              </PermissionGate>
            )}

            {page === "users" && showAdmin.users && (
              <Users
                permissions={{
                  ...canAny("USERS_ADMIN"),
                  canRead:
                    canAny("USERS_ADMIN").canRead ||
                    canOption("users", "users_list", true) ||
                    canOption("users", "users_view", true),
                }}
              />
            )}
            {page === "departments" && showAdmin.departments && (
              <DepartmentsAdmin
                permissions={{
                  ...canAny("DEPARTMENTS_ADMIN"),
                  canRead: canAny("DEPARTMENTS_ADMIN").canRead || canOption("departments", "departments_list", true),
                }}
              />
            )}
            {page === "rolespolicies" && showAdmin.rolespolicies && (
              <PermissionGate moduleId="rolespolicies" optionId="rolespolicies_list">
                <RolesPoliciesAdmin />
              </PermissionGate>
            )}
          </main>
        </div>
      </div>
    </ApprovalRequestsProvider>
  );
}