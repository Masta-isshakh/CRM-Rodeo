// src/pages/joborders/jobOrderRepo.ts

import type { Schema } from "../../amplify/data/resource";
import { getDataClient } from "../lib/amplifyClient";
import { resolveActorDisplay } from "../utils/actorIdentity";
import { getUserDirectory } from "../utils/userDirectoryCache";

type CustomerRow = Schema["Customer"]["type"];
type JobOrderRow = Schema["JobOrder"]["type"];

function toNum(x: any) {
  const n = typeof x === "number" ? x : Number(String(x ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatQar(n: number) {
  return `QAR ${Number(n || 0).toLocaleString()}`;
}

function safeLower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function firstNonEmptyText(...values: any[]): string {
  for (const value of values) {
    const out = String(value ?? "").trim();
    if (out) return out;
  }
  return "";
}

function isPlaceholderActor(value: any) {
  const raw = String(value ?? "").trim().toLowerCase();
  return (
    !raw ||
    raw === "-" ||
    raw === "--" ||
    raw === "—" ||
    raw === "null" ||
    raw === "undefined" ||
    raw === "system" ||
    raw === "system user" ||
    raw === "unknown" ||
    raw === "not assigned" ||
    raw === "n/a" ||
    raw === "na"
  );
}

function firstPreferredActor(...values: any[]) {
  const normalized = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  const nonPlaceholder = normalized.find((value) => !isPlaceholderActor(value));
  return nonPlaceholder ?? normalized[0] ?? "";
}

async function resolveVehicleIdByPlate(client: any, plateRaw: any): Promise<string> {
  const plate = String(plateRaw ?? "").trim();
  if (!plate) return "";

  try {
    const byIdx = await (client.models.Vehicle as any)?.vehiclesByPlateNumber?.({
      plateNumber: plate,
      limit: 1,
    });
    const row = byIdx?.data?.[0];
    const id = String(row?.vehicleId ?? "").trim();
    if (id) return id;
  } catch {
    // fallback below
  }

  try {
    const listed = await client.models.Vehicle.list({
      filter: { plateNumber: { eq: plate } } as any,
      limit: 1,
    });
    const row = listed?.data?.[0];
    return String(row?.vehicleId ?? "").trim();
  } catch {
    return "";
  }
}

function normalizeUiWorkStatusLabel(value: any): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const compact = raw.toLowerCase().replace(/[\s_]+/g, "");
  if (compact === "inprogress" || compact === "serviceoperation") return "Service_Operation";
  return raw;
}

function makeFullName(c: any) {
  return `${String(c?.name ?? "")} ${String(c?.lastname ?? "")}`.trim();
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

async function listAll<T>(listFn: (args: any) => Promise<any>, max = 5000): Promise<T[]> {
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Convert a possibly-human date/datetime to ISO string, else undefined */
function toIsoOrUndefined(v: any): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;

  // Already ISO-like? try parse anyway
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** date (YYYY-MM-DD) sanitizer */
function toDateOnlyOrUndefined(v: any): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;

  // Accept only YYYY-MM-DD (Amplify a.date)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return undefined;
}

/** UI workStatus -> schema status enum */
function mapWorkStatusToDbStatus(workStatusLabel: string | undefined): JobOrderRow["status"] {
  const s = String(workStatusLabel ?? "").trim().toLowerCase();
  const compact = s.replace(/[\s_]+/g, "");

  if (s === "cancelled" || s === "canceled") return "CANCELLED";
  if (s === "completed") return "COMPLETED";
  if (s === "ready") return "READY";
  if (s === "quality check") return "READY";
  if (compact === "inprogress" || compact === "serviceoperation") return "IN_PROGRESS";
  if (s === "inspection") return "IN_PROGRESS";
  if (s === "new request") return "OPEN";

  return "OPEN";
}

/** schema status enum -> UI label */
function mapEnumStatusToUi(status: any) {
  const s = String(status ?? "").toUpperCase();
  if (s === "OPEN") return "New Request";
  if (s === "IN_PROGRESS") return "Service_Operation";
  if (s === "READY") return "Ready";
  if (s === "COMPLETED") return "Completed";
  if (s === "CANCELLED") return "Cancelled";
  if (s === "DRAFT") return "Draft";
  return String(status ?? "New Request");
}

function deriveUiWorkStatus(job: any, parsed: any) {
  const fromParsed = String(parsed?.workStatusLabel ?? "").trim();
  if (fromParsed) {
    const upper = fromParsed.toUpperCase();
    if (["DRAFT", "OPEN", "IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"].includes(upper)) {
      return mapEnumStatusToUi(upper);
    }
    return normalizeUiWorkStatusLabel(fromParsed);
  }

  const fromLabel = String(job?.workStatusLabel ?? "").trim();
  if (fromLabel) {
    const upper = fromLabel.toUpperCase();
    if (["DRAFT", "OPEN", "IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"].includes(upper)) {
      return mapEnumStatusToUi(upper);
    }
    return normalizeUiWorkStatusLabel(fromLabel);
  }

  return mapEnumStatusToUi(job?.status);
}

/** payment enum -> UI label (with refund override) */
function deriveUiPaymentStatus(job: any, parsed: any) {
  const ps = String(job?.paymentStatus ?? "").toUpperCase();

  const label = String(parsed?.paymentStatusLabel ?? job?.paymentStatusLabel ?? "").trim();
  const labelLower = label.toLowerCase();

  if (ps === "PAID") return "Fully Paid";
  if (ps === "PARTIAL") return "Partially Paid";

  if (ps === "UNPAID") {
    if (label && labelLower.includes("refund")) return label;
    return "Unpaid";
  }

  if (label) return label;
  return "Unpaid";
}

/** Exit permit normalization (schema enum) */
function normalizeExitPermitStatus(raw: any): "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED" {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "APPROVED" || s === "CREATED") return "APPROVED";
  if (s === "PENDING" || s === "NOT CREATED" || s === "NOT_CREATED") return "PENDING";
  if (s === "REJECTED") return "REJECTED";
  return "NOT_REQUIRED";
}

function mapExitPermitStatusToUi(status: any): string {
  const s = normalizeExitPermitStatus(status);
  if (s === "APPROVED") return "Completed";
  if (s === "PENDING") return "Pending";
  if (s === "REJECTED") return "Rejected";
  return "Not Required";
}

function deriveExitPermitStatus(job: any, parsed: any) {
  const fromSchema = String(job?.exitPermitStatus ?? "").trim();
  if (fromSchema) return mapExitPermitStatusToUi(fromSchema);

  const fromParsed = String(parsed?.exitPermitStatus ?? "").trim();
  if (fromParsed) return mapExitPermitStatusToUi(fromParsed);

  const fromExitPermitInfo = String(parsed?.exitPermitInfo?.status ?? job?.exitPermitInfo?.status ?? "").trim();
  if (fromExitPermitInfo) return mapExitPermitStatusToUi(fromExitPermitInfo);

  const fromExitPermit = String(parsed?.exitPermit?.status ?? job?.exitPermit?.status ?? "").trim();
  if (fromExitPermit) return mapExitPermitStatusToUi(fromExitPermit);

  const permitId = firstNonEmptyText(
    parsed?.exitPermit?.permitId,
    parsed?.exitPermit?.permitID,
    parsed?.exitPermit?.permitNumber,
    parsed?.exitPermit?.permitNo,
    parsed?.exitPermitInfo?.permitId,
    parsed?.exitPermitInfo?.permitID,
    parsed?.exitPermitInfo?.permitNumber,
    parsed?.exitPermitInfo?.permitNo,
    job?.exitPermit?.permitId,
    job?.exitPermitInfo?.permitId,
    job?.permitId
  );
  return permitId ? "Created" : "Not Required";
}

// ✅ Quality check display
function mapQualityCheckStatus(status: any) {
  const s = String(status ?? "").toUpperCase();
  if (s === "PASSED") return "Passed ✓";
  if (s === "FAILED") return "Failed ✗";
  if (s === "IN_PROGRESS") return "In Progress...";
  return "Pending";
}

// ✅ Priority level display
function mapPriorityLevel(level: any) {
  const p = String(level ?? "NORMAL").toUpperCase();
  if (p === "URGENT") return { label: "URGENT", color: "#DC2626", bgColor: "#FEE2E2" };
  if (p === "HIGH") return { label: "HIGH", color: "#F97316", bgColor: "#FFEDD5" };
  if (p === "NORMAL") return { label: "NORMAL", color: "#6366F1", bgColor: "#E0E7FF" };
  if (p === "LOW") return { label: "LOW", color: "#6B7280", bgColor: "#F3F4F6" };
  return { label: "NORMAL", color: "#6366F1", bgColor: "#E0E7FF" };
}

function calculateServiceProgress(completed: number, total: number): { percent: number; label: string } {
  const totalSafe = Math.max(1, total || 0);
  const completedSafe = Math.max(0, completed || 0);
  const percent = Math.round((completedSafe / totalSafe) * 100);
  return { percent: Math.min(100, percent), label: `${completedSafe}/${totalSafe} completed` };
}

function formatTechnicianAssignment(name: string | null, assignDate: any) {
  const techName = String(name ?? "").trim();
  if (!techName) return "Unassigned";

  const iso = toIsoOrUndefined(assignDate);
  if (iso) {
    const d = new Date(iso);
    const dateStr = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return `${techName} (${dateStr})`;
  }

  return techName;
}

/** Convert schema enum vehicleType -> UI-friendly "SUV"/"Sedan"/... */
function vehicleTypeEnumToUi(v: any): string {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "SUV_4X4") return "SUV";
  if (s === "SEDAN") return "Sedan";
  if (s === "TRUCK") return "Truck";
  if (s === "MOTORBIKE") return "Motorbike";
  if (s === "OTHER") return "Other";
  return String(v ?? "SUV");
}

/** Convert UI vehicle type -> schema enum */
function normalizeVehicleTypeToEnum(v: any): JobOrderRow["vehicleType"] {
  const s = String(v ?? "").trim().toUpperCase();

  // Already valid enum
  if (s === "SUV_4X4" || s === "SEDAN" || s === "TRUCK" || s === "MOTORBIKE" || s === "OTHER") {
    return s as any;
  }

  // UI/common variants
  if (s === "SUV" || s === "4X4" || s === "SUV/4X4" || s === "SUV_4X4") return "SUV_4X4" as any;
  if (s === "SEDAN" || s === "SEDANS" || s === "SALON") return "SEDAN" as any;
  if (s === "TRUCK" || s === "PICKUP" || s === "PICK-UP") return "TRUCK" as any;
  if (s === "BIKE" || s === "MOTORBIKE" || s === "MOTORCYCLE") return "MOTORBIKE" as any;

  // Anything else -> OTHER
  return "OTHER" as any;
}

// ✅ Payment info display
function formatPaymentInfo(payment: any) {
  return {
    amount: formatQar(toNum(payment?.amount ?? 0)),
    method: payment?.paymentSource ?? payment?.method ?? "Cash",
    receiptNumber: payment?.receiptNumber ? `Receipt: ${payment.receiptNumber}` : null,
    transactionId: payment?.transactionId ? `Txn: ${payment.transactionId}` : null,
    verificationCode: payment?.verificationCode ? `Verify: ${payment.verificationCode}` : null,
    paymentStatus: String(payment?.paymentStatus ?? "COMPLETED").toUpperCase(),
    approvedBy: payment?.approvedBy ?? null,
    approvalDate: payment?.approvalDate ? new Date(String(payment.approvalDate)).toLocaleDateString() : null,
    paidAt: payment?.paidAt ? new Date(String(payment.paidAt)).toLocaleString() : "",
  };
}

function unwrapAwsJsonMaybe(raw: any): any {
  const parsed = safeJsonParse<any>(raw);
  return parsed ?? raw;
}

function parseJobOrderSaveResult(res: any): { id?: string; orderNumber?: string } {
  // Try multiple paths to extract the result
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

function mapPaymentStatusToDbStatus(paymentStatusLabel: string | undefined): JobOrderRow["paymentStatus"] {
  const s = String(paymentStatusLabel ?? "").trim().toLowerCase();
  if (s === "paid" || s === "fully paid") return "PAID";
  if (s === "partial" || s === "partially paid") return "PARTIAL";
  return "UNPAID";
}

async function persistJobOrderViaModel(client: any, payload: any): Promise<{ id?: string; orderNumber?: string }> {
  const now = new Date().toISOString();

  const dataJson = JSON.stringify({
    services: Array.isArray(payload?.services) ? payload.services : [],
    documents: Array.isArray(payload?.documents) ? payload.documents : [],
    billing: payload?.billing ?? {},
    roadmap: Array.isArray(payload?.roadmap) ? payload.roadmap : [],
    exitPermit: payload?.exitPermit ?? {},
    exitPermitInfo: payload?.exitPermitInfo ?? {},
    additionalServiceRequests: Array.isArray(payload?.additionalServiceRequests) ? payload.additionalServiceRequests : [],
    customerNotes: payload?.customerNotes ?? null,
    expectedDeliveryDate: payload?.expectedDeliveryDate ?? null,
    expectedDeliveryTime: payload?.expectedDeliveryTime ?? null,
  });

  const modelInput: any = {
    orderNumber: payload.orderNumber,
    orderType: payload.orderType,
    status: payload.status,
    paymentStatus: mapPaymentStatusToDbStatus(payload.paymentStatusLabel),
    workStatusLabel: payload.workStatusLabel,
    paymentStatusLabel: payload.paymentStatusLabel,

    customerId: payload.customerId,
    customerName: payload.customerName,
    customerPhone: payload.customerPhone,
    customerEmail: payload.customerEmail,
    customerAddress: payload.customerAddress,
    customerCompany: payload.customerCompany,
    customerSince: payload.customerSince,
    completedServicesCount: payload.completedServicesCount,
    registeredVehiclesCount: payload.registeredVehiclesCount,

    vehicleId: payload.vehicleId,
    vehicleType: payload.vehicleType,
    vehicleMake: payload.vehicleMake,
    vehicleModel: payload.vehicleModel,
    vehicleYear: payload.vehicleYear,
    plateNumber: payload.plateNumber,
    vin: payload.vin,
    mileage: payload.mileage,
    color: payload.color,
    registrationDate: payload.registrationDate,

    discount: payload.discount,
    discountPercent: payload.discountPercent,
    vatRate: payload.vatRate,
    totalAmount: payload.totalAmount,
    billId: payload.billId,
    netAmount: payload.netAmount,
    paymentMethod: payload.paymentMethod,

    totalServiceCount: payload.totalServiceCount,
    completedServiceCount: payload.completedServiceCount,
    pendingServiceCount: payload.pendingServiceCount,

    expectedDeliveryDate: payload.expectedDeliveryDate,
    expectedDeliveryTime: payload.expectedDeliveryTime,
    actualDeliveryDate: payload.actualDeliveryDate,
    actualDeliveryTime: payload.actualDeliveryTime,
    estimatedCompletionHours: payload.estimatedCompletionHours,
    actualCompletionHours: payload.actualCompletionHours,

    qualityCheckStatus: payload.qualityCheckStatus,
    qualityCheckDate: payload.qualityCheckDate,
    qualityCheckNotes: payload.qualityCheckNotes,
    qualityCheckedBy: payload.qualityCheckedBy,

    exitPermitRequired: payload.exitPermitRequired,
    exitPermitStatus: payload.exitPermitStatus,
    exitPermitDate: payload.exitPermitDate,
    nextServiceDate: payload.nextServiceDate,

    priorityLevel: payload.priorityLevel,
    assignedTechnicianId: payload.assignedTechnicianId,
    assignedTechnicianName: payload.assignedTechnicianName,
    assignmentDate: payload.assignmentDate,

    customerNotes: payload.customerNotes,
    internalNotes: payload.internalNotes,
    customerNotified: payload.customerNotified,
    lastNotificationDate: payload.lastNotificationDate,
    jobDescription: payload.jobDescription,
    specialInstructions: payload.specialInstructions,

    dataJson,
    updatedAt: now,
    updatedBy: payload.updatedBy ?? "system",
  };

  // Filter out undefined values - prevents schema validation errors for missing fields
  const cleanInput = Object.fromEntries(
    Object.entries(modelInput).filter(([_, v]) => v !== undefined && v !== null)
  );

  if (payload?.id) {
    const out = await client.models.JobOrder.update({ id: payload.id, ...cleanInput });
    if ((out as any)?.errors?.length) {
      throw new Error((out as any).errors.map((e: any) => e?.message || String(e)).join(" | "));
    }
    const row = out?.data ?? out;
    return { id: row?.id, orderNumber: row?.orderNumber ?? payload.orderNumber };
  }

  const out = await client.models.JobOrder.create({
    ...cleanInput,
    createdAt: now,
    createdBy: payload.createdBy ?? "system",
  });
  if ((out as any)?.errors?.length) {
    throw new Error((out as any).errors.map((e: any) => e?.message || String(e)).join(" | "));
  }
  const row = out?.data ?? out;
  return { id: row?.id, orderNumber: row?.orderNumber ?? payload.orderNumber };
}

async function findJobOrderRowByAnyKey(keyRaw: string): Promise<any | null> {
  const client = getDataClient();
  const key = String(keyRaw ?? "").trim();
  if (!key) return null;

  // 1) secondary index queryField
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
    const hit = all.find((r: any) => String(r?.orderNumber ?? "").trim().toLowerCase() === k);
    return hit ?? null;
  } catch {
    return null;
  }
}

async function resolveBackendIdWithRetry(orderNumberKey: string, attempts = 4): Promise<string> {
  const key = String(orderNumberKey ?? "").trim();
  if (!key) return "";

  for (let i = 0; i < attempts; i++) {
    const row = await findJobOrderRowByAnyKey(key);
    const id = String(row?.id ?? "").trim();
    if (id) return id;
    if (i < attempts - 1) await sleep(250 * (i + 1));
  }

  return "";
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

  // try get by id
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

  for (const r of [...(byPhone.data ?? []), ...(byEmail.data ?? []), ...(byName.data ?? []), ...(byLast.data ?? [])]) {
    const id = String((r as any)?.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    results.push(r as any);
  }

  // full name match
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

  // fallback scan
  if (!results.length) {
    const all = await listAll<CustomerRow>((args) => client.models.Customer.list(args), 2000);
    const ql = q.toLowerCase();
    for (const r of all) {
      const id = String((r as any)?.id ?? "");
      if (!id || seen.has(id)) continue;

      const hay = [id, (r as any).name, (r as any).lastname, (r as any).email, (r as any).phone, makeFullName(r)]
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
      ? new Date(String(c.createdAt)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
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
      ? new Date(String(c.createdAt)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      : "",
  };
}

export async function createCustomer(input: { fullName: string; phone: string; email?: string; address?: string; actor?: string }): Promise<any> {
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
    createdBy: String(input.actor ?? "system").trim() || "system",
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
      ? new Date(String(row.createdAt)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
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
  actor?: string;
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
    createdBy: String(input.actor ?? "system").trim() || "system",
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
    const exitPermitStatus = deriveExitPermitStatus(job, parsed);

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

      priorityLevel: priority.label,
      priorityColor: priority.color,
      priorityBg: priority.bgColor,
      assignedTechnicianName,
      qualityCheckStatus: qualityStatus,
      serviceProgress,

      createDate: job.createdAt
        ? new Date(String(job.createdAt)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
        : "",
    };
  });
}

export async function getJobOrderByOrderNumber(orderKey: string): Promise<any | null> {
  const client = getDataClient();
  const key = String(orderKey ?? "").trim();
  if (!key) return null;

  const directory = await getUserDirectory(client).catch(() => null);
  const identityToUsernameMap = directory?.identityToUsernameMap ?? {};
  const resolveActor = (value: any, fallback = "—") =>
    resolveActorDisplay(value, {
      identityToUsernameMap,
      fallback,
    });

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
      technician: resolveActor(s.assignedTo ?? s.technician, "Not assigned"),

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
        stepStatus: r.stepStatus ?? r.status ?? null,
        startTimestamp: r.startTimestamp ?? r.startedAt ?? r.startTime ?? r.started ?? null,
        endTimestamp: r.endTimestamp ?? r.completedAt ?? r.endTime ?? r.ended ?? null,
        actionBy: resolveActor(r.actionBy, "Not assigned"),
        status: r.status ?? r.stepStatus ?? "Upcoming",
      }))
    : [];

  const newRequestRoadmapActor = (() => {
    const step = roadmap.find((entry: any) => {
      const key = String(entry?.step ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
      return key === "newrequest";
    });
    return String(step?.actionBy ?? "").trim();
  })();

  const documents = Array.isArray(parsed?.documents) ? parsed.documents : [];
  const additionalServiceRequests = Array.isArray(parsed?.additionalServiceRequests) ? parsed.additionalServiceRequests : [];

  const exitPermitStatus = deriveExitPermitStatus(job, parsed);
  const parsedExitPermit = parsed?.exitPermit ?? {};
  const parsedExitPermitInfo = parsed?.exitPermitInfo ?? {};
  const exitPermit = {
    permitId:
      firstNonEmptyText(
        parsedExitPermit?.permitId,
        parsedExitPermit?.permitID,
        parsedExitPermit?.permitNumber,
        parsedExitPermit?.permitNo,
        parsedExitPermitInfo?.permitId,
        parsedExitPermitInfo?.permitID,
        parsedExitPermitInfo?.permitNumber,
        parsedExitPermitInfo?.permitNo,
        job?.permitId
      ) || null,
    createDate:
      firstNonEmptyText(
        parsedExitPermit?.createDate,
        parsedExitPermit?.createdAt,
        parsedExitPermitInfo?.createDate,
        parsedExitPermitInfo?.date,
        job?.exitPermitDate
      ) || null,
    nextServiceDate:
      firstNonEmptyText(
        parsedExitPermit?.nextServiceDate,
        parsedExitPermitInfo?.nextServiceDate,
        job?.nextServiceDate
      ) || null,
    createdBy:
      resolveActor(
        firstNonEmptyText(
          parsedExitPermit?.createdBy,
          parsedExitPermitInfo?.createdBy,
          parsedExitPermitInfo?.actionBy,
          job?.updatedBy,
          job?.createdBy
        ),
        "—"
      ) || null,
    collectedBy:
      firstNonEmptyText(
        parsedExitPermit?.collectedBy,
        parsedExitPermit?.collectorName,
        parsedExitPermitInfo?.collectedBy,
        parsedExitPermitInfo?.collectorName,
        parsedExitPermitInfo?.receivedBy,
        parsedExitPermitInfo?.handoverTo,
        job?.collectedBy
      ) || null,
    collectedByMobile:
      firstNonEmptyText(
        parsedExitPermit?.collectedByMobile,
        parsedExitPermit?.mobileNumber,
        parsedExitPermitInfo?.collectedByMobile,
        parsedExitPermitInfo?.mobileNumber,
        parsedExitPermitInfo?.collectorMobile,
        parsedExitPermitInfo?.phone,
        job?.collectedByMobile,
        job?.mobileNumber
      ) || null,
  };

  // Payments
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
      cashierName: resolveActor(firstPreferredActor(info.approvedBy, p.createdBy), "—"),
      timestamp: info.paidAt,

      receiptNumber: info.receiptNumber,
      transactionId: info.transactionId,
      verificationCode: info.verificationCode,
      paymentStatus: info.paymentStatus,
      approvalDate: info.approvalDate,
    };
  });

  const createDate = job.createdAt
    ? new Date(String(job.createdAt)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "";

  const expectedDeliveryDate = String(parsed?.expectedDeliveryDate ?? job.expectedDeliveryDate ?? "").trim();
  const expectedDeliveryTime = String(parsed?.expectedDeliveryTime ?? job.expectedDeliveryTime ?? "").trim();
  const actualDeliveryDate = String(job?.actualDeliveryDate ?? "").trim();
  const actualDeliveryTime = String(job?.actualDeliveryTime ?? "").trim();

  const expectedDelivery =
    expectedDeliveryDate || expectedDeliveryTime
      ? `${expectedDeliveryDate} ${expectedDeliveryTime}`.trim()
      : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleString();

  const actualDelivery = actualDeliveryDate || actualDeliveryTime ? `${actualDeliveryDate} ${actualDeliveryTime}`.trim() : "Not completed";

  const workStatus = deriveUiWorkStatus(job, parsed);
  const paymentStatus = deriveUiPaymentStatus(job, parsed);

  // Quality check / assignment / progress
  const qualityCheckStatus = String(job?.qualityCheckStatus ?? "PENDING").toUpperCase();
  const qualityCheckDateDisplay = job?.qualityCheckDate ? new Date(String(job.qualityCheckDate)).toLocaleString() : "Not checked";
  const qualityCheckNotes = String(job?.qualityCheckNotes ?? "").trim();
  const qualityCheckedBy = resolveActor(job?.qualityCheckedBy, "Not yet");

  const priorityLevel = String(job?.priorityLevel ?? "NORMAL").toUpperCase();
  const priority = mapPriorityLevel(priorityLevel);

  const assignedTechnicianName = String(job?.assignedTechnicianName ?? "").trim();
  const assignmentDateDisplay = job?.assignmentDate ? new Date(String(job.assignmentDate)).toLocaleDateString() : "Not assigned";
  const technicianInfo = formatTechnicianAssignment(assignedTechnicianName || null, job?.assignmentDate);

  const totalServiceCount = toNum(job?.totalServiceCount ?? 0);
  const completedServiceCount = toNum(job?.completedServiceCount ?? 0);
  const pendingServiceCount = Math.max(0, totalServiceCount - completedServiceCount);
  const serviceProgress = calculateServiceProgress(completedServiceCount, totalServiceCount);

  const exitPermitRequired = job?.exitPermitRequired ?? false;
  const exitPermitStatus2 = String(job?.exitPermitStatus ?? "NOT_REQUIRED").toUpperCase();
  const nextServiceDate = String(job?.nextServiceDate ?? "").trim() || "Not scheduled";

  const customerDetails = {
    ...(parsed?.customerDetails ?? {}),
    customerId: job.customerId ?? parsed?.customerId ?? parsed?.customerDetails?.customerId ?? "N/A",
    email: job.customerEmail ?? parsed?.customerEmail ?? parsed?.customerDetails?.email ?? "",
    address: job.customerAddress ?? parsed?.customerDetails?.address ?? parsed?.address ?? null,
    company: job.customerCompany ?? parsed?.customerDetails?.company ?? null,
    registeredVehiclesCount: job.registeredVehiclesCount ?? parsed?.customerDetails?.registeredVehiclesCount ?? 0,
    completedServicesCount: job.completedServicesCount ?? parsed?.customerDetails?.completedServicesCount ?? 0,
    customerSince: job.customerSince ?? parsed?.customerDetails?.customerSince ?? parsed?.customerSince ?? "",
  };

  const parsedVehicle = parsed?.vehicleDetails ?? {};
  const vehicleIdByPlate = await resolveVehicleIdByPlate(
    client,
    firstNonEmptyText(job?.plateNumber, parsedVehicle?.plateNumber, parsed?.plateNumber)
  );
  const vehicleTypeUi = vehicleTypeEnumToUi(job.vehicleType ?? parsedVehicle?.type ?? parsed?.vehicleType ?? "");

  const vehicleDetails = {
    ...parsedVehicle,
    vehicleId:
      firstNonEmptyText(
        parsedVehicle?.vehicleId,
        parsedVehicle?.id,
        parsed?.vehicleId,
        job?.vehicleId,
        vehicleIdByPlate
      ) || "N/A",
    ownedBy:
      firstNonEmptyText(
        parsedVehicle?.ownedBy,
        parsed?.ownedBy,
        job?.customerName,
        parsed?.customerName
      ) || "",
    make: firstNonEmptyText(job?.vehicleMake, parsedVehicle?.make, parsed?.vehicleMake) || "",
    model: firstNonEmptyText(job?.vehicleModel, parsedVehicle?.model, parsed?.vehicleModel) || "",
    year: firstNonEmptyText(job?.vehicleYear, parsedVehicle?.year, parsed?.vehicleYear) || "",
    type: vehicleTypeUi,
    color: firstNonEmptyText(job?.color, parsedVehicle?.color, parsed?.color) || "",
    vin: firstNonEmptyText(job?.vin, parsedVehicle?.vin, parsed?.vin) || "",
    registrationDate: firstNonEmptyText(parsedVehicle?.registrationDate, parsed?.registrationDate) || "",
    mileage: firstNonEmptyText(job?.mileage, parsedVehicle?.mileage, parsed?.mileage) || "",
    plateNumber: firstNonEmptyText(job?.plateNumber, parsedVehicle?.plateNumber, parsed?.plateNumber) || "",
  };

  return {
    _backendId: job.id,
    id: job.orderNumber,
    orderType: job.orderType ?? parsed?.orderType ?? "Job Order",
    customerName: job.customerName ?? parsed?.customerName ?? "",
    mobile: job.customerPhone ?? parsed?.customerPhone ?? "",
    vehicleId: firstNonEmptyText(vehicleDetails?.vehicleId, parsed?.vehicleId, job?.vehicleId, vehicleIdByPlate) || "",
    vehiclePlate: job.plateNumber ?? parsed?.plateNumber ?? "",
    workStatus,
    paymentStatus,
    exitPermitStatus,
    exitPermit,
    createDate,

    jobOrderSummary: {
      createDate: job.createdAt ? new Date(String(job.createdAt)).toLocaleString() : "",
      createdBy: resolveActor(firstPreferredActor(job.createdBy, parsed?.createdBy, newRequestRoadmapActor, job.updatedBy), "—"),
      expectedDelivery,
      actualDelivery,
    },

    customerDetails,
    vehicleDetails,

    priorityLevel: priority.label,
    priorityColor: priority.color,
    priorityBg: priority.bgColor,

    technicianAssignment: {
      name: assignedTechnicianName,
      assignedDate: assignmentDateDisplay,
      displayText: technicianInfo,
    },

    qualityCheck: {
      status: qualityCheckStatus,
      displayText: mapQualityCheckStatus(qualityCheckStatus),
      date: qualityCheckDateDisplay, // display
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
      estimatedHours: job?.estimatedCompletionHours ?? null,
      actualHours: job?.actualCompletionHours ?? null,
    },

    exitPermitInfo: {
      required: exitPermitRequired,
      status: exitPermitStatus2,
      nextServiceDate,
      date: firstNonEmptyText(parsedExitPermitInfo?.date, parsedExitPermit?.createDate, job?.exitPermitDate) || undefined,
      permitId: exitPermit.permitId ?? undefined,
      collectedBy: exitPermit.collectedBy ?? undefined,
      mobileNumber: exitPermit.collectedByMobile ?? undefined,
      createdBy: exitPermit.createdBy ?? undefined,
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
  if (!services.length && !backendIdExisting) throw new Error("Select at least one service.");

  const workStatusLabel = String(order?.workStatus ?? order?.workStatusLabel ?? "").trim() || "New Request";
  const paymentStatusLabel = String(order?.paymentStatus ?? order?.paymentStatusLabel ?? "").trim() || "Unpaid";

  const status = mapWorkStatusToDbStatus(workStatusLabel);

  const discountNum =
    typeof order?.billing?.discount === "string"
      ? toNum(order.billing.discount)
      : toNum(order?.billing?.discount);

  const totalFromBilling =
    typeof order?.billing?.totalAmount === "string"
      ? toNum(order.billing.totalAmount)
      : toNum(order?.billing?.totalAmount);

  const netFromBilling =
    typeof order?.billing?.netAmount === "string"
      ? toNum(order.billing.netAmount)
      : toNum(order?.billing?.netAmount);

  const billId = String(order?.billing?.billId ?? "").trim() || undefined;
  const paymentMethod = String(order?.billing?.paymentMethod ?? "").trim() || undefined;

  // ✅ FIX: wizard stores discountPercent at root
  const discountPercent = toNum(order?.discountPercent ?? order?.billing?.discountPercent);

  // ✅ FIX: service counts for create/update
  const totalServiceCount = Math.max(0, toNum(order?.serviceProgressInfo?.total ?? services.length));
  const completedServiceCount = Math.max(0, toNum(order?.serviceProgressInfo?.completed ?? 0));
  const pendingServiceCount = Math.max(
    0,
    toNum(order?.serviceProgressInfo?.pending ?? (totalServiceCount - completedServiceCount))
  );

  // ✅ FIX: vehicleType enum normalization (prevents create failure)
  const uiVehicleType = order?.vehicleDetails?.type ?? order?.vehicleType ?? "SUV";
  const vehicleTypeEnum = normalizeVehicleTypeToEnum(uiVehicleType);

  // ✅ FIX: never serialize invalid dates (UI sometimes carries "Not checked"/"Not assigned")
  const assignmentDateIso = toIsoOrUndefined(order?.technicianAssignment?.assignedDate ?? order?.assignmentDate);
  const qualityCheckDateIso = toIsoOrUndefined(order?.qualityCheck?.date);
  const exitPermitDateIso = toIsoOrUndefined(order?.exitPermitInfo?.date ?? order?.exitPermit?.createDate);
  const lastNotifIso = toIsoOrUndefined(order?.lastNotificationDate);

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
    vehicleId: String(
      firstNonEmptyText(order?.vehicleDetails?.vehicleId, order?.vehicleDetails?.id, order?.vehicleId)
    ).trim() || undefined,
    vehicleMake: String(order?.vehicleDetails?.make ?? "").trim() || undefined,
    vehicleModel: String(order?.vehicleDetails?.model ?? "").trim() || undefined,
    vehicleYear: String(order?.vehicleDetails?.year ?? "").trim() || undefined,
    vin: String(order?.vehicleDetails?.vin ?? "").trim() || undefined,
    color: String(order?.vehicleDetails?.color ?? "").trim() || undefined,
    mileage: String(order?.vehicleDetails?.mileage ?? "").trim() || undefined,
    registrationDate: String(order?.vehicleDetails?.registrationDate ?? "").trim() || undefined,

    vehicleType: vehicleTypeEnum,

    discount: discountNum,
    discountPercent,
    vatRate: 0,

    // Priority & Technician
    priorityLevel: String(order?.priorityLevel ?? "NORMAL").trim().toUpperCase(),
    assignedTechnicianId: String(order?.technicianAssignment?.id ?? "").trim() || undefined,
    assignedTechnicianName: String(order?.technicianAssignment?.name ?? "").trim() || undefined,
    assignmentDate: assignmentDateIso,

    // Quality check
    qualityCheckStatus: String(order?.qualityCheck?.status ?? "PENDING").trim().toUpperCase(),
    qualityCheckDate: qualityCheckDateIso,
    qualityCheckNotes: String(order?.qualityCheck?.notes ?? "").trim() || undefined,
    qualityCheckedBy: String(order?.qualityCheck?.checkedBy ?? "").trim() || undefined,

    // Exit permit
    exitPermitRequired: order?.exitPermitInfo?.required ?? false,
    exitPermitStatus: normalizeExitPermitStatus(
      order?.exitPermitInfo?.status ??
        order?.exitPermitStatus ??
        (order?.exitPermit?.permitId ? "APPROVED" : "NOT_REQUIRED")
    ),
    exitPermitDate: exitPermitDateIso,
    nextServiceDate: String(order?.exitPermitInfo?.nextServiceDate ?? order?.exitPermit?.nextServiceDate ?? "").trim() || undefined,

    // Service counts
    totalServiceCount,
    completedServiceCount,
    pendingServiceCount,

    // Delivery (schema expects a.date for expected/actual delivery date)
    expectedDeliveryDate: toDateOnlyOrUndefined(order?.expectedDeliveryDate ?? order?.deliveryInfo?.expectedDate),
    expectedDeliveryTime: String(order?.expectedDeliveryTime ?? order?.deliveryInfo?.expectedTime ?? "").trim() || undefined,
    actualDeliveryDate: toDateOnlyOrUndefined(order?.deliveryInfo?.actualDate),
    actualDeliveryTime: String(order?.deliveryInfo?.actualTime ?? "").trim() || undefined,

    // Completion hours (floats)
    estimatedCompletionHours: (() => {
      const n = toNum(order?.deliveryInfo?.estimatedHours);
      return n > 0 ? n : undefined;
    })(),
    actualCompletionHours: (() => {
      const n = toNum(order?.deliveryInfo?.actualHours);
      return n > 0 ? n : undefined;
    })(),

    // Customer comms
    customerNotified: order?.customerNotified ?? false,
    lastNotificationDate: lastNotifIso,
    customerNotes: String(order?.customerNotes ?? "").trim() || undefined,
    jobDescription: String(order?.jobDescription ?? "").trim() || undefined,
    specialInstructions: String(order?.specialInstructions ?? "").trim() || undefined,
    internalNotes: String(order?.internalNotes ?? "").trim() || undefined,
    createdBy: firstPreferredActor(order?.createdBy, order?.jobOrderSummary?.createdBy) || undefined,
    updatedBy: firstPreferredActor(order?.updatedBy, order?.createdBy, order?.jobOrderSummary?.createdBy) || undefined,

    // Customer detail fields
    customerAddress: String(order?.customerDetails?.address ?? order?.customerAddress ?? "").trim() || undefined,
    customerCompany: String(order?.customerDetails?.company ?? order?.customerCompany ?? "").trim() || undefined,
    customerSince: String(order?.customerDetails?.customerSince ?? order?.customerSince ?? "").trim() || undefined,
    registeredVehiclesCount: toNum(order?.customerDetails?.registeredVehiclesCount ?? order?.registeredVehiclesCount),
    completedServicesCount: toNum(order?.customerDetails?.completedServicesCount ?? order?.completedServicesCount),

    // Minimal JSON structure the lambda expects
    services: services.map((s: any, idx: number) => {
      const price = toNum(s.price);
      const assignedTo = String(s?.assignedTo ?? "").trim().toLowerCase() || null;
      const technicians = Array.isArray(s?.technicians)
        ? s.technicians.map((t: any) => String(t ?? "").trim()).filter(Boolean)
        : [];

      return {
        id: String(s.id ?? `SVC-${idx + 1}`),
        order: Number(s.order ?? idx + 1),
        name: String(s.name ?? "").trim() || "Service",
        price,
        qty: Math.max(1, toNum(s.qty ?? 1)),
        unitPrice: Math.max(0, toNum(s.unitPrice ?? price)),

        status: String(s?.status ?? "Pending"),
        priority: String(s?.priority ?? "normal"),
        assignedTo,
        technicians,

        startTime: s?.startTime ?? null,
        endTime: s?.endTime ?? null,
        started: s?.started ?? (s?.startTime ?? "Not started"),
        ended: s?.ended ?? (s?.endTime ?? "Not completed"),
        duration: s?.duration ?? "Not started",
        technician: assignedTo ?? String(s?.technician ?? "Not assigned"),

        requestedAction: s?.requestedAction ?? null,
        approvalStatus: s?.approvalStatus ?? null,
        qualityCheckResult: s?.qualityCheckResult ?? s?.qcResult ?? null,
        notes: String(s?.notes ?? ""),
      };
    }),

    documents: Array.isArray(order?.documents) ? order.documents : [],
    billing: order?.billing ?? {},
    roadmap: Array.isArray(order?.roadmap) ? order.roadmap : [],
    exitPermit: order?.exitPermit ?? {},
    exitPermitInfo: order?.exitPermitInfo ?? {},
    additionalServiceRequests: Array.isArray(order?.additionalServiceRequests) ? order.additionalServiceRequests : [],

    billId,
    netAmount: Number.isFinite(netFromBilling) ? netFromBilling : undefined,
    paymentMethod,
    totalAmount: Number.isFinite(totalFromBilling) ? totalFromBilling : undefined,
  };

  let parsed: { id?: string; orderNumber?: string };
  try {
    const saveMutation = (client.mutations as any)?.jobOrderSave;
    if (typeof saveMutation !== "function") throw new Error("__JOB_ORDER_SAVE_MISSING__");

    const res: any = await saveMutation({
      input: JSON.stringify(payload),
    });

    if (res?.errors?.length) {
      throw new Error(res.errors.map((e: any) => e.message).join(" | "));
    }

    parsed = parseJobOrderSaveResult(res);
  } catch (e) {
    const msg = String((e as any)?.message ?? "");
    const schemaMismatch =
      msg.includes("Unknown type AWSJSON") ||
      msg.includes("Field 'jobOrderSave' in type 'Mutation' is undefined") ||
      msg.includes("__JOB_ORDER_SAVE_MISSING__");

    if (!schemaMismatch) throw e;

    parsed = await persistJobOrderViaModel(client, payload);
  }

  let backendId = String(parsed?.id ?? payload.id ?? "").trim();
  let returnedOrderNumber = String(parsed?.orderNumber ?? payload.orderNumber ?? "").trim();

  if (!backendId) {
    backendId = await resolveBackendIdWithRetry(returnedOrderNumber || orderNumber);
  }

  if (!backendId) {
    throw new Error("Save completed but verification failed: created job order could not be read back from backend.");
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

  // keep existing exit permit status if any (don't force it)
  order.exitPermitStatus = order.exitPermitStatus ?? "Not Required";

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

export async function listJobOrdersForExitPermit(): Promise<any[]> {
  const all = await listJobOrdersForMain();

  return (all ?? []).filter((o: any) => {
    const work = String(o.workStatus ?? "").trim().toLowerCase();
    const pay = String(o.paymentStatus ?? "").trim().toLowerCase();
    const permit = normalizeExitPermitStatus(o.exitPermitStatus);

    if (permit === "APPROVED") return false;

    const readyOk = work === "ready" && pay === "fully paid";
    const cancelledOk = work === "cancelled" && (pay === "unpaid" || pay.includes("refund"));

    return readyOk || cancelledOk;
  });
}

export async function createExitPermitForOrderNumber(input: {
  orderNumber: string;
  collectedBy: string;
  mobileNumber: string;
  nextServiceDate?: string; // yyyy-mm-dd
  actor?: string;
}): Promise<{ permitId: string; orderNumber: string }> {
  const order = await getJobOrderByOrderNumber(input.orderNumber);
  if (!order) throw new Error("Order not found.");

  const currentStatus = normalizeExitPermitStatus(order.exitPermitStatus);
  if (currentStatus === "APPROVED" || String(order.exitPermit?.permitId ?? "").trim()) {
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
  const actor = String(input.actor ?? "system");

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

  if (work === "ready") {
    order.workStatus = "Completed";
    order.workStatusLabel = "Completed";
  }

  order.exitPermitStatus = "APPROVED";
  order.exitPermitInfo = {
    ...(order.exitPermitInfo ?? {}),
    required: true,
    status: "APPROVED",
    date: new Date().toISOString(),
    nextServiceDate: work === "cancelled" ? undefined : String(input.nextServiceDate ?? "").trim() || undefined,
    permitId,
    collectedBy,
    mobileNumber,
    createdBy: actor,
  };
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