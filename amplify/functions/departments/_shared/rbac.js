// amplify/functions/departments/_shared/rbac.ts
// Shared server-side RBAC helpers for department Lambda functions.
// Mirrors the pattern from invite-user/handler.ts.
import { CognitoIdentityProviderClient, AdminListGroupsForUserCommand, } from "@aws-sdk/client-cognito-identity-provider";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { DEPT_PREFIX } from "./departmentKey";
const cognito = new CognitoIdentityProviderClient();
const ADMIN_GROUP = "Admins";
// ─── key helpers ────────────────────────────────────────────────────────────
function normalizeKey(x) {
    return String(x ?? "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "_");
}
function optKey(moduleId, optionId) {
    return `${normalizeKey(moduleId)}::${normalizeKey(optionId)}`;
}
// ─── event helpers ───────────────────────────────────────────────────────────
function pickGroupsFromClaims(claims) {
    const g = claims?.["cognito:groups"] ?? claims?.groups;
    if (Array.isArray(g))
        return g.map(String).filter(Boolean);
    if (typeof g === "string" && g.trim())
        return [g.trim()];
    return [];
}
function extractGroups(event) {
    const claims = event?.identity?.claims ?? event?.identity ?? {};
    return pickGroupsFromClaims(claims);
}
function actorEmailFromEvent(event) {
    const claims = event?.identity?.claims ?? event?.request?.userAttributes ?? {};
    return String(claims?.email ?? event?.identity?.claims?.email ?? event?.identity?.username ?? "")
        .trim()
        .toLowerCase();
}
function actorUsernameFromEvent(event) {
    return String(event?.identity?.username ??
        event?.identity?.claims?.["cognito:username"] ??
        event?.request?.userAttributes?.["cognito:username"] ??
        event?.request?.userAttributes?.username ??
        event?.identity?.claims?.email ??
        "")
        .trim()
        .toLowerCase();
}
function actorSubFromEvent(event) {
    return String(event?.identity?.claims?.sub ?? "").trim();
}
function findDeptFromGroups(groups) {
    return String((groups ?? []).find((g) => String(g).startsWith(DEPT_PREFIX)) ?? "").trim();
}
// ─── Cognito group resolver ──────────────────────────────────────────────────
async function resolveGroups(event, userPoolId) {
    const groupsFromClaims = extractGroups(event);
    if (groupsFromClaims.length)
        return groupsFromClaims;
    const username = actorUsernameFromEvent(event);
    if (!username)
        return [];
    try {
        const res = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username }));
        return (res.Groups ?? []).map((g) => String(g.GroupName ?? "")).filter(Boolean);
    }
    catch {
        return [];
    }
}
// ─── DynamoDB paginator ──────────────────────────────────────────────────────
async function listAll(listFn, pageSize = 1000, max = 20000) {
    const out = [];
    let nextToken = undefined;
    while (out.length < max) {
        const res = await listFn({ limit: pageSize, nextToken });
        out.push(...(res?.data ?? []));
        nextToken = res?.nextToken;
        if (!nextToken)
            break;
    }
    return out.slice(0, max);
}
// ─── UserProfile resolver ────────────────────────────────────────────────────
async function findUserProfileByEmail(dataClient, email) {
    const normalized = String(email ?? "").trim().toLowerCase();
    if (!normalized)
        return null;
    try {
        const exact = await dataClient.models.UserProfile.list({
            filter: { email: { eq: normalized } },
            limit: 1,
        });
        const row = (exact?.data ?? [])[0];
        if (row?.id)
            return row;
    }
    catch {
        // fallback below
    }
    const all = await dataClient.models.UserProfile.list({ limit: 20000 });
    return ((all?.data ?? []).find((row) => String(row?.email ?? "").trim().toLowerCase() === normalized) ?? null);
}
async function findUserProfileForActor(dataClient, event) {
    const email = actorEmailFromEvent(event);
    if (email) {
        const byEmail = await findUserProfileByEmail(dataClient, email);
        if (byEmail?.id)
            return byEmail;
    }
    const username = actorUsernameFromEvent(event);
    if (username) {
        const byUsername = await findUserProfileByEmail(dataClient, username);
        if (byUsername?.id)
            return byUsername;
    }
    const sub = actorSubFromEvent(event);
    if (sub) {
        const all = await dataClient.models.UserProfile.list({ limit: 20000 });
        const match = (all?.data ?? []).find((row) => {
            const owner = String(row?.profileOwner ?? "").trim();
            if (!owner)
                return false;
            if (owner === sub)
                return true;
            return owner.split("::")[0]?.trim() === sub;
        });
        if (match?.id)
            return match;
    }
    return null;
}
// ─── Toggle aggregator ───────────────────────────────────────────────────────
function aggregateToggleMap(rows) {
    const out = {};
    for (const row of rows ?? []) {
        const k = normalizeKey(row?.key ?? "");
        if (!k)
            continue;
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
export async function canPerformDepartmentAction(event, optionId, policyVerb) {
    const userPoolId = process.env.AMPLIFY_AUTH_USERPOOL_ID;
    if (!userPoolId)
        throw new Error("Missing AMPLIFY_AUTH_USERPOOL_ID");
    const groups = await resolveGroups(event, userPoolId);
    // Admins always pass
    if (groups.includes(ADMIN_GROUP))
        return true;
    // Build Amplify data client inside the Lambda runtime
    const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env);
    Amplify.configure(resourceConfig, libraryOptions);
    const dataClient = generateClient();
    const deptFromGroups = findDeptFromGroups(groups);
    const profile = await findUserProfileForActor(dataClient, event);
    const departmentKey = String(profile?.departmentKey ?? deptFromGroups ?? "").trim();
    const actorRoleId = String(profile?.roleId ?? "").trim();
    if (!departmentKey && !actorRoleId)
        return false;
    // Resolve role IDs
    let roleIds;
    if (actorRoleId) {
        roleIds = [actorRoleId];
    }
    else {
        const links = await listAll((args) => dataClient.models.DepartmentRoleLink.list({
            ...args,
            filter: { departmentKey: { eq: departmentKey } },
        }));
        roleIds = Array.from(new Set((links ?? []).map((l) => String(l?.roleId ?? "").trim()).filter(Boolean)));
        if (!roleIds.length && departmentKey && !departmentKey.startsWith(DEPT_PREFIX)) {
            const alt = `${DEPT_PREFIX}${departmentKey}`;
            const altLinks = await listAll((args) => dataClient.models.DepartmentRoleLink.list({
                ...args,
                filter: { departmentKey: { eq: alt } },
            }));
            roleIds = Array.from(new Set((altLinks ?? []).map((l) => String(l?.roleId ?? "").trim()).filter(Boolean)));
        }
    }
    if (!roleIds.length)
        return false;
    const roleIdSet = new Set(roleIds);
    // Load option toggles
    const allToggles = await listAll((args) => dataClient.models.RoleOptionToggle.list(args));
    const toggleMap = aggregateToggleMap((allToggles ?? []).filter((r) => roleIdSet.has(String(r?.roleId ?? "").trim())));
    const moduleEnabledKey = optKey("departments", "__enabled");
    const actionKey = optKey("departments", optionId);
    // Module must be enabled (defaults true if never set)
    const moduleEnabled = moduleEnabledKey in toggleMap ? Boolean(toggleMap[moduleEnabledKey]) : true;
    if (!moduleEnabled)
        return false;
    // Option check (defaults true if never set explicitly)
    const actionEnabled = actionKey in toggleMap ? Boolean(toggleMap[actionKey]) : true;
    if (!actionEnabled)
        return false;
    // If the option is explicitly toggled on, we're done
    if (Object.prototype.hasOwnProperty.call(toggleMap, actionKey))
        return true;
    // Fall back to RolePolicy DEPARTMENTS_ADMIN macro permission
    const allPolicies = await listAll((args) => dataClient.models.RolePolicy.list(args));
    for (const policy of allPolicies ?? []) {
        const rid = String(policy?.roleId ?? "").trim();
        if (!roleIdSet.has(rid))
            continue;
        const key = normalizeKey(policy?.policyKey ?? "");
        if (key !== "DEPARTMENTS_ADMIN")
            continue;
        if (Boolean(policy?.[policyVerb]))
            return true;
    }
    return false;
}
