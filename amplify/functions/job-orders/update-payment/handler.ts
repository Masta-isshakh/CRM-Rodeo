import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import type { AppSyncResolverHandler } from "aws-lambda";

import type { Schema } from "../../../data/resource";

import { requirePermissionFromEvent } from "../_shared/rbac";
import { toNum } from "../_shared/finance";
import { recomputeJobOrderPaymentSummary } from "../_shared/payments";

type Args = {
  id: string;
  amount?: number;
  method?: string;
  reference?: string;
  paidAt?: string;
  notes?: string;
};

type Out = { id: string; jobOrderId: string };

function nowIso() {
  return new Date().toISOString();
}

export const handler: AppSyncResolverHandler<Args, Out> = async (event) => {
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);

  const client = generateClient<Schema>();

  await requirePermissionFromEvent(client, event, "JOB_CARDS", "UPDATE");

  const id = String(event.arguments?.id ?? "").trim();
  if (!id) throw new Error("id is required");

  const existing = await client.models.JobOrderPayment.get({ id });
  const row = (existing as any)?.data ?? existing;
  if (!row?.id) throw new Error("Payment not found");

  const jobOrderId = String(row.jobOrderId ?? "").trim();
  if (!jobOrderId) throw new Error("Payment is missing jobOrderId");

  const next: any = { id, updatedAt: nowIso() };

  if (event.arguments?.amount != null) {
    const a = Math.max(0, toNum(event.arguments.amount));
    if (!a) throw new Error("amount must be > 0");
    next.amount = a;
  }

  if (event.arguments?.method != null) next.method = String(event.arguments.method ?? "").trim() || "Cash";
  if (event.arguments?.reference != null) next.reference = String(event.arguments.reference ?? "").trim() || undefined;
  if (event.arguments?.paidAt != null) next.paidAt = String(event.arguments.paidAt ?? "").trim() || row.paidAt;
  if (event.arguments?.notes != null) next.notes = String(event.arguments.notes ?? "").trim() || undefined;

  await client.models.JobOrderPayment.update(next);

  await recomputeJobOrderPaymentSummary(client, jobOrderId);

  return { id, jobOrderId };
};
