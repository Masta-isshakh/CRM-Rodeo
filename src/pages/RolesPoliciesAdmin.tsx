// src/pages/RolesPoliciesAdmin.tsx
import { useEffect, useMemo, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

import { POLICY_LABELS, type PolicyKey } from "../lib/policies";
import type { PageProps } from "../lib/PageProps";

const client = generateClient<Schema>();

type Actions = {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
};

const EMPTY: Actions = {
  canRead: false,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canApprove: false,
};

const FULL: Actions = {
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canApprove: true,
};

function toBool(v: any): boolean {
  return v === true;
}

export default function RolesPoliciesAdmin({ permissions }: PageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const [roles, setRoles] = useState<Schema["AppRole"]["type"][]>([]);
  const [policies, setPolicies] = useState<Schema["RolePolicy"]["type"][]>([]);
  const [status, setStatus] = useState("");

  const [newRole, setNewRole] = useState("");
  const [roleId, setRoleId] = useState<string>("");

  const allPolicyKeys = useMemo(() => Object.keys(POLICY_LABELS) as PolicyKey[], []);

  const load = async () => {
    setStatus("Loading...");
    try {
      const [r, p] = await Promise.all([
        client.models.AppRole.list({ limit: 1000 }),
        client.models.RolePolicy.list({ limit: 10000 }),
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

  const selectedRole = useMemo(() => roles.find((r) => r.id === roleId), [roles, roleId]);

  const rolePolicyMap = useMemo(() => {
    // Map<roleId, Map<policyKey, row>>
    const map = new Map<string, Map<string, Schema["RolePolicy"]["type"]>>();
    for (const row of policies) {
      const rid = String(row.roleId ?? "");
      const key = String((row as any).policyKey ?? "");
      if (!rid || !key) continue;
      const rmap = map.get(rid) ?? new Map<string, Schema["RolePolicy"]["type"]>();
      rmap.set(key, row);
      map.set(rid, rmap);
    }
    return map;
  }, [policies]);

  const getRow = (rid: string, key: PolicyKey) => rolePolicyMap.get(rid)?.get(key);

  const createRole = async () => {
    if (!permissions.canCreate) return;
    setStatus("");
    try {
      const name = newRole.trim();
      if (!name) throw new Error("Role name required.");

      const res = await client.models.AppRole.create({
        name,
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
    if (!permissions.canDelete) return;
    if (!confirm("Delete role? (Policies for it will be removed)")) return;

    setStatus("");
    try {
      const toDelete = policies.filter((x) => x.roleId === id);
      for (const row of toDelete) {
        await client.models.RolePolicy.delete({ id: row.id });
      }

      await client.models.AppRole.delete({ id });

      if (roleId === id) setRoleId("");
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Delete failed.");
    }
  };

  const upsertPolicy = async (rid: string, key: PolicyKey, next: Actions) => {
    if (!permissions.canUpdate) return;
    setStatus("");
    try {
      const existing = getRow(rid, key);

      if (!existing) {
        await client.models.RolePolicy.create({
          roleId: rid,
          // Most schemas store this as a string/enum. Keep it safe:
          policyKey: key as any,
          canRead: next.canRead,
          canCreate: next.canCreate,
          canUpdate: next.canUpdate,
          canDelete: next.canDelete,
          canApprove: next.canApprove,
          createdAt: new Date().toISOString(),
        } as any);
      } else {
        await client.models.RolePolicy.update({
          id: existing.id,
          canRead: next.canRead,
          canCreate: next.canCreate,
          canUpdate: next.canUpdate,
          canDelete: next.canDelete,
          canApprove: next.canApprove,
        });
      }

      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Update policy failed.");
    }
  };

  const setPreset = async (preset: "NONE" | "READ" | "FULL", policyKey: PolicyKey) => {
    if (!selectedRole) return;
    if (!permissions.canUpdate) return;

    const next =
      preset === "NONE" ? { ...EMPTY } :
      preset === "READ" ? { ...EMPTY, canRead: true } :
      { ...FULL };

    await upsertPolicy(selectedRole.id, policyKey, next);
  };

  return (
    <div style={{ padding: 24, width: "100%", maxWidth: "100%" }}>
      <h2>Roles & Policies</h2>
      {status && <p style={{ opacity: 0.8 }}>{status}</p>}

      {/* Create role */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Create Role</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <TextField
            label="Role name"
            value={newRole}
            onChange={(e) => setNewRole((e.target as HTMLInputElement).value)}
          />
          <Button variation="primary" onClick={createRole} isDisabled={!permissions.canCreate}>
            Create
          </Button>
          <Button onClick={load}>Refresh</Button>
        </div>
        {!permissions.canCreate && (
          <p style={{ marginTop: 8, opacity: 0.7, fontSize: 12 }}>Create is disabled by policy.</p>
        )}
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
            <Button variation="destructive" onClick={() => deleteRole(selectedRole.id)} isDisabled={!permissions.canDelete}>
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
            <table style={{ width: "100%", minWidth: 1200, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ padding: 10 }}>Policy (Page)</th>
                  <th style={{ padding: 10 }}>Read</th>
                  <th style={{ padding: 10 }}>Create</th>
                  <th style={{ padding: 10 }}>Update</th>
                  <th style={{ padding: 10 }}>Delete</th>
                  <th style={{ padding: 10 }}>Approve</th>
                  <th style={{ padding: 10 }}>Presets</th>
                </tr>
              </thead>

              <tbody>
                {allPolicyKeys.map((key) => {
                  const row = getRow(selectedRole.id, key);

                  const current: Actions = row
                    ? {
                        canRead: toBool((row as any).canRead),
                        canCreate: toBool((row as any).canCreate),
                        canUpdate: toBool((row as any).canUpdate),
                        canDelete: toBool((row as any).canDelete),
                        canApprove: toBool((row as any).canApprove),
                      }
                    : { ...EMPTY };

                  const disabled = !permissions.canUpdate;

                  const toggle = (field: keyof Actions) => {
                    if (disabled) return;
                    const next = { ...current, [field]: !current[field] };
                    upsertPolicy(selectedRole.id, key, next);
                  };

                  return (
                    <tr key={key} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: 10, fontWeight: 600 }}>{POLICY_LABELS[key]}</td>

                      <td style={{ padding: 10 }}>
                        <Button onClick={() => toggle("canRead")} isDisabled={disabled}>
                          {current.canRead ? "Enabled" : "Disabled"}
                        </Button>
                      </td>

                      <td style={{ padding: 10 }}>
                        <Button onClick={() => toggle("canCreate")} isDisabled={disabled}>
                          {current.canCreate ? "Enabled" : "Disabled"}
                        </Button>
                      </td>

                      <td style={{ padding: 10 }}>
                        <Button onClick={() => toggle("canUpdate")} isDisabled={disabled}>
                          {current.canUpdate ? "Enabled" : "Disabled"}
                        </Button>
                      </td>

                      <td style={{ padding: 10 }}>
                        <Button onClick={() => toggle("canDelete")} isDisabled={disabled}>
                          {current.canDelete ? "Enabled" : "Disabled"}
                        </Button>
                      </td>

                      <td style={{ padding: 10 }}>
                        <Button onClick={() => toggle("canApprove")} isDisabled={disabled}>
                          {current.canApprove ? "Enabled" : "Disabled"}
                        </Button>
                      </td>

                      <td style={{ padding: 10 }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <Button onClick={() => setPreset("NONE", key)} isDisabled={disabled}>None</Button>
                          <Button onClick={() => setPreset("READ", key)} isDisabled={disabled}>Read</Button>
                          <Button onClick={() => setPreset("FULL", key)} isDisabled={disabled}>Full</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            Tip: A page appears for a user only if their effective role policies have <b>Read = Enabled</b>.
          </p>
        </div>
      )}
    </div>
  );
}
