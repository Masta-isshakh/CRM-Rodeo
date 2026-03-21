import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import "./PaymentInvoiceManagment.css";
import "./JobOrderHistory.css";
import "./JobCards.css";

import SuccessPopup from "./SuccessPopup";
import ErrorPopup from "./ErrorPopup";
import PermissionGate from "./PermissionGate";
import { getDataClient } from "../lib/amplifyClient";
import { usePermissions } from "../lib/userPermissions";
import { useLanguage } from "../i18n/LanguageContext";
import { getUserDirectory } from "../utils/userDirectoryCache";
import { resolveActorDisplay, resolveActorUsername, resolveOrderCreatedBy } from "../utils/actorIdentity";
import {
  clampTotalDiscountAmount,
  computeCumulativeDiscountAllowance,
  resolveCentralDiscountPercent,
} from "../utils/discountPolicy";
import {
  derivePaymentStatusFromFinancials,
  pickBillingFirstValue,
  pickPaymentEnum,
  pickPaymentLabel,
} from "../utils/paymentStatus";

import {
  cancelJobOrderByOrderNumber,
  getJobOrderByOrderNumber,
  upsertJobOrder,
} from "./jobOrderRepo";
import { UnifiedCustomerInfoCard, UnifiedVehicleInfoCard } from "../components/UnifiedCustomerVehicleCards";
import { UnifiedJobOrderSummaryCard } from "../components/UnifiedJobOrderSummaryCard";

import { getUrl, uploadData } from "aws-amplify/storage";

// -------------------- helpers --------------------
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

function errMsg(e: unknown) {
  const anyE = e as any;
  return String(anyE?.message ?? anyE?.errors?.[0]?.message ?? anyE ?? "Unknown error");
}

