// src/pages/VehicleManagement.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import "./Vehicule.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";
import { getCurrentUser } from "aws-amplify/auth";
import { resolveActorUsername } from "../utils/actorIdentity";
import { normalizePaymentStatusLabel as normalizePaymentStatusLabelShared } from "../utils/paymentStatus";
import { formatCustomerDisplayId } from "../utils/customerId";
import { logActivity } from "../utils/activityLogger";
import { matchesSearchQuery } from "../lib/searchUtils";
import { QATAR_MANUFACTURERS, getModelsByManufacturer } from "../utils/vehicleCatalog";
import { VEHICLE_COLORS } from "../utils/vehicleColors";
import type { ReactNode } from "react";
import { usePermissions } from "../lib/userPermissions";
import PermissionGate from "./PermissionGate";
import { useLanguage } from "../i18n/LanguageContext";

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

function normalizePaymentStatusLabel(value: any): string {
  const out = normalizePaymentStatusLabelShared(value);
  return out || "—";
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
  canView: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  completedServicesByPlate: Record<string, number>;
}) {
  const { data, searchQuery, onView, onEdit, onDelete, canView, canUpdate, canDelete, completedServicesByPlate } = props;

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
      document.addEventListener("pointerdown", handleClickOutside, true);
      return () => document.removeEventListener("pointerdown", handleClickOutside, true);
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
                {(() => {
                  const plateKey = String(v.plateNumber ?? "").trim().toLowerCase();
                  const dynamicCount = plateKey ? completedServicesByPlate[plateKey] : undefined;
                  const finalCount = Number.isFinite(dynamicCount as number)
                    ? Number(dynamicCount)
                    : Number(v.completedServicesCount ?? 0);
                  return <span className="count-badge">{finalCount.toString()} services</span>;
                })()}
              </td>

              <td>
                {(canView || canUpdate || canDelete) && (
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
                        flushSync(() => {
                          setDropdownPosition({ top, left });
                          setActiveDropdown(v.id);
                        });
                      }}
                    >
                      <i className="fas fa-cogs"></i> Actions <i className="fas fa-chevron-down"></i>
                    </button>
                  </div>
                )}
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
            {canView && (
              <button
                className="dropdown-item view"
                onClick={() => {
                  onView(activeDropdown);
                  setActiveDropdown(null);
                }}
              >
                <i className="fas fa-eye"></i> View Details
              </button>
            )}

            {(canView && (canUpdate || canDelete)) && <div className="dropdown-divider"></div>}

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
  const { t } = useLanguage();
  const { canOption } = usePermissions();

  const canSearch = canOption("vehicles", "vehicles_search", true);
  const canAdd = permissions.canCreate && canOption("vehicles", "vehicles_add", true);
  const canViewDetails = permissions.canRead && canOption("vehicles", "vehicles_viewdetails", true);
  const canEdit = permissions.canUpdate && canOption("vehicles", "vehicles_edit", true);
  const canDelete = permissions.canDelete && canOption("vehicles", "vehicles_delete", true);
  const canVerifyCustomer = permissions.canUpdate && canOption("vehicles", "vehicles_verifycustomer", true);

  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>{t("You don’t have access to this page.")}</div>;
  }

  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [completedServicesByPlate, setCompletedServicesByPlate] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [viewMode, setViewMode] = useState<"list" | "details">("list");
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleRow | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [completedOrders, setCompletedOrders] = useState<JobOrderRow[]>([]);
  const [selectedCustomerVehiclesCount, setSelectedCustomerVehiclesCount] = useState(0);
  const [selectedCustomerCompletedServicesCount, setSelectedCustomerCompletedServicesCount] = useState(0);

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

  const manufacturerOptions = useMemo<Array<string | { value: string; label: string }>>(() => {
    const options: Array<string | { value: string; label: string }> = [{ value: "", label: "Select manufacturer" }];
    const make = form.make.trim();
    if (make && !QATAR_MANUFACTURERS.includes(make)) {
      options.push({ value: make, label: `${make} (current)` });
    }
    options.push(...QATAR_MANUFACTURERS);
    return options;
  }, [form.make]);

  const catalogModelsForMake = useMemo(() => getModelsByManufacturer(form.make), [form.make]);
  const selectedMakeHasCatalog = catalogModelsForMake.length > 0;

  const modelOptions = useMemo<Array<string | { value: string; label: string }>>(() => {
    const options: Array<string | { value: string; label: string }> = [{ value: "", label: "Select model" }];

    if (!selectedMakeHasCatalog) {
      const model = form.model.trim();
      if (model) options.push({ value: model, label: `${model} (current)` });
      return options;
    }

    options.push(...catalogModelsForMake);
    return options;
  }, [catalogModelsForMake, form.model, selectedMakeHasCatalog]);

  const colorOptions = useMemo<Array<string | { value: string; label: string }>>(() => {
    const options: Array<string | { value: string; label: string }> = [{ value: "", label: "Select color" }];
    const color = form.color.trim();
    if (color && !VEHICLE_COLORS.includes(color)) {
      options.push({ value: color, label: `${color} (current)` });
    }
    options.push(...VEHICLE_COLORS);
    return options;
  }, [form.color]);

  useEffect(() => {
    if (!selectedMakeHasCatalog) return;
    if (!form.model.trim()) return;
    if (catalogModelsForMake.includes(form.model)) return;
    setForm((prev) => ({ ...prev, model: "" }));
  }, [catalogModelsForMake, form.model, selectedMakeHasCatalog]);

  // alert
  const [alert, setAlert] = useState<AlertState>({
    isOpen: false,
    title: "",
    message: "",
    type: "info",
    showCancel: false,
  });
  const customerLookupRef = useRef<Map<string, CustomerRow>>(new Map());
  const customerLookupLoadedRef = useRef(false);
  const vehicleByBusinessIdRef = useRef<Map<string, VehicleRow>>(new Map());
  const customerByIdCacheRef = useRef<Map<string, CustomerRow | null>>(new Map());
  const completedOrdersByPlateRef = useRef<Map<string, JobOrderRow[]>>(new Map());

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
      const res = await client.models.Vehicle.list({ limit: 500 });
      const nextVehicles = (res.data ?? []) as VehicleRow[];
      const byBusinessId = new Map<string, VehicleRow>();
      for (const row of nextVehicles) {
        const businessId = String(row.vehicleId ?? "").trim();
        if (businessId) byBusinessId.set(businessId, row);
      }
      vehicleByBusinessIdRef.current = byBusinessId;
      customerByIdCacheRef.current.clear();
      completedOrdersByPlateRef.current.clear();
      setVehicles(nextVehicles);
    } catch (e) {
      console.error(e);
      await showAlert(t("Error"), t("Failed to load vehicles. Check console."), "error");
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  const loadCompletedServicesByPlate = useCallback(async () => {
    try {
      let rows: JobOrderRow[] = [];

      try {
        const out: JobOrderRow[] = [];
        let nextToken: string | null | undefined = undefined;
        do {
          const byStatus: any = await (client.models.JobOrder as any)?.jobOrdersByStatus?.({
            status: "COMPLETED",
            limit: 2000,
            nextToken,
          });
          out.push(...(((byStatus as any)?.data ?? []) as JobOrderRow[]));
          nextToken = (byStatus as any)?.nextToken;
        } while (nextToken && out.length < 12000);
        rows = out;
      } catch {
        const res = await client.models.JobOrder.list({
          limit: 5000,
          filter: { status: { eq: "COMPLETED" } },
        } as any);
        rows = ((res as any)?.data ?? []) as JobOrderRow[];
      }

      const counts: Record<string, number> = {};
      for (const row of rows) {
        const key = String((row as any)?.plateNumber ?? "").trim().toLowerCase();
        if (!key) continue;
        counts[key] = (counts[key] ?? 0) + 1;
      }

      setCompletedServicesByPlate(counts);
    } catch (e) {
      console.error("[vehicles] failed to load completed-services counts", e);
      setCompletedServicesByPlate({});
    }
  }, []);

  useEffect(() => {
    loadVehicles();
    loadCompletedServicesByPlate();
  }, [loadVehicles, loadCompletedServicesByPlate]);

  // Optional navigation hook
  useEffect(() => {
    if (navigationData?.openDetails && navigationData?.vehicleId) {
      if (!canViewDetails) {
        onClearNavigation?.();
        return;
      }
      (async () => {
        try {
          const targetBusinessId = String(navigationData.vehicleId ?? "").trim();
          let found = vehicleByBusinessIdRef.current.get(targetBusinessId);

          if (!found) {
            const res = await client.models.Vehicle.list({
              limit: 1,
              filter: { vehicleId: { eq: targetBusinessId } },
            });
            found = res.data?.[0] as VehicleRow | undefined;
          }

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
  }, [navigationData, onClearNavigation, canViewDetails]);

  const performSmartSearch = useCallback(
    (query: string) => {
      if (!query.trim()) return vehicles;

      return vehicles.filter((v) => {
        return matchesSearchQuery(
          [resolveVehicleIdRaw(v), v.ownedBy, v.make, v.model, v.year, v.color, v.plateNumber, v.vin],
          query
        );
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
      const rawInput = customerId.trim();
      if (!rawInput) return null;
      const normalizedInput = rawInput.toLowerCase();

      // if already verified and matches -> return it
      if (
        verifiedCustomer?.id &&
        (String(verifiedCustomer.id).trim() === rawInput ||
          formatCustomerDisplayId(verifiedCustomer.id).toLowerCase() === normalizedInput)
      ) {
        return verifiedCustomer;
      }

      try {
        const byRawId = await client.models.Customer.get({ id: rawInput });
        if (byRawId.data) {
          customerLookupRef.current.set(String(byRawId.data.id).trim().toLowerCase(), byRawId.data);
          customerLookupRef.current.set(formatCustomerDisplayId(byRawId.data.id).toLowerCase(), byRawId.data);
          setVerifiedCustomer(byRawId.data);
          return byRawId.data;
        }

        const cached = customerLookupRef.current.get(normalizedInput);
        if (cached?.id) {
          setVerifiedCustomer(cached);
          return cached;
        }

        if (!customerLookupLoadedRef.current) {
          const listed = await client.models.Customer.list({ limit: 2000 } as any);
          for (const row of listed.data ?? []) {
            const rowId = String((row as any)?.id ?? "").trim().toLowerCase();
            if (!rowId) continue;
            customerLookupRef.current.set(rowId, row as CustomerRow);
            customerLookupRef.current.set(formatCustomerDisplayId((row as any)?.id).toLowerCase(), row as CustomerRow);
          }
          customerLookupLoadedRef.current = true;
        }

        const byDisplayId = customerLookupRef.current.get(normalizedInput);
        if (!byDisplayId?.id) return null;
        setVerifiedCustomer(byDisplayId);
        return byDisplayId;
      } catch (e) {
        console.error(e);
        return null;
      }
    },
    [verifiedCustomer]
  );

  const verifyCustomer = async (customerId: string) => {
    if (!canVerifyCustomer) return;
    if (!customerId.trim()) {
      setVerifiedCustomer(null);
      await showAlert(t("Missing"), t("Please enter a Customer ID."), "warning");
      return;
    }
    const c = await ensureVerifiedCustomer(customerId);
    if (!c) {
      setVerifiedCustomer(null);
      await showAlert(t("Not Found"), t("Customer not found. Please use a valid Customer ID."), "error");
      return;
    }
    setForm((prev) => ({ ...prev, customerId: String(c.id ?? "").trim() }));
    await showAlert(t("Verified"), `${t("Customer verified:")} ${c.name} ${c.lastname}`, "success");
  };

  const validateVehicleForm = (isEdit: boolean) => {
    const next: Record<string, string> = {};

    if (!form.customerId.trim()) next.customerId = t("Customer ID required");
    if (!form.make.trim()) next.make = t("Make required");
    if (!form.model.trim()) next.model = t("Model required");
    if (!form.year.trim()) next.year = t("Year required");
    if (!form.vehicleType.trim()) next.vehicleType = t("Type required");
    if (!form.color.trim()) next.color = t("Color required");
    if (!form.plateNumber.trim()) next.plateNumber = t("Plate number required");

    if (!isEdit && !form.vehicleId.trim()) next.vehicleId = t("Vehicle ID required");

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const openAddModal = () => {
    if (!canAdd) return;
    resetForm();
    setForm((p) => ({ ...p, vehicleId: generateVehicleId() }));
    setShowAddModal(true);
  };

  const openEditModal = async (id: string) => {
    if (!canEdit) return;
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
    if (!canAdd || saving) return;

    const ok = validateVehicleForm(false);
    if (!ok) return;

    // ✅ Auto verify on save
    const customer = await ensureVerifiedCustomer(form.customerId);
    if (!customer) {
      await showAlert(t("Customer missing"), t("Customer ID is invalid. Please verify a valid customer."), "error");
      return;
    }
    const resolvedCustomerId = String(customer.id ?? "").trim();
    if (!resolvedCustomerId) {
      await showAlert(t("Customer missing"), t("Customer ID is invalid. Please verify a valid customer."), "error");
      return;
    }

    setSaving(true);
    try {
      const u = await getCurrentUser();
      const createdBy = resolveActorUsername(u, "system");

      const ownerName = `${customer.name} ${customer.lastname}`.trim();

      const created = await client.models.Vehicle.create({
        customerId: resolvedCustomerId,
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
      await loadCompletedServicesByPlate();
      await showAlert(t("Success"), t("Vehicle created successfully!"), "success");
    } catch (e) {
      console.error(e);
      await showAlert(t("Error"), t("Create failed. Check console."), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateVehicle = async () => {
    if (!canEdit || saving) return;
    if (!selectedVehicleId) return;

    const ok = validateVehicleForm(true);
    if (!ok) return;

    // ✅ Auto verify on save
    const customer = await ensureVerifiedCustomer(form.customerId);
    if (!customer) {
      await showAlert(t("Customer missing"), t("Customer ID is invalid. Please verify a valid customer."), "error");
      return;
    }
    const resolvedCustomerId = String(customer.id ?? "").trim();
    if (!resolvedCustomerId) {
      await showAlert(t("Customer missing"), t("Customer ID is invalid. Please verify a valid customer."), "error");
      return;
    }

    setSaving(true);
    try {
      const ownerName = `${customer.name} ${customer.lastname}`.trim();

      await client.models.Vehicle.update({
        id: selectedVehicleId,
        customerId: resolvedCustomerId,
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
      await loadCompletedServicesByPlate();
      await showAlert(t("Success"), t("Vehicle updated successfully!"), "success");
    } catch (e) {
      console.error(e);
      await showAlert(t("Error"), t("Update failed. Check console."), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteVehicle = async (id: string) => {
    if (!canDelete) return;
    const row = vehicles.find((v) => v.id === id);
    if (!row) return;
    setDeleteVehicle(row);
  };

  const confirmDeleteVehicle = async () => {
    if (!canDelete || !deleteVehicle) return;

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
      await loadCompletedServicesByPlate();
      await showAlert(t("Success"), t("Vehicle deleted successfully!"), "success");
    } catch (e) {
      console.error(e);
      await showAlert(t("Error"), t("Delete failed. Check console."), "error");
    } finally {
      setSaving(false);
    }
  };

  const openDetails = async (id: string) => {
    if (!canViewDetails) return;
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
        const fromList = vehicles.find((item) => item.id === selectedVehicleId) ?? null;
        const v = fromList ? null : await client.models.Vehicle.get({ id: selectedVehicleId });
        const vehicle = fromList ?? ((v as any)?.data ?? null);
        setSelectedVehicle(vehicle);

        const customerId = String(vehicle?.customerId ?? "").trim();
        const plateNumber = String(vehicle?.plateNumber ?? "").trim();

        const customerPromise = customerId
          ? (async () => {
              if (customerByIdCacheRef.current.has(customerId)) {
                return customerByIdCacheRef.current.get(customerId) ?? null;
              }
              const customerRes = await client.models.Customer.get({ id: customerId });
              const customerData = (customerRes as any)?.data ?? null;
              customerByIdCacheRef.current.set(customerId, customerData);
              return customerData;
            })()
          : Promise.resolve(null);

        const customerVehiclesCountPromise = customerId
          ? (async () => {
              try {
                const byCustomer = await client.models.Vehicle.list({
                  filter: { customerId: { eq: customerId } } as any,
                  limit: 2000,
                } as any);
                return (byCustomer.data ?? []).length;
              } catch {
                return 0;
              }
            })()
          : Promise.resolve(0);

        const customerCompletedServicesPromise = customerId
          ? (async () => {
              try {
                const completed = await client.models.JobOrder.list({
                  filter: { customerId: { eq: customerId }, status: { eq: "COMPLETED" } } as any,
                  limit: 5000,
                } as any);
                const direct = (completed.data ?? []).length;
                if (direct > 0) return direct;
              } catch {
                // fallback below
              }

              try {
                const customerVehicles = await client.models.Vehicle.list({
                  filter: { customerId: { eq: customerId } } as any,
                  limit: 2000,
                } as any);
                const uniquePlates = Array.from(
                  new Set(
                    (customerVehicles.data ?? [])
                      .map((v: any) => String(v?.plateNumber ?? "").trim())
                      .filter(Boolean)
                  )
                );

                if (!uniquePlates.length) return 0;

                const counts = await Promise.all(
                  uniquePlates.map(async (plate) => {
                    try {
                      const byPlate = await (client.models.JobOrder as any)?.jobOrdersByPlateNumber?.({
                        plateNumber: plate,
                        limit: 2000,
                      });
                      const rows = ((byPlate as any)?.data ?? []) as any[];
                      return rows.filter((row) => String(row?.status ?? "") === "COMPLETED").length;
                    } catch {
                      const listed = await client.models.JobOrder.list({
                        filter: { plateNumber: { eq: plate }, status: { eq: "COMPLETED" } } as any,
                        limit: 2000,
                      } as any);
                      return (listed.data ?? []).length;
                    }
                  })
                );

                return counts.reduce((sum, n) => sum + Number(n || 0), 0);
              } catch {
                return 0;
              }
            })()
          : Promise.resolve(0);

        const completedOrdersPromise = plateNumber
          ? (async () => {
              if (completedOrdersByPlateRef.current.has(plateNumber)) {
                return completedOrdersByPlateRef.current.get(plateNumber) ?? [];
              }
              const ordersRes = await client.models.JobOrder.list({
                limit: 500,
                filter: { plateNumber: { eq: plateNumber }, status: { eq: "COMPLETED" } },
              });
              const rows = ((ordersRes as any)?.data ?? []) as JobOrderRow[];
              completedOrdersByPlateRef.current.set(plateNumber, rows);
              return rows;
            })()
          : Promise.resolve([] as JobOrderRow[]);

        const [customerData, completedRows, customerVehiclesCount, customerCompletedServicesCount] = await Promise.all([
          customerPromise,
          completedOrdersPromise,
          customerVehiclesCountPromise,
          customerCompletedServicesPromise,
        ]);

        setSelectedCustomer(customerData);
        setCompletedOrders(completedRows);
        setSelectedCustomerVehiclesCount(customerVehiclesCount);
        setSelectedCustomerCompletedServicesCount(customerCompletedServicesCount);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [viewMode, selectedVehicleId, vehicles]);

  const closeDetails = () => {
    setViewMode("list");
    setSelectedVehicleId(null);
    setSelectedVehicle(null);
    setSelectedCustomer(null);
    setCompletedOrders([]);
    setSelectedCustomerVehiclesCount(0);
    setSelectedCustomerCompletedServicesCount(0);
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
                    <span className="pim-info-value">{formatCustomerDisplayId(selectedVehicle.customerId)}</span>
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

                  <div className="pim-info-item">
                    <span className="pim-info-label">Registered Vehicles</span>
                    <span className="pim-info-value">
                      <span className="count-badge">{selectedCustomerVehiclesCount} vehicles</span>
                    </span>
                  </div>

                  <div className="pim-info-item">
                    <span className="pim-info-label">Completed Services</span>
                    <span className="pim-info-value">
                      <span className="count-badge">{selectedCustomerCompletedServicesCount} completed</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="pim-detail-card cv-unified-card">
                <div className="details-card-header">
                  <h3>
                    <i className="fas fa-car"></i> Vehicle Information
                  </h3>

                  <PermissionGate moduleId="vehicles" optionId="vehicles_edit" fallback={null}>
                    {canEdit && (
                      <button className="btn-action btn-edit" onClick={() => openEditModal(selectedVehicle.id)}>
                        <i className="fas fa-edit"></i> Edit Vehicle
                      </button>
                    )}
                  </PermissionGate>
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

              <div className="pim-detail-card cv-full-width-card">
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
                        startStep: 3,
                        source: "Vehicles Management",
                        returnToVehicle: resolveVehicleIdRaw(selectedVehicle),
                        customerData: selectedCustomer
                          ? {
                              ...selectedCustomer,
                              id: selectedVehicle.customerId,
                              mobile: selectedCustomer.phone ?? null,
                            }
                          : selectedVehicle.customerId
                            ? { id: selectedVehicle.customerId }
                            : null,
                        vehicleData: {
                          ...selectedVehicle,
                          id: resolveVehicleIdRaw(selectedVehicle),
                          vehicleId: resolveVehicleIdRaw(selectedVehicle),
                          plateNumber: selectedVehicle.plateNumber,
                        },
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
                            <td>{normalizePaymentStatusLabel(o.paymentStatus)}</td>
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
              <PermissionGate moduleId="vehicles" optionId="vehicles_verifycustomer" fallback={null}>
                {canVerifyCustomer && (
                  <button className="btn-verify" type="button" onClick={() => verifyCustomer(form.customerId)}>
                    <i className="fas fa-check-circle"></i> Verify
                  </button>
                )}
              </PermissionGate>
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
                type="select"
                value={form.make}
                onChange={(e) => setForm((p) => ({ ...p, make: e.target.value }))}
                error={errors.make}
                required
                options={manufacturerOptions}
              />
              <FormField
                label="Model"
                id="editModel"
                type="select"
                value={form.model}
                onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
                error={errors.model}
                required
                options={modelOptions}
                disabled={!form.make.trim()}
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
                type="select"
                value={form.color}
                onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                error={errors.color}
                required
                options={colorOptions}
              />
              <FormField
                label="VIN"
                id="editVin"
                placeholder="Optional"
                value={form.vin}
                onChange={(e) => setForm((p) => ({ ...p, vin: e.target.value }))}
                required={false}
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
    <div className="app-container vehicle-page" id="mainScreen">
      <header className="app-header crm-unified-header">
        <div className="header-left">
          <h1>
            <i className="fas fa-car"></i> {t("Vehicle Management")}
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
              placeholder={t("Search by any vehicle details")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={!canSearch}
              autoComplete="off"
            />
          </div>

          <div className="search-stats">
            {loading
              ? t("Loading vehicles...")
              : searchResults.length === 0
              ? t("No vehicles found")
              : `${t("Showing")} ${Math.min((currentPage - 1) * pageSize + 1, searchResults.length)}-${Math.min(
                  currentPage * pageSize,
                  searchResults.length
                )} ${t("of")} ${searchResults.length} ${t("vehicles")}`}
          </div>
        </section>

        <section className="results-section">
          <div className="section-header">
            <h2>
              <i className="fas fa-list"></i> {t("Vehicle Records")}
            </h2>

            <div className="pagination-controls">
              <div className="records-per-page">
                <label htmlFor="pageSizeSelect">{t("Records per page:")}</label>
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

              <PermissionGate moduleId="vehicles" optionId="vehicles_add" fallback={null}>
                {canAdd && (
                  <button className="btn-new-customer" onClick={openAddModal}>
                    <i className="fas fa-plus-circle"></i> {t("Add New Vehicle")}
                  </button>
                )}
              </PermissionGate>
            </div>
          </div>

          <VehiclesTable
            data={paginatedData}
            searchQuery={searchQuery}
            onView={openDetails}
            onEdit={openEditModal}
            onDelete={handleDeleteVehicle}
            canView={canViewDetails}
            canUpdate={canEdit}
            canDelete={canDelete}
            completedServicesByPlate={completedServicesByPlate}
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
        <p>{t("Service Management System ©")} {new Date().getFullYear()} | {t("Vehicle Management Module")}</p>
      </footer>

      {/* Add Modal */}
      <Modal
        isOpen={showAddModal}
        title={t("Add New Vehicle")}
        icon="fas fa-car"
        className="vehicle-create-modal"
        onClose={() => {
          setShowAddModal(false);
          resetForm();
        }}
        onSave={handleCreateVehicle}
        saving={saving}
        saveLabel={t("Add Vehicle")}
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
              <PermissionGate moduleId="vehicles" optionId="vehicles_verifycustomer" fallback={null}>
                {canVerifyCustomer && (
                  <button className="btn-verify" type="button" onClick={() => verifyCustomer(form.customerId)}>
                    <i className="fas fa-check-circle"></i> Verify
                  </button>
                )}
              </PermissionGate>
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
              type="select"
              value={form.make}
              onChange={(e) => setForm((p) => ({ ...p, make: e.target.value }))}
              error={errors.make}
              required
              options={manufacturerOptions}
            />
            <FormField
              label="Model"
              id="newModel"
              type="select"
              value={form.model}
              onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
              error={errors.model}
              required
              options={modelOptions}
              disabled={!form.make.trim()}
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
              type="select"
              value={form.color}
              onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
              error={errors.color}
              required
              options={colorOptions}
            />

            <FormField
              label="VIN"
              id="newVin"
              placeholder="Optional"
              value={form.vin}
              onChange={(e) => setForm((p) => ({ ...p, vin: e.target.value }))}
              required={false}
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
