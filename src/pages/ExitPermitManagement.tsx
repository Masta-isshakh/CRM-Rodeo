// src/pages/ExitPermitManagement.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";

import "./ExitPermitManagement.css";
import "./JobOrderHistory.css";
import "./JobCards.css";

import SuccessPopup from "./SuccessPopup";
import ErrorPopup from "./ErrorPopup";
import UnifiedJobOrderRoadmap from "../components/UnifiedJobOrderRoadmap";
import { UnifiedCustomerInfoCard, UnifiedVehicleInfoCard } from "../components/UnifiedCustomerVehicleCards";
import { UnifiedJobOrderSummaryCard } from "../components/UnifiedJobOrderSummaryCard";
import UnifiedBillingInvoicesSection from "../components/UnifiedBillingInvoicesSection";

// ✅ Correct path (your PermissionGate lives here)
import PermissionGate from "./PermissionGate";

// ✅ Use your backend repo (no demo / no localStorage)
import {
  cancelJobOrderByOrderNumber,
  createExitPermitForOrderNumber,
  getJobOrderByOrderNumber,
  upsertJobOrder,
} from "./jobOrderRepo";
import { uploadData } from "aws-amplify/storage";

import { getDataClient } from "../lib/amplifyClient";
import { matchesSearchQuery, splitSearchTerms } from "../lib/searchUtils";
import { getUserDirectory } from "../utils/userDirectoryCache";
import { resolveActorUsername, resolveOrderCreatedBy } from "../utils/actorIdentity";
import {
  derivePaymentStatusFromFinancials,
  pickBillingFirstValue,
  pickPaymentEnum,
  pickPaymentLabel,
} from "../utils/paymentStatus";
import { useLanguage } from "../i18n/LanguageContext";

function safeLower(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function normalizeActorDisplay(value: any, fallback = "—") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  if (normalized === "system" || normalized === "system user" || normalized === "unknown" || normalized === "not assigned") {
    return fallback;
  }
  const at = raw.indexOf("@");
  if (at > 0) return raw.slice(0, at).toLowerCase();
  return raw;
}

function resolveActorName(user: any) {
  return resolveActorUsername(user, "system");
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

function errMsg(e: unknown) {
  const anyE = e as any;
  return String(anyE?.message ?? anyE?.errors?.[0]?.message ?? anyE ?? "Unknown error");
}

function safeFileName(name: string) {
  return String(name || "file")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "");
}

