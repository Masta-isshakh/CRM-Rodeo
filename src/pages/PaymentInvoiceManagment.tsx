import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import "./PaymentInvoiceManagment.css";

import SuccessPopup from "./SuccessPopup";
import ErrorPopup from "./ErrorPopup";
import PermissionGate from "./PermissionGate";

import { usePermissions } from "../lib/userPermissions";
import { getDataClient } from "../lib/amplifyClient";
import { getUserDirectory } from "../utils/userDirectoryCache";
import { resolveActorUsername } from "../utils/actorIdentity";

import {
  cancelJobOrderByOrderNumber,
  getJobOrderByOrderNumber,
  upsertJobOrder,
} from "./jobOrderRepo";

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

function normalizeIdentity(v: any) {
  return String(v ?? "").trim().toLowerCase();
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
      return "Inprogress";
    case "READY":
      return "Ready";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return "Inprogress";
  }
}

function normalizePaymentLabel(enumVal?: string, label?: string): string {
  const ps = String(enumVal || "").toUpperCase();
  if (ps === "PAID") return "Fully Paid";
  if (ps === "PARTIAL") return "Partially Paid";
  if (ps === "UNPAID") return "Unpaid";

  const l = String(label ?? "").trim();
  if (l) return l;

  return "Unpaid";
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
  amountToPay: string;
  paymentMethod: string;

  transferProofDataUrl: string | null;
  transferProofName: string;

  balance: number;
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

  _parsed: any;
};

function clampDiscountQar(totalAmount: number, discount: number, maxPct: number) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(maxPct) ? maxPct : 0));
  const maxQar = (Math.max(0, totalAmount) * pct) / 100;
  const d = Math.max(0, discount);
  return Math.min(d, Math.max(0, totalAmount), maxQar);
}

