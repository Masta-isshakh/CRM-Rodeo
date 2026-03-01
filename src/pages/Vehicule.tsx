// src/pages/VehicleManagement.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import "./Vehicule.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";
import { getCurrentUser } from "aws-amplify/auth";
import { resolveActorUsername } from "../utils/actorIdentity";
import { logActivity } from "../utils/activityLogger";
import type { ReactNode } from "react";

const client = generateClient<Schema>();

type VehicleRow = Schema["Vehicle"]["type"];
type CustomerRow = Schema["Customer"]["type"];
type JobOrderRow = Schema["JobOrder"]["type"];

type VehicleForm = {
  customerId: string;
  vehicleId: string;
  make: string;
  model: string;
  year: string;
  vehicleType: string;
  color: string;
  plateNumber: string;
  vin: string;
  notes: string;
};

type AlertType = "info" | "success" | "warning" | "error";

type AlertState = {
  isOpen: boolean;
  title: string;
  message: string;
  type: AlertType;
  showCancel: boolean;
  onClose?: () => void;
  onConfirm?: () => void;
};

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, query: string) {
  const q = query?.trim();
  if (!q) return text;
  if (q.startsWith("!") || q.includes(":")) return text;

  const terms = q
    .toLowerCase()
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!terms.length) return text;

  const safe = escapeRegExp(terms.join("|"));
  const splitRe = new RegExp(`(${safe})`, "ig");
  const isHitRe = new RegExp(`^(${safe})$`, "i");

  const parts = String(text ?? "").split(splitRe);
  return parts.map((p, idx) =>
    isHitRe.test(p) ? (
      <mark key={idx} className="search-highlight">
        {p}
      </mark>
    ) : (
      <span key={idx}>{p}</span>
    )
  );
}

function resolveVehicleIdRaw(source: any): string {
  return String(
    source?.vehicleDetails?.vehicleId ??
      source?.vehicleDetails?.id ??
      source?.vehicleId ??
      ""
  ).trim();
}

function resolveVehicleIdDisplay(source: any): string {
  return resolveVehicleIdRaw(source) || "—";
}

