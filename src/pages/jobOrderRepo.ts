// src/pages/joborders/jobOrderRepo.ts
import type { Schema } from "../../amplify/data/resource";
import { getDataClient } from "../lib/amplifyClient";

type CustomerRow = Schema["Customer"]["type"];
type JobOrderRow = Schema["JobOrder"]["type"];

function toNum(x: any) {
  const n =
    typeof x === "number" ? x : Number(String(x ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatQar(n: number) {
  return `QAR ${Number(n || 0).toLocaleString()}`;
}

function makeFullName(c: any) {
  return `${String(c?.name ?? "")} ${String(c?.lastname ?? "")}`.trim();
}

function safeLower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function safeJsonParse<T>(raw: unknown): T | null {
  try {
    if (raw == null) return null;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return null;
      return JSON.parse(s) as T;
    }
    return raw as T;
  } catch {
    return null;
  }
}

async function listAll<T>(
  listFn: (args: any) => Promise<any>,
  max = 5000
): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | null | undefined = undefined;
  while (out.length < max) {
    const res = await listFn({ limit: 1000, nextToken });
    out.push(...((res?.data ?? []) as T[]));
    nextToken = res?.nextToken;
    if (!nextToken) break;
  }
  return out.slice(0, max);
}

function mapWorkStatusToDbStatus(
  workStatusLabel: string | undefined
): JobOrderRow["status"] {
  const s = String(workStatusLabel ?? "").trim().toLowerCase();

  if (s === "cancelled" || s === "canceled") return "CANCELLED";
  if (s === "completed") return "COMPLETED";
  if (s === "ready") return "READY";
  if (s === "quality check") return "READY";
  if (s === "inprogress" || s === "in progress") return "IN_PROGRESS";
  if (s === "inspection") return "IN_PROGRESS";
  if (s === "new request") return "OPEN";

  return "OPEN";
}

function mapEnumStatusToUi(status: any) {
  const s = String(status ?? "").toUpperCase();
  if (s === "OPEN") return "New Request";
  if (s === "IN_PROGRESS") return "Inprogress";
  if (s === "READY") return "Ready";
  if (s === "COMPLETED") return "Completed";
  if (s === "CANCELLED") return "Cancelled";
  if (s === "DRAFT") return "Draft";
  return String(status ?? "New Request");
}

function deriveUiWorkStatus(job: any, parsed: any) {
  const fromParsed = String(parsed?.workStatusLabel ?? "").trim();
  if (fromParsed) return fromParsed;

  const fromLabel = String(job?.workStatusLabel ?? "").trim();
  if (fromLabel) return fromLabel;

  return mapEnumStatusToUi(job?.status);
}

function deriveUiPaymentStatus(job: any, parsed: any) {
  // ✅ enum FIRST, BUT allow "refund" label to win when enum=UNPAID
  const ps = String(job?.paymentStatus ?? "").toUpperCase();

  const label = String(parsed?.paymentStatusLabel ?? job?.paymentStatusLabel ?? "").trim();
  const labelLower = label.toLowerCase();

  if (ps === "PAID") return "Fully Paid";
  if (ps === "PARTIAL") return "Partially Paid";

  if (ps === "UNPAID") {
    if (label && labelLower.includes("refund")) return label; // e.g. Fully Refunded
    return "Unpaid";
  }

  if (label) return label;
  return "Unpaid";
}

function deriveExitPermitStatus(parsed: any) {
  const s = String(parsed?.exitPermitStatus ?? "").trim();
  if (s) return s;
  const permitId = String(parsed?.exitPermit?.permitId ?? "").trim();
  return permitId ? "Created" : "Not Created";
}

// ✅ NEW: Quality Check Status Display
function mapQualityCheckStatus(status: any) {
  const s = String(status ?? "").toUpperCase();
  if (s === "PASSED") return "Passed ✓";
  if (s === "FAILED") return "Failed ✗";
  if (s === "IN_PROGRESS") return "In Progress...";
  return "Pending";
}

// ✅ NEW: Priority Level Display with Colors
function mapPriorityLevel(level: any) {
  const p = String(level ?? "NORMAL").toUpperCase();
  if (p === "URGENT") return { label: "URGENT", color: "#DC2626", bgColor: "#FEE2E2" };
  if (p === "HIGH") return { label: "HIGH", color: "#F97316", bgColor: "#FFEDD5" };
  if (p === "NORMAL") return { label: "NORMAL", color: "#6366F1", bgColor: "#E0E7FF" };
  if (p === "LOW") return { label: "LOW", color: "#6B7280", bgColor: "#F3F4F6" };
  return { label: "NORMAL", color: "#6366F1", bgColor: "#E0E7FF" };
}

// ✅ NEW: Service Progress Calculation
function calculateServiceProgress(completed: number, total: number): { percent: number; label: string } {
  const total_safe = Math.max(1, total || 0);
  const completed_safe = Math.max(0, completed || 0);
  const percent = Math.round((completed_safe / total_safe) * 100);
  return {
    percent: Math.min(100, percent),
    label: `${completed_safe}/${total_safe} completed`,
  };
}

// ✅ NEW: Technician Assignment Display
function formatTechnicianAssignment(name: string | null, assignDate: any) {
  const techName = String(name ?? "").trim();
  if (!techName) return "Unassigned";
  
  let dateStr = "";
  if (assignDate) {
    try {
      dateStr = new Date(String(assignDate)).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      });
      return `${techName} (${dateStr})`;
    } catch {}
  }
  return techName;
}

