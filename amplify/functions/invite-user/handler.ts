// amplify/functions/invite-user/handler.ts
import type { Schema } from "../../data/resource";

import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminResetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  AdminListGroupsForUserCommand,
  GetGroupCommand,
  CreateGroupCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

import { DEPT_PREFIX, keyToLabel } from "../departments/_shared/departmentKey";

type Handler = (event: any) => Promise<any>;
const cognito = new CognitoIdentityProviderClient();
const ADMIN_GROUP = "Admins";

function normalizeKey(x: unknown) {
  return String(x ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function optKey(moduleId: string, optionId: string) {
  return `${normalizeKey(moduleId)}::${normalizeKey(optionId)}`;
}

function pickGroupsFromClaims(claims: any): string[] {
  const g = claims?.["cognito:groups"] ?? claims?.groups;
  if (Array.isArray(g)) return g.map(String).filter(Boolean);
  if (typeof g === "string" && g.trim()) return [g.trim()];
  return [];
}

function extractGroups(event: any): string[] {
  const claims = event?.identity?.claims ?? event?.identity ?? {};
  return pickGroupsFromClaims(claims);
}

function actorEmailFromEvent(event: any): string {
  const claims = event?.identity?.claims ?? event?.request?.userAttributes ?? {};
  const email = String(claims?.email ?? event?.identity?.claims?.email ?? event?.identity?.username ?? "")
    .trim()
    .toLowerCase();
  if (email) return email;
  return "";
}

function actorUsernameFromEvent(event: any): string {
  return String(
    event?.identity?.username ??
      event?.identity?.claims?.["cognito:username"] ??
      event?.request?.userAttributes?.["cognito:username"] ??
      event?.request?.userAttributes?.username ??
      event?.identity?.claims?.email ??
      ""
  )
    .trim()
    .toLowerCase();
}

function actorSubFromEvent(event: any): string {
  return String(event?.identity?.claims?.sub ?? "").trim();
}

function findDeptFromGroups(groups: string[]): string {
  return String((groups ?? []).find((g) => String(g).startsWith(DEPT_PREFIX)) ?? "").trim();
}

async function resolveGroups(event: any, userPoolId: string): Promise<string[]> {
  const groupsFromClaims = extractGroups(event);
  if (groupsFromClaims.length) return groupsFromClaims;

  const username = actorUsernameFromEvent(event);
  if (!username) return [];

  try {
    const res = await cognito.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: userPoolId,
        Username: username,
      })
    );
    return (res.Groups ?? []).map((g) => String(g.GroupName ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}

async function listAll<T>(
  listFn: (args: any) => Promise<any>,
  pageSize = 1000,
  max = 20000
): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | null | undefined = undefined;

  while (out.length < max) {
    const res = await listFn({ limit: pageSize, nextToken });
    out.push(...((res?.data ?? []) as T[]));
    nextToken = res?.nextToken;
    if (!nextToken) break;
  }

  return out.slice(0, max);
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

async function findUserProfileForActor(
  dataClient: ReturnType<typeof generateClient<Schema>>,
  event: any
) {
  const actorEmail = actorEmailFromEvent(event);
  if (actorEmail) {
    const byEmail = await findUserProfileByEmailCaseInsensitive(dataClient, actorEmail);
    if (byEmail?.id) return byEmail;
  }

  const actorUsername = actorUsernameFromEvent(event);
  if (actorUsername) {
    const byUsername = await findUserProfileByEmailCaseInsensitive(dataClient, actorUsername);
    if (byUsername?.id) return byUsername;
  }

  const actorSub = actorSubFromEvent(event);
  if (actorSub) {
    const all = await dataClient.models.UserProfile.list({
      limit: 20000,
    } as any);
    const match = (all?.data ?? []).find((row: any) => {
      const owner = String(row?.profileOwner ?? "").trim();
      if (!owner) return false;
      if (owner === actorSub) return true;
      const ownerSub = owner.split("::")[0]?.trim();
      return ownerSub === actorSub;
    });
    if (match?.id) return match as any;
  }

  return null;
}

function aggregateToggleMap(rows: Array<{ key?: string | null; enabled?: boolean | null }>) {
  const out: Record<string, boolean> = {};
  for (const row of rows ?? []) {
    const k = normalizeKey(row?.key ?? "");
    if (!k) continue;
    out[k] = Boolean(out[k]) || Boolean(row?.enabled);
  }
  return out;
}

async function canInviteUsers(
  dataClient: ReturnType<typeof generateClient<Schema>>,
  event: any,
  userPoolId: string
): Promise<boolean> {
  const groups = await resolveGroups(event, userPoolId);
  console.log("[invite-user RBAC] resolved groups:", groups);
  if (groups.includes(ADMIN_GROUP)) return true;

  const deptFromGroups = findDeptFromGroups(groups);

  const profile = await findUserProfileForActor(dataClient, event);
  console.log("[invite-user RBAC] actor profile:", profile?.email ?? "NOT FOUND", "dept:", profile?.departmentKey ?? "NONE");
  const departmentKey = String(profile?.departmentKey ?? deptFromGroups ?? "").trim();
  const actorRoleId = String(profile?.roleId ?? "").trim();
  console.log("[invite-user RBAC] effective department:", departmentKey || "NONE", "(from", profile?.departmentKey ? "profile" : deptFromGroups ? "group" : "none", ")");
  if (!departmentKey && !actorRoleId) return false;

  const fetchLinksForDept = async (dk: string) =>
    await listAll<Schema["DepartmentRoleLink"]["type"]>((args) =>
      dataClient.models.DepartmentRoleLink.list({
        ...args,
        filter: { departmentKey: { eq: dk } },
      } as any)
    );

  let links: any[] = [];
  if (!actorRoleId) {
    links = await fetchLinksForDept(departmentKey);
    if ((!links || !links.length) && departmentKey && !departmentKey.startsWith(DEPT_PREFIX)) {
      const alt = `${DEPT_PREFIX}${departmentKey}`;
      links = await fetchLinksForDept(alt);
    }
  }

  const roleIds = actorRoleId
    ? [actorRoleId]
    : Array.from(
        new Set((links ?? []).map((l: any) => String(l?.roleId ?? "").trim()).filter(Boolean))
      );
  console.log("[invite-user RBAC] roleIds:", roleIds);
  if (!roleIds.length) return false;

  const roleIdSet = new Set(roleIds);

  const allToggles = await listAll<Schema["RoleOptionToggle"]["type"]>((args) =>
    dataClient.models.RoleOptionToggle.list(args)
  );

  const toggleMap = aggregateToggleMap(
    (allToggles ?? []).filter((r: any) => roleIdSet.has(String(r?.roleId ?? "").trim())) as any
  );

  const moduleEnabledKey = optKey("users", "__enabled");
  const inviteKey = optKey("users", "users_invite");

  const moduleEnabled = moduleEnabledKey in toggleMap ? Boolean(toggleMap[moduleEnabledKey]) : true;
  if (!moduleEnabled) return false;

  const inviteAllowedByOption = inviteKey in toggleMap ? Boolean(toggleMap[inviteKey]) : true;
  console.log("[invite-user RBAC] module enabled:", moduleEnabled, "invite option:", inviteAllowedByOption);
  if (!inviteAllowedByOption) return false;

  const inviteToggleExplicit = Object.prototype.hasOwnProperty.call(toggleMap, inviteKey);
  if (inviteToggleExplicit) return true;

  const allPolicies = await listAll<Schema["RolePolicy"]["type"]>((args) =>
    dataClient.models.RolePolicy.list(args)
  );

  let canCreate = false;
  let canUpdate = false;
  for (const policy of allPolicies ?? []) {
    const rid = String((policy as any)?.roleId ?? "").trim();
    if (!roleIdSet.has(rid)) continue;
    const key = normalizeKey((policy as any)?.policyKey ?? "");
    if (key !== "USERS_ADMIN") continue;
    canCreate = canCreate || Boolean((policy as any)?.canCreate);
    canUpdate = canUpdate || Boolean((policy as any)?.canUpdate);
    if (canCreate || canUpdate) break;
  }
  console.log("[invite-user RBAC] USERS_ADMIN policy canCreate:", canCreate, "canUpdate:", canUpdate);

  return canCreate || canUpdate;
}

function getAttr(attrs: { Name?: string; Value?: string }[] | undefined, name: string) {
  return (attrs ?? []).find((a) => a.Name === name)?.Value;
}

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

async function resolveCognitoUsernames(userPoolId: string, email: string, sub?: string): Promise<string[]> {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const normalizedSub = String(sub ?? "").trim();
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

  if (!usernames.size || normalizedSub) {
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

      if (normalizedSub && userSub === normalizedSub) {
        usernames.add(username);
      }
    }
  }

  return Array.from(usernames);
}

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const pick = (len: number) =>
    Array.from({ length: len }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");

  return `${pick(4)}aA1!${pick(6)}`;
}

async function ensureGroup(userPoolId: string, groupName: string, description: string) {
  try {
    await cognito.send(new GetGroupCommand({ UserPoolId: userPoolId, GroupName: groupName }));
    return;
  } catch (e: any) {
    if (e?.name !== "ResourceNotFoundException") throw e;
  }
  await cognito.send(
    new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: groupName, Description: description })
  );
}

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

