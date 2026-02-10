// amplify/functions/job-orders/_shared/payments.ts
import type { Schema } from "../../../data/resource";

function toNum(x: any) {
  const n = typeof x === "number" ? x : Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function computePaymentStatus(totalAmount: number, amountPaid: number) {
  const balanceDue = Math.max(0, totalAmount - amountPaid);
  const paymentStatus =
    balanceDue <= 0.00001 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "UNPAID";
  return { balanceDue, paymentStatus };
}

async function listAll<T>(listFn: (args: any) => Promise<any>, pageSize = 1000, max = 20000): Promise<T[]> {
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

export async function recomputeJobOrderPaymentSummary(client: any, jobOrderId: string) {
  if (!jobOrderId) return;

  // load job order
  const jobRes = await client.models.JobOrder.get({ id: jobOrderId });
  const job = (jobRes as any)?.data ?? jobRes;
  if (!job?.id) throw new Error("Job order not found");

  // sum payments
  let payments: any[] = [];
  try {
    const res = await (client.models.JobOrderPayment as any).listPaymentsByJobOrder?.({
      jobOrderId,
      limit: 2000,
    });
    payments = res?.data ?? [];
  } catch {
    payments = await listAll<any>((args) =>
      client.models.JobOrderPayment.list({
        ...args,
        filter: { jobOrderId: { eq: jobOrderId } },
      } as any)
    );
  }

  const amountPaid = Math.max(
    0,
    (payments ?? []).reduce((sum, p) => sum + Math.max(0, toNum(p?.amount)), 0)
  );

  const totalAmount = Math.max(0, toNum(job?.totalAmount));
  const { balanceDue, paymentStatus } = computePaymentStatus(totalAmount, amountPaid);

  const ts = new Date().toISOString();

  // ✅ Update job order so UI + reports always match
  await client.models.JobOrder.update({
    id: jobOrderId,
    amountPaid,
    balanceDue,
    paymentStatus,
    updatedAt: ts,
  });
}
