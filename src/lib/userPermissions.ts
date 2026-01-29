import { useEffect, useMemo, useState } from "react";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { PermissionSet } from "./PageProps";

const client = generateClient<Schema>();

const ADMIN_GROUP_NAME = "Admins"; // <-- change if your admin group name is different

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

export function usePermissions() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [isAdminGroup, setIsAdminGroup] = useState(false);
  const [permMap, setPermMap] = useState<Record<string, PermissionSet>>({});

  const loadPermissions = async () => {
    setLoading(true);
    try {
      const u = await getCurrentUser();
      const session = await fetchAuthSession();

      const payload = (session.tokens?.idToken?.payload ?? {}) as any;
      const groups = (payload["cognito:groups"] as string[] | undefined) ?? [];

      const login =
        u.signInDetails?.loginId ||
        (payload.email as string) ||
        (payload["cognito:username"] as string) ||
        u.username;

      setEmail(String(login || ""));
      const admin = groups.includes(ADMIN_GROUP_NAME);
      setIsAdminGroup(admin);

      // Admin = full permissions for everything
      if (admin) {
        setPermMap({});
        return;
      }

      // Non-admin: build permissions from DepartmentRoleLink + RolePolicy
      const DeptRoleLink = (client.models as any).DepartmentRoleLink as any;
      const RolePolicy = (client.models as any).RolePolicy as any;

      // If your schema uses a different model name, change it here.
      if (!DeptRoleLink || !RolePolicy) {
        setPermMap({});
        return;
      }

      const [linksRes, policyRes] = await Promise.all([
        DeptRoleLink.list({ limit: 5000 }),
        RolePolicy.list({ limit: 5000 }),
      ]);

      const links = (linksRes.data ?? []) as any[];
      const policies = (policyRes.data ?? []) as any[];

      // Which departments the user belongs to = cognito groups
      const myLinks = links.filter((l) =>
        groups.includes(String(l.departmentKey ?? ""))
      );

      const roleIds = Array.from(
        new Set(
          myLinks
            .map((l) => String(l.roleId ?? ""))
            .filter((x) => x.trim())
        )
      );

      const myPolicies = policies.filter((p) =>
        roleIds.includes(String(p.roleId ?? ""))
      );

      const map: Record<string, PermissionSet> = {};

      for (const p of myPolicies) {
        const resourceKey = String(
          p.resourceKey ?? p.key ?? p.pageKey ?? ""
        ).trim();
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
      console.error("usePermissions load error:", e);
      setPermMap({});
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