// ✅ NEW: Time Duration Format
function formatTime(timeStr: any): string {
  const t = String(timeStr ?? "").trim();
  if (!t) return "Not set";
  // If it's already formatted like "2h 30m", return as-is
  if (t.includes("h") || t.includes("m")) return t;
  // If it's minutes, format it
  const mins = toNum(t);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

// ✅ NEW: Payment Status and Receipt Info
function formatPaymentInfo(payment: any) {
  return {
    amount: formatQar(toNum(payment?.amount ?? 0)),
    method: payment?.paymentSource ?? payment?.method ?? "Cash",
    receiptNumber: payment?.receiptNumber ? `Receipt: ${payment.receiptNumber}` : null,
    transactionId: payment?.transactionId ? `Txn: ${payment.transactionId}` : null,
    verificationCode: payment?.verificationCode ? `Verify: ${payment.verificationCode}` : null,
    paymentStatus: String(payment?.paymentStatus ?? "COMPLETED").toUpperCase(),
    approvedBy: payment?.approvedBy ?? null,
    approvalDate: payment?.approvalDate
      ? new Date(String(payment.approvalDate)).toLocaleDateString()
      : null,
    paidAt: payment?.paidAt
      ? new Date(String(payment.paidAt)).toLocaleString()
      : "",
  };
}

function unwrapAwsJsonMaybe(raw: any): any {
  const parsed = safeJsonParse<any>(raw);
  return parsed ?? raw;
}

function parseJobOrderSaveResult(res: any): { id?: string; orderNumber?: string } {
  let x = res?.data ?? res;
  x = unwrapAwsJsonMaybe(x);

  if (x && typeof x === "object" && (x as any).jobOrderSave != null) {
    x = unwrapAwsJsonMaybe((x as any).jobOrderSave);
  }

  if (x && typeof x === "object") {
    const id = String((x as any).id ?? "").trim();
    const orderNumber = String((x as any).orderNumber ?? "").trim();
    return { id: id || undefined, orderNumber: orderNumber || undefined };
  }

  return {};
}

async function findJobOrderRowByAnyKey(keyRaw: string): Promise<any | null> {
  const client = getDataClient();
  const key = String(keyRaw ?? "").trim();
  if (!key) return null;

  // 1) secondary index queryField (if generated)
  try {
    const byIndex = await (client.models.JobOrder as any)?.jobOrdersByOrderNumber?.({
      orderNumber: key,
      limit: 1,
    });
    const row = (byIndex?.data ?? [])[0];
    if (row?.id) return row;
  } catch {}

  // 2) list filter
  try {
    const list = await client.models.JobOrder.list({
      filter: { orderNumber: { eq: key } } as any,
      limit: 1,
    });
    const row = (list?.data ?? [])[0];
    if (row?.id) return row;
  } catch {}

  // 3) direct get by backend id
  try {
    const g = await client.models.JobOrder.get({ id: key } as any);
    const row = (g as any)?.data ?? g;
    if (row?.id) return row;
  } catch {}

  // 4) fallback scan
  try {
    const all = await listAll<any>((args) => client.models.JobOrder.list(args), 2000);
    const k = key.toLowerCase();
    const hit = all.find(
      (r: any) => String(r?.orderNumber ?? "").trim().toLowerCase() === k
    );
    return hit ?? null;
  } catch {
    return null;
  }
}

// -------------------------
// CUSTOMER / VEHICLES
// -------------------------

export async function searchCustomers(term: string): Promise<any[]> {
  const client = getDataClient();
  const q = String(term ?? "").trim();
  if (!q) return [];

  const results: CustomerRow[] = [];
  const seen = new Set<string>();

  if (q.length >= 8 && /[a-z0-9-]/i.test(q)) {
    try {
      const g = await client.models.Customer.get({ id: q } as any);
      const row = (g as any)?.data as CustomerRow | undefined;
      if (row?.id) {
        seen.add(String(row.id));
        results.push(row);
      }
    } catch {}
  }

  const [byPhone, byEmail, byName, byLast] = await Promise.all([
    client.models.Customer.list({ filter: { phone: { contains: q } } as any, limit: 50 }),
    client.models.Customer.list({ filter: { email: { contains: q } } as any, limit: 50 }),
    client.models.Customer.list({ filter: { name: { contains: q } } as any, limit: 50 }),
    client.models.Customer.list({ filter: { lastname: { contains: q } } as any, limit: 50 }),
  ]);

  for (const r of [
    ...(byPhone.data ?? []),
    ...(byEmail.data ?? []),
    ...(byName.data ?? []),
    ...(byLast.data ?? []),
  ]) {
    const id = String((r as any)?.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    results.push(r as any);
  }

  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts.slice(1).join(" ");
    try {
      const byFull = await client.models.Customer.list({
        filter: { and: [{ name: { contains: first } }, { lastname: { contains: last } }] } as any,
        limit: 50,
      });
      for (const r of byFull.data ?? []) {
        const id = String((r as any)?.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        results.push(r as any);
      }
    } catch {}
  }

  if (!results.length) {
    const all = await listAll<CustomerRow>((args) => client.models.Customer.list(args), 2000);
    const ql = q.toLowerCase();
    for (const r of all) {
      const id = String((r as any)?.id ?? "");
      if (!id || seen.has(id)) continue;

      const hay = [
        id,
        (r as any).name,
        (r as any).lastname,
        (r as any).email,
        (r as any).phone,
        makeFullName(r),
      ]
        .map((x) => safeLower(x))
        .join(" ");

      if (hay.includes(ql)) {
        seen.add(id);
        results.push(r);
      }
    }
  }

  return results.map((c: any) => ({
    id: String(c.id),
    name: makeFullName(c),
    email: c.email ?? "",
    mobile: c.phone ?? "",
    phone: c.phone ?? "",
    address: c.notes ?? null,
    vehicles: [],
    registeredVehiclesCount: 0,
    completedServicesCount: 0,
    customerSince: c.createdAt
      ? new Date(String(c.createdAt)).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "",
  }));
}

export async function getCustomerWithVehicles(customerId: string): Promise<any | null> {
  const client = getDataClient();
  const id = String(customerId ?? "").trim();
  if (!id) return null;

  const cRes = await client.models.Customer.get({ id } as any);
  const c = (cRes as any)?.data as CustomerRow | undefined;
  if (!c?.id) return null;

  let vData: any[] = [];
  try {
    const byIndex = await (client.models.Vehicle as any)?.vehiclesByCustomer?.({
      customerId: id,
      limit: 2000,
    });
    vData = byIndex?.data ?? [];
  } catch {
    const vRes = await client.models.Vehicle.list({
      filter: { customerId: { eq: id } } as any,
      limit: 2000,
    });
    vData = vRes.data ?? [];
  }

  const vehicles = vData.map((v: any) => ({
    vehicleId: v.vehicleId,
    ownedBy: v.ownedBy,
    make: v.make,
    model: v.model,
    year: v.year,
    vehicleType: v.vehicleType,
    color: v.color,
    plateNumber: v.plateNumber,
    vin: v.vin,
    notes: v.notes,
  }));

  return {
    id: String(c.id),
    name: makeFullName(c),
    email: c.email ?? "",
    mobile: c.phone ?? "",
    phone: c.phone ?? "",
    address: c.notes ?? null,
    vehicles,
    registeredVehiclesCount: vehicles.length,
    completedServicesCount: 0,
    customerSince: c.createdAt
      ? new Date(String(c.createdAt)).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "",
  };
}

export async function createCustomer(input: {
  fullName: string;
  phone: string;
  email?: string;
  address?: string;
}): Promise<any> {
  const client = getDataClient();

  const fullName = String(input.fullName ?? "").trim();
  const phone = String(input.phone ?? "").trim();
  if (!fullName || !phone) throw new Error("Full name and phone are required.");

  const parts = fullName.split(/\s+/).filter(Boolean);
  const name = parts[0] ?? "Unknown";
  const lastname = parts.slice(1).join(" ") || "-";

  const ts = new Date().toISOString();

  const created = await client.models.Customer.create({
    name,
    lastname,
    phone,
    email: String(input.email ?? "").trim() || undefined,
    notes: String(input.address ?? "").trim() || undefined,
    createdAt: ts,
    createdBy: "system",
  } as any);

  const row = (created as any)?.data ?? created;

  return {
    id: String(row.id),
    name: makeFullName(row),
    email: row.email ?? "",
    mobile: row.phone ?? phone,
    phone: row.phone ?? phone,
    address: row.notes ?? input.address ?? null,
    vehicles: [],
    registeredVehiclesCount: 0,
    completedServicesCount: 0,
    customerSince: row.createdAt
      ? new Date(String(row.createdAt)).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "",
  };
}

export async function createVehicleForCustomer(input: {
  customerId: string;
  ownedBy: string;
  make: string;
  model: string;
  year: string;
  color: string;
  plateNumber: string;
  vehicleType: string;
  vin: string;
}): Promise<any> {
  const client = getDataClient();

  const ts = new Date().toISOString();
  const yearNow = new Date().getFullYear();
  const vehicleId = `VEH-${yearNow}-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;

  const created = await client.models.Vehicle.create({
    vehicleId,
    customerId: String(input.customerId).trim(),
    ownedBy: String(input.ownedBy).trim() || "Owner",
    make: String(input.make).trim() || "N/A",
    model: String(input.model).trim() || "N/A",
    year: String(input.year).trim() || "",
    vehicleType: String(input.vehicleType).trim() || "",
    color: String(input.color).trim() || "",
    plateNumber: String(input.plateNumber).trim(),
    vin: String(input.vin).trim() || undefined,
    createdAt: ts,
    updatedAt: ts,
    createdBy: "system",
  } as any);

  const row = (created as any)?.data ?? created;

  return {
    vehicleId: row.vehicleId,
    ownedBy: row.ownedBy,
    make: row.make,
    model: row.model,
    year: row.year,
    vehicleType: row.vehicleType,
    color: row.color,
    plateNumber: row.plateNumber,
    vin: row.vin,
  };
}

// -------------------------
// JOB ORDERS
// -------------------------

export async function listJobOrdersForMain(): Promise<any[]> {
  const client = getDataClient();
  const res = await client.models.JobOrder.list({ limit: 2000 });
  const rows = res.data ?? [];

  const sorted = [...rows].sort((a: any, b: any) =>
    String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? ""))
  );

  return sorted.map((job: any) => {
    const parsed = safeJsonParse<any>(job.dataJson) ?? {};
    const workStatus = deriveUiWorkStatus(job, parsed);
    const paymentStatus = deriveUiPaymentStatus(job, parsed);
    const exitPermitStatus = deriveExitPermitStatus(parsed);
    
    // ✅ NEW: Get values from new schema fields
    const priorityLevel = String(job?.priorityLevel ?? "NORMAL").toUpperCase();
    const priority = mapPriorityLevel(priorityLevel);
    const assignedTechnicianName = String(job?.assignedTechnicianName ?? "").trim() || "Unassigned";
    const qualityStatus = mapQualityCheckStatus(job?.qualityCheckStatus);
    const serviceProgress = calculateServiceProgress(job?.completedServiceCount ?? 0, job?.totalServiceCount ?? 0);

    return {
      _backendId: job.id,
      id: job.orderNumber,
      orderType: job.orderType ?? parsed?.orderType ?? "Job Order",
      customerName: job.customerName ?? parsed?.customerName ?? "",
      mobile: job.customerPhone ?? parsed?.customerPhone ?? "",
      vehiclePlate: job.plateNumber ?? parsed?.plateNumber ?? "",
      workStatus,
      paymentStatus,
      exitPermitStatus,
      // ✅ NEW FIELDS
      priorityLevel: priority.label,
      priorityColor: priority.color,
      priorityBg: priority.bgColor,
      assignedTechnicianName,
      qualityCheckStatus: qualityStatus,
      serviceProgress,
      createDate: job.createdAt
        ? new Date(String(job.createdAt)).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : "",
    };
  });
}

export async function getJobOrderByOrderNumber(orderKey: string): Promise<any | null> {
  const client = getDataClient();
  const key = String(orderKey ?? "").trim();
  if (!key) return null;

  const job = await findJobOrderRowByAnyKey(key);
  if (!job?.id) return null;

  const parsed = safeJsonParse<any>(job.dataJson) ?? {};

  const parsedServices = Array.isArray(parsed?.services) ? parsed.services : [];
  const services = parsedServices.map((s: any, idx: number) => {
    const qty = Math.max(1, toNum(s.qty ?? 1));
    const unitPrice = Math.max(0, toNum(s.unitPrice ?? s.price ?? 0));
    const price = Math.max(0, toNum(s.price ?? qty * unitPrice));

    return {
      id: String(s.id ?? `SVC-${idx + 1}`),
      order: Number(s.order ?? idx + 1),

      name: String(s.name ?? "").trim() || "Service",
      price,

      status: s.status ?? "Pending",
      priority: s.priority ?? "normal",

      assignedTo: s.assignedTo ?? null,
      technicians: Array.isArray(s.technicians) ? s.technicians : [],

      startTime: s.startTime ?? null,
      endTime: s.endTime ?? null,

      started: s.startTime || s.started || "Not started",
      ended: s.endTime || s.ended || "Not completed",

      duration: s.duration ?? "Not started",
      technician: s.assignedTo ?? s.technician ?? "Not assigned",

      requestedAction: s.requestedAction ?? null,
      approvalStatus: s.approvalStatus ?? null,

      qualityCheckResult: s.qualityCheckResult ?? s.qcResult ?? null,
      notes: s.notes ?? "",
    };
  });

  const billingRaw = parsed?.billing ?? {};
  const billId = String(billingRaw?.billId ?? job.billId ?? "").trim();

  const totalAmount = toNum(job.totalAmount ?? billingRaw?.totalAmount);
  const discount = toNum(job.discount ?? billingRaw?.discount);
  const netAmount = toNum(job.netAmount ?? billingRaw?.netAmount ?? Math.max(0, totalAmount - discount));

  const amountPaid = toNum(job.amountPaid ?? 0);
  const balanceDue = toNum(job.balanceDue ?? Math.max(0, totalAmount - amountPaid));

  const invoices = Array.isArray(billingRaw?.invoices)
    ? billingRaw.invoices.map((inv: any) => ({
        number: String(inv.number ?? ""),
        amount: typeof inv.amount === "string" ? inv.amount : formatQar(toNum(inv.amount)),
        discount: typeof inv.discount === "string" ? inv.discount : formatQar(toNum(inv.discount)),
        status: inv.status ?? "Unpaid",
        paymentMethod: inv.paymentMethod ?? null,
        services: Array.isArray(inv.services) ? inv.services.map(String) : [],
      }))
    : [];

  const roadmap = Array.isArray(parsed?.roadmap)
    ? parsed.roadmap.map((r: any) => ({
        step: r.step,
        stepStatus: r.stepStatus ?? null,
        startTimestamp: r.startTimestamp ?? null,
        endTimestamp: r.endTimestamp ?? null,
        actionBy: r.actionBy ?? "Not assigned",
        status: r.status ?? "Upcoming",
      }))
    : [];

  const documents = Array.isArray(parsed?.documents) ? parsed.documents : [];
  const additionalServiceRequests = Array.isArray(parsed?.additionalServiceRequests)
    ? parsed.additionalServiceRequests
    : [];

  const exitPermitStatus = deriveExitPermitStatus(parsed);
  const exitPermit = parsed?.exitPermit ?? {
    permitId: null,
    createDate: null,
    nextServiceDate: null,
    createdBy: null,
    collectedBy: null,
    collectedByMobile: null,
  };

  let paymentRows: any[] = [];
  try {
    const byIdx = await (client.models.JobOrderPayment as any)?.listPaymentsByJobOrder?.({
      jobOrderId: job.id,
      limit: 2000,
    });
    paymentRows = byIdx?.data ?? [];
  } catch {
    const pRes = await client.models.JobOrderPayment.list({
      filter: { jobOrderId: { eq: job.id } } as any,
      limit: 2000,
    });
    paymentRows = pRes.data ?? [];
  }

  const paymentActivityLog = (paymentRows ?? []).map((p: any, idx: number) => {
    const info = formatPaymentInfo(p);
    return {
      serial: idx + 1,
      amount: info.amount,
      discount: formatQar(0),
      paymentMethod: info.method,
      cashierName: info.approvedBy ?? p.createdBy ?? "System",
      timestamp: info.paidAt,
      // ✅ NEW: Payment details
      receiptNumber: info.receiptNumber,
      transactionId: info.transactionId,
      verificationCode: info.verificationCode,
      paymentStatus: info.paymentStatus,
      approvalDate: info.approvalDate,
    };
  });

  const createDate = job.createdAt
    ? new Date(String(job.createdAt)).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

  const expectedDeliveryDate = String(parsed?.expectedDeliveryDate ?? job.expectedDeliveryDate ?? "").trim();
  const expectedDeliveryTime = String(parsed?.expectedDeliveryTime ?? job.expectedDeliveryTime ?? "").trim();
  const actualDeliveryDate = String(job?.actualDeliveryDate ?? "").trim();
  const actualDeliveryTime = String(job?.actualDeliveryTime ?? "").trim();

  const expectedDelivery =
    expectedDeliveryDate || expectedDeliveryTime
      ? `${expectedDeliveryDate} ${expectedDeliveryTime}`.trim()
      : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleString();

  const actualDelivery = actualDeliveryDate || actualDeliveryTime
    ? `${actualDeliveryDate} ${actualDeliveryTime}`.trim()
    : "Not completed";

  const workStatus = deriveUiWorkStatus(job, parsed);
  const paymentStatus = deriveUiPaymentStatus(job, parsed);
  
  // ✅ NEW: Quality Check, Priority, Technician Assignment, Service Progress
  const qualityCheckStatus = String(job?.qualityCheckStatus ?? "PENDING").toUpperCase();
  const qualityCheckDate = job?.qualityCheckDate
    ? new Date(String(job.qualityCheckDate)).toLocaleString()
    : "Not checked";
  const qualityCheckNotes = String(job?.qualityCheckNotes ?? "").trim();
  const qualityCheckedBy = String(job?.qualityCheckedBy ?? "").trim() || "Not yet";
  
  const priorityLevel = String(job?.priorityLevel ?? "NORMAL").toUpperCase();
  const priority = mapPriorityLevel(priorityLevel);
  
  const assignedTechnicianName = String(job?.assignedTechnicianName ?? "").trim();
  const assignmentDate = job?.assignmentDate
    ? new Date(String(job.assignmentDate)).toLocaleDateString()
    : "Not assigned";
  const technicianInfo = formatTechnicianAssignment(assignedTechnicianName || null, job?.assignmentDate);
  
  const totalServiceCount = toNum(job?.totalServiceCount ?? 0);
  const completedServiceCount = toNum(job?.completedServiceCount ?? 0);
  const pendingServiceCount = totalServiceCount - completedServiceCount;
  const serviceProgress = calculateServiceProgress(completedServiceCount, totalServiceCount);
  
  const estimatedHours = formatTime(job?.estimatedCompletionHours);
  const actualHours = formatTime(job?.actualCompletionHours);
  
  const exitPermitRequired = job?.exitPermitRequired ?? false;
  const exitPermitStatus2 = String(job?.exitPermitStatus ?? "NOT_REQUIRED").toUpperCase();
  const nextServiceDate = String(job?.nextServiceDate ?? "").trim() || "Not scheduled";

  // ✅ Add customerDetails & vehicleDetails for Exit Permit details UI
  const customerDetails = parsed?.customerDetails ?? {
    customerId: job.customerId ?? parsed?.customerId ?? "N/A",
    email: job.customerEmail ?? parsed?.customerEmail ?? "",
    address: parsed?.address ?? null,
    registeredVehiclesCount: parsed?.registeredVehiclesCount ?? 0,
    completedServicesCount: parsed?.completedServicesCount ?? 0,
    customerSince: parsed?.customerSince ?? "",
  };

  const vehicleDetails = parsed?.vehicleDetails ?? {
    vehicleId: parsed?.vehicleId ?? "N/A",
    ownedBy: parsed?.ownedBy ?? job.customerName ?? "",
    make: job.vehicleMake ?? parsed?.vehicleMake ?? "",
    model: job.vehicleModel ?? parsed?.vehicleModel ?? "",
    year: job.vehicleYear ?? parsed?.vehicleYear ?? "",
    type: parsed?.type ?? job.vehicleType ?? "",
    color: job.color ?? parsed?.color ?? "",
    vin: job.vin ?? parsed?.vin ?? "",
    registrationDate: parsed?.registrationDate ?? "",
    mileage: job.mileage ?? parsed?.mileage ?? "",
    plateNumber: job.plateNumber ?? parsed?.plateNumber ?? "",
  };

  return {
    _backendId: job.id,
    id: job.orderNumber,
    orderType: job.orderType ?? parsed?.orderType ?? "Job Order",
    customerName: job.customerName ?? parsed?.customerName ?? "",
    mobile: job.customerPhone ?? parsed?.customerPhone ?? "",
    vehiclePlate: job.plateNumber ?? parsed?.plateNumber ?? "",
    workStatus,
    paymentStatus,
    exitPermitStatus,
    exitPermit,
    createDate,

    jobOrderSummary: {
      createDate: job.createdAt ? new Date(String(job.createdAt)).toLocaleString() : "",
      createdBy: job.createdBy ?? "System User",
      expectedDelivery,
      actualDelivery,
    },

    customerDetails,
    vehicleDetails,
    
    // ✅ NEW: Priority, Technician, Quality Check, Service Progress
    priorityLevel: priority.label,
    priorityColor: priority.color,
    priorityBg: priority.bgColor,
    
    technicianAssignment: {
      name: assignedTechnicianName,
      assignedDate: assignmentDate,
      displayText: technicianInfo,
    },
    
    qualityCheck: {
      status: qualityCheckStatus,
      displayText: mapQualityCheckStatus(qualityCheckStatus),
      date: qualityCheckDate,
      notes: qualityCheckNotes,
      checkedBy: qualityCheckedBy,
    },
    
    deliveryInfo: {
      expected: expectedDelivery,
      actual: actualDelivery,
      expectedDate: expectedDeliveryDate,
      expectedTime: expectedDeliveryTime,
      actualDate: actualDeliveryDate,
      actualTime: actualDeliveryTime,
      estimatedHours,
      actualHours,
    },
    
    exitPermitInfo: {
      required: exitPermitRequired,
      status: exitPermitStatus2,
      nextServiceDate,
    },
    
    serviceProgressInfo: {
      total: totalServiceCount,
      completed: completedServiceCount,
      pending: pendingServiceCount,
      progress: serviceProgress,
    },

    billing: {
      billId,
      totalAmount: formatQar(totalAmount),
      discount: formatQar(discount),
      netAmount: formatQar(netAmount),
      amountPaid: formatQar(amountPaid),
      balanceDue: formatQar(balanceDue),
      paymentMethod: billingRaw?.paymentMethod ?? job.paymentMethod ?? null,
      invoices,
    },

    services,
    roadmap,
    documents,
    additionalServiceRequests,
    paymentActivityLog,

    customerNotes: parsed?.customerNotes ?? job.customerNotes ?? null,
    expectedDeliveryDate,
    expectedDeliveryTime,
  };
}

export async function upsertJobOrder(order: any): Promise<{ backendId: string; orderNumber: string }> {
  const client = getDataClient();

  const orderNumber = String(order?.id ?? order?.orderNumber ?? "").trim();
  if (!orderNumber) throw new Error("Missing Job Order ID (orderNumber).");

  const backendIdExisting = String(order?._backendId ?? "").trim();

  const services = Array.isArray(order?.services) ? order.services : [];
  // ✅ Do not break updates if older order dataJson has no services
  if (!services.length && !backendIdExisting) throw new Error("Select at least one service.");

  const workStatusLabel = String(order?.workStatus ?? order?.workStatusLabel ?? "").trim() || "New Request";
  const paymentStatusLabel = String(order?.paymentStatus ?? order?.paymentStatusLabel ?? "").trim() || "Unpaid";

  const status = mapWorkStatusToDbStatus(workStatusLabel);

  const discountNum =
    typeof order?.billing?.discount === "string" ? toNum(order.billing.discount) : toNum(order?.billing?.discount);

  const totalFromBilling =
    typeof order?.billing?.totalAmount === "string" ? toNum(order.billing.totalAmount) : toNum(order?.billing?.totalAmount);

  const netFromBilling =
    typeof order?.billing?.netAmount === "string" ? toNum(order.billing.netAmount) : toNum(order?.billing?.netAmount);

  const billId = String(order?.billing?.billId ?? "").trim() || undefined;
  const paymentMethod = String(order?.billing?.paymentMethod ?? "").trim() || undefined;

  const payload: any = {
    id: backendIdExisting || undefined,
    orderNumber,
    orderType: String(order?.orderType ?? "Job Order"),

    status,
    workStatusLabel,
    paymentStatusLabel,

    customerId: String(order?.customerDetails?.customerId ?? "").trim() || undefined,
    customerName: String(order?.customerName ?? "").trim(),
    customerPhone: String(order?.mobile ?? "").trim() || undefined,
    customerEmail: String(order?.customerDetails?.email ?? "").trim() || undefined,

    plateNumber: String(order?.vehiclePlate ?? order?.vehicleDetails?.plateNumber ?? "").trim() || undefined,
    vehicleId: String(order?.vehicleDetails?.vehicleId ?? "").trim() || undefined,
    vehicleMake: String(order?.vehicleDetails?.make ?? "").trim() || undefined,
    vehicleModel: String(order?.vehicleDetails?.model ?? "").trim() || undefined,
    vehicleYear: String(order?.vehicleDetails?.year ?? "").trim() || undefined,
    vin: String(order?.vehicleDetails?.vin ?? "").trim() || undefined,
    color: String(order?.vehicleDetails?.color ?? "").trim() || undefined,
    mileage: String(order?.vehicleDetails?.mileage ?? "").trim() || undefined,
    registrationDate: String(order?.vehicleDetails?.registrationDate ?? "").trim() || undefined,

    vehicleType: String(order?.vehicleDetails?.type ?? "SUV_4X4"),

    discount: discountNum,
    discountPercent: toNum(order?.billing?.discountPercent),
    vatRate: 0,
    
    // ✅ NEW: Priority & Technician Assignment
    priorityLevel: String(order?.priorityLevel ?? "NORMAL").trim(),
    assignedTechnicianId: String(order?.technicianAssignment?.id ?? "").trim() || undefined,
    assignedTechnicianName: String(order?.technicianAssignment?.name ?? "").trim() || undefined,
    assignmentDate: order?.technicianAssignment?.assignedDate ? new Date(String(order.technicianAssignment.assignedDate)) : undefined,
    
    // ✅ NEW: Quality Check Fields
    qualityCheckStatus: String(order?.qualityCheck?.status ?? "PENDING").trim(),
    qualityCheckDate: order?.qualityCheck?.date ? new Date(String(order.qualityCheck.date)) : undefined,
    qualityCheckNotes: String(order?.qualityCheck?.notes ?? "").trim() || undefined,
    qualityCheckedBy: String(order?.qualityCheck?.checkedBy ?? "").trim() || undefined,
    
    // ✅ NEW: Exit Permit Fields
    exitPermitRequired: order?.exitPermitInfo?.required ?? false,
    exitPermitStatus: String(order?.exitPermitInfo?.status ?? "NOT_REQUIRED").trim(),
    exitPermitDate: order?.exitPermitInfo?.date ? new Date(String(order.exitPermitInfo.date)) : undefined,
    nextServiceDate: String(order?.exitPermitInfo?.nextServiceDate ?? "").trim() || undefined,
    
    // ✅ NEW: Service Tracking
    totalServiceCount: toNum(order?.serviceProgressInfo?.total ?? order?.services?.length ?? 0),
    completedServiceCount: toNum(order?.serviceProgressInfo?.completed ?? 0),
    pendingServiceCount: toNum(order?.serviceProgressInfo?.pending ?? 0),
    
    // ✅ NEW: Delivery Information
    expectedDeliveryDate: String(order?.expectedDeliveryDate ?? order?.deliveryInfo?.expectedDate ?? "").trim() || undefined,
    expectedDeliveryTime: String(order?.expectedDeliveryTime ?? order?.deliveryInfo?.expectedTime ?? "").trim() || undefined,
    actualDeliveryDate: String(order?.deliveryInfo?.actualDate ?? "").trim() || undefined,
    actualDeliveryTime: String(order?.deliveryInfo?.actualTime ?? "").trim() || undefined,
    estimatedCompletionHours: toNum(order?.deliveryInfo?.estimatedHours),
    actualCompletionHours: toNum(order?.deliveryInfo?.actualHours),
    
    // ✅ NEW: Customer Communication
    customerNotified: order?.customerNotified ?? false,
    lastNotificationDate: order?.lastNotificationDate ? new Date(String(order.lastNotificationDate)) : undefined,
    customerNotes: String(order?.customerNotes ?? "").trim() || undefined,
    jobDescription: String(order?.jobDescription ?? "").trim() || undefined,
    specialInstructions: String(order?.specialInstructions ?? "").trim() || undefined,
    internalNotes: String(order?.internalNotes ?? "").trim() || undefined,
    
    // ✅ NEW: Customer Details (stored as schema fields)
    customerAddress: String(order?.customerDetails?.address ?? "").trim() || undefined,
    customerCompany: String(order?.customerDetails?.company ?? "").trim() || undefined,
    customerSince: String(order?.customerDetails?.customerSince ?? "").trim() || undefined,
    registeredVehiclesCount: toNum(order?.customerDetails?.registeredVehiclesCount),
    completedServicesCount: toNum(order?.customerDetails?.completedServicesCount),

    // keep existing structure
    services: services.map((s: any, idx: number) => {
      const price = toNum(s.price);
      return {
        id: String(s.id ?? `SVC-${idx + 1}`),
        order: Number(s.order ?? idx + 1),

        name: String(s.name ?? "").trim() || "Service",
        qty: 1,
        unitPrice: price,
        price,

        status: s.status ?? "Pending",
        priority: s.priority ?? "normal",

        assignedTo: s.assignedTo ?? null,
        technicians: Array.isArray(s.technicians) ? s.technicians : [],

        startTime: s.startTime ?? null,
        endTime: s.endTime ?? null,

        started: s.startTime || s.started || "Not started",
        ended: s.endTime || s.ended || "Not completed",

        duration: s.duration ?? "Not started",
        technician: s.assignedTo ?? s.technician ?? "Not assigned",

        requestedAction: s.requestedAction ?? null,
        approvalStatus: s.approvalStatus ?? null,

        qualityCheckResult: s.qualityCheckResult ?? s.qcResult ?? null,
        notes: s.notes ?? "",
      };
    }),

    documents: Array.isArray(order?.documents) ? order.documents : [],
    billing: order?.billing ?? {},
    roadmap: Array.isArray(order?.roadmap) ? order.roadmap : [],

    additionalServiceRequests: Array.isArray(order?.additionalServiceRequests)
      ? order.additionalServiceRequests
      : [],

    billId,
    netAmount: Number.isFinite(netFromBilling) ? netFromBilling : undefined,
    paymentMethod,
    totalAmount: Number.isFinite(totalFromBilling) ? totalFromBilling : undefined,
  };

  const res: any = await (client.mutations as any).jobOrderSave({
    input: JSON.stringify(payload),
  });

  if (res?.errors?.length) {
    throw new Error(res.errors.map((e: any) => e.message).join(" | "));
  }

  const parsed = parseJobOrderSaveResult(res);

  let backendId = String(parsed?.id ?? payload.id ?? "").trim();
  let returnedOrderNumber = String(parsed?.orderNumber ?? payload.orderNumber ?? "").trim();

  if (!backendId) {
    const row = await findJobOrderRowByAnyKey(returnedOrderNumber || orderNumber);
    backendId = String(row?.id ?? "").trim();
  }

  if (!backendId) {
    throw new Error("Saved but backend id could not be resolved (check jobOrderSave return type).");
  }

  return { backendId, orderNumber: returnedOrderNumber || orderNumber };
}

export async function cancelJobOrderByOrderNumber(orderKey: string): Promise<void> {
  const order = await getJobOrderByOrderNumber(orderKey);
  if (!order) throw new Error("Order not found.");

  order.workStatus = "Cancelled";
  order.workStatusLabel = "Cancelled";

  order.paymentStatus = order.paymentStatus ?? "Unpaid";
  order.paymentStatusLabel = order.paymentStatusLabel ?? order.paymentStatus ?? "Unpaid";

  // do not change exit permit status here (keep if already created)
  order.exitPermitStatus = order.exitPermitStatus ?? "Not Created";

  await upsertJobOrder(order);
}

export async function listCompletedOrdersByPlateNumber(plateNumber: string): Promise<any[]> {
  const client = getDataClient();
  const plate = String(plateNumber ?? "").trim();
  if (!plate) return [];

  let rows: any[] = [];
  try {
    const byIdx = await (client.models.JobOrder as any)?.jobOrdersByPlateNumber?.({
      plateNumber: plate,
      limit: 2000,
    });
    rows = byIdx?.data ?? [];
  } catch {
    const res = await client.models.JobOrder.list({
      filter: { plateNumber: { eq: plate } } as any,
      limit: 2000,
    });
    rows = res.data ?? [];
  }

  return (rows ?? [])
    .filter((r: any) => String(r.status) === "COMPLETED")
    .map((r: any) => ({
      id: r.orderNumber,
      vehiclePlate: r.plateNumber,
      workStatus: r.workStatusLabel ?? "Completed",
    }));
}

/**
 * ✅ NEW: Exit Permit - list eligible orders (Ready+Paid or Cancelled+Unpaid/Refunded) and Not Created
 */
export async function listJobOrdersForExitPermit(): Promise<any[]> {
  const all = await listJobOrdersForMain();

  return (all ?? []).filter((o: any) => {
    const work = String(o.workStatus ?? "").trim().toLowerCase();
    const pay = String(o.paymentStatus ?? "").trim().toLowerCase();
    const permit = String(o.exitPermitStatus ?? "Not Created").trim().toLowerCase();

    if (permit === "created") return false;

    const readyOk = work === "ready" && pay === "fully paid";
    const cancelledOk =
      work === "cancelled" && (pay === "unpaid" || pay.includes("refund"));

    return readyOk || cancelledOk;
  });
}

/**
 * ✅ NEW: Exit Permit - create permit and persist to backend via upsertJobOrder()
 */
export async function createExitPermitForOrderNumber(input: {
  orderNumber: string;
  collectedBy: string;
  mobileNumber: string;
  nextServiceDate?: string; // yyyy-mm-dd
  actor?: string;
}): Promise<{ permitId: string; orderNumber: string }> {
  const order = await getJobOrderByOrderNumber(input.orderNumber);
  if (!order) throw new Error("Order not found.");

  const currentStatus = String(order.exitPermitStatus ?? "Not Created").toLowerCase();
  if (currentStatus === "created" || String(order.exitPermit?.permitId ?? "").trim()) {
    throw new Error("Exit permit already exists for this order.");
  }

  const work = String(order.workStatus ?? "").trim().toLowerCase();
  const pay = String(order.paymentStatus ?? "").trim().toLowerCase();

  const eligibleReady = work === "ready" && pay === "fully paid";
  const eligibleCancelled = work === "cancelled" && (pay === "unpaid" || pay.includes("refund"));

  if (!eligibleReady && !eligibleCancelled) {
    throw new Error("This order is not eligible for Exit Permit.");
  }

  const collectedBy = String(input.collectedBy ?? "").trim();
  const mobileNumber = String(input.mobileNumber ?? "").trim();
  if (!collectedBy || !mobileNumber) throw new Error("Collected By and Mobile Number are required.");

  if (work !== "cancelled" && !String(input.nextServiceDate ?? "").trim()) {
    throw new Error("Next Service Date is required for non-cancelled orders.");
  }

  const permitId = `PERMIT-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
  const createDate = new Date().toLocaleString("en-GB");
  const actor = String(input.actor ?? "System User");

  const nextServiceDateDisplay =
    work === "cancelled"
      ? "N/A"
      : (() => {
          const d = new Date(String(input.nextServiceDate));
          if (Number.isNaN(d.getTime())) return String(input.nextServiceDate);
          const day = d.getDate();
          const month = d.toLocaleString("en-US", { month: "short" });
          const year = d.getFullYear();
          return `${day} ${month} ${year}`;
        })();

  const roadmap = Array.isArray(order.roadmap) ? [...order.roadmap] : [];

  // mark Ready for Delivery as completed if present
  const updatedRoadmap = roadmap.map((step: any) => {
    if (String(step?.step ?? "").toLowerCase() === "ready for delivery") {
      return {
        ...step,
        stepStatus: "completed",
        status: "Completed",
        endTimestamp: step.endTimestamp || createDate,
      };
    }
    return step;
  });

  const hasExit = updatedRoadmap.some((s: any) => String(s?.step ?? "").toLowerCase() === "exit permit issued");
  const finalRoadmap = hasExit
    ? updatedRoadmap
    : [
        ...updatedRoadmap,
        {
          step: "Exit Permit Issued",
          stepStatus: "completed",
          startTimestamp: createDate,
          endTimestamp: createDate,
          actionBy: actor,
          status: "Completed",
        },
      ];

  // Ready -> Completed, Cancelled stays Cancelled
  if (work === "ready") {
    order.workStatus = "Completed";
    order.workStatusLabel = "Completed";
  }

  order.exitPermitStatus = "Created";
  order.exitPermit = {
    permitId,
    createDate,
    nextServiceDate: nextServiceDateDisplay,
    createdBy: actor,
    collectedBy,
    collectedByMobile: mobileNumber,
  };

  order.roadmap = finalRoadmap;

  await upsertJobOrder(order);
  return { permitId, orderNumber: String(order.id) };
}