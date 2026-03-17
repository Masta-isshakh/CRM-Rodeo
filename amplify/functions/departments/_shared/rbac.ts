// amplify/functions/departments/_shared/rbac.ts
// Shared server-side RBAC helpers for department Lambda functions.
// Mirrors the pattern from invite-user/handler.ts.

import type { Schema } from "../../../data/resource";
import {
  CognitoIdentityProviderClient,
  AdminListGroupsForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { DEPT_PREFIX } from "./departmentKey";

const cognito = new CognitoIdentityProviderClient();
const ADMIN_GROUP = "Admins";

// ─── key helpers ────────────────────────────────────────────────────────────

function normalizeKey(x: unknown) {
  return String(x ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function optKey(moduleId: string, optionId: string) {
  return `${normalizeKey(moduleId)}::${normalizeKey(optionId)}`;
}

// ─── event helpers ───────────────────────────────────────────────────────────

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
  return String(claims?.email ?? event?.identity?.claims?.email ?? event?.identity?.username ?? "")
    .trim()
    .toLowerCase();
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

// ─── Cognito group resolver ──────────────────────────────────────────────────

async function resolveGroups(event: any, userPoolId: string): Promise<string[]> {
  const groupsFromClaims = extractGroups(event);
  if (groupsFromClaims.length) return groupsFromClaims;

  const username = actorUsernameFromEvent(event);
  if (!username) return [];

  try {
    const res = await cognito.send(
      new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username })
    );
    return (res.Groups ?? []).map((g) => String(g.GroupName ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}

// ─── DynamoDB paginator ──────────────────────────────────────────────────────

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

// ─── UserProfile resolver ────────────────────────────────────────────────────

async function findUserProfileByEmail(
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
    const row = (exact?.data ?? [])[0] as any;
    if (row?.id) return row;
  } catch {
    // fallback below
  }

  const all = await dataClient.models.UserProfile.list({ limit: 20000 } as any);
  return (
    (all?.data ?? []).find(
      (row: any) => String(row?.email ?? "").trim().toLowerCase() === normalized
    ) ?? null
  );
}

async function findUserProfileForActor(
  dataClient: ReturnType<typeof generateClient<Schema>>,
  event: any
) {
  const email = actorEmailFromEvent(event);
  if (email) {
    const byEmail = await findUserProfileByEmail(dataClient, email);
    if (byEmail?.id) return byEmail;
  }

  const username = actorUsernameFromEvent(event);
  if (username) {
    const byUsername = await findUserProfileByEmail(dataClient, username);
    if (byUsername?.id) return byUsername;
  }

  const sub = actorSubFromEvent(event);
  if (sub) {
    const all = await dataClient.models.UserProfile.list({ limit: 20000 } as any);
    const match = (all?.data ?? []).find((row: any) => {
      const owner = String(row?.profileOwner ?? "").trim();
      if (!owner) return false;
      if (owner === sub) return true;
      return owner.split("::")[0]?.trim() === sub;
    });
    if (match?.id) return match as any;
  }

  return null;
}

// ─── Toggle aggregator ───────────────────────────────────────────────────────

function aggregateToggleMap(
  rows: Array<{ key?: string | null; enabled?: boolean | null }>
) {
  const out: Record<string, boolean> = {};
  for (const row of rows ?? []) {
    const k = normalizeKey(row?.key ?? "");
    if (!k) continue;
    out[k] = Boolean(out[k]) || Boolean(row?.enabled);
  }
  return out;
}

// ─── Main RBAC check ─────────────────────────────────────────────────────────

/**
 * Returns true when the calling user is authorized to perform the requested
 * department action based on Roles & Policies configuration.
 *
 * @param optionId     The fine-grained option key, e.g. "departments_create"
 * @param policyVerb   Which RolePolicy boolean to fall back to: "canCreate" | "canUpdate" | "canDelete"
 */
export async function canPerformDepartmentAction(
  event: any,
  optionId: string,
  policyVerb: "canCreate" | "canUpdate" | "canDelete"
): Promise<boolean> {
  const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
  if (!userPoolId) throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");

  const groups = await resolveGroups(event, userPoolId);

  // Admins always pass
  if (groups.includes(ADMIN_GROUP)) return true;

  // Build Amplify data client inside the Lambda runtime
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(
    process.env as any
  );
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const deptFromGroups = findDeptFromGroups(groups);
  const profile = await findUserProfileForActor(dataClient, event);
  const departmentKey = String(profile?.departmentKey ?? deptFromGroups ?? "").trim();
  const actorRoleId = String(profile?.roleId ?? "").trim();

  if (!departmentKey && !actorRoleId) return false;

  // Resolve role IDs
  let roleIds: string[];
  if (actorRoleId) {
    roleIds = [actorRoleId];
  } else {
    const links = await listAll<Schema["DepartmentRoleLink"]["type"]>((args) =>
      dataClient.models.DepartmentRoleLink.list({
        ...args,
        filter: { departmentKey: { eq: departmentKey } },
      } as any)
    );
    roleIds = Array.from(
      new Set(
        (links ?? []).map((l: any) => String(l?.roleId ?? "").trim()).filter(Boolean)
      )
    );
    if (!roleIds.length && departmentKey && !departmentKey.startsWith(DEPT_PREFIX)) {
      const alt = `${DEPT_PREFIX}${departmentKey}`;
      const altLinks = await listAll<Schema["DepartmentRoleLink"]["type"]>((args) =>
        dataClient.models.DepartmentRoleLink.list({
          ...args,
          filter: { departmentKey: { eq: alt } },
        } as any)
      );
      roleIds = Array.from(
        new Set(
          (altLinks ?? []).map((l: any) => String(l?.roleId ?? "").trim()).filter(Boolean)
        )
      );
    }
  }

  if (!roleIds.length) return false;

  const roleIdSet = new Set(roleIds);

  // Load option toggles
  const allToggles = await listAll<Schema["RoleOptionToggle"]["type"]>((args) =>
    dataClient.models.RoleOptionToggle.list(args)
  );

  const toggleMap = aggregateToggleMap(
    (allToggles ?? []).filter((r: any) => roleIdSet.has(String(r?.roleId ?? "").trim())) as any
  );

  const moduleEnabledKey = optKey("departments", "__enabled");
  const actionKey = optKey("departments", optionId);

  // Module must be enabled (defaults true if never set)
  const moduleEnabled =
    moduleEnabledKey in toggleMap ? Boolean(toggleMap[moduleEnabledKey]) : true;
  if (!moduleEnabled) return false;

  // Option check (defaults true if never set explicitly)
  const actionEnabled = actionKey in toggleMap ? Boolean(toggleMap[actionKey]) : true;
  if (!actionEnabled) return false;

  // If the option is explicitly toggled on, we're done
  if (Object.prototype.hasOwnProperty.call(toggleMap, actionKey)) return true;

  // Fall back to RolePolicy DEPARTMENTS_ADMIN macro permission
  const allPolicies = await listAll<Schema["RolePolicy"]["type"]>((args) =>
    dataClient.models.RolePolicy.list(args)
  );

  for (const policy of allPolicies ?? []) {
    const rid = String((policy as any)?.roleId ?? "").trim();
    if (!roleIdSet.has(rid)) continue;
    const key = normalizeKey((policy as any)?.policyKey ?? "");
    if (key !== "DEPARTMENTS_ADMIN") continue;
    if (Boolean((policy as any)?.[policyVerb])) return true;
  }

  return false;
}
