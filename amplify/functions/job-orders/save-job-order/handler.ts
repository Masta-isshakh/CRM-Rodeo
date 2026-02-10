import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import type { AppSyncResolverHandler } from "aws-lambda";

import type { Schema } from "../../../data/resource";

import { requirePermissionFromEvent } from "../_shared/rbac";
import { computePaymentStatus, toNum } from "../_shared/finance";
import { recomputeJobOrderPaymentSummary } from "../_shared/payments";

type Args = { input: any };

type ServiceLine = { qty: number; unitPrice: number };

type Payload = {
  id?: string;
  orderNumber?: string;
  orderType?: string;
  status?: string;

  customerId?: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;

  vehicleType?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  plateNumber?: string;
  vin?: string;
  mileage?: string;
  color?: string;

  notes?: string;

  vatRate?: number;
  discount?: number;

  services?: ServiceLine[];
  documents?: any[];

  // allow extra future fields
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

  const customerName = String(payload.customerName ?? "").trim();
  if (!customerName) throw new Error("Customer name is required.");

  const services = Array.isArray(payload.services) ? payload.services : [];
  if (!services.length) throw new Error("Add at least one service.");

  const vatRate = Math.max(0, toNum(payload.vatRate));
  const discount = Math.max(0, toNum(payload.discount));

  const subtotal = services.reduce((sum, s) => sum + Math.max(1, toNum(s.qty)) * Math.max(0, toNum(s.unitPrice)), 0);
  const taxable = Math.max(0, subtotal - discount);
  const vatAmount = taxable * vatRate;
  const totalAmount = taxable + vatAmount;

  // Amount paid is sourced from Payment model for accuracy.
  // If this is an update, we will compute it from payments; for create it is 0.
  let amountPaid = 0;

  if (isUpdate && payload.id) {
    // Ensure any out-of-sync order has its payment summary recomputed first (best-effort).
    // This is safe and keeps amountPaid/balanceDue/paymentStatus correct.
    await recomputeJobOrderPaymentSummary(client as any, payload.id);
    const existing = await (client.models as any).JobOrder.get({ id: payload.id });
    amountPaid = Math.max(0, toNum(existing?.data?.amountPaid));
  }

  const { paymentStatus, balanceDue } = computePaymentStatus(totalAmount, amountPaid);

  // Persist full module payload (excluding any legacy 'payments' array)
  const { payments, ...payloadNoPayments } = payload as any;
  const dataJson = JSON.stringify({
    ...payloadNoPayments,
    customerName,
    services,
    documents: Array.isArray(payload.documents) ? payload.documents : [],
    vatRate,
    discount,
  });

  const common = {
    orderType: String(payload.orderType ?? "Job Order"),
    status: (payload.status as any) ?? "OPEN",

    customerId: payload.customerId ?? undefined,
    customerName,
    customerPhone: String(payload.customerPhone ?? "").trim() || undefined,
    customerEmail: String(payload.customerEmail ?? "").trim() || undefined,

    vehicleType: (payload.vehicleType as any) ?? "SUV_4X4",
    vehicleMake: String(payload.vehicleMake ?? "").trim() || undefined,
    vehicleModel: String(payload.vehicleModel ?? "").trim() || undefined,
    plateNumber: String(payload.plateNumber ?? "").trim() || undefined,
    vin: String(payload.vin ?? "").trim() || undefined,
    mileage: String(payload.mileage ?? "").trim() || undefined,
    color: String(payload.color ?? "").trim() || undefined,

    subtotal,
    discount,
    vatRate,
    vatAmount,
    totalAmount,
    amountPaid,
    balanceDue,
    paymentStatus,

    notes: String(payload.notes ?? "").trim() || undefined,
    dataJson,

    updatedAt: nowIso(),
  };

  if (!isUpdate) {
    const out = await (client.models as any).JobOrder.create({
      ...common,
      orderNumber: String(payload.orderNumber ?? "").trim() || makeOrderNumber(),
      createdAt: nowIso(),
      createdBy: String((event.identity as any)?.claims?.email ?? (event.identity as any)?.username ?? "").toLowerCase() || undefined,
    });

    return {
      id: out?.data?.id,
      orderNumber: out?.data?.orderNumber,
    };
  }

  const out = await (client.models as any).JobOrder.update({
    id: payload.id,
    ...common,
  });

  return {
    id: out?.data?.id,
    orderNumber: out?.data?.orderNumber,
  };
};
