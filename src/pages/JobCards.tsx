import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { createPortal } from "react-dom";

import { uploadData, getUrl } from "aws-amplify/storage";

import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";
import { logActivity } from "../utils/activityLogger";

import "./JobCards.css";

type JobOrderRow = Schema["JobOrder"]["type"];
type CustomerRow = Schema["Customer"]["type"];
type PaymentRow = Schema["JobOrderPayment"]["type"];

type OrderStatus =
  | "DRAFT"
  | "OPEN"
  | "IN_PROGRESS"
  | "READY"
  | "COMPLETED"
  | "CANCELLED";
type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
type VehicleType = "SEDAN" | "SUV_4X4" | "TRUCK" | "MOTORBIKE" | "OTHER";

type ServiceLine = {
  id: string;
  name: string;
  category?: string;
  qty: number;
  unitPrice: number;
  status: "PENDING" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  technician?: string;
  notes?: string;
};

type DocLine = {
  id: string;
  title: string;
  url: string; // external URL OR legacy string
  type?: string;
  addedAt: string;

  // NEW (for Storage uploads)
  storagePath?: string; // e.g. "job-orders/<orderId>/documents/<file>"
  fileName?: string;
  contentType?: string;
  size?: number;

  // Optional linkage metadata
  linkedPaymentId?: string;
  paymentMethod?: string;
};

type OrderPayload = {
  id?: string;
  orderNumber?: string;
  orderType: string;
  status: OrderStatus;
  paymentStatus?: PaymentStatus;

  customerId?: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;

  vehicleType: VehicleType;
  vehicleMake?: string;
  vehicleModel?: string;
  plateNumber?: string;
  vin?: string;
  mileage?: string;
  color?: string;

  notes?: string;

  vatRate: number; // 0..1
  discount: number;

  services: ServiceLine[];
  documents: DocLine[];

  totals?: {
    subtotal: number;
    discount: number;
    vatRate: number;
    vatAmount: number;
    totalAmount: number;
    amountPaid: number;
    balanceDue: number;
    paymentStatus: PaymentStatus;
  };

  [k: string]: any;
};

const VEHICLE_TYPES: { key: VehicleType; label: string }[] = [
  { key: "SEDAN", label: "Sedan" },
  { key: "SUV_4X4", label: "SUV / 4x4" },
  { key: "TRUCK", label: "Truck" },
  { key: "MOTORBIKE", label: "Motorbike" },
  { key: "OTHER", label: "Other" },
];

const METHODS = ["Cash", "Card", "Bank Transfer", "Online", "Other"];

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

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function toNum(x: unknown) {
  const n = typeof x === "number" ? x : Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function computeTotalsFromServices(d: OrderPayload) {
  const subtotal = (d.services ?? []).reduce(
    (sum, s) => sum + toNum(s.qty) * toNum(s.unitPrice),
    0
  );
  const discount = Math.max(0, toNum(d.discount));
  const vatRate = Math.max(0, toNum(d.vatRate));
  const taxable = Math.max(0, subtotal - discount);
  const vatAmount = taxable * vatRate;
  const totalAmount = taxable + vatAmount;

  const amountPaid = 0;
  const balanceDue = Math.max(0, totalAmount - amountPaid);
  const paymentStatus: PaymentStatus =
    balanceDue <= 0.00001 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "UNPAID";

  return {
    subtotal,
    discount,
    vatRate,
    vatAmount,
    totalAmount,
    amountPaid,
    balanceDue,
    paymentStatus,
  };
}

function isHttpUrl(s: string) {
  return /^https?:\/\//i.test(String(s ?? "").trim());
}

function sanitizeFileName(name: string) {
  const base = String(name || "file")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "");
  return base || `file_${Date.now()}`;
}

type MenuState =
  | { open: false }
  | { open: true; orderId: string; top: number; left: number };

