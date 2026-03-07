// src/pages/DepartmentsAdmin.tsx
import { useEffect, useMemo, useState } from "react";
import { Button, TextField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import "./DepartmentsAdmin.css";
import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";
import { usePermissions } from "../lib/userPermissions";
import PermissionGate from "./PermissionGate";
import ConfirmationPopup from "./ConfirmationPopup";

type Dept = { key: string; name: string };

function normalizeDepartmentsFallback(links: any[], users: any[]): Dept[] {
  const map = new Map<string, string>();

  for (const link of links ?? []) {
    const key = String(link?.departmentKey ?? "").trim();
    const name = String(link?.departmentName ?? "").trim();
    if (!key) continue;
    map.set(key, name || key);
  }

  for (const user of users ?? []) {
    const key = String(user?.departmentKey ?? "").trim();
    const name = String(user?.departmentName ?? "").trim();
    if (!key || map.has(key)) continue;
    map.set(key, name || key);
  }

  return Array.from(map.entries())
    .map(([key, name]) => ({ key, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseAWSJSON<T>(raw: unknown): T | null {
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

export default function DepartmentsAdmin({ permissions }: PageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const client = getDataClient();
  const { canOption, isAdminGroup } = usePermissions();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [departments, setDepartments] = useState<Dept[]>([]);
  const [roles, setRoles] = useState<Schema["AppRole"]["type"][]>([]);
  const [links, setLinks] = useState<Schema["DepartmentRoleLink"]["type"][]>([]);
  const [deptUserCounts, setDeptUserCounts] = useState<Record<string, number>>({});

  const [newDept, setNewDept] = useState("");
  const [showCreateRow, setShowCreateRow] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [roleModalDept, setRoleModalDept] = useState<Dept | null>(null);
  const [modalRoleName, setModalRoleName] = useState("");
  const [modalRoleDescription, setModalRoleDescription] = useState("");
  const [showDeletePopup, setShowDeletePopup] = useState(false);
  const [deleteTargetDept, setDeleteTargetDept] = useState<Dept | null>(null);

  const load = async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [deptRes, rolesRes, linksRes] = await Promise.all([
        isAdminGroup ? client.queries.adminListDepartments().catch(() => null) : Promise.resolve(null),
        client.models.AppRole.list({ limit: 1000 }),
        client.models.DepartmentRoleLink.list({ limit: 5000 }),
      ]);

      const anyErrors = (deptRes as any)?.errors;
      if (isAdminGroup && deptRes && Array.isArray(anyErrors) && anyErrors.length) {
        throw new Error(anyErrors.map((e: any) => e.message).join(" | "));
      }

      const raw = (deptRes as any)?.data;

      const parsedObj = parseAWSJSON<{ departments?: Dept[] }>(raw);
      const parsedArr = Array.isArray(raw) ? (raw as Dept[]) : parseAWSJSON<Dept[]>(raw);

      const deptListFromAdminQuery =
        (parsedObj?.departments && Array.isArray(parsedObj.departments) ? parsedObj.departments : null) ??
        (Array.isArray(parsedArr) ? parsedArr : []);

      const usersForFallback = await client.models.UserProfile.list({ limit: 5000 }).catch(() => ({ data: [] } as any));
      const deptList = deptListFromAdminQuery.length
        ? deptListFromAdminQuery
        : normalizeDepartmentsFallback(linksRes.data ?? [], usersForFallback?.data ?? []);

      setDepartments(deptList);
      setRoles(rolesRes.data ?? []);
      setLinks(linksRes.data ?? []);

      try {
        const upRes = usersForFallback;
        const counts: Record<string, number> = {};
        for (const row of upRes?.data ?? []) {
          const key = String((row as any)?.departmentKey ?? "").trim();
          if (!key) continue;
          counts[key] = (counts[key] ?? 0) + 1;
        }
        setDeptUserCounts(counts);
      } catch {
        setDeptUserCounts({});
      }

      setStatus("");
    } catch (e: any) {
      console.error(e);
      setDepartments([]);
      setDeptUserCounts({});
      setStatus(e?.message ?? "Load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roleIdsByDept = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const l of links) {
      const dk = String(l.departmentKey ?? "");
      if (!dk) continue;
      const arr = map.get(dk) ?? [];
      if (l.roleId) arr.push(String(l.roleId));
      map.set(dk, arr);
    }
    return map;
  }, [links]);

  const createDept = async () => {
    if (!permissions.canCreate || !canOption("departments", "departments_create", true)) return;
    setStatus("");
    setLoading(true);
    try {
      const name = newDept.trim();
      if (!name) throw new Error("Department name required");
      await client.mutations.adminCreateDepartment({ departmentName: name });
      setNewDept("");
      setShowCreateRow(false);
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Create failed");
    } finally {
      setLoading(false);
    }
  };

  const renameDept = async (oldKey: string, newName: string) => {
    if (!permissions.canUpdate || !canOption("departments", "departments_rename", true)) return;
    setStatus("");
    setLoading(true);
    try {
      const oldKeyTrimmed = String(oldKey ?? "").trim();
      const newNameTrimmed = String(newName ?? "").trim();
      if (!oldKey || !newName) throw new Error("Select old and enter new name");
      await client.mutations.adminRenameDepartment({ oldKey: oldKeyTrimmed, newName: newNameTrimmed });
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Rename failed");
    } finally {
      setLoading(false);
    }
  };

  const deleteDept = async (departmentKey: string) => {
    if (!permissions.canDelete || !canOption("departments", "departments_delete", true)) return;

    setStatus("");
    setLoading(true);
    try {
      await client.mutations.adminDeleteDepartment({ departmentKey });
      await load();
      setShowDeletePopup(false);
      setDeleteTargetDept(null);
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Delete failed");
    } finally {
      setLoading(false);
    }
  };

  const openDeletePopup = (department: Dept) => {
    if (!permissions.canDelete || !canOption("departments", "departments_delete", true) || loading) return;
    setDeleteTargetDept(department);
    setShowDeletePopup(true);
  };

  const closeDeletePopup = () => {
    if (loading) return;
    setShowDeletePopup(false);
    setDeleteTargetDept(null);
  };

  const createRoleForDepartment = async (department: Dept, roleNameRaw: string, roleDescriptionRaw: string) => {
    if (!permissions.canUpdate || !canOption("departments", "departments_assignrole", true)) return;

    const roleName = roleNameRaw.trim();
    if (!roleName) return;
    const roleDescription = roleDescriptionRaw.trim();

    setStatus("");
    setLoading(true);
    try {
      const existing = roles.find((r) => String(r.name ?? "").trim().toLowerCase() === roleName.toLowerCase());
      const roleId = String(existing?.id ?? "").trim();

      let targetRoleId = roleId;
      if (!targetRoleId) {
        const created = await client.models.AppRole.create({
          name: roleName,
          description: roleDescription || undefined,
          isActive: true,
          createdAt: new Date().toISOString(),
        });
        targetRoleId = String((created as any)?.data?.id ?? "").trim();
      }

      if (!targetRoleId) throw new Error("Role creation failed.");

      const exists = links.some(
        (l) => String(l.departmentKey ?? "") === String(department.key ?? "") && String(l.roleId ?? "") === targetRoleId
      );
      if (!exists) {
        await client.models.DepartmentRoleLink.create({
          departmentKey: department.key,
          departmentName: department.name,
          roleId: targetRoleId,
        });
      }

      await load();
      setShowRoleModal(false);
      setRoleModalDept(null);
      setModalRoleName("");
      setModalRoleDescription("");
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Add role failed");
    } finally {
      setLoading(false);
    }
  };

  const openRoleModal = (department: Dept) => {
    if (!permissions.canUpdate || !canOption("departments", "departments_assignrole", true) || loading) return;
    setRoleModalDept(department);
    setModalRoleName("");
    setModalRoleDescription("");
    setShowRoleModal(true);
  };

  const removeRole = async (departmentKey: string, roleId: string) => {
    if (!permissions.canUpdate || !canOption("departments", "departments_assignrole", true)) return;
    setStatus("");
    setLoading(true);
    try {
      const link = links.find(
        (l) => l.departmentKey === departmentKey && String(l.roleId) === String(roleId)
      );
      if (!link?.id) return;

      await client.models.DepartmentRoleLink.delete({ id: link.id });
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Remove failed");
    } finally {
      setLoading(false);
    }
  };

  const totalRoleAssignments = links.length;
  const avgRolesPerDept = departments.length ? (totalRoleAssignments / departments.length).toFixed(1) : "0.0";

  const onClickEditDepartment = async (dept: Dept) => {
    if (!permissions.canUpdate || !canOption("departments", "departments_rename", true)) return;
    const suggested = dept.name;
    const typed = window.prompt("Rename department", suggested);
    if (!typed) return;
    const next = typed.trim();
    if (!next || next === suggested) return;
    await renameDept(dept.key, next);
  };

  return (
    <div className="dep-page">
      <div className="dep-page-title">
        <h1><i className="fas fa-sitemap"></i> Department &amp; Role Management</h1>
        <p>Create departments, add roles, and manage your organizational structure with full-width department and role cards.</p>
      </div>

      <section className="dep-panel">
        <div className="dep-panel-head">
          <h2><i className="fas fa-list"></i> Departments &amp; Roles</h2>
          <div className="dep-head-actions">
            <Button onClick={load} isLoading={loading} className="dep-btn dep-btn-muted">Refresh</Button>
            <PermissionGate moduleId="departments" optionId="departments_create">
              <Button
                className="dep-btn dep-btn-primary"
                onClick={() => setShowCreateRow((prev) => !prev)}
                isDisabled={!permissions.canCreate || loading}
              >
                <i className="fas fa-plus"></i> Add New Department
              </Button>
            </PermissionGate>
          </div>
        </div>

        {showCreateRow && (
          <div className="dep-create-row">
            <TextField
              label="Department name"
              value={newDept}
              onChange={(e) => setNewDept((e.target as HTMLInputElement).value)}
            />
            <PermissionGate moduleId="departments" optionId="departments_create">
              <Button
                className="dep-btn dep-btn-success"
                onClick={createDept}
                isLoading={loading}
                isDisabled={!permissions.canCreate || loading}
              >
                Create
              </Button>
            </PermissionGate>
          </div>
        )}

        <div className="dep-stats">
          <div className="dep-stat-card">
            <strong>{departments.length}</strong>
            <span>Departments</span>
          </div>
          <div className="dep-stat-card">
            <strong>{totalRoleAssignments}</strong>
            <span>Total Roles</span>
          </div>
          <div className="dep-stat-card">
            <strong>{avgRolesPerDept}</strong>
            <span>Avg Roles/Dept</span>
          </div>
        </div>

        {status && <div className="dep-status">{status}</div>}

        <div className="dep-list">
          {departments.map((d) => {
            const currentRoleIds = roleIdsByDept.get(d.key) ?? [];
            const currentRoles = currentRoleIds
              .map((rid) => roles.find((r) => String(r.id) === String(rid)) ?? null)
              .filter(Boolean) as Schema["AppRole"]["type"][];

            return (
              <article key={d.key} className="dep-card">
                <header className="dep-card-head">
                  <div className="dep-card-title">
                    <h3>{d.name}</h3>
                    <span>{currentRoleIds.length} roles</span>
                  </div>

                  <div className="dep-card-actions">
                    <PermissionGate moduleId="departments" optionId="departments_assignrole">
                      <Button
                        className="dep-btn dep-btn-success dep-mini"
                        onClick={() => openRoleModal(d)}
                        isDisabled={!permissions.canUpdate || loading}
                      >
                        <i className="fas fa-plus"></i> Add Role
                      </Button>
                    </PermissionGate>

                    <PermissionGate moduleId="departments" optionId="departments_rename">
                      <Button
                        className="dep-btn dep-btn-muted dep-mini"
                        onClick={() => void onClickEditDepartment(d)}
                        isDisabled={!permissions.canUpdate || loading}
                      >
                        <i className="fas fa-edit"></i> Edit
                      </Button>
                    </PermissionGate>

                    <PermissionGate moduleId="departments" optionId="departments_delete">
                      <Button
                        className="dep-btn dep-btn-danger dep-mini"
                        onClick={() => openDeletePopup(d)}
                        isDisabled={!permissions.canDelete || loading}
                      >
                        <i className="fas fa-trash"></i> Delete
                      </Button>
                    </PermissionGate>
                  </div>
                </header>

                <div className="dep-card-body">
                  <p className="dep-card-desc">
                    Department key: <strong>{d.key}</strong>. Users in this department: <strong>{deptUserCounts[d.key] ?? 0}</strong>.
                  </p>

                  <div className="dep-roles-title">
                    <i className="fas fa-user-shield"></i>
                    <span>Department Roles ({currentRoleIds.length})</span>
                  </div>

                  <div className="dep-roles-list">
                    {currentRoles.length > 0 ? (
                      currentRoles.map((role) => (
                        <div key={role.id} className="dep-role-item">
                          <div className="dep-role-main">
                            <div className="dep-role-name"><i className="fas fa-user"></i> {role.name}</div>
                            <div className="dep-role-desc">{String(role.description ?? "Role assigned to this department")}</div>
                          </div>

                          <div className="dep-role-actions">
                            <Button className="dep-btn dep-btn-muted dep-mini" isDisabled>
                              <i className="fas fa-edit"></i> Edit
                            </Button>
                            <PermissionGate moduleId="departments" optionId="departments_assignrole">
                              <Button
                                className="dep-btn dep-btn-danger dep-mini"
                                onClick={() => void removeRole(d.key, String(role.id))}
                                isDisabled={!permissions.canUpdate || loading}
                              >
                                <i className="fas fa-trash"></i> Delete
                              </Button>
                            </PermissionGate>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="dep-empty-roles">No roles assigned yet.</div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {!departments.length && <div className="dep-empty">No departments yet.</div>}
        </div>
      </section>

      {showRoleModal && roleModalDept && (
        <div className="dep-modal-backdrop" role="dialog" aria-modal="true" aria-label="Create role">
          <div className="dep-modal-card">
            <div className="dep-modal-head">
              <h3>Create Role</h3>
              <button
                type="button"
                className="dep-modal-close"
                onClick={() => {
                  if (loading) return;
                  setShowRoleModal(false);
                  setRoleModalDept(null);
                }}
              >
                ×
              </button>
            </div>

            <p className="dep-modal-subtitle">Department: <strong>{roleModalDept.name}</strong></p>

            <div className="dep-modal-body">
              <TextField
                label="Role name"
                value={modalRoleName}
                onChange={(e) => setModalRoleName((e.target as HTMLInputElement).value)}
              />
              <TextField
                label="Role description (optional)"
                value={modalRoleDescription}
                onChange={(e) => setModalRoleDescription((e.target as HTMLInputElement).value)}
              />
            </div>

            <div className="dep-modal-actions">
              <Button
                className="dep-btn dep-btn-muted"
                onClick={() => {
                  if (loading) return;
                  setShowRoleModal(false);
                  setRoleModalDept(null);
                }}
                isDisabled={loading}
              >
                Cancel
              </Button>
              <Button
                className="dep-btn dep-btn-success"
                onClick={() => void createRoleForDepartment(roleModalDept, modalRoleName, modalRoleDescription)}
                isLoading={loading}
                isDisabled={loading || !modalRoleName.trim()}
              >
                Create & Add
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationPopup
        open={showDeletePopup && !!deleteTargetDept}
        title="Delete Department"
        message={
          <>
            Are you sure you want to delete <strong>{deleteTargetDept?.name}</strong>?
            <br />
            This department must have no users before deletion.
          </>
        }
        confirmText="Delete Department"
        cancelText="Keep Department"
        tone="danger"
        loading={loading}
        onCancel={closeDeletePopup}
        onConfirm={() => {
          if (!deleteTargetDept) return;
          void deleteDept(deleteTargetDept.key);
        }}
        footerNote="This action cannot be undone."
      />
    </div>
  );
}



