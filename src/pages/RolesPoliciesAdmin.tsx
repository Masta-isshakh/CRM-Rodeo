import { useEffect, useMemo, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { POLICY_LABELS, type PolicyKey } from "../lib/policies";

const client = generateClient<Schema>();

type Actions = {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
};

const empty: Actions = { canRead: false, canCreate: false, canUpdate: false, canDelete: false, canApprove: false };

export default function RolesPoliciesAdmin() {
  const [roles, setRoles] = useState<Schema["AppRole"]["type"][]>([]);
  const [policies, setPolicies] = useState<Schema["RolePolicy"]["type"][]>([]);
  const [status, setStatus] = useState("");

  // create role
  const [newRole, setNewRole] = useState("");

  // selected role
  const [roleId, setRoleId] = useState<string>("");

  const load = async () => {
    setStatus("Loading...");
    try {
      const [r, p] = await Promise.all([
        client.models.AppRole.list({ limit: 1000 }),
        client.models.RolePolicy.list({ limit: 5000 }),
      ]);
      setRoles(r.data ?? []);
      setPolicies(p.data ?? []);
      setStatus("");
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to load.");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createRole = async () => {
    setStatus("");
    try {
      const name = newRole.trim();
      if (!name) throw new Error("Role name required.");
      const res = await client.models.AppRole.create({
        name,
        isActive: true,
        createdAt: new Date().toISOString(),
      });
      setNewRole("");
      await load();
      if (res.data?.id) setRoleId(res.data.id);
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Create failed.");
    }
  };

  const deleteRole = async (id: string) => {
    if (!confirm("Delete role? (Policies for it will be removed)")) return;
    setStatus("");
    try {
      // delete role policies first
      const toDelete = policies.filter((x) => x.roleId === id);
      for (const row of toDelete) await client.models.RolePolicy.delete({ id: row.id });

      await client.models.AppRole.delete({ id });
      if (roleId === id) setRoleId("");
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Delete failed.");
    }
  };

  const rolePolicyMap = useMemo(() => {
    const map = new Map<string, Map<string, Schema["RolePolicy"]["type"]>>();
    for (const row of policies) {
      const rmap = map.get(row.roleId) ?? new Map<string, Schema["RolePolicy"]["type"]>();
      rmap.set(row.policyKey as string, row);
      map.set(row.roleId, rmap);
    }
    return map;
  }, [policies]);

  const getRow = (rid: string, key: PolicyKey) => rolePolicyMap.get(rid)?.get(key);

  const upsertPolicy = async (rid: string, key: PolicyKey, patch: Partial<Actions>) => {
    setStatus("");
    try {
      const existing = getRow(rid, key);
      if (!existing) {
        await client.models.RolePolicy.create({
          roleId: rid,
          policyKey: key as any,
          canRead: patch.canRead ?? false,
          canCreate: patch.canCreate ?? false,
          canUpdate: patch.canUpdate ?? false,
          canDelete: patch.canDelete ?? false,
          canApprove: patch.canApprove ?? false,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await client.models.RolePolicy.update({
          id: existing.id,
          canRead: patch.canRead ?? existing.canRead,
          canCreate: patch.canCreate ?? existing.canCreate,
          canUpdate: patch.canUpdate ?? existing.canUpdate,
          canDelete: patch.canDelete ?? existing.canDelete,
          canApprove: patch.canApprove ?? existing.canApprove,
          updatedAt: new Date().toISOString(),
        });
      }
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Update policy failed.");
    }
  };

  const selectedRole = roles.find((r) => r.id === roleId);

  const allPolicyKeys = Object.keys(POLICY_LABELS) as PolicyKey[];

  return (
    <div style={{ padding: 24, width: "100%", maxWidth: "100%" }}>
      <h2>Roles & Policies (Admin)</h2>
      {status && <p style={{ opacity: 0.8 }}>{status}</p>}

      {/* Create role */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Create Role</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <TextField label="Role name" value={newRole} onChange={(e) => setNewRole((e.target as HTMLInputElement).value)} />
          <Button variation="primary" onClick={createRole}>Create</Button>
          <Button onClick={load}>Refresh</Button>
        </div>
      </div>

      {/* Select role */}
      <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Select Role</h3>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <SelectField label="Role" value={roleId} onChange={(e) => setRoleId((e.target as HTMLSelectElement).value)}>
            <option value="">Select…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </SelectField>

          {selectedRole && (
            <Button variation="destructive" onClick={() => deleteRole(selectedRole.id)}>
              Delete role
            </Button>
          )}
        </div>

        {!selectedRole && <p style={{ opacity: 0.75, marginTop: 10 }}>Select a role to manage its policies.</p>}
      </div>

      {/* Policy matrix */}
      {selectedRole && (
        <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>
            Policy Matrix for: <span style={{ opacity: 0.85 }}>{selectedRole.name}</span>
          </h3>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 1100, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: 10 }}>Policy (Page)</th>
                  <th style={{ padding: 10 }}>Read</th>
                  <th style={{ padding: 10 }}>Create</th>
                  <th style={{ padding: 10 }}>Update</th>
                  <th style={{ padding: 10 }}>Delete</th>
                  <th style={{ padding: 10 }}>Approve</th>
                </tr>
              </thead>
              <tbody>
                {allPolicyKeys.map((key) => {
                  const row = getRow(selectedRole.id, key);
                  const current: Actions = row
                    ? {
                        canRead: !!row.canRead,
                        canCreate: !!row.canCreate,
                        canUpdate: !!row.canUpdate,
                        canDelete: !!row.canDelete,
                        canApprove: !!row.canApprove,
                      }
                    : empty;

                  const toggle = (field: keyof Actions) => {
                    const next = { ...current, [field]: !current[field] };
                    upsertPolicy(selectedRole.id, key, next);
                  };

                  return (
                    <tr key={key} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: 10, fontWeight: 600 }}>{POLICY_LABELS[key]}</td>
                      <td style={{ padding: 10 }}><Button onClick={() => toggle("canRead")}>{current.canRead ? "Enabled" : "Disabled"}</Button></td>
                      <td style={{ padding: 10 }}><Button onClick={() => toggle("canCreate")}>{current.canCreate ? "Enabled" : "Disabled"}</Button></td>
                      <td style={{ padding: 10 }}><Button onClick={() => toggle("canUpdate")}>{current.canUpdate ? "Enabled" : "Disabled"}</Button></td>
                      <td style={{ padding: 10 }}><Button onClick={() => toggle("canDelete")}>{current.canDelete ? "Enabled" : "Disabled"}</Button></td>
                      <td style={{ padding: 10 }}><Button onClick={() => toggle("canApprove")}>{current.canApprove ? "Enabled" : "Disabled"}</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            Tip: A page appears for a user only if their effective role policies have <b>Read=Enabled</b>.
          </p>
        </div>
      )}
    </div>
  );
}
