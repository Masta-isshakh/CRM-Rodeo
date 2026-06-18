// src/pages/inspection/InspectionModule.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { jsPDF } from "jspdf";
import "./InspectionModule.css";
import "./JobCards.css";

import SuccessPopup from "./SuccessPopup";
import PermissionGate from "./PermissionGate";
import inspectionListConfig from "./inspectionConfig";
import { matchesSearchQuery } from "../lib/searchUtils";
import { UnifiedCustomerInfoCard, UnifiedVehicleInfoCard } from "../components/UnifiedCustomerVehicleCards";
import { UnifiedJobOrderSummaryCard } from "../components/UnifiedJobOrderSummaryCard";
import UnifiedBillingInvoicesSection from "../components/UnifiedBillingInvoicesSection";

import {
  listJobOrdersForMain,
  getJobOrderByOrderNumber,
  upsertJobOrder,
  cancelJobOrderByOrderNumber,
} from "./jobOrderRepo"; // ✅ use your real repo

import {
  loadInspectionConfig,
  getInspectionState,
  upsertInspectionState,
  uploadInspectionPhoto,
  resolveStorageUrl,
  saveInspectionReport,
  getInspectionReport,
  buildInspectionReportHtml,
} from "./inspectionRepo";
import { uploadData } from "aws-amplify/storage";
import { listServiceCatalog, resolveServicePriceForVehicleType, type ServiceCatalogItem } from "./serviceCatalogRepo";
import { resolveActorUsername, resolveOrderCreatedBy } from "../utils/actorIdentity";
import { usePermissions } from "../lib/userPermissions";
import { useLanguage } from "../i18n/LanguageContext";
import { useGlobalLoading } from "../utils/GlobalLoadingContext";
import { filterVisibleDocuments } from "../utils/documentVisibility";
import {
  computeCumulativeDiscountAllowance,
  resolveCentralDiscountPercent,
  toCurrencyNumber,
} from "../utils/discountPolicy";
import {
  derivePaymentStatusFromFinancials,
  pickBillingFirstValue,
  pickPaymentEnum,
  pickPaymentLabel,
} from "../utils/paymentStatus";

type AnyObj = Record<string, any>;

function errMsg(e: unknown) {
  const anyE = e as any;
  return String(anyE?.message ?? anyE?.errors?.[0]?.message ?? anyE ?? "Unknown error");
}

function toBilingualName(nameEn: any, nameAr: any, fallback = "Unnamed service") {
  const en = String(nameEn || "").trim();
  const ar = String(nameAr || "").trim();
  if (en && ar) return `${en} / ${ar}`;
  return en || ar || fallback;
}

function safeFileName(name: string) {
  return String(name || "file")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "");
}

const buildSectionState = (sectionConfig: AnyObj, sectionKey: string) => {
  const items = sectionConfig[sectionKey]?.groups
    ? sectionConfig[sectionKey].groups
        .flatMap((group: AnyObj) => group.items)
        .reduce((acc: AnyObj, item: AnyObj) => {
          acc[item.id] = { status: null, comment: "", photos: [] as string[] };
          return acc;
        }, {} as AnyObj)
    : {};
  return { started: false, completed: false, paused: false, notRequired: false, items };
};

const buildInitialInspectionState = (sectionConfig: AnyObj) => ({
  exterior: buildSectionState(sectionConfig, "exterior"),
  interior: buildSectionState(sectionConfig, "interior"),
});

function filterInspectionRows(rows: AnyObj[]) {
  return rows.filter((r) => ["New Request", "Inspection"].includes(String(r.workStatus || "")));
}

function resolveActorName(user: AnyObj) {
  return resolveActorUsername(user, "inspector");
}

function normalizeStepName(value: any) {
  return String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

function isServiceOperationStepName(value: any) {
  const n = normalizeStepName(value);
  return n === "inprogress" || n === "serviceoperation";
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

function ensureRoadmap(order: AnyObj, currentUser: AnyObj) {
  const rm = Array.isArray(order?.roadmap) ? order.roadmap : [];
  if (rm.length) return rm;

  const now = new Date().toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  return [
    { step: "New Request", stepStatus: "Active", startTimestamp: now, endTimestamp: null, actionBy: resolveActorName(currentUser), status: "InProgress" },
    { step: "Inspection", stepStatus: "Upcoming", startTimestamp: null, endTimestamp: null, actionBy: "Not assigned", status: "Upcoming" },
    { step: "Service_Operation", stepStatus: "Upcoming", startTimestamp: null, endTimestamp: null, actionBy: "Not assigned", status: "Upcoming" },
    { step: "Quality Check", stepStatus: "Upcoming", startTimestamp: null, endTimestamp: null, actionBy: "Not assigned", status: "Upcoming" },
    { step: "Ready", stepStatus: "Upcoming", startTimestamp: null, endTimestamp: null, actionBy: "Not assigned", status: "Upcoming" },
  ];
}

function roadmapMark(roadmap: AnyObj[], stepName: string, patch: AnyObj) {
  return roadmap.map((s) => {
    const isTargetServiceOperation = stepName === "Service_Operation" && isServiceOperationStepName(s.step);
    const isExact = String(s.step) === stepName;
    return isTargetServiceOperation || isExact ? { ...s, ...patch } : s;
  });
}

function deriveDetailData(order: AnyObj, row: AnyObj) {
  const parsed = (order as any)?._parsed ?? {};
  const expectedDelivery =
    order.expectedDeliveryDate || order.expectedDeliveryTime
      ? `${order.expectedDeliveryDate ?? ""} ${order.expectedDeliveryTime ?? ""}`.trim()
      : "Not specified";

  const vehicleModel =
    (order.vehicleMake && order.vehicleModel ? `${order.vehicleMake} ${order.vehicleModel} ${order.vehicleYear || ""}` : "").trim() ||
    `${order.vehicleDetails?.make || ""} ${order.vehicleDetails?.model || ""} ${order.vehicleDetails?.year || ""}`.trim() ||
    "N/A";

  return {
    jobOrderId: order._backendId,
    orderNumber: row.id,
    orderType: order.orderType || row.orderType || "New Job Order",
    createDate: order.jobOrderSummary?.createDate || row.createDate || "Not specified",
    createdBy: resolveOrderCreatedBy(order, { fallback: "—" }),
    expectedDelivery,

    workStatus: order.workStatusLabel || row.workStatus || "New Request",
    paymentStatus: derivePaymentStatusFromFinancials({
      paymentEnum: pickPaymentEnum(order, row, parsed),
      paymentLabel: pickPaymentLabel(order, row, parsed),
      totalAmount: pickBillingFirstValue("totalAmount", order, row, parsed),
      discount: pickBillingFirstValue("discount", order, row, parsed),
      amountPaid: pickBillingFirstValue("amountPaid", order, row, parsed),
      netAmount: pickBillingFirstValue("netAmount", order, row, parsed),
      balanceDue: pickBillingFirstValue("balanceDue", order, row, parsed),
    }),

    customerId: order.customerId || order.customerDetails?.customerId || "N/A",
    email: order.customerEmail || order.customerDetails?.email || "N/A",
    address: order.customerNotes || order.customerDetails?.address || "N/A",

    vehicleModel,
    year: order.vehicleYear || order.vehicleDetails?.year || "N/A",
    type: order.vehicleType || order.vehicleDetails?.type || "N/A",
    color: order.color || order.vehicleDetails?.color || "N/A",
    vin: order.vin || order.vehicleDetails?.vin || "N/A",
  };
}

type InspectionFinding = {
  sectionTitle: string;
  groupTitle: string;
  itemName: string;
  status: "attention" | "failed";
  comment: string;
  photos: string[];
};

function displayText(value: any, fallback = "N/A") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function collectInspectionFindings(inspectionState: AnyObj, sectionConfig: AnyObj): InspectionFinding[] {
  const findings: InspectionFinding[] = [];

  for (const sectionKey of ["exterior", "interior"]) {
    const section = sectionConfig?.[sectionKey];
    if (!section) continue;

    for (const group of section.groups || []) {
      for (const item of group.items || []) {
        const state = inspectionState?.[sectionKey]?.items?.[item.id];
        const status = String(state?.status ?? "").trim().toLowerCase();
        if (status !== "attention" && status !== "failed") continue;

        findings.push({
          sectionTitle: String(section.title ?? sectionKey),
          groupTitle: String(group.title ?? ""),
          itemName: String(item.name ?? item.id ?? "Inspection item"),
          status: status as "attention" | "failed",
          comment: String(state?.comment ?? "").trim(),
          photos: Array.isArray(state?.photos) ? state.photos.filter(Boolean) : [],
        });
      }
    }
  }

  return findings;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image."));
    reader.readAsDataURL(blob);
  });
}

async function loadImageDataUrl(src: string): Promise<string | null> {
  const value = String(src ?? "").trim();
  if (!value) return null;
  if (value.startsWith("data:image/")) return value;

  try {
    const response = await fetch(value);
    if (!response.ok) return null;
    return await blobToDataUrl(await response.blob());
  } catch {
    return null;
  }
}

function imageFormatFromDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);/);
  const fmt = String(match?.[1] ?? "jpeg").toUpperCase();
  if (fmt === "JPG") return "JPEG";
  if (fmt === "SVG+XML") return "PNG";
  return fmt;
}