function generateExitPermitHTML(input: {
  permitId: string;
  orderNumber: string;
  customerName: string;
  mobile: string;
  vehiclePlate: string;
  workStatus: string;
  paymentStatus: string;
  collectedBy: string;
  collectedMobile: string;
  nextServiceDate?: string;
  createdBy: string;
  createdAtIso: string;
}) {
  const createdAt = new Date(input.createdAtIso);
  const createdAtText = createdAt.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>ExitPermit_${input.permitId}.html</title>
<style>
  body { font-family: 'Segoe UI', sans-serif; margin:0; padding:20mm; background:#f6f7fb; color:#0f172a; }
  * { box-sizing:border-box; }
  .hdr { text-align:center; margin-bottom:18px; padding:18px 10px; border-radius:12px; background:linear-gradient(135deg,#0f172a,#2563eb); color:white; }
  .hdr h1 { margin:0 0 6px 0; font-size:26px; }
  .hdr p { margin:0; opacity:.9; font-size:12px; }
  .card { background:white; border:1px solid #e7e8ee; border-radius:12px; padding:16px; margin-bottom:14px; box-shadow:0 10px 22px rgba(15,23,42,.08); }
  .ttl { margin:0 0 12px 0; font-size:14px; font-weight:800; border-bottom:1px solid #eef0f5; padding-bottom:10px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px 14px; font-size:12px; }
  .lbl { font-weight:800; color:#334155; display:block; margin-bottom:4px; }
  .val { color:#475569; }
</style>
</head>
<body>
  <div class="hdr">
    <h1>Exit Permit</h1>
    <p>Generated on ${createdAtText}</p>
  </div>

  <div class="card">
    <div class="ttl">Permit Information</div>
    <div class="grid">
      <div><span class="lbl">Permit ID</span><span class="val">${input.permitId}</span></div>
      <div><span class="lbl">Job Order ID</span><span class="val">${input.orderNumber}</span></div>
      <div><span class="lbl">Created By</span><span class="val">${input.createdBy || "—"}</span></div>
      <div><span class="lbl">Created At</span><span class="val">${createdAtText}</span></div>
    </div>
  </div>

  <div class="card">
    <div class="ttl">Customer & Vehicle</div>
    <div class="grid">
      <div><span class="lbl">Customer Name</span><span class="val">${input.customerName || "—"}</span></div>
      <div><span class="lbl">Mobile</span><span class="val">${input.mobile || "—"}</span></div>
      <div><span class="lbl">Vehicle Plate</span><span class="val">${input.vehiclePlate || "—"}</span></div>
      <div><span class="lbl">Work Status</span><span class="val">${input.workStatus || "—"}</span></div>
      <div><span class="lbl">Payment Status</span><span class="val">${input.paymentStatus || "—"}</span></div>
      <div><span class="lbl">Next Service Date</span><span class="val">${input.nextServiceDate || "N/A"}</span></div>
    </div>
  </div>

  <div class="card">
    <div class="ttl">Collection Details</div>
    <div class="grid">
      <div><span class="lbl">Collected By</span><span class="val">${input.collectedBy}</span></div>
      <div><span class="lbl">Collection Mobile</span><span class="val">${input.collectedMobile}</span></div>
    </div>
  </div>
</body>
</html>`;
}

function normalizeWorkLabel(statusEnum?: string, label?: string) {
  const l = String(label ?? "").trim();
  if (l) return l;

  switch (String(statusEnum ?? "").toUpperCase()) {
    case "READY":
      return "Ready";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    case "IN_PROGRESS":
      return "Service_Operation";
    case "OPEN":
      return "New Request";
    case "DRAFT":
      return "Draft";
    default:
      return "Service_Operation";
  }
}

/**
 * ✅ FIX (payment status):
 * - Prefer top-level JobOrder fields (paymentStatus/paymentStatusLabel) first.
 * - Fallback to parsed (dataJson) only when top-level values are unavailable.
 * - If labels/enums are missing, derive from totals/amountPaid/balanceDue.
 * - Keep "Fully Refunded" if label contains refund.
 */
function getParsedPaymentLabel(parsed: any) {
  const candidates = [
    parsed?.paymentStatusLabel,
    parsed?.paymentStatus,
    parsed?.billing?.paymentStatusLabel,
    parsed?.billing?.paymentStatus,
  ];
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (s) return s;
  }
  return "";
}

function derivePaymentStatusFromRow(row: any, parsed: any) {
  return derivePaymentStatusFromFinancials({
    paymentEnum: pickPaymentEnum(row, parsed),
    paymentLabel: pickPaymentLabel(row, parsed) ?? getParsedPaymentLabel(parsed),
    totalAmount: pickBillingFirstValue("totalAmount", row, parsed),
    discount: pickBillingFirstValue("discount", row, parsed),
    amountPaid: pickBillingFirstValue("amountPaid", row, parsed),
  });
}

function derivePaymentStatusFromUiOrder(order: any) {
  return derivePaymentStatusFromFinancials({
    paymentEnum: pickPaymentEnum(order),
    paymentLabel: pickPaymentLabel(order),
    totalAmount: pickBillingFirstValue("totalAmount", order),
    discount: pickBillingFirstValue("discount", order),
    amountPaid: pickBillingFirstValue("amountPaid", order),
  });
}

function isExitPermitCreatedFromParsed(parsed: any) {
  if (!parsed) return false;
  const topLevel = String(parsed.exitPermitStatus ?? "").trim().toLowerCase();
  if (topLevel === "created" || topLevel === "approved") return true;

  const nestedStatus = String(parsed?.exitPermit?.status ?? parsed?.exitPermitInfo?.status ?? "").trim().toLowerCase();
  if (nestedStatus === "created" || nestedStatus === "approved") return true;

  if (parsed.exitPermit?.permitId) return true;
  return false;
}

function isExitPermitCreatedFromRowOrParsed(row: any, parsed: any) {
  const schemaStatus = String(row?.exitPermitStatus ?? "").trim().toLowerCase();
  if (schemaStatus === "approved" || schemaStatus === "created") return true;
  return isExitPermitCreatedFromParsed(parsed);
}

function isExitPermitCreatedFromOrder(order: any) {
  if (!order) return false;
  const s = String(order.exitPermitStatus ?? "").trim().toLowerCase();
  if (s === "created" || s === "approved") return true;

  const nestedStatus = String(order?.exitPermit?.status ?? order?.exitPermitInfo?.status ?? "").trim().toLowerCase();
  if (nestedStatus === "created" || nestedStatus === "approved") return true;

  if (String(order.exitPermit?.permitId ?? "").trim()) return true;
  return false;
}

function mapExitPermitStatusToUi(status: any, hasPermitId = false) {
  const s = String(status ?? "").trim().toUpperCase();
  if (hasPermitId) return "Completed";
  if (s === "APPROVED" || s === "CREATED" || s === "COMPLETED") return "Completed";
  return "Not Created";
}

function deriveExitPermitStatusLabel(row: any, parsed: any) {
  const permitId = String(
    parsed?.exitPermit?.permitId ??
      parsed?.exitPermitInfo?.permitId ??
      row?.exitPermit?.permitId ??
      row?.exitPermitInfo?.permitId ??
      ""
  ).trim();
  const hasPermitId = Boolean(permitId);

  const fromSchema = String(row?.exitPermitStatus ?? "").trim();
  if (fromSchema) return mapExitPermitStatusToUi(fromSchema, hasPermitId);

  const fromTopLevelParsed = String(parsed?.exitPermitStatus ?? "").trim();
  if (fromTopLevelParsed) return mapExitPermitStatusToUi(fromTopLevelParsed, hasPermitId);

  const fromInfo = String(parsed?.exitPermitInfo?.status ?? row?.exitPermitInfo?.status ?? "").trim();
  if (fromInfo) return mapExitPermitStatusToUi(fromInfo, hasPermitId);

  const fromPermit = String(parsed?.exitPermit?.status ?? row?.exitPermit?.status ?? "").trim();
  if (fromPermit) return mapExitPermitStatusToUi(fromPermit, hasPermitId);

  return mapExitPermitStatusToUi("", hasPermitId);
}

function getExitPermitPaymentBadgeClass(status: any) {
  return getPermitHeaderBadgeClass(status);
}

function getPermitHeaderBadgeClass(status: any) {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "completed" || s === "created" || s === "approved") return "permit-completed";
  if (s === "not created") return "permit-pending";
  if (s === "pending") return "permit-pending";
  if (s === "rejected") return "permit-rejected";
  return "permit-not-required";
}

function isEligibleForExitPermit(workStatus: string, paymentStatus: string, created: boolean) {
  if (created) return false;

  const w = safeLower(workStatus);
  const p = safeLower(paymentStatus);

  const readyOk = w === "ready" && p === "fully paid";
  const cancelledOk = w === "cancelled" && (p === "unpaid" || p.includes("refund"));
  return readyOk || cancelledOk;
}

// --------- Documents: resolve storage path to URL (safe / no build-break) ----------
async function resolveDocUrlLocal(raw: string): Promise<string> {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:")) return s;

  try {
    const mod: any = await import("aws-amplify/storage");
    const getUrl = mod?.getUrl || mod?.getSignedUrl;
    if (!getUrl) return s;

    const res = await getUrl({ path: s });
    const url = res?.url?.toString?.() ?? res?.url ?? "";
    return String(url || s);
  } catch {
    return s;
  }
}

// Helper Functions for CSS classes
const getWorkStatusClass = (status: string) => {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "ready") return "status-ready";
  if (s === "completed") return "status-completed";
  if (s === "cancelled" || s === "canceled") return "status-cancelled";
  if (s === "quality check") return "status-quality-check";
  if (s === "inspection") return "status-inspection";
  return "status-inprogress";
};

const getServiceStatusClass = (status: string) => {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "completed") return "status-completed";
  if (s === "cancelled" || s === "canceled") return "status-cancelled";
  if (s === "quality check") return "status-quality-check";
  if (s === "service_operation" || s === "inprogress" || s === "in progress") return "status-inprogress";
  if (s === "inspection") return "status-inspection";
  if (s === "ready") return "status-ready";
  return "status-new-request";
};

const getAdditionalServiceStatusClass = (status: string) => {
  switch (status) {
    case "Pending Approval":
      return "epm-pending";
    case "Approved":
      return "epm-approved";
    case "Declined":
      return "epm-declined";
    default:
      return "epm-pending";
  }
};

function paymentBadgeClass(paymentStatus: string) {
  if (paymentStatus === "Fully Paid") return "payment-full";
  if (paymentStatus === "Partially Paid") return "payment-partial";
  if (/refund/i.test(paymentStatus)) return "payment-unpaid";
  return "payment-unpaid";
}

function getServiceSpecificationLabel(service: any) {
  const brand = String(service?.specificationBrandName ?? "").trim();
  const product = String(service?.specificationProductName ?? "").trim();
  const measurement = String(service?.specificationMeasurement ?? "").trim();
  if (brand && product && measurement) return `${brand} / ${product} / ${measurement}`;
  if (brand && product) return `${brand} / ${product}`;
  return brand || product || measurement || "";
}

function getServiceSpecificationColor(service: any) {
  return String(service?.specificationColorHex ?? "").trim();
}

// Exit Permit Management Component
const ExitPermitManagement = ({ currentUser }: { currentUser: any }) => {
  const client = useMemo(() => getDataClient(), []);
  const { t } = useLanguage();

  const [loading, setLoading] = useState(false);

  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [showDetailsScreen, setShowDetailsScreen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);

  const [showExitPermitModal, setShowExitPermitModal] = useState(false);
  const [currentOrderForPermit, setCurrentOrderForPermit] = useState<any | null>(null);
  const [exitPermitForm, setExitPermitForm] = useState({
    collectedBy: "",
    mobileNumber: "",
    nextServiceDate: "",
  });

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const activeDropdownRef = useRef<string | null>(null);
  const detailsCacheRef = useRef<Map<string, any>>(new Map());

  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);

  const [showSuccessPopup, setShowSuccessPopup] = useState(false);

  const [showErrorPopup, setShowErrorPopup] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [showExitPermitSuccessPopup, setShowExitPermitSuccessPopup] = useState(false);
  const [successPermitId, setSuccessPermitId] = useState("");
  const [successOrderId, setSuccessOrderId] = useState("");
  const [actorLabelMap, setActorLabelMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const directory = await getUserDirectory(client);
        if (cancelled) return;
        setActorLabelMap(directory.identityToUsernameMap ?? {});
      } catch {
        if (!cancelled) setActorLabelMap({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  // ✅ Live list from backend (JobOrder) => filtered to eligible only
  useEffect(() => {
    const sub = (client.models.JobOrder as any)
      .observeQuery({ limit: 500 })
      .subscribe(({ items }: any) => {
        const rows = (items ?? []) as any[];

        const mapped = rows
          .map((row) => {
            const parsed = safeJsonParse<any>(row.dataJson, {});
            const orderNumber = String(row.orderNumber ?? "").trim();
            if (!orderNumber) return null;

            const workStatus = normalizeWorkLabel(
              row.status,
              // ✅ prefer parsed label first (same stale-label problem can happen here too)
              String(parsed?.workStatusLabel ?? "").trim() || row.workStatusLabel
            );

            // ✅ FIX: derive payment status robustly
            const paymentStatus = derivePaymentStatusFromRow(row, parsed);

            const exitPermitStatus = deriveExitPermitStatusLabel(row, parsed);
            const created = ["completed", "created"].includes(String(exitPermitStatus).toLowerCase()) || isExitPermitCreatedFromRowOrParsed(row, parsed);
            const eligible = isEligibleForExitPermit(workStatus, paymentStatus, created);
            if (!eligible) return null;

            const createDate =
              String(parsed.createDate ?? "").trim() ||
              new Date(String(row.createdAt ?? Date.now())).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              });

            return {
              id: orderNumber, // UI orderNumber
              orderType: String(row.orderType ?? parsed.orderType ?? "Job Order"),
              customerName: String(row.customerName ?? parsed.customerName ?? ""),
              mobile: String(row.customerPhone ?? parsed.mobile ?? ""),
              vehiclePlate: String(row.plateNumber ?? parsed.vehiclePlate ?? ""),
              workStatus,
              paymentStatus,
              createDate,
              exitPermitStatus,
              _backendId: String(row.id),
            };
          })
          .filter(Boolean);

        mapped.sort((a: any, b: any) => String(b.createDate).localeCompare(String(a.createDate)));
        setAllOrders(mapped);
      });

    return () => sub.unsubscribe();
  }, [client]);

  // Click outside handler for dropdown
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
    const menuHeight = 160;
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

  // Smart search on current eligible list
  useEffect(() => {
    const q = safeLower(searchQuery);
    if (!q) {
      setSearchResults(allOrders);
      setCurrentPage(1);
      return;
    }

    const terms = splitSearchTerms(q);
    let res = [...allOrders];

    const matchesTerm = (order: any, term: string) => {
      return matchesSearchQuery(
        [
          order.id,
          order.orderType,
          order.customerName,
          order.mobile,
          order.vehiclePlate,
          order.workStatus,
          order.paymentStatus,
          order.createDate,
        ],
        term
      );
    };

    terms.forEach((term) => {
      if (term.startsWith("!")) {
        const ex = term.substring(1);
        if (ex) res = res.filter((o) => !matchesTerm(o, ex));
      } else {
        res = res.filter((o) => matchesTerm(o, term));
      }
    });

    setSearchResults(res);
    setCurrentPage(1);
  }, [searchQuery, allOrders]);

  const handlePageSizeChange = (e: any) => {
    setPageSize(parseInt(e.target.value, 10));
    setCurrentPage(1);
  };

  const openDetailsView = async (orderId: string) => {
    // Instant open from cache
    const cached = detailsCacheRef.current.get(orderId);
    if (cached) {
      flushSync(() => {
        setSelectedOrder(cached);
        setShowDetailsScreen(true);
      });
      return;
    }

    // Show stub immediately from list row
    const listRow = allOrders.find((o: any) => o.id === orderId);
    if (listRow) {
      flushSync(() => {
        setSelectedOrder({
          ...listRow,
          _backendId: String(listRow._backendId ?? ""),
          id: String(listRow.id ?? ""),
          documents: [],
          roadmap: [],
          services: [],
          customerDetails: null,
          vehicleDetails: null,
          _parsed: { roadmap: [], services: [], documents: [] },
        });
        setShowDetailsScreen(true);
      });
    }

    setLoading(true);
    try {
      const order = await getJobOrderByOrderNumber(orderId);
      if (!order) throw new Error(t("Order not found"));
      order.paymentStatus = derivePaymentStatusFromUiOrder(order);
      detailsCacheRef.current.set(orderId, order);
      flushSync(() => { setSelectedOrder(order); });
    } catch (e) {
      setErrorMessage(errMsg(e));
      setShowErrorPopup(true);
      if (!listRow) setShowDetailsScreen(false);
    } finally {
      setLoading(false);
    }
  };

  const closeDetailsView = () => {
    setShowDetailsScreen(false);
    setSelectedOrder(null);
  };

  const openExitPermitModal = async (orderId: string) => {
    // Show modal immediately with loading indicator, then validate & hydrate
    flushSync(() => {
      setCurrentOrderForPermit({ id: orderId, _loading: true });
      setExitPermitForm({ collectedBy: "", mobileNumber: "", nextServiceDate: "" });
      setShowExitPermitModal(true);
    });

    setLoading(true);
    try {
      const order = await getJobOrderByOrderNumber(orderId);
      if (!order) throw new Error(t("Order not found"));

      // ✅ FIX: normalize payment status before eligibility check
      order.paymentStatus = derivePaymentStatusFromUiOrder(order);

      const created = isExitPermitCreatedFromOrder(order);
      if (created) throw new Error(t("Exit permit already exists for this order."));

      const eligible = isEligibleForExitPermit(order.workStatus, order.paymentStatus, false);
      if (!eligible) throw new Error(t("This order is not eligible for Exit Permit."));

      const nextServiceDate = new Date();
      nextServiceDate.setMonth(nextServiceDate.getMonth() + 3);
      const formattedDate = nextServiceDate.toISOString().split("T")[0];

      setCurrentOrderForPermit(order);
      setExitPermitForm({
        collectedBy: order.customerName || "",
        mobileNumber: order.mobile || "",
        nextServiceDate: safeLower(order.workStatus) === "cancelled" ? "" : formattedDate,
      });
    } catch (e) {
      setErrorMessage(errMsg(e));
      setShowErrorPopup(true);
      setShowExitPermitModal(false);
      setCurrentOrderForPermit(null);
    } finally {
      setLoading(false);
    }
  };

  const closeExitPermitModal = () => {
    setShowExitPermitModal(false);
    setCurrentOrderForPermit(null);
    setExitPermitForm({ collectedBy: "", mobileNumber: "", nextServiceDate: "" });
  };

  const handleCancelOrder = async () => {
    if (!cancelOrderId) return;
    setLoading(true);
    try {
      await cancelJobOrderByOrderNumber(cancelOrderId);

      setShowCancelConfirmation(false);
      // ✅ keep cancelOrderId until popup closes so it displays correctly
      setShowSuccessPopup(true);

      if (selectedOrder?.id === cancelOrderId) {
        const reloaded = await getJobOrderByOrderNumber(cancelOrderId);
        if (reloaded) reloaded.paymentStatus = derivePaymentStatusFromUiOrder(reloaded);
        setSelectedOrder(reloaded);
      }
    } catch (e) {
      setErrorMessage(errMsg(e));
      setShowErrorPopup(true);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateExitPermit = async (e: any) => {
    e.preventDefault();
    if (!currentOrderForPermit) {
      setErrorMessage(t("No order selected for exit permit creation."));
      setShowErrorPopup(true);
      return;
    }

    const { collectedBy, mobileNumber, nextServiceDate } = exitPermitForm;

    if (!collectedBy.trim() || !mobileNumber.trim()) {
      setErrorMessage(t("Please fill in all required fields."));
      setShowErrorPopup(true);
      return;
    }

    if (safeLower(currentOrderForPermit.workStatus) !== "cancelled" && !nextServiceDate) {
      setErrorMessage(t("Please select a next service date."));
      setShowErrorPopup(true);
      return;
    }

    setLoading(true);
    try {
      const orderNumber = String(currentOrderForPermit.id);
      const actor = resolveActorName(currentUser);
      const createdAtIso = new Date().toISOString();

      const res = await createExitPermitForOrderNumber({
        orderNumber,
        collectedBy,
        mobileNumber,
        nextServiceDate: safeLower(currentOrderForPermit.workStatus) === "cancelled" ? undefined : nextServiceDate,
        actor,
      });

      const permitDocHtml = generateExitPermitHTML({
        permitId: String(res.permitId),
        orderNumber,
        customerName: String(currentOrderForPermit.customerName || ""),
        mobile: String(currentOrderForPermit.mobile || ""),
        vehiclePlate: String(currentOrderForPermit.vehiclePlate || ""),
        workStatus: String(currentOrderForPermit.workStatus || ""),
        paymentStatus: String(currentOrderForPermit.paymentStatus || ""),
        collectedBy,
        collectedMobile: mobileNumber,
        nextServiceDate: safeLower(currentOrderForPermit.workStatus) === "cancelled" ? undefined : nextServiceDate,
        createdBy: actor,
        createdAtIso,
      });

      const permitDocPath = `job-orders/${orderNumber}/exit-permits/ExitPermit_${safeFileName(String(res.permitId))}_${Date.now()}.html`;
      const permitDocBlob = new Blob([permitDocHtml], { type: "text/html" });
      await uploadData({ path: permitDocPath, data: permitDocBlob, options: { contentType: "text/html" } }).result;

      const latestOrder = await getJobOrderByOrderNumber(orderNumber);
      if (latestOrder) {
        const parsed = safeJsonParse<any>(latestOrder?._parsed ?? latestOrder?.dataJson, {});
        const existingDocs = Array.isArray(latestOrder?.documents)
          ? latestOrder.documents
          : Array.isArray(parsed?.documents)
            ? parsed.documents
            : [];

        const newPermitDoc = {
          id: `DOC-EXIT-${Date.now()}`,
          name: `ExitPermit_${String(res.permitId)}.html`,
          type: "Exit Permit",
          category: "Permit",
          addedAt: createdAtIso,
          uploadedBy: actor,
          storagePath: permitDocPath,
          permitReference: String(res.permitId),
          orderReference: orderNumber,
        };

        const updatedDocs = [...existingDocs, newPermitDoc];
        await upsertJobOrder({
          ...latestOrder,
          documents: updatedDocs,
          dataJson: JSON.stringify({
            ...parsed,
            documents: updatedDocs,
          }),
        });
      }

      setSuccessPermitId(res.permitId);
      setSuccessOrderId(res.orderNumber);
      setShowExitPermitSuccessPopup(true);
      closeExitPermitModal();

      if (selectedOrder?.id === orderNumber) {
        const reloaded = await getJobOrderByOrderNumber(orderNumber);
        if (reloaded) reloaded.paymentStatus = derivePaymentStatusFromUiOrder(reloaded);
        setSelectedOrder(reloaded);
      }
    } catch (e2) {
      setErrorMessage(errMsg(e2));
      setShowErrorPopup(true);
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(searchResults.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, searchResults.length);
  const pageData = searchResults.slice(startIndex, endIndex);

  return (
    <div className="epm-container">
      {!showDetailsScreen ? (
        <>
          <div className="epm-header crm-unified-header">
            <div className="epm-header-left">
              <h1>
                <i className="fas fa-id-card"></i> {t("Exit Permit Management")}
              </h1>
            </div>
          </div>

          <div className="epm-main-content">
            <section className="epm-search-section">
              <div className="epm-search-container">
                <i className="fas fa-search epm-search-icon"></i>
                <input
                  type="text"
                  className="epm-smart-search-input"
                  placeholder={t("Search by job order ID, customer name, vehicle plate, etc.")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="epm-search-stats">
                {searchResults.length === 0
                  ? loading
                    ? "Loading..."
                    : t("No eligible job orders found")
                  : `${t("Showing")} ${startIndex + 1}-${endIndex} ${t("of")} ${searchResults.length} ${t("job orders")}`}
              </div>
            </section>

            <section className="epm-results-section">
              <div className="epm-section-header">
                <h2>
                  <i className="fas fa-list"></i> {t("Exit Permit Management")}
                </h2>
                <div className="epm-section-header-controls">
                  <select className="epm-pagination-select" value={pageSize} onChange={handlePageSizeChange}>
                    <option value="20">20 {t("per page")}</option>
                    <option value="50">50 {t("per page")}</option>
                    <option value="100">100 {t("per page")}</option>
                  </select>
                </div>
              </div>

              {searchResults.length === 0 ? (
                <div className="epm-empty-state">
                  <div className="epm-empty-icon">
                    <i className="fas fa-search"></i>
                  </div>
                  <div className="epm-empty-text">{t("No eligible job orders found")}</div>
                  <div className="epm-empty-subtext">
                    {t("This screen displays only orders eligible for exit permit creation")}
                  </div>
                </div>
              ) : (
                <>
                  <div className="epm-table-wrapper">
                    <table className="epm-job-order-table">
                      <thead>
                        <tr>
                          <th>{t("Create Date")}</th>
                          <th>{t("Job Card ID")}</th>
                          <th>{t("Order Type")}</th>
                          <th>{t("Customer Name")}</th>
                          <th>{t("Mobile Number")}</th>
                          <th>{t("Vehicle Plate")}</th>
                          <th>{t("Work Status")}</th>
                          <th>{t("Payment Status")}</th>
                          <th>{t("Actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageData.map((order) => (
                          <tr key={order.id}>
                            <td className="epm-date-column">{order.createDate}</td>
                            <td>{order.id}</td>
                            <td>
                              <span
                                className={`epm-order-type-badge ${
                                  order.orderType === "New Job Order"
                                    ? "epm-order-type-new-job"
                                    : "epm-order-type-service"
                                }`}
                              >
                                {order.orderType}
                              </span>
                            </td>
                            <td>{order.customerName}</td>
                            <td>{order.mobile}</td>
                            <td>{order.vehiclePlate}</td>
                            <td>
                              <span className={`epm-status-badge ${getWorkStatusClass(order.workStatus)}`}>
                                {order.workStatus}
                              </span>
                            </td>
                            <td>
                              <span className={`epm-status-badge ${paymentBadgeClass(order.paymentStatus)}`}>
                                {order.paymentStatus}
                              </span>
                            </td>
                            <td>
                              <PermissionGate moduleId="exitpermit" optionId="exitpermit_actions">
                                <div className="action-dropdown-container">
                                  <button
                                    type="button"
                                    className={`btn-action-dropdown ${activeDropdown === order.id ? "active" : ""}`}
                                    onClick={(e) => {
                                      toggleActionDropdown(String(order.id), e.currentTarget as HTMLElement);
                                    }}
                                    disabled={loading}
                                  >
                                    <i className="fas fa-cogs"></i> {t("Actions")} <i className="fas fa-chevron-down"></i>
                                  </button>
                                </div>
                              </PermissionGate>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="epm-pagination">
                    <button
                      className="epm-pagination-btn"
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                      type="button"
                    >
                      <i className="fas fa-chevron-left"></i>
                    </button>
                    <div className="epm-page-numbers">
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
                            className={`epm-pagination-btn ${pageNum === currentPage ? "epm-active" : ""}`}
                            onClick={() => setCurrentPage(pageNum)}
                            type="button"
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      className="epm-pagination-btn"
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage === totalPages}
                      type="button"
                    >
                      <i className="fas fa-chevron-right"></i>
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>

          <div className="epm-footer">
            <p>{t("Service Management System © 2023 | Exit Permit Management Module")}</p>
          </div>
        </>
      ) : (
        <div className="epm-details-screen pim-details-screen jo-details-v3">
          <div className="epm-details-header pim-details-header">
            <div className="epm-details-title-container pim-details-title-container">
              <h2>
                <i className="fas fa-clipboard-list"></i> {t("Job Order Details")} - <span>{selectedOrder?.id}</span>
              </h2>
              <div className="pim-details-header-badges">
                {selectedOrder?.technicianAssignment?.name && (
                  <span className="pim-tech-badge">
                    <i className="fas fa-user-tie"></i> {selectedOrder.technicianAssignment.displayText}
                  </span>
                )}
              </div>
            </div>
            <button className="epm-btn-close-details pim-btn-close-details" onClick={closeDetailsView} type="button">
              <i className="fas fa-times"></i> {t("Close Details")}
            </button>
          </div>

          <div className="epm-details-body pim-details-body">
            <div className="epm-details-grid pim-details-grid">
              {selectedOrder && (
                <>
                  <PermissionGate moduleId="exitpermit" optionId="exitpermit_summary">
                    <JobOrderSummaryCard order={selectedOrder} identityToUsernameMap={actorLabelMap} />
                  </PermissionGate>

                  {selectedOrder.customerDetails && (
                    <PermissionGate moduleId="exitpermit" optionId="exitpermit_customer">
                      <CustomerDetailsCard order={selectedOrder} identityToUsernameMap={actorLabelMap} />
                    </PermissionGate>
                  )}

                  {selectedOrder.vehicleDetails && (
                    <PermissionGate moduleId="exitpermit" optionId="exitpermit_vehicle">
                      <VehicleDetailsCard order={selectedOrder} identityToUsernameMap={actorLabelMap} />
                    </PermissionGate>
                  )}

                  <PermissionGate moduleId="exitpermit" optionId="exitpermit_services">
                    <ServicesCard order={selectedOrder} />
                  </PermissionGate>

                  <PermissionGate moduleId="exitpermit" optionId="exitpermit_billing">
                    <BillingCard order={selectedOrder} />
                  </PermissionGate>

                  {selectedOrder.services && selectedOrder.services.length > 0 && (
                    <PermissionGate moduleId="exitpermit" optionId="exitpermit_quality">
                      <QualityCheckListCard order={selectedOrder} />
                    </PermissionGate>
                  )}

                  <PermissionGate moduleId="exitpermit" optionId="exitpermit_exitpermit">
                    <ExitPermitCard order={selectedOrder} />
                  </PermissionGate>

                  {selectedOrder.customerNotes && (
                    <PermissionGate moduleId="exitpermit" optionId="exitpermit_notes">
                      <CustomerNotesCard order={selectedOrder} />
                    </PermissionGate>
                  )}

                  <PermissionGate moduleId="exitpermit" optionId="exitpermit_services">
                    {selectedOrder.additionalServiceRequests &&
                      selectedOrder.additionalServiceRequests.map((request: any, idx: number) => (
                        <AdditionalServicesRequestCard key={idx} request={request} index={idx + 1} />
                      ))}
                  </PermissionGate>
                </>
              )}
            </div>

            {selectedOrder?.roadmap && selectedOrder.roadmap.length > 0 && (
              <PermissionGate moduleId="exitpermit" optionId="exitpermit_roadmap">
                <UnifiedJobOrderRoadmap order={selectedOrder} />
              </PermissionGate>
            )}

            <PermissionGate moduleId="exitpermit" optionId="exitpermit_documents">
              <DocumentsCard order={selectedOrder} />
            </PermissionGate>
          </div>
        </div>
      )}

      {/* Exit Permit Modal */}
      {showExitPermitModal && (
        <div className="epm-exit-permit-modal">
          <div className="epm-exit-permit-modal-content">
            <h3>
              <i className="fas fa-id-card"></i> {t("Create Exit Permit")}
            </h3>
            <form onSubmit={handleCreateExitPermit}>
              <div className="epm-form-group">
                <label>
                  {t("Collected By")} <span className="epm-required">*</span>
                </label>
                <input
                  type="text"
                  value={exitPermitForm.collectedBy}
                  onChange={(e) => setExitPermitForm({ ...exitPermitForm, collectedBy: e.target.value })}
                  placeholder={t("Enter name of person collecting the vehicle")}
                  required
                />
              </div>
              <div className="epm-form-group">
                <label>
                  {t("Mobile Number")} <span className="epm-required">*</span>
                </label>
                <input
                  type="tel"
                  value={exitPermitForm.mobileNumber}
                  onChange={(e) => setExitPermitForm({ ...exitPermitForm, mobileNumber: e.target.value })}
                  placeholder={t("Enter mobile number")}
                  required
                />
              </div>
              <div className="epm-form-group">
                <label>
                  {t("Next Service Date")}{" "}
                  {safeLower(currentOrderForPermit?.workStatus) !== "cancelled" && <span className="epm-required">*</span>}
                </label>
                <input
                  type="date"
                  value={exitPermitForm.nextServiceDate}
                  onChange={(e) => setExitPermitForm({ ...exitPermitForm, nextServiceDate: e.target.value })}
                  required={safeLower(currentOrderForPermit?.workStatus) !== "cancelled"}
                  min={new Date().toISOString().split("T")[0]}
                />
              </div>

              <div className="epm-exit-permit-modal-actions">
                <button type="button" className="epm-btn-cancel-permit" onClick={closeExitPermitModal} disabled={loading}>
                  {t("Cancel")}
                </button>
                <button type="submit" className="epm-btn-create-permit" disabled={loading}>
                  <i className="fas fa-check-circle"></i> {loading ? t("Creating...") : t("Create Exit Permit")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Action Dropdown Menu Portal */}
      {typeof document !== "undefined" &&
        createPortal(
          <div
            className={`action-dropdown-menu show action-dropdown-menu-fixed ${activeDropdown ? "open" : "closed"}`}
            style={
              activeDropdown
                ? { top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` }
                : { top: "-9999px", left: "-9999px" }
            }
          >
            <PermissionGate moduleId="exitpermit" optionId="exitpermit_viewdetails">
              <button
                className="dropdown-item view"
                type="button"
                onClick={() => {
                  if (!activeDropdown) return;
                  void openDetailsView(activeDropdown);
                  activeDropdownRef.current = null;
                  setActiveDropdown(null);
                }}
                disabled={loading}
              >
                <i className="fas fa-eye"></i> {t("View Details")}
              </button>
            </PermissionGate>

            <PermissionGate moduleId="exitpermit" optionId="exitpermit_create">
              <>
                <div className="dropdown-divider"></div>
                <button
                  className="dropdown-item create-permit"
                  type="button"
                  onClick={() => {
                    if (!activeDropdown) return;
                    void openExitPermitModal(activeDropdown);
                    activeDropdownRef.current = null;
                    setActiveDropdown(null);
                  }}
                  disabled={loading}
                >
                  <i className="fas fa-id-card"></i> {t("Create Exit Permit")}
                </button>
              </>
            </PermissionGate>

            <PermissionGate moduleId="exitpermit" optionId="exitpermit_cancelorder">
              <>
                <div className="dropdown-divider"></div>
                <button
                  className="dropdown-item delete"
                  type="button"
                  onClick={() => {
                    if (!activeDropdown) return;
                    setCancelOrderId(activeDropdown);
                    setShowCancelConfirmation(true);
                    activeDropdownRef.current = null;
                    setActiveDropdown(null);
                  }}
                  disabled={loading}
                >
                  <i className="fas fa-times-circle"></i> {t("Cancel Order")}
                </button>
              </>
            </PermissionGate>
          </div>,
          document.body
        )}

      {/* Cancel Confirmation Modal */}
      <div className={`cancel-modal-overlay ${showCancelConfirmation && cancelOrderId ? "active" : ""}`}>
        <div className="cancel-modal">
          <div className="cancel-modal-header">
            <h3>
                <i className="fas fa-exclamation-triangle"></i> {t("Confirm Cancellation")}
            </h3>
          </div>
          <div className="cancel-modal-body">
            <div className="cancel-warning">
              <i className="fas fa-exclamation-circle"></i>
              <div className="cancel-warning-text">
                <p>
                  {t("You are about to cancel order")} <strong>{cancelOrderId}</strong>.
                </p>
                <p>{t("This action cannot be undone.")}</p>
              </div>
            </div>
            <div className="cancel-modal-actions">
              <button
                className="btn-cancel"
                type="button"
                onClick={() => {
                  setShowCancelConfirmation(false);
                  setCancelOrderId(null);
                }}
                disabled={loading}
              >
                <i className="fas fa-times"></i> {t("Keep Order")}
              </button>
              <button className="btn-confirm-cancel" type="button" onClick={() => void handleCancelOrder()} disabled={loading}>
                <i className="fas fa-ban"></i> {loading ? t("Cancelling...") : t("Cancel Order")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Success Popup for Cancel Order */}
      {showSuccessPopup && (
        <SuccessPopup
          isVisible={true}
          onClose={() => {
            setShowSuccessPopup(false);
            setCancelOrderId(null);
          }}
          message={
            <>
              <span className="epm-popup-title">
                <i className="fas fa-check-circle"></i> {t("Order Cancelled Successfully!")}
              </span>
              <span className="epm-popup-line">
                <strong>{t("Job Order ID:")}</strong> <span className="epm-popup-id">{cancelOrderId}</span>
              </span>
            </>
          }
        />
      )}

      {/* Success Popup for Exit Permit Creation */}
      {showExitPermitSuccessPopup && (
        <SuccessPopup
          isVisible={true}
          onClose={() => {
            setShowExitPermitSuccessPopup(false);
            setSuccessPermitId("");
            setSuccessOrderId("");
          }}
          message={
            <>
              <span className="epm-popup-title">
                <i className="fas fa-check-circle"></i> {t("Exit Permit Created Successfully!")}
              </span>
              <span className="epm-popup-line">
                <strong>{t("Permit ID:")}</strong> <span className="epm-popup-id">{successPermitId}</span>
              </span>
              <span className="epm-popup-line">
                <strong>{t("Job Order ID:")}</strong> <span className="epm-popup-id">{successOrderId}</span>
              </span>
            </>
          }
        />
      )}

      {/* Error Popup */}
      {showErrorPopup && <ErrorPopup isVisible={true} onClose={() => setShowErrorPopup(false)} message={errorMessage} />}
    </div>
  );
};

/* -------------------- Cards -------------------- */

const JobOrderSummaryCard = ({ order, identityToUsernameMap }: any) => {
  const createdByDisplay = resolveOrderCreatedBy(order, {
    identityToUsernameMap,
    fallback: "—",
  });
  return <UnifiedJobOrderSummaryCard order={order} className="jh-summary-card" identityToUsernameMap={identityToUsernameMap} createdByOverride={createdByDisplay} />;
};

const CustomerDetailsCard = ({ order }: any) => <UnifiedCustomerInfoCard order={order} className="cv-unified-card" />;

const VehicleDetailsCard = ({ order }: any) => <UnifiedVehicleInfoCard order={order} className="cv-unified-card" />;

const DocumentsCard = ({ order }: any) => {
  const { t } = useLanguage();
  const documents = Array.isArray(order.documents) ? order.documents : [];
  if (documents.length === 0) return null;

  return (
    <div className="epm-detail-card pim-detail-card">
      <h3>
        <i className="fas fa-folder-open"></i> {t("Documents")}
      </h3>
      <div className="epm-docs">
        {documents.map((doc: any, idx: number) => (
          <div key={doc.id || idx} className="epm-doc-item">
            <div className="epm-doc-left">
              <div className="epm-doc-name">{doc.name || doc.title || `${t("Document")} ${idx + 1}`}</div>
              <div className="epm-doc-meta">
                {doc.type || ""} {doc.category ? `• ${doc.category}` : ""}
                {String(doc?.addedAt ?? doc?.generatedAt ?? doc?.createdAt ?? doc?.uploadedAt ?? doc?.timestamp ?? "").trim()
                  ? ` • ${t("Generated:")} ${String(doc?.addedAt ?? doc?.generatedAt ?? doc?.createdAt ?? doc?.uploadedAt ?? doc?.timestamp ?? "").trim()}`
                  : ""}
              </div>
            </div>

            <PermissionGate moduleId="exitpermit" optionId="exitpermit_download">
              <button
                type="button"
                className="epm-doc-download"
                onClick={async () => {
                  const raw = String(doc.storagePath || doc.url || doc.fileData || "");
                  const url = await resolveDocUrlLocal(raw);
                  if (!url) return;
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
              >
                <i className="fas fa-download"></i> {t("Download")}
              </button>
            </PermissionGate>
          </div>
        ))}
      </div>
    </div>
  );
};

const ServicesCard = ({ order }: any) => {
  const { t } = useLanguage();
  return (
    <div className="epm-detail-card pim-detail-card">
      <h3>
        <i className="fas fa-tasks"></i> {t("Services Summary")} ({order.services?.length || 0})
      </h3>
      <div className="epm-services-list pim-services-list">
        {order.services && order.services.length > 0 ? (
          order.services.map((service: any, idx: number) => (
            <div key={idx} className="epm-service-item pim-service-item">
              <div className="epm-service-header pim-service-header">
                <span className="epm-service-name pim-service-name">{service.name}</span>
                <span className={`epm-status-badge status-badge ${getServiceStatusClass(service.status)}`}>{service.status}</span>
              </div>
              {getServiceSpecificationLabel(service) ? (
                <div className="pim-service-meta" style={{ marginTop: 8 }}>
                  <div className="pim-service-meta-row" style={{ gridColumn: "span 2" }}>
                    <span className="pim-service-meta-label">Specification:</span>
                    <span className="pim-service-meta-value" data-no-translate="true" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      {getServiceSpecificationColor(service) ? (
                        <span
                          aria-hidden="true"
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: getServiceSpecificationColor(service),
                            border: "1px solid rgba(15, 23, 42, 0.14)",
                            display: "inline-block",
                          }}
                        ></span>
                      ) : null}
                      {getServiceSpecificationLabel(service)}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="epm-service-item pim-service-item">
            <em>{t("No services recorded")}</em>
          </div>
        )}
      </div>
    </div>
  );
};

const AdditionalServicesRequestCard = ({ request, index }: any) => {
  const { t } = useLanguage();
  const statusClass = getAdditionalServiceStatusClass(request.status);
  return (
    <div className={`epm-additional-services epm-${statusClass}`}>
      <div className="epm-additional-header">{t("Additional Services Request")} {index > 1 ? `#${index}` : ""}</div>
      <div className="epm-card-body">
        <div className="epm-info-item pim-info-item">
          <div className="epm-info-label pim-info-label">{t("Request ID")}</div>
          <div className="epm-info-value pim-info-value">{request.requestId}</div>
        </div>
        <div className="epm-info-item pim-info-item">
          <div className="epm-info-label pim-info-label">{t("Requested Service")}</div>
          <div className="epm-info-value pim-info-value">{request.requestedService}</div>
        </div>
        <div className="epm-info-item pim-info-item">
          <div className="epm-info-label pim-info-label">{t("Status")}</div>
          <div className="epm-info-value pim-info-value">{request.status}</div>
        </div>
      </div>
    </div>
  );
};

const CustomerNotesCard = ({ order }: any) => {
  const { t } = useLanguage();
  return (
    <div className="epm-detail-card pim-detail-card">
      <h3>
        <i className="fas fa-sticky-note"></i> {t("Customer Notes / Comments")}
      </h3>
      <div className="epm-card-content pim-card-content">
        <div className="epm-notes-box">{order.customerNotes}</div>
      </div>
    </div>
  );
};

const BillingCard = ({ order }: any) => {
  return <UnifiedBillingInvoicesSection order={order} className="epm-detail-card" />;
};

const ExitPermitCard = ({ order }: any) => {
  const { t } = useLanguage();
  const permit = order?.exitPermit ?? {};
  const permitInfo = order?.exitPermitInfo ?? {};

  const firstNonEmpty = (...values: any[]) => {
    for (const value of values) {
      const out = String(value ?? "").trim();
      if (out) return out;
    }
    return "";
  };

  const permitId = firstNonEmpty(permit?.permitId, permitInfo?.permitId) || "—";
  const createDate = firstNonEmpty(permit?.createDate, permitInfo?.createDate, order?.exitPermitDate) || "—";
  const nextServiceDate = firstNonEmpty(permit?.nextServiceDate, permitInfo?.nextServiceDate, order?.nextServiceDate) || "—";
  const createdBy = normalizeActorDisplay(
    firstNonEmpty(permit?.createdBy, permitInfo?.createdBy, permitInfo?.actionBy),
    "—"
  );
  const collectedBy = firstNonEmpty(permit?.collectedBy, permitInfo?.collectedBy) || "—";
  const collectedByMobile = firstNonEmpty(permit?.collectedByMobile, permitInfo?.collectedByMobile, permitInfo?.mobileNumber) || "—";
  const status = mapExitPermitStatusToUi(
    order?.exitPermitStatus ?? permit?.status ?? permitInfo?.status,
    Boolean(firstNonEmpty(permit?.permitId, permitInfo?.permitId))
  );

  return (
    <div className="epm-detail-card pim-detail-card ex-unified-card">
      <h3>
        <i className="fas fa-id-card"></i> {t("Exit Permit")}
      </h3>
      <div className="epm-card-content pim-card-content ex-unified-grid">
        <div className="epm-info-item pim-info-item">
          <span className="epm-info-label pim-info-label">{t("Status")}</span>
          <span className="epm-info-value pim-info-value">
            <span className={`epm-status-badge status-badge ${getExitPermitPaymentBadgeClass(status)}`}>
              {status}
            </span>
          </span>
        </div>
        <div className="epm-info-item pim-info-item">
          <span className="epm-info-label pim-info-label">{t("Permit ID")}</span>
          <span className="epm-info-value pim-info-value">{permitId}</span>
        </div>
        <div className="epm-info-item pim-info-item">
          <span className="epm-info-label pim-info-label">{t("Create Date")}</span>
          <span className="epm-info-value pim-info-value">{createDate}</span>
        </div>
        <div className="epm-info-item pim-info-item">
          <span className="epm-info-label pim-info-label">{t("Next Service Date")}</span>
          <span className="epm-info-value pim-info-value">{nextServiceDate}</span>
        </div>
        <div className="epm-info-item pim-info-item">
          <span className="epm-info-label pim-info-label">{t("Created By")}</span>
          <span className="epm-info-value pim-info-value">{createdBy}</span>
        </div>
        <div className="epm-info-item pim-info-item">
          <span className="epm-info-label pim-info-label">{t("Collected By")}</span>
          <span className="epm-info-value pim-info-value">{collectedBy}</span>
        </div>
        <div className="epm-info-item pim-info-item">
          <span className="epm-info-label pim-info-label">{t("Mobile Number")}</span>
          <span className="epm-info-value pim-info-value">{collectedByMobile}</span>
        </div>
      </div>
    </div>
  );
};

const QualityCheckListCard = ({ order }: any) => {
  const { t } = useLanguage();
  const services = order.services || [];

  const getQualityCheckResult = (service: any) => {
    if (service && typeof service === "object") {
      return service.qualityCheckResult || service.qcResult || service.qcStatus || service.qualityStatus || null;
    }
    return null;
  };

  return (
    <div className="epm-detail-card pim-detail-card epm-qc-card">
      <h3>
        <i className="fas fa-clipboard-check"></i> {t("Quality Check List")}
      </h3>
      <div className="epm-qc-list">
        {services.length > 0 ? (
          services.map((service: any, idx: number) => {
            const serviceName = typeof service === "string" ? service : service.name;
            const result = getQualityCheckResult(service) || t("Not Evaluated");
            return (
              <div key={`${serviceName}-${idx}`} className="epm-qc-row">
                <span className="epm-qc-name">{serviceName}</span>
                <span className={`epm-qc-badge epm-qc-${safeLower(result).replace(/\s+/g, "-")}`}>{result}</span>
              </div>
            );
          })
        ) : (
          <div className="epm-qc-empty">{t("No services to evaluate")}</div>
        )}
      </div>
    </div>
  );
};

export default ExitPermitManagement;