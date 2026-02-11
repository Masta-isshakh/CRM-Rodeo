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

// Must match your Cognito group name exactly:
const ADMIN_GROUP_NAME = "Admins";
const DEPT_PREFIX = "DEPT_";

export const POLICY_KEYS = [
  "DASHBOARD",
  "CUSTOMERS",
  "TICKETS",
  "EMPLOYEES",
  "ACTIVITY_LOG",
  "JOB_CARDS",
  "CALL_TRACKING",
  "INSPECTION_APPROVALS",
] as const;

function normalizeKey(x: unknown) {
  return String(x ?? "").trim().toUpperCase().replace(/\s+/g, "_");
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

export function usePermissions() {
  const client = getDataClient();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [groups, setGroups] = useState<string[]>([]);
  const [departmentKey, setDepartmentKey] = useState<string>("");
  const [isAdminGroup, setIsAdminGroup] = useState(false);
  const [permMap, setPermMap] = useState<Record<string, Permission>>({});

  // ✅ allow UI to force refresh permissions (without breaking current API)
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // ✅ listen for refresh event (triggered after dept changes)
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

  const debugSummary = useMemo(
    () => ({
      email,
      groups,
      departmentKey,
      isAdminGroup,
      permKeys: Object.keys(permMap),
    }),
    [email, groups, departmentKey, isAdminGroup, permMap]
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
        // Force refresh so if your own dept was changed you get latest tokens where possible
        const session = await fetchAuthSession({ forceRefresh: true });
        const idPayload: any = session.tokens?.idToken?.payload ?? {};
        const accessPayload: any = session.tokens?.accessToken?.payload ?? {};

        // 1) Try token groups first
        let resolvedGroups =
          pickGroups(idPayload).length ? pickGroups(idPayload) : pickGroups(accessPayload);

        // 2) If token groups empty, fallback to server-side Cognito lookup
        if (!resolvedGroups.length) {
          const fb = await fetchGroupsFallback();
          if (fb.length) resolvedGroups = fb;
        }

        setGroups(resolvedGroups);

        const admin = resolvedGroups.includes(ADMIN_GROUP_NAME);
        setIsAdminGroup(admin);

        // Email for display (and for UserProfile lookup)
        let resolvedEmail = String(idPayload?.email ?? "");
        if (!resolvedEmail) {
          const u = await getCurrentUser();
          const maybe = u.signInDetails?.loginId || u.username;
          resolvedEmail = String(maybe ?? "");
        }
        resolvedEmail = resolvedEmail.trim().toLowerCase();
        setEmail(resolvedEmail);

        // Dept from token groups (legacy)
        const deptFromGroups = resolvedGroups.find((g) => g.startsWith(DEPT_PREFIX)) ?? "";

        // ✅ Dept from UserProfile (authoritative; fixes dept change UX/permissions)
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

        // pick dept: profile > token
        let effectiveDept = deptFromProfile || deptFromGroups || "";
        setDepartmentKey(effectiveDept);

        // Admin => full map (do NOT change your current behavior)
        if (admin) {
          const fullMap: Record<string, Permission> = {};
          for (const k of POLICY_KEYS) fullMap[k] = FULL;
          setPermMap(fullMap);

          console.log("[PERMS] loaded (admin)", {
            ...debugSummary,
            groups: resolvedGroups,
            departmentKey: effectiveDept,
            isAdminGroup: true,
            permKeys: Object.keys(fullMap),
          });
          return;
        }

        // If profile says inactive => no permissions
        if (!profileActive) {
          setPermMap({});
          console.log("[PERMS] loaded (inactive user)", {
            groups: resolvedGroups,
            departmentKey: effectiveDept,
            isAdminGroup: false,
            permKeys: [],
          });
          return;
        }

        // No dept => no permissions
        if (!effectiveDept) {
          setPermMap({});
          console.log("[PERMS] loaded (no dept)", {
            ...debugSummary,
            groups: resolvedGroups,
            departmentKey: "",
            isAdminGroup: false,
            permKeys: [],
          });
          return;
        }

        // 1) Dept -> Roles (support legacy non-prefixed keys only if needed)
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

        // If no links and dept lacks prefix, try adding DEPT_
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

        if (!roleIds.length) {
          setPermMap({});
          console.log("[PERMS] loaded (dept has no roles)", {
            groups: resolvedGroups,
            departmentKey: effectiveDept,
            roleIds: [],
          });
          return;
        }

        // 2) Roles -> Policies (load all then filter in-memory)
        const allPolicies = await listAll<Schema["RolePolicy"]["type"]>(
          (args) => client.models.RolePolicy.list(args),
          1000,
          20000
        );

        const roleIdSet = new Set(roleIds);

        const map: Record<string, Permission> = {};
        for (const rp of allPolicies ?? []) {
          const rid = String((rp as any).roleId ?? "");
          if (!roleIdSet.has(rid)) continue;

          const key = normalizeKey((rp as any).policyKey);
          if (!key) continue;

          const prev = map[key] ?? { ...EMPTY };
          map[key] = {
            canRead: prev.canRead || Boolean((rp as any).canRead),
            canCreate: prev.canCreate || Boolean((rp as any).canCreate),
            canUpdate: prev.canUpdate || Boolean((rp as any).canUpdate),
            canDelete: prev.canDelete || Boolean((rp as any).canDelete),
            canApprove: prev.canApprove || Boolean((rp as any).canApprove),
          };
        }

        setPermMap(map);

        console.log("[PERMS] loaded (dept)", {
          groups: resolvedGroups,
          departmentKey: effectiveDept,
          roleIds,
          permKeys: Object.keys(map),
        });
      } catch (e) {
        console.error("[PERMS] Failed to load permissions:", e);
        setPermMap({});
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, fetchGroupsFallback, client]);

  // ✅ keep old API, add refresh without breaking anything
  return { loading, email, groups, departmentKey, isAdminGroup, can, refresh };
}
