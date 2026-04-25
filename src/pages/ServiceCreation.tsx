import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import PermissionGate from "./PermissionGate";
import "./ServiceCreation.css";
import {
  createServiceBrandSpecificationItem,
  createServiceCatalogItem,
  createServiceCategoryItem,
  deleteServiceBrandSpecificationItem,
  deleteServiceCatalogItem,
  deleteServiceCategoryItem,
  listServiceBrandSpecifications,
  listServiceCatalog,
  listServiceCategories,
  updateServiceCatalogItem,
  updateServiceCategoryItem,
  updateServiceBrandSpecificationItem,
  type ServiceCatalogItem,
  type ServiceBrandSpecificationItem,
  type ServiceCategoryItem,
  type ServiceSpecificationBrand,
} from "./serviceCatalogRepo";
import { useLanguage } from "../i18n/LanguageContext";

type Tab = "services" | "packages" | "specifications";
type ModalType = "none" | "category" | "service" | "package" | "specification";

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
  specificationId: string;
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

type SpecificationProductFormState = {
  id: string;
  name: string;
  measurements: string[];
};

type SpecificationBrandFormState = {
  id: string;
  name: string;
  colorHex: string;
  products: SpecificationProductFormState[];
};

type BrandSpecificationFormState = {
  id?: string;
  specificationCode: string;
  brandName: string;
  colorHex: string;
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
  specificationId: "",
};