// ----------------------
// Alert Popup Component
// ----------------------
function AlertPopup(props: AlertState) {
  const { isOpen, title, message, type, onClose, showCancel, onConfirm } = props;
  if (!isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case "success":
        return "fas fa-check-circle";
      case "error":
        return "fas fa-exclamation-circle";
      case "warning":
        return "fas fa-exclamation-triangle";
      default:
        return "fas fa-info-circle";
    }
  };

  return (
    <div className="alert-popup-overlay show" role="dialog" aria-modal="true">
      <div className={`alert-popup alert-${type}`}>
        <div className="alert-popup-header">
          <div className="alert-popup-title">
            <i className={getIcon()}></i>
            <span>{title}</span>
          </div>
        </div>
        <div className="alert-popup-body">
          <div className="alert-popup-message">{message}</div>
        </div>
        <div className="alert-popup-footer">
          {!showCancel ? (
            <button className="alert-popup-btn ok" onClick={onClose}>
              OK
            </button>
          ) : (
            <>
              <button className="alert-popup-btn cancel" onClick={onClose}>
                Cancel
              </button>
              <button className="alert-popup-btn confirm" onClick={onConfirm}>
                Confirm
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------
// Modal Component
// ----------------------
function Modal(props: {
  isOpen: boolean;
  title: string;
  icon: string;
  children: ReactNode;
  onClose: () => void;
  onSave: () => void;
  isEdit?: boolean;
  saving?: boolean;
  saveLabel?: string;
  className?: string;
}) {
  const { isOpen, title, icon, children, onClose, onSave, isEdit = false, saving = false, saveLabel, className } = props;

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="modal-overlay show">
      <div className={`modal ${className || ""}`.trim()} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <i className={icon}></i> {title}
          </h3>
          <button className="btn-close-modal" onClick={onClose} aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="modal-body">{children}</div>

        <div className="modal-footer">
          <button className="btn-save" onClick={onSave} disabled={saving}>
            <i className="fas fa-save"></i>{" "}
            {saving ? "Saving..." : saveLabel ? saveLabel : isEdit ? "Save Changes" : "Add Vehicle"}
          </button>
          <button className="btn-cancel" onClick={onClose} disabled={saving}>
            <i className="fas fa-times"></i> Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ----------------------
// Form Field Component
// ----------------------
function FormField(props: {
  label: string;
  id: string;
  type?: string;
  value: string | number;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  options?: Array<string | { value: string; label: string }>;
  hint?: string;
}) {
  const {
    label,
    id,
    type = "text",
    value,
    onChange,
    error,
    placeholder,
    required = false,
    disabled = false,
    options,
    hint,
  } = props;

  const isSelect = type === "select";

  return (
    <div className="form-group">
      <label htmlFor={id}>
        {label}
        {required ? <span className="required">*</span> : <span className="form-optional">(optional)</span>}
      </label>

      {isSelect ? (
        <select
          id={id}
          className={`form-control ${error ? "error" : ""}`}
          value={String(value)}
          onChange={onChange}
          disabled={disabled}
          required={required}
        >
          {options?.map((opt) => {
            const v = typeof opt === "string" ? opt : opt.value;
            const l = typeof opt === "string" ? opt : opt.label;
            return (
              <option key={v} value={v}>
                {l}
              </option>
            );
          })}
        </select>
      ) : (
        <input
          type={type}
          id={id}
          className={`form-control ${error ? "error" : ""}`}
          value={String(value)}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
        />
      )}

      {hint && <div className="field-hint">{hint}</div>}
      {error && <div className="error-message show">{error}</div>}
    </div>
  );
}

// ----------------------
// Vehicles Table
// ----------------------
function VehiclesTable(props: {
  data: VehicleRow[];
  searchQuery: string;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const { data, searchQuery, onView, onEdit, onDelete, canUpdate, canDelete } = props;

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const t = event.target as HTMLElement;
      const isDropdownButton = t.closest(".btn-action-dropdown");
      const isDropdownMenu = t.closest(".action-dropdown-menu");
      if (!isDropdownButton && !isDropdownMenu) setActiveDropdown(null);
    };

    if (activeDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [activeDropdown]);

  if (data.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <i className="fas fa-search"></i>
        </div>
        <div className="empty-text">No matching vehicles found</div>
        <div className="empty-subtext">Try adjusting your search terms or clear the search to see all records</div>
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table className="customers-table">
        <thead>
          <tr>
            <th>Vehicle ID</th>
            <th>Owned By</th>
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
          {data.map((v) => (
            <tr key={v.id}>
              <td>{highlightText(resolveVehicleIdDisplay(v), searchQuery)}</td>
              <td>{highlightText(v.ownedBy ?? "—", searchQuery)}</td>
              <td>{highlightText(v.make ?? "—", searchQuery)}</td>
              <td>{highlightText(v.model ?? "—", searchQuery)}</td>
              <td>{highlightText(v.year ?? "—", searchQuery)}</td>
              <td>{highlightText(v.color ?? "—", searchQuery)}</td>
              <td>{highlightText(v.plateNumber ?? "—", searchQuery)}</td>
              <td>
                <span className="count-badge">{(v.completedServicesCount ?? 0).toString()} services</span>
              </td>

              <td>
                <div className="action-dropdown-container">
                  <button
                    className={`btn-action-dropdown ${activeDropdown === v.id ? "active" : ""}`}
                    onClick={(e) => {
                      const isActive = activeDropdown === v.id;
                      if (isActive) {
                        setActiveDropdown(null);
                        return;
                      }
                      const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                      const menuHeight = 160;
                      const menuWidth = 210;
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

      {activeDropdown &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="action-dropdown-menu show action-dropdown-menu-fixed"
            style={{ top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="dropdown-item view"
              onClick={() => {
                onView(activeDropdown);
                setActiveDropdown(null);
              }}
            >
              <i className="fas fa-eye"></i> View Details
            </button>

            {(canUpdate || canDelete) && <div className="dropdown-divider"></div>}

            {canUpdate && (
              <>
                <button
                  className="dropdown-item edit"
                  onClick={() => {
                    onEdit(activeDropdown);
                    setActiveDropdown(null);
                  }}
                >
                  <i className="fas fa-edit"></i> Edit Vehicle
                </button>
                {canDelete && <div className="dropdown-divider"></div>}
              </>
            )}

            {canDelete && (
              <button
                className="dropdown-item delete"
                onClick={() => {
                  onDelete(activeDropdown);
                  setActiveDropdown(null);
                }}
              >
                <i className="fas fa-trash"></i> Delete Vehicle
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

// ----------------------
// Page
// ----------------------
type VehiclePageProps = PageProps & {
  navigationData?: any;
  onClearNavigation?: () => void;
  onNavigate?: (moduleName: string, payload?: any) => void;
  onNavigateBack?: (source: string, returnToCustomerId?: string | null) => void;
};

export default function VehicleManagement({
  permissions,
  navigationData,
  onClearNavigation,
  onNavigate,
  onNavigateBack,
}: VehiclePageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [viewMode, setViewMode] = useState<"list" | "details">("list");
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleRow | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [completedOrders, setCompletedOrders] = useState<JobOrderRow[]>([]);

  // modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleteVehicle, setDeleteVehicle] = useState<VehicleRow | null>(null);
  const [saving, setSaving] = useState(false);

  // verification
  const [verifiedCustomer, setVerifiedCustomer] = useState<CustomerRow | null>(null);

  // forms/errors
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

  // alert
  const [alert, setAlert] = useState<AlertState>({
    isOpen: false,
    title: "",
    message: "",
    type: "info",
    showCancel: false,
  });

  const showAlert = useCallback((title: string, message: string, type: AlertType = "info", showCancel = false) => {
    return new Promise<boolean>((resolve) => {
      setAlert({
        isOpen: true,
        title,
        message,
        type,
        showCancel,
        onClose: () => {
          setAlert((p) => ({ ...p, isOpen: false }));
          resolve(false);
        },
        onConfirm: () => {
          setAlert((p) => ({ ...p, isOpen: false }));
          resolve(true);
        },
      });
    });
  }, []);

  const loadVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.models.Vehicle.list({ limit: 2000 });
      setVehicles(res.data ?? []);
    } catch (e) {
      console.error(e);
      await showAlert("Error", "Failed to load vehicles. Check console.", "error");
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  // Optional navigation hook
  useEffect(() => {
    if (navigationData?.openDetails && navigationData?.vehicleId) {
      (async () => {
        try {
          const res = await client.models.Vehicle.list({
            limit: 1,
            filter: { vehicleId: { eq: navigationData.vehicleId } },
          });
          const found = res.data?.[0];
          if (found) {
            setSelectedVehicleId(found.id);
            setViewMode("details");
          }
        } catch (e) {
          console.error(e);
        } finally {
          onClearNavigation?.();
        }
      })();
    }
  }, [navigationData, onClearNavigation]);

  const performSmartSearch = useCallback(
    (query: string) => {
      if (!query.trim()) return vehicles;
      const terms = query.toLowerCase().split(" ").filter(Boolean);

      return vehicles.filter((v) => {
        const hay = [
          resolveVehicleIdRaw(v),
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
    },
    [vehicles]
  );

  const searchResults = useMemo(() => performSmartSearch(searchQuery), [performSmartSearch, searchQuery]);

  const totalPages = Math.ceil(searchResults.length / pageSize) || 1;
  const paginatedData = searchResults.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pageSize]);

  const resetForm = () => {
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
    setErrors({});
    setVerifiedCustomer(null);
  };

  const generateVehicleId = () => {
    const year = new Date().getFullYear();
    const rand = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
    return `VEH-${year}-${rand}`;
  };

  // ✅ Verify helper (used by button + autosave)
  const ensureVerifiedCustomer = useCallback(
    async (customerId: string): Promise<CustomerRow | null> => {
      const id = customerId.trim();
      if (!id) return null;

      // if already verified and matches -> return it
      if (verifiedCustomer?.id === id) return verifiedCustomer;

      try {
        const res = await client.models.Customer.get({ id });
        if (!res.data) return null;
        setVerifiedCustomer(res.data);
        return res.data;
      } catch (e) {
        console.error(e);
        return null;
      }
    },
    [verifiedCustomer]
  );

  const verifyCustomer = async (customerId: string) => {
    if (!customerId.trim()) {
      setVerifiedCustomer(null);
      await showAlert("Missing", "Please enter a Customer ID.", "warning");
      return;
    }
    const c = await ensureVerifiedCustomer(customerId);
    if (!c) {
      setVerifiedCustomer(null);
      await showAlert("Not Found", "Customer not found. Please use a valid Customer ID.", "error");
      return;
    }
    await showAlert("Verified", `Customer verified: ${c.name} ${c.lastname}`, "success");
  };

  const validateVehicleForm = (isEdit: boolean) => {
    const next: Record<string, string> = {};

    if (!form.customerId.trim()) next.customerId = "Customer ID required";
    if (!form.make.trim()) next.make = "Make required";
    if (!form.model.trim()) next.model = "Model required";
    if (!form.year.trim()) next.year = "Year required";
    if (!form.vehicleType.trim()) next.vehicleType = "Type required";
    if (!form.color.trim()) next.color = "Color required";
    if (!form.plateNumber.trim()) next.plateNumber = "Plate number required";

    if (!isEdit && !form.vehicleId.trim()) next.vehicleId = "Vehicle ID required";

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const openAddModal = () => {
    if (!permissions.canCreate) return;
    resetForm();
    setForm((p) => ({ ...p, vehicleId: generateVehicleId() }));
    setShowAddModal(true);
  };

  const openEditModal = async (id: string) => {
    if (!permissions.canUpdate) return;
    const row = vehicles.find((v) => v.id === id);
    if (!row) return;

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
      await ensureVerifiedCustomer(row.customerId);
    }

    setSelectedVehicleId(id);
    setShowEditModal(true);
  };

  const handleCreateVehicle = async () => {
    if (!permissions.canCreate || saving) return;

    const ok = validateVehicleForm(false);
    if (!ok) return;

    // ✅ Auto verify on save
    const customer = await ensureVerifiedCustomer(form.customerId);
    if (!customer) {
      await showAlert("Customer missing", "Customer ID is invalid. Please verify a valid customer.", "error");
      return;
    }

    setSaving(true);
    try {
      const u = await getCurrentUser();
      const createdBy = resolveActorUsername(u, "system");

      const ownerName = `${customer.name} ${customer.lastname}`.trim();

      const created = await client.models.Vehicle.create({
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

      if (!created.data) throw new Error("Vehicle not created");

      await logActivity(
        "Vehicle",
        created.data.id,
        "CREATE",
        `Vehicle ${resolveVehicleIdDisplay(created.data) || resolveVehicleIdDisplay(form)} created`
      );

      setShowAddModal(false);
      resetForm();
      await loadVehicles();
      await showAlert("Success", "Vehicle created successfully!", "success");
    } catch (e) {
      console.error(e);
      await showAlert("Error", "Create failed. Check console.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateVehicle = async () => {
    if (!permissions.canUpdate || saving) return;
    if (!selectedVehicleId) return;

    const ok = validateVehicleForm(true);
    if (!ok) return;

    // ✅ Auto verify on save
    const customer = await ensureVerifiedCustomer(form.customerId);
    if (!customer) {
      await showAlert("Customer missing", "Customer ID is invalid. Please verify a valid customer.", "error");
      return;
    }

    setSaving(true);
    try {
      const ownerName = `${customer.name} ${customer.lastname}`.trim();

      await client.models.Vehicle.update({
        id: selectedVehicleId,
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

      await logActivity(
        "Vehicle",
        selectedVehicleId,
        "UPDATE",
        `Vehicle ${resolveVehicleIdDisplay(selectedVehicle) || resolveVehicleIdDisplay(form)} updated`
      );

      setShowEditModal(false);
      resetForm();
      setSelectedVehicleId(null);
      await loadVehicles();
      await showAlert("Success", "Vehicle updated successfully!", "success");
    } catch (e) {
      console.error(e);
      await showAlert("Error", "Update failed. Check console.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteVehicle = async (id: string) => {
    if (!permissions.canDelete) return;
    const row = vehicles.find((v) => v.id === id);
    if (!row) return;
    setDeleteVehicle(row);
  };

  const confirmDeleteVehicle = async () => {
    if (!permissions.canDelete || !deleteVehicle) return;

    setSaving(true);
    try {
      await client.models.Vehicle.delete({ id: deleteVehicle.id });
      await logActivity("Vehicle", deleteVehicle.id, "DELETE", `Vehicle ${resolveVehicleIdDisplay(deleteVehicle)} deleted`);

      setDeleteVehicle(null);

      if (selectedVehicleId === deleteVehicle.id) {
        setSelectedVehicleId(null);
        setSelectedVehicle(null);
        setSelectedCustomer(null);
        setCompletedOrders([]);
        setViewMode("list");
      }

      await loadVehicles();
      await showAlert("Success", "Vehicle deleted successfully!", "success");
    } catch (e) {
      console.error(e);
      await showAlert("Error", "Delete failed. Check console.", "error");
    } finally {
      setSaving(false);
    }
  };

  const openDetails = async (id: string) => {
    const row = vehicles.find((v) => v.id === id);
    if (!row) return;

    setSelectedVehicleId(id);
    setViewMode("details");
  };

  // Load details view data
  useEffect(() => {
    if (viewMode !== "details" || !selectedVehicleId) return;

    (async () => {
      try {
        const v = await client.models.Vehicle.get({ id: selectedVehicleId });
        const vehicle = v.data ?? null;
        setSelectedVehicle(vehicle);

        if (vehicle?.customerId) {
          const c = await client.models.Customer.get({ id: vehicle.customerId });
          setSelectedCustomer(c.data ?? null);
        } else {
          setSelectedCustomer(null);
        }

        if (vehicle?.plateNumber) {
          const orders = await client.models.JobOrder.list({
            limit: 2000,
            filter: { plateNumber: { eq: vehicle.plateNumber }, status: { eq: "COMPLETED" } },
          });
          setCompletedOrders(orders.data ?? []);
        } else {
          setCompletedOrders([]);
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [viewMode, selectedVehicleId]);

  const closeDetails = () => {
    setViewMode("list");
    setSelectedVehicleId(null);
    setSelectedVehicle(null);
    setSelectedCustomer(null);
    setCompletedOrders([]);
  };

  // ----------------------
  // Details View
  // ----------------------
  if (viewMode === "details" && selectedVehicle) {
    return (
      <>
        <div className="pim-details-screen">
          <div className="pim-details-header">
            <div className="pim-details-title-container">
              <h2>
                <i className="fas fa-car"></i> Vehicle Details - <span>{resolveVehicleIdDisplay(selectedVehicle)}</span>
              </h2>
            </div>

            <button
              className="pim-btn-close-details"
              onClick={() => {
                closeDetails();
                if (navigationData?.source && onNavigateBack) {
                  onNavigateBack(navigationData.source, navigationData.returnToCustomer ?? null);
                }
              }}
            >
              <i className="fas fa-times"></i> Close Details
            </button>
          </div>

          <div className="pim-details-body">
            <div className="pim-details-grid">
              <div className="pim-detail-card cv-unified-card">
                <div className="details-card-header">
                  <h3>
                    <i className="fas fa-user"></i> Customer Information
                  </h3>
                </div>

                <div className="pim-card-content cv-unified-grid">
                  <div className="pim-info-item">
                    <span className="pim-info-label">Customer ID</span>
                    <span className="pim-info-value">{selectedVehicle.customerId ?? "—"}</span>
                  </div>

                  <div className="pim-info-item">
                    <span className="pim-info-label">Customer Name</span>
                    <span className="pim-info-value">
                      {selectedCustomer
                        ? `${selectedCustomer.name} ${selectedCustomer.lastname}`
                        : selectedVehicle.ownedBy ?? "—"}
                    </span>
                  </div>

                  <div className="pim-info-item">
                    <span className="pim-info-label">Mobile</span>
                    <span className="pim-info-value">{selectedCustomer?.phone ?? "Not provided"}</span>
                  </div>

                  <div className="pim-info-item">
                    <span className="pim-info-label">Email</span>
                    <span className="pim-info-value">{selectedCustomer?.email ?? "Not provided"}</span>
                  </div>
                </div>
              </div>

              <div className="pim-detail-card cv-unified-card">
                <div className="details-card-header">
                  <h3>
                    <i className="fas fa-car"></i> Vehicle Information
                  </h3>

                  {permissions.canUpdate && (
                    <button className="btn-action btn-edit" onClick={() => openEditModal(selectedVehicle.id)}>
                      <i className="fas fa-edit"></i> Edit Vehicle
                    </button>
                  )}
                </div>

                <div className="pim-card-content cv-unified-grid">
                  <div className="pim-info-item">
                    <span className="pim-info-label">Vehicle ID</span>
                    <span className="pim-info-value">{resolveVehicleIdDisplay(selectedVehicle)}</span>
                  </div>
                  <div className="pim-info-item">
                    <span className="pim-info-label">Make</span>
                    <span className="pim-info-value">{selectedVehicle.make ?? "—"}</span>
                  </div>
                  <div className="pim-info-item">
                    <span className="pim-info-label">Model</span>
                    <span className="pim-info-value">{selectedVehicle.model ?? "—"}</span>
                  </div>
                  <div className="pim-info-item">
                    <span className="pim-info-label">Year</span>
                    <span className="pim-info-value">{selectedVehicle.year ?? "—"}</span>
                  </div>
                  <div className="pim-info-item">
                    <span className="pim-info-label">Type</span>
                    <span className="pim-info-value">{selectedVehicle.vehicleType ?? "—"}</span>
                  </div>
                  <div className="pim-info-item">
                    <span className="pim-info-label">Color</span>
                    <span className="pim-info-value">{selectedVehicle.color ?? "—"}</span>
                  </div>
                  <div className="pim-info-item">
                    <span className="pim-info-label">Plate Number</span>
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
                    <i className="fas fa-tasks"></i> Completed Services (from Job Orders)
                  </h3>

                  <button
                    className="btn-add-vehicle"
                    onClick={() => {
                      if (!onNavigate) return;
                      onNavigate("Job Order Management", {
                        openNewJob: true,
                        source: "Vehicles Management",
                        vehicleId: resolveVehicleIdRaw(selectedVehicle),
                        customerId: selectedVehicle.customerId,
                        plateNumber: selectedVehicle.plateNumber,
                      });
                    }}
                  >
                    <i className="fas fa-plus-circle"></i> Add New Order
                  </button>
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
                            No completed job orders found for this vehicle (matched by plate number).
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Edit Modal */}
        <Modal
          isOpen={showEditModal}
          title="Edit Vehicle"
          icon="fas fa-car"
          onClose={() => {
            setShowEditModal(false);
            resetForm();
            setSelectedVehicleId(null);
          }}
          onSave={handleUpdateVehicle}
          isEdit
          saving={saving}
          saveLabel="Save Changes"
        >
          <div className="modal-form">
            <div className="verify-row">
              <FormField
                label="Customer ID"
                id="editCustomerId"
                placeholder="Enter Customer ID"
                value={form.customerId}
                onChange={(e) => setForm((p) => ({ ...p, customerId: e.target.value }))}
                error={errors.customerId}
                required
              />
              <button className="btn-verify" type="button" onClick={() => verifyCustomer(form.customerId)}>
                <i className="fas fa-check-circle"></i> Verify
              </button>
            </div>

            {verifiedCustomer && (
              <div className="verified-banner">
                <i className="fas fa-check-circle"></i> Verified: {verifiedCustomer.name} {verifiedCustomer.lastname}
              </div>
            )}

            <div className="form-grid-2">
              <FormField
                label="Vehicle ID"
                id="editVehicleId"
                value={form.vehicleId}
                onChange={(e) => setForm((p) => ({ ...p, vehicleId: e.target.value }))}
                disabled
                hint="Vehicle ID is not editable."
              />
              <FormField
                label="Plate Number"
                id="editPlate"
                placeholder="e.g. 123456"
                value={form.plateNumber}
                onChange={(e) => setForm((p) => ({ ...p, plateNumber: e.target.value }))}
                error={errors.plateNumber}
                required
              />
              <FormField
                label="Make"
                id="editMake"
                placeholder="e.g. Toyota"
                value={form.make}
                onChange={(e) => setForm((p) => ({ ...p, make: e.target.value }))}
                error={errors.make}
                required
              />
              <FormField
                label="Model"
                id="editModel"
                placeholder="e.g. Land Cruiser"
                value={form.model}
                onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
                error={errors.model}
                required
              />
              <FormField
                label="Year"
                id="editYear"
                placeholder="e.g. 2024"
                value={form.year}
                onChange={(e) => setForm((p) => ({ ...p, year: e.target.value }))}
                error={errors.year}
                required
              />
              <FormField
                label="Vehicle Type"
                id="editType"
                type="select"
                value={form.vehicleType}
                onChange={(e) => setForm((p) => ({ ...p, vehicleType: e.target.value }))}
                error={errors.vehicleType}
                required
                options={[
                  { value: "", label: "Select type" },
                  { value: "Sedan", label: "Sedan" },
                  { value: "SUV", label: "SUV" },
                  { value: "Truck", label: "Truck" },
                  { value: "Coupe", label: "Coupe" },
                  { value: "Hatchback", label: "Hatchback" },
                  { value: "Van", label: "Van" },
                  { value: "Motorbike", label: "Motorbike" },
                  { value: "Other", label: "Other" },
                ]}
              />
              <FormField
                label="Color"
                id="editColor"
                placeholder="e.g. Black"
                value={form.color}
                onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                error={errors.color}
                required
              />
              <FormField
                label="VIN"
                id="editVin"
                placeholder="Optional"
                value={form.vin}
                onChange={(e) => setForm((p) => ({ ...p, vin: e.target.value }))}
              />
            </div>

            <FormField
              label="Notes"
              id="editNotes"
              placeholder="Optional"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </div>
        </Modal>

        <AlertPopup {...alert} />
      </>
    );
  }

  // ----------------------
  // List View
  // ----------------------
  return (
    <div className="app-container" id="mainScreen">
      <header className="app-header">
        <div className="header-left">
          <h1>
            <i className="fas fa-car"></i> Vehicle Management
          </h1>
        </div>
      </header>

      <main className="main-content">
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
              ? "Loading vehicles..."
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
                <button className="btn-new-customer" onClick={openAddModal}>
                  <i className="fas fa-plus-circle"></i> Add New Vehicle
                </button>
              )}
            </div>
          </div>

          <VehiclesTable
            data={paginatedData}
            searchQuery={searchQuery}
            onView={openDetails}
            onEdit={openEditModal}
            onDelete={handleDeleteVehicle}
            canUpdate={permissions.canUpdate}
            canDelete={permissions.canDelete}
          />

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
              >
                <i className="fas fa-chevron-left"></i>
              </button>

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
                    className={`pagination-btn ${pageNum === currentPage ? "active" : ""}`}
                    onClick={() => setCurrentPage(pageNum)}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                className="pagination-btn"
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                <i className="fas fa-chevron-right"></i>
              </button>
            </div>
          )}
        </section>
      </main>

      <footer className="app-footer">
        <p>Service Management System © {new Date().getFullYear()} | Vehicle Management Module</p>
      </footer>

      {/* Add Modal */}
      <Modal
        isOpen={showAddModal}
        title="Add New Vehicle"
        icon="fas fa-car"
        className="vehicle-create-modal"
        onClose={() => {
          setShowAddModal(false);
          resetForm();
        }}
        onSave={handleCreateVehicle}
        saving={saving}
        saveLabel="Add Vehicle"
      >
        <div className="modal-form vehicle-create-form">
          <div className="verify-row vehicle-create-verify-row">
            <FormField
              label="Customer ID"
              id="newCustomerId"
              placeholder="Enter Customer ID"
              value={form.customerId}
              onChange={(e) => setForm((p) => ({ ...p, customerId: e.target.value }))}
              error={errors.customerId}
              required
            />
            <button className="btn-verify" type="button" onClick={() => verifyCustomer(form.customerId)}>
              <i className="fas fa-check-circle"></i> Verify
            </button>
          </div>

          {verifiedCustomer && (
            <div className="verified-banner">
              <i className="fas fa-check-circle"></i> Verified: {verifiedCustomer.name} {verifiedCustomer.lastname}
            </div>
          )}

          <div className="form-grid-2">
            <FormField
              label="Vehicle ID"
              id="newVehicleId"
              value={form.vehicleId}
              onChange={(e) => setForm((p) => ({ ...p, vehicleId: e.target.value }))}
              error={errors.vehicleId}
              required
              disabled
              hint="Auto-generated"
            />
            <FormField
              label="Plate Number"
              id="newPlate"
              placeholder="e.g. 123456"
              value={form.plateNumber}
              onChange={(e) => setForm((p) => ({ ...p, plateNumber: e.target.value }))}
              error={errors.plateNumber}
              required
            />

            <FormField
              label="Make"
              id="newMake"
              placeholder="e.g. Toyota"
              value={form.make}
              onChange={(e) => setForm((p) => ({ ...p, make: e.target.value }))}
              error={errors.make}
              required
            />
            <FormField
              label="Model"
              id="newModel"
              placeholder="e.g. Land Cruiser"
              value={form.model}
              onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
              error={errors.model}
              required
            />

            <FormField
              label="Year"
              id="newYear"
              placeholder="e.g. 2024"
              value={form.year}
              onChange={(e) => setForm((p) => ({ ...p, year: e.target.value }))}
              error={errors.year}
              required
            />

            <FormField
              label="Vehicle Type"
              id="newType"
              type="select"
              value={form.vehicleType}
              onChange={(e) => setForm((p) => ({ ...p, vehicleType: e.target.value }))}
              error={errors.vehicleType}
              required
              options={[
                { value: "", label: "Select type" },
                { value: "Sedan", label: "Sedan" },
                { value: "SUV", label: "SUV" },
                { value: "Truck", label: "Truck" },
                { value: "Coupe", label: "Coupe" },
                { value: "Hatchback", label: "Hatchback" },
                { value: "Van", label: "Van" },
                { value: "Motorbike", label: "Motorbike" },
                { value: "Other", label: "Other" },
              ]}
            />

            <FormField
              label="Color"
              id="newColor"
              placeholder="e.g. Black"
              value={form.color}
              onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
              error={errors.color}
              required
            />

            <FormField
              label="VIN"
              id="newVin"
              placeholder="Optional"
              value={form.vin}
              onChange={(e) => setForm((p) => ({ ...p, vin: e.target.value }))}
            />
          </div>

          <FormField
            label="Notes"
            id="newNotes"
            placeholder="Optional"
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          />
        </div>
      </Modal>

      {/* Delete Modal */}
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
                      You are about to delete vehicle <strong>{resolveVehicleIdDisplay(deleteVehicle)}</strong>.
                    </p>
                    <p>This action cannot be undone.</p>
                  </div>
                </div>

                <div className="delete-modal-actions">
                  <button className="btn-confirm-delete" onClick={confirmDeleteVehicle} disabled={saving}>
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

      <AlertPopup {...alert} />
    </div>
  );
}
