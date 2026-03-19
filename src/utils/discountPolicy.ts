export type DiscountAllowanceInput = {
  policyMaxPercent: number;
  baseAmount: number;
  existingDiscountAmount?: number;
  floorDiscountAmount?: number;
};

export type DiscountAllowance = {
  normalizedMaxPercent: number;
  normalizedBaseAmount: number;
  baselineDiscountAmount: number;
  policyCapAmount: number;
  maxAllowedTotalDiscountAmount: number;
  maxAdditionalDiscountAmount: number;
  remainingPercentOfBase: number;
};

export function toCurrencyNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "");
  const parsed = Number(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizePercent(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, raw));
}

export const CENTRAL_DISCOUNT_MODULE_ID = "joborder";
export const CENTRAL_DISCOUNT_OPTION_ID = "joborder_discount_percent";
export const CENTRAL_DISCOUNT_DEFAULT_PERCENT = 20;

export function resolveCentralDiscountPercent(
  canOption: (...args: any[]) => boolean,
  getOptionNumber: (...args: any[]) => number,
  fallback = CENTRAL_DISCOUNT_DEFAULT_PERCENT
): number {
  if (!canOption(CENTRAL_DISCOUNT_MODULE_ID, CENTRAL_DISCOUNT_OPTION_ID, true)) return 0;
  const configured = Number(
    getOptionNumber(CENTRAL_DISCOUNT_MODULE_ID, CENTRAL_DISCOUNT_OPTION_ID, fallback)
  );
  if (!Number.isFinite(configured)) return fallback;
  return normalizePercent(configured);
}

export function computeCumulativeDiscountAllowance(input: DiscountAllowanceInput): DiscountAllowance {
  const normalizedMaxPercent = normalizePercent(input.policyMaxPercent);
  const normalizedBaseAmount = Math.max(0, toCurrencyNumber(input.baseAmount));
  const existingDiscountAmount = Math.max(0, toCurrencyNumber(input.existingDiscountAmount ?? 0));
  const floorDiscountAmount = Math.max(0, toCurrencyNumber(input.floorDiscountAmount ?? 0));
  const baselineDiscountAmount = Math.max(existingDiscountAmount, floorDiscountAmount);

  const policyCapAmount = (normalizedBaseAmount * normalizedMaxPercent) / 100;
  const maxAllowedTotalDiscountAmount = Math.max(policyCapAmount, baselineDiscountAmount);
  const maxAdditionalDiscountAmount = Math.max(0, maxAllowedTotalDiscountAmount - baselineDiscountAmount);
  const remainingPercentOfBase =
    normalizedBaseAmount > 0 ? (maxAdditionalDiscountAmount / normalizedBaseAmount) * 100 : 0;

  return {
    normalizedMaxPercent,
    normalizedBaseAmount,
    baselineDiscountAmount,
    policyCapAmount,
    maxAllowedTotalDiscountAmount,
    maxAdditionalDiscountAmount,
    remainingPercentOfBase,
  };
}

export function clampTotalDiscountAmount(requestedTotalDiscountAmount: number, allowance: DiscountAllowance): number {
  const requested = Math.max(0, toCurrencyNumber(requestedTotalDiscountAmount));
  return Math.min(
    Math.max(requested, allowance.baselineDiscountAmount),
    allowance.normalizedBaseAmount,
    allowance.maxAllowedTotalDiscountAmount
  );
}
