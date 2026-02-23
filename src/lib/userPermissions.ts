// src/lib/userPermissions.ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import type { Schema } from "../../amplify/data/resource";
import { getDataClient } from "./amplifyClient";

export type Permission = {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
};

const EMPTY: Permission = {
  canRead: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canApprove: false,
};

const FULL: Permission = {
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canApprove: true,
};

const ADMIN_GROUP_NAME = "Admins";
const DEPT_PREFIX = "DEPT_";

export const POLICY_KEYS = [
  "DASHBOARD",
  "CUSTOMERS",
  "VEHICLES",
  "TICKETS",
  "EMPLOYEES",
  "ACTIVITY_LOG",
  "JOB_CARDS",
  "CALL_TRACKING",
  "INSPECTION_APPROVALS",
  "USERS_ADMIN",
  "DEPARTMENTS_ADMIN",
  "ROLES_POLICIES_ADMIN",
] as const;

function normalizeKey(x: unknown) {
  return String(x ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function pickGroups(payload: any): string[] {
  const g = payload?.["cognito:groups"];
  if (Array.isArray(g)) return g.map(String);
  if (typeof g === "string" && g.trim()) return [g.trim()];
  return [];
}

function safeJsonParse<T>(raw: unknown): T | null {
  try {
    if (raw == null) return null;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return null;
      return JSON.parse(s) as T;
    }
    return raw as T;
  } catch {
    return null;
  }
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

function optKey(moduleId: string, optionId: string) {
  return `${normalizeKey(moduleId)}::${normalizeKey(optionId)}`;
}

export function usePermissions() {
  const client = useMemo(() => getDataClient(), []);

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [groups, setGroups] = useState<string[]>([]);
  const [departmentKey, setDepartmentKey] = useState<string>("");
  const [isAdminGroup, setIsAdminGroup] = useState(false);

  // policy-level permissions
  const [permMap, setPermMap] = useState<Record<string, Permission>>({});

  // option-level
  const [optionToggleMap, setOptionToggleMap] = useState<Record<string, boolean>>({});
  const [optionNumberMap, setOptionNumberMap] = useState<Record<string, number>>({});

  // refresh
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const onRefresh = () => refresh();
    window.addEventListener("rbac:refresh", onRefresh);
    return () => window.removeEventListener("rbac:refresh", onRefresh);
  }, [refresh]);

  const can = useCallback(
    (policyKey: string): Permission => {
      if (isAdminGroup) return FULL;
      const k = normalizeKey(policyKey);
      return permMap[k] ?? EMPTY;
    },
    [isAdminGroup, permMap]
  );

  const isModuleEnabled = useCallback(
    (moduleId: string, fallback = true) => {
      if (isAdminGroup) return true;
      const k = optKey(moduleId, "__enabled");
      return k in optionToggleMap ? Boolean(optionToggleMap[k]) : fallback;
    },
    [isAdminGroup, optionToggleMap]
  );

  const canOption = useCallback(
    (moduleId: string, optionId: string, fallback = true) => {
      if (isAdminGroup) return true;

      // module gate
      if (!isModuleEnabled(moduleId, true) && normalizeKey(optionId) !== "__ENABLED") return false;

      const k = optKey(moduleId, optionId);
      return k in optionToggleMap ? Boolean(optionToggleMap[k]) : fallback;
    },
    [isAdminGroup, optionToggleMap, isModuleEnabled]
  );

  // ✅ IMPORTANT: PermissionGate needs this to know whether a toggle exists explicitly
  const hasOptionToggle = useCallback(
    (moduleId: string, optionId: string) => {
      if (isAdminGroup) return true;
      const k = optKey(moduleId, optionId);
      return Object.prototype.hasOwnProperty.call(optionToggleMap, k);
    },
    [isAdminGroup, optionToggleMap]
  );

  const getOptionNumber = useCallback(
    (moduleId: string, optionId: string, fallback: number) => {
      if (isAdminGroup) return fallback;
      const k = optKey(moduleId, optionId);
      const v = optionNumberMap[k];
      return Number.isFinite(v) ? v : fallback;
    },
    [isAdminGroup, optionNumberMap]
  );

  const fetchGroupsFallback = useCallback(async (): Promise<string[]> => {
    try {
      const res = await (client.queries as any).myGroups?.();
      const raw = (res as any)?.data;

      const parsed = safeJsonParse<any>(raw) ?? raw;
      const g =
        Array.isArray(parsed) ? parsed :
        Array.isArray(parsed?.groups) ? parsed.groups :
        [];

      return (g ?? []).map(String).filter(Boolean);
    } catch (e) {
      console.warn("[PERMS] myGroups fallback failed:", e);
      return [];
    }
  }, [client]);

  useEffect(() => {
    (async () => {
      setLoading(true);

      try {
        const session = await fetchAuthSession({ forceRefresh: true });
        const idPayload: any = session.tokens?.idToken?.payload ?? {};
        const accessPayload: any = session.tokens?.accessToken?.payload ?? {};

        let resolvedGroups =
          pickGroups(idPayload).length ? pickGroups(idPayload) : pickGroups(accessPayload);

        if (!resolvedGroups.length) {
          const fb = await fetchGroupsFallback();
          if (fb.length) resolvedGroups = fb;
        }

        setGroups(resolvedGroups);

        const admin = resolvedGroups.includes(ADMIN_GROUP_NAME);
        setIsAdminGroup(admin);

        let resolvedEmail = String(idPayload?.email ?? "");
        if (!resolvedEmail) {
          const u = await getCurrentUser();
          const maybe = u.signInDetails?.loginId || u.username;
          resolvedEmail = String(maybe ?? "");
        }
        resolvedEmail = resolvedEmail.trim().toLowerCase();
        setEmail(resolvedEmail);

        const deptFromGroups = resolvedGroups.find((g) => g.startsWith(DEPT_PREFIX)) ?? "";

        type UserProfileRow = Schema["UserProfile"]["type"];
        let deptFromProfile = "";
        let profileActive = true;

        if (resolvedEmail) {
          try {
            const upRes = await (client.models.UserProfile as any).list({
              filter: { email: { eq: resolvedEmail } },
              limit: 1,
            });
            const row = (upRes?.data ?? [])[0] as UserProfileRow | undefined;
            deptFromProfile = String((row as any)?.departmentKey ?? "").trim();
            profileActive = Boolean((row as any)?.isActive ?? true);
          } catch (e) {
            console.warn("[PERMS] UserProfile lookup failed:", e);
          }
        }

        let effectiveDept = deptFromProfile || deptFromGroups || "";
        setDepartmentKey(effectiveDept);

        if (admin) {
          const fullMap: Record<string, Permission> = {};
          for (const k of POLICY_KEYS) fullMap[k] = FULL;
          setPermMap(fullMap);
          setOptionToggleMap({});
          setOptionNumberMap({});
          return;
        }

        if (!profileActive || !effectiveDept) {
          setPermMap({});
          setOptionToggleMap({});
          setOptionNumberMap({});
          return;
        }

        // Dept -> Roles
        const fetchLinksForDept = async (dk: string) => {
          return await listAll<Schema["DepartmentRoleLink"]["type"]>(
            (args) =>
              client.models.DepartmentRoleLink.list({
                ...args,
                filter: { departmentKey: { eq: dk } },
              } as any),
            1000,
            20000
          );
        };

        let links = await fetchLinksForDept(effectiveDept);

        if ((!links || !links.length) && effectiveDept && !effectiveDept.startsWith(DEPT_PREFIX)) {
          const alt = `${DEPT_PREFIX}${effectiveDept}`;
          const altLinks = await fetchLinksForDept(alt);
          if (altLinks?.length) {
            links = altLinks;
            effectiveDept = alt;
            setDepartmentKey(alt);
          }
        }

        const roleIds = Array.from(
          new Set((links ?? []).map((l) => String((l as any).roleId ?? "")).filter(Boolean))
        );
        const roleIdSet = new Set(roleIds);

        if (!roleIds.length) {
          setPermMap({});
          setOptionToggleMap({});
          setOptionNumberMap({});
          return;
        }

        // Roles -> Policies
        const allPolicies = await listAll<Schema["RolePolicy"]["type"]>(
          (args) => client.models.RolePolicy.list(args),
          1000,
          20000
        );

        const nextPermMap: Record<string, Permission> = {};
        for (const rp of allPolicies ?? []) {
          const rid = String((rp as any).roleId ?? "");
          if (!roleIdSet.has(rid)) continue;

          const key = normalizeKey((rp as any).policyKey);
          if (!key) continue;

          const prev = nextPermMap[key] ?? { ...EMPTY };
          nextPermMap[key] = {
            canRead: prev.canRead || Boolean((rp as any).canRead),
            canCreate: prev.canCreate || Boolean((rp as any).canCreate),
            canUpdate: prev.canUpdate || Boolean((rp as any).canUpdate),
            canDelete: prev.canDelete || Boolean((rp as any).canDelete),
            canApprove: prev.canApprove || Boolean((rp as any).canApprove),
          };
        }
        setPermMap(nextPermMap);

        // Option toggles + numeric limits per role
        const mergedToggles: Record<string, boolean> = {};
        const mergedNums: Record<string, number> = {};

        for (const rid of roleIds) {
          // toggles
          let toggleRows: any[] = [];
          try {
            const q = await (client.models as any).RoleOptionToggle.roleOptionTogglesByRole?.({
              roleId: String(rid),
              limit: 2000,
            });
            toggleRows = (q?.data ?? []) as any[];
          } catch {
            const res = await (client.models as any).RoleOptionToggle.list({
              limit: 2000,
              filter: { roleId: { eq: String(rid) } },
            });
            toggleRows = (res?.data ?? []) as any[];
          }

          for (const t of toggleRows ?? []) {
            const k = normalizeKey(t.key);
            if (!k) continue;
            mergedToggles[k] = Boolean(mergedToggles[k] || Boolean(t.enabled));
          }

          // numbers
          let numRows: any[] = [];
          try {
            const qn = await (client.models as any).RoleOptionNumber.roleOptionNumbersByRole?.({
              roleId: String(rid),
              limit: 2000,
            });
            numRows = (qn?.data ?? []) as any[];
          } catch {
            const resn = await (client.models as any).RoleOptionNumber.list({
              limit: 2000,
              filter: { roleId: { eq: String(rid) } },
            });
            numRows = (resn?.data ?? []) as any[];
          }

          for (const n of numRows ?? []) {
            const k = normalizeKey(n.key);
            const v = Number(n.value);
            if (!k || !Number.isFinite(v)) continue;
            mergedNums[k] = Number.isFinite(mergedNums[k]) ? Math.max(mergedNums[k], v) : v;
          }
        }

        setOptionToggleMap(mergedToggles);
        setOptionNumberMap(mergedNums);
      } catch (e) {
        console.error("[PERMS] Failed to load permissions:", e);
        setPermMap({});
        setOptionToggleMap({});
        setOptionNumberMap({});
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, fetchGroupsFallback, client]);

  return {
    loading,
    email,
    groups,
    departmentKey,
    isAdminGroup,

    can,

    // option-level
    canOption,
    hasOptionToggle, // ✅ required by PermissionGate
    getOptionNumber,
    isModuleEnabled,

    refresh,
  };
}