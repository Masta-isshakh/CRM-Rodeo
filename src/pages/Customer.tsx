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
import "./Customer.css";

const client = generateClient<Schema>();

type CustomerRow = Schema["Customer"]["type"];
type ContactRow = Schema["Contact"]["type"];
type DealRow = Schema["Deal"]["type"];
type TicketRow = Schema["Ticket"]["type"];

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

function heardFromLabel(v: unknown) {
  const key = String(v ?? "").trim().toLowerCase();
  if (!key) return "Not provided";
  const found = HEARD_FROM_OPTIONS.find((o) => o.value === key);
  return found?.label ?? key;
}

function socialPlatformLabel(v: unknown) {
  const key = String(v ?? "").trim().toLowerCase();
  if (!key) return "Not provided";
  const found = SOCIAL_PLATFORM_OPTIONS.find((o) => o.value === key);
  return found?.label ?? key;
}

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
  const { isOpen, title, icon, children, onClose, onSave, isEdit, saving, saveDisabled, saveLabel } = props;
  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="modal-overlay show">
      <div className="modal">
        <div className="modal-header">
          <h3>
            <i className={icon} /> {title}
          </h3>
          <button className="btn-close-modal" onClick={onClose} disabled={!!saving}>
            <i className="fas fa-times" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">
          <button className="btn-save" onClick={onSave} disabled={!!saving || !!saveDisabled}>
            <i className="fas fa-save" />{" "}
            {saving ? "Saving..." : saveLabel ? saveLabel : isEdit ? "Save Changes" : "Add Customer"}
          </button>
          <button className="btn-cancel" onClick={onClose} disabled={!!saving}>
            <i className="fas fa-times" /> Cancel
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
  const { label, id, type = "text", value, onChange, error, placeholder, required, disabled } = props;

  const common = {
    id,
    className: `form-control ${error ? "error" : ""}`,
    value,
    placeholder,
    disabled,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
  };

  return (
    <div className="form-group">
      <label htmlFor={id}>
        {label}
        {required ? <span className="required">*</span> : <span className="form-optional">(optional)</span>}
      </label>

      {type === "textarea" ? <textarea {...common} rows={3} /> : <input {...common} type={type} />}

      {error && <div className="error-message show">{error}</div>}
    </div>
  );
}

