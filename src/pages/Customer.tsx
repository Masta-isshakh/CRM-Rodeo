// src/pages/Customers.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { generateClient } from "aws-amplify/data";
import { getCurrentUser } from "aws-amplify/auth";
import { resolveActorUsername } from "../utils/actorIdentity";
import { formatCustomerDisplayId } from "../utils/customerId";
import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";
import { logActivity } from "../utils/activityLogger";
import { matchesSearchQuery, splitSearchTerms } from "../lib/searchUtils";
import { usePermissions } from "../lib/userPermissions";
import { useLanguage } from "../i18n/LanguageContext";
import { useGlobalLoading } from "../utils/GlobalLoadingContext";
import { User } from "lucide-react";

const client = generateClient<Schema>();

type CustomerRow = Schema["Customer"]["type"];
type ContactRow = Schema["Contact"]["type"];
type DealRow = Schema["Deal"]["type"];
type TicketRow = Schema["Ticket"]["type"];
type VehicleRow = Schema["Vehicle"]["type"];

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

type ArtTheme = "theme-elegant-glass" | "theme-executive-minimal";

type CustomerForm = {
  name: string;
  lastname: string;
  phone: string;
  email: string;
  company: string;
  notes: string;
  heardFrom: string;
  referralPersonName: string;
  referralPersonMobile: string;
  socialPlatform: string;
  heardFromOtherNote: string;
};

type FormErrors = Partial<Record<keyof CustomerForm, string>>;

const HEARD_FROM_OPTIONS = [
  { value: "walk_in", label: "Walk-in" },
  { value: "refer_person", label: "Refer by person" },
  { value: "social_media", label: "Social media" },
  { value: "other", label: "Other" },
] as const;

const SOCIAL_PLATFORM_OPTIONS = [
  { value: "instagram", label: "Instagram" },
  { value: "twitter", label: "Twitter" },
  { value: "tiktok", label: "TikTok" },
  { value: "website", label: "Website" },
] as const;

type CountsMap = Record<
  string,
  {
    contacts: number;
    deals: number;
    tickets: number;
  }
>;

function replaceAllSafe(str: string, search: string, replacement: string) {
  return str.split(search).join(replacement);
}

function escapeHtml(input: string) {
  let s = String(input ?? "");
  s = replaceAllSafe(s, "&", "&amp;");
  s = replaceAllSafe(s, "<", "&lt;");
  s = replaceAllSafe(s, ">", "&gt;");
  s = replaceAllSafe(s, '"', "&quot;");
  s = replaceAllSafe(s, "'", "&#039;");
  return s;
}

// -----------------------------
// Alert Popup
// -----------------------------
function AlertPopup(props: {
  isOpen: boolean;
  title: string;
  message: string;
  type: AlertType;
  onClose: () => void;
  showCancel?: boolean;
  onConfirm?: () => void;
}) {
  const { t } = useLanguage();
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
    <div className="alert-popup-overlay show">
      <div className={`alert-popup alert-${type}`}>
        <div className="alert-popup-header">
          <div className="alert-popup-title">
            <i className={getIcon()} />
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
    </div>
  );
}

// -----------------------------
// Modal
// -----------------------------
function Modal(props: {
  isOpen: boolean;
  title: string;
  icon: string;
  children: React.ReactNode;
  onClose: () => void;
  onSave: () => void;
  isEdit?: boolean;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
}) {
  const { t } = useLanguage();
  const { isOpen, title, icon, children, onClose, onSave, isEdit, saving, saveDisabled, saveLabel } = props;
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
        className="modal"
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
        {/* Accent gradient bar */}
        <div
          style={{
            height: 4,
            background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)",
            flexShrink: 0,
          }}
        />

        {/* Header */}
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
            disabled={!!saving}
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

        {/* Body */}
        <div
          className="modal-body"
          style={{ padding: "22px 24px 6px", overflowY: "auto", maxHeight: "60vh" }}
        >
          {children}
        </div>

        {/* Footer */}
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
            disabled={!!saving || !!saveDisabled}
            style={{
              background:
                saving || saveDisabled
                  ? "linear-gradient(90deg, #b0aef8 0%, #a0e6ee 100%)"
                  : "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)",
              color: "#fff",
              border: "none",
              borderRadius: 9,
              padding: "10px 24px",
              fontSize: "0.85rem",
              fontWeight: 700,
              cursor: saving || saveDisabled ? "not-allowed" : "pointer",
              boxShadow: saving || saveDisabled ? "none" : "0 4px 14px rgba(78, 64, 248, 0.30)",
              display: "flex",
              alignItems: "center",
              gap: 7,
              letterSpacing: "0.01em",
              transition: "all 0.15s",
            }}
          >
            <i className="fas fa-save" style={{ fontSize: 12 }} />
            {saving ? t("Saving...") : saveLabel ? saveLabel : isEdit ? t("Save Changes") : t("Add Customer")}
          </button>
          <button
            onClick={onClose}
            disabled={!!saving}
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

