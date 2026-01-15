import { useEffect, useMemo, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

type Role = "ADMIN" | "SALES" | "SALES_MANAGER" | "SUPPORT";

export default function Users() {
  // Invite form
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("SALES");
  const [inviteStatus, setInviteStatus] = useState<string>("");

  // Listing
  const [loading, setLoading] = useState(false);
  const [listStatus, setListStatus] = useState<string>("");
  const [users, setUsers] = useState<Schema["UserProfile"]["type"][]>([]);
  const [search, setSearch] = useState("");

  // Row action states
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [togglingActiveId, setTogglingActiveId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Local edited role values per user id
  const [roleDraft, setRoleDraft] = useState<Record<string, Role>>({});

  const inviteLink = useMemo(() => {
    const e = email.trim().toLowerCase();
    if (!e) return "";
    return `${window.location.origin}/set-password?email=${encodeURIComponent(e)}`;
  }, [email]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;

    return users.filter((u) => {
      const hay = `${u.email ?? ""} ${u.fullName ?? ""} ${u.role ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [users, search]);

  const loadUsers = async () => {
    setLoading(true);
    setListStatus("");
    try {
      const res = await client.models.UserProfile.list({ limit: 1000 });
      const sorted = [...(res.data ?? [])].sort((a, b) => {
        const at = a.createdAt ?? "";
        const bt = b.createdAt ?? "";
        return bt.localeCompare(at);
      });

      setUsers(sorted);

      // Initialize drafts
      const draft: Record<string, Role> = {};
      for (const u of sorted) {
        if (u.id && u.role) draft[u.id] = u.role as Role;
      }
      setRoleDraft(draft);

      setListStatus(`Loaded ${sorted.length} users.`);
    } catch (e: any) {
      console.error(e);
      setListStatus(e?.message ?? "Failed to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const invite = async () => {
    setInviteStatus("Inviting...");
    try {
      const e = email.trim().toLowerCase();
      const n = fullName.trim();
      if (!e || !n) throw new Error("Email and full name are required.");

      await client.mutations.inviteUser({ email: e, fullName: n, role });

      setInviteStatus(`Invitation sent to ${e}.`);
      setEmail("");
      setFullName("");
      await loadUsers();
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

  const saveRole = async (u: Schema["UserProfile"]["type"]) => {
    if (!u.id || !u.email) return;
    const newRole = roleDraft[u.id];
    if (!newRole) return;

    setSavingRoleId(u.id);
    setListStatus("");
    try {
      // Updates both Cognito group + Data role
      await client.mutations.adminUpdateUserRole({
        email: u.email,
        role: newRole,
      });

      setListStatus(`Role updated for ${u.email} → ${newRole}`);
      await loadUsers();
    } catch (e: any) {
      console.error(e);
      setListStatus(e?.message ?? "Failed to update role.");
    } finally {
      setSavingRoleId(null);
    }
  };

  const toggleActive = async (u: Schema["UserProfile"]["type"]) => {
    if (!u.id || !u.email) return;

    setTogglingActiveId(u.id);
    setListStatus("");
    try {
      const next = !u.isActive;

      // Updates both Cognito enabled/disabled + Data isActive
      await client.mutations.adminSetUserActive({
        email: u.email,
        isActive: next,
      });

      setListStatus(`${u.email} is now ${next ? "ENABLED" : "DISABLED"}.`);
      await loadUsers();
    } catch (e: any) {
      console.error(e);
      setListStatus(e?.message ?? "Failed to change active status.");
    } finally {
      setTogglingActiveId(null);
    }
  };

  const deleteUser = async (u: Schema["UserProfile"]["type"]) => {
    if (!u.id || !u.email) return;

    const ok = window.confirm(
      `Delete user "${u.email}"?\n\nThis will delete from Cognito and remove the UserProfile record.\nThis action cannot be undone.`
    );
    if (!ok) return;

    setDeletingId(u.id);
    setListStatus("");
    try {
      await client.mutations.adminDeleteUser({ email: u.email });

      setListStatus(`Deleted user ${u.email}.`);
      await loadUsers();
    } catch (e: any) {
      console.error(e);
      setListStatus(e?.message ?? "Failed to delete user.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h2>Users (Admin)</h2>
      <p style={{ opacity: 0.8 }}>
        Invite users, edit roles, disable/enable accounts, and delete users.
      </p>

      {/* INVITE */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Invite user</h3>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <TextField
            label="Full name"
            value={fullName}
            onChange={(e) => setFullName((e.target as HTMLInputElement).value)}
          />

          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
          />

          <SelectField
            label="Role"
            value={role}
            onChange={(e) => setRole((e.target as HTMLSelectElement).value as Role)}
          >
            <option value="ADMIN">ADMIN</option>
            <option value="SALES">SALES</option>
            <option value="SALES_MANAGER">SALES_MANAGER</option>
            <option value="SUPPORT">SUPPORT</option>
          </SelectField>

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <Button variation="primary" onClick={invite}>
              Invite
            </Button>
            <Button onClick={copyInviteLink} isDisabled={!inviteLink}>
              Copy set-password link
            </Button>
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Set-password link</div>
          <div style={{ wordBreak: "break-all" }}>
            {inviteLink || "Enter an email to generate the link."}
          </div>
        </div>

        {inviteStatus && (
          <div style={{ marginTop: 12, padding: 10, border: "1px solid #eee", borderRadius: 8 }}>
            {inviteStatus}
          </div>
        )}
      </div>

      {/* LIST */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          padding: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <h3 style={{ margin: 0 }}>Existing users</h3>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <TextField
              label="Search"
              placeholder="email, name, role..."
              value={search}
              onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
            />
            <Button onClick={loadUsers} isLoading={loading}>
              Refresh
            </Button>
          </div>
        </div>

        {listStatus && (
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
            {listStatus}
          </div>
        )}

        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: "10px 8px" }}>Full name</th>
                <th style={{ padding: "10px 8px" }}>Email</th>
                <th style={{ padding: "10px 8px" }}>Role</th>
                <th style={{ padding: "10px 8px" }}>Active</th>
                <th style={{ padding: "10px 8px" }}>Created</th>
                <th style={{ padding: "10px 8px" }}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "10px 8px" }}>{u.fullName}</td>
                  <td style={{ padding: "10px 8px" }}>{u.email}</td>

                  <td style={{ padding: "10px 8px" }}>
                    <SelectField
                      label=""
                      value={u.id ? roleDraft[u.id] ?? (u.role as Role) : (u.role as Role)}
                      onChange={(e) => {
                        if (!u.id) return;
                        const v = (e.target as HTMLSelectElement).value as Role;
                        setRoleDraft((prev) => ({ ...prev, [u.id!]: v }));
                      }}
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="SALES">SALES</option>
                      <option value="SALES_MANAGER">SALES_MANAGER</option>
                      <option value="SUPPORT">SUPPORT</option>
                    </SelectField>
                  </td>

                  <td style={{ padding: "10px 8px" }}>
                    {u.isActive ? "Yes" : "No"}
                  </td>

                  <td style={{ padding: "10px 8px" }}>
                    {u.createdAt ? new Date(u.createdAt).toLocaleString() : "-"}
                  </td>

                  <td style={{ padding: "10px 8px" }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button
                        size="small"
                        onClick={() => saveRole(u)}
                        isLoading={savingRoleId === u.id}
                      >
                        Save role
                      </Button>

                      <Button
                        size="small"
                        onClick={() => toggleActive(u)}
                        isLoading={togglingActiveId === u.id}
                      >
                        {u.isActive ? "Disable" : "Enable"}
                      </Button>

                      <Button
                        size="small"
                        variation="destructive"
                        onClick={() => deleteUser(u)}
                        isLoading={deletingId === u.id}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}

              {!filtered.length && (
                <tr>
                  <td colSpan={6} style={{ padding: 12, opacity: 0.7 }}>
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
          This list comes from the UserProfile table. Role changes / disable / delete are synchronized with Cognito.
        </div>
      </div>
    </div>
  );
}
