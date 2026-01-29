import { useEffect, useMemo, useState } from "react";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { PolicyActions, PolicyKey } from "./policies";
import { EMPTY_ACTIONS, POLICY_LABELS } from "./policies";

const client = generateClient<Schema>();

function merge(a: PolicyActions, b: PolicyActions): PolicyActions {
  return {
    canRead: a.canRead || b.canRead,
    canCreate: a.canCreate || b.canCreate,
    canUpdate: a.canUpdate || b.canUpdate,
    canDelete: a.canDelete || b.canDelete,
    canApprove: a.canApprove || b.canApprove,
  };
}

const FULL: PolicyActions = {
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canApprove: true,
};

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
        const e = (u.signInDetails?.loginId || "").trim().toLowerCase();
        setEmail(e);

        const session = await fetchAuthSession();
        const g = (session.tokens?.idToken?.payload["cognito:groups"] as string[]) ?? [];
        setGroups(g);

        // ADMIN => everything
        if (g.includes("ADMIN")) {
          const all: Record<string, PolicyActions> = {};
          (Object.keys(POLICY_LABELS) as PolicyKey[]).forEach((k) => (all[k] = FULL));
          setPermissions(all);
          return;
        }

        const deptKeys = g.filter((x) => x.startsWith("DEPT_"));

        // DepartmentRoleLink -> roleIds
        const linksRes = await client.models.DepartmentRoleLink.list({ limit: 5000 });
        const roleIds = (linksRes.data ?? [])
          .filter((l) => deptKeys.includes(l.departmentKey))
          .map((l) => l.roleId);

        // RolePolicy -> merge
        const rpRes = await client.models.RolePolicy.list({ limit: 10000 });

        const perms: Record<string, PolicyActions> = {};
        for (const row of rpRes.data ?? []) {
          if (!roleIds.includes(row.roleId)) continue;

          const key = row.policyKey as string;
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
