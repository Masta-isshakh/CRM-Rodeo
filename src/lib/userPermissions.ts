import { useEffect, useMemo, useState } from "react";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import type { PermissionSet } from "./PageProps";
import { getDataClient } from "./amplifyClient";

// ✅ MUST MATCH backend ADMIN_GROUP exactly
const ADMIN_GROUP_NAME = "Admins";

const EMPTY: PermissionSet = {
  canRead: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canApprove: false,
};

const FULL: PermissionSet = {
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canApprove: true,
};

function readGroupsFromTokenPayload(payload: any): string[] {
  const g = payload?.["cognito:groups"];
  if (Array.isArray(g)) return g.map(String);
  if (typeof g === "string") return [g];
  return [];
}

export function usePermissions() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [isAdminGroup, setIsAdminGroup] = useState(false);
  const [permMap, setPermMap] = useState<Record<string, PermissionSet>>({});

  const loadPermissions = async () => {
    setLoading(true);
    try {
      const client = getDataClient();

      const u = await getCurrentUser();

      // ✅ forceRefresh so new group membership is included
      const session = await fetchAuthSession({ forceRefresh: true });

      const idPayload = (session.tokens?.idToken?.payload ?? {}) as any;
      const accessPayload = (session.tokens?.accessToken?.payload ?? {}) as any;

      const groups = Array.from(
        new Set([
          ...readGroupsFromTokenPayload(idPayload),
          ...readGroupsFromTokenPayload(accessPayload),
        ])
      );

      console.log("[PERMS] ADMIN_GROUP_NAME expected:", ADMIN_GROUP_NAME);
      console.log("[PERMS] Groups from token:", groups);

      const login =
        u.signInDetails?.loginId ||
        (idPayload.email as string) ||
        (accessPayload.email as string) ||
        (idPayload["cognito:username"] as string) ||
        u.username;

      setEmail(String(login || ""));

      const admin = groups.includes(ADMIN_GROUP_NAME);
      console.log("[PERMS] isAdminGroup computed:", admin);

      setIsAdminGroup(admin);

      // ✅ Admin sees everything in UI
      if (admin) {
        setPermMap({});
        return;
      }

      // Non-admin: Department(Group) -> Role -> Policy
      const DeptRoleLink = (client.models as any).DepartmentRoleLink as any;
      const RolePolicy = (client.models as any).RolePolicy as any;

      if (!DeptRoleLink || !RolePolicy) {
        console.warn("[PERMS] Missing models from client.models. Check Amplify.configure timing.");
        setPermMap({});
        return;
      }

      const [linksRes, policyRes] = await Promise.all([
        DeptRoleLink.list({ limit: 5000 }),
        RolePolicy.list({ limit: 5000 }),
      ]);

      const links = (linksRes.data ?? []) as any[];
      const policies = (policyRes.data ?? []) as any[];

      const myLinks = links.filter((l) => groups.includes(String(l.departmentKey ?? "")));

      const roleIds = Array.from(
        new Set(myLinks.map((l) => String(l.roleId ?? "")).filter((x) => x.trim()))
      );

      const myPolicies = policies.filter((p) => roleIds.includes(String(p.roleId ?? "")));

      const map: Record<string, PermissionSet> = {};

      for (const p of myPolicies) {
        const resourceKey = String(p.policyKey ?? "").trim();
        if (!resourceKey) continue;

        const cur = map[resourceKey] ?? { ...EMPTY };

        map[resourceKey] = {
          canRead: cur.canRead || !!p.canRead,
          canCreate: cur.canCreate || !!p.canCreate,
          canUpdate: cur.canUpdate || !!p.canUpdate,
          canDelete: cur.canDelete || !!p.canDelete,
          canApprove: cur.canApprove || !!p.canApprove,
        };
      }

      setPermMap(map);
    } catch (e) {
      console.error("[PERMS] load error:", e);
      setPermMap({});
      setIsAdminGroup(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPermissions();
  }, []);

  const can = useMemo(() => {
    return (key: string): PermissionSet => {
      if (isAdminGroup) return FULL;
      return permMap[key] ?? EMPTY;
    };
  }, [isAdminGroup, permMap]);

  return { loading, email, isAdminGroup, can, reloadPermissions: loadPermissions };
}
