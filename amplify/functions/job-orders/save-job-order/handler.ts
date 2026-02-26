// amplify/functions/job-orders/save-job-order/handler.ts
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import type { AppSyncResolverHandler } from "aws-lambda";

import type { Schema } from "../../../data/resource";
import { requirePermissionFromEvent } from "../_shared/rbac";
import { computePaymentStatus, toNum } from "../_shared/finance";
import { recomputeJobOrderPaymentSummary } from "../_shared/payments";
import { getOptionCtx } from "../_shared/optionRbac";

type Args = { input: any };
type ServiceLine = { qty?: number; unitPrice?: number; price?: number; name?: string };

type Payload = {
  id?: string;
  orderNumber?: string;
  orderType?: string;
  status?: string;
  workStatusLabel?: string;
  paymentStatusLabel?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  plateNumber?: string;
  vehicleId?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: string;
  vin?: string;
  mileage?: string;
  color?: string;
  registrationDate?: string;
  vehicleType?: string;
  billId?: string;
  netAmount?: number;
  paymentMethod?: string;
  discount?: number;
  discountPercent?: number;
  vatRate?: number;
  
  // ✅ NEW: All new fields from schema
  priorityLevel?: string;
  assignedTechnicianId?: string;
  assignedTechnicianName?: string;
  assignmentDate?: string | Date;
  qualityCheckStatus?: string;
  qualityCheckDate?: string | Date;
  qualityCheckNotes?: string;
  qualityCheckedBy?: string;
  exitPermitRequired?: boolean;
  exitPermitStatus?: string;
  exitPermitDate?: string | Date;
  nextServiceDate?: string;
  totalServiceCount?: number;
  completedServiceCount?: number;
  pendingServiceCount?: number;
  expectedDeliveryDate?: string;
  expectedDeliveryTime?: string;
  actualDeliveryDate?: string;
  actualDeliveryTime?: string;
  estimatedCompletionHours?: number;
  actualCompletionHours?: number;
  customerNotified?: boolean;
  lastNotificationDate?: string | Date;
  customerNotes?: string;
  jobDescription?: string;
  specialInstructions?: string;
  internalNotes?: string;
  customerAddress?: string;
  customerCompany?: string;
  customerSince?: string;
  registeredVehiclesCount?: number;
  completedServicesCount?: number;

  services?: ServiceLine[];
  documents?: any[];
  roadmap?: any[];
  billing?: any;

  [k: string]: any;
};

function safeParseInput(raw: any): Payload {
  if (raw == null) throw new Error("Missing input");
  
  // ✅ NEW: Handle both direct object and JSON string for backwards compatibility
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) throw new Error("Empty input");
    return JSON.parse(s) as Payload;
  }
  
  // If it's already an object, use it directly
  return raw as Payload;
}

function nowIso() {
  return new Date().toISOString();
}

