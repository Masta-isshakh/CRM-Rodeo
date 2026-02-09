import type { Schema } from "../../../data/resource";

import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";

type Handler = (event: any) => Promise<any>;

const ADMIN_GROUP = "Admins";
const POLICY_KEY = "JOB_CARDS";

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

function normalizeGroupsFromClaims(claims: any): string[] {
  const g = claims?.["cognito:groups"];
  if (!g) return [];
  if (Array.isArray(g)) return g.map(String);
  // sometimes it's a string like '["A","B"]' or 'A,B'
  const parsed = safeJsonParse<any>(g);
  if (Array.isArray(parsed)) return parsed.map(String);
  return String(g)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

type EffectivePerms = { canRead: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean; canApprove: boolean };

function emptyPerms(): EffectivePerms {
  return { canRead: false, canCreate: false, canUpdate: false, canDelete: false, canApprove: false };
}

async function resolvePermissions(dataClient: ReturnType<typeof generateClient<Schema>>, groups: string[]): Promise<EffectivePerms> {
  const perms = emptyPerms();

  const normGroups = (groups ?? []).map((x) => String(x || "").trim()).filter(Boolean);
  if (normGroups.includes(ADMIN_GROUP)) {
    return { canRead: true, canCreate: true, canUpdate: true, canDelete: true, canApprove: true };
  }

  // DepartmentRoleLink and RolePolicy are readable to authenticated in your schema, but the Lambda uses IAM anyway.
  const linksRes = await dataClient.models.DepartmentRoleLink.list({ limit: 5000 });
  const roleIds = new Set<string>();

  for (const l of linksRes.data ?? []) {
    const dk = String((l as any).departmentKey ?? "");
    if (dk && normGroups.includes(dk)) {
      const rid = String((l as any).roleId ?? "");
      if (rid) roleIds.add(rid);
    }
  }

  if (!roleIds.size) return perms;

  const polRes = await dataClient.models.RolePolicy.list({ limit: 8000 });
  for (const p of polRes.data ?? []) {
    const rid = String((p as any).roleId ?? "");
    const key = String((p as any).policyKey ?? "");
    if (!rid || !key) continue;
    if (!roleIds.has(rid)) continue;
    if (key !== POLICY_KEY) continue;

    perms.canRead = perms.canRead || Boolean((p as any).canRead);
    perms.canCreate = perms.canCreate || Boolean((p as any).canCreate);
    perms.canUpdate = perms.canUpdate || Boolean((p as any).canUpdate);
    perms.canDelete = perms.canDelete || Boolean((p as any).canDelete);
    perms.canApprove = perms.canApprove || Boolean((p as any).canApprove);
  }

  return perms;
}

function generateOrderNumber(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `JO-${y}${m}${d}-${rand}`;
}

function toNum(x: unknown): number {
  const n = typeof x === "number" ? x : Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

type ServiceLine = {
  id?: string;
  name: string;
  category?: string;
  qty?: number;
  unitPrice?: number;
  status?: string;
  technician?: string;
  notes?: string;
};

type PaymentLine = {
  id?: string;
  amount: number;
  method?: string;
  reference?: string;
  paidAt?: string;
};

type DocLine = {
  id?: string;
  title: string;
  url: string;
  type?: string;
  addedAt?: string;
};

type InputShape = {
  id?: string;
  orderNumber?: string;
  orderType?: string;
  status?: string;
  customerId?: string;
  customerName?: string;
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
  payments?: PaymentLine[];
  documents?: DocLine[];

  // additional module data
  [k: string]: any;
};

export const handler: Handler = async (event) => {
  const rawInput = (event?.arguments as any)?.input;
  const input = safeJsonParse<InputShape>(rawInput) ?? (rawInput as InputShape) ?? {};

  const isUpdate = Boolean(input.id);

  // identify caller
  const claims = event?.identity?.claims ?? {};
  const username = String(event?.identity?.username ?? claims?.username ?? claims?.email ?? "").toLowerCase();
  const login = String(claims?.email ?? username ?? "").toLowerCase();

  const groups = normalizeGroupsFromClaims(claims);
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  const dataClient = generateClient<Schema>();

  const perms = await resolvePermissions(dataClient, groups);
  if (isUpdate && !perms.canUpdate) throw new Error("Not authorized: missing JOB_CARDS canUpdate.");
  if (!isUpdate && !perms.canCreate) throw new Error("Not authorized: missing JOB_CARDS canCreate.");

  const customerName = String(input.customerName ?? "").trim();
  if (!customerName) throw new Error("customerName is required.");

  const nowIso = new Date().toISOString();

  // normalize services
  const services: ServiceLine[] = Array.isArray(input.services) ? input.services : [];
  const normServices = services
    .map((s) => ({
      id: String(s.id ?? "").trim() || undefined,
      name: String(s.name ?? "").trim(),
      category: String(s.category ?? "").trim() || undefined,
      qty: toNum(s.qty ?? 1) || 1,
      unitPrice: toNum(s.unitPrice ?? 0),
      status: String(s.status ?? "PENDING").trim() || "PENDING",
      technician: String(s.technician ?? "").trim() || undefined,
      notes: String(s.notes ?? "").trim() || undefined,
    }))
    .filter((s) => s.name);

  const subtotal = normServices.reduce((sum, s) => sum + (toNum(s.qty) * toNum(s.unitPrice)), 0);

  const discount = Math.max(0, toNum(input.discount));
  const vatRate = Math.max(0, toNum(input.vatRate));
  const taxable = Math.max(0, subtotal - discount);
  const vatAmount = taxable * vatRate;
  const totalAmount = taxable + vatAmount;

  const payments: PaymentLine[] = Array.isArray(input.payments) ? input.payments : [];
  const normPayments = payments
    .map((p) => ({
      id: String(p.id ?? "").trim() || undefined,
      amount: Math.max(0, toNum(p.amount)),
      method: String(p.method ?? "").trim() || undefined,
      reference: String(p.reference ?? "").trim() || undefined,
      paidAt: String(p.paidAt ?? "").trim() || nowIso,
    }))
    .filter((p) => p.amount > 0);

  const amountPaid = normPayments.reduce((sum, p) => sum + toNum(p.amount), 0);
  const balanceDue = Math.max(0, totalAmount - amountPaid);
  const paymentStatus = balanceDue <= 0.00001 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "UNPAID";

  const status = String(input.status ?? (isUpdate ? "" : "OPEN")).trim() || "OPEN";
  const orderType = String(input.orderType ?? "").trim() || "Job Order";

  const orderNumber = String(input.orderNumber ?? "").trim() || generateOrderNumber();

  // store full payload (including services/payments/documents + any extra module fields)
  const documents: DocLine[] = Array.isArray(input.documents) ? input.documents : [];
  const normDocs = documents
    .map((d) => ({
      id: String(d.id ?? "").trim() || undefined,
      title: String(d.title ?? "").trim(),
      url: String(d.url ?? "").trim(),
      type: String(d.type ?? "").trim() || undefined,
      addedAt: String(d.addedAt ?? "").trim() || nowIso,
    }))
    .filter((d) => d.title && d.url);

  const payloadToStore: any = {
    ...input,
    id: input.id,
    orderNumber,
    orderType,
    status,
    paymentStatus,
    customerName,
    customerPhone: String(input.customerPhone ?? "").trim() || undefined,
    customerEmail: String(input.customerEmail ?? "").trim() || undefined,
    vehicleType: String(input.vehicleType ?? "").trim() || undefined,
    vehicleMake: String(input.vehicleMake ?? "").trim() || undefined,
    vehicleModel: String(input.vehicleModel ?? "").trim() || undefined,
    plateNumber: String(input.plateNumber ?? "").trim() || undefined,
    vin: String(input.vin ?? "").trim() || undefined,
    mileage: String(input.mileage ?? "").trim() || undefined,
    color: String(input.color ?? "").trim() || undefined,
    notes: String(input.notes ?? "").trim() || undefined,
    services: normServices,
    payments: normPayments,
    documents: normDocs,
    totals: { subtotal, discount, vatRate, vatAmount, totalAmount, amountPaid, balanceDue },
    updatedAt: nowIso,
  };

  if (!isUpdate) {
    payloadToStore.createdAt = nowIso;
    payloadToStore.createdBy = login || username || "unknown";
  }

  // persist
  if (isUpdate) {
    const res = await dataClient.models.JobOrder.update({
      id: String(input.id),
      orderNumber,
      orderType,
      status: status as any,
      paymentStatus: paymentStatus as any,

      customerId: String(input.customerId ?? "").trim() || undefined,
      customerName,
      customerPhone: String(input.customerPhone ?? "").trim() || undefined,
      customerEmail: String(input.customerEmail ?? "").trim() || undefined,

      vehicleType: (String(input.vehicleType ?? "").trim() || undefined) as any,
      vehicleMake: String(input.vehicleMake ?? "").trim() || undefined,
      vehicleModel: String(input.vehicleModel ?? "").trim() || undefined,
      plateNumber: String(input.plateNumber ?? "").trim() || undefined,
      vin: String(input.vin ?? "").trim() || undefined,
      mileage: String(input.mileage ?? "").trim() || undefined,
      color: String(input.color ?? "").trim() || undefined,

      subtotal,
      discount,
      vatRate,
      vatAmount,
      totalAmount,
      amountPaid,
      balanceDue,

      notes: String(input.notes ?? "").trim() || undefined,
      dataJson: JSON.stringify(payloadToStore),

      updatedAt: nowIso,
    } as any);

    return { ok: true, mode: "update", id: res.data?.id ?? input.id, orderNumber, status, paymentStatus, totals: payloadToStore.totals };
  }

  const createRes = await dataClient.models.JobOrder.create({
    orderNumber,
    orderType,
    status: status as any,
    paymentStatus: paymentStatus as any,

    customerId: String(input.customerId ?? "").trim() || undefined,
    customerName,
    customerPhone: String(input.customerPhone ?? "").trim() || undefined,
    customerEmail: String(input.customerEmail ?? "").trim() || undefined,

    vehicleType: (String(input.vehicleType ?? "").trim() || undefined) as any,
    vehicleMake: String(input.vehicleMake ?? "").trim() || undefined,
    vehicleModel: String(input.vehicleModel ?? "").trim() || undefined,
    plateNumber: String(input.plateNumber ?? "").trim() || undefined,
    vin: String(input.vin ?? "").trim() || undefined,
    mileage: String(input.mileage ?? "").trim() || undefined,
    color: String(input.color ?? "").trim() || undefined,

    subtotal,
    discount,
    vatRate,
    vatAmount,
    totalAmount,
    amountPaid,
    balanceDue,

    notes: String(input.notes ?? "").trim() || undefined,
    dataJson: JSON.stringify(payloadToStore),

    createdBy: login || username || "unknown",
    createdAt: nowIso,
    updatedAt: nowIso,
  } as any);

  return { ok: true, mode: "create", id: createRes.data?.id, orderNumber, status, paymentStatus, totals: payloadToStore.totals };
};
