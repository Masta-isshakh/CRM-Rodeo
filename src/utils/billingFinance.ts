import { computePaymentSnapshot } from "./paymentStatus";

export function toCurrencyNumber(value: any): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "");
  const parsed = Number(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeKey(value: any): string {
  return String(value ?? "").trim().toLowerCase();
}

export function getPackageGroupKey(service: any): string {
  const packageCode = normalizeKey(service?.packageCode);
  if (packageCode) return packageCode;

  const packageName = normalizeKey(service?.packageName ?? service?.packageNameAr);
  if (packageName) return `pkg:${packageName}`;

  const packageId = normalizeKey(service?.packageId);
  if (packageId) return `pkgid:${packageId}`;

  const groupId = normalizeKey(service?.groupId);
  if (groupId) return `group:${groupId}`;

  const groupName = normalizeKey(service?.groupName);
  if (groupName) return `group:${groupName}`;

  return "";
}

export function hasPackageSignals(services: any[]): boolean {
  return (services ?? []).some((service: any) => {
    const packageKey = getPackageGroupKey(service);
    const packagePrice = Math.max(0, toCurrencyNumber(service?.packagePrice));
    return !!packageKey || packagePrice > 0;
  });
}

export function summarizeServicesSubtotalPackageAware(services: any[]): number {
  let standaloneSubtotal = 0;
  const packageSummary = new Map<string, { packagePrice: number | null; fallbackServicesTotal: number }>();

  for (const service of services || []) {
    const price = Math.max(0, toCurrencyNumber(service?.price));
    const packageKey = getPackageGroupKey(service);

    if (!packageKey) {
      standaloneSubtotal += price;
      continue;
    }

    const existing = packageSummary.get(packageKey) ?? { packagePrice: null, fallbackServicesTotal: 0 };
    const packagePriceRaw = Math.max(0, toCurrencyNumber(service?.packagePrice));
    const packagePrice = packagePriceRaw > 0 ? packagePriceRaw : null;

    packageSummary.set(packageKey, {
      packagePrice: existing.packagePrice ?? packagePrice,
      fallbackServicesTotal: existing.fallbackServicesTotal + price,
    });
  }

  let packageSubtotal = 0;
  packageSummary.forEach((entry) => {
    packageSubtotal += entry.packagePrice ?? entry.fallbackServicesTotal;
  });

  return Math.max(0, standaloneSubtotal + packageSubtotal);
}

type PackageGroupDebug = {
  key: string;
  mode: "packagePrice" | "fallbackServicesTotal";
  packagePrice: number | null;
  fallbackServicesTotal: number;
  usedTotal: number;
  itemCount: number;
};

function summarizeServicesSubtotalPackageAwareDebug(services: any[]) {
  let standaloneSubtotal = 0;
  const packageSummary = new Map<string, { packagePrice: number | null; fallbackServicesTotal: number; itemCount: number }>();

  for (const service of services || []) {
    const price = Math.max(0, toCurrencyNumber(service?.price));
    const packageKey = getPackageGroupKey(service);

    if (!packageKey) {
      standaloneSubtotal += price;
      continue;
    }

    const existing = packageSummary.get(packageKey) ?? { packagePrice: null, fallbackServicesTotal: 0, itemCount: 0 };
    const packagePriceRaw = Math.max(0, toCurrencyNumber(service?.packagePrice));
    const packagePrice = packagePriceRaw > 0 ? packagePriceRaw : null;

    packageSummary.set(packageKey, {
      packagePrice: existing.packagePrice ?? packagePrice,
      fallbackServicesTotal: existing.fallbackServicesTotal + price,
      itemCount: existing.itemCount + 1,
    });
  }

  let packageSubtotal = 0;
  const packageGroups: PackageGroupDebug[] = [];
  packageSummary.forEach((entry, key) => {
    const usedTotal = entry.packagePrice ?? entry.fallbackServicesTotal;
    packageSubtotal += usedTotal;
    packageGroups.push({
      key,
      mode: entry.packagePrice != null ? "packagePrice" : "fallbackServicesTotal",
      packagePrice: entry.packagePrice,
      fallbackServicesTotal: entry.fallbackServicesTotal,
      usedTotal,
      itemCount: entry.itemCount,
    });
  });

  return {
    total: Math.max(0, standaloneSubtotal + packageSubtotal),
    standaloneSubtotal,
    packageSubtotal,
    packageGroups,
  };
}

export function resolveAuthoritativeTotalAmountFromSources(...sources: any[]): number {
  for (const source of sources) {
    if (!source) continue;
    const billingTotal =
      source?.billing?.totalAmount ??
      source?.totalAmount;
    const total = Math.max(0, toCurrencyNumber(billingTotal));
    if (total > 0) return total;
  }

  for (const source of sources) {
    if (!source) continue;
    const services = Array.isArray(source?.services) ? source.services : [];
    if (!services.length) continue;
    if (!hasPackageSignals(services)) continue;
    return summarizeServicesSubtotalPackageAware(services);
  }

  return 0;
}

export function sumApprovedPayments(paymentRows: any[]): number {
  const approved = (paymentRows ?? []).filter((p: any) => {
    const status = String(p?.paymentStatus ?? "COMPLETED").trim().toUpperCase();
    return status !== "VOID" && status !== "CANCELLED" && status !== "FAILED";
  });

  return approved.reduce((sum: number, p: any) => sum + Math.max(0, toCurrencyNumber(p?.amount)), 0);
}

function pickBillingNumber(field: "discount" | "amountPaid", ...sources: any[]): number {
  for (const source of sources) {
    if (!source) continue;
    if (source?.billing?.[field] != null) return Math.max(0, toCurrencyNumber(source.billing[field]));
    if (source?.[field] != null) return Math.max(0, toCurrencyNumber(source[field]));
  }
  return 0;
}

function pickBillingText(field: "billId" | "paymentMethod", ...sources: any[]): string {
  for (const source of sources) {
    if (!source) continue;
    const fromBilling = source?.billing?.[field];
    if (fromBilling != null && String(fromBilling).trim()) return String(fromBilling).trim();
    const fromRoot = source?.[field];
    if (fromRoot != null && String(fromRoot).trim()) return String(fromRoot).trim();
  }
  return "";
}

function sumPaymentActivityLogAmounts(log: any[]): number {
  return (log ?? []).reduce((sum: number, row: any) => {
    return sum + Math.max(0, toCurrencyNumber(row?.amount));
  }, 0);
}

export function resolveDynamicBillingSnapshot(order: any, options?: { paymentRows?: any[] }) {
  const sources = [order, order?._row, order?._parsed];
  const services = Array.isArray(order?.services) ? order.services : [];
  const hasPackages = hasPackageSignals(services);
  const packageDebug = summarizeServicesSubtotalPackageAwareDebug(services);

  const totalFromStored = (() => {
    for (const source of sources) {
      if (!source) continue;
      const raw = source?.billing?.totalAmount ?? source?.totalAmount;
      const v = Math.max(0, toCurrencyNumber(raw));
      if (v > 0) return v;
    }
    return 0;
  })();
  const totalFromPackage = hasPackages ? packageDebug.total : 0;
  const totalAmount = resolveAuthoritativeTotalAmountFromSources(...sources);
  const discount = pickBillingNumber("discount", ...sources);

  const paidFromRows = sumApprovedPayments(options?.paymentRows ?? order?._paymentRows ?? []);
  const paidFromActivityLog = paidFromRows > 0 ? 0 : sumPaymentActivityLogAmounts(order?.paymentActivityLog ?? []);
  const amountPaidFallback = pickBillingNumber("amountPaid", ...sources);
  const amountPaid = paidFromRows > 0 ? paidFromRows : paidFromActivityLog > 0 ? paidFromActivityLog : amountPaidFallback;

  const paymentSnap = computePaymentSnapshot(totalAmount, discount, amountPaid);
  const billId = pickBillingText("billId", ...sources);
  const paymentMethod = pickBillingText("paymentMethod", ...sources);

  return {
    billId,
    paymentMethod,
    paymentSnap,
    debug: {
      total: {
        value: totalAmount,
        source: totalAmount === totalFromStored && totalFromStored > 0 ? "storedBillingTotal" : hasPackages ? "packageAwareDerived" : "fallbackDerived",
        storedBillingTotal: totalFromStored,
        packageAwareTotal: totalFromPackage,
        hasPackages,
      },
      paid: {
        value: amountPaid,
        source: paidFromRows > 0 ? "approvedPaymentRows" : paidFromActivityLog > 0 ? "paymentActivityLog" : "storedBillingAmountPaid",
        approvedPaymentRowsTotal: paidFromRows,
        paymentActivityLogTotal: paidFromActivityLog,
        storedBillingAmountPaid: amountPaidFallback,
      },
      net: paymentSnap.netAmount,
      balance: {
        value: paymentSnap.balanceDue,
        formula: `max(0, ${paymentSnap.netAmount} - ${paymentSnap.amountPaid})`,
      },
      packageBreakdown: packageDebug,
    },
  };
}
