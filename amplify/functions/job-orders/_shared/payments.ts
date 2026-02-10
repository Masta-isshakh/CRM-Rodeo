import type { Schema } from "../../../data/resource";
import { computePaymentStatus, toNum } from "./finance";

export async function recomputeJobOrderPaymentSummary(client: any, jobOrderId: string) {
  if (!jobOrderId) return;

  // Prefer secondary-index query if available
  let payments: Array<Schema["JobOrderPayment"]["type"]> = [];
  try {
    const res = await (client.models.JobOrderPayment as any).listPaymentsByJobOrder({ jobOrderId, limit: 2000 });
    payments = (res?.data ?? []) as any;
  } catch {
    const res = await client.models.JobOrderPayment.list({
      limit: 2000,
      filter: { jobOrderId: { eq: jobOrderId } },
    } as any);
    payments = (res?.data ?? []) as any;
  }

  const amountPaid = payments.reduce((sum, p: any) => sum + Math.max(0, toNum(p.amount)), 0);

  const o = await client.models.JobOrder.get({ id: jobOrderId });
  const row = o?.data as any;
  if (!row) return;

  const totalAmount = Math.max(0, toNum(row.totalAmount));
  const { paymentStatus, balanceDue } = computePaymentStatus(totalAmount, amountPaid);

  await client.models.JobOrder.update({
    id: jobOrderId,
    amountPaid,
    balanceDue,
    paymentStatus,
    updatedAt: new Date().toISOString(),
  });
}
