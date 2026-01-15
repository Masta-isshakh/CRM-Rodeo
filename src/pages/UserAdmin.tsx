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
      // Admin-only page: ADMIN has group access to list all profiles
      const res = await client.models.UserProfile.list({
        limit: 1000,
      });

      // If you have pagination later, handle res.nextToken
      const sorted = [...(res.data ?? [])].sort((a, b) => {
        const at = a.createdAt ?? "";
        const bt = b.createdAt ?? "";
        return bt.localeCompare(at);
      });

      setUsers(sorted);
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

      await client.mutations.inviteUser({
        email: e,
        fullName: n,
        role,
      });

      setInviteStatus(`Invitation sent to ${e}.`);
      setEmail("");
      setFullName("");

      // Refresh list after invite
      await loadUsers();
    } catch (e: any) {
      console.error(e);
      setInviteStatus(e?.message ?? "Invite failed.");
    }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setInviteStatus("Invite link copied.");
  };

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h2>Users (Admin)</h2>
      <p style={{ opacity: 0.8 }}>
        Invite users and view existing users from the database.
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
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Existing users</h3>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: "10px 8px" }}>Full name</th>
                <th style={{ padding: "10px 8px" }}>Email</th>
                <th style={{ padding: "10px 8px" }}>Role</th>
                <th style={{ padding: "10px 8px" }}>Active</th>
                <th style={{ padding: "10px 8px" }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "10px 8px" }}>{u.fullName}</td>
                  <td style={{ padding: "10px 8px" }}>{u.email}</td>
                  <td style={{ padding: "10px 8px" }}>{u.role}</td>
                  <td style={{ padding: "10px 8px" }}>
                    {u.isActive ? "Yes" : "No"}
                  </td>
                  <td style={{ padding: "10px 8px" }}>
                    {u.createdAt ? new Date(u.createdAt).toLocaleString() : "-"}
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

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
          Note: Listing users is based on the UserProfile table (not a live Cognito directory list).
        </div>
      </div>
    </div>
  );
}
