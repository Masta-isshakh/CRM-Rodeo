// amplify/functions/job-orders/create-payment/handler.ts
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { requirePermissionFromEvent } from "../_shared/rbac";
import { toNum } from "../_shared/finance";
import { recomputeJobOrderPaymentSummary } from "../_shared/payments";
import { getOptionCtx } from "../_shared/optionRbac";
function nowIso() {
    return new Date().toISOString();
}
function actorFromEvent(event) {
    const id = event?.identity;
    return (String(id?.username ?? "").trim() ||
        String(id?.claims?.email ?? "").trim() ||
        String(id?.claims?.preferred_username ?? "").trim() ||
        String(id?.sub ?? "").trim() ||
        String(id?.claims?.sub ?? "").trim() ||
        "unknown");
}
export const handler = async (event) => {
    const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env);
    Amplify.configure(resourceConfig, libraryOptions);
    const client = generateClient();
    // ✅ policy-level
    await requirePermissionFromEvent(client, event, "JOB_CARDS", "UPDATE");
    // ✅ option-level
    const opt = await getOptionCtx(client, event);
    if (!opt.toggleEnabled("payment", "payment_pay", true)) {
        throw new Error("You are not allowed to record payments.");
    }
    const jobOrderId = String(event.arguments?.jobOrderId ?? "").trim();
    if (!jobOrderId)
        throw new Error("jobOrderId is required");
    const amount = Math.max(0, toNum(event.arguments?.amount));
    if (!amount)
        throw new Error("amount must be > 0");
    const method = String(event.arguments?.method ?? "Cash").trim() || "Cash";
    const reference = String(event.arguments?.reference ?? "").trim() || undefined;
    const paidAt = String(event.arguments?.paidAt ?? "").trim() || nowIso();
    const notes = String(event.arguments?.notes ?? "").trim() || undefined;
    const actor = String(event.arguments?.createdBy ?? "").trim() || actorFromEvent(event);
    const ts = nowIso();
    const created = await client.models.JobOrderPayment.create({
        jobOrderId,
        amount,
        method,
        reference,
        paidAt,
        notes,
        createdBy: actor,
        createdAt: ts,
        updatedAt: ts,
    });
    const id = String(created?.data?.id ?? created?.id ?? "").trim();
    await recomputeJobOrderPaymentSummary(client, jobOrderId);
    return { id, jobOrderId };
};