export default function JobCards({ permissions }: PageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const client = getDataClient();

  const [orders, setOrders] = useState<JobOrderRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "ALL">("ALL");

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activePayload, setActivePayload] = useState<OrderPayload | null>(null);

  const [activePayments, setActivePayments] = useState<PaymentRow[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [draft, setDraft] = useState<OrderPayload>(() => ({
    orderType: "Job Order",
    status: "OPEN",
    vehicleType: "SUV_4X4",
    customerName: "",
    vatRate: 0,
    discount: 0,
    services: [],
    documents: [],
  }));

  const [menu, setMenu] = useState<MenuState>({ open: false });
  const portalMenuRef = useRef<HTMLDivElement | null>(null);

  // Documents UI state (Details screen)
  const [docTitle, setDocTitle] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docUploading, setDocUploading] = useState(false);

  // Payment quick-add state (Details screen)
  const [payAmount, setPayAmount] = useState<string>("");
  const [payMethod, setPayMethod] = useState<string>("Cash");
  const [payRef, setPayRef] = useState<string>("");
  const [payNotes, setPayNotes] = useState<string>("");
  const [payFile, setPayFile] = useState<File | null>(null);
  const [payAttaching, setPayAttaching] = useState(false);

  // Payment edit state
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editPayAmount, setEditPayAmount] = useState<string>("");
  const [editPayMethod, setEditPayMethod] = useState<string>("Cash");
  const [editPayRef, setEditPayRef] = useState<string>("");
  const [editPayNotes, setEditPayNotes] = useState<string>("");
  const [editPayAt, setEditPayAt] = useState<string>("");

  const load = async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [oRes, cRes] = await Promise.all([
        client.models.JobOrder.list({ limit: 2000 }),
        client.models.Customer.list({ limit: 2000 }),
      ]);
      const sorted = [...(oRes.data ?? [])].sort((a, b) =>
        String((b as any).updatedAt ?? (b as any).createdAt ?? "").localeCompare(
          String((a as any).updatedAt ?? (a as any).createdAt ?? "")
        )
      );
      setOrders(sorted);
      setCustomers(cRes.data ?? []);
      setStatus(`Loaded ${sorted.length} job orders.`);
    } catch (e: any) {
      console.error(e);
      setOrders([]);
      setCustomers([]);
      setStatus(e?.message ?? "Failed to load.");
    } finally {
      setLoading(false);
    }
  };

  const loadPaymentsFor = async (jobOrderId: string) => {
    if (!jobOrderId) return;
    setPaymentsLoading(true);
    try {
      let res: any;
      try {
        res = await (client.models.JobOrderPayment as any).listPaymentsByJobOrder?.({
          jobOrderId,
          limit: 2000,
        });
      } catch {
        res = null;
      }
      if (!res) {
        res = await client.models.JobOrderPayment.list({
          filter: { jobOrderId: { eq: jobOrderId } } as any,
          limit: 2000,
        });
      }
      const sorted = [...(res.data ?? [])].sort((a: any, b: any) =>
        String(b.paidAt ?? "").localeCompare(String(a.paidAt ?? ""))
      );
      setActivePayments(sorted);
    } catch (e) {
      console.warn("Failed to load payments", e);
      setActivePayments([]);
    } finally {
      setPaymentsLoading(false);
    }
  };

  const rowToPayload = (row: JobOrderRow): OrderPayload => {
    const payload =
      safeJsonParse<Partial<OrderPayload>>((row as any).dataJson) ??
      ({} as Partial<OrderPayload>);

    const merged: OrderPayload = {
      id: (row as any).id,
      orderNumber: (row as any).orderNumber,
      orderType: String((row as any).orderType ?? "Job Order"),
      status: ((row as any).status as any) ?? "OPEN",
      paymentStatus: ((row as any).paymentStatus as any) ?? "UNPAID",

      customerId: (row as any).customerId ?? undefined,
      customerName: (row as any).customerName ?? "",
      customerPhone: (row as any).customerPhone ?? undefined,
      customerEmail: (row as any).customerEmail ?? undefined,

      vehicleType: ((row as any).vehicleType as any) ?? "SUV_4X4",
      vehicleMake: (row as any).vehicleMake ?? undefined,
      vehicleModel: (row as any).vehicleModel ?? undefined,
      plateNumber: (row as any).plateNumber ?? undefined,
      vin: (row as any).vin ?? undefined,
      mileage: (row as any).mileage ?? undefined,
      color: (row as any).color ?? undefined,

      notes: (row as any).notes ?? undefined,

      vatRate: toNum((row as any).vatRate ?? (payload as any).vatRate ?? 0),
      discount: toNum((row as any).discount ?? (payload as any).discount ?? 0),

      services: (payload as any).services ?? [],
      documents: (payload as any).documents ?? [],
      ...payload,
    };

    merged.totals = {
      subtotal: toNum((row as any).subtotal),
      discount: toNum((row as any).discount),
      vatRate: toNum((row as any).vatRate),
      vatAmount: toNum((row as any).vatAmount),
      totalAmount: toNum((row as any).totalAmount),
      amountPaid: toNum((row as any).amountPaid),
      balanceDue: toNum((row as any).balanceDue),
      paymentStatus: ((row as any).paymentStatus as any) ?? "UNPAID",
    };

    return merged;
  };

  const refreshActiveOrder = async (id: string) => {
    try {
      const res = await client.models.JobOrder.get({ id } as any);
      const row = (res as any)?.data as JobOrderRow | undefined;
      if (!row) return;
      const merged = rowToPayload(row);
      setActiveOrderId(id);
      setActivePayload(merged);
    } catch (e) {
      console.warn("Failed to refresh active order", e);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!menu.open) return;

    const onDown = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (!t) return;
      const btn = t.closest(`[data-jom-menu-btn="${menu.orderId}"]`);
      if (btn) return;
      if (portalMenuRef.current?.contains(t)) return;
      setMenu({ open: false });
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setMenu({ open: false });
    };

    const onScroll = () => setMenu({ open: false });
    const onResize = () => setMenu({ open: false });

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [menu]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (orders ?? []).filter((o) => {
      if (statusFilter !== "ALL" && String((o as any).status) !== statusFilter)
        return false;

      if (!q) return true;
      const hay = [
        (o as any).orderNumber,
        (o as any).customerName,
        (o as any).customerPhone,
        (o as any).plateNumber,
        (o as any).vehicleMake,
        (o as any).vehicleModel,
        (o as any).status,
        (o as any).paymentStatus,
      ]
        .map((x) => String(x ?? ""))
        .join(" ")
        .toLowerCase();

      return hay.includes(q);
    });
  }, [orders, search, statusFilter]);

  const openActionsMenu = (orderId: string, btnEl: HTMLElement) => {
    const rect = btnEl.getBoundingClientRect();
    const menuWidth = 200;
    const menuHeight = 170;

    let left = rect.right - menuWidth;
    if (left < 12) left = 12;
    if (left + menuWidth > window.innerWidth - 12)
      left = window.innerWidth - 12 - menuWidth;

    let top = rect.bottom + 8;
    if (top + menuHeight > window.innerHeight - 12) {
      top = rect.top - 8 - menuHeight;
      if (top < 12) top = 12;
    }

    setMenu({ open: true, orderId, top, left });
  };

  const portalDropdown =
    menu.open &&
    createPortal(
      <div
        className="jom-menu"
        ref={portalMenuRef}
        style={{ top: menu.top, left: menu.left, width: 200 }}
      >
        <button
          className="jom-menu-item"
          onClick={() => {
            setMenu({ open: false });
            openDetails(menu.orderId);
          }}
        >
          View details
        </button>

        <button
          className="jom-menu-item"
          disabled={!permissions.canUpdate}
          onClick={() => {
            setMenu({ open: false });
            startEdit(menu.orderId);
          }}
        >
          Edit
        </button>

        <button
          className="jom-menu-item danger"
          disabled={!permissions.canDelete}
          onClick={() => {
            setMenu({ open: false });
            void removeOrder(menu.orderId);
          }}
        >
          Delete
        </button>

        <div className="jom-menu-sep" />

        <button
          className="jom-menu-item"
          onClick={() => {
            setMenu({ open: false });
            window.print();
          }}
        >
          Print
        </button>
      </div>,
      document.body
    );

  const openDetails = async (id: string) => {
    const row = orders.find((x) => (x as any).id === id);
    if (!row) return;

    const merged = rowToPayload(row);

    setActiveOrderId(id);
    setActivePayload(merged);
    setDetailsOpen(true);

    // reset inline UI fields
    setDocTitle("");
    setDocUrl("");
    setDocFile(null);

    setPayAmount("");
    setPayMethod("Cash");
    setPayRef("");
    setPayNotes("");
    setPayFile(null);

    setEditingPaymentId(null);

    await loadPaymentsFor(id);
  };

  const startCreate = () => {
    setWizardStep(1);
    setDraft({
      orderType: "Job Order",
      status: "OPEN",
      vehicleType: "SUV_4X4",
      customerName: "",
      vatRate: 0,
      discount: 0,
      services: [],
      documents: [],
    });
    setWizardOpen(true);
  };

  const startEdit = (id: string) => {
    const row = orders.find((x) => (x as any).id === id);
    if (!row) return;

    const d = rowToPayload(row);

    setDraft(d);
    setWizardStep(1);
    setWizardOpen(true);
  };

  const savePayload = async (payload: OrderPayload) => {
    setStatus("");
    setLoading(true);

    try {
      const clean: OrderPayload = {
        ...payload,
        customerName: String(payload.customerName ?? "").trim(),
        customerPhone: String(payload.customerPhone ?? "").trim() || undefined,
        customerEmail: String(payload.customerEmail ?? "").trim() || undefined,
        plateNumber: String(payload.plateNumber ?? "").trim() || undefined,
        vehicleMake: String(payload.vehicleMake ?? "").trim() || undefined,
        vehicleModel: String(payload.vehicleModel ?? "").trim() || undefined,
        vin: String(payload.vin ?? "").trim() || undefined,
        mileage: String(payload.mileage ?? "").trim() || undefined,
        color: String(payload.color ?? "").trim() || undefined,
        notes: String(payload.notes ?? "").trim() || undefined,
        services: (payload.services ?? []).map((s) => ({
          ...s,
          name: String(s.name ?? "").trim(),
          category: String(s.category ?? "").trim() || undefined,
          technician: String(s.technician ?? "").trim() || undefined,
          notes: String(s.notes ?? "").trim() || undefined,
          qty: Math.max(1, toNum(s.qty)),
          unitPrice: Math.max(0, toNum(s.unitPrice)),
        })),
        documents: (payload.documents ?? []).map((d) => ({
          ...d,
          title: String(d.title ?? "").trim(),
          url: String(d.url ?? "").trim(),
          type: String(d.type ?? "").trim() || undefined,
          addedAt: String(d.addedAt ?? "").trim() || new Date().toISOString(),
          storagePath: String(d.storagePath ?? "").trim() || undefined,
          fileName: String(d.fileName ?? "").trim() || undefined,
          contentType: String(d.contentType ?? "").trim() || undefined,
          size: typeof d.size === "number" ? d.size : undefined,
          linkedPaymentId: String(d.linkedPaymentId ?? "").trim() || undefined,
          paymentMethod: String(d.paymentMethod ?? "").trim() || undefined,
        })),
        vatRate: Math.max(0, toNum(payload.vatRate)),
        discount: Math.max(0, toNum(payload.discount)),
      };

      if (!clean.customerName) throw new Error("Customer name is required.");
      if (!clean.services.length) throw new Error("Add at least one service.");

      const res = await (client.mutations as any).jobOrderSave({
        input: JSON.stringify(clean),
      });

      if (res?.errors?.length) {
        throw new Error(res.errors.map((e: any) => e.message).join(" | "));
      }

      const out = res?.data as any;
      const savedId = String(out?.id || clean.id || "");
      const orderNumber = String(out?.orderNumber || clean.orderNumber || "");

      const action = clean.id ? "UPDATE" : "CREATE";
      if (savedId) {
        await logActivity(
          "JobOrder",
          savedId,
          action,
          `Job order ${orderNumber} ${action.toLowerCase()}`
        );
      }

      setWizardOpen(false);

      await load();
      setStatus(clean.id ? "Job order updated." : "Job order created.");

      if (detailsOpen && activeOrderId && activeOrderId === savedId) {
        await refreshActiveOrder(savedId);
      }
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Save failed.");
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const saveDraft = async () => {
    await savePayload(draft);
  };

  const saveFromDetails = async (next: OrderPayload) => {
    setActivePayload(next);
    setDraft(next);
    await savePayload(next);
  };

  const removeOrder = async (id: string) => {
    if (!permissions.canDelete) return;
    if (!confirm("Delete this job order? This cannot be undone.")) return;

    setStatus("");
    setLoading(true);
    try {
      const res = await (client.mutations as any).jobOrderDelete({ id });

      if (res?.errors?.length)
        throw new Error(res.errors.map((e: any) => e.message).join(" | "));

      await logActivity("JobOrder", id, "DELETE", `Job order deleted`);
      await load();
      setStatus("Deleted.");
      if (activeOrderId === id) {
        setDetailsOpen(false);
        setActiveOrderId(null);
        setActivePayload(null);
        setActivePayments([]);
      }
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Delete failed.");
    } finally {
      setLoading(false);
    }
  };

  // -------- Storage helpers --------
  const uploadFileToStorage = async (opts: {
    orderId: string;
    file: File;
    folder: "documents" | "payments";
  }) => {
    const safe = sanitizeFileName(opts.file.name);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const storagePath = `job-orders/${opts.orderId}/${opts.folder}/${ts}_${safe}`;

    // Upload to S3 via Amplify Storage
    const task = uploadData({
      path: storagePath,
      data: opts.file,
      options: {
        contentType: opts.file.type || "application/octet-stream",
      },
    });
    await task.result;

    return {
      storagePath,
      fileName: opts.file.name,
      contentType: opts.file.type || undefined,
      size: opts.file.size,
    };
  };

  const openStoragePathInNewTab = async (storagePath: string) => {
    const link = await getUrl({
      path: storagePath,
      options: {
        expiresIn: 60 * 30, // 30 minutes
        validateObjectExistence: true,
      },
    });

    const signed = String((link as any)?.url ?? "");
    if (!signed) throw new Error("Could not create download URL.");

    window.open(signed, "_blank", "noopener,noreferrer");
  };

  const openDoc = async (d: DocLine) => {
    const external = String(d.url ?? "").trim();
    if (d.storagePath) {
      await openStoragePathInNewTab(d.storagePath);
      return;
    }
    // legacy support: if url is not http, treat it as storage path
    if (external && !isHttpUrl(external)) {
      await openStoragePathInNewTab(external);
      return;
    }
    if (external && isHttpUrl(external)) {
      window.open(external, "_blank", "noopener,noreferrer");
      return;
    }
    throw new Error("Document has no URL/path.");
  };

  // -------- Payments actions --------
  const addPayment = async (
    jobOrderId: string,
    amount: number,
    method: string,
    reference: string,
    paidAt: string,
    notes?: string
  ) => {
    if (!permissions.canUpdate) return;

    setStatus("");
    setPaymentsLoading(true);
    try {
      const res = await (client.mutations as any).jobOrderPaymentCreate({
        jobOrderId,
        amount,
        method,
        reference,
        paidAt,
        notes: notes || "",
      });
      if (res?.errors?.length)
        throw new Error(res.errors.map((e: any) => e.message).join(" | "));

      await logActivity(
        "JobOrder",
        String(res?.data?.jobOrderId ?? activeOrderId ?? ""),
        "CREATE",
        `Payment added: ${amount.toFixed(2)} QAR`
      );

      await loadPaymentsFor(jobOrderId);
      await refreshActiveOrder(jobOrderId);
      await load();
      setStatus("Payment added.");
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to add payment.");
      throw e;
    } finally {
      setPaymentsLoading(false);
    }
  };

  const updatePayment = async (payload: {
    id: string;
    amount: number;
    method?: string;
    reference?: string;
    paidAt?: string;
    notes?: string;
  }) => {
    if (!permissions.canUpdate) return;

    setStatus("");
    setPaymentsLoading(true);
    try {
      const res = await (client.mutations as any).jobOrderPaymentUpdate({
        id: payload.id,
        amount: payload.amount,
        method: payload.method ?? "",
        reference: payload.reference ?? "",
        paidAt: payload.paidAt ?? "",
        notes: payload.notes ?? "",
      });
      if (res?.errors?.length)
        throw new Error(res.errors.map((e: any) => e.message).join(" | "));

      const jobOrderId = String(res?.data?.jobOrderId ?? activeOrderId ?? "");
      await logActivity(
        "JobOrder",
        jobOrderId,
        "UPDATE",
        `Payment updated`
      );

      if (jobOrderId) {
        await loadPaymentsFor(jobOrderId);
        await refreshActiveOrder(jobOrderId);
        await load();
      }

      setStatus("Payment updated.");
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to update payment.");
    } finally {
      setPaymentsLoading(false);
    }
  };

  const deletePayment = async (paymentId: string) => {
    if (!permissions.canDelete) return;
    if (!confirm("Delete this payment entry?")) return;

    setStatus("");
    setPaymentsLoading(true);
    try {
      const res = await (client.mutations as any).jobOrderPaymentDelete({
        id: paymentId,
      });
      if (res?.errors?.length)
        throw new Error(res.errors.map((e: any) => e.message).join(" | "));

      const jobOrderId = String(res?.data?.jobOrderId ?? activeOrderId ?? "");

      await logActivity(
        "JobOrder",
        String(activeOrderId ?? ""),
        "DELETE",
        `Payment deleted`
      );

      if (jobOrderId) {
        await loadPaymentsFor(jobOrderId);
        await refreshActiveOrder(jobOrderId);
        await load();
      }

      setStatus("Payment deleted.");
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to delete payment.");
    } finally {
      setPaymentsLoading(false);
    }
  };

  const totalsPreview = useMemo(() => computeTotalsFromServices(draft), [draft]);

  // -------- Documents actions (Details screen) --------
  const addDocumentLink = async (title: string, url: string) => {
    if (!permissions.canUpdate || !activePayload?.id) return;
    const nextDocs: DocLine[] = [
      ...(activePayload.documents ?? []),
      {
        id: uid("doc"),
        title,
        url,
        type: "Link",
        addedAt: new Date().toISOString(),
      },
    ];
    const next = { ...activePayload, documents: nextDocs };
    await saveFromDetails(next);
  };

  const addDocumentUpload = async (title: string, file: File) => {
    if (!permissions.canUpdate || !activePayload?.id) return;

    setDocUploading(true);
    try {
      const meta = await uploadFileToStorage({
        orderId: activePayload.id,
        file,
        folder: "documents",
      });

      const nextDocs: DocLine[] = [
        ...(activePayload.documents ?? []),
        {
          id: uid("doc"),
          title: title || file.name,
          url: meta.storagePath, // keep legacy compatibility
          storagePath: meta.storagePath,
          type: "File",
          addedAt: new Date().toISOString(),
          fileName: meta.fileName,
          contentType: meta.contentType,
          size: meta.size,
        },
      ];

      const next = { ...activePayload, documents: nextDocs };
      await saveFromDetails(next);

      setDocTitle("");
      setDocUrl("");
      setDocFile(null);
      setStatus("Document uploaded.");
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Failed to upload document.");
    } finally {
      setDocUploading(false);
    }
  };

  const removeDocument = async (docId: string) => {
    if (!permissions.canUpdate || !activePayload?.id) return;
    if (!confirm("Remove this document from the job order?")) return;

    const nextDocs = (activePayload.documents ?? []).filter((d) => d.id !== docId);
    const next = { ...activePayload, documents: nextDocs };
    await saveFromDetails(next);
    setStatus("Document removed.");
  };

  // ---------- UI ----------
  return (
    <div className="jom-page">
      {portalDropdown}

      <div className="jom-header">
        <div className="jom-title">
          <div className="jom-badge">≡</div>
          <div>
            <h2>Job Orders</h2>
            <p>Search, create, and manage job orders (services, billing, documents).</p>
          </div>
        </div>

        <div className="jom-header-actions">
          <select
            className="jom-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="READY">Ready</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          <div className="jom-search-wrap">
            <span className="jom-search-ico" aria-hidden>
              🔎
            </span>
            <input
              className="jom-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order no, customer, phone, plate..."
            />
          </div>

          {permissions.canCreate && (
            <button className="jom-add" onClick={startCreate}>
              <span aria-hidden>+</span> New Job Order
            </button>
          )}

          <Button onClick={load} isLoading={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {status && <div className="jom-status">{status}</div>}

      <div className="jom-card">
        <div className="jom-table-scroll">
          <table className="jom-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Customer</th>
                <th>Phone</th>
                <th>Vehicle</th>
                <th>Plate</th>
                <th>Status</th>
                <th>Payment</th>
                <th className="right">Total (QAR)</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr
                  key={(o as any).id}
                  onDoubleClick={() => openDetails(String((o as any).id))}
                  title="Double-click to view details"
                >
                  <td className="mono">{(o as any).orderNumber}</td>
                  <td className="strong">{(o as any).customerName}</td>
                  <td>{(o as any).customerPhone ?? "—"}</td>
                  <td>
                    {[(o as any).vehicleMake, (o as any).vehicleModel]
                      .filter(Boolean)
                      .join(" ") || "—"}
                  </td>
                  <td>{(o as any).plateNumber ?? "—"}</td>
                  <td>
                    <span
                      className={`pill st-${String((o as any).status ?? "").toLowerCase()}`}
                    >
                      {String((o as any).status ?? "—")}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`pill pay-${String((o as any).paymentStatus ?? "").toLowerCase()}`}
                    >
                      {String((o as any).paymentStatus ?? "—")}
                    </span>
                  </td>
                  <td className="right">
                    {typeof (o as any).totalAmount === "number"
                      ? (o as any).totalAmount.toFixed(2)
                      : "—"}
                  </td>
                  <td className="right">
                    <button
                      className="jom-actions-btn"
                      type="button"
                      data-jom-menu-btn={String((o as any).id)}
                      onClick={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        if (menu.open && menu.orderId === String((o as any).id))
                          setMenu({ open: false });
                        else openActionsMenu(String((o as any).id), el);
                      }}
                    >
                      Actions{" "}
                      <span className="caret" aria-hidden>
                        ▾
                      </span>
                    </button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={9} className="empty">
                    No job orders found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="jom-footnote">
          Permissions are enforced in UI and also server-side for Create/Update/Delete through the{" "}
          <b>jobOrderSave</b> / <b>jobOrderDelete</b> functions (RBAC policy key: <b>JOB_CARDS</b>). Payments are stored in a separate model (
          <b>JobOrderPayment</b>) for reporting/audits.
        </div>
      </div>

      {/* Details screen */}
      {detailsOpen && activePayload && (
        <div className="jom-overlay" role="dialog" aria-modal="true">
          <div className="jom-details">
            <div className="jom-details-head">
              <div className="left">
                <button
                  className="icon-btn"
                  onClick={() => {
                    setDetailsOpen(false);
                    setActivePayments([]);
                    setEditingPaymentId(null);
                  }}
                  aria-label="Close"
                >
                  ✕
                </button>
                <div>
                  <div className="kicker">Job Order</div>
                  <div className="headline">{activePayload.orderNumber || "—"}</div>
                  <div className="subline">
                    <span className={`pill st-${activePayload.status.toLowerCase()}`}>
                      {activePayload.status}
                    </span>
                    <span
                      className={`pill pay-${String(
                        activePayload.totals?.paymentStatus ??
                          activePayload.paymentStatus ??
                          "UNPAID"
                      ).toLowerCase()}`}
                    >
                      {String(
                        activePayload.totals?.paymentStatus ??
                          activePayload.paymentStatus ??
                          "UNPAID"
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <div className="right">
                {permissions.canUpdate && (
                  <button
                    className="primary"
                    onClick={() => {
                      setDetailsOpen(false);
                      startEdit(activePayload.id!);
                    }}
                  >
                    Edit
                  </button>
                )}
                {permissions.canDelete && (
                  <button
                    className="danger"
                    onClick={() => void removeOrder(activePayload.id!)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            <div className="jom-details-body">
              <div className="grid">
                <div className="card">
                  <div className="card-title">Customer</div>
                  <div className="rows">
                    <div className="row">
                      <span>Name</span>
                      <b>{activePayload.customerName}</b>
                    </div>
                    <div className="row">
                      <span>Phone</span>
                      <b>{activePayload.customerPhone || "—"}</b>
                    </div>
                    <div className="row">
                      <span>Email</span>
                      <b>{activePayload.customerEmail || "—"}</b>
                    </div>
                  </div>

                  {activePayload.customerId && (
                    <div className="hint">
                      Linked to customer record:{" "}
                      <span className="mono">{activePayload.customerId}</span>
                    </div>
                  )}
                </div>

                <div className="card">
                  <div className="card-title">Vehicle</div>
                  <div className="rows">
                    <div className="row">
                      <span>Type</span>
                      <b>{activePayload.vehicleType}</b>
                    </div>
                    <div className="row">
                      <span>Make / Model</span>
                      <b>
                        {[activePayload.vehicleMake, activePayload.vehicleModel]
                          .filter(Boolean)
                          .join(" ") || "—"}
                      </b>
                    </div>
                    <div className="row">
                      <span>Plate</span>
                      <b>{activePayload.plateNumber || "—"}</b>
                    </div>
                    <div className="row">
                      <span>VIN</span>
                      <b>{activePayload.vin || "—"}</b>
                    </div>
                    <div className="row">
                      <span>Mileage</span>
                      <b>{activePayload.mileage || "—"}</b>
                    </div>
                    <div className="row">
                      <span>Color</span>
                      <b>{activePayload.color || "—"}</b>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">Billing</div>
                  {(() => {
                    const t = activePayload.totals;
                    const total = t?.totalAmount ?? 0;
                    const amountPaid = t?.amountPaid ?? 0;
                    const balance = t?.balanceDue ?? 0;
                    return (
                      <>
                        <div className="rows">
                          <div className="row">
                            <span>Subtotal</span>
                            <b>{toNum(t?.subtotal).toFixed(2)} QAR</b>
                          </div>
                          <div className="row">
                            <span>Discount</span>
                            <b>{toNum(t?.discount).toFixed(2)} QAR</b>
                          </div>
                          <div className="row">
                            <span>VAT</span>
                            <b>{toNum(t?.vatAmount).toFixed(2)} QAR</b>
                          </div>
                          <div className="row">
                            <span>Total</span>
                            <b>{toNum(total).toFixed(2)} QAR</b>
                          </div>
                          <div className="row">
                            <span>Paid</span>
                            <b>{toNum(amountPaid).toFixed(2)} QAR</b>
                          </div>
                          <div className="row">
                            <span>Balance</span>
                            <b>{toNum(balance).toFixed(2)} QAR</b>
                          </div>
                        </div>
                        {permissions.canUpdate && (
                          <div className="inline">
                            <label>Order status</label>
                            <select
                              value={activePayload.status}
                              onChange={(e) => {
                                const next = {
                                  ...activePayload,
                                  status: e.target.value as OrderStatus,
                                };
                                void saveFromDetails(next);
                              }}
                            >
                              <option value="DRAFT">DRAFT</option>
                              <option value="OPEN">OPEN</option>
                              <option value="IN_PROGRESS">IN_PROGRESS</option>
                              <option value="READY">READY</option>
                              <option value="COMPLETED">COMPLETED</option>
                              <option value="CANCELLED">CANCELLED</option>
                            </select>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Services */}
              <div className="card wide">
                <div className="card-title">Services</div>

                <div className="table-mini">
                  <div className="thead">
                    <div>Service</div>
                    <div>Qty</div>
                    <div>Unit</div>
                    <div>Status</div>
                    <div className="right">Line Total</div>
                    <div />
                  </div>

                  {(activePayload.services ?? []).map((s, idx) => (
                    <div className="trow" key={s.id || idx}>
                      <div>
                        <div className="strong">{s.name}</div>
                        <div className="muted">{s.category || "—"}</div>
                      </div>
                      <div>{s.qty}</div>
                      <div>{toNum(s.unitPrice).toFixed(2)}</div>
                      <div>
                        {permissions.canUpdate ? (
                          <select
                            value={s.status}
                            onChange={(e) => {
                              const nextServices = [...activePayload.services];
                              nextServices[idx] = {
                                ...s,
                                status: e.target.value as any,
                              };
                              const next = {
                                ...activePayload,
                                services: nextServices,
                              };
                              void saveFromDetails(next);
                            }}
                          >
                            <option value="PENDING">PENDING</option>
                            <option value="IN_PROGRESS">IN_PROGRESS</option>
                            <option value="DONE">DONE</option>
                            <option value="CANCELLED">CANCELLED</option>
                          </select>
                        ) : (
                          <span className="pill">{s.status}</span>
                        )}
                      </div>
                      <div className="right">
                        {(toNum(s.qty) * toNum(s.unitPrice)).toFixed(2)}
                      </div>
                      <div className="right">
                        {permissions.canUpdate && (
                          <button
                            className="link danger"
                            onClick={() => {
                              const nextServices = activePayload.services.filter(
                                (_, i) => i !== idx
                              );
                              const next = {
                                ...activePayload,
                                services: nextServices,
                              };
                              void saveFromDetails(next);
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {!activePayload.services?.length && (
                    <div className="empty-mini">No services yet.</div>
                  )}
                </div>

                {permissions.canUpdate && (
                  <div className="add-line">
                    <select
                      className="input"
                      defaultValue=""
                      onChange={(e) => {
                        const name = e.target.value;
                        if (!name) return;
                        const p = YOUR_PRODUCTS.find((x) => x.name === name);
                        const isSUV = activePayload.vehicleType !== "SEDAN";
                        const unitPrice = p
                          ? isSUV
                            ? p.suvPrice
                            : p.sedanPrice
                          : 0;

                        const nextServices = [
                          ...(activePayload.services ?? []),
                          {
                            id: uid("svc"),
                            name,
                            qty: 1,
                            unitPrice,
                            status: "PENDING" as const,
                          },
                        ];
                        const next = { ...activePayload, services: nextServices };
                        void saveFromDetails(next);
                        e.currentTarget.value = "";
                      }}
                    >
                      <option value="">+ Add service from catalog…</option>
                      {YOUR_PRODUCTS.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>

                    <button
                      className="secondary"
                      onClick={() => {
                        const nextServices = [
                          ...(activePayload.services ?? []),
                          {
                            id: uid("svc"),
                            name: "Custom Service",
                            qty: 1,
                            unitPrice: 0,
                            status: "PENDING" as const,
                          },
                        ];
                        const next = { ...activePayload, services: nextServices };
                        void saveFromDetails(next);
                      }}
                    >
                      + Custom
                    </button>
                  </div>
                )}
              </div>

              {/* Payments */}
              <div className="card wide">
                <div className="card-title">Payments</div>

                <div className="payments">
                  {paymentsLoading && <div className="muted">Loading payments…</div>}

                  {(activePayments ?? []).map((p) => {
                    const pid = String((p as any).id);
                    const isEditing = editingPaymentId === pid;

                    return (
                      <div className="pay" key={pid}>
                        {!isEditing ? (
                          <>
                            <div className="strong">
                              {toNum((p as any).amount).toFixed(2)} QAR
                            </div>
                            <div className="muted">
                              {(p as any).method || "—"} • {(p as any).reference || "—"}
                            </div>
                            <div className="muted">
                              {(p as any).paidAt
                                ? new Date(String((p as any).paidAt)).toLocaleString()
                                : "—"}
                              {(p as any).notes ? ` • ${(p as any).notes}` : ""}
                            </div>

                            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                              {permissions.canUpdate && (
                                <button
                                  className="link"
                                  onClick={() => {
                                    setEditingPaymentId(pid);
                                    setEditPayAmount(String(toNum((p as any).amount)));
                                    setEditPayMethod(String((p as any).method ?? "Cash") || "Cash");
                                    setEditPayRef(String((p as any).reference ?? ""));
                                    setEditPayNotes(String((p as any).notes ?? ""));
                                    setEditPayAt(String((p as any).paidAt ?? ""));
                                  }}
                                >
                                  Edit
                                </button>
                              )}
                              {permissions.canDelete && (
                                <button
                                  className="link danger"
                                  onClick={() => void deletePayment(pid)}
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={{ display: "grid", gridTemplateColumns: "160px 180px 1fr", gap: 10, width: "100%" }}>
                              <input
                                className="input"
                                type="number"
                                value={editPayAmount}
                                onChange={(e) => setEditPayAmount(e.target.value)}
                                placeholder="Amount"
                              />
                              <select
                                className="input"
                                value={editPayMethod}
                                onChange={(e) => setEditPayMethod(e.target.value)}
                              >
                                {METHODS.map((m) => (
                                  <option key={m} value={m}>
                                    {m}
                                  </option>
                                ))}
                              </select>
                              <input
                                className="input"
                                value={editPayRef}
                                onChange={(e) => setEditPayRef(e.target.value)}
                                placeholder="Reference"
                              />
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 10, width: "100%", marginTop: 10 }}>
                              <input
                                className="input"
                                value={editPayNotes}
                                onChange={(e) => setEditPayNotes(e.target.value)}
                                placeholder="Notes (optional)"
                              />
                              <input
                                className="input"
                                value={editPayAt}
                                onChange={(e) => setEditPayAt(e.target.value)}
                                placeholder="paidAt (ISO or leave)"
                              />
                            </div>

                            <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
                              <button
                                className="secondary"
                                disabled={paymentsLoading}
                                onClick={() => {
                                  const amt = Math.max(0, toNum(editPayAmount));
                                  if (!amt) {
                                    setStatus("Payment amount must be > 0.");
                                    return;
                                  }
                                  void updatePayment({
                                    id: pid,
                                    amount: amt,
                                    method: editPayMethod,
                                    reference: editPayRef,
                                    notes: editPayNotes,
                                    paidAt: editPayAt,
                                  });
                                  setEditingPaymentId(null);
                                }}
                              >
                                Save
                              </button>
                              <button
                                className="link"
                                onClick={() => setEditingPaymentId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}

                  {!paymentsLoading && !activePayments?.length && (
                    <div className="muted">No payments recorded.</div>
                  )}
                </div>

                {/* Add payment */}
                {permissions.canUpdate && activePayload.id && (
                  <div className="add-payment">
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 180px", gap: 10, width: "100%" }}>
                      <input
                        className="input"
                        type="number"
                        placeholder="Amount (QAR)"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                      />
                      <select
                        className="input"
                        value={payMethod}
                        onChange={(e) => {
                          setPayMethod(e.target.value);
                          // if method changes away from bank transfer, keep file optional (do not clear)
                        }}
                      >
                        {METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input"
                        placeholder="Reference (optional)"
                        value={payRef}
                        onChange={(e) => setPayRef(e.target.value)}
                      />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%", marginTop: 10 }}>
                      <input
                        className="input"
                        placeholder="Notes (optional)"
                        value={payNotes}
                        onChange={(e) => setPayNotes(e.target.value)}
                      />

                      <input
                        className="input"
                        type="file"
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          setPayFile(f);
                        }}
                      />
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
                      <button
                        className="secondary"
                        disabled={!payAmount || paymentsLoading || payAttaching}
                        onClick={async () => {
                          const amt = Math.max(0, toNum(payAmount));
                          if (!amt || !activePayload.id) return;

                          // RULE: Bank Transfer requires receipt file
                          if (payMethod === "Bank Transfer" && !payFile) {
                            setStatus("Bank Transfer requires uploading a receipt file before submitting.");
                            return;
                          }

                          setPayAttaching(true);
                          try {
                            // Upload optional/required receipt file first (if provided)
                            let receiptDoc: DocLine | null = null;

                            if (payFile) {
                              const meta = await uploadFileToStorage({
                                orderId: activePayload.id,
                                file: payFile,
                                folder: "payments",
                              });

                              receiptDoc = {
                                id: uid("doc"),
                                title:
                                  (payMethod === "Bank Transfer"
                                    ? "Bank Transfer Receipt"
                                    : "Payment Attachment") + ` • ${amt.toFixed(2)} QAR`,
                                url: meta.storagePath,
                                storagePath: meta.storagePath,
                                type: "Payment Receipt",
                                addedAt: new Date().toISOString(),
                                fileName: meta.fileName,
                                contentType: meta.contentType,
                                size: meta.size,
                                paymentMethod: payMethod,
                              };
                            }

                            // Create payment record
                            await addPayment(
                              activePayload.id,
                              amt,
                              payMethod,
                              payRef,
                              new Date().toISOString(),
                              payNotes
                            );

                            // If we uploaded a receipt, store it in JobOrder documents
                            if (receiptDoc) {
                              const nextDocs = [
                                ...(activePayload.documents ?? []),
                                receiptDoc,
                              ];
                              const next = { ...activePayload, documents: nextDocs };
                              await saveFromDetails(next);
                            }

                            setPayAmount("");
                            setPayRef("");
                            setPayNotes("");
                            setPayFile(null);
                          } finally {
                            setPayAttaching(false);
                          }
                        }}
                      >
                        Add payment
                      </button>

                      <span className="hint">
                        {payMethod === "Bank Transfer"
                          ? "Receipt file is required for Bank Transfer."
                          : "Attachment is optional for other methods."}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Documents */}
              <div className="card wide">
                <div className="card-title">Documents</div>

                <div className="docs">
                  {(activePayload.documents ?? []).map((d) => (
                    <div key={d.id} className="doc" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="strong" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {d.title}
                        </div>
                        <div className="muted">
                          {d.type || "Link"} •{" "}
                          {d.addedAt ? new Date(d.addedAt).toLocaleDateString() : "—"}
                          {d.fileName ? ` • ${d.fileName}` : ""}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <button
                          className="link"
                          onClick={async () => {
                            try {
                              await openDoc(d);
                            } catch (e: any) {
                              setStatus(e?.message ?? "Failed to open document.");
                            }
                          }}
                        >
                          Open
                        </button>

                        {permissions.canUpdate && (
                          <button className="link danger" onClick={() => void removeDocument(d.id)}>
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {!activePayload.documents?.length && (
                    <div className="muted">No documents added.</div>
                  )}
                </div>

                {permissions.canUpdate && (
                  <div className="add-doc" style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <input
                        className="input"
                        placeholder="Document title (optional)"
                        value={docTitle}
                        onChange={(e) => setDocTitle(e.target.value)}
                      />
                      <input
                        className="input"
                        type="file"
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          setDocFile(f);
                        }}
                      />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 10 }}>
                      <input
                        className="input"
                        placeholder="OR paste a link (https://...)"
                        value={docUrl}
                        onChange={(e) => setDocUrl(e.target.value)}
                      />
                      <button
                        className="secondary"
                        disabled={docUploading || !activePayload.id}
                        onClick={async () => {
                          const title = String(docTitle ?? "").trim();
                          const url = String(docUrl ?? "").trim();
                          const file = docFile;

                          if (file) {
                            await addDocumentUpload(title, file);
                            return;
                          }
                          if (title && url) {
                            await addDocumentLink(title, url);
                            setDocTitle("");
                            setDocUrl("");
                            setDocFile(null);
                            setStatus("Document link added.");
                            return;
                          }

                          setStatus("Upload a file OR provide Title + URL.");
                        }}
                      >
                        {docUploading ? "Uploading..." : "Add"}
                      </button>
                    </div>

                    <div className="hint">
                      Upload a file to Storage (recommended) or add an external link. Stored files open via signed URL.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Wizard (Create/Edit) */}
      {wizardOpen && (
        <div className="jom-overlay" role="dialog" aria-modal="true">
          <div className="jom-wizard">
            <div className="jom-wizard-head">
              <div className="left">
                <button className="icon-btn" onClick={() => setWizardOpen(false)} aria-label="Close">
                  ✕
                </button>
                <div>
                  <div className="headline">{draft.id ? "Edit Job Order" : "New Job Order"}</div>
                  <div className="muted">Step {wizardStep} of 4</div>
                </div>
              </div>

              <div className="steps">
                <div className={wizardStep === 1 ? "step on" : "step"}>Customer</div>
                <div className={wizardStep === 2 ? "step on" : "step"}>Vehicle</div>
                <div className={wizardStep === 3 ? "step on" : "step"}>Services</div>
                <div className={wizardStep === 4 ? "step on" : "step"}>Summary</div>
              </div>
            </div>

            <div className="jom-wizard-body">
              {wizardStep === 1 && (
                <div className="panel">
                  <h3>Customer</h3>

                  <div className="grid2">
                    <div>
                      <label>Link existing customer (optional)</label>
                      <select
                        className="input"
                        value={draft.customerId ?? ""}
                        onChange={(e) => {
                          const id = e.target.value || undefined;
                          const c = customers.find((x) => (x as any).id === id);
                          setDraft((p) => ({
                            ...p,
                            customerId: id,
                            customerName: c
                              ? `${(c as any).name ?? ""} ${(c as any).lastname ?? ""}`.trim()
                              : p.customerName,
                            customerPhone: (c as any)?.phone ?? p.customerPhone,
                            customerEmail: (c as any)?.email ?? p.customerEmail,
                          }));
                        }}
                      >
                        <option value="">— Select customer —</option>
                        {customers
                          .slice()
                          .sort((a, b) =>
                            String((a as any).name ?? "").localeCompare(String((b as any).name ?? ""))
                          )
                          .map((c) => (
                            <option key={(c as any).id} value={(c as any).id}>
                              {((c as any).name ?? "") + " " + ((c as any).lastname ?? "")} •{" "}
                              {(c as any).phone ?? "—"}
                            </option>
                          ))}
                      </select>
                      <div className="hint">
                        If the customer isn't listed, create them in <b>Customers</b> page first.
                      </div>
                    </div>

                    <div>
                      <label>Customer name</label>
                      <input
                        className="input"
                        value={draft.customerName}
                        onChange={(e) => setDraft((p) => ({ ...p, customerName: e.target.value }))}
                        placeholder="Full name"
                      />
                    </div>

                    <div>
                      <label>Phone</label>
                      <input
                        className="input"
                        value={draft.customerPhone ?? ""}
                        onChange={(e) => setDraft((p) => ({ ...p, customerPhone: e.target.value }))}
                        placeholder="+974 XXXXXXXX"
                      />
                    </div>

                    <div>
                      <label>Email</label>
                      <input
                        className="input"
                        value={draft.customerEmail ?? ""}
                        onChange={(e) => setDraft((p) => ({ ...p, customerEmail: e.target.value }))}
                        placeholder="email@domain.com"
                      />
                    </div>
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="panel">
                  <h3>Vehicle</h3>

                  <div className="grid2">
                    <div>
                      <label>Vehicle type</label>
                      <select
                        className="input"
                        value={draft.vehicleType}
                        onChange={(e) => setDraft((p) => ({ ...p, vehicleType: e.target.value as VehicleType }))}
                      >
                        {VEHICLE_TYPES.map((v) => (
                          <option key={v.key} value={v.key}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label>Make</label>
                      <input
                        className="input"
                        value={draft.vehicleMake ?? ""}
                        onChange={(e) => setDraft((p) => ({ ...p, vehicleMake: e.target.value }))}
                        placeholder="BMW"
                      />
                    </div>

                    <div>
                      <label>Model</label>
                      <input
                        className="input"
                        value={draft.vehicleModel ?? ""}
                        onChange={(e) => setDraft((p) => ({ ...p, vehicleModel: e.target.value }))}
                        placeholder="X5"
                      />
                    </div>

                    <div>
                      <label>Plate number</label>
                      <input
                        className="input"
                        value={draft.plateNumber ?? ""}
                        onChange={(e) => setDraft((p) => ({ ...p, plateNumber: e.target.value }))}
                        placeholder="123456"
                      />
                    </div>

                    <div>
                      <label>VIN</label>
                      <input
                        className="input"
                        value={draft.vin ?? ""}
                        onChange={(e) => setDraft((p) => ({ ...p, vin: e.target.value }))}
                        placeholder="(optional)"
                      />
                    </div>

                    <div>
                      <label>Mileage</label>
                      <input
                        className="input"
                        value={draft.mileage ?? ""}
                        onChange={(e) => setDraft((p) => ({ ...p, mileage: e.target.value }))}
                        placeholder="(optional)"
                      />
                    </div>

                    <div>
                      <label>Color</label>
                      <input
                        className="input"
                        value={draft.color ?? ""}
                        onChange={(e) => setDraft((p) => ({ ...p, color: e.target.value }))}
                        placeholder="(optional)"
                      />
                    </div>

                    <div>
                      <label>Notes</label>
                      <input
                        className="input"
                        value={draft.notes ?? ""}
                        onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
                        placeholder="(optional)"
                      />
                    </div>
                  </div>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="panel">
                  <h3>Services</h3>

                  <div className="service-add">
                    <select
                      className="input"
                      defaultValue=""
                      onChange={(e) => {
                        const name = e.target.value;
                        if (!name) return;

                        const p = YOUR_PRODUCTS.find((x) => x.name === name);
                        const isSUV = draft.vehicleType !== "SEDAN";
                        const unitPrice = p ? (isSUV ? p.suvPrice : p.sedanPrice) : 0;

                        setDraft((prev) => ({
                          ...prev,
                          services: [
                            ...prev.services,
                            { id: uid("svc"), name, qty: 1, unitPrice, status: "PENDING" as const },
                          ],
                        }));
                        e.currentTarget.value = "";
                      }}
                    >
                      <option value="">+ Add service from catalog…</option>
                      {YOUR_PRODUCTS.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>

                    <button
                      className="secondary"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          services: [
                            ...prev.services,
                            { id: uid("svc"), name: "Custom Service", qty: 1, unitPrice: 0, status: "PENDING" as const },
                          ],
                        }))
                      }
                    >
                      + Custom
                    </button>
                  </div>

                  <div className="services">
                    {draft.services.map((s, idx) => (
                      <div key={s.id} className="svc">
                        <div className="svc-main">
                          <input
                            className="input"
                            value={s.name}
                            onChange={(e) => {
                              const v = e.target.value;
                              setDraft((p) => {
                                const next = [...p.services];
                                next[idx] = { ...next[idx], name: v };
                                return { ...p, services: next };
                              });
                            }}
                            placeholder="Service name"
                          />

                          <select
                            className="input"
                            value={s.status}
                            onChange={(e) => {
                              const v = e.target.value as ServiceLine["status"];
                              setDraft((p) => {
                                const next = [...p.services];
                                next[idx] = { ...next[idx], status: v };
                                return { ...p, services: next };
                              });
                            }}
                          >
                            <option value="PENDING">PENDING</option>
                            <option value="IN_PROGRESS">IN_PROGRESS</option>
                            <option value="DONE">DONE</option>
                            <option value="CANCELLED">CANCELLED</option>
                          </select>
                        </div>

                        <div className="svc-grid">
                          <div>
                            <label>Qty</label>
                            <input
                              className="input"
                              type="number"
                              value={s.qty}
                              min={1}
                              onChange={(e) => {
                                const v = Math.max(1, toNum(e.target.value));
                                setDraft((p) => {
                                  const next = [...p.services];
                                  next[idx] = { ...next[idx], qty: v };
                                  return { ...p, services: next };
                                });
                              }}
                            />
                          </div>

                          <div>
                            <label>Unit price (QAR)</label>
                            <input
                              className="input"
                              type="number"
                              value={s.unitPrice}
                              min={0}
                              onChange={(e) => {
                                const v = Math.max(0, toNum(e.target.value));
                                setDraft((p) => {
                                  const next = [...p.services];
                                  next[idx] = { ...next[idx], unitPrice: v };
                                  return { ...p, services: next };
                                });
                              }}
                            />
                          </div>

                          <div>
                            <label>Technician</label>
                            <input
                              className="input"
                              value={s.technician ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                setDraft((p) => {
                                  const next = [...p.services];
                                  next[idx] = { ...next[idx], technician: v };
                                  return { ...p, services: next };
                                });
                              }}
                              placeholder="(optional)"
                            />
                          </div>

                          <div className="svc-total">
                            <label>Line total</label>
                            <div className="price">{(toNum(s.qty) * toNum(s.unitPrice)).toFixed(2)} QAR</div>
                          </div>
                        </div>

                        <div className="svc-foot">
                          <input
                            className="input"
                            value={s.notes ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setDraft((p) => {
                                const next = [...p.services];
                                next[idx] = { ...next[idx], notes: v };
                                return { ...p, services: next };
                              });
                            }}
                            placeholder="Notes (optional)"
                          />
                          <button
                            className="link danger"
                            onClick={() => setDraft((p) => ({ ...p, services: p.services.filter((_, i) => i !== idx) }))}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}

                    {!draft.services.length && <div className="muted">No services added yet.</div>}
                  </div>
                </div>
              )}

              {wizardStep === 4 && (
                <div className="panel">
                  <h3>Summary</h3>

                  <div className="grid2">
                    <div className="summary">
                      <div className="row">
                        <span>Subtotal</span>
                        <b>{totalsPreview.subtotal.toFixed(2)} QAR</b>
                      </div>
                      <div className="row">
                        <span>Discount</span>
                        <b>{totalsPreview.discount.toFixed(2)} QAR</b>
                      </div>
                      <div className="row">
                        <span>VAT rate</span>
                        <b>{(totalsPreview.vatRate * 100).toFixed(2)}%</b>
                      </div>
                      <div className="row">
                        <span>VAT</span>
                        <b>{totalsPreview.vatAmount.toFixed(2)} QAR</b>
                      </div>
                      <div className="row">
                        <span>Total</span>
                        <b>{totalsPreview.totalAmount.toFixed(2)} QAR</b>
                      </div>
                    </div>

                    <div>
                      <label>Discount (QAR)</label>
                      <input
                        className="input"
                        type="number"
                        value={draft.discount}
                        onChange={(e) => setDraft((p) => ({ ...p, discount: toNum(e.target.value) }))}
                      />

                      <label style={{ marginTop: 10 }}>VAT rate (e.g., 0.05 for 5%)</label>
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        value={draft.vatRate}
                        onChange={(e) => setDraft((p) => ({ ...p, vatRate: toNum(e.target.value) }))}
                      />

                      <label style={{ marginTop: 10 }}>Order status</label>
                      <select
                        className="input"
                        value={draft.status}
                        onChange={(e) => setDraft((p) => ({ ...p, status: e.target.value as OrderStatus }))}
                      >
                        <option value="DRAFT">DRAFT</option>
                        <option value="OPEN">OPEN</option>
                        <option value="IN_PROGRESS">IN_PROGRESS</option>
                        <option value="READY">READY</option>
                        <option value="COMPLETED">COMPLETED</option>
                        <option value="CANCELLED">CANCELLED</option>
                      </select>
                    </div>
                  </div>

                  <div className="hint">Tip: Payments can be added in the details screen after saving the job order.</div>
                </div>
              )}
            </div>

            <div className="jom-wizard-foot">
              <div className="left">
                <button className="secondary" onClick={() => setWizardOpen(false)}>
                  Cancel
                </button>
              </div>

              <div className="right">
                <button
                  className="secondary"
                  disabled={wizardStep === 1}
                  onClick={() => setWizardStep((s) => (s > 1 ? ((s - 1) as any) : s))}
                >
                  Back
                </button>

                {wizardStep < 4 ? (
                  <button className="primary" onClick={() => setWizardStep((s) => (s + 1) as any)}>
                    Next
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={draft.id ? !permissions.canUpdate : !permissions.canCreate}
                    onClick={() => void saveDraft()}
                  >
                    {draft.id ? "Update Job Order" : "Create Job Order"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
