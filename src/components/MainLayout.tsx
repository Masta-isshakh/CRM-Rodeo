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
import InventoryManagement from "../pages/InventoryManagement";
import InternalChat from "../pages/InternalChat";
import EmailInbox from "../pages/EmailInbox";

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
import { useLanguage } from "../i18n/LanguageContext";

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
  | "internalchat"
  | "emailinbox"
  | "users"
  | "departments"
  | "rolespolicies"
  | "inventory";

const EMPTY = {
  canRead: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canApprove: false,
};

type CrudPerm = typeof EMPTY;

const THEME_STORAGE_KEY = "crm.themeMode";

type ThemeMode = "light" | "dark";

function resolveInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

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
  const DESKTOP_BREAKPOINT = 1100;
  const detectDesktop = () =>
    typeof window !== "undefined" ? window.innerWidth >= DESKTOP_BREAKPOINT : true;

  const [page, setPage] = useState<Page>("dashboard");
  const [isDesktop, setIsDesktop] = useState<boolean>(detectDesktop);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(detectDesktop);
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveInitialTheme);

  const { loading, email, isAdminGroup, can, canOption, isModuleEnabled, refresh } = usePermissions();
  const { language, toggleLanguage, t } = useLanguage();
  const canAny = (key: string) => ((can as any)(key) ?? EMPTY) as CrudPerm;

  // ✅ Customer permission resolver (supports both CUSTOMER and CUSTOMERS keys safely)
  const customerPerms = useMemo(
    () => mergePerms(canAny("CUSTOMERS"), canAny("CUSTOMER")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can]
  );

  const go = (p: Page) => {
    setPage(p);
    if (!isDesktop) setSidebarOpen(false);
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
      internalchat: (isAdminGroup || canAny("INTERNAL_CHAT").canRead) && listOn("internalchat", "internalchat_list"),
      emailinbox: (isAdminGroup || canAny("EMAIL_INBOX").canRead) && listOn("emailinbox", "emailinbox_list"),

      // Job ecosystem (policy JOB_CARDS)
      jobcards: jobCardsRead && listOn("joborder", "joborder_list"),
      servicecreation: jobCardsRead && listOn("joborder", "joborder_list"),
      jobhistory: jobCardsRead && listOn("jobhistory", "jobhistory_list"),
      serviceexecution: jobCardsRead && listOn("serviceexec", "serviceexec_list"),
      paymentinvoices: jobCardsRead && listOn("payment", "payment_list"),
      qualitycheck: jobCardsRead && listOn("qualitycheck", "qualitycheck_list"),
      exitpermit: jobCardsRead && listOn("exitpermit", "exitpermit_list"),
      inspection: jobCardsRead && listOn("inspection", "inspection_list"),
      inventory: (isAdminGroup || canAny("INVENTORY").canRead) && listOn("inventory", "inventory_list"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminGroup, can, canOption, customerPerms]);

  const showAdmin = useMemo(() => {
    const usersModuleEnabled = isModuleEnabled("users", true);
    const usersListAllowed = canOption("users", "users_list", true);
    const usersRead = isAdminGroup || (usersModuleEnabled && usersListAllowed);

    const departmentsModuleEnabled = isModuleEnabled("departments", true);
    const departmentsListAllowed = canOption("departments", "departments_list", true);
    const departmentsRead = isAdminGroup || (departmentsModuleEnabled && departmentsListAllowed);

    const rolesRead = isAdminGroup || canAny("ROLES_POLICIES_ADMIN").canRead;

    return {
      users: usersRead,
      departments: departmentsRead,
      rolespolicies: rolesRead && listOn("rolespolicies", "rolespolicies_list"),
    };
  }, [isAdminGroup, can, canOption, isModuleEnabled]);

  const nothingVisible =
    !loading &&
    !show.dashboard &&
    !show.customers &&
    !show.vehicles &&
    !show.tickets &&
    !show.employees &&
    !show.activitylog &&
    !show.calltracking &&
    !show.internalchat &&
    !show.emailinbox &&
    !show.jobcards &&
    !show.servicecreation &&
    !show.jobhistory &&
    !show.serviceexecution &&
    !show.paymentinvoices &&
    !show.qualitycheck &&
    !show.exitpermit &&
    !show.inspection &&
    !show.inventory &&
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
    if (show.internalchat) allowedPages.push("internalchat");
    if (show.emailinbox) allowedPages.push("emailinbox");
    if (show.inventory) allowedPages.push("inventory");

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
      (page === "internalchat" && show.internalchat) ||
      (page === "emailinbox" && show.emailinbox) ||
      (page === "inventory" && show.inventory) ||
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
    const handleResize = () => {
      const nextDesktop = detectDesktop();
      setIsDesktop(nextDesktop);
      setSidebarOpen(nextDesktop);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isDesktop) setSidebarOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isDesktop]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    if (!isDesktop && sidebarOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = prev || "";
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [isDesktop, sidebarOpen]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
    document.body.setAttribute("data-theme", themeMode);
    document.documentElement.style.colorScheme = themeMode;

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // ignore storage failures
    }
  }, [themeMode]);

  const toggleThemeMode = () => {
    setThemeMode((current) => (current === "dark" ? "light" : "dark"));
  };

  const title = t("Rodeo Drive CRM");

  const pageTitleByKey: Record<Page, string> = {
    dashboard: t("Dashboard"),
    customers: t("Customers"),
    vehicles: t("Vehicles"),
    tickets: t("Tickets"),
    employees: t("Employees"),
    activitylog: t("Activity Log"),
    jobcards: t("Job Cards"),
    servicecreation: t("Service Creation"),
    jobhistory: t("Job History"),
    serviceexecution: t("Service Execution"),
    paymentinvoices: t("Payment & Invoices"),
    qualitycheck: t("Quality Check"),
    exitpermit: t("Exit Permit"),
    calltracking: t("Call Tracking"),
    internalchat: t("Internal Chat"),
    emailinbox: t("Email Inbox"),
    inventory: t("Inventory"),
    inspection: t("Inspection"),
    users: t("User Management"),
    departments: t("Departments"),
    rolespolicies: t("Roles & Policies"),
  };

  const activePageTitle = pageTitleByKey[page] ?? t("Workspace");

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
      <div className={`layout-root ${isDesktop ? "desktop-sidebar" : "mobile-sidebar"} ${themeMode === "dark" ? "theme-dark" : "theme-light"}`}>
        <div className={`drawer-overlay ${!isDesktop && sidebarOpen ? "show" : ""}`} onClick={() => setSidebarOpen(false)} />

        <aside className={`drawer ${isDesktop || sidebarOpen ? "open" : ""}`} aria-hidden={!isDesktop && !sidebarOpen}>
          <div className="drawer-head">
            <div className="drawer-brand">
              <img src={logo} alt={t("Rodeo Drive CRM Logo")} className="brand-logo" />
              <div className="brand-text">
                <div className="brand-title">{t("Rodeo Drive")}</div>
                <div className="brand-sub">{t("CRM Console")}</div>
              </div>
            </div>

            <button className="drawer-close" onClick={() => setSidebarOpen(false)} aria-label={t("Close menu")}>
              ✕
            </button>
          </div>

          <nav className="drawer-nav">
            {show.dashboard && (
              <button className={page === "dashboard" ? "active" : ""} onClick={() => go("dashboard")}>
                <i className="fas fa-chart-line" aria-hidden="true" /> {t("Dashboard")}
              </button>
            )}

            {show.customers && (
              <button className={page === "customers" ? "active" : ""} onClick={() => go("customers")}>
                <i className="fas fa-users" aria-hidden="true" /> {t("Customers")}
              </button>
            )}

            {show.vehicles && (
              <button className={page === "vehicles" ? "active" : ""} onClick={() => go("vehicles")}>
                <i className="fas fa-car" aria-hidden="true" /> {t("Vehicles")}
              </button>
            )}

            {show.jobcards && (
              <button className={page === "jobcards" ? "active" : ""} onClick={() => go("jobcards")}>
                <i className="fas fa-tools" aria-hidden="true" /> {t("Job Cards")}
              </button>
            )}

            {show.servicecreation && (
              <button className={page === "servicecreation" ? "active" : ""} onClick={() => go("servicecreation")}>
                <i className="fas fa-plus-circle" aria-hidden="true" /> {t("Service Creation")}
              </button>
            )}

            {show.jobhistory && (
              <button className={page === "jobhistory" ? "active" : ""} onClick={() => go("jobhistory")}>
                <i className="fas fa-history" aria-hidden="true" /> {t("Job History")}
              </button>
            )}

            {show.serviceexecution && (
              <button className={page === "serviceexecution" ? "active" : ""} onClick={() => go("serviceexecution")}>
                <i className="fas fa-clipboard-check" aria-hidden="true" /> {t("Service Execution")}
              </button>
            )}

            {show.paymentinvoices && (
              <button className={page === "paymentinvoices" ? "active" : ""} onClick={() => go("paymentinvoices")}>
                <i className="fas fa-file-invoice-dollar" aria-hidden="true" /> {t("Payment & Invoices")}
              </button>
            )}

            {show.qualitycheck && (
              <button className={page === "qualitycheck" ? "active" : ""} onClick={() => go("qualitycheck")}>
                <i className="fas fa-check-double" aria-hidden="true" /> {t("Quality Check")}
              </button>
            )}

            {show.exitpermit && (
              <button className={page === "exitpermit" ? "active" : ""} onClick={() => go("exitpermit")}>
                <i className="fas fa-id-card" aria-hidden="true" /> {t("Exit Permit")}
              </button>
            )}

            {show.calltracking && (
              <button className={page === "calltracking" ? "active" : ""} onClick={() => go("calltracking")}>
                <i className="fas fa-phone-alt" aria-hidden="true" /> {t("Call Tracking")}
              </button>
            )}

            {show.internalchat && (
              <button className={page === "internalchat" ? "active" : ""} onClick={() => go("internalchat")}>
                <i className="fas fa-comments" aria-hidden="true" /> {t("Internal Chat")}
              </button>
            )}

            {show.emailinbox && (
              <button className={page === "emailinbox" ? "active" : ""} onClick={() => go("emailinbox")}>
                <i className="fas fa-envelope-open-text" aria-hidden="true" /> {t("Email Inbox")}
              </button>
            )}

            {show.inspection && (
              <button className={page === "inspection" ? "active" : ""} onClick={() => go("inspection")}>
                <i className="fas fa-search" aria-hidden="true" /> {t("Inspection")}
              </button>
            )}

            {show.tickets && (
              <button className={page === "tickets" ? "active" : ""} onClick={() => go("tickets")}>
                <i className="fas fa-ticket-alt" aria-hidden="true" /> {t("Tickets")}
              </button>
            )}

            {show.employees && (
              <button className={page === "employees" ? "active" : ""} onClick={() => go("employees")}>
                <i className="fas fa-user-tie" aria-hidden="true" /> {t("Employees")}
              </button>
            )}

            {show.inventory && (
              <button className={page === "inventory" ? "active" : ""} onClick={() => go("inventory")}>
                <i className="fas fa-boxes-stacked" aria-hidden="true" /> {t("Inventory")}
              </button>
            )}

            {show.activitylog && (
              <button className={page === "activitylog" ? "active" : ""} onClick={() => go("activitylog")}>
                <i className="fas fa-stream" aria-hidden="true" /> {t("Activity Log")}
              </button>
            )}

            {(showAdmin.users || showAdmin.departments || showAdmin.rolespolicies) && (
              <div className="drawer-section">
                <div className="drawer-section-label">{t("Admin")}</div>

                {showAdmin.users && (
                  <button className={page === "users" ? "active" : ""} onClick={() => go("users")}>
                    <i className="fas fa-user-cog" aria-hidden="true" /> {t("Users")}
                  </button>
                )}
                {showAdmin.departments && (
                  <button className={page === "departments" ? "active" : ""} onClick={() => go("departments")}>
                    <i className="fas fa-sitemap" aria-hidden="true" /> {t("Departments")}
                  </button>
                )}
                {showAdmin.rolespolicies && (
                  <button className={page === "rolespolicies" ? "active" : ""} onClick={() => go("rolespolicies")}>
                    <i className="fas fa-shield-alt" aria-hidden="true" /> {t("Roles & Policies")}
                  </button>
                )}

              </div>
            )}

            <div className="drawer-section drawer-theme-section">
              <div className="drawer-section-label">{t("Appearance")}</div>
              <button
                className="drawer-theme-toggle"
                onClick={toggleThemeMode}
                type="button"
                aria-pressed={themeMode === "dark"}
                aria-label={themeMode === "dark" ? t("Switch to light mode") : t("Switch to dark mode")}
              >
                <i className={`fas ${themeMode === "dark" ? "fa-sun" : "fa-moon"}`} aria-hidden="true" />
                <span>{themeMode === "dark" ? t("Light Mode") : t("Dark Mode")}</span>
              </button>
            </div>

            <div className="drawer-spacer" />

            <button className="danger" onClick={signOut}>
              <i className="fas fa-sign-out-alt" aria-hidden="true" /> {t("Sign out")}
            </button>
          </nav>
        </aside>

        <div className="layout-main">
          <header className="topbar">
            <div className="topbar-inner">
              <button className="menu-toggle" onClick={() => setSidebarOpen(true)} aria-label={t("Open menu")} type="button">
                <span className="menu-toggle-icon" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              </button>

              <div className="topbar-center">
                <div className="topbar-kicker">
                  <span className="topbar-chip">{t("CRM Console")}</span>
                  <span className="topbar-page">{activePageTitle}</span>
                </div>
                <div className="topbar-title">{title}</div>
                <div className="topbar-sub">{loading ? t("Loading...") : `${t("Signed in as:")} ${email || "-"}`}</div>
              </div>

              <div className="topbar-right">
                <button className="lang-toggle" onClick={toggleLanguage} type="button" aria-label={t("Toggle language")}>
                  {language === "en" ? "AR" : "EN"}
                </button>
                <div className="topbar-user" title={email || ""}>
                  <div className="topbar-user-meta">
                    <div className="topbar-user-name">{(email || t("User")).split("@")[0]}</div>
                    <div className="topbar-user-role">{t("Active Session")}</div>
                  </div>
                  <div className="avatar">
                    {initials}
                  </div>
                </div>
              </div>
            </div>
          </header>

          <main className="content">
            {nothingVisible && (
              <div className="no-access">
                <h3>{t("No access configured")}</h3>
                <p>
                  {t(
                    "You are signed in, but no department -> role -> policy permissions were resolved for your account. Ask an Admin to assign a Department role + Role policies."
                  )}
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

            {page === "internalchat" && show.internalchat && (
              <PermissionGate moduleId="internalchat" optionId="internalchat_list">
                <InternalChat permissions={canAny("INTERNAL_CHAT")} />
              </PermissionGate>
            )}

            {page === "emailinbox" && show.emailinbox && (
              <PermissionGate moduleId="emailinbox" optionId="emailinbox_list">
                <EmailInbox />
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
            {page === "inventory" && show.inventory && (
              <PermissionGate moduleId="inventory" optionId="inventory_list">
                <InventoryManagement permissions={canAny("INVENTORY")} />
              </PermissionGate>
            )}

            {page === "activitylog" && show.activitylog && (
              <PermissionGate moduleId="activitylog" optionId="activitylog_list">
                <ActivityLog permissions={canAny("ACTIVITY_LOG")} />
              </PermissionGate>
            )}

            {page === "users" && showAdmin.users && (
              <Users permissions={canAny("USERS_ADMIN")} />
            )}
            {page === "departments" && showAdmin.departments && (
              <DepartmentsAdmin
                permissions={{
                  ...canAny("DEPARTMENTS_ADMIN"),
                  canRead: canOption("departments", "departments_list", true),
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