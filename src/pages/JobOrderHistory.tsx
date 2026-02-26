// src/pages/JobOrderHistory.tsx
import  { useEffect, useMemo, useState } from "react";
import "./JobOrderHistory.css";

import PermissionGate from "./PermissionGate";
import { getDataClient } from "../lib/amplifyClient";
import { getUserDirectory } from "../utils/userDirectoryCache";

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
      return "Inprogress";
    case "OPEN":
      return "New Request";
    case "DRAFT":
      return "Draft";
    default:
      return "Completed";
  }
}

function uiPaymentStatus(enumVal?: string, label?: string) {
  // ✅ enum first (truth)
  const ps = String(enumVal ?? "").toUpperCase();
  if (ps === "PAID") return "Fully Paid";
  if (ps === "PARTIAL") return "Partially Paid";
  if (ps === "UNPAID") return "Unpaid";

  // fallback label
  const lbl = String(label ?? "").trim();
  if (lbl) return lbl;

  return "Unpaid";
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

function toSummaryStatus(v: any, fallback = "Not Created") {
  const out = String(v ?? "").trim();
  return out || fallback;
}

function includeInJobHistory(workStatus: string, paymentStatus: string) {
  const work = normalizeIdentity(workStatus);
  const payment = normalizeIdentity(paymentStatus);
  const isCancelledAndUnpaid = work === "cancelled" && payment === "unpaid";
  const isCompletedAndFullyPaid = work === "completed" && payment === "fully paid";
  return isCancelledAndUnpaid || isCompletedAndFullyPaid;
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
  return String(step ?? "").trim().toLowerCase();
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

async function loadNormalizedInvoices(client: any, jobOrderId: string): Promise<InvoiceUi[]> {
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
}

async function loadNormalizedRoadmap(client: any, jobOrderId: string): Promise<RoadmapStepUi[]> {
  try {
    let rows: any[] = [];
    try {
      const byIdx = await (client.models.JobOrderRoadmapStep as any).listRoadmapByJobOrder?.({
        jobOrderId: String(jobOrderId),
        limit: 2000,
      });
      rows = (byIdx?.data ?? []) as any[];
    } catch {
      const res = await client.models.JobOrderRoadmapStep.list({
        limit: 2000,
        filter: { jobOrderId: { eq: String(jobOrderId) } } as any,
      });
      rows = (res?.data ?? []) as any[];
    }

    if (!rows.length) return [];

    // Sort by createdAt, then step
    rows.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));

    return rows
      .map((r) => normalizeRoadmapStep(r))
      .filter(Boolean) as RoadmapStepUi[];
  } catch {
    return [];
  }
}

async function loadVehicleIdByPlate(client: any, plateNumber: string): Promise<string | null> {
  const plate = String(plateNumber ?? "").trim();
  if (!plate) return null;

  try {
    const byIdx = await (client.models.Vehicle as any).vehiclesByPlateNumber?.({
      plateNumber: plate,
      limit: 1,
    });
    const row = (byIdx?.data ?? [])[0];
    if (row?.vehicleId) return String(row.vehicleId);
  } catch {}

  try {
    const res = await client.models.Vehicle.list({
      filter: { plateNumber: { eq: plate } } as any,
      limit: 1,
    });
    const row = (res?.data ?? [])[0];
    if (row?.vehicleId) return String(row.vehicleId);
  } catch {}

  return null;
}

