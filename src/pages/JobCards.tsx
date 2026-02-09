import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { createPortal } from "react-dom";

import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";
import { logActivity } from "../utils/activityLogger";

import "./JobCards.css";

type JobOrderRow = Schema["JobOrder"]["type"];
type CustomerRow = Schema["Customer"]["type"];

type OrderStatus = "DRAFT" | "OPEN" | "IN_PROGRESS" | "READY" | "COMPLETED" | "CANCELLED";
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

type PaymentLine = {
  id: string;
  amount: number;
  method?: string;
  reference?: string;
  paidAt: string;
};

type DocLine = {
  id: string;
  title: string;
  url: string;
  type?: string;
  addedAt: string;
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
  payments: PaymentLine[];
  documents: DocLine[];

  totals?: {
    subtotal: number;
    discount: number;
    vatRate: number;
    vatAmount: number;
    totalAmount: number;
    amountPaid: number;
    balanceDue: number;
  };

  // room for future features from the HTML module
  [k: string]: any;
};

const VEHICLE_TYPES: { key: VehicleType; label: string }[] = [
  { key: "SEDAN", label: "Sedan" },
  { key: "SUV_4X4", label: "SUV / 4x4" },
  { key: "TRUCK", label: "Truck" },
  { key: "MOTORBIKE", label: "Motorbike" },
  { key: "OTHER", label: "Other" },
];

//const METHODS = ["Cash", "Card", "Bank Transfer", "Online", "Other"];

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

function computeTotals(d: OrderPayload) {
  const subtotal = (d.services ?? []).reduce((sum, s) => sum + toNum(s.qty) * toNum(s.unitPrice), 0);
  const discount = Math.max(0, toNum(d.discount));
  const vatRate = Math.max(0, toNum(d.vatRate));
  const taxable = Math.max(0, subtotal - discount);
  const vatAmount = taxable * vatRate;
  const totalAmount = taxable + vatAmount;

  const amountPaid = (d.payments ?? []).reduce((sum, p) => sum + Math.max(0, toNum(p.amount)), 0);
  const balanceDue = Math.max(0, totalAmount - amountPaid);

  const paymentStatus: PaymentStatus = balanceDue <= 0.00001 ? "PAID" : amountPaid > 0 ? "PARTIAL" : "UNPAID";
  return { subtotal, discount, vatRate, vatAmount, totalAmount, amountPaid, balanceDue, paymentStatus };
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

  // details & editor
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activePayload, setActivePayload] = useState<OrderPayload | null>(null);

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
    payments: [],
    documents: [],
  }));

  // actions dropdown (portal)
  const [menu, setMenu] = useState<MenuState>({ open: false });
  const portalMenuRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    setLoading(true);
    setStatus("Loading...");
    try {
      const [oRes, cRes] = await Promise.all([
        client.models.JobOrder.list({ limit: 2000 }),
        client.models.Customer.list({ limit: 2000 }),
      ]);
      const sorted = [...(oRes.data ?? [])].sort((a, b) =>
        String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? ""))
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

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close menu on outside click / ESC / scroll / resize
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
      if (statusFilter !== "ALL" && String(o.status) !== statusFilter) return false;

      if (!q) return true;
      const hay = [
        o.orderNumber,
        o.customerName,
        o.customerPhone,
        o.plateNumber,
        o.vehicleMake,
        o.vehicleModel,
        o.status,
        o.paymentStatus,
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
    if (left + menuWidth > window.innerWidth - 12) left = window.innerWidth - 12 - menuWidth;

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
      <div className="jom-menu" ref={portalMenuRef} style={{ top: menu.top, left: menu.left, width: 200 }}>
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

  const openDetails = (id: string) => {
    const row = orders.find((x) => x.id === id);
    if (!row) return;

const payload = safeJsonParse<Partial<OrderPayload>>(row.dataJson) ?? {};

    const merged: OrderPayload = {
      id: row.id,
      orderNumber: row.orderNumber,
      orderType: String(row.orderType ?? "Job Order"),
      status: (row.status as any) ?? "OPEN",
      paymentStatus: (row.paymentStatus as any) ?? "UNPAID",

      customerId: row.customerId ?? undefined,
      customerName: row.customerName ?? "",
      customerPhone: row.customerPhone ?? undefined,
      customerEmail: row.customerEmail ?? undefined,

      vehicleType: (row.vehicleType as any) ?? "SUV_4X4",
      vehicleMake: row.vehicleMake ?? undefined,
      vehicleModel: row.vehicleModel ?? undefined,
      plateNumber: row.plateNumber ?? undefined,
      vin: row.vin ?? undefined,
      mileage: row.mileage ?? undefined,
      color: row.color ?? undefined,

      notes: row.notes ?? undefined,

      vatRate: toNum(row.vatRate ?? payload?.vatRate ?? 0),
      discount: toNum(row.discount ?? payload?.discount ?? 0),

      services: payload?.services ?? [],
      payments: payload?.payments ?? [],
      documents: payload?.documents ?? [],
      ...payload,
    };

    merged.totals = computeTotals(merged);
    setActiveOrderId(id);
    setActivePayload(merged);
    setDetailsOpen(true);
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
      payments: [],
      documents: [],
    });
    setWizardOpen(true);
  };

