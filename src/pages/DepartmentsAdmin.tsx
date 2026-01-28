import { useEffect, useMemo, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

export default function DepartmentsAdmin() {
  const [departments, setDepartments] = useState<Schema["Department"]["type"][]>([]);
  const [roles, setRoles] = useState<Schema["AppRole"]["type"][]>([]);
  const [deptRoles, setDeptRoles] = useState<Schema["DepartmentRole"]["type"][]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [newDept, setNewDept] = useState("");

  // drafts (avoid update on every keystroke)
  const [nameDraft, setNameDraft] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    setStatus("");
    try {
      const [d, r, dr] = await Promise.all([
        client.models.Department.list({ limit: 1000 }),
        client.models.AppRole.list({ limit: 1000 }),
        client.models.DepartmentRole.list({ limit: 5000 }),
      ]);

      const dList = d.data ?? [];
      setDepartments(dList);
      setRoles(r.data ?? []);
      setDeptRoles(dr.data ?? []);

      const draft: Record<string, string> = {};
      for (const dep of dList) draft[dep.id] = dep.name ?? "";
      setNameDraft(draft);
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to load.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createDept = async () => {
    setStatus("");
    try {
      const name = newDept.trim();
      if (!name) throw new Error("Department name required.");

      await client.models.Department.create({
        name,
        isActive: true,
        createdAt: new Date().toISOString(),
      });

      setNewDept("");
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Create failed.");
    }
  };

  const saveDeptName = async (depId: string) => {
    setStatus("");
    try {
      const dep = departments.find((x) => x.id === depId);
      if (!dep) return;

      const name = (nameDraft[depId] ?? "").trim();
      if (!name) throw new Error("Name required.");

      await client.models.Department.update({
        id: depId,
        name,
        isActive: !!dep.isActive,
      });

      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Update failed.");
    }
  };

  const toggleDeptActive = async (depId: string) => {
    setStatus("");
    try {
      const dep = departments.find((x) => x.id === depId);
      if (!dep) return;

      await client.models.Department.update({
        id: depId,
        name: dep.name,
        isActive: !dep.isActive,
      });

      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Update failed.");
    }
  };

  const deleteDept = async (depId: string) => {
    if (!confirm("Delete department?")) return;
    setStatus("");
    try {
      const links = deptRoles.filter((x) => x.departmentId === depId);
      for (const l of links) await client.models.DepartmentRole.delete({ id: l.id });

      await client.models.Department.delete({ id: depId });
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Delete failed.");
    }
  };

  const rolesForDept = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const dr of deptRoles) {
      const arr = map.get(dr.departmentId) ?? [];
      arr.push(dr.roleId);
      map.set(dr.departmentId, arr);
    }
    return map;
  }, [deptRoles]);

  const addRoleToDept = async (departmentId: string, roleId: string) => {
    setStatus("");
    try {
      if (!roleId) return;
      const exists = deptRoles.some((x) => x.departmentId === departmentId && x.roleId === roleId);
      if (exists) return;

      await client.models.DepartmentRole.create({ departmentId, roleId });
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Assign failed.");
    }
  };

  const removeRoleFromDept = async (departmentId: string, roleId: string) => {
    setStatus("");
    try {
      const link = deptRoles.find((x) => x.departmentId === departmentId && x.roleId === roleId);
      if (!link) return;

      await client.models.DepartmentRole.delete({ id: link.id });
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Remove failed.");
    }
  };

  return (
    <div style={{ padding: 24, width: "100%", maxWidth: "100%" }}>
      <h2>Departments (Admin)</h2>
      {status && <p style={{ opacity: 0.85 }}>{status}</p>}

      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Create Department</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <TextField
            label="Name"
            value={newDept}
            onChange={(e) => setNewDept((e.target as HTMLInputElement).value)}
          />
          <Button variation="primary" onClick={createDept}>
            Create
          </Button>
          <Button onClick={load} isLoading={loading}>
            Refresh
          </Button>
        </div>
      </div>

      <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Departments</h3>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: 10 }}>Name</th>
                <th style={{ padding: 10 }}>Active</th>
                <th style={{ padding: 10 }}>Roles in Department</th>
                <th style={{ padding: 10 }}>Add Role</th>
                <th style={{ padding: 10 }}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {departments.map((d) => {
                const currentRoleIds = rolesForDept.get(d.id) ?? [];
                return (
                  <tr key={d.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: 10 }}>
                      <TextField
                        label=""
                        value={nameDraft[d.id] ?? ""}
                        onChange={(e) =>
                          setNameDraft((prev) => ({ ...prev, [d.id]: (e.target as HTMLInputElement).value }))
                        }
                      />
                    </td>

                    <td style={{ padding: 10 }}>{d.isActive ? "Yes" : "No"}</td>

                    <td style={{ padding: 10 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {currentRoleIds.map((rid) => {
                          const role = roles.find((r) => r.id === rid);
                          return (
                            <span key={rid} style={{ border: "1px solid #ddd", borderRadius: 999, padding: "4px 10px" }}>
                              {role?.name ?? rid}
                              <button
                                style={{ marginLeft: 8, border: "none", background: "transparent", cursor: "pointer" }}
                                onClick={() => removeRoleFromDept(d.id, rid)}
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
                      <SelectField label="" onChange={(e) => addRoleToDept(d.id, (e.target as HTMLSelectElement).value)}>
                        <option value="">Select role…</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </SelectField>
                    </td>

                    <td style={{ padding: 10 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Button onClick={() => saveDeptName(d.id)}>Save</Button>
                        <Button onClick={() => toggleDeptActive(d.id)}>
                          {d.isActive ? "Disable" : "Enable"}
                        </Button>
                        <Button variation="destructive" onClick={() => deleteDept(d.id)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!departments.length && (
                <tr>
                  <td colSpan={5} style={{ padding: 12, opacity: 0.7 }}>
                    No departments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
          If Department.create is undefined, your backend schema is not deployed yet. Run: npx ampx sandbox and restart Vite.
        </div>
      </div>
    </div>
  );
}