async function loadCustomerDetails(client: any, customerId: string) {
  const id = String(customerId ?? "").trim();
  if (!id) return null;

  try {
    const cRes = await client.models.Customer.get({ id } as any);
    const c = (cRes as any)?.data ?? null;
    if (!c?.id) return null;

    // registered vehicles count
    let vehiclesCount = 0;
    try {
      const vRes = await (client.models.Vehicle as any).vehiclesByCustomer?.({
        customerId: id,
        limit: 2000,
      });
      vehiclesCount = (vRes?.data ?? []).length;
    } catch {
      try {
        const vRes2 = await client.models.Vehicle.list({
          filter: { customerId: { eq: id } } as any,
          limit: 2000,
        });
        vehiclesCount = (vRes2?.data ?? []).length;
      } catch {}
    }

    const fullName = `${String(c.name ?? "")} ${String(c.lastname ?? "")}`.trim();

    return {
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
  } catch {
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

function paymentStatusClass(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s.includes("fully paid")) return "jh-badge jh-badge-success";
  if (s.includes("partially")) return "jh-badge jh-badge-warn";
  if (s.includes("unpaid")) return "jh-badge jh-badge-danger";
  if (s.includes("refunded")) return "jh-badge jh-badge-neutral";
  return "jh-badge jh-badge-neutral";
}

function orderTypeClass(type: string) {
  return String(type ?? "").toLowerCase().includes("new") ? "jh-pill jh-pill-blue" : "jh-pill jh-pill-slate";
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

  const [navSource, setNavSource] = useState<string | null>(null);
  const [returnVehicleId, setReturnVehicleId] = useState<string | null>(null);

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

  const displayUser = (value: any) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "—";
    return userLabelMap[normalizeIdentity(raw)] || raw;
  };

  // -------------------- LIVE HISTORY LIST --------------------
  useEffect(() => {
    const sub = (client.models.JobOrder as any)
      .observeQuery({
        limit: 2000,
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
          const paymentStatus = uiPaymentStatus(row.paymentStatus, row.paymentStatusLabel ?? parsed?.paymentStatusLabel);

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
        .filter((row: ListRow) => includeInJobHistory(row.workStatus, row.paymentStatus));

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

    const t = setTimeout(() => {
      onClearNavigation?.();
    }, 100);

    return () => clearTimeout(t);
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
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `job_history_${exportDates.startDate}_to_${exportDates.endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setShowExportModal(false);
  };

  // -------------------- DETAILS LOADER --------------------
  const openDetails = async (orderNumber: string) => {
    setLoading(true);
    try {
      const detailed = await getJobOrderByOrderNumber(orderNumber);
      if (!detailed?._backendId) throw new Error("Order not found in backend.");

      // Get latest JobOrder row for normalized fields/enums
      const rowRes = await client.models.JobOrder.get({ id: String(detailed._backendId) } as any);
      const row = (rowRes as any)?.data ?? null;

      const parsed = safeJsonParse<any>(row?.dataJson, {});

      // customer details
      const customerDetails =
        row?.customerId ? await loadCustomerDetails(client, String(row.customerId)) : null;

      // vehicle details from JobOrder row (+ try vehicleId by plate)
      const vehiclePlate = String(row?.plateNumber ?? detailed?.vehiclePlate ?? parsed?.plateNumber ?? "");
      const vehicleId = await loadVehicleIdByPlate(client, vehiclePlate);

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

      // roadmap: prefer normalized steps if exist
      const normalizedRoadmap = await loadNormalizedRoadmap(client, String(detailed._backendId));
      const detailedRoadmap = Array.isArray(detailed?.roadmap) ? detailed.roadmap : [];
      const parsedRoadmap = Array.isArray(parsed?.roadmap) ? parsed.roadmap : [];
      const roadmap: RoadmapStepUi[] = mergeRoadmapSources(
        normalizedRoadmap,
        detailedRoadmap,
        parsedRoadmap,
        String(row?.createdAt ?? "")
      );

      // invoices: normalized tables
      const normalizedInvoices = await loadNormalizedInvoices(client, String(detailed._backendId));

      // documents: prefer parsed/documents, but accept detailed.documents as well
      const documents: DocUi[] =
        Array.isArray(parsed?.documents) ? parsed.documents : Array.isArray(detailed?.documents) ? detailed.documents : [];

      // billing from row fields (truth)
      const totalAmount = toNum(row?.totalAmount);
      const discount = toNum(row?.discount);
      const netAmount = toNum(row?.netAmount) > 0 ? toNum(row?.netAmount) : Math.max(0, totalAmount - discount);
      const amountPaid = toNum(row?.amountPaid);
      const balanceDue = toNum(row?.balanceDue);

      const billing = {
        billId: String(row?.billId ?? parsed?.billing?.billId ?? detailed?.billing?.billId ?? ""),
        totalAmount: fmtQar(totalAmount),
        discount: fmtQar(discount),
        netAmount: fmtQar(netAmount),
        amountPaid: fmtQar(amountPaid),
        balanceDue: fmtQar(balanceDue),
        paymentMethod: String(row?.paymentMethod ?? parsed?.billing?.paymentMethod ?? detailed?.billing?.paymentMethod ?? ""),
        invoices: normalizedInvoices, // ✅ normalized invoices
      };

      const merged: DetailsOrder = {
        ...detailed,
        _backendId: String(detailed._backendId),
        id: String(orderNumber),

        orderType: String(row?.orderType ?? detailed?.orderType ?? parsed?.orderType ?? "Job Order"),
        customerName: String(row?.customerName ?? detailed?.customerName ?? parsed?.customerName ?? ""),
        mobile: String(row?.customerPhone ?? detailed?.mobile ?? parsed?.customerPhone ?? ""),
        vehiclePlate: vehiclePlate,

        workStatus: uiWorkStatus(row?.status, row?.workStatusLabel ?? parsed?.workStatusLabel ?? detailed?.workStatus),
        paymentStatus: uiPaymentStatus(row?.paymentStatus, row?.paymentStatusLabel ?? parsed?.paymentStatusLabel ?? detailed?.paymentStatus),

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

        exitPermit: parsed?.exitPermit ?? null, // if you store it in dataJson
        customerNotes: parsed?.customerNotes ?? row?.customerNotes ?? detailed?.customerNotes ?? null,

        paymentActivityLog: Array.isArray(detailed?.paymentActivityLog) ? detailed.paymentActivityLog : [],

        summary: {
          jobOrderId: String(orderNumber || "—"),
          orderType: String(row?.orderType ?? detailed?.orderType ?? parsed?.orderType ?? "Job Order"),
          requestCreateDate: normalizeDateForSummary(row?.createdAt ?? detailed?.createDate ?? parsed?.createDate),
          requestCreateDateTime: normalizeDateTimeForSummary(row?.createdAt ?? detailed?.createDate ?? parsed?.createDate),
          createdBy: toSummaryText(
            parsed?.createdBy ?? row?.createdBy ?? detailed?.createdBy ?? row?.updatedBy ?? detailed?.updatedBy
          ),
          expectedDeliveryDate: normalizeDateForSummary(
            parsed?.expectedDeliveryDate ?? row?.expectedDeliveryDate ?? detailed?.expectedDeliveryDate
          ),
          workStatus: uiWorkStatus(row?.status, row?.workStatusLabel ?? parsed?.workStatusLabel ?? detailed?.workStatus),
          paymentStatus: uiPaymentStatus(row?.paymentStatus, row?.paymentStatusLabel ?? parsed?.paymentStatusLabel ?? detailed?.paymentStatus),
          exitPermitStatus: toSummaryStatus(
            parsed?.exitPermit?.status ?? row?.exitPermitStatus ?? detailed?.exitPermitStatus,
            parsed?.exitPermit ? "Created" : "Not Created"
          ),
          customerName: toSummaryText(row?.customerName ?? detailed?.customerName ?? parsed?.customerName),
          customerMobile: toSummaryText(row?.customerPhone ?? detailed?.mobile ?? parsed?.customerPhone),
          vehiclePlate: toSummaryText(vehiclePlate || row?.plateNumber || detailed?.vehiclePlate),
          orderStatusEnum: toSummaryText(row?.status, "—"),
          paymentStatusEnum: toSummaryText(row?.paymentStatus, "—"),
          updatedAt: normalizeDateTimeForSummary(row?.updatedAt ?? detailed?.updatedAt),
          updatedBy: toSummaryText(row?.updatedBy ?? detailed?.updatedBy),
        },
      };

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
      />
    );
  }

  // ===================== LIST SCREEN =====================
  return (
    <div className="jh-root">
      <header className="jh-header">
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
}: {
  order: DetailsOrder;
  loading: boolean;
  onClose: () => void;
  currentUser: any;
  displayUser: (value: any) => string;
}) {
  const invoices: InvoiceUi[] = Array.isArray(order?.billing?.invoices) ? order.billing.invoices : [];
  const roadmap: RoadmapStepUi[] = Array.isArray(order?.roadmap) ? order.roadmap : [];
  const docs: DocUi[] = Array.isArray(order?.documents) ? order.documents : [];
  const summary = order?.summary ?? {};

  return (
    <div className="jh-details">
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
            <div className="jh-card">
              <h3><i className="fas fa-info-circle" /> Summary</h3>
              <div className="jh-kv">
                <div><span>Job Order ID</span><strong>{summary.jobOrderId || order.id}</strong></div>
                <div><span>Order Type</span><strong>{summary.orderType || order.orderType || "Job Order"}</strong></div>
                <div><span>Request Create Date</span><strong>{summary.requestCreateDate || "—"}</strong></div>
                <div><span>Created By</span><strong>{displayUser(summary.createdBy)}</strong></div>
                <div><span>Expected Delivery Date</span><strong>{summary.expectedDeliveryDate || "—"}</strong></div>
                <div><span>Work Status</span><strong className={workStatusClass(summary.workStatus || order.workStatus)}>{summary.workStatus || order.workStatus}</strong></div>
                <div><span>Payment Status</span><strong className={paymentStatusClass(summary.paymentStatus || order.paymentStatus)}>{summary.paymentStatus || order.paymentStatus}</strong></div>
                <div><span>Exit Permit Status</span><strong>{summary.exitPermitStatus || "Not Created"}</strong></div>
                <div><span>Customer Name</span><strong>{summary.customerName || order.customerName || "—"}</strong></div>
                <div><span>Customer Mobile</span><strong>{summary.customerMobile || order.mobile || "—"}</strong></div>
                <div><span>Vehicle Plate</span><strong>{summary.vehiclePlate || order.vehiclePlate || "—"}</strong></div>
                <div><span>Order Status (Enum)</span><strong>{summary.orderStatusEnum || "—"}</strong></div>
                <div><span>Payment Status (Enum)</span><strong>{summary.paymentStatusEnum || "—"}</strong></div>
                <div><span>Last Updated</span><strong>{summary.updatedAt || "—"}</strong></div>
                <div><span>Updated By</span><strong>{displayUser(summary.updatedBy)}</strong></div>
              </div>
            </div>
          </PermissionGate>

          <PermissionGate moduleId="jobhistory" optionId="jobhistory_customer">
            <div className="jh-card">
              <h3><i className="fas fa-user" /> Customer</h3>
              <div className="jh-kv">
                <div><span>Customer ID</span><strong>{order.customerDetails?.customerId || "—"}</strong></div>
                <div><span>Name</span><strong>{order.customerDetails?.name || order.customerName || "—"}</strong></div>
                <div><span>Mobile</span><strong>{order.customerDetails?.mobile || order.mobile || "—"}</strong></div>
                <div><span>Email</span><strong>{order.customerDetails?.email || "—"}</strong></div>
                <div><span>Address</span><strong>{order.customerDetails?.address || "—"}</strong></div>
                <div><span>Vehicles</span><strong>{order.customerDetails?.registeredVehiclesCount ?? 0}</strong></div>
                <div><span>Customer Since</span><strong>{order.customerDetails?.customerSince || "—"}</strong></div>
              </div>
            </div>
          </PermissionGate>

          <PermissionGate moduleId="jobhistory" optionId="jobhistory_vehicle">
            <div className="jh-card">
              <h3><i className="fas fa-car" /> Vehicle</h3>
              <div className="jh-kv">
                <div><span>Vehicle ID</span><strong>{order.vehicleDetails?.vehicleId || "—"}</strong></div>
                <div><span>Make</span><strong>{order.vehicleDetails?.make || "—"}</strong></div>
                <div><span>Model</span><strong>{order.vehicleDetails?.model || "—"}</strong></div>
                <div><span>Year</span><strong>{order.vehicleDetails?.year || "—"}</strong></div>
                <div><span>Type</span><strong>{order.vehicleDetails?.type || "—"}</strong></div>
                <div><span>Color</span><strong>{order.vehicleDetails?.color || "—"}</strong></div>
                <div><span>Plate</span><strong>{order.vehicleDetails?.plateNumber || order.vehiclePlate || "—"}</strong></div>
                <div><span>VIN</span><strong>{order.vehicleDetails?.vin || "—"}</strong></div>
              </div>
            </div>
          </PermissionGate>

          <PermissionGate moduleId="jobhistory" optionId="jobhistory_roadmap">
            <div className="jh-card jh-span-2">
              <h3><i className="fas fa-map-signs" /> Roadmap</h3>
              {roadmap.length === 0 ? (
                <div className="jh-empty-inline">No roadmap data.</div>
              ) : (
                <div className="jh-roadmap">
                  {roadmap.map((s, idx) => (
                    <div className="jh-step" key={idx}>
                      <div className="jh-step-top">
                        <div className="jh-step-name">{s.step}</div>
                        <span className="jh-pill jh-pill-slate">{s.status || "—"}</span>
                      </div>
                      <div className="jh-step-grid">
                        <div><span>Started</span><strong>{s.startTimestamp || "—"}</strong></div>
                        <div><span>Ended</span><strong>{s.endTimestamp || "—"}</strong></div>
                        <div><span>Action By</span><strong>{displayUser(s.actionBy)}</strong></div>
                        <div><span>Step Status</span><strong>{s.stepStatus || "—"}</strong></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </PermissionGate>

          <PermissionGate moduleId="jobhistory" optionId="jobhistory_services">
            <div className="jh-card jh-span-2">
              <h3><i className="fas fa-tasks" /> Services</h3>
              {Array.isArray(order.services) && order.services.length ? (
                <div className="jh-services">
                  {order.services.map((svc: any, idx: number) => (
                    <div className="jh-service" key={idx}>
                      <div className="jh-service-top">
                        <div className="jh-service-name">{String(svc.name ?? "Service")}</div>
                        <span className="jh-pill jh-pill-slate">{String(svc.status ?? "—")}</span>
                      </div>
                      <div className="jh-service-grid">
                        <div><span>Started</span><strong>{svc.started || "—"}</strong></div>
                        <div><span>Ended</span><strong>{svc.ended || "—"}</strong></div>
                        <div><span>Technician</span><strong>{displayUser(svc.technician || svc.assignedTo)}</strong></div>
                        <div><span>Price</span><strong>{svc.price != null ? fmtQar(toNum(svc.price)) : "—"}</strong></div>
                      </div>
                      {svc.notes ? <div className="jh-note">{String(svc.notes)}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="jh-empty-inline">No services in this order.</div>
              )}
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
            <div className="jh-card jh-span-2">
              <h3><i className="fas fa-receipt" /> Billing & Invoices</h3>

              <div className="jh-billing">
                <div><span>Bill ID</span><strong>{order.billing?.billId || "—"}</strong></div>
                <div><span>Total</span><strong>{order.billing?.totalAmount || "—"}</strong></div>
                <div><span>Discount</span><strong className="jh-green">{order.billing?.discount || "—"}</strong></div>
                <div><span>Net</span><strong>{order.billing?.netAmount || "—"}</strong></div>
                <div><span>Paid</span><strong className="jh-green">{order.billing?.amountPaid || "—"}</strong></div>
                <div><span>Balance</span><strong className="jh-red">{order.billing?.balanceDue || "—"}</strong></div>
                <div><span>Method</span><strong>{order.billing?.paymentMethod || "—"}</strong></div>
              </div>

              <div className="jh-subhead">
                <i className="fas fa-file-invoice" /> Invoices ({invoices.length})
              </div>

              {invoices.length === 0 ? (
                <div className="jh-empty-inline">No invoices found in normalized tables.</div>
              ) : (
                <div className="jh-invoices">
                  {invoices.map((inv) => (
                    <div className="jh-invoice" key={inv.id}>
                      <div className="jh-invoice-top">
                        <div>
                          <div className="jh-invoice-no">Invoice #{inv.number}</div>
                          {inv.createdAt ? <div className="jh-muted">{new Date(String(inv.createdAt)).toLocaleString("en-GB")}</div> : null}
                        </div>
                        <div className="jh-invoice-right">
                          <div className="jh-invoice-amt">{fmtQar(inv.amount)}</div>
                          <span className="jh-pill jh-pill-slate">{inv.status}</span>
                        </div>
                      </div>

                      <div className="jh-invoice-meta">
                        <div><span>Discount</span><strong>{fmtQar(inv.discount)}</strong></div>
                        <div><span>Method</span><strong>{inv.paymentMethod || "—"}</strong></div>
                      </div>

                      <div className="jh-invoice-services">
                        <div className="jh-muted">Services Included</div>
                        {inv.services.length ? (
                          <ul>
                            {inv.services.map((s, i) => (
                              <li key={i}><i className="fas fa-check-circle" /> {s}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="jh-empty-inline">No linked services.</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </PermissionGate>

          <PermissionGate moduleId="jobhistory" optionId="jobhistory_paymentlog">
            <div className="jh-card jh-span-2">
              <h3><i className="fas fa-history" /> Payment Activity Log</h3>

              {Array.isArray(order.paymentActivityLog) && order.paymentActivityLog.length ? (
                <div className="jh-table-wrap">
                  <table className="jh-table">
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
                      {[...order.paymentActivityLog].reverse().map((p: any, idx: number) => (
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
                <div className="jh-empty-inline">No payment activity.</div>
              )}
            </div>
          </PermissionGate>

          <PermissionGate moduleId="jobhistory" optionId="jobhistory_exitpermit">
            {order.exitPermit ? (
              <div className="jh-card">
                <h3><i className="fas fa-id-card" /> Exit Permit</h3>
                <div className="jh-kv">
                  <div><span>Permit ID</span><strong>{order.exitPermit?.permitId || "—"}</strong></div>
                  <div><span>Create Date</span><strong>{order.exitPermit?.createDate || "—"}</strong></div>
                  <div><span>Next Service</span><strong>{order.exitPermit?.nextServiceDate || "—"}</strong></div>
                  <div><span>Created By</span><strong>{order.exitPermit?.createdBy || "—"}</strong></div>
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
                          {[d.type, d.category, d.paymentReference].filter(Boolean).join(" • ")}
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
                            const a = document.createElement("a");
                            a.href = linkUrl;
                            a.download = d.name || "document";
                            a.click();
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