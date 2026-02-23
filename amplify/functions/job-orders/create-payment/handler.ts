// amplify/functions/job-orders/create-payment/handler.ts
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import type { AppSyncResolverHandler } from "aws-lambda";

import type { Schema } from "../../../data/resource";

import { requirePermissionFromEvent } from "../_shared/rbac";
import { toNum } from "../_shared/finance";
import { recomputeJobOrderPaymentSummary } from "../_shared/payments";
import { getOptionCtx } from "../_shared/optionRbac";

type Args = {
  jobOrderId: string;
  amount: number;
  method?: string;
  reference?: string;
  paidAt?: string;
  notes?: string;
};

type Out = { id: string; jobOrderId: string };

function nowIso() {
  return new Date().toISOString();
}

function actorFromEvent(event: any) {
  const id = event?.identity;
  return (
    String(id?.username ?? "").trim() ||
    String(id?.sub ?? "").trim() ||
    String(id?.claims?.sub ?? "").trim() ||
    String(id?.claims?.email ?? "").trim() ||
    "unknown"
  );
}

export const handler: AppSyncResolverHandler<Args, Out> = async (event) => {
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);

  const client = generateClient<Schema>();

  // ✅ policy-level
  await requirePermissionFromEvent(client, event, "JOB_CARDS", "UPDATE");

  // ✅ option-level
  const opt = await getOptionCtx(client as any, event);
  if (!opt.toggleEnabled("payment", "payment_pay", true)) {
    throw new Error("You are not allowed to record payments.");
  }

  const jobOrderId = String(event.arguments?.jobOrderId ?? "").trim();
  if (!jobOrderId) throw new Error("jobOrderId is required");

  const amount = Math.max(0, toNum(event.arguments?.amount));
  if (!amount) throw new Error("amount must be > 0");

  const method = String(event.arguments?.method ?? "Cash").trim() || "Cash";
  const reference = String(event.arguments?.reference ?? "").trim() || undefined;
  const paidAt = String(event.arguments?.paidAt ?? "").trim() || nowIso();
  const notes = String(event.arguments?.notes ?? "").trim() || undefined;

  const actor = actorFromEvent(event);
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
  } as any);

  const id = String((created as any)?.data?.id ?? (created as any)?.id ?? "").trim();

  await recomputeJobOrderPaymentSummary(client, jobOrderId);

  return { id, jobOrderId };
};