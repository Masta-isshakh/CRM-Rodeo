// src/pages/PermissionGate.tsx
import React, { useMemo } from "react";
import { usePermissions, type Permission } from "../lib/userPermissions";

type Props = {
  moduleId: string;
  optionId: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

type PermOp = keyof Permission;

type ResolvedRule = {
  policyKey: string;
  op: PermOp;
  fallbackOps?: PermOp[];
};

// ✅ exported so pages can reuse the same mapping logic if needed
export function resolvePolicyAndOp(moduleId: string, optionId: string): ResolvedRule | null {
  const m = String(moduleId ?? "").toLowerCase().trim();
  const o = String(optionId ?? "").toLowerCase().trim();

  // -----------------------------
  // CUSTOMERS
  // -----------------------------
  if (m === "customers" || m === "customer" || m === "customermanagement") {
    if (
      o === "customers_list" ||
      o === "customers_search" ||
      o === "customers_refresh" ||
      o === "customers_actions" ||
      o === "customers_viewdetails" ||
      o === "customers_details_info" ||
      o === "customers_details_related" ||
      o === "customers_related_contacts" ||
      o === "customers_related_deals" ||
      o === "customers_related_tickets"
    ) {
      return { policyKey: "CUSTOMERS", op: "canRead" };
    }

    if (o === "customers_add" || o === "customers_create") {
      // legacy compatibility: some old roles may only have update on this module
      return { policyKey: "CUSTOMERS", op: "canCreate", fallbackOps: ["canUpdate"] };
    }

    if (o === "customers_edit" || o === "customers_update") {
      return { policyKey: "CUSTOMERS", op: "canUpdate" };
    }

    if (o === "customers_delete" || o === "customers_remove") {
      return { policyKey: "CUSTOMERS", op: "canDelete" };
    }

    return null;
  }

  // DASHBOARD
  if (m === "dashboard") {
    if (
      o === "dashboard_list" ||
      o === "dashboard_kpis" ||
      o === "dashboard_quicknav" ||
      o === "dashboard_revenue" ||
      o === "dashboard_activity" ||
      o === "dashboard_calendar"
    ) {
      return { policyKey: "DASHBOARD", op: "canRead" };
    }
    return null;
  }

  // VEHICLES
  if (m === "vehicles" || m === "vehicle") {
    if (
      o === "vehicles_list" ||
      o === "vehicles_search" ||
      o === "vehicles_viewdetails"
    ) {
      return { policyKey: "VEHICLES", op: "canRead" };
    }
    if (o === "vehicles_add") return { policyKey: "VEHICLES", op: "canCreate", fallbackOps: ["canUpdate"] };
    if (o === "vehicles_edit" || o === "vehicles_verifycustomer") return { policyKey: "VEHICLES", op: "canUpdate" };
    if (o === "vehicles_delete") return { policyKey: "VEHICLES", op: "canDelete" };
    return null;
  }

  // TICKETS
  if (m === "tickets" || m === "ticket") {
    if (o === "tickets_list" || o === "tickets_refresh") return { policyKey: "TICKETS", op: "canRead" };
    if (o === "tickets_create") return { policyKey: "TICKETS", op: "canCreate", fallbackOps: ["canUpdate"] };
    if (o === "tickets_edit") return { policyKey: "TICKETS", op: "canUpdate" };
    if (o === "tickets_delete") return { policyKey: "TICKETS", op: "canDelete" };
    return null;
  }

  // EMPLOYEES
  if (m === "employees" || m === "employee") {
    if (o === "employees_list" || o === "employees_refresh") return { policyKey: "EMPLOYEES", op: "canRead" };
    if (o === "employees_add") return { policyKey: "EMPLOYEES", op: "canCreate", fallbackOps: ["canUpdate"] };
    if (o === "employees_edit") return { policyKey: "EMPLOYEES", op: "canUpdate" };
    if (o === "employees_delete") return { policyKey: "EMPLOYEES", op: "canDelete" };
    return null;
  }

  // ACTIVITY LOG
  if (m === "activitylog" || m === "activity") {
    if (o === "activitylog_list" || o === "activitylog_view") {
      return { policyKey: "ACTIVITY_LOG", op: "canRead" };
    }
    return null;
  }

  // CALL TRACKING
  if (m === "calltracking" || m === "calls") {
    if (o === "calltracking_list" || o === "calltracking_refresh") {
      return { policyKey: "CALL_TRACKING", op: "canRead" };
    }
    if (o === "calltracking_create") return { policyKey: "CALL_TRACKING", op: "canCreate", fallbackOps: ["canUpdate"] };
    if (o === "calltracking_edit") return { policyKey: "CALL_TRACKING", op: "canUpdate" };
    if (o === "calltracking_delete") return { policyKey: "CALL_TRACKING", op: "canDelete" };
    return null;
  }

  // INTERNAL CHAT
  if (m === "internalchat" || m === "chat") {
    if (
      o === "internalchat_list" ||
      o === "internalchat_view" ||
      o === "internalchat_send" ||
      o === "internalchat_direct_message"
    ) {
      return { policyKey: "INTERNAL_CHAT", op: o === "internalchat_send" ? "canCreate" : "canRead", fallbackOps: ["canUpdate"] };
    }
    return null;
  }

  // EMAIL INBOX
  if (m === "emailinbox" || m === "email") {
    if (o === "emailinbox_list" || o === "emailinbox_open") {
      return { policyKey: "EMAIL_INBOX", op: "canRead" };
    }
    return null;
  }

  // JOB ORDERS
  if (m === "joborder" || m === "joborders") {
    if (
      o === "joborder_viewdetails" ||
      o === "joborder_summary" ||
      o === "joborder_customer" ||
      o === "joborder_vehicle" ||
      o === "joborder_services" ||
      o === "joborder_billing" ||
      o === "joborder_paymentlog" ||
      o === "joborder_actions" ||
      o === "joborder_list"
    ) {
      return { policyKey: "JOB_CARDS", op: "canRead" };
    }

    if (o === "joborder_add" || o === "joborder_create") {
      return { policyKey: "JOB_CARDS", op: "canCreate", fallbackOps: ["canUpdate"] };
    }

    if (o === "joborder_cancel") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    if (o === "joborder_addservice") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    if (o === "joborder_serviceprice") return { policyKey: "JOB_CARDS", op: "canRead" };
    if (o === "joborder_servicediscount") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    if (o === "joborder_servicediscount_percent") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    if (o === "joborder_discount_percent") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    return null;
  }

  // QUALITY CHECK
  if (m === "qualitycheck" || m === "qc") {
    if (
      o === "qualitycheck_list" ||
      o === "qualitycheck_actions" ||
      o === "qualitycheck_viewdetails" ||
      o === "qualitycheck_summary" ||
      o === "qualitycheck_customer" ||
      o === "qualitycheck_vehicle" ||
      o === "qualitycheck_services" ||
      o === "qualitycheck_quality" ||
      o === "qualitycheck_roadmap" ||
      o === "qualitycheck_billing" ||
      o === "qualitycheck_paymentlog" ||
      o === "qualitycheck_exitpermit" ||
      o === "qualitycheck_documents" ||
      o === "qualitycheck_notes" ||
      o === "qualitycheck_download"
    ) {
      return { policyKey: "JOB_CARDS", op: "canRead" };
    }

    if (
      o === "qualitycheck_finish" ||
      o === "qualitycheck_approve" ||
      o === "qualitycheck_reject" ||
      o === "qualitycheck_cancel"
    ) {
      return { policyKey: "JOB_CARDS", op: "canUpdate" };
    }

    return null;
  }

  // EXIT PERMIT
  if (m === "exitpermit" || m === "exitpermitmanagement") {
    if (
      o === "exitpermit_list" ||
      o === "exitpermit_actions" ||
      o === "exitpermit_viewdetails" ||
      o === "exitpermit_summary" ||
      o === "exitpermit_customer" ||
      o === "exitpermit_vehicle" ||
      o === "exitpermit_services" ||
      o === "exitpermit_notes" ||
      o === "exitpermit_quality" ||
      o === "exitpermit_billing" ||
      o === "exitpermit_paymentlog" ||
      o === "exitpermit_exitpermit" ||
      o === "exitpermit_documents" ||
      o === "exitpermit_download" ||
      o === "exitpermit_roadmap"
    ) {
      return { policyKey: "JOB_CARDS", op: "canRead" };
    }

    if (o === "exitpermit_create" || o === "exitpermit_cancelorder") {
      return { policyKey: "JOB_CARDS", op: "canUpdate" };
    }

    return null;
  }

  // PAYMENT
  if (m === "payment" || m === "paymentinvoice" || m === "paymentinvoices") {
    if (
      o === "payment_list" ||
      o === "payment_actions" ||
      o === "payment_viewdetails" ||
      o === "payment_summary" ||
      o === "payment_customer" ||
      o === "payment_vehicle" ||
      o === "payment_services" ||
      o === "payment_notes" ||
      o === "payment_quality" ||
      o === "payment_billing" ||
      o === "payment_invoices" ||
      o === "payment_paymentlog" ||
      o === "payment_exitpermit" ||
      o === "payment_documents" ||
      o === "payment_download"
    ) {
      return { policyKey: "JOB_CARDS", op: "canRead" };
    }

    if (
      o === "payment_pay" ||
      o === "payment_discountfield" ||
      o === "payment_generatebill" ||
      o === "payment_cancel" ||
      o === "payment_refund"
    ) {
      return { policyKey: "JOB_CARDS", op: "canUpdate" };
    }

    if (o === "payment_discount_percent" || o === "payment_max_discount_percent") {
      return { policyKey: "JOB_CARDS", op: "canUpdate" };
    }

    return null;
  }

  // SERVICE EXECUTION
  if (m === "serviceexec" || m === "serviceexecution") {
    if (
      o === "serviceexec_list" ||
      o === "serviceexec_actions" ||
      o === "serviceexec_viewdetails" ||
      o === "serviceexec_summary" ||
      o === "serviceexec_roadmap" ||
      o === "serviceexec_customer" ||
      o === "serviceexec_vehicle" ||
      o === "serviceexec_services" ||
      o === "serviceexec_notes" ||
      o === "serviceexec_quality" ||
      o === "serviceexec_billing" ||
      o === "serviceexec_paymentlog" ||
      o === "serviceexec_exitpermit" ||
      o === "serviceexec_documents"
    ) {
      return { policyKey: "JOB_CARDS", op: "canRead" };
    }

    if (
      o === "serviceexec_edit" ||
      o === "serviceexec_update" ||
      o === "serviceexec_finish" ||
      o === "serviceexec_addservice" ||
      o === "serviceexec_cancel"
    ) {
      return { policyKey: "JOB_CARDS", op: "canUpdate" };
    }

    return null;
  }

  // JOB HISTORY
  if (m === "jobhistory" || m === "joborderhistory") {
    if (
      o === "jobhistory_list" ||
      o === "jobhistory_view" ||
      o === "jobhistory_viewdetails" ||
      o === "jobhistory_summary" ||
      o === "jobhistory_customer" ||
      o === "jobhistory_vehicle" ||
      o === "jobhistory_services" ||
      o === "jobhistory_notes" ||
      o === "jobhistory_quality" ||
      o === "jobhistory_billing" ||
      o === "jobhistory_paymentlog" ||
      o === "jobhistory_exitpermit" ||
      o === "jobhistory_documents" ||
      o === "jobhistory_download" ||
      o === "jobhistory_roadmap" ||
      o === "jobhistory_export"
    ) {
      return { policyKey: "JOB_CARDS", op: "canRead" };
    }
    return null;
  }

  // APPROVAL HISTORY
  if (m === "approvalhistory") {
    if (o === "approvalhistory_view") return { policyKey: "JOB_CARDS", op: "canRead" };
    return null;
  }

  // INSPECTION
  if (m === "inspection" || m === "inspectionmodule") {
    if (
      o === "inspection_list" ||
      o === "inspection_summary" ||
      o === "inspection_customer" ||
      o === "inspection_vehicle" ||
      o === "inspection_services" ||
      o === "inspection_billing" ||
      o === "inspection_paymentlog" ||
      o === "inspection_documents" ||
      o === "inspection_exitpermit" ||
      o === "inspection_roadmap" ||
      o === "inspection_quality" ||
      o === "inspection_download" ||
      o === "inspection_viewdetails" ||
      o === "inspection_actions"
    ) {
      return { policyKey: "JOB_CARDS", op: "canRead" };
    }

    if (
      o === "inspection_start" ||
      o === "inspection_resume" ||
      o === "inspection_complete" ||
      o === "inspection_notrequired" ||
      o === "inspection_finish" ||
      o === "inspection_cancel" ||
      o === "inspection_addservice" ||
      o === "inspection_servicediscount" ||
      o === "inspection_discount_percent"
    ) {
      return { policyKey: "JOB_CARDS", op: "canUpdate" };
    }

    if (o === "inspection_serviceprice") return { policyKey: "JOB_CARDS", op: "canRead" };
    return null;
  }

  // USERS ADMIN
  if (m === "users" || m === "useradmin") {
    if (o === "users_list") return { policyKey: "USERS_ADMIN", op: "canRead" };
    if (o === "users_view") return { policyKey: "USERS_ADMIN", op: "canRead" };
    if (o === "users_invite") return { policyKey: "USERS_ADMIN", op: "canCreate", fallbackOps: ["canUpdate"] };
    if (o === "users_edit") return { policyKey: "USERS_ADMIN", op: "canUpdate" };
    if (o === "users_delete") return { policyKey: "USERS_ADMIN", op: "canDelete" };
    return null;
  }

  // DEPARTMENTS ADMIN
  if (m === "departments" || m === "departmentsadmin") {
    if (o === "departments_list") return { policyKey: "DEPARTMENTS_ADMIN", op: "canRead" };
    if (o === "departments_create") return { policyKey: "DEPARTMENTS_ADMIN", op: "canCreate", fallbackOps: ["canUpdate"] };
    if (o === "departments_rename" || o === "departments_assignrole") return { policyKey: "DEPARTMENTS_ADMIN", op: "canUpdate" };
    if (o === "departments_delete") return { policyKey: "DEPARTMENTS_ADMIN", op: "canDelete" };
    return null;
  }

  // ROLES & POLICIES ADMIN
  if (m === "rolespolicies" || m === "roleaccesscontrol") {
    if (o === "rolespolicies_list") return { policyKey: "ROLES_POLICIES_ADMIN", op: "canRead" };
    return null;
  }

  // ADMIN - Inspection config
  if (m === "admin" && o === "inspection_config_admin") {
    return { policyKey: "INSPECTION_APPROVALS", op: "canUpdate", fallbackOps: ["canRead"] };
  }

  return null;
}

export default function PermissionGate({
  moduleId,
  optionId,
  children,
  fallback = null,
}: Props) {
  const {
    can,
    canOption,
    hasOptionToggle,
    loading,
    isAdminGroup,
  } = usePermissions();

  const rule = useMemo(() => resolvePolicyAndOp(moduleId, optionId), [moduleId, optionId]);

  if (loading) return null;
  if (isAdminGroup) return <>{children}</>;

  // 1) Option-level check (includes module enabled gate)
  const optionAllowed = canOption(moduleId, optionId, true);
  if (!optionAllowed) return <>{fallback}</>;

  const normalizedModule = String(moduleId ?? "").toLowerCase().trim();
  const normalizedOption = String(optionId ?? "").toLowerCase().trim();
  const optionAuthoritative =
    (normalizedModule === "users" || normalizedModule === "useradmin") &&
    (normalizedOption === "users_list" || normalizedOption === "users_view") ||
    (normalizedModule === "departments" || normalizedModule === "departmentsadmin") &&
    normalizedOption === "departments_list";
  if (optionAuthoritative) {
    return <>{children}</>;
  }

  // If this exact option is explicitly configured in RoleOptionToggle,
  // option-level RBAC becomes authoritative for visibility.
  const optionIsExplicitlyConfigured = hasOptionToggle(moduleId, optionId);
  if (optionIsExplicitlyConfigured) {
    return <>{children}</>;
  }

  // 2) No policy mapping? option-level is enough.
  if (!rule) return <>{children}</>;

  // 3) Legacy fallback to policy-level CRUD
  const perm = can(rule.policyKey);
  const primaryAllowed = Boolean(perm?.[rule.op]);
  const compatAllowed =
    !primaryAllowed && (rule.fallbackOps?.some((op) => Boolean(perm?.[op])) ?? false);

  const allowed = primaryAllowed || compatAllowed;
  return <>{allowed ? children : fallback}</>;
}