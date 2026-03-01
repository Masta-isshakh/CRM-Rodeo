// src/pages/inspection/InspectionModule.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./InspectionModule.css";
import "./JobCards.css";

import SuccessPopup from "./SuccessPopup";
import PermissionGate from "./PermissionGate"; // ✅ use the real PermissionGate
import inspectionListConfig from "./inspectionConfig";

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
import { resolveActorUsername, resolveOrderCreatedBy } from "../utils/actorIdentity";

// ============================================
// CATALOG
// ============================================
const YOUR_PRODUCTS = [
  { name: "Extra Cool Tint", suvPrice: 3200, sedanPrice: 2900 },
  { name: "UV Protection Film", suvPrice: 2500, sedanPrice: 2200 },
  { name: "Cool Shade Tint", suvPrice: 1800, sedanPrice: 1500 },
  { name: "Smart Pro Protection", suvPrice: 17500, sedanPrice: 15500 },
  { name: "Full Body Protection", suvPrice: 5500, sedanPrice: 4400 },
  { name: "Quarter Panel Protection", suvPrice: 4300, sedanPrice: 3500 },
  { name: "Glass Protection (Light)", suvPrice: 400, sedanPrice: 400 },
  { name: "Extreme Glass Protection", suvPrice: 1200, sedanPrice: 1200 },
  { name: "City Glass Protection", suvPrice: 800, sedanPrice: 800 },
  { name: "Matte Protection", suvPrice: 18500, sedanPrice: 16500 },
  { name: "Color Change", suvPrice: 20500, sedanPrice: 18500 },
  { name: "Leather Protection", suvPrice: 1200, sedanPrice: 1200 },
  { name: "Wheel Protection", suvPrice: 600, sedanPrice: 600 },
  { name: "VIP Interior & Exterior Polish", suvPrice: 1650, sedanPrice: 1650 },
  { name: "Interior Polish", suvPrice: 850, sedanPrice: 850 },
  { name: "Exterior Polish", suvPrice: 800, sedanPrice: 800 },
  { name: "Nano Interior & Exterior Polish", suvPrice: 2200, sedanPrice: 2200 },
  { name: "Rear Bumper Protection", suvPrice: 2200, sedanPrice: 2200 },
  { name: "Fender Protection", suvPrice: 2000, sedanPrice: 2000 },
  { name: "Roof Protection", suvPrice: 2200, sedanPrice: 2200 },
  { name: "Single Door Protection", suvPrice: 400, sedanPrice: 400 },
  { name: "Front Bumper Protection", suvPrice: 1500, sedanPrice: 1500 },
  { name: "Mirror Protection (Each)", suvPrice: 150, sedanPrice: 150 },
  { name: "Front Fender Protection (Each)", suvPrice: 500, sedanPrice: 500 },
  { name: "Rear Fender for Pickups & Small Cars", suvPrice: 1700, sedanPrice: 1700 },
  { name: "Rear Fender Protection (Each)", suvPrice: 2800, sedanPrice: 2800 },
  { name: "Headlight Protection (Each)", suvPrice: 150, sedanPrice: 150 },
  { name: "Trunk Door Protection", suvPrice: 1000, sedanPrice: 1000 },
  { name: "Tire Base Protection (Each)", suvPrice: 400, sedanPrice: 400 },
  { name: "Pedal Protection (Each)", suvPrice: 400, sedanPrice: 400 },
];

type AnyObj = Record<string, any>;

