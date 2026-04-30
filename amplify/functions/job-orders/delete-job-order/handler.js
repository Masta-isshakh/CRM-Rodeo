import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { requirePermissionFromEvent } from "../_shared/rbac";
function asStringArray(x) {
    if (Array.isArray(x))
        return x.map(String);
    if (typeof x === "string" && x.trim())
        return [x.trim()];
    return [];
}
export const handler = async (event) => {
    const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env);
    Amplify.configure(resourceConfig, libraryOptions);
    const client = generateClient();
    const id = String(event.arguments?.id ?? "").trim();
    if (!id)
        throw new Error("id is required");
    await requirePermissionFromEvent(client, event, "JOB_CARDS", "DELETE");
    // delete payments first (prevent orphans)
    const payList = await client.models.JobOrderPayment.list({
        filter: { jobOrderId: { eq: id } },
        limit: 2000,
    });
    const payIds = (payList?.data ?? []).map((p) => String(p?.id ?? "")).filter(Boolean);
    for (const pid of payIds) {
        try {
            await client.models.JobOrderPayment.delete({ id: pid });
        }
        catch (e) {
            // best-effort; continue (the subsequent job order delete might still succeed)
            console.warn("Failed deleting payment", pid, e);
        }
    }
    await client.models.JobOrder.delete({ id });
    return { ok: true, deletedId: id };
};
