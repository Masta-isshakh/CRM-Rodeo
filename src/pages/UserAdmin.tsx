// src/pages/UserAdmin.tsx
import { useEffect, useMemo, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";

type Dept = { key: string; name: string };

function safeJsonParse<T>(raw: unknown): T | null {
  try {
    if (raw == null) return null;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return null;
      return JSON.parse(s) as T;
    }
    return raw as T;
  } catch {
    return null;
  }
}

function normalizeDepartmentsFromAdminList(deptRes: any): Dept[] {
  // adminListDepartments returns AWSJSON in deptRes.data (often STRING)
  // Possible shapes:
  // 1) raw = "[{key,name}]"
  // 2) raw = {"departments":[{key,name}]}
  // 3) raw = {"departments":"[{key,name}]"}
  // 4) raw = {departments:[...]} or {departments:"..."} (rare)
  // 5) raw already array (rare)

  const raw = deptRes?.data ?? deptRes;

  // If it's an array already
  if (Array.isArray(raw)) return raw as Dept[];

  // Parse top-level AWSJSON string/object
  const parsedTop = safeJsonParse<any>(raw);

  // If parsing yields array
  if (Array.isArray(parsedTop)) return parsedTop as Dept[];

  // If parsing yields object with departments
  const departmentsField = parsedTop?.departments ?? (raw as any)?.departments;

  if (Array.isArray(departmentsField)) return departmentsField as Dept[];

  if (typeof departmentsField === "string") {
    const parsedDept = safeJsonParse<any>(departmentsField);
    if (Array.isArray(parsedDept)) return parsedDept as Dept[];
    if (Array.isArray(parsedDept?.departments)) return parsedDept.departments as Dept[];
  }

  // Some resolvers return { departmentsJson: "..." }
  const departmentsJsonField = parsedTop?.departmentsJson ?? (raw as any)?.departmentsJson;
  if (typeof departmentsJsonField === "string") {
    const parsedDept = safeJsonParse<any>(departmentsJsonField);
    if (Array.isArray(parsedDept)) return parsedDept as Dept[];
    if (Array.isArray(parsedDept?.departments)) return parsedDept.departments as Dept[];
  }

  return [];
}

