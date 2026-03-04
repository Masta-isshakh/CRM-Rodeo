import { useEffect, useMemo, useState } from "react";
import PermissionGate from "./PermissionGate";
import "./ServiceCreation.css";
import {
  createServiceCatalogItem,
  deleteServiceCatalogItem,
  listServiceCatalog,
  updateServiceCatalogItem,
  type ServiceCatalogItem,
  type ServiceCatalogType,
} from "./serviceCatalogRepo";

type FormState = {
  id?: string;
  serviceCode: string;
  name: string;
  type: ServiceCatalogType;
  suvPrice: string;
  sedanPrice: string;
  includedServiceCodes: string[];
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  serviceCode: "",
  name: "",
  type: "service",
  suvPrice: "",
  sedanPrice: "",
  includedServiceCodes: [],
  isActive: true,
};

function formatQar(value: number) {
  return `QAR ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function smartMatch(service: ServiceCatalogItem, query: string) {
  const terms = query
    .toLowerCase()
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!terms.length) return true;

  const fieldMap: Record<string, string> = {
    id: service.serviceCode,
    code: service.serviceCode,
    name: service.name,
    type: service.type,
    suv: String(service.suvPrice),
    sedan: String(service.sedanPrice),
    price: `${service.suvPrice} ${service.sedanPrice}`,
  };

  return terms.every((term) => {
    if (term.startsWith("!")) {
      const ex = term.slice(1);
      if (!ex) return true;
      return !Object.values(fieldMap).some((v) => v.toLowerCase().includes(ex));
    }

    if (term.includes(":")) {
      const [k, ...rest] = term.split(":");
      const val = rest.join(":").trim();
      if (!k || !val) return true;
      return String(fieldMap[k] || "").toLowerCase().includes(val.toLowerCase());
    }

    return Object.values(fieldMap).some((v) => v.toLowerCase().includes(term));
  });
}

export default function ServiceCreation() {
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [selected, setSelected] = useState<ServiceCatalogItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ message: string; isError?: boolean } | null>(null);

  const loadServices = async () => {
    setLoading(true);
    try {
      const rows = await listServiceCatalog();
      setServices(rows);
    } catch (e: any) {
      setBanner({ message: String(e?.message || "Failed to load services"), isError: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadServices();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, pageSize]);

  const filtered = useMemo(() => services.filter((s) => smartMatch(s, search)), [services, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  const openCreate = () => {
    setError("");
    setSelected(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (item: ServiceCatalogItem) => {
    setError("");
    setSelected(item);
    setForm({
      id: item.id,
      serviceCode: item.serviceCode,
      name: item.name,
      type: item.type,
      suvPrice: String(item.suvPrice),
      sedanPrice: String(item.sedanPrice),
      includedServiceCodes: item.includedServiceCodes,
      isActive: item.isActive,
    });
    setFormOpen(true);
  };

  const validateForm = () => {
    if (!form.serviceCode.trim()) return "Service code is required.";
    if (!form.name.trim()) return "Service/Package name is required.";

    const suv = Number(form.suvPrice);
    const sedan = Number(form.sedanPrice);

    if (!Number.isFinite(suv) || suv < 0) return "SUV price must be a non-negative number.";
    if (!Number.isFinite(sedan) || sedan < 0) return "Sedan price must be a non-negative number.";

    if (form.type === "package" && form.includedServiceCodes.length === 0) {
      return "Please select at least one service for the package.";
    }

    return "";
  };

  const saveForm = async () => {
    const v = validateForm();
    if (v) {
      setError(v);
      return;
    }

    setSaving(true);
    setError("");

    try {
      if (form.id) {
        await updateServiceCatalogItem({
          id: form.id,
          serviceCode: form.serviceCode,
          name: form.name,
          type: form.type,
          suvPrice: Number(form.suvPrice),
          sedanPrice: Number(form.sedanPrice),
          includedServiceCodes: form.type === "package" ? form.includedServiceCodes : [],
          isActive: form.isActive,
        });
        setBanner({ message: "Service updated successfully." });
      } else {
        await createServiceCatalogItem({
          serviceCode: form.serviceCode,
          name: form.name,
          type: form.type,
          suvPrice: Number(form.suvPrice),
          sedanPrice: Number(form.sedanPrice),
          includedServiceCodes: form.type === "package" ? form.includedServiceCodes : [],
          isActive: form.isActive,
        });
        setBanner({ message: "Service created successfully." });
      }

      setFormOpen(false);
      await loadServices();
    } catch (e: any) {
      setError(String(e?.message || "Failed to save service"));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!selected?.id) return;
    setSaving(true);
    try {
      await deleteServiceCatalogItem(selected.id);
      setDeleteOpen(false);
      setBanner({ message: `Service ${selected.serviceCode} deleted.` });
      await loadServices();
    } catch (e: any) {
      setBanner({ message: String(e?.message || "Failed to delete service"), isError: true });
    } finally {
      setSaving(false);
    }
  };

  const allSingleServices = useMemo(
    () => services.filter((s) => s.type === "service" && (!form.id || s.id !== form.id)),
    [services, form.id]
  );

  return (
    <div className="sc-page">
      <div className="sc-shell">
        <div className="sc-header">
          <h1>
            <i className="fas fa-concierge-bell"></i> Service Management
          </h1>
        </div>

        <div className="sc-toolbar">
          <input
            className="sc-input"
            placeholder="Search by code, name, type or price (supports !term and field:value)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select className="sc-select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value) || 10)}>
            <option value={10}>10 / page</option>
            <option value={20}>20 / page</option>
            <option value={50}>50 / page</option>
          </select>

          <PermissionGate moduleId="joborder" optionId="joborder_create">
            <button className="sc-btn sc-btn-primary" onClick={openCreate}>
              <i className="fas fa-plus-circle"></i> Create New Service
            </button>
          </PermissionGate>
        </div>

        <div className="sc-content">
          <div className="sc-stats">
            {loading
              ? "Loading services..."
              : filtered.length
              ? `Showing ${(safePage - 1) * pageSize + 1}-${Math.min(safePage * pageSize, filtered.length)} of ${filtered.length} services`
              : "No services found"}
          </div>

          {banner && (
            <div className={`sc-delete-copy`} style={{ marginBottom: 12, color: banner.isError ? "#991b1b" : "#065f46", background: banner.isError ? "#fef2f2" : "#ecfdf5", borderLeftColor: banner.isError ? "#ef4444" : "#10b981" }}>
              {banner.message}
            </div>
          )}

          {!loading && pageItems.length === 0 ? (
            <div className="sc-empty">
              <p>
                <i className="fas fa-inbox" style={{ fontSize: 36 }}></i>
              </p>
              <p>No matching services found.</p>
            </div>
          ) : (
            <div className="sc-table-wrap">
              <table className="sc-table">
                <thead>
                  <tr>
                    <th>Service ID</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>SUV Price</th>
                    <th>Sedan Price</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.serviceCode}</td>
                      <td>{item.name}</td>
                      <td>
                        <span className={`sc-badge ${item.type === "package" ? "sc-badge-package" : "sc-badge-service"}`}>{item.type}</span>
                      </td>
                      <td>{formatQar(item.suvPrice)}</td>
                      <td>{formatQar(item.sedanPrice)}</td>
                      <td>
                        <div className="sc-actions">
                          <button className="sc-btn sc-btn-ghost" onClick={() => { setSelected(item); setDetailsOpen(true); }}>
                            View
                          </button>
                          <PermissionGate moduleId="joborder" optionId="joborder_create">
                            <button className="sc-btn sc-btn-primary" onClick={() => openEdit(item)}>
                              Edit
                            </button>
                          </PermissionGate>
                          <PermissionGate moduleId="joborder" optionId="joborder_create">
                            <button className="sc-btn sc-btn-danger" onClick={() => { setSelected(item); setDeleteOpen(true); }}>
                              Delete
                            </button>
                          </PermissionGate>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="sc-pagination">
              <button className="sc-page-btn" disabled={safePage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>
                <i className="fas fa-chevron-left"></i>
              </button>

              {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                const start = Math.max(1, Math.min(safePage - 2, totalPages - 4));
                const page = start + idx;
                if (page > totalPages) return null;
                return (
                  <button key={page} className={`sc-page-btn ${page === safePage ? "active" : ""}`} onClick={() => setCurrentPage(page)}>
                    {page}
                  </button>
                );
              })}

              <button className="sc-page-btn" disabled={safePage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>
                <i className="fas fa-chevron-right"></i>
              </button>
            </div>
          )}
        </div>
      </div>

      {formOpen && (
        <div className="sc-overlay" onClick={() => setFormOpen(false)}>
          <div className="sc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sc-modal-header">
              <h2>{form.id ? "Edit Service" : "Create New Service"}</h2>
              <button className="sc-btn" onClick={() => setFormOpen(false)}>✕</button>
            </div>

            <div className="sc-modal-body">
              <div className="sc-type-switch">
                <button className={`sc-type-btn ${form.type === "service" ? "active" : ""}`} onClick={() => setForm((p) => ({ ...p, type: "service", includedServiceCodes: [] }))}>
                  <i className="fas fa-cog"></i>
                  <div>Service</div>
                </button>
                <button className={`sc-type-btn ${form.type === "package" ? "active" : ""}`} onClick={() => setForm((p) => ({ ...p, type: "package" }))}>
                  <i className="fas fa-box"></i>
                  <div>Package</div>
                </button>
              </div>

              <div className="sc-grid-2">
                <div className="sc-field">
                  <label>Service ID *</label>
                  <input className="sc-input" value={form.serviceCode} onChange={(e) => setForm((p) => ({ ...p, serviceCode: e.target.value.toUpperCase() }))} placeholder="SVC001 / PKG001" />
                </div>

                <div className="sc-field">
                  <label>Name *</label>
                  <input className="sc-input" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Service or package name" />
                </div>

                <div className="sc-field">
                  <label>SUV Price *</label>
                  <input className="sc-input" type="number" min={0} step="0.01" value={form.suvPrice} onChange={(e) => setForm((p) => ({ ...p, suvPrice: e.target.value }))} />
                </div>

                <div className="sc-field">
                  <label>Sedan Price *</label>
                  <input className="sc-input" type="number" min={0} step="0.01" value={form.sedanPrice} onChange={(e) => setForm((p) => ({ ...p, sedanPrice: e.target.value }))} />
                </div>
              </div>

              {form.type === "package" && (
                <div className="sc-field">
                  <label>Select Services for Package *</label>
                  <div className="sc-service-list">
                    {allSingleServices.length === 0 && <div className="sc-empty">No individual services available.</div>}
                    {allSingleServices.map((s) => {
                      const checked = form.includedServiceCodes.includes(s.serviceCode);
                      return (
                        <label key={s.id} className="sc-service-item">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...form.includedServiceCodes, s.serviceCode]
                                : form.includedServiceCodes.filter((x) => x !== s.serviceCode);
                              setForm((p) => ({ ...p, includedServiceCodes: next }));
                            }}
                          />
                          <span>{s.name}</span>
                          <strong>{formatQar(s.suvPrice)} / {formatQar(s.sedanPrice)}</strong>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {error && <div className="sc-delete-copy">{error}</div>}

              <div className="sc-modal-actions">
                <button className="sc-btn sc-btn-ghost" onClick={() => setFormOpen(false)}>Cancel</button>
                <button className="sc-btn sc-btn-primary" onClick={() => void saveForm()} disabled={saving}>
                  {saving ? "Saving..." : "Save Service"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {detailsOpen && selected && (
        <div className="sc-overlay" onClick={() => setDetailsOpen(false)}>
          <div className="sc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sc-modal-header">
              <h2>Service Details</h2>
              <button className="sc-btn" onClick={() => setDetailsOpen(false)}>✕</button>
            </div>
            <div className="sc-modal-body">
              <div className="sc-details-grid">
                <div><strong>Service ID:</strong> {selected.serviceCode}</div>
                <div><strong>Name:</strong> {selected.name}</div>
                <div><strong>Type:</strong> {selected.type}</div>
                <div><strong>SUV Price:</strong> {formatQar(selected.suvPrice)}</div>
                <div><strong>Sedan Price:</strong> {formatQar(selected.sedanPrice)}</div>
                <div><strong>Status:</strong> {selected.isActive ? "Active" : "Inactive"}</div>
              </div>

              {selected.type === "package" && (
                <div style={{ marginTop: 14 }}>
                  <strong>Included Services:</strong>
                  <div style={{ marginTop: 8, color: "#334155" }}>
                    {selected.includedServiceCodes.length ? selected.includedServiceCodes.join(", ") : "No included services."}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteOpen && selected && (
        <div className="sc-overlay" onClick={() => setDeleteOpen(false)}>
          <div className="sc-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="sc-modal-header">
              <h2>Confirm Deletion</h2>
              <button className="sc-btn" onClick={() => setDeleteOpen(false)}>✕</button>
            </div>
            <div className="sc-modal-body">
              <div className="sc-delete-copy">
                You are about to delete <strong>{selected.serviceCode}</strong> ({selected.name}). This action cannot be undone.
              </div>

              <div className="sc-modal-actions">
                <button className="sc-btn sc-btn-ghost" onClick={() => setDeleteOpen(false)}>Cancel</button>
                <button className="sc-btn sc-btn-danger" onClick={() => void confirmDelete()} disabled={saving}>
                  {saving ? "Deleting..." : "Delete Service"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
