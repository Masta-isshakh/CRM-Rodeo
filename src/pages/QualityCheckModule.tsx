// src/pages/QualityCheckModule.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";

import SuccessPopup from "./SuccessPopup";
import ConfirmationPopup from "./ConfirmationPopup";
import UnifiedJobOrderRoadmap from "../components/UnifiedJobOrderRoadmap";
import { matchesSearchQuery } from "../lib/searchUtils";

import "./QualityCheckModule.css";
import "./JobCards.css";
import "./JobOrderHistory.css";

import { getDataClient } from "../lib/amplifyClient";
import { cancelJobOrderByOrderNumber, getJobOrderByOrderNumber, upsertJobOrder } from "./jobOrderRepo";
import { UnifiedCustomerInfoCard, UnifiedVehicleInfoCard } from "../components/UnifiedCustomerVehicleCards";
import { UnifiedJobOrderSummaryCard } from "../components/UnifiedJobOrderSummaryCard";
import UnifiedBillingInvoicesSection from "../components/UnifiedBillingInvoicesSection";
import { getUserDirectory } from "../utils/userDirectoryCache";
import { resolveActorUsername, resolveOrderCreatedBy } from "../utils/actorIdentity";
import {
  derivePaymentStatusFromFinancials,
  normalizePaymentStatusLabel,
  pickBillingFirstValue,
  pickPaymentEnum,
  pickPaymentLabel,
} from "../utils/paymentStatus";

import { getUrl, uploadData } from "aws-amplify/storage";

import PermissionGate from "./PermissionGate";

/* -------------------- helpers -------------------- */
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

