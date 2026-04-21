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
const PERMISSIONS_CACHE_KEY = "crm.permissionsCache.v1";
const PERMISSIONS_CACHE_TTL_MS = 5 * 60 * 1000;

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
  "INTERNAL_CHAT",
  "EMAIL_INBOX",
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

async function findUserProfileByEmailCaseInsensitive(client: any, email: string) {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized) return null;

  try {
    const exact = await (client.models.UserProfile as any).list({
      filter: { email: { eq: normalized } },
      limit: 1,
    });
    const row = (exact?.data ?? [])[0] as any;
    if (row?.id) return row;
  } catch {
    // fallback below
  }

  const all = await (client.models.UserProfile as any).list({
    limit: 20000,
  });

  return (
    (all?.data ?? []).find((row: any) => String(row?.email ?? "").trim().toLowerCase() === normalized) ?? null
  );
}

function optKey(moduleId: string, optionId: string) {
  return `${normalizeKey(moduleId)}::${normalizeKey(optionId)}`;
}

function getRowTimestamp(row: any): number {
  const updated = Date.parse(String(row?.updatedAt ?? ""));
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(String(row?.createdAt ?? ""));
  if (Number.isFinite(created)) return created;
  return 0;
}

type PermissionsCacheShape = {
  cachedAt: number;
  email: string;
  groups: string[];
  departmentKey: string;
  isAdminGroup: boolean;
  permMap: Record<string, Permission>;
  optionToggleMap: Record<string, boolean>;
  optionNumberMap: Record<string, number>;
};

function readPermissionsCache(): PermissionsCacheShape | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(PERMISSIONS_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PermissionsCacheShape>;
    const cachedAt = Number(parsed.cachedAt ?? 0);
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > PERMISSIONS_CACHE_TTL_MS) return null;

    return {
      cachedAt,
      email: String(parsed.email ?? ""),
      groups: Array.isArray(parsed.groups) ? parsed.groups.map(String) : [],
      departmentKey: String(parsed.departmentKey ?? ""),
      isAdminGroup: Boolean(parsed.isAdminGroup),
      permMap: (parsed.permMap as Record<string, Permission>) ?? {},
      optionToggleMap: (parsed.optionToggleMap as Record<string, boolean>) ?? {},
      optionNumberMap: (parsed.optionNumberMap as Record<string, number>) ?? {},
    };
  } catch {
    return null;
  }
}

function writePermissionsCache(value: Omit<PermissionsCacheShape, "cachedAt">) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      PERMISSIONS_CACHE_KEY,
      JSON.stringify({
        ...value,
        cachedAt: Date.now(),
      } satisfies PermissionsCacheShape)
    );
  } catch {
    // ignore storage errors
  }
}

function clearPermissionsCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PERMISSIONS_CACHE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function usePermissions() {
  const client = useMemo(() => getDataClient(), []);
  const cached = useMemo(() => readPermissionsCache(), []);

  const [loading, setLoading] = useState(!cached);
  const [email, setEmail] = useState<string>(cached?.email ?? "");
  const [groups, setGroups] = useState<string[]>(cached?.groups ?? []);
  const [departmentKey, setDepartmentKey] = useState<string>(cached?.departmentKey ?? "");
  const [isAdminGroup, setIsAdminGroup] = useState(cached?.isAdminGroup ?? false);

  // policy-level permissions
  const [permMap, setPermMap] = useState<Record<string, Permission>>(cached?.permMap ?? {});

  // option-level
  const [optionToggleMap, setOptionToggleMap] = useState<Record<string, boolean>>(cached?.optionToggleMap ?? {});
  const [optionNumberMap, setOptionNumberMap] = useState<Record<string, number>>(cached?.optionNumberMap ?? {});

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

      const moduleKey = normalizeKey(moduleId);
      const optionKey = normalizeKey(optionId);
      const bypassModuleGate =
        (moduleKey === "USERS" &&
          (optionKey === "USERS_LIST" || optionKey === "USERS_VIEW" || optionKey === "USERS_SHOW_ROOT_ADMIN")) ||
        (moduleKey === "DEPARTMENTS" && optionKey === "DEPARTMENTS_LIST");

      // module gate
      if (!bypassModuleGate && !isModuleEnabled(moduleId, true) && optionKey !== "__ENABLED") return false;

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
      if (!cached) setLoading(true);

      try {
        const session = await fetchAuthSession();
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
        let profileRoleId = "";
        let profileActive = true;
        let profileDashboardAccessEnabled = true;

        if (resolvedEmail) {
          try {
            const row = (await findUserProfileByEmailCaseInsensitive(client, resolvedEmail)) as UserProfileRow | undefined;
            deptFromProfile = String((row as any)?.departmentKey ?? "").trim();
            profileRoleId = String((row as any)?.roleId ?? "").trim();
            profileActive = Boolean((row as any)?.isActive ?? true);
            profileDashboardAccessEnabled = Boolean((row as any)?.dashboardAccessEnabled ?? true);
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
          writePermissionsCache({
            email: resolvedEmail,
            groups: resolvedGroups,
            departmentKey: effectiveDept,
            isAdminGroup: true,
            permMap: fullMap,
            optionToggleMap: {},
            optionNumberMap: {},
          });
          return;
        }

        if (!profileActive || !profileDashboardAccessEnabled || !effectiveDept) {
          setPermMap({});
          setOptionToggleMap({});
          setOptionNumberMap({});
          clearPermissionsCache();
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

        const roleIds = profileRoleId
          ? [profileRoleId]
          : Array.from(
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

        await Promise.all(
          roleIds.map(async (rid) => {
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

            const roleToggleByKey = new Map<string, any>();
            for (const t of toggleRows ?? []) {
              const k = normalizeKey(t?.key);
              if (!k) continue;

              const prev = roleToggleByKey.get(k);
              if (!prev || getRowTimestamp(t) >= getRowTimestamp(prev)) {
                roleToggleByKey.set(k, t);
              }
            }

            for (const [k, row] of roleToggleByKey.entries()) {
              mergedToggles[k] = Boolean(mergedToggles[k] || Boolean(row?.enabled));
            }

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

            const roleNumByKey = new Map<string, any>();
            for (const n of numRows ?? []) {
              const k = normalizeKey(n?.key);
              if (!k) continue;

              const prev = roleNumByKey.get(k);
              if (!prev || getRowTimestamp(n) >= getRowTimestamp(prev)) {
                roleNumByKey.set(k, n);
              }
            }

            for (const [k, row] of roleNumByKey.entries()) {
              const v = Number(row?.value);
              if (!Number.isFinite(v)) continue;
              mergedNums[k] = Number.isFinite(mergedNums[k]) ? Math.max(mergedNums[k], v) : v;
            }
          })
        );

        setOptionToggleMap(mergedToggles);
        setOptionNumberMap(mergedNums);
        writePermissionsCache({
          email: resolvedEmail,
          groups: resolvedGroups,
          departmentKey: effectiveDept,
          isAdminGroup: false,
          permMap: nextPermMap,
          optionToggleMap: mergedToggles,
          optionNumberMap: mergedNums,
        });
      } catch (e) {
        console.error("[PERMS] Failed to load permissions:", e);
        if (!cached) {
          setPermMap({});
          setOptionToggleMap({});
          setOptionNumberMap({});
        }
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