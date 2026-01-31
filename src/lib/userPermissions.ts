// src/lib/userPermissions.ts
import { useCallback, useEffect, useState } from "react";
import {
  fetchAuthSession,
  getCurrentUser,
  fetchUserAttributes,
} from "aws-amplify/auth";
import type { Schema } from "../../amplify/data/resource";
import { getDataClient } from "./amplifyClient";
import { RESOURCE_KEYS, type ResourceKey } from "./permissionKeys";

export type Permission = {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
};

const EMPTY: Permission = { canRead: false, canCreate: false, canUpdate: false, canDelete: false, canApprove: false };
const FULL: Permission = { canRead: true, canCreate: true, canUpdate: true, canDelete: true, canApprove: true };

// MUST match Cognito group name EXACTLY
const ADMIN_GROUP_NAME = "Admins";
const DEPT_PREFIX = "DEPT_";

// ---------------- helpers ----------------
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

function dedupe(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

// Resolve department key from groups even if user is in "sales" instead of "DEPT_SALES"
function resolveDepartmentKeyFromGroups(groups: string[]) {
  // 1) Prefer explicit DEPT_ group
  const dept = groups.find((g) => g.startsWith(DEPT_PREFIX));
  if (dept) return dept;

  // 2) Otherwise pick the first "non-admin" group
  const nonAdmin = groups.filter((g) => g !== ADMIN_GROUP_NAME);
  if (!nonAdmin.length) return "";

  // 3) Use it as-is
  return nonAdmin[0];
}

async function getSessionWithRetry() {
  // Hosted builds sometimes race at startup; retry a few times
  let lastErr: any = null;

  for (let i = 0; i < 6; i++) {
    try {
      const s = await fetchAuthSession();
      // if tokens exist, we’re good
      if (s?.tokens?.accessToken && s?.tokens?.idToken) return s;
    } catch (e) {
      lastErr = e;
    }
    await sleep(150 * (i + 1));
  }

  // final try with forceRefresh
  try {
    return await fetchAuthSession({ forceRefresh: true });
  } catch (e) {
    lastErr = e;
    throw lastErr;
  }
}

export function usePermissions() {
  const client = getDataClient();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [departmentKey, setDepartmentKey] = useState("");
  const [isAdminGroup, setIsAdminGroup] = useState(false);
  const [permMap, setPermMap] = useState<Record<string, Permission>>({});

  const can = useCallback(
    (policyKey: ResourceKey | string): Permission => {
      if (isAdminGroup) return FULL;
      const k = normalizeKey(policyKey);
      return permMap[k] ?? EMPTY;
    },
    [isAdminGroup, permMap]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);

      try {
        // Always set email even if session fails
        try {
          const attrs = await fetchUserAttributes();
          if (attrs?.email) setEmail(String(attrs.email));
        } catch {
          // ignore
        }

        // Ensure we have a current user (also helps verify auth state)
        try {
          const u = await getCurrentUser();
          if (!email) setEmail(String(u.signInDetails?.loginId || u.username || ""));
        } catch {
          // if this throws, user isn't really signed in
        }

        // Session (retry to avoid SPA startup race)
        const session = await getSessionWithRetry();

        const idPayload: any = session.tokens?.idToken?.payload ?? {};
        const accessPayload: any = session.tokens?.accessToken?.payload ?? {};

        // Get groups (prefer access token, then id token)
        let tokenGroups = pickGroups(accessPayload);
        if (!tokenGroups.length) tokenGroups = pickGroups(idPayload);

        // If still empty, force refresh once more (group changes need refresh)
        if (!tokenGroups.length) {
          const refreshed = await fetchAuthSession({ forceRefresh: true });
          const ap2: any = refreshed.tokens?.accessToken?.payload ?? {};
          const ip2: any = refreshed.tokens?.idToken?.payload ?? {};
          tokenGroups = pickGroups(ap2);
          if (!tokenGroups.length) tokenGroups = pickGroups(ip2);
        }

        setGroups(tokenGroups);

        // Admin?
        const admin = tokenGroups.includes(ADMIN_GROUP_NAME);
        setIsAdminGroup(admin);

        // Email from token if available
        const tokenEmail = String(idPayload?.email ?? "");
        if (tokenEmail) setEmail(tokenEmail);

        // Admin = full permissions
        if (admin) {
          const fullMap: Record<string, Permission> = {};
          for (const k of RESOURCE_KEYS) fullMap[normalizeKey(k)] = FULL;
          setDepartmentKey("");
          setPermMap(fullMap);

          console.log("[PERMS] loaded (admin)", {
            email: tokenEmail || email,
            groups: tokenGroups,
            departmentKey: "",
            permKeys: Object.keys(fullMap),
          });
          return;
        }

        // Department key resolution
        let deptKey = resolveDepartmentKeyFromGroups(tokenGroups);

        // OPTIONAL fallback: if you ever add custom attribute "custom:departmentKey"
        // this helps if groups claim is missing for some reason.
        if (!deptKey) {
          try {
            const attrs = await fetchUserAttributes();
            const c = (attrs as any)?.["custom:departmentKey"];
            if (c) deptKey = String(c);
          } catch {
            // ignore
          }
        }

        setDepartmentKey(deptKey);

        if (!deptKey) {
          setPermMap({});
          console.log("[PERMS] loaded (no dept)", {
            email: tokenEmail || email,
            groups: tokenGroups,
            departmentKey: "",
            permKeys: [],
          });
          return;
        }

        // 1) Dept -> Roles
        const links = await listAll<Schema["DepartmentRoleLink"]["type"]>(
          (args) =>
            client.models.DepartmentRoleLink.list({
              ...args,
              filter: { departmentKey: { eq: deptKey } },
            } as any),
          1000,
          20000
        );

        const roleIds = dedupe(
          (links ?? [])
            .map((l) => String((l as any).roleId ?? ""))
            .filter(Boolean)
        );

        if (!roleIds.length) {
          setPermMap({});
          console.log("[PERMS] loaded (dept has no roles)", {
            email: tokenEmail || email,
            groups: tokenGroups,
            departmentKey: deptKey,
            roleIds,
            permKeys: [],
          });
          return;
        }

        // 2) Roles -> Policies
        const [allPolicies, allRoles] = await Promise.all([
          listAll<Schema["RolePolicy"]["type"]>((args) => client.models.RolePolicy.list(args), 1000, 20000),
          listAll<Schema["AppRole"]["type"]>((args) => client.models.AppRole.list(args), 1000, 20000),
        ]);

        // roleName -> roleId mapping (fixes if RolePolicy.roleId mistakenly stores role name)
        const roleNameToId = new Map<string, string>();
        for (const r of allRoles ?? []) {
          const rid = String((r as any)?.id ?? "");
          const nm = String((r as any)?.name ?? "");
          if (rid && nm) roleNameToId.set(normalizeKey(nm), rid);
        }

        const roleIdSet = new Set(roleIds);

        const map: Record<string, Permission> = {};
        for (const rp of allPolicies ?? []) {
          let rid = String((rp as any).roleId ?? "");
          if (!rid) continue;

          // match by id OR by role name fallback
          if (!roleIdSet.has(rid)) {
            const maybeId = roleNameToId.get(normalizeKey(rid));
            if (!maybeId || !roleIdSet.has(maybeId)) continue;
            rid = maybeId;
          }

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

        console.log("[PERMS] loaded", {
          email: tokenEmail || email,
          groups: tokenGroups,
          departmentKey: deptKey,
          roleIds,
          permKeys: Object.keys(map),
        });
      } catch (e) {
        console.error("[PERMS] failed:", e);
        setGroups([]);
        setDepartmentKey("");
        setIsAdminGroup(false);
        setPermMap({});
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  return { loading, email, groups, departmentKey, isAdminGroup, can };
}
