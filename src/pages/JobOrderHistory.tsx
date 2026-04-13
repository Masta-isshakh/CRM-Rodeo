// src/pages/JobOrderHistory.tsx
import  { useEffect, useMemo, useRef, useState } from "react";
import "./JobOrderHistory.css";

import PermissionGate from "./PermissionGate";
import { getDataClient } from "../lib/amplifyClient";
import { getUserDirectory } from "../utils/userDirectoryCache";
import { firstPreferredActorValue, resolveActorDisplay, resolveOrderCreatedBy, resolveOrderUpdatedBy } from "../utils/actorIdentity";
import {
  computePaymentSnapshot,
  derivePaymentStatusFromFinancials,
  normalizePaymentStatusLabel,
  pickBillingFirstValue,
  pickPaymentEnum,
  pickPaymentLabel,
} from "../utils/paymentStatus";
import UnifiedJobOrderRoadmap from "../components/UnifiedJobOrderRoadmap";
import { UnifiedCustomerInfoCard, UnifiedVehicleInfoCard } from "../components/UnifiedCustomerVehicleCards";
import { UnifiedJobOrderSummaryCard } from "../components/UnifiedJobOrderSummaryCard";
import UnifiedBillingInvoicesSection from "../components/UnifiedBillingInvoicesSection";

import { getJobOrderByOrderNumber } from "./jobOrderRepo";
import { getUrl } from "aws-amplify/storage";

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

async function resolveMaybeStorageUrl(urlOrPath: string): Promise<string> {
  const v = String(urlOrPath || "").trim();
  if (!v) return "";
  if (v.startsWith("job-orders/")) {
    const out = await getUrl({ path: v });
    return out.url.toString();
  }
  return v;
}

function uiWorkStatus(rowStatus?: string, label?: string) {
  const lbl = String(label ?? "").trim();
  if (lbl) return lbl;

  switch (String(rowStatus ?? "").toUpperCase()) {
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    case "READY":
      return "Ready";
    case "IN_PROGRESS":
      return "Service_Operation";
    case "OPEN":
      return "New Request";
    case "DRAFT":
      return "Draft";
    default:
      return "Completed";
  }
}

function uiPaymentStatus(enumVal?: string, label?: string) {
  return normalizePaymentStatusLabel(enumVal, label);
}

