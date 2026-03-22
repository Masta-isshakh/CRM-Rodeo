// amplify/functions/job-orders/_shared/payments.ts
import type { Schema } from "../../../data/resource";
import { toNum } from "./finance";

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse<T>(raw: any, fallback: T): T {
  try {
    if (raw == null) return fallback;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return fallback;
      return JSON.parse(s) as T;
    }
    return raw as T;
  } catch {
    return fallback;
  }
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

  // 3) Sum amountPaid — exclude VOID/CANCELLED/FAILED rows
  const sumPaid = (payments ?? []).reduce((acc: number, p: any) => {
    const status = String(p?.paymentStatus ?? "COMPLETED").trim().toUpperCase();
    if (status === "VOID" || status === "CANCELLED" || status === "FAILED") return acc;
    const a = Math.max(0, toNum(p?.amount));
    return acc + a;
  }, 0);

  // 4) Determine net amount
  // IMPORTANT: prefer dataJson.billing.totalAmount as the authoritative stored total
  // (set by the frontend with package-aware logic). Fall back to job.totalAmount only
  // when the parsed billing total is missing — this prevents overwriting a correct
  // package-price total with the raw per-service sum stored in the top-level field.
  const parsed = safeJsonParse<any>(job.dataJson, {});
  const parsedBillingTotal = toNum(parsed?.billing?.totalAmount);
  const totalAmount = parsedBillingTotal > 0 ? parsedBillingTotal : toNum(job.totalAmount);
  const parsedDiscount = toNum(parsed?.billing?.discount);
  const discount = Math.max(toNum(job.discount), parsedDiscount);
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

  const nextDataJson = JSON.stringify({
    ...parsed,
    billing: {
      ...(parsed?.billing ?? {}),
      totalAmount,
      discount,
      netAmount: net,
      amountPaid: sumPaid,
      balanceDue,
      paymentMethod: paymentMethod ?? null,
    },
    paymentStatusLabel,
  });

  // 8) Update JobOrder (this is the missing part)
  await client.models.JobOrder.update({
    id: jobOrderId,
    discount,
    netAmount: net,
    amountPaid: sumPaid,
    balanceDue,
    paymentStatus,
    paymentStatusLabel,
    paymentMethod,
    dataJson: nextDataJson,
    updatedAt: nowIso(),
  } as any);
}