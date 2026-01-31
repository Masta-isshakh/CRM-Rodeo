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

const EMPTY: Permission = { canRead: false, canCreate: false, canUpdate: false, canDelete: false, canApprove: false };
const FULL: Permission = { canRead: true, canCreate: true, canUpdate: true, canDelete: true, canApprove: true };

// Must match your Cognito group name exactly:
const ADMIN_GROUP_NAME = "Admins";

// Your departments in Cognito are like: DEPT_ACCOUNTANT, DEPT_MASTA, ...
const DEPT_PREFIX = "DEPT_";

// These MUST match what MainLayout requests.
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

  const [permMap, setPermMap] = useState<Record<string, Permission>>({}); // policyKey -> permission

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

  useEffect(() => {
    (async () => {
      setLoading(true);

      try {
        // Force refresh to avoid "group changed but token still old"
        const session = await fetchAuthSession({ forceRefresh: true });
        const idPayload: any = session.tokens?.idToken?.payload ?? {};
        const accessPayload: any = session.tokens?.accessToken?.payload ?? {};

        const tokenGroups = pickGroups(idPayload).length ? pickGroups(idPayload) : pickGroups(accessPayload);
        setGroups(tokenGroups);

        const admin = tokenGroups.includes(ADMIN_GROUP_NAME);
        setIsAdminGroup(admin);

        // Email for display
        const tokenEmail = String(idPayload?.email ?? "");
        if (tokenEmail) {
          setEmail(tokenEmail);
        } else {
          const u = await getCurrentUser();
          const maybe = u.signInDetails?.loginId || u.username;
          setEmail(String(maybe ?? ""));
        }

        // Department group is the first DEPT_ group
        const dept = tokenGroups.find((g) => g.startsWith(DEPT_PREFIX)) ?? "";
        setDepartmentKey(dept);

        // Admins get full access; still load map for UI consistency (optional)
        if (admin) {
          // Give full access to all known policy keys
          const fullMap: Record<string, Permission> = {};
          for (const k of POLICY_KEYS) fullMap[k] = FULL;
          setPermMap(fullMap);
          setLoading(false);
          return;
        }

        if (!dept) {
          // No department group => no policies => sidebar empty
          setPermMap({});
          setLoading(false);
          return;
        }

        // 1) Dept -> Roles
        const links = await listAll<Schema["DepartmentRoleLink"]["type"]>(
          (args) =>
            client.models.DepartmentRoleLink.list({
              ...args,
              filter: { departmentKey: { eq: dept } },
            } as any),
          1000,
          20000
        );

        const roleIds = Array.from(
          new Set(
            (links ?? [])
              .map((l) => String((l as any).roleId ?? ""))
              .filter(Boolean)
          )
        );

        if (!roleIds.length) {
          setPermMap({});
          setLoading(false);
          return;
        }

        // 2) Roles -> Policies
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
      } catch (e) {
        console.error("[PERMS] Failed to load permissions:", e);
        setPermMap({});
      } finally {
        setLoading(false);
        console.log("[PERMS] summary:", debugSummary);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { loading, email, groups, departmentKey, isAdminGroup, can };
}
