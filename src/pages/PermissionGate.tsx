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
 * Backend enforces JOB_CARDS for Job Orders + Inspection mutations.
 */
function resolvePolicyAndOp(
  moduleId: string,
  optionId: string
): { policyKey: string; op: keyof Permission } | null {
  const m = String(moduleId ?? "").toLowerCase().trim();
  const o = String(optionId ?? "").toLowerCase().trim();

  // -----------------------------
  // JOB ORDERS -> JOB_CARDS policy
  // -----------------------------
  if (m === "joborder" || m === "joborders") {
    // view sections / view details
    if (
      o === "joborder_viewdetails" ||
      o === "joborder_summary" ||
      o === "joborder_customer" ||
      o === "joborder_vehicle" ||
      o === "joborder_services" ||
      o === "joborder_billing" ||
      o === "joborder_paymentlog" ||
      o === "joborder_actions"
    ) {
      return { policyKey: "JOB_CARDS", op: "canRead" };
    }

    // create new order
    if (o === "joborder_add") return { policyKey: "JOB_CARDS", op: "canCreate" };

    // cancel/update order
    if (o === "joborder_cancel") return { policyKey: "JOB_CARDS", op: "canUpdate" };

    // add service / edit pricing / discounts
    if (o === "joborder_addservice") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    if (o === "joborder_serviceprice") return { policyKey: "JOB_CARDS", op: "canRead" };
    if (o === "joborder_servicediscount") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    if (o === "joborder_servicediscount_percent") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    // (optional alias if you ever used this id)
    if (o === "joborder_discount_percent") return { policyKey: "JOB_CARDS", op: "canUpdate" };

    return null;
  }

  // -----------------------------------------
  // INSPECTION -> ALSO JOB_CARDS policy
  // (Inspection is part of JobOrder lifecycle)
  // -----------------------------------------
  if (m === "inspection" || m === "inspectionmodule") {
    // READ UI blocks
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
      o === "inspection_viewdetails"
    ) {
      return { policyKey: "JOB_CARDS", op: "canRead" };
    }

    // Actions dropdown itself (show/hide)
    if (o === "inspection_actions") return { policyKey: "JOB_CARDS", op: "canRead" };

    // MUTATING actions (update)
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

    // Price visibility (read-only)
    if (o === "inspection_serviceprice") return { policyKey: "JOB_CARDS", op: "canRead" };

    return null;
  }

  // Unknown module => fail closed for non-admins
  return null;
}

export default function PermissionGate({
  moduleId,
  optionId,
  children,
  fallback = null,
}: Props) {
  const { can, loading, isAdminGroup } = usePermissions();

  const rule = useMemo(() => resolvePolicyAndOp(moduleId, optionId), [moduleId, optionId]);

  // While loading permissions, hide (avoid flash)
  if (loading) return null;

  // ✅ Admin override ALWAYS wins (even if mapping is missing)
  if (isAdminGroup) return <>{children}</>;

  // Non-admins: fail closed if mapping not defined
  if (!rule) return <>{fallback}</>;

  const perm = can(rule.policyKey);
  const allowed = Boolean(perm?.[rule.op]);

  return <>{allowed ? children : fallback}</>;
}