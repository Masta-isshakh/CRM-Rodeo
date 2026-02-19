// src/pages/Vehicles.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import "./Vehicule.css";

import { getCurrentUser } from "aws-amplify/auth";
import type { Schema } from "../../amplify/data/resource";
import { getDataClient } from "../lib/amplifyClient";
import { logActivity } from "../utils/activityLogger";

type Permission = {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
};

type VehicleRow = Schema["Vehicle"]["type"];
type CustomerRow = Schema["Customer"]["type"];
type JobOrderRow = Schema["JobOrder"]["type"];

type VehicleForm = {
  customerId: string;
  vehicleId: string; // "VEH-2026-12345"
  make: string;
  model: string;
  year: string;
  vehicleType: string;
  color: string;
  plateNumber: string;
  vin: string;
  notes: string;
};

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, query: string) {
  if (!query?.trim()) return text;

  const terms = query
    .toLowerCase()
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!terms.length) return text;

  const safe = escapeRegExp(terms.join("|"));
  const re = new RegExp(`(${safe})`, "ig");

  const parts = String(text ?? "").split(re);
  return parts.map((p, idx) =>
    re.test(p) ? (
      <mark key={idx} className="search-highlight">
        {p}
      </mark>
    ) : (
      <span key={idx}>{p}</span>
    )
  );
}

