// src/layout/MainLayout.tsx
import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";

const loadDashboard = () => import("../pages/Dashboard");
const loadCustomers = () => import("../pages/Customer");
const loadVehicles = () => import("../pages/Vehicule");
const loadTickets = () => import("../pages/Tickets");
const loadEmployees = () => import("../pages/Employees");
const loadActivityLog = () => import("../pages/ActivityLogs");

const loadJobCards = () => import("../pages/JobCards");
const loadServiceCreation = () => import("../pages/ServiceCreation");
const loadCallTracking = () => import("../pages/CallTracking");
const loadServiceExecution = () => import("../pages/ServiceExecutionModule");
const loadUsers = () => import("../pages/UserAdmin");
const loadDepartmentsAdmin = () => import("../pages/DepartmentsAdmin");
const loadRolesPoliciesAdmin = () => import("../pages/RolesPoliciesAdmin");
const loadInventoryManagement = () => import("../pages/InventoryManagement");
const loadCampaignAudienceAdmin = () => import("../pages/CampaignAudienceAdmin.tsx");
const loadInternalChat = () => import("../pages/InternalMessaging");
const loadEmailInbox = () => import("../pages/EmailInboxPage");

const loadJobOrderHistory = () => import("../pages/JobOrderHistory");
const loadQualityCheckModule = () => import("../pages/QualityCheckModule");
const loadExitPermitManagement = () => import("../pages/ExitPermitManagement");

const loadInspectionModule = () => import("../pages/InspectionModule");
const loadPaymentInvoiceManagment = () => import("../pages/PaymentInvoiceManagment");
const loadDatabaseCleanup = () => import("../pages/DatabaseCleanupAdmin");

const Dashboard = lazy(loadDashboard);
const Customers = lazy(loadCustomers);
const Vehicles = lazy(loadVehicles);
const Tickets = lazy(loadTickets);
const Employees = lazy(loadEmployees);
const ActivityLog = lazy(loadActivityLog);

const JobCards = lazy(loadJobCards);
const ServiceCreation = lazy(loadServiceCreation);
const CallTracking = lazy(loadCallTracking);
const ServiceExecution = lazy(loadServiceExecution);
const Users = lazy(loadUsers);
const DepartmentsAdmin = lazy(loadDepartmentsAdmin);
const RolesPoliciesAdmin = lazy(loadRolesPoliciesAdmin);
const InventoryManagement = lazy(loadInventoryManagement);
const CampaignAudienceAdmin = lazy(loadCampaignAudienceAdmin);
const InternalChat = lazy(loadInternalChat);
const EmailInbox = lazy(loadEmailInbox);

const JobOrderHistory = lazy(loadJobOrderHistory);
const QualityCheckModule = lazy(loadQualityCheckModule);
const ExitPermitManagement = lazy(loadExitPermitManagement);

const InspectionModule = lazy(loadInspectionModule);
const PaymentInvoiceManagment = lazy(loadPaymentInvoiceManagment);
const DatabaseCleanupAdmin = lazy(loadDatabaseCleanup);
import PermissionGate from "../pages/PermissionGate";


import logo from "../assets/logo.jpeg";
import "./mainLayout.css";

import { usePermissions } from "../lib/userPermissions";
import { ApprovalRequestsProvider } from "../pages/ApprovalRequestsContext";
import { useLanguage } from "../i18n/LanguageContext";
import { getDataClient } from "../lib/amplifyClient";

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
    | "inventory"
    | "campaignaudience"
    | "dbcleanup";

const PAGE_LOADERS: Record<Page, () => Promise<unknown>> = {
  dashboard: loadDashboard,
  customers: loadCustomers,
  vehicles: loadVehicles,
  tickets: loadTickets,
  employees: loadEmployees,
  activitylog: loadActivityLog,
  jobcards: loadJobCards,
  servicecreation: loadServiceCreation,
  jobhistory: loadJobOrderHistory,
  serviceexecution: loadServiceExecution,
  paymentinvoices: loadPaymentInvoiceManagment,
  qualitycheck: loadQualityCheckModule,
  exitpermit: loadExitPermitManagement,
  calltracking: loadCallTracking,
  inspection: loadInspectionModule,
  internalchat: loadInternalChat,
  emailinbox: loadEmailInbox,
  users: loadUsers,
  departments: loadDepartmentsAdmin,
  rolespolicies: loadRolesPoliciesAdmin,
  inventory: loadInventoryManagement,
  campaignaudience: loadCampaignAudienceAdmin,
  dbcleanup: loadDatabaseCleanup,
};

const EMPTY = {
  canRead: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canApprove: false,
};

class LocalPageErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[local-page-error-boundary]", error, info);
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

type CrudPerm = typeof EMPTY;

