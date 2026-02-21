// src/pages/joborders/PermissionGate.tsx
import React, { useMemo } from "react";
import { usePermissions, type Permission } from "../lib/userPermissions";

type Props = {
  moduleId: string;
  optionId: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

/**
 * Map UI optionId -> required operation on policy key.
 */
function resolvePolicyAndOp(
  moduleId: string,
  optionId: string
): { policyKey: string; op: keyof Permission } | null {
  const m = String(moduleId ?? "").toLowerCase().trim();
  const o = String(optionId ?? "").toLowerCase().trim();

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
      o === "joborder_actions"
    ) return { policyKey: "JOB_CARDS", op: "canRead" };

    if (o === "joborder_add") return { policyKey: "JOB_CARDS", op: "canCreate" };
    if (o === "joborder_cancel") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    if (o === "joborder_addservice") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    if (o === "joborder_serviceprice") return { policyKey: "JOB_CARDS", op: "canRead" };
    if (o === "joborder_servicediscount") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    if (o === "joborder_servicediscount_percent") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    if (o === "joborder_discount_percent") return { policyKey: "JOB_CARDS", op: "canUpdate" };

    return null;
  }

  // INSPECTION
  if (m === "inspection" || m === "inspectionmodule") {
    if (
      o === "inspection_summary" ||
      o === "inspection_customer" ||
      o === "inspection_vehicle" ||
      o === "inspection_services" ||
      o === "inspection_billing" ||
      o === "inspection_paymentlog" ||
      o === "inspection_documents" ||
      o === "inspection_exitpermit" ||
      o === "inspection_roadmap" ||
      o === "inspection_list" ||
      o === "inspection_quality" ||
      o === "inspection_download" ||
      o === "inspection_viewdetails" ||
      o === "inspection_actions"
    ) return { policyKey: "JOB_CARDS", op: "canRead" };

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
    ) return { policyKey: "JOB_CARDS", op: "canUpdate" };

    if (o === "inspection_serviceprice") return { policyKey: "JOB_CARDS", op: "canRead" };
    return null;
  }

  // SERVICE EXECUTION
  if (m === "serviceexec" || m === "serviceexecution") {
    if (
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
    ) return { policyKey: "JOB_CARDS", op: "canRead" };

    if (
      o === "serviceexec_edit" ||
      o === "serviceexec_update" ||
      o === "serviceexec_finish" ||
      o === "serviceexec_addservice" ||
      o === "serviceexec_cancel"
    ) return { policyKey: "JOB_CARDS", op: "canUpdate" };

    return null;
  }

  // ✅ SERVICE APPROVAL HISTORY
  if (m === "approvalhistory" || m === "serviceapprovalhistory") {
    if (
      o === "approvalhistory_view" ||
      o === "approvalhistory_viewdetails" ||
      o === "approvalhistory_list"
    ) {
      // choose one policy key; this keeps it aligned with your existing setup
      return { policyKey: "JOB_CARDS", op: "canRead" };
    }
    return null;
  }

  return null;
}

export default function PermissionGate({ moduleId, optionId, children, fallback = null }: Props) {
  const { can, loading, isAdminGroup } = usePermissions();
  const rule = useMemo(() => resolvePolicyAndOp(moduleId, optionId), [moduleId, optionId]);

  if (loading) return null;
  if (isAdminGroup) return <>{children}</>;

  if (!rule) return <>{fallback}</>;

  const perm = can(rule.policyKey);
  const allowed = Boolean(perm?.[rule.op]);

  return <>{allowed ? children : fallback}</>;
}