// -----------------------------
// Customers Table
// -----------------------------
function CustomersTable(props: {
  data: CustomerRow[];
  counts: CountsMap;
  onViewDetails: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  formatCustomerId: (id: string) => string;
  searchQuery: string;
  canViewDetails: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canShowActions: boolean;
}) {
  const {
    data,
    counts,
    onViewDetails,
    onEdit,
    onDelete,
    formatCustomerId,
    searchQuery,
    canViewDetails,
    canUpdate,
    canDelete,
    canShowActions,
  } = props;

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
        <div className="empty-text">No matching customers found</div>
        <div className="empty-subtext">Try adjusting your search terms or clear the search to see all records</div>
      </div>
    );
  }

  const showAnyRowAction = canShowActions && (canViewDetails || canUpdate || canDelete);

  return (
    <div className="table-wrapper">
      <table className="customers-table">
        <thead>
          <tr>
            <th>Customer ID</th>
            <th>Customer Name</th>
            <th>Mobile Number</th>
            <th>Company</th>
            <th>Contacts</th>
            <th>Deals</th>
            <th>Tickets</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.map((c) => {
            const fullName = `${c.name ?? ""} ${c.lastname ?? ""}`.trim();
            const ct = counts[c.id] || { contacts: 0, deals: 0, tickets: 0 };

            return (
              <tr key={c.id}>
                <td dangerouslySetInnerHTML={{ __html: highlight(formatCustomerId(c.id), searchQuery) }} />

                <td dangerouslySetInnerHTML={{ __html: highlight(fullName || "—", searchQuery) }} />
                <td dangerouslySetInnerHTML={{ __html: highlight(c.phone ?? "—", searchQuery) }} />
                <td dangerouslySetInnerHTML={{ __html: highlight(c.company ?? "—", searchQuery) }} />

                <td>
                  <span className="count-badge">{ct.contacts} contacts</span>
                </td>
                <td>
                  <span className="count-badge">{ct.deals} deals</span>
                </td>
                <td>
                  <span className="count-badge">{ct.tickets} tickets</span>
                </td>

                <td>
                  {showAnyRowAction ? (
                    <div className="action-dropdown-container">
                      <button
                        className={`btn-action-dropdown ${activeDropdown === c.id ? "active" : ""}`}
                        onClick={(e) => {
                          const isActive = activeDropdown === c.id;
                          if (isActive) return setActiveDropdown(null);

                          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                          const menuHeight = 160;
                          const menuWidth = 220;
                          const spaceBelow = window.innerHeight - rect.bottom;
                          const top = spaceBelow < menuHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
                          const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));

                          flushSync(() => {
                            setDropdownPosition({ top, left });
                            setActiveDropdown(c.id);
                          });
                        }}
                        type="button"
                      >
                        <i className="fas fa-cogs" /> Actions <i className="fas fa-chevron-down" />
                      </button>
                    </div>
                  ) : (
                    <span className="muted">—</span>
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
            style={{ top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` }}
          >
            {canViewDetails && (
              <button
                className="dropdown-item view"
                onClick={() => {
                  onViewDetails(activeDropdown);
                  setActiveDropdown(null);
                }}
              >
                <i className="fas fa-eye" /> View Details
              </button>
            )}

            {canViewDetails && (canUpdate || canDelete) && <div className="dropdown-divider" />}

            {canUpdate && (
              <>
                <button
                  className="dropdown-item edit"
                  onClick={() => {
                    onEdit(activeDropdown);
                    setActiveDropdown(null);
                  }}
                >
                  <i className="fas fa-edit" /> Edit Customer
                </button>
                {canDelete && <div className="dropdown-divider" />}
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
                <i className="fas fa-trash" /> Delete Customer
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
  counts: CountsMap;
  customerStats: { vehicles: number; completedServices: number };
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
}) {
  const {
    customer,
    counts,
    customerStats,
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
  } = props;

  const fullName = `${customer.name ?? ""} ${customer.lastname ?? ""}`.trim();
  const displayCustomerId = formatCustomerId(customer.id);
  const createdAt = customer.createdAt ? new Date(customer.createdAt).toLocaleString() : "—";
  const ct = counts[customer.id] || { contacts: 0, deals: 0, tickets: 0 };

  return (
    <div className="pim-details-screen">
      <div className="pim-details-header">
        <div className="pim-details-title-container">
          <h2>
            <i className="fas fa-user-circle" /> Customer Details - <span>{displayCustomerId}</span>
          </h2>
        </div>
        <button className="pim-btn-close-details" onClick={onClose} type="button">
          <i className="fas fa-times" /> Close Details
        </button>
      </div>

      <div className="pim-details-body">
        <div className="pim-details-grid">
          {canViewInfoCard && (
            <div className="pim-detail-card">
              <div className="details-card-header">
                <h3>
                  <i className="fas fa-user" /> Customer Information
                </h3>

                {canUpdate && (
                  <button className="btn-action btn-edit" onClick={() => onEdit(customer.id)} type="button">
                    <i className="fas fa-edit" /> Edit Customer
                  </button>
                )}
              </div>

              <div className="pim-card-content">
                <div className="pim-info-item">
                  <span className="pim-info-label">Customer ID</span>
                  <span className="pim-info-value">{displayCustomerId}</span>
                </div>

                <div className="pim-info-item">
                  <span className="pim-info-label">Customer Name</span>
                  <span className="pim-info-value">{fullName || "—"}</span>
                </div>

                <div className="pim-info-item">
                  <span className="pim-info-label">Mobile Number</span>
                  <span className="pim-info-value">{customer.phone || "Not provided"}</span>
                </div>

                <div className="pim-info-item">
                  <span className="pim-info-label">Email Address</span>
                  <span className="pim-info-value">{customer.email || "Not provided"}</span>
                </div>

                <div className="pim-info-item">
                  <span className="pim-info-label">Company</span>
                  <span className="pim-info-value">{customer.company || "Not provided"}</span>
                </div>

                <div className="pim-info-item">
                  <span className="pim-info-label">Notes</span>
                  <span className="pim-info-value">{customer.notes || "Not provided"}</span>
                </div>

                <div className="pim-info-item">
                  <span className="pim-info-label">Heard of us from</span>
                  <span className="pim-info-value">{heardFromLabel((customer as any).heardFrom)}</span>
                </div>

                {String((customer as any).heardFrom ?? "") === "refer_person" && (
                  <>
                    <div className="pim-info-item">
                      <span className="pim-info-label">Referred Person Name</span>
                      <span className="pim-info-value">{String((customer as any).referralPersonName ?? "").trim() || "Not provided"}</span>
                    </div>
                    <div className="pim-info-item">
                      <span className="pim-info-label">Referred Person Mobile</span>
                      <span className="pim-info-value">{String((customer as any).referralPersonMobile ?? "").trim() || "Not provided"}</span>
                    </div>
                  </>
                )}

                {String((customer as any).heardFrom ?? "") === "social_media" && (
                  <div className="pim-info-item">
                    <span className="pim-info-label">Social Platform</span>
                    <span className="pim-info-value">{socialPlatformLabel((customer as any).socialPlatform)}</span>
                  </div>
                )}

                {String((customer as any).heardFrom ?? "") === "other" && (
                  <div className="pim-info-item">
                    <span className="pim-info-label">Other Note</span>
                    <span className="pim-info-value">{String((customer as any).heardFromOtherNote ?? "").trim() || "Not provided"}</span>
                  </div>
                )}

                <div className="pim-info-item">
                  <span className="pim-info-label">Contacts</span>
                  <span className="pim-info-value">
                    <span className="count-badge">{ct.contacts} contacts</span>
                  </span>
                </div>

                <div className="pim-info-item">
                  <span className="pim-info-label">Deals</span>
                  <span className="pim-info-value">
                    <span className="count-badge">{ct.deals} deals</span>
                  </span>
                </div>

                <div className="pim-info-item">
                  <span className="pim-info-label">Tickets</span>
                  <span className="pim-info-value">
                    <span className="count-badge">{ct.tickets} tickets</span>
                  </span>
                </div>

                <div className="pim-info-item">
                  <span className="pim-info-label">Registered Vehicles</span>
                  <span className="pim-info-value">
                    <span className="count-badge">{customerStats.vehicles} vehicles</span>
                  </span>
                </div>

                <div className="pim-info-item">
                  <span className="pim-info-label">Completed Services</span>
                  <span className="pim-info-value">
                    <span className="count-badge">{customerStats.completedServices} completed</span>
                  </span>
                </div>

                <div className="pim-info-item">
                  <span className="pim-info-label">Created At</span>
                  <span className="pim-info-value">{createdAt}</span>
                </div>
              </div>
            </div>
          )}

          {canViewRelatedCard && (
            <div className="pim-detail-card">
              <div className="details-card-header">
                <h3>
                  <i className="fas fa-layer-group" /> Related Records
                </h3>
                <div className="details-card-subtitle">
                  {loadingRelations ? <span className="muted">Loading…</span> : <span className="muted">Latest 10 items per section</span>}
                </div>
              </div>

              <div className="pim-card-content">
                {canViewRelatedContacts && (
                  <div className="related-section">
                    <div className="related-title">
                      <i className="fas fa-address-book" /> Contacts
                    </div>
                    {loadingRelations ? (
                      <div className="related-empty">Loading contacts…</div>
                    ) : contacts.length ? (
                      <ul className="related-list">
                        {contacts.slice(0, 10).map((x) => (
                          <li key={x.id}>
                            <b>{x.fullName}</b>
                            <span className="muted"> • {x.phone || "—"} • {x.email || "—"}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="related-empty">No contacts.</div>
                    )}
                  </div>
                )}

                {canViewRelatedDeals && (
                  <div className="related-section">
                    <div className="related-title">
                      <i className="fas fa-handshake" /> Deals
                    </div>
                    {loadingRelations ? (
                      <div className="related-empty">Loading deals…</div>
                    ) : deals.length ? (
                      <ul className="related-list">
                        {deals.slice(0, 10).map((x) => (
                          <li key={x.id}>
                            <b>{x.title}</b>
                            <span className="muted">
                              {" "}
                              • {x.stage || "—"} • {typeof x.value === "number" ? `${x.value} QAR` : "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="related-empty">No deals.</div>
                    )}
                  </div>
                )}

                {canViewRelatedTickets && (
                  <div className="related-section">
                    <div className="related-title">
                      <i className="fas fa-ticket-alt" /> Tickets
                    </div>
                    {loadingRelations ? (
                      <div className="related-empty">Loading tickets…</div>
                    ) : tickets.length ? (
                      <ul className="related-list">
                        {tickets.slice(0, 10).map((x) => (
                          <li key={x.id}>
                            <b>{x.title}</b>
                            <span className="muted"> • {x.status || "—"} • {x.priority || "—"}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="related-empty">No tickets.</div>
                    )}
                  </div>
                )}

                {!canViewRelatedContacts && !canViewRelatedDeals && !canViewRelatedTickets && (
                  <div className="related-empty">No related sections are enabled for your role.</div>
                )}
              </div>
            </div>
          )}

          {!canViewInfoCard && !canViewRelatedCard && (
            <div className="pim-detail-card">
              <div className="pim-card-content">
                <div className="related-empty">You don’t have permission to view customer detail sections.</div>
              </div>
            </div>
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

  const [viewMode, setViewMode] = useState<"list" | "details">("list");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const [loadingRelations, setLoadingRelations] = useState(false);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [customerStats, setCustomerStats] = useState<{ vehicles: number; completedServices: number }>({
    vehicles: 0,
    completedServices: 0,
  });
  const countsRequestRef = useRef(0);
  const relationsCacheRef = useRef<
    Map<string, { contacts?: ContactRow[]; deals?: DealRow[]; tickets?: TicketRow[] }>
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

    setSelectedCustomerId(id);
    setViewMode("details");

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
    const shouldLoadRelations =
      canCustomersDetailsRelated &&
      (canCustomersRelatedContacts || canCustomersRelatedDeals || canCustomersRelatedTickets);

    if (!shouldLoadRelations) {
      setLoadingRelations(false);
      setContacts([]);
      setDeals([]);
      setTickets([]);
      return;
    }

    const cacheEntry = relationsCacheRef.current.get(id) ?? {};
    const needsContacts = canCustomersRelatedContacts && !cacheEntry.contacts;
    const needsDeals = canCustomersRelatedDeals && !cacheEntry.deals;
    const needsTickets = canCustomersRelatedTickets && !cacheEntry.tickets;

    if (!needsContacts && !needsDeals && !needsTickets) {
      setContacts(cacheEntry.contacts ?? []);
      setDeals(cacheEntry.deals ?? []);
      setTickets(cacheEntry.tickets ?? []);
      setLoadingRelations(false);
      return;
    }

    setLoadingRelations(true);
    setContacts(cacheEntry.contacts ?? []);
    setDeals(cacheEntry.deals ?? []);
    setTickets(cacheEntry.tickets ?? []);

    try {
      const [contactRes, dealRes, ticketRes] = await Promise.all([
        needsContacts
          ? client.models.Contact.list({ filter: { customerId: { eq: id } }, limit: 500 })
          : Promise.resolve({ data: (cacheEntry.contacts ?? []) as ContactRow[] } as any),
        needsDeals
          ? client.models.Deal.list({ filter: { customerId: { eq: id } }, limit: 500 })
          : Promise.resolve({ data: (cacheEntry.deals ?? []) as DealRow[] } as any),
        needsTickets
          ? client.models.Ticket.list({ filter: { customerId: { eq: id } }, limit: 500 })
          : Promise.resolve({ data: (cacheEntry.tickets ?? []) as TicketRow[] } as any),
      ]);

      const nextEntry = {
        contacts: (contactRes.data ?? []) as ContactRow[],
        deals: (dealRes.data ?? []) as DealRow[],
        tickets: (ticketRes.data ?? []) as TicketRow[],
      };
      relationsCacheRef.current.set(id, nextEntry);

      setContacts(nextEntry.contacts);
      setDeals(nextEntry.deals);
      setTickets(nextEntry.tickets);
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
      await showAlert(t("Success"), `Customer "${created.data.name} ${created.data.lastname}" added successfully!`, "success");
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
          counts={counts}
          customerStats={customerStats}
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
        />

        <Modal
          isOpen={showEditCustomerModal}
          title="Edit Customer"
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
              label="First Name"
              id="editFirstName"
              placeholder="Enter first name"
              value={formData.name}
              onChange={(v) => setFormData((p) => ({ ...p, name: v }))}
              error={formErrors.name}
              required
              disabled={!canCustomersEdit}
            />
            <FormField
              label="Last Name"
              id="editLastName"
              placeholder="Enter last name"
              value={formData.lastname}
              onChange={(v) => setFormData((p) => ({ ...p, lastname: v }))}
              error={formErrors.lastname}
              required
              disabled={!canCustomersEdit}
            />
            <FormField
              label="Mobile Number"
              id="editPhone"
              type="tel"
              placeholder="Enter mobile number"
              value={formData.phone}
              onChange={(v) => setFormData((p) => ({ ...p, phone: v }))}
              disabled={!canCustomersEdit}
            />
            <FormField
              label="Email Address"
              id="editEmail"
              type="email"
              placeholder="Enter email address"
              value={formData.email}
              onChange={(v) => setFormData((p) => ({ ...p, email: v }))}
              disabled={!canCustomersEdit}
            />
            <FormField
              label="Company"
              id="editCompany"
              placeholder="Enter company name"
              value={formData.company}
              onChange={(v) => setFormData((p) => ({ ...p, company: v }))}
              disabled={!canCustomersEdit}
            />
            <FormField
              label="Notes"
              id="editNotes"
              type="textarea"
              placeholder="Enter notes"
              value={formData.notes}
              onChange={(v) => setFormData((p) => ({ ...p, notes: v }))}
              disabled={!canCustomersEdit}
            />

            <div className="form-group">
              <label htmlFor="editHeardFrom">
                Heard of us from <span className="required">*</span>
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
              >
                <option value="">Select…</option>
                {HEARD_FROM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {formErrors.heardFrom && <div className="error-message show">{formErrors.heardFrom}</div>}
            </div>

            {formData.heardFrom === "refer_person" && (
              <>
                <FormField
                  label="Referred Person Name"
                  id="editReferralPersonName"
                  placeholder="Enter person name"
                  value={formData.referralPersonName}
                  onChange={(v) => setFormData((p) => ({ ...p, referralPersonName: v }))}
                  error={formErrors.referralPersonName}
                  required
                  disabled={!canCustomersEdit}
                />
                <FormField
                  label="Referred Person Mobile"
                  id="editReferralPersonMobile"
                  type="tel"
                  placeholder="Enter mobile number"
                  value={formData.referralPersonMobile}
                  onChange={(v) => setFormData((p) => ({ ...p, referralPersonMobile: v }))}
                  error={formErrors.referralPersonMobile}
                  required
                  disabled={!canCustomersEdit}
                />
              </>
            )}

            {formData.heardFrom === "social_media" && (
              <div className="form-group">
                <label htmlFor="editSocialPlatform">
                  Social Platform <span className="required">*</span>
                </label>
                <select
                  id="editSocialPlatform"
                  className={`form-control ${formErrors.socialPlatform ? "error" : ""}`}
                  value={formData.socialPlatform}
                  onChange={(e) => setFormData((p) => ({ ...p, socialPlatform: e.target.value }))}
                  disabled={!canCustomersEdit}
                >
                  <option value="">Select…</option>
                  {SOCIAL_PLATFORM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {formErrors.socialPlatform && <div className="error-message show">{formErrors.socialPlatform}</div>}
              </div>
            )}

            {formData.heardFrom === "other" && (
              <FormField
                label="Other Note"
                id="editHeardFromOtherNote"
                type="textarea"
                placeholder="Enter note"
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
    <div className="app-container customer-page" id="mainScreen">
      <header className="app-header crm-unified-header">
        <div className="header-left">
          <h1>
            <i className="fas fa-users" /> {t("Customers Management")}
          </h1>
        </div>
        <div className="header-right">
          {canCustomersRefresh && (
            <button className="btn-refresh" onClick={() => void load()} disabled={loading}>
              <i className="fas fa-sync" /> {loading ? t("Loading...") : t("Refresh")}
            </button>
          )}
        </div>
      </header>

      <main className="main-content">
        <section className="search-section">
          {canCustomersSearch ? (
            <div className="search-container">
              <i className="fas fa-search search-icon" />
              <input
                type="text"
                className="smart-search-input"
                placeholder={t("Search by any customer details")}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                autoComplete="off"
              />
            </div>
          ) : (
            <div className="search-container" style={{ opacity: 0.8 }}>
              <i className="fas fa-lock search-icon" />
              <input
                type="text"
                className="smart-search-input"
                placeholder={t("Search is disabled for your role")}
                value=""
                disabled
                readOnly
              />
            </div>
          )}

          <div className="search-stats">
            {loading ? (
              t("Loading customers…")
            ) : searchResults.length === 0 ? (
              t("No customers found")
            ) : (
              <>
                {t("Showing")} {Math.min((currentPage - 1) * pageSize + 1, searchResults.length)}-
                {Math.min(currentPage * pageSize, searchResults.length)} {t("of")} {searchResults.length} {t("customers")}
                {canCustomersSearch && searchQuery && (
                  <span style={{ color: "var(--secondary-color)" }}> {`${t("(Filtered by: \"")}${searchQuery}")`}</span>
                )}
              </>
            )}
          </div>
        </section>

        <section className="results-section">
          <div className="section-header">
            <h2>
              <i className="fas fa-list" /> {t("Customers Records")}
            </h2>

            <div className="pagination-controls">
              <div className="records-per-page">
                <label htmlFor="pageSizeSelect">{t("Records per page:")}</label>
                <select
                  id="pageSizeSelect"
                  className="page-size-select"
                  value={pageSize}
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

              {canCustomersAdd && (
                <button className="btn-new-customer" onClick={openAddModal} type="button">
                  <i className="fas fa-plus-circle" /> {t("Add New Customer")}
                </button>
              )}
            </div>
          </div>

          <CustomersTable
            data={paginatedData}
            counts={counts}
            onViewDetails={openDetailsView}
            onEdit={openEditModal}
            onDelete={openDeleteConfirm}
            formatCustomerId={formatCustomerId}
            searchQuery={canCustomersSearch ? searchQuery : ""}
            canViewDetails={canCustomersViewDetails}
            canUpdate={canCustomersEdit}
            canDelete={canCustomersDelete}
            canShowActions={canCustomersActions}
          />

          {totalPages > 1 && (
            <div className="pagination">
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
        </section>
      </main>

      <footer className="app-footer">
        <p>{t("Service Management System ©")} {new Date().getFullYear()} {t("| Customers Management Module")}</p>
      </footer>

      <Modal
        isOpen={showAddCustomerModal}
        title={t("Add New Customer")}
        icon="fas fa-user-plus"
        onClose={() => setShowAddCustomerModal(false)}
        onSave={handleAddCustomer}
        saving={saving}
        saveDisabled={!canCustomersAdd}
        saveLabel={t("Add Customer")}
      >
        <form className="modal-form" onSubmit={(e) => e.preventDefault()}>
          <FormField
            label="First Name"
            id="newFirstName"
            placeholder="Enter first name"
            value={formData.name}
            onChange={(v) => setFormData((p) => ({ ...p, name: v }))}
            error={formErrors.name}
            required
            disabled={!canCustomersAdd}
          />
          <FormField
            label="Last Name"
            id="newLastName"
            placeholder="Enter last name"
            value={formData.lastname}
            onChange={(v) => setFormData((p) => ({ ...p, lastname: v }))}
            error={formErrors.lastname}
            required
            disabled={!canCustomersAdd}
          />
          <FormField
            label="Mobile Number"
            id="newPhone"
            type="tel"
            placeholder="Enter mobile number"
            value={formData.phone}
            onChange={(v) => setFormData((p) => ({ ...p, phone: v }))}
            disabled={!canCustomersAdd}
          />
          <FormField
            label="Email Address"
            id="newEmail"
            type="email"
            placeholder="Enter email address"
            value={formData.email}
            onChange={(v) => setFormData((p) => ({ ...p, email: v }))}
            disabled={!canCustomersAdd}
          />
          <FormField
            label="Company"
            id="newCompany"
            placeholder="Enter company name"
            value={formData.company}
            onChange={(v) => setFormData((p) => ({ ...p, company: v }))}
            disabled={!canCustomersAdd}
          />
          <FormField
            label="Notes"
            id="newNotes"
            type="textarea"
            placeholder="Enter notes"
            value={formData.notes}
            onChange={(v) => setFormData((p) => ({ ...p, notes: v }))}
            disabled={!canCustomersAdd}
          />

          <div className="form-group">
            <label htmlFor="newHeardFrom">
              Heard of us from <span className="required">*</span>
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
            >
              <option value="">Select…</option>
              {HEARD_FROM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {formErrors.heardFrom && <div className="error-message show">{formErrors.heardFrom}</div>}
          </div>

          {formData.heardFrom === "refer_person" && (
            <>
              <FormField
                label="Referred Person Name"
                id="newReferralPersonName"
                placeholder="Enter person name"
                value={formData.referralPersonName}
                onChange={(v) => setFormData((p) => ({ ...p, referralPersonName: v }))}
                error={formErrors.referralPersonName}
                required
                disabled={!canCustomersAdd}
              />
              <FormField
                label="Referred Person Mobile"
                id="newReferralPersonMobile"
                type="tel"
                placeholder="Enter mobile number"
                value={formData.referralPersonMobile}
                onChange={(v) => setFormData((p) => ({ ...p, referralPersonMobile: v }))}
                error={formErrors.referralPersonMobile}
                required
                disabled={!canCustomersAdd}
              />
            </>
          )}

          {formData.heardFrom === "social_media" && (
            <div className="form-group">
              <label htmlFor="newSocialPlatform">
                Social Platform <span className="required">*</span>
              </label>
              <select
                id="newSocialPlatform"
                className={`form-control ${formErrors.socialPlatform ? "error" : ""}`}
                value={formData.socialPlatform}
                onChange={(e) => setFormData((p) => ({ ...p, socialPlatform: e.target.value }))}
                disabled={!canCustomersAdd}
              >
                <option value="">Select…</option>
                {SOCIAL_PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {formErrors.socialPlatform && <div className="error-message show">{formErrors.socialPlatform}</div>}
            </div>
          )}

          {formData.heardFrom === "other" && (
            <FormField
              label="Other Note"
              id="newHeardFromOtherNote"
              type="textarea"
              placeholder="Enter note"
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
        onSave={handleSaveCustomer}
        isEdit
        saving={saving}
        saveDisabled={!canCustomersEdit}
        saveLabel={t("Save Changes")}
      >
        <form className="modal-form" onSubmit={(e) => e.preventDefault()}>
          <FormField
            label="First Name"
            id="editFirstName2"
            placeholder="Enter first name"
            value={formData.name}
            onChange={(v) => setFormData((p) => ({ ...p, name: v }))}
            error={formErrors.name}
            required
            disabled={!canCustomersEdit}
          />
          <FormField
            label="Last Name"
            id="editLastName2"
            placeholder="Enter last name"
            value={formData.lastname}
            onChange={(v) => setFormData((p) => ({ ...p, lastname: v }))}
            error={formErrors.lastname}
            required
            disabled={!canCustomersEdit}
          />
          <FormField
            label="Mobile Number"
            id="editPhone2"
            type="tel"
            placeholder="Enter mobile number"
            value={formData.phone}
            onChange={(v) => setFormData((p) => ({ ...p, phone: v }))}
            disabled={!canCustomersEdit}
          />
          <FormField
            label="Email Address"
            id="editEmail2"
            type="email"
            placeholder="Enter email address"
            value={formData.email}
            onChange={(v) => setFormData((p) => ({ ...p, email: v }))}
            disabled={!canCustomersEdit}
          />
          <FormField
            label="Company"
            id="editCompany2"
            placeholder="Enter company name"
            value={formData.company}
            onChange={(v) => setFormData((p) => ({ ...p, company: v }))}
            disabled={!canCustomersEdit}
          />
          <FormField
            label="Notes"
            id="editNotes2"
            type="textarea"
            placeholder="Enter notes"
            value={formData.notes}
            onChange={(v) => setFormData((p) => ({ ...p, notes: v }))}
            disabled={!canCustomersEdit}
          />

          <div className="form-group">
            <label htmlFor="editHeardFrom2">
              Heard of us from <span className="required">*</span>
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
            >
              <option value="">Select…</option>
              {HEARD_FROM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {formErrors.heardFrom && <div className="error-message show">{formErrors.heardFrom}</div>}
          </div>

          {formData.heardFrom === "refer_person" && (
            <>
              <FormField
                label="Referred Person Name"
                id="editReferralPersonName2"
                placeholder="Enter person name"
                value={formData.referralPersonName}
                onChange={(v) => setFormData((p) => ({ ...p, referralPersonName: v }))}
                error={formErrors.referralPersonName}
                required
                disabled={!canCustomersEdit}
              />
              <FormField
                label="Referred Person Mobile"
                id="editReferralPersonMobile2"
                type="tel"
                placeholder="Enter mobile number"
                value={formData.referralPersonMobile}
                onChange={(v) => setFormData((p) => ({ ...p, referralPersonMobile: v }))}
                error={formErrors.referralPersonMobile}
                required
                disabled={!canCustomersEdit}
              />
            </>
          )}

          {formData.heardFrom === "social_media" && (
            <div className="form-group">
              <label htmlFor="editSocialPlatform2">
                Social Platform <span className="required">*</span>
              </label>
              <select
                id="editSocialPlatform2"
                className={`form-control ${formErrors.socialPlatform ? "error" : ""}`}
                value={formData.socialPlatform}
                onChange={(e) => setFormData((p) => ({ ...p, socialPlatform: e.target.value }))}
                disabled={!canCustomersEdit}
              >
                <option value="">Select…</option>
                {SOCIAL_PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {formErrors.socialPlatform && <div className="error-message show">{formErrors.socialPlatform}</div>}
            </div>
          )}

          {formData.heardFrom === "other" && (
            <FormField
              label="Other Note"
              id="editHeardFromOtherNote2"
              type="textarea"
              placeholder="Enter note"
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
                <i className="fas fa-exclamation-triangle" /> Confirm Deletion
              </h3>
            </div>
            <div className="delete-modal-body">
              <div className="delete-warning">
                <i className="fas fa-exclamation-circle" />
                <div className="delete-warning-text">
                  <p>
                    You are about to delete customer <strong>{deleteCustomerId}</strong>.
                  </p>
                  <p>This action cannot be undone.</p>
                </div>
              </div>

              <div className="delete-modal-actions">
                <button className="btn-confirm-delete" onClick={() => void handleConfirmDelete()} disabled={saving}>
                  <i className="fas fa-trash" /> Delete Customer
                </button>
                <button className="btn-cancel" onClick={() => setDeleteCustomerId(null)} disabled={saving}>
                  <i className="fas fa-times" /> Cancel
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