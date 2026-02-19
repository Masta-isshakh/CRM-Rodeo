// src/pages/Customers.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { generateClient } from "aws-amplify/data";
import { getCurrentUser } from "aws-amplify/auth";
import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";
import { logActivity } from "../utils/activityLogger";
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
};

type FormErrors = Partial<Record<keyof CustomerForm, string>>;

type CountsMap = Record<
  string,
  {
    contacts: number;
    deals: number;
    tickets: number;
  }
>;

// ✅ replaceAll-safe helper
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
  searchQuery: string;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const { data, counts, onViewDetails, onEdit, onDelete, searchQuery, canUpdate, canDelete } = props;

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
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [activeDropdown]);

  const highlight = (text: string, query: string) => {
    const safeText = escapeHtml(text ?? "");
    if (!query.trim()) return safeText;

    const terms = query
      .toLowerCase()
      .split(" ")
      .map((t) => t.trim())
      .filter(Boolean);

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
                <td>{c.id}</td>

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
                  <div className="action-dropdown-container">
                    <button
                      className={`btn-action-dropdown ${activeDropdown === c.id ? "active" : ""}`}
                      onClick={(e) => {
                        const isActive = activeDropdown === c.id;
                        if (isActive) return setActiveDropdown(null);

                        const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                        const menuHeight = 150;
                        const menuWidth = 210;
                        const spaceBelow = window.innerHeight - rect.bottom;
                        const top = spaceBelow < menuHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
                        const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));

                        setDropdownPosition({ top, left });
                        setActiveDropdown(c.id);
                      }}
                      type="button"
                    >
                      <i className="fas fa-cogs" /> Actions <i className="fas fa-chevron-down" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {activeDropdown && typeof document !== "undefined" &&
        createPortal(
          <div
            className="action-dropdown-menu show action-dropdown-menu-fixed"
            style={{ top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` }}
          >
            <button
              className="dropdown-item view"
              onClick={() => {
                onViewDetails(activeDropdown);
                setActiveDropdown(null);
              }}
            >
              <i className="fas fa-eye" /> View Details
            </button>

            {(canUpdate || canDelete) && <div className="dropdown-divider" />}

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
  contacts: ContactRow[];
  deals: DealRow[];
  tickets: TicketRow[];
  loadingRelations: boolean;
  onClose: () => void;
  onEdit: (id: string) => void;
  canUpdate: boolean;
}) {
  const { customer, counts, contacts, deals, tickets, loadingRelations, onClose, onEdit, canUpdate } = props;

  const fullName = `${customer.name ?? ""} ${customer.lastname ?? ""}`.trim();
  const createdAt = customer.createdAt ? new Date(customer.createdAt).toLocaleString() : "—";
  const ct = counts[customer.id] || { contacts: 0, deals: 0, tickets: 0 };

  return (
    <div className="pim-details-screen">
      <div className="pim-details-header">
        <div className="pim-details-title-container">
          <h2>
            <i className="fas fa-user-circle" /> Customer Details - <span>{customer.id}</span>
          </h2>
        </div>
        <button className="pim-btn-close-details" onClick={onClose} type="button">
          <i className="fas fa-times" /> Close Details
        </button>
      </div>

      <div className="pim-details-body">
        <div className="pim-details-grid">
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
                <span className="pim-info-value">{customer.id}</span>
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
                <span className="pim-info-label">Created At</span>
                <span className="pim-info-value">{createdAt}</span>
              </div>
            </div>
          </div>

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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Main Page
// -----------------------------
export default function Customers({ permissions }: PageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
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
    setLoading(true);
    try {
      const [cRes, contactRes, dealRes, ticketRes] = await Promise.all([
        client.models.Customer.list({ limit: 2000 }),
        client.models.Contact.list({ limit: 5000 }),
        client.models.Deal.list({ limit: 5000 }),
        client.models.Ticket.list({ limit: 5000 }),
      ]);

      const cData = (cRes.data ?? []).slice().sort((a, b) => {
        const an = `${a.name ?? ""} ${a.lastname ?? ""}`.trim().toLowerCase();
        const bn = `${b.name ?? ""} ${b.lastname ?? ""}`.trim().toLowerCase();
        return an.localeCompare(bn);
      });

      setCustomers(cData);
      setCounts(computeCounts(contactRes.data ?? [], dealRes.data ?? [], ticketRes.data ?? []));
    } catch (err) {
      console.error(err);
      await showAlert("Error", "Failed to load customers from Amplify.", "error");
    } finally {
      setLoading(false);
    }
  }, [computeCounts, showAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  const performSmartSearch = useCallback((query: string, list: CustomerRow[]) => {
    if (!query.trim()) return list;

    const terms = query.toLowerCase().split(" ").filter((t) => t.trim());
    let results = [...list];

    for (const term of terms) {
      results = results.filter((c) => {
        const fullName = `${c.name ?? ""} ${c.lastname ?? ""}`.trim().toLowerCase();
        return (
          String(c.id).toLowerCase().includes(term) ||
          fullName.includes(term) ||
          String(c.phone ?? "").toLowerCase().includes(term) ||
          String(c.email ?? "").toLowerCase().includes(term) ||
          String(c.company ?? "").toLowerCase().includes(term)
        );
      });
    }

    return results;
  }, []);

  const searchResults = useMemo(() => performSmartSearch(searchQuery, customers), [searchQuery, customers, performSmartSearch]);

  const totalPages = Math.ceil(searchResults.length / pageSize) || 1;
  const paginatedData = searchResults.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const resetForm = () => {
    setFormData({ name: "", lastname: "", phone: "", email: "", company: "", notes: "" });
    setFormErrors({});
    setEditingCustomerId(null);
  };

  const openAddModal = () => {
    if (!permissions.canCreate) return;
    resetForm();
    setShowAddCustomerModal(true);
  };

  const openEditModal = (id: string) => {
    if (!permissions.canUpdate) return;
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
    });
    setFormErrors({});
    setShowEditCustomerModal(true);
  };

  const openDeleteConfirm = (id: string) => {
    if (!permissions.canDelete) return;
    setDeleteCustomerId(id);
  };

  const openDetailsView = async (id: string) => {
    if (!permissions.canRead) return;

    setSelectedCustomerId(id);
    setViewMode("details");

    setLoadingRelations(true);
    setContacts([]);
    setDeals([]);
    setTickets([]);
    try {
      const [contactRes, dealRes, ticketRes] = await Promise.all([
        client.models.Contact.list({ filter: { customerId: { eq: id } }, limit: 2000 }),
        client.models.Deal.list({ filter: { customerId: { eq: id } }, limit: 2000 }),
        client.models.Ticket.list({ filter: { customerId: { eq: id } }, limit: 2000 }),
      ]);

      setContacts(contactRes.data ?? []);
      setDeals(dealRes.data ?? []);
      setTickets(ticketRes.data ?? []);
    } catch (err) {
      console.error(err);
      await showAlert("Warning", "Could not load related records.", "warning");
    } finally {
      setLoadingRelations(false);
    }
  };

  const closeDetailsView = () => {
    setViewMode("list");
    setSelectedCustomerId(null);
  };

  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!formData.name.trim()) e.name = "First name is required";
    if (!formData.lastname.trim()) e.lastname = "Last name is required";
    setFormErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleAddCustomer = async () => {
    if (!permissions.canCreate) return;
    if (saving) return;
    if (!validate()) return;

    setSaving(true);
    try {
      const u = await getCurrentUser();
      const createdBy = (u.signInDetails?.loginId || u.username || "").toLowerCase();

      const created = await client.models.Customer.create({
        name: formData.name.trim(),
        lastname: formData.lastname.trim(),
        phone: formData.phone.trim() || undefined,
        email: formData.email.trim() || undefined,
        company: formData.company.trim() || undefined,
        notes: formData.notes.trim() || undefined,
        createdBy,
        createdAt: new Date().toISOString(),
      });

      if (!created.data) throw new Error("Customer not created");

      await logActivity("Customer", created.data.id, "CREATE", `Customer ${formData.name} ${formData.lastname} created`);

      setCustomers((prev) => [created.data!, ...prev]);
      setCounts((prev) => ({ ...prev, [created.data!.id]: { contacts: 0, deals: 0, tickets: 0 } }));

      setShowAddCustomerModal(false);
      resetForm();
      await showAlert("Success", `Customer "${created.data.name} ${created.data.lastname}" added successfully!`, "success");
    } catch (err) {
      console.error(err);
      await showAlert("Error", "Failed to create customer. Check console.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCustomer = async () => {
    if (!permissions.canUpdate) return;
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
              }
            : c
        )
      );

      setShowEditCustomerModal(false);
      resetForm();
      await showAlert("Success", "Customer updated successfully!", "success");
    } catch (err) {
      console.error(err);
      await showAlert("Error", "Failed to update customer. Check console.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!permissions.canDelete) return;
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
      await showAlert("Success", "Customer deleted successfully!", "success");
    } catch (err) {
      console.error(err);
      await showAlert("Error", "Delete failed. Check console.", "error");
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
          contacts={contacts}
          deals={deals}
          tickets={tickets}
          loadingRelations={loadingRelations}
          onClose={closeDetailsView}
          onEdit={openEditModal}
          canUpdate={permissions.canUpdate}
        />

        <Modal
          isOpen={showEditCustomerModal}
          title="Edit Customer"
          icon="fas fa-user-edit"
          onClose={() => setShowEditCustomerModal(false)}
          onSave={handleSaveCustomer}
          isEdit
          saving={saving}
          saveDisabled={!permissions.canUpdate}
          saveLabel="Save Changes"
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
              disabled={!permissions.canUpdate}
            />
            <FormField
              label="Last Name"
              id="editLastName"
              placeholder="Enter last name"
              value={formData.lastname}
              onChange={(v) => setFormData((p) => ({ ...p, lastname: v }))}
              error={formErrors.lastname}
              required
              disabled={!permissions.canUpdate}
            />
            <FormField
              label="Mobile Number"
              id="editPhone"
              type="tel"
              placeholder="Enter mobile number"
              value={formData.phone}
              onChange={(v) => setFormData((p) => ({ ...p, phone: v }))}
              disabled={!permissions.canUpdate}
            />
            <FormField
              label="Email Address"
              id="editEmail"
              type="email"
              placeholder="Enter email address"
              value={formData.email}
              onChange={(v) => setFormData((p) => ({ ...p, email: v }))}
              disabled={!permissions.canUpdate}
            />
            <FormField
              label="Company"
              id="editCompany"
              placeholder="Enter company name"
              value={formData.company}
              onChange={(v) => setFormData((p) => ({ ...p, company: v }))}
              disabled={!permissions.canUpdate}
            />
            <FormField
              label="Notes"
              id="editNotes"
              type="textarea"
              placeholder="Enter notes"
              value={formData.notes}
              onChange={(v) => setFormData((p) => ({ ...p, notes: v }))}
              disabled={!permissions.canUpdate}
            />
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
    <div className="app-container" id="mainScreen">
      <header className="app-header">
        <div className="header-left">
          <h1>
            <i className="fas fa-users" /> Customers Management
          </h1>
        </div>
        <div className="header-right">
          <button className="btn-refresh" onClick={() => void load()} disabled={loading}>
            <i className="fas fa-sync" /> {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </header>

      <main className="main-content">
        <section className="search-section">
          <div className="search-container">
            <i className="fas fa-search search-icon" />
            <input
              type="text"
              className="smart-search-input"
              placeholder="Search by any customer details"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              autoComplete="off"
            />
          </div>

          <div className="search-stats">
            {loading ? (
              "Loading customers…"
            ) : searchResults.length === 0 ? (
              "No customers found"
            ) : (
              <>
                Showing {Math.min((currentPage - 1) * pageSize + 1, searchResults.length)}-
                {Math.min(currentPage * pageSize, searchResults.length)} of {searchResults.length} customers
                {searchQuery && <span style={{ color: "var(--secondary-color)" }}> (Filtered by: "{searchQuery}")</span>}
              </>
            )}
          </div>
        </section>

        <section className="results-section">
          <div className="section-header">
            <h2>
              <i className="fas fa-list" /> Customers Records
            </h2>

            <div className="pagination-controls">
              <div className="records-per-page">
                <label htmlFor="pageSizeSelect">Records per page:</label>
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

              {permissions.canCreate && (
                <button className="btn-new-customer" onClick={openAddModal} type="button">
                  <i className="fas fa-plus-circle" /> Add New Customer
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
            searchQuery={searchQuery}
            canUpdate={permissions.canUpdate}
            canDelete={permissions.canDelete}
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
        <p>Service Management System © {new Date().getFullYear()} | Customers Management Module</p>
      </footer>

      <Modal
        isOpen={showAddCustomerModal}
        title="Add New Customer"
        icon="fas fa-user-plus"
        onClose={() => setShowAddCustomerModal(false)}
        onSave={handleAddCustomer}
        saving={saving}
        saveDisabled={!permissions.canCreate}
        saveLabel="Add Customer"
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
            disabled={!permissions.canCreate}
          />
          <FormField
            label="Last Name"
            id="newLastName"
            placeholder="Enter last name"
            value={formData.lastname}
            onChange={(v) => setFormData((p) => ({ ...p, lastname: v }))}
            error={formErrors.lastname}
            required
            disabled={!permissions.canCreate}
          />
          <FormField
            label="Mobile Number"
            id="newPhone"
            type="tel"
            placeholder="Enter mobile number"
            value={formData.phone}
            onChange={(v) => setFormData((p) => ({ ...p, phone: v }))}
            disabled={!permissions.canCreate}
          />
          <FormField
            label="Email Address"
            id="newEmail"
            type="email"
            placeholder="Enter email address"
            value={formData.email}
            onChange={(v) => setFormData((p) => ({ ...p, email: v }))}
            disabled={!permissions.canCreate}
          />
          <FormField
            label="Company"
            id="newCompany"
            placeholder="Enter company name"
            value={formData.company}
            onChange={(v) => setFormData((p) => ({ ...p, company: v }))}
            disabled={!permissions.canCreate}
          />
          <FormField
            label="Notes"
            id="newNotes"
            type="textarea"
            placeholder="Enter notes"
            value={formData.notes}
            onChange={(v) => setFormData((p) => ({ ...p, notes: v }))}
            disabled={!permissions.canCreate}
          />
        </form>
      </Modal>

      <Modal
        isOpen={showEditCustomerModal}
        title="Edit Customer"
        icon="fas fa-user-edit"
        onClose={() => setShowEditCustomerModal(false)}
        onSave={handleSaveCustomer}
        isEdit
        saving={saving}
        saveDisabled={!permissions.canUpdate}
        saveLabel="Save Changes"
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
            disabled={!permissions.canUpdate}
          />
          <FormField
            label="Last Name"
            id="editLastName2"
            placeholder="Enter last name"
            value={formData.lastname}
            onChange={(v) => setFormData((p) => ({ ...p, lastname: v }))}
            error={formErrors.lastname}
            required
            disabled={!permissions.canUpdate}
          />
          <FormField
            label="Mobile Number"
            id="editPhone2"
            type="tel"
            placeholder="Enter mobile number"
            value={formData.phone}
            onChange={(v) => setFormData((p) => ({ ...p, phone: v }))}
            disabled={!permissions.canUpdate}
          />
          <FormField
            label="Email Address"
            id="editEmail2"
            type="email"
            placeholder="Enter email address"
            value={formData.email}
            onChange={(v) => setFormData((p) => ({ ...p, email: v }))}
            disabled={!permissions.canUpdate}
          />
          <FormField
            label="Company"
            id="editCompany2"
            placeholder="Enter company name"
            value={formData.company}
            onChange={(v) => setFormData((p) => ({ ...p, company: v }))}
            disabled={!permissions.canUpdate}
          />
          <FormField
            label="Notes"
            id="editNotes2"
            type="textarea"
            placeholder="Enter notes"
            value={formData.notes}
            onChange={(v) => setFormData((p) => ({ ...p, notes: v }))}
            disabled={!permissions.canUpdate}
          />
        </form>
      </Modal>

      {deleteCustomerId && (
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
