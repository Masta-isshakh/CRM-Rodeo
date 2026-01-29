import { useEffect, useMemo, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type Dept = { name: string; description?: string };

export default function DepartmentsAdmin() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [departments, setDepartments] = useState<Dept[]>([]);
  const [roles, setRoles] = useState<Schema["AppRole"]["type"][]>([]);
  const [links, setLinks] = useState<Schema["DepartmentRoleLink"]["type"][]>([]);

  const [newDept, setNewDept] = useState("");
  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("");

  const load = async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [deptRes, rolesRes, linksRes] = await Promise.all([
        client.mutations.adminListDepartments({}),
        client.models.AppRole.list({ limit: 1000 }),
        client.models.DepartmentRoleLink.list({ limit: 5000 }),
      ]);

      const deptList = (deptRes?.data as any)?.departments ?? [];
      setDepartments(deptList);
      setRoles(rolesRes.data ?? []);
      setLinks(linksRes.data ?? []);
      setStatus("");
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const roleIdsByDept = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const l of links) {
      const arr = map.get(l.departmentName) ?? [];
      arr.push(l.roleId);
      map.set(l.departmentName, arr);
    }
    return map;
  }, [links]);

  const createDept = async () => {
    setStatus("");
    try {
      const name = newDept.trim();
      if (!name) throw new Error("Department name required");
      await client.mutations.adminCreateDepartment({ departmentName: name });
      setNewDept("");
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Create failed");
    }
  };

  const renameDept = async () => {
    setStatus("");
    try {
      const oldName = renameFrom.trim();
      const newName = renameTo.trim();
      if (!oldName || !newName) throw new Error("Select old and new name");
      await client.mutations.adminRenameDepartment({ oldName, newName });
      setRenameFrom("");
      setRenameTo("");
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Rename failed");
    }
  };

  const deleteDept = async (name: string) => {
    const ok = confirm(`Delete department "${name}"?\n\nIt must have NO users.`);
    if (!ok) return;

    setStatus("");
    try {
      await client.mutations.adminDeleteDepartment({ departmentName: name });
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Delete failed");
    }
  };

  const assignRole = async (departmentName: string, roleId: string) => {
    if (!roleId) return;
    setStatus("");
    try {
      // prevent duplicates
      const exists = links.some((l) => l.departmentName === departmentName && l.roleId === roleId);
      if (exists) return;

      await client.models.DepartmentRoleLink.create({
        departmentName,
        roleId,
        createdAt: new Date().toISOString(),
      });
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Assign failed");
    }
  };

  const removeRole = async (departmentName: string, roleId: string) => {
    setStatus("");
    try {
      const link = links.find((l) => l.departmentName === departmentName && l.roleId === roleId);
      if (!link?.id) return;
      await client.models.DepartmentRoleLink.delete({ id: link.id });
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Remove failed");
    }
  };

  return (
    <div style={{ padding: 24, width: "100%" }}>
      <h2>Departments (Cognito Groups)</h2>
      {status && <p style={{ opacity: 0.8 }}>{status}</p>}

      {/* Create */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Create Department</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <TextField label="Department name" value={newDept} onChange={(e) => setNewDept((e.target as HTMLInputElement).value)} />
          <Button variation="primary" onClick={createDept} isLoading={loading}>Create</Button>
          <Button onClick={load} isLoading={loading}>Refresh</Button>
        </div>
      </div>

      {/* Rename */}
      <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Rename Department</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <SelectField label="Old name" value={renameFrom} onChange={(e) => setRenameFrom((e.target as HTMLSelectElement).value)}>
            <option value="">Select...</option>
            {departments.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </SelectField>

          <TextField label="New name" value={renameTo} onChange={(e) => setRenameTo((e.target as HTMLInputElement).value)} />
          <Button variation="primary" onClick={renameDept}>Rename</Button>
        </div>
        <p style={{ opacity: 0.75, marginTop: 8 }}>
          Renaming migrates users + updates mappings, then deletes the old group.
        </p>
      </div>

      {/* List + Assign Roles */}
      <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Departments</h3>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: 10 }}>Department</th>
                <th style={{ padding: 10 }}>Roles assigned</th>
                <th style={{ padding: 10 }}>Add role</th>
                <th style={{ padding: 10 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => {
                const currentRoleIds = roleIdsByDept.get(d.name) ?? [];
                return (
                  <tr key={d.name} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: 10, fontWeight: 600 }}>{d.name}</td>

                    <td style={{ padding: 10 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {currentRoleIds.map((rid) => {
                          const role = roles.find((r) => r.id === rid);
                          return (
                            <span key={rid} style={{ border: "1px solid #ddd", borderRadius: 999, padding: "4px 10px" }}>
                              {role?.name ?? rid}
                              <button
                                style={{ marginLeft: 8, border: "none", background: "transparent", cursor: "pointer" }}
                                onClick={() => removeRole(d.name, rid)}
                                title="Remove role"
                              >
                                ✕
                              </button>
                            </span>
                          );
                        })}
                        {!currentRoleIds.length && <span style={{ opacity: 0.7 }}>No roles</span>}
                      </div>
                    </td>

                    <td style={{ padding: 10 }}>
                      <SelectField label="" onChange={(e) => assignRole(d.name, (e.target as HTMLSelectElement).value)}>
                        <option value="">Select role...</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </SelectField>
                    </td>

                    <td style={{ padding: 10 }}>
                      <Button variation="destructive" onClick={() => deleteDept(d.name)} isDisabled={d.name === "ADMIN"}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                );
              })}

              {!departments.length && (
                <tr><td colSpan={4} style={{ padding: 12, opacity: 0.7 }}>No departments yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