async function buildInspectionPdfDocument(args: {
  orderNumber: string;
  detailData: AnyObj;
  activeJob: AnyObj;
  activeOrder: AnyObj;
  inspectionState: AnyObj;
  sectionConfig: AnyObj;
  photoUrlMap: Record<string, string>;
  actor: string;
}) {
  const findings = collectInspectionFindings(args.inspectionState, args.sectionConfig);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 16;

  const failedCount = findings.filter((finding) => finding.status === "failed").length;
  const attentionCount = findings.filter((finding) => finding.status === "attention").length;

  const setFont = (size: number, style: "normal" | "bold" = "normal", color = "#253247") => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(color);
  };

  const addFooter = () => {
    const pageCount = doc.getNumberOfPages();
    for (let pageIndex = 1; pageIndex <= pageCount; pageIndex += 1) {
      doc.setPage(pageIndex);
      doc.setDrawColor("#d7e2f0");
      doc.line(margin, pageH - 12, pageW - margin, pageH - 12);
      setFont(7, "normal", "#64748b");
      doc.text(`Inspection Report - ${args.orderNumber}`, margin, pageH - 7);
      doc.text(`Page ${pageIndex} of ${pageCount}`, pageW - margin, pageH - 7, { align: "right" });
    }
  };

  const drawPageHeader = (compact = false) => {
    doc.setFillColor("#123057");
    doc.rect(0, 0, pageW, compact ? 8 : 11, "F");
    y = compact ? 16 : 18;
    if (!compact) {
      setFont(18, "bold", "#123057");
      doc.text("Inspection Report", margin, y);
      setFont(9, "normal", "#64748b");
      doc.text("Attention and failed findings only", margin, y + 6);

      setFont(9, "bold", "#123057");
      doc.text(`Job Card: ${args.orderNumber}`, pageW - margin, y, { align: "right" });
      setFont(8, "normal", "#64748b");
      doc.text(`Generated: ${new Date().toLocaleString()}`, pageW - margin, y + 5, { align: "right" });
      y += 15;
    } else {
      setFont(9, "bold", "#123057");
      doc.text(`Inspection Report - ${args.orderNumber}`, margin, y);
      y += 7;
    }
  };

  const addPage = () => {
    doc.addPage();
    drawPageHeader(true);
  };

  const ensureSpace = (height: number) => {
    if (y + height > pageH - 18) addPage();
  };

  const drawLabelValue = (label: string, value: any, x: number, rowY: number, width: number) => {
    setFont(7, "bold", "#64748b");
    doc.text(label.toUpperCase(), x, rowY);
    setFont(8.3, "normal", "#1f2937");
    const lines = doc.splitTextToSize(displayText(value), width);
    doc.text(lines.slice(0, 2), x, rowY + 4.6);
  };

  drawPageHeader();

  doc.setFillColor("#f8fafc");
  doc.setDrawColor("#dbe7f5");
  doc.roundedRect(margin, y, contentW, 30, 2.5, 2.5, "FD");
  const colW = contentW / 3;
  drawLabelValue("Customer", args.activeJob?.customerName, margin + 5, y + 8, colW - 10);
  drawLabelValue("Mobile", args.activeJob?.mobile, margin + colW + 5, y + 8, colW - 10);
  drawLabelValue("Vehicle", args.detailData?.vehicleModel, margin + colW * 2 + 5, y + 8, colW - 10);
  drawLabelValue("Plate", args.activeJob?.vehiclePlate, margin + 5, y + 21, colW - 10);
  drawLabelValue("Inspector", args.actor, margin + colW + 5, y + 21, colW - 10);
  drawLabelValue("Expected Delivery", args.detailData?.expectedDelivery, margin + colW * 2 + 5, y + 21, colW - 10);
  y += 38;

  doc.setFillColor("#fff7ed");
  doc.roundedRect(margin, y, (contentW - 6) / 2, 15, 2, 2, "F");
  doc.setFillColor("#fef2f2");
  doc.roundedRect(margin + (contentW + 6) / 2, y, (contentW - 6) / 2, 15, 2, 2, "F");
  setFont(8, "bold", "#b45309");
  doc.text("Attention", margin + 6, y + 6);
  setFont(14, "bold", "#b45309");
  doc.text(String(attentionCount), margin + 6, y + 12);
  setFont(8, "bold", "#dc2626");
  doc.text("Failed", margin + (contentW + 6) / 2 + 6, y + 6);
  setFont(14, "bold", "#dc2626");
  doc.text(String(failedCount), margin + (contentW + 6) / 2 + 6, y + 12);
  y += 24;

  if (!findings.length) {
    ensureSpace(24);
    doc.setFillColor("#eef6ff");
    doc.setDrawColor("#cfe3fb");
    doc.roundedRect(margin, y, contentW, 22, 2, 2, "FD");
    setFont(9, "bold", "#123057");
    doc.text("No attention or failed findings were recorded.", margin + 6, y + 9);
    setFont(8, "normal", "#64748b");
    doc.text("Pass and completed items are intentionally excluded from this report.", margin + 6, y + 15);
    y += 30;
  }

  let lastSection = "";
  for (const finding of findings) {
    if (finding.sectionTitle !== lastSection) {
      ensureSpace(16);
      lastSection = finding.sectionTitle;
      setFont(11, "bold", "#123057");
      doc.text(lastSection, margin, y);
      doc.setDrawColor("#2d95d7");
      doc.line(margin, y + 2, margin + contentW, y + 2);
      y += 8;
    }

    const commentLines = doc.splitTextToSize(finding.comment || "No comments provided.", contentW - 16);
    const photoRows = Math.ceil(Math.min(finding.photos.length, 4) / 2);
    const cardHeight = 24 + Math.min(commentLines.length, 3) * 4.4 + photoRows * 31 + (finding.photos.length > 4 ? 5 : 0);
    ensureSpace(cardHeight + 4);

    const isFailed = finding.status === "failed";
    doc.setFillColor(isFailed ? "#fff5f5" : "#fffbeb");
    doc.setDrawColor(isFailed ? "#fecaca" : "#fde68a");
    doc.roundedRect(margin, y, contentW, cardHeight, 2.5, 2.5, "FD");

    setFont(9.5, "bold", "#172033");
    doc.text(finding.itemName, margin + 6, y + 7);
    setFont(7.3, "bold", isFailed ? "#dc2626" : "#b45309");
    doc.text(isFailed ? "FAILED" : "ATTENTION", pageW - margin - 6, y + 7, { align: "right" });
    setFont(7.5, "normal", "#64748b");
    doc.text(finding.groupTitle || "Inspection item", margin + 6, y + 12.2);
    setFont(8, "normal", "#334155");
    doc.text(commentLines.slice(0, 3), margin + 6, y + 18);

    let imageY = y + 18 + Math.min(commentLines.length, 3) * 4.4 + 3;
    const imageW = 39;
    const imageH = 25;
    const imageGap = 5;
    const maxImages = Math.min(finding.photos.length, 4);
    for (let idx = 0; idx < maxImages; idx += 1) {
      const photo = finding.photos[idx];
      const src = photo.startsWith("data:") ? photo : args.photoUrlMap[photo] || await resolveStorageUrl(photo).catch(() => "");
      const dataUrl = await loadImageDataUrl(src);
      const imageX = margin + 6 + (idx % 2) * (imageW + imageGap);
      if (idx > 0 && idx % 2 === 0) imageY += imageH + 5;
      doc.setDrawColor("#cbd5e1");
      doc.roundedRect(imageX, imageY, imageW, imageH, 1.5, 1.5, "S");
      if (dataUrl) {
        try {
          doc.addImage(dataUrl, imageFormatFromDataUrl(dataUrl), imageX + 1, imageY + 1, imageW - 2, imageH - 2);
        } catch {
          setFont(6.5, "normal", "#94a3b8");
          doc.text("Image unavailable", imageX + 3, imageY + 13);
        }
      } else {
        setFont(6.5, "normal", "#94a3b8");
        doc.text("Image unavailable", imageX + 3, imageY + 13);
      }
    }

    if (finding.photos.length > 4) {
      setFont(7, "normal", "#64748b");
      doc.text(`+${finding.photos.length - 4} more image(s) saved on the job card`, margin + 6, y + cardHeight - 4);
    }

    y += cardHeight + 6;
  }

  ensureSpace(34);
  doc.setFillColor("#f8fafc");
  doc.setDrawColor("#dbe7f5");
  doc.roundedRect(margin, y, contentW, 30, 2.5, 2.5, "FD");
  setFont(9, "bold", "#123057");
  doc.text("Customer Signature (Required)", margin + 6, y + 8);
  setFont(7.8, "normal", "#64748b");
  doc.text("Customer confirmation is required for the inspection findings above.", margin + 6, y + 13.5);
  doc.setDrawColor("#94a3b8");
  doc.line(margin + 6, y + 22, margin + 84, y + 22);
  doc.line(margin + 104, y + 22, margin + contentW - 6, y + 22);
  setFont(7.2, "normal", "#64748b");
  doc.text(`Name: ${displayText(args.activeJob?.customerName, "")}`, margin + 6, y + 26);
  doc.text("Date:", margin + 104, y + 26);

  addFooter();

  return {
    doc,
    blob: doc.output("blob"),
    findings,
  };
}

