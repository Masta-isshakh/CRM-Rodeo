// src/pages/QualityCheckModule.tsx
import  { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import SuccessPopup from "./SuccessPopup";
import ConfirmationPopup from "./ConfirmationPopup";
import PermissionGate from "./PermissionGate";

import "./QualityCheckModule.css";

import { getDataClient } from "../lib/amplifyClient";
import { cancelJobOrderByOrderNumber, getJobOrderByOrderNumber, upsertJobOrder } from "./jobOrderRepo";
import { getUserDirectory } from "../utils/userDirectoryCache";

import { getUrl, uploadData } from "aws-amplify/storage";

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

function normalizeIdentity(v: any) {
  return String(v ?? "").trim().toLowerCase();
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
  const l = String(label ?? "").trim();
  if (l) return l;

  switch (String(enumVal || "").toUpperCase()) {
    case "UNPAID":
      return "Unpaid";
    case "PARTIAL":
      return "Partially Paid";
    case "PAID":
      return "Fully Paid";
    default:
      return "Unpaid";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function resolveActorEmail(user: any) {
  const raw = String(
    user?.email ?? user?.attributes?.email ?? user?.signInDetails?.loginId ?? user?.name ?? user?.username ?? ""
  ).trim();
  return raw.includes("@") ? raw : "";
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

  const displayUser = (value: any) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "Not assigned";
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

  /* -------------------- live list from backend -------------------- */
  useEffect(() => {
    const sub = (client.models.JobOrder as any)
      .observeQuery({ limit: 2000 })
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
      const hay = [
        job.id,
        job.createDate,
        job.orderType,
        job.customerName,
        job.mobile,
        job.vehiclePlate,
        job.workStatus,
      ]
        .map((x) => safeLower(x))
        .join(" ");
      return hay.includes(q);
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
      if (!isDropdownButton && !isDropdownMenu) setActiveDropdown(null);
    };

    if (activeDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [activeDropdown]);

  const handleOpenDropdown = (e: any, jobId: string) => {
    const isActive = activeDropdown === jobId;
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
    setActiveDropdown(jobId);
  };

  /* -------------------- details loader -------------------- */
  const viewDetails = async (job: QCListRow) => {
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
        paymentStatus: normalizePaymentLabel(row?.paymentStatus, row?.paymentStatusLabel ?? parsed?.paymentStatusLabel ?? detailed?.paymentStatus),
        orderType: String(row?.orderType ?? detailed?.orderType ?? parsed?.orderType ?? "Job Order"),
        customerName: String(row?.customerName ?? detailed?.customerName ?? parsed?.customerName ?? ""),
        mobile: String(row?.customerPhone ?? detailed?.mobile ?? parsed?.customerPhone ?? ""),
        vehiclePlate: String(row?.plateNumber ?? detailed?.vehiclePlate ?? parsed?.plateNumber ?? ""),
        documents: Array.isArray(parsed?.documents) ? parsed.documents : Array.isArray(detailed?.documents) ? detailed.documents : [],
      };

      setSelectedOrder(merged);
      setScreenState("details");
    } catch (e) {
      setPopupMessage(`Load failed: ${errMsg(e)}`);
      setShowPopup(true);
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

    const actor = resolveActorEmail(currentUser) || "qc";
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
    const actor = resolveActorEmail(currentUser) || "qc";

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
      if (safeLower(nextWorkStatusLabel) === "inprogress" && (stepName === "inprogress" || stepName === "in progress")) {
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

      // keep existing payment label (don’t overwrite)
      paymentStatus: detailed.paymentStatus,
      paymentStatusLabel: (parsed?.paymentStatusLabel ?? detailed.paymentStatus) || "Unpaid",

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
    setLoading(true);
    try {
      await persistQcResultsToOrder("Inprogress");
      setPopupMessage("Quality Check Rejected! Order returned to Service Execution (Inprogress).");
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

  /* -------------------- UI helpers (classes only) -------------------- */
  const getQCStepStatusClass = (stepStatus: string) => {
    switch (stepStatus) {
      case "Completed":
        return "qc-step-completed";
      case "Active":
      case "InProgress":
        return "qc-step-active";
      case "Pending":
        return "qc-step-pending";
      case "Cancelled":
        return "qc-step-cancelled";
      case "Upcoming":
      default:
        return "qc-step-upcoming";
    }
  };

  const getQCStepIcon = (stepStatus: string) => {
    switch (stepStatus) {
      case "Completed":
        return "fas fa-check-circle";
      case "Active":
      case "InProgress":
        return "fas fa-play-circle";
      case "Pending":
        return "fas fa-clock";
      case "Cancelled":
        return "fas fa-times-circle";
      case "Upcoming":
      default:
        return "fas fa-circle";
    }
  };

  const getQCStatusClass = (status: string) => {
    switch (status) {
      case "Completed":
        return "qc-status-completed";
      case "InProgress":
        return "qc-status-inprogress";
      case "Pending":
      case "Upcoming":
        return "qc-status-pending";
      default:
        return "qc-status-pending";
    }
  };

  /* ===================== MAIN SCREEN ===================== */
  if (screenState === "main") {
    return (
      <div className="quality-check-module">
        <div className="app-container">
          <header className="app-header">
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
                                  onClick={(e) => handleOpenDropdown(e, job.id)}
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
        {activeDropdown &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="action-dropdown-menu show action-dropdown-menu-fixed"
              style={{ top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` }}
            >
              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_viewdetails">
                <button
                  className="dropdown-item view"
                  type="button"
                  onClick={() => {
                    const job = filteredJobs.find((j) => j.id === activeDropdown);
                    if (job) void viewDetails(job);
                    setActiveDropdown(null);
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
                    onClick={() => handleShowCancelConfirmation(activeDropdown)}
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

    const paymentLog = Array.isArray(selectedOrder?.paymentActivityLog) ? selectedOrder.paymentActivityLog : [];

    return (
      <div className="quality-check-module">
        <div className="detail-view" id="detailView">
          <div className="detail-header">
            <h2>
              Quality Check Details - Job Order #<span id="detailJobIdHeader">{selectedOrder.id}</span>
            </h2>
            <button className="close-detail" type="button" onClick={closeDetailView}>
              <i className="fas fa-times"></i> Close Details
            </button>
          </div>

          <div className="detail-container">
            <div className="detail-cards">
              {/* Summary */}
              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_summary">
                <div className="qc-detail-card">
                  <h3>
                    <i className="fas fa-info-circle"></i> Job Order Summary
                  </h3>
                  <div className="qc-card-content">
                    <div className="qc-info-item">
                      <span className="qc-info-label">Job Order ID</span>
                      <span className="qc-info-value">{selectedOrder.id}</span>
                    </div>
                    <div className="qc-info-item">
                      <span className="qc-info-label">Order Type</span>
                      <span className="qc-info-value">{selectedOrder.orderType || "Job Order"}</span>
                    </div>
                    <div className="qc-info-item">
                      <span className="qc-info-label">Request Create Date</span>
                      <span className="qc-info-value">{selectedOrder.jobOrderSummary?.createDate || selectedOrder.createDate || "—"}</span>
                    </div>
                    <div className="qc-info-item">
                      <span className="qc-info-label">Created By</span>
                      <span className="qc-info-value">{selectedOrder.jobOrderSummary?.createdBy || "System"}</span>
                    </div>
                    <div className="qc-info-item">
                      <span className="qc-info-label">Expected Delivery</span>
                      <span className="qc-info-value">{selectedOrder.jobOrderSummary?.expectedDelivery || "—"}</span>
                    </div>
                    <div className="qc-info-item">
                      <span className="qc-info-label">Work Status</span>
                      <span className="qc-info-value">
                        <span className="qc-status-badge qc-status-pending">{selectedOrder.workStatus}</span>
                      </span>
                    </div>
                    <div className="qc-info-item">
                      <span className="qc-info-label">Payment Status</span>
                      <span className="qc-info-value">
                        <span className="qc-status-badge qc-payment-unpaid">{selectedOrder.paymentStatus}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </PermissionGate>

              {/* Roadmap */}
              {roadmap.length > 0 && (
                <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_roadmap">
                  <div className="qc-detail-card">
                    <h3>
                      <i className="fas fa-map-signs"></i> Job Order Roadmap
                    </h3>
                    <div className="qc-roadmap-container">
                      <div className="qc-roadmap-steps">
                        {roadmap.map((step: any, idx: number) => (
                          <div key={idx} className={`qc-roadmap-step ${getQCStepStatusClass(String(step.stepStatus ?? "Upcoming"))}`}>
                            <div className="qc-step-icon">
                              <i className={getQCStepIcon(String(step.stepStatus ?? "Upcoming"))}></i>
                            </div>
                            <div className="qc-step-content">
                              <div className="qc-step-header">
                                <div className="qc-step-name">{String(step.step ?? "")}</div>
                                <span className={`qc-status-badge-roadmap ${getQCStatusClass(String(step.status ?? "Upcoming"))}`}>
                                  {String(step.status ?? "Upcoming")}
                                </span>
                              </div>
                              <div className="qc-step-details">
                                <div className="qc-step-detail">
                                  <span className="qc-detail-label">Started</span>
                                  <span className="qc-detail-value">{String(step.startTimestamp ?? "Not started")}</span>
                                </div>
                                <div className="qc-step-detail">
                                  <span className="qc-detail-label">Ended</span>
                                  <span className="qc-detail-value">{String(step.endTimestamp ?? "Not completed")}</span>
                                </div>
                                <div className="qc-step-detail">
                                  <span className="qc-detail-label">Action By</span>
                                  <span className="qc-detail-value">{displayUser(step.actionBy)}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </PermissionGate>
              )}

              {/* Customer */}
              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_customer">
                <div className="qc-detail-card">
                  <h3>
                    <i className="fas fa-user"></i> Customer Information
                  </h3>
                  <div className="qc-card-content">
                    <div className="qc-info-item">
                      <span className="qc-info-label">Name</span>
                      <span className="qc-info-value">{selectedOrder.customerName || "—"}</span>
                    </div>
                    <div className="qc-info-item">
                      <span className="qc-info-label">Mobile</span>
                      <span className="qc-info-value">{selectedOrder.mobile || "—"}</span>
                    </div>
                    <div className="qc-info-item">
                      <span className="qc-info-label">Email</span>
                      <span className="qc-info-value">{selectedOrder.customerDetails?.email || "—"}</span>
                    </div>
                  </div>
                </div>
              </PermissionGate>

              {/* Vehicle */}
              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_vehicle">
                <div className="qc-detail-card">
                  <h3>
                    <i className="fas fa-car"></i> Vehicle Information
                  </h3>
                  <div className="qc-card-content">
                    <div className="qc-info-item">
                      <span className="qc-info-label">Make / Model</span>
                      <span className="qc-info-value">
                        {selectedOrder.vehicleDetails?.make || "—"} {selectedOrder.vehicleDetails?.model || ""}
                      </span>
                    </div>
                    <div className="qc-info-item">
                      <span className="qc-info-label">Plate</span>
                      <span className="qc-info-value">{selectedOrder.vehicleDetails?.plateNumber || selectedOrder.vehiclePlate || "—"}</span>
                    </div>
                    <div className="qc-info-item">
                      <span className="qc-info-label">Color</span>
                      <span className="qc-info-value">{selectedOrder.vehicleDetails?.color || "—"}</span>
                    </div>
                  </div>
                </div>
              </PermissionGate>

              {/* Services */}
              <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_services">
                <div className="qc-detail-card">
                  <h3>
                    <i className="fas fa-tasks"></i> Services Summary
                  </h3>

                  <div className="qc-services-list">
                    {servicesForQc.length > 0 ? (
                      servicesForQc.map((service: any, idx: number) => (
                        <div key={idx} className="qc-service-item">
                          <div className="qc-service-header">
                            <span className="qc-service-name">{String(service?.name ?? service ?? `Service ${idx + 1}`)}</span>
                            <span className="qc-status-badge qc-status-new">{String(service?.status ?? "New")}</span>
                          </div>
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
                <div className="qc-detail-card qc-quality-card">
                  <div className="qc-quality-head">
                    <h3>
                      <i className="fas fa-clipboard-check"></i> Quality Check List
                    </h3>

                    <button
                      className="qc-btn-finish"
                      type="button"
                      onClick={handleFinishQC}
                      disabled={!allServicesEvaluated() || loading}
                    >
                      <i className="fas fa-flag-checkered"></i> {loading ? "Saving..." : "Finish"}
                    </button>
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
                </div>
              </PermissionGate>

              {/* Payment log (read only from repo result) */}
              {paymentLog.length > 0 && (
                <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_paymentlog">
                  <div className="qc-detail-card">
                    <h3>
                      <i className="fas fa-history"></i> Payment Activity Log
                    </h3>
                    <div className="pim-table-wrap">
                      <table className="pim-table pim-payment-log-table">
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
                          {[...paymentLog].reverse().map((p: any, idx: number) => (
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
                  </div>
                </PermissionGate>
              )}

              {/* Documents */}
              {docs.length > 0 && (
                <PermissionGate moduleId="qualitycheck" optionId="qualitycheck_documents">
                  <div className="qc-detail-card">
                    <h3>
                      <i className="fas fa-folder-open"></i> Documents
                    </h3>

                    <div className="pim-docs">
                      {docs.map((doc: any, idx: number) => (
                        <div key={doc.id || idx} className="pim-doc">
                          <div className="pim-doc-left">
                            <div className="pim-doc-name">{doc.name}</div>
                            <div className="pim-doc-meta">
                              {doc.type}
                              {doc.category ? ` • ${doc.category}` : ""}
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
                  </div>
                </PermissionGate>
              )}

              {/* QC confirmation popup */}
              {showQCConfirmation && (
                <ConfirmationPopup
                  open={showQCConfirmation}
                  message="Quality Check Evaluation Complete. Please select an action:"
                  confirmText="Approve Quality Check"
                  cancelText="Reject Quality Check"
                  onConfirm={() => void handleApproveQC()}
                  onCancel={() => {
                    void handleRejectQC();
                    setShowQCConfirmation(false);
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