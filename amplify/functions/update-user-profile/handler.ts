import type { Schema } from "../../data/resource";
import {
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

type Handler = (event: {
  arguments: {
    email: string;
    fullName?: string;
    employeeId?: string;
    roleId?: string;
    roleName?: string;
    mobileNumber?: string;
    lineManagerEmail?: string;
    lineManagerName?: string;
    dashboardAccessEnabled?: boolean;
  };
  identity?: any;
  request?: any;
}) => Promise<any>;

const cognito = new CognitoIdentityProviderClient();
const ADMIN_GROUP = "Admins";
const DEPT_PREFIX = "DEPT_";

function normalizeKey(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

function pickGroupsFromClaims(claims: any): string[] {
  const raw = claims?.["cognito:groups"];
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && typeof raw === "string") return [raw];
  return [];
}

function extractGroups(groups: string[]): { adminGroup: boolean; deptKey: string } {
  const isAdmin = groups.includes(ADMIN_GROUP);
  const deptKey = groups.find((g) => g.startsWith(DEPT_PREFIX)) ?? "";
  return { adminGroup: isAdmin, deptKey };
}

function actorEmailFromEvent(event: any): string {
  const claims = event?.identity?.claims ?? event?.request?.userAttributes ?? {};
  return normalizeKey(claims?.email ?? claims?.["cognito:username"] ?? event?.identity?.username ?? "");
}

function actorUsernameFromEvent(event: any): string {
  const claims = event?.identity?.claims ?? event?.request?.userAttributes ?? {};
  return normalizeKey(
    claims?.["cognito:username"] ?? claims?.username ?? claims?.email ?? event?.identity?.username ?? ""
  );
}

function actorSubFromEvent(event: any): string {
  const claims = event?.identity?.claims ?? event?.request?.userAttributes ?? {};
  return String(claims?.sub ?? "").trim();
}

function expandDepartmentCandidates(dept: string): string[] {
  const d = String(dept ?? "").trim();
  if (!d) return [];
  if (d.startsWith(DEPT_PREFIX)) {
    const bare = d.slice(DEPT_PREFIX.length);
    return bare ? [d, bare] : [d];
  }
  return [d, `${DEPT_PREFIX}${d}`];
}

async function resolveGroups(
  userPoolId: string,
  event: any
): Promise<{ adminGroup: boolean; deptKey: string }> {
  const claims = event?.identity?.claims ?? event?.request?.userAttributes ?? {};
  let groups = pickGroupsFromClaims(claims);

  if (!groups.length && userPoolId) {
    const username = actorUsernameFromEvent(event);
    if (username) {
      try {
        const res = await cognito.send(
          new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username })
        );
        groups = (res.Groups ?? []).map((g) => String(g.GroupName ?? ""));
      } catch {
        // fallback: no groups
      }
    }
  }

  return extractGroups(groups);
}

async function findUserProfileForActor(
  dataClient: ReturnType<typeof generateClient<Schema>>,
  event: any
): Promise<{ profile: any; email: string; username: string; sub: string }> {
  const email = actorEmailFromEvent(event);
  const username = actorUsernameFromEvent(event);
  const sub = actorSubFromEvent(event);

  if (email) {
    try {
      const byEmail = await dataClient.models.UserProfile.list({
        filter: { email: { eq: email } },
        limit: 1,
      });
      const row = (byEmail?.data ?? [])[0] as any;
      if (row?.id) return { profile: row, email, username, sub };
    } catch {
      // continue
    }
  }

  if (username && username !== email) {
    try {
      const byUsername = await dataClient.models.UserProfile.list({
        filter: { email: { eq: username } },
        limit: 1,
      });
      const row = (byUsername?.data ?? [])[0] as any;
      if (row?.id) return { profile: row, email, username, sub };
    } catch {
      // continue
    }
  }

  if (sub) {
    try {
      const all = await dataClient.models.UserProfile.list({ limit: 20000 } as any);
      const row = (all?.data ?? []).find((r: any) => {
        const owner = String(r?.profileOwner ?? "").trim();
        if (!owner) return false;
        if (owner === sub) return true;
        const ownerSub = owner.split("::")[0]?.trim();
        return ownerSub === sub;
      }) as any;
      if (row?.id) return { profile: row, email, username, sub };
    } catch {
      // continue
    }
  }

  return { profile: null, email, username, sub };
}

function aggregateToggleMap(toggleRecords: any[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const t of toggleRecords ?? []) {
    const k = normalizeKey(t?.key ?? "");
    if (!k) continue;
    map[k] = Boolean(map[k]) || Boolean(t?.enabled);
  }
  return map;
}

function isToggleExplicit(toggleMap: Record<string, boolean>, key: string) {
  return Object.prototype.hasOwnProperty.call(toggleMap, key);
}

