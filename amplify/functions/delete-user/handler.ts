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

function getAttr(attrs: { Name?: string; Value?: string }[] | undefined, name: string) {
  return (attrs ?? []).find((a) => a.Name === name)?.Value;
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
    console.log(`[delete-user RBAC] roleIds: ${roleIds.join(", ")}`);

    const allToggles = await dataClient.models.RoleOptionToggle.list({ limit: 30000 });
    const roleToggles = (allToggles?.data ?? []).filter((t: any) =>
      roleIds.includes(t?.roleId)
    );

    const toggleMap = aggregateToggleMap(roleToggles);

    const moduleEnabledKey = "users.__enabled";
    const deleteKey = "users::users_delete";
    const moduleEnabled = isToggleExplicit(toggleMap, moduleEnabledKey)
      ? Boolean(toggleMap[moduleEnabledKey])
      : true;
    const deleteAllowedByOption = isToggleExplicit(toggleMap, deleteKey)
      ? Boolean(toggleMap[deleteKey])
      : null;
    console.log(`[delete-user RBAC] module enabled: ${moduleEnabled} delete option: ${deleteAllowedByOption}`);

    if (!moduleEnabled) return false;
    if (deleteAllowedByOption !== null) return Boolean(deleteAllowedByOption);

    const roleIdSet = new Set(roleIds);
    const policies = await dataClient.models.RolePolicy.list({ limit: 30000 } as any);

    let canDelete = false;
    for (const p of policies?.data ?? []) {
      const rid = String((p as any)?.roleId ?? "").trim();
      if (!roleIdSet.has(rid)) continue;
      const key = normalizeKey((p as any)?.policyKey ?? "");
      if (key !== "users_admin") continue;
      canDelete = canDelete || Boolean((p as any)?.canDelete);
      if (canDelete) break;
    }
    console.log(`[delete-user RBAC] USERS_ADMIN policy canDelete: ${canDelete}`);

    return canDelete;
  } catch (err) {
    console.error("[delete-user RBAC] error:", err);
    return false;
  }
}

// ==================== End Utility Functions ====================


async function listAllCognitoUsers(userPoolId: string, max = 5000) {
  const out: Array<{ Username?: string; Attributes?: { Name?: string; Value?: string }[] }> = [];
  let paginationToken: string | undefined;

  while (out.length < max) {
    const res = await cognito.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Limit: 60,
        PaginationToken: paginationToken,
      })
    );

    out.push(...(res.Users ?? []));
    paginationToken = res.PaginationToken;
    if (!paginationToken) break;
  }

  return out;
}

async function resolveCognitoUsernames(userPoolId: string, email: string, subCandidates: string[] = []): Promise<string[]> {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const normalizedSubs = new Set(
    (subCandidates ?? []).map((value) => String(value ?? "").trim()).filter(Boolean)
  );
  const usernames = new Set<string>();

  if (normalizedEmail) {
    try {
      await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: normalizedEmail }));
      usernames.add(normalizedEmail);
    } catch {
      // continue
    }

    try {
      const listed = await cognito.send(
        new ListUsersCommand({
          UserPoolId: userPoolId,
          Filter: `email = "${normalizedEmail}"`,
          Limit: 10,
        })
      );
      for (const user of listed.Users ?? []) {
        const username = String(user.Username ?? "").trim();
        if (username) usernames.add(username);
      }
    } catch {
      // continue
    }
  }

  if (!usernames.size || normalizedSubs.size) {
    const allUsers = await listAllCognitoUsers(userPoolId);
    for (const user of allUsers) {
      const username = String(user.Username ?? "").trim();
      const userEmail = String(getAttr(user.Attributes, "email") ?? "").trim().toLowerCase();
      const userSub = String(getAttr(user.Attributes, "sub") ?? "").trim();
      if (!username) continue;

      if (normalizedEmail && (username.toLowerCase() === normalizedEmail || userEmail === normalizedEmail)) {
        usernames.add(username);
        continue;
      }

      if (userSub && normalizedSubs.has(userSub)) {
        usernames.add(username);
      }
    }
  }

  return Array.from(usernames);
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

  const profiles = await dataClient.models.UserProfile.list({
    filter: { email: { eq: email } },
    limit: 50,
  });

  const subCandidates = (profiles.data ?? [])
    .map((profile) => String((profile as any)?.profileOwner ?? "").split("::")[0]?.trim() || "")
    .filter(Boolean);

  const usernames = await resolveCognitoUsernames(userPoolId, email, subCandidates);
  let cognitoDeleted = false;
  let cognitoDeletedCount = 0;

  // 1) Delete Cognito user (if it still exists)
  for (const username of usernames) {
    if (!username) continue;
    try {
      await cognito.send(
        new AdminDeleteUserCommand({
          UserPoolId: userPoolId,
          Username: username,
        })
      );
      cognitoDeleted = true;
      cognitoDeletedCount += 1;
    } catch (e: any) {
      if (String(e?.name ?? "") !== "UserNotFoundException") {
        throw e;
      }
    }
  }

  // 2) Delete UserProfile records (NOT Customer)
  for (const p of profiles.data ?? []) {
    await dataClient.models.UserProfile.delete({ id: p.id });
  }

  return {
    ok: true,
    email,
    username: usernames[0] || null,
    cognitoDeleted,
    cognitoDeletedCount,
    deletedProfiles: (profiles.data ?? []).length,
  };
};