function uniq(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

const EMPTY_BRAND_SPECIFICATION_FORM: BrandSpecificationFormState = {
  specificationCode: "",
  brandName: "",
  colorHex: "#1F2937",
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

function makeClientId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptySpecificationProduct(): SpecificationProductFormState {
  return {
    id: makeClientId("product"),
    name: "",
    measurements: [""],
  };
}

function createEmptySpecificationBrand(): SpecificationBrandFormState {
  return {
    id: makeClientId("brand"),
    name: "",
    colorHex: "#1F2937",
    products: [createEmptySpecificationProduct()],
  };
}

function mapSpecificationBrands(brands: ServiceSpecificationBrand[] | undefined): SpecificationBrandFormState[] {
  if (!Array.isArray(brands) || brands.length === 0) return [createEmptySpecificationBrand()];

  return brands.map((brand) => ({
    id: brand.id || makeClientId("brand"),
    name: brand.name || "",
    colorHex: brand.colorHex || "#1F2937",
    products:
      Array.isArray(brand.products) && brand.products.length > 0
        ? brand.products.map((product) => ({
            id: product.id || makeClientId("product"),
            name: product.name || "",
            measurements: Array.isArray(product.measurements) && product.measurements.length > 0 ? product.measurements : [""],
          }))
        : [createEmptySpecificationProduct()],
  }));
}

function sanitizeSpecificationBrands(brands: SpecificationBrandFormState[]): ServiceSpecificationBrand[] {
  return brands
    .map((brand, brandIndex) => ({
      id: String(brand.id || `brand-${brandIndex + 1}`).trim(),
      name: String(brand.name || "").trim(),
      colorHex: String(brand.colorHex || "").trim() || "#1F2937",
      products: (brand.products || [])
        .map((product, productIndex) => ({
          id: String(product.id || `product-${brandIndex + 1}-${productIndex + 1}`).trim(),
          name: String(product.name || "").trim(),
          measurements: (product.measurements || []).map((measurement) => String(measurement || "").trim()).filter(Boolean),
        }))
        .filter((product) => !!product.name),
    }))
    .filter((brand) => !!brand.name && brand.products.length > 0);
}

function resolveServiceSpecificationIds(
  item: ServiceCatalogItem,
  brandSpecifications: ServiceBrandSpecificationItem[]
) {
  const byId = new Map<string, ServiceBrandSpecificationItem>();
  const byBrandName = new Map<string, ServiceBrandSpecificationItem>();

  for (const spec of brandSpecifications) {
    byId.set(String(spec.id || "").trim(), spec);
    byBrandName.set(String(spec.brandName || "").trim().toLowerCase(), spec);
  }

  const collected: string[] = [];

  if (item.specificationId && byId.has(String(item.specificationId).trim())) {
    collected.push(String(item.specificationId).trim());
  }

  for (const brand of item.specifications || []) {
    const idCandidate = String(brand?.id || "").trim();
    if (idCandidate && byId.has(idCandidate)) {
      collected.push(idCandidate);
      continue;
    }

    const byName = byBrandName.get(String(brand?.name || "").trim().toLowerCase());
    if (byName?.id) collected.push(String(byName.id));
  }

  return uniq(collected);
}

export default function ServiceCreation() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<Tab>("services");
  const [modalType, setModalType] = useState<ModalType>("none");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState<{ message: string; isError?: boolean } | null>(null);

  const [categories, setCategories] = useState<ServiceCategoryItem[]>([]);
  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([]);
  const [brandSpecifications, setBrandSpecifications] = useState<ServiceBrandSpecificationItem[]>([]);

  const [editingCategory, setEditingCategory] = useState<ServiceCategoryItem | null>(null);
  const [editingService, setEditingService] = useState<ServiceCatalogItem | null>(null);
  const [editingPackage, setEditingPackage] = useState<ServiceCatalogItem | null>(null);
  const [editingBrandSpecification, setEditingBrandSpecification] = useState<ServiceBrandSpecificationItem | null>(null);

  const [pendingDelete, setPendingDelete] = useState<
    | { type: "category"; item: ServiceCategoryItem }
    | { type: "catalog"; item: ServiceCatalogItem }
    | { type: "specification"; item: ServiceBrandSpecificationItem }
    | null
  >(null);

  const [categoryForm, setCategoryForm] = useState<CategoryFormState>(EMPTY_CATEGORY_FORM);
  const [serviceForm, setServiceForm] = useState<ServiceFormState>(EMPTY_SERVICE_FORM);
  const [selectedServiceSpecificationIds, setSelectedServiceSpecificationIds] = useState<string[]>([]);
  const [packageForm, setPackageForm] = useState<PackageFormState>(EMPTY_PACKAGE_FORM);
  const [brandSpecificationForm, setBrandSpecificationForm] = useState<BrandSpecificationFormState>(EMPTY_BRAND_SPECIFICATION_FORM);
  const [specificationBrands, setSpecificationBrands] = useState<SpecificationBrandFormState[]>([createEmptySpecificationBrand()]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [cats, items, specifications] = await Promise.all([
        listServiceCategories(),
        listServiceCatalog(),
        listServiceBrandSpecifications(),
      ]);
      setCategories(cats);
      setCatalog(items);
      setBrandSpecifications(specifications);
    } catch (e: any) {
      setBanner({ message: String(e?.message || t("Failed to load service data")), isError: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const services = useMemo(() => catalog.filter((x) => x.type === "service"), [catalog]);
  const packages = useMemo(() => catalog.filter((x) => x.type === "package"), [catalog]);
  const servicesWithSpecifications = useMemo(
    () => services.filter((service) => service.hasSpecifications && service.specifications.length > 0),
    [services]
  );
  const specificationBrandsCount = brandSpecifications.length;
  const brandSpecificationById = useMemo(() => {
    const map = new Map<string, ServiceBrandSpecificationItem>();
    brandSpecifications.forEach((specification) => map.set(specification.id, specification));
    return map;
  }, [brandSpecifications]);
  useEffect(() => {
    setSelectedServiceSpecificationIds((current) =>
      current.filter((id) => brandSpecificationById.has(String(id || "").trim()))
    );
  }, [brandSpecificationById]);

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
          nameEn: t("Uncategorized"),
          nameAr: t("Uncategorized"),
          descriptionEn: "",
          descriptionAr: "",
          isActive: true,
        },
        services: uncategorized,
      });
    }

    return out;
  }, [categories, services, t]);

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
    flushSync(() => {
      setModalType("none");
      setError("");
      setEditingBrandSpecification(null);
      setSelectedServiceSpecificationIds([]);
    });
  };

  const openCategoryModal = (item?: ServiceCategoryItem) => {
    const nextForm: CategoryFormState = item
      ? {
          id: item.id,
          categoryCode: item.categoryCode,
          nameEn: item.nameEn,
          nameAr: item.nameAr,
          descriptionEn: item.descriptionEn || "",
          descriptionAr: item.descriptionAr || "",
        }
      : {
          ...EMPTY_CATEGORY_FORM,
          categoryCode: makeNextCode(categories.map((c) => c.categoryCode), "CAT"),
        };

    flushSync(() => {
      setError("");
      setEditingCategory(item || null);
      setCategoryForm(nextForm);
      setModalType("category");
    });
  };

  const openServiceModal = (item?: ServiceCatalogItem) => {
    const nextForm: ServiceFormState = item
      ? {
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
        specificationId: item.specificationId || "",
      }
      : {
        ...EMPTY_SERVICE_FORM,
        serviceCode: makeNextCode(services.map((s) => s.serviceCode), "SVC"),
      };
    const nextSpecifications = item ? resolveServiceSpecificationIds(item, brandSpecifications) : [];

    flushSync(() => {
      setError("");
      setEditingService(item || null);
      setServiceForm(nextForm);
      setSelectedServiceSpecificationIds(nextSpecifications);
      setModalType("service");
    });
  };

  const openPackageModal = (item?: ServiceCatalogItem) => {
    const nextForm: PackageFormState = item
      ? {
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
      }
      : {
        ...EMPTY_PACKAGE_FORM,
        packageCode: makeNextCode(packages.map((p) => p.serviceCode), "PKG"),
      };

    flushSync(() => {
      setError("");
      setEditingPackage(item || null);
      setPackageForm(nextForm);
      setModalType("package");
    });
  };

  const openSpecificationModal = (item?: ServiceBrandSpecificationItem) => {
    const nextForm: BrandSpecificationFormState = item
      ? {
        id: item.id,
        specificationCode: item.specificationCode,
        brandName: item.brandName,
        colorHex: item.colorHex || "#1F2937",
      }
      : {
        ...EMPTY_BRAND_SPECIFICATION_FORM,
        specificationCode: makeNextCode(brandSpecifications.map((specification) => specification.specificationCode), "SPC"),
      };
    const nextBrands = item ? mapSpecificationBrands(item.specifications) : [createEmptySpecificationBrand()];

    flushSync(() => {
      setError("");
      setEditingBrandSpecification(item || null);
      setBrandSpecificationForm(nextForm);
      setSpecificationBrands(nextBrands);
      setModalType("specification");
    });
  };

  const validateCategory = () => {
    if (!categoryForm.nameEn.trim()) return t("English category name is required.");
    if (!categoryForm.nameAr.trim()) return t("Arabic category name is required.");
    return "";
  };

  const validateService = () => {
    if (!serviceForm.categoryId.trim()) return t("Please select a category.");
    if (!serviceForm.serviceCode.trim()) return t("Service ID is required.");
    if (!serviceForm.nameEn.trim()) return t("English service name is required.");
    if (!serviceForm.nameAr.trim()) return t("Arabic service name is required.");
    if (!serviceForm.suvPrice.trim() || Number(serviceForm.suvPrice) < 0) return t("SUV price is required and must be valid.");
    if (!serviceForm.sedanPrice.trim() || Number(serviceForm.sedanPrice) < 0) return t("Sedan price is required and must be valid.");
    return "";
  };

  const validatePackage = () => {
    if (!packageForm.packageCode.trim()) return t("Package ID is required.");
    if (!packageForm.nameEn.trim()) return t("English package name is required.");
    if (!packageForm.nameAr.trim()) return t("Arabic package name is required.");
    if (!packageForm.suvPrice.trim() || Number(packageForm.suvPrice) < 0) return t("SUV price is required and must be valid.");
    if (!packageForm.sedanPrice.trim() || Number(packageForm.sedanPrice) < 0) return t("Sedan price is required and must be valid.");
    if (packageForm.includedServiceCodes.length < 1) return t("Please include at least one service in the package.");
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
        setBanner({ message: t("Category updated successfully.") });
      } else {
        await createServiceCategoryItem(payload);
        setBanner({ message: t("Category created successfully.") });
      }

      closeModal();
      await loadData();
    } catch (e: any) {
      setError(String(e?.message || t("Failed to save category")));
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
      setError(t("Selected category does not exist."));
      return;
    }

    setSaving(true);
    setError("");

    try {
      const selectedSpecifications = selectedServiceSpecificationIds
        .map((id) => brandSpecificationById.get(String(id || "").trim()))
        .filter(Boolean) as ServiceBrandSpecificationItem[];

      const mergedSpecifications = selectedSpecifications.flatMap((specification) => {
        if (Array.isArray(specification.specifications) && specification.specifications.length > 0) {
          return specification.specifications;
        }
        return [
          {
            id: specification.id,
            name: specification.brandName,
            colorHex: specification.colorHex,
            products: [],
          },
        ];
      });

      const primarySpecification = selectedSpecifications[0];
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
        specificationId: primarySpecification?.id,
        specificationName: primarySpecification?.brandName,
        specificationColorHex: primarySpecification?.colorHex,
        specificationProductId: undefined,
        specificationProductName: undefined,
        specificationMeasurement: undefined,
        hasSpecifications: mergedSpecifications.length > 0,
        specifications: mergedSpecifications,
      };

      if (serviceForm.id) {
        await updateServiceCatalogItem({ id: serviceForm.id, ...payload });
        setBanner({ message: t("Service updated successfully.") });
      } else {
        await createServiceCatalogItem(payload);
        setBanner({ message: t("Service created successfully.") });
      }

      closeModal();
      await loadData();
    } catch (e: any) {
      setError(String(e?.message || t("Failed to save service")));
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
        hasSpecifications: false,
        specifications: [],
        categoryId: undefined,
        categoryCode: undefined,
        categoryNameEn: undefined,
        categoryNameAr: undefined,
      };

      if (packageForm.id) {
        await updateServiceCatalogItem({ id: packageForm.id, ...payload });
        setBanner({ message: t("Package updated successfully.") });
      } else {
        await createServiceCatalogItem(payload);
        setBanner({ message: t("Package created successfully.") });
      }

      closeModal();
      await loadData();
    } catch (e: any) {
      setError(String(e?.message || t("Failed to save package")));
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
            message: t("Cannot delete category that still has services. Move or delete services first."),
            isError: true,
          });
          setPendingDelete(null);
          return;
        }

        await deleteServiceCategoryItem(pendingDelete.item.id);
        setBanner({ message: t("Category deleted successfully.") });
      } else if (pendingDelete.type === "specification") {
        const isAssigned = services.some((service) => service.specificationId === pendingDelete.item.id);
        if (isAssigned) {
          setBanner({
            message: t("Cannot delete a brand specification that is still assigned to services."),
            isError: true,
          });
          setPendingDelete(null);
          return;
        }

        await deleteServiceBrandSpecificationItem(pendingDelete.item.id);
        setBanner({ message: t("Brand specification deleted successfully.") });
      } else {
        await deleteServiceCatalogItem(pendingDelete.item.id);
        setBanner({ message: `${pendingDelete.item.type === "package" ? t("Package") : t("Service")} ${t("deleted successfully.")}` });
      }

      setPendingDelete(null);
      await loadData();
    } catch (e: any) {
      setBanner({ message: String(e?.message || t("Delete failed")), isError: true });
    } finally {
      setSaving(false);
    }
  };

  const saveSpecifications = async () => {
    const primaryBrand = specificationBrands[0] || createEmptySpecificationBrand();
    const sanitized = sanitizeSpecificationBrands([
      {
        ...primaryBrand,
        name: brandSpecificationForm.brandName.trim() || primaryBrand.name,
        colorHex: brandSpecificationForm.colorHex || primaryBrand.colorHex || "#1F2937",
      },
    ]);

    if (!brandSpecificationForm.brandName.trim()) {
      setError(t("Brand name is required."));
      return;
    }
    if ((primaryBrand.products || []).every((product) => !product.name.trim())) {
      setError(t("Brand must include at least one product."));
      return;
    }
    if (
      (primaryBrand.products || []).some(
        (product) => product.name.trim() && (product.measurements || []).every((measurement) => !String(measurement || "").trim())
      )
    ) {
      setError(t("Each product must include at least one measurement."));
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = {
        specificationCode: brandSpecificationForm.specificationCode.trim().toUpperCase(),
        brandName: brandSpecificationForm.brandName.trim(),
        colorHex: brandSpecificationForm.colorHex || "#1F2937",
        specifications: sanitized,
      };

      if (brandSpecificationForm.id) {
        await updateServiceBrandSpecificationItem({ id: brandSpecificationForm.id, ...payload });
      } else {
        await createServiceBrandSpecificationItem(payload);
      }

      setBanner({
        message:
          sanitized.length > 0
            ? t("Brand specification saved successfully.")
            : t("Brand specification cleared successfully."),
      });
      closeModal();
      await loadData();
    } catch (e: any) {
      setError(String(e?.message || t("Failed to save brand specification")));
    } finally {
      setSaving(false);
    }
  };

  const renderPriceChips = (item: ServiceCatalogItem) => (
    <div className="sc-price-chips">
      <span><strong>{t("SUV:")}</strong> {formatQar(item.suvPrice)}</span>
      <span><strong>{t("Sedan:")}</strong> {formatQar(item.sedanPrice)}</span>
      <span><strong>{t("Hatchback:")}</strong> {formatQar(item.hatchbackPrice ?? item.sedanPrice)}</span>
      <span><strong>{t("Truck:")}</strong> {formatQar(item.truckPrice ?? item.suvPrice)}</span>
      <span><strong>{t("Coupe:")}</strong> {formatQar(item.coupePrice ?? item.sedanPrice)}</span>
      <span><strong>{t("Other:")}</strong> {formatQar(item.otherPrice ?? item.sedanPrice)}</span>
    </div>
  );

  const switchTab = (tab: Tab) => {
    flushSync(() => {
      setActiveTab(tab);
    });
  };

  return (
    <div className="sc2-page">
      <header className="sc2-page-header">
        <div className="sc2-page-header-left">
          <p className="sc2-kicker">{t("Service Intelligence")}</p>
          <h1>
            <i className="fas fa-tools"></i> {t("Service Creation")}
          </h1>
          <p className="sc2-sub">{t("Configure services, packages, and brand specifications with bilingual visibility.")}</p>
        </div>
        <div className="sc2-page-header-right">
          <button className="sc2-btn blue sc2-refresh" onClick={() => void loadData()} disabled={loading || saving}>
            <i className="fas fa-sync"></i> {loading ? t("Loading...") : t("Refresh")}
          </button>
        </div>
      </header>

      <div className="sc2-tabs">
        <button className={activeTab === "services" ? "active" : ""} onClick={() => switchTab("services")}>
          <i className="fas fa-cog"></i> {t("Services")}
        </button>
        <button className={activeTab === "packages" ? "active" : ""} onClick={() => switchTab("packages")}>
          <i className="fas fa-suitcase"></i> {t("Packages")}
        </button>
        <button className={activeTab === "specifications" ? "active" : ""} onClick={() => switchTab("specifications")}>
          <i className="fas fa-palette"></i> {t("Service Specification")}
        </button>
      </div>

      {banner && (
        <div className={`sc2-banner ${banner.isError ? "error" : "ok"}`}>{banner.message}</div>
      )}

      {activeTab === "services" && (
        <section className="sc2-section">
          <div className="sc2-section-header">
            <h2><i className="fas fa-cog"></i> {t("Services by Category")}</h2>
            <div className="sc2-actions-row">
              <PermissionGate moduleId="joborder" optionId="joborder_create">
                <button className="sc2-btn green" onClick={() => openCategoryModal()}>
                  <i className="fas fa-folder-plus"></i> {t("Add Category")}
                </button>
              </PermissionGate>
              <PermissionGate moduleId="joborder" optionId="joborder_create">
                <button className="sc2-btn blue" onClick={() => openServiceModal()}>
                  <i className="fas fa-plus-circle"></i> {t("Add Service")}
                </button>
              </PermissionGate>
            </div>
          </div>

          <div className="sc2-stats-grid">
            <div className="sc2-stat-card"><strong>{categories.length}</strong><span>{t("Categories")}</span></div>
            <div className="sc2-stat-card"><strong>{services.length}</strong><span>{t("Total Services")}</span></div>
            <div className="sc2-stat-card"><strong>{avgServicesPerCategory}</strong><span>{t("Avg Services/Cat")}</span></div>
          </div>

          {loading && <div className="sc2-empty">{t("Loading services...")}</div>}
          {!loading && categoryRows.length === 0 && <div className="sc2-empty">{t("No service categories found.")}</div>}

          {!loading && categoryRows.map((row) => (
            <article className="sc2-category-card" key={row.category.id}>
              <header className="sc2-category-header" data-no-translate="true">
                <div className="sc2-category-title">
                  <i className="fas fa-folder"></i>
                  <span>{displayBilingual(row.category.nameEn, row.category.nameAr)}</span>
                  <small>{row.services.length} {t("services")}</small>
                </div>
                {row.category.id !== "uncategorized" && (
                  <div className="sc2-inline-actions">
                    <PermissionGate moduleId="joborder" optionId="joborder_create">
                      <button className="sc2-mini-btn warn" onClick={() => openCategoryModal(row.category)}>{t("Edit")}</button>
                    </PermissionGate>
                    <PermissionGate moduleId="joborder" optionId="joborder_create">
                      <button className="sc2-mini-btn danger" onClick={() => setPendingDelete({ type: "category", item: row.category })}>{t("Delete")}</button>
                    </PermissionGate>
                  </div>
                )}
              </header>

              {(row.category.descriptionEn || row.category.descriptionAr) && (
                <div className="sc2-category-desc" data-no-translate="true">
                  <div><strong>{t("EN:")}</strong> {row.category.descriptionEn || "-"}</div>
                  <div><strong>{t("AR:")}</strong> {row.category.descriptionAr || "-"}</div>
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
                          <button className="sc2-mini-btn" onClick={() => openServiceModal(service)}>{t("Edit")}</button>
                        </PermissionGate>
                        <PermissionGate moduleId="joborder" optionId="joborder_create">
                          <button className="sc2-mini-btn warn" onClick={() => openServiceModal(service)}>
                            {service.specificationId ? t("Change Brand Spec") : t("Set Brand Spec")}
                          </button>
                        </PermissionGate>
                        <PermissionGate moduleId="joborder" optionId="joborder_create">
                          <button className="sc2-mini-btn danger" onClick={() => setPendingDelete({ type: "catalog", item: service })}>{t("Delete")}</button>
                        </PermissionGate>
                      </div>
                    </div>

                    <div className="sc2-dual-desc" data-no-translate="true">
                      <div><strong>{t("EN:")}</strong> {service.descriptionEn || "-"}</div>
                      <div><strong>{t("AR:")}</strong> {service.descriptionAr || "-"}</div>
                    </div>

                    <div data-no-translate="true">{renderPriceChips(service)}</div>

                    {service.hasSpecifications && service.specifications.length > 0 && (
                      <div className="sc2-included" data-no-translate="true">
                        {service.specifications.map((brand) => (
                          <span
                            key={`${service.id}-${brand.id}`}
                            className="sc2-chip"
                            style={brand.colorHex ? { borderColor: brand.colorHex, color: brand.colorHex } : undefined}
                          >
                            {t("Brand")}: {brand.name}
                          </span>
                        ))}
                        <span className="sc2-chip">{service.specifications.length} {t("brands")}</span>
                      </div>
                    )}
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
            <h2><i className="fas fa-suitcase"></i> {t("Service Packages")}</h2>
            <PermissionGate moduleId="joborder" optionId="joborder_create">
              <button className="sc2-btn blue" onClick={() => openPackageModal()}>
                <i className="fas fa-plus-circle"></i> {t("Add Package")}
              </button>
            </PermissionGate>
          </div>

          <div className="sc2-stats-grid">
            <div className="sc2-stat-card"><strong>{packages.length}</strong><span>{t("Total Packages")}</span></div>
            <div className="sc2-stat-card"><strong>{formatQar(avgPackagePrice)}</strong><span>{t("Avg SUV Price")}</span></div>
            <div className="sc2-stat-card"><strong>{formatQar(packages.reduce((s, p) => s + Number(p.sedanPrice || 0), 0) / Math.max(packages.length, 1))}</strong><span>{t("Avg Sedan Price")}</span></div>
          </div>

          {loading && <div className="sc2-empty">{t("Loading packages...")}</div>}
          {!loading && packages.length === 0 && <div className="sc2-empty">{t("No packages found.")}</div>}

          {!loading && packages.map((pkg) => (
            <article className="sc2-package-card" key={pkg.id}>
              <header className="sc2-item-top" data-no-translate="true">
                <div className="sc2-name-line">
                  <i className="fas fa-box-open"></i>
                  <span className="sc2-name">{displayBilingual(pkg.name, pkg.nameAr)}</span>
                </div>
                <div className="sc2-inline-actions">
                  <PermissionGate moduleId="joborder" optionId="joborder_create">
                    <button className="sc2-mini-btn" onClick={() => openPackageModal(pkg)}>{t("Edit")}</button>
                  </PermissionGate>
                  <PermissionGate moduleId="joborder" optionId="joborder_create">
                    <button className="sc2-mini-btn danger" onClick={() => setPendingDelete({ type: "catalog", item: pkg })}>{t("Delete")}</button>
                  </PermissionGate>
                </div>
              </header>

              <div className="sc2-dual-desc" data-no-translate="true">
                <div><strong>{t("EN:")}</strong> {pkg.descriptionEn || "-"}</div>
                <div><strong>{t("AR:")}</strong> {pkg.descriptionAr || "-"}</div>
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

      {activeTab === "specifications" && (
        <section className="sc2-section">
          <div className="sc2-section-header">
            <h2><i className="fas fa-clipboard-list"></i> {t("Brand & Product Specifications")}</h2>
            <PermissionGate moduleId="joborder" optionId="joborder_create">
              <button className="sc2-btn green" onClick={() => openSpecificationModal()}>
                <i className="fas fa-plus-circle"></i> {t("Add New Brand")}
              </button>
            </PermissionGate>
          </div>

          <div className="sc2-stats-grid">
            <div className="sc2-stat-card"><strong>{specificationBrandsCount}</strong><span>{t("Brands")}</span></div>
            <div className="sc2-stat-card"><strong>{servicesWithSpecifications.length}</strong><span>{t("Services with Specs")}</span></div>
          </div>

          {loading && <div className="sc2-empty">{t("Loading specifications...")}</div>}
          {!loading && brandSpecifications.length === 0 && <div className="sc2-empty">{t("No brand specifications available yet.")}</div>}

          {!loading && brandSpecifications.map((specification) => (
            <article className="sc2-spec-card" key={`spec-${specification.id}`}>
              <header className="sc2-spec-card-header" data-no-translate="true">
                <div className="sc2-name-line">
                  <span className="sc2-color-dot" style={{ backgroundColor: specification.colorHex }}></span>
                  <span className="sc2-name">{specification.brandName}</span>
                </div>
                <div className="sc2-inline-actions">
                  <PermissionGate moduleId="joborder" optionId="joborder_create">
                    <button className="sc2-mini-btn warn" onClick={() => openSpecificationModal(specification)}>
                      {t("Edit")}
                    </button>
                  </PermissionGate>
                  <PermissionGate moduleId="joborder" optionId="joborder_create">
                    <button className="sc2-mini-btn danger" onClick={() => setPendingDelete({ type: "specification", item: specification })}>
                      {t("Delete")}
                    </button>
                  </PermissionGate>
                </div>
              </header>

              <div className="sc2-spec-card-body" data-no-translate="true">
                <div className="sc2-spec-section-title">{t("Products & Sizes")}</div>
              {specification.specifications.length > 0 ? (
                <div className="sc2-spec-products" data-no-translate="true">
                  {specification.specifications.map((brand) => (
                    <div key={`${specification.id}-${brand.id}`}>
                      {brand.products.map((product) => (
                        <div key={`${brand.id}-${product.id}`} className="sc2-product-block">
                          <div className="sc2-product-title"><i className="fas fa-box"></i> {product.name}</div>
                          <ul className="sc2-measurement-list">
                            {product.measurements.map((measurement, index) => (
                              <li key={`${product.id}-${index}`}><i className="fas fa-ruler"></i> {measurement}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sc2-empty">{t("No products configured for this brand yet.")}</div>
              )}
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
                  <h3><i className="fas fa-folder-plus"></i> {editingCategory ? t("Edit Category") : t("Add New Category")}</h3>
                  <button onClick={closeModal}>✕</button>
                </div>
                <div className="sc2-modal-body">
                  <div className="sc2-grid-2">
                    <label>
                      <span>{t("English Name *")}</span>
                      <input value={categoryForm.nameEn} onChange={(e) => setCategoryForm((p) => ({ ...p, nameEn: e.target.value }))} placeholder={t("Category name in English")} />
                    </label>
                    <label>
                      <span>{t("Arabic Name *")}</span>
                      <input value={categoryForm.nameAr} onChange={(e) => setCategoryForm((p) => ({ ...p, nameAr: e.target.value }))} placeholder={t("Category name in Arabic")} />
                    </label>
                    <label>
                      <span>{t("English Description")}</span>
                      <textarea value={categoryForm.descriptionEn} onChange={(e) => setCategoryForm((p) => ({ ...p, descriptionEn: e.target.value }))} placeholder={t("Category description in English")} />
                    </label>
                    <label>
                      <span>{t("Arabic Description")}</span>
                      <textarea value={categoryForm.descriptionAr} onChange={(e) => setCategoryForm((p) => ({ ...p, descriptionAr: e.target.value }))} placeholder={t("Category description in Arabic")} />
                    </label>
                  </div>
                </div>
              </>
            )}

            {modalType === "service" && (
              <>
                <div className="sc2-modal-header">
                  <h3><i className="fas fa-plus-circle"></i> {editingService ? t("Edit Service") : t("Add New Service")}</h3>
                  <button onClick={closeModal}>✕</button>
                </div>
                <div className="sc2-modal-body">
                  <div className="sc2-grid-1">
                    <label>
                      <span>{t("Service Category *")}</span>
                      <select
                        value={serviceForm.categoryId}
                        onChange={(e) => setServiceForm((p) => ({ ...p, categoryId: e.target.value }))}
                      >
                        <option value="">{t("Select a category")}</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>{cat.nameEn} / {cat.nameAr}</option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span>{t("Service ID *")}</span>
                      <input value={serviceForm.serviceCode} onChange={(e) => setServiceForm((p) => ({ ...p, serviceCode: e.target.value.toUpperCase() }))} placeholder={t("e.g. SVC001")} />
                      <small>{t("Auto-generated if left empty")}</small>
                    </label>

                    <label>
                      <span>{t("Brand Specifications")}</span>
                      <div className="sc2-checklist" data-no-translate="true">
                        {brandSpecifications.length === 0 && <div className="sc2-empty">{t("No brand specifications available.")}</div>}
                        {brandSpecifications.map((specification) => {
                          const checked = selectedServiceSpecificationIds.includes(specification.id);
                          return (
                            <label key={specification.id} className="sc2-check-item" style={{ alignItems: "center" }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? uniq([...selectedServiceSpecificationIds, specification.id])
                                    : selectedServiceSpecificationIds.filter((id) => id !== specification.id);
                                  setSelectedServiceSpecificationIds(next);
                                  setServiceForm((current) => ({
                                    ...current,
                                    specificationId: next[0] || "",
                                  }));
                                }}
                              />
                              <span className="sc2-color-dot" style={{ backgroundColor: specification.colorHex }}></span>
                              <span>{specification.brandName}</span>
                            </label>
                          );
                        })}
                      </div>
                    </label>
                  </div>

                  <div className="sc2-grid-2">
                    <label>
                      <span>{t("English Name *")}</span>
                      <input value={serviceForm.nameEn} onChange={(e) => setServiceForm((p) => ({ ...p, nameEn: e.target.value }))} placeholder={t("Service name in English")} />
                    </label>
                    <label>
                      <span>{t("Arabic Name *")}</span>
                      <input value={serviceForm.nameAr} onChange={(e) => setServiceForm((p) => ({ ...p, nameAr: e.target.value }))} placeholder={t("Service name in Arabic")} />
                    </label>
                    <label>
                      <span>{t("English Description")}</span>
                      <textarea value={serviceForm.descriptionEn} onChange={(e) => setServiceForm((p) => ({ ...p, descriptionEn: e.target.value }))} placeholder={t("Service description in English")} />
                    </label>
                    <label>
                      <span>{t("Arabic Description")}</span>
                      <textarea value={serviceForm.descriptionAr} onChange={(e) => setServiceForm((p) => ({ ...p, descriptionAr: e.target.value }))} placeholder={t("Service description in Arabic")} />
                    </label>
                  </div>

                  <h4>{t("Pricing by Vehicle Type")}</h4>
                  <div className="sc2-grid-3">
                    <label><span>{t("SUV Price (QAR) *")}</span><input type="number" min={0} step="0.01" value={serviceForm.suvPrice} onChange={(e) => setServiceForm((p) => ({ ...p, suvPrice: e.target.value }))} /></label>
                    <label><span>{t("Sedan Price (QAR) *")}</span><input type="number" min={0} step="0.01" value={serviceForm.sedanPrice} onChange={(e) => setServiceForm((p) => ({ ...p, sedanPrice: e.target.value }))} /></label>
                    <label><span>{t("Hatchback Price (QAR)")}</span><input type="number" min={0} step="0.01" value={serviceForm.hatchbackPrice} onChange={(e) => setServiceForm((p) => ({ ...p, hatchbackPrice: e.target.value }))} /></label>
                    <label><span>{t("Truck Price (QAR)")}</span><input type="number" min={0} step="0.01" value={serviceForm.truckPrice} onChange={(e) => setServiceForm((p) => ({ ...p, truckPrice: e.target.value }))} /></label>
                    <label><span>{t("Coupe Price (QAR)")}</span><input type="number" min={0} step="0.01" value={serviceForm.coupePrice} onChange={(e) => setServiceForm((p) => ({ ...p, coupePrice: e.target.value }))} /></label>
                    <label><span>{t("Other Price (QAR)")}</span><input type="number" min={0} step="0.01" value={serviceForm.otherPrice} onChange={(e) => setServiceForm((p) => ({ ...p, otherPrice: e.target.value }))} /></label>
                  </div>
                </div>
              </>
            )}

            {modalType === "package" && (
              <>
                <div className="sc2-modal-header">
                  <h3><i className="fas fa-suitcase"></i> {editingPackage ? t("Edit Package") : t("Add New Package")}</h3>
                  <button onClick={closeModal}>✕</button>
                </div>
                <div className="sc2-modal-body">
                  <div className="sc2-grid-2">
                    <label>
                      <span>{t("English Name *")}</span>
                      <input value={packageForm.nameEn} onChange={(e) => setPackageForm((p) => ({ ...p, nameEn: e.target.value }))} placeholder={t("Package name in English")} />
                    </label>
                    <label>
                      <span>{t("Arabic Name *")}</span>
                      <input value={packageForm.nameAr} onChange={(e) => setPackageForm((p) => ({ ...p, nameAr: e.target.value }))} placeholder={t("Package name in Arabic")} />
                    </label>
                    <label>
                      <span>{t("English Description")}</span>
                      <textarea value={packageForm.descriptionEn} onChange={(e) => setPackageForm((p) => ({ ...p, descriptionEn: e.target.value }))} placeholder={t("Package description in English")} />
                    </label>
                    <label>
                      <span>{t("Arabic Description")}</span>
                      <textarea value={packageForm.descriptionAr} onChange={(e) => setPackageForm((p) => ({ ...p, descriptionAr: e.target.value }))} placeholder={t("Package description in Arabic")} />
                    </label>
                  </div>

                  <div className="sc2-grid-1">
                    <label>
                      <span>{t("Package ID *")}</span>
                      <input value={packageForm.packageCode} onChange={(e) => setPackageForm((p) => ({ ...p, packageCode: e.target.value.toUpperCase() }))} placeholder={t("e.g. PKG001")} />
                    </label>
                  </div>

                  <h4>{t("Package Pricing")}</h4>
                  <div className="sc2-grid-3">
                    <label><span>{t("SUV Price (QAR) *")}</span><input type="number" min={0} step="0.01" value={packageForm.suvPrice} onChange={(e) => setPackageForm((p) => ({ ...p, suvPrice: e.target.value }))} /></label>
                    <label><span>{t("Sedan Price (QAR) *")}</span><input type="number" min={0} step="0.01" value={packageForm.sedanPrice} onChange={(e) => setPackageForm((p) => ({ ...p, sedanPrice: e.target.value }))} /></label>
                    <label><span>{t("Hatchback Price (QAR)")}</span><input type="number" min={0} step="0.01" value={packageForm.hatchbackPrice} onChange={(e) => setPackageForm((p) => ({ ...p, hatchbackPrice: e.target.value }))} /></label>
                    <label><span>{t("Truck Price (QAR)")}</span><input type="number" min={0} step="0.01" value={packageForm.truckPrice} onChange={(e) => setPackageForm((p) => ({ ...p, truckPrice: e.target.value }))} /></label>
                    <label><span>{t("Coupe Price (QAR)")}</span><input type="number" min={0} step="0.01" value={packageForm.coupePrice} onChange={(e) => setPackageForm((p) => ({ ...p, coupePrice: e.target.value }))} /></label>
                    <label><span>{t("Other Price (QAR)")}</span><input type="number" min={0} step="0.01" value={packageForm.otherPrice} onChange={(e) => setPackageForm((p) => ({ ...p, otherPrice: e.target.value }))} /></label>
                  </div>

                  <h4>{t("Select Services to Include *")}</h4>
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

            {modalType === "specification" && (
              <>
                <div className="sc2-modal-header">
                  <h3>{editingBrandSpecification ? t("Edit Brand") : t("Add Brand")}</h3>
                  <button onClick={closeModal}>✕</button>
                </div>
                <div className="sc2-modal-body sc2-brand-modal-body">
                  <div className="sc2-grid-2">
                    <label>
                      <span>{t("Brand Name")}</span>
                      <input value={brandSpecificationForm.brandName} onChange={(e) => setBrandSpecificationForm((p) => ({ ...p, brandName: e.target.value }))} placeholder={t("Brand name")} />
                    </label>
                    <label>
                      <span>{t("Brand Color")}</span>
                      <div className="sc2-color-picker-wrap">
                        <input type="color" value={brandSpecificationForm.colorHex} onChange={(e) => setBrandSpecificationForm((p) => ({ ...p, colorHex: e.target.value }))} />
                        <span className="sc2-color-badge">
                          <span className="sc2-color-dot" style={{ backgroundColor: brandSpecificationForm.colorHex }}></span>
                          {brandSpecificationForm.colorHex}
                        </span>
                      </div>
                    </label>
                  </div>

                  <div className="sc2-brand-products-head">
                    <h4>{t("Products & Measurements")}</h4>
                    <button
                      className="sc2-btn ghost sc2-brand-add-btn"
                      type="button"
                      onClick={() => {
                        setSpecificationBrands((current) => {
                          const brand = current[0] || createEmptySpecificationBrand();
                          return [
                            {
                              ...brand,
                              products: [...brand.products, createEmptySpecificationProduct()],
                            },
                          ];
                        });
                      }}
                    >
                      <i className="fas fa-plus"></i> {t("Add Product")}
                    </button>
                  </div>

                  <div className="sc2-brand-product-list" data-no-translate="true">
                    {(specificationBrands[0]?.products || []).map((product, productIndex) => (
                      <div key={product.id} className="sc2-brand-product-card">
                        <div className="sc2-brand-product-row">
                          <input
                            value={product.name}
                            onChange={(e) => {
                              const value = e.target.value;
                              setSpecificationBrands((current) => {
                                const brand = current[0] || createEmptySpecificationBrand();
                                return [
                                  {
                                    ...brand,
                                    products: brand.products.map((candidate) =>
                                      candidate.id === product.id ? { ...candidate, name: value } : candidate
                                    ),
                                  },
                                ];
                              });
                            }}
                            placeholder={t("Product Name (e.g., Ceramic Coating)")}
                          />
                          <button
                            className="sc2-mini-btn danger"
                            type="button"
                            onClick={() => {
                              setSpecificationBrands((current) => {
                                const brand = current[0] || createEmptySpecificationBrand();
                                return [
                                  {
                                    ...brand,
                                    products:
                                      brand.products.length > 1
                                        ? brand.products.filter((candidate) => candidate.id !== product.id)
                                        : [createEmptySpecificationProduct()],
                                  },
                                ];
                              });
                            }}
                          >
                            <i className="fas fa-trash"></i> {t("Remove")}
                          </button>
                        </div>

                        <div className="sc2-brand-measurements">
                          {(product.measurements || []).map((measurement, measurementIndex) => (
                            <div key={`${product.id}-measurement-${measurementIndex}`} className="sc2-brand-product-row">
                                <input
                                  value={measurement}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setSpecificationBrands((current) => {
                                      const brand = current[0] || createEmptySpecificationBrand();
                                      return [
                                        {
                                          ...brand,
                                          products: brand.products.map((candidate) =>
                                            candidate.id !== product.id
                                              ? candidate
                                              : {
                                                  ...candidate,
                                                  measurements: candidate.measurements.map((currentMeasurement, currentIndex) =>
                                                    currentIndex === measurementIndex ? value : currentMeasurement
                                                  ),
                                                }
                                          ),
                                        },
                                      ];
                                    });
                                  }}
                                  placeholder={productIndex === 0 && measurementIndex === 0 ? t("Standard") : `${t("Size/Measure")} ${measurementIndex + 1}`}
                                />
                                <button
                                  className="sc2-mini-btn danger"
                                  type="button"
                                  onClick={() => {
                                    setSpecificationBrands((current) => {
                                      const brand = current[0] || createEmptySpecificationBrand();
                                      return [
                                        {
                                          ...brand,
                                          products: brand.products.map((candidate) =>
                                            candidate.id !== product.id
                                              ? candidate
                                              : {
                                                  ...candidate,
                                                  measurements:
                                                    candidate.measurements.length > 1
                                                      ? candidate.measurements.filter((_, currentIndex) => currentIndex !== measurementIndex)
                                                      : [""],
                                                }
                                          ),
                                        },
                                      ];
                                    });
                                  }}
                                >
                                  <i className="fas fa-minus-circle"></i> {t("Remove")}
                                </button>
                            </div>
                          ))}
                        </div>

                        <div className="sc2-inline-actions" style={{ marginTop: 12 }}>
                          <button
                            className="sc2-btn ghost sc2-brand-add-btn"
                            type="button"
                            onClick={() => {
                              setSpecificationBrands((current) => {
                                const brand = current[0] || createEmptySpecificationBrand();
                                return [
                                  {
                                    ...brand,
                                    products: brand.products.map((candidate) =>
                                      candidate.id === product.id
                                        ? { ...candidate, measurements: [...candidate.measurements, ""] }
                                        : candidate
                                    ),
                                  },
                                ];
                              });
                            }}
                          >
                            <i className="fas fa-plus"></i> {t("Add Size/Measure")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {error && <div className="sc2-form-error">{error}</div>}

            <div className="sc2-modal-actions">
              {modalType === "category" && <button className="sc2-btn green" disabled={saving} onClick={() => void saveCategory()}>{saving ? t("Saving...") : editingCategory ? t("Update Category") : t("Add Category")}</button>}
              {modalType === "service" && <button className="sc2-btn blue" disabled={saving} onClick={() => void saveService()}>{saving ? t("Saving...") : editingService ? t("Update Service") : t("Add Service")}</button>}
              {modalType === "package" && <button className="sc2-btn blue" disabled={saving} onClick={() => void savePackage()}>{saving ? t("Saving...") : editingPackage ? t("Update Package") : t("Add Package")}</button>}
              {modalType === "specification" ? (
                <>
                  <button className="sc2-btn blue" disabled={saving} onClick={() => void saveSpecifications()}>{saving ? t("Saving...") : t("Save Brand")}</button>
                  <button className="sc2-btn ghost" onClick={closeModal}>{t("Cancel")}</button>
                </>
              ) : (
                <button className="sc2-btn ghost" onClick={closeModal}>{t("Cancel")}</button>
              )}
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="sc2-overlay" onClick={() => setPendingDelete(null)}>
          <div className="sc2-modal sc2-delete" onClick={(e) => e.stopPropagation()}>
            <div className="sc2-modal-header">
              <h3>{t("Confirm Deletion")}</h3>
              <button onClick={() => setPendingDelete(null)}>✕</button>
            </div>
            <div className="sc2-modal-body">
              <p>
                {t("You are about to delete")} <strong data-no-translate="true">{pendingDelete.type === "category" ? displayBilingual(pendingDelete.item.nameEn, pendingDelete.item.nameAr) : pendingDelete.type === "specification" ? pendingDelete.item.brandName : displayBilingual(pendingDelete.item.name, pendingDelete.item.nameAr)}</strong>.
                {" "}{t("This action cannot be undone.")}
              </p>
            </div>
            <div className="sc2-modal-actions">
              <button className="sc2-btn ghost" onClick={() => setPendingDelete(null)}>{t("Cancel")}</button>
              <button className="sc2-btn danger" disabled={saving} onClick={() => void confirmDelete()}>
                {saving ? t("Deleting...") : t("Delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
