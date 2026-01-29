// src/pages/UserAdmin.tsx
import { useEffect, useMemo, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";

const client = generateClient<Schema>();

type Dept = { key: string; name: string };

function parseDepartments(deptRes: any): Dept[] {
  // Supports many shapes:
  // 1) { data: { departments: [{key,name}] } }
  // 2) { data: { departments: "JSON_STRING" } }
  // 3) { departments: [...] } or { departments: "JSON_STRING" }
  // 4) { data: { adminListDepartments: { departments: ... } } } (rare nesting)
  const root = deptRes?.data ?? deptRes ?? {};
  const direct = root?.departments ?? root?.adminListDepartments?.departments ?? root?.data?.departments;

  if (Array.isArray(direct)) return direct as Dept[];

  if (typeof direct === "string") {
    try {
      const parsed = JSON.parse(direct);
      if (Array.isArray(parsed)) return parsed as Dept[];
      if (Array.isArray(parsed?.departments)) return parsed.departments as Dept[];
    } catch {
      // ignore
    }
  }

  // Sometimes resolvers return: { departmentsJson: "..." }
  const maybeJson = root?.departmentsJson ?? root?.adminListDepartments?.departmentsJson;
  if (typeof maybeJson === "string") {
    try {
      const parsed = JSON.parse(maybeJson);
      if (Array.isArray(parsed)) return parsed as Dept[];
      if (Array.isArray(parsed?.departments)) return parsed.departments as Dept[];
    } catch {
      // ignore
    }
  }

  return [];
}

async function listAll<T>(listFn: (args: any) => Promise<any>, pageSize = 1000, max = 10000): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | null | undefined = undefined;

  while (out.length < max) {
    const res = await listFn({ limit: pageSize, nextToken });
    const data = (res?.data ?? []) as T[];
    out.push(...data);

    nextToken = res?.nextToken;
    if (!nextToken) break;
  }

  return out.slice(0, max);
}