async function canEditUsers(
  dataClient: ReturnType<typeof generateClient<Schema>>,
  event: any,
  userPoolId: string
): Promise<boolean> {
  const { adminGroup, deptKey } = await resolveGroups(userPoolId, event);
  if (adminGroup) return true;

  const { profile } = await findUserProfileForActor(dataClient, event);
  const actorRoleId = String(profile?.roleId ?? "").trim();
  const dept = String(profile?.departmentKey ?? deptKey ?? "").trim();
  if (!actorRoleId && !dept) return false;

  let roleIds: string[] = [];
  if (actorRoleId) {
    roleIds = [actorRoleId];
  } else {
    const candidates = expandDepartmentCandidates(dept);
    const collected = new Set<string>();
    for (const candidate of candidates) {
      const deptLinks = await dataClient.models.DepartmentRoleLink.list({
        filter: { departmentKey: { eq: candidate } },
        limit: 100,
      });
      for (const link of deptLinks?.data ?? []) {
        const rid = String((link as any)?.roleId ?? "").trim();
        if (rid) collected.add(rid);
      }
    }
    roleIds = Array.from(collected);
  }

  if (!roleIds.length) return false;
  const roleIdSet = new Set(roleIds);

  const allToggles = await dataClient.models.RoleOptionToggle.list({ limit: 30000 } as any);
  const roleToggles = (allToggles?.data ?? []).filter((t: any) =>
    roleIdSet.has(String(t?.roleId ?? "").trim())
  );
  const toggleMap = aggregateToggleMap(roleToggles);

  const moduleEnabledKey = "users.__enabled";
  const editKey = "users::users_edit";

  const moduleEnabled = isToggleExplicit(toggleMap, moduleEnabledKey)
    ? Boolean(toggleMap[moduleEnabledKey])
    : true;
  if (!moduleEnabled) return false;

  if (isToggleExplicit(toggleMap, editKey)) {
    return Boolean(toggleMap[editKey]);
  }

  const policies = await dataClient.models.RolePolicy.list({ limit: 30000 } as any);
  let canUpdate = false;
  for (const p of policies?.data ?? []) {
    const rid = String((p as any)?.roleId ?? "").trim();
    if (!roleIdSet.has(rid)) continue;
    const key = normalizeKey((p as any)?.policyKey ?? "");
    if (key !== "users_admin") continue;
    canUpdate = canUpdate || Boolean((p as any)?.canUpdate);
    if (canUpdate) break;
  }

  return canUpdate;
}

async function findUserProfileByEmailCaseInsensitive(
  dataClient: ReturnType<typeof generateClient<Schema>>,
  email: string
) {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized) return null;

  try {
    const exact = await dataClient.models.UserProfile.list({
      filter: { email: { eq: normalized } },
      limit: 1,
    });
    const exactRow = (exact?.data ?? [])[0] as any;
    if (exactRow?.id) return exactRow;
  } catch {
    // fallback below
  }

  const all = await dataClient.models.UserProfile.list({ limit: 20000 } as any);
  return (all?.data ?? []).find((row: any) => String(row?.email ?? "").trim().toLowerCase() === normalized) ?? null;
}

export const handler: Handler = async (event) => {
  const email = String(event.arguments?.email ?? "").trim().toLowerCase();
  if (!email) throw new Error("Email is required.");

  const userPoolId =
    process.env.AMPLIFY_AUTH_USERPOOL_ID ||
    process.env.USERPOOL_ID ||
    process.env.USER_POOL_ID;

  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const allowed = await canEditUsers(dataClient, event, String(userPoolId ?? ""));
  if (!allowed) {
    throw new Error("Not authorized to edit users. Check roles and policies configuration.");
  }

  const profile = await findUserProfileByEmailCaseInsensitive(dataClient, email);
  if (!profile?.id) throw new Error(`UserProfile not found for ${email}`);

  const nextFullName = String(event.arguments?.fullName ?? profile.fullName ?? "").trim();
  const nextEmployeeId = String(event.arguments?.employeeId ?? profile.employeeId ?? "").trim();
  const nextRoleId = String(event.arguments?.roleId ?? profile.roleId ?? "").trim();
  const nextRoleName = String(event.arguments?.roleName ?? profile.roleName ?? "").trim();
  const nextMobile = String(event.arguments?.mobileNumber ?? profile.mobileNumber ?? "").trim();
  const nextLineManagerEmail = String(event.arguments?.lineManagerEmail ?? profile.lineManagerEmail ?? "").trim().toLowerCase();
  const nextLineManagerName = String(event.arguments?.lineManagerName ?? profile.lineManagerName ?? "").trim();

  const dashboardAccessEnabled =
    typeof event.arguments?.dashboardAccessEnabled === "boolean"
      ? Boolean(event.arguments.dashboardAccessEnabled)
      : Boolean((profile as any)?.dashboardAccessEnabled ?? true);

  await dataClient.models.UserProfile.update({
    id: profile.id,
    email: profile.email,
    fullName: nextFullName || profile.fullName,
    profileOwner: profile.profileOwner,
    createdAt: profile.createdAt ?? new Date().toISOString(),
    isActive: Boolean((profile as any)?.isActive ?? true),
    dashboardAccessEnabled,
    departmentKey: profile.departmentKey ?? undefined,
    departmentName: profile.departmentName ?? undefined,
    roleId: nextRoleId || undefined,
    roleName: nextRoleName || undefined,
    employeeId: nextEmployeeId || undefined,
    lineManagerEmail: nextLineManagerEmail || undefined,
    lineManagerName: nextLineManagerName || undefined,
    failedLoginAttempts: Number((profile as any)?.failedLoginAttempts ?? 0),
    lastFailedLoginAt: (profile as any)?.lastFailedLoginAt ?? undefined,
    mobileNumber: nextMobile || undefined,
  } as any);

  return {
    ok: true,
    email,
    fullName: nextFullName || profile.fullName,
    roleId: nextRoleId || null,
    roleName: nextRoleName || null,
  };
};