const startEdit = (id: string) => {
  const row = orders.find((x) => x.id === id);
  if (!row) return;

  const payload = safeJsonParse<Partial<OrderPayload>>(row.dataJson) ?? {};

  const d: OrderPayload = {
    id: row.id,
    orderNumber: row.orderNumber,
    orderType: String(row.orderType ?? "Job Order"),
    status: (row.status as any) ?? "OPEN",
    paymentStatus: (row.paymentStatus as any) ?? "UNPAID",

    customerId: row.customerId ?? undefined,
    customerName: row.customerName ?? "",
    customerPhone: row.customerPhone ?? undefined,
    customerEmail: row.customerEmail ?? undefined,

    vehicleType: (row.vehicleType as any) ?? "SUV_4X4",
    vehicleMake: row.vehicleMake ?? undefined,
    vehicleModel: row.vehicleModel ?? undefined,
    plateNumber: row.plateNumber ?? undefined,
    vin: row.vin ?? undefined,
    mileage: row.mileage ?? undefined,
    color: row.color ?? undefined,

    notes: row.notes ?? undefined,

    vatRate: toNum((row as any).vatRate ?? payload.vatRate ?? 0),
    discount: toNum((row as any).discount ?? payload.discount ?? 0),

    services: (payload.services as ServiceLine[] | undefined) ?? [],
    payments: (payload.payments as PaymentLine[] | undefined) ?? [],
    documents: (payload.documents as DocLine[] | undefined) ?? [],

    ...payload,
  };

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
        payments: (payload.payments ?? []).map((p) => ({
          ...p,
          amount: Math.max(0, toNum(p.amount)),
          method: String(p.method ?? "").trim() || undefined,
          reference: String(p.reference ?? "").trim() || undefined,
          paidAt: String(p.paidAt ?? "").trim() || new Date().toISOString(),
        })),
        documents: (payload.documents ?? []).map((d) => ({
          ...d,
          title: String(d.title ?? "").trim(),
          url: String(d.url ?? "").trim(),
          type: String(d.type ?? "").trim() || undefined,
          addedAt: String(d.addedAt ?? "").trim() || new Date().toISOString(),
        })),
        vatRate: Math.max(0, toNum(payload.vatRate)),
        discount: Math.max(0, toNum(payload.discount)),
      };

      if (!clean.customerName) throw new Error("Customer name is required.");
      if (!clean.services.length) throw new Error("Add at least one service.");

      const totals = computeTotals(clean);
      clean.totals = totals;

      const res = await (client.mutations as any).jobOrderSave({
        input: JSON.stringify(clean),
      });

      if (res?.errors?.length) {
        throw new Error(res.errors.map((e: any) => e.message).join(" | "));
      }

      const out = res?.data as any;
      const savedId = String(out?.id || clean.id || "");
      const orderNumber = String(out?.orderNumber || clean.orderNumber || "");

      // Activity log (best-effort)
      const action = clean.id ? "UPDATE" : "CREATE";
      if (savedId) {
        await logActivity("JobOrder", savedId, action, `Job order ${orderNumber} ${action.toLowerCase()}`);
      }

      setWizardOpen(false);

      // if we were in details view, keep it open and reload list (to get updated computed fields)
      await load();

      setStatus(clean.id ? "Job order updated." : "Job order created.");
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Save failed.");
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const saveDraft = async () => {
    // keep draft & wizard state consistent
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

      if (res?.errors?.length) throw new Error(res.errors.map((e: any) => e.message).join(" | "));

      await logActivity("JobOrder", id, "DELETE", `Job order deleted`);
      await load();
      setStatus("Deleted.");
      if (activeOrderId === id) {
        setDetailsOpen(false);
        setActiveOrderId(null);
        setActivePayload(null);
      }
    } catch (e: any) {
      console.error(e);
      setStatus(e?.message ?? "Delete failed.");
    } finally {
      setLoading(false);
    }
  };

  const totalsPreview = useMemo(() => computeTotals(draft), [draft]);

  return (
    <div className="jom-page">
      {portalDropdown}

      {/* Header */}
      <div className="jom-header">
        <div className="jom-title">
          <div className="jom-badge">≡</div>
          <div>
            <h2>Job Orders</h2>
            <p>Search, create, and manage job orders (services, billing, documents).</p>
          </div>
        </div>

        <div className="jom-header-actions">
          <select className="jom-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="READY">Ready</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          <div className="jom-search-wrap">
            <span className="jom-search-ico" aria-hidden>🔎</span>
            <input className="jom-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order no, customer, phone, plate..." />
          </div>

          {permissions.canCreate && (
            <button className="jom-add" onClick={startCreate}>
              <span aria-hidden>+</span> New Job Order
            </button>
          )}

          <Button onClick={load} isLoading={loading}>Refresh</Button>
        </div>
      </div>

      {status && <div className="jom-status">{status}</div>}

      {/* Table */}
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
                <tr key={o.id} onDoubleClick={() => openDetails(o.id)} title="Double-click to view details">
                  <td className="mono">{o.orderNumber}</td>
                  <td className="strong">{o.customerName}</td>
                  <td>{o.customerPhone ?? "—"}</td>
                  <td>{[o.vehicleMake, o.vehicleModel].filter(Boolean).join(" ") || "—"}</td>
                  <td>{o.plateNumber ?? "—"}</td>
                  <td>
                    <span className={`pill st-${String(o.status ?? "").toLowerCase()}`}>{String(o.status ?? "—")}</span>
                  </td>
                  <td>
                    <span className={`pill pay-${String(o.paymentStatus ?? "").toLowerCase()}`}>{String(o.paymentStatus ?? "—")}</span>
                  </td>
                  <td className="right">{typeof o.totalAmount === "number" ? o.totalAmount.toFixed(2) : "—"}</td>
                  <td className="right">
                    <button
                      className="jom-actions-btn"
                      type="button"
                      data-jom-menu-btn={o.id}
                      onClick={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        if (menu.open && menu.orderId === o.id) setMenu({ open: false });
                        else openActionsMenu(o.id, el);
                      }}
                    >
                      Actions <span className="caret" aria-hidden>▾</span>
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
          Permissions are enforced in UI and also server-side for Create/Update/Delete through the <b>jobOrderSave</b> / <b>jobOrderDelete</b> functions (RBAC policy key: <b>JOB_CARDS</b>).
        </div>
      </div>

      {/* Details screen */}
      {detailsOpen && activePayload && (
        <div className="jom-overlay" role="dialog" aria-modal="true">
          <div className="jom-details">
            <div className="jom-details-head">
              <div className="left">
                <button className="icon-btn" onClick={() => setDetailsOpen(false)} aria-label="Close">✕</button>
                <div>
                  <div className="kicker">Job Order</div>
                  <div className="headline">{activePayload.orderNumber || "—"}</div>
                  <div className="subline">
                    <span className={`pill st-${activePayload.status.toLowerCase()}`}>{activePayload.status}</span>
                    <span className={`pill pay-${computeTotals(activePayload).paymentStatus.toLowerCase()}`}>{computeTotals(activePayload).paymentStatus}</span>
                  </div>
                </div>
              </div>

              <div className="right">
                {permissions.canUpdate && (
                  <button className="primary" onClick={() => { setDetailsOpen(false); startEdit(activePayload.id!); }}>
                    Edit
                  </button>
                )}
                {permissions.canDelete && (
                  <button className="danger" onClick={() => void removeOrder(activePayload.id!)}>Delete</button>
                )}
              </div>
            </div>

            <div className="jom-details-body">
              {/* Summary cards */}
              <div className="grid">
                <div className="card">
                  <div className="card-title">Customer</div>
                  <div className="rows">
                    <div className="row"><span>Name</span><b>{activePayload.customerName}</b></div>
                    <div className="row"><span>Phone</span><b>{activePayload.customerPhone || "—"}</b></div>
                    <div className="row"><span>Email</span><b>{activePayload.customerEmail || "—"}</b></div>
                  </div>

                  {activePayload.customerId && (
                    <div className="hint">
                      Linked to customer record: <span className="mono">{activePayload.customerId}</span>
                    </div>
                  )}
                </div>

                <div className="card">
                  <div className="card-title">Vehicle</div>
                  <div className="rows">
                    <div className="row"><span>Type</span><b>{activePayload.vehicleType}</b></div>
                    <div className="row"><span>Make / Model</span><b>{[activePayload.vehicleMake, activePayload.vehicleModel].filter(Boolean).join(" ") || "—"}</b></div>
                    <div className="row"><span>Plate</span><b>{activePayload.plateNumber || "—"}</b></div>
                    <div className="row"><span>VIN</span><b>{activePayload.vin || "—"}</b></div>
                    <div className="row"><span>Mileage</span><b>{activePayload.mileage || "—"}</b></div>
                    <div className="row"><span>Color</span><b>{activePayload.color || "—"}</b></div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">Billing</div>
                  {(() => {
                    const t = computeTotals(activePayload);
                    return (
                      <>
                        <div className="rows">
                          <div className="row"><span>Subtotal</span><b>{t.subtotal.toFixed(2)} QAR</b></div>
                          <div className="row"><span>Discount</span><b>{t.discount.toFixed(2)} QAR</b></div>
                          <div className="row"><span>VAT</span><b>{(t.vatAmount).toFixed(2)} QAR</b></div>
                          <div className="row"><span>Total</span><b>{t.totalAmount.toFixed(2)} QAR</b></div>
                          <div className="row"><span>Paid</span><b>{t.amountPaid.toFixed(2)} QAR</b></div>
                          <div className="row"><span>Balance</span><b>{t.balanceDue.toFixed(2)} QAR</b></div>
                        </div>
                        {permissions.canUpdate && (
                          <div className="inline">
                            <label>Order status</label>
                            <select
                              value={activePayload.status}
                              onChange={(e) => {
                                const next = { ...activePayload, status: e.target.value as OrderStatus };
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
                              nextServices[idx] = { ...s, status: e.target.value as any };
                              const next = { ...activePayload, services: nextServices };
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
                      <div className="right">{(toNum(s.qty) * toNum(s.unitPrice)).toFixed(2)}</div>
                      <div className="right">
                        {permissions.canUpdate && (
                          <button
                            className="link danger"
                            onClick={() => {
                              const nextServices = activePayload.services.filter((_, i) => i !== idx);
                              const next = { ...activePayload, services: nextServices };
                              void saveFromDetails(next);
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {!activePayload.services?.length && <div className="empty-mini">No services yet.</div>}
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
                        const unitPrice = p ? (isSUV ? p.suvPrice : p.sedanPrice) : 0;

                        const nextServices = [
                          ...(activePayload.services ?? []),
                          { id: uid("svc"), name, qty: 1, unitPrice, status: "PENDING" as const },
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
                          { id: uid("svc"), name: "Custom Service", qty: 1, unitPrice: 0, status: "PENDING" as const },
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
                  {(activePayload.payments ?? []).map((p, idx) => (
                    <div className="pay" key={p.id || idx}>
                      <div className="strong">{toNum(p.amount).toFixed(2)} QAR</div>
                      <div className="muted">{p.method || "—"} • {p.reference || "—"}</div>
                      <div className="muted">{p.paidAt ? new Date(p.paidAt).toLocaleString() : "—"}</div>
                      {permissions.canUpdate && (
                        <button
                          className="link danger"
                          onClick={() => {
                            const nextPayments = activePayload.payments.filter((_, i) => i !== idx);
                            const next = { ...activePayload, payments: nextPayments };
                            void saveFromDetails(next);
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  {!activePayload.payments?.length && <div className="muted">No payments recorded.</div>}
                </div>

                {permissions.canUpdate && (
                  <div className="add-payment">
                    <input
                      className="input"
                      type="number"
                      placeholder="Amount (QAR)"
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        const amount = Math.max(0, toNum((e.target as HTMLInputElement).value));
                        if (!amount) return;

                        const nextPayments = [
                          ...(activePayload.payments ?? []),
                          { id: uid("pay"), amount, method: "Cash", reference: "", paidAt: new Date().toISOString() },
                        ];
                        const next = { ...activePayload, payments: nextPayments };
                        void saveFromDetails(next);
                        (e.target as HTMLInputElement).value = "";
                      }}
                    />
                    <span className="hint">Press Enter to add quick cash payment.</span>
                  </div>
                )}
              </div>

              {/* Documents */}
              <div className="card wide">
                <div className="card-title">Documents</div>

                <div className="docs">
                  {(activePayload.documents ?? []).map((d, idx) => (
                    <a key={d.id || idx} className="doc" href={d.url} target="_blank" rel="noreferrer">
                      <div className="strong">{d.title}</div>
                      <div className="muted">{d.type || "Link"} • {new Date(d.addedAt).toLocaleDateString()}</div>
                    </a>
                  ))}
                  {!activePayload.documents?.length && <div className="muted">No documents added.</div>}
                </div>

                {permissions.canUpdate && (
                  <div className="add-doc">
                    <input
                      className="input"
                      placeholder="Document title"
                      id="docTitle"
                    />
                    <input
                      className="input"
                      placeholder="URL (https://...)"
                      id="docUrl"
                    />
                    <button
                      className="secondary"
                      onClick={() => {
                        const tEl = document.getElementById("docTitle") as HTMLInputElement | null;
                        const uEl = document.getElementById("docUrl") as HTMLInputElement | null;
                        const title = String(tEl?.value ?? "").trim();
                        const url = String(uEl?.value ?? "").trim();
                        if (!title || !url) return;

                        const nextDocs = [
                          ...(activePayload.documents ?? []),
                          { id: uid("doc"), title, url, type: "Link", addedAt: new Date().toISOString() },
                        ];
                        const next = { ...activePayload, documents: nextDocs };
                        void saveFromDetails(next);

                        if (tEl) tEl.value = "";
                        if (uEl) uEl.value = "";
                      }}
                    >
                      Add
                    </button>
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
                <button className="icon-btn" onClick={() => setWizardOpen(false)} aria-label="Close">✕</button>
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
                          const c = customers.find((x) => x.id === id);
                          setDraft((p) => ({
                            ...p,
                            customerId: id,
                            customerName: c ? `${c.name ?? ""} ${c.lastname ?? ""}`.trim() : p.customerName,
                            customerPhone: c?.phone ?? p.customerPhone,
                            customerEmail: c?.email ?? p.customerEmail,
                          }));
                        }}
                      >
                        <option value="">— Select customer —</option>
                        {customers
                          .slice()
                          .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {(c.name ?? "") + " " + (c.lastname ?? "")} • {c.phone ?? "—"}
                            </option>
                          ))}
                      </select>
                      <div className="hint">
                        If the customer isn't listed, create them in <b>Customers</b> page first.
                      </div>
                    </div>

                    <div>
                      <label>Customer name</label>
                      <input className="input" value={draft.customerName} onChange={(e) => setDraft((p) => ({ ...p, customerName: e.target.value }))} placeholder="Full name" />
                    </div>

                    <div>
                      <label>Phone</label>
                      <input className="input" value={draft.customerPhone ?? ""} onChange={(e) => setDraft((p) => ({ ...p, customerPhone: e.target.value }))} placeholder="+974 XXXXXXXX" />
                    </div>

                    <div>
                      <label>Email</label>
                      <input className="input" value={draft.customerEmail ?? ""} onChange={(e) => setDraft((p) => ({ ...p, customerEmail: e.target.value }))} placeholder="email@domain.com" />
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
                      <select className="input" value={draft.vehicleType} onChange={(e) => setDraft((p) => ({ ...p, vehicleType: e.target.value as VehicleType }))}>
                        {VEHICLE_TYPES.map((v) => (
                          <option key={v.key} value={v.key}>{v.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label>Make</label>
                      <input className="input" value={draft.vehicleMake ?? ""} onChange={(e) => setDraft((p) => ({ ...p, vehicleMake: e.target.value }))} placeholder="BMW" />
                    </div>

                    <div>
                      <label>Model</label>
                      <input className="input" value={draft.vehicleModel ?? ""} onChange={(e) => setDraft((p) => ({ ...p, vehicleModel: e.target.value }))} placeholder="X5" />
                    </div>

                    <div>
                      <label>Plate number</label>
                      <input className="input" value={draft.plateNumber ?? ""} onChange={(e) => setDraft((p) => ({ ...p, plateNumber: e.target.value }))} placeholder="123456" />
                    </div>

                    <div>
                      <label>VIN</label>
                      <input className="input" value={draft.vin ?? ""} onChange={(e) => setDraft((p) => ({ ...p, vin: e.target.value }))} placeholder="(optional)" />
                    </div>

                    <div>
                      <label>Mileage</label>
                      <input className="input" value={draft.mileage ?? ""} onChange={(e) => setDraft((p) => ({ ...p, mileage: e.target.value }))} placeholder="(optional)" />
                    </div>

                    <div>
                      <label>Color</label>
                      <input className="input" value={draft.color ?? ""} onChange={(e) => setDraft((p) => ({ ...p, color: e.target.value }))} placeholder="(optional)" />
                    </div>

                    <div>
                      <label>Notes</label>
                      <input className="input" value={draft.notes ?? ""} onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))} placeholder="(optional)" />
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
                          services: [...prev.services, { id: uid("svc"), name: "Custom Service", qty: 1, unitPrice: 0, status: "PENDING" as const }],
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
                      <div className="row"><span>Subtotal</span><b>{totalsPreview.subtotal.toFixed(2)} QAR</b></div>
                      <div className="row"><span>Discount</span><b>{totalsPreview.discount.toFixed(2)} QAR</b></div>
                      <div className="row"><span>VAT rate</span><b>{(totalsPreview.vatRate * 100).toFixed(2)}%</b></div>
                      <div className="row"><span>VAT</span><b>{totalsPreview.vatAmount.toFixed(2)} QAR</b></div>
                      <div className="row"><span>Total</span><b>{totalsPreview.totalAmount.toFixed(2)} QAR</b></div>
                      <div className="row"><span>Paid</span><b>{totalsPreview.amountPaid.toFixed(2)} QAR</b></div>
                      <div className="row"><span>Balance</span><b>{totalsPreview.balanceDue.toFixed(2)} QAR</b></div>
                      <div className="row"><span>Payment status</span><b>{totalsPreview.paymentStatus}</b></div>
                    </div>

                    <div>
                      <label>Discount (QAR)</label>
                      <input className="input" type="number" value={draft.discount} onChange={(e) => setDraft((p) => ({ ...p, discount: toNum(e.target.value) }))} />

                      <label style={{ marginTop: 10 }}>VAT rate (e.g., 0.05 for 5%)</label>
                      <input className="input" type="number" step="0.01" value={draft.vatRate} onChange={(e) => setDraft((p) => ({ ...p, vatRate: toNum(e.target.value) }))} />

                      <label style={{ marginTop: 10 }}>Order status</label>
                      <select className="input" value={draft.status} onChange={(e) => setDraft((p) => ({ ...p, status: e.target.value as OrderStatus }))}>
                        <option value="DRAFT">DRAFT</option>
                        <option value="OPEN">OPEN</option>
                        <option value="IN_PROGRESS">IN_PROGRESS</option>
                        <option value="READY">READY</option>
                        <option value="COMPLETED">COMPLETED</option>
                        <option value="CANCELLED">CANCELLED</option>
                      </select>
                    </div>
                  </div>

                  <div className="hint">
                    Tip: Payments & documents can be added in the details screen after saving the job order.
                  </div>
                </div>
              )}
            </div>

            <div className="jom-wizard-foot">
              <div className="left">
                <button className="secondary" onClick={() => setWizardOpen(false)}>Cancel</button>
              </div>

              <div className="right">
                <button className="secondary" disabled={wizardStep === 1} onClick={() => setWizardStep((s) => (s > 1 ? ((s - 1) as any) : s))}>
                  Back
                </button>

                {wizardStep < 4 ? (
                  <button className="primary" onClick={() => setWizardStep((s) => ((s + 1) as any))}>
                    Next
                  </button>
                ) : (
                  <button className="primary" disabled={draft.id ? !permissions.canUpdate : !permissions.canCreate} onClick={() => void saveDraft()}>
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
