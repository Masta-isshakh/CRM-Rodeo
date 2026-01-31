// src/lib/userPermissions.ts
import { useCallback, useEffect, useState } from "react";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
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

// MUST match Cognito group name exactly
const ADMIN_GROUP_NAME = "Admins";

// your usual dept prefix (but we also support non-prefixed dept groups)
const DEPT_PREFIX = "DEPT_";

// ---- helpers ----
function normalizeKey(x: unknown) {
  return String(x ?? "").trim().toUpperCase().replace(/\s+/g, "_");
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

function dedupe(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function resolveDeptCandidates(groups: string[]) {
  // priority: any DEPT_ group
  const dept = groups.find((g) => g.startsWith(DEPT_PREFIX));
  if (dept) return [dept];

  // otherwise: take any non-admin group as dept (common when you used group name "sales")
  const nonAdmin = groups.filter(
    (g) => g !== ADMIN_GROUP_NAME && g !== "ADMIN_GROUP" && g !== "ADMIN" && !g.startsWith("ADMIN_")
  );

  if (!nonAdmin.length) return [];

  // if multiple, just try them all in order
  const candidates: string[] = [];

  for (const g of nonAdmin) {
    candidates.push(g); // raw
    candidates.push(normalizeKey(g)); // SALES
    candidates.push(`${DEPT_PREFIX}${normalizeKey(g)}`); // DEPT_SALES
  }

  return dedupe(candidates);
}

export function usePermissions() {
  const client = getDataClient();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [departmentKey, setDepartmentKey] = useState("");
  const [isAdminGroup, setIsAdminGroup] = useState(false);

  // key is normalized policyKey (ex: "TICKETS")
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
        // 1) session + groups
        const session = await fetchAuthSession({ forceRefresh: true });
        const idPayload: any = session.tokens?.idToken?.payload ?? {};
        const accessPayload: any = session.tokens?.accessToken?.payload ?? {};

        // prefer access token groups (Cognito sometimes is more consistent there)
        const gAccess = pickGroups(accessPayload);
        const gId = pickGroups(idPayload);
        const tokenGroups = gAccess.length ? gAccess : gId;

        const admin = tokenGroups.includes(ADMIN_GROUP_NAME);
        setGroups(tokenGroups);
        setIsAdminGroup(admin);

        // email
        const tokenEmail = String(idPayload?.email ?? "");
        if (tokenEmail) {
          setEmail(tokenEmail);
        } else {
          const u = await getCurrentUser();
          setEmail(String(u.signInDetails?.loginId || u.username || ""));
        }

        // Admin => full map (for all keys)
        if (admin) {
          const fullMap: Record<string, Permission> = {};
          for (const k of RESOURCE_KEYS) fullMap[normalizeKey(k)] = FULL;
          setDepartmentKey("");
          setPermMap(fullMap);

          console.log("[PERMS] admin user", { groups: tokenGroups, fullKeys: Object.keys(fullMap) });
          return;
        }

        // 2) resolve departmentKey from groups (robust)
        const deptCandidates = resolveDeptCandidates(tokenGroups);

        // 3) dept -> roles (try candidates until one works)
        let chosenDept = "";
        let roleIds: string[] = [];

        for (const cand of deptCandidates) {
          const links = await listAll<Schema["DepartmentRoleLink"]["type"]>(
            (args) =>
              client.models.DepartmentRoleLink.list({
                ...args,
                filter: { departmentKey: { eq: cand } },
              } as any),
            1000,
            20000
          );

          const ids = dedupe(
            (links ?? [])
              .map((l) => String((l as any).roleId ?? ""))
              .filter(Boolean)
          );

          if (ids.length) {
            chosenDept = cand;
            roleIds = ids;
            break;
          }
        }

        setDepartmentKey(chosenDept);

        if (!chosenDept || !roleIds.length) {
          setPermMap({});
          console.log("[PERMS] no dept roles found", {
            groups: tokenGroups,
            deptCandidates,
            chosenDept,
            roleIds,
          });
          return;
        }

        // 4) policies read
        const [allPolicies, allRoles] = await Promise.all([
          listAll<Schema["RolePolicy"]["type"]>((args) => client.models.RolePolicy.list(args), 1000, 20000),
          listAll<Schema["AppRole"]["type"]>((args) => client.models.AppRole.list(args), 1000, 20000),
        ]);

        // roleName -> roleId (to handle bad data where RolePolicy.roleId stores name)
        const roleNameToId = new Map<string, string>();
        for (const r of allRoles ?? []) {
          if (!r?.id || !(r as any)?.name) continue;
          roleNameToId.set(normalizeKey((r as any).name), String(r.id));
        }

        const roleIdSet = new Set(roleIds);

        // 5) aggregate permissions per policyKey
        const map: Record<string, Permission> = {};

        for (const rp of allPolicies ?? []) {
          let rid = String((rp as any).roleId ?? "");
          if (!rid) continue;

          // if not matching by ID, try matching by role NAME (bad data fix)
          if (!roleIdSet.has(rid)) {
            const maybe = roleNameToId.get(normalizeKey(rid));
            if (maybe && roleIdSet.has(maybe)) rid = maybe;
            else continue;
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
          groups: tokenGroups,
          deptCandidates,
          chosenDept,
          roleIds,
          permKeys: Object.keys(map),
        });
      } catch (e) {
        console.error("[PERMS] failed:", e);
        setPermMap({});
        setDepartmentKey("");
      } finally {
        setLoading(false);
      }
    })();
  }, [client]);

  return { loading, email, groups, departmentKey, isAdminGroup, can };
}