export const handler: Handler = async (event) => {
  const employeeId = String((event.arguments as any)?.employeeId ?? "").trim();
  const lineManagerEmail = String((event.arguments as any)?.lineManagerEmail ?? "").trim().toLowerCase();
  const lineManagerName = String((event.arguments as any)?.lineManagerName ?? "").trim();
  const email = String(event.arguments?.email ?? "").trim().toLowerCase();
  const fullName = String(event.arguments?.fullName ?? "").trim();
  const departmentKey = String(event.arguments?.departmentKey ?? "").trim();
  const departmentNameFromArgs = String(event.arguments?.departmentName ?? "").trim();
  const roleId = String((event.arguments as any)?.roleId ?? "").trim();

  // ✅ NEW (backward-compatible)
  const mobileNumberRaw = (event.arguments as any)?.mobileNumber;
  const mobileNumber = String(mobileNumberRaw ?? "").trim(); // may be empty if schema didn't send it

  if (!email || !fullName) throw new Error("email and fullName are required.");
  if (!departmentKey.startsWith(DEPT_PREFIX)) {
    throw new Error(`departmentKey must start with ${DEPT_PREFIX}`);
  }

  // IMPORTANT: don't hard fail if schema/client didn't send it yet
  // You can enforce "required" on the UI, and AFTER schema update it'll always come.
  if (!mobileNumber) {
    console.warn(
      "invite-user: mobileNumber missing from event.arguments. Update amplify/data/resource.ts mutation args + regenerate client."
    );
  }

  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID env var.");

  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const allowed = await canInviteUsers(dataClient, event, userPoolId);
  if (!allowed) {
    throw new Error("Not authorized to invite users.");
  }

  const departmentName = departmentNameFromArgs || keyToLabel(departmentKey);
  await ensureGroup(userPoolId, departmentKey, departmentName);

  let sub: string | undefined;
  let inviteAction: "CREATED" | "RESET" = "CREATED";
  const temporaryPassword = generateTemporaryPassword();
  let cognitoUsername = email;
  const existingProfile = await findUserProfileByEmailCaseInsensitive(dataClient, email);
  const existingProfileSub = String(existingProfile?.profileOwner ?? "").split("::")[0]?.trim() || "";

  // 1) Create user OR re-send invite if exists
  try {
const createRes = await cognito.send(
  new AdminCreateUserCommand({
    UserPoolId: userPoolId,
    Username: email,
    TemporaryPassword: temporaryPassword,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "email_verified", Value: "true" },
      { Name: "name", Value: fullName },
    ],
    DesiredDeliveryMediums: ["EMAIL"],
    ForceAliasCreation: false
  })
);
    sub = getAttr(createRes.User?.Attributes, "sub");
  } catch (e: any) {
    if (e?.name !== "UsernameExistsException") throw e;

    const staleUsernames = await resolveCognitoUsernames(userPoolId, email, existingProfileSub);
    if (!existingProfile?.id && staleUsernames.length) {
      for (const staleUsername of staleUsernames) {
        await cognito.send(
          new AdminDeleteUserCommand({
            UserPoolId: userPoolId,
            Username: staleUsername,
          })
        );
      }

      const recreated = await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: email,
          TemporaryPassword: temporaryPassword,
          UserAttributes: [
            { Name: "email", Value: email },
            { Name: "email_verified", Value: "true" },
            { Name: "name", Value: fullName },
          ],
          DesiredDeliveryMediums: ["EMAIL"],
          ForceAliasCreation: false,
        })
      );

      sub = getAttr(recreated.User?.Attributes, "sub");
      cognitoUsername = email;
    } else {
      inviteAction = "RESET";
      cognitoUsername = staleUsernames[0] || (await resolveCognitoUsername(userPoolId, email));

      await cognito.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: userPoolId,
          Username: cognitoUsername,
          UserAttributes: [
            { Name: "email", Value: email },
            { Name: "email_verified", Value: "true" },
            { Name: "name", Value: fullName },
          ],
        })
      );

      // Some Cognito states reject direct reset ("User password cannot be reset in the current state").
      // Try reset first, then fall back to RESEND invite for users awaiting initial password setup.
      try {
        await cognito.send(
          new AdminResetUserPasswordCommand({
            UserPoolId: userPoolId,
            Username: cognitoUsername,
          })
        );
      } catch (resetErr: any) {
        const resetErrName = String(resetErr?.name ?? "").toLowerCase();
        const resetErrMsg = String(resetErr?.message ?? "").toLowerCase();
        const isCurrentStateResetIssue =
          resetErrName.includes("invalidparameter") &&
          (resetErrMsg.includes("cannot be reset in the current state") ||
            resetErrMsg.includes("current state"));

        if (!isCurrentStateResetIssue) {
          throw resetErr;
        }

        await cognito.send(
          new AdminCreateUserCommand({
            UserPoolId: userPoolId,
            Username: cognitoUsername,
            TemporaryPassword: temporaryPassword,
            UserAttributes: [
              { Name: "email", Value: email },
              { Name: "email_verified", Value: "true" },
              { Name: "name", Value: fullName },
            ],
            DesiredDeliveryMediums: ["EMAIL"],
            MessageAction: "RESEND",
            ForceAliasCreation: false,
          })
        );
      }
    }
  }

  // 2) Ensure user is in department group
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: cognitoUsername,
      GroupName: departmentKey,
    })
  );

  // 3) Resolve sub if missing
  if (!sub) {
    const getRes = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: cognitoUsername }));
    sub = getAttr(getRes.UserAttributes, "sub");
  }
  if (!sub) throw new Error("Could not resolve user sub.");

  // 4) Write UserProfile (Data)

  const profileOwner = `${sub}::${email}`;

  const existing = await dataClient.models.UserProfile.list({
    filter: { email: { eq: email } },
    limit: 1,
  });

  let roleName = "";
  if (roleId) {
    const roleRes = await dataClient.models.AppRole.list({
      filter: { id: { eq: roleId } },
      limit: 1,
    });
    roleName = String(roleRes.data?.[0]?.name ?? "").trim();
  }

  const payload: any = {
    employeeId: employeeId || undefined,
    email,
    fullName,
    departmentKey,
    departmentName,
    roleId: roleId || undefined,
    roleName: roleName || undefined,
    lineManagerEmail: lineManagerEmail || undefined,
    lineManagerName: lineManagerName || undefined,
    isActive: true,
    dashboardAccessEnabled: true,
    failedLoginAttempts: 0,
    lastFailedLoginAt: null,
    profileOwner,
    mobileNumber: mobileNumber || undefined, // ✅ save only if present
  };

  if (existing.data.length && existing.data[0]?.id) {
    await dataClient.models.UserProfile.update({
      id: existing.data[0].id,
      createdAt: existing.data[0].createdAt ?? new Date().toISOString(),
      ...payload,
    } as any);
  } else {
    await dataClient.models.UserProfile.create({
      createdAt: new Date().toISOString(),
      ...payload,
    } as any);
  }

  return {
    ok: true,
    invitedEmail: email,
    cognitoUsername,
    departmentKey,
    departmentName,
    roleId: roleId || null,
    roleName: roleName || null,
    sub,
    inviteAction,
    emailDeliveryMedium: "EMAIL",
    employeeId: employeeId || null,
    lineManagerEmail: lineManagerEmail || null,
    lineManagerName: lineManagerName || null,
    mobileNumber: mobileNumber || null,
  };
};
