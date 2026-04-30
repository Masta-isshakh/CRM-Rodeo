import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { requirePermissionFromEvent } from "../_shared/rbac";
import { getOptionCtx } from "../_shared/optionRbac";
function normalizeActorIdentity(value) {
    return String(value ?? "").trim().toLowerCase();
}
function usernameFromEmail(email) {
    const normalized = normalizeActorIdentity(email);
    const at = normalized.indexOf("@");
    return at > 0 ? normalized.slice(0, at) : normalized;
}
function isPlaceholderActor(value) {
    const v = normalizeActorIdentity(value);
    return (!v ||
        v === "-" ||
        v === "--" ||
        v === "—" ||
        v === "null" ||
        v === "undefined" ||
        v === "system" ||
        v === "system user" ||
        v === "unknown" ||
        v === "not assigned" ||
        v === "n/a" ||
        v === "na");
}
function looksLikeOpaqueActorId(value) {
    const v = normalizeActorIdentity(value);
    if (!v)
        return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))
        return true;
    if (/^[a-f0-9-]{24,}$/i.test(v) && !v.includes("@"))
        return true;
    return false;
}
function toUsernameCandidate(raw, subToUsernameMap) {
    const s = String(raw ?? "").trim();
    if (!s || isPlaceholderActor(s))
        return "";
    if (s.includes("::")) {
        const parts = s.split("::");
        const rhs = String(parts[1] ?? "").trim();
        if (rhs.includes("@"))
            return usernameFromEmail(rhs);
    }
    if (s.includes("@"))
        return usernameFromEmail(s);
    if (looksLikeOpaqueActorId(s)) {
        const mapped = subToUsernameMap[normalizeActorIdentity(s)] ?? "";
        return normalizeActorIdentity(mapped);
    }
    return normalizeActorIdentity(s);
}
async function listAll(listFn, max = 50000) {
    const out = [];
    let nextToken = undefined;
    while (out.length < max) {
        const res = await listFn({ limit: 1000, nextToken });
        out.push(...(res?.data ?? []));
        nextToken = res?.nextToken;
        if (!nextToken)
            break;
    }
    return out.slice(0, max);
}
function firstNonEmpty(...values) {
    for (const value of values) {
        const s = String(value ?? "").trim();
        if (s)
            return s;
    }
    return "";
}
export const handler = async (event) => {
    const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env);
    Amplify.configure(resourceConfig, libraryOptions);
    const client = generateClient();
    await requirePermissionFromEvent(client, event, "JOB_CARDS", "UPDATE");
    const opt = await getOptionCtx(client, event);
    if (!opt.toggleEnabled("payment", "payment_pay", true)) {
        throw new Error("You are not allowed to run payment backfill.");
    }
    const dryRun = Boolean(event.arguments?.dryRun ?? true);
    const limitArg = Number(event.arguments?.limit ?? 5000);
    const limit = Number.isFinite(limitArg) ? Math.max(1, Math.min(50000, Math.floor(limitArg))) : 5000;
    const [profiles, payments, orders] = await Promise.all([
        listAll((args) => client.models.UserProfile.list(args), 50000),
        listAll((args) => client.models.JobOrderPayment.list(args), limit),
        listAll((args) => client.models.JobOrder.list(args), 50000),
    ]);
    const subToUsernameMap = {};
    for (const profile of profiles ?? []) {
        const profileOwner = String(profile?.profileOwner ?? "").trim();
        const email = String(profile?.email ?? "").trim();
        const username = email ? usernameFromEmail(email) : normalizeActorIdentity(profile?.fullName ?? "");
        if (!username)
            continue;
        if (profileOwner.includes("::")) {
            const [lhs] = profileOwner.split("::");
            const sub = normalizeActorIdentity(lhs);
            if (sub)
                subToUsernameMap[sub] = username;
        }
    }
    const orderActorMap = {};
    for (const order of orders ?? []) {
        const orderId = String(order?.id ?? "").trim();
        if (!orderId)
            continue;
        const candidate = firstNonEmpty(toUsernameCandidate(order?.createdBy, subToUsernameMap), toUsernameCandidate(order?.updatedBy, subToUsernameMap));
        if (candidate)
            orderActorMap[orderId] = candidate;
    }
    let scanned = 0;
    let updated = 0;
    let alreadyGood = 0;
    let unresolved = 0;
    const unresolvedPaymentIds = [];
    for (const payment of payments ?? []) {
        if (scanned >= limit)
            break;
        scanned += 1;
        const paymentId = String(payment?.id ?? "").trim();
        const current = String(payment?.createdBy ?? "").trim();
        if (current && !isPlaceholderActor(current) && !looksLikeOpaqueActorId(current)) {
            alreadyGood += 1;
            continue;
        }
        const resolved = firstNonEmpty(toUsernameCandidate(current, subToUsernameMap), toUsernameCandidate(payment?.approvedBy, subToUsernameMap), orderActorMap[String(payment?.jobOrderId ?? "").trim()]);
        if (!resolved) {
            unresolved += 1;
            if (unresolvedPaymentIds.length < 30 && paymentId)
                unresolvedPaymentIds.push(paymentId);
            continue;
        }
        if (!dryRun) {
            await client.models.JobOrderPayment.update({
                id: paymentId,
                createdBy: resolved,
                updatedAt: new Date().toISOString(),
            });
        }
        updated += 1;
    }
    return {
        dryRun,
        scanned,
        updated,
        alreadyGood,
        unresolved,
        unresolvedPaymentIds,
    };
};