function normalizeIdentity(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function normalizeDateForSummary(v: any) {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function normalizeDateTimeForSummary(v: any) {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function toSummaryText(v: any, fallback = "—") {
  const out = String(v ?? "").trim();
  return out || fallback;
}

function mapExitPermitStatusToUi(v: any, hasPermitId = false) {
  const s = String(v ?? "").trim().toUpperCase();
  if (hasPermitId) return "Completed";
  if (s === "APPROVED" || s === "CREATED" || s === "COMPLETED") return "Completed";
  return "Not Created";
}

function toSummaryStatus(v: any, fallback = "Not Created", hasPermitId = false) {
  const out = String(v ?? "").trim();
  if (out) return mapExitPermitStatusToUi(out, hasPermitId);
  return mapExitPermitStatusToUi(fallback, hasPermitId);
}

function includeInJobHistory(workStatus: string, paymentStatus: string, exitPermitStatus?: string) {
  const work = normalizeIdentity(workStatus);
  const payment = normalizeIdentity(paymentStatus);
  const permit = normalizeIdentity(exitPermitStatus);
  const hasCreatedExitPermit = permit === "created" || permit === "approved" || permit === "completed";
  const isCancelledAndUnpaid = work === "cancelled" && payment === "unpaid";
  const isCompletedAndFullyPaid = work === "completed" && payment === "fully paid";
  return hasCreatedExitPermit || isCancelledAndUnpaid || isCompletedAndFullyPaid;
}

type ListRow = {
  _backendId: string; // JobOrder.id
  orderNumber: string;

  orderType: string;
  customerName: string;
  mobile: string;
  vehiclePlate: string;

  statusEnum: string;
  workStatus: string;

  paymentEnum: string;
  paymentStatus: string;

  createdAtIso: string;
  createDate: string;

  _parsed: any;
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

type DocUi = {
  id?: string;
  name: string;
  type?: string;
  category?: string;
  addedAt?: string;
  uploadedBy?: string;
  storagePath?: string;
  url?: string;
  paymentReference?: string;
  billReference?: string;
};

type RoadmapStepUi = {
  step: string;
  stepStatus?: string | null;
  startTimestamp?: string | null;
  endTimestamp?: string | null;
  actionBy?: string | null;
  status?: string | null;
};

function stepKey(step: any) {
  return String(step ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
}

function normalizeRoadmapTimestamp(v: any) {
  const s = String(v ?? "").trim();
  return s || null;
}

function normalizeRoadmapActor(row: any) {
  const raw =
    row?.actionBy ??
    row?.updatedBy ??
    row?.createdBy ??
    row?.actor ??
    row?.requestedBy ??
    row?.assignedTo ??
    null;
  const s = String(raw ?? "").trim();
  return s || null;
}

function normalizeRoadmapStep(row: any): RoadmapStepUi | null {
  const step = String(row?.step ?? "").trim();
  if (!step) return null;

  return {
    step,
    stepStatus: String(row?.stepStatus ?? row?.statusLabel ?? row?.state ?? "").trim() || null,
    startTimestamp: normalizeRoadmapTimestamp(row?.startTimestamp ?? row?.startedAt ?? row?.startTime ?? row?.started),
    endTimestamp: normalizeRoadmapTimestamp(row?.endTimestamp ?? row?.completedAt ?? row?.endTime ?? row?.ended),
    actionBy: normalizeRoadmapActor(row),
    status: String(row?.status ?? row?.stepState ?? "").trim() || null,
  };
}

function mergeRoadmapSources(
  normalizedRoadmap: RoadmapStepUi[],
  detailedRoadmap: any[],
  parsedRoadmap: any[],
  createdAtIso?: string | null
) {
  const out: RoadmapStepUi[] = [];
  const byStep = new Map<string, RoadmapStepUi>();

  const ingest = (source: any[]) => {
    for (const row of source ?? []) {
      const step = normalizeRoadmapStep(row);
      if (!step) continue;

      const k = stepKey(step.step);
      const existing = byStep.get(k);

      if (!existing) {
        byStep.set(k, step);
        out.push(step);
        continue;
      }

      existing.stepStatus = existing.stepStatus ?? step.stepStatus ?? null;
      existing.startTimestamp = existing.startTimestamp ?? step.startTimestamp ?? null;
      existing.endTimestamp = existing.endTimestamp ?? step.endTimestamp ?? null;
      existing.actionBy = existing.actionBy ?? step.actionBy ?? null;
      existing.status = existing.status ?? step.status ?? null;
    }
  };

  ingest(normalizedRoadmap);
  ingest(detailedRoadmap);
  ingest(parsedRoadmap);

  const createdAt = normalizeRoadmapTimestamp(createdAtIso);
  for (const step of out) {
    const key = stepKey(step.step);
    if (!step.startTimestamp && key === "new request") {
      step.startTimestamp = createdAt;
    }
    if (!step.actionBy) {
      step.actionBy = null;
    }
  }

  return out;
}

type DetailsOrder = any & {
  _backendId: string;
  id: string; // orderNumber
  orderType: string;
  customerName: string;
  mobile: string;
  vehiclePlate: string;

  workStatus: string;
  paymentStatus: string;

  customerDetails?: any;
  vehicleDetails?: any;

  roadmap?: RoadmapStepUi[];
  billing?: any;
  documents?: DocUi[];

  paymentActivityLog?: any[];
};

async function loadNormalizedInvoices(
  client: any,
  jobOrderId: string,
  cache?: Map<string, InvoiceUi[]>
): Promise<InvoiceUi[]> {
  const key = String(jobOrderId ?? "").trim();
  if (!key) return [];
  if (cache?.has(key)) return cache.get(key) ?? [];

  const out: InvoiceUi[] = [];
  try {
    let invRows: any[] = [];
    try {
      const byIdx = await (client.models.JobOrderInvoice as any).listInvoicesByJobOrder?.({
        jobOrderId: String(jobOrderId),
        limit: 500,
      });
      invRows = (byIdx?.data ?? []) as any[];
    } catch {
      const res = await client.models.JobOrderInvoice.list({
        limit: 500,
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
  cache?.set(key, out);
  return out;
}

async function loadNormalizedRoadmap(
  client: any,
  jobOrderId: string,
  cache?: Map<string, RoadmapStepUi[]>
): Promise<RoadmapStepUi[]> {
  const key = String(jobOrderId ?? "").trim();
  if (!key) return [];
  if (cache?.has(key)) return cache.get(key) ?? [];

  try {
    let rows: any[] = [];
    try {
      const byIdx = await (client.models.JobOrderRoadmapStep as any).listRoadmapByJobOrder?.({
        jobOrderId: String(jobOrderId),
        limit: 500,
      });
      rows = (byIdx?.data ?? []) as any[];
    } catch {
      const res = await client.models.JobOrderRoadmapStep.list({
        limit: 500,
        filter: { jobOrderId: { eq: String(jobOrderId) } } as any,
      });
      rows = (res?.data ?? []) as any[];
    }

    if (!rows.length) {
      cache?.set(key, []);
      return [];
    }

    // Sort by createdAt, then step
    rows.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));

    const normalized = rows
      .map((r) => normalizeRoadmapStep(r))
      .filter(Boolean) as RoadmapStepUi[];
    cache?.set(key, normalized);
    return normalized;
  } catch {
    cache?.set(key, []);
    return [];
  }
}

async function loadVehicleIdByPlate(
  client: any,
  plateNumber: string,
  cache?: Map<string, string | null>
): Promise<string | null> {
  const plate = String(plateNumber ?? "").trim();
  if (!plate) return null;
  if (cache?.has(plate)) return cache.get(plate) ?? null;

  try {
    const byIdx = await (client.models.Vehicle as any).vehiclesByPlateNumber?.({
      plateNumber: plate,
      limit: 1,
    });
    const row = (byIdx?.data ?? [])[0];
    if (row?.vehicleId) {
      const value = String(row.vehicleId);
      cache?.set(plate, value);
      return value;
    }
  } catch {}

  try {
    const res = await client.models.Vehicle.list({
      filter: { plateNumber: { eq: plate } } as any,
      limit: 1,
    });
    const row = (res?.data ?? [])[0];
    if (row?.vehicleId) {
      const value = String(row.vehicleId);
      cache?.set(plate, value);
      return value;
    }
  } catch {}

  cache?.set(plate, null);
  return null;
}

async function loadCustomerDetails(
  client: any,
  customerId: string,
  cache?: Map<string, any>
) {
  const id = String(customerId ?? "").trim();
  if (!id) return null;
  if (cache?.has(id)) return cache.get(id) ?? null;

  try {
    const cRes = await client.models.Customer.get({ id } as any);
    const c = (cRes as any)?.data ?? null;
    if (!c?.id) return null;

    // registered vehicles count
    let vehiclesCount = 0;
    try {
      const vRes = await (client.models.Vehicle as any).vehiclesByCustomer?.({
        customerId: id,
        limit: 500,
      });
      vehiclesCount = (vRes?.data ?? []).length;
    } catch {
      try {
        const vRes2 = await client.models.Vehicle.list({
          filter: { customerId: { eq: id } } as any,
          limit: 500,
        });
        vehiclesCount = (vRes2?.data ?? []).length;
      } catch {}
    }

    const fullName = `${String(c.name ?? "")} ${String(c.lastname ?? "")}`.trim();

    const value = {
      customerId: String(c.id),
      name: fullName || "—",
      mobile: c.phone ?? "—",
      email: c.email ?? "—",
      address: c.notes ?? "—",
      registeredVehiclesCount: vehiclesCount,
      completedServicesCount: 0,
      customerSince: c.createdAt
        ? new Date(String(c.createdAt)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
        : "—",
    };
    cache?.set(id, value);
    return value;
  } catch {
    cache?.set(id, null);
    return null;
  }
}

function workStatusClass(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s.includes("completed")) return "jh-badge jh-badge-success";
  if (s.includes("cancel")) return "jh-badge jh-badge-danger";
  if (s.includes("ready")) return "jh-badge jh-badge-info";
  return "jh-badge jh-badge-neutral";
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

function paymentStatusClass(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s.includes("fully paid") || s === "paid") return "jh-badge jh-badge-success";
  if (s.includes("partially") || s === "partial") return "jh-badge jh-badge-warn";
  if (s.includes("unpaid")) return "jh-badge jh-badge-danger";
  if (s.includes("refunded")) return "jh-badge jh-badge-neutral";
  return "jh-badge jh-badge-neutral";
}

function permitStatusClass(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s.includes("completed")) return "jh-badge jh-badge-success";
  if (s.includes("not created")) return "jh-badge jh-badge-warn";
  if (s.includes("pending")) return "jh-badge jh-badge-warn";
  if (s.includes("rejected")) return "jh-badge jh-badge-danger";
  return "jh-badge jh-badge-info";
}

function orderTypeClass(type: string) {
  return String(type ?? "").toLowerCase().includes("new") ? "jh-pill jh-pill-blue" : "jh-pill jh-pill-slate";
}

function resolveExitPermitActor(order: any, roadmap: any[]) {
  const fromPermit = String(order?.exitPermit?.createdBy ?? "").trim();
  if (fromPermit) return fromPermit;

  const fromInfo = String(order?.exitPermitInfo?.createdBy ?? order?.exitPermitInfo?.actionBy ?? "").trim();
  if (fromInfo) return fromInfo;

  const exitStep = (Array.isArray(roadmap) ? roadmap : []).find((step: any) => {
    const key = String(step?.step ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
    return key === "exitpermitissued" || key === "exitpermit";
  });

  const fromRoadmap = String(exitStep?.actionBy ?? "").trim();
  return fromRoadmap || "";
}

function resolveSummaryActors(row: any, detailed: any, parsed: any, roadmap: any[]) {
  const roadmapList = Array.isArray(roadmap) ? roadmap : [];
  const newRequestStep = roadmapList.find((step: any) => {
    const key = String(step?.step ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
    return key === "newrequest";
  });
  const parsedSummary = parsed?.jobOrderSummary ?? {};

  const createdBy = firstPreferredActorValue(
    detailed?.jobOrderSummary?.createdByName,
    detailed?.jobOrderSummary?.createdBy,
    detailed?.jobOrderSummary?.createBy,
    parsedSummary?.createdByName,
    parsedSummary?.createdBy,
    parsedSummary?.createBy,
    parsed?.createdBy,
    row?.createdBy,
    detailed?.createdBy,
    newRequestStep?.actionBy,
    newRequestStep?.updatedBy,
    newRequestStep?.createdBy,
    detailed?.customerDetails?.createdBy,
    detailed?.vehicleDetails?.createdBy,
    row?.updatedBy,
    detailed?.updatedBy
  );

  const updatedBy = firstPreferredActorValue(
    detailed?.jobOrderSummary?.updatedBy,
    parsedSummary?.updatedBy,
    row?.updatedBy,
    detailed?.updatedBy,
    parsed?.updatedBy,
    roadmapList.slice().reverse().find((step: any) => String(step?.actionBy ?? "").trim())?.actionBy,
    createdBy
  );

  return {
    createdBy: createdBy || "—",
    updatedBy: updatedBy || "—",
  };
}

function parseHistoryServiceDateTime(value: any): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const now = new Date();
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    }
  }

  return null;
}

function formatHistoryServiceDuration(startValue: any, endValue: any): string {
  const start = parseHistoryServiceDateTime(startValue);
  const end = parseHistoryServiceDateTime(endValue);
  if (!start || !end) return "Not started";

  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "0m";

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function resolveHistoryServiceActor(service: any, displayUser: (value: any) => string): string {
  const actorCandidates = [
    service?.completedByName,
    service?.completedBy,
    service?.endedBy,
    service?.updatedByName,
    service?.updatedBy,
    service?.actionBy,
    service?.doneBy,
    service?.technicianName,
    service?.technician,
    service?.assignedTo,
    Array.isArray(service?.technicians) ? service.technicians[0] : "",
  ];

  const actor = actorCandidates.find((candidate) => String(candidate ?? "").trim().length > 0) ?? "";

  const out = displayUser(actor);
  return out || "Not assigned";
}

export default function JobOrderHistory({
  currentUser,
  navigationData,
  onClearNavigation,
  onNavigateBack,
}: {
  currentUser: any;
  navigationData?: any;
  onClearNavigation?: () => void;
  onNavigateBack?: (source: string, vehicleId?: string | null) => void;
}) {
  const client = useMemo(() => getDataClient(), []);

  const [loading, setLoading] = useState(false);

  const [rows, setRows] = useState<ListRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportDates, setExportDates] = useState({
    startDate: "2023-10-01",
    endDate: "2023-10-31",
  });

  const [selectedOrder, setSelectedOrder] = useState<DetailsOrder | null>(null);
  const [userLabelMap, setUserLabelMap] = useState<Record<string, string>>({});
  const detailsCacheRef = useRef<Map<string, DetailsOrder>>(new Map());
  const invoicesCacheRef = useRef<Map<string, InvoiceUi[]>>(new Map());
  const roadmapCacheRef = useRef<Map<string, RoadmapStepUi[]>>(new Map());
  const vehicleIdCacheRef = useRef<Map<string, string | null>>(new Map());
  const customerDetailsCacheRef = useRef<Map<string, any>>(new Map());

  const [navSource, setNavSource] = useState<string | null>(null);
  const [returnVehicleId, setReturnVehicleId] = useState<string | null>(null);

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

  const displayUser = (value: any) => {
    return resolveActorDisplay(value, {
      identityToUsernameMap: userLabelMap,
      fallback: "—",
    });
  };

  // -------------------- LIVE HISTORY LIST --------------------
  useEffect(() => {
    const sub = (client.models.JobOrder as any)
      .observeQuery({
        limit: 500,
        filter: {
          or: [{ status: { eq: "COMPLETED" } }, { status: { eq: "CANCELLED" } }],
        } as any,
      })
      .subscribe(({ items }: any) => {
        const mapped: ListRow[] = (items ?? []).map((row: any) => {
          const parsed = safeJsonParse<any>(row.dataJson, {});
          const createdIso = String(row.createdAt ?? "");
          const createDate = createdIso
            ? new Date(createdIso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
            : "";

          const workStatus = uiWorkStatus(row.status, row.workStatusLabel ?? parsed?.workStatusLabel);
          const paymentStatus = derivePaymentStatusFromFinancials({
            paymentEnum: pickPaymentEnum(row, parsed),
            paymentLabel: pickPaymentLabel(row, parsed),
            totalAmount: pickBillingFirstValue("totalAmount", row, parsed),
            discount: pickBillingFirstValue("discount", row, parsed),
            amountPaid: pickBillingFirstValue("amountPaid", row, parsed),
            netAmount: pickBillingFirstValue("netAmount", row, parsed),
            balanceDue: pickBillingFirstValue("balanceDue", row, parsed),
          });

          return {
            _backendId: String(row.id),
            orderNumber: String(row.orderNumber ?? ""),

            orderType: String(row.orderType ?? parsed?.orderType ?? "Job Order"),
            customerName: String(row.customerName ?? parsed?.customerName ?? ""),
            mobile: String(row.customerPhone ?? parsed?.customerPhone ?? ""),
            vehiclePlate: String(row.plateNumber ?? parsed?.plateNumber ?? ""),

            statusEnum: String(row.status ?? ""),
            workStatus,

            paymentEnum: String(row.paymentStatus ?? ""),
            paymentStatus,

            createdAtIso: createdIso,
            createDate,

            _parsed: parsed,
          };
        })
        .filter((row: ListRow) => {
          const permitStatus =
            String(
              row._parsed?.exitPermitStatus ??
                row._parsed?.exitPermitInfo?.status ??
                row._parsed?.exitPermit?.status ??
                ""
            ).trim() || mapExitPermitStatusToUi("", Boolean(row._parsed?.exitPermit?.permitId));
          return includeInJobHistory(row.workStatus, row.paymentStatus, permitStatus);
        });

        // newest first
        mapped.sort((a, b) => String(b.createdAtIso).localeCompare(String(a.createdAtIso)));

        setRows(mapped);
      });

    return () => sub.unsubscribe();
  }, [client]);

  // -------------------- NAVIGATION IN (optional) --------------------
  useEffect(() => {
    if (!navigationData?.openDetails) return;

    const orderNumber =
      String(navigationData?.orderNumber ?? navigationData?.jobOrderNumber ?? navigationData?.id ?? "").trim() ||
      String(navigationData?.jobOrder?.id ?? "").trim();

    if (!orderNumber) return;

    if (navigationData.source) setNavSource(String(navigationData.source));
    if (navigationData.returnToVehicle) setReturnVehicleId(String(navigationData.returnToVehicle));

    void openDetails(orderNumber);
    onClearNavigation?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationData]);

  // -------------------- SEARCH --------------------
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((r) => {
      const hay = [
        r.orderNumber,
        r.orderType,
        r.customerName,
        r.mobile,
        r.vehiclePlate,
        r.workStatus,
        r.paymentStatus,
        r.createDate,
      ]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [rows, searchQuery]);

  useEffect(() => setCurrentPage(1), [pageSize, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const pageRows = filtered.slice(startIndex, startIndex + pageSize);

  // -------------------- EXPORT --------------------
  const handleExport = () => {
    const start = new Date(exportDates.startDate);
    const end = new Date(exportDates.endDate);
    end.setHours(23, 59, 59, 999);

    const list = rows.filter((r) => {
      if (!r.createdAtIso) return false;
      const d = new Date(r.createdAtIso);
      return d >= start && d <= end;
    });

    let csv = "Job Order ID,Order Type,Customer Name,Mobile,Vehicle Plate,Work Status,Payment Status,Create Date\n";
    for (const r of list) {
      csv += `"${r.orderNumber}","${r.orderType}","${r.customerName}","${r.mobile}","${r.vehiclePlate}","${r.workStatus}","${r.paymentStatus}","${r.createDate}"\n`;
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);

    setShowExportModal(false);
  };

  // -------------------- DETAILS LOADER --------------------
  const openDetails = async (orderNumber: string) => {
    const orderKey = String(orderNumber ?? "").trim();
    if (!orderKey) return;

    const cached = detailsCacheRef.current.get(orderKey);
    if (cached) {
      setSelectedOrder(cached);
      return;
    }

    setLoading(true);
    try {
      const detailed = await getJobOrderByOrderNumber(orderKey);
      if (!detailed?._backendId) throw new Error("Order not found in backend.");

      // Get latest JobOrder row for normalized fields/enums
      const rowRes = await client.models.JobOrder.get({ id: String(detailed._backendId) } as any);
      const row = (rowRes as any)?.data ?? null;

      const parsed = safeJsonParse<any>(row?.dataJson, {});

      // vehicle plate (sync from row)
      const vehiclePlate = String(row?.plateNumber ?? detailed?.vehiclePlate ?? parsed?.plateNumber ?? "");

      // parallel: customer details, vehicle id, roadmap steps, invoices — all independent from each other
      const [customerDetails, vehicleId, normalizedRoadmap, normalizedInvoices] = await Promise.all([
        row?.customerId
          ? loadCustomerDetails(client, String(row.customerId), customerDetailsCacheRef.current)
          : Promise.resolve(null),
        loadVehicleIdByPlate(client, vehiclePlate, vehicleIdCacheRef.current),
        loadNormalizedRoadmap(client, String(detailed._backendId), roadmapCacheRef.current),
        loadNormalizedInvoices(client, String(detailed._backendId), invoicesCacheRef.current),
      ]);

      const vehicleDetails = {
        vehicleId: vehicleId ?? "N/A",
        ownedBy: customerDetails?.name ?? detailed?.customerName ?? "N/A",
        make: row?.vehicleMake ?? null,
        model: row?.vehicleModel ?? null,
        year: row?.vehicleYear ?? null,
        type: row?.vehicleType ?? null,
        color: row?.color ?? null,
        plateNumber: vehiclePlate || "N/A",
        vin: row?.vin ?? null,
        registrationDate: null,
      };

      const detailedRoadmap = Array.isArray(detailed?.roadmap) ? detailed.roadmap : [];
      const parsedRoadmap = Array.isArray(parsed?.roadmap) ? parsed.roadmap : [];
      const roadmap: RoadmapStepUi[] = mergeRoadmapSources(
        normalizedRoadmap,
        detailedRoadmap,
        parsedRoadmap,
        String(row?.createdAt ?? "")
      );

      // documents: prefer parsed/documents, but accept detailed.documents as well
      const documents: DocUi[] =
        Array.isArray(parsed?.documents) ? parsed.documents : Array.isArray(detailed?.documents) ? detailed.documents : [];

      // billing from row fields (truth)
      const totalAmountRaw = toNum(pickBillingFirstValue("totalAmount", detailed, row, parsed));
      const discountRaw = toNum(pickBillingFirstValue("discount", detailed, row, parsed));
      const amountPaidRaw = toNum(pickBillingFirstValue("amountPaid", detailed, row, parsed));
      const paymentSnap = computePaymentSnapshot(totalAmountRaw, discountRaw, amountPaidRaw);

      const billing = {
        billId: String(row?.billId ?? parsed?.billing?.billId ?? detailed?.billing?.billId ?? ""),
        totalAmount: fmtQar(paymentSnap.totalAmount),
        discount: fmtQar(paymentSnap.discount),
        netAmount: fmtQar(paymentSnap.netAmount),
        amountPaid: fmtQar(paymentSnap.amountPaid),
        balanceDue: fmtQar(paymentSnap.balanceDue),
        paymentMethod: String(row?.paymentMethod ?? parsed?.billing?.paymentMethod ?? detailed?.billing?.paymentMethod ?? ""),
        invoices: normalizedInvoices, // ✅ normalized invoices
      };

      const hasAnyExitPermitData = Boolean(
        parsed?.exitPermit ||
          detailed?.exitPermit ||
          parsed?.exitPermitInfo ||
          detailed?.exitPermitInfo ||
          row?.exitPermitStatus ||
          row?.exitPermitDate ||
          row?.nextServiceDate
      );

      const mergedExitPermit = hasAnyExitPermitData
        ? {
            permitId:
              String(
                parsed?.exitPermit?.permitId ??
                  detailed?.exitPermit?.permitId ??
                  parsed?.exitPermitInfo?.permitId ??
                  detailed?.exitPermitInfo?.permitId ??
                  ""
              ).trim(),
            createDate:
              String(
                parsed?.exitPermit?.createDate ??
                  detailed?.exitPermit?.createDate ??
                  parsed?.exitPermitInfo?.createDate ??
                  detailed?.exitPermitInfo?.createDate ??
                  normalizeDateTimeForSummary(row?.exitPermitDate ?? detailed?.exitPermitDate ?? row?.updatedAt) ??
                  ""
              ).trim(),
            nextServiceDate:
              String(
                parsed?.exitPermit?.nextServiceDate ??
                  detailed?.exitPermit?.nextServiceDate ??
                  parsed?.exitPermitInfo?.nextServiceDate ??
                  detailed?.exitPermitInfo?.nextServiceDate ??
                  row?.nextServiceDate ??
                  ""
              ).trim(),
            createdBy:
              String(
                parsed?.exitPermit?.createdBy ??
                  detailed?.exitPermit?.createdBy ??
                  parsed?.exitPermitInfo?.createdBy ??
                  detailed?.exitPermitInfo?.createdBy ??
                  parsed?.exitPermitInfo?.actionBy ??
                  detailed?.exitPermitInfo?.actionBy ??
                  row?.updatedBy ??
                  detailed?.updatedBy ??
                  ""
              ).trim(),
            collectedBy:
              String(
                parsed?.exitPermit?.collectedBy ??
                  detailed?.exitPermit?.collectedBy ??
                  parsed?.exitPermitInfo?.collectedBy ??
                  detailed?.exitPermitInfo?.collectedBy ??
                  ""
              ).trim(),
            collectedByMobile:
              String(
                parsed?.exitPermit?.collectedByMobile ??
                  detailed?.exitPermit?.collectedByMobile ??
                  parsed?.exitPermitInfo?.collectedByMobile ??
                  detailed?.exitPermitInfo?.collectedByMobile ??
                  parsed?.exitPermitInfo?.mobileNumber ??
                  detailed?.exitPermitInfo?.mobileNumber ??
                  ""
              ).trim(),
            status:
              String(
                parsed?.exitPermit?.status ??
                  detailed?.exitPermit?.status ??
                  parsed?.exitPermitInfo?.status ??
                  detailed?.exitPermitInfo?.status ??
                  row?.exitPermitStatus ??
                  detailed?.exitPermitStatus ??
                  ""
              ).trim(),
          }
        : null;

  const summaryActors = resolveSummaryActors(row, detailed, parsed, roadmap);

  const summarySourceOrder = {
    ...detailed,
    roadmap,
    customerDetails,
    vehicleDetails,
    createdBy: summaryActors.createdBy,
    updatedBy: summaryActors.updatedBy,
    jobOrderSummary: {
      ...(detailed?.jobOrderSummary ?? {}),
      ...(parsed?.jobOrderSummary ?? {}),
      createdBy: summaryActors.createdBy,
      updatedBy: summaryActors.updatedBy,
    },
  };

  const resolvedCreatedBy = resolveOrderCreatedBy(summarySourceOrder, {
    identityToUsernameMap: userLabelMap,
    fallback: "—",
  });

  const resolvedUpdatedBy = resolveOrderUpdatedBy(summarySourceOrder, {
    identityToUsernameMap: userLabelMap,
    fallback: "—",
  });

      const merged: DetailsOrder = {
        ...detailed,
        _backendId: String(detailed._backendId),
        id: orderKey,

        orderType: String(row?.orderType ?? detailed?.orderType ?? parsed?.orderType ?? "Job Order"),
        customerName: String(row?.customerName ?? detailed?.customerName ?? parsed?.customerName ?? ""),
        mobile: String(row?.customerPhone ?? detailed?.mobile ?? parsed?.customerPhone ?? ""),
        vehiclePlate: vehiclePlate,

        workStatus: uiWorkStatus(row?.status, row?.workStatusLabel ?? parsed?.workStatusLabel ?? detailed?.workStatus),
        paymentStatus: derivePaymentStatusFromFinancials({
          paymentEnum: pickPaymentEnum(detailed, row, parsed),
          paymentLabel: pickPaymentLabel(detailed, row, parsed),
          totalAmount: pickBillingFirstValue("totalAmount", detailed, row, parsed),
          discount: pickBillingFirstValue("discount", detailed, row, parsed),
          amountPaid: pickBillingFirstValue("amountPaid", detailed, row, parsed),
          netAmount: pickBillingFirstValue("netAmount", detailed, row, parsed),
          balanceDue: pickBillingFirstValue("balanceDue", detailed, row, parsed),
        }),

        customerDetails: customerDetails ?? {
          customerId: row?.customerId ?? "N/A",
          name: String(row?.customerName ?? detailed?.customerName ?? "—"),
          mobile: String(row?.customerPhone ?? detailed?.mobile ?? "—"),
          email: String(row?.customerEmail ?? "—"),
          address: "—",
          registeredVehiclesCount: 0,
          completedServicesCount: 0,
          customerSince: "—",
        },

        vehicleDetails,

        roadmap,
        billing,
        documents,

        exitPermit: mergedExitPermit,
        customerNotes: parsed?.customerNotes ?? row?.customerNotes ?? detailed?.customerNotes ?? null,

        paymentActivityLog: Array.isArray(detailed?.paymentActivityLog) ? detailed.paymentActivityLog : [],

        summary: {
          jobOrderId: String(orderKey || "—"),
          orderType: String(row?.orderType ?? detailed?.orderType ?? parsed?.orderType ?? "Job Order"),
          requestCreateDate: normalizeDateForSummary(row?.createdAt ?? detailed?.createDate ?? parsed?.createDate),
          requestCreateDateTime: normalizeDateTimeForSummary(row?.createdAt ?? detailed?.createDate ?? parsed?.createDate),
          createdBy: toSummaryText(resolvedCreatedBy),
          expectedDeliveryDate: normalizeDateForSummary(
            parsed?.expectedDeliveryDate ?? row?.expectedDeliveryDate ?? detailed?.expectedDeliveryDate
          ),
          workStatus: uiWorkStatus(row?.status, row?.workStatusLabel ?? parsed?.workStatusLabel ?? detailed?.workStatus),
          paymentStatus: derivePaymentStatusFromFinancials({
            paymentEnum: pickPaymentEnum(detailed, row, parsed),
            paymentLabel: pickPaymentLabel(detailed, row, parsed),
            totalAmount: pickBillingFirstValue("totalAmount", detailed, row, parsed),
            discount: pickBillingFirstValue("discount", detailed, row, parsed),
            amountPaid: pickBillingFirstValue("amountPaid", detailed, row, parsed),
            netAmount: pickBillingFirstValue("netAmount", detailed, row, parsed),
            balanceDue: pickBillingFirstValue("balanceDue", detailed, row, parsed),
          }),
          exitPermitStatus: toSummaryStatus(
            parsed?.exitPermit?.status ?? parsed?.exitPermitInfo?.status ?? row?.exitPermitStatus ?? detailed?.exitPermitStatus,
            "Not Created",
            Boolean(
              parsed?.exitPermit?.permitId ??
                detailed?.exitPermit?.permitId ??
                row?.exitPermit?.permitId
            )
          ),
          customerName: toSummaryText(row?.customerName ?? detailed?.customerName ?? parsed?.customerName),
          customerMobile: toSummaryText(row?.customerPhone ?? detailed?.mobile ?? parsed?.customerPhone),
          vehiclePlate: toSummaryText(vehiclePlate || row?.plateNumber || detailed?.vehiclePlate),
          orderStatusEnum: toSummaryText(row?.status, "—"),
          paymentStatusEnum: toSummaryText(row?.paymentStatus, "—"),
          updatedAt: normalizeDateTimeForSummary(row?.updatedAt ?? detailed?.updatedAt),
          updatedBy: toSummaryText(resolvedUpdatedBy),
        },
      };

      detailsCacheRef.current.set(orderKey, merged);
      setSelectedOrder(merged);
    } catch (e) {
      alert(`Load failed: ${errMsg(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const closeDetails = () => {
    setSelectedOrder(null);

    if (navSource && onNavigateBack) {
      const src = navSource;
      const v = returnVehicleId;
      setNavSource(null);
      setReturnVehicleId(null);
      onNavigateBack(src, v);
    }
  };

  // ===================== DETAILS SCREEN =====================
  if (selectedOrder) {
    return (
      <JobHistoryDetails
        order={selectedOrder}
        loading={loading}
        onClose={closeDetails}
        currentUser={currentUser}
        displayUser={displayUser}
        actorMap={userLabelMap}
      />
    );
  }

  // ===================== LIST SCREEN =====================
  return (
    <div className="jh-root">
      <header className="jh-header crm-unified-header">
        <div className="jh-header-left">
          <h1>
            <i className="fas fa-history" /> Job Order History
          </h1>
          <div className="jh-sub">
            Cancelled + Unpaid and Completed + Fully Paid job orders (live from backend)
          </div>
        </div>
      </header>

      <main className="jh-main">
        <section className="jh-search">
          <div className="jh-search-box">
            <i className="fas fa-search" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Job ID, Customer, Plate, Status..."
              autoComplete="off"
            />
          </div>

          <div className="jh-search-meta">
            {filtered.length === 0 ? (
              <span>No job orders found</span>
            ) : (
              <span>
                Showing {Math.min(startIndex + 1, filtered.length)}-
                {Math.min(startIndex + pageSize, filtered.length)} of {filtered.length}
                {searchQuery ? <span className="jh-filtered"> (Filtered)</span> : null}
              </span>
            )}
          </div>
        </section>

        <section className="jh-section">
          <div className="jh-section-head">
            <h2>
              <i className="fas fa-list" /> Job Order Records
            </h2>

            <div className="jh-controls">
              <div className="jh-pagesize">
                <label>Records per page</label>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(parseInt(e.target.value, 10));
                    setCurrentPage(1);
                  }}
                >
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>

              <PermissionGate moduleId="jobhistory" optionId="jobhistory_export">
                <button className="jh-btn jh-btn-secondary" type="button" onClick={() => setShowExportModal(true)}>
                  <i className="fas fa-file-export" /> Export
                </button>
              </PermissionGate>
            </div>
          </div>

          {pageRows.length === 0 ? (
            <div className="jh-empty">
              <div className="jh-empty-ic">
                <i className="fas fa-search" />
              </div>
              <div className="jh-empty-title">{loading ? "Loading..." : "No matching job orders found"}</div>
              <div className="jh-empty-sub">Try adjusting your search terms.</div>
            </div>
          ) : (
            <>
              <div className="jh-table-wrap">
                <table className="jh-table">
                  <thead>
                    <tr>
                      <th>Create Date</th>
                      <th>Job Card ID</th>
                      <th>Order Type</th>
                      <th>Customer</th>
                      <th>Mobile</th>
                      <th>Plate</th>
                      <th>Work Status</th>
                      <th>Payment Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {pageRows.map((r) => (
                      <tr key={r._backendId}>
                        <td className="jh-muted">{r.createDate || "—"}</td>
                        <td className="jh-strong">{r.orderNumber}</td>
                        <td>
                          <span className={orderTypeClass(r.orderType)}>{r.orderType}</span>
                        </td>
                        <td>{r.customerName || "—"}</td>
                        <td>{r.mobile || "—"}</td>
                        <td>{r.vehiclePlate || "—"}</td>
                        <td>
                          <span className={workStatusClass(r.workStatus)}>{r.workStatus}</span>
                        </td>
                        <td>
                          <span className={paymentStatusClass(r.paymentStatus)}>{r.paymentStatus}</span>
                        </td>
                        <td>
                          <PermissionGate moduleId="jobhistory" optionId="jobhistory_view">
                            <button
                              className="jh-btn jh-btn-primary"
                              type="button"
                              onClick={() => void openDetails(r.orderNumber)}
                            >
                              <i className="fas fa-eye" /> View Details
                            </button>
                          </PermissionGate>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="jh-pagination">
                  <button
                    className="jh-pagebtn"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    type="button"
                  >
                    <i className="fas fa-chevron-left" />
                  </button>

                  <div className="jh-pages">
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
                          className={`jh-pagebtn ${pageNum === currentPage ? "active" : ""}`}
                          onClick={() => setCurrentPage(pageNum)}
                          type="button"
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    className="jh-pagebtn"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    type="button"
                  >
                    <i className="fas fa-chevron-right" />
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="jh-footer">
        <p>Service Management System © 2023 | Job Order History Module</p>
      </footer>

      {/* Export Modal */}
      {showExportModal && (
        <div className="jh-modal-overlay" role="dialog" aria-modal="true">
          <div className="jh-modal">
            <div className="jh-modal-head">
              <h3>
                <i className="fas fa-file-export" /> Export Data
              </h3>
              <button className="jh-x" type="button" onClick={() => setShowExportModal(false)} aria-label="Close">
                ✕
              </button>
            </div>

            <div className="jh-modal-body">
              <div className="jh-grid2">
                <div className="jh-field">
                  <label>From Date</label>
                  <input
                    type="date"
                    value={exportDates.startDate}
                    onChange={(e) => setExportDates((p) => ({ ...p, startDate: e.target.value }))}
                  />
                </div>

                <div className="jh-field">
                  <label>To Date</label>
                  <input
                    type="date"
                    value={exportDates.endDate}
                    onChange={(e) => setExportDates((p) => ({ ...p, endDate: e.target.value }))}
                  />
                </div>
              </div>

              <div className="jh-hint">
                Export downloads a CSV file (Excel-compatible).
              </div>
            </div>

            <div className="jh-modal-actions">
              <button className="jh-btn jh-btn-ghost" type="button" onClick={() => setShowExportModal(false)}>
                Cancel
              </button>
              <button className="jh-btn jh-btn-primary" type="button" onClick={handleExport}>
                Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function JobHistoryDetails({
  order,
  loading,
  onClose,
  displayUser,
  actorMap,
}: {
  order: DetailsOrder;
  loading: boolean;
  onClose: () => void;
  currentUser: any;
  displayUser: (value: any) => string;
  actorMap: Record<string, string>;
}) {
  const roadmap: RoadmapStepUi[] = Array.isArray(order?.roadmap) ? order.roadmap : [];
  const docs: DocUi[] = Array.isArray(order?.documents) ? order.documents : [];
  const services: any[] = Array.isArray(order?.services) ? order.services : [];
  const servicesCompleted = services.filter((service: any) => String(service?.status ?? "").trim().toLowerCase() === "completed").length;
  const servicesProgressPercent = services.length ? Math.round((servicesCompleted / services.length) * 100) : 0;
  const servicesProgressLabel = services.length ? `${servicesCompleted}/${services.length} completed` : "0/0 completed";
  const createdByDisplay = resolveOrderCreatedBy(order, {
    identityToUsernameMap: actorMap,
    fallback: "—",
  });

  return (
    <div className="jh-details jo-details-v3">
      <div className="jh-details-head">
        <div className="jh-details-title">
          <h2>
            <i className="fas fa-clipboard-list" /> Job Order Details - <span>{order.id}</span>
          </h2>
          {loading ? <span className="jh-loading">Loading…</span> : null}
        </div>

        <button className="jh-btn jh-btn-ghost" type="button" onClick={onClose}>
          <i className="fas fa-times" /> Close
        </button>
      </div>

      <div className="jh-details-body">
        <div className="jh-grid">
          <PermissionGate moduleId="jobhistory" optionId="jobhistory_summary">
            <UnifiedJobOrderSummaryCard
              order={order}
              className="jh-summary-card"
              identityToUsernameMap={actorMap}
              createdByOverride={createdByDisplay}
              paymentStatusOverride={uiPaymentStatus(undefined, order?.paymentStatus)}
            />
          </PermissionGate>

          <PermissionGate moduleId="jobhistory" optionId="jobhistory_customer">
            <UnifiedCustomerInfoCard order={order} className="cv-unified-card" />
          </PermissionGate>

          <PermissionGate moduleId="jobhistory" optionId="jobhistory_vehicle">
            <UnifiedVehicleInfoCard order={order} className="cv-unified-card" />
          </PermissionGate>

          <PermissionGate moduleId="jobhistory" optionId="jobhistory_roadmap">
            <div className="jh-card jh-span-2">
              {roadmap.length === 0 ? (
                <div className="jh-empty-inline">No roadmap data.</div>
              ) : (
                <UnifiedJobOrderRoadmap order={{ ...order, roadmap }} />
              )}
            </div>
          </PermissionGate>

          <PermissionGate moduleId="jobhistory" optionId="jobhistory_services">
            <div className="pim-detail-card jh-services-card jh-span-2">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: "0 0 12px 0" }}>
                    <i className="fas fa-tasks" /> Services Summary ({services.length})
                  </h3>
                  {services.length ? (
                    <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                      <div style={{ flex: 1, minHeight: "8px" }}>
                        <div className="epm-progress-bar" style={{ height: "8px" }}>
                          <div className="epm-progress-fill" style={{ width: `${servicesProgressPercent}%`, height: "100%" }} />
                        </div>
                      </div>
                      <span className="epm-progress-text" style={{ fontSize: "12px", color: "#666" }}>
                        {servicesProgressLabel}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="pim-services-list">
                {services.length ? (
                  services.map((svc: any, idx: number) => (
                    <div key={svc?.id ?? idx} className="pim-service-item">
                      <div className="pim-service-header">
                        <span className="pim-service-name">{String(svc?.name ?? "Service")}</span>
                        <span className="pim-service-price">{svc?.price != null ? fmtQar(toNum(svc.price)) : "N/A"}</span>
                      </div>

                      <div className="pim-service-meta">
                        {getServiceSpecificationLabel(svc) ? (
                          <div className="pim-service-meta-row" style={{ gridColumn: "span 2" }}>
                            <span className="pim-service-meta-label">Specification:</span>
                            <span className="pim-service-meta-value" data-no-translate="true" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              {getServiceSpecificationColor(svc) ? (
                                <span
                                  aria-hidden="true"
                                  style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: 999,
                                    background: getServiceSpecificationColor(svc),
                                    border: "1px solid rgba(15, 23, 42, 0.14)",
                                    display: "inline-block",
                                  }}
                                ></span>
                              ) : null}
                              {getServiceSpecificationLabel(svc)}
                            </span>
                          </div>
                        ) : null}
                        <div className="pim-service-meta-row">
                          <span className="pim-service-meta-label">Status:</span>
                          <span className="pim-service-meta-value">{String(svc?.status ?? "N/A")}</span>
                        </div>
                        <div className="pim-service-meta-row">
                          <span className="pim-service-meta-label">Technician:</span>
                          <span className="pim-service-meta-value">{resolveHistoryServiceActor(svc, displayUser)}</span>
                        </div>
                        {svc?.started ? (
                          <div className="pim-service-meta-row">
                            <span className="pim-service-meta-label">Started:</span>
                            <span className="pim-service-meta-value">{String(svc.started)}</span>
                          </div>
                        ) : null}
                        {svc?.ended ? (
                          <div className="pim-service-meta-row">
                            <span className="pim-service-meta-label">Ended:</span>
                            <span className="pim-service-meta-value">{String(svc.ended)}</span>
                          </div>
                        ) : null}
                        <div className="pim-service-meta-row">
                          <span className="pim-service-meta-label">Duration:</span>
                          <span className="pim-service-meta-value">{formatHistoryServiceDuration(svc?.started, svc?.ended)}</span>
                        </div>
                        {svc?.notes ? (
                          <div className="pim-service-meta-row" style={{ gridColumn: "span 2" }}>
                            <span className="pim-service-meta-label">Notes:</span>
                            <span className="pim-service-meta-value">{String(svc.notes)}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="jh-empty-inline">No services in this order.</div>
                )}
              </div>
            </div>
          </PermissionGate>

          <PermissionGate moduleId="jobhistory" optionId="jobhistory_notes">
            {order.customerNotes ? (
              <div className="jh-card jh-span-2">
                <h3><i className="fas fa-sticky-note" /> Customer Notes</h3>
                <div className="jh-notebox">{String(order.customerNotes)}</div>
              </div>
            ) : null}
          </PermissionGate>

          <PermissionGate moduleId="jobhistory" optionId="jobhistory_billing">
            <UnifiedBillingInvoicesSection order={order} className="jh-card jh-span-2" />
          </PermissionGate>

          <PermissionGate moduleId="jobhistory" optionId="jobhistory_exitpermit">
            {order.exitPermit ? (
              <div className="jh-card ex-unified-card">
                <h3><i className="fas fa-id-card" /> Exit Permit</h3>
                <div className="jh-kv ex-unified-grid">
                  <div><span>Status</span><strong className={permitStatusClass(toSummaryStatus(order?.exitPermitStatus ?? order?.exitPermit?.status, "Not Created", Boolean(order?.exitPermit?.permitId)))}>{toSummaryStatus(order?.exitPermitStatus ?? order?.exitPermit?.status, "Not Created", Boolean(order?.exitPermit?.permitId))}</strong></div>
                  <div><span>Permit ID</span><strong>{order.exitPermit?.permitId || "—"}</strong></div>
                  <div><span>Create Date</span><strong>{order.exitPermit?.createDate || "—"}</strong></div>
                  <div><span>Next Service</span><strong>{order.exitPermit?.nextServiceDate || "—"}</strong></div>
                  <div><span>Created By</span><strong>{displayUser(resolveExitPermitActor(order, roadmap))}</strong></div>
                  <div><span>Collected By</span><strong>{order.exitPermit?.collectedBy || "—"}</strong></div>
                  <div><span>Mobile</span><strong>{order.exitPermit?.collectedByMobile || "—"}</strong></div>
                </div>
              </div>
            ) : (
              <div className="jh-card">
                <h3><i className="fas fa-id-card" /> Exit Permit</h3>
                <div className="jh-empty-inline">No exit permit data found.</div>
              </div>
            )}
          </PermissionGate>

          <PermissionGate moduleId="jobhistory" optionId="jobhistory_documents">
            <div className="jh-card jh-span-2">
              <h3><i className="fas fa-folder-open" /> Documents</h3>
              {docs.length ? (
                <div className="jh-docs">
                  {docs.map((d, idx) => (
                    <div className="jh-doc" key={d.id ?? idx}>
                      <div className="jh-doc-left">
                        <div className="jh-doc-name">{d.name}</div>
                        <div className="jh-doc-meta">
                          {[
                            d.type,
                            d.category,
                            d.paymentReference,
                            String((d as any)?.addedAt ?? (d as any)?.generatedAt ?? (d as any)?.createdAt ?? (d as any)?.uploadedAt ?? (d as any)?.timestamp ?? "").trim()
                              ? `Generated: ${String((d as any)?.addedAt ?? (d as any)?.generatedAt ?? (d as any)?.createdAt ?? (d as any)?.uploadedAt ?? (d as any)?.timestamp ?? "").trim()}`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" • ")}
                        </div>
                      </div>

                      <PermissionGate moduleId="jobhistory" optionId="jobhistory_download">
                        <button
                          type="button"
                          className="jh-btn jh-btn-primary"
                          onClick={async () => {
                            const raw = String(d.storagePath || d.url || "");
                            const linkUrl = await resolveMaybeStorageUrl(raw);
                            if (!linkUrl) return;
                            window.open(linkUrl, "_blank", "noopener,noreferrer");
                          }}
                        >
                          <i className="fas fa-download" /> Download
                        </button>
                      </PermissionGate>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="jh-empty-inline">No documents available.</div>
              )}
            </div>
          </PermissionGate>
        </div>
      </div>
    </div>
  );
}