function toNum(v: any): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "");
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fmtQar(n: number) {
  return `QAR ${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
}

function safeFileName(name: string) {
  return String(name || "file")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "");
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = String(dataUrl || "").split(",");
  const mime = meta?.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
  const bin = atob(b64 || "");
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function resolveMaybeStorageUrl(urlOrPath: string): Promise<string> {
  const v = String(urlOrPath || "").trim();
  if (!v) return "";
  if (v.startsWith("job-orders/")) {
    const out = await getUrl({ path: v });
    return out.url.toString();
  }
  return v;
}

function normalizeWorkStatus(rowStatus?: string, label?: string): string {
  const l = String(label ?? "").trim();
  if (l) return l;

  switch (String(rowStatus || "").toUpperCase()) {
    case "DRAFT":
      return "Draft";
    case "OPEN":
      return "New Request";
    case "IN_PROGRESS":
      return "Service_Operation";
    case "READY":
      return "Ready";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return "Service_Operation";
  }
}

function normalizePaymentStatusLabel(enumVal?: string, label?: string): string {
  const ps = String(enumVal ?? "").trim().toUpperCase();
  const psCompact = ps.replace(/[\s_-]+/g, "");
  if (ps === "PAID" || ps === "FULLY_PAID" || psCompact === "FULLYPAID") return "Fully Paid";
  if (ps === "PARTIAL" || ps === "PARTIALLY_PAID" || psCompact === "PARTIALLYPAID") return "Partially Paid";
  if (ps === "UNPAID" || ps === "NOT_PAID" || psCompact === "NOTPAID") return "Unpaid";

  const raw = String(label ?? "").trim();
  if (!raw) return "Unpaid";

  const lower = raw.toLowerCase();
  if (lower.includes("fully paid") || lower.includes("fully_paid") || lower.includes("fullypaid") || lower === "paid") return "Fully Paid";
  if (lower.includes("partially") || lower === "partial") return "Partially Paid";
  if (lower.includes("unpaid")) return "Unpaid";

  return raw;
}

function isFullyPaidStatus(enumVal?: string, label?: string): boolean {
  return normalizePaymentStatusLabel(enumVal, label) === "Fully Paid";
}

type DocItem = {
  id: string;
  name: string;
  type: string;
  category?: string;
  addedAt?: string;
  uploadedBy?: string;
  storagePath?: string;
  url?: string;
  paymentReference?: string;
  billReference?: string;
  billDetails?: any;
};

type InvoiceUi = {
  id: string;
  number: string;
  amount: number;
  discount: number;
  status: string;
  paymentMethod?: string | null;
  services: string[];
  createdAt?: string | null;
};

type PaymentRowRaw = {
  id: string;
  jobOrderId: string;
  amount: number;
  method?: string;
  reference?: string;
  paidAt?: string;
  notes?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

type PaymentLogUi = {
  serial: number;
  amount: string;
  discount: string;
  paymentMethod: string;
  cashierName: string;
  timestamp: string;
  _raw: PaymentRowRaw;
};

type PaymentFormState = {
  orderNumber: string;
  jobOrderId: string;

  totalAmount: number;
  netAmount: number;
  amountPaid: number;

  discount: string;
  discountPercent: string;
  amountToPay: string;
  paymentMethod: string;

  transferProofDataUrl: string | null;
  transferProofName: string;

  balance: number;
  discountFloor: number;
};

type RefundFormState = {
  orderNumber: string;
  jobOrderId: string;

  refundType: "Full Refund" | "Partial Refund";
  refundAmount: string;
  maxRefundAmount: number;
};

type ListOrder = {
  _backendId: string;
  id: string; // orderNumber
  orderType: string;
  customerName: string;
  mobile: string;
  vehiclePlate: string;
  createDate: string;

  statusEnum: string;
  workStatus: string;

  paymentEnum: string;
  paymentStatus: string;

  paymentTotalAmount: number;
  paymentDiscount: number;
  paymentAmountPaid: number;
  paymentNetAmount: number;
  paymentBalanceDue: number;

  _parsed: any;
};

function roundMoney(value: number): number {
  const n = Number.isFinite(value) ? value : 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function computePaymentSnapshot(totalAmountRaw: number, discountRaw: number, amountPaidRaw: number) {
  const totalAmount = roundMoney(Math.max(0, toNum(totalAmountRaw)));
  const discount = roundMoney(Math.max(0, toNum(discountRaw)));
  const netAmount = roundMoney(Math.max(0, totalAmount - Math.min(discount, totalAmount)));
  const amountPaid = roundMoney(Math.max(0, toNum(amountPaidRaw)));
  const balanceDue = roundMoney(Math.max(0, netAmount - amountPaid));

  const paymentStatusEnum = balanceDue <= 0.00001 ? "PAID" : amountPaid > 0.00001 ? "PARTIAL" : "UNPAID";
  const paymentStatusLabel = paymentStatusEnum === "PAID" ? "Fully Paid" : paymentStatusEnum === "PARTIAL" ? "Partially Paid" : "Unpaid";

  return {
    totalAmount,
    discount,
    netAmount,
    amountPaid,
    balanceDue,
    paymentStatusEnum,
    paymentStatusLabel,
  };
}

function normalizeCatalogKey(value: any) {
  return String(value ?? "").trim().toLowerCase();
}

function getPackageGroupKeyFromService(service: any) {
  const packageCode = normalizeCatalogKey(service?.packageCode);
  const packageName = String(service?.packageName || "").trim();
  return packageCode || (packageName ? `pkg:${normalizeCatalogKey(packageName)}` : "");
}

function summarizeServicesSubtotalPackageAware(services: any[]): number {
  let standaloneSubtotal = 0;
  const packageSummary = new Map<string, { packagePrice: number | null; fallbackServicesTotal: number }>();

  for (const service of services || []) {
    const price = Math.max(0, toNum(service?.price));
    const packageKey = getPackageGroupKeyFromService(service);

    if (!packageKey) {
      standaloneSubtotal += price;
      continue;
    }

    const existing = packageSummary.get(packageKey) || { packagePrice: null, fallbackServicesTotal: 0 };
    const packagePriceRaw = toNum(service?.packagePrice);
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

  return roundMoney(Math.max(0, standaloneSubtotal + packageSubtotal));
}

function resolvePackageAwareTotalAmountFromSources(...sources: any[]): number | null {
  for (const source of sources) {
    if (!source) continue;
    const services = Array.isArray(source?.services) ? source.services : null;
    if (!services || services.length === 0) continue;
    return summarizeServicesSubtotalPackageAware(services);
  }
  return null;
}

function hasPackageSignalsInSources(...sources: any[]): boolean {
  for (const source of sources) {
    if (!source) continue;
    const services = Array.isArray(source?.services) ? source.services : [];
    if (!services.length) continue;
    const hasSignals = services.some(
      (s: any) =>
        String(s?.packageCode ?? "").trim() ||
        String(s?.packageName ?? "").trim() ||
        Math.max(0, toNum(s?.packagePrice)) > 0
    );
    if (hasSignals) return true;
  }
  return false;
}

function resolveAuthoritativeTotalAmount(...sources: any[]): number {
  if (hasPackageSignalsInSources(...sources)) {
    const packageAwareFirst = resolvePackageAwareTotalAmountFromSources(...sources);
    if (packageAwareFirst != null && packageAwareFirst > 0) return packageAwareFirst;
  }

  const fromBilling = toNum(pickBillingFirstValue("totalAmount", ...sources));
  if (fromBilling > 0) return fromBilling;

  const packageAware = resolvePackageAwareTotalAmountFromSources(...sources);
  return packageAware ?? 0;
}

function buildPackageAuditBreakdown(services: any[]) {
  const packageMap = new Map<string, { title: string; packagePrice: number | null; fallbackServicesTotal: number; itemCount: number }>();
  let standaloneTotal = 0;
  let standaloneCount = 0;

  for (const service of services || []) {
    const servicePrice = Math.max(0, toNum(service?.price));
    const packageKey = getPackageGroupKeyFromService(service);

    if (!packageKey) {
      standaloneTotal += servicePrice;
      standaloneCount += 1;
      continue;
    }

    const packageName = String(service?.packageName || service?.packageCode || "Unnamed Package").trim();
    const existing = packageMap.get(packageKey) || {
      title: packageName,
      packagePrice: null,
      fallbackServicesTotal: 0,
      itemCount: 0,
    };

    const packagePriceRaw = toNum(service?.packagePrice);
    const packagePrice = packagePriceRaw > 0 ? packagePriceRaw : null;

    packageMap.set(packageKey, {
      title: existing.title || packageName,
      packagePrice: existing.packagePrice ?? packagePrice,
      fallbackServicesTotal: existing.fallbackServicesTotal + servicePrice,
      itemCount: existing.itemCount + 1,
    });
  }

  const packageLines = Array.from(packageMap.entries()).map(([key, entry]) => ({
    key,
    title: entry.title,
    itemCount: entry.itemCount,
    total: roundMoney(entry.packagePrice ?? entry.fallbackServicesTotal),
  }));

  return {
    packageLines,
    standaloneCount,
    standaloneTotal: roundMoney(standaloneTotal),
  };
}

export default function PaymentInvoiceManagement({ currentUser }: { currentUser: any; permissions?: any }) {
  const client = useMemo(() => getDataClient(), []);
  const { t } = useLanguage();
  const { canOption, getOptionNumber } = usePermissions();
  const [userLabelMap, setUserLabelMap] = useState<Record<string, string>>({});

  // ✅ numeric limit (percent)
  const centralDiscountPercent = useMemo(
    () => resolveCentralDiscountPercent(canOption, getOptionNumber),
    [canOption, getOptionNumber]
  );

  const [allOrders, setAllOrders] = useState<ListOrder[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);

  const [loading, setLoading] = useState(false);

  const [showDetailsScreen, setShowDetailsScreen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);

  const [normalizedInvoices, setNormalizedInvoices] = useState<InvoiceUi[]>([]);
  const [paymentRowsRaw, setPaymentRowsRaw] = useState<PaymentRowRaw[]>([]);
  const [approvalRequests, setApprovalRequests] = useState<any[]>([]);
  const paymentRowsCacheRef = useRef<Map<string, PaymentRowRaw[]>>(new Map());
  const approvalRequestsCacheRef = useRef<Map<string, any[]>>(new Map());
  const invoicesCacheRef = useRef<Map<string, InvoiceUi[]>>(new Map());
  const detailsViewCacheRef = useRef<
    Map<
      string,
      {
        selectedOrder: any;
        payRows: PaymentRowRaw[];
        approvals: any[];
        invoices: InvoiceUi[];
      }
    >
  >(new Map());

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const activeDropdownRef = useRef<string | null>(null);

  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);

  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [successMessage, setSuccessMessage] = useState<React.ReactNode>("");
  const [showErrorPopup, setShowErrorPopup] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [showBillExistsPopup, setShowBillExistsPopup] = useState(false);
  const [billExistsMessage, setBillExistsMessage] = useState("");
  const [showBillGeneratedPopup, setShowBillGeneratedPopup] = useState(false);
  const [billGeneratedMessage, setBillGeneratedMessage] = useState("");
  const [isGeneratingBill, setIsGeneratingBill] = useState(false);

  const [showPaymentPopup, setShowPaymentPopup] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState | null>(null);

  const [showRefundPopup, setShowRefundPopup] = useState(false);
  const [refundForm, setRefundForm] = useState<RefundFormState | null>(null);

  const displayUser = (value: any) => {
    return resolveActorDisplay(value, {
      identityToUsernameMap: userLabelMap,
      fallback: "—",
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const directory = await getUserDirectory(client);
        if (cancelled) return;

        setUserLabelMap(directory.identityToUsernameMap ?? {});
      } catch {
        if (!cancelled) setUserLabelMap({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  // -------------------- dropdown outside click --------------------
  useEffect(() => {
    const handleClickOutside = (event: any) => {
      const isDropdownButton = event.target.closest(".btn-action-dropdown");
      const isDropdownMenu = event.target.closest(".action-dropdown-menu");
      if (!isDropdownButton && !isDropdownMenu) {
        activeDropdownRef.current = null;
        setActiveDropdown(null);
      }
    };

    if (activeDropdown) {
      document.addEventListener("pointerdown", handleClickOutside, true);
      return () => document.removeEventListener("pointerdown", handleClickOutside, true);
    }
  }, [activeDropdown]);

  const toggleActionDropdown = useCallback((orderId: string, anchorEl: HTMLElement) => {
    const isActive = activeDropdownRef.current === orderId;
    if (isActive) {
      activeDropdownRef.current = null;
      setActiveDropdown(null);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    const menuHeight = 140;
    const menuWidth = 220;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    flushSync(() => {
      activeDropdownRef.current = orderId;
      setDropdownPosition({ top, left });
      setActiveDropdown(orderId);
    });
  }, []);

  // -------------------- live JobOrder list --------------------
  useEffect(() => {
    const sub = (client.models.JobOrder as any)
      .observeQuery({ limit: 500 })
      .subscribe(({ items }: any) => {
        const mapped: ListOrder[] = (items ?? []).map((row: any) => {
          const parsed = safeJsonParse<any>(row.dataJson, {});
          const orderNumber = String(row.orderNumber ?? "");
          const createDate = row.createdAt
            ? new Date(String(row.createdAt)).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : "";

          const workStatus = normalizeWorkStatus(row.status, row.workStatusLabel ?? parsed.workStatusLabel);
          const totalAmount = resolveAuthoritativeTotalAmount(parsed, row);
          const discount = toNum(pickBillingFirstValue("discount", parsed, row));
          const amountPaid = toNum(pickBillingFirstValue("amountPaid", parsed, row));
          const paymentSnap = computePaymentSnapshot(totalAmount, discount, amountPaid);
          const paymentStatus = derivePaymentStatusFromFinancials({
            paymentEnum: pickPaymentEnum(row, parsed),
            paymentLabel: pickPaymentLabel(row, parsed),
            totalAmount: paymentSnap.totalAmount,
            discount: paymentSnap.discount,
            amountPaid: paymentSnap.amountPaid,
            netAmount: paymentSnap.netAmount,
            balanceDue: paymentSnap.balanceDue,
          });

          return {
            _backendId: String(row.id),
            id: orderNumber,
            orderType: String(row.orderType ?? parsed.orderType ?? "Job Order"),
            customerName: String(row.customerName ?? parsed.customerName ?? ""),
            mobile: String(row.customerPhone ?? parsed.customerPhone ?? ""),
            vehiclePlate: String(row.plateNumber ?? parsed.plateNumber ?? ""),
            createDate,

            statusEnum: String(row.status ?? ""),
            workStatus,

            paymentEnum: String(row.paymentStatus ?? pickPaymentEnum(row, parsed) ?? ""),
            paymentStatus,

            paymentTotalAmount: paymentSnap.totalAmount,
            paymentDiscount: paymentSnap.discount,
            paymentAmountPaid: paymentSnap.amountPaid,
            paymentNetAmount: paymentSnap.netAmount,
            paymentBalanceDue: paymentSnap.balanceDue,

            _parsed: parsed,
          };
        });

        setAllOrders(mapped);
      });

    return () => sub.unsubscribe();
  }, [client]);

  // -------------------- filter rules --------------------
  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const allowedStatuses = new Set(["Unpaid", "Partially Paid"]);

    const list = allOrders.filter((o) => {
      const normalizedPay = normalizePaymentStatusLabel(o.paymentEnum, o.paymentStatus);

      const snap = computePaymentSnapshot(
        o.paymentTotalAmount,
        o.paymentDiscount,
        o.paymentAmountPaid
      );
      const hasBalanceSignal = o.paymentNetAmount > 0 || o.paymentAmountPaid > 0 || o.paymentBalanceDue > 0;
      const isFullyPaidByAmounts = hasBalanceSignal
        ? (o.paymentBalanceDue <= 0.00001 || snap.balanceDue <= 0.00001)
        : false;

      if (isFullyPaidByAmounts) return false;
      if (isFullyPaidStatus(o.paymentEnum, o.paymentStatus)) return false;
      return allowedStatuses.has(normalizedPay);
    });

    if (!q) return list;

    return list.filter((o) => {
      const hay = [
        o.id,
        o.orderType,
        o.customerName,
        o.mobile,
        o.vehiclePlate,
        o.workStatus,
        o.paymentStatus,
        o.createDate,
      ]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [allOrders, searchQuery]);

  useEffect(() => setCurrentPage(1), [pageSize, searchQuery]);
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedData = filteredOrders.slice(startIndex, startIndex + pageSize);

  // -------------------- backend loaders --------------------
  const loadPaymentsRaw = async (jobOrderId: string): Promise<PaymentRowRaw[]> => {
    const key = String(jobOrderId ?? "").trim();
    if (!key) return [];
    if (paymentRowsCacheRef.current.has(key)) return paymentRowsCacheRef.current.get(key) ?? [];

    try {
      try {
        const byIdx = await (client.models.JobOrderPayment as any).listPaymentsByJobOrder?.({
          jobOrderId: key,
          limit: 500,
        });
        const rows = (byIdx?.data ?? []) as any[];
        const mapped = rows.map((p) => ({
          id: String(p.id),
          jobOrderId: String(p.jobOrderId),
          amount: toNum(p.amount),
          method: p.method ?? undefined,
          reference: p.reference ?? undefined,
          paidAt: p.paidAt ?? undefined,
          notes: p.notes ?? undefined,
          createdBy: p.createdBy ?? undefined,
          createdAt: p.createdAt ?? undefined,
          updatedAt: p.updatedAt ?? undefined,
        }));
        paymentRowsCacheRef.current.set(key, mapped);
        return mapped;
      } catch {
        const res = await client.models.JobOrderPayment.list({
          limit: 500,
          filter: { jobOrderId: { eq: key } } as any,
        });
        const rows = (res?.data ?? []) as any[];
        const mapped = rows.map((p) => ({
          id: String(p.id),
          jobOrderId: String(p.jobOrderId),
          amount: toNum(p.amount),
          method: p.method ?? undefined,
          reference: p.reference ?? undefined,
          paidAt: p.paidAt ?? undefined,
          notes: p.notes ?? undefined,
          createdBy: p.createdBy ?? undefined,
          createdAt: p.createdAt ?? undefined,
          updatedAt: p.updatedAt ?? undefined,
        }));
        paymentRowsCacheRef.current.set(key, mapped);
        return mapped;
      }
    } catch {
      paymentRowsCacheRef.current.set(key, []);
      return [];
    }
  };

  const mapPaymentLog = (rows: PaymentRowRaw[]): PaymentLogUi[] => {
    const sorted = [...rows].sort((a, b) =>
      String(a.paidAt ?? a.createdAt ?? "").localeCompare(String(b.paidAt ?? b.createdAt ?? ""))
    );
    return sorted.map((p, idx) => ({
      serial: idx + 1,
      amount: fmtQar(toNum(p.amount)),
      discount: fmtQar(0),
      paymentMethod: String(p.method ?? "Cash"),
      cashierName: String(p.createdBy ?? "").trim(),
      timestamp: p.paidAt
        ? new Date(String(p.paidAt)).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
        : (p.createdAt
            ? new Date(String(p.createdAt)).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : "—"),
      _raw: p,
    }));
  };

  const loadApprovalRequests = async (orderNumber: string) => {
    const key = String(orderNumber ?? "").trim();
    if (!key) return [];
    if (approvalRequestsCacheRef.current.has(key)) return approvalRequestsCacheRef.current.get(key) ?? [];

    try {
      const res = await (client.models.ServiceApprovalRequest as any).serviceApprovalRequestsByOrderNumber({
        orderNumber: key,
        limit: 500,
      });
      const rows = (res?.data ?? []) as any[];
      rows.sort((a, b) => String(b.requestedAt ?? b.createdAt ?? "").localeCompare(String(a.requestedAt ?? a.createdAt ?? "")));
      approvalRequestsCacheRef.current.set(key, rows);
      return rows;
    } catch {
      approvalRequestsCacheRef.current.set(key, []);
      return [];
    }
  };

  const loadNormalizedInvoices = async (jobOrderId: string): Promise<InvoiceUi[]> => {
    const key = String(jobOrderId ?? "").trim();
    if (!key) return [];
    if (invoicesCacheRef.current.has(key)) return invoicesCacheRef.current.get(key) ?? [];

    const out: InvoiceUi[] = [];
    try {
      let invRows: any[] = [];

      try {
        const byIdx = await (client.models.JobOrderInvoice as any).listInvoicesByJobOrder?.({
          jobOrderId: key,
          limit: 500,
        });
        invRows = (byIdx?.data ?? []) as any[];
      } catch {
        const res = await client.models.JobOrderInvoice.list({
          limit: 500,
          filter: { jobOrderId: { eq: key } } as any,
        });
        invRows = (res?.data ?? []) as any[];
      }

      invRows.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));

      for (const inv of invRows) {
        const invoiceId = String(inv.id ?? "");
        let svcRows: any[] = [];

        try {
          const byIdxSvc = await (client.models.JobOrderInvoiceService as any).listInvoiceServicesByInvoice?.({
            invoiceId,
            limit: 500,
          });
          svcRows = (byIdxSvc?.data ?? []) as any[];
        } catch {
          const resSvc = await client.models.JobOrderInvoiceService.list({
            limit: 500,
            filter: { invoiceId: { eq: invoiceId } } as any,
          });
          svcRows = (resSvc?.data ?? []) as any[];
        }

        const services = svcRows.map((s) => String(s.serviceName ?? "").trim()).filter(Boolean);

        out.push({
          id: invoiceId,
          number: String(inv.number ?? "—"),
          amount: toNum(inv.amount),
          discount: toNum(inv.discount),
          status: String(inv.status ?? "Unpaid"),
          paymentMethod: inv.paymentMethod ?? null,
          services,
          createdAt: inv.createdAt ?? null,
        });
      }
    } catch {
      // ignore
    }
    invoicesCacheRef.current.set(key, out);
    return out;
  };

  // -------------------- details open/close --------------------
  const openDetailsView = async (orderNumber: string) => {
    const orderKey = String(orderNumber ?? "").trim();
    if (!orderKey) return;

    const cached = detailsViewCacheRef.current.get(orderKey);
    if (cached) {
      setPaymentRowsRaw(cached.payRows);
      setApprovalRequests(cached.approvals);
      setNormalizedInvoices(cached.invoices);
      setSelectedOrder(cached.selectedOrder);
      setShowDetailsScreen(true);
      return;
    }

    setLoading(true);
    try {
      const detailed = await getJobOrderByOrderNumber(orderKey);
      if (!detailed?._backendId) throw new Error("Order not found in backend.");

      const rowRes = await client.models.JobOrder.get({ id: detailed._backendId } as any);
      const row = (rowRes as any)?.data ?? null;
      const parsed = safeJsonParse<any>(row?.dataJson, {});
      const docs: DocItem[] = Array.isArray(parsed?.documents)
        ? parsed.documents
        : (Array.isArray(detailed?.documents) ? detailed.documents : []);

      const [payRows, approvals, invoices] = await Promise.all([
        loadPaymentsRaw(String(detailed._backendId)),
        loadApprovalRequests(orderKey),
        loadNormalizedInvoices(String(detailed._backendId)),
      ]);
      setPaymentRowsRaw(payRows);
      const paymentActivityLog = mapPaymentLog(payRows);
      setApprovalRequests(approvals);
      setNormalizedInvoices(invoices);

      const totalAmountRaw = resolveAuthoritativeTotalAmount(detailed, parsed, row);
      const discountRaw = toNum(detailed?.billing?.discount ?? parsed?.billing?.discount ?? row?.discount);

      // Authoritative amountPaid: sum approved payment rows (single source of truth).
      // Never rely on the stored billing.amountPaid which can be stale after payments.
      const approvedPayRows = payRows.filter((p: any) => {
        const st = String(p?.paymentStatus ?? "COMPLETED").trim().toUpperCase();
        return st !== "VOID" && st !== "CANCELLED" && st !== "FAILED";
      });
      const amountPaidRaw = approvedPayRows.length > 0
        ? roundMoney(approvedPayRows.reduce((s: number, p: any) => s + Math.max(0, toNum(p?.amount)), 0))
        : toNum(parsed?.billing?.amountPaid ?? row?.amountPaid ?? detailed?.billing?.amountPaid);

      // Always recompute netAmount and balanceDue from scratch — never trust stale stored values
      const paymentSnap = computePaymentSnapshot(totalAmountRaw, discountRaw, amountPaidRaw);

      const billing = {
        billId: String(detailed?.billing?.billId ?? row?.billId ?? parsed?.billing?.billId ?? ""),
        totalAmount: fmtQar(paymentSnap.totalAmount),
        discount: fmtQar(paymentSnap.discount),
        netAmount: fmtQar(paymentSnap.netAmount),
        amountPaid: fmtQar(paymentSnap.amountPaid),
        balanceDue: fmtQar(paymentSnap.balanceDue),
        paymentMethod: String(detailed?.billing?.paymentMethod ?? row?.paymentMethod ?? parsed?.billing?.paymentMethod ?? ""),
      };

      const merged = {
        ...detailed,
        _backendId: String(detailed._backendId),
        id: orderKey,
        orderNumber: orderKey,

        orderType: String(row?.orderType ?? detailed?.orderType ?? parsed?.orderType ?? "Job Order"),
        customerName: String(row?.customerName ?? detailed?.customerName ?? parsed?.customerName ?? ""),
        mobile: String(row?.customerPhone ?? detailed?.mobile ?? parsed?.customerPhone ?? ""),
        vehiclePlate: String(row?.plateNumber ?? detailed?.vehiclePlate ?? parsed?.plateNumber ?? ""),

        workStatus: normalizeWorkStatus(row?.status, row?.workStatusLabel ?? parsed?.workStatusLabel ?? detailed?.workStatus),
        paymentStatus: paymentSnap.paymentStatusLabel,
        paymentStatusEnum: paymentSnap.paymentStatusEnum,

        billing,
        paymentActivityLog,
        documents: docs,

        _row: row,
        _parsed: parsed,
      };

      detailsViewCacheRef.current.set(orderKey, {
        selectedOrder: merged,
        payRows,
        approvals,
        invoices,
      });
      setSelectedOrder(merged);
      setShowDetailsScreen(true);
    } catch (e) {
      setErrorMessage(`Load failed: ${errMsg(e)}`);
      setShowErrorPopup(true);
    } finally {
      setLoading(false);
    }
  };

  const closeDetailsView = () => {
    const orderKey = String(selectedOrder?.id ?? selectedOrder?.orderNumber ?? "").trim();
    if (orderKey) detailsViewCacheRef.current.delete(orderKey);
    setShowDetailsScreen(false);
    setSelectedOrder(null);
    setNormalizedInvoices([]);
    setPaymentRowsRaw([]);
    setApprovalRequests([]);
  };

  const invalidateDetailsCaches = (orderNumber?: string | null, backendId?: string | null) => {
    const orderKey = String(orderNumber ?? "").trim();
    const backendKey = String(backendId ?? "").trim();
    if (orderKey) {
      detailsViewCacheRef.current.delete(orderKey);
      approvalRequestsCacheRef.current.delete(orderKey);
    }
    if (backendKey) {
      paymentRowsCacheRef.current.delete(backendKey);
      invoicesCacheRef.current.delete(backendKey);
    }
  };

  const refreshDetails = async () => {
    if (!selectedOrder?.id) return;
    invalidateDetailsCaches(String(selectedOrder?.id), String(selectedOrder?._backendId ?? ""));
    await openDetailsView(String(selectedOrder.id));
  };

  // -------------------- cancel order --------------------
  const handleShowCancelConfirmation = (orderId: string) => {
    setCancelOrderId(orderId);
    setShowCancelConfirmation(true);
    setActiveDropdown(null);
  };

  const handleCancelOrder = async () => {
    if (!cancelOrderId) return;
    setLoading(true);
    try {
      await cancelJobOrderByOrderNumber(cancelOrderId);
      setShowCancelConfirmation(false);
      setCancelOrderId(null);

      setSuccessMessage(
        <>
          <span className="pim-pop-title"><i className="fas fa-check-circle" /> Order Cancelled</span>
          <span className="pim-pop-text">Order <strong>{cancelOrderId}</strong> cancelled successfully.</span>
        </>
      );
      setShowSuccessPopup(true);
      closeDetailsView();
    } catch (e) {
      setErrorMessage(`Cancel failed: ${errMsg(e)}`);
      setShowErrorPopup(true);
    } finally {
      setLoading(false);
    }
  };

  // -------------------- payment popup --------------------
  const openPaymentPopup = () => {
    if (!selectedOrder) return;

    const totalAmount = toNum(selectedOrder?.billing?.totalAmount);
    const rawDiscount = Math.max(0, toNum(selectedOrder?.billing?.discount));
    const discountFloor = Math.min(rawDiscount, Math.max(0, totalAmount));
    const discountAllowance = computeCumulativeDiscountAllowance({
      policyMaxPercent: centralDiscountPercent,
      baseAmount: totalAmount,
      existingDiscountAmount: rawDiscount,
      floorDiscountAmount: discountFloor,
    });
    const discount = clampTotalDiscountAmount(discountFloor, discountAllowance);

    const currentAmountPaid = toNum(selectedOrder?.billing?.amountPaid);
    const snap = computePaymentSnapshot(totalAmount, discount, currentAmountPaid);

    if (snap.balanceDue <= 0.00001) {
      setErrorMessage("This job order is already fully paid. No additional payment is allowed.");
      setShowErrorPopup(true);
      return;
    }

    setPaymentForm({
      orderNumber: String(selectedOrder.id),
      jobOrderId: String(selectedOrder._backendId),
      totalAmount,
      netAmount: snap.netAmount,
      amountPaid: snap.amountPaid,
      discount: String(snap.discount.toFixed(2)),
      discountPercent: String(totalAmount > 0 ? ((snap.discount / totalAmount) * 100).toFixed(2) : "0.00"),
      amountToPay: "",
      paymentMethod: String(selectedOrder?.billing?.paymentMethod || ""),
      transferProofDataUrl: null,
      transferProofName: "",
      balance: snap.balanceDue,
      discountFloor,
    });
    setShowPaymentPopup(true);
  };

  const closePaymentPopup = () => {
    setShowPaymentPopup(false);
    setPaymentForm(null);
  };

  const handlePaymentChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    setPaymentForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [name]: value } as PaymentFormState;

      if (name === "discount" || name === "discountPercent" || name === "amountToPay") {
        const discountAllowance = computeCumulativeDiscountAllowance({
          policyMaxPercent: centralDiscountPercent,
          baseAmount: prev.totalAmount,
          existingDiscountAmount: Math.max(0, prev.discountFloor || 0),
          floorDiscountAmount: Math.max(0, prev.discountFloor || 0),
        });

        let discount = Math.max(0, toNum(next.discount));
        if (name === "discountPercent") {
          let percent = Math.max(0, toNum(next.discountPercent));
          percent = Math.min(percent, centralDiscountPercent);
          next.discountPercent = percent.toFixed(2);
          discount = (Math.max(0, prev.totalAmount) * percent) / 100;
        }

        discount = clampTotalDiscountAmount(discount, discountAllowance);

        next.discount = discount.toFixed(2);
        next.discountPercent =
          prev.totalAmount > 0
            ? ((discount / prev.totalAmount) * 100).toFixed(2)
            : "0.00";

        const net = roundMoney(Math.max(0, prev.totalAmount - discount));
        next.netAmount = net;

        const remainingBeforePayment = roundMoney(Math.max(0, net - prev.amountPaid));
        let amountToPay = roundMoney(Math.max(0, toNum(next.amountToPay)));
        if (amountToPay > remainingBeforePayment) {
          amountToPay = remainingBeforePayment;
          next.amountToPay = amountToPay.toFixed(2);
        }

        next.balance = roundMoney(Math.max(0, remainingBeforePayment - amountToPay));
      }

      if (name === "paymentMethod" && value !== "Transfer") {
        next.transferProofDataUrl = null;
        next.transferProofName = "";
      }

      return next;
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
    if (!validTypes.includes(file.type)) {
      setErrorMessage("Please upload a valid file (JPG, PNG, or PDF).");
      setShowErrorPopup(true);
      e.target.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage("File size must be less than 5MB.");
      setShowErrorPopup(true);
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setPaymentForm((prev) => {
        if (!prev) return prev;
        return { ...prev, transferProofDataUrl: String(reader.result || ""), transferProofName: file.name };
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSavePayment = async () => {
    if (!paymentForm || !selectedOrder) return;

    const method = String(paymentForm.paymentMethod || "").trim();
    const amountToPay = roundMoney(toNum(paymentForm.amountToPay));
    const rawDiscount = Math.max(0, toNum(paymentForm.discount));
    const existingDiscount = Math.max(0, toNum(selectedOrder?.billing?.discount));
    const discountAllowance = computeCumulativeDiscountAllowance({
      policyMaxPercent: centralDiscountPercent,
      baseAmount: paymentForm.totalAmount,
      existingDiscountAmount: existingDiscount,
      floorDiscountAmount: Math.max(0, paymentForm.discountFloor || 0),
    });
    const discount = clampTotalDiscountAmount(
      Math.max(rawDiscount, Math.max(0, paymentForm.discountFloor || 0)),
      discountAllowance
    );

    if (rawDiscount > discountAllowance.maxAllowedTotalDiscountAmount + 0.00001) {
      setErrorMessage(`Discount exceeds limit. Max allowed is ${fmtQar(discountAllowance.maxAllowedTotalDiscountAmount)} (${centralDiscountPercent}% policy, including existing approved discount).`);
      setShowErrorPopup(true);
      return;
    }

    if (!method) {
      setErrorMessage("Please select a payment method.");
      setShowErrorPopup(true);
      return;
    }
    if (amountToPay <= 0) {
      setErrorMessage("Please enter a valid payment amount.");
      setShowErrorPopup(true);
      return;
    }
    if (method === "Transfer" && !paymentForm.transferProofDataUrl) {
      setErrorMessage("Please upload proof of transfer.");
      setShowErrorPopup(true);
      return;
    }

    const totalAmount = Math.max(0, toNum(selectedOrder?.billing?.totalAmount));
    const currentAmountPaid = Math.max(0, toNum(selectedOrder?.billing?.amountPaid));
    const beforePayment = computePaymentSnapshot(totalAmount, discount, currentAmountPaid);

    if (beforePayment.balanceDue <= 0.00001) {
      setErrorMessage("This job order is already fully paid. No additional payment is allowed.");
      setShowErrorPopup(true);
      return;
    }

    if (amountToPay - beforePayment.balanceDue > 0.00001) {
      setErrorMessage(`Payment amount exceeds remaining balance (${fmtQar(beforePayment.balanceDue)}).`);
      setShowErrorPopup(true);
      return;
    }

    setLoading(true);
    try {
      const actor = resolveActorUsername(currentUser, "user");

      let newDoc: DocItem | null = null;
      if (method === "Transfer" && paymentForm.transferProofDataUrl) {
        const blob = dataUrlToBlob(paymentForm.transferProofDataUrl);
        const key = `job-orders/${paymentForm.orderNumber}/payments/${Date.now()}-${safeFileName(paymentForm.transferProofName || "transfer_proof")}`;
        await uploadData({ path: key, data: blob, options: { contentType: blob.type || "application/octet-stream" } }).result;

        newDoc = {
          id: `DOC-${Date.now()}`,
          name: paymentForm.transferProofName || "Transfer Proof",
          type: "Transfer Proof",
          category: "Payment",
          addedAt: new Date().toISOString(),
          uploadedBy: actor,
          storagePath: key,
          paymentReference: `Payment ${new Date().toLocaleString("en-GB")}`,
        };
      }

      const parsed = safeJsonParse<any>(selectedOrder?._parsed ?? selectedOrder?.dataJson, {});
      const existingDocs: DocItem[] = Array.isArray(selectedOrder?.documents)
        ? selectedOrder.documents
        : Array.isArray(parsed?.documents)
          ? parsed.documents
          : [];

      const updatedDocs = newDoc ? [...existingDocs, newDoc] : existingDocs;

      const netAmount = beforePayment.netAmount;
      const afterPaymentAmountPaid = roundMoney(beforePayment.amountPaid + amountToPay);
      const afterPayment = computePaymentSnapshot(totalAmount, discount, afterPaymentAmountPaid);

      // ✅ IMPORTANT: write TOP-LEVEL fields that the Lambda actually consumes
      const updatedOrder = {
        ...selectedOrder,

        discount,                 // numeric
        netAmount,                // numeric
        paymentMethod: method,    // top-level
        billId: String(selectedOrder?.billing?.billId ?? ""), // keep if exists

        documents: updatedDocs,
        billing: {
          ...(selectedOrder.billing || {}),
          totalAmount: fmtQar(totalAmount),
          discount: fmtQar(discount),
          netAmount: fmtQar(netAmount),
          amountPaid: fmtQar(afterPayment.amountPaid),
          balanceDue: fmtQar(afterPayment.balanceDue),
          paymentMethod: method,
        },
        paymentStatus: afterPayment.paymentStatusLabel,
        paymentStatusEnum: afterPayment.paymentStatusEnum,
        dataJson: JSON.stringify({
          ...parsed,
          documents: updatedDocs,
          billing: {
            ...(parsed?.billing || {}),
            totalAmount,
            discount,
            netAmount,
            amountPaid: afterPayment.amountPaid,
            balanceDue: afterPayment.balanceDue,
            paymentMethod: method,
          },
          paymentStatusLabel: afterPayment.paymentStatusLabel,
        }),
      };

      await upsertJobOrder(updatedOrder);

      // audited payment row -> recomputeJobOrderPaymentSummary
      await (client.mutations as any).jobOrderPaymentCreate({
        jobOrderId: String(paymentForm.jobOrderId),
        amount: Number(amountToPay),
        method,
        reference: "",
        paidAt: new Date().toISOString(),
        notes: "",
        createdBy: actor,
      });

      setSuccessMessage(
        <>
          <span className="pim-pop-title"><i className="fas fa-check-circle" /> Payment Recorded</span>
          <span className="pim-pop-text">
            Payment <strong>{fmtQar(amountToPay)}</strong> recorded successfully.
            {method === "Transfer" ? " Transfer proof uploaded to Documents." : ""}
          </span>
        </>
      );
      setShowSuccessPopup(true);
      closePaymentPopup();

      invalidateDetailsCaches(String(paymentForm.orderNumber), String(paymentForm.jobOrderId));
      await refreshDetails();
    } catch (e) {
      setErrorMessage(`Payment failed: ${errMsg(e)}`);
      setShowErrorPopup(true);
    } finally {
      setLoading(false);
    }
  };

  // -------------------- refund popup --------------------
  const openRefundPopup = () => {
    if (!selectedOrder) return;

    const isCancelled =
      String(selectedOrder?.workStatus || "").toLowerCase().includes("cancel") ||
      String(selectedOrder?._row?.status || "").toUpperCase() === "CANCELLED";

    if (!isCancelled) {
      setErrorMessage("Refund can only be initiated for cancelled orders.");
      setShowErrorPopup(true);
      return;
    }

    const paidSum = paymentRowsRaw.reduce((acc, p) => acc + toNum(p.amount), 0);
    if (paidSum <= 0) {
      setErrorMessage("No payments exist for this order. Refund is not possible.");
      setShowErrorPopup(true);
      return;
    }

    setRefundForm({
      orderNumber: String(selectedOrder.id),
      jobOrderId: String(selectedOrder._backendId),
      refundType: "Full Refund",
      refundAmount: String(paidSum.toFixed(2)),
      maxRefundAmount: paidSum,
    });
    setShowRefundPopup(true);
  };

  const closeRefundPopup = () => {
    setShowRefundPopup(false);
    setRefundForm(null);
  };

  const handleRefundChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    setRefundForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [name]: value } as RefundFormState;

      if (name === "refundType") {
        if (value === "Full Refund") next.refundAmount = String(prev.maxRefundAmount.toFixed(2));
        else next.refundAmount = "0";
      }

      if (name === "refundAmount") {
        const v = toNum(value);
        if (v > prev.maxRefundAmount) next.refundAmount = String(prev.maxRefundAmount.toFixed(2));
      }

      return next;
    });
  };

  const handleSaveRefund = async () => {
    if (!refundForm || !selectedOrder) return;

    const refundAmount = toNum(refundForm.refundAmount);
    if (refundAmount <= 0) {
      setErrorMessage("Please enter a valid refund amount.");
      setShowErrorPopup(true);
      return;
    }
    if (refundAmount > refundForm.maxRefundAmount) {
      setErrorMessage(`Refund amount cannot exceed ${fmtQar(refundForm.maxRefundAmount)}.`);
      setShowErrorPopup(true);
      return;
    }

    setLoading(true);
    try {
      const payments = [...paymentRowsRaw].sort((a, b) =>
        String(b.paidAt ?? b.createdAt ?? "").localeCompare(String(a.paidAt ?? a.createdAt ?? ""))
      );

      let remaining = refundAmount;

      for (const p of payments) {
        if (remaining <= 0) break;

        const amt = toNum(p.amount);
        if (amt <= 0) continue;

        if (remaining < amt) {
          const newAmt = amt - remaining;
          await (client.mutations as any).jobOrderPaymentUpdate({
            id: String(p.id),
            amount: Number(newAmt),
          });
          remaining = 0;
          break;
        } else {
          await (client.mutations as any).jobOrderPaymentDelete({
            id: String(p.id),
          });
          remaining -= amt;
        }
      }

      if (remaining > 0.00001) {
        setErrorMessage("Refund could not be fully applied (insufficient payments).");
        setShowErrorPopup(true);
        return;
      }

      setSuccessMessage(
        <>
          <span className="pim-pop-title"><i className="fas fa-check-circle" /> Refund Processed</span>
          <span className="pim-pop-text">Refund <strong>{fmtQar(refundAmount)}</strong> processed successfully.</span>
        </>
      );
      setShowSuccessPopup(true);
      closeRefundPopup();

      invalidateDetailsCaches(String(refundForm.orderNumber), String(refundForm.jobOrderId));
      await refreshDetails();
    } catch (e) {
      setErrorMessage(`Refund failed: ${errMsg(e)}`);
      setShowErrorPopup(true);
    } finally {
      setLoading(false);
    }
  };

  // -------------------- generate bill --------------------
  const generateBillHTML = (order: any) => {
    const billing = order?.billing ?? {};
    const billId = String(billing.billId || order?.id || "BILL");
    const now = new Date();
    const currentDate = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    
    const services: any[] = Array.isArray(order?.services) ? order.services : [];
    const totalAmount = toNum(billing.totalAmount || 0);
    const discount = toNum(billing.discount || 0);
    const netAmount = toNum(billing.netAmount || 0);
    const amountPaid = toNum(billing.amountPaid || 0);
    const balanceDue = toNum(billing.balanceDue || 0);

    // Build service rows (max 15 rows like the template)
    let serviceRowsHtml = "";
    for (let i = 1; i <= 15; i++) {
      const service = services[i - 1];
      const description = service ? String(service?.name ?? service ?? "") : "";
      const amount = service ? fmtQar(toNum(service?.price || 0)) : "";
      
      serviceRowsHtml += `
        <tr>
          <td style="text-align:center; padding:10px; border:1px solid #ccc;">${i}</td>
          <td style="padding:10px; border:1px solid #ccc;">${description}</td>
          <td style="text-align:right; padding:10px; border:1px solid #ccc;">${amount}</td>
        </tr>
      `;
    }

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Invoice_${billId}.html</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; background: #fff; }
  @page { size: A4; margin: 0; }
  .invoice-container { width: 210mm; height: 297mm; margin: 0 auto; padding: 15mm; background: white; color: #000; }
  
  /* Header */
  .invoice-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 2px solid #000; }
  .company-info { flex: 1; }
  .company-info h1 { font-size: 24px; font-weight: bold; margin-bottom: 5px; color: #000; }
  .company-info p { font-size: 11px; margin: 2px 0; line-height: 1.4; }
  .invoice-title { text-align: center; flex: 1; }
  .invoice-title h2 { font-size: 28px; font-weight: bold; border: 3px solid #1a3a5c; padding: 10px 30px; display: inline-block; }
  .logo-area { flex: 1; text-align: right; }
  .logo-placeholder { width: 80px; height: 80px; background: #f0f0f0; border: 1px solid #999; display: inline-block; text-align: center; line-height: 80px; font-size: 11px; color: #999; }
  
  /* Arabic text */
  .arabic-text { direction: rtl; text-align: right; font-size: 12px; font-weight: bold; margin-top: 5px; }
  
  /* Bill Details Grid */
  .bill-details { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin: 20px 0; font-size: 12px; }
  .detail-field { display: flex; }
  .detail-label { font-weight: bold; min-width: 120px; }
  .detail-value { flex: 1; border-bottom: 1px dotted #999; }
  
  /* Services Table */
  .services-table { width: 100%; margin: 20px 0; border-collapse: collapse; font-size: 12px; }
  .services-table th { background: #e8e8e8; border: 1px solid #ccc; padding: 10px; text-align: center; font-weight: bold; }
  .services-table td { border: 1px solid #ccc; padding: 10px; }
  .services-table .no-col { text-align: center; width: 40px; }
  .services-table .desc-col { text-align: left; }
  .services-table .amount-col { text-align: right; width: 100px; }
  
  /* Summary Section */
  .summary-section { margin-top: 20px; }
  .summary-row { display: grid; grid-template-columns: 1fr 150px; gap: 10px; margin-bottom: 8px; font-size: 12px; font-weight: bold; }
  .summary-label { text-align: right; }
  .summary-value { text-align: right; }
  
  .total-amount-row { background: #e8e8e8; padding: 10px; display: grid; grid-template-columns: 1fr 150px; gap: 10px; margin: 10px 0; }
  .total-amount-row .summary-label { text-align: right; font-size: 14px; font-weight: bold; }
  .total-amount-row .summary-value { text-align: right; font-size: 14px; font-weight: bold; }
  
  /* Bottom fields */
  .bottom-fields { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 15px; margin: 25px 0; font-size: 11px; }
  .bottom-field { }
  .bottom-label { font-weight: bold; margin-bottom: 5px; }
  .bottom-value { border-bottom: 1px solid #999; min-height: 25px; }
  
  /* Footer */
  .invoice-footer { margin-top: 30px; padding-top: 20px; border-top: 2px solid #000; text-align: center; font-size: 10px; line-height: 1.6; }
  .footer-text { margin-bottom: 5px; }
  .footer-ar { direction: rtl; text-align: center; margin-top: 10px; }
</style>
</head>
<body>
<div class="invoice-container">
  <!-- Header -->
  <div class="invoice-header">
    <div class="company-info">
      <h1>RODEO DRIVE</h1>
      <p>Gloss PERFECTED</p>
      <p>Block 2, Shop No. SYS 066, Block 21,</p>
      <p>Near Dragon Mart Al Sayer, Doha.</p>
      <div class="arabic-text">
        <div>رودeo درايف</div>
        <div>الخدمات المتكاملة</div>
        <div>متجر 2، رقم متجر SYS 066 + 21</div>
        <div>بالقرب من دراغون مارت السيارة الدوحة</div>
      </div>
    </div>
    <div class="invoice-title">
      <h2>INVOICE</h2>
    </div>
    <div class="logo-area">
      <div class="logo-placeholder">logo</div>
    </div>
  </div>
  
  <!-- Bill Details -->
  <div class="bill-details">
    <div class="detail-field">
      <span class="detail-label">Bill Number</span>
      <span class="detail-value">${billId}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Bill Date</span>
      <span class="detail-value">${currentDate}</span>
    </div>
    <div></div>
    
    <div class="detail-field">
      <span class="detail-label">Order ID</span>
      <span class="detail-value">${String(order.id || "")}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Order Date</span>
      <span class="detail-value">${currentDate}</span>
    </div>
    <div></div>
    
    <div class="detail-field">
      <span class="detail-label">Customer Name</span>
      <span class="detail-value">${String(order.customerName || "")}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Mobile</span>
      <span class="detail-value">${String(order.mobile || "")}</span>
    </div>
    <div></div>
    
    <div class="detail-field">
      <span class="detail-label">Make</span>
      <span class="detail-value">${String(order.vehicleDetails?.make || "")}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Model</span>
      <span class="detail-value">${String(order.vehicleDetails?.model || "")}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Plate Number</span>
      <span class="detail-value">${String(order.vehiclePlate || order.vehicleDetails?.plateNumber || "")}</span>
    </div>
    
    <div class="detail-field">
      <span class="detail-label">Color</span>
      <span class="detail-value">${String(order.vehicleDetails?.color || "")}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Year</span>
      <span class="detail-value">${String(order.vehicleDetails?.year || "")}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">VIN</span>
      <span class="detail-value">${String(order.vehicleDetails?.vin || "")}</span>
    </div>
  </div>
  
  <!-- Services Table -->
  <table class="services-table">
    <thead>
      <tr>
        <th class="no-col">No</th>
        <th class="desc-col">Description</th>
        <th class="amount-col">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${serviceRowsHtml}
      <tr style="background: #e8e8e8;">
        <td colspan="2" style="text-align: right; padding: 10px; font-weight: bold;">Total Amount</td>
        <td style="text-align: right; padding: 10px; font-weight: bold;">${fmtQar(totalAmount)}</td>
      </tr>
    </tbody>
  </table>
  
  <!-- Summary Section -->
  <div class="summary-section">
    <div class="summary-row">
      <div style="text-align: right;">Total Amount</div>
      <div>${fmtQar(totalAmount)}</div>
    </div>
    <div class="summary-row">
      <div style="text-align: right;">Discount</div>
      <div>${fmtQar(discount)}</div>
    </div>
    <div class="summary-row">
      <div style="text-align: right;">Net Amount</div>
      <div>${fmtQar(netAmount)}</div>
    </div>
    <div class="summary-row">
      <div style="text-align: right;">Amount Paid</div>
      <div>${fmtQar(amountPaid)}</div>
    </div>
    <div class="summary-row">
      <div style="text-align: right; font-weight: bold; font-size: 13px;">Balance Due</div>
      <div style="font-weight: bold; font-size: 13px;">${fmtQar(balanceDue)}</div>
    </div>
  </div>
  
  <!-- Bottom Fields -->
  <div class="bottom-fields">
    <div class="bottom-field">
      <div class="bottom-label">Received By</div>
      <div class="bottom-value"></div>
    </div>
    <div class="bottom-field">
      <div class="bottom-label">Payment Method</div>
      <div class="bottom-value"></div>
    </div>
    <div class="bottom-field" style="grid-column: span 2;">
      <div class="bottom-label">Date & Time</div>
      <div class="bottom-value"></div>
    </div>
  </div>
  
  <!-- Footer -->
  <div class="invoice-footer">
    <div class="footer-text">
      <strong>RODEO DRIVE TRADING & SERVICES</strong><br>
      C.R. No: 122716<br>
      Location: Al Sayer, Doha<br>
      T: +974 44311871 | M: +974 3320 2409<br>
      E: info@rodeodrive.me | W: www.rodeodrive.me
    </div>
    <div class="footer-ar">
      <strong>رودeo درايف للتجارة والخدمات</strong><br>
      سجل تجاري: 122716<br>
      الموقع: السيار الدوحة<br>
      ت: +974 44311871 | م: +974 3320 2409<br>
      البريد الإلكتروني: info@rodeodrive.me | الموقع الإلكتروني: www.rodeodrive.me
    </div>
  </div>
</div>
</body>
</html>`;
  };

  const generateBill = async () => {
    if (!selectedOrder) return;
    if (isGeneratingBill) return;

    setIsGeneratingBill(true);
    try {
      const billing = selectedOrder?.billing ?? {};
      const billId = String(billing.billId || selectedOrder.id || "BILL");

      const docs: DocItem[] = Array.isArray(selectedOrder.documents) ? selectedOrder.documents : [];
      const existingBills = docs.filter((d) => String(d.type).toLowerCase() === "invoice/bill");

      const currDetails = {
        netAmount: toNum(billing.netAmount),
        amountPaid: toNum(billing.amountPaid),
        discount: toNum(billing.discount),
        balanceDue: toNum(billing.balanceDue),
      };

      const duplicate = existingBills.find((b) => b.billDetails && JSON.stringify(b.billDetails) === JSON.stringify(currDetails));
      if (duplicate) {
        setBillExistsMessage("Bill with the same payment details already exists in Documents.");
        setShowBillExistsPopup(true);
        return;
      }

      const html = generateBillHTML(selectedOrder);
      const blob = new Blob([html], { type: "text/html" });
      const key = `job-orders/${selectedOrder.id}/billing/Bill_${billId}_${Date.now()}.html`;

      await uploadData({ path: key, data: blob, options: { contentType: "text/html" } }).result;

      const actor = resolveActorUsername(currentUser, "user");

      const newDoc: DocItem = {
        id: `DOC-${Date.now()}`,
        name: `Bill_${billId}.html`,
        type: "Invoice/Bill",
        category: "Billing",
        addedAt: new Date().toISOString(),
        uploadedBy: actor,
        storagePath: key,
        billReference: billId,
        billDetails: currDetails,
      };

      const parsed = safeJsonParse<any>(selectedOrder?._parsed ?? selectedOrder?.dataJson, {});
      const updatedDocs = [...docs, newDoc];

      const updatedOrder = {
        ...selectedOrder,
        documents: updatedDocs,
        dataJson: JSON.stringify({ ...parsed, documents: updatedDocs }),
      };

      await upsertJobOrder(updatedOrder);

      setBillGeneratedMessage("Bill generated successfully and added to Documents.");
      setShowBillGeneratedPopup(true);

      invalidateDetailsCaches(String(selectedOrder?.id), String(selectedOrder?._backendId ?? ""));
      await refreshDetails();
    } catch (e) {
      setErrorMessage(`Bill generation failed: ${errMsg(e)}`);
      setShowErrorPopup(true);
    } finally {
      setIsGeneratingBill(false);
    }
  };

  // -------------------- UI helpers --------------------
  const workStatusClass = (status: string) => {
    switch (status) {
      case "New Request": return "pim-status-new-request";
      case "Inspection": return "pim-status-inspection";
      case "Service_Operation":
      case "Inprogress": return "pim-status-inprogress";
      case "Quality Check": return "pim-status-quality-check";
      case "Ready": return "pim-status-ready";
      case "Completed": return "pim-status-completed";
      case "Cancelled": return "pim-status-cancelled";
      default: return "pim-status-inprogress";
    }
  };

  const payStatusClass = (status: string) => {
    const s = String(status || "").toLowerCase();
    if (s.includes("fully paid")) return "pim-payment-full";
    if (s.includes("partially")) return "pim-payment-partial";
    if (s.includes("unpaid")) return "pim-payment-unpaid";
    if (s.includes("refunded")) return "pim-payment-refunded";
    return "pim-payment-unpaid";
  };

  const approvalStatusClass = (status: string) => {
    switch (String(status || "").toUpperCase()) {
      case "APPROVED": return "pim-approved";
      case "REJECTED": return "pim-declined";
      default: return "pim-pending";
    }
  };

  const invoiceStatusClass = (status: string) => {
    const s = String(status || "").toLowerCase();
    if (s.includes("paid")) return "pim-payment-full";
    if (s.includes("partial")) return "pim-payment-partial";
    return "pim-payment-unpaid";
  };

  // ===================== DETAILS SCREEN =====================
  if (showDetailsScreen && selectedOrder) {
    const isCancelled =
      String(selectedOrder?.workStatus || "").toLowerCase().includes("cancel") ||
      String(selectedOrder?._row?.status || "").toUpperCase() === "CANCELLED";

    const docs: DocItem[] = Array.isArray(selectedOrder.documents) ? selectedOrder.documents : [];
    const createdByDisplay = resolveOrderCreatedBy(selectedOrder, {
      identityToUsernameMap: userLabelMap,
      fallback: "—",
    });

    const paymentDiscountAllowance = paymentForm
      ? computeCumulativeDiscountAllowance({
          policyMaxPercent: centralDiscountPercent,
          baseAmount: paymentForm.totalAmount,
          existingDiscountAmount: Math.max(0, toNum(selectedOrder?.billing?.discount)),
          floorDiscountAmount: Math.max(0, paymentForm.discountFloor || 0),
        })
      : null;
    const maxDiscountQarUi = paymentDiscountAllowance?.maxAllowedTotalDiscountAmount ?? 0;
    const noRemainingDiscountAllowance = (paymentDiscountAllowance?.maxAdditionalDiscountAmount ?? 0) <= 0.00001;
    const summaryPaymentSnap = computePaymentSnapshot(
      toNum(selectedOrder?.billing?.totalAmount),
      toNum(selectedOrder?.billing?.discount),
      toNum(selectedOrder?.billing?.amountPaid)
    );
    const serviceAudit = buildPackageAuditBreakdown(Array.isArray(selectedOrder?.services) ? selectedOrder.services : []);
    const canRecordPayment = summaryPaymentSnap.balanceDue > 0.00001;

    return (
      <div className="pim-details-screen jo-details-v3">
        <div className="pim-details-header">
          <div className="pim-details-title-container">
            <h2><i className="fas fa-clipboard-list"></i> Job Order Details - {selectedOrder.id}</h2>
          </div>
          <button className="pim-btn-close-details" onClick={closeDetailsView} type="button">
            <i className="fas fa-times"></i> Close Details
          </button>
        </div>

        <div className="pim-details-body">
          <div className="pim-details-grid">
            <UnifiedJobOrderSummaryCard
              order={selectedOrder}
              className="jh-summary-card"
              identityToUsernameMap={userLabelMap}
              createdByOverride={createdByDisplay}
              paymentStatusOverride={selectedOrder?.paymentStatus}
            />

            <PermissionGate moduleId="payment" optionId="payment_customer">
              <UnifiedCustomerInfoCard order={selectedOrder} className="cv-unified-card" />
            </PermissionGate>

            <PermissionGate moduleId="payment" optionId="payment_vehicle">
              <UnifiedVehicleInfoCard order={selectedOrder} className="cv-unified-card" />
            </PermissionGate>

            <PermissionGate moduleId="payment" optionId="payment_services">
              {approvalRequests.length > 0 && (
                <div className="pim-card pim-detail-card pim-card-full">
                  <h3><i className="fas fa-user-check"></i> Service Approval Requests</h3>
                  <div className="pim-approvals">
                    {approvalRequests.map((r: any) => (
                      <div key={String(r.id)} className={`pim-approval ${approvalStatusClass(r.status)}`}>
                        <div className="pim-approval-top">
                          <div className="pim-approval-title">
                            {String(r.serviceName)} <span className="pim-approval-sub">({fmtQar(toNum(r.price))})</span>
                          </div>
                          <div className="pim-approval-status">{String(r.status)}</div>
                        </div>
                        <div className="pim-approval-meta">
                          <div><span>Requested by</span><strong>{displayUser(r.requestedBy)}</strong></div>
                          <div><span>Requested at</span><strong>{r.requestedAt ? new Date(String(r.requestedAt)).toLocaleString("en-GB") : "—"}</strong></div>
                          <div><span>Decided by</span><strong>{displayUser(r.decidedBy)}</strong></div>
                        </div>
                        {r.decisionNote ? <div className="pim-approval-note">{String(r.decisionNote)}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </PermissionGate>

            <PermissionGate moduleId="payment" optionId="payment_billing">
              <div className="pim-card pim-detail-card pim-card-full bi-unified-card">
                <div className="pim-card-head-row">
                  <h3><i className="fas fa-receipt"></i> Billing & Invoices</h3>
                  <div className="pim-actions">
                    <PermissionGate moduleId="payment" optionId="payment_pay">
                      <button className="pim-btn pim-btn-primary" type="button" onClick={openPaymentPopup} disabled={!canRecordPayment}>
                        <i className="fas fa-credit-card"></i> Payment
                      </button>
                    </PermissionGate>

                    <PermissionGate moduleId="payment" optionId="payment_refund">
                      {isCancelled && paymentRowsRaw.reduce((a, p) => a + toNum(p.amount), 0) > 0 && (
                        <button className="pim-btn pim-btn-warn" type="button" onClick={openRefundPopup}>
                          <i className="fas fa-undo"></i> Refund
                        </button>
                      )}
                    </PermissionGate>

                    <PermissionGate moduleId="payment" optionId="payment_generatebill">
                      <button className="pim-btn pim-btn-dark" type="button" onClick={generateBill} disabled={isGeneratingBill}>
                        <i className="fas fa-file-invoice-dollar"></i> {isGeneratingBill ? "Generating..." : "Generate Bill"}
                      </button>
                    </PermissionGate>
                  </div>
                </div>

                <div className="pim-billing-grid bi-summary">
                  <div className="pim-billing-item bi-row"><span className="bi-label">Bill ID</span><strong className="bi-value">{selectedOrder.billing?.billId || "—"}</strong></div>
                  <div className="pim-billing-item bi-row"><span className="bi-label">Total</span><strong className="bi-value">{selectedOrder.billing?.totalAmount || "—"}</strong></div>
                  <div className="pim-billing-item bi-row"><span className="bi-label">Discount</span><strong className="pim-green bi-value">{selectedOrder.billing?.discount || "—"}</strong></div>
                  <div className="pim-billing-item bi-row"><span className="bi-label">Net</span><strong className="bi-value">{selectedOrder.billing?.netAmount || "—"}</strong></div>
                  <div className="pim-billing-item bi-row"><span className="bi-label">Paid</span><strong className="pim-green bi-value">{selectedOrder.billing?.amountPaid || "—"}</strong></div>
                  <div className="pim-billing-item bi-row"><span className="bi-label">Balance Due</span><strong className="pim-red bi-value">{selectedOrder.billing?.balanceDue || "—"}</strong></div>
                </div>

                {(serviceAudit.packageLines.length > 0 || serviceAudit.standaloneCount > 0) && (
                  <div className="pim-subcard bi-package-audit-wrap">
                    <div className="pim-subtitle bi-package-audit-title">
                      <i className="fas fa-boxes"></i> Package Pricing Audit
                    </div>

                    <div className="bi-package-audit-table-wrap">
                      <table className="bi-package-audit-table">
                        <thead>
                          <tr>
                            <th>Package / Group</th>
                            <th style={{ textAlign: "center" }}>Included Services</th>
                            <th style={{ textAlign: "right" }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {serviceAudit.packageLines.map((line) => (
                            <tr key={line.key}>
                              <td>
                                <span className="bi-package-name"><i className="fas fa-box-open"></i> {line.title}</span>
                              </td>
                              <td style={{ textAlign: "center" }}>{line.itemCount}</td>
                              <td style={{ textAlign: "right", fontWeight: 900 }}>{fmtQar(line.total)}</td>
                            </tr>
                          ))}
                          {serviceAudit.standaloneCount > 0 && (
                            <tr>
                              <td>
                                <span className="bi-package-name"><i className="fas fa-tools"></i> Individual Services (Non-package)</span>
                              </td>
                              <td style={{ textAlign: "center" }}>{serviceAudit.standaloneCount}</td>
                              <td style={{ textAlign: "right", fontWeight: 900 }}>{fmtQar(serviceAudit.standaloneTotal)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <PermissionGate moduleId="payment" optionId="payment_invoices">
                  <div className="pim-subcard bi-invoices-wrap">
                    <div className="pim-subtitle bi-invoices-title">
                      <i className="fas fa-file-invoice"></i> Invoices ({normalizedInvoices.length})
                    </div>

                    {normalizedInvoices.length === 0 ? (
                      <div className="pim-empty-inline">No invoices found in normalized tables.</div>
                    ) : (
                      <div className="pim-invoices">
                        {normalizedInvoices.map((inv) => (
                          <div key={inv.id} className="pim-invoice bi-invoice-card">
                            <div className="pim-invoice-head">
                              <div className="pim-invoice-left">
                                <div className="pim-invoice-number">Invoice #{inv.number}</div>
                                {inv.createdAt ? (
                                  <div className="pim-invoice-date">
                                    {new Date(String(inv.createdAt)).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                  </div>
                                ) : null}
                              </div>
                              <div className="pim-invoice-right">
                                <div className="pim-invoice-amount">{fmtQar(inv.amount)}</div>
                                <span className={`pim-badge ${invoiceStatusClass(inv.status)}`}>{inv.status}</span>
                              </div>
                            </div>

                            <div className="pim-invoice-meta">
                              <div><span>Discount</span><strong>{fmtQar(inv.discount)}</strong></div>
                              <div><span>Payment Method</span><strong>{inv.paymentMethod || "—"}</strong></div>
                            </div>

                            <div className="pim-invoice-services">
                              <div className="pim-invoice-services-title">
                                <i className="fas fa-list-ul"></i> Services Included
                              </div>
                              {inv.services.length === 0 ? (
                                <div className="pim-empty-inline">No services linked to this invoice.</div>
                              ) : (
                                <ul className="pim-invoice-services-list">
                                  {inv.services.map((s, idx) => (
                                    <li key={idx}><i className="fas fa-check-circle"></i> {s}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </PermissionGate>

                <PermissionGate moduleId="payment" optionId="payment_paymentlog">
                  <div className="pim-subcard">
                    <div className="pim-subtitle"><i className="fas fa-history"></i> Payment Activity Log</div>

                    {Array.isArray(selectedOrder.paymentActivityLog) && selectedOrder.paymentActivityLog.length ? (
                      <div className="pim-table-wrap">
                        <table className="pim-table">
                          <thead>
                            <tr>
                              <th>Serial</th>
                              <th>Amount</th>
                              <th>Method</th>
                              <th>Cashier</th>
                              <th>Timestamp</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...selectedOrder.paymentActivityLog].reverse().map((p: PaymentLogUi, idx: number) => (
                              <tr key={idx}>
                                <td>{p.serial}</td>
                                <td>{p.amount}</td>
                                <td>{p.paymentMethod}</td>
                                <td>{displayUser(p.cashierName)}</td>
                                <td>{p.timestamp}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="pim-empty-inline">No payment activity yet.</div>
                    )}
                  </div>
                </PermissionGate>
              </div>
            </PermissionGate>

            <PermissionGate moduleId="payment" optionId="payment_documents">
              <div className="pim-card pim-detail-card pim-card-full">
                <h3><i className="fas fa-folder-open"></i> Documents</h3>

                {docs.length ? (
                  <div className="pim-docs">
                    {docs.map((doc, idx) => (
                      <div key={doc.id || idx} className="pim-doc">
                        <div className="pim-doc-left">
                          <div className="pim-doc-name">{doc.name}</div>
                          <div className="pim-doc-meta">
                            {doc.type}{doc.category ? ` • ${doc.category}` : ""}{doc.paymentReference ? ` • ${doc.paymentReference}` : ""}
                            {String(doc?.addedAt ?? (doc as any)?.generatedAt ?? (doc as any)?.createdAt ?? (doc as any)?.uploadedAt ?? (doc as any)?.timestamp ?? "").trim()
                              ? ` • Generated: ${String(doc?.addedAt ?? (doc as any)?.generatedAt ?? (doc as any)?.createdAt ?? (doc as any)?.uploadedAt ?? (doc as any)?.timestamp ?? "").trim()}`
                              : ""}
                          </div>
                        </div>

                        <PermissionGate moduleId="payment" optionId="payment_download">
                          <button
                            type="button"
                            className="pim-btn pim-btn-primary"
                            onClick={async () => {
                              const raw = String(doc.storagePath || doc.url || "");
                              const linkUrl = await resolveMaybeStorageUrl(raw);
                              if (!linkUrl) return;
                              window.open(linkUrl, "_blank", "noopener,noreferrer");
                            }}
                          >
                            <i className="fas fa-download"></i> Download
                          </button>
                        </PermissionGate>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="pim-empty-inline">No documents available.</div>
                )}
              </div>
            </PermissionGate>
          </div>
        </div>

        {createPortal(
          <>
            <ErrorPopup isVisible={showErrorPopup} onClose={() => setShowErrorPopup(false)} message={errorMessage} />
            <ErrorPopup isVisible={showBillExistsPopup} onClose={() => setShowBillExistsPopup(false)} message={billExistsMessage} />

            {showBillGeneratedPopup && (
              <SuccessPopup
                isVisible={true}
                onClose={() => setShowBillGeneratedPopup(false)}
                message={
                  <>
                    <span className="pim-pop-title"><i className="fas fa-file-invoice" /> Bill Generated</span>
                    <span className="pim-pop-text">{billGeneratedMessage}</span>
                  </>
                }
              />
            )}

            {showSuccessPopup && (
              <SuccessPopup isVisible={true} onClose={() => setShowSuccessPopup(false)} message={successMessage} />
            )}

            {showPaymentPopup && paymentForm && (
              <div className="pim-modal-overlay">
                <div className="pim-modal">
                  <div className="pim-modal-header">
                    <h3><i className="fas fa-credit-card"></i> Record Payment - {paymentForm.orderNumber}</h3>
                    <button type="button" className="pim-x" onClick={closePaymentPopup} aria-label="Close">✕</button>
                  </div>

                  <div className="pim-modal-body">
                    <div className="pim-kpis">
                      <div className="pim-kpi"><span>Net</span><strong>{fmtQar(paymentForm.netAmount)}</strong></div>
                      <div className="pim-kpi"><span>Paid</span><strong className="pim-green">{fmtQar(paymentForm.amountPaid)}</strong></div>
                      <div className="pim-kpi"><span>Balance</span><strong className="pim-red">{fmtQar(paymentForm.balance)}</strong></div>
                    </div>

                    <div className="pim-form">
                      <PermissionGate moduleId="joborder" optionId="joborder_discount_percent">
                        <div className="pim-field">
                          <label>Total Discount (QAR)</label>
                          <input
                            type="number"
                            name="discount"
                            value={paymentForm.discount}
                            onChange={handlePaymentChange}
                            min={0}
                            max={maxDiscountQarUi}
                            step={0.01}
                          />
                          <div className="pim-help">Max discount: {centralDiscountPercent}% ({fmtQar(maxDiscountQarUi)})</div>
                        </div>
                        <div className="pim-field">
                          <label>Total Discount (%)</label>
                          <input
                            type="number"
                            name="discountPercent"
                            value={paymentForm.discountPercent}
                            onChange={handlePaymentChange}
                            min={0}
                            max={centralDiscountPercent}
                            step={0.01}
                          />
                          <div className="pim-help">Changing either discount field updates the other automatically.</div>
                        </div>
                        {noRemainingDiscountAllowance ? (
                          <div className="pim-help" style={{ color: "#b91c1c", fontWeight: 600 }}>
                            {t("No additional discount can be applied. The order has already reached the role policy discount limit.")}
                          </div>
                        ) : null}
                      </PermissionGate>

                      <div className="pim-field">
                        <label>Amount to Pay (QAR) *</label>
                        <input type="number" name="amountToPay" value={paymentForm.amountToPay} onChange={handlePaymentChange} min={0} step={0.01} required />
                      </div>

                      <div className="pim-field">
                        <label>Payment Method *</label>
                        <select name="paymentMethod" value={paymentForm.paymentMethod} onChange={handlePaymentChange} required>
                          <option value="">Select</option>
                          <option value="Cash">Cash</option>
                          <option value="Card">Card</option>
                          <option value="Transfer">Transfer</option>
                        </select>
                      </div>

                      {paymentForm.paymentMethod === "Transfer" && (
                        <div className="pim-field">
                          <label>Upload Transfer Proof *</label>
                          <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleFileUpload} />
                          {paymentForm.transferProofName ? (
                            <div className="pim-file-ok"><i className="fas fa-check-circle"></i> {paymentForm.transferProofName}</div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pim-modal-actions">
                    <button className="pim-btn pim-btn-ghost" type="button" onClick={closePaymentPopup}>Cancel</button>
                    <button className="pim-btn pim-btn-success" type="button" onClick={handleSavePayment} disabled={loading}>
                      <i className="fas fa-check"></i> {loading ? "Saving..." : "Record Payment"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showRefundPopup && refundForm && (
              <div className="pim-modal-overlay">
                <div className="pim-modal">
                  <div className="pim-modal-header">
                    <h3><i className="fas fa-undo"></i> Process Refund - {refundForm.orderNumber}</h3>
                    <button type="button" className="pim-x" onClick={closeRefundPopup} aria-label="Close">✕</button>
                  </div>

                  <div className="pim-modal-body">
                    <div className="pim-kpis">
                      <div className="pim-kpi"><span>Max Refund</span><strong>{fmtQar(refundForm.maxRefundAmount)}</strong></div>
                      <div className="pim-kpi"><span>Refund Type</span><strong>{refundForm.refundType}</strong></div>
                    </div>

                    <div className="pim-form">
                      <div className="pim-field">
                        <label>Refund Type *</label>
                        <select name="refundType" value={refundForm.refundType} onChange={handleRefundChange}>
                          <option value="Full Refund">Full Refund</option>
                          <option value="Partial Refund">Partial Refund</option>
                        </select>
                      </div>

                      <div className="pim-field">
                        <label>Refund Amount (QAR) *</label>
                        <input
                          type="number"
                          name="refundAmount"
                          value={refundForm.refundAmount}
                          onChange={handleRefundChange}
                          min={0}
                          max={refundForm.maxRefundAmount}
                          step={0.01}
                          disabled={refundForm.refundType === "Full Refund"}
                        />
                        <div className="pim-help">Max: {fmtQar(refundForm.maxRefundAmount)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="pim-modal-actions">
                    <button className="pim-btn pim-btn-ghost" type="button" onClick={closeRefundPopup}>Cancel</button>
                    <button className="pim-btn pim-btn-warn" type="button" onClick={handleSaveRefund} disabled={loading}>
                      <i className="fas fa-check"></i> {loading ? "Saving..." : "Process Refund"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>,
          document.body
        )}
      </div>
    );
  }

  // ===================== LIST SCREEN =====================
  return (
    <div className="pim-root">
      <div className="pim-container">
        <header className="pim-header crm-unified-header">
          <div className="pim-header-left">
            <h1><i className="fas fa-file-invoice-dollar"></i> Payment & Invoice Management</h1>
          </div>
        </header>

        <section className="pim-search-section">
          <div className="pim-search-container">
            <i className="fas fa-search pim-search-icon"></i>
            <input
              type="text"
              className="pim-smart-search-input"
              placeholder="Search by any details"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="pim-search-stats">
            Showing unpaid/partially paid only • {filteredOrders.length} shown of {allOrders.length} total
          </div>
        </section>

        <section className="pim-results-section">
          <div className="pim-section-header">
            <h2><i className="fas fa-list"></i> Payment & Invoice Records</h2>
            <div className="pim-pagination-controls">
              <label htmlFor="pageSizeSelect">Records per page:</label>
              <select
                id="pageSizeSelect"
                className="pim-page-size-select"
                value={pageSize}
                onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              >
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>

          {paginatedData.length === 0 ? (
            <div className="pim-empty-state">
              <div className="pim-empty-icon"><i className="fas fa-search"></i></div>
              <div className="pim-empty-text">{loading ? "Loading..." : "No matching job orders found"}</div>
              <div className="pim-empty-subtext">Try adjusting your search terms.</div>
            </div>
          ) : (
            <>
              <div className="pim-table-wrapper">
                <table className="pim-job-order-table">
                  <thead>
                    <tr>
                      <th>Create Date</th>
                      <th>Job Card ID</th>
                      <th>Order Type</th>
                      <th>Customer Name</th>
                      <th>Mobile</th>
                      <th>Vehicle Plate</th>
                      <th>Work Status</th>
                      <th>Payment Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {paginatedData.map((order) => (
                      <tr key={order.id}>
                        <td className="pim-date-column">{order.createDate}</td>
                        <td className="pim-strong">{order.id}</td>
                        <td>{order.orderType}</td>
                        <td>{order.customerName}</td>
                        <td>{order.mobile}</td>
                        <td>{order.vehiclePlate}</td>
                        <td><span className={`pim-badge ${workStatusClass(order.workStatus)}`}>{order.workStatus}</span></td>
                        <td><span className={`pim-badge ${payStatusClass(order.paymentStatus)}`}>{order.paymentStatus}</span></td>
                        <td>
                          <PermissionGate moduleId="payment" optionId="payment_actions">
                            <div className="action-dropdown-container">
                              <button
                                type="button"
                                className={`btn-action-dropdown ${activeDropdown === order.id ? "active" : ""}`}
                                onClick={(e) => toggleActionDropdown(order.id, e.currentTarget as HTMLElement)}
                              >
                                <i className="fas fa-cogs"></i> Actions <i className="fas fa-chevron-down"></i>
                              </button>
                            </div>
                          </PermissionGate>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {typeof document !== "undefined" &&
                  createPortal(
                    <div
                      className={`action-dropdown-menu show action-dropdown-menu-fixed ${activeDropdown ? "open" : "closed"}`}
                      style={activeDropdown ? { top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` } : { top: "-9999px", left: "-9999px" }}
                    >
                      <PermissionGate moduleId="payment" optionId="payment_viewdetails">
                        <button
                          className="dropdown-item view"
                          onClick={() => {
                            if (!activeDropdown) return;
                            const target = activeDropdown;
                            activeDropdownRef.current = null;
                            setActiveDropdown(null);
                            void openDetailsView(target);
                          }}
                          type="button"
                        >
                          <i className="fas fa-eye"></i> View Details
                        </button>
                      </PermissionGate>

                      <PermissionGate moduleId="payment" optionId="payment_cancel">
                        <>
                          <div className="dropdown-divider"></div>
                          <button
                            className="dropdown-item delete"
                            onClick={() => {
                              if (!activeDropdown) return;
                              const target = activeDropdown;
                              activeDropdownRef.current = null;
                              setActiveDropdown(null);
                              handleShowCancelConfirmation(target);
                            }}
                            type="button"
                          >
                            <i className="fas fa-times-circle"></i> Cancel Order
                          </button>
                        </>
                      </PermissionGate>
                    </div>,
                    document.body
                  )}
              </div>

              {totalPages > 1 && (
                <div className="pim-pagination">
                  <button className="pim-pagination-btn" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} type="button">
                    <i className="fas fa-chevron-left"></i>
                  </button>

                  <div className="pim-page-numbers">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum: number;
                      if (totalPages <= 5) pageNum = i + 1;
                      else {
                        const start = Math.max(1, currentPage - 2);
                        const end = Math.min(totalPages, start + 4);
                        const adjustedStart = Math.max(1, end - 4);
                        pageNum = adjustedStart + i;
                      }
                      return (
                        <button
                          key={pageNum}
                          className={`pim-pagination-btn ${pageNum === currentPage ? "active" : ""}`}
                          onClick={() => setCurrentPage(pageNum)}
                          type="button"
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>

                  <button className="pim-pagination-btn" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} type="button">
                    <i className="fas fa-chevron-right"></i>
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <footer className="pim-footer">
          <p>Service Management System © 2023 | Payment & Invoice Management Module</p>
        </footer>

        <div className={`cancel-modal-overlay ${showCancelConfirmation && cancelOrderId ? "active" : ""}`}>
          <div className="cancel-modal">
            <div className="cancel-modal-header">
              <h3><i className="fas fa-exclamation-triangle"></i> Confirm Cancellation</h3>
            </div>
            <div className="cancel-modal-body">
              <div className="cancel-warning">
                <i className="fas fa-exclamation-circle"></i>
                <div className="cancel-warning-text">
                  <p>You are about to cancel order <strong>{cancelOrderId}</strong>.</p>
                  <p>This action cannot be undone.</p>
                </div>
              </div>
              <div className="cancel-modal-actions">
                <button
                  className="btn-cancel"
                  onClick={() => { setShowCancelConfirmation(false); setCancelOrderId(null); }}
                  type="button"
                >
                  <i className="fas fa-times"></i> Keep Order
                </button>
                <button className="btn-confirm-cancel" onClick={() => void handleCancelOrder()} disabled={loading} type="button">
                  <i className="fas fa-ban"></i> {loading ? "Cancelling..." : "Cancel Order"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {createPortal(
          <>
            <ErrorPopup isVisible={showErrorPopup} onClose={() => setShowErrorPopup(false)} message={errorMessage} />
            <ErrorPopup isVisible={showBillExistsPopup} onClose={() => setShowBillExistsPopup(false)} message={billExistsMessage} />
            {showBillGeneratedPopup && (
              <SuccessPopup
                isVisible={true}
                onClose={() => setShowBillGeneratedPopup(false)}
                message={
                  <>
                    <span className="pim-pop-title"><i className="fas fa-file-invoice" /> Bill Generated</span>
                    <span className="pim-pop-text">{billGeneratedMessage}</span>
                  </>
                }
              />
            )}
            {showSuccessPopup && <SuccessPopup isVisible={true} onClose={() => setShowSuccessPopup(false)} message={successMessage} />}
          </>,
          document.body
        )}
      </div>
    </div>
  );
}