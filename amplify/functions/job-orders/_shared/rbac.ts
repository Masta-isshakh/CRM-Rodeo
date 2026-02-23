// amplify/functions/job-orders/_shared/rbac.ts
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
  return String(x ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}

function pickGroupsFromClaims(claims: any): string[] {
  const g = claims?.["cognito:groups"] ?? claims?.groups;
  if (Array.isArray(g)) return g.map(String).filter(Boolean);
  if (typeof g === "string" && g.trim()) return [g.trim()];
  return [];
}

export function extractGroups(event: any): string[] {
  const claims = event?.identity?.claims ?? event?.identity ?? {};
  return pickGroupsFromClaims(claims);
}

export function isAdmin(groups: string[]) {
  return groups.includes(ADMIN_GROUP);
}

export function extractDepartmentKey(groups: string[]) {
  return groups.find((g) => g.startsWith(DEPT_PREFIX)) ?? "";
}

function actorEmailFromEvent(event: any): string {
  const claims = event?.identity?.claims ?? {};
  const email = String(claims?.email ?? "").trim().toLowerCase();
  if (email) return email;
  // fallback to username/loginId if your pool uses it as email
  return String(event?.identity?.username ?? "").trim().toLowerCase();
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

async function resolveDeptKeyFromProfile(client: any, event: any): Promise<string> {
  const email = actorEmailFromEvent(event);
  if (!email) return "";
  try {
    const res = await (client.models.UserProfile as any).list({
      filter: { email: { eq: email } },
      limit: 1,
    });
    const row = (res?.data ?? [])[0];
    return String(row?.departmentKey ?? "").trim();
  } catch {
    return "";
  }
}

async function resolveEffectiveDeptKey(client: any, groups: string[], event: any): Promise<string> {
  const deptFromGroups = extractDepartmentKey(groups);
  if (deptFromGroups) return deptFromGroups;

  const deptFromProfile = await resolveDeptKeyFromProfile(client, event);
  if (deptFromProfile) return deptFromProfile;

  return "";
}

export async function resolvePolicyPermission(
  client: any,
  event: any,
  groups: string[],
  policyKey: string
): Promise<Permission> {
  if (isAdmin(groups)) return FULL;

  let dept = await resolveEffectiveDeptKey(client, groups, event);
  if (!dept) return EMPTY;

  // Dept -> Roles (support legacy non-prefixed dept)
  const fetchLinks = async (dk: string) =>
    await listAll<Schema["DepartmentRoleLink"]["type"]>((args) =>
      client.models.DepartmentRoleLink.list({
        ...args,
        filter: { departmentKey: { eq: dk } },
      } as any)
    );

  let links = await fetchLinks(dept);

  if ((!links || !links.length) && dept && !dept.startsWith(DEPT_PREFIX)) {
    const alt = `${DEPT_PREFIX}${dept}`;
    const altLinks = await fetchLinks(alt);
    if (altLinks?.length) {
      dept = alt;
      links = altLinks;
    }
  }

  const roleIds = Array.from(
    new Set((links ?? []).map((l: any) => String(l?.roleId ?? "")).filter(Boolean))
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

type OpInput = "READ" | "CREATE" | "UPDATE" | "DELETE" | "APPROVE" | "read" | "create" | "update" | "delete" | "approve";

function normalizeOp(op: OpInput): "read" | "create" | "update" | "delete" | "approve" {
  const s = String(op).trim().toLowerCase();
  if (s === "read") return "read";
  if (s === "create") return "create";
  if (s === "update") return "update";
  if (s === "delete") return "delete";
  if (s === "approve") return "approve";
  return "read";
}

/**
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
  const perm = await resolvePolicyPermission(client, event, groups, policyKey);
  assertAllowed(normalizeOp(op), perm);
  return perm;
}