// -----------------------------
// Form Field
// -----------------------------
function FormField(props: {
  label: string;
  id: string;
  type?: "text" | "email" | "tel" | "textarea";
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const { label, id, type = "text", value, onChange, error, placeholder, required, disabled } = props;
  const [focused, setFocused] = React.useState(false);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 14px",
    fontSize: "0.9rem",
    fontWeight: 500,
    color: disabled ? "#A0AEC7" : "#0F2A66",
    background: disabled ? "#F4F7FC" : focused ? "#FFFFFF" : "#F7F9FF",
    border: error
      ? "1.5px solid #F87171"
      : focused
      ? "1.5px solid #7C6DF0"
      : "1.5px solid #D5DEEF",
    borderRadius: 9,
    outline: "none",
    boxShadow: focused ? "0 0 0 3px rgba(101, 92, 255, 0.13)" : "none",
    transition: "all 0.18s ease",
    cursor: disabled ? "not-allowed" : "text",
  };

  const common = {
    id,
    className: `form-control ${error ? "error" : ""}`,
    value,
    placeholder,
    disabled,
    style: inputStyle,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
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

      {type === "textarea" ? (
        <textarea {...common} rows={3} style={{ ...inputStyle, resize: "vertical", minHeight: 80 }} />
      ) : (
        <input {...common} type={type} />
      )}

      {error && (
        <div
          className="error-message show"
          style={{ fontSize: 11, color: "#EF4444", marginTop: 4, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}
        >
          <i className="fas fa-exclamation-circle" style={{ fontSize: 10 }} />
          {error}
        </div>
      )}
    </div>
  );
}

// -----------------------------
// Customers Table
// -----------------------------
function CustomersTable(props: {
  data: CustomerRow[];
  counts: CountsMap;
  loading: boolean;
  onViewDetails: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  searchQuery: string;
  canViewDetails: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canShowActions: boolean;
}) {
  const { t } = useLanguage();
  const {
    data,
    counts,
    loading,
    onViewDetails,
    onEdit,
    onDelete,
    searchQuery,
    canViewDetails,
    canUpdate,
    canDelete,
    canShowActions,
  } = props;

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
            <div className="empty-text" style={{ marginBottom: 6 }}>{t("Loading Customers")}</div>
            <div className="empty-subtext">{t("Please wait while we fetch your data")}</div>
          </div>
        </div>
      </div>
    );
  }

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const isDropdownButton = target.closest(".btn-action-dropdown");
      const isDropdownMenu = target.closest(".action-dropdown-menu");
      if (!isDropdownButton && !isDropdownMenu) setActiveDropdown(null);
    };

    if (activeDropdown) {
      document.addEventListener("pointerdown", handleClickOutside, true);
      return () => document.removeEventListener("pointerdown", handleClickOutside, true);
    }
  }, [activeDropdown]);

  const highlight = (text: string, query: string) => {
    const safeText = escapeHtml(text ?? "");
    if (!query.trim()) return safeText;

    const terms = splitSearchTerms(query);

    if (!terms.length) return safeText;

    let result = safeText;
    terms.forEach((term) => {
      const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(${escapedTerm})`, "gi");
      result = result.replace(regex, `<mark class="search-highlight">$1</mark>`);
    });
    return result;
  };

  if (!data.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <i className="fas fa-search" />
        </div>
        <div className="empty-text">{t("No matching customers found")}</div>
        <div className="empty-subtext">{t("Try adjusting your search terms or clear the search to see all records")}</div>
      </div>
    );
  }

  const showAnyRowAction = canShowActions && (canViewDetails || canUpdate || canDelete);
  const tableTitleStyle: React.CSSProperties = {
    color: "#111827",
    fontSize: 10.8,
    fontWeight: 800,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  };
  const primaryInfoStyle: React.CSSProperties = {
    color: "#0F2A66",
    fontSize: "0.9rem",
    fontWeight: 700,
    lineHeight: 1.28,
    letterSpacing: "0.01em",
    display: "block",
    width: "100%",
  };
  const tableShellStyle: React.CSSProperties = {
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
  const tableStyle: React.CSSProperties = {
    width: "100%",
    minWidth: 1020,
    borderCollapse: "separate",
    borderSpacing: 0,
    tableLayout: "fixed",
  };
  const headerRowStyle: React.CSSProperties = {
    background: "linear-gradient(90deg, #EEF4FF 0%, #E8F7FF 100%)",
  };
  const headerCellStyle: React.CSSProperties = {
    ...tableTitleStyle,
    padding: "9px 12px",
    borderBottom: "1px solid #D9E5FA",
    verticalAlign: "middle",
    textAlign: "left",
    whiteSpace: "nowrap",
  };
  const cellStyle: React.CSSProperties = {
    padding: "6px 12px",
    borderBottom: "1px solid #E7EEFC",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
    wordBreak: "normal",
    overflowWrap: "normal",
  };
  const actionHeaderStyle: React.CSSProperties = {
    ...headerCellStyle,
    textAlign: "right",
    paddingRight: 12,
  };

  return (
    <div className="table-wrapper customer-table-card-shell" style={tableShellStyle}>
      <table className="customers-table customer-dashboard-table" style={tableStyle}>
        <colgroup>
          <col style={{ width: "24%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr style={headerRowStyle}>
            <th style={headerCellStyle}>{t("Customer Name")}</th>
            <th style={headerCellStyle}>{t("Contact Info")}</th>
            <th style={headerCellStyle}>{t("Vehicle Make/Model")}</th>
            <th style={headerCellStyle}>{t("Recent Service")}</th>
            <th style={headerCellStyle}>{t("Total Spent")}</th>
            <th style={actionHeaderStyle}>{t("Actions")}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((c, idx) => {
            const fullName = `${c.name ?? ""} ${c.lastname ?? ""}`.trim();
            const ct = counts[c.id] || { contacts: 0, deals: 0, tickets: 0 };
            const rowStyle: React.CSSProperties = {
              background: idx % 2 === 0 ? "rgba(255,255,255,0.96)" : "rgba(246,250,255,0.96)",
            };

            return (
              <tr key={c.id} style={rowStyle}>
                <td style={cellStyle}>
                  <div className="customer-cell-primary" style={primaryInfoStyle} dangerouslySetInnerHTML={{ __html: highlight(fullName || "—", searchQuery) }} />
                </td>
                <td style={cellStyle}>
                  <div className="customer-cell-primary" style={primaryInfoStyle} dangerouslySetInnerHTML={{ __html: highlight(c.phone ?? "—", searchQuery) }} />
                </td>
                <td style={cellStyle}>
                  <div className="customer-cell-primary" style={primaryInfoStyle} dangerouslySetInnerHTML={{ __html: highlight(c.company ?? "—", searchQuery) }} />
                </td>
                <td style={cellStyle}>
                  <span className="count-badge">
                    {ct.tickets} {t("service records")}
                  </span>
                </td>
                <td style={cellStyle}>
                  <span className="customer-cell-primary" style={primaryInfoStyle}>{t("Not available")}</span>
                </td>

                <td style={{ ...cellStyle, textAlign: "right", paddingRight: 12 }}>
                  {showAnyRowAction ? (
                    <div className="action-dropdown-container" style={{ width: "100%", display: "flex", justifyContent: "flex-end", paddingRight: 0 }}>
                      <button
                        className={`btn-action-dropdown ${activeDropdown === c.id ? "active" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const isActive = activeDropdown === c.id;
                          if (isActive) return setActiveDropdown(null);

                          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                          const menuHeight = 220;
                          const menuWidth = 230;
                          const spaceBelow = window.innerHeight - rect.bottom;
                          const rawTop = spaceBelow < menuHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
                          const top = Math.max(8, Math.min(rawTop, window.innerHeight - menuHeight - 8));
                          const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));

                          flushSync(() => {
                            setDropdownPosition({ top, left });
                            setActiveDropdown(c.id);
                          });
                        }}
                        type="button"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 10px",
                          borderRadius: 9,
                          border: activeDropdown === c.id ? "none" : "1px solid #DDE7F6",
                          background: activeDropdown === c.id ? "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)" : "#F7F9FF",
                          color: activeDropdown === c.id ? "#FFFFFF" : "#5D54FF",
                          fontSize: "0.84rem",
                          fontWeight: 800,
                          cursor: "pointer",
                          boxShadow: activeDropdown === c.id ? "0 6px 14px rgba(78, 64, 248, 0.30)" : "none",
                          marginRight: 2,
                          minWidth: 102,
                          justifyContent: "center",
                        }}
                      >
                        <i className="fas fa-cogs" /> {t("Actions")} <i className="fas fa-chevron-down" />
                      </button>
                    </div>
                  ) : (
                    <span className="muted">{t("—")}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {activeDropdown &&
        showAnyRowAction &&
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
            {canViewDetails && (
              <button
                className="dropdown-item view"
                                type="button"
                onClick={() => {
                  onViewDetails(activeDropdown);
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
                <i className="fas fa-eye" /> {t("View Details")}
              </button>
            )}

                            {canViewDetails && (canUpdate || canDelete) && <div className="dropdown-divider" style={{ height: 1, background: "#E6ECF8", margin: "4px 6px" }}></div>}

            {canUpdate && (
              <>
                <button
                  className="dropdown-item edit"
                                  type="button"
                  onClick={() => {
                    onEdit(activeDropdown);
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
                  <i className="fas fa-edit" /> {t("Edit Customer")}
                </button>
                                {canDelete && <div className="dropdown-divider" style={{ height: 1, background: "#E6ECF8", margin: "4px 6px" }}></div>}
              </>
            )}

            {canDelete && (
              <button
                className="dropdown-item delete"
                                type="button"
                onClick={() => {
                  onDelete(activeDropdown);
                  setActiveDropdown(null);
                }}
                                style={{
                                  width: "100%",
                                  border: "none",
                                  background: "transparent",
                                  color: "#D14343",
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
                <i className="fas fa-trash" /> {t("Delete Customer")}
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

// -----------------------------
// Details View
// -----------------------------
function DetailsView(props: {
  customer: CustomerRow;
  customerStats: { vehicles: number; completedServices: number };
  vehicles: VehicleRow[];
  contacts: ContactRow[];
  deals: DealRow[];
  tickets: TicketRow[];
  loadingRelations: boolean;
  onClose: () => void;
  onEdit: (id: string) => void;
  formatCustomerId: (id: string) => string;
  canUpdate: boolean;
  canViewInfoCard: boolean;
  canViewRelatedCard: boolean;
  canViewRelatedContacts: boolean;
  canViewRelatedDeals: boolean;
  canViewRelatedTickets: boolean;
  themeClass: ArtTheme;
  onToggleTheme: () => void;
}) {
  const { t } = useLanguage();
  const {
    customer,
    customerStats,
    vehicles,
    contacts,
    deals,
    tickets,
    loadingRelations,
    onClose,
    onEdit,
    formatCustomerId,
    canUpdate,
    canViewInfoCard,
    canViewRelatedCard,
    canViewRelatedContacts,
    canViewRelatedDeals,
    canViewRelatedTickets,
    themeClass,
    onToggleTheme,
  } = props;

  const fullName = `${customer.name ?? ""} ${customer.lastname ?? ""}`.trim();
  const displayCustomerId = formatCustomerId(customer.id);
  const firstVehicle = vehicles[0] as any;

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
        {fields.map((field, index) => (
          <div
            key={field.key}
            style={{
              minHeight: 114,
              padding: "20px 18px 18px",
              borderLeft: index === 0 ? "none" : "1px solid #E3EAF6",
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
              <i className={field.iconClass} style={{ fontSize: 12 }} />
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
              {field.label}
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
              {field.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const contactFields: PremiumField[] = [
    {
      key: "contact-phone",
      iconClass: "fas fa-phone",
      label: t("Phone:"),
      value: customer.phone || t("Not provided"),
    },
    {
      key: "contact-email",
      iconClass: "fas fa-envelope",
      label: t("Email:"),
      value: customer.email || t("Not provided"),
    },
    {
      key: "contact-address",
      iconClass: "fas fa-map-marker-alt",
      label: t("Address:"),
      value: customer.company || t("Not provided"),
    },
    {
      key: "contact-id",
      iconClass: "fas fa-id-badge",
      label: t("Customer ID:"),
      value: displayCustomerId,
    },
  ];

  const vehicleFields: PremiumField[] = [
    {
      key: "vehicle-total",
      iconClass: "fas fa-car",
      label: t("Total Vehicles"),
      value: String(customerStats.vehicles),
    },
    {
      key: "vehicle-completed-services",
      iconClass: "fas fa-check-circle",
      label: t("Completed Services"),
      value: String(customerStats.completedServices),
    },
    ...vehicles.slice(0, 10).flatMap((vehicle, index) => {
      const idx = index + 1;
      const makeModel =
        `${String((vehicle as any).make ?? "").trim()} ${String((vehicle as any).model ?? "").trim()}`.trim() || "—";
      return [
        {
          key: `vehicle-${vehicle.id}-name`,
          iconClass: "fas fa-car-side",
          label: `${t("Vehicle")} ${idx}`,
          value: makeModel,
        },
        {
          key: `vehicle-${vehicle.id}-plate`,
          iconClass: "fas fa-hashtag",
          label: `${t("Plate")} ${idx}`,
          value: String((vehicle as any).plateNumber ?? "").trim() || "—",
        },
        {
          key: `vehicle-${vehicle.id}-vin`,
          iconClass: "fas fa-barcode",
          label: `${t("VIN")} ${idx}`,
          value: String((vehicle as any).vin ?? "").trim() || "—",
        },
      ];
    }),
  ];

  const relatedFields: PremiumField[] = (() => {
    if (canViewRelatedTickets) {
      if (loadingRelations) {
        return [
          {
            key: "related-loading-tickets",
            iconClass: "fas fa-spinner",
            label: t("Status"),
            value: t("Loading tickets…"),
          },
        ];
      }

      if (tickets.length) {
        return tickets.slice(0, 10).map((item, index) => ({
          key: `ticket-${item.id}`,
          iconClass: "fas fa-briefcase",
          label: `${t("Job")} ${index + 1}`,
          value: `${item.title || "—"} • ${item.status || "—"} • ${item.priority || "—"}`,
        }));
      }

      return [
        {
          key: "related-empty-tickets",
          iconClass: "fas fa-folder-open",
          label: t("Recent Activity"),
          value: t("No tickets."),
        },
      ];
    }

    if (canViewRelatedDeals) {
      if (loadingRelations) {
        return [
          {
            key: "related-loading-deals",
            iconClass: "fas fa-spinner",
            label: t("Status"),
            value: t("Loading deals…"),
          },
        ];
      }

      if (deals.length) {
        return deals.slice(0, 10).map((item, index) => ({
          key: `deal-${item.id}`,
          iconClass: "fas fa-handshake",
          label: `${t("Deal")} ${index + 1}`,
          value: `${item.title || "—"} • ${item.stage || "—"} • ${typeof item.value === "number" ? `${item.value} QAR` : "—"}`,
        }));
      }

      return [
        {
          key: "related-empty-deals",
          iconClass: "fas fa-folder-open",
          label: t("Recent Activity"),
          value: t("No deals."),
        },
      ];
    }

    if (canViewRelatedContacts) {
      if (loadingRelations) {
        return [
          {
            key: "related-loading-contacts",
            iconClass: "fas fa-spinner",
            label: t("Status"),
            value: t("Loading contacts…"),
          },
        ];
      }

      if (contacts.length) {
        return contacts.slice(0, 10).map((item, index) => ({
          key: `contact-${item.id}`,
          iconClass: "fas fa-user-friends",
          label: `${t("Contact")} ${index + 1}`,
          value: `${item.fullName || "—"} • ${item.phone || "—"} • ${item.email || "—"}`,
        }));
      }

      return [
        {
          key: "related-empty-contacts",
          iconClass: "fas fa-folder-open",
          label: t("Recent Activity"),
          value: t("No contacts."),
        },
      ];
    }

    return [
      {
        key: "related-empty-fallback",
        iconClass: "fas fa-folder-open",
        label: t("Recent Activity"),
        value: t("No recent activity available."),
      },
    ];
  })();

  return (
    <div
      style={{
        background: "linear-gradient(145deg, #f8fafe 0%, #eef3ff 100%)",
        minHeight: "calc(100vh - 120px)",
        borderRadius: 18,
        padding: "16px 8px",
      }}
    >
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          marginBottom: 14,
          background: "linear-gradient(90deg, #F7F9FF 0%, #F3F6FD 46%, #EFF3FF 100%)",
          border: "1px solid #DDE7FB",
          borderRadius: 20,
          boxShadow: "0 8px 20px rgba(103, 123, 176, 0.08)",
          padding: "11px 15px 15px",
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
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <button
            onClick={onClose}
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
            {t("Back to Customers")}
          </button>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              onClick={onToggleTheme}
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
            {canUpdate && (
              <button
                onClick={() => onEdit(customer.id)}
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
                {t("Edit Customer")}
              </button>
            )}
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
              style={{
                margin: 0,
                color: "#102A68",
                fontSize: 20,
                fontWeight: 700,
                lineHeight: 1.15,
                letterSpacing: "-0.03em",
              }}
            >
              {fullName || t("Customer Details")}
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
                style={{
                  margin: 0,
                  color: "#6F7EA8",
                  fontSize: "10.5px",
                  fontWeight: 600,
                  letterSpacing: "0.01em",
                  lineHeight: 1.4,
                }}
              >
                {displayCustomerId}
              </p>
            </div>
          </div>
        </div>
      </div>
      </div>

      <div style={{ padding: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6 }}>
          {canViewInfoCard && (
            <>
              <PremiumDetailsCard title={t("Contact Information")} iconClass="fas fa-user" fields={contactFields} />

              {loadingRelations ? (
                <PremiumDetailsCard
                  title={t("Associated Vehicles")}
                  iconClass="fas fa-car"
                  fields={[
                    {
                      key: "vehicles-loading",
                      iconClass: "fas fa-spinner",
                      label: t("Status"),
                      value: t("Loading vehicles…"),
                    },
                  ]}
                />
              ) : vehicles.length ? (
                <PremiumDetailsCard
                  title={t("Associated Vehicles")}
                  iconClass="fas fa-car"
                  fields={vehicleFields}
                  forceSingleRow
                />
              ) : (
                <PremiumDetailsCard
                  title={t("Associated Vehicles")}
                  iconClass="fas fa-car"
                  fields={[
                    {
                      key: "vehicles-empty",
                      iconClass: "fas fa-folder-open",
                      label: t("Status"),
                      value: t("No vehicles."),
                    },
                  ]}
                />
              )}
            </>
          )}

          {canViewRelatedCard && (
            <PremiumDetailsCard
              title={t("Job History / Recent Activity")}
              iconClass="fas fa-history"
              fields={relatedFields}
            />
          )}

          {!canViewInfoCard && !canViewRelatedCard && (
            <PremiumDetailsCard
              title={t("Customer Details")}
              iconClass="fas fa-lock"
              fields={[
                {
                  key: "permission-blocked",
                  iconClass: "fas fa-ban",
                  label: t("Permission"),
                  value: t("You don’t have permission to view customer detail sections."),
                },
              ]}
            />
          )}

          {!canViewInfoCard && canViewRelatedCard && firstVehicle && (
            <PremiumDetailsCard
              title={t("Associated Vehicles")}
              iconClass="fas fa-car"
              fields={vehicleFields}
              forceSingleRow
            />
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Main Page
// -----------------------------
export default function Customers({ permissions }: PageProps) {
  const { t } = useLanguage();
  const { withLoading } = useGlobalLoading();
  const {
    can: rbacCan,
    canOption,
    hasOptionToggle,
    isAdminGroup,
    loading: permissionsLoading,
  } = usePermissions();

  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>{t("You don’t have access to this page.")}</div>;
  }

  // ✅ Same concept as PermissionGate (option-level + explicit toggle override + policy fallback)
  const allowCustomersOption = (optionId: string, fallback = true): boolean => {
    const o = String(optionId ?? "").toLowerCase().trim();

    // While permissions are still loading, fall back to page policy prop to avoid false-negative flicker
    if (permissionsLoading) {
      if (
        o === "customers_list" ||
        o === "customers_search" ||
        o === "customers_refresh" ||
        o === "customers_actions" ||
        o === "customers_viewdetails" ||
        o === "customers_details_info" ||
        o === "customers_details_related" ||
        o === "customers_related_contacts" ||
        o === "customers_related_deals" ||
        o === "customers_related_tickets"
      ) {
        return Boolean(permissions.canRead);
      }
      if (o === "customers_add" || o === "customers_create") {
        return Boolean(permissions.canCreate || permissions.canUpdate);
      }
      if (o === "customers_edit" || o === "customers_update") {
        return Boolean(permissions.canUpdate);
      }
      if (o === "customers_delete" || o === "customers_remove") {
        return Boolean(permissions.canDelete);
      }
      return fallback;
    }

    if (isAdminGroup) return true;

    // 1) option-level (includes module enabled gate)
    const optionAllowed = canOption("customers", optionId, fallback);
    if (!optionAllowed) return false;

    // 2) explicit toggle row => authoritative
    if (hasOptionToggle("customers", optionId)) return true;

    // 3) fallback to policy-level CRUD
    const p = rbacCan("CUSTOMERS");

    if (
      o === "customers_list" ||
      o === "customers_search" ||
      o === "customers_refresh" ||
      o === "customers_actions" ||
      o === "customers_viewdetails" ||
      o === "customers_details_info" ||
      o === "customers_details_related" ||
      o === "customers_related_contacts" ||
      o === "customers_related_deals" ||
      o === "customers_related_tickets"
    ) {
      return Boolean(p.canRead);
    }

    if (o === "customers_add" || o === "customers_create") {
      return Boolean(p.canCreate || p.canUpdate); // compat fallback
    }

    if (o === "customers_edit" || o === "customers_update") {
      return Boolean(p.canUpdate);
    }

    if (o === "customers_delete" || o === "customers_remove") {
      return Boolean(p.canDelete);
    }

    return fallback;
  };

  const canCustomersList = allowCustomersOption("customers_list");
  const canCustomersSearch = allowCustomersOption("customers_search");
  const canCustomersRefresh = allowCustomersOption("customers_refresh");
  const canCustomersAdd = allowCustomersOption("customers_add");
  const canCustomersActions = allowCustomersOption("customers_actions");
  const canCustomersViewDetails = allowCustomersOption("customers_viewdetails");
  const canCustomersEdit = allowCustomersOption("customers_edit");
  const canCustomersDelete = allowCustomersOption("customers_delete");
  const canCustomersDetailsInfo = allowCustomersOption("customers_details_info");
  const canCustomersDetailsRelated = allowCustomersOption("customers_details_related");
  const canCustomersRelatedContacts = allowCustomersOption("customers_related_contacts");
  const canCustomersRelatedDeals = allowCustomersOption("customers_related_deals");
  const canCustomersRelatedTickets = allowCustomersOption("customers_related_tickets");

  if (!canCustomersList) {
    return <div style={{ padding: 24 }}>{t("You don’t have access to this page.")}</div>;
  }

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [counts, setCounts] = useState<CountsMap>({});
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
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const [loadingRelations, setLoadingRelations] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [customerStats, setCustomerStats] = useState<{ vehicles: number; completedServices: number }>({
    vehicles: 0,
    completedServices: 0,
  });
  const countsRequestRef = useRef(0);
  const relationsCacheRef = useRef<
    Map<string, { vehicles?: VehicleRow[]; contacts?: ContactRow[]; deals?: DealRow[]; tickets?: TicketRow[] }>
  >(new Map());
  const customerStatsCacheRef = useRef<Map<string, { vehicles: number; completedServices: number }>>(new Map());

  const formatCustomerId = useCallback((id: string) => formatCustomerDisplayId(id), []);

  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [showEditCustomerModal, setShowEditCustomerModal] = useState(false);
  const [deleteCustomerId, setDeleteCustomerId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CustomerForm>({
    name: "",
    lastname: "",
    phone: "",
    email: "",
    company: "",
    notes: "",
    heardFrom: "",
    referralPersonName: "",
    referralPersonMobile: "",
    socialPlatform: "",
    heardFromOtherNote: "",
  });
  const [formErrors, setFormErrors] = useState<FormErrors>({});

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
          setAlert((prev) => ({ ...prev, isOpen: false }));
          resolve(false);
        },
        onConfirm: () => {
          setAlert((prev) => ({ ...prev, isOpen: false }));
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

  const computeCounts = useCallback((contactsList: ContactRow[], dealsList: DealRow[], ticketsList: TicketRow[]) => {
    const map: CountsMap = {};

    const bump = (customerId: string, key: "contacts" | "deals" | "tickets") => {
      if (!map[customerId]) map[customerId] = { contacts: 0, deals: 0, tickets: 0 };
      map[customerId][key] += 1;
    };

    for (const c of contactsList) bump(String((c as any).customerId), "contacts");
    for (const d of dealsList) bump(String((d as any).customerId), "deals");
    for (const t of ticketsList) bump(String((t as any).customerId), "tickets");

    return map;
  }, []);

  const load = useCallback(async () => {
    if (!canCustomersList) return;

    const requestId = Date.now();
    countsRequestRef.current = requestId;
    setLoading(true);
    try {
      const cRes = await client.models.Customer.list({ limit: 500 });

      const cData = (cRes.data ?? []).slice().sort((a, b) => {
        const an = `${a.name ?? ""} ${a.lastname ?? ""}`.trim().toLowerCase();
        const bn = `${b.name ?? ""} ${b.lastname ?? ""}`.trim().toLowerCase();
        return an.localeCompare(bn);
      });

      if (countsRequestRef.current !== requestId) return;

      setCustomers(cData);
      relationsCacheRef.current.clear();

      // Load relation counts in background so customer list appears immediately.
      void (async () => {
        try {
          const [contactRes, dealRes, ticketRes] = await Promise.all([
            client.models.Contact.list({ limit: 2000 }),
            client.models.Deal.list({ limit: 2000 }),
            client.models.Ticket.list({ limit: 2000 }),
          ]);

          if (countsRequestRef.current !== requestId) return;
          setCounts(computeCounts(contactRes.data ?? [], dealRes.data ?? [], ticketRes.data ?? []));
        } catch {
          if (countsRequestRef.current !== requestId) return;
          setCounts({});
        }
      })();
    } catch (err) {
      console.error(err);
      await showAlert(t("Error"), t("Failed to load customers from Amplify."), "error");
    } finally {
      if (countsRequestRef.current === requestId) setLoading(false);
    }
  }, [canCustomersList, computeCounts, showAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  const performSmartSearch = useCallback((query: string, list: CustomerRow[]) => {
    if (!query.trim()) return list;

    return list.filter((c) => {
      const fullName = `${c.name ?? ""} ${c.lastname ?? ""}`.trim();
      return matchesSearchQuery(
        [
          c.id,
          formatCustomerDisplayId(c.id),
          fullName,
          c.phone,
          c.email,
          c.company,
          (c as any).heardFrom,
          (c as any).socialPlatform,
          (c as any).referralPersonName,
          (c as any).referralPersonMobile,
        ],
        query
      );
    });
  }, []);

  const searchResults = useMemo(
    () => (canCustomersSearch ? performSmartSearch(searchQuery, customers) : customers),
    [canCustomersSearch, searchQuery, customers, performSmartSearch]
  );

  const totalPages = Math.ceil(searchResults.length / pageSize) || 1;
  const paginatedData = searchResults.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const resetForm = () => {
    setFormData({
      name: "",
      lastname: "",
      phone: "",
      email: "",
      company: "",
      notes: "",
      heardFrom: "",
      referralPersonName: "",
      referralPersonMobile: "",
      socialPlatform: "",
      heardFromOtherNote: "",
    });
    setFormErrors({});
    setEditingCustomerId(null);
  };

  const openAddModal = () => {
    if (!canCustomersAdd) return;
    resetForm();
    setShowAddCustomerModal(true);
  };

  const openEditModal = (id: string) => {
    if (!canCustomersEdit) return;
    const c = customers.find((x) => x.id === id);
    if (!c) return;

    setEditingCustomerId(id);
    setFormData({
      name: c.name ?? "",
      lastname: c.lastname ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      company: c.company ?? "",
      notes: c.notes ?? "",
      heardFrom: String((c as any).heardFrom ?? ""),
      referralPersonName: String((c as any).referralPersonName ?? ""),
      referralPersonMobile: String((c as any).referralPersonMobile ?? ""),
      socialPlatform: String((c as any).socialPlatform ?? ""),
      heardFromOtherNote: String((c as any).heardFromOtherNote ?? ""),
    });
    setFormErrors({});
    setShowEditCustomerModal(true);
  };

  const openDeleteConfirm = (id: string) => {
    if (!canCustomersDelete) return;
    setDeleteCustomerId(id);
  };

  const openDetailsView = async (id: string) => {
    if (!canCustomersViewDetails) return;

    // Use flushSync to ensure UI state updates synchronously before async data fetch
    flushSync(() => {
      setSelectedCustomerId(id);
      setViewMode("details");
    });

    const cachedStats = customerStatsCacheRef.current.get(id);
    setCustomerStats(cachedStats ?? { vehicles: 0, completedServices: 0 });

    void (async () => {
      try {
        const vehiclesByCustomer = await client.models.Vehicle.list({
          filter: { customerId: { eq: id } } as any,
          limit: 2000,
        } as any);
        const vehiclesRows = (vehiclesByCustomer.data ?? []) as any[];
        const vehiclesCount = vehiclesRows.length;

        let completedCount = 0;
        try {
          const byCustomerCompleted = await client.models.JobOrder.list({
            filter: { customerId: { eq: id }, status: { eq: "COMPLETED" } } as any,
            limit: 5000,
          } as any);
          completedCount = (byCustomerCompleted.data ?? []).length;
        } catch {
          completedCount = 0;
        }

        if (completedCount === 0 && vehiclesRows.length) {
          const uniquePlates = Array.from(
            new Set(
              vehiclesRows
                .map((v: any) => String(v?.plateNumber ?? "").trim())
                .filter(Boolean)
            )
          );

          if (uniquePlates.length) {
            const byPlate = await Promise.all(
              uniquePlates.map(async (plate) => {
                try {
                  const out = await (client.models.JobOrder as any)?.jobOrdersByPlateNumber?.({
                    plateNumber: plate,
                    limit: 2000,
                  });
                  const rows = ((out as any)?.data ?? []) as any[];
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
            completedCount = byPlate.reduce((sum, n) => sum + Number(n || 0), 0);
          }
        }

        const nextStats = { vehicles: vehiclesCount, completedServices: completedCount };
        customerStatsCacheRef.current.set(id, nextStats);
        setCustomerStats(nextStats);
      } catch (e) {
        console.error("[customers] failed to compute customer stats", e);
      }
    })();

    // only load relations if at least one related section is enabled
    const shouldLoadRelations = canCustomersDetailsRelated;

    if (!shouldLoadRelations) {
      setLoadingRelations(false);
      setVehicles([]);
      setContacts([]);
      setDeals([]);
      setTickets([]);
      return;
    }

    const cacheEntry = relationsCacheRef.current.get(id) ?? {};
    const needsVehicles = !cacheEntry.vehicles;
    const needsContacts = canCustomersRelatedContacts && !cacheEntry.contacts;
    const needsDeals = canCustomersRelatedDeals && !cacheEntry.deals;
    const needsTickets = canCustomersRelatedTickets && !cacheEntry.tickets;

    if (!needsVehicles && !needsContacts && !needsDeals && !needsTickets) {
      setVehicles(cacheEntry.vehicles ?? []);
      setContacts(cacheEntry.contacts ?? []);
      setDeals(cacheEntry.deals ?? []);
      setTickets(cacheEntry.tickets ?? []);
      setLoadingRelations(false);
      return;
    }

    setLoadingRelations(true);
    setVehicles(cacheEntry.vehicles ?? []);
    setContacts(cacheEntry.contacts ?? []);
    setDeals(cacheEntry.deals ?? []);
    setTickets(cacheEntry.tickets ?? []);

    try {
      const nextEntry = {
        vehicles: (cacheEntry.vehicles ?? []) as VehicleRow[],
        contacts: (cacheEntry.contacts ?? []) as ContactRow[],
        deals: (cacheEntry.deals ?? []) as DealRow[],
        tickets: (cacheEntry.tickets ?? []) as TicketRow[],
      };

      const tasks: Promise<void>[] = [];

      if (needsVehicles) {
        tasks.push(
          client.models.Vehicle.list({ filter: { customerId: { eq: id } }, limit: 1000 }).then((vehicleRes: any) => {
            nextEntry.vehicles = (vehicleRes.data ?? []) as VehicleRow[];
            setVehicles(nextEntry.vehicles);
          })
        );
      }

      if (needsContacts) {
        tasks.push(
          client.models.Contact.list({ filter: { customerId: { eq: id } }, limit: 500 }).then((contactRes: any) => {
            nextEntry.contacts = (contactRes.data ?? []) as ContactRow[];
            setContacts(nextEntry.contacts);
          })
        );
      }

      if (needsDeals) {
        tasks.push(
          client.models.Deal.list({ filter: { customerId: { eq: id } }, limit: 500 }).then((dealRes: any) => {
            nextEntry.deals = (dealRes.data ?? []) as DealRow[];
            setDeals(nextEntry.deals);
          })
        );
      }

      if (needsTickets) {
        tasks.push(
          client.models.Ticket.list({ filter: { customerId: { eq: id } }, limit: 500 }).then((ticketRes: any) => {
            nextEntry.tickets = (ticketRes.data ?? []) as TicketRow[];
            setTickets(nextEntry.tickets);
          })
        );
      }

      await Promise.all(tasks);
      relationsCacheRef.current.set(id, nextEntry);
    } catch (err) {
      console.error(err);
      await showAlert(t("Warning"), t("Could not load related records."), "warning");
    } finally {
      setLoadingRelations(false);
    }
  };

  const closeDetailsView = () => {
    setViewMode("list");
    setSelectedCustomerId(null);
    setVehicles([]);
    setCustomerStats({ vehicles: 0, completedServices: 0 });
  };

  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!formData.name.trim()) e.name = t("First name is required");
    if (!formData.lastname.trim()) e.lastname = t("Last name is required");
    if (!formData.heardFrom.trim()) e.heardFrom = t("Please select how customer heard about us");

    if (formData.heardFrom === "refer_person") {
      if (!formData.referralPersonName.trim()) e.referralPersonName = t("Referred person name is required");
      if (!formData.referralPersonMobile.trim()) e.referralPersonMobile = t("Referred person mobile is required");
    }

    if (formData.heardFrom === "social_media") {
      if (!formData.socialPlatform.trim()) e.socialPlatform = t("Please select social media platform");
    }

    if (formData.heardFrom === "other") {
      if (!formData.heardFromOtherNote.trim()) e.heardFromOtherNote = t("Please enter note for Other");
    }

    setFormErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleAddCustomer = async () => {
    if (!canCustomersAdd) return;
    if (saving) return;
    if (!validate()) return;

    setSaving(true);
    try {
      const u = await getCurrentUser();
      const createdBy = resolveActorUsername(u, "system");

      const created = await client.models.Customer.create({
        name: formData.name.trim(),
        lastname: formData.lastname.trim(),
        phone: formData.phone.trim() || undefined,
        email: formData.email.trim() || undefined,
        company: formData.company.trim() || undefined,
        notes: formData.notes.trim() || undefined,
        heardFrom: formData.heardFrom.trim() || undefined,
        referralPersonName: formData.heardFrom === "refer_person" ? (formData.referralPersonName.trim() || undefined) : undefined,
        referralPersonMobile: formData.heardFrom === "refer_person" ? (formData.referralPersonMobile.trim() || undefined) : undefined,
        socialPlatform: formData.heardFrom === "social_media" ? (formData.socialPlatform.trim() || undefined) : undefined,
        heardFromOtherNote: formData.heardFrom === "other" ? (formData.heardFromOtherNote.trim() || undefined) : undefined,
        createdBy,
        createdAt: new Date().toISOString(),
      });

      if (!created.data) throw new Error("Customer not created");

      await logActivity("Customer", created.data.id, "CREATE", `Customer ${formData.name} ${formData.lastname} created`);

      setCustomers((prev) => [created.data!, ...prev]);
      setCounts((prev) => ({ ...prev, [created.data!.id]: { contacts: 0, deals: 0, tickets: 0 } }));

      setShowAddCustomerModal(false);
      resetForm();
      await showAlert(t("Success"), `${t("Customer")} "${created.data.name} ${created.data.lastname}" ${t("added successfully!")}`, "success");
    } catch (err) {
      console.error(err);
      await showAlert(t("Error"), t("Failed to create customer. Check console."), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCustomer = async () => {
    if (!canCustomersEdit) return;
    if (saving) return;
    if (!editingCustomerId) return;
    if (!validate()) return;

    setSaving(true);
    try {
      await client.models.Customer.update({
        id: editingCustomerId,
        name: formData.name.trim(),
        lastname: formData.lastname.trim(),
        phone: formData.phone.trim() || undefined,
        email: formData.email.trim() || undefined,
        company: formData.company.trim() || undefined,
        notes: formData.notes.trim() || undefined,
        heardFrom: formData.heardFrom.trim() || undefined,
        referralPersonName: formData.heardFrom === "refer_person" ? (formData.referralPersonName.trim() || undefined) : undefined,
        referralPersonMobile: formData.heardFrom === "refer_person" ? (formData.referralPersonMobile.trim() || undefined) : undefined,
        socialPlatform: formData.heardFrom === "social_media" ? (formData.socialPlatform.trim() || undefined) : undefined,
        heardFromOtherNote: formData.heardFrom === "other" ? (formData.heardFromOtherNote.trim() || undefined) : undefined,
      });

      await logActivity("Customer", editingCustomerId, "UPDATE", `Customer ${formData.name} ${formData.lastname} updated`);

      setCustomers((prev) =>
        prev.map((c) =>
          c.id === editingCustomerId
            ? {
                ...c,
                name: formData.name.trim(),
                lastname: formData.lastname.trim(),
                phone: formData.phone.trim() || undefined,
                email: formData.email.trim() || undefined,
                company: formData.company.trim() || undefined,
                notes: formData.notes.trim() || undefined,
                heardFrom: formData.heardFrom.trim() || undefined,
                referralPersonName: formData.heardFrom === "refer_person" ? (formData.referralPersonName.trim() || undefined) : undefined,
                referralPersonMobile: formData.heardFrom === "refer_person" ? (formData.referralPersonMobile.trim() || undefined) : undefined,
                socialPlatform: formData.heardFrom === "social_media" ? (formData.socialPlatform.trim() || undefined) : undefined,
                heardFromOtherNote: formData.heardFrom === "other" ? (formData.heardFromOtherNote.trim() || undefined) : undefined,
              }
            : c
        )
      );

      setShowEditCustomerModal(false);
      resetForm();
      await showAlert(t("Success"), t("Customer updated successfully!"), "success");
    } catch (err) {
      console.error(err);
      await showAlert(t("Error"), t("Failed to update customer. Check console."), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!canCustomersDelete) return;
    if (saving) return;
    if (!deleteCustomerId) return;

    const c = customers.find((x) => x.id === deleteCustomerId);
    setSaving(true);
    try {
      await client.models.Customer.delete({ id: deleteCustomerId });
      if (c) {
        await logActivity("Customer", deleteCustomerId, "DELETE", `Customer ${c.name} ${c.lastname} deleted`);
      }

      setCustomers((prev) => prev.filter((x) => x.id !== deleteCustomerId));
      setCounts((prev) => {
        const copy = { ...prev };
        delete copy[deleteCustomerId];
        return copy;
      });

      if (selectedCustomerId === deleteCustomerId) closeDetailsView();

      setDeleteCustomerId(null);
      await showAlert(t("Success"), t("Customer deleted successfully!"), "success");
    } catch (err) {
      console.error(err);
      await showAlert(t("Error"), t("Delete failed. Check console."), "error");
    } finally {
      setSaving(false);
    }
  };

  if (viewMode === "details" && selectedCustomer) {
    return (
      <>
        <DetailsView
          customer={selectedCustomer}
          customerStats={customerStats}
          vehicles={vehicles}
          contacts={contacts}
          deals={deals}
          tickets={tickets}
          loadingRelations={loadingRelations}
          onClose={closeDetailsView}
          onEdit={openEditModal}
          formatCustomerId={formatCustomerId}
          canUpdate={canCustomersEdit}
          canViewInfoCard={canCustomersDetailsInfo}
          canViewRelatedCard={canCustomersDetailsRelated}
          canViewRelatedContacts={canCustomersRelatedContacts}
          canViewRelatedDeals={canCustomersRelatedDeals}
          canViewRelatedTickets={canCustomersRelatedTickets}
          themeClass={themeClass}
          onToggleTheme={toggleTheme}
        />

        <Modal
          isOpen={showEditCustomerModal}
          title={t("Edit Customer")}
          icon="fas fa-user-edit"
          onClose={() => setShowEditCustomerModal(false)}
          onSave={handleSaveCustomer}
          isEdit
          saving={saving}
          saveDisabled={!canCustomersEdit}
          saveLabel={t("Save Changes")}
        >
          <form className="modal-form" onSubmit={(e) => e.preventDefault()}>
            <FormField
              label={t("First Name")}
              id="editFirstName"
              placeholder={t("Enter first name")}
              value={formData.name}
              onChange={(v) => setFormData((p) => ({ ...p, name: v }))}
              error={formErrors.name}
              required
              disabled={!canCustomersEdit}
            />
            <FormField
              label={t("Last Name")}
              id="editLastName"
              placeholder={t("Enter last name")}
              value={formData.lastname}
              onChange={(v) => setFormData((p) => ({ ...p, lastname: v }))}
              error={formErrors.lastname}
              required
              disabled={!canCustomersEdit}
            />
            <FormField
              label={t("Mobile Number")}
              id="editPhone"
              type="tel"
              placeholder={t("Enter mobile number")}
              value={formData.phone}
              onChange={(v) => setFormData((p) => ({ ...p, phone: v }))}
              disabled={!canCustomersEdit}
            />
            <FormField
              label={t("Email Address")}
              id="editEmail"
              type="email"
              placeholder={t("Enter email address")}
              value={formData.email}
              onChange={(v) => setFormData((p) => ({ ...p, email: v }))}
              disabled={!canCustomersEdit}
            />
            <FormField
              label={t("Company")}
              id="editCompany"
              placeholder={t("Enter company name")}
              value={formData.company}
              onChange={(v) => setFormData((p) => ({ ...p, company: v }))}
              disabled={!canCustomersEdit}
            />
            <FormField
              label={t("Notes")}
              id="editNotes"
              type="textarea"
              placeholder={t("Enter notes")}
              value={formData.notes}
              onChange={(v) => setFormData((p) => ({ ...p, notes: v }))}
              disabled={!canCustomersEdit}
            />

            <div className="form-group" style={{ marginBottom: 14 }}>
              <label htmlFor="editHeardFrom" style={{ display: "block", marginBottom: 6, fontSize: 10.5, fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {t("Heard of us from")} <span style={{ color: "#EF4444", marginLeft: 3, fontWeight: 700 }}>*</span>
              </label>
              <select
                id="editHeardFrom"
                className={`form-control ${formErrors.heardFrom ? "error" : ""}`}
                value={formData.heardFrom}
                onChange={(e) =>
                  setFormData((p) => ({
                    ...p,
                    heardFrom: e.target.value,
                    referralPersonName: "",
                    referralPersonMobile: "",
                    socialPlatform: "",
                    heardFromOtherNote: "",
                  }))
                }
                disabled={!canCustomersEdit}
                style={{ width: "100%", padding: "10px 14px", fontSize: "0.9rem", fontWeight: 500, color: "#0F2A66", background: "#F7F9FF", border: formErrors.heardFrom ? "1.5px solid #F87171" : "1.5px solid #D5DEEF", borderRadius: 9, outline: "none", boxSizing: "border-box" }}
              >
                <option value="">{t("Select…")}</option>
                {HEARD_FROM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.label)}
                  </option>
                ))}
              </select>
              {formErrors.heardFrom && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 4, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}><i className="fas fa-exclamation-circle" style={{ fontSize: 10 }} />{formErrors.heardFrom}</div>}
            </div>

            {formData.heardFrom === "refer_person" && (
              <>
                <FormField
                  label={t("Referred Person Name")}
                  id="editReferralPersonName"
                  placeholder={t("Enter person name")}
                  value={formData.referralPersonName}
                  onChange={(v) => setFormData((p) => ({ ...p, referralPersonName: v }))}
                  error={formErrors.referralPersonName}
                  required
                  disabled={!canCustomersEdit}
                />
                <FormField
                  label={t("Referred Person Mobile")}
                  id="editReferralPersonMobile"
                  type="tel"
                  placeholder={t("Enter mobile number")}
                  value={formData.referralPersonMobile}
                  onChange={(v) => setFormData((p) => ({ ...p, referralPersonMobile: v }))}
                  error={formErrors.referralPersonMobile}
                  required
                  disabled={!canCustomersEdit}
                />
              </>
            )}

            {formData.heardFrom === "social_media" && (
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label htmlFor="editSocialPlatform" style={{ display: "block", marginBottom: 6, fontSize: 10.5, fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {t("Social Platform")} <span style={{ color: "#EF4444", marginLeft: 3, fontWeight: 700 }}>*</span>
                </label>
                <select
                  id="editSocialPlatform"
                  className={`form-control ${formErrors.socialPlatform ? "error" : ""}`}
                  value={formData.socialPlatform}
                  onChange={(e) => setFormData((p) => ({ ...p, socialPlatform: e.target.value }))}
                  disabled={!canCustomersEdit}
                  style={{ width: "100%", padding: "10px 14px", fontSize: "0.9rem", fontWeight: 500, color: "#0F2A66", background: "#F7F9FF", border: formErrors.socialPlatform ? "1.5px solid #F87171" : "1.5px solid #D5DEEF", borderRadius: 9, outline: "none", boxSizing: "border-box" }}
                >
                  <option value="">{t("Select…")}</option>
                  {SOCIAL_PLATFORM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t(opt.label)}
                    </option>
                  ))}
                </select>
                {formErrors.socialPlatform && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 4, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}><i className="fas fa-exclamation-circle" style={{ fontSize: 10 }} />{formErrors.socialPlatform}</div>}
              </div>
            )}

            {formData.heardFrom === "other" && (
              <FormField
                label={t("Other Note")}
                id="editHeardFromOtherNote"
                type="textarea"
                placeholder={t("Enter note")}
                value={formData.heardFromOtherNote}
                onChange={(v) => setFormData((p) => ({ ...p, heardFromOtherNote: v }))}
                error={formErrors.heardFromOtherNote}
                required
                disabled={!canCustomersEdit}
              />
            )}
          </form>
        </Modal>

        <AlertPopup
          isOpen={alert.isOpen}
          title={alert.title}
          message={alert.message}
          type={alert.type}
          onClose={alert.onClose ?? (() => setAlert((p) => ({ ...p, isOpen: false })))}
          showCancel={alert.showCancel}
          onConfirm={alert.onConfirm}
        />
      </>
    );
  }

  return (
    <div
      className={`vehicle-page customer-page customer-dashboard-shell ${themeClass}`}
      id="mainScreen"
      style={{ background: "linear-gradient(145deg, #f8fafe 0%, #eef3ff 100%)", minHeight: "100vh" }}
    >
      <main className="main-content customer-dashboard-main" style={{ padding: "16px 8px" }}>
        <section style={{ position: "relative", overflow: "hidden", marginBottom: 10, background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 12, boxShadow: "0 10px 24px rgba(51, 84, 160, 0.08)", border: "1px solid #DDE7F6" }}>
          <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />
          <div aria-hidden="true" style={{ position: "absolute", top: -18, right: -22, height: 96, width: 202, background: "linear-gradient(to bottom left, rgba(67, 24, 255, 0.18), rgba(67, 24, 255, 0))", borderBottomLeftRadius: 999, pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", right: 28, top: 26, width: 44, height: 44, borderRadius: 14, opacity: 0.35, backgroundImage: "radial-gradient(circle, rgba(116, 137, 191, 0.55) 1.4px, transparent 1.5px)", backgroundSize: "10px 10px", pointerEvents: "none" }} />
          <div style={{ position: "relative", zIndex: 1, padding: "17px 24px 17px", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 17 }}>
                <div style={{ width: 42, height: 42, borderRadius: "50%", background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)", border: "1px solid #D8E1F7", boxShadow: "0 0 0 4px rgba(101, 92, 255, 0.08), 0 6px 14px rgba(71, 88, 180, 0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5D54FF" }}>
                  <i className="fas fa-users" style={{ fontSize: 16 }} />
                </div>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#102A68", lineHeight: 1.15, letterSpacing: "-0.03em" }}>{t("Customers")}</h1>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", fontSize: "0.88rem", fontWeight: 700, cursor: "pointer" }}
                onClick={toggleTheme} type="button"
              >
                <i className="fas fa-palette" />
                {themeClass === "theme-elegant-glass" ? t("Elegant Glass") : t("Executive Minimal")}
              </button>

              {canCustomersSearch ? (
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <i className="fas fa-search" style={{ position: "absolute", left: 10, color: "#8C9ABF", fontSize: 12, pointerEvents: "none" }} />
                  <input
                    type="text"
                    style={{ paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderRadius: 8, border: "1px solid #DDE7F6", background: "#FAFBFF", color: "#102A68", fontSize: "0.88rem", fontWeight: 700, outline: "none", minWidth: 220 }}
                    placeholder={t("Search by any customer details")}
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
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
                    value="" disabled readOnly
                  />
                </div>
              )}

              {canCustomersRefresh && (
                <button
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", fontSize: "0.88rem", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}
                  onClick={() => void load()} disabled={loading}
                >
                  <i className="fas fa-sync" /> {loading ? t("Loading...") : t("Refresh")}
                </button>
              )}

              {canCustomersAdd && (
                <button
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 8, border: "none", background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", color: "#fff", fontSize: "0.88rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 12px rgba(78, 64, 248, 0.25)" }}
                  onClick={openAddModal} type="button"
                >
                  <i className="fas fa-plus-circle" /> {t("Add New Customer")}
                </button>
              )}
            </div>
            </div>
            <p style={{ margin: 0, marginLeft: 59, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: "#8C9ABF", fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1.35 }}>
              <span
                aria-hidden="true"
                style={{ width: 2, height: 12, borderRadius: 999, background: "linear-gradient(180deg, #25D6E8 0%, #4E40F8 100%)", boxShadow: "0 0 0 2px rgba(78, 64, 248, 0.10)" }}
              />
              <span style={{ color: "#7E8FB9" }}>{t("Manage customer information, vehicles, contacts, and relationships.")}</span>
            </p>
          </div>
        </section>

        <section style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: "8px 4px", marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: "#8C9ABF", fontWeight: 600 }}>
            {loading ? (
              t("Loading customers…")
            ) : searchResults.length === 0 ? (
              t("No customers found")
            ) : (
              <>
                {t("Showing")} {Math.min((currentPage - 1) * pageSize + 1, searchResults.length)}–
                {Math.min(currentPage * pageSize, searchResults.length)} {t("of")} <strong style={{ color: "#102A68", fontSize: "0.88rem", fontWeight: 700 }}>{searchResults.length}</strong> {t("customers")}
                {canCustomersSearch && searchQuery && (
                  <span style={{ color: "#5D54FF" }}> {`(${t("Filtered by:")}: "${searchQuery}")`}</span>
                )}
              </>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label htmlFor="pageSizeSelect" style={{ fontSize: 10, color: "#8C9ABF", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em" }}>{t("Records per page:")}</label>
            <select
              id="pageSizeSelect"
              style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #DDE7F6", background: "#FAFBFF", color: "#112A6D", fontSize: "0.88rem", fontWeight: 700, outline: "none" }}
              value={pageSize}
              onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setCurrentPage(1); }}
            >
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
        </section>

        <section style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 12, boxShadow: "0 10px 24px rgba(51, 84, 160, 0.08)", border: "1px solid #DDE7F6", overflow: "hidden", marginBottom: 6 }}>
          <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />
          <div style={{ paddingTop: 4 }}>
          <CustomersTable
            data={paginatedData}
            counts={counts}
            loading={loading}
            onViewDetails={(id) => void withLoading(openDetailsView(id), t("Loading customer details..."))}
            onEdit={openEditModal}
            onDelete={openDeleteConfirm}
            searchQuery={canCustomersSearch ? searchQuery : ""}
            canViewDetails={canCustomersViewDetails}
            canUpdate={canCustomersEdit}
            canDelete={canCustomersDelete}
            canShowActions={canCustomersActions}
          />

          {totalPages > 1 && (
            <div className="pagination" style={{ borderTop: "1px solid #E4ECF7", padding: "10px 0 4px" }}>
              <button
                className="pagination-btn"
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                <i className="fas fa-chevron-left" />
              </button>

              <div className="page-numbers">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) pageNum = i + 1;
                  else {
                    const start = Math.max(1, currentPage - 2);
                    const end = Math.min(totalPages, start + 4);
                    const adjustedStart = Math.max(1, end - 4);
                    pageNum = adjustedStart + i;
                  }
                  if (pageNum > totalPages) return null;

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
              </div>

              <button
                className="pagination-btn"
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                <i className="fas fa-chevron-right" />
              </button>
            </div>
          )}
          </div>
        </section>
      </main>

      <Modal
        isOpen={showAddCustomerModal}
        title={t("Add New Customer")}
        icon="fas fa-user-plus"
        onClose={() => setShowAddCustomerModal(false)}
        onSave={() => void withLoading(handleAddCustomer(), t("Saving customer..."))}
        saving={saving}
        saveDisabled={!canCustomersAdd}
        saveLabel={t("Add Customer")}
      >
        <form className="modal-form" onSubmit={(e) => e.preventDefault()}>
          <FormField
            label={t("First Name")}
            id="newFirstName"
            placeholder={t("Enter first name")}
            value={formData.name}
            onChange={(v) => setFormData((p) => ({ ...p, name: v }))}
            error={formErrors.name}
            required
            disabled={!canCustomersAdd}
          />
          <FormField
            label={t("Last Name")}
            id="newLastName"
            placeholder={t("Enter last name")}
            value={formData.lastname}
            onChange={(v) => setFormData((p) => ({ ...p, lastname: v }))}
            error={formErrors.lastname}
            required
            disabled={!canCustomersAdd}
          />
          <FormField
            label={t("Mobile Number")}
            id="newPhone"
            type="tel"
            placeholder={t("Enter mobile number")}
            value={formData.phone}
            onChange={(v) => setFormData((p) => ({ ...p, phone: v }))}
            disabled={!canCustomersAdd}
          />
          <FormField
            label={t("Email Address")}
            id="newEmail"
            type="email"
            placeholder={t("Enter email address")}
            value={formData.email}
            onChange={(v) => setFormData((p) => ({ ...p, email: v }))}
            disabled={!canCustomersAdd}
          />
          <FormField
            label={t("Company")}
            id="newCompany"
            placeholder={t("Enter company name")}
            value={formData.company}
            onChange={(v) => setFormData((p) => ({ ...p, company: v }))}
            disabled={!canCustomersAdd}
          />
          <FormField
            label={t("Notes")}
            id="newNotes"
            type="textarea"
            placeholder={t("Enter notes")}
            value={formData.notes}
            onChange={(v) => setFormData((p) => ({ ...p, notes: v }))}
            disabled={!canCustomersAdd}
          />

          <div className="form-group" style={{ marginBottom: 14 }}>
            <label htmlFor="newHeardFrom" style={{ display: "block", marginBottom: 6, fontSize: 10.5, fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {t("Heard of us from")} <span style={{ color: "#EF4444", marginLeft: 3, fontWeight: 700 }}>*</span>
            </label>
            <select
              id="newHeardFrom"
              className={`form-control ${formErrors.heardFrom ? "error" : ""}`}
              value={formData.heardFrom}
              onChange={(e) =>
                setFormData((p) => ({
                  ...p,
                  heardFrom: e.target.value,
                  referralPersonName: "",
                  referralPersonMobile: "",
                  socialPlatform: "",
                  heardFromOtherNote: "",
                }))
              }
              disabled={!canCustomersAdd}
              style={{ width: "100%", padding: "10px 14px", fontSize: "0.9rem", fontWeight: 500, color: "#0F2A66", background: "#F7F9FF", border: formErrors.heardFrom ? "1.5px solid #F87171" : "1.5px solid #D5DEEF", borderRadius: 9, outline: "none", boxSizing: "border-box" }}
            >
              <option value="">{t("Select…")}</option>
              {HEARD_FROM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.label)}
                </option>
              ))}
            </select>
            {formErrors.heardFrom && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 4, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}><i className="fas fa-exclamation-circle" style={{ fontSize: 10 }} />{formErrors.heardFrom}</div>}
          </div>

          {formData.heardFrom === "refer_person" && (
            <>
              <FormField
                label={t("Referred Person Name")}
                id="newReferralPersonName"
                placeholder={t("Enter person name")}
                value={formData.referralPersonName}
                onChange={(v) => setFormData((p) => ({ ...p, referralPersonName: v }))}
                error={formErrors.referralPersonName}
                required
                disabled={!canCustomersAdd}
              />
              <FormField
                label={t("Referred Person Mobile")}
                id="newReferralPersonMobile"
                type="tel"
                placeholder={t("Enter mobile number")}
                value={formData.referralPersonMobile}
                onChange={(v) => setFormData((p) => ({ ...p, referralPersonMobile: v }))}
                error={formErrors.referralPersonMobile}
                required
                disabled={!canCustomersAdd}
              />
            </>
          )}

          {formData.heardFrom === "social_media" && (
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label htmlFor="newSocialPlatform" style={{ display: "block", marginBottom: 6, fontSize: 10.5, fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {t("Social Platform")} <span style={{ color: "#EF4444", marginLeft: 3, fontWeight: 700 }}>*</span>
              </label>
              <select
                id="newSocialPlatform"
                className={`form-control ${formErrors.socialPlatform ? "error" : ""}`}
                value={formData.socialPlatform}
                onChange={(e) => setFormData((p) => ({ ...p, socialPlatform: e.target.value }))}
                disabled={!canCustomersAdd}
                style={{ width: "100%", padding: "10px 14px", fontSize: "0.9rem", fontWeight: 500, color: "#0F2A66", background: "#F7F9FF", border: formErrors.socialPlatform ? "1.5px solid #F87171" : "1.5px solid #D5DEEF", borderRadius: 9, outline: "none", boxSizing: "border-box" }}
              >
                <option value="">{t("Select…")}</option>
                {SOCIAL_PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.label)}
                  </option>
                ))}
              </select>
              {formErrors.socialPlatform && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 4, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}><i className="fas fa-exclamation-circle" style={{ fontSize: 10 }} />{formErrors.socialPlatform}</div>}
            </div>
          )}

          {formData.heardFrom === "other" && (
            <FormField
              label={t("Other Note")}
              id="newHeardFromOtherNote"
              type="textarea"
              placeholder={t("Enter note")}
              value={formData.heardFromOtherNote}
              onChange={(v) => setFormData((p) => ({ ...p, heardFromOtherNote: v }))}
              error={formErrors.heardFromOtherNote}
              required
              disabled={!canCustomersAdd}
            />
          )}
        </form>
      </Modal>

      <Modal
        isOpen={showEditCustomerModal}
        title={t("Edit Customer")}
        icon="fas fa-user-edit"
        onClose={() => setShowEditCustomerModal(false)}
        onSave={() => void withLoading(handleSaveCustomer(), t("Saving customer changes..."))}
        isEdit
        saving={saving}
        saveDisabled={!canCustomersEdit}
        saveLabel={t("Save Changes")}
      >
        <form className="modal-form" onSubmit={(e) => e.preventDefault()}>
          <FormField
            label={t("First Name")}
            id="editFirstName2"
            placeholder={t("Enter first name")}
            value={formData.name}
            onChange={(v) => setFormData((p) => ({ ...p, name: v }))}
            error={formErrors.name}
            required
            disabled={!canCustomersEdit}
          />
          <FormField
            label={t("Last Name")}
            id="editLastName2"
            placeholder={t("Enter last name")}
            value={formData.lastname}
            onChange={(v) => setFormData((p) => ({ ...p, lastname: v }))}
            error={formErrors.lastname}
            required
            disabled={!canCustomersEdit}
          />
          <FormField
            label={t("Mobile Number")}
            id="editPhone2"
            type="tel"
            placeholder={t("Enter mobile number")}
            value={formData.phone}
            onChange={(v) => setFormData((p) => ({ ...p, phone: v }))}
            disabled={!canCustomersEdit}
          />
          <FormField
            label={t("Email Address")}
            id="editEmail2"
            type="email"
            placeholder={t("Enter email address")}
            value={formData.email}
            onChange={(v) => setFormData((p) => ({ ...p, email: v }))}
            disabled={!canCustomersEdit}
          />
          <FormField
            label={t("Company")}
            id="editCompany2"
            placeholder={t("Enter company name")}
            value={formData.company}
            onChange={(v) => setFormData((p) => ({ ...p, company: v }))}
            disabled={!canCustomersEdit}
          />
          <FormField
            label={t("Notes")}
            id="editNotes2"
            type="textarea"
            placeholder={t("Enter notes")}
            value={formData.notes}
            onChange={(v) => setFormData((p) => ({ ...p, notes: v }))}
            disabled={!canCustomersEdit}
          />

          <div className="form-group" style={{ marginBottom: 14 }}>
            <label htmlFor="editHeardFrom2" style={{ display: "block", marginBottom: 6, fontSize: 10.5, fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {t("Heard of us from")} <span style={{ color: "#EF4444", marginLeft: 3, fontWeight: 700 }}>*</span>
            </label>
            <select
              id="editHeardFrom2"
              className={`form-control ${formErrors.heardFrom ? "error" : ""}`}
              value={formData.heardFrom}
              onChange={(e) =>
                setFormData((p) => ({
                  ...p,
                  heardFrom: e.target.value,
                  referralPersonName: "",
                  referralPersonMobile: "",
                  socialPlatform: "",
                  heardFromOtherNote: "",
                }))
              }
              disabled={!canCustomersEdit}
              style={{ width: "100%", padding: "10px 14px", fontSize: "0.9rem", fontWeight: 500, color: "#0F2A66", background: "#F7F9FF", border: formErrors.heardFrom ? "1.5px solid #F87171" : "1.5px solid #D5DEEF", borderRadius: 9, outline: "none", boxSizing: "border-box" }}
            >
              <option value="">{t("Select…")}</option>
              {HEARD_FROM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {formErrors.heardFrom && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 4, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}><i className="fas fa-exclamation-circle" style={{ fontSize: 10 }} />{formErrors.heardFrom}</div>}
          </div>

          {formData.heardFrom === "refer_person" && (
            <>
              <FormField
                label={t("Referred Person Name")}
                id="editReferralPersonName2"
                placeholder={t("Enter person name")}
                value={formData.referralPersonName}
                onChange={(v) => setFormData((p) => ({ ...p, referralPersonName: v }))}
                error={formErrors.referralPersonName}
                required
                disabled={!canCustomersEdit}
              />
              <FormField
                label={t("Referred Person Mobile")}
                id="editReferralPersonMobile2"
                type="tel"
                placeholder={t("Enter mobile number")}
                value={formData.referralPersonMobile}
                onChange={(v) => setFormData((p) => ({ ...p, referralPersonMobile: v }))}
                error={formErrors.referralPersonMobile}
                required
                disabled={!canCustomersEdit}
              />
            </>
          )}

          {formData.heardFrom === "social_media" && (
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label htmlFor="editSocialPlatform2" style={{ display: "block", marginBottom: 6, fontSize: 10.5, fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {t("Social Platform")} <span style={{ color: "#EF4444", marginLeft: 3, fontWeight: 700 }}>*</span>
              </label>
              <select
                id="editSocialPlatform2"
                className={`form-control ${formErrors.socialPlatform ? "error" : ""}`}
                value={formData.socialPlatform}
                onChange={(e) => setFormData((p) => ({ ...p, socialPlatform: e.target.value }))}
                disabled={!canCustomersEdit}
                style={{ width: "100%", padding: "10px 14px", fontSize: "0.9rem", fontWeight: 500, color: "#0F2A66", background: "#F7F9FF", border: formErrors.socialPlatform ? "1.5px solid #F87171" : "1.5px solid #D5DEEF", borderRadius: 9, outline: "none", boxSizing: "border-box" }}
              >
                <option value="">{t("Select…")}</option>
                {SOCIAL_PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.label)}
                  </option>
                ))}
              </select>
              {formErrors.socialPlatform && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 4, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}><i className="fas fa-exclamation-circle" style={{ fontSize: 10 }} />{formErrors.socialPlatform}</div>}
            </div>
          )}

          {formData.heardFrom === "other" && (
            <FormField
              label={t("Other Note")}
              id="editHeardFromOtherNote2"
              type="textarea"
              placeholder={t("Enter note")}
              value={formData.heardFromOtherNote}
              onChange={(v) => setFormData((p) => ({ ...p, heardFromOtherNote: v }))}
              error={formErrors.heardFromOtherNote}
              required
              disabled={!canCustomersEdit}
            />
          )}
        </form>
      </Modal>

      {deleteCustomerId && canCustomersDelete && (
        <div className="delete-modal-overlay" onClick={() => setDeleteCustomerId(null)}>
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-modal-header">
              <h3>
                <i className="fas fa-exclamation-triangle" /> {t("Confirm Deletion")}
              </h3>
            </div>
            <div className="delete-modal-body">
              <div className="delete-warning">
                <i className="fas fa-exclamation-circle" />
                <div className="delete-warning-text">
                  <p>
                    {t("You are about to delete customer")} <strong>{deleteCustomerId}</strong>.
                  </p>
                  <p>{t("This action cannot be undone.")}</p>
                </div>
              </div>

              <div className="delete-modal-actions">
                <button className="btn-confirm-delete" onClick={() => void withLoading(handleConfirmDelete(), t("Deleting customer..."))} disabled={saving}>
                  <i className="fas fa-trash" /> {t("Delete Customer")}
                </button>
                <button className="btn-cancel" onClick={() => setDeleteCustomerId(null)} disabled={saving}>
                  <i className="fas fa-times" /> {t("Cancel")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AlertPopup
        isOpen={alert.isOpen}
        title={alert.title}
        message={alert.message}
        type={alert.type}
        onClose={alert.onClose ?? (() => setAlert((p) => ({ ...p, isOpen: false })))}
        showCancel={alert.showCancel}
        onConfirm={alert.onConfirm}
      />
    </div>
  );
}