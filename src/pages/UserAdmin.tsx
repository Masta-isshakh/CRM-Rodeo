// src/pages/UserAdmin.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@aws-amplify/ui-react";
import { createPortal } from "react-dom";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { useLanguage } from "../i18n/LanguageContext";

import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";
import { matchesSearchQuery } from "../lib/searchUtils";
import { usePermissions } from "../lib/userPermissions";
import PermissionGate from "./PermissionGate";
import ConfirmationPopup from "./ConfirmationPopup";

import "./UserAdmin.css";

type Dept = { key: string; name: string };
type FailedLoginTracker = Record<string, { count: number; lockedUntil: number }>;
const FAILED_LOGIN_TRACKER_KEY = "crm.failedLoginTracker";

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

function normalizeDepartmentsFallback(users: any[], links: any[]): Dept[] {
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

function normalizeEmployeeId(value: string) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function pickEmailLike(...values: any[]): string {
  for (const value of values) {
    const s = String(value ?? "").trim().toLowerCase();
    if (s.includes("@")) return s;
  }
  return "";
}

async function resolveSessionEmailFallback(currentEmail: string): Promise<string> {
  const normalizedCurrent = pickEmailLike(currentEmail);
  if (normalizedCurrent) return normalizedCurrent;

  try {
    const session = await fetchAuthSession({ forceRefresh: true });
    const idPayload: any = session.tokens?.idToken?.payload ?? {};
    const accessPayload: any = session.tokens?.accessToken?.payload ?? {};

    const tokenEmail = pickEmailLike(
      idPayload?.email,
      accessPayload?.email,
      idPayload?.["cognito:username"],
      accessPayload?.["cognito:username"]
    );
    if (tokenEmail) return tokenEmail;
  } catch {
    // ignore
  }

  try {
    const user = await getCurrentUser();
    const fromUser = pickEmailLike(user?.signInDetails?.loginId, user?.username);
    if (fromUser) return fromUser;
  } catch {
    // ignore
  }

  return "";
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

//const EMPTY = { canRead: false, canCreate: false, canUpdate: false, canDelete: false, canApprove: false };

export default function Users(_: PageProps) {
  const { t } = useLanguage();
  const client = getDataClient();
  const { canOption, isAdminGroup, email: currentUserEmail } = usePermissions();
  const isDev = import.meta.env.DEV;
  const canOpenUsersPage = isAdminGroup || canOption("users", "users_list", true);
  const canViewUsersList = isAdminGroup || canOption("users", "users_view", true);
  const canShowRootAdminUser = isAdminGroup || canOption("users", "users_show_root_admin", true);
  const canInviteUsers = isAdminGroup || canOption("users", "users_invite", true);
  const canEditUsers = isAdminGroup || canOption("users", "users_edit", true);
  const canDeleteUsers = isAdminGroup || canOption("users", "users_delete", true);
  const canAccessUsersAdmin = canOpenUsersPage && (canViewUsersList || canInviteUsers || canEditUsers || canDeleteUsers);
  const rbacSelfCheckRows = [
    { key: "users_list", value: canOpenUsersPage },
    { key: "users_view", value: canViewUsersList },
    { key: "users_invite", value: canInviteUsers },
    { key: "users_edit", value: canEditUsers },
    { key: "users_delete", value: canDeleteUsers },
    { key: "users_show_root_admin", value: canShowRootAdminUser },
    { key: "users_access", value: canAccessUsersAdmin },
  ] as const;

  if (!canAccessUsersAdmin) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  // Invite modal state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [departmentKey, setDepartmentKey] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [lineManagerEmail, setLineManagerEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");

  // Delete confirmation popup state
  const [deletePopupOpen, setDeletePopupOpen] = useState(false);
  const [deleteTargetUser, setDeleteTargetUser] = useState<UserRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // List state
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  type UserRow = Schema["UserProfile"]["type"];
  const [users, setUsers] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [roles, setRoles] = useState<Schema["AppRole"]["type"][]>([]);
  const [deptRoleLinks, setDeptRoleLinks] = useState<Schema["DepartmentRoleLink"]["type"][]>([]);
  const [search, setSearch] = useState("");

  // UI/table controls
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);

  // Portal dropdown menu state
  const [menu, setMenu] = useState<MenuState>({ open: false });
  const portalMenuRef = useRef<HTMLDivElement | null>(null);

  // View details modal state
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsUser, setDetailsUser] = useState<UserRow | null>(null);
  const [detailsEditing, setDetailsEditing] = useState(false);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editDepartmentKey, setEditDepartmentKey] = useState("");
  const [editRoleKey, setEditRoleKey] = useState("");
  const [editMobileNumber, setEditMobileNumber] = useState("");
  const [editEmployeeId, setEditEmployeeId] = useState("");
  const [editLineManagerEmail, setEditLineManagerEmail] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editDashboardAccessEnabled, setEditDashboardAccessEnabled] = useState(true);
  const [lockoutNow, setLockoutNow] = useState(() => Date.now());
  const [detailsStatus, setDetailsStatus] = useState("");

  // RBAC display helpers
  const [dashboardAllowedByDept, setDashboardAllowedByDept] = useState<Record<string, boolean>>({});
  const [dashboardAllowedByRoleId, setDashboardAllowedByRoleId] = useState<Record<string, boolean>>({});
  const adminDataCacheRef = useRef<{
    links: any[];
    roles: any[];
    policies: any[];
    deptListFromAdminQuery: Dept[];
  } | null>(null);

  const isRootAdminSyntheticUser = (u: any) => Boolean(u?._isRootAdminSynthetic);

  const inviteLink = useMemo(() => {
    const e = email.trim().toLowerCase();
    if (!e) return "";
    return `${window.location.origin}/set-password?email=${encodeURIComponent(e)}`;
  }, [email]);

  const crmLoginUrl = useMemo(() => {
    if (typeof window === "undefined") return "https://crm.rodeodrive.work";
    return "https://crm.rodeodrive.work";
  }, []);

  const availableRolesForDept = useMemo(() => {
    if (!departmentKey) return [];
    const roleIds = deptRoleLinks
      .filter((link) => String(link.departmentKey ?? "") === departmentKey)
      .map((link) => String(link.roleId ?? ""));
    return roles.filter((r) => roleIds.includes(String(r.id ?? "")));
  }, [departmentKey, deptRoleLinks, roles]);

  const availableRolesForEditDept = useMemo(() => {
    if (!editDepartmentKey) return [];
    const roleIds = deptRoleLinks
      .filter((link) => String(link.departmentKey ?? "") === editDepartmentKey)
      .map((link) => String(link.roleId ?? ""));
    return roles.filter((r) => roleIds.includes(String(r.id ?? "")));
  }, [editDepartmentKey, deptRoleLinks, roles]);

  const lineManagerOptions = useMemo(() => {
    return (users ?? [])
      .filter((u) => !isRootAdminSyntheticUser(u))
      .map((u) => {
        const userEmail = String(u.email ?? "").trim().toLowerCase();
        const userName = String(u.fullName ?? "").trim() || userEmail;
        return {
          email: userEmail,
          label: `${userName} (${userEmail})`,
        };
      })
      .filter((x) => !!x.email)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [users]);

  const editUserLockoutInfo = useMemo(() => {
    const targetEmail = String(detailsUser?.email ?? "").trim().toLowerCase();
    if (!targetEmail) return { active: false, remainingMinutes: 0 };

    try {
      const raw = window.localStorage.getItem(FAILED_LOGIN_TRACKER_KEY) ?? "{}";
      const tracker = safeJsonParse<FailedLoginTracker>(raw) ?? {};
      const entry = tracker[targetEmail];
      const lockedUntil = Number(entry?.lockedUntil ?? 0);
      if (!lockedUntil) return { active: false, remainingMinutes: 0 };

      const remainingMs = lockedUntil - lockoutNow;
      if (remainingMs <= 0) return { active: false, remainingMinutes: 0 };

      return {
        active: true,
        remainingMinutes: Math.max(1, Math.ceil(remainingMs / 60000)),
      };
    } catch {
      return { active: false, remainingMinutes: 0 };
    }
  }, [detailsUser?.email, detailsOpen, lockoutNow]);

  useEffect(() => {
    if (!detailsOpen) return;
    setLockoutNow(Date.now());
    const intervalId = window.setInterval(() => {
      setLockoutNow(Date.now());
    }, 60_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [detailsOpen]);

  const load = async (opts?: { fullRefresh?: boolean }) => {
    const fullRefresh = Boolean(opts?.fullRefresh);
    setLoading(true);
    setStatus("Loading...");
    try {
      const cached = adminDataCacheRef.current;
      const canReuseCache = !fullRefresh && Boolean(cached);

      const allUsersPromise = listAll<UserRow>((args) => client.models.UserProfile.list(args), 1000, 20000);
      const deptResPromise = canReuseCache
        ? Promise.resolve(null)
        : (isAdminGroup ? client.queries.adminListDepartments().catch(() => null) : Promise.resolve(null));
      const linksPromise = canReuseCache
        ? Promise.resolve(cached?.links ?? [])
        : listAll<any>((args) => client.models.DepartmentRoleLink.list(args), 1000, 5000);
      const rolesPromise = canReuseCache
        ? Promise.resolve(cached?.roles ?? [])
        : listAll<any>((args) => client.models.AppRole.list(args), 1000, 5000);
      const policiesPromise = canReuseCache
        ? Promise.resolve(cached?.policies ?? [])
        : listAll<any>((args) => client.models.RolePolicy.list(args), 1000, 5000);

      const [allUsers, deptRes, links, roles, policies] = await Promise.all([
        allUsersPromise,
        deptResPromise,
        linksPromise,
        rolesPromise,
        policiesPromise,
      ]);

      const anyErrors = (deptRes as any)?.errors;
      if (!canReuseCache && isAdminGroup && deptRes && Array.isArray(anyErrors) && anyErrors.length) {
        throw new Error(anyErrors.map((e: any) => e.message).join(" | "));
      }

      const deptListFromAdminQuery = canReuseCache
        ? (cached?.deptListFromAdminQuery ?? [])
        : (deptRes ? normalizeDepartmentsFromAdminList(deptRes) : []);

      if (!canReuseCache) {
        adminDataCacheRef.current = {
          links: links ?? [],
          roles: roles ?? [],
          policies: policies ?? [],
          deptListFromAdminQuery,
        };
      }
      const deptList = deptListFromAdminQuery.length
        ? deptListFromAdminQuery
        : normalizeDepartmentsFallback(allUsers ?? [], links ?? []);

      const sorted = [...(allUsers ?? [])].sort((a, b) =>
        String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
      );

      if (canShowRootAdminUser) {
        const adminRoleIds = new Set(
          (roles ?? [])
            .filter((r: any) => String(r?.name ?? "").trim().toLowerCase().includes("admin"))
            .map((r: any) => String(r?.id ?? "").trim())
            .filter(Boolean)
        );

        const adminCandidates = sorted
          .map((u: any) => {
            const email = String(u?.email ?? "").trim().toLowerCase();
            if (!email) return null;

            const fullName = String(u?.fullName ?? "").trim().toLowerCase();
            const deptKey = String(u?.departmentKey ?? "").trim().toLowerCase();
            const deptName = String(u?.departmentName ?? "").trim().toLowerCase();
            const roleName = String((u as any)?.roleName ?? "").trim().toLowerCase();
            const roleId = String((u as any)?.roleId ?? "").trim();

            const emailHasRoot = email.includes("root");
            const nameHasRoot = fullName.includes("root");
            const roleHasRoot = roleName.includes("root");
            const deptHasAdmin = deptKey.includes("admin") || deptName.includes("admin");
            const roleHasAdmin = roleName.includes("admin") || (roleId && adminRoleIds.has(roleId));

            const score =
              (emailHasRoot ? 100 : 0) +
              (nameHasRoot ? 80 : 0) +
              (roleHasRoot ? 60 : 0) +
              (deptHasAdmin ? 40 : 0) +
              (roleHasAdmin ? 30 : 0);

            return score > 0 ? { email, score } : null;
          })
          .filter(Boolean) as Array<{ email: string; score: number }>;

        const rootCandidate = adminCandidates.sort((a, b) => b.score - a.score)[0] ?? null;

        const cachedRootEmail = (() => {
          try {
            return String(window.localStorage.getItem("crm.rootAdminEmail") ?? "").trim().toLowerCase();
          } catch {
            return "";
          }
        })();

        const sessionAdminEmail = isAdminGroup
          ? await resolveSessionEmailFallback(String(currentUserEmail ?? ""))
          : "";

        let cognitoAdminsEmail = "";
        if (!rootCandidate && !sessionAdminEmail) {
          try {
            const systemUsersRes = await (client.queries as any).systemListUsers?.();
            const raw = (systemUsersRes as any)?.data ?? systemUsersRes;
            const parsed = safeJsonParse<any>(raw) ?? raw;
            const users = Array.isArray(parsed?.users) ? parsed.users : Array.isArray(parsed) ? parsed : [];
            const currentEmailNormalized = pickEmailLike(currentUserEmail);

            const rankedAdminUsers = (users as any[])
              .filter(
                (u: any) =>
                  Array.isArray(u?.groups) &&
                  u.groups.some((g: any) => String(g ?? "").trim().toLowerCase() === "admins")
              )
              .map((u: any) => {
                const userEmail = pickEmailLike(u?.email);
                const userName = pickEmailLike(u?.username);
                const displayName = String(u?.fullName ?? u?.name ?? "").trim().toLowerCase();

                const emailHasRoot = userEmail.includes("root");
                const usernameHasRoot = userName.includes("root");
                const nameHasRoot = displayName.includes("root");
                const notCurrentUser =
                  currentEmailNormalized && userEmail
                    ? userEmail !== currentEmailNormalized
                    : true;

                const score =
                  (emailHasRoot ? 100 : 0) +
                  (usernameHasRoot ? 90 : 0) +
                  (nameHasRoot ? 70 : 0) +
                  (notCurrentUser ? 10 : 0);

                return {
                  email: userEmail,
                  username: userName,
                  score,
                };
              })
              .sort((a, b) => b.score - a.score);

            const bestAdminUser = rankedAdminUsers[0];
            cognitoAdminsEmail = pickEmailLike(bestAdminUser?.email, bestAdminUser?.username);
          } catch {
            cognitoAdminsEmail = "";
          }
        }

        const sanitizedCachedRootEmail = cachedRootEmail === "root-admin@system" ? "" : cachedRootEmail;

        const rootEmail =
          String(rootCandidate?.email ?? "").trim().toLowerCase() ||
          sessionAdminEmail ||
          cognitoAdminsEmail ||
          sanitizedCachedRootEmail;

        if (rootEmail) {
          try {
            window.localStorage.setItem("crm.rootAdminEmail", rootEmail);
          } catch {
            // no-op
          }
        }

        const hasRootAdminRow = sorted.some((u: any) => {
          const email = String(u?.email ?? "").trim().toLowerCase();
          const fullName = String(u?.fullName ?? "").trim().toLowerCase();
          const roleName = String((u as any)?.roleName ?? "").trim().toLowerCase();
          return (rootEmail && email === rootEmail) || fullName === "root admin" || roleName === "root admin";
        });

        if (!hasRootAdminRow && rootEmail) {
          sorted.unshift({
            id: "root-admin-system",
            email: rootEmail,
            fullName: "Root Admin",
            departmentKey: "Admins",
            departmentName: "Admins",
            roleName: "Root Admin",
            roleId: "",
            isActive: true,
            mobileNumber: "",
            createdAt: new Date(0).toISOString(),
            _isRootAdminSynthetic: true,
          } as any);
        }
      }

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

      const byRole: Record<string, boolean> = {};
      for (const rid of roleDashboardAllowed) byRole[rid] = true;
      setDashboardAllowedByRoleId(byRole);

      setUsers(sorted);
      setDepartments(deptList);
      setRoles(roles ?? []);
      setDeptRoleLinks(links ?? []);
      setStatus(`Loaded ${sorted.length} users • ${deptList.length} departments.`);
    } catch (e: any) {
      console.error(e);
      setUsers([]);
      setDepartments([]);
      setDashboardAllowedByDept({});
      setDashboardAllowedByRoleId({});
      setStatus(e?.message ?? "Failed to load.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load({ fullRefresh: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminGroup, canShowRootAdminUser, currentUserEmail]);

  useEffect(() => setPageIndex(0), [search, pageSize]);

  // Close menu on outside click / ESC / scroll / resize
  useEffect(() => {
    if (!menu.open) return;

    const onDown = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (!t) return;

      const btn = t.closest(`[data-ums-menu-btn="${menu.userId}"]`);
      if (btn) return;

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
    const roleNameById = new Map<string, string>();
    for (const r of roles ?? []) roleNameById.set(String(r.id ?? ""), String(r.name ?? ""));
    const deptNameByKey = new Map<string, string>();
    for (const d of departments ?? []) deptNameByKey.set(String(d.key ?? ""), String(d.name ?? ""));

    const firstRoleByDept: Record<string, string> = {};
    for (const link of deptRoleLinks ?? []) {
      const dk = String(link.departmentKey ?? "");
      const rid = String(link.roleId ?? "");
      if (!dk || !rid || firstRoleByDept[dk]) continue;
      firstRoleByDept[dk] = roleNameById.get(rid) || "";
    }

    return (users ?? []).map((u, idx) => {
      const persistedEmpId = String((u as any).employeeId ?? "").trim();
      const empId = persistedEmpId || empIdFromIndex(idx);
      const deptName = deptNameByKey.get(String(u.departmentKey ?? "")) ?? (u.departmentName ?? "—");
      const lineManagerDisplay =
        String((u as any).lineManagerName ?? "").trim() ||
        String((u as any).lineManagerEmail ?? "").trim() ||
        "—";

      const userRoleId = String((u as any).roleId ?? "").trim();
      const userRoleName = String((u as any).roleName ?? "").trim();
      const roleName = userRoleName || roleNameById.get(userRoleId) || (u.departmentKey ? (firstRoleByDept[u.departmentKey] ?? "—") : "—");
      const dashboardAccessEnabled = Boolean((u as any).dashboardAccessEnabled ?? true);

      const dashboardAllowed = isRootAdminSyntheticUser(u)
        ? true
        : Boolean(u.isActive) &&
          dashboardAccessEnabled &&
          (userRoleId
            ? Boolean(dashboardAllowedByRoleId[userRoleId])
            : (u.departmentKey ? Boolean(dashboardAllowedByDept[u.departmentKey]) : false));

      const mobile = String((u as any).mobileNumber ?? (u as any).mobile ?? (u as any).phone ?? "").trim();

      return {
        u,
        empId,
        deptName: String(deptName || "—"),
        roleName: String(roleName || "—"),
        lineManagerDisplay,
        dashboardAllowed,
        mobile,
      };
    });
  }, [users, departments, roles, deptRoleLinks, dashboardAllowedByDept, dashboardAllowedByRoleId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return enriched;

    return enriched.filter((row) => {
      const fullName = String(row.u.fullName ?? "");
      const email = String(row.u.email ?? "");
      const dept = String(row.deptName ?? "");
      const role = String(row.roleName ?? "");
      const lineManager = String(row.lineManagerDisplay ?? "");
      const mobile = String(row.mobile ?? "");
      return matchesSearchQuery([row.empId, fullName, email, mobile, dept, role, lineManager], q);
    });
  }, [enriched, search]);

  const visibleRows = canViewUsersList ? filtered : [];

  const total = visibleRows.length;
  const from = total ? pageIndex * pageSize + 1 : 0;
  const to = Math.min(total, (pageIndex + 1) * pageSize);

  const pageRows = useMemo(() => {
    const start = pageIndex * pageSize;
    return visibleRows.slice(start, start + pageSize);
  }, [visibleRows, pageIndex, pageSize]);

  // Backend actions
  const invite = async () => {
    if (!canInviteUsers) return;
    setInviteStatus(t("inviting"));
    try {
      const e = email.trim().toLowerCase();
      const eid = normalizeEmployeeId(employeeId);
      const fn = firstName.trim();
      const ln = lastName.trim();
      const mob = mobileNumber.trim();
      const lmEmail = String(lineManagerEmail ?? "").trim().toLowerCase();
      const lmName =
        lineManagerOptions.find((x) => x.email === lmEmail)?.label.split(" (")[0]?.trim() ?? "";

      if (!eid) throw new Error(t("employeeIdIsRequired"));
      if (!e || !fn || !ln) throw new Error(t("emailFirstNameLastNameRequired"));
      if (!departmentKey) throw new Error(t("selectDepartment"));
      if (!roleKey) throw new Error(t("selectRole"));
      if (!mob) throw new Error(t("mobileNumberRequired"));
      const duplicateEmployeeId = users.some(
        (u) => normalizeEmployeeId(String((u as any).employeeId ?? "")) === eid
      );
      if (duplicateEmployeeId) {
        throw new Error(t("employeeIDExists"));
      }
      if (!availableRolesForDept.some((r) => String(r.id ?? "") === roleKey)) {
        throw new Error(t("selectedRoleNotValidForDept"));
      }

      const dept = departments.find((d) => d.key === departmentKey);
      const fullName = `${fn} ${ln}`.trim();

      const res = await client.mutations.inviteUser({
        employeeId: eid,
        email: e,
        fullName,
        departmentKey,
        departmentName: dept?.name ?? "",
        mobileNumber: mob,
        roleId: roleKey,
        lineManagerEmail: lmEmail || undefined,
        lineManagerName: lmName || undefined,
      } as any);

      const errs = (res as any)?.errors;
      if (Array.isArray(errs) && errs.length) {
        throw new Error(errs.map((x: any) => x.message).join(" | "));
      }

      const payload = (res as any)?.data ?? {};
      const ok = payload?.ok !== false;
      if (!ok) {
        throw new Error(t("invitationEmailNotDispatched"));
      }

      const inviteAction = String(payload?.inviteAction ?? "CREATED").toUpperCase();
      const deliveredTo = String(payload?.invitedEmail ?? e).trim() || e;

      setInviteStatus(
        inviteAction === "RESET"
          ? `Password reset email sent to ${deliveredTo}.`
          : `Invitation email sent to ${deliveredTo}.`
      );
      setEmployeeId("");
      setEmail("");
      setFirstName("");
      setLastName("");
      setMobileNumber("");
      setDepartmentKey("");
      setRoleKey("");
      setLineManagerEmail("");
      await load();
    } catch (e: any) {
      console.error(e);
      setInviteStatus(e?.message ?? t("inviteFailed"));
    }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setInviteStatus(t("setPasswordLink"));
  };

  const askDeleteUser = (u: UserRow) => {
    if (!canDeleteUsers) return;
    if (!u.email) return;
    if (isRootAdminSyntheticUser(u)) return;

    setDeleteTargetUser(u);
    setDeletePopupOpen(true);
  };

  const closeDeletePopup = () => {
    if (deleteLoading) return;
    setDeletePopupOpen(false);
    setDeleteTargetUser(null);
  };

  const confirmDeleteUser = async () => {
    if (!deleteTargetUser?.email) return;

    setStatus("");
    setDeleteLoading(true);
    setLoading(true);
    try {
      const res = await client.mutations.adminDeleteUser({ email: deleteTargetUser.email });

      const errs = (res as any)?.errors;
      if (Array.isArray(errs) && errs.length) {
        throw new Error(errs.map((x: any) => x.message).join(" | "));
      }

      closeDeletePopup();
      window.dispatchEvent(new Event("rbac:refresh"));
      await load();
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? t("failedToDeleteUser"));
    } finally {
      setDeleteLoading(false);
      setLoading(false);
    }
  };

  const openDetailsModal = (u: UserRow) => {
    setDetailsUser(u);
    setDetailsEditing(false);
    setEditFirstName(u.fullName ? u.fullName.split(" ")[0] : "");
    setEditLastName(u.fullName ? u.fullName.split(" ").slice(1).join(" ") : "");
    setEditDepartmentKey(String(u.departmentKey ?? ""));
    setEditRoleKey(String((u as any).roleId ?? ""));
    setEditMobileNumber(u.mobileNumber ?? "");
    setEditEmployeeId(normalizeEmployeeId(String((u as any).employeeId ?? "")));
    setEditLineManagerEmail(String((u as any).lineManagerEmail ?? "").trim().toLowerCase());
    const nextIsActive = Boolean((u as any).isActive ?? true);
    const nextDashboardEnabled = Boolean((u as any).dashboardAccessEnabled ?? true);
    setEditIsActive(nextIsActive);
    setEditDashboardAccessEnabled(nextIsActive ? nextDashboardEnabled : false);
    setDetailsStatus("");
    setDetailsOpen(true);
  };

  const saveUserChanges = async () => {
    if (!detailsUser?.email) return;
    if (isRootAdminSyntheticUser(detailsUser)) {
      setDetailsStatus(t("rootAdminReadOnly"));
      return;
    }
    if (!editFirstName.trim() || !editLastName.trim()) {
      setDetailsStatus(t("firstNameLastNameRequired"));
      return;
    }
    if (!editDepartmentKey) {
      setDetailsStatus(t("departmentRequired"));
      return;
    }
    if (!editRoleKey) {
      setDetailsStatus(t("roleRequired"));
      return;
    }
    if (!normalizeEmployeeId(editEmployeeId)) {
      setDetailsStatus(t("employeeIdIsRequired"));
      return;
    }
    if (!availableRolesForEditDept.some((r) => String(r.id ?? "") === editRoleKey)) {
      setDetailsStatus(t("selectedRoleNotValidForDept"));
      return;
    }

    const normalizedEditEmployeeId = normalizeEmployeeId(editEmployeeId);
    const duplicateEmployeeId = users.some(
      (u) =>
        String(u.id ?? "") !== String(detailsUser.id ?? "") &&
        normalizeEmployeeId(String((u as any).employeeId ?? "")) === normalizedEditEmployeeId
    );
    if (duplicateEmployeeId) {
      setDetailsStatus(t("employeeIDExists"));
      return;
    }

    setLoading(true);
    try {
      const newFullName = `${editFirstName.trim()} ${editLastName.trim()}`.trim();

      // Update department if changed
      if (editDepartmentKey !== String(detailsUser.departmentKey ?? "")) {
        const resDepth = await client.mutations.adminSetUserDepartment({
          email: detailsUser.email,
          departmentKey: editDepartmentKey,
        });

        const errsDepth = (resDepth as any)?.errors;
        if (Array.isArray(errsDepth) && errsDepth.length) {
          throw new Error(errsDepth.map((x: any) => x.message).join(" | "));
        }
      }

      const selectedRole = availableRolesForEditDept.find((r) => String(r.id ?? "") === editRoleKey);
      const selectedRoleName = String(selectedRole?.name ?? "").trim();
      const selectedLineManager = lineManagerOptions.find((o) => o.email === editLineManagerEmail);
      const selectedLineManagerName = selectedLineManager?.label.split(" (")[0]?.trim() ?? "";
      const effectiveDashboardAccess = editIsActive ? Boolean(editDashboardAccessEnabled) : false;

      const roleChanged = editRoleKey !== String((detailsUser as any).roleId ?? "");
      const mobileChanged = editMobileNumber !== (detailsUser.mobileNumber ?? "");
      const employeeIdChanged = normalizedEditEmployeeId !== normalizeEmployeeId(String((detailsUser as any).employeeId ?? ""));
      const lineManagerChanged =
        String(editLineManagerEmail ?? "").trim().toLowerCase() !==
        String((detailsUser as any).lineManagerEmail ?? "").trim().toLowerCase();
      const statusChanged = editIsActive !== Boolean((detailsUser as any).isActive ?? true);
      const dashboardAccessChanged =
        effectiveDashboardAccess !== Boolean((detailsUser as any).dashboardAccessEnabled ?? true);
      const fullNameChanged = newFullName !== String(detailsUser.fullName ?? "");

      if (statusChanged) {
        const resActive = await client.mutations.adminSetUserActive({
          email: String(detailsUser.email ?? "").trim().toLowerCase(),
          isActive: editIsActive,
        });

        const errsActive = (resActive as any)?.errors;
        if (Array.isArray(errsActive) && errsActive.length) {
          throw new Error(errsActive.map((x: any) => x.message).join(" | "));
        }
      }

      if (
        fullNameChanged ||
        roleChanged ||
        mobileChanged ||
        employeeIdChanged ||
        lineManagerChanged ||
        statusChanged ||
        dashboardAccessChanged
      ) {
        const resProfile = await client.mutations.adminUpdateUserProfile({
          email: String(detailsUser.email ?? "").trim().toLowerCase(),
          fullName: newFullName,
          dashboardAccessEnabled: effectiveDashboardAccess,
          employeeId: normalizedEditEmployeeId,
          roleId: editRoleKey,
          roleName: selectedRoleName || undefined,
          mobileNumber: editMobileNumber || undefined,
          lineManagerEmail: editLineManagerEmail || undefined,
          lineManagerName: editLineManagerEmail ? (selectedLineManagerName || undefined) : undefined,
        } as any);

        const errsProfile = (resProfile as any)?.errors;
        if (Array.isArray(errsProfile) && errsProfile.length) {
          throw new Error(errsProfile.map((x: any) => x.message).join(" | "));
        }
      }

      const selectedDept = departments.find((d) => d.key === editDepartmentKey);
      setDetailsUser((prev) =>
        prev
          ? ({
              ...prev,
              fullName: newFullName,
              departmentKey: editDepartmentKey,
              departmentName: selectedDept?.name ?? prev.departmentName,
              roleId: editRoleKey,
              roleName: selectedRoleName || (prev as any).roleName,
              mobileNumber: editMobileNumber || null,
              employeeId: normalizedEditEmployeeId,
              lineManagerEmail: editLineManagerEmail || null,
              lineManagerName: editLineManagerEmail ? (selectedLineManagerName || null) : null,
              isActive: editIsActive,
              dashboardAccessEnabled: effectiveDashboardAccess,
            } as any)
          : prev
      );

      setDetailsStatus(t("userUpdatedSuccessfully"));
      setDetailsEditing(false);
      await load();
      setDetailsOpen(false);
    } catch (e: any) {
      console.error(e);
      setDetailsStatus(e?.message ?? t("failedToUpdateUser"));
    } finally {
      setLoading(false);
    }
  };

  const sendResetPassword = async (u: UserRow) => {
    if (!canEditUsers) return;
    if (isRootAdminSyntheticUser(u)) return;

    const targetEmail = String(u.email ?? "").trim().toLowerCase();
    if (!targetEmail) {
      setDetailsStatus(t("userEmailMissing"));
      return;
    }

    const loadedUser = users.find(
      (x) => String((x as any)?.email ?? "").trim().toLowerCase() === targetEmail
    );
    const isDetailsTarget =
      detailsOpen &&
      String((detailsUser as any)?.email ?? "").trim().toLowerCase() === targetEmail;

    const fullName = String(u.fullName ?? (loadedUser as any)?.fullName ?? "").trim();

    let deptKey = String(
      u.departmentKey ??
      (loadedUser as any)?.departmentKey ??
      (isDetailsTarget ? editDepartmentKey : "")
    ).trim();
    const deptNameHint = String(
      u.departmentName ?? (loadedUser as any)?.departmentName ?? ""
    ).trim();
    if (!deptKey && deptNameHint) {
      const fromName = departments.find(
        (d) => String(d.name ?? "").trim().toLowerCase() === deptNameHint.toLowerCase()
      );
      deptKey = String(fromName?.key ?? "").trim();
    }

    let roleId = String(
      (u as any).roleId ??
      (loadedUser as any)?.roleId ??
      (isDetailsTarget ? editRoleKey : "")
    ).trim();
    const roleName = String((u as any).roleName ?? (loadedUser as any)?.roleName ?? "").trim();
    if (!roleId && roleName) {
      const roleByName = roles.find(
        (r: any) => String(r?.name ?? "").trim().toLowerCase() === roleName.toLowerCase()
      );
      roleId = String(roleByName?.id ?? "").trim();
    }
    if (!roleId && deptKey) {
      const link = deptRoleLinks.find((l: any) => String(l?.departmentKey ?? "") === deptKey);
      roleId = String(link?.roleId ?? "").trim();
    }

    const employeeIdValue = normalizeEmployeeId(
      String(
        (u as any).employeeId ??
        (loadedUser as any)?.employeeId ??
        (isDetailsTarget ? editEmployeeId : "")
      )
    );
    const mobileValue = String(
      (u as any).mobileNumber ??
      (loadedUser as any)?.mobileNumber ??
      (isDetailsTarget ? editMobileNumber : "")
    ).trim();

    if (!deptKey) {
      setDetailsStatus(t("departmentRequiredForReset"));
      return;
    }
    if (!employeeIdValue) {
      setDetailsStatus(t("employeeIdIsRequired"));
      return;
    }
    if (!roleId) {
      setDetailsStatus(t("roleRequired"));
      return;
    }

    setLoading(true);
    setDetailsStatus(t("sendingResetPasswordEmail"));
    try {
      const deptName =
        departments.find((d) => d.key === deptKey)?.name ??
        String(u.departmentName ?? "").trim() ??
        "";

      const res = await client.mutations.inviteUser({
        employeeId: employeeIdValue,
        email: targetEmail,
        fullName: fullName || targetEmail,
        mobileNumber: mobileValue || undefined,
        departmentKey: deptKey,
        departmentName: deptName,
        roleId,
      } as any);

      const errs = (res as any)?.errors;
      if (Array.isArray(errs) && errs.length) {
        throw new Error(errs.map((x: any) => x.message).join(" | "));
      }

      const payload = (res as any)?.data ?? {};
      const ok = payload?.ok !== false;
      if (!ok) {
        throw new Error(t("passwordResetNotDispatched"));
      }

      setDetailsStatus(`Reset password email sent to ${targetEmail}.`);

      if (!roleName && !roleId) {
        console.warn("sendResetPassword: user has no role assigned");
      }
    } catch (e: any) {
      console.error(e);
      setDetailsStatus(e?.message ?? t("failedToSendResetPasswordEmail"));
    } finally {
      setLoading(false);
    }
  };

  const openActionsMenu = (userId: string, btnEl: HTMLElement) => {
    const rect = btnEl.getBoundingClientRect();
    const menuWidth = 168;
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
        style={{ top: menu.top, left: menu.left, width: "min(168px, calc(100vw - 24px))", maxWidth: "calc(100vw - 24px)" }}
        data-ums-menu={menu.userId}
      >
        {(() => {
          const row = users.find((x) => x.id === menu.userId);
          return (
            <>
              <button
                className="ums-menu-item"
                onClick={() => {
                  setMenu({ open: false });
                  if (row) openDetailsModal(row);
                }}
                disabled={loading}
              >
                {t("View Details")}
              </button>

              <button
                className="ums-menu-item danger"
                onClick={() => {
                  setMenu({ open: false });
                    if (row) askDeleteUser(row);
                }}
                disabled={!canDeleteUsers || loading}
              >
                {t("Delete")}
              </button>
            </>
          );
        })()}
      </div>,
      document.body
    );

  return (
    <div className="ums-page">
      {!detailsOpen && portalDropdown}

      <ConfirmationPopup
        open={deletePopupOpen}
        title={t("deleteUserAccount")}
        message={
          <>
            {t("youAreAboutToDelete")}
            <strong>{` ${deleteTargetUser?.fullName || deleteTargetUser?.email || "this user"}`}</strong>
            {deleteTargetUser?.email ? <span>{` (${deleteTargetUser.email})`}</span> : null}.
            <br />
            {t("thisActionIsPermanent")}
          </>
        }
        confirmText={t("deleteUser")}
        cancelText={t("keepUser")}
        tone="danger"
        loading={deleteLoading}
        disableConfirm={!deleteTargetUser?.email}
        onConfirm={() => void confirmDeleteUser()}
        onCancel={closeDeletePopup}
        closeOnOverlay={!deleteLoading}
        closeOnEsc={!deleteLoading}
        icon={<span className="cp-iconMark" aria-hidden="true">🗑</span>}
        footerNote={t("tipSetInactiveInsteadOfDeleting")}
      />

      <div className="ums-shell">
        {/* Top bar */}
        {!detailsOpen && (
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
              <h1>{t("userManagementSystem")}</h1>
            </div>
          </div>
        )}

        {detailsOpen && detailsUser ? (
          <div className="ums-card ums-details-page" role="region" aria-label="Edit user details">
            <div className="ums-details-page-head">
              <div className="ums-details-page-title-wrap">
                <h3><span className="ums-section-icon" aria-hidden>●</span>{t("userDetails")}</h3>
                <div className="ums-details-page-sub">{t("viewAndManageUserAccountSettings")}</div>
              </div>
              <button className="ums-back-btn" onClick={() => setDetailsOpen(false)} aria-label="Back to users list">
                {t("backToUsers")}
              </button>
            </div>

            <div className="ums-details-page-body">
              <div className={`ums-edit-page ${detailsEditing ? "is-editing" : "is-readonly"}`}>
                <div className="ums-edit-card">
                  <div className="ums-edit-card-head-wrap">
                    <div className="ums-edit-card-head"><span className="ums-card-icon" aria-hidden>●</span>{t("userInformation")}</div>
                    <PermissionGate moduleId="users" optionId="users_edit">
                      <button
                        type="button"
                        className="ums-card-edit-btn"
                        onClick={() => setDetailsEditing((v) => !v)}
                        disabled={isRootAdminSyntheticUser(detailsUser) || !canEditUsers}
                      >
                        {detailsEditing ? t("cancelEdit") : t("edit")}
                      </button>
                    </PermissionGate>
                  </div>
                  <div className={`ums-form-grid ${detailsEditing ? "" : "ums-form-grid-readonly"}`}>
                    <div>
                      <label className="ums-label">{t("employeeID")}</label>
                      {detailsEditing ? (
                        <input
                          className="ums-input"
                          value={editEmployeeId}
                          onChange={(e) => setEditEmployeeId(normalizeEmployeeId(e.target.value))}
                          placeholder="EMP001"
                        />
                      ) : (
                        <div className="ums-static-value">{String((detailsUser as any).employeeId ?? "").trim() || "—"}</div>
                      )}
                    </div>

                    <div>
                      <label className="ums-label">{t("Email")}</label>
                      <div className="ums-static-value">{detailsUser.email ?? "—"}</div>
                    </div>

                    <div>
                      <label className="ums-label">{t("firstName")}</label>
                      {detailsEditing ? (
                        <input
                          className="ums-input"
                          value={editFirstName}
                          onChange={(e) => setEditFirstName(e.target.value)}
                          placeholder={t("firstName")}
                        />
                      ) : (
                        <div className="ums-static-value">{editFirstName || "—"}</div>
                      )}
                    </div>

                    <div>
                      <label className="ums-label">{t("lastName")}</label>
                      {detailsEditing ? (
                        <input
                          className="ums-input"
                          value={editLastName}
                          onChange={(e) => setEditLastName(e.target.value)}
                          placeholder={t("lastName")}
                        />
                      ) : (
                        <div className="ums-static-value">{editLastName || "—"}</div>
                      )}
                    </div>

                    <div>
                      <label className="ums-label">{t("mobileNumber")}</label>
                      {detailsEditing ? (
                        <input
                          className="ums-input"
                          value={editMobileNumber}
                          onChange={(e) => setEditMobileNumber(e.target.value)}
                          placeholder="+974 1234 5678"
                        />
                      ) : (
                        <div className="ums-static-value">{editMobileNumber || "—"}</div>
                      )}
                    </div>

                    <div>
                      <label className="ums-label">{t("department")}</label>
                      {detailsEditing ? (
                        <select
                          className="ums-input"
                          value={editDepartmentKey}
                          onChange={(e) => {
                            const nextDept = e.target.value;
                            setEditDepartmentKey(nextDept);
                            setEditRoleKey("");
                          }}
                          disabled={loading}
                        >
                          <option value="">{t("selectEllipsis")}</option>
                          {departments.map((d) => (
                            <option key={d.key} value={d.key}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="ums-static-value">
                          {departments.find((d) => d.key === editDepartmentKey)?.name ?? detailsUser.departmentName ?? "—"}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="ums-label">{t("role")}</label>
                      {detailsEditing ? (
                        <>
                          <select
                            className="ums-input"
                            value={editRoleKey}
                            onChange={(e) => setEditRoleKey(e.target.value)}
                            disabled={loading || !editDepartmentKey}
                          >
                            <option value="">{t("selectEllipsis")}</option>
                            {availableRolesForEditDept.map((r) => (
                              <option key={String(r.id ?? "")} value={String(r.id ?? "")}>
                                {r.name ?? "—"}
                              </option>
                            ))}
                          </select>
                          {!editDepartmentKey && (
                            <div className="ums-field-hint">{t("selectDepartmentFirst")}</div>
                          )}
                        </>
                      ) : (
                        <div className="ums-static-value">{String((detailsUser as any).roleName ?? "").trim() || "—"}</div>
                      )}
                    </div>

                    <div className="ums-span-2">
                      <label className="ums-label">{t("lineManager")}</label>
                      {detailsEditing ? (
                        <select
                          className="ums-input"
                          value={editLineManagerEmail}
                          onChange={(e) => setEditLineManagerEmail(e.target.value)}
                          disabled={loading}
                        >
                          <option value="">{t("selectEllipsis")}</option>
                          {lineManagerOptions
                            .filter((o) => o.email !== String(detailsUser.email ?? "").trim().toLowerCase())
                            .map((opt) => (
                              <option key={opt.email} value={opt.email}>
                                {opt.label}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <div className="ums-static-value">
                          {String((detailsUser as any).lineManagerName ?? "").trim() || String((detailsUser as any).lineManagerEmail ?? "").trim() || "—"}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="ums-edit-card">
                  <div className="ums-edit-card-head"><span className="ums-card-icon" aria-hidden>●</span>{t("accountSettings")}</div>
                  <div className="ums-toggle-grid">
                    <div className="ums-toggle-row">
                      <div>
                        <div className="ums-toggle-title">{t("userStatus")}</div>
                        <div className="ums-toggle-sub">{t("inactiveUsersBlockedFromAccess")}</div>
                      </div>
                      <label className="ums-switch" aria-label="Toggle user active status">
                        <input
                          type="checkbox"
                          checked={editIsActive}
                          onChange={(e) => {
                            const next = e.target.checked;
                            setEditIsActive(next);
                            if (!next) setEditDashboardAccessEnabled(false);
                          }}
                          disabled={loading || !detailsEditing}
                        />
                        <span className="ums-switch-slider" />
                      </label>
                    </div>

                    <div className="ums-toggle-row">
                      <div>
                        <div className="ums-toggle-title">{t("dashboardAccess")}</div>
                        <div className="ums-toggle-sub">{t("disabledUsersCannotAccessDashboard")}</div>
                      </div>
                      <label className="ums-switch" aria-label="Toggle dashboard access">
                        <input
                          type="checkbox"
                          checked={editDashboardAccessEnabled}
                          onChange={(e) => setEditDashboardAccessEnabled(e.target.checked)}
                          disabled={loading || !editIsActive || !detailsEditing}
                        />
                        <span className="ums-switch-slider" />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="ums-edit-card">
                  <div className="ums-edit-card-head"><span className="ums-card-icon" aria-hidden>●</span>{t("passwordManagement")}</div>
                  {editUserLockoutInfo.active && (
                    <div className="ums-lockout-label" role="status" aria-live="polite">
                      {t("resetPassword")} ({editUserLockoutInfo.remainingMinutes} min left)
                    </div>
                  )}
                  <div className="ums-password-row">
                    <div>
                      <div className="ums-toggle-title">{t("resetUserPassword")}</div>
                      <div className="ums-toggle-sub">{t("sendPasswordResetEmailToUser")}</div>
                    </div>
                    <Button
                      onClick={() => void sendResetPassword(detailsUser)}
                      isDisabled={loading || isRootAdminSyntheticUser(detailsUser)}
                      disabled={!canEditUsers || loading}
                    >
                      {t("resetPassword")}
                    </Button>
                  </div>
                </div>
              </div>

              {detailsStatus && <div className={`ums-toast ${detailsStatus.includes("successfully") ? "" : "error"}`}>{detailsStatus}</div>}
            </div>

            <div className="ums-details-page-foot">
              <Button onClick={() => setDetailsOpen(false)}>{t("Close")}</Button>
              {detailsEditing && (
                <Button
                  variation="primary"
                  onClick={saveUserChanges}
                          disabled={isRootAdminSyntheticUser(detailsUser) || !canEditUsers}
                  isLoading={loading}
                >
                  {t("Save Changes")}
                </Button>
              )}
            </div>
          </div>
        ) : (
        <div className="ums-list-page">

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
              placeholder={t("searchByEmployeeNameEmailEtc")}
            />
          </div>

          <div className="ums-showing">
            Showing {from}-{to} of {total} {t("users")}
          </div>
        </div>

        {isDev && (
          <div
            className="ums-card"
            style={{
              marginTop: 10,
              marginBottom: 10,
              padding: "10px 12px",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
              RBAC self-check (dev only)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
              {rbacSelfCheckRows.map((item) => (
                <span
                  key={item.key}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 999,
                    border: "1px solid currentColor",
                  }}
                >
                  {item.key}: {item.value ? "ON" : "OFF"}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Users list */}
        <div className="ums-card ums-table-card">
          <div className="ums-table-header">
            <div className="ums-table-title">
              <span className="ums-list-icon" aria-hidden>≡</span>
              <h2>{t("usersList")}</h2>
            </div>

            <div className="ums-table-actions">
              <div className="ums-rpp">
                <span>{t("Records per page:")}</span>
                <select className="ums-select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>

              <PermissionGate moduleId="users" optionId="users_invite">
                <button
                  className="ums-add-btn"
                  onClick={() => {
                    setInviteStatus("");
                    setInviteOpen(true);
                  }}
                  disabled={!canInviteUsers}
                >
                  <span className="ums-add-icon" aria-hidden>+</span>
                  {t("addNewUser")}
                </button>
              </PermissionGate>
            </div>
          </div>

          {status && <div className="ums-status">{status}</div>}
          {!canViewUsersList && <div className="ums-status">{t("usersListDisabledForRole")}</div>}

          <div className="ums-table-scroll">
            <table className="ums-table">
              <thead>
                <tr>
                  <th>{t("employeeID")}</th>
                  <th>{t("employeeName")}</th>
                  <th>{t("emailAddress")}</th>
                  <th>{t("mobileNumber")}</th>
                  <th>{t("department")}</th>
                  <th>{t("role")}</th>
                  <th>{t("lineManager")}</th>
                  <th>{t("userStatus")}</th>
                  <th>{t("dashboardAccess")}</th>
                  <th className="ums-th-actions">{t("Actions")}</th>
                </tr>
              </thead>

              <tbody>
                {pageRows.map((row) => {
                  const u = row.u;
                  const isRootAdminRow = isRootAdminSyntheticUser(u);
                  const active = Boolean(u.isActive);  
                  const dashboardAccessEnabled = Boolean((u as any).dashboardAccessEnabled ?? true);
                  const dashAllowed = active && dashboardAccessEnabled;

                  return (
                    <tr key={u.id}>
                      <td data-label="Employee ID" className="ums-mono">{row.empId}</td>
                      <td data-label="Employee Name" className="ums-name">{u.fullName ?? "—"}</td>
                      <td data-label="Email Address" className="ums-email">{u.email ?? "—"}</td>
                      <td data-label="Mobile Number" className="ums-muted">{row.mobile || "—"}</td>

                      <td data-label="Department">
                        <span className="pill pill-dept">{row.deptName}</span>
                      </td>

                      <td data-label="Role">
                        <span className="pill pill-role">{row.roleName}</span>
                      </td>

                      <td data-label="Line Manager" className="ums-muted">
                        <span className="ums-line-manager-cell" title={row.lineManagerDisplay}>
                          {row.lineManagerDisplay}
                        </span>
                      </td>

                      <td data-label="User Status">
                        <span className={`pill ${active ? "pill-active" : "pill-inactive"}`}>
                          {active ? t("Active") : t("Inactive")}
                        </span>
                      </td>

                      <td data-label="Dashboard Access">
                        <span className={`pill ${dashAllowed ? "pill-allowed" : "pill-blocked"}`}>
                          {dashAllowed ? t("allowed") : t("blocked")}
                        </span>
                      </td>

                      <td data-label="Actions" className="ums-actions-cell">
                        {!isRootAdminRow && (canEditUsers || canDeleteUsers) && (
                          <PermissionGate moduleId="users" optionId="users_edit">
                            <button
                              className="ums-actions-btn"
                              type="button"
                              data-ums-menu-btn={u.id}
                              onClick={(e) => {
                                const el = e.currentTarget as HTMLElement;
                                if (menu.open && menu.userId === u.id) setMenu({ open: false });
                                else openActionsMenu(u.id, el);
                              }}
                              disabled={loading}
                            >
                              <span aria-hidden>⚙</span> Actions <span className="ums-caret" aria-hidden>▾</span>
                            </button>
                          </PermissionGate>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {!pageRows.length && (
                  <tr>
                    <td colSpan={10} className="ums-empty">
                      {t("noUsersFound")}
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
                <h3>{t("addNewUser")}</h3>
                <button className="ums-modal-close" onClick={() => setInviteOpen(false)} aria-label="Close">
                  ✕
                </button>
              </div>

              <div className="ums-modal-body">
                <div className="ums-form-grid">
                  <div>
                    <label className="ums-label">{t("employeeID")}</label>
                    <input
                      className="ums-input"
                      value={employeeId}
                      onChange={(e) => setEmployeeId(normalizeEmployeeId(e.target.value))}
                      placeholder="EMP001"
                    />
                  </div>

                  <div>
                    <label className="ums-label">{t("firstName")}</label>
                    <input
                      className="ums-input"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder={t("firstName")}
                    />
                  </div>

                  <div>
                    <label className="ums-label">{t("lastName")}</label>
                    <input
                      className="ums-input"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder={t("lastName")}
                    />
                  </div>

                  <div className="ums-span-2">
                    <label className="ums-label">{t("Email")}</label>
                    <input
                      className="ums-input"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="email@domain.com"
                      type="email"
                    />
                  </div>

                  <div className="ums-span-2">
                    <label className="ums-label">{t("mobileNumber")}</label>
                    <input
                      className="ums-input"
                      value={mobileNumber}
                      onChange={(e) => setMobileNumber(e.target.value)}
                      placeholder="+974 1234 5678"
                    />
                    <div className="ums-field-hint">{t("tipQatarFormat")}</div>
                  </div>

                  <div className="ums-span-2">
                    <label className="ums-label">{t("department")}</label>
                    <select
                      className="ums-input"
                      value={departmentKey}
                      onChange={(e) => {
                        const nextDept = e.target.value;
                        setDepartmentKey(nextDept);
                        setRoleKey("");
                      }}
                      disabled={loading}
                    >
                      <option value="">{t("selectEllipsis")}</option>
                      {departments.map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="ums-span-2">
                    <label className="ums-label">{t("role")}</label>
                    <select
                      className="ums-input"
                      value={roleKey}
                      onChange={(e) => setRoleKey(e.target.value)}
                      disabled={loading || !departmentKey}
                    >
                      <option value="">{t("selectEllipsis")}</option>
                      {availableRolesForDept.map((r) => (
                        <option key={String(r.id ?? "")} value={String(r.id ?? "")}>
                          {r.name ?? "—"}
                        </option>
                      ))}
                    </select>
                    {!departmentKey && (
                      <div className="ums-field-hint">{t("selectDepartmentFirst")}</div>
                    )}
                  </div>

                  <div className="ums-span-2">
                    <label className="ums-label">{t("lineManager")}</label>
                    <select
                      className="ums-input"
                      value={lineManagerEmail}
                      onChange={(e) => setLineManagerEmail(e.target.value)}
                      disabled={loading}
                    >
                      <option value="">{t("selectEllipsis")}</option>
                      {lineManagerOptions
                        .filter((o) => o.email !== String(email ?? "").trim().toLowerCase())
                        .map((opt) => (
                          <option key={opt.email} value={opt.email}>
                            {opt.label}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="ums-invite-link">
                  <div className="ums-invite-link-title">{t("loginPage")}</div>
                  <div className="ums-invite-link-value">
                    {crmLoginUrl}
                  </div>
                </div>

                <div className="ums-invite-link">
                  <div className="ums-invite-link-title">{t("setPasswordLinkLabel")}</div>
                  <div className="ums-invite-link-value">
                    {inviteLink || t("enterEmailToGenerateLink")}
                  </div>
                </div>

                {inviteStatus && <div className="ums-toast">{inviteStatus}</div>}
              </div>

              <div className="ums-modal-foot">
                <Button onClick={() => setInviteOpen(false)}>{t("Cancel")}</Button>
                <Button onClick={copyInviteLink} isDisabled={!inviteLink}>{t("copyLink")}</Button>
                <PermissionGate moduleId="users" optionId="users_invite">
                  <Button
                    variation="primary"
                    onClick={invite}
                    isDisabled={!canInviteUsers || loading}
                    isLoading={loading}
                  >
                    {t("inviteUser")}
                  </Button>
                </PermissionGate>
              </div>

              <div className="ums-hint">
                {t("usersGetAccessHint")}
              </div>
            </div>
          </div>
        )}
        </div>
        )}
      </div>
    </div>
  );
}