function InspectionModule({ currentUser }: any) {
  const { t } = useLanguage();
  const { canOption, getOptionNumber } = usePermissions();
  const { withLoading } = useGlobalLoading();
  const [inspectionConfig, setInspectionConfig] = useState<any[]>(inspectionListConfig);
  const [serviceCatalog, setServiceCatalog] = useState<ServiceCatalogItem[]>([]);
  const centralDiscountPercent = useMemo(
    () => resolveCentralDiscountPercent(canOption, getOptionNumber),
    [canOption, getOptionNumber]
  );

  const sectionConfig = useMemo(() => {
    const exterior = inspectionConfig.find((c: AnyObj) => c.category === "Exterior of the Vehicle");
    const interior = inspectionConfig.find((c: AnyObj) => c.category === "Interior of the Vehicle");

    return {
      exterior: {
        title: "Exterior Inspection",
        groups:
          exterior?.sections.map((section: AnyObj) => ({
            title: section.name,
            items: section.items.map((item: AnyObj) => ({ id: item.id, name: item.name, required: item.required })),
          })) || [],
      },
      interior: {
        title: "Interior Inspection",
        groups:
          interior?.sections.map((section: AnyObj) => ({
            title: section.name,
            items: section.items.map((item: AnyObj) => ({ id: item.id, name: item.name, required: item.required })),
          })) || [],
      },
    };
  }, [inspectionConfig]);

  const [rows, setRows] = useState<AnyObj[]>([]);
  const [loading, setLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [screenState, setScreenState] = useState<"main" | "details" | "addService">("main");
  const [activeRow, setActiveRow] = useState<AnyObj | null>(null);
  const [activeOrder, setActiveOrder] = useState<AnyObj | null>(null);
  const [detailData, setDetailData] = useState<any | null>(null);

  const [inspectionState, setInspectionState] = useState<any>(() => buildInitialInspectionState(sectionConfig));
  const [resumeAvailable, setResumeAvailable] = useState({ exterior: false, interior: false });

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [photoUrlCache, setPhotoUrlCache] = useState<Record<string, string>>({});
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const visibleInspectionDocuments = useMemo(
    () => filterVisibleDocuments(Array.isArray(activeOrder?.documents) ? activeOrder.documents : [], canOption),
    [activeOrder?.documents, canOption]
  );

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const activeDropdownRef = useRef<string | null>(null);
  const detailsCacheRef = useRef<Map<string, { order: AnyObj; detail: AnyObj; state: AnyObj | null; report: string | null }>>(new Map());

  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);

  const [showInspectionConfirmation, setShowInspectionConfirmation] = useState(false);
  const [inspectionConfirmData, setInspectionConfirmData] = useState<{ title: string; message: string; onConfirm: null | (() => void) }>({
    title: "",
    message: "",
    onConfirm: null,
  });

  const [showPopup, setShowPopup] = useState(false);
  const [popupMessage, setPopupMessage] = useState<React.ReactNode>("");

  const reportRef = useRef<HTMLDivElement | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    (Object.keys(sectionConfig) as Array<"exterior" | "interior">).forEach((sectionKey) => {
      sectionConfig[sectionKey].groups.forEach((group: AnyObj) => {
        initial[`${sectionKey}-${group.title}`] = false;
      });
    });
    setExpandedGroups(initial);
  }, [sectionConfig]);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await withLoading(loadInspectionConfig(inspectionListConfig), "Loading inspection config...");
        setInspectionConfig(cfg);
      } catch (e) {
        console.error(e);
        setInspectionConfig(inspectionListConfig);
      }
    })();
  }, [withLoading]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const catalog = await withLoading(listServiceCatalog(), "Loading service catalog...");
        if (!cancelled) setServiceCatalog(catalog);
      } catch {
        if (!cancelled) setServiceCatalog([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [withLoading]);

  const refreshOrders = async () => {
    try {
      const list = await withLoading(listJobOrdersForMain(), "Loading inspections...");
      setRows(filterInspectionRows(list));
      setCurrentPage(1);
    } catch (e) {
      console.error("Error loading inspections:", e);
    }
  };

  useEffect(() => {
    void refreshOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setCurrentPage(1), [searchQuery]);

  const filteredRows = useMemo(() => {
    if (!searchQuery) return rows;
    return rows.filter((job) => {
      return matchesSearchQuery(
        [job.id, job.createDate, job.orderType, job.customerName, job.mobile, job.vehiclePlate, job.workStatus],
        searchQuery
      );
    });
  }, [rows, searchQuery]);

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
  const paginated = useMemo(
    () => filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredRows, currentPage, pageSize]
  );

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
    const menuWidth = 200;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    flushSync(() => {
      activeDropdownRef.current = jobId;
      setDropdownPosition({ top, left });
      setActiveDropdown(jobId);
    });
  }, []);

  const resetInspectionState = () => {
    setInspectionState(buildInitialInspectionState(sectionConfig));
    setResumeAvailable({ exterior: false, interior: false });
  };

  const viewDetails = async (row: AnyObj) => {
    const rowId = String(row?.id ?? "").trim();
    if (!rowId) return;

    const cached = detailsCacheRef.current.get(rowId);
    if (cached) {
      flushSync(() => {
        setActiveRow(row);
        setActiveOrder(cached.order);
        setDetailData(cached.detail);
        setReportHtml(cached.report);
        if (cached.state) {
          setInspectionState(cached.state);
          setResumeAvailable({ exterior: true, interior: true });
          hydratedRef.current = true;
        } else {
          hydratedRef.current = false;
          resetInspectionState();
        }
        setScreenState("details");
      });
      return;
    }

    const orderStub: AnyObj = {
      ...row,
      id: rowId,
      _backendId: String(row?._backendId ?? ""),
      services: [],
      documents: [],
      roadmap: [],
      customerDetails: null,
      vehicleDetails: null,
      _parsed: {},
    };
    const detailStub = deriveDetailData(orderStub, row);

    flushSync(() => {
      setActiveRow(row);
      setActiveOrder(orderStub);
      setDetailData(detailStub);
      setScreenState("details");
      setReportHtml(null);
    });

    hydratedRef.current = false;
    resetInspectionState();

    setLoading(true);
    try {
      const order = await getJobOrderByOrderNumber(rowId);
      if (!order?._backendId) throw new Error(t("Backend order not found."));

      const resolvedDetail = deriveDetailData(order, row);
      setActiveOrder(order);
      setDetailData(resolvedDetail);

      const [state, rep] = await Promise.all([
        getInspectionState(order._backendId),
        getInspectionReport(order._backendId),
      ]);
      if (state) {
        setInspectionState(state);
        setResumeAvailable({ exterior: true, interior: true });
      }
      setReportHtml(rep);

      detailsCacheRef.current.set(rowId, {
        order,
        detail: resolvedDetail,
        state: state || null,
        report: rep ?? null,
      });

      hydratedRef.current = true;
    } catch (e) {
      console.error(e);
      setPopupMessage(`${t("Load failed:")} ${errMsg(e)}`);
      setShowPopup(true);
      setScreenState("main");
      setActiveRow(null);
      setActiveOrder(null);
      setDetailData(null);
    } finally {
      setLoading(false);
    }
  };

  const closeDetailView = () => {
    hydratedRef.current = false;
    setActiveRow(null);
    setActiveOrder(null);
    setDetailData(null);
    setReportHtml(null);
    resetInspectionState();
    setScreenState("main");
  };

  const getSectionItems = (sectionKey: "exterior" | "interior") =>
    sectionConfig[sectionKey].groups.flatMap((group: AnyObj) => group.items);

  const getProgress = (sectionKey: "exterior" | "interior") => {
    const items = getSectionItems(sectionKey);
    if (!items.length) return 0;
    const checked = items.filter((item: AnyObj) => inspectionState[sectionKey].items[item.id]?.status).length;
    return Math.round((checked / items.length) * 100);
  };

  const isRequirementsMet = (sectionKey: "exterior" | "interior") => {
    const items = getSectionItems(sectionKey);
    return items.every((item: AnyObj) => {
      const st = inspectionState[sectionKey].items[item.id];
      const status = st?.status;
      const comment = st?.comment;
      const photos = Array.isArray(st?.photos) ? st.photos : [];
      if (status === "attention" || status === "failed") {
        return comment && comment.trim().length > 0 && photos.length > 0;
      }
      return !!status;
    });
  };

  const canCompleteSection = (sectionKey: "exterior" | "interior") => {
    const items = getSectionItems(sectionKey);
    const allChecked = items.every((item: AnyObj) => inspectionState[sectionKey].items[item.id]?.status);
    return allChecked && isRequirementsMet(sectionKey);
  };

  const updateItemStatus = (sectionKey: "exterior" | "interior", itemId: string, status: string) => {
    setInspectionState((prev: AnyObj) => {
      const updated = { ...prev };
      const section = { ...updated[sectionKey] };
      const items = { ...section.items };
      const item = { ...items[itemId], status };
      if (status === "pass") item.comment = "";
      items[itemId] = item;
      section.items = items;
      updated[sectionKey] = section;
      return updated;
    });
  };

  const selectAllGroupItems = (sectionKey: "exterior" | "interior", groupItems: AnyObj[]) => {
    setInspectionState((prev: AnyObj) => {
      const updated = { ...prev };
      const section = { ...updated[sectionKey] };
      const items = { ...section.items };
      groupItems.forEach((item: AnyObj) => {
        items[item.id] = { ...items[item.id], status: "pass", comment: "" };
      });
      section.items = items;
      updated[sectionKey] = section;
      return updated;
    });
  };

  const updateItemComment = (sectionKey: "exterior" | "interior", itemId: string, comment: string) => {
    setInspectionState((prev: AnyObj) => {
      const updated = { ...prev };
      const section = { ...updated[sectionKey] };
      const items = { ...section.items };
      items[itemId] = { ...items[itemId], comment };
      section.items = items;
      updated[sectionKey] = section;
      return updated;
    });
  };

  useEffect(() => {
    const allPaths: string[] = [];
    for (const secKey of ["exterior", "interior"]) {
      const items = inspectionState?.[secKey]?.items || {};
      Object.values(items).forEach((it: any) => {
        const photos = Array.isArray(it?.photos) ? it.photos : [];
        photos.forEach((p: string) => {
          if (p && !p.startsWith("data:")) allPaths.push(p);
        });
      });
    }
    const unique = Array.from(new Set(allPaths));
    const missing = unique.filter((p) => !photoUrlCache[p]);
    if (!missing.length) return;

    let cancelled = false;
    (async () => {
      for (const p of missing) {
        try {
          const url = await resolveStorageUrl(p);
          if (cancelled) return;
          setPhotoUrlCache((prev) => ({ ...prev, [p]: url }));
        } catch {
          // ignore
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inspectionState, photoUrlCache]);

  const handlePhotoUpload = async (sectionKey: "exterior" | "interior", itemId: string, files: FileList | null) => {
    if (!activeOrder?._backendId || !activeRow?.id) return;

    const list = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;

    setLoading(true);
    try {
      const paths = await Promise.all(
        list.map((f) =>
          uploadInspectionPhoto({
            jobOrderId: activeOrder._backendId,
            orderNumber: activeRow.id,
            sectionKey,
            itemId,
            file: f,
            actor: resolveActorName(currentUser),
          })
        )
      );

      setInspectionState((prev: AnyObj) => {
        const updated = { ...prev };
        const section = { ...updated[sectionKey] };
        const items = { ...section.items };
        const it = { ...items[itemId] };
        const existing = Array.isArray(it.photos) ? it.photos : [];
        it.photos = [...existing, ...paths];
        items[itemId] = it;
        section.items = items;
        updated[sectionKey] = section;
        return updated;
      });
    } catch (e) {
      console.error(e);
      setPopupMessage(`Photo upload failed: ${errMsg(e)}`);
      setShowPopup(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (!activeOrder?._backendId || !activeRow?.id) return;

    const t = setTimeout(() => {
      const status: any = inspectionState?.exterior?.paused || inspectionState?.interior?.paused ? "PAUSED" : "IN_PROGRESS";
      const actorEmail = resolveActorName(currentUser);
      void upsertInspectionState({
        jobOrderId: activeOrder._backendId,
        orderNumber: activeRow.id,
        status,
        inspectionState,
        actor: actorEmail,
      });
    }, 200);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectionState]);

  const startInspection = async (sectionKey: "exterior" | "interior") => {
    if (!activeOrder || !activeOrder._backendId || !activeRow) return;

    setInspectionState((prev: AnyObj) => ({
      ...prev,
      [sectionKey]: { ...prev[sectionKey], started: true, paused: false },
    }));

    setLoading(true);
    try {
      const now = new Date().toLocaleString();
      const actorEmail = resolveActorName(currentUser);
      let rm = ensureRoadmap(activeOrder, currentUser);

      rm = roadmapMark(rm, "New Request", {
        stepStatus: "Completed",
        status: "Completed",
        endTimestamp: now,
        actionBy: actorEmail,
      });

      rm = roadmapMark(rm, "Inspection", {
        stepStatus: "Active",
        status: "InProgress",
        startTimestamp: rm.find((s) => s.step === "Inspection")?.startTimestamp || now,
        actionBy: actorEmail,
      });

      const updated = {
        ...activeOrder,
        workStatus: "Inspection",
        workStatusLabel: "Inspection",
        updatedBy: actorEmail,
        roadmap: rm,
      } as AnyObj;

      const { backendId } = await upsertJobOrder(updated);
      updated._backendId = backendId;

      setActiveOrder(updated);
      await Promise.all([
        refreshOrders(),
        upsertInspectionState({
          jobOrderId: updated._backendId,
          orderNumber: activeRow.id,
          status: "IN_PROGRESS",
          inspectionState,
          actor: actorEmail,
        }),
      ]);

      setPopupMessage(t("Inspection started."));
      setShowPopup(true);
    } catch (e) {
      console.error(e);
      setPopupMessage(`${t("Start failed:")} ${errMsg(e)}`);
      setShowPopup(true);
    } finally {
      setLoading(false);
    }
  };

  const saveAndPause = (sectionKey: "exterior" | "interior") => {
    const sectionLabel = sectionKey === "exterior" ? t("Exterior") : t("Interior");
    setInspectionConfirmData({
      title: t("Save and Pause Inspection"),
      message: `${t("Save and pause")} ${sectionLabel} ${t("inspection? You can resume later.")}`,
      onConfirm: () => {
        setInspectionState((prev: AnyObj) => ({
          ...prev,
          [sectionKey]: { ...prev[sectionKey], paused: true, started: true },
        }));
        setResumeAvailable({ exterior: true, interior: true });
        setShowInspectionConfirmation(false);
        setPopupMessage(`${sectionLabel} ${t("inspection saved and paused.")}`);
        setShowPopup(true);
      },
    });
    setShowInspectionConfirmation(true);
  };

  const resumeInspection = (sectionKey: "exterior" | "interior") => {
    const sectionLabel = sectionKey === "exterior" ? t("Exterior") : t("Interior");
    setInspectionState((prev: AnyObj) => ({
      ...prev,
      [sectionKey]: { ...prev[sectionKey], started: true, paused: false },
    }));
    setPopupMessage(`${sectionLabel} ${t("inspection resumed.")}`);
    setShowPopup(true);
  };

  const markNotRequired = (sectionKey: "exterior" | "interior") => {
    const sectionLabel = sectionKey === "exterior" ? t("Exterior") : t("Interior");
    setInspectionConfirmData({
      title: t("Mark as Not Required"),
      message: `${t("Mark")} ${sectionLabel} ${t("inspection as not required?")}`,
      onConfirm: () => {
        setInspectionState((prev: AnyObj) => ({
          ...prev,
          [sectionKey]: { ...prev[sectionKey], started: false, completed: true, paused: false, notRequired: true },
        }));
        setShowInspectionConfirmation(false);
      },
    });
    setShowInspectionConfirmation(true);
  };

  const completeSection = (sectionKey: "exterior" | "interior") => {
    const sectionLabel = sectionKey === "exterior" ? t("Exterior") : t("Interior");
    setInspectionConfirmData({
      title: t("Complete Inspection"),
      message: `${t("Complete")} ${sectionLabel} ${t("inspection?")}`,
      onConfirm: () => {
        setInspectionState((prev: AnyObj) => ({
          ...prev,
          [sectionKey]: { ...prev[sectionKey], completed: true, started: false, paused: false },
        }));
        setPopupMessage(`${sectionLabel} ${t("inspection completed successfully.")}`);
        setShowPopup(true);
        setShowInspectionConfirmation(false);
      },
    });
    setShowInspectionConfirmation(true);
  };

  const canFinish =
    (inspectionState.exterior.completed || inspectionState.exterior.notRequired) &&
    (inspectionState.interior.completed || inspectionState.interior.notRequired);

  const finishInspection = () => {
    setInspectionConfirmData({
      title: t("Finish Inspection"),
      message: t("Finish the inspection? Status will change to Service_Operation."),
      onConfirm: async () => {
        if (!activeOrder || !activeRow) return;

        setLoading(true);
        try {
          const photoMap: Record<string, string> = { ...photoUrlCache };
          const allPhotos: string[] = [];

          for (const secKey of ["exterior", "interior"]) {
            const items = inspectionState?.[secKey]?.items || {};
            Object.values(items).forEach((it: any) => {
              const photos = Array.isArray(it?.photos) ? it.photos : [];
              photos.forEach((p: string) => allPhotos.push(p));
            });
          }

          const unique = Array.from(new Set(allPhotos)).filter((p) => p && !p.startsWith("data:"));
          for (const p of unique) {
            if (!photoMap[p]) {
              try {
                photoMap[p] = await resolveStorageUrl(p);
              } catch {
                // ignore
              }
            }
          }

          const actorEmail = resolveActorName(currentUser);
          const dd = deriveDetailData(activeOrder, activeRow);
          const html = buildInspectionReportHtml({
            orderNumber: activeRow.id,
            detailData: dd,
            activeJob: activeRow,
            inspectionState,
            sectionConfig,
            photoUrlMap: photoMap,
          });
          const { blob: reportPdfBlob } = await buildInspectionPdfDocument({
            orderNumber: activeRow.id,
            detailData: dd,
            activeJob: activeRow,
            activeOrder,
            inspectionState,
            sectionConfig,
            photoUrlMap: photoMap,
            actor: actorEmail,
          });

          await saveInspectionReport({
            jobOrderId: activeOrder._backendId,
            orderNumber: activeRow.id,
            html,
            actor: actorEmail,
          });

          const reportStoragePath = `job-orders/${activeRow.id}/inspection/Inspection_Report_${safeFileName(activeRow.id)}_${Date.now()}.pdf`;
          await uploadData({
            path: reportStoragePath,
            data: reportPdfBlob,
            options: { contentType: "application/pdf" },
          }).result;

          const existingDocs = Array.isArray(activeOrder?.documents) ? activeOrder.documents : [];
          const docsWithoutOldInspection = existingDocs.filter(
            (d: any) => String(d?.type ?? "").trim().toLowerCase() !== "inspection report"
          );
          const inspectionDoc = {
            id: `DOC-INSP-${Date.now()}`,
            name: `Inspection_Report_${activeRow.id}.pdf`,
            type: "Inspection Report",
            category: "Inspection",
            addedAt: new Date().toISOString(),
            uploadedBy: actorEmail,
            storagePath: reportStoragePath,
          };
          const updatedDocs = [...docsWithoutOldInspection, inspectionDoc];

          const now = new Date().toLocaleString();
          let rm = ensureRoadmap(activeOrder, currentUser);

          rm = roadmapMark(rm, "Inspection", {
            stepStatus: "Completed",
            status: "Completed",
            endTimestamp: now,
            actionBy: actorEmail,
          });

          rm = roadmapMark(rm, "Service_Operation", {
            stepStatus: "Active",
            status: "InProgress",
            startTimestamp: rm.find((s) => isServiceOperationStepName(s.step))?.startTimestamp || now,
            actionBy: actorEmail,
          });

          const updated = {
            ...activeOrder,
            workStatus: "Service_Operation",
            workStatusLabel: "Service_Operation",
            updatedBy: actorEmail,
            roadmap: rm,
            documents: updatedDocs,
          } as AnyObj;

          const { backendId } = await upsertJobOrder(updated);
          updated._backendId = backendId;
          setActiveOrder(updated);
          setDetailData(dd);
          setReportHtml(html);
          setPhotoUrlCache(photoMap);

          await upsertInspectionState({
            jobOrderId: updated._backendId,
            orderNumber: activeRow.id,
            status: "COMPLETED",
            inspectionState,
            actor: actorEmail,
          });

          void refreshOrders();
          detailsCacheRef.current.set(String(activeRow.id), {
            order: updated,
            detail: dd,
            state: inspectionState,
            report: html,
          });

          setPopupMessage(t("Inspection finished! Status changed to Service_Operation and PDF report generated."));
          setShowPopup(true);

          setShowInspectionConfirmation(false);
        } catch (e) {
          console.error(e);
          setPopupMessage(`${t("Finish failed:")} ${errMsg(e)}`);
          setShowPopup(true);
        } finally {
          setLoading(false);
        }
      },
    });

    setShowInspectionConfirmation(true);
  };

  const handleShowCancelConfirmation = (orderNumber: string) => {
    setCancelOrderId(orderNumber);
    setShowCancelConfirmation(true);
    setActiveDropdown(null);
  };

  const handleCancelOrder = async () => {
    if (!cancelOrderId) return;

    setLoading(true);
    try {
      await cancelJobOrderByOrderNumber(cancelOrderId);
      void refreshOrders();
      setPopupMessage(
        <>
          <span style={{ fontWeight: 700, color: "#16a34a", display: "block", marginBottom: 8 }}>
            <i className="fas fa-check-circle"></i> {t("Order Cancelled Successfully")}
          </span>
          <span>
            {t("Job Order ID:")} <strong>{cancelOrderId}</strong>
          </span>
        </>
      );
      setShowPopup(true);
    } catch (e) {
      console.error(e);
      setPopupMessage(`${t("Cancel failed:")} ${errMsg(e)}`);
      setShowPopup(true);
    } finally {
      setLoading(false);
      setShowCancelConfirmation(false);
      setCancelOrderId(null);
    }
  };

  const downloadReport = async () => {
    if (!activeRow?.id || !activeOrder) return;
    setLoading(true);
    try {
      const dd = detailData || deriveDetailData(activeOrder, activeRow);
      const { doc } = await buildInspectionPdfDocument({
        orderNumber: activeRow.id,
        detailData: dd,
        activeJob: activeRow,
        activeOrder,
        inspectionState,
        sectionConfig,
        photoUrlMap: photoUrlCache,
        actor: resolveActorName(currentUser),
      });
      doc.save(`Inspection_Report_${safeFileName(activeRow.id)}.pdf`);
    } catch (e) {
      console.error(e);
      setPopupMessage(`${t("Download failed:")} ${errMsg(e)}`);
      setShowPopup(true);
    } finally {
      setLoading(false);
    }
  };

  const [currentAddServiceOrder, setCurrentAddServiceOrder] = useState<any>(null);

  const handleAddService = () => {
    if (!activeOrder) return;
    setCurrentAddServiceOrder(activeOrder);
    setScreenState("addService");
  };

  const handleAddServiceSubmit = async (_: any) => {
    // keep your existing logic if you want. Not needed for the crash fix.
    setScreenState("details");
  };

  return (
    <div className="inspection-module" ref={reportRef}>
      {screenState === "main" && (
        <div className="app-container customer-page customer-dashboard-shell theme-elegant-glass jc-main-screen">
          <main className="main-content customer-dashboard-main">
            <section
              className="jc-main-hero"
              style={{ position: "relative", overflow: "hidden", marginBottom: 10, background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 12, boxShadow: "0 10px 24px rgba(51, 84, 160, 0.08)", border: "1px solid #DDE7F6" }}
            >
              <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />
              <div aria-hidden="true" style={{ position: "absolute", top: -18, right: -22, height: 96, width: 202, background: "linear-gradient(to bottom left, rgba(67, 24, 255, 0.18), rgba(67, 24, 255, 0))", borderBottomLeftRadius: 999, pointerEvents: "none" }} />
              <div aria-hidden="true" style={{ position: "absolute", right: 28, top: 26, width: 44, height: 44, borderRadius: 14, opacity: 0.35, backgroundImage: "radial-gradient(circle, rgba(116, 137, 191, 0.55) 1.4px, transparent 1.5px)", backgroundSize: "10px 10px", pointerEvents: "none" }} />

              <div style={{ position: "relative", zIndex: 1, padding: "17px 24px 17px", display: "grid", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 17 }}>
                    <div style={{ width: 42, height: 42, borderRadius: "50%", background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)", border: "1px solid #D8E1F7", boxShadow: "0 0 0 4px rgba(101, 92, 255, 0.08), 0 6px 14px rgba(71, 88, 180, 0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5D54FF" }}>
                      <i className="fas fa-clipboard-check" style={{ fontSize: 16 }} />
                    </div>
                    <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#102A68", lineHeight: 1.15, letterSpacing: "-0.03em" }}>{t("Inspection Module")}</h1>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      <i className="fas fa-search" style={{ position: "absolute", left: 10, color: "#8C9ABF", fontSize: 12, pointerEvents: "none" }} />
                      <input
                        type="text"
                        style={{ paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderRadius: 8, border: "1px solid #DDE7F6", background: "#FAFBFF", color: "#102A68", fontSize: "0.88rem", fontWeight: 700, outline: "none", minWidth: 220 }}
                        placeholder={t("Search by any inspection details")}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoComplete="off"
                      />
                    </div>

                    <button
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", fontSize: "0.88rem", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}
                      onClick={() => void refreshOrders()}
                      disabled={loading}
                      type="button"
                    >
                      <i className="fas fa-sync" /> {loading ? t("Loading...") : t("Refresh")}
                    </button>
                  </div>
                </div>

                <p style={{ margin: 0, marginLeft: 59, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: "#8C9ABF", fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1.35 }}>
                  <span aria-hidden="true" style={{ width: 2, height: 12, borderRadius: 999, background: "linear-gradient(180deg, #25D6E8 0%, #4E40F8 100%)", boxShadow: "0 0 0 2px rgba(78, 64, 248, 0.10)" }} />
                  <span style={{ color: "#7E8FB9" }}>{t("Track incoming inspections, move active vehicles forward, and keep the queue review-ready.")}</span>
                </p>
              </div>
            </section>

            <section className="customer-top-meta-row jc-main-meta-row">
              <div className="search-stats customer-search-stats">
                {loading
                  ? t("Loading...")
                  : filteredRows.length === 0
                  ? t("No jobs found")
                  : `${t("Showing")} ${Math.min((currentPage - 1) * pageSize + 1, filteredRows.length)}-${Math.min(
                      currentPage * pageSize,
                      filteredRows.length
                    )} ${t("of")} ${filteredRows.length} ${t("inspection jobs")}`}
              </div>

              <div className="pagination-controls customer-page-size-control">
                <div className="records-per-page">
                  <label htmlFor="inspectionPageSize">{t("Records per page:")}</label>
                  <select
                    id="inspectionPageSize"
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
            </section>

            <section className="results-section customer-results-section jc-main-results-section">
              <div className="customer-table-card jc-main-table-card">
              {filteredRows.length > 0 ? (
                <div className="table-wrapper customer-table-card-shell jc-job-table-shell">
                  <table className="job-order-table customer-dashboard-table jc-job-table">
                    <thead>
                      <tr>
                        <th>Create Date</th>
                        <th>{t("Job Card ID")}</th>
                        <th>{t("Order Type")}</th>
                        <th>{t("Customer Name")}</th>
                        <th>{t("Mobile Number")}</th>
                        <th>{t("Vehicle Plate")}</th>
                        <th>{t("Work Status")}</th>
                        <th>{t("Actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((job) => (
                        <tr key={job.id}>
                          <td className="date-column" data-label={t("Create Date")}>{job.createDate}</td>
                          <td data-label={t("Job Card ID")}>{job.id}</td>
                          <td data-label={t("Order Type")}>
                            <span className={`order-type-badge ${job.orderType === "New Job Order" ? "order-type-new-job" : "order-type-service"}`}>
                              {job.orderType}
                            </span>
                          </td>
                          <td data-label={t("Customer Name")}>{job.customerName}</td>
                          <td data-label={t("Mobile Number")}>{job.mobile}</td>
                          <td data-label={t("Vehicle Plate")}>{job.vehiclePlate}</td>
                          <td data-label={t("Work Status")}>
                            <span className={`status-badge ${job.workStatus === "New Request" ? "status-new-request" : "status-inspection"}`}>
                              {job.workStatus}
                            </span>
                          </td>
                          <td data-label={t("Actions")}>
                            <PermissionGate moduleId="inspection" optionId="inspection_actions">
                              <div className="action-dropdown-container">
                                <button className={`btn-action-dropdown ${activeDropdown === job.id ? "active" : ""}`} onClick={(e) => handleOpenDropdown(e.currentTarget as HTMLElement, job.id)}>
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
              ) : (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "#999" }}>
                  <p>
                    <i className="fas fa-inbox" style={{ fontSize: "36px", marginBottom: "10px" }}></i>
                  </p>
                  <p>{t("No inspection jobs found")}</p>
                </div>
              )}
              </div>
            </section>
              {totalPages > 1 && (
                <div className="pagination">
                  <button className="pagination-btn" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
                    <i className="fas fa-chevron-left"></i>
                  </button>
                  <div className="page-numbers">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
                      let pageNum;
                      if (totalPages <= 5) pageNum = index + 1;
                      else {
                        const start = Math.max(1, currentPage - 2);
                        const end = Math.min(totalPages, start + 4);
                        const adjustedStart = Math.max(1, end - 4);
                        pageNum = adjustedStart + index;
                      }
                      return (
                        <button key={pageNum} className={`pagination-btn ${pageNum === currentPage ? "active" : ""}`} onClick={() => setCurrentPage(pageNum)}>
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  <button className="pagination-btn" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                    <i className="fas fa-chevron-right"></i>
                  </button>
                </div>
              )}
          </main>


        </div>
      )}

      {screenState === "addService" && currentAddServiceOrder && (
        <AddServiceScreen
          order={currentAddServiceOrder}
          products={serviceCatalog}
          maxDiscountPercent={centralDiscountPercent}
          onClose={() => setScreenState("details")}
          onSubmit={handleAddServiceSubmit}
        />
      )}

      {screenState === "details" && activeRow && activeOrder && detailData && (
        <div className="detail-view pim-details-screen customer-details-screen dashboard-customer-details-bg customer-details-exact theme-elegant-glass jc-skin jo-details-v3" id="detailView">
          <div className="detail-header pim-details-header">
            <div className="detail-title-container">
              <h2>
                <i className="fas fa-clipboard-list"></i> {t("Inspection Details - Job Order #")}
                <span id="detailJobIdHeader">{activeRow.id}</span>
              </h2>
            </div>
            <button className="close-detail pim-btn-close-details" onClick={closeDetailView}>
              <i className="fas fa-times"></i> {t("Close Details")}
            </button>
          </div>

          <div className="detail-container pim-details-body">
            <div className="detail-cards pim-details-grid">
              <PermissionGate moduleId="inspection" optionId="inspection_summary">
                <>
                  <UnifiedJobOrderSummaryCard
                    order={activeOrder}
                    className="jh-summary-card"
                    createdByOverride={detailData?.createdBy || "—"}
                    paymentStatusOverride={detailData?.paymentStatus}
                    workStatusOverride={detailData?.workStatus}
                  />
                  {reportHtml && (
                    <div className="inspection-summary-actions">
                      <PermissionGate moduleId="inspection" optionId="inspection_download">
                        <button className="btn btn-primary" onClick={downloadReport} disabled={loading}>
                          <i className="fas fa-download"></i> {loading ? t("Working...") : t("Download Inspection Report")}
                        </button>
                      </PermissionGate>
                      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
                        {t("Generated:")} {
                          String(
                            Array.isArray(visibleInspectionDocuments)
                              ? (
                                  visibleInspectionDocuments.find(
                                    (d: any) => String(d?.type ?? "").trim().toLowerCase() === "inspection report"
                                  )?.addedAt ??
                                  visibleInspectionDocuments.find(
                                    (d: any) => String(d?.type ?? "").trim().toLowerCase() === "inspection report"
                                  )?.createdAt ??
                                  "—"
                                )
                              : "—"
                          )
                        }
                      </div>
                    </div>
                  )}
                </>
              </PermissionGate>

              <PermissionGate moduleId="inspection" optionId="inspection_summary">
                <UnifiedCustomerInfoCard order={activeOrder} className="cv-unified-card" />
              </PermissionGate>

              <PermissionGate moduleId="inspection" optionId="inspection_summary">
                <UnifiedVehicleInfoCard order={activeOrder} className="cv-unified-card" />
              </PermissionGate>

              <PermissionGate moduleId="inspection" optionId="inspection_services">
                <div className="pim-detail-card">
                  <div className="inspection-service-head">
                    <h3><i className="fas fa-tasks"></i> {t("Services Summary")} ({Array.isArray(activeOrder.services) ? activeOrder.services.length : 0})</h3>
                    <PermissionGate moduleId="inspection" optionId="inspection_addservice">
                      <button className="btn-add-service inspection-add-service-btn" onClick={handleAddService}>
                        <i className="fas fa-plus-circle"></i> {t("Add Service")}
                      </button>
                    </PermissionGate>
                  </div>
                  <div className="pim-services-list">
                    {Array.isArray(activeOrder.services) && activeOrder.services.length > 0 ? (
                      activeOrder.services.map((s: any, idx: number) => (
                        <div key={idx} className="pim-service-item">
                          <div className="pim-service-header">
                            <span className="pim-service-name" data-no-translate="true">{toBilingualName(s?.name, s?.nameAr)}</span>
                            <span className={`status-badge ${getServiceStatusClass(s.status || "New")}`}>{t(String(s.status || "New"))}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="inspection-empty-inline">{t("No services added yet")}</div>
                    )}
                  </div>
                </div>
              </PermissionGate>

              <PermissionGate moduleId="inspection" optionId="inspection_billing">
                <UnifiedBillingInvoicesSection order={activeOrder} />
              </PermissionGate>

              <PermissionGate moduleId="inspection" optionId="inspection_documents">
                <div className="pim-card pim-detail-card pim-card-full">
                  <h3><i className="fas fa-folder-open"></i> {t("Documents")}</h3>

                  {visibleInspectionDocuments.length > 0 ? (
                    <div className="pim-docs">
                      {visibleInspectionDocuments.map((doc: any, idx: number) => (
                        <div key={doc.id || idx} className="pim-doc">
                          <div className="pim-doc-left">
                            <div className="pim-doc-name">{doc.name || `${t("Document")} ${idx + 1}`}</div>
                            <div className="pim-doc-meta">
                              {doc.type ? t(String(doc.type)) : ""}
                              {doc.category ? ` • ${doc.category}` : ""}
                              {String(doc?.addedAt ?? doc?.generatedAt ?? doc?.createdAt ?? doc?.uploadedAt ?? doc?.timestamp ?? "").trim()
                                ? ` • ${t("Generated:")} ${String(doc?.addedAt ?? doc?.generatedAt ?? doc?.createdAt ?? doc?.uploadedAt ?? doc?.timestamp ?? "").trim()}`
                                : ""}
                            </div>
                          </div>

                          <PermissionGate moduleId="inspection" optionId="inspection_download">
                            <button
                              type="button"
                              className="pim-btn pim-btn-primary"
                              onClick={async () => {
                                const raw = String(doc.storagePath || doc.url || "").trim();
                                const linkUrl = raw
                                  ? (raw.startsWith("http://") || raw.startsWith("https://")
                                    ? raw
                                    : await resolveStorageUrl(raw))
                                  : "";
                                if (!linkUrl) return;
                                window.open(linkUrl, "_blank", "noopener,noreferrer");
                              }}
                            >
                              <i className="fas fa-download"></i> {t("Download")}
                            </button>
                          </PermissionGate>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="pim-empty-inline">{t("No documents available.")}</div>
                  )}
                </div>
              </PermissionGate>
            </div>

            <PermissionGate moduleId="inspection" optionId="inspection_list">
              <div className="epm-detail-card inspection-list-card">
                <div className="inspection-list-head">
                  <h3><i className="fas fa-clipboard-check"></i> {t("Inspection List")}</h3>
                </div>

                <div className="inspection-section">
                  {(["exterior", "interior"] as const).map((sectionKey) => {
                    const sectionState = inspectionState[sectionKey];
                    const progress = getProgress(sectionKey);
                    const progressText = `${progress}%`;

                    const isPaused = sectionState.paused;
                    const isCompleted = sectionState.completed;
                    const isNotRequired = sectionState.notRequired;
                    const isStarted = sectionState.started;

                    const canComplete = canCompleteSection(sectionKey);
                    const startLabel = resumeAvailable[sectionKey] ? "Continue Inspection" : "Start Inspection";

                    return (
                      <div className="inspection-card" key={sectionKey}>
                        <div className="inspection-header">
                          <div className="header-title-section">
                            <h3 style={{ margin: 0 }}>
                              {sectionConfig[sectionKey].title}
                              {!isCompleted && !isNotRequired && isStarted && !isPaused && (
                                  <span className="status-indicator status-active"><i className="fas fa-spinner fa-spin"></i> {t("In Progress")}</span>
                              )}
                              {isPaused && <span className="status-indicator status-paused"><i className="fas fa-pause"></i> {t("Paused")}</span>}
                              {isCompleted && <span className="status-indicator status-active"><i className="fas fa-check"></i> {t("Completed")}</span>}
                            </h3>
                          </div>

                          <div className="inspection-actions">
                            {!isCompleted && !isNotRequired && (
                              <PermissionGate moduleId="inspection" optionId="inspection_start">
                                <button className="inspection-btn btn-start" onClick={() => void startInspection(sectionKey)} style={{ display: isStarted ? "none" : "flex" }}>
                                  <i className="fas fa-play"></i> {t(startLabel)}
                                </button>
                              </PermissionGate>
                            )}

                            {!isCompleted && !isNotRequired && (
                              <button className="inspection-btn btn-save" onClick={() => saveAndPause(sectionKey)} style={{ display: isStarted && !isPaused ? "flex" : "none" }}>
                                <i className="fas fa-save"></i> {t("Save & Pause")}
                              </button>
                            )}

                            {!isCompleted && !isNotRequired && (
                              <PermissionGate moduleId="inspection" optionId="inspection_resume">
                                <button className="inspection-btn btn-resume" onClick={() => resumeInspection(sectionKey)} disabled={!resumeAvailable[sectionKey]}>
                                  <i className="fas fa-play-circle"></i> {t("Resume")}
                                </button>
                              </PermissionGate>
                            )}

                            {!isCompleted && !isNotRequired && (
                              <PermissionGate moduleId="inspection" optionId="inspection_complete">
                                <button className="inspection-btn btn-complete" onClick={() => completeSection(sectionKey)} disabled={!canComplete}>
                                  <i className="fas fa-check-circle"></i> {t("Complete Inspection")}
                                </button>
                              </PermissionGate>
                            )}

                            {!isCompleted && !isNotRequired && (
                              <PermissionGate moduleId="inspection" optionId="inspection_notrequired">
                                <button className="inspection-btn btn-not-required" onClick={() => markNotRequired(sectionKey)}>
                                  <i className="fas fa-ban"></i> {t("Not Required")}
                                </button>
                              </PermissionGate>
                            )}
                          </div>
                        </div>

                        {isStarted && !isNotRequired && (
                          <div className="inspection-progress">
                            <div>{t("Progress:")} <span>{progressText}</span></div>
                            <div className="progress-bar"><div className="progress-fill" style={{ width: progressText }} /></div>
                          </div>
                        )}

                        {isStarted && !isNotRequired && (
                          <div className="vehicle-sides">
                            {sectionConfig[sectionKey].groups.map((group: AnyObj) => {
                              const groupKey = `${sectionKey}-${group.title}`;
                              const isGroupExpanded = expandedGroups[groupKey] !== false;

                              return (
                                <div className="side-section" key={group.title}>
                                  <div className="side-title">
                                    <button className="group-toggle-btn" onClick={() => setExpandedGroups((p) => ({ ...p, [groupKey]: !p[groupKey] }))} title={isGroupExpanded ? "Collapse" : "Expand"}>
                                      <i className={`fas fa-chevron-${isGroupExpanded ? "down" : "right"}`} />
                                    </button>
                                    <span>{group.title}</span>
                                    <button 
                                      className="select-all-btn" 
                                      onClick={() => selectAllGroupItems(sectionKey, group.items)} 
                                      title={t("Select all items as Pass")}
                                    >
                                      <i className="fas fa-check-double"></i> {t("Select All")}
                                    </button>
                                  </div>

                                  {isGroupExpanded && (
                                    <div className="section-items-row">
                                      {group.items.map((item: AnyObj) => {
                                        const itemState = sectionState.items[item.id];
                                        const showComments = itemState?.status === "attention" || itemState?.status === "failed";

                                        return (
                                          <div key={item.id} className="inspection-item-wrapper">
                                            <div className="inspection-item">
                                              <div className="item-name">{item.name}</div>
                                              <div className="checkbox-group">
                                                <label className="checkbox-option">
                                                  <input type="radio" name={`${sectionKey}-${item.id}`} value="pass" checked={itemState?.status === "pass"} onChange={() => updateItemStatus(sectionKey, item.id, "pass")} />
                                                  <span className="status-label green">{t("Pass")}</span>
                                                </label>
                                                <label className="checkbox-option">
                                                  <input type="radio" name={`${sectionKey}-${item.id}`} value="attention" checked={itemState?.status === "attention"} onChange={() => updateItemStatus(sectionKey, item.id, "attention")} />
                                                  <span className="status-label amber">{t("Attention")}</span>
                                                </label>
                                                <label className="checkbox-option">
                                                  <input type="radio" name={`${sectionKey}-${item.id}`} value="failed" checked={itemState?.status === "failed"} onChange={() => updateItemStatus(sectionKey, item.id, "failed")} />
                                                  <span className="status-label red">{t("Failed")}</span>
                                                </label>
                                              </div>
                                            </div>

                                            {showComments && (
                                              <div className="comment-section">
                                                <textarea placeholder={t("Add comments...")} value={itemState?.comment} onChange={(e) => updateItemComment(sectionKey, item.id, e.target.value)} />
                                                <div className="photo-upload">
                                                  <input
                                                    id={`${sectionKey}-${item.id}-photo`}
                                                    className="photo-input"
                                                    type="file"
                                                    accept="image/*"
                                                    multiple
                                                    onChange={(event) => {
                                                      void handlePhotoUpload(sectionKey, item.id, event.target.files);
                                                      event.currentTarget.value = "";
                                                    }}
                                                  />
                                                  <button type="button" className="photo-btn" onClick={() => document.getElementById(`${sectionKey}-${item.id}-photo`)?.click()}>
                                                    <i className="fas fa-camera"></i> {t("Upload/Take Photo")}
                                                  </button>
                                                  <span className="photo-requirement">{t("* Required for Amber/Red status")}</span>
                                                </div>

                                                {Array.isArray(itemState?.photos) && itemState.photos.length > 0 && (
                                                  <div className="photo-preview">
                                                    {itemState.photos.map((p: string, idx: number) => {
                                                      const src = p.startsWith("data:") ? p : photoUrlCache[p] || "";
                                                      return (
                                                        <div key={`${item.id}-photo-${idx}`} className="photo-preview-item">
                                                          {src ? <img src={src} alt={`${t("Inspection")} ${item.name}`} /> : <div style={{ padding: 10, color: "#999" }}>{t("Loading...")}</div>}
                                                        </div>
                                                      );
                                                    })}
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="inspection-list-footer">
                  <PermissionGate moduleId="inspection" optionId="inspection_finish">
                    <button className="finish-btn inspection-finish-btn" disabled={!canFinish || loading} onClick={finishInspection}>
                      <i className="fas fa-flag-checkered"></i> {loading ? t("Working...") : t("Finish Inspection")}
                    </button>
                  </PermissionGate>
                </div>
              </div>
            </PermissionGate>
          </div>
        </div>
      )}

      {showPopup && <SuccessPopup isVisible={true} onClose={() => setShowPopup(false)} message={popupMessage} />}

      <div className={`cancel-modal-overlay ${showInspectionConfirmation ? "active" : ""}`}>
        <div className="cancel-modal">
          <div className="cancel-modal-header">
            <h3><i className="fas fa-exclamation-triangle"></i> {inspectionConfirmData.title}</h3>
          </div>
          <div className="cancel-modal-body">
            <div className="cancel-warning">
              <i className="fas fa-exclamation-circle"></i>
              <div className="cancel-warning-text"><p>{inspectionConfirmData.message}</p></div>
            </div>
            <div className="cancel-modal-actions">
              <button className="btn-cancel" onClick={() => setShowInspectionConfirmation(false)}>
                <i className="fas fa-times"></i> {t("Cancel")}
              </button>
              <button className="btn-confirm-cancel" onClick={() => inspectionConfirmData.onConfirm && inspectionConfirmData.onConfirm()} disabled={loading}>
                <i className="fas fa-check"></i> {loading ? t("Working...") : t("Confirm")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`cancel-modal-overlay ${showCancelConfirmation && cancelOrderId ? "active" : ""}`}>
        <div className="cancel-modal">
          <div className="cancel-modal-header">
            <h3><i className="fas fa-exclamation-triangle"></i> {t("Confirm Cancellation")}</h3>
          </div>
          <div className="cancel-modal-body">
            <div className="cancel-warning">
              <i className="fas fa-exclamation-circle"></i>
              <div className="cancel-warning-text">
                <p>{t("You are about to cancel order")} <strong>{cancelOrderId}</strong>.</p>
                <p>{t("This action cannot be undone.")}</p>
              </div>
            </div>
            <div className="cancel-modal-actions">
              <button className="btn-cancel" onClick={() => { setShowCancelConfirmation(false); setCancelOrderId(null); }}>
                <i className="fas fa-times"></i> {t("Keep Order")}
              </button>
              <button className="btn-confirm-cancel" onClick={() => void handleCancelOrder()} disabled={loading}>
                <i className="fas fa-ban"></i> {loading ? t("Cancelling...") : t("Cancel Order")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <div
            className={`action-dropdown-menu show action-dropdown-menu-fixed ${activeDropdown ? "open" : "closed"}`}
            style={activeDropdown ? { top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` } : { top: "-9999px", left: "-9999px" }}
          >
            <PermissionGate moduleId="inspection" optionId="inspection_viewdetails">
              <button
                className="dropdown-item view"
                onClick={() => {
                  if (!activeDropdown) return;
                  const target = activeDropdown;
                  const r = filteredRows.find((x) => x.id === target);
                  activeDropdownRef.current = null;
                  setActiveDropdown(null);
                  if (r) void viewDetails(r);
                }}
              >
                <i className="fas fa-eye"></i> {t("View Details")}
              </button>
            </PermissionGate>
            <PermissionGate moduleId="inspection" optionId="inspection_cancel">
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
                >
                  <i className="fas fa-times-circle"></i> {t("Cancel Order")}
                </button>
              </>
            </PermissionGate>
          </div>,
          document.body
        )}
    </div>
  );
}

function AddServiceScreen({ order, products = [], maxDiscountPercent = 0, onClose, onSubmit }: any) {
  const { t } = useLanguage();
  const [selectedServices, setSelectedServices] = useState<any[]>([]);
  const [discountPercent, setDiscountPercent] = useState(0);
  const vehicleType = order?.vehicleDetails?.type || "SUV";

  const handleToggleService = (product: any) => {
    const price = resolveServicePriceForVehicleType(product, vehicleType);
    const productKey = String(product.serviceCode || product.id || product.name);
    const isSelected = selectedServices.some((s: any) => String(s.serviceCode || s.catalogId || s.name) === productKey);
    if (isSelected) {
      setSelectedServices(selectedServices.filter((s: any) => String(s.serviceCode || s.catalogId || s.name) !== productKey));
    } else {
      setSelectedServices([
        ...selectedServices,
        {
          name: product.name,
          nameAr: product.nameAr,
          price,
          serviceCode: product.serviceCode || undefined,
          catalogId: product.id || undefined,
        },
      ]);
    }
  };

  const [inFilterCategory, setInFilterCategory] = useState("all");
  const [inFilterType, setInFilterType] = useState("all");

  const inCategories = useMemo(() => {
    const catMap = new Map<string, { id: string; nameEn: string }>();
    for (const p of products) {
      const catId = String(p?.categoryId || "");
      if (catId && !catMap.has(catId)) {
        catMap.set(catId, { id: catId, nameEn: String(p?.categoryNameEn || p?.categoryCode || catId) });
      }
    }
    return [...catMap.values()].sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  }, [products]);

  const inFilteredProducts = useMemo(() =>
    products.filter((p: any) => {
      const catOk = inFilterCategory === "all" || String(p?.categoryId || "") === inFilterCategory;
      const typeOk = inFilterType === "all" || String(p?.type || "").toLowerCase() === inFilterType;
      return catOk && typeOk;
    }), [products, inFilterCategory, inFilterType]);

  const formatPrice = (price: number) => `QAR ${price.toLocaleString()}`;
  const subtotal = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const existingTotalAmount = Math.max(0, toCurrencyNumber(order?.billing?.totalAmount));
  const existingDiscountAmount = Math.max(0, toCurrencyNumber(order?.billing?.discount));
  const combinedTotalAmount = Math.max(0, existingTotalAmount + subtotal);
  const discountAllowance = computeCumulativeDiscountAllowance({
    policyMaxPercent: maxDiscountPercent,
    baseAmount: combinedTotalAmount,
    existingDiscountAmount,
  });
  const maxAdditionalDiscountAmount = Math.max(0, Math.min(subtotal, discountAllowance.maxAdditionalDiscountAmount));
  const maxAdditionalDiscountPercent = subtotal > 0 ? (maxAdditionalDiscountAmount / subtotal) * 100 : 0;
  const noRemainingDiscountAllowance = maxAdditionalDiscountAmount <= 0.00001;
  const effectiveDiscountPercent = Math.max(0, Math.min(maxAdditionalDiscountPercent, Number(discountPercent || 0)));
  const discount = Math.max(0, Math.min(maxAdditionalDiscountAmount, (subtotal * effectiveDiscountPercent) / 100));
  const total = subtotal - discount;

  return (
    <div className="pim-details-screen customer-details-screen dashboard-customer-details-bg customer-details-exact theme-elegant-glass jc-skin jo-wizard-screen bg-[#F4F7FE] p-6 md:p-8">
      <div className="pim-details-header">
        <div className="pim-details-title-container">
          <h2><i className="fas fa-plus-circle"></i> {t("Add Services to Job Order")}</h2>
        </div>
        <button className="pim-btn-close-details" onClick={onClose}>
          <i className="fas fa-times"></i> {t("Cancel")}
        </button>
      </div>

      <div className="pim-details-body">
        <div className="form-card">
          <div className="form-card-title">
            <i className="fas fa-concierge-bell"></i>
            <h2>{t("Services Selection")}</h2>
          </div>

          <div className="form-card-content">
            <p>{t("Select services for")} {vehicleType}:</p>
            {products.length === 0 ? (
              <div className="empty-state" style={{ padding: "28px 12px" }}>
                <div className="empty-text">{t("No services configured yet")}</div>
                <div className="empty-subtext">{t("Create services from Service Creation before adding services.")}</div>
              </div>
            ) : (
            <>
              <div className="svc-filter-bar">
                <div className="svc-filter-row">
                  <span className="svc-filter-label"><i className="fas fa-tags"></i> {t("Category")}</span>
                  <select
                    className="svc-filter-select"
                    value={inFilterCategory}
                    onChange={(e) => setInFilterCategory(e.target.value)}
                  >
                    <option value="all">{t("All Categories")}</option>
                    {inCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.nameEn}</option>
                    ))}
                  </select>
                </div>
                <div className="svc-filter-row">
                  <span className="svc-filter-label"><i className="fas fa-layer-group"></i> {t("Type")}</span>
                  <div className="svc-type-pills">
                    <button type="button" className={`svc-type-pill${inFilterType === "all" ? " active" : ""}`} onClick={() => setInFilterType("all")}>{t("All")}</button>
                    <button type="button" className={`svc-type-pill${inFilterType === "service" ? " active" : ""}`} onClick={() => setInFilterType("service")}><i className="fas fa-wrench"></i> {t("Services")}</button>
                    <button type="button" className={`svc-type-pill${inFilterType === "package" ? " active" : ""}`} onClick={() => setInFilterType("package")}><i className="fas fa-box-open"></i> {t("Packages")}</button>
                  </div>
                  <span className="svc-filter-count">{inFilteredProducts.length} {t("of")} {products.length}</span>
                </div>
              </div>
              {inFilteredProducts.length === 0 ? (
                <div className="empty-state" style={{ padding: "24px 12px" }}>
                  <div className="empty-text">{t("No services match your filter")}</div>
                  <div className="empty-subtext">{t("Try a different category or type.")}</div>
                </div>
              ) : (
              <div className="services-grid">
                {inFilteredProducts.map((product: any) => (
                  <div
                    key={String(product.id || product.serviceCode || product.name)}
                    className={`service-checkbox ${selectedServices.some((s: any) => String(s.serviceCode || s.catalogId || s.name) === String(product.serviceCode || product.id || product.name)) ? "selected" : ""}`}
                    onClick={() => handleToggleService(product)}
                  >
                    <div className="service-info">
                      <div className="service-name-row">
                        <div className="service-name" data-no-translate="true">{toBilingualName(product?.name, product?.nameAr)}</div>
                        {String(product?.type ?? "").toLowerCase() === "package" && (
                          <span className="jo-package-price-badge">
                            <i className="fas fa-box-open" aria-hidden="true"></i>
                            {t("Package Price Applied")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="service-price">{formatPrice(resolveServicePriceForVehicleType(product, vehicleType))}</div>
                  </div>
                ))}
              </div>
              )}
            </>
            )}

            <div className="price-summary-box">
              <h4>{t("Price Summary")}</h4>
              <div className="price-row"><span>{t("Services:")}</span><span>{formatPrice(subtotal)}</span></div>
              <div className="price-row">
                <span>{t("Apply Discount:")}</span>
                <div>
                  <input
                    type="number"
                    min="0"
                    max={maxAdditionalDiscountPercent}
                    value={Number(effectiveDiscountPercent.toFixed(2))}
                    onChange={(e) => setDiscountPercent(Math.max(0, Math.min(maxAdditionalDiscountPercent, parseFloat(e.target.value) || 0)))}
                    style={{ width: 80 }}
                  />
                  <span> %</span>
                </div>
              </div>
              <div className="price-row">
                <span>{t("Remaining Allowed Discount:")}</span>
                <span>{Number(maxAdditionalDiscountPercent.toFixed(2))}% ({formatPrice(maxAdditionalDiscountAmount)})</span>
              </div>
              {noRemainingDiscountAllowance ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#b91c1c", fontWeight: 600 }}>
                  {t("No additional discount can be applied. The order has already reached the role policy discount limit.")}
                </div>
              ) : null}
              <div className="price-row discount-amount"><span>{t("Discount Amount:")}</span><span>{formatPrice(discount)}</span></div>
              <div className="price-row total"><span>{t("Total:")}</span><span>{formatPrice(total)}</span></div>
            </div>

            <div className="action-buttons">
              <button className="btn btn-secondary" onClick={onClose}>{t("Cancel")}</button>
              <button className="btn btn-primary" onClick={() => onSubmit({ selectedServices, discountPercent: effectiveDiscountPercent })} disabled={selectedServices.length === 0 || products.length === 0}>
                {t("Add Services")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InspectionModule;
