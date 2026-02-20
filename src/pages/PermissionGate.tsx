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
 * Your backend enforces JOB_CARDS for mutations.
 */
function resolvePolicyAndOp(moduleId: string, optionId: string): { policyKey: string; op: keyof Permission } | null {
  const m = String(moduleId ?? "").toLowerCase().trim();
  const o = String(optionId ?? "").toLowerCase().trim();

  // This page is Job Orders -> JOB_CARDS policy
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

    // cancel order (destructive-ish) — you can choose canUpdate instead, but delete is stricter
if (o === "joborder_cancel") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    // add service / edit pricing / discounts
    if (o === "joborder_addservice") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    if (o === "joborder_serviceprice") return { policyKey: "JOB_CARDS", op: "canRead" };
    if (o === "joborder_servicediscount") return { policyKey: "JOB_CARDS", op: "canUpdate" };
    if (o === "joborder_servicediscount_percent") return { policyKey: "JOB_CARDS", op: "canUpdate" };

    // default (fail closed)
    return null;
  }

  return null;
}

export default function PermissionGate({ moduleId, optionId, children, fallback = null }: Props) {
  const { can, loading, isAdminGroup } = usePermissions();

  const rule = useMemo(() => resolvePolicyAndOp(moduleId, optionId), [moduleId, optionId]);

  // Fail closed: if unknown mapping, hide content (so admin truly controls every action)
  if (!rule) return <>{fallback}</>;

  // While loading permissions, hide (avoid “flash of unauthorized UI”)
  if (loading) return null;

  if (isAdminGroup) return <>{children}</>;

  const perm = can(rule.policyKey);
  const allowed = Boolean(perm?.[rule.op]);

  return <>{allowed ? children : fallback}</>;
}