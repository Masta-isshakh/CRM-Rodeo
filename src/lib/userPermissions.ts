// src/lib/userPermissions.ts
import { useEffect, useMemo, useState } from "react";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { PolicyActions, PolicyKey } from "./policies";
import { EMPTY_ACTIONS } from "./policies";

const client = generateClient<Schema>();

const DEPT_PREFIX = "DEPT_";
const isDeptKey = (k?: string) => !!k && k.startsWith(DEPT_PREFIX);

function merge(a: PolicyActions, b: PolicyActions): PolicyActions {
  return {
    canRead: a.canRead || b.canRead,
    canCreate: a.canCreate || b.canCreate,
    canUpdate: a.canUpdate || b.canUpdate,
    canDelete: a.canDelete || b.canDelete,
    canApprove: a.canApprove || b.canApprove,
  };
}

function fullAccess(): PolicyActions {
  return { canRead: true, canCreate: true, canUpdate: true, canDelete: true, canApprove: true };
}

export function usePermissions() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Record<string, PolicyActions>>({});

  const isAdminGroup = useMemo(() => groups.includes("ADMIN"), [groups]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const u = await getCurrentUser();
        const e = (u.signInDetails?.loginId || u.username || "").trim().toLowerCase();
        setEmail(e);

        const session = await fetchAuthSession();
        const g = ((session.tokens?.idToken?.payload["cognito:groups"] as string[]) ?? []).filter(Boolean);
        setGroups(g);

        // If you want ADMIN to always see everything, keep this:
        if (g.includes("ADMIN")) {
          // grant full access to all known policy keys at runtime (UI will still ask can("X"))
          setPermissions(new Proxy({}, { get: () => fullAccess() }) as any);
          return;
        }

        // 1) Dept keys from cognito groups
        const deptKeys = g.filter(isDeptKey);
        if (!deptKeys.length) {
          setPermissions({});
          return;
        }

        // 2) Get roleIds linked to these department keys
        const linksRes = await client.models.DepartmentRoleLink.list({ limit: 5000 });
        const roleIds = Array.from(
          new Set(
            (linksRes.data ?? [])
              .filter((l) => deptKeys.includes(l.departmentKey || ""))
              .map((l) => l.roleId)
              .filter(Boolean) as string[]
          )
        );

        if (!roleIds.length) {
          setPermissions({});
          return;
        }

        // 3) Get policies for these roles
        const rpRes = await client.models.RolePolicy.list({ limit: 10000 });

        const perms: Record<string, PolicyActions> = {};
        for (const row of rpRes.data ?? []) {
          if (!row.roleId || !roleIds.includes(row.roleId)) continue;

          const key = String(row.policyKey || "");
          if (!key) continue;

          const actions: PolicyActions = {
            canRead: !!row.canRead,
            canCreate: !!row.canCreate,
            canUpdate: !!row.canUpdate,
            canDelete: !!row.canDelete,
            canApprove: !!row.canApprove,
          };

          perms[key] = perms[key] ? merge(perms[key], actions) : actions;
        }

        setPermissions(perms);
      } catch (err) {
        console.error(err);
        setPermissions({});
      } finally {
        setLoading(false);
      }
    };

    run();
  }, []);

  const can = (policy: PolicyKey): PolicyActions => permissions[policy] ?? EMPTY_ACTIONS;

  return { loading, email, groups, isAdminGroup, can };
}
