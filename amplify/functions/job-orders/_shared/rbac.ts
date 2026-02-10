import type { Schema } from "../../../data/resource";

export type Permission = {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
};

const EMPTY: Permission = { canRead: false, canCreate: false, canUpdate: false, canDelete: false, canApprove: false };
const FULL: Permission = { canRead: true, canCreate: true, canUpdate: true, canDelete: true, canApprove: true };

const ADMIN_GROUP = "Admins";
const DEPT_PREFIX = "DEPT_";

function normalizeKey(x: unknown) {
  return String(x ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function pickGroupsFromClaims(claims: any): string[] {
  const g = claims?.["cognito:groups"] ?? claims?.groups;
  if (Array.isArray(g)) return g.map(String).filter(Boolean);
  if (typeof g === "string" && g.trim()) return [g.trim()];
  return [];
}

export function extractGroups(event: any): string[] {
  // Amplify/AppSync typically provides identity.claims
  const claims = event?.identity?.claims ?? event?.identity ?? {};
  return pickGroupsFromClaims(claims);
}

export function isAdmin(groups: string[]) {
  return groups.includes(ADMIN_GROUP);
}

export function extractDepartmentKey(groups: string[]) {
  return groups.find((g) => g.startsWith(DEPT_PREFIX)) ?? "";
}

async function listAll<T>(
  listFn: (args: any) => Promise<any>,
  pageSize = 1000,
  max = 20000
): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | null | undefined = undefined;

  while (out.length < max) {
    const res = await listFn({ limit: pageSize, nextToken });
    out.push(...((res?.data ?? []) as T[]));
    nextToken = res?.nextToken;
    if (!nextToken) break;
  }

  return out.slice(0, max);
}

export async function resolvePolicyPermission(
  client: any,
  groups: string[],
  policyKey: string
): Promise<Permission> {
  if (isAdmin(groups)) return FULL;

  const dept = extractDepartmentKey(groups);
  if (!dept) return EMPTY;

  // Dept -> Roles
  const links = await listAll<Schema["DepartmentRoleLink"]["type"]>((args) =>
    client.models.DepartmentRoleLink.list({
      ...args,
      filter: { departmentKey: { eq: dept } },
    } as any)
  );

  const roleIds = Array.from(
    new Set(
      (links ?? [])
        .map((l: any) => String(l?.roleId ?? ""))
        .filter(Boolean)
    )
  );

  if (!roleIds.length) return EMPTY;

  // Roles -> Policies
  const allPolicies = await listAll<Schema["RolePolicy"]["type"]>((args) => client.models.RolePolicy.list(args));
  const roleIdSet = new Set(roleIds);

  const wantKey = normalizeKey(policyKey);
  const agg: Permission = { ...EMPTY };

  for (const rp of allPolicies ?? []) {
    const rid = String((rp as any)?.roleId ?? "");
    if (!roleIdSet.has(rid)) continue;

    const key = normalizeKey((rp as any)?.policyKey);
    if (key !== wantKey) continue;

    agg.canRead = agg.canRead || Boolean((rp as any)?.canRead);
    agg.canCreate = agg.canCreate || Boolean((rp as any)?.canCreate);
    agg.canUpdate = agg.canUpdate || Boolean((rp as any)?.canUpdate);
    agg.canDelete = agg.canDelete || Boolean((rp as any)?.canDelete);
    agg.canApprove = agg.canApprove || Boolean((rp as any)?.canApprove);
  }

  return agg;
}

export function assertAllowed(op: "read" | "create" | "update" | "delete" | "approve", perm: Permission) {
  const ok =
    op === "read"
      ? perm.canRead
      : op === "create"
        ? perm.canCreate
        : op === "update"
          ? perm.canUpdate
          : op === "delete"
            ? perm.canDelete
            : perm.canApprove;

  if (!ok) {
    const msg = `Not authorized (${op}).`;
    const err = new Error(msg);
    (err as any).code = "FORBIDDEN";
    throw err;
  }
}

// ------------------------------------------------------------
// Convenience helpers for AppSync resolvers
// ------------------------------------------------------------

type OpInput = "READ" | "CREATE" | "UPDATE" | "DELETE" | "APPROVE" | "read" | "create" | "update" | "delete" | "approve";

function normalizeOp(op: OpInput): "read" | "create" | "update" | "delete" | "approve" {
  const s = String(op).trim().toLowerCase();
  if (s === "read") return "read";
  if (s === "create") return "create";
  if (s === "update") return "update";
  if (s === "delete") return "delete";
  if (s === "approve") return "approve";
  // fallback (will fail closed inside assertAllowed)
  return "read";
}

/**
 * Fetches caller groups from the AppSync event and enforces RBAC.
 *
 * Example:
 *   await requirePermissionFromEvent(client, event, "JOB_CARDS", "UPDATE")
 */
export async function requirePermissionFromEvent(
  client: any,
  event: any,
  policyKey: string,
  op: OpInput
): Promise<Permission> {
  const groups = extractGroups(event);
  const perm = await resolvePolicyPermission(client, groups, policyKey);
  assertAllowed(normalizeOp(op), perm);
  return perm;
}