function safeLower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function isServiceOperationLabel(value: any) {
  const compact = String(value ?? "").trim().toLowerCase().replace(/[\s_]+/g, "");
  return compact === "inprogress" || compact === "serviceoperation";
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

function normalizePaymentLabel(enumVal?: string, label?: string): string {
  return normalizePaymentStatusLabel(enumVal, label);
}

function nowIso() {
  return new Date().toISOString();
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

function resolveActorName(user: any) {
  return resolveActorUsername(user, "qc");
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

type QCListRow = {
  _backendId: string;
  id: string; // orderNumber
  createDate: string;
  orderType: string;
  customerName: string;
  mobile: string;
  vehiclePlate: string;
  workStatus: string;
};

type DocItem = {
  id: string;
  name: string;
  type: string;
  category?: string;
  addedAt?: string;
  uploadedBy?: string;
  storagePath?: string;
  url?: string;
};

/* -------------------- component -------------------- */
export default function QualityCheckModule({ currentUser }: { currentUser: any }) {
  const client = useMemo(() => getDataClient(), []);

  const [loading, setLoading] = useState(false);

  const [allOrders, setAllOrders] = useState<QCListRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredJobs, setFilteredJobs] = useState<QCListRow[]>([]);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const activeDropdownRef = useRef<string | null>(null);

  // details
  const [screenState, setScreenState] = useState<"main" | "details">("main");
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [userLabelMap, setUserLabelMap] = useState<Record<string, string>>({});

  // QC results keyed by service index
  const [serviceQCResults, setServiceQCResults] = useState<Record<number, "Pass" | "Failed" | "Acceptable">>({});
  const [showQCConfirmation, setShowQCConfirmation] = useState(false);

  // popups
  const [showPopup, setShowPopup] = useState(false);
  const [popupMessage, setPopupMessage] = useState("");

  // cancel modal
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const canFinishQCAction = true;
  const canApproveQCAction = true;
  const canRejectQCAction = true;

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

  /* -------------------- live list from backend -------------------- */
  useEffect(() => {
    const sub = (client.models.JobOrder as any)
      .observeQuery({ limit: 500 })
      .subscribe(({ items }: any) => {
        const rows = (items ?? []) as any[];

        const mapped: QCListRow[] = rows
          .map((row) => {
            const parsed = safeJsonParse<any>(row.dataJson, {});
            const orderNumber = String(row.orderNumber ?? "").trim();

            const workStatus = normalizeWorkStatus(row.status, row.workStatusLabel ?? parsed?.workStatusLabel);

            // show only QC stage
            // QC is driven by label (workStatusLabel) in your UI.
            const isQC =
              safeLower(workStatus) === "quality check" ||
              safeLower(row.workStatusLabel) === "quality check" ||
              safeLower(parsed?.workStatusLabel) === "quality check";

            if (!isQC) return null;

            const createDate = row.createdAt
              ? new Date(String(row.createdAt)).toLocaleString("en-GB")
              : "";

            return {
              _backendId: String(row.id),
              id: orderNumber,
              createDate,
              orderType: String(row.orderType ?? parsed?.orderType ?? "Job Order"),
              customerName: String(row.customerName ?? parsed?.customerName ?? ""),
              mobile: String(row.customerPhone ?? parsed?.customerPhone ?? ""),
              vehiclePlate: String(row.plateNumber ?? parsed?.plateNumber ?? ""),
              workStatus, // should be "Quality Check"
              // paymentStatus not needed in list here but your UI can show if you want
              // paymentStatus,
            };
          })
          .filter(Boolean) as QCListRow[];

        // newest first
        mapped.sort((a, b) => String(b.createDate).localeCompare(String(a.createDate)));

        setAllOrders(mapped);
      });

    return () => sub.unsubscribe();
  }, [client]);

  /* -------------------- search -------------------- */
  useEffect(() => {
    const q = safeLower(searchQuery);
    if (!q) {
      setFilteredJobs(allOrders);
      setCurrentPage(1);
      return;
    }

    const filtered = allOrders.filter((job) => {
      return matchesSearchQuery(
        [job.id, job.createDate, job.orderType, job.customerName, job.mobile, job.vehiclePlate, job.workStatus],
        q
      );
    });

    setFilteredJobs(filtered);
    setCurrentPage(1);
  }, [searchQuery, allOrders]);

  /* -------------------- pagination -------------------- */
  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / pageSize));
  const paginatedJobs = filteredJobs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  /* -------------------- dropdown outside click -------------------- */
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

  const handleOpenDropdown = useCallback((anchorEl: HTMLElement, jobId: string) => {
    const isActive = activeDropdownRef.current === jobId;
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
      activeDropdownRef.current = jobId;
      setDropdownPosition({ top, left });
      setActiveDropdown(jobId);
    });
  }, []);

  /* -------------------- details loader -------------------- */
  const viewDetails = async (job: QCListRow) => {
    setScreenState("details");
    setLoading(true);
    try {
      const detailed = await getJobOrderByOrderNumber(job.id);
      if (!detailed?._backendId) throw new Error("Order not found in backend.");

      // refresh the actual row too (for labels if needed)
      const rowRes = await client.models.JobOrder.get({ id: String(detailed._backendId) } as any);
      const row = (rowRes as any)?.data ?? null;
      const parsed = safeJsonParse<any>(row?.dataJson, safeJsonParse<any>(detailed?.dataJson, {}));

      // reset QC results; prefill if already evaluated
      const parsedServices = Array.isArray(parsed?.services) ? parsed.services : [];
      const nextResults: Record<number, any> = {};
      parsedServices.forEach((s: any, idx: number) => {
        const v = String(s?.qualityCheckResult ?? s?.qcResult ?? "").trim();
        if (v === "Pass" || v === "Failed" || v === "Acceptable") nextResults[idx] = v;
      });
      setServiceQCResults(nextResults);

      // merge consistent data for UI
      const merged = {
        ...detailed,
        _row: row,
        _parsed: parsed,
        id: String(detailed.id), // orderNumber
        workStatus: normalizeWorkStatus(row?.status, row?.workStatusLabel ?? parsed?.workStatusLabel ?? detailed?.workStatus),
        paymentStatus: derivePaymentStatusFromFinancials({
          paymentEnum: pickPaymentEnum(detailed, row, parsed),
          paymentLabel: pickPaymentLabel(detailed, row, parsed),
          totalAmount: pickBillingFirstValue("totalAmount", detailed, row, parsed),
          discount: pickBillingFirstValue("discount", detailed, row, parsed),
          amountPaid: pickBillingFirstValue("amountPaid", detailed, row, parsed),
          netAmount: pickBillingFirstValue("netAmount", detailed, row, parsed),
          balanceDue: pickBillingFirstValue("balanceDue", detailed, row, parsed),
        }),
        orderType: String(row?.orderType ?? detailed?.orderType ?? parsed?.orderType ?? "Job Order"),
        customerName: String(row?.customerName ?? detailed?.customerName ?? parsed?.customerName ?? ""),
        mobile: String(row?.customerPhone ?? detailed?.mobile ?? parsed?.customerPhone ?? ""),
        vehiclePlate: String(row?.plateNumber ?? detailed?.vehiclePlate ?? parsed?.plateNumber ?? ""),
        documents: Array.isArray(parsed?.documents) ? parsed.documents : Array.isArray(detailed?.documents) ? detailed.documents : [],
      };

      setSelectedOrder(merged);
    } catch (e) {
      setPopupMessage(`Load failed: ${errMsg(e)}`);
      setShowPopup(true);
      setScreenState("main");
    } finally {
      setLoading(false);
    }
  };

  const closeDetailView = () => {
    setSelectedOrder(null);
    setScreenState("main");
    setServiceQCResults({});
    setShowQCConfirmation(false);
  };

  /* -------------------- cancel order (backend) -------------------- */
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

      setPopupMessage(`Job Order ${cancelOrderId} cancelled successfully.`);
      setShowPopup(true);

      // if details open for this order, close
      if (selectedOrder?.id === cancelOrderId) closeDetailView();
    } catch (e) {
      setPopupMessage(`Cancel failed: ${errMsg(e)}`);
      setShowPopup(true);
    } finally {
      setLoading(false);
    }
  };

  /* -------------------- QC logic -------------------- */
  const servicesForQc = useMemo(() => {
    const parsed = safeJsonParse<any>(selectedOrder?._parsed ?? selectedOrder?.dataJson, {});
    const parsedServices = Array.isArray(parsed?.services) ? parsed.services : [];
    // fallback to detailed.services which your repo derives
    const detailedServices = Array.isArray(selectedOrder?.services) ? selectedOrder.services : [];
    // prefer parsed services (we need to write back)
    return parsedServices.length ? parsedServices : detailedServices;
  }, [selectedOrder]);

  const handleServiceQCChange = (serviceIndex: number, qcResult: any) => {
    setServiceQCResults((prev) => ({
      ...prev,
      [serviceIndex]: qcResult,
    }));
  };

  const allServicesEvaluated = () => {
    if (!servicesForQc || servicesForQc.length === 0) return false;
    return servicesForQc.every((_: any, idx: number) => Boolean(serviceQCResults[idx]));
  };

  const calculateOverallStatus = () => {
    const results = Object.values(serviceQCResults);
    if (!results.length) return "N/A";
    if (results.some((r) => r === "Failed")) return "Failed";
    if (results.some((r) => r === "Acceptable")) return "Acceptable";
    return "Pass";
  };

  /* -------------------- generate QC report + upload to S3 -------------------- */
  const generateReportHtml = (orderNumber: string, overallStatus: string) => {
    const now = new Date();

    const services = servicesForQc || [];
    const serviceRows = services
      .map((s: any, idx: number) => {
        const name = String(s?.name ?? s ?? `Service ${idx + 1}`);
        const r = String(serviceQCResults[idx] ?? "Not Evaluated");
        const cls =
          r === "Pass" ? "qc-pass" : r === "Failed" ? "qc-failed" : r === "Acceptable" ? "qc-acceptable" : "qc-na";
        return `<tr><td>${name}</td><td class="${cls}">${r}</td></tr>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>Quality_Check_${orderNumber}.html</title>
<style>
  body{font-family:Segoe UI,Arial,sans-serif;margin:0;padding:20mm;background:#f6f7fb;color:#0f172a}
  *{box-sizing:border-box}
  .hdr{background:linear-gradient(135deg,#0f172a,#2563eb);color:#fff;padding:18px;border-radius:12px;text-align:center;margin-bottom:16px}
  .hdr h1{margin:0 0 6px 0;font-size:24px}
  .hdr p{margin:0;font-size:12px;opacity:.9}
  .card{background:#fff;border:1px solid #e7e8ee;border-radius:12px;padding:16px;margin-bottom:14px}
  .ttl{margin:0 0 12px 0;font-size:14px;font-weight:800;border-bottom:1px solid #eef0f5;padding-bottom:10px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;font-size:12px}
  .lbl{font-weight:800;color:#334155;display:block;margin-bottom:4px}
  .val{color:#475569}
  table{width:100%;border-collapse:collapse}
  th,td{padding:10px 12px;border-bottom:1px solid #eef0f5;font-size:12px}
  thead{background:#0f172a;color:#fff}
  .overall{margin-top:10px;padding:12px;border-radius:10px;font-weight:900}
  .overall.pass{background:#d1fae5;color:#065f46}
  .overall.failed{background:#fee2e2;color:#991b1b}
  .overall.acceptable{background:#fef3c7;color:#92400e}
  .qc-pass{color:#065f46;font-weight:800}
  .qc-failed{color:#991b1b;font-weight:800}
  .qc-acceptable{color:#92400e;font-weight:800}
  .qc-na{color:#64748b}
</style>
</head>
<body>
  <div class="hdr">
    <h1>Quality Check Result Report</h1>
    <p>Generated on ${now.toLocaleString()}</p>
  </div>

  <div class="card">
    <div class="ttl">Job Order</div>
    <div class="grid">
      <div><span class="lbl">Order Number</span><span class="val">${orderNumber}</span></div>
      <div><span class="lbl">Overall Status</span><span class="val">${overallStatus}</span></div>
    </div>
  </div>

  <div class="card">
    <div class="ttl">Service Results</div>
    <table>
      <thead><tr><th>Service</th><th>Result</th></tr></thead>
      <tbody>${serviceRows}</tbody>
    </table>
    <div class="overall ${
      overallStatus === "Pass" ? "pass" : overallStatus === "Failed" ? "failed" : "acceptable"
    }">Overall: ${overallStatus}</div>
  </div>
</body>
</html>`;
  };

  const uploadQcReportAndReturnDoc = async (orderNumber: string): Promise<DocItem | null> => {
    const overall = calculateOverallStatus();
    const html = generateReportHtml(orderNumber, overall);

    const blob = new Blob([html], { type: "text/html" });
    const key = `job-orders/${orderNumber}/quality-check/QC_Report_${orderNumber}_${Date.now()}.html`;

    await uploadData({ path: key, data: blob, options: { contentType: "text/html" } }).result;

    const actor = resolveActorName(currentUser);
    return {
      id: `DOC-${Date.now()}`,
      name: `QC_Report_${orderNumber}.html`,
      type: "Quality Check Report",
      category: "Quality",
      addedAt: nowIso(),
      uploadedBy: actor,
      storagePath: key,
    };
  };

  const handleFinishQC = () => {
    if (!canFinishQCAction) return;
    if (!canApproveQCAction && !canRejectQCAction) {
      setPopupMessage("You don’t have permission to approve or reject Quality Check.");
      setShowPopup(true);
      return;
    }
    if (!allServicesEvaluated()) return;
    setShowQCConfirmation(true);
  };

  /* -------------------- approve / reject (backend write) -------------------- */
  const persistQcResultsToOrder = async (nextWorkStatusLabel: string) => {
    if (!selectedOrder?.id) throw new Error("No order selected.");

    // Load fresh detailed order (repo ensures correct shape)
    const detailed = await getJobOrderByOrderNumber(String(selectedOrder.id));
    if (!detailed) throw new Error("Order not found.");

    const parsed = safeJsonParse<any>((selectedOrder as any)?._parsed ?? (selectedOrder as any)?.dataJson, {});
    const parsedServices = Array.isArray(parsed?.services) ? parsed.services : [];

    const nextServices = (parsedServices.length ? parsedServices : Array.isArray(detailed.services) ? detailed.services : []).map(
      (s: any, idx: number) => {
        // keep existing fields, only set QC result
        const qc = serviceQCResults[idx] || undefined;
        return { ...s, qualityCheckResult: qc };
      }
    );

    // upload QC report (replace old QC report docs)
    const docs: DocItem[] = Array.isArray(parsed?.documents)
      ? parsed.documents
      : Array.isArray((selectedOrder as any)?.documents)
        ? (selectedOrder as any).documents
        : [];

    const qcDoc = await uploadQcReportAndReturnDoc(String(selectedOrder.id));
    const docsWithoutOld = docs.filter((d) => safeLower(d?.type) !== "quality check report");

    const updatedDocs = qcDoc ? [...docsWithoutOld, qcDoc] : docsWithoutOld;

    // roadmap update is optional; keep safe: mark quality check done if roadmap exists
    const roadmap = Array.isArray(parsed?.roadmap) ? parsed.roadmap : Array.isArray(detailed.roadmap) ? detailed.roadmap : [];
    const actor = resolveActorName(currentUser);

    const nextRoadmap = roadmap.map((step: any) => {
      const stepName = safeLower(step?.step);
      if (stepName === "quality check") {
        return {
          ...step,
          stepStatus: "Completed",
          status: "Completed",
          endTimestamp: new Date().toLocaleString("en-GB"),
          actionBy: actor,
        };
      }
      if (safeLower(nextWorkStatusLabel) === "ready" && (stepName === "ready" || stepName === "ready for delivery")) {
        return {
          ...step,
          stepStatus: "Active",
          status: "InProgress",
          startTimestamp: step?.startTimestamp ?? new Date().toLocaleString("en-GB"),
          actionBy: actor,
        };
      }
      if (isServiceOperationLabel(nextWorkStatusLabel) && (stepName === "inprogress" || stepName === "in progress" || stepName === "serviceoperation" || stepName === "service_operation")) {
        return {
          ...step,
          stepStatus: "Active",
          status: "InProgress",
          actionBy: actor,
        };
      }
      return step;
    });

    // build updated order for jobOrderSave lambda (via repo)
    const updatedOrder = {
      ...detailed,
      _backendId: detailed._backendId,
      id: detailed.id, // orderNumber
      workStatus: nextWorkStatusLabel,
      workStatusLabel: nextWorkStatusLabel,
      updatedBy: actor,

      dataJson: JSON.stringify({
        ...parsed,
        services: nextServices,
        documents: updatedDocs,
        roadmap: nextRoadmap,
        workStatusLabel: nextWorkStatusLabel,
      }),

      documents: updatedDocs,
      roadmap: nextRoadmap,
      services: nextServices,
    };

    await upsertJobOrder(updatedOrder);
  };

  const handleApproveQC = async () => {
    if (!canApproveQCAction) return;
    setLoading(true);
    try {
      await persistQcResultsToOrder("Ready");
      setPopupMessage("Quality Check Approved! Order moved to Ready status.");
      setShowPopup(true);
      setShowQCConfirmation(false);
      closeDetailView();
    } catch (e) {
      setPopupMessage(`Approve failed: ${errMsg(e)}`);
      setShowPopup(true);
    } finally {
      setLoading(false);
    }
  };

  const handleRejectQC = async () => {
    if (!canRejectQCAction) return;
    setLoading(true);
    try {
      await persistQcResultsToOrder("Service_Operation");
      setPopupMessage("Quality Check Rejected! Order returned to Service Execution (Service_Operation).");
      setShowPopup(true);
      setShowQCConfirmation(false);
      closeDetailView();
    } catch (e) {
      setPopupMessage(`Reject failed: ${errMsg(e)}`);
      setShowPopup(true);
    } finally {
      setLoading(false);
    }
  };

  /* ===================== MAIN SCREEN ===================== */
  if (screenState === "main") {
    return (
      <div className="quality-check-module">
        <div className="app-container">
          <header className="app-header crm-unified-header">
            <div className="header-left">
              <h1>
                <i className="fas fa-check-double"></i> Quality Check Module
              </h1>
            </div>
          </header>

          <main className="main-content">
            <section className="search-section">
              <div className="search-container">
                <i className="fas fa-search search-icon"></i>
                <input
                  type="text"
                  className="smart-search-input"
                  placeholder="Search by any details"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoComplete="off"
                />
              </div>

              <div className="search-stats">
                {filteredJobs.length === 0
                  ? loading
                    ? "Loading..."
                    : "No jobs found"
                  : `Showing ${Math.min((currentPage - 1) * pageSize + 1, filteredJobs.length)}-${Math.min(
                      currentPage * pageSize,
                      filteredJobs.length
                    )} of ${filteredJobs.length} quality check jobs`}
              </div>
            </section>

            <section className="results-section">
              <div className="section-header">
                <h2>
                  <i className="fas fa-list"></i> Quality Check Records
                </h2>

                <div className="pagination-controls">
                  <div className="records-per-page">
                    <label htmlFor="qcPageSize">Records per page:</label>
                    <select
                      id="qcPageSize"
                      className="page-size-select"
                      value={pageSize}
                      onChange={(event) => {
                        setPageSize(parseInt(event.target.value, 10));
                        setCurrentPage(1);
                      }}
                    >
                      <option value="20">20</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                    </select>
                  </div>
                </div>
              </div>

              {filteredJobs.length > 0 ? (
                <div className="table-wrapper">
                  <table className="job-order-table">
                    <thead>
                      <tr>
                        <th>Create Date</th>
                        <th>Job Card ID</th>
                        <th>Order Type</th>
                        <th>Customer Name</th>
                        <th>Mobile Number</th>
                        <th>Vehicle Plate</th>
                        <th>Work Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedJobs.map((job) => (
                        <tr key={job.id}>
                          <td className="date-column">{job.createDate}</td>
                          <td>{job.id}</td>
                          <td>
                            <span className={`order-type-badge ${safeLower(job.orderType).includes("new") ? "order-type-new-job" : "order-type-service"}`}>
                              {job.orderType}
                            </span>
                          </td>
                          <td>{job.customerName}</td>
                          <td>{job.mobile}</td>
                          <td>{job.vehiclePlate}</td>
                          <td>
                            <span className="status-badge status-pending">{job.workStatus}</span>
                          </td>
                          <td>
                            <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_actions">
                              <div className="action-dropdown-container">
                                <button
                                  type="button"
                                  className={`btn-action-dropdown ${activeDropdown === job.id ? "active" : ""}`}
                                  onClick={(e) => handleOpenDropdown(e.currentTarget as HTMLElement, job.id)}
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
                </div>
              ) : (
                <div className="qc-empty">
                  <i className="fas fa-inbox"></i>
                  <p>No quality check jobs found</p>
                </div>
              )}

              {totalPages > 1 && (
                <div className="pagination">
                  <button
                    className="pagination-btn"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    type="button"
                  >
                    <i className="fas fa-chevron-left"></i>
                  </button>

                  <div className="page-numbers">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
                      let pageNum: number;
                      if (totalPages <= 5) pageNum = index + 1;
                      else {
                        const start = Math.max(1, currentPage - 2);
                        const end = Math.min(totalPages, start + 4);
                        const adjustedStart = Math.max(1, end - 4);
                        pageNum = adjustedStart + index;
                      }
                      return (
                        <button
                          key={pageNum}
                          className={`pagination-btn ${pageNum === currentPage ? "active" : ""}`}
                          onClick={() => setCurrentPage(pageNum)}
                          type="button"
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    className="pagination-btn"
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    type="button"
                  >
                    <i className="fas fa-chevron-right"></i>
                  </button>
                </div>
              )}
            </section>

            <div className="quality-footer">
              <p>Service Management System © 2023 | Quality Check Module</p>
            </div>
          </main>
        </div>

        {/* Actions dropdown */}
        {typeof document !== "undefined" &&
          createPortal(
            <div
              className={`action-dropdown-menu show action-dropdown-menu-fixed ${activeDropdown ? "open" : "closed"}`}
              style={activeDropdown ? { top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` } : { top: "-9999px", left: "-9999px" }}
            >
              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_viewdetails">
                <button
                  className="dropdown-item view"
                  type="button"
                  onClick={() => {
                    if (!activeDropdown) return;
                    const target = activeDropdown;
                    const job = filteredJobs.find((j) => j.id === target);
                    activeDropdownRef.current = null;
                    setActiveDropdown(null);
                    if (job) void viewDetails(job);
                  }}
                >
                  <i className="fas fa-eye"></i> View Details
                </button>
              </PermissionGate>

              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_cancel">
                <>
                  <div className="dropdown-divider"></div>
                  <button
                    className="dropdown-item delete"
                    type="button"
                    onClick={() => {
                      if (!activeDropdown) return;
                      const target = activeDropdown;
                      activeDropdownRef.current = null;
                      setActiveDropdown(null);
                      handleShowCancelConfirmation(target);
                    }}
                  >
                    <i className="fas fa-times-circle"></i> Cancel Order
                  </button>
                </>
              </PermissionGate>
            </div>,
            document.body
          )}

        {/* Cancel modal */}
        <div className={`cancel-modal-overlay ${showCancelConfirmation && cancelOrderId ? "active" : ""}`}>
          <div className="cancel-modal">
            <div className="cancel-modal-header">
              <h3>
                <i className="fas fa-exclamation-triangle"></i> Confirm Cancellation
              </h3>
            </div>
            <div className="cancel-modal-body">
              <div className="cancel-warning">
                <i className="fas fa-exclamation-circle"></i>
                <div className="cancel-warning-text">
                  <p>
                    You are about to cancel order <strong>{cancelOrderId}</strong>.
                  </p>
                  <p>This action cannot be undone.</p>
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
                >
                  <i className="fas fa-times"></i> Keep Order
                </button>
                <button className="btn-confirm-cancel" type="button" onClick={() => void handleCancelOrder()} disabled={loading}>
                  <i className="fas fa-ban"></i> {loading ? "Cancelling..." : "Cancel Order"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Popups */}
        {showPopup && (
          <SuccessPopup isVisible={showPopup} onClose={() => setShowPopup(false)} message={popupMessage} />
        )}
      </div>
    );
  }

  /* ===================== DETAILS SCREEN ===================== */
  if (screenState === "details" && selectedOrder) {
    const parsed = safeJsonParse<any>(selectedOrder?._parsed ?? selectedOrder?.dataJson, {});
    const roadmap = Array.isArray(parsed?.roadmap) ? parsed.roadmap : Array.isArray(selectedOrder?.roadmap) ? selectedOrder.roadmap : [];
    const docs: DocItem[] = Array.isArray(parsed?.documents) ? parsed.documents : Array.isArray(selectedOrder?.documents) ? selectedOrder.documents : [];
    const createdByDisplay = resolveOrderCreatedBy(selectedOrder, { identityToUsernameMap: userLabelMap, fallback: "—" });

    return (
      <div className="quality-check-module">
        <div className="detail-view pim-details-screen jo-details-v3 jh-details" id="detailView">
          <div className="detail-header pim-details-header">
            <div className="pim-details-title-container">
              <h2>
                Quality Check Details - Job Order #<span id="detailJobIdHeader">{selectedOrder.id}</span>
              </h2>
            </div>
            <button className="close-detail pim-btn-close-details" type="button" onClick={closeDetailView}>
              <i className="fas fa-times"></i> Close Details
            </button>
          </div>

          <div className="detail-container pim-details-body jh-details-body">
            <div className="detail-cards pim-details-grid jh-grid">
              {/* Summary */}
              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_summary">
                <UnifiedJobOrderSummaryCard
                  order={selectedOrder}
                  className="jh-summary-card"
                  identityToUsernameMap={userLabelMap}
                  createdByOverride={createdByDisplay}
                  paymentStatusOverride={normalizePaymentLabel(undefined, selectedOrder?.paymentStatus)}
                />
              </PermissionGate>

              {/* Roadmap */}
              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_roadmap">
                <div className="jh-card jh-span-2">
                  {roadmap.length === 0 ? (
                    <div className="jh-empty-inline">No roadmap data.</div>
                  ) : (
                    <UnifiedJobOrderRoadmap order={{ ...selectedOrder, roadmap }} />
                  )}
                </div>
              </PermissionGate>

              {/* Customer */}
              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_customer">
                <UnifiedCustomerInfoCard order={selectedOrder} className="cv-unified-card" />
              </PermissionGate>

              {/* Vehicle */}
              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_vehicle">
                <UnifiedVehicleInfoCard order={selectedOrder} className="cv-unified-card" />
              </PermissionGate>

              {/* Services */}
              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_services">
                <div className="pim-detail-card">
                  <h3>
                    <i className="fas fa-tasks"></i> Services Summary ({servicesForQc.length || 0})
                  </h3>

                  <div className="pim-services-list">
                    {servicesForQc.length > 0 ? (
                      servicesForQc.map((service: any, idx: number) => (
                        <div key={idx} className="pim-service-item">
                          <div className="pim-service-header">
                            <span className="pim-service-name">{String(service?.name ?? service ?? `Service ${idx + 1}`)}</span>
                            <span className={`status-badge ${getServiceStatusClass(service?.status ?? "New")}`}>
                              {String(service?.status ?? "New")}
                            </span>
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
                      <div className="qc-empty-inline">No services added yet</div>
                    )}
                  </div>
                </div>
              </PermissionGate>

              {/* Quality checklist */}
              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_quality">
                <div className="qc-detail-card qc-quality-card pim-detail-card">
                  <div className="qc-quality-head">
                    <h3>
                      <i className="fas fa-clipboard-check"></i> Quality Check List
                    </h3>
                  </div>

                  <div className="qc-checklist-items">
                    {servicesForQc.length > 0 ? (
                      servicesForQc.map((service: any, idx: number) => (
                        <div key={idx} className="qc-checklist-item">
                          <span className="qc-checklist-service-name">{String(service?.name ?? service ?? `Service ${idx + 1}`)}</span>

                          <div className="qc-checklist-actions">
                            <select
                              className="qc-service-dropdown"
                              value={serviceQCResults[idx] || ""}
                              onChange={(e) => handleServiceQCChange(idx, e.target.value)}
                            >
                              <option value="">-- Select Result --</option>
                              <option value="Pass">✓ Pass</option>
                              <option value="Failed">✗ Failed</option>
                              <option value="Acceptable">~ Acceptable</option>
                            </select>

                            {serviceQCResults[idx] ? (
                              <span className={`qc-result-badge qc-result-${safeLower(serviceQCResults[idx])}`}>
                                {serviceQCResults[idx]}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="qc-empty-inline">No services to evaluate</div>
                    )}
                  </div>

                  <div className="qc-quality-footer">
                    <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_finish">
                      <button
                        className="qc-btn-finish"
                        type="button"
                        onClick={handleFinishQC}
                        disabled={!allServicesEvaluated() || loading}
                      >
                        <i className="fas fa-flag-checkered"></i> {loading ? "Saving..." : "Finish"}
                      </button>
                    </PermissionGate>
                  </div>
                </div>
              </PermissionGate>

              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_billing">
                <UnifiedBillingInvoicesSection order={selectedOrder} />
              </PermissionGate>

              {/* Documents */}
              {docs.length > 0 && (
                <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_documents">
                  <div className="qc-detail-card pim-detail-card">
                    <h3>
                      <i className="fas fa-folder-open"></i> Documents
                    </h3>

                    <div className="pim-docs">
                      {docs.map((doc: any, idx: number) => (
                        (() => {
                          const generatedAt = String(
                            doc?.addedAt ?? doc?.generatedAt ?? doc?.createdAt ?? doc?.uploadedAt ?? doc?.timestamp ?? ""
                          ).trim();
                          return (
                        <div key={doc.id || idx} className="pim-doc">
                          <div className="pim-doc-left">
                            <div className="pim-doc-name">{doc.name}</div>
                            <div className="pim-doc-meta">
                              {doc.type}
                              {doc.category ? ` • ${doc.category}` : ""}
                              {generatedAt ? ` • Generated: ${generatedAt}` : ""}
                            </div>
                          </div>

                          <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_download">
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
                          );
                        })()
                      ))}
                    </div>
                  </div>
                </PermissionGate>
              )}

              {/* QC confirmation popup */}
              {showQCConfirmation && (
                <ConfirmationPopup
                  open={showQCConfirmation}
                  message="Quality Check Evaluation Complete. Please select an action:"
                  confirmText={canApproveQCAction ? "Approve Quality Check" : "Close"}
                  cancelText={canRejectQCAction ? "Reject Quality Check" : "Cancel"}
                  disableConfirm={!canApproveQCAction}
                  onConfirm={() => {
                    if (canApproveQCAction) {
                      void handleApproveQC();
                    } else {
                      setShowQCConfirmation(false);
                    }
                  }}
                  onCancel={() => {
                    if (canRejectQCAction) {
                      void handleRejectQC();
                    } else {
                      setShowQCConfirmation(false);
                    }
                  }}
                />
              )}

              {/* Generic popup */}
              {showPopup &&
                createPortal(
                  <SuccessPopup isVisible={showPopup} onClose={() => setShowPopup(false)} message={popupMessage} />,
                  document.body
                )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function getServiceStatusClass(status: any) {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "completed") return "status-completed";
  if (s === "cancelled" || s === "canceled") return "status-cancelled";
  if (s === "quality check") return "status-quality-check";
  if (s === "service_operation" || s === "inprogress" || s === "in progress") return "status-inprogress";
  if (s === "inspection") return "status-inspection";
  if (s === "ready") return "status-ready";
  return "status-new-request";
}

