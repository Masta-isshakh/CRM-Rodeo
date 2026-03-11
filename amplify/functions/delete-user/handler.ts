import type { Schema } from "../../data/resource";

import {
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

type Handler = (event: any) => Promise<any>;

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
  return normalizeKey(claims?.email ?? claims?.["cognito:username"] ?? "");
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
      const bySub = await dataClient.models.UserProfile.list({
        filter: { profileOwner: { eq: sub } },
        limit: 1,
      });
      const row = (bySub?.data ?? [])[0] as any;
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
    const k = normalizeKey(t?.toggleKey ?? "");
    if (!k) continue;
    if (t.valueType === "boolean") map[k] = !!t.boolValue;
    else if (t.valueType === "number") map[k] = Number(t.numValue ?? 0);
  }
  return map;
}

async function canDeleteUsers(
  dataClient: ReturnType<typeof generateClient<Schema>>,
  event: any,
  userPoolId: string
): Promise<boolean> {
  const { adminGroup, deptKey } = await resolveGroups(userPoolId, event);
  console.log(`[delete-user RBAC] resolved groups: adminGroup=${adminGroup} deptKey=${deptKey}`);

  if (adminGroup) return true;

  const { profile, email, username, sub } = await findUserProfileForActor(dataClient, event);
  console.log(`[delete-user RBAC] actor profile: email=${email} username=${username} sub=${sub} dept=${profile?.departmentKey ?? "none"}`);

  if (!profile?.id) return false;

  const actorRoleId = String(profile?.roleId ?? "").trim();
  const dept = profile.departmentKey ?? deptKey;
  if (!actorRoleId && !dept) return false;

  try {
    let roleIds: string[] = [];
    if (actorRoleId) {
      roleIds = [actorRoleId];
    } else {
      const deptLinks = await dataClient.models.DepartmentRoleLink.list({
        filter: { departmentKey: { eq: dept } },
        limit: 100,
      });

      roleIds = (deptLinks?.data ?? [])
        .map((link: any) => String(link?.roleId ?? "").trim())
        .filter((rid: any) => !!rid);
    }

    if (!roleIds.length) return false;
    console.log(`[delete-user RBAC] roleIds: ${roleIds.join(", ")}`);

    const allToggles = await dataClient.models.RoleOptionToggle.list({ limit: 30000 });
    const roleToggles = (allToggles?.data ?? []).filter((t: any) =>
      roleIds.includes(t?.roleId)
    );

    const toggleMap = aggregateToggleMap(roleToggles);

    const moduleEnabled = toggleMap["users.__enabled"] === true;
    const deleteAllowedByOption = toggleMap["users::users_delete"] === true;
    console.log(`[delete-user RBAC] module enabled: ${moduleEnabled} delete option: ${deleteAllowedByOption}`);

    if (moduleEnabled && deleteAllowedByOption) return true;

    const policies = await dataClient.models.RolePolicy.list({
      filter: { roleId: { eq: roleIds[0] } },
      limit: 1000,
    });

    const usersPolicy = (policies?.data ?? []).find(
      (p: any) => normalizeKey(p?.module ?? "") === "users_admin"
    );

    const canDelete = usersPolicy?.canDelete ?? false;
    console.log(`[delete-user RBAC] USERS_ADMIN policy canDelete: ${canDelete}`);

    return canDelete;
  } catch (err) {
    console.error("[delete-user RBAC] error:", err);
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
    if (!username) return "";
    return username;
  }
}

export const handler: Handler = async (event: any) => {
  const email = String(event.arguments?.email ?? "").trim().toLowerCase();
  if (!email) throw new Error("Email is required.");

  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID env var.");

  // RBAC check: Verify actor is authorized to delete users
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const allowed = await canDeleteUsers(dataClient, event, userPoolId);
  if (!allowed) {
    throw new Error("Not authorized to delete users. Check roles and policies configuration.");
  }

  const username = await resolveCognitoUsername(userPoolId, email);
  let cognitoDeleted = false;

  // 1) Delete Cognito user (if it still exists)
  if (username) {
    try {
      await cognito.send(
        new AdminDeleteUserCommand({
          UserPoolId: userPoolId,
          Username: username,
        })
      );
      cognitoDeleted = true;
    } catch (e: any) {
      if (String(e?.name ?? "") !== "UserNotFoundException") {
        throw e;
      }
    }
  }

  // 2) Delete UserProfile records (NOT Customer)
  const profiles = await dataClient.models.UserProfile.list({
    filter: { email: { eq: email } },
    limit: 50,
  });

  for (const p of profiles.data ?? []) {
    await dataClient.models.UserProfile.delete({ id: p.id });
  }

  return {
    ok: true,
    email,
    username: username || null,
    cognitoDeleted,
    deletedProfiles: (profiles.data ?? []).length,
  };
};
