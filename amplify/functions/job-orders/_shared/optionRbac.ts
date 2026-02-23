// amplify/functions/job-orders/_shared/optionRbac.ts
import type { Schema } from "../../../data/resource";

function normalizeKey(x: unknown) {
  return String(x ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}

function optKey(moduleId: string, optionId: string) {
  return `${normalizeKey(moduleId)}::${normalizeKey(optionId)}`;
}

function pickGroupsFromEvent(event: any): string[] {
  const claims = event?.identity?.claims ?? {};
  const g = claims["cognito:groups"];
  if (Array.isArray(g)) return g.map(String).filter(Boolean);
  if (typeof g === "string" && g.trim()) return [g.trim()];
  return [];
}

function actorEmailFromEvent(event: any): string {
  const claims = event?.identity?.claims ?? {};
  const email = String(claims?.email ?? "").trim().toLowerCase();
  if (email) return email;
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

async function deptFromProfile(client: any, email: string): Promise<string> {
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

export type OptionCtx = {
  isAdmin: boolean;
  deptKey: string;
  roleIds: string[];
  toggleEnabled: (moduleId: string, optionId: string, fallback?: boolean) => boolean;
  maxNumber: (moduleId: string, optionId: string, fallback: number) => number;
};

export async function getOptionCtx(client: any, event: any): Promise<OptionCtx> {
  const groups = pickGroupsFromEvent(event);
  const isAdmin = groups.includes("Admins");

  let deptKey = groups.find((x) => String(x).startsWith("DEPT_")) ?? "";
  if (!deptKey) {
    const email = actorEmailFromEvent(event);
    deptKey = await deptFromProfile(client, email);
  }

  // Dept -> Roles
  let roleIds: string[] = [];
  if (deptKey) {
    const links = await listAll<Schema["DepartmentRoleLink"]["type"]>(
      (args) =>
        client.models.DepartmentRoleLink.list({
          ...args,
          filter: { departmentKey: { eq: deptKey } },
        } as any),
      1000,
      20000
    );

    roleIds = Array.from(
      new Set((links ?? []).map((l: any) => String(l?.roleId ?? "")).filter(Boolean))
    );
  }

  const toggleMap: Record<string, boolean> = {};
  const numberMap: Record<string, number> = {};

  if (roleIds.length) {
    for (const rid of roleIds) {
      // toggles
      const toggles = await listAll<any>(
        (args) =>
          (client.models as any).RoleOptionToggle.list({
            ...args,
            filter: { roleId: { eq: String(rid) } },
          }),
        1000,
        20000
      );

      for (const t of toggles ?? []) {
        const k = normalizeKey(t.key);
        if (!k) continue;
        toggleMap[k] = Boolean(toggleMap[k] || Boolean(t.enabled));
      }

      // numbers
      const nums = await listAll<any>(
        (args) =>
          (client.models as any).RoleOptionNumber.list({
            ...args,
            filter: { roleId: { eq: String(rid) } },
          }),
        1000,
        20000
      );

      for (const n of nums ?? []) {
        const k = normalizeKey(n.key);
        const v = Number(n.value);
        if (!k || !Number.isFinite(v)) continue;
        numberMap[k] = Number.isFinite(numberMap[k]) ? Math.max(numberMap[k], v) : v;
      }
    }
  }

  return {
    isAdmin,
    deptKey,
    roleIds,

    toggleEnabled: (moduleId: string, optionId: string, fallback = true) => {
      if (isAdmin) return true;
      const k = optKey(moduleId, optionId);
      return k in toggleMap ? Boolean(toggleMap[k]) : fallback; // default allow
    },

    maxNumber: (moduleId: string, optionId: string, fallback: number) => {
      if (isAdmin) return fallback;
      const k = optKey(moduleId, optionId);
      const v = numberMap[k];
      return Number.isFinite(v) ? v : fallback;
    },
  };
}