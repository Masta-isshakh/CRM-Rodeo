import { useEffect, useMemo, useState } from "react";
import PermissionGate from "./PermissionGate";
import "./ServiceCreation.css";
import {
  createServiceCatalogItem,
  createServiceCategoryItem,
  deleteServiceCatalogItem,
  deleteServiceCategoryItem,
  listServiceCatalog,
  listServiceCategories,
  updateServiceCatalogItem,
  updateServiceCategoryItem,
  type ServiceCatalogItem,
  type ServiceCategoryItem,
} from "./serviceCatalogRepo";

type Tab = "services" | "packages";
type ModalType = "none" | "category" | "service" | "package";

type CategoryFormState = {
  id?: string;
  categoryCode: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
};

type ServiceFormState = {
  id?: string;
  categoryId: string;
  serviceCode: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  suvPrice: string;
  sedanPrice: string;
  hatchbackPrice: string;
  truckPrice: string;
  coupePrice: string;
  otherPrice: string;
};

type PackageFormState = {
  id?: string;
  packageCode: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  suvPrice: string;
  sedanPrice: string;
  hatchbackPrice: string;
  truckPrice: string;
  coupePrice: string;
  otherPrice: string;
  includedServiceCodes: string[];
};

const EMPTY_CATEGORY_FORM: CategoryFormState = {
  categoryCode: "",
  nameEn: "",
  nameAr: "",
  descriptionEn: "",
  descriptionAr: "",
};

const EMPTY_SERVICE_FORM: ServiceFormState = {
  categoryId: "",
  serviceCode: "",
  nameEn: "",
  nameAr: "",
  descriptionEn: "",
  descriptionAr: "",
  suvPrice: "",
  sedanPrice: "",
  hatchbackPrice: "",
  truckPrice: "",
  coupePrice: "",
  otherPrice: "",
};

const EMPTY_PACKAGE_FORM: PackageFormState = {
  packageCode: "",
  nameEn: "",
  nameAr: "",
  descriptionEn: "",
  descriptionAr: "",
  suvPrice: "",
  sedanPrice: "",
  hatchbackPrice: "",
  truckPrice: "",
  coupePrice: "",
  otherPrice: "",
  includedServiceCodes: [],
};