const THEME_STORAGE_KEY = "crm.themeMode";
const CHAT_LAST_SEEN_STORAGE_PREFIX = "crm.chat.lastSeen.";
const WORKMAIL_URL = String(import.meta.env.VITE_WORKMAIL_URL ?? "https://rodeodrive.awsapps.com/mail").trim();

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
  const [navigationData, setNavigationData] = useState<any>(null);
  const [isDesktop, setIsDesktop] = useState<boolean>(detectDesktop);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(detectDesktop);
  const [themeMode, setThemeMode] = useState<ThemeMode>(resolveInitialTheme);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const prefetchedPagesRef = useRef<Set<Page>>(new Set());

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
    setNavigationData(null);
    if (!isDesktop) setSidebarOpen(false);
  };

  const openEmailInbox = useCallback(() => {
    if (!WORKMAIL_URL) return;
    window.location.assign(WORKMAIL_URL);
  }, []);

  const handleModuleNavigate = useCallback(
    (moduleName: string, payload?: any) => {
      const normalized = String(moduleName ?? "").trim().toLowerCase();
      let targetPage: Page | null = null;

      if (normalized === "job order management" || normalized === "jobcards") {
        targetPage = "jobcards";
      } else if (normalized === "vehicles management" || normalized === "vehicles") {
        targetPage = "vehicles";
      }

      if (!targetPage) return;
      setNavigationData(payload ?? null);
      setPage(targetPage);
      if (!isDesktop) setSidebarOpen(false);
    },
    [isDesktop]
  );

  const clearNavigationData = useCallback(() => {
    setNavigationData(null);
  }, []);

  const handleNavigateBack = useCallback(
    (source: string, returnId?: string | null) => {
      const normalized = String(source ?? "").trim().toLowerCase();
      if (normalized === "vehicles management" || normalized === "vehicles") {
        setNavigationData(returnId ? { openDetails: true, vehicleId: returnId } : null);
        setPage("vehicles");
        if (!isDesktop) setSidebarOpen(false);
        return;
      }
      setNavigationData(null);
    },
    [isDesktop]
  );

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
      campaignaudience: isAdminGroup,
      dbcleanup: isAdminGroup,
    };
  }, [isAdminGroup, can, canOption, isModuleEnabled]);

  const visiblePages = useMemo(() => {
    const pages: Page[] = [];
    if (show.dashboard) pages.push("dashboard");
    if (show.customers) pages.push("customers");
    if (show.vehicles) pages.push("vehicles");
    if (show.jobcards) pages.push("jobcards");
    if (show.servicecreation) pages.push("servicecreation");
    if (show.jobhistory) pages.push("jobhistory");
    if (show.serviceexecution) pages.push("serviceexecution");
    if (show.paymentinvoices) pages.push("paymentinvoices");
    if (show.qualitycheck) pages.push("qualitycheck");
    if (show.exitpermit) pages.push("exitpermit");
    if (show.inspection) pages.push("inspection");
    if (show.calltracking) pages.push("calltracking");
    if (show.tickets) pages.push("tickets");
    if (show.employees) pages.push("employees");
    if (show.activitylog) pages.push("activitylog");
    if (show.internalchat) pages.push("internalchat");
    if (show.emailinbox) pages.push("emailinbox");
    if (show.inventory) pages.push("inventory");
    if (showAdmin.users) pages.push("users");
    if (showAdmin.departments) pages.push("departments");
    if (showAdmin.rolespolicies) pages.push("rolespolicies");
    if (showAdmin.campaignaudience) pages.push("campaignaudience");
    if (showAdmin.dbcleanup) pages.push("dbcleanup");
    return pages;
  }, [show, showAdmin]);

  const prefetchPage = useCallback((target: Page) => {
    if (prefetchedPagesRef.current.has(target)) return;

    const connection = (navigator as any)?.connection;
    const saveData = Boolean(connection?.saveData);
    const slowConn =
      connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g";
    if (saveData || slowConn) return;

    const loader = PAGE_LOADERS[target];
    if (!loader) return;

    prefetchedPagesRef.current.add(target);
    void loader();
  }, []);

  useEffect(() => {
    const toPrefetch = visiblePages.filter((p) => p !== page).slice(0, 3);
    if (toPrefetch.length === 0) return;

    const idle = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;

    if (idle) {
      const id = idle(() => {
        for (const p of toPrefetch) prefetchPage(p);
      }, { timeout: 1500 });
      return () => {
        const cancelIdle = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;
        cancelIdle?.(id);
      };
    }

    const timer = window.setTimeout(() => {
      for (const p of toPrefetch) prefetchPage(p);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [page, prefetchPage, visiblePages]);

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
    !showAdmin.rolespolicies &&
    !showAdmin.campaignaudience &&
    !showAdmin.dbcleanup;

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
    if (showAdmin.campaignaudience) allowedPages.push("campaignaudience");
    if (showAdmin.dbcleanup) allowedPages.push("dbcleanup");

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
      (page === "rolespolicies" && showAdmin.rolespolicies) ||
      (page === "campaignaudience" && showAdmin.campaignaudience) ||
      (page === "dbcleanup" && showAdmin.dbcleanup);

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
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    if (!normalizedEmail || !show.internalchat || page === "internalchat") {
      setUnreadChatCount(0);
      return;
    }

    let cancelled = false;
    const client = getDataClient();
    const chatModel = (client.models as any).InternalChatMessage as any;
    const seenKey = `${CHAT_LAST_SEEN_STORAGE_PREFIX}${normalizedEmail}`;

    if (!chatModel) {
      setUnreadChatCount(0);
      return;
    }

    const refreshUnreadCount = async () => {
      try {
        let seenAt = 0;
        try {
          const raw = window.localStorage.getItem(seenKey);
          const parsed = raw ? Date.parse(raw) : NaN;
          seenAt = Number.isFinite(parsed) ? parsed : 0;
        } catch {
          seenAt = 0;
        }

        const minIso = seenAt > 0 ? new Date(seenAt).toISOString() : undefined;
        const res = await chatModel.list({
          limit: 500,
          filter: minIso ? { createdAt: { gt: minIso } } : undefined,
        });
        const rows = (res?.data ?? []) as Array<Record<string, any>>;
        const unread = rows.filter((row) => {
          const senderEmail = String(row?.senderEmail ?? "").trim().toLowerCase();
          if (!senderEmail || senderEmail === normalizedEmail) return false;

          const conversationKey = String(row?.conversationKey ?? "").trim().toLowerCase();
          const forUser =
            conversationKey === "global:all" ||
            (conversationKey.startsWith("direct:") && conversationKey.includes(normalizedEmail));
          if (!forUser) return false;

          const createdAt = Date.parse(String(row?.createdAt ?? ""));
          if (!Number.isFinite(createdAt)) return false;
          return createdAt > seenAt;
        }).length;

        if (!cancelled) setUnreadChatCount(unread);
      } catch {
        if (!cancelled) setUnreadChatCount(0);
      }
    };

    void refreshUnreadCount();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void refreshUnreadCount();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [email, page, show.internalchat]);

  useEffect(() => {
    if (page !== "internalchat") return;
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    if (!normalizedEmail) return;

    try {
      window.localStorage.setItem(`${CHAT_LAST_SEEN_STORAGE_PREFIX}${normalizedEmail}`, new Date().toISOString());
    } catch {
      // ignore storage issues
    }
    setUnreadChatCount(0);
  }, [page, email]);

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
    campaignaudience: t("Campaign Audience"),
    dbcleanup: t("Database Cleanup"),
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
                {unreadChatCount > 0 && (
                  <span className="drawer-chat-badge" aria-label={`${unreadChatCount} unread chat messages`}>
                    {unreadChatCount > 99 ? "99+" : unreadChatCount}
                  </span>
                )}
              </button>
            )}

            {show.emailinbox && (
              <button className={page === "emailinbox" ? "active" : ""} onClick={openEmailInbox}>
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

            {(showAdmin.users || showAdmin.departments || showAdmin.rolespolicies || showAdmin.campaignaudience || showAdmin.dbcleanup) && (
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
                {showAdmin.campaignaudience && (
                  <button className={page === "campaignaudience" ? "active" : ""} onClick={() => go("campaignaudience")}>
                    <i className="fas fa-bullhorn" aria-hidden="true" /> {t("Campaign Audience")}
                  </button>
                )}
                {showAdmin.dbcleanup && (
                  <button className={page === "dbcleanup" ? "active" : ""} onClick={() => go("dbcleanup")}>
                    <i className="fas fa-trash-alt" aria-hidden="true" /> {t("Database Cleanup")}
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
            <Suspense fallback={<div className="no-access"><h3>{t("Loading...")}</h3></div>}>
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
                <Vehicles
                  permissions={canAny("VEHICLES")}
                  navigationData={navigationData}
                  onClearNavigation={clearNavigationData}
                  onNavigate={handleModuleNavigate}
                  onNavigateBack={handleNavigateBack}
                />
              </PermissionGate>
            )}

            {page === "jobcards" && show.jobcards && (
              <PermissionGate moduleId="joborder" optionId="joborder_list">
                <JobCards
                  permissions={canAny("JOB_CARDS")}
                  currentUser={currentUser}
                  navigationData={navigationData}
                  onClearNavigation={clearNavigationData}
                  onNavigateBack={handleNavigateBack}
                />
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
                <LocalPageErrorBoundary
                  fallback={<div className="no-access"><h3>{t("Internal Chat is temporarily unavailable.")}</h3></div>}
                >
                  <InternalChat permissions={canAny("INTERNAL_CHAT")} />
                </LocalPageErrorBoundary>
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
            {page === "campaignaudience" && showAdmin.campaignaudience && (
              <CampaignAudienceAdmin />
            )}
            {page === "dbcleanup" && showAdmin.dbcleanup && (
              <DatabaseCleanupAdmin />
            )}
            </Suspense>
          </main>
        </div>
      </div>
    </ApprovalRequestsProvider>
  );
}