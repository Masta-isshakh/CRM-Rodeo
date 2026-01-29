import { useEffect, useMemo, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";

const client = generateClient<Schema>();

type Dept = { key: string; name: string };
type AnyRow = Record<string, any>;

function safeJson(v: any) {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function normalizeDepartments(rawRes: any): Dept[] {
  const raw0 = rawRes?.data ?? rawRes;
  const raw = safeJson(raw0);

  const container =
    raw?.departments ??
    raw?.groups ??
    raw?.items ??
    raw?.data?.departments ??
    raw?.data?.groups ??
    raw?.data?.items ??
    [];

  const arr = Array.isArray(container) ? container : [];
  const mapped = arr
    .map((x: any) => {
      if (typeof x === "string") return { key: x, name: x };

      // cognito listGroups shape
      const key =
        x.key ??
        x.departmentKey ??
        x.GroupName ??
        x.groupName ??
        x.name ??
        x.Name ??
        "";

      const name =
        x.name ??
        x.departmentName ??
        x.Description ??
        x.description ??
        key;

      return { key: String(key).trim(), name: String(name).trim() };
    })
    .filter((d: Dept) => d.key);

  // de-dup + sort
  const uniq = new Map<string, Dept>();
  for (const d of mapped) uniq.set(d.key, d);
  return Array.from(uniq.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export default function DepartmentsAdmin({ permissions }: PageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [departments, setDepartments] = useState<Dept[]>([]);

  const AppRoleModel = (client.models as any).AppRole as any;
  const LinkModel = (client.models as any).DepartmentRoleLink as any;

  const [roles, setRoles] = useState<AnyRow[]>([]);
  const [links, setLinks] = useState<AnyRow[]>([]);

  const [newDept, setNewDept] = useState("");
  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("");

  const adminListDepartments = (client.queries as any)?.adminListDepartments;
  const adminCreateDepartment = (client.mutations as any)?.adminCreateDepartment;
  const adminRenameDepartment = (client.mutations as any)?.adminRenameDepartment;
  const adminDeleteDepartment = (client.mutations as any)?.adminDeleteDepartment;

  const load = async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [deptRes, rolesRes, linksRes] = await Promise.all([
        adminListDepartments ? adminListDepartments({}) : Promise.resolve({ data: { departments: [] } }),
        AppRoleModel ? AppRoleModel.list({ limit: 1000 }) : Promise.resolve({ data: [] }),
        LinkModel ? LinkModel.list({ limit: 5000 }) : Promise.resolve({ data: [] }),
      ]);

      const deptList = normalizeDepartments(deptRes);

      setDepartments(deptList);
      setRoles((rolesRes.data ?? []) as AnyRow[]);
      setLinks((linksRes.data ?? []) as AnyRow[]);
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
      const dk = String(l.departmentKey ?? "").trim();
      if (!dk) continue;
      const arr = map.get(dk) ?? [];
      const rid = String(l.roleId ?? "").trim();
      if (rid) arr.push(rid);
      map.set(dk, arr);
    }
    return map;
  }, [links]);

  const createDept = async () => {
    if (!permissions.canCreate) return;
    setStatus("");
    try {
      const name = newDept.trim();
      if (!name) throw new Error("Department name required");
      if (!adminCreateDepartment) throw new Error("adminCreateDepartment mutation is missing.");

      const res = await adminCreateDepartment({ departmentName: name });

      // optimistic add (handles eventual consistency + bad list response)
      const payload = safeJson(res?.data ?? res) as any;
      const created =
        payload?.department ??
        payload?.created ??
        payload;

      const key = String(created?.key ?? created?.departmentKey ?? created?.GroupName ?? name).trim();
      const disp = String(created?.name ?? created?.departmentName ?? created?.Description ?? name).trim();

      setDepartments((prev) => {
        const exists = prev.some((d) => d.key === key);
        const next = exists ? prev : [...prev, { key, name: disp }];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });

      setNewDept("");
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Create failed");
    }
  };

  const renameDept = async () => {
    if (!permissions.canUpdate) return;
    setStatus("");
    try {
      const oldKey = renameFrom.trim();
      const newName = renameTo.trim();
      if (!oldKey || !newName) throw new Error("Select old and enter new name");
      if (!adminRenameDepartment) throw new Error("adminRenameDepartment mutation is missing.");

      await adminRenameDepartment({ oldKey, newName });
      setRenameFrom("");
      setRenameTo("");
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Rename failed");
    }
  };

  const deleteDept = async (departmentKey: string) => {
    if (!permissions.canDelete) return;
    const ok = confirm(`Delete department "${departmentKey}"?\n\nIt must have NO users.`);
    if (!ok) return;

    setStatus("");
    try {
      if (!adminDeleteDepartment) throw new Error("adminDeleteDepartment mutation is missing.");
      await adminDeleteDepartment({ departmentKey });
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Delete failed");
    }
  };

  const assignRole = async (department: Dept, roleId: string) => {
    if (!permissions.canUpdate) return;
    if (!roleId) return;

    setStatus("");
    try {
      if (!LinkModel) throw new Error("DepartmentRoleLink model missing.");

      const exists = links.some(
        (l) => String(l.departmentKey) === department.key && String(l.roleId) === roleId
      );
      if (exists) return;

      await LinkModel.create({
        departmentKey: department.key,
        departmentName: department.name,
        roleId,
        createdAt: new Date().toISOString(),
      });

      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Assign failed");
    }
  };

  const removeRole = async (departmentKey: string, roleId: string) => {
    if (!permissions.canUpdate) return;
    setStatus("");
    try {
      if (!LinkModel) throw new Error("DepartmentRoleLink model missing.");
      const link = links.find(
        (l) => String(l.departmentKey) === departmentKey && String(l.roleId) === roleId
      );
      if (!link?.id) return;

      await LinkModel.delete({ id: link.id });
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

      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Create Department</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <TextField
            label="Department name"
            value={newDept}
            onChange={(e) => setNewDept((e.target as HTMLInputElement).value)}
          />
          <Button variation="primary" onClick={createDept} isLoading={loading} isDisabled={!permissions.canCreate}>
            Create
          </Button>
          <Button onClick={load} isLoading={loading}>Refresh</Button>
        </div>
      </div>

      <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Rename Department</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <SelectField label="Old department" value={renameFrom} onChange={(e) => setRenameFrom((e.target as HTMLSelectElement).value)}>
            <option value="">Select...</option>
            {departments.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name} ({d.key})
              </option>
            ))}
          </SelectField>

          <TextField label="New name" value={renameTo} onChange={(e) => setRenameTo((e.target as HTMLInputElement).value)} />
          <Button variation="primary" onClick={renameDept} isDisabled={!permissions.canUpdate}>
            Rename
          </Button>
        </div>
        <p style={{ opacity: 0.75, marginTop: 8 }}>
          Renaming creates a new group key, migrates users + mappings, then deletes the old group.
        </p>
      </div>

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
                const currentRoleIds = roleIdsByDept.get(d.key) ?? [];
                return (
                  <tr key={d.key} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: 10, fontWeight: 600 }}>
                      {d.name}
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{d.key}</div>
                    </td>

                    <td style={{ padding: 10 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {currentRoleIds.map((rid) => {
                          const role = roles.find((r) => String(r.id) === String(rid));
                          return (
                            <span key={rid} style={{ border: "1px solid #ddd", borderRadius: 999, padding: "4px 10px" }}>
                              {role?.name ?? rid}
                              <button
                                style={{
                                  marginLeft: 8,
                                  border: "none",
                                  background: "transparent",
                                  cursor: permissions.canUpdate ? "pointer" : "not-allowed",
                                  opacity: permissions.canUpdate ? 1 : 0.5,
                                }}
                                onClick={() => permissions.canUpdate && removeRole(d.key, rid)}
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
                      <SelectField
                        label=""
                        onChange={(e) => assignRole(d, (e.target as HTMLSelectElement).value)}
                        isDisabled={!permissions.canUpdate}
                      >
                        <option value="">Select role...</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </SelectField>
                    </td>

                    <td style={{ padding: 10 }}>
                      <Button variation="destructive" onClick={() => deleteDept(d.key)} isDisabled={!permissions.canDelete}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                );
              })}

              {!departments.length && (
                <tr>
                  <td colSpan={4} style={{ padding: 12, opacity: 0.7 }}>
                    No departments yet.
                  </td>
                </tr>
              )}
            </tbody>

          </table>
        </div>
      </div>
    </div>
  );
}
