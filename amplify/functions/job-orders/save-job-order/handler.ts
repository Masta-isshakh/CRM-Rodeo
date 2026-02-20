// amplify/functions/job-orders/save-job-order/handler.ts
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import type { AppSyncResolverHandler } from "aws-lambda";

import type { Schema } from "../../../data/resource";
import { requirePermissionFromEvent } from "../_shared/rbac";
import { computePaymentStatus, toNum } from "../_shared/finance";
import { recomputeJobOrderPaymentSummary } from "../_shared/payments";

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

  vehicleType?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: string;
  plateNumber?: string;
  vin?: string;
  mileage?: string;
  color?: string;

  billId?: string;
  netAmount?: number;
  paymentMethod?: string;

  expectedDeliveryDate?: string;
  expectedDeliveryTime?: string;
  customerNotes?: string;

  vatRate?: number;
  discount?: number;

  services?: ServiceLine[];
  documents?: any[];
  roadmap?: any[];
  billing?: any;

  [k: string]: any;
};

function safeParseInput(raw: any): Payload {
  if (raw == null) throw new Error("Missing input");
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) throw new Error("Empty input");
    return JSON.parse(s) as Payload;
  }
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

export const handler: AppSyncResolverHandler<Args, any> = async (event) => {
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);

  const client = generateClient<Schema>();

  const payload = safeParseInput(event.arguments?.input);
  const isUpdate = Boolean(payload.id);

  // RBAC
  await requirePermissionFromEvent(client as any, event, "JOB_CARDS", isUpdate ? "UPDATE" : "CREATE");

  const status = String(payload.status ?? "OPEN").toUpperCase();
  const cancelling = status === "CANCELLED";

  // ✅ customer name required unless cancelling an already-existing order (we can preserve old)
  let customerName = String(payload.customerName ?? "").trim();

  // Services: allow empty only for CANCELLED updates (we’ll preserve existing totals)
  let services = Array.isArray(payload.services) ? payload.services : [];

  // Load existing if update (for cancel safety and missing fields)
  let existing: any = null;
  if (isUpdate && payload.id) {
    const ex = await (client.models as any).JobOrder.get({ id: payload.id });
    existing = ex?.data ?? ex;

    if (!customerName) customerName = String(existing?.customerName ?? "").trim();

    if ((!services || !services.length) && existing?.dataJson) {
      try {
        const parsed = JSON.parse(String(existing.dataJson));
        if (Array.isArray(parsed?.services)) services = parsed.services;
      } catch {
        // ignore
      }
    }
  }

  if (!customerName && !cancelling) throw new Error("Customer name is required.");
  if ((!services || !services.length) && !cancelling) throw new Error("Add at least one service.");

  const vatRate = Math.max(0, toNum(payload.vatRate));
  const discount = Math.max(0, toNum(payload.discount));

  // Compute subtotal safely
  const subtotal = (services ?? []).reduce((sum, s) => {
    const qty = Math.max(1, toNum((s as any).qty ?? 1));
    const unit = Math.max(0, toNum((s as any).unitPrice ?? (s as any).price ?? 0));
    return sum + qty * unit;
  }, 0);

  const taxable = Math.max(0, subtotal - discount);
  const vatAmount = taxable * vatRate;
  const totalAmount = taxable + vatAmount;

  // Amount paid from Payment model (accurate)
  let amountPaid = 0;

  if (isUpdate && payload.id) {
    await recomputeJobOrderPaymentSummary(client as any, payload.id);
    const updated = await (client.models as any).JobOrder.get({ id: payload.id });
    amountPaid = Math.max(0, toNum(updated?.data?.amountPaid));
  }

  const { paymentStatus, balanceDue } = computePaymentStatus(totalAmount, amountPaid);

  // Build dataJson snapshot (store EVERYTHING, but remove legacy payments array if it exists)
  const { payments, ...payloadNoPayments } = payload as any;

  const dataJson = JSON.stringify({
    ...payloadNoPayments,
    customerName,
    services,
    documents: Array.isArray(payload.documents) ? payload.documents : [],
    roadmap: Array.isArray(payload.roadmap) ? payload.roadmap : [],
    billing: payload.billing ?? {},
    vatRate,
    discount,
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

    subtotal,
    discount,
    vatRate,
    vatAmount,
    totalAmount,

    amountPaid,
    balanceDue,
    paymentStatus,

    billId: String(payload.billId ?? existing?.billId ?? "").trim() || undefined,
    netAmount: payload.netAmount != null ? Math.max(0, toNum(payload.netAmount)) : existing?.netAmount ?? undefined,
    paymentMethod: String(payload.paymentMethod ?? existing?.paymentMethod ?? "").trim() || undefined,

    expectedDeliveryDate: String(payload.expectedDeliveryDate ?? existing?.expectedDeliveryDate ?? "").trim() || undefined,
    expectedDeliveryTime: String(payload.expectedDeliveryTime ?? existing?.expectedDeliveryTime ?? "").trim() || undefined,
    customerNotes: String(payload.customerNotes ?? existing?.customerNotes ?? "").trim() || undefined,

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
        String((event.identity as any)?.claims?.email ?? (event.identity as any)?.username ?? "")
          .toLowerCase()
          .trim() || undefined,
    });

    const row = out?.data ?? out;
    return { id: row?.id, orderNumber: row?.orderNumber };
  }

  const out = await (client.models as any).JobOrder.update({
    id: payload.id,
    ...common,
  });

  const row = out?.data ?? out;
  return { id: row?.id, orderNumber: row?.orderNumber };
};