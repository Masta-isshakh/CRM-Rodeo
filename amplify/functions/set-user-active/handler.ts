import type { Schema } from "../../data/resource";

import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

type Handler = (event: { arguments: { email: string; isActive: boolean }; identity?: any; request?: any }) => Promise<{ ok: boolean; email: string; isActive: boolean }>;

const cognito = new CognitoIdentityProviderClient();
const ADMIN_GROUP = "Admins";
const DEPT_PREFIX = "DEPT_";

// ==================== Utility Functions ====================

function normalizeKey(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

function optKey(module: string, option: string): string {
  return `${module}::${option}`;
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
    claims?.["cognito:username"] ?? claims?.username ?? claims?.email ?? ""
  );
}

function actorSubFromEvent(event: any): string {
  const claims = event?.identity?.claims ?? event?.request?.userAttributes ?? {};
  return String(claims?.sub ?? "").trim();
}

function findDeptFromGroups(groups: string[]): string {
  return String((groups ?? []).find((g) => String(g).startsWith(DEPT_PREFIX)) ?? "").trim();
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

  if (!groups.length) {
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

  // Tier 1: lookup by email
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

  // Tier 2: lookup by username
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

  // Tier 3: lookup by sub (profileOwner match)
  if (sub) {
    try {
      const all = await dataClient.models.UserProfile.list({
        limit: 20000,
      } as any);
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

function aggregateToggleMap(toggleRecords: any[]): Record<string, boolean | number> {
  const map: Record<string, boolean | number> = {};
  for (const t of toggleRecords) {
    const k = normalizeKey(t?.key ?? "");
    if (!k) continue;
    map[k] = Boolean(map[k]) || Boolean(t?.enabled);
  }
  return map;
}

function isToggleExplicit(toggleMap: Record<string, boolean | number>, key: string) {
  return Object.prototype.hasOwnProperty.call(toggleMap, key);
}

async function canEditUsers(
  dataClient: ReturnType<typeof generateClient<Schema>>,
  event: any,
  userPoolId: string
): Promise<boolean> {
  const { adminGroup, deptKey } = await resolveGroups(userPoolId, event);
  console.log(`[set-user-active RBAC] resolved groups: adminGroup=${adminGroup} deptKey=${deptKey}`);

  if (adminGroup) return true;

  const { profile, email, username, sub } = await findUserProfileForActor(dataClient, event);
  console.log(`[set-user-active RBAC] actor profile: email=${email} username=${username} sub=${sub} dept=${profile?.departmentKey ?? "none"}`);

  const actorRoleId = String(profile?.roleId ?? "").trim();
  const deptFromGroups = findDeptFromGroups([deptKey].filter(Boolean));
  const dept = String(profile?.departmentKey ?? deptKey ?? deptFromGroups ?? "").trim();
  if (!actorRoleId && !dept) return false;

  try {
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
    console.log(`[set-user-active RBAC] roleIds: ${roleIds.join(", ")}`);

    const allToggles = await dataClient.models.RoleOptionToggle.list({ limit: 30000 });
    const roleToggles = (allToggles?.data ?? []).filter((t: any) =>
      roleIds.includes(t?.roleId)
    );

    const toggleMap = aggregateToggleMap(roleToggles);

    const moduleEnabledKey = "users::__enabled";
    const editKey = "users::users_edit";
    const moduleEnabled = isToggleExplicit(toggleMap, moduleEnabledKey)
      ? Boolean(toggleMap[moduleEnabledKey])
      : true;
    const editAllowedByOption = isToggleExplicit(toggleMap, editKey)
      ? Boolean(toggleMap[editKey])
      : null;
    console.log(`[set-user-active RBAC] module enabled: ${moduleEnabled} edit option: ${editAllowedByOption}`);

    if (!moduleEnabled) return false;
    if (editAllowedByOption !== null) return Boolean(editAllowedByOption);

    const roleIdSet = new Set(roleIds);
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
    console.log(`[set-user-active RBAC] USERS_ADMIN policy canUpdate: ${canUpdate}`);

    return canUpdate;
  } catch (err) {
    console.error("[set-user-active RBAC] error:", err);
    return false;
  }
}

// ==================== End Utility Functions ====================


async function resolveCognitoUsername(userPoolId: string, email: string): Promise<string> {
  try {
    await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }));
    return email;
  } catch {
    const listed = await cognito.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `email = "${email}"`,
        Limit: 1,
      })
    );

    const username = String(listed.Users?.[0]?.Username ?? "").trim();
    if (!username) throw new Error(`Cognito user not found for email: ${email}`);
    return username;
  }
}

async function findUserProfileByEmailCaseInsensitive(dataClient: ReturnType<typeof generateClient<Schema>>, email: string) {
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

  const all = await dataClient.models.UserProfile.list({
    limit: 20000,
  } as any);

  return (
    (all?.data ?? []).find((row: any) => String(row?.email ?? "").trim().toLowerCase() === normalized) ?? null
  );
}

export const handler: Handler = async (event) => {
  const { email, isActive } = event.arguments;

  const e = email.trim().toLowerCase();
  if (!e) throw new Error("Email is required.");

  const userPoolId =
    process.env.AMPLIFY_AUTH_USERPOOL_ID ||
    process.env.USERPOOL_ID ||
    process.env.USER_POOL_ID;
  if (!userPoolId) throw new Error("Missing Cognito User Pool env var (AMPLIFY_AUTH_USERPOOL_ID/USERPOOL_ID/USER_POOL_ID).");

  // RBAC check: Verify actor is authorized to edit users
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const allowed = await canEditUsers(dataClient, event, userPoolId);
  if (!allowed) {
    throw new Error("Not authorized to edit users. Check roles and policies configuration.");
  }

  const username = await resolveCognitoUsername(userPoolId, e);

  // 1) Disable/Enable in Cognito
  if (isActive) {
    await cognito.send(new AdminEnableUserCommand({ UserPoolId: userPoolId, Username: username }));
  } else {
    await cognito.send(new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: username }));
  }

  // 2) Update UserProfile in Data
  const profile = await findUserProfileByEmailCaseInsensitive(dataClient, e);

  if (profile?.id) {
    await dataClient.models.UserProfile.update({
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      profileOwner: profile.profileOwner,
      createdAt: profile.createdAt ?? new Date().toISOString(),
      isActive: !!isActive,
      dashboardAccessEnabled: isActive ? Boolean((profile as any).dashboardAccessEnabled ?? true) : false,
      departmentKey: profile.departmentKey ?? undefined,
      departmentName: profile.departmentName ?? undefined,
      roleId: (profile as any).roleId ?? undefined,
      roleName: (profile as any).roleName ?? undefined,
      employeeId: (profile as any).employeeId ?? undefined,
      lineManagerEmail: (profile as any).lineManagerEmail ?? undefined,
      lineManagerName: (profile as any).lineManagerName ?? undefined,
      failedLoginAttempts: Number((profile as any).failedLoginAttempts ?? 0),
      lastFailedLoginAt: (profile as any).lastFailedLoginAt ?? undefined,
      mobileNumber: profile.mobileNumber ?? undefined,
    });
  }

  return {
    ok: true,
    email: e,
    isActive: !!isActive,
  };
};
