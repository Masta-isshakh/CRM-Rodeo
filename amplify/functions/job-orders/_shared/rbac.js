const EMPTY = { canRead: false, canCreate: false, canUpdate: false, canDelete: false, canApprove: false };
const FULL = { canRead: true, canCreate: true, canUpdate: true, canDelete: true, canApprove: true };
const ADMIN_GROUP = "Admins";
const DEPT_PREFIX = "DEPT_";
function normalizeKey(x) {
    return String(x ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}
function pickGroupsFromClaims(claims) {
    const g = claims?.["cognito:groups"] ?? claims?.groups;
    if (Array.isArray(g))
        return g.map(String).filter(Boolean);
    if (typeof g === "string" && g.trim())
        return [g.trim()];
    return [];
}
export function extractGroups(event) {
    const claims = event?.identity?.claims ?? event?.identity ?? {};
    return pickGroupsFromClaims(claims);
}
export function isAdmin(groups) {
    return groups.includes(ADMIN_GROUP);
}
export function extractDepartmentKey(groups) {
    return groups.find((g) => g.startsWith(DEPT_PREFIX)) ?? "";
}
function actorEmailFromEvent(event) {
    const claims = event?.identity?.claims ?? {};
    const email = String(claims?.email ?? "").trim().toLowerCase();
    if (email)
        return email;
    // fallback to username/loginId if your pool uses it as email
    return String(event?.identity?.username ?? "").trim().toLowerCase();
}
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
async function resolveDeptKeyFromProfile(client, event) {
    const email = actorEmailFromEvent(event);
    if (!email)
        return "";
    try {
        const res = await client.models.UserProfile.list({
            filter: { email: { eq: email } },
            limit: 1,
        });
        const row = (res?.data ?? [])[0];
        return String(row?.departmentKey ?? "").trim();
    }
    catch {
        return "";
    }
}
async function resolveEffectiveDeptKey(client, groups, event) {
    const deptFromGroups = extractDepartmentKey(groups);
    if (deptFromGroups)
        return deptFromGroups;
    const deptFromProfile = await resolveDeptKeyFromProfile(client, event);
    if (deptFromProfile)
        return deptFromProfile;
    return "";
}
export async function resolvePolicyPermission(client, event, groups, policyKey) {
    if (isAdmin(groups))
        return FULL;
    let dept = await resolveEffectiveDeptKey(client, groups, event);
    if (!dept)
        return EMPTY;
    // Dept -> Roles (support legacy non-prefixed dept)
    const fetchLinks = async (dk) => await listAll((args) => client.models.DepartmentRoleLink.list({
        ...args,
        filter: { departmentKey: { eq: dk } },
    }));
    let links = await fetchLinks(dept);
    if ((!links || !links.length) && dept && !dept.startsWith(DEPT_PREFIX)) {
        const alt = `${DEPT_PREFIX}${dept}`;
        const altLinks = await fetchLinks(alt);
        if (altLinks?.length) {
            dept = alt;
            links = altLinks;
        }
    }
    const roleIds = Array.from(new Set((links ?? []).map((l) => String(l?.roleId ?? "")).filter(Boolean)));
    if (!roleIds.length)
        return EMPTY;
    // Roles -> Policies
    const allPolicies = await listAll((args) => client.models.RolePolicy.list(args));
    const roleIdSet = new Set(roleIds);
    const wantKey = normalizeKey(policyKey);
    const agg = { ...EMPTY };
    for (const rp of allPolicies ?? []) {
        const rid = String(rp?.roleId ?? "");
        if (!roleIdSet.has(rid))
            continue;
        const key = normalizeKey(rp?.policyKey);
        if (key !== wantKey)
            continue;
        agg.canRead = agg.canRead || Boolean(rp?.canRead);
        agg.canCreate = agg.canCreate || Boolean(rp?.canCreate);
        agg.canUpdate = agg.canUpdate || Boolean(rp?.canUpdate);
        agg.canDelete = agg.canDelete || Boolean(rp?.canDelete);
        agg.canApprove = agg.canApprove || Boolean(rp?.canApprove);
    }
    return agg;
}
export function assertAllowed(op, perm) {
    const ok = op === "read"
        ? perm.canRead
        : op === "create"
            ? perm.canCreate
            : op === "update"
                ? perm.canUpdate
                : op === "delete"
                    ? perm.canDelete
                    : perm.canApprove;
    if (!ok) {
        const msg = `Not authorized (${op}).`;
        const err = new Error(msg);
        err.code = "FORBIDDEN";
        throw err;
    }
}
function normalizeOp(op) {
    const s = String(op).trim().toLowerCase();
    if (s === "read")
        return "read";
    if (s === "create")
        return "create";
    if (s === "update")
        return "update";
    if (s === "delete")
        return "delete";
    if (s === "approve")
        return "approve";
    return "read";
}
/**
 * Example:
 *   await requirePermissionFromEvent(client, event, "JOB_CARDS", "UPDATE")
 */
export async function requirePermissionFromEvent(client, event, policyKey, op) {
    const groups = extractGroups(event);
    const perm = await resolvePolicyPermission(client, event, groups, policyKey);
    assertAllowed(normalizeOp(op), perm);
    return perm;
}
