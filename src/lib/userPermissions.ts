import { useEffect, useMemo, useState } from "react";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { PolicyActions, PolicyKey } from "./policies";
import { EMPTY_ACTIONS } from "./policies";

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

        // 1) user department rows (user can read own, admin can read all)
        const udRes = await client.models.UserDepartment.list({
          filter: { userEmail: { eq: e } },
          limit: 50,
        });
        const deptIds = (udRes.data ?? []).map((x) => x.departmentId).filter(Boolean);

        // 2) department roles
        let roleIds: string[] = [];
        if (deptIds.length) {
          const drRes = await client.models.DepartmentRole.list({ limit: 5000 });
          roleIds = (drRes.data ?? [])
            .filter((x) => deptIds.includes(x.departmentId))
            .map((x) => x.roleId);
        }

        // 3) role policies
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