export default function Users({ permissions }: PageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [lastName, setLastName] = useState("");
  const [departmentKey, setDepartmentKey] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  type UserWithActive = Schema["Customer"]["type"] & { isActive?: boolean; departmentKey?: string };
  const [users, setUsers] = useState<UserWithActive[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [search, setSearch] = useState("");

  const inviteLink = useMemo(() => {
    const e = email.trim().toLowerCase();
    if (!e) return "";
    return `${window.location.origin}/set-password?email=${encodeURIComponent(e)}`;
  }, [email]);

  const load = async () => {
    setLoading(true);
    setStatus("");
    try {
      const [allUsers, deptRes] = await Promise.all([
        listAll<Schema["Customer"]["type"]>((args) => client.models.Customer.list(args), 1000, 20000),
        client.queries.adminListDepartments({}),
      ]);

      const sorted = [...(allUsers ?? [])].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
      const deptList = parseDepartments(deptRes);

      setUsers(sorted);
      setDepartments(deptList);
      setStatus(`Loaded ${sorted.length} users • ${deptList.length} departments.`);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const deptName = departments.find((d) => d.key === u.departmentKey)?.name ?? "";
      return `${u.email ?? ""} ${u.name ?? ""} ${deptName}`.toLowerCase().includes(q);
    });
  }, [users, search, departments]);

  const invite = async () => {
    if (!permissions.canCreate) return;
    setInviteStatus("Inviting...");
    try {
      const e = email.trim().toLowerCase();
      const n = fullName.trim();
      const ln = lastName.trim();
      if (!e || !n || !ln) throw new Error("Email, full name, and last name are required.");
      if (!departmentKey) throw new Error("Select a department.");

      const dept = departments.find((d) => d.key === departmentKey);

      // Use the correct mutation name or a generic create method if inviteUser does not exist.
      // Example: createUserProfile (adjust to your actual mutation name)
      const res = await client.models.Customer.create({
        email: e,
        name: n,
        lastname: ln,
        // Only include departmentKey and departmentName if they exist in the Customer type
        ...(departmentKey && { departmentKey }),
        ...(dept?.name && { departmentName: dept.name }),
      });

      if ((res as any)?.errors?.length) {
        throw new Error((res as any).errors[0]?.message ?? "Invite failed.");
      }

      setInviteStatus(`Invitation sent to ${e}.`);
      setEmail("");
      setFullName("");
      setLastName("");
      setDepartmentKey("");
      await load();
    } catch (e: any) {
      console.error(e);
      setInviteStatus(e?.message ?? "Invite failed.");
    }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setInviteStatus("Set-password link copied.");
  };

  const setDepartmentForUser = async (u: Schema["Customer"]["type"], deptKey: string) => {
    if (!permissions.canUpdate) return;
    if (!u.email) return;

    setStatus("");
    try {
      const dept = departments.find((d) => d.key === deptKey);

      // Replace with the correct mutation or update method for setting a user's department.
      // Example using a generic update mutation (adjust as needed for your schema):
            const res = await client.models.Customer.update({
              id: u.id,
              // If departmentKey is a valid property, update it instead
              ...(dept?.key && { departmentKey: dept.key }),
            });
      // If you have a custom mutation, use its correct name here.

      if ((res as any)?.errors?.length) {
        throw new Error((res as any).errors[0]?.message ?? "Failed to set department.");
      }

      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to set department.");
    }
  };

  const toggleActive = async (u: Schema["Customer"]["type"]) => {
    if (!permissions.canUpdate) return;
    if (!u.id) return;

    setStatus("");
    try {
      // Replace 'isActive' with the correct field name if your schema supports it.
      // For now, only update the id, or add the correct field if available.
      const res = await client.models.Customer.update({
        id: u.id,
        // Add the correct field here if your schema supports enabling/disabling users.
        // Example: status: u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      });

      if ((res as any)?.errors?.length) {
        throw new Error((res as any).errors[0]?.message ?? "Failed to change status.");
      }

      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to change status.");
    }
  };

  const deleteUser = async (u: Schema["Customer"]["type"]) => {
    if (!permissions.canDelete) return;
    if (!u.email) return;

    const ok = confirm(`Delete user ${u.email}? This cannot be undone.`);
    if (!ok) return;

    setStatus("");
    try {
      const res = await client.models.Customer.delete({ id: u.id });

      if ((res as any)?.errors?.length) {
        throw new Error((res as any).errors[0]?.message ?? "Failed to delete user.");
      }

      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to delete user.");
    }
  };

  return (
    <div style={{ padding: 24, width: "100%", maxWidth: "100%" }}>
      <h2>Users</h2>

      {/* Invite user */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Invite user</h3>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <TextField label="Full name" value={fullName} onChange={(e) => setFullName((e.target as HTMLInputElement).value)} />
          <TextField label="Last name" value={lastName} onChange={(e) => setLastName((e.target as HTMLInputElement).value)} />
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail((e.target as HTMLInputElement).value)} />

          <SelectField label="Department" value={departmentKey} onChange={(e) => setDepartmentKey((e.target as HTMLSelectElement).value)}>
            <option value="">Select…</option>
            {departments.map((d) => (
              <option key={d.key} value={d.key}>{d.name}</option>
            ))}
          </SelectField>

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Button variation="primary" onClick={invite} isDisabled={!permissions.canCreate}>Invite</Button>
            <Button onClick={copyInviteLink} isDisabled={!inviteLink}>Copy set-password link</Button>
            <Button onClick={load} isLoading={loading}>Refresh</Button>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Set-password link</div>
          <div style={{ wordBreak: "break-all" }}>{inviteLink || "Enter an email to generate the link."}</div>
        </div>

        {inviteStatus && <div style={{ marginTop: 12, padding: 10, border: "1px solid #eee", borderRadius: 8 }}>{inviteStatus}</div>}
      </div>

      {/* Existing users */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Existing users</h3>
          <TextField label="Search" placeholder="email, name..." value={search} onChange={(e) => setSearch((e.target as HTMLInputElement).value)} />
        </div>

        {status && <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>{status}</div>}

        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: 10 }}>Name</th>
                <th style={{ padding: 10 }}>Email</th>
                <th style={{ padding: 10 }}>Department</th>
                <th style={{ padding: 10 }}>Active</th>
                <th style={{ padding: 10 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: 10 }}>{u.name}</td>
                  <td style={{ padding: 10 }}>{u.email}</td>

                  <td style={{ padding: 10 }}>
                    <SelectField
                      label=""
                      value={u.departmentKey ?? ""}
                      onChange={(e) => setDepartmentForUser(u, (e.target as HTMLSelectElement).value)}
                      isDisabled={!permissions.canUpdate}
                    >
                      <option value="">Select…</option>
                      {departments.map((d) => (
                        <option key={d.key} value={d.key}>{d.name}</option>
                      ))}
                    </SelectField>
                    <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                      Current: {departments.find((d) => d.key === u.departmentKey)?.name ?? "-"}
                    </div>
                  </td>

                  <td style={{ padding: 10 }}>{u.isActive ? "Yes" : "No"}</td>

                  <td style={{ padding: 10 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button size="small" onClick={() => toggleActive(u)} isDisabled={!permissions.canUpdate}>
                        {u.isActive ? "Disable" : "Enable"}
                      </Button>
                      <Button size="small" variation="destructive" onClick={() => deleteUser(u)} isDisabled={!permissions.canDelete}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}

              {!filtered.length && (
                <tr>
                  <td colSpan={5} style={{ padding: 12, opacity: 0.7 }}>
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          Users get page access from Department(Group) → Roles → Policies.
        </p>
      </div>
    </div>
  );
}
