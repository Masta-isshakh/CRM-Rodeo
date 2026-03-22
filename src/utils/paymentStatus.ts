export function toMoney(value: any): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "");
  const parsed = Number(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export type BillingFirstField = "totalAmount" | "discount" | "amountPaid" | "netAmount" | "balanceDue";

export function pickBillingFirstValue(field: BillingFirstField, ...sources: any[]): any {
  for (const source of sources) {
    if (!source) continue;
    if (source?.billing?.[field] != null) return source.billing[field];
    if (source?.[field] != null) return source[field];
  }
  return undefined;
}

export function pickPaymentLabel(...sources: any[]): any {
  for (const source of sources) {
    if (!source) continue;
    if (source?.paymentStatusLabel != null && String(source.paymentStatusLabel).trim()) return source.paymentStatusLabel;
    if (source?.paymentStatus != null && String(source.paymentStatus).trim()) return source.paymentStatus;
    if (source?.billing?.paymentStatusLabel != null && String(source.billing.paymentStatusLabel).trim()) return source.billing.paymentStatusLabel;
    if (source?.billing?.paymentStatus != null && String(source.billing.paymentStatus).trim()) return source.billing.paymentStatus;
  }
  return undefined;
}

export function pickPaymentEnum(...sources: any[]): any {
  for (const source of sources) {
    if (!source) continue;
    if (source?.paymentEnum != null && String(source.paymentEnum).trim()) return source.paymentEnum;
    if (source?.paymentStatus != null && String(source.paymentStatus).trim()) return source.paymentStatus;
  }
  return undefined;
}

export function normalizePaymentStatusLabel(enumOrLabel?: any, labelMaybe?: any): string {
  const hasEnumAndLabel = arguments.length >= 2;
  const enumVal = hasEnumAndLabel ? enumOrLabel : undefined;
  const label = hasEnumAndLabel ? labelMaybe : enumOrLabel;

  const ps = String(enumVal ?? "").trim().toUpperCase();
  if (ps === "PAID") return "Fully Paid";
  if (ps === "PARTIAL") return "Partially Paid";
  if (ps === "UNPAID") return "Unpaid";

  const raw = String(label ?? "").trim();
  if (!raw) return "Unpaid";

  const lower = raw.toLowerCase();
  if (lower.includes("fully paid") || lower === "paid") return "Fully Paid";
  if (lower.includes("partially") || lower === "partial") return "Partially Paid";
  if (lower.includes("unpaid")) return "Unpaid";

  return raw;
}

export function computePaymentSnapshot(totalAmountRaw: any, discountRaw: any, amountPaidRaw: any, netAmountRaw?: any, balanceDueRaw?: any) {
  const totalAmount = Math.max(0, toMoney(totalAmountRaw));
  const discount = Math.max(0, toMoney(discountRaw));
  const paid = Math.max(0, toMoney(amountPaidRaw));

  const netFromField = toMoney(netAmountRaw);
  const netAmount = netFromField > 0 ? netFromField : Math.max(0, totalAmount - Math.min(discount, totalAmount));

  const balanceFromField = toMoney(balanceDueRaw);
  // Business rule: balance due is based on Net - Paid.
  const balanceDue = balanceFromField > 0 ? balanceFromField : Math.max(0, netAmount - paid);

  const eps = 0.00001;
  const paymentStatusEnum = balanceDue <= eps ? "PAID" : paid > eps ? "PARTIAL" : "UNPAID";
  const paymentStatusLabel = paymentStatusEnum === "PAID" ? "Fully Paid" : paymentStatusEnum === "PARTIAL" ? "Partially Paid" : "Unpaid";

  return {
    totalAmount,
    discount,
    netAmount,
    amountPaid: paid,
    balanceDue,
    paymentStatusEnum,
    paymentStatusLabel,
  };
}

export function derivePaymentStatusFromFinancials(input: {
  paymentEnum?: any;
  paymentLabel?: any;
  totalAmount?: any;
  discount?: any;
  amountPaid?: any;
  netAmount?: any;
  balanceDue?: any;
}): string {
  const rawLabel = String(input.paymentLabel ?? "").trim();
  if (rawLabel && /refund/i.test(rawLabel)) return rawLabel;

  const hasPrimaryAmounts =
    input.totalAmount != null ||
    input.discount != null ||
    input.amountPaid != null;

  if (hasPrimaryAmounts) {
    const snap = computePaymentSnapshot(
      input.totalAmount,
      input.discount,
      input.amountPaid
    );
    return snap.paymentStatusLabel;
  }

  const hasAnyAmount =
    input.totalAmount != null ||
    input.discount != null ||
    input.amountPaid != null ||
    input.netAmount != null ||
    input.balanceDue != null;

  if (hasAnyAmount) {
    const snap = computePaymentSnapshot(
      input.totalAmount,
      input.discount,
      input.amountPaid,
      input.netAmount,
      input.balanceDue
    );
    return snap.paymentStatusLabel;
  }

  return normalizePaymentStatusLabel(input.paymentEnum, input.paymentLabel);
}
