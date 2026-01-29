// src/pages/UserAdmin.tsx
import { useEffect, useMemo, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";

const client = generateClient<Schema>();
type Dept = { key: string; name: string };

export default function Users({ permissions }: PageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [departmentKey, setDepartmentKey] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [users, setUsers] = useState<Schema["UserProfile"]["type"][]>([]);
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
      const [up, deptRes] = await Promise.all([
        client.models.UserProfile.list({ limit: 2000 }),
        client.queries.adminListDepartments({}),
      ]);

      const sorted = [...(up.data ?? [])].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      const deptList = ((deptRes?.data as any)?.departments ?? []) as Dept[];

      setUsers(sorted);
      setDepartments(deptList);
      setStatus(`Loaded ${sorted.length} users.`);
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
    return users.filter((u) => `${u.email} ${u.fullName} ${u.departmentName}`.toLowerCase().includes(q));
  }, [users, search]);

  const invite = async () => {
    if (!permissions.canCreate) return;
    setInviteStatus("Inviting...");
    try {
      const e = email.trim().toLowerCase();
      const n = fullName.trim();
      if (!e || !n) throw new Error("Email and full name are required.");
      if (!departmentKey) throw new Error("Select a department.");

      const dept = departments.find((d) => d.key === departmentKey);

      await client.mutations.inviteUser({
        email: e,
        fullName: n,
        departmentKey,
        departmentName: dept?.name ?? "",
      });

      setInviteStatus(`Invitation sent to ${e}.`);
      setEmail("");
      setFullName("");
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

  const setDepartmentForUser = async (u: Schema["UserProfile"]["type"], deptKey: string) => {
    if (!permissions.canUpdate) return;
    if (!u.email) return;

    setStatus("");
    try {
      const dept = departments.find((d) => d.key === deptKey);
      await client.mutations.adminSetUserDepartment({
        email: u.email,
        departmentKey: deptKey,
        departmentName: dept?.name ?? "",
      });
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to set department.");
    }
  };

  const toggleActive = async (u: Schema["UserProfile"]["type"]) => {
    if (!permissions.canUpdate) return;
    if (!u.email) return;

    setStatus("");
    try {
      await client.mutations.adminSetUserActive({ email: u.email, isActive: !u.isActive });
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to change status.");
    }
  };

  const deleteUser = async (u: Schema["UserProfile"]["type"]) => {
    if (!permissions.canDelete) return;
    if (!u.email) return;

    const ok = confirm(`Delete user ${u.email}? This cannot be undone.`);
    if (!ok) return;

    setStatus("");
    try {
      await client.mutations.adminDeleteUser({ email: u.email });
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to delete user.");
    }
  };

  return (
    <div style={{ padding: 24, width: "100%", maxWidth: "100%" }}>
      <h2>Users</h2>

      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Invite user</h3>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <TextField label="Full name" value={fullName} onChange={(e) => setFullName((e.target as HTMLInputElement).value)} />
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
                  <td style={{ padding: 10 }}>{u.fullName}</td>
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
                      Current: {u.departmentName ?? "-"}
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
