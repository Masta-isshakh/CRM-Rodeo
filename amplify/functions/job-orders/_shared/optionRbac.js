function normalizeKey(x) {
    return String(x ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}
function optKey(moduleId, optionId) {
    return `${normalizeKey(moduleId)}::${normalizeKey(optionId)}`;
}
function pickGroupsFromEvent(event) {
    const claims = event?.identity?.claims ?? {};
    const g = claims["cognito:groups"];
    if (Array.isArray(g))
        return g.map(String).filter(Boolean);
    if (typeof g === "string" && g.trim())
        return [g.trim()];
    return [];
}
function actorEmailFromEvent(event) {
    const claims = event?.identity?.claims ?? {};
    const email = String(claims?.email ?? "").trim().toLowerCase();
    if (email)
        return email;
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
async function deptFromProfile(client, email) {
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
export async function getOptionCtx(client, event) {
    const groups = pickGroupsFromEvent(event);
    const isAdmin = groups.includes("Admins");
    let deptKey = groups.find((x) => String(x).startsWith("DEPT_")) ?? "";
    if (!deptKey) {
        const email = actorEmailFromEvent(event);
        deptKey = await deptFromProfile(client, email);
    }
    // Dept -> Roles
    let roleIds = [];
    if (deptKey) {
        const links = await listAll((args) => client.models.DepartmentRoleLink.list({
            ...args,
            filter: { departmentKey: { eq: deptKey } },
        }), 1000, 20000);
        roleIds = Array.from(new Set((links ?? []).map((l) => String(l?.roleId ?? "")).filter(Boolean)));
    }
    const toggleMap = {};
    const numberMap = {};
    if (roleIds.length) {
        for (const rid of roleIds) {
            // toggles
            const toggles = await listAll((args) => client.models.RoleOptionToggle.list({
                ...args,
                filter: { roleId: { eq: String(rid) } },
            }), 1000, 20000);
            for (const t of toggles ?? []) {
                const k = normalizeKey(t.key);
                if (!k)
                    continue;
                toggleMap[k] = Boolean(toggleMap[k] || Boolean(t.enabled));
            }
            // numbers
            const nums = await listAll((args) => client.models.RoleOptionNumber.list({
                ...args,
                filter: { roleId: { eq: String(rid) } },
            }), 1000, 20000);
            for (const n of nums ?? []) {
                const k = normalizeKey(n.key);
                const v = Number(n.value);
                if (!k || !Number.isFinite(v))
                    continue;
                numberMap[k] = Number.isFinite(numberMap[k]) ? Math.max(numberMap[k], v) : v;
            }
        }
    }
    return {
        isAdmin,
        deptKey,
        roleIds,
        toggleEnabled: (moduleId, optionId, fallback = true) => {
            if (isAdmin)
                return true;
            const k = optKey(moduleId, optionId);
            return k in toggleMap ? Boolean(toggleMap[k]) : fallback; // default allow
        },
        maxNumber: (moduleId, optionId, fallback) => {
            if (isAdmin)
                return fallback;
            const k = optKey(moduleId, optionId);
            const v = numberMap[k];
            return Number.isFinite(v) ? v : fallback;
        },
    };
}
