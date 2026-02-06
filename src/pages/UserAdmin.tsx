// src/pages/UserAdmin.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { createPortal } from "react-dom";

import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";

import "./UserAdmin.css";

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
  const raw = deptRes?.data ?? deptRes;
  if (Array.isArray(raw)) return raw as Dept[];

  const parsedTop = safeJsonParse<any>(raw);
  if (Array.isArray(parsedTop)) return parsedTop as Dept[];

  const departmentsField = parsedTop?.departments ?? (raw as any)?.departments;
  if (Array.isArray(departmentsField)) return departmentsField as Dept[];

  if (typeof departmentsField === "string") {
    const parsedDept = safeJsonParse<any>(departmentsField);
    if (Array.isArray(parsedDept)) return parsedDept as Dept[];
    if (Array.isArray(parsedDept?.departments)) return parsedDept.departments as Dept[];
  }

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

function normalizeKey(x: unknown) {
  return String(x ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function empIdFromIndex(idx: number) {
  const n = String(idx + 1).padStart(3, "0");
  return `EMP${n}`;
}

type MenuState =
  | { open: false }
  | {
      open: true;
      userId: string;
      top: number;
      left: number;
      width: number;
    };

export default function Users({ permissions }: PageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const client = getDataClient();

  // Invite modal state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [mobileNumber, setMobileNumber] = useState(""); // ✅ NEW
  const [departmentKey, setDepartmentKey] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");

  // List state
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  type UserRow = Schema["UserProfile"]["type"];
  const [users, setUsers] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [search, setSearch] = useState("");

  // UI/table controls
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  // Portal dropdown menu state
  const [menu, setMenu] = useState<MenuState>({ open: false });
  const portalMenuRef = useRef<HTMLDivElement | null>(null);

  // RBAC display helpers
  const [roleByDept, setRoleByDept] = useState<Record<string, string>>({});
  const [dashboardAllowedByDept, setDashboardAllowedByDept] = useState<Record<string, boolean>>({});

  const inviteLink = useMemo(() => {
    const e = email.trim().toLowerCase();
    if (!e) return "";
    return `${window.location.origin}/set-password?email=${encodeURIComponent(e)}`;
  }, [email]);

  const load = async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [allUsers, deptRes, links, roles, policies] = await Promise.all([
        listAll<UserRow>((args) => client.models.UserProfile.list(args), 1000, 20000),
        client.queries.adminListDepartments(),

        // Used only for UI labels
        listAll<any>((args) => client.models.DepartmentRoleLink.list(args), 1000, 20000),
        listAll<any>((args) => client.models.AppRole.list(args), 1000, 20000),
        listAll<any>((args) => client.models.RolePolicy.list(args), 1000, 20000),
      ]);

      const anyErrors = (deptRes as any)?.errors;
      if (Array.isArray(anyErrors) && anyErrors.length) {
        throw new Error(anyErrors.map((e: any) => e.message).join(" | "));
      }

      const deptList = normalizeDepartmentsFromAdminList(deptRes);

      const sorted = [...(allUsers ?? [])].sort((a, b) =>
        String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
      );

      // Role map per department
      const roleNameById = new Map<string, string>();
      for (const r of roles ?? []) roleNameById.set(String(r.id), String(r.name ?? ""));

      const deptToRoleIds = new Map<string, string[]>();
      for (const l of links ?? []) {
        const dk = String(l.departmentKey ?? "");
        const rid = String(l.roleId ?? "");
        if (!dk || !rid) continue;
        const arr = deptToRoleIds.get(dk) ?? [];
        arr.push(rid);
        deptToRoleIds.set(dk, arr);
      }

      const deptRoleLabel: Record<string, string> = {};
      for (const [dk, rids] of deptToRoleIds.entries()) {
        const first = rids.map((x) => roleNameById.get(x) || "").find(Boolean);
        deptRoleLabel[dk] = first || "—";
      }
      setRoleByDept(deptRoleLabel);

      // Dashboard access per department
      const roleDashboardAllowed = new Set<string>();
      for (const p of policies ?? []) {
        const rid = String(p.roleId ?? "");
        const key = normalizeKey((p as any).policyKey);
        if (!rid || !key) continue;
        if (key === "DASHBOARD" && Boolean((p as any).canRead)) {
          roleDashboardAllowed.add(rid);
        }
      }

      const deptDashboard: Record<string, boolean> = {};
      for (const [dk, rids] of deptToRoleIds.entries()) {
        deptDashboard[dk] = rids.some((rid) => roleDashboardAllowed.has(rid));
      }
      setDashboardAllowedByDept(deptDashboard);

      setUsers(sorted);
      setDepartments(deptList);
      setStatus(`Loaded ${sorted.length} users • ${deptList.length} departments.`);
    } catch (e: any) {
      console.error(e);
      setUsers([]);
      setDepartments([]);
      setRoleByDept({});
      setDashboardAllowedByDept({});
      setStatus(e?.message ?? "Failed to load.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setPageIndex(0), [search, pageSize]);

  // Close menu on outside click / ESC / scroll / resize
  useEffect(() => {
    if (!menu.open) return;

    const onDown = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (!t) return;

      // click on the same button should be ignored (button carries data attr)
      const btn = t.closest(`[data-ums-menu-btn="${menu.userId}"]`);
      if (btn) return;

      // click inside menu
      if (portalMenuRef.current?.contains(t)) return;

      setMenu({ open: false });
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setMenu({ open: false });
    };

    const onScroll = () => setMenu({ open: false });
    const onResize = () => setMenu({ open: false });

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [menu]);

  const enriched = useMemo(() => {
    return (users ?? []).map((u, idx) => {
      const empId = empIdFromIndex(idx);
      const deptName =
        departments.find((d) => d.key === u.departmentKey)?.name ?? (u.departmentName ?? "—");

      const roleName = u.departmentKey ? (roleByDept[u.departmentKey] ?? "—") : "—";
      const dashboardAllowed = u.departmentKey ? Boolean(dashboardAllowedByDept[u.departmentKey]) : false;

      // ✅ read mobile from model if exists
      const mobile = String((u as any).mobileNumber ?? (u as any).mobile ?? (u as any).phone ?? "").trim();

      return { u, empId, deptName: String(deptName || "—"), roleName: String(roleName || "—"), dashboardAllowed, mobile };
    });
  }, [users, departments, roleByDept, dashboardAllowedByDept]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return enriched;

    return enriched.filter((row) => {
      const fullName = String(row.u.fullName ?? "");
      const email = String(row.u.email ?? "");
      const dept = String(row.deptName ?? "");
      const role = String(row.roleName ?? "");
      const mobile = String(row.mobile ?? "");
      const hay = `${row.empId} ${fullName} ${email} ${mobile} ${dept} ${role}`.toLowerCase();
      return hay.includes(q);
    });
  }, [enriched, search]);

  const total = filtered.length;
  const from = total ? pageIndex * pageSize + 1 : 0;
  const to = Math.min(total, (pageIndex + 1) * pageSize);

  const pageRows = useMemo(() => {
    const start = pageIndex * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, pageIndex, pageSize]);

  // Backend actions (unchanged)
  const invite = async () => {
    if (!permissions.canCreate) return;
    setInviteStatus("Inviting...");
    try {
      const e = email.trim().toLowerCase();
      const fn = firstName.trim();
      const ln = lastName.trim();
      const mob = mobileNumber.trim();

      if (!e || !fn || !ln) throw new Error("Email, first name, and last name are required.");
      if (!departmentKey) throw new Error("Select a department.");
      if (!mob) throw new Error("Mobile number is required."); // ✅ required

      const dept = departments.find((d) => d.key === departmentKey);
      const fullName = `${fn} ${ln}`.trim();

      // ✅ send mobileNumber (requires backend update below)
      const res = await client.mutations.inviteUser({
        email: e,
        fullName,
        departmentKey,
        departmentName: dept?.name ?? "",
        mobileNumber: mob,
      } as any);

      const errs = (res as any)?.errors;
      if (Array.isArray(errs) && errs.length) {
        throw new Error(errs.map((x: any) => x.message).join(" | "));
      }

      setInviteStatus(`Invitation created for ${e}.`);
      setEmail("");
      setFirstName("");
      setLastName("");
      setMobileNumber("");
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

  const openActionsMenu = (userId: string, btnEl: HTMLElement) => {
    const rect = btnEl.getBoundingClientRect();
    const menuWidth = 180;
    const menuHeight = 110;

    let left = rect.right - menuWidth;
    if (left < 12) left = 12;
    if (left + menuWidth > window.innerWidth - 12) left = window.innerWidth - 12 - menuWidth;

    let top = rect.bottom + 8;
    if (top + menuHeight > window.innerHeight - 12) {
      top = rect.top - 8 - menuHeight;
      if (top < 12) top = 12;
    }

    setMenu({ open: true, userId, top, left, width: rect.width });
  };

  const portalDropdown =
    menu.open &&
    createPortal(
      <div
        className="ums-portal-menu"
        ref={portalMenuRef}
        style={{ top: menu.top, left: menu.left, width: 180 }}
        data-ums-menu={menu.userId}
      >
        {(() => {
          const row = users.find((x) => x.id === menu.userId);
          const active = Boolean(row?.isActive);
          return (
            <>
              <button
                className="ums-menu-item"
                onClick={() => {
                  setMenu({ open: false });
                  if (row) toggleActive(row);
                }}
                disabled={!permissions.canUpdate || loading}
              >
                {active ? "Disable" : "Enable"}
              </button>

              <button
                className="ums-menu-item danger"
                onClick={() => {
                  setMenu({ open: false });
                  if (row) deleteUser(row);
                }}
                disabled={!permissions.canDelete || loading}
              >
                Delete
              </button>
            </>
          );
        })()}
      </div>,
      document.body
    );

  return (
    <div className="ums-page">
      {portalDropdown}

      <div className="ums-shell">
        {/* Top bar */}
        <div className="ums-topbar">
          <div className="ums-topbar-left">
            <span className="ums-topbar-icon" aria-hidden>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M16 11c1.66 0 3-1.34 3-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Z" fill="currentColor" opacity="0.9" />
                <path d="M8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Z" fill="currentColor" opacity="0.9" />
                <path d="M8 13c-2.67 0-8 1.34-8 4v2h10v-2c0-1.12.45-2.13 1.2-2.93C10.33 13.42 9.2 13 8 13Z" fill="currentColor" opacity="0.9" />
                <path d="M16 13c-1.54 0-4.2.78-5.6 2.07A3.97 3.97 0 0 1 12 17v2h12v-2c0-2.66-5.33-4-8-4Z" fill="currentColor" opacity="0.9" />
              </svg>
            </span>
            <h1>User Management System</h1>
          </div>
        </div>

        {/* Search */}
        <div className="ums-card ums-search-card">
          <div className="ums-search-wrap">
            <span className="ums-search-icon" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm6.1-1.4 4.3 4.3"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <input
              className="ums-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Employee ID, Name, Email, Mobile, Department, or Role"
            />
          </div>

          <div className="ums-showing">
            Showing {from}-{to} of {total} users
          </div>
        </div>

        {/* Users list */}
        <div className="ums-card ums-table-card">
          <div className="ums-table-header">
            <div className="ums-table-title">
              <span className="ums-list-icon" aria-hidden>≡</span>
              <h2>Users List</h2>
            </div>

            <div className="ums-table-actions">
              <div className="ums-rpp">
                <span>Records per page:</span>
                <select className="ums-select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>

              <button
                className="ums-add-btn"
                onClick={() => {
                  setInviteStatus("");
                  setInviteOpen(true);
                }}
                disabled={!permissions.canCreate}
              >
                <span className="ums-add-icon" aria-hidden>+</span>
                Add New User
              </button>
            </div>
          </div>

          {status && <div className="ums-status">{status}</div>}

          <div className="ums-table-scroll">
            <table className="ums-table">
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>Employee Name</th>
                  <th>Email Address</th>
                  <th>Mobile Number</th>
                  <th>Department</th>
                  <th>Role</th>
                  <th>User Status</th>
                  <th>Dashboard Access</th>
                  <th className="ums-th-actions">Actions</th>
                </tr>
              </thead>

              <tbody>
                {pageRows.map((row) => {
                  const u = row.u;
                  const active = Boolean(u.isActive);
                  const dashAllowed = row.dashboardAllowed && active;

                  return (
                    <tr key={u.id}>
                      <td className="ums-mono">{row.empId}</td>
                      <td className="ums-name">{u.fullName ?? "—"}</td>
                      <td className="ums-email">{u.email ?? "—"}</td>

                      {/* ✅ Mobile */}
                      <td className="ums-muted">{row.mobile || "—"}</td>

                      <td>
                        <span className="pill pill-dept">{row.deptName}</span>
                        {permissions.canUpdate && (
                          <div className="ums-inline-edit">
                            <select
                              className="ums-pill-select"
                              value={u.departmentKey ?? ""}
                              onChange={(e) => setDepartmentForUser(u, e.target.value)}
                              disabled={loading}
                              title="Change department"
                            >
                              <option value="">Select…</option>
                              {departments.map((d) => (
                                <option key={d.key} value={d.key}>
                                  {d.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </td>

                      <td>
                        <span className="pill pill-role">{row.roleName}</span>
                      </td>

                      <td>
                        <span className={`pill ${active ? "pill-active" : "pill-inactive"}`}>
                          {active ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td>
                        <span className={`pill ${dashAllowed ? "pill-allowed" : "pill-blocked"}`}>
                          {dashAllowed ? "Allowed" : "Blocked"}
                        </span>
                      </td>

                      <td className="ums-actions-cell">
                        <button
                          className="ums-actions-btn"
                          type="button"
                          data-ums-menu-btn={u.id}
                          onClick={(e) => {
                            const el = e.currentTarget as HTMLElement;
                            if (menu.open && menu.userId === u.id) setMenu({ open: false });
                            else openActionsMenu(u.id, el);
                          }}
                        >
                          <span aria-hidden>⚙</span> Actions <span className="ums-caret" aria-hidden>▾</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {!pageRows.length && (
                  <tr>
                    <td colSpan={9} className="ums-empty">
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Invite Modal */}
        {inviteOpen && (
          <div className="ums-modal-overlay" role="dialog" aria-modal="true">
            <div className="ums-modal">
              <div className="ums-modal-head">
                <h3>Add New User</h3>
                <button className="ums-modal-close" onClick={() => setInviteOpen(false)} aria-label="Close">
                  ✕
                </button>
              </div>

              <div className="ums-modal-body">
                <div className="ums-form-grid">
                  <div>
                    <label className="ums-label">First name</label>
                    <input
                      className="ums-input"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First name"
                    />
                  </div>

                  <div>
                    <label className="ums-label">Last name</label>
                    <input
                      className="ums-input"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Last name"
                    />
                  </div>

                  <div className="ums-span-2">
                    <label className="ums-label">Email</label>
                    <input
                      className="ums-input"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="email@domain.com"
                      type="email"
                    />
                  </div>

                  {/* ✅ NEW Mobile field */}
                  <div className="ums-span-2">
                    <label className="ums-label">Mobile number</label>
                    <input
                      className="ums-input"
                      value={mobileNumber}
                      onChange={(e) => setMobileNumber(e.target.value)}
                      placeholder="+974 1234 5678"
                    />
                    <div className="ums-field-hint">Tip: use Qatar format like +974 XXXXXXXX</div>
                  </div>

                  <div className="ums-span-2">
                    <label className="ums-label">Department</label>
                    <select
                      className="ums-input"
                      value={departmentKey}
                      onChange={(e) => setDepartmentKey(e.target.value)}
                      disabled={loading}
                    >
                      <option value="">Select…</option>
                      {departments.map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="ums-invite-link">
                  <div className="ums-invite-link-title">Set-password link</div>
                  <div className="ums-invite-link-value">
                    {inviteLink || "Enter an email to generate the link."}
                  </div>
                </div>

                {inviteStatus && <div className="ums-toast">{inviteStatus}</div>}
              </div>

              <div className="ums-modal-foot">
                <Button onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button onClick={copyInviteLink} isDisabled={!inviteLink}>Copy link</Button>
                <Button
                  variation="primary"
                  onClick={invite}
                  isDisabled={!permissions.canCreate || loading}
                  isLoading={loading}
                >
                  Invite
                </Button>
              </div>

              <div className="ums-hint">
                Users get access from Department(Group) → Roles → Policies.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