async function listAll<T>(
  listFn: (args: any) => Promise<any>,
  pageSize = 1000,
  max = 10000
): Promise<T[]> {
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

  const client = getDataClient();

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState(""); // UI field
  const [lastName, setLastName] = useState("");   // UI field
  const [departmentKey, setDepartmentKey] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  type UserRow = Schema["UserProfile"]["type"];
  const [users, setUsers] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [search, setSearch] = useState("");

  const inviteLink = useMemo(() => {
    const e = email.trim().toLowerCase();
    if (!e) return "";
    return `${window.location.origin}/set-password?email=${encodeURIComponent(e)}`;
  }, [email]);

  const load = async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [allUsers, deptRes] = await Promise.all([
        listAll<UserRow>((args) => client.models.UserProfile.list(args), 1000, 20000),
        client.queries.adminListDepartments(), // ✅ no args
      ]);

      // show GraphQL errors if any
      const anyErrors = (deptRes as any)?.errors;
      if (Array.isArray(anyErrors) && anyErrors.length) {
        throw new Error(anyErrors.map((e: any) => e.message).join(" | "));
      }

      const deptList = normalizeDepartmentsFromAdminList(deptRes);

      // sort newest first (createdAt may be null)
      const sorted = [...(allUsers ?? [])].sort((a, b) =>
        String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
      );

      setUsers(sorted);
      setDepartments(deptList);
      setStatus(`Loaded ${sorted.length} users • ${deptList.length} departments.`);
    } catch (e: any) {
      console.error(e);
      setUsers([]);
      setDepartments([]);
      setStatus(e?.message ?? "Failed to load.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const deptName = departments.find((d) => d.key === u.departmentKey)?.name ?? "";
      return `${u.email ?? ""} ${u.fullName ?? ""} ${deptName}`.toLowerCase().includes(q);
    });
  }, [users, search, departments]);

  const invite = async () => {
    if (!permissions.canCreate) return;
    setInviteStatus("Inviting...");
    try {
      const e = email.trim().toLowerCase();
      const fn = firstName.trim();
      const ln = lastName.trim();
      if (!e || !fn || !ln) throw new Error("Email, first name, and last name are required.");
      if (!departmentKey) throw new Error("Select a department.");

      const dept = departments.find((d) => d.key === departmentKey);
      const fullName = `${fn} ${ln}`.trim();

      const res = await client.mutations.inviteUser({
        email: e,
        fullName,
        departmentKey,
        departmentName: dept?.name ?? "",
      });

      const errs = (res as any)?.errors;
      if (Array.isArray(errs) && errs.length) {
        throw new Error(errs.map((x: any) => x.message).join(" | "));
      }

      setInviteStatus(`Invitation created for ${e}.`);
      setEmail("");
      setFirstName("");
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

  const setDepartmentForUser = async (u: UserRow, deptKey: string) => {
    if (!permissions.canUpdate) return;
    if (!u.email) return;

    setStatus("");
    setLoading(true);
    try {
      const dept = departments.find((d) => d.key === deptKey);

      const res = await client.mutations.adminSetUserDepartment({
        email: u.email,
        departmentKey: deptKey,
        departmentName: dept?.name ?? "",
      });

      const errs = (res as any)?.errors;
      if (Array.isArray(errs) && errs.length) {
        throw new Error(errs.map((x: any) => x.message).join(" | "));
      }

      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to set department.");
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (u: UserRow) => {
    if (!permissions.canUpdate) return;
    if (!u.email) return;

    setStatus("");
    setLoading(true);
    try {
      const next = !Boolean(u.isActive);

      const res = await client.mutations.adminSetUserActive({
        email: u.email,
        isActive: next,
      });

      const errs = (res as any)?.errors;
      if (Array.isArray(errs) && errs.length) {
        throw new Error(errs.map((x: any) => x.message).join(" | "));
      }

      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to change status.");
    } finally {
      setLoading(false);
    }
  };

  const deleteUser = async (u: UserRow) => {
    if (!permissions.canDelete) return;
    if (!u.email) return;

    const ok = confirm(`Delete user ${u.email}? This cannot be undone.`);
    if (!ok) return;

    setStatus("");
    setLoading(true);
    try {
      const res = await client.mutations.adminDeleteUser({ email: u.email });

      const errs = (res as any)?.errors;
      if (Array.isArray(errs) && errs.length) {
        throw new Error(errs.map((x: any) => x.message).join(" | "));
      }

      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to delete user.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, width: "100%", maxWidth: "100%" }}>
      <h2>Users</h2>

      {/* Invite user */}
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

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <TextField
            label="First name"
            value={firstName}
            onChange={(e) => setFirstName((e.target as HTMLInputElement).value)}
          />
          <TextField
            label="Last name"
            value={lastName}
            onChange={(e) => setLastName((e.target as HTMLInputElement).value)}
          />
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
          />

          <SelectField
            label="Department"
            value={departmentKey}
            onChange={(e) => setDepartmentKey((e.target as HTMLSelectElement).value)}
            isDisabled={loading}
          >
            <option value="">Select…</option>
            {departments.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </SelectField>

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Button variation="primary" onClick={invite} isDisabled={!permissions.canCreate || loading}>
              Invite
            </Button>
            <Button onClick={copyInviteLink} isDisabled={!inviteLink}>
              Copy set-password link
            </Button>
            <Button onClick={load} isLoading={loading}>
              Refresh
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

      {/* Existing users */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Existing users</h3>
          <TextField
            label="Search"
            placeholder="email, name..."
            value={search}
            onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
          />
        </div>

        {status && <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>{status}</div>}

        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: 10 }}>Full name</th>
                <th style={{ padding: 10 }}>Email</th>
                <th style={{ padding: 10 }}>Department</th>
                <th style={{ padding: 10 }}>Active</th>
                <th style={{ padding: 10 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: 10 }}>{u.fullName ?? "-"}</td>
                  <td style={{ padding: 10 }}>{u.email ?? "-"}</td>

                  <td style={{ padding: 10 }}>
                    <SelectField
                      label=""
                      value={u.departmentKey ?? ""}
                      onChange={(e) => setDepartmentForUser(u, (e.target as HTMLSelectElement).value)}
                      isDisabled={!permissions.canUpdate || loading}
                    >
                      <option value="">Select…</option>
                      {departments.map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.name}
                        </option>
                      ))}
                    </SelectField>
                    <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                      Current: {departments.find((d) => d.key === u.departmentKey)?.name ?? "-"}
                    </div>
                  </td>

                  <td style={{ padding: 10 }}>{u.isActive ? "Yes" : "No"}</td>

                  <td style={{ padding: 10 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button size="small" onClick={() => toggleActive(u)} isDisabled={!permissions.canUpdate || loading}>
                        {u.isActive ? "Disable" : "Enable"}
                      </Button>
                      <Button size="small" variation="destructive" onClick={() => deleteUser(u)} isDisabled={!permissions.canDelete || loading}>
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
