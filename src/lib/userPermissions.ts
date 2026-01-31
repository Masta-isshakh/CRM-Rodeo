// src/lib/userPermissions.ts
import { useCallback, useEffect, useState } from "react";
import { fetchAuthSession, getCurrentUser, fetchUserAttributes } from "aws-amplify/auth";
import type { Schema } from "../../amplify/data/resource";
import { getDataClient } from "./amplifyClient";
import { RESOURCE_KEYS } from "./permissionKeys";

export type Permission = {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
};

const EMPTY: Permission = { canRead: false, canCreate: false, canUpdate: false, canDelete: false, canApprove: false };
const FULL: Permission  = { canRead: true,  canCreate: true,  canUpdate: true,  canDelete: true,  canApprove: true  };

const ADMIN_GROUP_NAME = "Admins";
const DEPT_PREFIX = "DEPT_";

function normalizeKey(x: unknown) {
  return String(x ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}

function parseAWSJSON<T>(raw: unknown): T | null {
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

function pickGroups(payload: any): string[] {
  const g = payload?.["cognito:groups"];
  if (Array.isArray(g)) return g.map(String);
  if (typeof g === "string" && g.trim()) return [g.trim()];
  return [];
}

function dedupe(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function resolveDepartmentKeyFromGroups(groups: string[]) {
  // Prefer DEPT_*
  const dept = groups.find((g) => g.startsWith(DEPT_PREFIX));
  if (dept) return dept;

  // Otherwise any non-admin group acts as department
  const nonAdmin = groups.filter((g) => g !== ADMIN_GROUP_NAME);
  return nonAdmin[0] ?? "";
}

async function listAll<T>(listFn: (args: any) => Promise<any>, pageSize = 1000, max = 20000): Promise<T[]> {
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
  const [email, setEmail] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [departmentKey, setDepartmentKey] = useState("");
  const [isAdminGroup, setIsAdminGroup] = useState(false);
  const [permMap, setPermMap] = useState<Record<string, Permission>>({});

  const can = useCallback(
    (policyKey: string): Permission => {
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
        // ---------- email ----------
        try {
          const attrs = await fetchUserAttributes();
          if (attrs?.email) setEmail(String(attrs.email));
        } catch {}

        try {
          const u = await getCurrentUser();
          if (!email) setEmail(String(u.signInDetails?.loginId || u.username || ""));
        } catch {}

        // ---------- token groups ----------
        const session = await fetchAuthSession({ forceRefresh: true });
        const idPayload: any = session.tokens?.idToken?.payload ?? {};
        const accessPayload: any = session.tokens?.accessToken?.payload ?? {};

        let tokenGroups = pickGroups(accessPayload);
        if (!tokenGroups.length) tokenGroups = pickGroups(idPayload);

        // ---------- fallback: ask backend (Cognito) ----------
        if (!tokenGroups.length) {
          try {
            const res = await (client.queries as any).myGroups();
            const raw = (res as any)?.data;

            const parsedObj = parseAWSJSON<{ groups?: string[] }>(raw);
            const parsedArr = parseAWSJSON<string[]>(raw);

            const fallbackGroups = Array.isArray(parsedArr)
              ? parsedArr
              : Array.isArray(parsedObj?.groups)
              ? parsedObj!.groups!
              : [];

            tokenGroups = fallbackGroups.map(String);
          } catch (e) {
            console.error("[PERMS] myGroups fallback failed:", e);
          }
        }

        tokenGroups = dedupe(tokenGroups);
        setGroups(tokenGroups);

        const admin = tokenGroups.includes(ADMIN_GROUP_NAME);
        setIsAdminGroup(admin);

        // ---------- admin full access ----------
        if (admin) {
          const fullMap: Record<string, Permission> = {};
          for (const k of RESOURCE_KEYS) fullMap[normalizeKey(k)] = FULL;
          setDepartmentKey("");
          setPermMap(fullMap);

          console.log("[PERMS] loaded (admin)", {
            email: String(idPayload?.email ?? email),
            groups: tokenGroups,
            departmentKey: "",
            permKeys: Object.keys(fullMap),
          });
          return;
        }

        // ---------- department ----------
        const deptKey = resolveDepartmentKeyFromGroups(tokenGroups);
        setDepartmentKey(deptKey);

        if (!deptKey) {
          setPermMap({});
          console.log("[PERMS] loaded (no dept)", {
            email: String(idPayload?.email ?? email),
            groups: tokenGroups,
            departmentKey: "",
            permKeys: [],
          });
          return;
        }

        // Dept -> Roles
        const links = await listAll<Schema["DepartmentRoleLink"]["type"]>(
          (args) =>
            client.models.DepartmentRoleLink.list({
              ...args,
              filter: { departmentKey: { eq: deptKey } },
            } as any)
        );

        const roleIds = dedupe(
          (links ?? [])
            .map((l) => String((l as any).roleId ?? ""))
            .filter(Boolean)
        );

        if (!roleIds.length) {
          setPermMap({});
          console.log("[PERMS] loaded (dept has no roles)", {
            email: String(idPayload?.email ?? email),
            groups: tokenGroups,
            departmentKey: deptKey,
            roleIds,
            permKeys: [],
          });
          return;
        }

        // Roles -> Policies
        const allPolicies = await listAll<Schema["RolePolicy"]["type"]>((args) => client.models.RolePolicy.list(args));
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

        console.log("[PERMS] loaded", {
          email: String(idPayload?.email ?? email),
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