export default function Vehicles({ permissions }: { permissions: Permission }) {
  const client = getDataClient();

  const [loading, setLoading] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [deleteVehicle, setDeleteVehicle] = useState<VehicleRow | null>(null);

  const [selectedVehicle, setSelectedVehicle] = useState<VehicleRow | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [completedOrders, setCompletedOrders] = useState<JobOrderRow[]>([]);

  const [verifiedCustomer, setVerifiedCustomer] = useState<CustomerRow | null>(null);

  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<VehicleForm>({
    customerId: "",
    vehicleId: "",
    make: "",
    model: "",
    year: "",
    vehicleType: "",
    color: "",
    plateNumber: "",
    vin: "",
    notes: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const loadVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.models.Vehicle.list({ limit: 2000 });
      setVehicles(res.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  // Close dropdown on outside click
  useEffect(() => {
    const handle = (event: MouseEvent) => {
      const t = event.target as HTMLElement;
      const isBtn = t.closest(".btn-action-dropdown");
      const isMenu = t.closest(".action-dropdown-menu");
      if (!isBtn && !isMenu) setActiveDropdown(null);
    };
    if (activeDropdown) {
      document.addEventListener("mousedown", handle);
      return () => document.removeEventListener("mousedown", handle);
    }
  }, [activeDropdown]);

  const generateVehicleId = () => {
    const y = new Date().getFullYear();
    const rand = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
    return `VEH-${y}-${rand}`;
  };

  const validate = (isEdit: boolean) => {
    const next: Record<string, string> = {};

    if (!form.customerId.trim()) next.customerId = "Customer ID required";
    if (!isEdit && !form.vehicleId.trim()) next.vehicleId = "Vehicle ID required";

    if (!form.make.trim()) next.make = "Make required";
    if (!form.model.trim()) next.model = "Model required";

    // Your schema allows these optional, but your UI wants them required:
    if (!form.year.trim()) next.year = "Year required";
    if (!form.vehicleType.trim()) next.vehicleType = "Vehicle type required";
    if (!form.color.trim()) next.color = "Color required";

    if (!form.plateNumber.trim()) next.plateNumber = "Plate number required";

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const resetForm = () => {
    setErrors({});
    setVerifiedCustomer(null);
    setForm({
      customerId: "",
      vehicleId: "",
      make: "",
      model: "",
      year: "",
      vehicleType: "",
      color: "",
      plateNumber: "",
      vin: "",
      notes: "",
    });
  };

  const verifyCustomer = async (customerId: string) => {
    const id = customerId.trim();
    if (!id) {
      setVerifiedCustomer(null);
      alert("Please enter a Customer ID");
      return;
    }

    const res = await client.models.Customer.get({ id });
    if (!res.data) {
      setVerifiedCustomer(null);
      alert("Customer not found");
      return;
    }

    setVerifiedCustomer(res.data);
    alert(`Customer verified: ${res.data.name} ${res.data.lastname}`);
  };

  const openAdd = () => {
    if (!permissions.canCreate) return;
    resetForm();
    setForm((p) => ({ ...p, vehicleId: generateVehicleId() }));
    setShowAdd(true);
  };

  const openEdit = async (row: VehicleRow) => {
    if (!permissions.canUpdate) return;
    resetForm();

    setForm({
      customerId: row.customerId ?? "",
      vehicleId: row.vehicleId ?? "",
      make: row.make ?? "",
      model: row.model ?? "",
      year: row.year ?? "",
      vehicleType: row.vehicleType ?? "",
      color: row.color ?? "",
      plateNumber: row.plateNumber ?? "",
      vin: row.vin ?? "",
      notes: row.notes ?? "",
    });

    if (row.customerId) {
      const c = await client.models.Customer.get({ id: row.customerId });
      setVerifiedCustomer(c.data ?? null);
    }

    setSelectedVehicle(row);
    setShowEdit(true);
  };

  const openDetails = async (row: VehicleRow) => {
    setSelectedVehicle(row);

    // load customer
    if (row.customerId) {
      const c = await client.models.Customer.get({ id: row.customerId });
      setSelectedCustomer(c.data ?? null);
    } else {
      setSelectedCustomer(null);
    }

    // load completed orders (matched by plate number)
    if (row.plateNumber) {
      const ordersRes = await client.models.JobOrder.list({
        limit: 2000,
        filter: {
          plateNumber: { eq: row.plateNumber },
          status: { eq: "COMPLETED" },
        },
      });
      setCompletedOrders(ordersRes.data ?? []);
    } else {
      setCompletedOrders([]);
    }
  };

  const createVehicle = async () => {
    if (!permissions.canCreate || saving) return;
    if (!validate(false)) return;

    if (!verifiedCustomer || verifiedCustomer.id !== form.customerId.trim()) {
      alert("Please verify customer before saving");
      return;
    }

    setSaving(true);
    try {
      const u = await getCurrentUser();
      const createdBy = (u.signInDetails?.loginId || u.username || "").toLowerCase();

      const ownerName = `${verifiedCustomer.name} ${verifiedCustomer.lastname}`.trim();

      const res = await client.models.Vehicle.create({
        customerId: form.customerId.trim(),
        vehicleId: form.vehicleId.trim(),
        ownedBy: ownerName,
        make: form.make.trim(),
        model: form.model.trim(),
        year: form.year.trim(),
        vehicleType: form.vehicleType.trim(),
        color: form.color.trim(),
        plateNumber: form.plateNumber.trim(),
        vin: form.vin.trim() || undefined,
        notes: form.notes.trim() || undefined,
        completedServicesCount: 0,
        createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const created = res.data;
      if (!created) throw new Error("Create failed: no data returned");

      // ✅ NO MORE RED UNDERLINE (because logger accepts "Vehicle")
      await logActivity("Vehicle", created.id, "CREATE", `Vehicle ${created.vehicleId} created`);

      setShowAdd(false);
      resetForm();
      await loadVehicles();
      alert("Vehicle created successfully");
    } catch (e) {
      console.error(e);
      alert("Create failed");
    } finally {
      setSaving(false);
    }
  };

  const updateVehicle = async () => {
    if (!permissions.canUpdate || saving) return;
    if (!selectedVehicle) return;
    if (!validate(true)) return;

    if (!verifiedCustomer || verifiedCustomer.id !== form.customerId.trim()) {
      alert("Please verify customer before saving");
      return;
    }

    setSaving(true);
    try {
      const ownerName = `${verifiedCustomer.name} ${verifiedCustomer.lastname}`.trim();

      await client.models.Vehicle.update({
        id: selectedVehicle.id,
        customerId: form.customerId.trim(),
        ownedBy: ownerName,
        make: form.make.trim(),
        model: form.model.trim(),
        year: form.year.trim(),
        vehicleType: form.vehicleType.trim(),
        color: form.color.trim(),
        plateNumber: form.plateNumber.trim(),
        vin: form.vin.trim() || undefined,
        notes: form.notes.trim() || undefined,
        updatedAt: new Date().toISOString(),
      });

      // ✅ NO MORE RED UNDERLINE
      await logActivity("Vehicle", selectedVehicle.id, "UPDATE", `Vehicle ${form.vehicleId} updated`);

      setShowEdit(false);
      resetForm();
      setSelectedVehicle(null);
      await loadVehicles();
      alert("Vehicle updated successfully");
    } catch (e) {
      console.error(e);
      alert("Update failed");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!permissions.canDelete || saving) return;
    if (!deleteVehicle) return;

    const toDelete = deleteVehicle;

    setSaving(true);
    try {
      await client.models.Vehicle.delete({ id: toDelete.id });

      // ✅ NO MORE RED UNDERLINE
      await logActivity("Vehicle", toDelete.id, "DELETE", `Vehicle ${toDelete.vehicleId} deleted`);

      setDeleteVehicle(null);
      setSelectedVehicle(null);
      setSelectedCustomer(null);
      setCompletedOrders([]);
      await loadVehicles();
      alert("Vehicle deleted successfully");
    } catch (e) {
      console.error(e);
      alert("Delete failed");
    } finally {
      setSaving(false);
    }
  };

  // SEARCH + PAGINATION
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return vehicles;

    const terms = searchQuery.toLowerCase().split(" ").filter(Boolean);
    return vehicles.filter((v) => {
      const hay = [
        v.vehicleId,
        v.ownedBy,
        v.make,
        v.model,
        v.year,
        v.color,
        v.plateNumber,
        v.vin,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return terms.every((t) => hay.includes(t));
    });
  }, [vehicles, searchQuery]);

  //const totalPages = Math.ceil(searchResults.length / pageSize);
  const paginated = searchResults.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => setCurrentPage(1), [searchQuery, pageSize]);

  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to Vehicles.</div>;
  }

  return (
    <>
      <div className={`vehicle-main-screen ${selectedVehicle ? "hidden" : ""}`}>
        <header className="vehicle-header">
          <div className="header-left">
            <h1>
              <i className="fas fa-car"></i> Vehicle Management
            </h1>
          </div>
        </header>

        <main className="vehicle-content">
          <section className="search-section">
            <div className="search-container">
              <i className="fas fa-search search-icon"></i>
              <input
                type="text"
                className="smart-search-input"
                placeholder="Search by any vehicle details"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="search-stats">
              {loading
                ? "Loading..."
                : searchResults.length === 0
                ? "No vehicles found"
                : `Showing ${Math.min((currentPage - 1) * pageSize + 1, searchResults.length)}-${Math.min(
                    currentPage * pageSize,
                    searchResults.length
                  )} of ${searchResults.length} vehicles`}
            </div>
          </section>

          <section className="results-section">
            <div className="section-header">
              <h2>
                <i className="fas fa-list"></i> Vehicle Records
              </h2>

              <div className="pagination-controls">
                <div className="records-per-page">
                  <label htmlFor="pageSizeSelect">Records per page:</label>
                  <select
                    id="pageSizeSelect"
                    className="page-size-select"
                    value={pageSize}
                    onChange={(e) => setPageSize(parseInt(e.target.value))}
                  >
                    <option value="20">20</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </div>

                {permissions.canCreate && (
                  <button className="btn-new-vehicle" onClick={openAdd}>
                    <i className="fas fa-plus-circle"></i> Add New Vehicle
                  </button>
                )}
              </div>
            </div>

            <div className="table-wrapper">
              <table className="vehicle-table">
                <thead>
                  <tr>
                    <th>Vehicle ID</th>
                    <th>Owned by</th>
                    <th>Make</th>
                    <th>Model</th>
                    <th>Year</th>
                    <th>Color</th>
                    <th>Plate Number</th>
                    <th>Completed Services</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {paginated.map((v) => (
                    <tr key={v.id}>
                      <td>{highlightText(v.vehicleId ?? "—", searchQuery)}</td>
                      <td>{highlightText(v.ownedBy ?? "—", searchQuery)}</td>
                      <td>{highlightText(v.make ?? "—", searchQuery)}</td>
                      <td>{highlightText(v.model ?? "—", searchQuery)}</td>
                      <td>{highlightText(v.year ?? "—", searchQuery)}</td>
                      <td>{highlightText(v.color ?? "—", searchQuery)}</td>
                      <td>{highlightText(v.plateNumber ?? "—", searchQuery)}</td>
                      <td>{v.completedServicesCount ?? 0}</td>
                      <td>
                        <div className="action-dropdown-container">
                          <button
                            className={`btn-action-dropdown ${activeDropdown === v.id ? "active" : ""}`}
                            onClick={(e) => {
                              const isActive = activeDropdown === v.id;
                              if (isActive) return setActiveDropdown(null);

                              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                              const menuHeight = 180;
                              const menuWidth = 200;
                              const spaceBelow = window.innerHeight - rect.bottom;

                              const top = spaceBelow < menuHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
                              const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));

                              setDropdownPosition({ top, left });
                              setActiveDropdown(v.id);
                            }}
                          >
                            <i className="fas fa-cogs"></i> Actions <i className="fas fa-chevron-down"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {activeDropdown &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  className="action-dropdown-menu show action-dropdown-menu-fixed"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  style={{ top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` }}
                >
                  <button
                    className="dropdown-item view"
                    onClick={() => {
                      const row = vehicles.find((x) => x.id === activeDropdown);
                      if (row) openDetails(row);
                      setActiveDropdown(null);
                    }}
                  >
                    <i className="fas fa-eye"></i> View Details
                  </button>

                  {permissions.canUpdate && (
                    <>
                      <div className="dropdown-divider"></div>
                      <button
                        className="dropdown-item edit"
                        onClick={() => {
                          const row = vehicles.find((x) => x.id === activeDropdown);
                          if (row) openEdit(row);
                          setActiveDropdown(null);
                        }}
                      >
                        <i className="fas fa-edit"></i> Edit Vehicle
                      </button>
                    </>
                  )}

                  {permissions.canDelete && (
                    <>
                      <div className="dropdown-divider"></div>
                      <button
                        className="dropdown-item delete"
                        onClick={() => {
                          const row = vehicles.find((x) => x.id === activeDropdown);
                          if (row) setDeleteVehicle(row);
                          setActiveDropdown(null);
                        }}
                      >
                        <i className="fas fa-trash"></i> Delete Vehicle
                      </button>
                    </>
                  )}
                </div>,
                document.body
              )}
          </section>
        </main>

        <footer className="vehicle-footer">
          <p>Service Management System © {new Date().getFullYear()} | Vehicle Management Module</p>
        </footer>
      </div>

      {/* DETAILS */}
      {selectedVehicle && (
        <div className="pim-details-screen">
          <div className="pim-details-header">
            <div className="pim-details-title-container">
              <h2>
                <i className="fas fa-car"></i> Vehicle Details - <span>{selectedVehicle.vehicleId}</span>
              </h2>
            </div>

            <button
              className="pim-btn-close-details"
              onClick={() => {
                setSelectedVehicle(null);
                setSelectedCustomer(null);
                setCompletedOrders([]);
              }}
            >
              <i className="fas fa-times"></i> Close Details
            </button>
          </div>

          <div className="pim-details-body">
            <div className="pim-details-grid">
              <div className="pim-detail-card">
                <div className="details-card-header">
                  <h3>
                    <i className="fas fa-user"></i> Customer Information
                  </h3>
                </div>
                <div className="pim-card-content">
                  <div className="pim-info-item">
                    <span className="pim-info-label">Customer ID</span>
                    <span className="pim-info-value">{selectedVehicle.customerId ?? "—"}</span>
                  </div>
                  <div className="pim-info-item">
                    <span className="pim-info-label">Customer Name</span>
                    <span className="pim-info-value">
                      {selectedCustomer ? `${selectedCustomer.name} ${selectedCustomer.lastname}` : selectedVehicle.ownedBy ?? "—"}
                    </span>
                  </div>
                  <div className="pim-info-item">
                    <span className="pim-info-label">Phone</span>
                    <span className="pim-info-value">{selectedCustomer?.phone ?? "Not provided"}</span>
                  </div>
                  <div className="pim-info-item">
                    <span className="pim-info-label">Email</span>
                    <span className="pim-info-value">{selectedCustomer?.email ?? "Not provided"}</span>
                  </div>
                </div>
              </div>

              <div className="pim-detail-card">
                <div className="details-card-header">
                  <h3>
                    <i className="fas fa-car"></i> Vehicle Information
                  </h3>
                </div>
                <div className="pim-card-content">
                  <div className="pim-info-item">
                    <span className="pim-info-label">Make</span>
                    <span className="pim-info-value">{selectedVehicle.make ?? "—"}</span>
                  </div>
                  <div className="pim-info-item">
                    <span className="pim-info-label">Model</span>
                    <span className="pim-info-value">{selectedVehicle.model ?? "—"}</span>
                  </div>
                  <div className="pim-info-item">
                    <span className="pim-info-label">Plate</span>
                    <span className="pim-info-value">{selectedVehicle.plateNumber ?? "—"}</span>
                  </div>
                  <div className="pim-info-item">
                    <span className="pim-info-label">VIN</span>
                    <span className="pim-info-value">{selectedVehicle.vin ?? "N/A"}</span>
                  </div>
                </div>
              </div>

              <div className="pim-detail-card">
                <div className="details-card-header">
                  <h3>
                    <i className="fas fa-tasks"></i> Completed Orders (by plate number)
                  </h3>
                </div>

                <div className="table-wrapper details-table-wrapper">
                  <table className="vehicles-table">
                    <thead>
                      <tr>
                        <th>Order #</th>
                        <th>Status</th>
                        <th>Payment</th>
                        <th>Total</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {completedOrders.length ? (
                        completedOrders.map((o) => (
                          <tr key={o.id}>
                            <td>{o.orderNumber ?? o.id}</td>
                            <td>{o.status ?? "—"}</td>
                            <td>{o.paymentStatus ?? "—"}</td>
                            <td>{typeof o.totalAmount === "number" ? `QAR ${o.totalAmount.toFixed(2)}` : "—"}</td>
                            <td>{o.updatedAt ? new Date(o.updatedAt).toLocaleString() : "—"}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} style={{ textAlign: "center", padding: 30, opacity: 0.8 }}>
                            No completed orders found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* quick actions */}
              <div style={{ display: "flex", gap: 10, padding: 10 }}>
                {permissions.canUpdate && (
                  <button className="btn-new-vehicle" onClick={() => openEdit(selectedVehicle)}>
                    <i className="fas fa-edit"></i> Edit
                  </button>
                )}
                {permissions.canDelete && (
                  <button className="btn-confirm-delete" onClick={() => setDeleteVehicle(selectedVehicle)}>
                    <i className="fas fa-trash"></i> Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADD MODAL */}
      {showAdd &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="edit-modal-overlay" onClick={() => setShowAdd(false)}>
            <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
              <div className="edit-modal-header">
                <h3>
                  <i className="fas fa-plus-circle"></i> Add New Vehicle
                </h3>
                <button className="btn-close-modal" onClick={() => setShowAdd(false)}>
                  <i className="fas fa-times"></i>
                </button>
              </div>

              <div className="edit-modal-body">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    createVehicle();
                  }}
                >
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Customer ID *</label>
                      <div className="customer-verify-section">
                        <div className="form-group">
                          <input
                            className="form-input"
                            value={form.customerId}
                            onChange={(e) => setForm((p) => ({ ...p, customerId: e.target.value }))}
                          />
                        </div>
                        <button type="button" className="btn-verify" onClick={() => verifyCustomer(form.customerId)}>
                          <i className="fas fa-check-circle"></i> Verify
                        </button>
                      </div>
                      {errors.customerId && <div className="error-message show">{errors.customerId}</div>}
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Vehicle ID</label>
                      <input className="form-input" value={form.vehicleId} disabled />
                      {errors.vehicleId && <div className="error-message show">{errors.vehicleId}</div>}
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Make *</label>
                      <input
                        className="form-input"
                        value={form.make}
                        onChange={(e) => setForm((p) => ({ ...p, make: e.target.value }))}
                        disabled={!verifiedCustomer}
                      />
                      {errors.make && <div className="error-message show">{errors.make}</div>}
                    </div>
                    <div className="form-group">
                      <label className="form-label">Model *</label>
                      <input
                        className="form-input"
                        value={form.model}
                        onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
                        disabled={!verifiedCustomer}
                      />
                      {errors.model && <div className="error-message show">{errors.model}</div>}
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Year *</label>
                      <input
                        className="form-input"
                        value={form.year}
                        onChange={(e) => setForm((p) => ({ ...p, year: e.target.value }))}
                        disabled={!verifiedCustomer}
                      />
                      {errors.year && <div className="error-message show">{errors.year}</div>}
                    </div>
                    <div className="form-group">
                      <label className="form-label">Vehicle Type *</label>
                      <input
                        className="form-input"
                        value={form.vehicleType}
                        onChange={(e) => setForm((p) => ({ ...p, vehicleType: e.target.value }))}
                        disabled={!verifiedCustomer}
                      />
                      {errors.vehicleType && <div className="error-message show">{errors.vehicleType}</div>}
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Color *</label>
                      <input
                        className="form-input"
                        value={form.color}
                        onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                        disabled={!verifiedCustomer}
                      />
                      {errors.color && <div className="error-message show">{errors.color}</div>}
                    </div>
                    <div className="form-group">
                      <label className="form-label">Plate Number *</label>
                      <input
                        className="form-input"
                        value={form.plateNumber}
                        onChange={(e) => setForm((p) => ({ ...p, plateNumber: e.target.value }))}
                        disabled={!verifiedCustomer}
                      />
                      {errors.plateNumber && <div className="error-message show">{errors.plateNumber}</div>}
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">VIN</label>
                      <input
                        className="form-input"
                        value={form.vin}
                        onChange={(e) => setForm((p) => ({ ...p, vin: e.target.value }))}
                        disabled={!verifiedCustomer}
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Notes</label>
                      <input
                        className="form-input"
                        value={form.notes}
                        onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                        disabled={!verifiedCustomer}
                      />
                    </div>
                  </div>

                  <div className="form-actions">
                    <button type="submit" className="btn-save" disabled={saving || !verifiedCustomer}>
                      <i className="fas fa-save"></i> {saving ? "Saving..." : "Add Vehicle"}
                    </button>
                    <button type="button" className="btn-cancel" onClick={() => setShowAdd(false)} disabled={saving}>
                      <i className="fas fa-times"></i> Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* EDIT MODAL */}
      {showEdit &&
        selectedVehicle &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="edit-modal-overlay" onClick={() => setShowEdit(false)}>
            <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
              <div className="edit-modal-header">
                <h3>
                  <i className="fas fa-edit"></i> Edit Vehicle
                </h3>
                <button className="btn-close-modal" onClick={() => setShowEdit(false)}>
                  <i className="fas fa-times"></i>
                </button>
              </div>

              <div className="edit-modal-body">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    updateVehicle();
                  }}
                >
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Customer ID *</label>
                      <div className="customer-verify-section">
                        <div className="form-group">
                          <input
                            className="form-input"
                            value={form.customerId}
                            onChange={(e) => setForm((p) => ({ ...p, customerId: e.target.value }))}
                          />
                        </div>
                        <button type="button" className="btn-verify" onClick={() => verifyCustomer(form.customerId)}>
                          <i className="fas fa-check-circle"></i> Verify
                        </button>
                      </div>
                      {errors.customerId && <div className="error-message show">{errors.customerId}</div>}
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Vehicle ID</label>
                      <input className="form-input" value={form.vehicleId} disabled />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Color *</label>
                      <input className="form-input" value={form.color} onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))} />
                      {errors.color && <div className="error-message show">{errors.color}</div>}
                    </div>
                    <div className="form-group">
                      <label className="form-label">Plate Number *</label>
                      <input
                        className="form-input"
                        value={form.plateNumber}
                        onChange={(e) => setForm((p) => ({ ...p, plateNumber: e.target.value }))}
                      />
                      {errors.plateNumber && <div className="error-message show">{errors.plateNumber}</div>}
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">VIN</label>
                      <input className="form-input" value={form.vin} onChange={(e) => setForm((p) => ({ ...p, vin: e.target.value }))} />
                    </div>
                  </div>

                  <div className="form-actions">
                    <button type="submit" className="btn-save" disabled={saving}>
                      <i className="fas fa-save"></i> {saving ? "Saving..." : "Save Changes"}
                    </button>
                    <button type="button" className="btn-cancel" onClick={() => setShowEdit(false)} disabled={saving}>
                      <i className="fas fa-times"></i> Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* DELETE */}
      {deleteVehicle &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="delete-modal-overlay" onClick={() => setDeleteVehicle(null)}>
            <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
              <div className="delete-modal-header">
                <h3>
                  <i className="fas fa-exclamation-triangle"></i> Confirm Deletion
                </h3>
              </div>
              <div className="delete-modal-body">
                <div className="delete-warning">
                  <i className="fas fa-exclamation-circle"></i>
                  <div className="delete-warning-text">
                    <p>
                      You are about to delete vehicle <strong>{deleteVehicle.vehicleId}</strong>.
                    </p>
                    <p>This action cannot be undone.</p>
                  </div>
                </div>

                <div className="delete-modal-actions">
                  <button className="btn-confirm-delete" onClick={confirmDelete} disabled={saving}>
                    <i className="fas fa-trash"></i> Delete Vehicle
                  </button>
                  <button className="btn-cancel" onClick={() => setDeleteVehicle(null)} disabled={saving}>
                    <i className="fas fa-times"></i> Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
