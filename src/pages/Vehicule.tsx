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
import type { CSSProperties, ReactNode } from "react";
import { usePermissions } from "../lib/userPermissions";
import PermissionGate from "./PermissionGate";
import { useLanguage } from "../i18n/LanguageContext";
import { useGlobalLoading } from "../utils/GlobalLoadingContext";
import { User } from "lucide-react";

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

type ArtTheme = "theme-elegant-glass" | "theme-executive-minimal";

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
  const { t } = useLanguage();
  const { isOpen, title, message, type, onClose, showCancel, onConfirm } = props;
  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

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

  return createPortal(
    <div
      className="alert-popup-overlay show"
      role="dialog"
      aria-modal="true"
      style={{ zIndex: 10050 }}
    >
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
              {t("OK")}
            </button>
          ) : (
            <>
              <button className="alert-popup-btn cancel" onClick={onClose}>
                {t("Cancel")}
              </button>
              <button className="alert-popup-btn confirm" onClick={onConfirm}>
                {t("Confirm")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
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
  const { t } = useLanguage();
  const { isOpen, title, icon, children, onClose, onSave, isEdit = false, saving = false, saveLabel, className } = props;

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="modal-overlay show"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 28, 80, 0.45)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px 14px",
        zIndex: 9999,
      }}
    >
      <div
        className={`modal ${className || ""}`.trim()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(145deg, #f8fafe 0%, #eef3ff 100%)",
          border: "1px solid #DDE7F6",
          borderRadius: 18,
          boxShadow:
            "0 24px 64px rgba(51, 84, 160, 0.22), 0 4px 20px rgba(78, 64, 248, 0.12), inset 0 1px 0 rgba(255,255,255,0.9)",
          overflow: "hidden",
          maxWidth: 520,
          width: "92vw",
          maxHeight: "86vh",
          padding: 0,
        }}
      >
        <div
          style={{
            height: 4,
            background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)",
            flexShrink: 0,
          }}
        />

        <div
          className="modal-header"
          style={{
            padding: "18px 24px 14px",
            borderBottom: "1px solid #E8EEFB",
            background: "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "linear-gradient(160deg, #FFFFFF 0%, #E8EEFF 100%)",
                border: "1px solid #D0DAEE",
                boxShadow: "0 0 0 5px rgba(101, 92, 255, 0.08), 0 2px 8px rgba(78,64,248,0.10)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#5D54FF",
                fontSize: 15,
                flexShrink: 0,
              }}
            >
              <i className={icon} />
            </div>
            <h3
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 700,
                color: "#102A68",
                letterSpacing: "-0.02em",
              }}
            >
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            aria-label={t("Close")}
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "1px solid #DDE7F6",
              background: "linear-gradient(160deg, #FFFFFF 0%, #F0F4FF 100%)",
              color: "#8C9ABF",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              flexShrink: 0,
              outline: "none",
              transition: "all 0.15s",
            }}
          >
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="modal-body" style={{ padding: "22px 24px 6px", overflowY: "auto", maxHeight: "60vh" }}>
          {children}
        </div>

        <div
          className="modal-footer"
          style={{
            padding: "14px 24px 20px",
            borderTop: "1px solid #E8EEFB",
            background: "transparent",
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <button
            onClick={onSave}
            disabled={saving}
            style={{
              background: saving
                ? "linear-gradient(90deg, #b0aef8 0%, #a0e6ee 100%)"
                : "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)",
              color: "#fff",
              border: "none",
              borderRadius: 9,
              padding: "10px 24px",
              fontSize: "0.85rem",
              fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
              boxShadow: saving ? "none" : "0 4px 14px rgba(78, 64, 248, 0.30)",
              display: "flex",
              alignItems: "center",
              gap: 7,
              letterSpacing: "0.01em",
              transition: "all 0.15s",
            }}
          >
            <i className="fas fa-save" style={{ fontSize: 12 }} />
            {saving ? t("Saving...") : saveLabel ? saveLabel : isEdit ? t("Save Changes") : t("Add Vehicle")}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              border: "1.5px solid #C8D5EE",
              background: "linear-gradient(160deg, #FFFFFF 0%, #F0F4FF 100%)",
              color: "#5D54FF",
              borderRadius: 9,
              padding: "10px 20px",
              fontSize: "0.85rem",
              fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 7,
              letterSpacing: "0.01em",
              transition: "all 0.15s",
            }}
          >
            <i className="fas fa-times" style={{ fontSize: 11 }} />
            {t("Cancel")}
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
  const { t } = useLanguage();
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
  const [focused, setFocused] = useState(false);

  const inputStyle: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 14px",
    fontSize: "0.9rem",
    fontWeight: 500,
    color: disabled ? "#A0AEC7" : "#0F2A66",
    background: disabled ? "#F4F7FC" : focused ? "#FFFFFF" : "#F7F9FF",
    border: error ? "1.5px solid #F87171" : focused ? "1.5px solid #7C6DF0" : "1.5px solid #D5DEEF",
    borderRadius: 9,
    outline: "none",
    boxShadow: focused ? "0 0 0 3px rgba(101, 92, 255, 0.13)" : "none",
    transition: "all 0.18s ease",
    cursor: disabled ? "not-allowed" : "text",
  };

  return (
    <div className="form-group" style={{ marginBottom: 14 }}>
      <label
        htmlFor={id}
        style={{
          display: "block",
          marginBottom: 6,
          fontSize: 10.5,
          fontWeight: 700,
          color: "#8C9ABF",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
        {required ? (
          <span style={{ color: "#EF4444", marginLeft: 3, fontWeight: 700 }}>*</span>
        ) : (
          <span
            className="form-optional"
            style={{
              color: "#B8C5DC",
              fontWeight: 500,
              textTransform: "none",
              letterSpacing: 0,
              fontSize: 10,
              marginLeft: 4,
            }}
          >
            {t("(optional)")}
          </span>
        )}
      </label>

      {isSelect ? (
        <select
          id={id}
          className={`form-control ${error ? "error" : ""}`}
          value={String(value)}
          onChange={onChange}
          disabled={disabled}
          required={required}
          style={inputStyle}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          {options?.map((opt) => {
            const v = typeof opt === "string" ? opt : opt.value;
            const l = typeof opt === "string" ? opt : opt.label;
            return (
              <option key={v} value={v}>
                {t(String(l))}
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
          style={inputStyle}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      )}

      {hint && <div className="field-hint" style={{ fontSize: 11, color: "#8FA0C3", marginTop: 4 }}>{hint}</div>}
      {error && (
        <div
          className="error-message show"
          style={{
            fontSize: 11,
            color: "#EF4444",
            marginTop: 4,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <i className="fas fa-exclamation-circle" style={{ fontSize: 10 }} />
          {error}
        </div>
      )}
    </div>
  );
}

// ----------------------
// Vehicles Table
// ----------------------
function VehiclesTable(props: {
  data: VehicleRow[];
  searchQuery: string;
  loading: boolean;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  canView: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  completedServicesByPlate: Record<string, number>;
}) {
  const { t } = useLanguage();
  const { data, searchQuery, loading, onView, onEdit, onDelete, canView, canUpdate, canDelete, completedServicesByPlate } = props;

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

  if (loading) {
    return (
      <div
        className="empty-state"
        style={{
          minHeight: 260,
          background: "linear-gradient(145deg, #f7f9ff 0%, #f3f6fd 45%, #eef3ff 100%)",
          border: "1px solid #DBE4F6",
          borderRadius: 16,
          boxShadow: "0 8px 18px rgba(112, 144, 176, 0.10)",
          padding: "26px 24px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backgroundImage:
              "linear-gradient(90deg, rgba(255,255,255,0.52) 0%, rgba(255,255,255,0.08) 26%, rgba(255,255,255,0.38) 44%, rgba(255,255,255,0.08) 63%, rgba(255,255,255,0.45) 100%)",
          }}
        />
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)" }} />
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 16, justifyContent: "center", minHeight: 208, textAlign: "left", flexWrap: "wrap" }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 14,
              background: "linear-gradient(140deg, #1EC7C7 0%, #6D4FFF 100%)",
              boxShadow: "0 6px 12px rgba(98, 109, 229, 0.20)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              flexShrink: 0,
            }}
          >
            <i className="fas fa-spinner fa-spin" style={{ fontSize: 22 }} />
          </div>
          <div style={{ minWidth: 220 }}>
            <div className="empty-text" style={{ marginBottom: 6 }}>{t("Loading Vehicles")}</div>
            <div className="empty-subtext">{t("Please wait while we fetch your data")}</div>
          </div>
        </div>
      </div>
    );
  }

  const tableTitleStyle: CSSProperties = {
    color: "#111827",
    fontSize: 10.8,
    fontWeight: 800,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  };
  const primaryInfoStyle: CSSProperties = {
    color: "#0F2A66",
    fontSize: "0.9rem",
    fontWeight: 700,
    lineHeight: 1.28,
    letterSpacing: "0.01em",
    display: "block",
    width: "100%",
  };
  const tableShellStyle: CSSProperties = {
    borderRadius: 16,
    border: "1px solid #DCE6F8",
    background: "linear-gradient(180deg, #FFFFFF 0%, #F8FBFF 100%)",
    boxShadow: "0 14px 34px rgba(15, 42, 102, 0.12)",
    padding: 10,
    overflowX: "auto",
    overflowY: "hidden",
    WebkitOverflowScrolling: "touch",
    position: "relative",
  };
  const tableStyle: CSSProperties = {
    width: "100%",
    minWidth: 1140,
    borderCollapse: "separate",
    borderSpacing: 0,
    tableLayout: "fixed",
  };
  const headerRowStyle: CSSProperties = {
    background: "linear-gradient(90deg, #EEF4FF 0%, #E8F7FF 100%)",
  };
  const headerCellStyle: CSSProperties = {
    ...tableTitleStyle,
    padding: "9px 12px",
    borderBottom: "1px solid #D9E5FA",
    verticalAlign: "middle",
    textAlign: "left",
    whiteSpace: "nowrap",
  };
  const cellStyle: CSSProperties = {
    padding: "6px 12px",
    borderBottom: "1px solid #E7EEFC",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
    wordBreak: "normal",
    overflowWrap: "normal",
  };
  const actionHeaderStyle: CSSProperties = {
    ...headerCellStyle,
    textAlign: "right",
    paddingRight: 12,
  };

  if (data.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <i className="fas fa-search"></i>
        </div>
        <div className="empty-text">{t("No matching vehicles found")}</div>
        <div className="empty-subtext">{t("Try adjusting your search terms or clear the search to see all records")}</div>
      </div>
    );
  }

  return (
    <div className="table-wrapper customer-table-card-shell" style={tableShellStyle}>
      <table className="customers-table customer-dashboard-table" style={tableStyle}>
        <colgroup>
          <col style={{ width: "13%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr style={headerRowStyle}>
            <th style={headerCellStyle}>{t("Vehicle ID")}</th>
            <th style={headerCellStyle}>{t("Owned By")}</th>
            <th style={headerCellStyle}>{t("Make")}</th>
            <th style={headerCellStyle}>{t("Year")}</th>
            <th style={headerCellStyle}>{t("Plate Number")}</th>
            <th style={headerCellStyle}>{t("Completed Services")}</th>
            <th style={actionHeaderStyle}>{t("Actions")}</th>
          </tr>
        </thead>

        <tbody>
          {data.map((v, idx) => (
            <tr key={v.id} style={{ background: idx % 2 === 0 ? "rgba(255,255,255,0.96)" : "rgba(246,250,255,0.96)" }}>
              <td style={cellStyle}>
                <div className="customer-cell-primary" style={primaryInfoStyle}>{highlightText(resolveVehicleIdDisplay(v), searchQuery)}</div>
              </td>
              <td style={cellStyle}>
                <div className="customer-cell-primary" style={primaryInfoStyle}>{highlightText(v.ownedBy ?? "—", searchQuery)}</div>
              </td>
              <td style={cellStyle}>
                <div className="customer-cell-primary" style={primaryInfoStyle}>{highlightText(v.make ?? "—", searchQuery)}</div>
              </td>
              <td style={cellStyle}>
                <div className="customer-cell-primary" style={primaryInfoStyle}>{highlightText(v.year ?? "—", searchQuery)}</div>
              </td>
              <td style={cellStyle}>
                <div className="customer-cell-primary" style={primaryInfoStyle}>{highlightText(v.plateNumber ?? "—", searchQuery)}</div>
              </td>
              <td style={cellStyle}>
                {(() => {
                  const plateKey = String(v.plateNumber ?? "").trim().toLowerCase();
                  const dynamicCount = plateKey ? completedServicesByPlate[plateKey] : undefined;
                  const finalCount = Number.isFinite(dynamicCount as number)
                    ? Number(dynamicCount)
                    : Number(v.completedServicesCount ?? 0);
                  return <span className="count-badge">{finalCount.toString()} {t("services")}</span>;
                })()}
              </td>

              <td style={{ ...cellStyle, textAlign: "right", paddingRight: 12 }}>
                {(canView || canUpdate || canDelete) && (
                  <div className="action-dropdown-container" style={{ position: "relative", display: "flex", justifyContent: "flex-end", width: "100%", paddingRight: 0 }}>
                    <button
                      className={`btn-action-dropdown ${activeDropdown === v.id ? "active" : ""}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const isActive = activeDropdown === v.id;
                        if (isActive) {
                          setActiveDropdown(null);
                          return;
                        }
                        const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                        const menuHeight = 220;
                        const menuWidth = 230;
                        const spaceBelow = window.innerHeight - rect.bottom;
                        const rawTop = spaceBelow < menuHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
                        const top = Math.max(8, Math.min(rawTop, window.innerHeight - menuHeight - 8));
                        const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
                        flushSync(() => {
                          setDropdownPosition({ top, left });
                          setActiveDropdown(v.id);
                        });
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 10px",
                        borderRadius: 9,
                        border: activeDropdown === v.id ? "none" : "1px solid #DDE7F6",
                        background: activeDropdown === v.id ? "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)" : "#F7F9FF",
                        color: activeDropdown === v.id ? "#FFFFFF" : "#5D54FF",
                        fontSize: "0.84rem",
                        fontWeight: 800,
                        cursor: "pointer",
                        boxShadow: activeDropdown === v.id ? "0 6px 14px rgba(78, 64, 248, 0.30)" : "none",
                        marginRight: 2,
                        minWidth: 102,
                        justifyContent: "center",
                      }}
                    >
                      <i className="fas fa-cogs"></i> {t("Actions")} <i className="fas fa-chevron-down"></i>
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
            style={{
              position: "fixed",
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              zIndex: 10050,
              minWidth: 230,
              background: "#FFFFFF",
              border: "1px solid #DDE7F6",
              borderRadius: 10,
              boxShadow: "0 18px 32px rgba(28, 45, 94, 0.18)",
              padding: 6,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {canView && (
              <button
                className="dropdown-item view"
                type="button"
                onClick={() => {
                  const selectedVehicleId = String(activeDropdown ?? "").trim();
                  if (!selectedVehicleId) return;
                  onView(selectedVehicleId);
                  setActiveDropdown(null);
                }}
                style={{
                  width: "100%",
                  border: "none",
                  background: "transparent",
                  color: "#2A3B66",
                  fontSize: "0.84rem",
                  fontWeight: 600,
                  padding: "9px 10px",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <i className="fas fa-eye"></i> {t("View Details")}
              </button>
            )}

            {(canView && (canUpdate || canDelete)) && <div className="dropdown-divider" style={{ height: 1, background: "#E6ECF8", margin: "4px 6px" }}></div>}

            {canUpdate && (
              <>
                <button
                  className="dropdown-item edit"
                  type="button"
                  onClick={() => {
                    const selectedVehicleId = String(activeDropdown ?? "").trim();
                    if (!selectedVehicleId) return;
                    onEdit(selectedVehicleId);
                    setActiveDropdown(null);
                  }}
                  style={{
                    width: "100%",
                    border: "none",
                    background: "transparent",
                    color: "#2A3B66",
                    fontSize: "0.84rem",
                    fontWeight: 600,
                    padding: "9px 10px",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <i className="fas fa-edit"></i> {t("Edit Vehicle")}
                </button>
                {canDelete && <div className="dropdown-divider" style={{ height: 1, background: "#E6ECF8", margin: "4px 6px" }}></div>}
              </>
            )}

            {canDelete && (
              <button
                className="dropdown-item delete"
                type="button"
                onClick={() => {
                  const selectedVehicleId = String(activeDropdown ?? "").trim();
                  if (!selectedVehicleId) return;
                  onDelete(selectedVehicleId);
                  setActiveDropdown(null);
                }}
                style={{
                  width: "100%",
                  border: "none",
                  background: "transparent",
                  color: "#B42318",
                  fontSize: "0.84rem",
                  fontWeight: 700,
                  padding: "9px 10px",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <i className="fas fa-trash"></i> {t("Delete Vehicle")}
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
  const { withLoading } = useGlobalLoading();
  const { canOption } = usePermissions();

  const canSearch = canOption("vehicles", "vehicles_search", true);
  const canAdd = permissions.canCreate && canOption("vehicles", "vehicles_add", true);
  const canViewDetails = permissions.canRead && canOption("vehicles", "vehicles_viewdetails", true);
  const canEdit = permissions.canUpdate && canOption("vehicles", "vehicles_edit", true);
  const canDelete = permissions.canDelete && canOption("vehicles", "vehicles_delete", true);
  const canVerifyCustomer = permissions.canUpdate && canOption("vehicles", "vehicles_verifycustomer", true);

  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>{t("You don't have access to this page.")}</div>;
  }

  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [completedServicesByPlate, setCompletedServicesByPlate] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [themeClass, setThemeClass] = useState<ArtTheme>(() => {
    if (typeof window === "undefined") return "theme-executive-minimal";
    const stored = window.localStorage.getItem("crm-customer-theme");
    return stored === "theme-elegant-glass" || stored === "theme-executive-minimal"
      ? stored
      : "theme-executive-minimal";
  });

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
  const [verifyAlert, setVerifyAlert] = useState<{ type: "warning" | "error" | "success"; title: string; message: string } | null>(null);

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
    const options: Array<string | { value: string; label: string }> = [{ value: "", label: t("Select manufacturer") }];
    const make = form.make.trim();
    if (make && !QATAR_MANUFACTURERS.includes(make)) {
      options.push({ value: make, label: `${make} ${t("(current)")}` });
    }
    options.push(...QATAR_MANUFACTURERS);
    return options;
  }, [form.make, t]);

  const catalogModelsForMake = useMemo(() => getModelsByManufacturer(form.make), [form.make]);
  const selectedMakeHasCatalog = catalogModelsForMake.length > 0;

  const modelOptions = useMemo<Array<string | { value: string; label: string }>>(() => {
    const options: Array<string | { value: string; label: string }> = [{ value: "", label: t("Select model") }];

    if (!selectedMakeHasCatalog) {
      const model = form.model.trim();
      if (model) options.push({ value: model, label: `${model} ${t("(current)")}` });
      return options;
    }

    options.push(...catalogModelsForMake);
    return options;
  }, [catalogModelsForMake, form.model, selectedMakeHasCatalog, t]);

  const colorOptions = useMemo<Array<string | { value: string; label: string }>>(() => {
    const options: Array<string | { value: string; label: string }> = [{ value: "", label: t("Select color") }];
    const color = form.color.trim();
    if (color && !VEHICLE_COLORS.includes(color)) {
      options.push({ value: color, label: `${color} ${t("(current)")}` });
    }
    options.push(...VEHICLE_COLORS);
    return options;
  }, [form.color, t]);

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

  const toggleTheme = useCallback(() => {
    setThemeClass((prev) => (prev === "theme-elegant-glass" ? "theme-executive-minimal" : "theme-elegant-glass"));
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.remove("theme-elegant-glass", "theme-executive-minimal");
    document.body.classList.add(themeClass);
    try {
      window.localStorage.setItem("crm-customer-theme", themeClass);
    } catch {
      // ignore localStorage failures in restricted contexts
    }
    return () => {
      document.body.classList.remove("theme-elegant-glass", "theme-executive-minimal");
    };
  }, [themeClass]);

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
  }, [showAlert, t]);

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

  // Verify helper (used by button + autosave)
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
      setVerifyAlert({ type: "warning", title: t("Missing Customer ID"), message: t("Please enter a customer ID before verifying.") });
      return;
    }
    setVerifyAlert(null);
    const c = await ensureVerifiedCustomer(customerId);
    if (!c) {
      setVerifiedCustomer(null);
      setVerifyAlert({ type: "error", title: t("Not Found"), message: t("Customer not found. Please use a valid Customer ID.") });
      return;
    }
    setForm((prev) => ({ ...prev, customerId: String(c.id ?? "").trim() }));
    setVerifyAlert({ type: "success", title: t("Verified"), message: `${t("Customer verified:")} ${c.name} ${c.lastname}` });
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

    // Auto verify on save
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

    // Auto verify on save
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

    setShowEditModal(false);
    setSelectedVehicleId(id);
    setViewMode("details");
  };

  // Load details view data
  useEffect(() => {
    if (viewMode !== "details" || !selectedVehicleId) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const fromList = vehicles.find((item) => item.id === selectedVehicleId) ?? null;
        const v = fromList ? null : await client.models.Vehicle.get({ id: selectedVehicleId });
        const vehicle = fromList ?? ((v as any)?.data ?? null);
        if (cancelled) return;
        setSelectedVehicle(vehicle);
        setSelectedCustomer(null);
        setCompletedOrders([]);
        setSelectedCustomerVehiclesCount(0);
        setSelectedCustomerCompletedServicesCount(0);
        setLoading(false);

        const customerId = String(vehicle?.customerId ?? "").trim();
        const plateNumber = String(vehicle?.plateNumber ?? "").trim();

        if (customerId) {
          void (async () => {
            try {
              let customerData: CustomerRow | null = null;
              if (customerByIdCacheRef.current.has(customerId)) {
                customerData = customerByIdCacheRef.current.get(customerId) ?? null;
              } else {
                const customerRes = await client.models.Customer.get({ id: customerId });
                customerData = (customerRes as any)?.data ?? null;
                customerByIdCacheRef.current.set(customerId, customerData);
              }
              if (!cancelled) setSelectedCustomer(customerData);
            } catch {
              if (!cancelled) setSelectedCustomer(null);
            }
          })();

          void (async () => {
            try {
              const byCustomer = await client.models.Vehicle.list({
                filter: { customerId: { eq: customerId } } as any,
                limit: 2000,
              } as any);
              if (!cancelled) setSelectedCustomerVehiclesCount((byCustomer.data ?? []).length);
            } catch {
              if (!cancelled) setSelectedCustomerVehiclesCount(0);
            }
          })();

          void (async () => {
            try {
              const completed = await client.models.JobOrder.list({
                filter: { customerId: { eq: customerId }, status: { eq: "COMPLETED" } } as any,
                limit: 5000,
              } as any);
              const direct = (completed.data ?? []).length;
              if (direct > 0) {
                if (!cancelled) setSelectedCustomerCompletedServicesCount(direct);
                return;
              }
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

              if (!uniquePlates.length) {
                if (!cancelled) setSelectedCustomerCompletedServicesCount(0);
                return;
              }

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

              if (!cancelled) setSelectedCustomerCompletedServicesCount(counts.reduce((sum, n) => sum + Number(n || 0), 0));
            } catch {
              if (!cancelled) setSelectedCustomerCompletedServicesCount(0);
            }
          })();
        }

        if (plateNumber) {
          void (async () => {
            try {
              if (completedOrdersByPlateRef.current.has(plateNumber)) {
                if (!cancelled) setCompletedOrders(completedOrdersByPlateRef.current.get(plateNumber) ?? []);
                return;
              }
              const ordersRes = await client.models.JobOrder.list({
                limit: 500,
                filter: { plateNumber: { eq: plateNumber }, status: { eq: "COMPLETED" } },
              });
              const rows = ((ordersRes as any)?.data ?? []) as JobOrderRow[];
              completedOrdersByPlateRef.current.set(plateNumber, rows);
              if (!cancelled) setCompletedOrders(rows);
            } catch {
              if (!cancelled) setCompletedOrders([]);
            }
          })();
        }
      } catch (e) {
        console.error(e);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [viewMode, selectedVehicleId, vehicles]);

  const closeDetails = () => {
    setShowEditModal(false);
    setViewMode("list");
    setSelectedVehicleId(null);
    setSelectedVehicle(null);
    setSelectedCustomer(null);
    setCompletedOrders([]);
    setSelectedCustomerVehiclesCount(0);
    setSelectedCustomerCompletedServicesCount(0);
  };

  type PremiumField = {
    key: string;
    iconClass: string;
    label: string;
    value: string;
  };

  const PremiumDetailsCard = ({
    title,
    iconClass,
    fields,
    forceSingleRow = false,
  }: {
    title: string;
    iconClass: string;
    fields: PremiumField[];
    forceSingleRow?: boolean;
  }) => (
    <div
      style={{
        position: "relative",
        background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)",
        borderRadius: 12,
        boxShadow: "0 10px 24px rgba(51, 84, 160, 0.08)",
        border: "1px solid #DDE7F6",
        overflow: "hidden",
        marginBottom: 6,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: 4,
          background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)",
          zIndex: 2,
        }}
      />
      <div
        style={{
          padding: "12px 16px 11px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "linear-gradient(180deg, #FEFEFF 0%, #FDFEFF 100%)",
          position: "relative",
          overflow: "hidden",
          borderBottom: "2px solid #DDE6F4",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -18,
            right: -22,
            height: 96,
            width: 202,
            background: "linear-gradient(to bottom left, rgba(67, 24, 255, 0.18), rgba(67, 24, 255, 0))",
            borderBottomLeftRadius: 999,
            pointerEvents: "none",
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 28,
            top: 26,
            width: 44,
            height: 44,
            borderRadius: 14,
            opacity: 0.35,
            backgroundImage:
              "radial-gradient(circle, rgba(116, 137, 191, 0.55) 1.4px, transparent 1.5px)",
            backgroundSize: "10px 10px",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)",
              border: "1px solid #D8E1F7",
              boxShadow: "0 0 0 4px rgba(101, 92, 255, 0.08), 0 6px 14px rgba(71, 88, 180, 0.10)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#5D54FF",
            }}
          >
            <i className={iconClass} style={{ fontSize: 13 }} />
          </div>
          <h3
            style={{
              margin: 0,
              fontSize: 11,
              fontWeight: 800,
              color: "#111827",
              lineHeight: 1.34,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            {title}
          </h3>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: forceSingleRow
            ? `repeat(${Math.max(fields.length, 1)}, minmax(160px, 1fr))`
            : "repeat(4, minmax(0, 1fr))",
          background: "#FFFFFF",
          overflowX: forceSingleRow ? "auto" : "visible",
        }}
      >
        {fields.map((f, idx) => (
          <div
            key={f.key}
            style={{
              minHeight: 114,
              padding: "20px 18px 18px",
              borderLeft: idx === 0 ? "none" : "1px solid #E3EAF6",
              background: "linear-gradient(180deg, #FFFFFF 0%, #FBFDFF 100%)",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)",
                border: "1px solid #DDE6F5",
                color: "#5C55FF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 14,
                boxShadow: "0 0 0 3px rgba(92, 85, 255, 0.05)",
              }}
            >
              <i className={f.iconClass} style={{ fontSize: 12 }} />
            </div>
            <span
              style={{
                display: "block",
                fontSize: "10.5px",
                fontWeight: 600,
                color: "#6F7EA8",
                textTransform: "none",
                letterSpacing: "0.01em",
                marginBottom: 7,
                lineHeight: 1.4,
              }}
            >
              {f.label}
            </span>
            <span
              style={{
                display: "block",
                fontSize: "0.92rem",
                fontWeight: 600,
                color: "#0F2A66",
                lineHeight: 1.34,
                letterSpacing: "0.01em",
                wordBreak: "break-word",
              }}
            >
              {f.value || "-"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  // ----------------------
  // Loading Details Screen Component
  // ----------------------
  const LoadingDetailsScreen = () => (
    <div
      style={{
        background: "linear-gradient(145deg, #f8fafe 0%, #eef3ff 100%)",
        minHeight: "calc(100vh - 120px)",
        borderRadius: 18,
        padding: "16px 8px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "linear-gradient(145deg, #f7f9ff 0%, #f3f6fd 45%, #eef3ff 100%)",
          border: "1px solid #DBE4F6",
          borderRadius: 16,
          boxShadow: "0 8px 18px rgba(112, 144, 176, 0.10)",
          padding: "40px 32px",
          width: "100%",
          maxWidth: 500,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)",
          }}
        />
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 14,
              background: "linear-gradient(140deg, #1EC7C7 0%, #6D4FFF 100%)",
              boxShadow: "0 6px 12px rgba(98, 109, 229, 0.20)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              margin: "0 auto 20px",
              animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
            }}
          >
            <i className="fas fa-spinner" style={{ fontSize: 24, animation: "spin 1s linear infinite" }} />
          </div>
          <h2 style={{ margin: "0 0 8px 0", color: "#102A68", fontSize: 18, fontWeight: 700 }}>
            {t("Loading Vehicle")}...
          </h2>
          <p style={{ margin: "0 0 0 0", color: "#6F7EA8", fontSize: 13, fontWeight: 500 }}>
            {t("Please wait while we fetch your data")}
          </p>
        </div>
      </div>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );

  // ----------------------
  // Details View
  // ----------------------
  if (viewMode === "details") {
    if (loading || !selectedVehicle) {
      return <LoadingDetailsScreen />;
    }

    return (
      <>
        <div
          className={`pim-details-screen customer-details-screen dashboard-customer-details-bg vehicle-details-exact ${themeClass}`}
          style={{
            background: "linear-gradient(145deg, #f8fafe 0%, #eef3ff 100%)",
            minHeight: "calc(100vh - 120px)",
            borderRadius: 18,
            padding: "16px 8px",
          }}
        >
          <div
            className="customer-details-page-header"
            style={{
              position: "relative",
              overflow: "hidden",
              marginBottom: 0,
              background: "linear-gradient(145deg, #f7f9ff 0%, #f3f6fd 45%, #eef3ff 100%)",
              border: "1px solid #DBE4F6",
              borderRadius: 16,
              boxShadow: "0 8px 18px rgba(112, 144, 176, 0.10)",
              padding: "12px 14px 10px",
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                backgroundImage:
                  "linear-gradient(90deg, rgba(255,255,255,0.52) 0%, rgba(255,255,255,0.08) 26%, rgba(255,255,255,0.38) 44%, rgba(255,255,255,0.08) 63%, rgba(255,255,255,0.45) 100%)",
              }}
            />

            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: "14%",
                right: -3,
                bottom: -1,
                height: "40%",
                pointerEvents: "none",
                backgroundImage:
                  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 1300 260\' preserveAspectRatio=\'none\'%3E%3Cpath d=\'M0 214 C 116 220 214 210 300 178 C 366 154 447 104 546 110 C 593 113 626 126 668 119 C 754 103 843 46 931 64 C 976 73 1011 100 1058 108 C 1134 121 1212 77 1300 91\' fill=\'none\' stroke=\'%2307D3B0\' stroke-opacity=\'0.8\' stroke-width=\'5.5\'/%3E%3Ccircle cx=\'546\' cy=\'110\' r=\'5.5\' fill=\'%2394EFE1\'/%3E%3Ccircle cx=\'931\' cy=\'64\' r=\'5.5\' fill=\'%2394EFE1\'/%3E%3C/svg%3E"), url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 1300 260\' preserveAspectRatio=\'none\'%3E%3Cpath d=\'M0 246 C 120 248 233 248 342 242 C 458 236 542 200 623 151 C 700 104 781 93 845 111 C 894 123 934 150 987 147 C 1057 143 1124 85 1207 78 C 1240 75 1269 84 1300 99\' fill=\'none\' stroke=\'%236C4CFF\' stroke-opacity=\'0.8\' stroke-width=\'5.5\'/%3E%3Ccircle cx=\'845\' cy=\'111\' r=\'5.5\' fill=\'%23B3A1FF\'/%3E%3Ccircle cx=\'987\' cy=\'147\' r=\'5.5\' fill=\'%23B3A1FF\'/%3E%3Ccircle cx=\'1207\' cy=\'78\' r=\'5.5\' fill=\'%23B3A1FF\'/%3E%3C/svg%3E"), linear-gradient(180deg, rgba(248,250,255,0) 0%, rgba(247,249,255,0.92) 82%, rgba(247,249,255,0.98) 100%)',
                backgroundPosition: "bottom right, bottom right, bottom right",
                backgroundRepeat: "no-repeat, no-repeat, no-repeat",
                backgroundSize: "100% 100%, 100% 100%, 100% 100%",
              }}
            />

            <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <button
                className="customer-details-back-btn"
                onClick={() => {
                  closeDetails();
                  if (navigationData?.source && onNavigateBack) {
                    onNavigateBack(navigationData.source, navigationData.returnToCustomer ?? null);
                  }
                }}
                type="button"
                style={{
                  border: "1px solid #D6E0F4",
                  background: "rgba(255,255,255,0.88)",
                  color: "#6675A3",
                  borderRadius: 10,
                  height: 36,
                  padding: "0 9px",
                  fontSize: 12,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                  boxShadow: "0 3px 7px rgba(157, 176, 220, 0.11)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 7,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "linear-gradient(135deg, #F5F8FF, #E9EEFF)",
                    border: "1px solid #D8E2F8",
                    color: "#5E42FF",
                    flexShrink: 0,
                  }}
                >
                  <i className="fas fa-arrow-left" style={{ fontSize: 10 }} />
                </span>
                {t("Back to Vehicles")}
              </button>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  className="customer-theme-toggle-btn"
                  onClick={toggleTheme}
                  type="button"
                  style={{
                    border: "1px solid #DDE5F8",
                    background: "rgba(255,255,255,0.92)",
                    color: "#1E2F67",
                    borderRadius: 12,
                    height: 40,
                    padding: "0 10px",
                    fontSize: 12,
                    fontWeight: 800,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                    boxShadow: "0 6px 12px rgba(112, 144, 176, 0.08)",
                    backdropFilter: "blur(10px)",
                    WebkitBackdropFilter: "blur(10px)",
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#5E42FF",
                      flexShrink: 0,
                    }}
                  >
                    <i className="fas fa-gem" style={{ fontSize: 11 }} />
                  </span>
                  {themeClass === "theme-elegant-glass" ? t("Elegant Glass") : t("Executive Minimal")}
                </button>
                <PermissionGate moduleId="vehicles" optionId="vehicles_edit" fallback={null}>
                  {canEdit && (
                    <button
                      className="btn-action btn-edit customer-details-edit-btn"
                      onClick={() => openEditModal(selectedVehicle.id)}
                      type="button"
                      style={{
                        border: "none",
                        background: "linear-gradient(135deg, #5B33FF 0%, #00D1BE 100%)",
                        color: "#ffffff",
                        borderRadius: 12,
                        height: 40,
                        padding: "0 10px",
                        fontSize: 12,
                        fontWeight: 800,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        cursor: "pointer",
                        boxShadow: "0 7px 14px rgba(67, 24, 255, 0.22)",
                      }}
                    >
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <i className="fas fa-edit" style={{ fontSize: 11 }} />
                      </span>
                      {t("Edit Vehicle")}
                    </button>
                  )}
                </PermissionGate>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  background: "linear-gradient(140deg, #1EC7C7 0%, #6D4FFF 100%)",
                  boxShadow: "0 6px 12px rgba(98, 109, 229, 0.20)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ffffff",
                  flexShrink: 0,
                }}
              >
                <User size={20} strokeWidth={2.1} />
              </div>

              <div style={{ minWidth: 0 }}>
                <h1
                  className="customer-details-page-title"
                  style={{
                    margin: 0,
                    color: "#102A68",
                    fontSize: 20,
                    fontWeight: 700,
                    lineHeight: 1.15,
                    letterSpacing: "-0.03em",
                  }}
                >
                  {t("Vehicle Details")}
                </h1>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6 }}>
                  <span
                    style={{
                      width: 2,
                      alignSelf: "stretch",
                      borderRadius: 999,
                      background: "linear-gradient(180deg, #00D1BE 0%, #5E42FF 100%)",
                    }}
                  />
                  <p
                    className="customer-details-page-subtitle"
                    style={{
                      margin: 0,
                      color: "#6F7EA8",
                      fontSize: "10.5px",
                      fontWeight: 600,
                      letterSpacing: "0.01em",
                      lineHeight: 1.4,
                    }}
                  >
                    {resolveVehicleIdDisplay(selectedVehicle)}
                  </p>
                </div>
              </div>
            </div>
            </div>
          </div>

          <div className="pim-details-body customer-details-body" style={{ padding: 0, marginTop: 8 }}>
            <div className="pim-details-grid customer-details-grid" style={{ display: "grid", gap: 6, marginTop: 0 }}>
              <PremiumDetailsCard
                title={t("Customer Information")}
                iconClass="fas fa-user"
                forceSingleRow
                fields={[
                  { key: "customer-id", iconClass: "fas fa-hashtag", label: t("Customer ID"), value: formatCustomerDisplayId(selectedVehicle.customerId) },
                  { key: "customer-name", iconClass: "fas fa-id-badge", label: t("Customer Name"), value: selectedCustomer ? `${selectedCustomer.name} ${selectedCustomer.lastname}` : selectedVehicle.ownedBy ?? "-" },
                  { key: "customer-mobile", iconClass: "fas fa-phone", label: t("Mobile"), value: selectedCustomer?.phone ?? t("Not provided") },
                  { key: "customer-email", iconClass: "fas fa-envelope", label: t("Email"), value: selectedCustomer?.email ?? t("Not provided") },
                  { key: "customer-vehicles", iconClass: "fas fa-car", label: t("Vehicles"), value: String(selectedCustomerVehiclesCount) },
                  { key: "customer-services", iconClass: "fas fa-check-circle", label: t("Completed"), value: String(selectedCustomerCompletedServicesCount) },
                ]}
              />

              <PremiumDetailsCard
                title={t("Vehicle Information")}
                iconClass="fas fa-car"
                fields={[
                  { key: "vehicle-id", iconClass: "fas fa-hashtag", label: t("Vehicle ID"), value: resolveVehicleIdDisplay(selectedVehicle) },
                  { key: "vehicle-make", iconClass: "fas fa-industry", label: t("Make"), value: selectedVehicle.make ?? "-" },
                  { key: "vehicle-model", iconClass: "fas fa-tag", label: t("Model"), value: selectedVehicle.model ?? "-" },
                  { key: "vehicle-year", iconClass: "fas fa-calendar", label: t("Year"), value: selectedVehicle.year ?? "-" },
                  { key: "vehicle-type", iconClass: "fas fa-shapes", label: t("Type"), value: selectedVehicle.vehicleType ?? "-" },
                  { key: "vehicle-color", iconClass: "fas fa-palette", label: t("Color"), value: selectedVehicle.color ?? "-" },
                  { key: "vehicle-plate", iconClass: "fas fa-id-card", label: t("Plate Number"), value: selectedVehicle.plateNumber ?? "-" },
                  { key: "vehicle-vin", iconClass: "fas fa-fingerprint", label: t("VIN"), value: selectedVehicle.vin ?? t("N/A") },
                ]}
              />

              <div
                className="pim-detail-card customer-details-card customer-details-card--wide"
                style={{
                  background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)",
                  borderRadius: 12,
                  boxShadow: "0 10px 24px rgba(51, 84, 160, 0.08)",
                  border: "1px solid #DDE7F6",
                  overflow: "hidden",
                }}
              >
                <div style={{ height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)" }} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                  <h3
                    className="text-lg font-bold text-[#2B3674] mb-0 customer-details-card-title"
                    style={{ color: "#111827", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", padding: 0, margin: 0 }}
                  >
                    <i className="fas fa-tasks" /> {t("Completed Services (from Job Orders)")}
                  </h3>
                  <button
                    className="btn-new-customer customer-primary-btn"
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
                    style={{
                      border: "none",
                      background: "linear-gradient(135deg, #5B33FF 0%, #00D1BE 100%)",
                      color: "#ffffff",
                      borderRadius: 12,
                      height: 40,
                      padding: "0 10px",
                      fontSize: 12,
                      fontWeight: 800,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      cursor: "pointer",
                      boxShadow: "0 7px 14px rgba(67, 24, 255, 0.22)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <i className="fas fa-plus-circle" style={{ fontSize: 11 }} />
                    </span>
                    {t("Add New Order")}
                  </button>
                </div>
                <div style={{ height: 1, background: "#DDE7F6", marginBottom: 12 }} />

                <div className="customer-activity-table-wrap">
                  <table className="vehicles-table customer-dashboard-table" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
                    <thead>
                      <tr>
                        <th style={{ color: "#111827", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("Order #")}</th>
                        <th style={{ color: "#111827", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("Status")}</th>
                        <th style={{ color: "#111827", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("Payment")}</th>
                        <th style={{ color: "#111827", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("Total")}</th>
                        <th style={{ color: "#111827", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("Updated")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {completedOrders.length ? (
                        completedOrders.map((o) => (
                          <tr key={o.id}>
                            <td style={{ color: "#0F2A66", fontSize: "0.92rem", fontWeight: 600 }}>{o.orderNumber ?? o.id}</td>
                            <td style={{ color: "#0F2A66", fontSize: "0.92rem", fontWeight: 600 }}>{o.status ?? "-"}</td>
                            <td style={{ color: "#0F2A66", fontSize: "0.92rem", fontWeight: 600 }}>{normalizePaymentStatusLabel(o.paymentStatus)}</td>
                            <td style={{ color: "#0F2A66", fontSize: "0.92rem", fontWeight: 600 }}>{typeof o.totalAmount === "number" ? `QAR ${o.totalAmount.toFixed(2)}` : "-"}</td>
                            <td style={{ color: "#0F2A66", fontSize: "0.92rem", fontWeight: 600 }}>{o.updatedAt ? new Date(o.updatedAt).toLocaleString() : "-"}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} style={{ textAlign: "center", padding: 30, opacity: 0.8 }}>
                            {t("No completed job orders found for this vehicle (matched by plate number).")}
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
          title={t("Edit Vehicle")}
          icon="fas fa-car"
          onClose={() => {
            setShowEditModal(false);
            resetForm();
            setSelectedVehicleId(null);
          }}
          onSave={() => void withLoading(handleUpdateVehicle(), t("Saving vehicle changes..."))}
          isEdit
          saving={saving}
          saveLabel={t("Save Changes")}
        >
          <div className="modal-form">
            <div className="verify-row">
              <FormField
                label={t("Customer ID")}
                id="editCustomerId"
                placeholder={t("Enter Customer ID")}
                value={form.customerId}
                onChange={(e) => { setForm((p) => ({ ...p, customerId: e.target.value })); setVerifyAlert(null); }}
                error={errors.customerId}
                required
              />
              <PermissionGate moduleId="vehicles" optionId="vehicles_verifycustomer" fallback={null}>
                {canVerifyCustomer && (
                  <button className="btn-verify" type="button" onClick={() => verifyCustomer(form.customerId)}>
                    <i className="fas fa-check-circle"></i> {t("Verify")}
                  </button>
                )}
              </PermissionGate>
            </div>

            {verifyAlert && (
              <div className={`verify-inline-alert verify-inline-alert--${verifyAlert.type}`}>
                <div className="verify-inline-alert__icon">
                  <i className={verifyAlert.type === "success" ? "fas fa-check-circle" : verifyAlert.type === "warning" ? "fas fa-exclamation-triangle" : "fas fa-times-circle"}></i>
                </div>
                <div className="verify-inline-alert__body">
                  <strong>{verifyAlert.title}</strong>
                  <span>{verifyAlert.message}</span>
                </div>
                <button className="verify-inline-alert__close" onClick={() => setVerifyAlert(null)} type="button">×</button>
              </div>
            )}

            {verifiedCustomer && (
              <div className="verified-banner">
                <i className="fas fa-check-circle"></i> {t("Verified:")} {verifiedCustomer.name} {verifiedCustomer.lastname}
              </div>
            )}

            <div className="form-grid-2">
              <FormField
                label={t("Vehicle ID")}
                id="editVehicleId"
                value={form.vehicleId}
                onChange={(e) => setForm((p) => ({ ...p, vehicleId: e.target.value }))}
                disabled
                hint={t("Vehicle ID is not editable.")}
              />
              <FormField
                label={t("Plate Number")}
                id="editPlate"
                placeholder={t("e.g. 123456")}
                value={form.plateNumber}
                onChange={(e) => setForm((p) => ({ ...p, plateNumber: e.target.value }))}
                error={errors.plateNumber}
                required
              />
              <FormField
                label={t("Make")}
                id="editMake"
                type="select"
                value={form.make}
                onChange={(e) => setForm((p) => ({ ...p, make: e.target.value }))}
                error={errors.make}
                required
                options={manufacturerOptions}
              />
              <FormField
                label={t("Model")}
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
                label={t("Year")}
                id="editYear"
                placeholder={t("e.g. 2024")}
                value={form.year}
                onChange={(e) => setForm((p) => ({ ...p, year: e.target.value }))}
                error={errors.year}
                required
              />
              <FormField
                label={t("Vehicle Type")}
                id="editType"
                type="select"
                value={form.vehicleType}
                onChange={(e) => setForm((p) => ({ ...p, vehicleType: e.target.value }))}
                error={errors.vehicleType}
                required
                options={[
                  { value: "", label: t("Select type") },
                  { value: "Sedan", label: t("Sedan") },
                  { value: "SUV", label: t("SUV") },
                  { value: "Truck", label: t("Truck") },
                  { value: "Coupe", label: t("Coupe") },
                  { value: "Hatchback", label: t("Hatchback") },
                  { value: "Van", label: t("Van") },
                  { value: "Motorbike", label: t("Motorbike") },
                  { value: "Other", label: t("Other") },
                ]}
              />
              <FormField
                label={t("Color")}
                id="editColor"
                type="select"
                value={form.color}
                onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                error={errors.color}
                required
                options={colorOptions}
              />
              <FormField
                label={t("VIN")}
                id="editVin"
                placeholder={t("Optional")}
                value={form.vin}
                onChange={(e) => setForm((p) => ({ ...p, vin: e.target.value }))}
                required={false}
              />
            </div>

            <FormField
              label={t("Notes")}
              id="editNotes"
              placeholder={t("Optional")}
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
    <div
      className={`vehicle-page customer-page customer-dashboard-shell ${themeClass}`}
      id="mainScreen"
      style={{ background: "linear-gradient(145deg, #f8fafe 0%, #eef3ff 100%)", minHeight: "100vh" }}
    >
      <main className="main-content customer-dashboard-main" style={{ padding: "16px 8px" }}>
        <section
          style={{
            position: "relative",
            overflow: "hidden",
            marginBottom: 10,
            background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)",
            borderRadius: 12,
            boxShadow: "0 10px 24px rgba(51, 84, 160, 0.08)",
            border: "1px solid #DDE7F6",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: 4,
              background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)",
              zIndex: 2,
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: -18,
              right: -22,
              height: 96,
              width: 202,
              background: "linear-gradient(to bottom left, rgba(67, 24, 255, 0.18), rgba(67, 24, 255, 0))",
              borderBottomLeftRadius: 999,
              pointerEvents: "none",
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              right: 28,
              top: 26,
              width: 44,
              height: 44,
              borderRadius: 14,
              opacity: 0.35,
              backgroundImage: "radial-gradient(circle, rgba(116, 137, 191, 0.55) 1.4px, transparent 1.5px)",
              backgroundSize: "10px 10px",
              pointerEvents: "none",
            }}
          />
          <div style={{ position: "relative", zIndex: 1, padding: "17px 24px 17px", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 17 }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: "50%",
                    background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)",
                    border: "1px solid #D8E1F7",
                    boxShadow: "0 0 0 4px rgba(101, 92, 255, 0.08), 0 6px 14px rgba(71, 88, 180, 0.10)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#5D54FF",
                  }}
                >
                  <i className="fas fa-car" style={{ fontSize: 16 }} />
                </div>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#102A68", lineHeight: 1.15, letterSpacing: "-0.03em" }}>
                  {t("Vehicles")}
                </h1>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", fontSize: "0.88rem", fontWeight: 700, cursor: "pointer" }}
                  onClick={toggleTheme}
                  type="button"
                >
                  <i className="fas fa-palette" />
                  {themeClass === "theme-elegant-glass" ? t("Elegant Glass") : t("Executive Minimal")}
                </button>

                {canSearch ? (
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <i className="fas fa-search" style={{ position: "absolute", left: 10, color: "#8C9ABF", fontSize: 12, pointerEvents: "none" }} />
                    <input
                      type="text"
                      style={{ paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderRadius: 8, border: "1px solid #DDE7F6", background: "#FAFBFF", color: "#102A68", fontSize: "0.88rem", fontWeight: 700, outline: "none", minWidth: 220 }}
                      placeholder={t("Search by any vehicle details")}
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setCurrentPage(1);
                      }}
                      autoComplete="off"
                    />
                  </div>
                ) : (
                  <div style={{ position: "relative", display: "flex", alignItems: "center", opacity: 0.7 }}>
                    <i className="fas fa-lock" style={{ position: "absolute", left: 10, color: "#8C9ABF", fontSize: 12, pointerEvents: "none" }} />
                    <input
                      type="text"
                      style={{ paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderRadius: 8, border: "1px solid #DDE7F6", background: "#F5F7FF", color: "#8C9ABF", fontSize: "0.88rem", fontWeight: 700, outline: "none", minWidth: 220 }}
                      placeholder={t("Search is disabled for your role")}
                      value=""
                      disabled
                      readOnly
                    />
                  </div>
                )}

                <button
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", fontSize: "0.88rem", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}
                  onClick={() => {
                    void loadVehicles();
                    void loadCompletedServicesByPlate();
                  }}
                  disabled={loading}
                  type="button"
                >
                  <i className="fas fa-sync" /> {loading ? t("Loading...") : t("Refresh")}
                </button>

                <PermissionGate moduleId="vehicles" optionId="vehicles_add" fallback={null}>
                  {canAdd && (
                    <button
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 8, border: "none", background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", color: "#fff", fontSize: "0.88rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 12px rgba(78, 64, 248, 0.25)" }}
                      onClick={openAddModal}
                      type="button"
                    >
                      <i className="fas fa-plus-circle" /> {t("Add New Vehicle")}
                    </button>
                  )}
                </PermissionGate>
              </div>
            </div>

            <p style={{ margin: 0, marginLeft: 59, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: "#8C9ABF", fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1.35 }}>
              <span
                aria-hidden="true"
                style={{ width: 2, height: 12, borderRadius: 999, background: "linear-gradient(180deg, #25D6E8 0%, #4E40F8 100%)", boxShadow: "0 0 0 2px rgba(78, 64, 248, 0.10)" }}
              />
              <span style={{ color: "#7E8FB9" }}>{t("Manage vehicle information, ownership, and completed services.")}</span>
            </p>
          </div>
        </section>

        <section style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: "8px 4px", marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: "#8C9ABF", fontWeight: 600 }}>
            {loading ? (
              t("Loading vehicles...")
            ) : searchResults.length === 0 ? (
              t("No vehicles found")
            ) : (
              <>
                {t("Showing")} {Math.min((currentPage - 1) * pageSize + 1, searchResults.length)}-
                {Math.min(currentPage * pageSize, searchResults.length)} {t("of")} <strong style={{ color: "#102A68", fontSize: "0.88rem", fontWeight: 700 }}>{searchResults.length}</strong> {t("vehicles")}
                {canSearch && searchQuery && (
                  <span style={{ color: "#5D54FF" }}> {`(${t("Filtered by:")}: "${searchQuery}")`}</span>
                )}
              </>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label htmlFor="pageSizeSelect" style={{ fontSize: 10, color: "#8C9ABF", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em" }}>{t("Records per page:")}</label>
              <select
                id="pageSizeSelect"
                className="page-size-select"
                value={pageSize}
                style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #DDE7F6", background: "#FAFBFF", color: "#112A6D", fontSize: "0.88rem", fontWeight: 700, outline: "none" }}
                onChange={(e) => {
                  setPageSize(parseInt(e.target.value, 10));
                  setCurrentPage(1);
                }}
              >
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
          </div>
        </section>

        <section
          className="results-section customer-results-section"
          style={{
            position: "relative",
            background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)",
            borderRadius: 12,
            boxShadow: "0 10px 24px rgba(51, 84, 160, 0.08)",
            border: "1px solid #DDE7F6",
            overflow: "hidden",
            marginBottom: 6,
          }}
        >
          <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />
          <div style={{ paddingTop: 4 }}>
          <VehiclesTable
            data={paginatedData}
            searchQuery={searchQuery}
            loading={loading}
            onView={(id) => void withLoading(openDetails(id), t("Loading vehicle details..."))}
            onEdit={openEditModal}
            onDelete={handleDeleteVehicle}
            canView={canViewDetails}
            canUpdate={canEdit}
            canDelete={canDelete}
            completedServicesByPlate={completedServicesByPlate}
          />

          {totalPages > 1 && (
            <div className="pagination" style={{ borderTop: "1px solid #E4ECF7", padding: "10px 0 4px", marginTop: 0 }}>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
                style={{ border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", borderRadius: 8, minWidth: 34, height: 34, fontWeight: 700 }}
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
                    style={{
                      border: pageNum === currentPage ? "none" : "1px solid #DDE7F6",
                      background: pageNum === currentPage ? "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)" : "#F7F9FF",
                      color: pageNum === currentPage ? "#FFFFFF" : "#5D54FF",
                      borderRadius: 8,
                      minWidth: 34,
                      height: 34,
                      fontWeight: 700,
                      boxShadow: pageNum === currentPage ? "0 4px 12px rgba(78, 64, 248, 0.25)" : "none",
                    }}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                className="pagination-btn"
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages}
                style={{ border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", borderRadius: 8, minWidth: 34, height: 34, fontWeight: 700 }}
              >
                <i className="fas fa-chevron-right"></i>
              </button>
            </div>
          )}
          </div>
        </section>
      </main>

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
        onSave={() => void withLoading(handleCreateVehicle(), t("Creating vehicle..."))}
        saving={saving}
        saveLabel={t("Add Vehicle")}
      >
        <div className="modal-form vehicle-create-form">
          <div className="verify-row vehicle-create-verify-row">
            <FormField
              label={t("Customer ID")}
              id="newCustomerId"
              placeholder={t("Enter Customer ID")}
              value={form.customerId}
              onChange={(e) => { setForm((p) => ({ ...p, customerId: e.target.value })); setVerifyAlert(null); }}
              error={errors.customerId}
              required
            />
              <PermissionGate moduleId="vehicles" optionId="vehicles_verifycustomer" fallback={null}>
                {canVerifyCustomer && (
                  <button className="btn-verify" type="button" onClick={() => verifyCustomer(form.customerId)}>
                    <i className="fas fa-check-circle"></i> {t("Verify")}
                  </button>
                )}
              </PermissionGate>
          </div>

          {verifyAlert && (
            <div className={`verify-inline-alert verify-inline-alert--${verifyAlert.type}`}>
              <div className="verify-inline-alert__icon">
                <i className={verifyAlert.type === "success" ? "fas fa-check-circle" : verifyAlert.type === "warning" ? "fas fa-exclamation-triangle" : "fas fa-times-circle"}></i>
              </div>
              <div className="verify-inline-alert__body">
                <strong>{verifyAlert.title}</strong>
                <span>{verifyAlert.message}</span>
              </div>
              <button className="verify-inline-alert__close" onClick={() => setVerifyAlert(null)} type="button">×</button>
            </div>
          )}

          {verifiedCustomer && (
            <div className="verified-banner">
              <i className="fas fa-check-circle"></i> {t("Verified:")} {verifiedCustomer.name} {verifiedCustomer.lastname}
            </div>
          )}

          <div className="form-grid-2">
            <FormField
              label={t("Vehicle ID")}
              id="newVehicleId"
              value={form.vehicleId}
              onChange={(e) => setForm((p) => ({ ...p, vehicleId: e.target.value }))}
              error={errors.vehicleId}
              required
              disabled
              hint={t("Auto-generated")}
            />
            <FormField
              label={t("Plate Number")}
              id="newPlate"
              placeholder={t("e.g. 123456")}
              value={form.plateNumber}
              onChange={(e) => setForm((p) => ({ ...p, plateNumber: e.target.value }))}
              error={errors.plateNumber}
              required
            />

            <FormField
              label={t("Make")}
              id="newMake"
              type="select"
              value={form.make}
              onChange={(e) => setForm((p) => ({ ...p, make: e.target.value }))}
              error={errors.make}
              required
              options={manufacturerOptions}
            />
            <FormField
              label={t("Model")}
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
              label={t("Year")}
              id="newYear"
              placeholder={t("e.g. 2024")}
              value={form.year}
              onChange={(e) => setForm((p) => ({ ...p, year: e.target.value }))}
              error={errors.year}
              required
            />

            <FormField
              label={t("Vehicle Type")}
              id="newType"
              type="select"
              value={form.vehicleType}
              onChange={(e) => setForm((p) => ({ ...p, vehicleType: e.target.value }))}
              error={errors.vehicleType}
              required
              options={[
                { value: "", label: t("Select type") },
                { value: "Sedan", label: t("Sedan") },
                { value: "SUV", label: t("SUV") },
                { value: "Truck", label: t("Truck") },
                { value: "Coupe", label: t("Coupe") },
                { value: "Hatchback", label: t("Hatchback") },
                { value: "Van", label: t("Van") },
                { value: "Motorbike", label: t("Motorbike") },
                { value: "Other", label: t("Other") },
              ]}
            />

            <FormField
              label={t("Color")}
              id="newColor"
              type="select"
              value={form.color}
              onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
              error={errors.color}
              required
              options={colorOptions}
            />

            <FormField
              label={t("VIN")}
              id="newVin"
              placeholder={t("Optional")}
              value={form.vin}
              onChange={(e) => setForm((p) => ({ ...p, vin: e.target.value }))}
              required={false}
            />
          </div>

          <FormField
            label={t("Notes")}
            id="newNotes"
            placeholder={t("Optional")}
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
                  <i className="fas fa-exclamation-triangle"></i> {t("Confirm Deletion")}
                </h3>
              </div>
              <div className="delete-modal-body">
                <div className="delete-warning">
                  <i className="fas fa-exclamation-circle"></i>
                  <div className="delete-warning-text">
                    <p>
                      {t("You are about to delete vehicle")} <strong>{resolveVehicleIdDisplay(deleteVehicle)}</strong>.
                    </p>
                    <p>{t("This action cannot be undone.")}</p>
                  </div>
                </div>

                <div className="delete-modal-actions">
                  <button className="btn-confirm-delete" onClick={() => void withLoading(confirmDeleteVehicle(), t("Deleting vehicle..."))} disabled={saving}>
                    <i className="fas fa-trash"></i> {t("Delete Vehicle")}
                  </button>
                  <button className="btn-cancel" onClick={() => setDeleteVehicle(null)} disabled={saving}>
                    <i className="fas fa-times"></i> {t("Cancel")}
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