function errMsg(e: unknown) {
  const anyE = e as any;
  return String(anyE?.message ?? anyE?.errors?.[0]?.message ?? anyE ?? "Unknown error");
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

function getWorkStatusClass(status: any) {
  const statusMap: any = {
    "New Request": "status-new-request",
    Inspection: "status-inspection",
    Service_Operation: "status-inprogress",
    Inprogress: "status-inprogress",
    "Quality Check": "status-quality-check",
    Ready: "status-ready",
    Completed: "status-completed",
    Cancelled: "status-cancelled",
  };
  return statusMap[String(status ?? "")] || "status-inprogress";
}

function getPaymentStatusClass(status: any) {
  if (status === "Fully Paid") return "payment-full";
  if (status === "Partially Paid") return "payment-partial";
  return "payment-unpaid";
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
    paymentStatus: order.paymentStatusLabel || "Unpaid",

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

function InspectionModule({ currentUser }: any) {
  const [inspectionConfig, setInspectionConfig] = useState<any[]>(inspectionListConfig);

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

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

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
        const cfg = await loadInspectionConfig(inspectionListConfig);
        setInspectionConfig(cfg);
      } catch (e) {
        console.error(e);
        setInspectionConfig(inspectionListConfig);
      }
    })();
  }, []);

  const refreshOrders = async () => {
    setLoading(true);
    try {
      const list = await listJobOrdersForMain();
      setRows(filterInspectionRows(list));
      setCurrentPage(1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setCurrentPage(1), [searchQuery]);

  const filteredRows = useMemo(() => {
    if (!searchQuery) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter((job) => {
      return (
        String(job.id || "").toLowerCase().includes(q) ||
        String(job.createDate || "").toLowerCase().includes(q) ||
        String(job.orderType || "").toLowerCase().includes(q) ||
        String(job.customerName || "").toLowerCase().includes(q) ||
        String(job.mobile || "").toLowerCase().includes(q) ||
        String(job.vehiclePlate || "").toLowerCase().includes(q) ||
        String(job.workStatus || "").toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery]);

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
  const paginated = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

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
    const menuWidth = 200;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    setDropdownPosition({ top, left });
    setActiveDropdown(jobId);
  };

  const resetInspectionState = () => {
    setInspectionState(buildInitialInspectionState(sectionConfig));
    setResumeAvailable({ exterior: false, interior: false });
  };

  const viewDetails = async (row: AnyObj) => {
    setActiveRow(row);
    setScreenState("details");
    setReportHtml(null);

    hydratedRef.current = false;
    resetInspectionState();

    setLoading(true);
    try {
      const order = await getJobOrderByOrderNumber(row.id);
      if (!order?._backendId) throw new Error("Backend order not found.");

      setActiveOrder(order);
      setDetailData(deriveDetailData(order, row));

      const state = await getInspectionState(order._backendId);
      if (state) {
        setInspectionState(state);
        setResumeAvailable({ exterior: true, interior: true });
      }

      const rep = await getInspectionReport(order._backendId);
      setReportHtml(rep);

      hydratedRef.current = true;
    } catch (e) {
      console.error(e);
      setPopupMessage(`Load failed: ${errMsg(e)}`);
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
      const paths: string[] = [];
      for (const f of list) {
        const p = await uploadInspectionPhoto({
          jobOrderId: activeOrder._backendId,
          orderNumber: activeRow.id,
          sectionKey,
          itemId,
          file: f,
          actor: resolveActorName(currentUser),
        });
        paths.push(p);
      }

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
    }, 1200);

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
      await refreshOrders();

      await upsertInspectionState({
        jobOrderId: updated._backendId,
        orderNumber: activeRow.id,
        status: "IN_PROGRESS",
        inspectionState,
        actor: actorEmail,
      });

      setPopupMessage("Inspection started.");
      setShowPopup(true);
    } catch (e) {
      console.error(e);
      setPopupMessage(`Start failed: ${errMsg(e)}`);
      setShowPopup(true);
    } finally {
      setLoading(false);
    }
  };

  const saveAndPause = (sectionKey: "exterior" | "interior") => {
    setInspectionConfirmData({
      title: "Save and Pause Inspection",
      message: `Save and pause ${sectionKey} inspection? You can resume later.`,
      onConfirm: () => {
        setInspectionState((prev: AnyObj) => ({
          ...prev,
          [sectionKey]: { ...prev[sectionKey], paused: true, started: true },
        }));
        setResumeAvailable({ exterior: true, interior: true });
        setShowInspectionConfirmation(false);
        setPopupMessage(`${sectionKey} inspection saved and paused.`);
        setShowPopup(true);
      },
    });
    setShowInspectionConfirmation(true);
  };

  const resumeInspection = (sectionKey: "exterior" | "interior") => {
    setInspectionState((prev: AnyObj) => ({
      ...prev,
      [sectionKey]: { ...prev[sectionKey], started: true, paused: false },
    }));
    setPopupMessage(`${sectionKey} inspection resumed.`);
    setShowPopup(true);
  };

  const markNotRequired = (sectionKey: "exterior" | "interior") => {
    setInspectionConfirmData({
      title: "Mark as Not Required",
      message: `Mark ${sectionKey} inspection as not required?`,
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
    setInspectionConfirmData({
      title: "Complete Inspection",
      message: `Complete ${sectionKey} inspection?`,
      onConfirm: () => {
        setInspectionState((prev: AnyObj) => ({
          ...prev,
          [sectionKey]: { ...prev[sectionKey], completed: true, started: false, paused: false },
        }));
        setPopupMessage(`${sectionKey} inspection completed successfully.`);
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
      title: "Finish Inspection",
      message: "Finish the inspection? Status will change to Service_Operation.",
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

          const dd = deriveDetailData(activeOrder, activeRow);
          const html = buildInspectionReportHtml({
            orderNumber: activeRow.id,
            detailData: dd,
            activeJob: activeRow,
            inspectionState,
            sectionConfig,
            photoUrlMap: photoMap,
          });

          await saveInspectionReport({
            jobOrderId: activeOrder._backendId,
            orderNumber: activeRow.id,
            html,
            actor: resolveActorName(currentUser),
          });

          const now = new Date().toLocaleString();
          const actorEmail = resolveActorName(currentUser);
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
          } as AnyObj;

          const { backendId } = await upsertJobOrder(updated);
          updated._backendId = backendId;
          setActiveOrder(updated);

          await upsertInspectionState({
            jobOrderId: updated._backendId,
            orderNumber: activeRow.id,
            status: "COMPLETED",
            inspectionState,
            actor: actorEmail,
          });

          await refreshOrders();

          setPopupMessage("Inspection finished! Status changed to Service_Operation.");
          setShowPopup(true);

          setShowInspectionConfirmation(false);
          closeDetailView();
        } catch (e) {
          console.error(e);
          setPopupMessage(`Finish failed: ${errMsg(e)}`);
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
      await refreshOrders();
      setPopupMessage(
        <>
          <span style={{ fontWeight: 700, color: "#16a34a", display: "block", marginBottom: 8 }}>
            <i className="fas fa-check-circle"></i> Order Cancelled Successfully
          </span>
          <span>
            Job Order ID: <strong>{cancelOrderId}</strong>
          </span>
        </>
      );
      setShowPopup(true);
    } catch (e) {
      console.error(e);
      setPopupMessage(`Cancel failed: ${errMsg(e)}`);
      setShowPopup(true);
    } finally {
      setLoading(false);
      setShowCancelConfirmation(false);
      setCancelOrderId(null);
    }
  };

  const downloadReport = () => {
    if (!reportHtml || !activeRow?.id) return;
    const blob = new Blob([reportHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Inspection_Result_${activeRow.id}.html`;
    a.click();
    URL.revokeObjectURL(url);
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
        <div className="app-container">
          <header className="app-header">
            <div className="header-left">
              <h1>
                <i className="fas fa-car"></i> Inspection Module
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
                {loading
                  ? "Loading..."
                  : filteredRows.length === 0
                  ? "No jobs found"
                  : `Showing ${Math.min((currentPage - 1) * pageSize + 1, filteredRows.length)}-${Math.min(
                      currentPage * pageSize,
                      filteredRows.length
                    )} of ${filteredRows.length} inspection jobs`}
              </div>
            </section>

            <section className="results-section">
              <div className="section-header">
                <h2>
                  <i className="fas fa-list"></i> Inspection Jobs Records
                </h2>
                <div className="pagination-controls">
                  <div className="records-per-page">
                    <label htmlFor="inspectionPageSize">Records per page:</label>
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
              </div>

              {filteredRows.length > 0 ? (
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
                      {paginated.map((job) => (
                        <tr key={job.id}>
                          <td className="date-column">{job.createDate}</td>
                          <td>{job.id}</td>
                          <td>
                            <span className={`order-type-badge ${job.orderType === "New Job Order" ? "order-type-new-job" : "order-type-service"}`}>
                              {job.orderType}
                            </span>
                          </td>
                          <td>{job.customerName}</td>
                          <td>{job.mobile}</td>
                          <td>{job.vehiclePlate}</td>
                          <td>
                            <span className={`status-badge ${job.workStatus === "New Request" ? "status-new-request" : "status-inspection"}`}>
                              {job.workStatus}
                            </span>
                          </td>
                          <td>
                            <PermissionGate moduleId="inspection" optionId="inspection_actions">
                              <div className="action-dropdown-container">
                                <button className={`btn-action-dropdown ${activeDropdown === job.id ? "active" : ""}`} onClick={(e) => handleOpenDropdown(e, job.id)}>
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
                <div style={{ padding: "40px 20px", textAlign: "center", color: "#999" }}>
                  <p>
                    <i className="fas fa-inbox" style={{ fontSize: "36px", marginBottom: "10px" }}></i>
                  </p>
                  <p>No inspection jobs found</p>
                </div>
              )}

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
            </section>
          </main>

          <div className="inspection-footer">
            <p>Service Management System © 2023 | Inspection Module</p>
          </div>
        </div>
      )}

      {screenState === "addService" && currentAddServiceOrder && (
        <AddServiceScreen order={currentAddServiceOrder} products={YOUR_PRODUCTS} onClose={() => setScreenState("details")} onSubmit={handleAddServiceSubmit} />
      )}

      {screenState === "details" && activeRow && activeOrder && detailData && (
        <div className="detail-view pim-details-screen jo-details-v3" id="detailView">
          <div className="detail-header pim-details-header">
            <div className="detail-title-container">
              <h2>
                <i className="fas fa-clipboard-list"></i> Inspection Details - Job Order #
                <span id="detailJobIdHeader">{activeRow.id}</span>
              </h2>
            </div>
            <button className="close-detail pim-btn-close-details" onClick={closeDetailView}>
              <i className="fas fa-times"></i> Close Details
            </button>
          </div>

          <div className="detail-container pim-details-body">
            <div className="detail-cards pim-details-grid">
              <PermissionGate moduleId="inspection" optionId="inspection_summary">
                <div className="pim-detail-card">
                  <h3><i className="fas fa-info-circle"></i> Job Order Summary</h3>
                  <div className="pim-card-content">
                    <div className="pim-info-item"><span className="pim-info-label">Job Order ID</span><span className="pim-info-value">{activeRow.id}</span></div>
                    <div className="pim-info-item"><span className="pim-info-label">Order Type</span><span className="pim-info-value">{detailData.orderType || activeOrder.orderType || "Job Order"}</span></div>
                    <div className="pim-info-item"><span className="pim-info-label">Request Create Date</span><span className="pim-info-value">{detailData.createDate || "Not specified"}</span></div>
                    <div className="pim-info-item"><span className="pim-info-label">Created By</span><span className="pim-info-value">{detailData.createdBy || "—"}</span></div>
                    <div className="pim-info-item"><span className="pim-info-label">Expected Delivery</span><span className="pim-info-value">{detailData.expectedDelivery || "Not specified"}</span></div>
                    <div className="pim-info-item"><span className="pim-info-label">Work Status</span><span className="pim-info-value"><span className={`epm-status-badge status-badge ${getWorkStatusClass(detailData.workStatus)}`}>{detailData.workStatus}</span></span></div>
                    <div className="pim-info-item"><span className="pim-info-label">Payment Status</span><span className="pim-info-value"><span className={`epm-status-badge status-badge ${getPaymentStatusClass(detailData.paymentStatus)}`}>{detailData.paymentStatus}</span></span></div>
                  </div>

                  {reportHtml && (
                    <div className="inspection-summary-actions">
                      <button className="btn btn-primary" onClick={downloadReport}>
                        <i className="fas fa-download"></i> Download Inspection Report
                      </button>
                    </div>
                  )}
                </div>
              </PermissionGate>

              <PermissionGate moduleId="inspection" optionId="inspection_services">
                <div className="pim-detail-card">
                  <div className="inspection-service-head">
                    <h3><i className="fas fa-tasks"></i> Services Summary ({Array.isArray(activeOrder.services) ? activeOrder.services.length : 0})</h3>
                    <PermissionGate moduleId="inspection" optionId="inspection_addservice">
                      <button className="btn-add-service inspection-add-service-btn" onClick={handleAddService}>
                        <i className="fas fa-plus-circle"></i> Add Service
                      </button>
                    </PermissionGate>
                  </div>
                  <div className="pim-services-list">
                    {Array.isArray(activeOrder.services) && activeOrder.services.length > 0 ? (
                      activeOrder.services.map((s: any, idx: number) => (
                        <div key={idx} className="pim-service-item">
                          <div className="pim-service-header">
                            <span className="pim-service-name">{s.name}</span>
                            <span className={`status-badge ${getServiceStatusClass(s.status || "New")}`}>{s.status || "New"}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="inspection-empty-inline">No services added yet</div>
                    )}
                  </div>
                </div>
              </PermissionGate>
            </div>

            <PermissionGate moduleId="inspection" optionId="inspection_list">
              <div className="epm-detail-card inspection-list-card">
                <div className="inspection-list-head">
                  <h3><i className="fas fa-clipboard-check"></i> Inspection List</h3>
                  <PermissionGate moduleId="inspection" optionId="inspection_finish">
                    <button className="finish-btn inspection-finish-btn" disabled={!canFinish || loading} onClick={finishInspection}>
                      <i className="fas fa-flag-checkered"></i> {loading ? "Working..." : "Finish Inspection"}
                    </button>
                  </PermissionGate>
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
                                <span className="status-indicator status-active"><i className="fas fa-spinner fa-spin"></i> In Progress</span>
                              )}
                              {isPaused && <span className="status-indicator status-paused"><i className="fas fa-pause"></i> Paused</span>}
                              {isCompleted && <span className="status-indicator status-active"><i className="fas fa-check"></i> Completed</span>}
                            </h3>
                          </div>

                          <div className="inspection-actions">
                            {!isCompleted && !isNotRequired && (
                              <PermissionGate moduleId="inspection" optionId="inspection_start">
                                <button className="inspection-btn btn-start" onClick={() => void startInspection(sectionKey)} style={{ display: isStarted ? "none" : "flex" }}>
                                  <i className="fas fa-play"></i> {startLabel}
                                </button>
                              </PermissionGate>
                            )}

                            {!isCompleted && !isNotRequired && (
                              <button className="inspection-btn btn-save" onClick={() => saveAndPause(sectionKey)} style={{ display: isStarted && !isPaused ? "flex" : "none" }}>
                                <i className="fas fa-save"></i> Save & Pause
                              </button>
                            )}

                            {!isCompleted && !isNotRequired && (
                              <PermissionGate moduleId="inspection" optionId="inspection_resume">
                                <button className="inspection-btn btn-resume" onClick={() => resumeInspection(sectionKey)} disabled={!resumeAvailable[sectionKey]}>
                                  <i className="fas fa-play-circle"></i> Resume
                                </button>
                              </PermissionGate>
                            )}

                            {!isCompleted && !isNotRequired && (
                              <PermissionGate moduleId="inspection" optionId="inspection_complete">
                                <button className="inspection-btn btn-complete" onClick={() => completeSection(sectionKey)} disabled={!canComplete}>
                                  <i className="fas fa-check-circle"></i> Complete Inspection
                                </button>
                              </PermissionGate>
                            )}

                            {!isCompleted && !isNotRequired && (
                              <PermissionGate moduleId="inspection" optionId="inspection_notrequired">
                                <button className="inspection-btn btn-not-required" onClick={() => markNotRequired(sectionKey)}>
                                  <i className="fas fa-ban"></i> Not Required
                                </button>
                              </PermissionGate>
                            )}
                          </div>
                        </div>

                        {isStarted && !isNotRequired && (
                          <div className="inspection-progress">
                            <div>Progress: <span>{progressText}</span></div>
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
                                                  <span className="status-label green">Pass</span>
                                                </label>
                                                <label className="checkbox-option">
                                                  <input type="radio" name={`${sectionKey}-${item.id}`} value="attention" checked={itemState?.status === "attention"} onChange={() => updateItemStatus(sectionKey, item.id, "attention")} />
                                                  <span className="status-label amber">Attention</span>
                                                </label>
                                                <label className="checkbox-option">
                                                  <input type="radio" name={`${sectionKey}-${item.id}`} value="failed" checked={itemState?.status === "failed"} onChange={() => updateItemStatus(sectionKey, item.id, "failed")} />
                                                  <span className="status-label red">Failed</span>
                                                </label>
                                              </div>
                                            </div>

                                            {showComments && (
                                              <div className="comment-section">
                                                <textarea placeholder="Add comments..." value={itemState?.comment} onChange={(e) => updateItemComment(sectionKey, item.id, e.target.value)} />
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
                                                    <i className="fas fa-camera"></i> Upload/Take Photo
                                                  </button>
                                                  <span className="photo-requirement">* Required for Amber/Red status</span>
                                                </div>

                                                {Array.isArray(itemState?.photos) && itemState.photos.length > 0 && (
                                                  <div className="photo-preview">
                                                    {itemState.photos.map((p: string, idx: number) => {
                                                      const src = p.startsWith("data:") ? p : photoUrlCache[p] || "";
                                                      return (
                                                        <div key={`${item.id}-photo-${idx}`} className="photo-preview-item">
                                                          {src ? <img src={src} alt={`Inspection ${item.name}`} /> : <div style={{ padding: 10, color: "#999" }}>Loading...</div>}
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
                <i className="fas fa-times"></i> Cancel
              </button>
              <button className="btn-confirm-cancel" onClick={() => inspectionConfirmData.onConfirm && inspectionConfirmData.onConfirm()} disabled={loading}>
                <i className="fas fa-check"></i> {loading ? "Working..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      </div>

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
              <button className="btn-cancel" onClick={() => { setShowCancelConfirmation(false); setCancelOrderId(null); }}>
                <i className="fas fa-times"></i> Keep Order
              </button>
              <button className="btn-confirm-cancel" onClick={() => void handleCancelOrder()} disabled={loading}>
                <i className="fas fa-ban"></i> {loading ? "Cancelling..." : "Cancel Order"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {activeDropdown &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="action-dropdown-menu show action-dropdown-menu-fixed" style={{ top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` }}>
            <PermissionGate moduleId="inspection" optionId="inspection_viewdetails">
              <button className="dropdown-item view" onClick={() => { const r = filteredRows.find((x) => x.id === activeDropdown); if (r) void viewDetails(r); setActiveDropdown(null); }}>
                <i className="fas fa-eye"></i> View Details
              </button>
            </PermissionGate>
            <PermissionGate moduleId="inspection" optionId="inspection_cancel">
              <>
                <div className="dropdown-divider"></div>
                <button className="dropdown-item delete" onClick={() => handleShowCancelConfirmation(activeDropdown)}>
                  <i className="fas fa-times-circle"></i> Cancel Order
                </button>
              </>
            </PermissionGate>
          </div>,
          document.body
        )}
    </div>
  );
}

function AddServiceScreen({ order, products = [], onClose, onSubmit }: any) {
  const [selectedServices, setSelectedServices] = useState<any[]>([]);
  const [discountPercent, setDiscountPercent] = useState(0);
  const vehicleType = order?.vehicleDetails?.type || "SUV";

  const handleToggleService = (product: any) => {
    const price = vehicleType === "SUV" ? product.suvPrice : product.sedanPrice;
    if (selectedServices.some((s) => s.name === product.name)) {
      setSelectedServices(selectedServices.filter((s) => s.name !== product.name));
    } else {
      setSelectedServices([...selectedServices, { name: product.name, price }]);
    }
  };

  const formatPrice = (price: number) => `QAR ${price.toLocaleString()}`;
  const subtotal = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const discount = (subtotal * discountPercent) / 100;
  const total = subtotal - discount;

  return (
    <div className="pim-details-screen">
      <div className="pim-details-header">
        <div className="pim-details-title-container">
          <h2><i className="fas fa-plus-circle"></i> Add Services to Job Order</h2>
        </div>
        <button className="pim-btn-close-details" onClick={onClose}>
          <i className="fas fa-times"></i> Cancel
        </button>
      </div>

      <div className="pim-details-body">
        <div className="form-card">
          <div className="form-card-title">
            <i className="fas fa-concierge-bell"></i>
            <h2>Services Selection</h2>
          </div>

          <div className="form-card-content">
            <p>Select services for {vehicleType}:</p>
            <div className="services-grid">
              {products.map((product: any) => (
                <div
                  key={product.name}
                  className={`service-checkbox ${selectedServices.some((s) => s.name === product.name) ? "selected" : ""}`}
                  onClick={() => handleToggleService(product)}
                >
                  <div className="service-info">
                    <div className="service-name">{product.name}</div>
                  </div>
                  <div className="service-price">{formatPrice(vehicleType === "SUV" ? product.suvPrice : product.sedanPrice)}</div>
                </div>
              ))}
            </div>

            <div className="price-summary-box">
              <h4>Price Summary</h4>
              <div className="price-row"><span>Services:</span><span>{formatPrice(subtotal)}</span></div>
              <div className="price-row">
                <span>Apply Discount:</span>
                <div>
                  <input type="number" min="0" max="100" value={discountPercent} onChange={(e) => setDiscountPercent(parseFloat(e.target.value) || 0)} style={{ width: 80 }} />
                  <span> %</span>
                </div>
              </div>
              <div className="price-row discount-amount"><span>Discount Amount:</span><span>{formatPrice(discount)}</span></div>
              <div className="price-row total"><span>Total:</span><span>{formatPrice(total)}</span></div>
            </div>

            <div className="action-buttons">
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={() => onSubmit({ selectedServices, discountPercent })} disabled={selectedServices.length === 0}>
                Add Services
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InspectionModule;