export default function PaymentInvoiceManagement({ currentUser }: { currentUser: any; permissions?: any }) {
  const client = useMemo(() => getDataClient(), []);
  const { getOptionNumber } = usePermissions();
  const [userLabelMap, setUserLabelMap] = useState<Record<string, string>>({});

  // ✅ numeric limit (percent)
  const maxPaymentDiscountPercent = useMemo(() => {
    const raw = Number(getOptionNumber("payment", "payment_discount_percent", 10));
    return Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 10));
  }, [getOptionNumber]);

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

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

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
    const raw = String(value ?? "").trim();
    if (!raw) return "—";
    return userLabelMap[normalizeIdentity(raw)] || raw;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const directory = await getUserDirectory(client);
        if (cancelled) return;

        const map: Record<string, string> = {};
        for (const u of directory.users ?? []) {
          const email = normalizeIdentity(u?.email);
          const name = String(u?.name ?? u?.email ?? "").trim();
          if (email && name) {
            map[email] = name;
          }
        }
        setUserLabelMap(map);
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
      if (!isDropdownButton && !isDropdownMenu) setActiveDropdown(null);
    };

    if (activeDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [activeDropdown]);

  // -------------------- live JobOrder list --------------------
  useEffect(() => {
    const sub = (client.models.JobOrder as any)
      .observeQuery({ limit: 2000 })
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
          const paymentStatus = normalizePaymentLabel(row.paymentStatus, row.paymentStatusLabel ?? parsed.paymentStatusLabel);

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

            paymentEnum: String(row.paymentStatus ?? ""),
            paymentStatus,

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

    const list = allOrders.filter((o) => {
      const isCancelled =
        String(o.statusEnum).toUpperCase() === "CANCELLED" ||
        String(o.workStatus).toLowerCase().includes("cancel");

      const payEnum = String(o.paymentEnum).toUpperCase();
      const payLabel = String(o.paymentStatus).toLowerCase();

      if (isCancelled) {
        return payEnum === "PAID" || payEnum === "PARTIAL" || payLabel.includes("fully paid") || payLabel.includes("partially");
      }

      return payEnum === "UNPAID" || payEnum === "PARTIAL" || payLabel.includes("unpaid") || payLabel.includes("partially");
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
    try {
      try {
        const byIdx = await (client.models.JobOrderPayment as any).listPaymentsByJobOrder?.({
          jobOrderId: String(jobOrderId),
          limit: 2000,
        });
        const rows = (byIdx?.data ?? []) as any[];
        return rows.map((p) => ({
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
      } catch {
        const res = await client.models.JobOrderPayment.list({
          limit: 2000,
          filter: { jobOrderId: { eq: String(jobOrderId) } } as any,
        });
        const rows = (res?.data ?? []) as any[];
        return rows.map((p) => ({
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
      }
    } catch {
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
      cashierName: String(p.createdBy ?? "System"),
      timestamp: p.paidAt
        ? new Date(String(p.paidAt)).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
        : (p.createdAt
            ? new Date(String(p.createdAt)).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : "—"),
      _raw: p,
    }));
  };

  const loadApprovalRequests = async (orderNumber: string) => {
    try {
      const res = await (client.models.ServiceApprovalRequest as any).serviceApprovalRequestsByOrderNumber({
        orderNumber: String(orderNumber),
        limit: 2000,
      });
      const rows = (res?.data ?? []) as any[];
      rows.sort((a, b) => String(b.requestedAt ?? b.createdAt ?? "").localeCompare(String(a.requestedAt ?? a.createdAt ?? "")));
      return rows;
    } catch {
      return [];
    }
  };

  const loadNormalizedInvoices = async (jobOrderId: string): Promise<InvoiceUi[]> => {
    const out: InvoiceUi[] = [];
    try {
      let invRows: any[] = [];

      try {
        const byIdx = await (client.models.JobOrderInvoice as any).listInvoicesByJobOrder?.({
          jobOrderId: String(jobOrderId),
          limit: 2000,
        });
        invRows = (byIdx?.data ?? []) as any[];
      } catch {
        const res = await client.models.JobOrderInvoice.list({
          limit: 2000,
          filter: { jobOrderId: { eq: String(jobOrderId) } } as any,
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
            limit: 2000,
          });
          svcRows = (byIdxSvc?.data ?? []) as any[];
        } catch {
          const resSvc = await client.models.JobOrderInvoiceService.list({
            limit: 2000,
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
    return out;
  };

  // -------------------- details open/close --------------------
  const openDetailsView = async (orderNumber: string) => {
    setLoading(true);
    try {
      const detailed = await getJobOrderByOrderNumber(orderNumber);
      if (!detailed?._backendId) throw new Error("Order not found in backend.");

      const rowRes = await client.models.JobOrder.get({ id: detailed._backendId } as any);
      const row = (rowRes as any)?.data ?? null;
      const parsed = safeJsonParse<any>(row?.dataJson, {});
      const docs: DocItem[] = Array.isArray(parsed?.documents)
        ? parsed.documents
        : (Array.isArray(detailed?.documents) ? detailed.documents : []);

      const payRows = await loadPaymentsRaw(String(detailed._backendId));
      setPaymentRowsRaw(payRows);
      const paymentActivityLog = mapPaymentLog(payRows);

      const approvals = await loadApprovalRequests(String(orderNumber));
      setApprovalRequests(approvals);

      const invoices = await loadNormalizedInvoices(String(detailed._backendId));
      setNormalizedInvoices(invoices);

      const totalAmount = toNum(row?.totalAmount ?? parsed?.billing?.totalAmount ?? detailed?.billing?.totalAmount);
      const discount = toNum(row?.discount ?? parsed?.billing?.discount ?? detailed?.billing?.discount);
      const netAmount = toNum(row?.netAmount ?? parsed?.billing?.netAmount ?? detailed?.billing?.netAmount ?? Math.max(0, totalAmount - discount));
      const amountPaid = toNum(row?.amountPaid ?? parsed?.billing?.amountPaid ?? detailed?.billing?.amountPaid);
      const balanceDue = toNum(row?.balanceDue ?? parsed?.billing?.balanceDue ?? detailed?.billing?.balanceDue ?? Math.max(0, netAmount - amountPaid));

      const billing = {
        billId: String(row?.billId ?? parsed?.billing?.billId ?? detailed?.billing?.billId ?? ""),
        totalAmount: fmtQar(totalAmount),
        discount: fmtQar(discount),
        netAmount: fmtQar(netAmount),
        amountPaid: fmtQar(amountPaid),
        balanceDue: fmtQar(balanceDue),
        paymentMethod: String(row?.paymentMethod ?? parsed?.billing?.paymentMethod ?? detailed?.billing?.paymentMethod ?? ""),
      };

      const merged = {
        ...detailed,
        _backendId: String(detailed._backendId),
        id: String(orderNumber),
        orderNumber: String(orderNumber),

        orderType: String(row?.orderType ?? detailed?.orderType ?? parsed?.orderType ?? "Job Order"),
        customerName: String(row?.customerName ?? detailed?.customerName ?? parsed?.customerName ?? ""),
        mobile: String(row?.customerPhone ?? detailed?.mobile ?? parsed?.customerPhone ?? ""),
        vehiclePlate: String(row?.plateNumber ?? detailed?.vehiclePlate ?? parsed?.plateNumber ?? ""),

        workStatus: normalizeWorkStatus(row?.status, row?.workStatusLabel ?? parsed?.workStatusLabel ?? detailed?.workStatus),
        paymentStatus: normalizePaymentLabel(row?.paymentStatus, row?.paymentStatusLabel ?? parsed?.paymentStatusLabel ?? detailed?.paymentStatus),

        billing,
        paymentActivityLog,
        documents: docs,

        _row: row,
        _parsed: parsed,
      };

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
    setShowDetailsScreen(false);
    setSelectedOrder(null);
    setNormalizedInvoices([]);
    setPaymentRowsRaw([]);
    setApprovalRequests([]);
  };

  const refreshDetails = async () => {
    if (!selectedOrder?.id) return;
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
    const rawDiscount = toNum(selectedOrder?.billing?.discount);
    const discount = clampDiscountQar(totalAmount, rawDiscount, maxPaymentDiscountPercent);

    const netAmount = toNum(selectedOrder?.billing?.netAmount) || Math.max(0, totalAmount - discount);
    const amountPaid = toNum(selectedOrder?.billing?.amountPaid);
    const balance = Math.max(0, netAmount - amountPaid);

    setPaymentForm({
      orderNumber: String(selectedOrder.id),
      jobOrderId: String(selectedOrder._backendId),
      totalAmount,
      netAmount,
      amountPaid,
      discount: String(discount.toFixed(2)),
      amountToPay: "",
      paymentMethod: String(selectedOrder?.billing?.paymentMethod || ""),
      transferProofDataUrl: null,
      transferProofName: "",
      balance,
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

      if (name === "discount" || name === "amountToPay") {
        const maxDiscountQar = (Math.max(0, prev.totalAmount) * maxPaymentDiscountPercent) / 100;

        let discount = Math.max(0, toNum(next.discount));
        discount = Math.min(discount, prev.totalAmount);
        discount = Math.min(discount, maxDiscountQar);

        next.discount = discount.toFixed(2);

        const amountToPay = Math.max(0, toNum(next.amountToPay));
        const net = Math.max(0, prev.totalAmount - discount);
        next.netAmount = net;

        const balance = net - prev.amountPaid - amountToPay;
        next.balance = balance > 0 ? balance : 0;
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
    const amountToPay = toNum(paymentForm.amountToPay);
    const rawDiscount = Math.max(0, toNum(paymentForm.discount));
    const discount = clampDiscountQar(paymentForm.totalAmount, rawDiscount, maxPaymentDiscountPercent);

    const maxDiscountQar = (Math.max(0, paymentForm.totalAmount) * maxPaymentDiscountPercent) / 100;
    if (rawDiscount > maxDiscountQar + 0.00001) {
      setErrorMessage(`Discount exceeds limit. Max allowed is ${fmtQar(maxDiscountQar)} (${maxPaymentDiscountPercent}%).`);
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

      const totalAmount = Math.max(0, toNum(selectedOrder?.billing?.totalAmount));
      const netAmount = Math.max(0, totalAmount - discount);

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
          paymentMethod: method,
        },
        dataJson: JSON.stringify({
          ...parsed,
          documents: updatedDocs,
          billing: {
            ...(parsed?.billing || {}),
            totalAmount,
            discount,
            netAmount,
            paymentMethod: method,
          },
          paymentStatusLabel: parsed?.paymentStatusLabel ?? selectedOrder?.paymentStatus ?? "Unpaid",
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

    const services: any[] = Array.isArray(order?.services) ? order.services : [];
    const serviceRows = services
      .map((s: any) => {
        const name = String(s?.name ?? s ?? "");
        const price = toNum(s?.price);
        return `<tr><td>${name}</td><td style="text-align:right">${price > 0 ? fmtQar(price) : "-"}</td></tr>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Bill_${billId}.html</title>
<style>
  body { font-family: 'Segoe UI', sans-serif; margin:0; padding:20mm; background:#f6f7fb; color:#0f172a; }
  * { box-sizing:border-box; }
  @page { size:A4; margin:0; }
  .hdr { text-align:center; margin-bottom:18px; padding:18px 10px; border-radius:12px; background:linear-gradient(135deg,#0f172a,#2563eb); color:white; }
  .hdr h1 { margin:0 0 6px 0; font-size:26px; }
  .hdr p { margin:0; opacity:.9; font-size:12px; }
  .card { background:white; border:1px solid #e7e8ee; border-radius:12px; padding:16px; margin-bottom:14px; box-shadow:0 10px 22px rgba(15,23,42,.08); }
  .ttl { margin:0 0 12px 0; font-size:14px; font-weight:800; border-bottom:1px solid #eef0f5; padding-bottom:10px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px 14px; font-size:12px; }
  .lbl { font-weight:800; color:#334155; display:block; margin-bottom:4px; }
  .val { color:#475569; }
  table { width:100%; border-collapse:collapse; margin-top:10px; }
  thead { background:#0f172a; color:white; }
  th, td { padding:10px 12px; font-size:12px; border-bottom:1px solid #eef0f5; }
  .sum { margin-top:10px; padding:12px; background:#f6f7fb; border:1px solid #e7e8ee; border-radius:10px; }
  .row { display:flex; justify-content:space-between; padding:6px 0; font-size:12px; }
  .grand { margin-top:10px; padding:12px; border-radius:10px; background:#2563eb; color:white; display:flex; justify-content:space-between; font-weight:900; }
  .ftr { margin-top:18px; text-align:center; font-size:11px; color:#64748b; }
</style>
</head>
<body>
  <div class="hdr">
    <h1>Bill / Invoice</h1>
    <p>Generated on ${now.toLocaleString()}</p>
  </div>

  <div class="card">
    <div class="ttl">Bill Information</div>
    <div class="grid">
      <div><span class="lbl">Bill ID</span><span class="val">${billId}</span></div>
      <div><span class="lbl">Job Order</span><span class="val">${order.id}</span></div>
      <div><span class="lbl">Order Type</span><span class="val">${String(order.orderType || "Job Order")}</span></div>
      <div><span class="lbl">Date</span><span class="val">${now.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" })}</span></div>
    </div>
  </div>

  <div class="card">
    <div class="ttl">Customer</div>
    <div class="grid">
      <div><span class="lbl">Name</span><span class="val">${String(order.customerName || "")}</span></div>
      <div><span class="lbl">Mobile</span><span class="val">${String(order.mobile || "")}</span></div>
      <div><span class="lbl">Email</span><span class="val">${String(order.customerDetails?.email || "N/A")}</span></div>
      <div><span class="lbl">Plate</span><span class="val">${String(order.vehiclePlate || order.vehicleDetails?.plateNumber || "N/A")}</span></div>
    </div>
  </div>

  ${services.length ? `
  <div class="card">
    <div class="ttl">Services</div>
    <table>
      <thead><tr><th>Service</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${serviceRows}</tbody>
    </table>
  </div>` : ""}

  <div class="card">
    <div class="ttl">Payment Summary</div>
    <div class="sum">
      <div class="row"><span>Total</span><strong>${billing.totalAmount || "—"}</strong></div>
      <div class="row"><span>Discount</span><strong>${billing.discount || "—"}</strong></div>
      <div class="row"><span>Net</span><strong>${billing.netAmount || "—"}</strong></div>
      <div class="row"><span>Paid</span><strong>${billing.amountPaid || "—"}</strong></div>
      <div class="grand"><span>Balance Due</span><span>${billing.balanceDue || "—"}</span></div>
    </div>
  </div>

  <div class="ftr">
    <div>Rodeo Drive CRM • This document is generated electronically.</div>
    <div>© ${now.getFullYear()} All rights reserved.</div>
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

    const maxDiscountQarUi = paymentForm
      ? (Math.max(0, paymentForm.totalAmount) * maxPaymentDiscountPercent) / 100
      : 0;

    return (
      <div className="pim-details-screen">
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
            <div className="pim-card">
              <h3><i className="fas fa-info-circle"></i> Job Order Summary</h3>
              <div className="pim-card-content">
                <div className="pim-info-row"><span className="pim-label">Job Order ID</span><span className="pim-value">{selectedOrder.id}</span></div>
                <div className="pim-info-row"><span className="pim-label">Order Type</span><span className="pim-value">{selectedOrder.orderType || "Job Order"}</span></div>
                <div className="pim-info-row"><span className="pim-label">Work Status</span><span className={`pim-badge ${workStatusClass(selectedOrder.workStatus)}`}>{selectedOrder.workStatus}</span></div>
                <div className="pim-info-row"><span className="pim-label">Payment Status</span><span className={`pim-badge ${payStatusClass(selectedOrder.paymentStatus)}`}>{selectedOrder.paymentStatus}</span></div>
              </div>
            </div>

            <PermissionGate moduleId="payment" optionId="payment_customer">
              <div className="pim-card">
                <h3><i className="fas fa-user"></i> Customer Information</h3>
                <div className="pim-card-content">
                  <div className="pim-info-row"><span className="pim-label">Name</span><span className="pim-value">{selectedOrder.customerName || "—"}</span></div>
                  <div className="pim-info-row"><span className="pim-label">Mobile</span><span className="pim-value">{selectedOrder.mobile || "—"}</span></div>
                  <div className="pim-info-row"><span className="pim-label">Email</span><span className="pim-value">{selectedOrder.customerDetails?.email || "—"}</span></div>
                </div>
              </div>
            </PermissionGate>

            <PermissionGate moduleId="payment" optionId="payment_vehicle">
              <div className="pim-card">
                <h3><i className="fas fa-car"></i> Vehicle Information</h3>
                <div className="pim-card-content">
                  <div className="pim-info-row">
                    <span className="pim-label">Make / Model</span>
                    <span className="pim-value">{selectedOrder.vehicleDetails?.make || "—"} {selectedOrder.vehicleDetails?.model || ""}</span>
                  </div>
                  <div className="pim-info-row"><span className="pim-label">Plate</span><span className="pim-value">{selectedOrder.vehicleDetails?.plateNumber || selectedOrder.vehiclePlate || "—"}</span></div>
                  <div className="pim-info-row"><span className="pim-label">Color</span><span className="pim-value">{selectedOrder.vehicleDetails?.color || "—"}</span></div>
                </div>
              </div>
            </PermissionGate>

            <PermissionGate moduleId="payment" optionId="payment_services">
              {approvalRequests.length > 0 && (
                <div className="pim-card pim-card-full">
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
              <div className="pim-card pim-card-full">
                <div className="pim-card-head-row">
                  <h3><i className="fas fa-receipt"></i> Billing & Invoices</h3>
                  <div className="pim-actions">
                    <PermissionGate moduleId="payment" optionId="payment_pay">
                      <button className="pim-btn pim-btn-primary" type="button" onClick={openPaymentPopup}>
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

                <div className="pim-billing-grid">
                  <div className="pim-billing-item"><span>Bill ID</span><strong>{selectedOrder.billing?.billId || "—"}</strong></div>
                  <div className="pim-billing-item"><span>Total</span><strong>{selectedOrder.billing?.totalAmount || "—"}</strong></div>
                  <div className="pim-billing-item"><span>Discount</span><strong className="pim-green">{selectedOrder.billing?.discount || "—"}</strong></div>
                  <div className="pim-billing-item"><span>Net</span><strong>{selectedOrder.billing?.netAmount || "—"}</strong></div>
                  <div className="pim-billing-item"><span>Paid</span><strong className="pim-green">{selectedOrder.billing?.amountPaid || "—"}</strong></div>
                  <div className="pim-billing-item"><span>Balance Due</span><strong className="pim-red">{selectedOrder.billing?.balanceDue || "—"}</strong></div>
                </div>

                <PermissionGate moduleId="payment" optionId="payment_invoices">
                  <div className="pim-subcard">
                    <div className="pim-subtitle">
                      <i className="fas fa-file-invoice"></i> Invoices ({normalizedInvoices.length})
                    </div>

                    {normalizedInvoices.length === 0 ? (
                      <div className="pim-empty-inline">No invoices found in normalized tables.</div>
                    ) : (
                      <div className="pim-invoices">
                        {normalizedInvoices.map((inv) => (
                          <div key={inv.id} className="pim-invoice">
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
                                <td>{p.cashierName}</td>
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
              <div className="pim-card pim-card-full">
                <h3><i className="fas fa-folder-open"></i> Documents</h3>

                {docs.length ? (
                  <div className="pim-docs">
                    {docs.map((doc, idx) => (
                      <div key={doc.id || idx} className="pim-doc">
                        <div className="pim-doc-left">
                          <div className="pim-doc-name">{doc.name}</div>
                          <div className="pim-doc-meta">
                            {doc.type}{doc.category ? ` • ${doc.category}` : ""}{doc.paymentReference ? ` • ${doc.paymentReference}` : ""}
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
                              const a = document.createElement("a");
                              a.href = linkUrl;
                              a.download = doc.name || "document";
                              a.click();
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
                      <PermissionGate moduleId="payment" optionId="payment_discountfield">
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
                          <div className="pim-help">Max discount: {maxPaymentDiscountPercent}% ({fmtQar(maxDiscountQarUi)})</div>
                        </div>
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
        <header className="pim-header">
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
            Showing payment records (Unpaid / Partially Paid; Cancelled only if Paid/Partial)
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
                                onClick={(e) => {
                                  const isActive = activeDropdown === order.id;
                                  if (isActive) {
                                    setActiveDropdown(null);
                                    return;
                                  }
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const menuHeight = 140;
                                  const menuWidth = 220;
                                  const spaceBelow = window.innerHeight - rect.bottom;
                                  const top = spaceBelow < menuHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
                                  const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
                                  setDropdownPosition({ top, left });
                                  setActiveDropdown(order.id);
                                }}
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

                {activeDropdown &&
                  typeof document !== "undefined" &&
                  createPortal(
                    <div
                      className="action-dropdown-menu show action-dropdown-menu-fixed"
                      style={{ top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` }}
                    >
                      <PermissionGate moduleId="payment" optionId="payment_viewdetails">
                        <button
                          className="dropdown-item view"
                          onClick={() => {
                            void openDetailsView(activeDropdown);
                            setActiveDropdown(null);
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
                            onClick={() => handleShowCancelConfirmation(activeDropdown)}
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