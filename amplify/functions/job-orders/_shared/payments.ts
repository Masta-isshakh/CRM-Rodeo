// amplify/functions/job-orders/_shared/payments.ts
import type { Schema } from "../../../data/resource";
import { toNum } from "./finance";

function nowIso() {
  return new Date().toISOString();
}

async function listAll<T>(
  listFn: (args: any) => Promise<any>,
  max = 5000
): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | null | undefined = undefined;

  while (out.length < max) {
    const res = await listFn({ limit: 1000, nextToken });
    out.push(...((res?.data ?? []) as T[]));
    nextToken = res?.nextToken;
    if (!nextToken) break;
  }
  return out.slice(0, max);
}

/**
 * ✅ Recompute payment summary on JobOrder from JobOrderPayment rows.
 * This MUST update:
 *  - amountPaid
 *  - balanceDue
 *  - paymentStatus (UNPAID|PARTIAL|PAID)
 *  - paymentStatusLabel ("Unpaid"|"Partially Paid"|"Fully Paid")
 *  - (optional) paymentMethod from latest payment
 */
export async function recomputeJobOrderPaymentSummary(
  client: ReturnType<any>,
  jobOrderIdRaw: string
) {
  const jobOrderId = String(jobOrderIdRaw ?? "").trim();
  if (!jobOrderId) return;

  // 1) Load JobOrder
  const g = await client.models.JobOrder.get({ id: jobOrderId } as any);
  const job = (g as any)?.data ?? g;
  if (!job?.id) return;

  // 2) Load all payments for this JobOrder (prefer index queryField)
  let payments: any[] = [];
  try {
    const byIdx = await (client.models.JobOrderPayment as any).listPaymentsByJobOrder?.({
      jobOrderId,
      limit: 1000,
    });

    if (byIdx?.nextToken) {
      payments = await listAll<any>(
        (args) =>
          (client.models.JobOrderPayment as any).listPaymentsByJobOrder({
            jobOrderId,
            ...args,
          }),
        5000
      );
    } else {
      payments = byIdx?.data ?? [];
    }
  } catch {
    // fallback scan
    const res = await client.models.JobOrderPayment.list({
      filter: { jobOrderId: { eq: jobOrderId } } as any,
      limit: 2000,
    });
    payments = res?.data ?? [];
  }

  // 3) Sum amountPaid
  const sumPaid = (payments ?? []).reduce((acc: number, p: any) => {
    const a = Math.max(0, toNum(p?.amount));
    return acc + a;
  }, 0);

  // 4) Determine net amount
  const totalAmount = toNum(job.totalAmount);
  const discount = toNum(job.discount);
  const netAmountField = toNum(job.netAmount);

  const net =
    netAmountField > 0
      ? netAmountField
      : Math.max(0, totalAmount - discount);

  // 5) Balance
  const balanceDue = Math.max(0, net - sumPaid);

  // 6) Payment status enum + label
  let paymentStatus: Schema["JobOrder"]["type"]["paymentStatus"] = "UNPAID";
  if (sumPaid <= 0.00001) {
    paymentStatus = "UNPAID";
  } else if (balanceDue <= 0.00001) {
    paymentStatus = "PAID";
  } else {
    paymentStatus = "PARTIAL";
  }

  const paymentStatusLabel =
    paymentStatus === "PAID"
      ? "Fully Paid"
      : paymentStatus === "PARTIAL"
        ? "Partially Paid"
        : "Unpaid";

  // 7) Latest payment method (optional)
  const latest = [...(payments ?? [])].sort((a: any, b: any) =>
    String(b?.paidAt ?? b?.createdAt ?? "").localeCompare(
      String(a?.paidAt ?? a?.createdAt ?? "")
    )
  )[0];

  const latestMethod = String(latest?.method ?? "").trim();
  const paymentMethod =
    latestMethod || String(job.paymentMethod ?? "").trim() || undefined;

  // 8) Update JobOrder (this is the missing part)
  await client.models.JobOrder.update({
    id: jobOrderId,
    amountPaid: sumPaid,
    balanceDue,
    paymentStatus,
    paymentStatusLabel,
    paymentMethod,
    updatedAt: nowIso(),
  } as any);
}