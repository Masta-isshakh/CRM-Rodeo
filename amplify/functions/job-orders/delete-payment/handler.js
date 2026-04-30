import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { requirePermissionFromEvent } from "../_shared/rbac";
import { recomputeJobOrderPaymentSummary } from "../_shared/payments";
export const handler = async (event) => {
    const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env);
    Amplify.configure(resourceConfig, libraryOptions);
    const client = generateClient();
    await requirePermissionFromEvent(client, event, "JOB_CARDS", "DELETE");
    const id = String(event.arguments?.id ?? "").trim();
    if (!id)
        throw new Error("id is required");
    const existing = await client.models.JobOrderPayment.get({ id });
    const row = existing?.data ?? existing;
    if (!row?.id)
        throw new Error("Payment not found");
    const jobOrderId = String(row.jobOrderId ?? "").trim();
    if (!jobOrderId)
        throw new Error("Payment is missing jobOrderId");
    await client.models.JobOrderPayment.delete({ id });
    await recomputeJobOrderPaymentSummary(client, jobOrderId);
    return { ok: true, deletedId: id, jobOrderId };
};