function toNum(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toOptionalNum(value: string): number | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

function formatQar(value: number | undefined) {
  return `QAR ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function makeNextCode(existingCodes: string[], prefix: string) {
  const maxNum = existingCodes.reduce((max, code) => {
    const m = String(code || "").toUpperCase().match(new RegExp(`^${prefix}(\\\\d+)$`));
    if (!m) return max;
    return Math.max(max, Number(m[1]));
  }, 0);
  const next = String(maxNum + 1).padStart(3, "0");
  return `${prefix}${next}`;
}

function displayBilingual(en?: string, ar?: string) {
  const e = String(en || "").trim();
  const a = String(ar || "").trim();
  if (e && a) return `${e} / ${a}`;
  return e || a || "-";
}

export default function ServiceCreation() {
  const [activeTab, setActiveTab] = useState<Tab>("services");
  const [modalType, setModalType] = useState<ModalType>("none");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState<{ message: string; isError?: boolean } | null>(null);

  const [categories, setCategories] = useState<ServiceCategoryItem[]>([]);
  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([]);

  const [editingCategory, setEditingCategory] = useState<ServiceCategoryItem | null>(null);
  const [editingService, setEditingService] = useState<ServiceCatalogItem | null>(null);
  const [editingPackage, setEditingPackage] = useState<ServiceCatalogItem | null>(null);

  const [pendingDelete, setPendingDelete] = useState<
    | { type: "category"; item: ServiceCategoryItem }
    | { type: "catalog"; item: ServiceCatalogItem }
    | null
  >(null);

  const [categoryForm, setCategoryForm] = useState<CategoryFormState>(EMPTY_CATEGORY_FORM);
  const [serviceForm, setServiceForm] = useState<ServiceFormState>(EMPTY_SERVICE_FORM);
  const [packageForm, setPackageForm] = useState<PackageFormState>(EMPTY_PACKAGE_FORM);

  const loadData = async () => {
    setLoading(true);
    try {
      const [cats, items] = await Promise.all([listServiceCategories(), listServiceCatalog()]);
      setCategories(cats);
      setCatalog(items);
    } catch (e: any) {
      setBanner({ message: String(e?.message || "Failed to load service data"), isError: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const services = useMemo(() => catalog.filter((x) => x.type === "service"), [catalog]);
  const packages = useMemo(() => catalog.filter((x) => x.type === "package"), [catalog]);

  const serviceByCode = useMemo(() => {
    const map = new Map<string, ServiceCatalogItem>();
    services.forEach((s) => map.set(String(s.serviceCode || "").trim(), s));
    return map;
  }, [services]);

  const categoryRows = useMemo(() => {
    const out = categories
      .map((category) => ({
        category,
        services: services.filter((service) => service.categoryId === category.id),
      }))
      .filter((row) => row.category.isActive !== false);

    const uncategorized = services.filter((service) => !service.categoryId);
    if (uncategorized.length) {
      out.push({
        category: {
          id: "uncategorized",
          categoryCode: "UNC",
          nameEn: "Uncategorized",
          nameAr: "غير مصنف",
          descriptionEn: "",
          descriptionAr: "",
          isActive: true,
        },
        services: uncategorized,
      });
    }

    return out;
  }, [categories, services]);

  const avgServicesPerCategory = useMemo(() => {
    const count = categories.length || 1;
    return (services.length / count).toFixed(1);
  }, [categories.length, services.length]);

  const avgPackagePrice = useMemo(() => {
    if (!packages.length) return 0;
    const total = packages.reduce((sum, p) => sum + Number(p.suvPrice || 0), 0);
    return total / packages.length;
  }, [packages]);

  const closeModal = () => {
    setModalType("none");
    setError("");
  };

  const openCategoryModal = (item?: ServiceCategoryItem) => {
    setError("");
    setEditingCategory(item || null);
    if (item) {
      setCategoryForm({
        id: item.id,
        categoryCode: item.categoryCode,
        nameEn: item.nameEn,
        nameAr: item.nameAr,
        descriptionEn: item.descriptionEn || "",
        descriptionAr: item.descriptionAr || "",
      });
    } else {
      setCategoryForm({
        ...EMPTY_CATEGORY_FORM,
        categoryCode: makeNextCode(categories.map((c) => c.categoryCode), "CAT"),
      });
    }
    setModalType("category");
  };

  const openServiceModal = (item?: ServiceCatalogItem) => {
    setError("");
    setEditingService(item || null);
    if (item) {
      setServiceForm({
        id: item.id,
        categoryId: item.categoryId || "",
        serviceCode: item.serviceCode,
        nameEn: item.name,
        nameAr: item.nameAr || "",
        descriptionEn: item.descriptionEn || "",
        descriptionAr: item.descriptionAr || "",
        suvPrice: String(item.suvPrice || ""),
        sedanPrice: String(item.sedanPrice || ""),
        hatchbackPrice: String(item.hatchbackPrice ?? ""),
        truckPrice: String(item.truckPrice ?? ""),
        coupePrice: String(item.coupePrice ?? ""),
        otherPrice: String(item.otherPrice ?? ""),
      });
    } else {
      setServiceForm({
        ...EMPTY_SERVICE_FORM,
        serviceCode: makeNextCode(services.map((s) => s.serviceCode), "SVC"),
      });
    }
    setModalType("service");
  };

  const openPackageModal = (item?: ServiceCatalogItem) => {
    setError("");
    setEditingPackage(item || null);
    if (item) {
      setPackageForm({
        id: item.id,
        packageCode: item.serviceCode,
        nameEn: item.name,
        nameAr: item.nameAr || "",
        descriptionEn: item.descriptionEn || "",
        descriptionAr: item.descriptionAr || "",
        suvPrice: String(item.suvPrice || ""),
        sedanPrice: String(item.sedanPrice || ""),
        hatchbackPrice: String(item.hatchbackPrice ?? ""),
        truckPrice: String(item.truckPrice ?? ""),
        coupePrice: String(item.coupePrice ?? ""),
        otherPrice: String(item.otherPrice ?? ""),
        includedServiceCodes: item.includedServiceCodes || [],
      });
    } else {
      setPackageForm({
        ...EMPTY_PACKAGE_FORM,
        packageCode: makeNextCode(packages.map((p) => p.serviceCode), "PKG"),
      });
    }
    setModalType("package");
  };

  const validateCategory = () => {
    if (!categoryForm.nameEn.trim()) return "English category name is required.";
    if (!categoryForm.nameAr.trim()) return "Arabic category name is required.";
    return "";
  };

  const validateService = () => {
    if (!serviceForm.categoryId.trim()) return "Please select a category.";
    if (!serviceForm.serviceCode.trim()) return "Service ID is required.";
    if (!serviceForm.nameEn.trim()) return "English service name is required.";
    if (!serviceForm.nameAr.trim()) return "Arabic service name is required.";
    if (!serviceForm.suvPrice.trim() || Number(serviceForm.suvPrice) < 0) return "SUV price is required and must be valid.";
    if (!serviceForm.sedanPrice.trim() || Number(serviceForm.sedanPrice) < 0) return "Sedan price is required and must be valid.";
    return "";
  };

  const validatePackage = () => {
    if (!packageForm.packageCode.trim()) return "Package ID is required.";
    if (!packageForm.nameEn.trim()) return "English package name is required.";
    if (!packageForm.nameAr.trim()) return "Arabic package name is required.";
    if (!packageForm.suvPrice.trim() || Number(packageForm.suvPrice) < 0) return "SUV price is required and must be valid.";
    if (!packageForm.sedanPrice.trim() || Number(packageForm.sedanPrice) < 0) return "Sedan price is required and must be valid.";
    if (packageForm.includedServiceCodes.length < 1) return "Please include at least one service in the package.";
    return "";
  };

  const saveCategory = async () => {
    const v = validateCategory();
    if (v) {
      setError(v);
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = {
        categoryCode: categoryForm.categoryCode.trim() || makeNextCode(categories.map((c) => c.categoryCode), "CAT"),
        nameEn: categoryForm.nameEn.trim(),
        nameAr: categoryForm.nameAr.trim(),
        descriptionEn: categoryForm.descriptionEn.trim() || undefined,
        descriptionAr: categoryForm.descriptionAr.trim() || undefined,
      };

      if (categoryForm.id) {
        await updateServiceCategoryItem({ id: categoryForm.id, ...payload });
        setBanner({ message: "Category updated successfully." });
      } else {
        await createServiceCategoryItem(payload);
        setBanner({ message: "Category created successfully." });
      }

      closeModal();
      await loadData();
    } catch (e: any) {
      setError(String(e?.message || "Failed to save category"));
    } finally {
      setSaving(false);
    }
  };

  const saveService = async () => {
    const v = validateService();
    if (v) {
      setError(v);
      return;
    }

    const selectedCategory = categories.find((c) => c.id === serviceForm.categoryId);
    if (!selectedCategory) {
      setError("Selected category does not exist.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = {
        serviceCode: serviceForm.serviceCode.trim().toUpperCase(),
        name: serviceForm.nameEn.trim(),
        nameAr: serviceForm.nameAr.trim(),
        descriptionEn: serviceForm.descriptionEn.trim() || undefined,
        descriptionAr: serviceForm.descriptionAr.trim() || undefined,
        categoryId: selectedCategory.id,
        categoryCode: selectedCategory.categoryCode,
        categoryNameEn: selectedCategory.nameEn,
        categoryNameAr: selectedCategory.nameAr,
        type: "service" as const,
        suvPrice: toNum(serviceForm.suvPrice),
        sedanPrice: toNum(serviceForm.sedanPrice),
        hatchbackPrice: toOptionalNum(serviceForm.hatchbackPrice),
        truckPrice: toOptionalNum(serviceForm.truckPrice),
        coupePrice: toOptionalNum(serviceForm.coupePrice),
        otherPrice: toOptionalNum(serviceForm.otherPrice),
        includedServiceCodes: [],
      };

      if (serviceForm.id) {
        await updateServiceCatalogItem({ id: serviceForm.id, ...payload });
        setBanner({ message: "Service updated successfully." });
      } else {
        await createServiceCatalogItem(payload);
        setBanner({ message: "Service created successfully." });
      }

      closeModal();
      await loadData();
    } catch (e: any) {
      setError(String(e?.message || "Failed to save service"));
    } finally {
      setSaving(false);
    }
  };

  const savePackage = async () => {
    const v = validatePackage();
    if (v) {
      setError(v);
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = {
        serviceCode: packageForm.packageCode.trim().toUpperCase(),
        name: packageForm.nameEn.trim(),
        nameAr: packageForm.nameAr.trim(),
        descriptionEn: packageForm.descriptionEn.trim() || undefined,
        descriptionAr: packageForm.descriptionAr.trim() || undefined,
        type: "package" as const,
        suvPrice: toNum(packageForm.suvPrice),
        sedanPrice: toNum(packageForm.sedanPrice),
        hatchbackPrice: toOptionalNum(packageForm.hatchbackPrice),
        truckPrice: toOptionalNum(packageForm.truckPrice),
        coupePrice: toOptionalNum(packageForm.coupePrice),
        otherPrice: toOptionalNum(packageForm.otherPrice),
        includedServiceCodes: packageForm.includedServiceCodes,
        categoryId: undefined,
        categoryCode: undefined,
        categoryNameEn: undefined,
        categoryNameAr: undefined,
      };

      if (packageForm.id) {
        await updateServiceCatalogItem({ id: packageForm.id, ...payload });
        setBanner({ message: "Package updated successfully." });
      } else {
        await createServiceCatalogItem(payload);
        setBanner({ message: "Package created successfully." });
      }

      closeModal();
      await loadData();
    } catch (e: any) {
      setError(String(e?.message || "Failed to save package"));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;

    setSaving(true);
    try {
      if (pendingDelete.type === "category") {
        const hasServices = services.some((s) => s.categoryId === pendingDelete.item.id);
        if (hasServices) {
          setBanner({
            message: "Cannot delete category that still has services. Move or delete services first.",
            isError: true,
          });
          setPendingDelete(null);
          return;
        }

        await deleteServiceCategoryItem(pendingDelete.item.id);
        setBanner({ message: "Category deleted successfully." });
      } else {
        await deleteServiceCatalogItem(pendingDelete.item.id);
        setBanner({ message: `${pendingDelete.item.type === "package" ? "Package" : "Service"} deleted successfully.` });
      }

      setPendingDelete(null);
      await loadData();
    } catch (e: any) {
      setBanner({ message: String(e?.message || "Delete failed"), isError: true });
    } finally {
      setSaving(false);
    }
  };

  const renderPriceChips = (item: ServiceCatalogItem) => (
    <div className="sc-price-chips">
      <span><strong>SUV:</strong> {formatQar(item.suvPrice)}</span>
      <span><strong>Sedan:</strong> {formatQar(item.sedanPrice)}</span>
      <span><strong>Hatchback:</strong> {formatQar(item.hatchbackPrice ?? item.sedanPrice)}</span>
      <span><strong>Truck:</strong> {formatQar(item.truckPrice ?? item.suvPrice)}</span>
      <span><strong>Coupe:</strong> {formatQar(item.coupePrice ?? item.sedanPrice)}</span>
      <span><strong>Other:</strong> {formatQar(item.otherPrice ?? item.sedanPrice)}</span>
    </div>
  );

  return (
    <div className="sc2-page">
      <div className="sc2-tabs">
        <button className={activeTab === "services" ? "active" : ""} onClick={() => setActiveTab("services")}>
          <i className="fas fa-cog"></i> Services
        </button>
        <button className={activeTab === "packages" ? "active" : ""} onClick={() => setActiveTab("packages")}>
          <i className="fas fa-suitcase"></i> Packages
        </button>
      </div>

      {banner && (
        <div className={`sc2-banner ${banner.isError ? "error" : "ok"}`}>{banner.message}</div>
      )}

      {activeTab === "services" && (
        <section className="sc2-section">
          <div className="sc2-section-header">
            <h2><i className="fas fa-cog"></i> Services by Category</h2>
            <div className="sc2-actions-row">
              <PermissionGate moduleId="joborder" optionId="joborder_create">
                <button className="sc2-btn green" onClick={() => openCategoryModal()}>
                  <i className="fas fa-folder-plus"></i> Add Category
                </button>
              </PermissionGate>
              <PermissionGate moduleId="joborder" optionId="joborder_create">
                <button className="sc2-btn blue" onClick={() => openServiceModal()}>
                  <i className="fas fa-plus-circle"></i> Add Service
                </button>
              </PermissionGate>
            </div>
          </div>

          <div className="sc2-stats-grid">
            <div className="sc2-stat-card"><strong>{categories.length}</strong><span>Categories</span></div>
            <div className="sc2-stat-card"><strong>{services.length}</strong><span>Total Services</span></div>
            <div className="sc2-stat-card"><strong>{avgServicesPerCategory}</strong><span>Avg Services/Cat</span></div>
          </div>

          {loading && <div className="sc2-empty">Loading services...</div>}
          {!loading && categoryRows.length === 0 && <div className="sc2-empty">No service categories found.</div>}

          {!loading && categoryRows.map((row) => (
            <article className="sc2-category-card" key={row.category.id}>
              <header className="sc2-category-header" data-no-translate="true">
                <div className="sc2-category-title">
                  <i className="fas fa-folder"></i>
                  <span>{displayBilingual(row.category.nameEn, row.category.nameAr)}</span>
                  <small>{row.services.length} services</small>
                </div>
                {row.category.id !== "uncategorized" && (
                  <div className="sc2-inline-actions">
                    <PermissionGate moduleId="joborder" optionId="joborder_create">
                      <button className="sc2-mini-btn warn" onClick={() => openCategoryModal(row.category)}>Edit</button>
                    </PermissionGate>
                    <PermissionGate moduleId="joborder" optionId="joborder_create">
                      <button className="sc2-mini-btn danger" onClick={() => setPendingDelete({ type: "category", item: row.category })}>Delete</button>
                    </PermissionGate>
                  </div>
                )}
              </header>

              {(row.category.descriptionEn || row.category.descriptionAr) && (
                <div className="sc2-category-desc" data-no-translate="true">
                  <div><strong>EN:</strong> {row.category.descriptionEn || "-"}</div>
                  <div><strong>AR:</strong> {row.category.descriptionAr || "-"}</div>
                </div>
              )}

              <div className="sc2-services-wrap">
                {row.services.map((service, idx) => (
                  <div className="sc2-service-item" key={service.id}>
                    <div className="sc2-item-top" data-no-translate="true">
                      <div className="sc2-name-line">
                        <span className="sc2-index-pill">{idx + 1}</span>
                        <span className="sc2-name">{displayBilingual(service.name, service.nameAr)}</span>
                      </div>
                      <div className="sc2-inline-actions">
                        <PermissionGate moduleId="joborder" optionId="joborder_create">
                          <button className="sc2-mini-btn" onClick={() => openServiceModal(service)}>Edit</button>
                        </PermissionGate>
                        <PermissionGate moduleId="joborder" optionId="joborder_create">
                          <button className="sc2-mini-btn danger" onClick={() => setPendingDelete({ type: "catalog", item: service })}>Delete</button>
                        </PermissionGate>
                      </div>
                    </div>

                    <div className="sc2-dual-desc" data-no-translate="true">
                      <div><strong>EN:</strong> {service.descriptionEn || "-"}</div>
                      <div><strong>AR:</strong> {service.descriptionAr || "-"}</div>
                    </div>

                    <div data-no-translate="true">{renderPriceChips(service)}</div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}

      {activeTab === "packages" && (
        <section className="sc2-section">
          <div className="sc2-section-header">
            <h2><i className="fas fa-suitcase"></i> Service Packages</h2>
            <PermissionGate moduleId="joborder" optionId="joborder_create">
              <button className="sc2-btn blue" onClick={() => openPackageModal()}>
                <i className="fas fa-plus-circle"></i> Add Package
              </button>
            </PermissionGate>
          </div>

          <div className="sc2-stats-grid">
            <div className="sc2-stat-card"><strong>{packages.length}</strong><span>Total Packages</span></div>
            <div className="sc2-stat-card"><strong>{formatQar(avgPackagePrice)}</strong><span>Avg SUV Price</span></div>
            <div className="sc2-stat-card"><strong>{formatQar(packages.reduce((s, p) => s + Number(p.sedanPrice || 0), 0) / Math.max(packages.length, 1))}</strong><span>Avg Sedan Price</span></div>
          </div>

          {loading && <div className="sc2-empty">Loading packages...</div>}
          {!loading && packages.length === 0 && <div className="sc2-empty">No packages found.</div>}

          {!loading && packages.map((pkg) => (
            <article className="sc2-package-card" key={pkg.id}>
              <header className="sc2-item-top" data-no-translate="true">
                <div className="sc2-name-line">
                  <i className="fas fa-box-open"></i>
                  <span className="sc2-name">{displayBilingual(pkg.name, pkg.nameAr)}</span>
                </div>
                <div className="sc2-inline-actions">
                  <PermissionGate moduleId="joborder" optionId="joborder_create">
                    <button className="sc2-mini-btn" onClick={() => openPackageModal(pkg)}>Edit</button>
                  </PermissionGate>
                  <PermissionGate moduleId="joborder" optionId="joborder_create">
                    <button className="sc2-mini-btn danger" onClick={() => setPendingDelete({ type: "catalog", item: pkg })}>Delete</button>
                  </PermissionGate>
                </div>
              </header>

              <div className="sc2-dual-desc" data-no-translate="true">
                <div><strong>EN:</strong> {pkg.descriptionEn || "-"}</div>
                <div><strong>AR:</strong> {pkg.descriptionAr || "-"}</div>
              </div>

              <div data-no-translate="true">{renderPriceChips(pkg)}</div>

              <div className="sc2-included" data-no-translate="true">
                {(pkg.includedServiceCodes || []).map((code) => {
                  const service = serviceByCode.get(code);
                  return (
                    <span key={`${pkg.id}-${code}`} className="sc2-chip">
                      {service ? displayBilingual(service.name, service.nameAr) : code}
                    </span>
                  );
                })}
              </div>
            </article>
          ))}
        </section>
      )}

      {modalType !== "none" && (
        <div className="sc2-overlay" onClick={closeModal}>
          <div className="sc2-modal" onClick={(e) => e.stopPropagation()}>
            {modalType === "category" && (
              <>
                <div className="sc2-modal-header">
                  <h3><i className="fas fa-folder-plus"></i> {editingCategory ? "Edit Category" : "Add New Category"}</h3>
                  <button onClick={closeModal}>✕</button>
                </div>
                <div className="sc2-modal-body">
                  <div className="sc2-grid-2">
                    <label>
                      <span>English Name *</span>
                      <input value={categoryForm.nameEn} onChange={(e) => setCategoryForm((p) => ({ ...p, nameEn: e.target.value }))} placeholder="Category name in English" />
                    </label>
                    <label>
                      <span>الاسم بالعربية *</span>
                      <input value={categoryForm.nameAr} onChange={(e) => setCategoryForm((p) => ({ ...p, nameAr: e.target.value }))} placeholder="اسم الفئة بالعربية" />
                    </label>
                    <label>
                      <span>English Description</span>
                      <textarea value={categoryForm.descriptionEn} onChange={(e) => setCategoryForm((p) => ({ ...p, descriptionEn: e.target.value }))} placeholder="Category description in English" />
                    </label>
                    <label>
                      <span>الوصف بالعربية</span>
                      <textarea value={categoryForm.descriptionAr} onChange={(e) => setCategoryForm((p) => ({ ...p, descriptionAr: e.target.value }))} placeholder="وصف الفئة بالعربية" />
                    </label>
                  </div>
                </div>
              </>
            )}

            {modalType === "service" && (
              <>
                <div className="sc2-modal-header">
                  <h3><i className="fas fa-plus-circle"></i> {editingService ? "Edit Service" : "Add New Service"}</h3>
                  <button onClick={closeModal}>✕</button>
                </div>
                <div className="sc2-modal-body">
                  <div className="sc2-grid-1">
                    <label>
                      <span>Service Category *</span>
                      <select
                        value={serviceForm.categoryId}
                        onChange={(e) => setServiceForm((p) => ({ ...p, categoryId: e.target.value }))}
                      >
                        <option value="">-- Select a category --</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>{cat.nameEn} / {cat.nameAr}</option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span>Service ID *</span>
                      <input value={serviceForm.serviceCode} onChange={(e) => setServiceForm((p) => ({ ...p, serviceCode: e.target.value.toUpperCase() }))} placeholder="e.g. SVC001" />
                      <small>Auto-generated if left empty</small>
                    </label>
                  </div>

                  <div className="sc2-grid-2">
                    <label>
                      <span>English Name *</span>
                      <input value={serviceForm.nameEn} onChange={(e) => setServiceForm((p) => ({ ...p, nameEn: e.target.value }))} placeholder="Service name in English" />
                    </label>
                    <label>
                      <span>الاسم بالعربية *</span>
                      <input value={serviceForm.nameAr} onChange={(e) => setServiceForm((p) => ({ ...p, nameAr: e.target.value }))} placeholder="اسم الخدمة بالعربية" />
                    </label>
                    <label>
                      <span>English Description</span>
                      <textarea value={serviceForm.descriptionEn} onChange={(e) => setServiceForm((p) => ({ ...p, descriptionEn: e.target.value }))} placeholder="Service description in English" />
                    </label>
                    <label>
                      <span>الوصف بالعربية</span>
                      <textarea value={serviceForm.descriptionAr} onChange={(e) => setServiceForm((p) => ({ ...p, descriptionAr: e.target.value }))} placeholder="وصف الخدمة بالعربية" />
                    </label>
                  </div>

                  <h4>Pricing by Vehicle Type</h4>
                  <div className="sc2-grid-3">
                    <label><span>SUV Price (QAR) *</span><input type="number" min={0} step="0.01" value={serviceForm.suvPrice} onChange={(e) => setServiceForm((p) => ({ ...p, suvPrice: e.target.value }))} /></label>
                    <label><span>Sedan Price (QAR) *</span><input type="number" min={0} step="0.01" value={serviceForm.sedanPrice} onChange={(e) => setServiceForm((p) => ({ ...p, sedanPrice: e.target.value }))} /></label>
                    <label><span>Hatchback Price (QAR)</span><input type="number" min={0} step="0.01" value={serviceForm.hatchbackPrice} onChange={(e) => setServiceForm((p) => ({ ...p, hatchbackPrice: e.target.value }))} /></label>
                    <label><span>Truck Price (QAR)</span><input type="number" min={0} step="0.01" value={serviceForm.truckPrice} onChange={(e) => setServiceForm((p) => ({ ...p, truckPrice: e.target.value }))} /></label>
                    <label><span>Coupe Price (QAR)</span><input type="number" min={0} step="0.01" value={serviceForm.coupePrice} onChange={(e) => setServiceForm((p) => ({ ...p, coupePrice: e.target.value }))} /></label>
                    <label><span>Other Price (QAR)</span><input type="number" min={0} step="0.01" value={serviceForm.otherPrice} onChange={(e) => setServiceForm((p) => ({ ...p, otherPrice: e.target.value }))} /></label>
                  </div>
                </div>
              </>
            )}

            {modalType === "package" && (
              <>
                <div className="sc2-modal-header">
                  <h3><i className="fas fa-suitcase"></i> {editingPackage ? "Edit Package" : "Add New Package"}</h3>
                  <button onClick={closeModal}>✕</button>
                </div>
                <div className="sc2-modal-body">
                  <div className="sc2-grid-2">
                    <label>
                      <span>English Name *</span>
                      <input value={packageForm.nameEn} onChange={(e) => setPackageForm((p) => ({ ...p, nameEn: e.target.value }))} placeholder="Package name in English" />
                    </label>
                    <label>
                      <span>الاسم بالعربية *</span>
                      <input value={packageForm.nameAr} onChange={(e) => setPackageForm((p) => ({ ...p, nameAr: e.target.value }))} placeholder="اسم الباقة بالعربية" />
                    </label>
                    <label>
                      <span>English Description</span>
                      <textarea value={packageForm.descriptionEn} onChange={(e) => setPackageForm((p) => ({ ...p, descriptionEn: e.target.value }))} placeholder="Package description in English" />
                    </label>
                    <label>
                      <span>الوصف بالعربية</span>
                      <textarea value={packageForm.descriptionAr} onChange={(e) => setPackageForm((p) => ({ ...p, descriptionAr: e.target.value }))} placeholder="وصف الباقة بالعربية" />
                    </label>
                  </div>

                  <div className="sc2-grid-1">
                    <label>
                      <span>Package ID *</span>
                      <input value={packageForm.packageCode} onChange={(e) => setPackageForm((p) => ({ ...p, packageCode: e.target.value.toUpperCase() }))} placeholder="e.g. PKG001" />
                    </label>
                  </div>

                  <h4>Package Pricing</h4>
                  <div className="sc2-grid-3">
                    <label><span>SUV Price (QAR) *</span><input type="number" min={0} step="0.01" value={packageForm.suvPrice} onChange={(e) => setPackageForm((p) => ({ ...p, suvPrice: e.target.value }))} /></label>
                    <label><span>Sedan Price (QAR) *</span><input type="number" min={0} step="0.01" value={packageForm.sedanPrice} onChange={(e) => setPackageForm((p) => ({ ...p, sedanPrice: e.target.value }))} /></label>
                    <label><span>Hatchback Price (QAR)</span><input type="number" min={0} step="0.01" value={packageForm.hatchbackPrice} onChange={(e) => setPackageForm((p) => ({ ...p, hatchbackPrice: e.target.value }))} /></label>
                    <label><span>Truck Price (QAR)</span><input type="number" min={0} step="0.01" value={packageForm.truckPrice} onChange={(e) => setPackageForm((p) => ({ ...p, truckPrice: e.target.value }))} /></label>
                    <label><span>Coupe Price (QAR)</span><input type="number" min={0} step="0.01" value={packageForm.coupePrice} onChange={(e) => setPackageForm((p) => ({ ...p, coupePrice: e.target.value }))} /></label>
                    <label><span>Other Price (QAR)</span><input type="number" min={0} step="0.01" value={packageForm.otherPrice} onChange={(e) => setPackageForm((p) => ({ ...p, otherPrice: e.target.value }))} /></label>
                  </div>

                  <h4>Select Services to Include *</h4>
                  <div className="sc2-checklist" data-no-translate="true">
                    {categoryRows.map((row) => (
                      <div key={`pkg-${row.category.id}`} className="sc2-checklist-group">
                        <div className="sc2-group-title">{displayBilingual(row.category.nameEn, row.category.nameAr)}</div>
                        {row.services.map((service) => {
                          const checked = packageForm.includedServiceCodes.includes(service.serviceCode);
                          return (
                            <label key={service.id} className="sc2-check-item">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...packageForm.includedServiceCodes, service.serviceCode]
                                    : packageForm.includedServiceCodes.filter((x) => x !== service.serviceCode);
                                  setPackageForm((p) => ({ ...p, includedServiceCodes: next }));
                                }}
                              />
                              <span>{displayBilingual(service.name, service.nameAr)}</span>
                              <small>(SUV: {formatQar(service.suvPrice)} | Sedan: {formatQar(service.sedanPrice)})</small>
                            </label>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {error && <div className="sc2-form-error">{error}</div>}

            <div className="sc2-modal-actions">
              <button className="sc2-btn ghost" onClick={closeModal}>Cancel</button>
              {modalType === "category" && <button className="sc2-btn green" disabled={saving} onClick={() => void saveCategory()}>{saving ? "Saving..." : editingCategory ? "Update Category" : "Add Category"}</button>}
              {modalType === "service" && <button className="sc2-btn blue" disabled={saving} onClick={() => void saveService()}>{saving ? "Saving..." : editingService ? "Update Service" : "Add Service"}</button>}
              {modalType === "package" && <button className="sc2-btn blue" disabled={saving} onClick={() => void savePackage()}>{saving ? "Saving..." : editingPackage ? "Update Package" : "Add Package"}</button>}
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="sc2-overlay" onClick={() => setPendingDelete(null)}>
          <div className="sc2-modal sc2-delete" onClick={(e) => e.stopPropagation()}>
            <div className="sc2-modal-header">
              <h3>Confirm Deletion</h3>
              <button onClick={() => setPendingDelete(null)}>✕</button>
            </div>
            <div className="sc2-modal-body">
              <p>
                You are about to delete <strong data-no-translate="true">{pendingDelete.type === "category" ? displayBilingual(pendingDelete.item.nameEn, pendingDelete.item.nameAr) : displayBilingual(pendingDelete.item.name, pendingDelete.item.nameAr)}</strong>.
                This action cannot be undone.
              </p>
            </div>
            <div className="sc2-modal-actions">
              <button className="sc2-btn ghost" onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="sc2-btn danger" disabled={saving} onClick={() => void confirmDelete()}>
                {saving ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
