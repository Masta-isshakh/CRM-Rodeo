export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";

export function toNum(x: unknown) {
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;

  const raw = String(x ?? "").trim();
  if (!raw) return 0;

  // Accept formatted currency/text values like "QAR 54,554.00".
  const normalized = raw.replace(/,/g, "").replace(/[^0-9.-]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function computePaymentStatus(totalAmount: number, amountPaid: number): { paymentStatus: PaymentStatus; balanceDue: number } {
  const paid = Math.max(0, toNum(amountPaid));
  const total = Math.max(0, toNum(totalAmount));
  const balanceDue = Math.max(0, total - paid);
  const paymentStatus: PaymentStatus = balanceDue <= 0.00001 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID";
  return { paymentStatus, balanceDue };
}

export function computeOrderAmounts(args: {
  services: Array<{ qty: unknown; unitPrice: unknown }>;
  discount: unknown;
  vatRate: unknown; // 0..1
}) {
  const subtotal = (args.services ?? []).reduce((sum, s) => sum + Math.max(0, toNum(s.qty)) * Math.max(0, toNum(s.unitPrice)), 0);
  const discount = Math.max(0, toNum(args.discount));
  const vatRate = Math.max(0, toNum(args.vatRate));
  const taxable = Math.max(0, subtotal - discount);
  const vatAmount = taxable * vatRate;
  const totalAmount = taxable + vatAmount;
  return { subtotal, discount, vatRate, vatAmount, totalAmount };
}