function makeOrderNumber(prefix = "JO") {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${y}${m}${day}-${rand}`;
}

function normalizeRoadmapEntry(entry: any, actorFallback: string): any {
  const step = String(entry?.step ?? "").trim();
  if (!step) return null;

  const stepStatus = String(entry?.stepStatus ?? entry?.statusLabel ?? entry?.state ?? "").trim() || null;
  const startTimestamp =
    entry?.startTimestamp ?? entry?.startedAt ?? entry?.startTime ?? entry?.started ?? null;
  const endTimestamp =
    entry?.endTimestamp ?? entry?.completedAt ?? entry?.endTime ?? entry?.ended ?? null;

  const actionByRaw =
    entry?.actionBy ??
    entry?.updatedBy ??
    entry?.createdBy ??
    entry?.actor ??
    actorFallback ??
    null;
  const actionBy = String(actionByRaw ?? "").trim() || null;

  const status = String(entry?.status ?? entry?.stepState ?? "").trim() || null;

  return {
    ...entry,
    step,
    stepStatus,
    startTimestamp,
    endTimestamp,
    actionBy,
    status,
  };
}

function normalizeRoadmapForDataJson(roadmap: any[] | null | undefined, actorFallback: string) {
  if (!Array.isArray(roadmap)) return [];

  const out: any[] = [];
  for (const row of roadmap) {
    const normalized = normalizeRoadmapEntry(row, actorFallback);
    if (normalized) out.push(normalized);
  }
  return out;
}

export const handler: AppSyncResolverHandler<Args, any> = async (event) => {
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);

  const client = generateClient<Schema>();

  const payload = safeParseInput(event.arguments?.input);
  const isUpdate = Boolean(payload.id);
  const actorFromIdentity =
    String((event.identity as any)?.claims?.email ?? (event.identity as any)?.username ?? "")
      .toLowerCase()
      .trim() || "system";

  // ✅ policy-level
  await requirePermissionFromEvent(client as any, event, "JOB_CARDS", isUpdate ? "UPDATE" : "CREATE");

  // ✅ option-level ctx
  const opt = await getOptionCtx(client as any, event);

  const status = String(payload.status ?? "OPEN").toUpperCase();
  const cancelling = status === "CANCELLED";

  // Load existing
  let existing: any = null;
  if (isUpdate && payload.id) {
    const ex = await (client.models as any).JobOrder.get({ id: payload.id });
    existing = ex?.data ?? ex;
  }

  // customer name required unless cancelling existing
  let customerName = String(payload.customerName ?? "").trim();
  if (!customerName) customerName = String(existing?.customerName ?? "").trim();
  if (!customerName && !cancelling) throw new Error("Customer name is required.");

  // services
  let services = Array.isArray(payload.services) ? payload.services : [];
  if ((!services || !services.length) && existing?.dataJson) {
    try {
      const parsed = JSON.parse(String(existing.dataJson));
      if (Array.isArray(parsed?.services)) services = parsed.services;
    } catch {
      // ignore
    }
  }
  if ((!services || !services.length) && !cancelling) throw new Error("Add at least one service.");

  // ✅ keep existing vat/discount when missing
  const vatRate =
    payload.vatRate != null ? Math.max(0, toNum(payload.vatRate)) : Math.max(0, toNum(existing?.vatRate));
  const discount =
    payload.discount != null ? Math.max(0, toNum(payload.discount)) : Math.max(0, toNum(existing?.discount));

  // subtotal
  const subtotal = (services ?? []).reduce((sum, s) => {
    const qty = Math.max(1, toNum((s as any).qty ?? 1));
    const unit = Math.max(0, toNum((s as any).unitPrice ?? (s as any).price ?? 0));
    return sum + qty * unit;
  }, 0);

  // ✅ numeric limit: discount max % (union of payment+joborder limits)
  if (!cancelling && subtotal > 0) {
    const existingDiscount = Math.max(0, toNum(existing?.discount));
    const discountChanged = Math.abs(discount - existingDiscount) > 0.00001;

    if (discountChanged && discount > 0) {
      const allowedByToggle =
        opt.toggleEnabled("payment", "payment_discountfield", true) ||
        opt.toggleEnabled("joborder", "joborder_discount_percent", true);

      if (!allowedByToggle) throw new Error("You are not allowed to change discount.");
    }

    const maxPctPayment = opt.maxNumber("payment", "payment_discount_percent", 100);
    const maxPctJob = opt.maxNumber("joborder", "joborder_discount_percent", 100);
    const maxPct = Math.max(0, Math.min(100, Math.max(maxPctPayment, maxPctJob)));

    const maxDiscountAmount = (subtotal * maxPct) / 100;
    if (discount > maxDiscountAmount + 0.00001) {
      throw new Error(`Discount exceeds allowed limit. Max ${maxPct}% of subtotal (${maxDiscountAmount.toFixed(2)}).`);
    }
  }

  const taxable = Math.max(0, subtotal - discount);
  const vatAmount = taxable * vatRate;
  const totalAmount = taxable + vatAmount;

  // amountPaid from Payment model
  let amountPaid = 0;
  if (isUpdate && payload.id) {
    await recomputeJobOrderPaymentSummary(client as any, payload.id);
    const updated = await (client.models as any).JobOrder.get({ id: payload.id });
    amountPaid = Math.max(0, toNum(updated?.data?.amountPaid));
  }

  const { paymentStatus, balanceDue } = computePaymentStatus(totalAmount, amountPaid);

  // ✅ NEW: Minimal dataJson - only store non-schema data (services, documents, roadmap, billing)
  // All other data is in schema fields, no need to duplicate
  const dataJson = JSON.stringify({
    services: services.map((s: any, idx: number) => {
      const price = toNum((s as any).price);
      const assignedTo = String((s as any).assignedTo ?? "").trim().toLowerCase() || null;
      const technicians = Array.isArray((s as any).technicians)
        ? (s as any).technicians.map((t: any) => String(t ?? "").trim()).filter(Boolean)
        : [];

      return {
        id: String(s.id ?? `SVC-${idx + 1}`),
        order: Number((s as any).order ?? idx + 1),
        name: String(s.name ?? "").trim(),
        price,

        qty: Math.max(1, toNum((s as any).qty ?? 1)),
        unitPrice: Math.max(0, toNum((s as any).unitPrice ?? price)),

        status: String((s as any).status ?? "Pending"),
        priority: String((s as any).priority ?? "normal"),
        assignedTo,
        technicians,

        startTime: (s as any).startTime ?? null,
        endTime: (s as any).endTime ?? null,
        started: (s as any).started ?? ((s as any).startTime ?? "Not started"),
        ended: (s as any).ended ?? ((s as any).endTime ?? "Not completed"),
        duration: (s as any).duration ?? "Not started",
        technician: assignedTo ?? String((s as any).technician ?? "Not assigned"),

        requestedAction: (s as any).requestedAction ?? null,
        approvalStatus: (s as any).approvalStatus ?? null,
        qualityCheckResult: (s as any).qualityCheckResult ?? (s as any).qcResult ?? null,
        notes: String((s as any).notes ?? ""),
      };
    }),
    documents: Array.isArray(payload.documents) ? payload.documents : [],
    roadmap: normalizeRoadmapForDataJson(payload.roadmap, actorFromIdentity),
    billing: payload.billing ?? {},
  });

  const common: any = {
    orderType: String(payload.orderType ?? existing?.orderType ?? "Job Order"),
    status: (payload.status as any) ?? existing?.status ?? "OPEN",

    workStatusLabel: String(payload.workStatusLabel ?? existing?.workStatusLabel ?? "").trim() || undefined,
    paymentStatusLabel: String(payload.paymentStatusLabel ?? existing?.paymentStatusLabel ?? "").trim() || undefined,

    customerId: payload.customerId ?? existing?.customerId ?? undefined,
    customerName,
    customerPhone: String(payload.customerPhone ?? existing?.customerPhone ?? "").trim() || undefined,
    customerEmail: String(payload.customerEmail ?? existing?.customerEmail ?? "").trim() || undefined,

    vehicleType: (payload.vehicleType as any) ?? existing?.vehicleType ?? "SUV_4X4",
    vehicleMake: String(payload.vehicleMake ?? existing?.vehicleMake ?? "").trim() || undefined,
    vehicleModel: String(payload.vehicleModel ?? existing?.vehicleModel ?? "").trim() || undefined,
    vehicleYear: String(payload.vehicleYear ?? existing?.vehicleYear ?? "").trim() || undefined,

    plateNumber: String(payload.plateNumber ?? existing?.plateNumber ?? "").trim() || undefined,
    vin: String(payload.vin ?? existing?.vin ?? "").trim() || undefined,
    mileage: String(payload.mileage ?? existing?.mileage ?? "").trim() || undefined,
    color: String(payload.color ?? existing?.color ?? "").trim() || undefined,
    registrationDate: String(payload.registrationDate ?? existing?.registrationDate ?? "").trim() || undefined,

    subtotal,
    discount,
    vatRate,
    vatAmount,
    totalAmount,

    amountPaid,
    balanceDue,
    paymentStatus,

    billId: String(payload.billId ?? existing?.billId ?? "").trim() || undefined,
    netAmount:
      payload.netAmount != null ? Math.max(0, toNum(payload.netAmount)) : existing?.netAmount ?? undefined,
    paymentMethod: String(payload.paymentMethod ?? existing?.paymentMethod ?? "").trim() || undefined,
    discountPercent: payload.discountPercent != null ? Math.max(0, toNum(payload.discountPercent)) : existing?.discountPercent ?? 0,

    // ✅ NEW: Customer Details
    customerAddress: String(payload.customerAddress ?? existing?.customerAddress ?? "").trim() || undefined,
    customerCompany: String(payload.customerCompany ?? existing?.customerCompany ?? "").trim() || undefined,
    customerSince: String(payload.customerSince ?? existing?.customerSince ?? "").trim() || undefined,
    completedServicesCount: payload.completedServicesCount != null ? Math.max(0, toNum(payload.completedServicesCount)) : existing?.completedServicesCount ?? 0,
    registeredVehiclesCount: payload.registeredVehiclesCount != null ? Math.max(1, toNum(payload.registeredVehiclesCount)) : existing?.registeredVehiclesCount ?? 1,

    // ✅ NEW: Service Tracking
    totalServiceCount: payload.totalServiceCount != null ? Math.max(0, toNum(payload.totalServiceCount)) : existing?.totalServiceCount ?? 0,
    completedServiceCount: payload.completedServiceCount != null ? Math.max(0, toNum(payload.completedServiceCount)) : existing?.completedServiceCount ?? 0,
    pendingServiceCount: payload.pendingServiceCount != null ? Math.max(0, toNum(payload.pendingServiceCount)) : existing?.pendingServiceCount ?? 0,

    // ✅ NEW: Delivery Information
    expectedDeliveryDate: String(payload.expectedDeliveryDate ?? existing?.expectedDeliveryDate ?? "").trim() || undefined,
    expectedDeliveryTime: String(payload.expectedDeliveryTime ?? existing?.expectedDeliveryTime ?? "").trim() || undefined,
    actualDeliveryDate: String(payload.actualDeliveryDate ?? existing?.actualDeliveryDate ?? "").trim() || undefined,
    actualDeliveryTime: String(payload.actualDeliveryTime ?? existing?.actualDeliveryTime ?? "").trim() || undefined,
    estimatedCompletionHours: payload.estimatedCompletionHours != null ? toNum(payload.estimatedCompletionHours) : existing?.estimatedCompletionHours ?? undefined,
    actualCompletionHours: payload.actualCompletionHours != null ? toNum(payload.actualCompletionHours) : existing?.actualCompletionHours ?? undefined,

    // ✅ NEW: Quality Check Fields
    qualityCheckStatus: (payload.qualityCheckStatus as any) ?? existing?.qualityCheckStatus ?? "PENDING",
    qualityCheckDate: payload.qualityCheckDate ?? existing?.qualityCheckDate ?? undefined,
    qualityCheckNotes: String(payload.qualityCheckNotes ?? existing?.qualityCheckNotes ?? "").trim() || undefined,
    qualityCheckedBy: String(payload.qualityCheckedBy ?? existing?.qualityCheckedBy ?? "").trim() || undefined,

    // ✅ NEW: Exit Permit Fields
    exitPermitRequired: payload.exitPermitRequired ?? existing?.exitPermitRequired ?? false,
    exitPermitStatus: (payload.exitPermitStatus as any) ?? existing?.exitPermitStatus ?? "NOT_REQUIRED",
    exitPermitDate: payload.exitPermitDate ?? existing?.exitPermitDate ?? undefined,
    nextServiceDate: String(payload.nextServiceDate ?? existing?.nextServiceDate ?? "").trim() || undefined,

    // ✅ NEW: Priority & Assignment
    priorityLevel: (payload.priorityLevel as any) ?? existing?.priorityLevel ?? "NORMAL",
    assignedTechnicianId: String(payload.assignedTechnicianId ?? existing?.assignedTechnicianId ?? "").trim() || undefined,
    assignedTechnicianName: String(payload.assignedTechnicianName ?? existing?.assignedTechnicianName ?? "").trim() || undefined,
    assignmentDate: payload.assignmentDate ?? existing?.assignmentDate ?? undefined,

    // ✅ NEW: Customer Communication
    customerNotes: String(payload.customerNotes ?? existing?.customerNotes ?? "").trim() || undefined,
    internalNotes: String(payload.internalNotes ?? existing?.internalNotes ?? "").trim() || undefined,
    customerNotified: payload.customerNotified ?? existing?.customerNotified ?? false,
    lastNotificationDate: payload.lastNotificationDate ?? existing?.lastNotificationDate ?? undefined,
    jobDescription: String(payload.jobDescription ?? existing?.jobDescription ?? "").trim() || undefined,
    specialInstructions: String(payload.specialInstructions ?? existing?.specialInstructions ?? "").trim() || undefined,

    notes: String(payload.notes ?? existing?.notes ?? "").trim() || undefined,
    dataJson,

    updatedAt: nowIso(),
  };

  if (!isUpdate) {
    const out = await (client.models as any).JobOrder.create({
      ...common,
      orderNumber: String(payload.orderNumber ?? "").trim() || makeOrderNumber(),
      createdAt: nowIso(),
      createdBy:
        actorFromIdentity || undefined,
    });

    const row = out?.data ?? out;
    console.log("[jobOrderSave] CREATE - out:", out);
    console.log("[jobOrderSave] CREATE - row:", row);
    console.log("[jobOrderSave] CREATE - returning:", { id: row?.id, orderNumber: row?.orderNumber });
    return { id: row?.id, orderNumber: row?.orderNumber };
  }

  const out = await (client.models as any).JobOrder.update({
    id: payload.id,
    ...common,
  });

  const row = out?.data ?? out;
  console.log("[jobOrderSave] UPDATE - out:", out);
  console.log("[jobOrderSave] UPDATE - row:", row);
  console.log("[jobOrderSave] UPDATE - returning:", { id: row?.id, orderNumber: row?.orderNumber });
  return { id: row?.id, orderNumber: row?.orderNumber };
};