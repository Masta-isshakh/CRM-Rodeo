import { useEffect, useMemo, useState } from "react";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { Amplify } from "aws-amplify";
import { Hub } from "aws-amplify/utils";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { PermissionSet } from "./PageProps";

const client = generateClient<Schema>();

// MUST match backend group exactly
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

function readGroupsFromPayload(payload: any): string[] {
  const g = payload?.["cognito:groups"];
  if (Array.isArray(g)) return g.map(String);
  if (typeof g === "string") return [g];
  return [];
}

function getRuntimeUserPoolId(): string {
  // Amplify v6 shape
  const cfg: any = Amplify.getConfig();
  return (
    cfg?.Auth?.Cognito?.userPoolId ||
    cfg?.Auth?.userPoolId ||
    ""
  );
}

export function usePermissions() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [isAdminGroup, setIsAdminGroup] = useState(false);
  const [permMap, setPermMap] = useState<Record<string, PermissionSet>>({});
  const [error, setError] = useState<string>("");

  const loadPermissions = async () => {
    setLoading(true);
    setError("");

    try {
      const u = await getCurrentUser();

      // forceRefresh ensures new group membership appears after you add user to group
      const session = await fetchAuthSession({ forceRefresh: true });

      const idPayload = (session.tokens?.idToken?.payload ?? {}) as any;
      const accessPayload = (session.tokens?.accessToken?.payload ?? {}) as any;

      const groups = Array.from(
        new Set([
          ...readGroupsFromPayload(idPayload),
          ...readGroupsFromPayload(accessPayload),
        ])
      );

      const login =
        u.signInDetails?.loginId ||
        (idPayload.email as string) ||
        (accessPayload.email as string) ||
        (idPayload["cognito:username"] as string) ||
        u.username;

      setEmail(String(login || ""));

      // ✅ IMPORTANT: verify runtime userpool (this is what differs between local vs hosted)
      const runtimeUserPoolId = getRuntimeUserPoolId();

      console.log("🔐 Runtime userPoolId:", runtimeUserPoolId);
      console.log("🔐 ADMIN_GROUP_NAME expected:", ADMIN_GROUP_NAME);
      console.log("🔐 Groups from token:", groups);

      const admin = groups.includes(ADMIN_GROUP_NAME);
      console.log("🔐 isAdminGroup computed:", admin);

      setIsAdminGroup(admin);

      // Admin: full UI access (no RBAC lookup needed)
      if (admin) {
        setPermMap({});
        return;
      }

      // Non-admin: Department(Group) -> Role -> Policy
      const DeptRoleLink = (client.models as any).DepartmentRoleLink as any;
      const RolePolicy = (client.models as any).RolePolicy as any;

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

      const myLinks = links.filter((l) =>
        groups.includes(String(l.departmentKey ?? ""))
      );

      const roleIds = Array.from(
        new Set(myLinks.map((l) => String(l.roleId ?? "")).filter((x) => x.trim()))
      );

      const myPolicies = policies.filter((p) =>
        roleIds.includes(String(p.roleId ?? ""))
      );

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
    } catch (e: any) {
      console.error("usePermissions load error:", e);
      setError(e?.message ?? "Permissions load failed");
      setPermMap({});
      setIsAdminGroup(false);
    } finally {
      setLoading(false);
    }
  };

  // initial load
  useEffect(() => {
    loadPermissions();
    // reload after sign-in/out events (fixes “stuck empty sidebar” cases)
    const stop = Hub.listen("auth", ({ payload }) => {
      const ev = payload?.event;
      if (ev === "signedIn" || ev === "signedOut" || ev === "tokenRefresh") {
        loadPermissions();
      }
    });
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const can = useMemo(() => {
    return (key: string): PermissionSet => {
      if (isAdminGroup) return FULL;
      return permMap[key] ?? EMPTY;
    };
  }, [isAdminGroup, permMap]);

  return { loading, email, isAdminGroup, can, error, reloadPermissions: loadPermissions };
}
