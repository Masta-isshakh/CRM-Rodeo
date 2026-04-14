// src/pages/JobOrderManagement.tsx
// ✅ Full updated file - paste as-is

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import "./JobCards.css";
import { getUrl } from "aws-amplify/storage";
import { normalizeActorIdentity, resolveActorDisplay, resolveActorUsername } from "../utils/actorIdentity";
import { getUserDirectory } from "../utils/userDirectoryCache";
import { getDataClient } from "../lib/amplifyClient";
import { QATAR_MANUFACTURERS, getModelsByManufacturer } from "../utils/vehicleCatalog";
import { VEHICLE_COLORS } from "../utils/vehicleColors";

import SuccessPopup from "./SuccessPopup";
import ErrorPopup from "./ErrorPopup";
import PermissionGate from "./PermissionGate";

import {
  listJobOrdersForMain,
  getJobOrderByOrderNumber,
  upsertJobOrder,
  cancelJobOrderByOrderNumber,
  searchCustomers,
  getCustomerWithVehicles,
  createCustomer,
  createVehicleForCustomer,
  listCompletedOrdersByPlateNumber,
} from "./jobOrderRepo";
import {
  listServiceCatalog,
  resolveServicePriceForVehicleType,
  type ServiceCatalogItem,
} from "./serviceCatalogRepo";
import {
  normalizePaymentStatusLabel as normalizePaymentStatusLabelShared,
} from "../utils/paymentStatus";
import { formatCustomerDisplayId } from "../utils/customerId";
import { usePermissions } from "../lib/userPermissions";
import { useLanguage } from "../i18n/LanguageContext";
import {
  clampTotalDiscountAmount,
  computeCumulativeDiscountAllowance,
  resolveCentralDiscountPercent,
  toCurrencyNumber,
} from "../utils/discountPolicy";
import {
  getPackageGroupKey as getSharedPackageGroupKey,
  summarizeServicesSubtotalPackageAware,
} from "../utils/billingFinance";
import { UnifiedCustomerInfoCard, UnifiedVehicleInfoCard } from "../components/UnifiedCustomerVehicleCards";
import { UnifiedJobOrderSummaryCard } from "../components/UnifiedJobOrderSummaryCard";
import UnifiedBillingInvoicesSection from "../components/UnifiedBillingInvoicesSection";

function errMsg(e: unknown) {
  const anyE = e as any;
  return String(anyE?.message ?? anyE?.errors?.[0]?.message ?? anyE ?? "Unknown error");
}

async function resolveMaybeStorageUrl(urlOrPath: string): Promise<string> {
  const v = String(urlOrPath || "").trim();
  if (!v) return "";

  // ✅ Your storage resource uses "job-orders/*"
  if (v.startsWith("job-orders/")) {
    const out = await getUrl({ path: v });
    return out.url.toString();
  }

  // already a full URL (or something else)
  return v;
}


function joStr(v: any) {
  return String(v ?? "").trim();
}

function joFirst(...vals: any[]) {
  for (const v of vals) {
    const s = joStr(v);
    if (s) return s;
  }
  return "";
}

function joFirstPreferredActor(...vals: any[]) {
  for (const v of vals) {
    const s = joStr(v);
    if (!s) continue;
    if (joIsPlaceholderName(s)) continue;
    return s;
  }
  return "";
}

function toUsernameDisplay(v: any, identityMap?: Record<string, string>) {
  return resolveActorDisplay(v, {
    identityToUsernameMap: identityMap,
    fallback: "—",
  });
}

function joIsPlaceholderName(s: string) {
  const t = joStr(s).toLowerCase();
  return (
    !t ||
    t === "-" ||
    t === "--" ||
    t === "—" ||
    t === "null" ||
    t === "undefined" ||
    t === "system user" ||
    t === "system" ||
    t === "n/a" ||
    t === "na" ||
    t === "not assigned" ||
    t === "unknown" ||
    t === "inspector" ||
    t === "qc inspector"
  );
}

function resolveAuthenticatedEmail(user: any) {
  return resolveActorUsername(user, "");
}

function resolveCurrentActorDisplay(currentUser: any, actorIdentity: string, identityMap?: Record<string, string>) {
  const normalizedIdentity = normalizeActorIdentity(actorIdentity);
  const direct = identityMap?.[normalizedIdentity];
  if (direct && !joIsPlaceholderName(String(direct))) return String(direct);

  const fromName = String(currentUser?.name ?? currentUser?.displayName ?? "").trim();
  if (fromName && !joIsPlaceholderName(fromName)) return fromName;

  const loginId = String(currentUser?.signInDetails?.loginId ?? "").trim();
  const loginKey = normalizeActorIdentity(loginId);
  if (loginKey && identityMap?.[loginKey] && !joIsPlaceholderName(String(identityMap[loginKey]))) {
    return String(identityMap[loginKey]);
  }

  return actorIdentity;
}

function normalizeCatalogKey(value: any) {
  return String(value ?? "").trim().toLowerCase();
}

function toBilingualName(nameEn: any, nameAr: any, fallback = "Unnamed service") {
  const en = String(nameEn || "").trim();
  const ar = String(nameAr || "").trim();
  if (en && ar) return `${en} / ${ar}`;
  return en || ar || fallback;
}

function dedupeSelectedServices(items: any[]) {
  const out: any[] = [];
  const seen = new Set<string>();

  for (const item of items || []) {
    const code = normalizeCatalogKey(item?.serviceCode || item?.catalogId || item?.name);
    const packageCode = normalizeCatalogKey(item?.packageCode);
    const key = packageCode ? `${packageCode}::${code}` : code;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function toMoneyNumber(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hasServiceSpecifications(product: any) {
  return (
    String(product?.type ?? "").toLowerCase() === "service" &&
    product?.hasSpecifications === true &&
    Array.isArray(product?.specifications) &&
    product.specifications.length > 0
  );
}

function getServiceSpecificationLabel(service: any) {
  const brand = String(service?.specificationBrandName ?? "").trim();
  const product = String(service?.specificationProductName ?? "").trim();
  const measurement = String(service?.specificationMeasurement ?? "").trim();
  if (brand && product && measurement) return `${brand} / ${product} / ${measurement}`;
  if (brand && product) return `${brand} / ${product}`;
  return brand || product || measurement || "";
}

function getServiceSpecificationParts(service: any) {
  const brand = String(service?.specificationBrandName ?? "").trim();
  const product = String(service?.specificationProductName ?? "").trim();
  const measurement = String(service?.specificationMeasurement ?? "").trim();
  const colorHex = String(service?.specificationColorHex ?? "").trim();

  return [
    brand ? { key: "brand", label: "Brand", value: brand, colorHex } : null,
    product ? { key: "product", label: "Product", value: product } : null,
    measurement ? { key: "measurement", label: "Measurement", value: measurement } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; value: string; colorHex?: string }>;
}

function renderServiceSpecificationBadges(service: any) {
  const parts = getServiceSpecificationParts(service);
  if (!parts.length) return null;

  return (
    <div className="jo-spec-badges" data-no-translate="true">
      {parts.map((part) => (
        <span
          key={`${service?.id || service?.serviceCode || service?.name}-${part.key}`}
          className={`jo-spec-badge jo-spec-badge-${part.key}`}
          style={part.key === "brand" && part.colorHex ? ({
            background: `${part.colorHex}18`,
            borderColor: `${part.colorHex}55`,
          } as React.CSSProperties) : undefined}
        >
          <span className="jo-spec-badge-label">{part.label}</span>
          <span className="jo-spec-badge-value">{part.value}</span>
        </span>
      ))}
    </div>
  );
}

function getSelectedSpecificationForProduct(product: any, selectedServices: any[]) {
  const productCode = normalizeCatalogKey(product?.serviceCode || product?.id || product?.name);
  return selectedServices.find(
    (service: any) => normalizeCatalogKey(service?.serviceCode || service?.catalogId || service?.name) === productCode
  );
}

function buildCatalogServiceSelection(product: any, vehicleType: any, specification?: any) {
  return {
    name: product.name,
    nameAr: product.nameAr,
    price: resolveServicePriceForVehicleType(product, vehicleType),
    serviceCode: product.serviceCode || undefined,
    catalogId: product.id || undefined,
    specificationBrandId: specification?.brandId || undefined,
    specificationBrandName: specification?.brandName || undefined,
    specificationColorHex: specification?.colorHex || undefined,
    specificationProductId: specification?.productId || undefined,
    specificationProductName: specification?.productName || undefined,
    specificationMeasurement: specification?.measurement || undefined,
  };
}

function getConfiguredSpecificationSelection(product: any) {
  const specificationId = String(product?.specificationId || "").trim();
  const brandName = String(product?.specificationName || "").trim();
  const colorHex = String(product?.specificationColorHex || "").trim();
  const productId = String(product?.specificationProductId || "").trim();
  const productName = String(product?.specificationProductName || "").trim();
  const measurement = String(product?.specificationMeasurement || "").trim();

  if (!specificationId || !productId || !measurement) return null;

  return {
    brandId: specificationId,
    brandName,
    colorHex,
    productId,
    productName,
    measurement,
  };
}

function getPackageGroupKey(service: any) {
  return getSharedPackageGroupKey(service);
}

function summarizeServicesPricing(services: any[]) {
  const packageKeys = new Set<string>();
  for (const service of services || []) {
    const key = getPackageGroupKey(service);
    if (key) packageKeys.add(key);
  }

  return {
    subtotal: summarizeServicesSubtotalPackageAware(services),
    packageCount: packageKeys.size,
  };
}

function expandCatalogProductToServices(product: any, products: any[], vehicleType: any, specification?: any) {
  const isPackage = String(product?.type ?? "").toLowerCase() === "package";
  const productCode = String(product?.serviceCode || product?.id || product?.name || "").trim();
  if (!productCode) return [];

  if (!isPackage) {
    return [buildCatalogServiceSelection(product, vehicleType, specification)];
  }

  const byCode = new Map<string, any>();
  for (const candidate of products || []) {
    const code = normalizeCatalogKey(candidate?.serviceCode || candidate?.id || candidate?.name);
    if (!code) continue;
    byCode.set(code, candidate);
  }

  const includedCodes = Array.isArray(product?.includedServiceCodes) ? product.includedServiceCodes : [];
  const resolvedPackagePrice = Math.max(0, toMoneyNumber(resolveServicePriceForVehicleType(product, vehicleType)));
  const expanded = includedCodes
    .map((code: any) => byCode.get(normalizeCatalogKey(code)))
    .filter(Boolean)
    .map((child: any) => ({
      name: child.name,
      nameAr: child.nameAr,
      price: resolveServicePriceForVehicleType(child, vehicleType),
      serviceCode: child.serviceCode || undefined,
      catalogId: child.id || undefined,
      packageCode: product.serviceCode || product.id || productCode,
      packageName: product.name,
      packageNameAr: product.nameAr,
      packagePrice: resolvedPackagePrice,
    }));

  if (expanded.length) return dedupeSelectedServices(expanded);

  return [
    {
      name: product.name,
      nameAr: product.nameAr,
      price: resolveServicePriceForVehicleType(product, vehicleType),
      serviceCode: product.serviceCode || undefined,
      catalogId: product.id || undefined,
      packageCode: product.serviceCode || product.id || productCode,
      packageName: product.name,
      packageNameAr: product.nameAr,
      packagePrice: resolvedPackagePrice,
    },
  ];
}

function isCatalogProductSelected(product: any, selectedServices: any[]) {
  const productCode = normalizeCatalogKey(product?.serviceCode || product?.id || product?.name);
  const isPackage = String(product?.type ?? "").toLowerCase() === "package";

  if (isPackage) {
    return selectedServices.some((service: any) => normalizeCatalogKey(service?.packageCode) === productCode);
  }

  return selectedServices.some((service: any) => normalizeCatalogKey(service?.serviceCode || service?.catalogId || service?.name) === productCode);
}

function groupServicesByPackage(services: any[]) {
  const groups: Array<{ key: string; packageTitle: string | null; items: any[]; packagePrice: number | null }> = [];
  const packageGroupIndex = new Map<string, number>();

  for (const service of services || []) {
    const packageCode = normalizeCatalogKey(service?.packageCode);
    const packageName = String(service?.packageName || "").trim();
    const packageNameAr = String(service?.packageNameAr || "").trim();
    const packageKey = packageCode || (packageName ? `pkg:${normalizeCatalogKey(packageName)}` : "");

    if (!packageKey) {
      groups.push({
        key: `single-${groups.length}-${normalizeCatalogKey(service?.serviceCode || service?.catalogId || service?.name)}`,
        packageTitle: null,
        items: [service],
        packagePrice: null,
      });
      continue;
    }

    const existingIdx = packageGroupIndex.get(packageKey);
    if (typeof existingIdx === "number") {
      groups[existingIdx].items.push(service);
      if (groups[existingIdx].packagePrice == null) {
        const maybePackagePrice = toMoneyNumber(service?.packagePrice);
        if (maybePackagePrice > 0) groups[existingIdx].packagePrice = maybePackagePrice;
      }
      continue;
    }

    const maybePackagePrice = toMoneyNumber(service?.packagePrice);

    packageGroupIndex.set(packageKey, groups.length);
    groups.push({
      key: `package-${packageKey}`,
      packageTitle: `Package: ${toBilingualName(packageName || service?.packageCode, packageNameAr, "Unnamed Package")}`,
      items: [service],
      packagePrice: maybePackagePrice > 0 ? maybePackagePrice : null,
    });
  }

  return groups;
}

function getServiceDisplayName(service: any) {
  return toBilingualName(service?.name, service?.nameAr, "Unnamed service");
}

function ServiceSpecificationModal({ product, onClose, onConfirm }: any) {
  const brands = Array.isArray(product?.specifications) ? product.specifications : [];
  const [brandId, setBrandId] = useState(() => String(brands[0]?.id || ""));
  const selectedBrand = brands.find((brand: any) => String(brand?.id || "") === brandId) || brands[0] || null;
  const selectedBrandProducts = Array.isArray(selectedBrand?.products) ? selectedBrand.products : [];
  const [productId, setProductId] = useState(() => String(selectedBrandProducts[0]?.id || ""));
  const selectedProduct = selectedBrandProducts.find((entry: any) => String(entry?.id || "") === productId) || selectedBrandProducts[0] || null;
  const selectedProductMeasurements = Array.isArray(selectedProduct?.measurements) ? selectedProduct.measurements : [];
  const [measurement, setMeasurement] = useState(() => String(selectedProductMeasurements[0] || ""));

  useEffect(() => {
    const nextBrandId = String(brands[0]?.id || "");
    setBrandId(nextBrandId);
    const nextBrand = brands.find((brand: any) => String(brand?.id || "") === nextBrandId) || brands[0] || null;
    const nextProducts = Array.isArray(nextBrand?.products) ? nextBrand.products : [];
    setProductId(String(nextProducts[0]?.id || ""));
    const nextMeasurements = Array.isArray(nextProducts[0]?.measurements) ? nextProducts[0].measurements : [];
    setMeasurement(String(nextMeasurements[0] || ""));
  }, [product]);

  useEffect(() => {
    const nextProducts = Array.isArray(selectedBrand?.products) ? selectedBrand.products : [];
    if (!nextProducts.some((candidate: any) => String(candidate?.id || "") === productId)) {
      setProductId(String(nextProducts[0]?.id || ""));
    }
  }, [brandId, selectedBrand, productId]);

  useEffect(() => {
    const nextMeasurements = Array.isArray(selectedProduct?.measurements) ? selectedProduct.measurements : [];
    if (!nextMeasurements.some((candidate: any) => String(candidate || "") === measurement)) {
      setMeasurement(String(nextMeasurements[0] || ""));
    }
  }, [selectedProduct, measurement]);

  if (!product) return null;

  const selectedColor = String(selectedBrand?.colorHex || "").trim() || "#1F2937";

  return (
    <div className="sc2-overlay" onClick={onClose}>
      <div className="sc2-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sc2-modal-header">
          <h3><i className="fas fa-palette"></i> Service Specification</h3>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="sc2-modal-body">
          <div className="sc2-grid-1">
            <label>
              <span>Service</span>
              <input value={getServiceDisplayName(product)} readOnly />
            </label>
          </div>

          <div className="sc2-grid-2" style={{ marginTop: 16 }}>
            <label>
              <span>Brand *</span>
              <select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                {brands.map((brand: any) => (
                  <option key={String(brand?.id || brand?.name)} value={String(brand?.id || "")}>
                    {brand?.name}
                  </option>
                ))}
              </select>
              <small style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: 999, background: selectedColor, display: "inline-block", border: "1px solid rgba(15, 23, 42, 0.14)" }}></span>
                {selectedColor}
              </small>
            </label>
            <label>
              <span>Product *</span>
              <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                {selectedBrandProducts.map((entry: any) => (
                  <option key={String(entry?.id || entry?.name)} value={String(entry?.id || "")}>
                    {entry?.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="sc2-grid-1" style={{ marginTop: 16 }}>
            <label>
              <span>Measurement *</span>
              <select value={measurement} onChange={(e) => setMeasurement(e.target.value)}>
                {selectedProductMeasurements.map((entry: any, index: number) => (
                  <option key={`${String(selectedProduct?.id || "product")}-measurement-${index}`} value={String(entry || "")}>
                    {String(entry || "")}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedBrand && (
            <div className="sc2-checklist-group" style={{ marginTop: 16 }}>
              <div className="sc2-group-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    background: selectedColor,
                    border: "1px solid rgba(15, 23, 42, 0.15)",
                    display: "inline-block",
                  }}
                ></span>
                {selectedBrand?.name}
              </div>
              {selectedProduct && <div className="sc2-empty">Selected product: {selectedProduct.name}</div>}
              {measurement && <div className="sc2-empty">Selected measurement: {measurement}</div>}
            </div>
          )}
        </div>
        <div className="sc2-modal-actions">
          <button className="sc2-btn ghost" onClick={onClose}>Cancel</button>
          <button
            className="sc2-btn blue"
            onClick={() =>
              onConfirm({
                brandId: String(selectedBrand?.id || ""),
                brandName: String(selectedBrand?.name || ""),
                colorHex: selectedColor,
                productId: String(selectedProduct?.id || ""),
                productName: String(selectedProduct?.name || ""),
                measurement: String(measurement || ""),
              })
            }
            disabled={!selectedBrand || !selectedProduct || !measurement}
          >
            Apply Specification
          </button>
        </div>
      </div>
    </div>
  );
}

/** ✅ Best creator name for the order (handles different payload shapes) */
function resolveCreatedBy(order: any, identityMap?: Record<string, string>) {
  const summary = order?.jobOrderSummary ?? {};
  const roadmap = Array.isArray(order?.roadmap) ? order.roadmap : [];
  const newRequestStep = roadmap.find((step: any) => {
    const key = String(step?.step ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
    return key === "newrequest";
  });

  // Prefer explicit creator fields
  const primary = joFirstPreferredActor(
    summary.createdByName,
    summary.createdBy,
    summary.createBy,
    summary.createdByUser,
    summary.createdByUserName,
    summary.updatedBy,
    order?.createdByName,
    order?.createdBy,
    order?.createdByUserName,
    order?.updatedBy,
    newRequestStep?.actionBy,
    newRequestStep?.updatedBy,
    newRequestStep?.createdBy
  );

  // If primary is placeholder (e.g., "System User"), try better alternatives
  if (joIsPlaceholderName(primary)) {
    const alt = joFirstPreferredActor(
      order?.createdByDisplay,
      order?.createdByEmail,
      order?.creatorName,
      order?.createdUserName,
      order?.customerDetails?.createdBy,
      order?.vehicleDetails?.createdBy
    );
    return alt && !joIsPlaceholderName(alt) ? toUsernameDisplay(alt, identityMap) : toUsernameDisplay(primary || "—", identityMap);
  }

  return toUsernameDisplay(primary || "—", identityMap);
}

/** ✅ Roadmap actor should represent who performed the step (NOT assignment) */
function resolveRoadmapActor(step: any, order: any, identityMap?: Record<string, string>) {
  const stepName = joStr(step?.step).toLowerCase();
  const isNewRequestStep = stepName === "new request" || stepName === "newrequest";

  const actor = joFirstPreferredActor(
    // ✅ action performer fields first
    step?.actionByName,
    step?.actionBy,
    step?.performedBy,
    step?.doneBy,
    step?.updatedByName,
    step?.updatedBy,
    step?.createdByName,
    step?.createdBy,

    // ✅ only then allow technician fields (some steps may use it as performer)
    step?.technicianName,
    step?.technician,

    // ✅ New Request fallback to createdBy
    isNewRequestStep ? resolveCreatedBy(order, identityMap) : ""
  );

  return joIsPlaceholderName(actor) ? "" : toUsernameDisplay(actor, identityMap);
}

// ============================================
// MAIN COMPONENT
// ============================================
function JobOrderManagement({ currentUser, navigationData, onClearNavigation, onNavigateBack }: any) {
  const client = useMemo(() => getDataClient(), []);
  const { canOption, getOptionNumber } = usePermissions();
  const [screenState, setScreenState] = useState<"main" | "details" | "newJob" | "addService">("main");
  const [currentDetailsOrder, setCurrentDetailsOrder] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [demoOrders, setDemoOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const [currentAddServiceOrder, setCurrentAddServiceOrder] = useState<any>(null);

  const [inspectionModalOpen, setInspectionModalOpen] = useState(false);
  const [currentInspectionItem, setCurrentInspectionItem] = useState<any>(null);

  // ✅ Success popup state
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [submittedOrderId, setSubmittedOrderId] = useState("");
  const [lastAction, setLastAction] = useState<"create" | "cancel" | "addService">("create");
  const [showAddServiceSuccessPopup, setShowAddServiceSuccessPopup] = useState(false);
  const [addServiceSuccessData, setAddServiceSuccessData] = useState({ orderId: "", invoiceId: "" });
  const [serviceCatalog, setServiceCatalog] = useState<ServiceCatalogItem[]>([]);

  // ✅ Error popup state
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorTitle, setErrorTitle] = useState("Operation failed");
  const [errorMessage, setErrorMessage] = useState<React.ReactNode>(null);
  const [errorDetails, setErrorDetails] = useState<string | undefined>(undefined);
  const [errorRetry, setErrorRetry] = useState<(() => void) | undefined>(undefined);
  const [actorIdentityMap, setActorIdentityMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const directory = await getUserDirectory(client);
        if (!cancelled) setActorIdentityMap(directory.identityToUsernameMap ?? {});
      } catch {
        if (!cancelled) setActorIdentityMap({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  const refreshServiceCatalog = useCallback(async () => {
    try {
      const services = await listServiceCatalog();
      setServiceCatalog(services);
    } catch {
      setServiceCatalog([]);
    }
  }, []);

  useEffect(() => {
    void refreshServiceCatalog();
  }, [refreshServiceCatalog]);

  useEffect(() => {
    if (screenState === "newJob" || screenState === "addService") {
      void refreshServiceCatalog();
    }
  }, [screenState, refreshServiceCatalog]);

  const showError = (args: {
    title?: string;
    message: React.ReactNode;
    details?: string;
    onRetry?: () => void;
  }) => {
    setErrorTitle(args.title || "Operation failed");
    setErrorMessage(args.message);
    setErrorDetails(args.details);
    setErrorRetry(args.onRetry);
    setErrorOpen(true);
  };

  const [newJobPrefill, setNewJobPrefill] = useState<any>(null);
  const [navigationSource, setNavigationSource] = useState<any>(null);
  const [returnToVehicleId, setReturnToVehicleId] = useState<any>(null);

  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);

  const centralDiscountPercent = useMemo(
    () => resolveCentralDiscountPercent(canOption, getOptionNumber),
    [canOption, getOptionNumber]
  );

  

  async function refreshMainOrders() {
    setLoadingOrders(true);
    try {
      const orders = await listJobOrdersForMain();
      setDemoOrders(orders);
    } finally {
      setLoadingOrders(false);
    }
  }

  useEffect(() => {
    void refreshMainOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (screenState === "main") void refreshMainOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenState]);

  useEffect(() => setCurrentPage(1), [searchQuery]);
  useEffect(() => setCurrentPage(1), [pageSize]);

  useEffect(() => {
    if (navigationData?.openNewJob) {
      setNewJobPrefill({
        startStep: navigationData.startStep || 1,
        customerData: navigationData.customerData || null,
        vehicleData: navigationData.vehicleData || null,
      });
      if (navigationData.source) setNavigationSource(navigationData.source);
      if (navigationData.returnToVehicle) setReturnToVehicleId(navigationData.returnToVehicle);

      setScreenState("newJob");
      if (onClearNavigation) onClearNavigation();
    }
  }, [navigationData, onClearNavigation]);

  const parseAmount = (value: any) => {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const cleaned = value.replace(/[^0-9.-]/g, "");
      const parsed = parseFloat(cleaned);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  const formatAmount = (value: any) => `QAR ${Number(value || 0).toLocaleString()}`;

  // ✅ Add service submit with ErrorPopup + SuccessPopup
  const handleAddServiceSubmit = async ({ selectedServices, discountPercent }: any) => {
    if (!currentAddServiceOrder || !selectedServices || selectedServices.length === 0) {
      setScreenState("details");
      return;
    }

    const now = new Date();
    const year = now.getFullYear();
    const invoiceNumber = `INV-${year}-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;
    const billId =
      currentAddServiceOrder.billing?.billId ||
      `BILL-${year}-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;

    const { subtotal } = summarizeServicesPricing(selectedServices);
    const existingTotal = parseAmount(currentAddServiceOrder.billing?.totalAmount);
    const existingDiscount = parseAmount(currentAddServiceOrder.billing?.discount);
    const existingNet = parseAmount(currentAddServiceOrder.billing?.netAmount);
    const existingPaid = parseAmount(currentAddServiceOrder.billing?.amountPaid);

    const combinedTotalAmount = Math.max(0, existingTotal + subtotal);
    const discountAllowance = computeCumulativeDiscountAllowance({
      policyMaxPercent: centralDiscountPercent,
      baseAmount: combinedTotalAmount,
      existingDiscountAmount: existingDiscount,
    });

    const requestedAdditionalDiscount = Math.max(0, Math.min(subtotal, (subtotal * Number(discountPercent || 0)) / 100));
    const requestedTotalDiscount = existingDiscount + requestedAdditionalDiscount;
    const safeTotalDiscount = clampTotalDiscountAmount(requestedTotalDiscount, discountAllowance);
    const discount = Math.max(0, Math.min(subtotal, safeTotalDiscount - existingDiscount));
    const netAmount = subtotal - discount;

    const updatedBilling = {
      billId,
      totalAmount: formatAmount(existingTotal + subtotal),
      discount: formatAmount(existingDiscount + discount),
      netAmount: formatAmount(existingNet + netAmount),
      amountPaid: formatAmount(existingPaid),
      balanceDue: formatAmount(existingNet + netAmount - existingPaid),
      paymentMethod: currentAddServiceOrder.billing?.paymentMethod || null,
      invoices: [
        ...(currentAddServiceOrder.billing?.invoices || []),
        {
          number: invoiceNumber,
          amount: formatAmount(netAmount),
          discount: formatAmount(discount),
          status: "Unpaid",
          paymentMethod: null,
          services: selectedServices.map((s: any) => getServiceDisplayName(s)),
        },
      ],
    };

    const newServiceEntries = selectedServices.map((service: any) => ({
      name: service.name,
      price: service.price || 0,
      serviceCode: service.serviceCode || undefined,
      catalogId: service.catalogId || undefined,
      packageCode: service.packageCode || undefined,
      packageName: service.packageName || undefined,
      packagePrice: service.packagePrice || undefined,
      specificationBrandId: service.specificationBrandId || undefined,
      specificationBrandName: service.specificationBrandName || undefined,
      specificationColorHex: service.specificationColorHex || undefined,
      specificationProductId: service.specificationProductId || undefined,
      specificationProductName: service.specificationProductName || undefined,
      specificationMeasurement: service.specificationMeasurement || undefined,
      status: "New",
      started: "Not started",
      ended: "Not completed",
      duration: "Not started",
      technician: "Not assigned",
      notes: "Added from Job Order details",
    }));

    const updatedOrder = {
      ...currentAddServiceOrder,
      services: [...(currentAddServiceOrder.services || []), ...newServiceEntries],
      billing: updatedBilling,
    };

    try {
      setLoadingOrders(true);

      const { backendId } = await upsertJobOrder(updatedOrder);
      updatedOrder._backendId = backendId;

      await refreshMainOrders();

      setCurrentDetailsOrder(updatedOrder);
      setCurrentAddServiceOrder(updatedOrder);

      setAddServiceSuccessData({ orderId: currentAddServiceOrder.id, invoiceId: invoiceNumber });
      setShowAddServiceSuccessPopup(true);
      setLastAction("addService");

      setScreenState("details");
    } catch (e) {
      console.error(e);
      showError({
        title: "Add services failed",
        message: (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Could not add services to this job order.</div>
            <div>{errMsg(e)}</div>
          </div>
        ),
        details: String((e as any)?.stack ?? ""),
        onRetry: () => void handleAddServiceSubmit({ selectedServices, discountPercent }),
      });
      setScreenState("details");
    } finally {
      setLoadingOrders(false);
    }
  };

  // ✅ Cancel: uses ErrorPopup + refresh
  const handleCancelOrder = async () => {
    if (!cancelOrderId) return;

    const orderToCancel = demoOrders.find((o) => o.id === cancelOrderId);
    if (!orderToCancel) {
      showError({
        title: "Cancel failed",
        message: "Order not found in the current list. Please refresh and try again.",
        onRetry: () => void refreshMainOrders(),
      });
      return;
    }

    if (orderToCancel.workStatus === "Cancelled") {
      showError({
        title: "Already cancelled",
        message: `Job Order ${cancelOrderId} is already cancelled.`,
      });
      setShowCancelConfirmation(false);
      setCancelOrderId(null);
      return;
    }

    try {
      setLoadingOrders(true);

      await cancelJobOrderByOrderNumber(cancelOrderId);
      await refreshMainOrders();

      setSubmittedOrderId(cancelOrderId);
      setLastAction("cancel");
      setShowSuccessPopup(true);
    } catch (e) {
      console.error(e);
      showError({
        title: "Cancel failed",
        message: (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Could not cancel this job order.</div>
            <div>{errMsg(e)}</div>
          </div>
        ),
        details: String((e as any)?.stack ?? ""),
        onRetry: () => void handleCancelOrder(),
      });
    } finally {
      setShowCancelConfirmation(false);
      setCancelOrderId(null);
      setLoadingOrders(false);
    }
  };

  const filteredOrders = demoOrders.filter((order) => {
    const allowedStatuses = ["New Request", "Inspection", "Service_Operation", "Inprogress", "Quality Check", "Ready"];
    if (!allowedStatuses.includes(order.workStatus)) return false;

    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      String(order.id || "").toLowerCase().includes(query) ||
      String(order.customerName || "").toLowerCase().includes(query) ||
      String(order.mobile || "").toLowerCase().includes(query) ||
      String(order.vehiclePlate || "").toLowerCase().includes(query) ||
      String(order.workStatus || "").toLowerCase().includes(query)
    );
  });

  const paginatedOrders = filteredOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="job-order-management">
      {screenState === "main" && (
        <MainScreen
          orders={paginatedOrders}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onViewDetails={async (order: any) => {
            try {
              const fresh = await getJobOrderByOrderNumber(order.id);
              setCurrentDetailsOrder(fresh || order);
              setScreenState("details");
            } catch (e) {
              console.error(e);
              showError({
                title: "Load details failed",
                message: errMsg(e),
                details: String((e as any)?.stack ?? ""),
                onRetry: async () => {
                  const fresh = await getJobOrderByOrderNumber(order.id);
                  setCurrentDetailsOrder(fresh || order);
                  setScreenState("details");
                },
              });
            }
          }}
          onNewJob={() => setScreenState("newJob")}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
          totalCount={filteredOrders.length}
          onCancelOrder={(orderId: string) => {
            setCancelOrderId(orderId);
            setShowCancelConfirmation(true);
          }}
          loading={loadingOrders}
        />
      )}

      {screenState === "details" && currentDetailsOrder && (
        <DetailsScreen
          order={currentDetailsOrder}
          currentUser={currentUser}
          actorMap={actorIdentityMap}
          onClose={() => setScreenState("main")}
          onAddService={() => {
            setCurrentAddServiceOrder(currentDetailsOrder);
            setScreenState("addService");
          }}
        />
      )}

      {screenState === "newJob" && (
        <NewJobScreen
          currentUser={currentUser}
          products={serviceCatalog}
          onClose={() => {
            setScreenState("main");
            setNewJobPrefill(null);
            if (navigationSource && onNavigateBack) {
              const vehicleId = returnToVehicleId;
              setNavigationSource(null);
              setReturnToVehicleId(null);
              onNavigateBack(navigationSource, vehicleId);
            }
          }}
          prefill={newJobPrefill}
          onSubmit={async (newOrder: any) => {
            setLoadingOrders(true);

            const doCreate = async () => {
              const out = await upsertJobOrder(newOrder);
              newOrder._backendId = out?.backendId;

              await refreshMainOrders();

              setScreenState("main");
              setSubmittedOrderId(String(newOrder.id || ""));
              setLastAction("create");
              setShowSuccessPopup(true);

              setNewJobPrefill(null);
              setNavigationSource(null);
              setReturnToVehicleId(null);

              window.scrollTo({ top: 0, behavior: "smooth" });
            };

            try {
              await doCreate();
            } catch (e) {
              console.error(e);
              showError({
                title: "Create job order failed",
                message: (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Your job order was not created.</div>
                    <div>{errMsg(e)}</div>
                  </div>
                ),
                details: String((e as any)?.stack ?? ""),
                onRetry: () => void doCreate(),
              });
            } finally {
              setLoadingOrders(false);
            }
          }}
        />
      )}

      {screenState === "addService" && currentAddServiceOrder && (
        <AddServiceScreen
          order={currentAddServiceOrder}
          products={serviceCatalog}
          maxDiscountPercent={centralDiscountPercent}
          onClose={() => setScreenState("details")}
          onSubmit={handleAddServiceSubmit}
        />
      )}

      {inspectionModalOpen && currentInspectionItem && (
        <InspectionModal
          item={currentInspectionItem}
          onClose={() => {
            setInspectionModalOpen(false);
            setCurrentInspectionItem(null);
          }}
        />
      )}

      {/* ✅ Success Popup: Create / Cancel */}
      {showSuccessPopup && (
        <SuccessPopup
          isVisible={true}
          onClose={() => {
            setShowSuccessPopup(false);
            setLastAction("create");
          }}
          title={lastAction === "cancel" ? "Cancelled" : "Created"}
          message={
            lastAction === "cancel" ? (
              <>
                <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#4CAF50", display: "block", marginBottom: "15px" }}>
                  <i className="fas fa-check-circle"></i> Order Cancelled Successfully!
                </span>
                <span style={{ fontSize: "1.1rem", color: "#333", display: "block", marginTop: "10px" }}>
                  <strong>Job Order ID:</strong>{" "}
                  <span style={{ color: "#2196F3", fontWeight: "600" }}>{submittedOrderId}</span>
                </span>
                <span style={{ fontSize: "0.95rem", color: "#666", display: "block", marginTop: "8px" }}>
                  This order is now marked as Cancelled.
                </span>
              </>
            ) : (
              <>
                <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#4CAF50", display: "block", marginBottom: "15px" }}>
                  <i className="fas fa-check-circle"></i> Order Created Successfully!
                </span>
                <span style={{ fontSize: "1.1rem", color: "#333", display: "block", marginTop: "10px" }}>
                  <strong>Job Order ID:</strong>{" "}
                  <span style={{ color: "#2196F3", fontWeight: "600" }}>{submittedOrderId}</span>
                </span>
              </>
            )
          }
          autoCloseMs={2200}
        />
      )}

      {/* ✅ Add Service Success Popup */}
      {showAddServiceSuccessPopup && (
        <SuccessPopup
          isVisible={true}
          onClose={() => setShowAddServiceSuccessPopup(false)}
          title="Services added"
          message={
            <>
              <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#4CAF50", display: "block", marginBottom: "15px" }}>
                <i className="fas fa-check-circle"></i> Services Added Successfully!
              </span>
              <span style={{ fontSize: "1.05rem", color: "#333", display: "block", marginTop: "10px" }}>
                <strong>Job Order ID:</strong>{" "}
                <span style={{ color: "#2196F3", fontWeight: "600" }}>{addServiceSuccessData.orderId}</span>
              </span>
              <span style={{ fontSize: "1.05rem", color: "#333", display: "block", marginTop: "8px" }}>
                <strong>New Invoice ID:</strong>{" "}
                <span style={{ color: "#27ae60", fontWeight: "600" }}>{addServiceSuccessData.invoiceId}</span>
              </span>
            </>
          }
          autoCloseMs={2200}
        />
      )}

      {/* ✅ Error Popup */}
      <ErrorPopup
        isVisible={errorOpen}
        onClose={() => setErrorOpen(false)}
        title={errorTitle}
        message={errorMessage || "Unknown error"}
        details={errorDetails}
        onRetry={errorRetry}
      />

      {/* Cancel Confirmation Modal */}
      <div className={`cancel-modal-overlay ${showCancelConfirmation && cancelOrderId ? "active" : ""}`}>
        <div className="cancel-modal">
          <div className="cancel-modal-header">
            <h3>
              <i className="fas fa-exclamation-triangle"></i> Confirm Cancellation
            </h3>
          </div>
          <div className="cancel-modal-body">
            <div className="cancel-warning">
              <i className="fas fa-exclamation-circle"></i>
              <div className="cancel-warning-text">
                <p>
                  You are about to cancel order <strong>{cancelOrderId}</strong>.
                </p>
                <p>This action cannot be undone.</p>
              </div>
            </div>
            <div className="cancel-modal-actions">
              <button
                className="btn-cancel"
                onClick={() => {
                  setShowCancelConfirmation(false);
                  setCancelOrderId(null);
                }}
              >
                <i className="fas fa-times"></i> Keep Order
              </button>
              <button className="btn-confirm-cancel" onClick={handleCancelOrder} disabled={loadingOrders}>
                <i className="fas fa-ban"></i> {loadingOrders ? "Cancelling..." : "Cancel Order"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// MAIN SCREEN
// ============================================
const JobOrderRecordsTable = memo(function JobOrderRecordsTable({
  orders,
  onToggleActions,
}: any) {
  if (orders.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <i className="fas fa-search"></i>
        </div>
        <div className="empty-text">No matching job orders found</div>
        <div className="empty-subtext">Try adjusting your search terms or click "New Job Order" to create one</div>
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table className="job-order-table">
        <thead>
          <tr>
            <th>Create Date</th>
            <th>Job Card ID</th>
            <th>Order Type</th>
            <th>Customer Name</th>
            <th>Mobile Number</th>
            <th>Vehicle Plate</th>
            <th>Work Status</th>
            <th>Payment Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order: any) => (
            <tr key={order.id}>
              <td className="date-column">{order.createDate}</td>
              <td>{order.id}</td>
              <td>
                <span className={`order-type-badge ${order.orderType === "New Job Order" ? "order-type-new-job" : "order-type-service"}`}>
                  {order.orderType}
                </span>
              </td>
              <td>{order.customerName}</td>
              <td>{order.mobile}</td>
              <td>{order.vehiclePlate}</td>
              <td>
                <span className={`status-badge ${getWorkStatusClass(order.workStatus)}`}>{displayWorkStatusLabel(order.workStatus)}</span>
              </td>
              <td>
                <span className={`status-badge ${getPaymentStatusClass(order.paymentStatus)}`}>{normalizePaymentStatusLabel(order.paymentStatus)}</span>
              </td>
              <td>
                <PermissionGate moduleId="joborder" optionId="joborder_actions">
                  <div className="action-dropdown-container">
                    <button
                      className="btn-action-dropdown"
                      onMouseDown={(e: any) => {
                        e.preventDefault();
                        onToggleActions(order.id, e.currentTarget as HTMLElement);
                      }}
                      onKeyDown={(e: any) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onToggleActions(order.id, e.currentTarget as HTMLElement);
                        }
                      }}
                    >
                      <i className="fas fa-cogs"></i> Actions <i className="fas fa-chevron-down"></i>
                    </button>
                  </div>
                </PermissionGate>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

function MainScreen({
  orders,
  searchQuery,
  onSearchChange,
  onViewDetails,
  onNewJob,
  currentPage,
  onPageChange,
  pageSize,
  onPageSizeChange,
  totalCount,
  onCancelOrder,
  loading,
}: any) {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const activeDropdownRef = useRef<string | null>(null);
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  const ordersById = useMemo(() => {
    const m = new Map<string, any>();
    for (const o of orders) m.set(String(o.id), o);
    return m;
  }, [orders]);

  const toggleActionDropdown = useCallback((orderId: string, anchorEl: HTMLElement) => {
    const isActive = activeDropdownRef.current === orderId;
    if (isActive) {
      activeDropdownRef.current = null;
      setActiveDropdown(null);
      return;
    }

    const rect = anchorEl.getBoundingClientRect();
    const menuHeight = 140;
    const menuWidth = 200;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));

    flushSync(() => {
      activeDropdownRef.current = orderId;
      setDropdownPosition({ top, left });
      setActiveDropdown(orderId);
    });
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: any) => {
      const isDropdownButton = event.target.closest(".btn-action-dropdown");
      const isDropdownMenu = event.target.closest(".action-dropdown-menu");
      if (!isDropdownButton && !isDropdownMenu) {
        activeDropdownRef.current = null;
        setActiveDropdown(null);
      }
    };

    if (activeDropdown) {
      document.addEventListener("pointerdown", handleClickOutside, true);
      return () => document.removeEventListener("pointerdown", handleClickOutside, true);
    }
  }, [activeDropdown]);

  return (
    <div className="app-container">
      <header className="app-header crm-unified-header">
        <div className="header-left">
          <h1>
            <i className="fas fa-tools"></i> Job Order Management
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
              placeholder="Search by any details"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <div className="search-stats">
            {loading ? "Loading..." : totalCount === 0 ? "No job orders found" : `Showing ${orders.length} of ${totalCount} job orders`}
          </div>
        </section>

        <section className="results-section">
          <div className="section-header">
            <h2>
              <i className="fas fa-list"></i> Job Order Records
            </h2>
            <div className="pagination-controls">
              <div className="records-per-page">
                <label htmlFor="pageSizeSelect">Records per page:</label>
                <select id="pageSizeSelect" className="page-size-select" value={pageSize} onChange={(e) => onPageSizeChange(parseInt(e.target.value))}>
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>
              <PermissionGate moduleId="joborder" optionId="joborder_add">
                <button className="btn-new-job" onClick={onNewJob}>
                  <i className="fas fa-plus-circle"></i> New Job Order
                </button>
              </PermissionGate>
            </div>
          </div>

          <JobOrderRecordsTable orders={orders} onToggleActions={toggleActionDropdown} />
        </section>

        {orders.length > 0 && totalPages > 1 && (
          <div className="pagination">
            <button className="pagination-btn" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>
              <i className="fas fa-chevron-left"></i>
            </button>
            <div className="page-numbers">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) pageNum = i + 1;
                else {
                  const start = Math.max(1, currentPage - 2);
                  const end = Math.min(totalPages, start + 4);
                  const adjustedStart = Math.max(1, end - 4);
                  pageNum = adjustedStart + i;
                }
                return (
                  <button key={pageNum} className={`pagination-btn ${pageNum === currentPage ? "active" : ""}`} onClick={() => onPageChange(pageNum)}>
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button className="pagination-btn" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>
              <i className="fas fa-chevron-right"></i>
            </button>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>Service Management System © 2023 | Job Order Management Module</p>
      </footer>

      {typeof document !== "undefined" &&
        createPortal(
          <div
            className={`action-dropdown-menu show action-dropdown-menu-fixed ${activeDropdown ? "open" : "closed"}`}
            style={
              activeDropdown
                ? { top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` }
                : { top: "-9999px", left: "-9999px" }
            }
          >
            <PermissionGate moduleId="joborder" optionId="joborder_viewdetails">
              <button
                className="dropdown-item view"
                onClick={() => {
                  if (!activeDropdown) return;
                  const targetOrder = ordersById.get(String(activeDropdown));
                  if (targetOrder) onViewDetails(targetOrder);
                  activeDropdownRef.current = null;
                  setActiveDropdown(null);
                }}
              >
                <i className="fas fa-eye"></i> View Details
              </button>
            </PermissionGate>

            <PermissionGate moduleId="joborder" optionId="joborder_cancel">
              <>
                <div className="dropdown-divider"></div>
                <button
                  className="dropdown-item delete"
                  onClick={() => {
                    if (!activeDropdown) return;
                    if (activeDropdown) onCancelOrder(activeDropdown);
                    activeDropdownRef.current = null;
                    setActiveDropdown(null);
                  }}
                >
                  <i className="fas fa-times-circle"></i> Cancel Order
                </button>
              </>
            </PermissionGate>
          </div>,
          document.body
        )}
    </div>
  );
}

// ============================================
// DETAILS SCREEN
// ============================================
function DetailsScreen({ order, onClose, onAddService, currentUser, actorMap }: any) {
  return (
<div className="pim-details-screen jo-details-v3">
      <div className="pim-details-header">
        <div className="pim-details-title-container">
          <h2>
            <i className="fas fa-clipboard-list"></i> Job Order Details - {order.id}
          </h2>
        </div>
        <button className="pim-btn-close-details" onClick={onClose}>
          <i className="fas fa-times"></i> Close Details
        </button>
      </div>

      <div className="pim-details-body">
        <div className="pim-details-grid">
          <PermissionGate moduleId="joborder" optionId="joborder_summary">
            <JobOrderSummaryCard order={order} currentUser={currentUser} actorMap={actorMap} />
          </PermissionGate>
          <PermissionGate moduleId="joborder" optionId="joborder_customer">
            <UnifiedCustomerInfoCard order={order} className="cv-unified-card" />
          </PermissionGate>
          <PermissionGate moduleId="joborder" optionId="joborder_vehicle">
            <UnifiedVehicleInfoCard order={order} className="cv-unified-card" />
          </PermissionGate>
          <PermissionGate moduleId="joborder" optionId="joborder_services">
            <ServicesCard order={order} onAddService={onAddService} />
          </PermissionGate>
          <PermissionGate moduleId="joborder" optionId="joborder_billing">
            <BillingCard order={order} />
          </PermissionGate>
          
          {/* ✅ NEW: Quality Check Card */}
          {order.qualityCheck && (
            <PermissionGate moduleId="joborder" optionId="joborder_quality">
              <QualityCheckCard order={order} />
            </PermissionGate>
          )}
          
          {/* ✅ NEW: Delivery Tracking Card */}
          {order.deliveryInfo && (
            <PermissionGate moduleId="joborder" optionId="joborder_delivery">
              <DeliveryTrackingCard order={order} />
            </PermissionGate>
          )}
          
        </div>

        {/* Roadmap Timeline - Full Width */}
        <PermissionGate moduleId="joborder" optionId="joborder_roadmap">
          <RoadmapCard order={order} currentUser={currentUser} actorMap={actorMap} />
        </PermissionGate>

        {/* ✅ Documents (Billing docs if available) - Full Width at bottom */}
<PermissionGate moduleId="joborder" optionId="joborder_documents">
  <JobOrderDocumentsCard order={order} />
</PermissionGate>
      </div>
    </div>
  );
}

// ============================================
// NEW JOB SCREEN (unchanged UI)
// ============================================
function NewJobScreen({ currentUser, products = [], onClose, onSubmit, prefill }: any) {
  const client = useMemo(() => getDataClient(), []);
  const { canOption, getOptionNumber } = usePermissions();
  const [step, setStep] = useState(1);
  const [orderType, setOrderType] = useState<any>(null); // 'new' or 'service'
  const [customerType, setCustomerType] = useState<any>(null);
  const [customerData, setCustomerData] = useState<any>(null);
  const [vehicleData, setVehicleData] = useState<any>(null);

  const [selectedServices, setSelectedServices] = useState<any[]>([]);
  const [additionalServices, setAdditionalServices] = useState<any[]>([]);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [orderNotes, setOrderNotes] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [expectedDeliveryTime, setExpectedDeliveryTime] = useState("");
  const [vehicleCompletedServices, setVehicleCompletedServices] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actorIdentityMap, setActorIdentityMap] = useState<Record<string, string>>({});
  const actorUsername = resolveAuthenticatedEmail(currentUser) || "system";
  const centralDiscountPercent = useMemo(
    () => resolveCentralDiscountPercent(canOption, getOptionNumber),
    [canOption, getOptionNumber]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const directory = await getUserDirectory(client);
        if (!cancelled) setActorIdentityMap(directory.identityToUsernameMap ?? {});
      } catch {
        if (!cancelled) setActorIdentityMap({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  const formatAmount = (value: any) => `QAR ${Number(value || 0).toLocaleString()}`;

  const handleVehicleSelected = async (vehicleInfo: any) => {
    setVehicleData(vehicleInfo);

    const plate = vehicleInfo.plateNumber || vehicleInfo.license || "";
    const completed = plate ? await listCompletedOrdersByPlateNumber(plate) : [];
    setVehicleCompletedServices(completed);

    if (orderType === "service" && completed.length === 0) {
      setOrderType("new");
    }
  };

  useEffect(() => {
    if (!prefill) return;

    if (prefill.customerData) {
      setCustomerType("existing");
      setCustomerData(prefill.customerData);
    }

    if (prefill.vehicleData) {
      void handleVehicleSelected(prefill.vehicleData);
    }

    if (prefill.startStep) setStep(Math.max(1, prefill.startStep));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
    const now = new Date();
    const year = now.getFullYear();
    const authEmail = resolveAuthenticatedEmail(currentUser);
    const jobOrderId = `JO-${year}-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;

    const customerName = String(
      customerData?.name ??
        customerData?.displayName ??
        customerData?.fullName ??
        [customerData?.firstName, customerData?.lastName].filter(Boolean).join(" ")
    ).trim();
    const customerMobile = String(customerData?.mobile ?? customerData?.phone ?? customerData?.phoneNumber ?? "").trim();
    const vehiclePlate = String(
      vehicleData?.plateNumber ??
        vehicleData?.license ??
        vehicleData?.licensePlate ??
        vehicleData?.plate ??
        vehicleData?.registrationNumber ??
        ""
    ).trim();

    const safeCustomerName = customerName || "Walk-in Customer";
    const safeCustomerMobile = customerMobile || "N/A";
    const safeVehiclePlate = vehiclePlate || "N/A";

    const servicesToBill = orderType === "service" ? additionalServices : selectedServices;
    const { subtotal } = summarizeServicesPricing(servicesToBill);
    const maxAllowedDiscountAmount = (Math.max(0, subtotal) * centralDiscountPercent) / 100;
    const discount = Math.min(
      Math.max(0, discountAmount || 0),
      Math.max(0, subtotal),
      Math.max(0, maxAllowedDiscountAmount)
    );
    const discountPercent = subtotal > 0 ? (discount / subtotal) * 100 : 0;
    const netAmount = subtotal - discount;

    const billId = `BILL-${year}-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;
    const invoiceNumber = `INV-${year}-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;
    const actorIdentity = authEmail || resolveActorUsername(currentUser, "—");
    const actorDisplayName = resolveCurrentActorDisplay(currentUser, actorIdentity, actorIdentityMap);

    const newOrder = {
      id: jobOrderId,
      orderType: orderType === "service" ? "Service Order" : "New Job Order",
      customerName: safeCustomerName,
      mobile: safeCustomerMobile,
      vehiclePlate: safeVehiclePlate,
      workStatus: "New Request",
      paymentStatus: "Unpaid",
      createdBy: actorIdentity,
      createdByName: actorDisplayName,
      updatedBy: actorIdentity,
      updatedByName: actorDisplayName,
      createDate: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
      jobOrderSummary: {
        createDate: new Date().toLocaleString(),
        createdBy: actorIdentity,
        createdByName: actorDisplayName,
        expectedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleString(),
      },
      customerDetails: {
        customerId: customerData.id,
        email: customerData.email,
        address: customerData.address || null,
        heardFrom: customerData.heardFrom || null,
        referralPersonName: customerData.referralPersonName || null,
        referralPersonMobile: customerData.referralPersonMobile || null,
        socialPlatform: customerData.socialPlatform || null,
        heardFromOtherNote: customerData.heardFromOtherNote || null,
        registeredVehicles: `${customerData.vehicles?.length ?? customerData.registeredVehiclesCount ?? 1} vehicles`,
        registeredVehiclesCount: customerData.vehicles?.length ?? customerData.registeredVehiclesCount ?? 1,
        completedServicesCount: customerData.completedServicesCount ?? 0,
        customerSince: customerData.customerSince || new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
      },
      vehicleDetails: {
        vehicleId: vehicleData.vehicleId || "VEH-" + Math.floor(Math.random() * 10000),
        ownedBy: safeCustomerName,
        make: vehicleData.make || vehicleData.factory,
        model: vehicleData.model,
        year: vehicleData.year,
        type: vehicleData.vehicleType || vehicleData.carType,
        color: vehicleData.color,
        plateNumber: vehicleData.plateNumber || vehicleData.license,
        vin: vehicleData.vin || "N/A",
        registrationDate: vehicleData.registrationDate || "N/A",
      },
      services:
        orderType === "service"
          ? additionalServices.map((s: any) => ({
              name: s.name,
              price: s.price || 0,
              serviceCode: s.serviceCode || undefined,
              catalogId: s.catalogId || undefined,
              packageCode: s.packageCode || undefined,
              packageName: s.packageName || undefined,
              packagePrice: s.packagePrice || undefined,
              specificationBrandId: s.specificationBrandId || undefined,
              specificationBrandName: s.specificationBrandName || undefined,
              specificationColorHex: s.specificationColorHex || undefined,
              specificationProductId: s.specificationProductId || undefined,
              specificationProductName: s.specificationProductName || undefined,
              specificationMeasurement: s.specificationMeasurement || undefined,
              status: "New",
              started: "Not started",
              ended: "Not completed",
              duration: "Not started",
              technician: "Not assigned",
              notes: "Additional service for completed order",
            }))
          : selectedServices.map((s: any) => ({
              name: s.name,
              price: s.price || 0,
              serviceCode: s.serviceCode || undefined,
              catalogId: s.catalogId || undefined,
              packageCode: s.packageCode || undefined,
              packageName: s.packageName || undefined,
              packagePrice: s.packagePrice || undefined,
              specificationBrandId: s.specificationBrandId || undefined,
              specificationBrandName: s.specificationBrandName || undefined,
              specificationColorHex: s.specificationColorHex || undefined,
              specificationProductId: s.specificationProductId || undefined,
              specificationProductName: s.specificationProductName || undefined,
              specificationMeasurement: s.specificationMeasurement || undefined,
              status: "New",
              started: "Not started",
              ended: "Not completed",
              duration: "Not started",
              technician: "Not assigned",
              notes: "New service request",
            })),
      billing: {
        billId,
        totalAmount: formatAmount(subtotal),
        discount: formatAmount(discount),
        netAmount: formatAmount(netAmount),
        amountPaid: formatAmount(0),
        balanceDue: formatAmount(netAmount),
        paymentMethod: null,
        invoices: [
          {
            number: invoiceNumber,
            amount: formatAmount(netAmount),
            discount: formatAmount(discount),
            status: "Unpaid",
            paymentMethod: null,
            services: servicesToBill.map((s: any) => getServiceDisplayName(s)),
          },
        ],
      },
      roadmap: [
        {
          step: "New Request",
          stepStatus: "Active",
          startTimestamp: new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }),
          endTimestamp: null,
          actionBy: actorIdentity,
          actionByName: actorDisplayName,
          status: "InProgress",
        },
        { step: "Inspection", stepStatus: "Upcoming", startTimestamp: null, endTimestamp: null, actionBy: "Not assigned", status: "Upcoming" },
        { step: "Service_Operation", stepStatus: "Upcoming", startTimestamp: null, endTimestamp: null, actionBy: "Not assigned", status: "Upcoming" },
        { step: "Quality Check", stepStatus: "Upcoming", startTimestamp: null, endTimestamp: null, actionBy: "Not assigned", status: "Upcoming" },
        { step: "Ready", stepStatus: "Upcoming", startTimestamp: null, endTimestamp: null, actionBy: "Not assigned", status: "Upcoming" },
      ],
      inspectionResult: null,
      deliveryQualityCheck: null,
      exitPermit: null,
      additionalServiceRequests: [],
      documents: [],
      customerNotes: orderNotes || null,

      discountPercent,
      expectedDeliveryDate,
      expectedDeliveryTime,
    };

    await onSubmit(newOrder);
    } finally {
      setIsSubmitting(false);
    }
  };

return (
  <div className="pim-details-screen jo-wizard-screen">
    <div className="pim-details-header jo-wizard-header">
      <div className="pim-details-title-container">
        <h2>
          <i className="fas fa-plus-circle"></i> Create New Job Order
        </h2>
      </div>
      <button className="pim-btn-close-details jo-wizard-cancel-btn" onClick={onClose}>
        <i className="fas fa-times"></i> Cancel
      </button>
    </div>

    <div className="pim-details-body jo-wizard-body">
      <div className="progress-bar jo-wizard-stepper">
        {[1, 2, 3, 4, 5].map((s) => (
          <div key={s} className={`progress-step ${s < step ? "completed" : s === step ? "active" : ""}`}>
            <span>{s}</span>
            <div className="step-label">{["Customer", "Vehicle", "Order Type", "Services", "Confirm"][s - 1]}</div>
          </div>
        ))}
      </div>

      {step === 1 && (
        <StepOneCustomer
          customerType={customerType}
          setCustomerType={setCustomerType}
          customerData={customerData}
          setCustomerData={setCustomerData}
          onNext={() => setStep(2)}
          onCancel={onClose}
          actorUsername={actorUsername}
        />
      )}

      {step === 2 && (
        <StepTwoVehicle
          vehicleData={vehicleData}
          setVehicleData={setVehicleData}
          customerData={customerData}
          setCustomerData={setCustomerData}
          onVehicleSelected={handleVehicleSelected}
          onNext={() => setStep(3)}
          onBack={() => setStep(1)}
          actorUsername={actorUsername}
        />
      )}

      {step === 3 && vehicleCompletedServices.length > 0 && (
        <OrderTypeSelection
          vehicleCompletedServices={vehicleCompletedServices}
          orderType={orderType}
          onSelectOrderType={(type: any) => {
            setOrderType(type);
            setStep(4);
          }}
          onBack={() => setStep(2)}
        />
      )}

      {step === 3 && vehicleCompletedServices.length === 0 && (
        <NoCompletedServicesMessage
          onNext={() => {
            setOrderType("new");
            setStep(4);
          }}
          onBack={() => setStep(2)}
        />
      )}

      {step === 4 && (
        <StepThreeServices
          products={products}
          selectedServices={orderType === "service" ? additionalServices : selectedServices}
          setSelectedServices={orderType === "service" ? setAdditionalServices : setSelectedServices}
          vehicleType={vehicleData?.carType || vehicleData?.vehicleType || "SUV"}
          maxDiscountPercent={centralDiscountPercent}
          discountAmount={discountAmount}
          setDiscountAmount={setDiscountAmount}
          orderNotes={orderNotes}
          setOrderNotes={setOrderNotes}
          expectedDeliveryDate={expectedDeliveryDate}
          setExpectedDeliveryDate={setExpectedDeliveryDate}
          expectedDeliveryTime={expectedDeliveryTime}
          setExpectedDeliveryTime={setExpectedDeliveryTime}
          onNext={() => setStep(5)}
          onBack={() => setStep(3)}
          orderType={orderType}
          vehicleCompletedServices={vehicleCompletedServices}
        />
      )}

      {step === 5 && (
        <StepFourConfirm
          orderType={orderType}
          customerData={customerData}
          vehicleData={vehicleData}
          selectedServices={orderType === "service" ? additionalServices : selectedServices}
          maxDiscountPercent={centralDiscountPercent}
          discountAmount={discountAmount}
          orderNotes={orderNotes}
          expectedDeliveryDate={expectedDeliveryDate}
          expectedDeliveryTime={expectedDeliveryTime}
          isSubmitting={isSubmitting}
          onBack={() => setStep(4)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  </div>
);
}

// ======================================================================
// ✅ IMPORTANT
// Keep the rest of your components exactly as in your current file:
// StepOneCustomer, StepTwoVehicle, StepThreeServices, AddServiceScreen,
// InspectionModal, StepFourConfirm, cards, utility functions, export.
// ======================================================================

// ============================================
// CUSTOMER STEP (backend search/create)
// ============================================
function StepOneCustomer({ customerType, setCustomerType, customerData, setCustomerData, onNext, onCancel, actorUsername }: any) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [heardFrom, setHeardFrom] = useState("");
  const [referralPersonName, setReferralPersonName] = useState("");
  const [referralPersonMobile, setReferralPersonMobile] = useState("");
  const [socialPlatform, setSocialPlatform] = useState("");
  const [heardFromOtherNote, setHeardFromOtherNote] = useState("");

  const [smartSearch, setSmartSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState(false);

  const [verifiedCustomer, setVerifiedCustomer] = useState<any>(null);

  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [pendingCustomer, setPendingCustomer] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCustomerData(null);
    setSmartSearch("");
    setSearchResults([]);
    setShowResults(false);
    setVerifiedCustomer(null);
    setHeardFrom("");
    setReferralPersonName("");
    setReferralPersonMobile("");
    setSocialPlatform("");
    setHeardFromOtherNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerType]);

  const sourceLabel = (src: string) => {
    if (src === "walk_in") return "Walk-in";
    if (src === "refer_person") return "Refer by person";
    if (src === "social_media") return "Social media";
    if (src === "other") return "Other";
    return src || "";
  };

  const handleSave = async () => {
    if (saving) return;
    if (!fullName || !phone) return;
    if (!heardFrom) return;
    if (heardFrom === "refer_person" && (!referralPersonName || !referralPersonMobile)) return;
    if (heardFrom === "social_media" && !socialPlatform) return;
    if (heardFrom === "other" && !heardFromOtherNote) return;

    setSaving(true);
    try {
      const existing = await searchCustomers(phone);
      const existingByName = await searchCustomers(fullName);

      const dup = [...existing, ...existingByName].find(
        (c) =>
          String(c.mobile || c.phone || "").toLowerCase() === phone.toLowerCase() ||
          String(c.name || "").toLowerCase() === fullName.toLowerCase()
      );

      if (dup) {
        const newCustomer = {
          id: "TEMP",
          name: fullName,
          email,
          mobile: phone,
          address: address || null,
          heardFrom,
          referralPersonName,
          referralPersonMobile,
          socialPlatform,
          heardFromOtherNote,
          registeredVehiclesCount: 0,
          completedServicesCount: 0,
          customerSince: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
          vehicles: [],
        };
        setPendingCustomer(newCustomer);
        setShowDuplicateWarning(true);
        return;
      }

      const created = await createCustomer({
        fullName,
        phone,
        email,
        address,
        actor: actorUsername,
        heardFrom,
        referralPersonName,
        referralPersonMobile,
        socialPlatform,
        heardFromOtherNote,
      });
      setCustomerData(created);
      setVerifiedCustomer(created);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDuplicate = async () => {
    if (!pendingCustomer || saving) return;
    setSaving(true);
    try {
      const created = await createCustomer({
        fullName: pendingCustomer.name,
        phone: pendingCustomer.mobile,
        email: pendingCustomer.email,
        address: pendingCustomer.address,
        actor: actorUsername,
        heardFrom: pendingCustomer.heardFrom,
        referralPersonName: pendingCustomer.referralPersonName,
        referralPersonMobile: pendingCustomer.referralPersonMobile,
        socialPlatform: pendingCustomer.socialPlatform,
        heardFromOtherNote: pendingCustomer.heardFromOtherNote,
      });
      setCustomerData(created);
      setVerifiedCustomer(created);
      setShowDuplicateWarning(false);
      setPendingCustomer(null);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelDuplicate = () => {
    setShowDuplicateWarning(false);
    setPendingCustomer(null);
  };

  const handleVerifySearch = async () => {
    const term = smartSearch.trim();
    if (!term) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    const matches = await searchCustomers(term);
    setSearchResults(matches);
    setShowResults(true);
  };

  const handleSelectCustomer = async (customer: any) => {
    const full = await getCustomerWithVehicles(customer.id);
    setVerifiedCustomer(full || customer);
    setCustomerData(full || customer);
    setSmartSearch("");
    setShowResults(false);
    setSearchResults([]);
  };

  // UI same as yours (unchanged)
  return (
    <div className="form-card">
      <div className="form-card-title">
        <i className="fas fa-user"></i>
        <h2>Customer Information</h2>
      </div>
      <div className="form-card-content">
        <div className="option-selector">
          <div className={`option-btn ${customerType === "new" ? "selected" : ""}`} onClick={() => setCustomerType("new")}>
            New Customer
          </div>
          <div className={`option-btn ${customerType === "existing" ? "selected" : ""}`} onClick={() => setCustomerType("existing")}>
            Existing Customer
          </div>
        </div>

        {customerType === "new" && !verifiedCustomer && (
          <div>
            <div className="form-row">
              <div className="form-group">
                <label>Full Name *</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Phone *</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Optional" />
              </div>
              <div className="form-group">
                <label>Address</label>
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Heard of us from *</label>
                <select
                  value={heardFrom}
                  onChange={(e) => {
                    setHeardFrom(e.target.value);
                    setReferralPersonName("");
                    setReferralPersonMobile("");
                    setSocialPlatform("");
                    setHeardFromOtherNote("");
                  }}
                >
                  <option value="">Select…</option>
                  <option value="walk_in">Walk-in</option>
                  <option value="refer_person">Refer by person</option>
                  <option value="social_media">Social media</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            {heardFrom === "refer_person" && (
              <div className="form-row">
                <div className="form-group">
                  <label>Referred Person Name *</label>
                  <input value={referralPersonName} onChange={(e) => setReferralPersonName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Referred Person Mobile *</label>
                  <input value={referralPersonMobile} onChange={(e) => setReferralPersonMobile(e.target.value)} />
                </div>
              </div>
            )}

            {heardFrom === "social_media" && (
              <div className="form-row">
                <div className="form-group">
                  <label>Platform *</label>
                  <select value={socialPlatform} onChange={(e) => setSocialPlatform(e.target.value)}>
                    <option value="">Select…</option>
                    <option value="instagram">Instagram</option>
                    <option value="twitter">Twitter</option>
                    <option value="tiktok">TikTok</option>
                    <option value="website">Website</option>
                  </select>
                </div>
              </div>
            )}

            {heardFrom === "other" && (
              <div className="form-row">
                <div className="form-group">
                  <label>Other Note *</label>
                  <input value={heardFromOtherNote} onChange={(e) => setHeardFromOtherNote(e.target.value)} />
                </div>
              </div>
            )}
            <button
              className="btn btn-primary"
              onClick={() => void handleSave()}
              disabled={
                saving ||
                !fullName ||
                !phone ||
                !heardFrom ||
                (heardFrom === "refer_person" && (!referralPersonName || !referralPersonMobile)) ||
                (heardFrom === "social_media" && !socialPlatform) ||
                (heardFrom === "other" && !heardFromOtherNote)
              }
            >
              {saving ? "Saving..." : "Save Customer"}
            </button>
          </div>
        )}

        {customerType === "existing" && (
          <div>
            <div className="form-group" style={{ position: "relative" }}>
              <label>Search Customer</label>
              <div className="smart-search-wrapper">
                <i className="fas fa-search" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#888" }}></i>
                <input
                  type="text"
                  className="smart-search-input"
                  placeholder="Search by name, customer ID, mobile, or email..."
                  value={smartSearch}
                  onChange={(e) => setSmartSearch(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && void handleVerifySearch()}
                  style={{ paddingLeft: "40px" }}
                />
              </div>
              <button className="btn btn-primary" onClick={() => void handleVerifySearch()} style={{ marginTop: "10px" }}>
                <i className="fas fa-search"></i> Verify Customer
              </button>

              {showResults && searchResults.length > 0 && (
                <div className="customer-search-results">
                  {searchResults.map((customer) => (
                    <div key={customer.id} className="customer-result-item">
                      <div className="customer-result-info">
                        <div className="customer-result-name">
                          <strong>{customer.name}</strong>
                        </div>
                        <div className="customer-result-details">
                          <span className="customer-detail-chip">
                            <i className="fas fa-id-card"></i> {formatCustomerDisplayId(customer.id)}
                          </span>
                          <span className="customer-detail-chip">
                            <i className="fas fa-phone"></i> {customer.mobile}
                          </span>
                          <span className="customer-detail-chip">
                            <i className="fas fa-envelope"></i> {customer.email}
                          </span>
                        </div>
                      </div>
                      <button className="btn btn-verify" onClick={() => void handleSelectCustomer(customer)}>
                        <i className="fas fa-check"></i> Select
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showResults && searchResults.length === 0 && (
                <div className="customer-search-results">
                  <div className="no-results-message">
                    <i className="fas fa-search"></i>
                    <p>No customers found matching your search</p>
                  </div>
                </div>
              )}
            </div>

            {verifiedCustomer && (
              <div className="verified-customer-display">
                <div className="verified-header">
                  <i className="fas fa-check-circle"></i>
                  <span>Customer Verified</span>
                </div>
                <div className="verified-info">
                  <div className="verified-row">
                    <span className="verified-label">Name:</span>
                    <span className="verified-value">{verifiedCustomer.name}</span>
                  </div>
                  <div className="verified-row">
                    <span className="verified-label">Customer ID:</span>
                    <span className="verified-value">{formatCustomerDisplayId(verifiedCustomer.id)}</span>
                  </div>
                  <div className="verified-row">
                    <span className="verified-label">Email:</span>
                    <span className="verified-value">{verifiedCustomer.email}</span>
                  </div>
                  <div className="verified-row">
                    <span className="verified-label">Mobile:</span>
                    <span className="verified-value">{verifiedCustomer.mobile}</span>
                  </div>
                  {verifiedCustomer.address && (
                    <div className="verified-row">
                      <span className="verified-label">Address:</span>
                      <span className="verified-value">{verifiedCustomer.address}</span>
                    </div>
                  )}
                  {(verifiedCustomer.heardFrom || "").trim() && (
                    <div className="verified-row">
                      <span className="verified-label">Heard of us from:</span>
                      <span className="verified-value">{sourceLabel(String(verifiedCustomer.heardFrom || ""))}</span>
                    </div>
                  )}
                  {String(verifiedCustomer.heardFrom ?? "") === "refer_person" && (
                    <>
                      <div className="verified-row">
                        <span className="verified-label">Referred Name:</span>
                        <span className="verified-value">{verifiedCustomer.referralPersonName || "—"}</span>
                      </div>
                      <div className="verified-row">
                        <span className="verified-label">Referred Mobile:</span>
                        <span className="verified-value">{verifiedCustomer.referralPersonMobile || "—"}</span>
                      </div>
                    </>
                  )}
                  {String(verifiedCustomer.heardFrom ?? "") === "social_media" && (
                    <div className="verified-row">
                      <span className="verified-label">Platform:</span>
                      <span className="verified-value">{verifiedCustomer.socialPlatform || "—"}</span>
                    </div>
                  )}
                  {String(verifiedCustomer.heardFrom ?? "") === "other" && (
                    <div className="verified-row">
                      <span className="verified-label">Other Note:</span>
                      <span className="verified-value">{verifiedCustomer.heardFromOtherNote || "—"}</span>
                    </div>
                  )}
                  <div className="verified-row">
                    <span className="verified-label">Registered Vehicles:</span>
                    <span className="verified-value">{verifiedCustomer.vehicles?.length ?? verifiedCustomer.registeredVehiclesCount ?? 0}</span>
                  </div>
                </div>
                <button
                  className="btn btn-change-customer"
                  onClick={() => {
                    setVerifiedCustomer(null);
                    setCustomerData(null);
                    setSmartSearch("");
                    setShowResults(false);
                    setSearchResults([]);
                  }}
                >
                  <i className="fas fa-sync-alt"></i> Change Customer
                </button>
              </div>
            )}
          </div>
        )}

        {customerType === "new" && verifiedCustomer && (
          <div className="verified-customer-display">
            <div className="verified-header">
              <i className="fas fa-check-circle"></i>
              <span>Customer Verified</span>
            </div>
            <div className="verified-info">
              <div className="verified-row">
                <span className="verified-label">Name:</span>
                <span className="verified-value">{verifiedCustomer.name}</span>
              </div>
              <div className="verified-row">
                <span className="verified-label">Customer ID:</span>
                <span className="verified-value">{formatCustomerDisplayId(verifiedCustomer.id)}</span>
              </div>
              <div className="verified-row">
                <span className="verified-label">Mobile:</span>
                <span className="verified-value">{verifiedCustomer.mobile}</span>
              </div>
              {(verifiedCustomer.heardFrom || "").trim() && (
                <div className="verified-row">
                  <span className="verified-label">Heard of us from:</span>
                  <span className="verified-value">{sourceLabel(String(verifiedCustomer.heardFrom || ""))}</span>
                </div>
              )}
            </div>
            <button
              className="btn btn-change-customer"
              onClick={() => {
                setVerifiedCustomer(null);
                setCustomerData(null);
                setFullName("");
                setEmail("");
                setPhone("");
                setAddress("");
                setHeardFrom("");
                setReferralPersonName("");
                setReferralPersonMobile("");
                setSocialPlatform("");
                setHeardFromOtherNote("");
              }}
            >
              <i className="fas fa-edit"></i> Edit Customer
            </button>
          </div>
        )}

        {showDuplicateWarning && (
          <div className="warning-dialog-overlay">
            <div className="warning-dialog">
              <div className="warning-dialog-header">
                <i className="fas fa-exclamation-circle"></i>
                <span>Duplicate Customer Warning</span>
              </div>
              <div className="warning-dialog-body">
                <p>This customer already exists in the system.</p>
                <p>
                  <strong>Name:</strong> {pendingCustomer?.name}
                </p>
                <p>
                  <strong>Mobile:</strong> {pendingCustomer?.mobile}
                </p>
                <p className="warning-message">Are you sure you want to save as a new customer?</p>
              </div>
              <div className="warning-dialog-footer">
                <button className="btn btn-danger" onClick={() => void handleConfirmDuplicate()}>
                  <i className="fas fa-check"></i> Yes, Save Anyway
                </button>
                <button className="btn btn-secondary" onClick={handleCancelDuplicate}>
                  <i className="fas fa-times"></i> No, Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="action-buttons">
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={onNext} disabled={!customerData}>
          Next: Vehicle
        </button>
      </div>
    </div>
  );
}

// ============================================
// VEHICLE STEP
// ============================================
function StepTwoVehicle({ vehicleData, setVehicleData, customerData, setCustomerData, onVehicleSelected, onNext, onBack, actorUsername }: any) {
  const [showNewVehicleForm, setShowNewVehicleForm] = useState(false);
  const [factory, setFactory] = useState(QATAR_MANUFACTURERS[0] ?? "Toyota");
  const [model, setModel] = useState("");
  const [year, setYear] = useState<any>(new Date().getFullYear());
  const [license, setLicense] = useState("");
  const [carType, setCarType] = useState("SUV");
  const [color, setColor] = useState("");
  const [vinNumber, setVinNumber] = useState(""); // ✅ NEW manual VIN
  const manufacturerOptions = QATAR_MANUFACTURERS;
  const modelOptions = useMemo(() => getModelsByManufacturer(factory), [factory]);
  const colorOptions = VEHICLE_COLORS;

  const hasVehicles = customerData?.vehicles && customerData.vehicles.length > 0;

  useEffect(() => {
    if (!hasVehicles) setShowNewVehicleForm(true);
  }, [hasVehicles]);

  useEffect(() => {
    setModel((current) => (modelOptions.includes(current) ? current : ""));
  }, [modelOptions]);

  const handleSaveNewVehicle = async () => {
    if (!(factory && model && year && license && carType && color)) return;

    const created = await createVehicleForCustomer({
      customerId: customerData.id,
      ownedBy: customerData.name,
      make: factory.trim(),
      model: model.trim(),
      year: String(year),
      color,
      plateNumber: license,
      vehicleType: carType,
      vin: vinNumber.trim().toUpperCase(),
      actor: actorUsername,
    });

    const updatedCustomer = {
      ...customerData,
      vehicles: [...(customerData.vehicles || []), created],
      registeredVehiclesCount: (customerData.registeredVehiclesCount || 0) + 1,
    };

    setCustomerData(updatedCustomer);
    setVehicleData(created);
    setShowNewVehicleForm(false);

    if (onVehicleSelected) onVehicleSelected(created);
  };

  const handleSelectExistingVehicle = (vehicle: any) => {
    setVehicleData(vehicle);
    if (onVehicleSelected) onVehicleSelected(vehicle);
  };

  return (
    <div className="form-card">
      <div className="form-card-title">
        <i className="fas fa-car"></i>
        <h2>Vehicle Information</h2>
      </div>
      <div className="form-card-content">
        {hasVehicles && !showNewVehicleForm && !vehicleData && (
          <div>
            <div className="info-banner" style={{ marginBottom: "20px" }}>
              <i className="fas fa-info-circle"></i>
              <span>This customer has {customerData.vehicles.length} registered vehicle(s). Select one or add a new vehicle.</span>
            </div>

            <h3 style={{ marginBottom: "15px", fontSize: "16px", fontWeight: "600" }}>Registered Vehicles</h3>
            <div className="vehicles-list">
              {customerData.vehicles.map((vehicle: any, idx: number) => (
                <div key={String(vehicle?.vehicleId ?? vehicle?.id ?? vehicle?.plateNumber ?? idx)} className="vehicle-result-item">
                  <div className="vehicle-result-info">
                    <div className="vehicle-result-name">
                      <strong>
                        {vehicle.make} {vehicle.model} ({vehicle.year})
                      </strong>
                    </div>
                    <div className="vehicle-result-details">
                      <span className="vehicle-detail-chip">
                        <i className="fas fa-palette"></i> {vehicle.color}
                      </span>
                      <span className="vehicle-detail-chip">
                        <i className="fas fa-id-card"></i> {vehicle.plateNumber}
                      </span>
                      <span className="vehicle-detail-chip">
                        <i className="fas fa-car"></i> {vehicle.vehicleType}
                      </span>
                      <span className="vehicle-detail-chip">
                        <i className="fas fa-barcode"></i> {vehicle.vin}
                      </span>
                    </div>
                  </div>
                  <button className="btn btn-verify" onClick={() => handleSelectExistingVehicle(vehicle)}>
                    <i className="fas fa-check"></i> Select
                  </button>
                </div>
              ))}
            </div>

            <button className="btn btn-secondary" onClick={() => setShowNewVehicleForm(true)} style={{ marginTop: "15px" }}>
              <i className="fas fa-plus"></i> Add New Vehicle
            </button>
          </div>
        )}

        {(showNewVehicleForm || !hasVehicles) && !vehicleData && (
          <div>
            {hasVehicles && (
              <button className="btn btn-link" onClick={() => setShowNewVehicleForm(false)} style={{ marginBottom: "15px", padding: "8px 12px", fontSize: "14px" }}>
                <i className="fas fa-arrow-left"></i> Back to Vehicle Selection
              </button>
            )}

            <div className="form-row">
              <div className="form-group">
                <label>Manufacturer *</label>
                <select value={factory} onChange={(e) => setFactory(e.target.value)}>
                  {manufacturerOptions.map((manufacturer) => (
                    <option key={manufacturer} value={manufacturer}>
                      {manufacturer}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Model *</label>
                <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!modelOptions.length}>
                  <option value="">Select model</option>
                  {modelOptions.map((modelName) => (
                    <option key={modelName} value={modelName}>
                      {modelName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Year *</label>
                <select value={year} onChange={(e) => setYear(e.target.value)}>
                  {Array.from({ length: 20 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>License Plate *</label>
                <input value={license} onChange={(e) => setLicense(e.target.value)} placeholder="e.g., 123456" />
              </div>
            </div>

            {/* ✅ NEW ROW: VIN + Vehicle Type */}
            <div className="form-row">
              <div className="form-group">
                <label>VIN Number</label>
                <input
                  value={vinNumber}
                  onChange={(e) => setVinNumber(e.target.value.toUpperCase())}
                  placeholder="e.g., JTDBR32E720054321"
                  maxLength={30}
                />
              </div>
              <div className="form-group">
                <label>Vehicle Type *</label>
                <select value={carType} onChange={(e) => setCarType(e.target.value)}>
                  <option>SUV</option>
                  <option>Sedan</option>
                  <option>Hatchback</option>
                  <option>Coupe</option>
                  <option>Truck</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Color *</label>
                <select value={color} onChange={(e) => setColor(e.target.value)}>
                  <option value="">Select color</option>
                  {colorOptions.map((colorName) => (
                    <option key={colorName} value={colorName}>
                      {colorName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              className="btn btn-success"
              onClick={() => void handleSaveNewVehicle()}
              disabled={!(factory && model && year && license && carType && color)}
            >
              <i className="fas fa-save"></i> Save Vehicle
            </button>
          </div>
        )}

        {vehicleData && (
          <div className="verified-customer-display" style={{ marginTop: "0" }}>
            <div className="verified-header">
              <i className="fas fa-check-circle"></i>
              <span>Vehicle Selected</span>
            </div>
            <div className="verified-info">
              <div className="verified-row">
                <span className="verified-label">Vehicle:</span>
                <span className="verified-value">
                  {vehicleData.make} {vehicleData.model} ({vehicleData.year})
                </span>
              </div>
              <div className="verified-row">
                <span className="verified-label">License Plate:</span>
                <span className="verified-value">{vehicleData.plateNumber}</span>
              </div>
              <div className="verified-row">
                <span className="verified-label">Type:</span>
                <span className="verified-value">{vehicleData.vehicleType}</span>
              </div>
              <div className="verified-row">
                <span className="verified-label">Color:</span>
                <span className="verified-value">{vehicleData.color}</span>
              </div>
              {vehicleData.vin && (
                <div className="verified-row">
                  <span className="verified-label">VIN:</span>
                  <span className="verified-value">{vehicleData.vin}</span>
                </div>
              )}
            </div>
            <button className="btn btn-change-customer" onClick={() => setVehicleData(null)}>
              <i className="fas fa-sync-alt"></i> Change Vehicle
            </button>
          </div>
        )}
      </div>

      <div className="action-buttons">
        <button className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onNext} disabled={!vehicleData}>
          Next: Services
        </button>
      </div>
    </div>
  );
}

// ============================================
// SERVICES STEP (same UI)
// ============================================
function StepThreeServices({
  products,
  selectedServices,
  setSelectedServices,
  vehicleType,
  maxDiscountPercent,
  discountAmount,
  setDiscountAmount,
  orderNotes,
  setOrderNotes,
  expectedDeliveryDate,
  setExpectedDeliveryDate,
  expectedDeliveryTime,
  setExpectedDeliveryTime,
  onNext,
  onBack,
  orderType,
  vehicleCompletedServices,
}: any) {
  const [pendingSpecificationProduct, setPendingSpecificationProduct] = useState<any>(null);

  // Unique services extracted from all completed orders (for "service" order type)
  const completedOrdersServices = useMemo(() => {
    if (!vehicleCompletedServices?.length) return [];
    const seen = new Set<string>();
    const out: any[] = [];
    for (const order of vehicleCompletedServices ?? []) {
      for (const svc of order.services ?? []) {
        const key = normalizeCatalogKey(svc?.serviceCode || svc?.catalogId || svc?.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(svc);
      }
    }
    return out;
  }, [vehicleCompletedServices]);

  // In "service" mode show completed services; fall through to catalog if none
  const useCompletedPool = orderType === "service" && completedOrdersServices.length > 0;

  const handleToggleCompletedService = (svc: any) => {
    const svcKey = normalizeCatalogKey(svc?.serviceCode || svc?.catalogId || svc?.name);
    const isSelected = selectedServices.some(
      (s: any) => normalizeCatalogKey(s?.serviceCode || s?.catalogId || s?.name) === svcKey
    );
    if (isSelected) {
      setSelectedServices(
        selectedServices.filter(
          (s: any) => normalizeCatalogKey(s?.serviceCode || s?.catalogId || s?.name) !== svcKey
        )
      );
      return;
    }
    // Check if the matching catalog product has specifications
    const catalogProduct = products.find(
      (p: any) =>
        normalizeCatalogKey(p?.serviceCode || p?.id || p?.name) ===
        normalizeCatalogKey(svc?.serviceCode || svc?.catalogId || svc?.name)
    );
    if (catalogProduct && hasServiceSpecifications(catalogProduct)) {
      setPendingSpecificationProduct(catalogProduct);
      return;
    }
    // No spec flow — add directly, preserving any previously saved specification
    setSelectedServices(
      dedupeSelectedServices([
        ...selectedServices,
        {
          name: svc.name,
          nameAr: svc.nameAr,
          price: catalogProduct
            ? resolveServicePriceForVehicleType(catalogProduct, vehicleType)
            : (svc.price || 0),
          serviceCode: svc.serviceCode || undefined,
          catalogId: svc.catalogId || undefined,
          specificationBrandId: svc.specificationBrandId || undefined,
          specificationBrandName: svc.specificationBrandName || undefined,
          specificationColorHex: svc.specificationColorHex || undefined,
          specificationProductId: svc.specificationProductId || undefined,
          specificationProductName: svc.specificationProductName || undefined,
          specificationMeasurement: svc.specificationMeasurement || undefined,
        },
      ])
    );
  };

  const handleToggleService = (product: any) => {
    const productKey = normalizeCatalogKey(product.serviceCode || product.id || product.name);
    const isSelected = isCatalogProductSelected(product, selectedServices);
    if (isSelected) {
      const next = String(product?.type ?? "").toLowerCase() === "package"
        ? selectedServices.filter((s: any) => normalizeCatalogKey(s.packageCode) !== productKey)
        : selectedServices.filter((s: any) => normalizeCatalogKey(s.serviceCode || s.catalogId || s.name) !== productKey);
      setSelectedServices(dedupeSelectedServices(next));
    } else {
      if (hasServiceSpecifications(product)) {
        const configuredSpecification = getConfiguredSpecificationSelection(product);
        if (configuredSpecification) {
          const expanded = expandCatalogProductToServices(product, products, vehicleType, configuredSpecification);
          setSelectedServices(dedupeSelectedServices([...selectedServices, ...expanded]));
          return;
        }
        setPendingSpecificationProduct(product);
        return;
      }
      const expanded = expandCatalogProductToServices(product, products, vehicleType);
      setSelectedServices(dedupeSelectedServices([...selectedServices, ...expanded]));
    }
  };

  const [filterCategory, setFilterCategory] = useState("all");
  const [filterType, setFilterType] = useState("all");

  const svcCategories = useMemo(() => {
    const catMap = new Map<string, { id: string; nameEn: string }>();
    for (const p of products) {
      const catId = String(p?.categoryId || "");
      if (catId && !catMap.has(catId)) {
        catMap.set(catId, { id: catId, nameEn: String(p?.categoryNameEn || p?.categoryCode || catId) });
      }
    }
    return [...catMap.values()].sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  }, [products]);

  const filteredProducts = useMemo(() =>
    products.filter((p: any) => {
      const catOk = filterCategory === "all" || String(p?.categoryId || "") === filterCategory;
      const typeOk = filterType === "all" || String(p?.type || "").toLowerCase() === filterType;
      return catOk && typeOk;
    }), [products, filterCategory, filterType]);

  const formatPrice = (price: number) => `QAR ${price.toLocaleString()}`;

  const { subtotal, packageCount } = summarizeServicesPricing(selectedServices);
  const normalizedMaxDiscountPercent = Math.max(0, Math.min(100, Number(maxDiscountPercent ?? 0)));
  const maxDiscountAmountByPolicy = (Math.max(0, subtotal) * normalizedMaxDiscountPercent) / 100;
  const discount = Math.min(
    Math.max(0, Number(discountAmount || 0)),
    Math.max(0, subtotal),
    Math.max(0, maxDiscountAmountByPolicy)
  );
  const discountPercent = subtotal > 0 ? (discount / subtotal) * 100 : 0;
  const total = subtotal - discount;

  return (
    <div className="form-card">
      <div className="form-card-title">
        <i className="fas fa-concierge-bell"></i>
        <h2>Services Selection</h2>
      </div>

      <div className="form-card-content">

        {/* ── COMPLETED SERVICES MODE (service order + completed history) ── */}
        {useCompletedPool ? (
          <>
            <div className="jo-completed-svc-banner">
              <i className="fas fa-history"></i>
              <span>Select from previously completed services for this vehicle</span>
            </div>

            <div className="jo-completed-svc-grid">
              {completedOrdersServices.map((svc: any, idx: number) => {
                const svcKey = normalizeCatalogKey(svc?.serviceCode || svc?.catalogId || svc?.name);
                const isSelected = selectedServices.some(
                  (s: any) => normalizeCatalogKey(s?.serviceCode || s?.catalogId || s?.name) === svcKey
                );
                const catalogProduct = products.find(
                  (p: any) =>
                    normalizeCatalogKey(p?.serviceCode || p?.id || p?.name) === svcKey
                );
                const currentPrice = catalogProduct
                  ? resolveServicePriceForVehicleType(catalogProduct, vehicleType)
                  : (svc.price || 0);
                const selectedSpec = selectedServices.find(
                  (s: any) => normalizeCatalogKey(s?.serviceCode || s?.catalogId || s?.name) === svcKey
                );
                const specLabel = getServiceSpecificationLabel(selectedSpec || svc);
                const hasSpecs = catalogProduct
                  ? hasServiceSpecifications(catalogProduct)
                  : !!(svc.specificationBrandId || svc.specificationBrandName);

                return (
                  <div
                    key={`completed-svc-${svcKey || idx}`}
                    className={`jo-completed-svc-card${isSelected ? " selected" : ""}`}
                    onClick={() => handleToggleCompletedService(svc)}
                  >
                    <div className="jo-completed-svc-check">
                      <span className={`jo-completed-svc-checkbox${isSelected ? " checked" : ""}`}>
                        {isSelected && <i className="fas fa-check"></i>}
                      </span>
                    </div>
                    <div className="jo-completed-svc-body">
                      <div className="jo-completed-svc-name" data-no-translate="true">
                        {getServiceDisplayName(svc)}
                      </div>
                      {hasSpecs && (
                        <div className="jo-completed-svc-spec" data-no-translate="true">
                          {specLabel ? (
                            <span className="jo-completed-spec-set">
                              {svc.specificationColorHex && (
                                <span
                                  className="jo-completed-spec-dot"
                                  style={{ background: svc.specificationColorHex }}
                                />
                              )}
                              <i className="fas fa-palette"></i> {specLabel}
                            </span>
                          ) : (
                            <span className="jo-completed-spec-hint">
                              <i className="fas fa-info-circle"></i> Specification required
                            </span>
                          )}
                        </div>
                      )}
                      <div className="jo-completed-svc-badge">
                        <i className="fas fa-check-circle"></i> Previously completed
                      </div>
                    </div>
                    <div className="jo-completed-svc-price">
                      QAR {Number(currentPrice || 0).toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* ── CATALOG MODE (new order or no completed services) ── */
          <>
            <p>Select services for {vehicleType}:</p>

            {products.length === 0 ? (
              <div className="empty-state" style={{ padding: "30px 12px" }}>
                <div className="empty-text">No services configured yet</div>
                <div className="empty-subtext">Please create services from the Service Creation page first.</div>
              </div>
            ) : (
            <>
              <div className="svc-filter-bar">
                <div className="svc-filter-row">
                  <span className="svc-filter-label"><i className="fas fa-tags"></i> Category</span>
                  <select
                    className="svc-filter-select"
                    value={filterCategory}
                    onChange={(e) => { setFilterCategory(e.target.value); }}
                  >
                    <option value="all">All Categories</option>
                    {svcCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.nameEn}</option>
                    ))}
                  </select>
                </div>
                <div className="svc-filter-row">
                  <span className="svc-filter-label"><i className="fas fa-layer-group"></i> Type</span>
                  <div className="svc-type-pills">
                    <button type="button" className={`svc-type-pill${filterType === "all" ? " active" : ""}`} onClick={() => setFilterType("all")}>All</button>
                    <button type="button" className={`svc-type-pill${filterType === "service" ? " active" : ""}`} onClick={() => setFilterType("service")}><i className="fas fa-wrench"></i> Services</button>
                    <button type="button" className={`svc-type-pill${filterType === "package" ? " active" : ""}`} onClick={() => setFilterType("package")}><i className="fas fa-box-open"></i> Packages</button>
                  </div>
                  <span className="svc-filter-count">{filteredProducts.length} of {products.length}</span>
                </div>
              </div>
              {filteredProducts.length === 0 ? (
                <div className="empty-state" style={{ padding: "24px 12px" }}>
                  <div className="empty-text">No services match your filter</div>
                  <div className="empty-subtext">Try a different category or type.</div>
                </div>
              ) : (
              <div className="services-grid">
                {filteredProducts.map((product: any) => (
                  <div
                    key={String(product.id || product.serviceCode || product.name)}
                    className={`service-checkbox ${isCatalogProductSelected(product, selectedServices) ? "selected" : ""}`}
                    onClick={() => handleToggleService(product)}
                  >
                    <div className="service-info">
                      <div className="service-name-row">
                        <div className="service-name" data-no-translate="true">{getServiceDisplayName(product)}</div>
                        {String(product?.type ?? "").toLowerCase() === "package" && (
                          <span className="jo-package-price-badge">
                            <i className="fas fa-box-open" aria-hidden="true"></i>
                            Package Price Applied
                          </span>
                        )}
                      </div>
                      {hasServiceSpecifications(product) && (
                        <div className="empty-subtext" data-no-translate="true">
                          {(() => {
                            const selectedSpecification = getSelectedSpecificationForProduct(product, selectedServices);
                            const label = getServiceSpecificationLabel(selectedSpecification);
                            const colorHex = String(selectedSpecification?.specificationColorHex || "").trim();
                            return label ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                {colorHex ? (
                                  <span
                                    aria-hidden="true"
                                    style={{
                                      width: 10,
                                      height: 10,
                                      borderRadius: 999,
                                      background: colorHex,
                                      border: "1px solid rgba(15, 23, 42, 0.14)",
                                      display: "inline-block",
                                    }}
                                  ></span>
                                ) : null}
                                {`Specification: ${label}`}
                              </span>
                            ) : "Specification required before adding this service.";
                          })()}
                        </div>
                      )}
                    </div>
                    <div className="service-price">{formatPrice(resolveServicePriceForVehicleType(product, vehicleType))}</div>
                  </div>
                ))}
              </div>
              )}
            </>
            )}
          </>
        )}

        <div style={{ marginTop: "20px" }}>
          <label style={{ display: "block", marginBottom: "8px", fontWeight: "500", color: "#333" }}>
            <i className="fas fa-sticky-note" style={{ marginRight: "8px" }}></i>
            Notes / Comments (Optional)
          </label>
          <textarea
            value={orderNotes}
            onChange={(e) => setOrderNotes(e.target.value)}
            placeholder="Add any special instructions, notes, or comments for this order..."
            rows={4}
            style={{ width: "100%", padding: "12px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "14px", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
          />
        </div>

        <div style={{ marginTop: "20px" }}>
          <label style={{ display: "block", marginBottom: "8px", fontWeight: "500", color: "#333" }}>
            <i className="fas fa-calendar-check" style={{ marginRight: "8px" }}></i>
            Expected Delivery Date & Time
          </label>
          <div style={{ display: "flex", gap: "12px" }}>
            <div style={{ flex: 1 }}>
              <input
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                style={{ width: "100%", padding: "12px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <input
                type="time"
                value={expectedDeliveryTime}
                onChange={(e) => setExpectedDeliveryTime(e.target.value)}
                style={{ width: "100%", padding: "12px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "14px", boxSizing: "border-box" }}
              />
            </div>
          </div>
        </div>

        <div className="price-summary-box">
          <h4>Price Summary</h4>
          <div className="price-row">
            <span>{packageCount > 0 ? "Packages & Services:" : "Services:"}</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          <div className="price-row">
            <span>Apply Discount:</span>
            <div>
              <PermissionGate moduleId="joborder" optionId="joborder_discount_percent">
                <input
                  type="number"
                  min="0"
                  max={normalizedMaxDiscountPercent}
                  value={Number(discountPercent.toFixed(2))}
                  onChange={(e) => {
                    const pct = Math.max(0, Math.min(normalizedMaxDiscountPercent, parseFloat(e.target.value) || 0));
                    setDiscountAmount((subtotal * pct) / 100);
                  }}
                  style={{ width: "80px", color: "#333", backgroundColor: "#fff" }}
                />
                <span> %</span>
              </PermissionGate>
            </div>
          </div>
          <div className="price-row">
            <span>Discount Amount (QAR):</span>
            <div>
              <PermissionGate moduleId="joborder" optionId="joborder_discount_percent">
                <input
                  type="number"
                  min="0"
                  max={Math.max(0, Math.min(subtotal, maxDiscountAmountByPolicy))}
                  step="0.01"
                  value={Number(discount.toFixed(2))}
                  onChange={(e) => {
                    const amount = Math.max(0, Math.min(subtotal, maxDiscountAmountByPolicy, parseFloat(e.target.value) || 0));
                    setDiscountAmount(amount);
                  }}
                  style={{ width: "120px", color: "#333", backgroundColor: "#fff" }}
                />
              </PermissionGate>
            </div>
          </div>
          <div className="price-row">
            <span>Max Allowed Discount:</span>
            <span>{Number(normalizedMaxDiscountPercent.toFixed(2))}%</span>
          </div>
          <div className="price-row discount-amount">
            <span>Discount Amount:</span>
            <span>{formatPrice(discount)}</span>
          </div>
          <div className="price-row total">
            <span>Total:</span>
            <span>{formatPrice(total)}</span>
          </div>
        </div>
      </div>

      <div className="action-buttons">
        <button className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onNext} disabled={selectedServices.length === 0 || (!useCompletedPool && products.length === 0)}>
          Next: Confirm
        </button>
      </div>

      {pendingSpecificationProduct && (
        <ServiceSpecificationModal
          product={pendingSpecificationProduct}
          onClose={() => setPendingSpecificationProduct(null)}
          onConfirm={(specification: any) => {
            const expanded = expandCatalogProductToServices(pendingSpecificationProduct, products, vehicleType, specification);
            setSelectedServices(dedupeSelectedServices([...selectedServices, ...expanded]));
            setPendingSpecificationProduct(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================
// ADD SERVICE SCREEN
// ============================================
function AddServiceScreen({ order, products = [], maxDiscountPercent = 0, onClose, onSubmit }: any) {
  const { t } = useLanguage();
  const [selectedServices, setSelectedServices] = useState<any[]>([]);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [pendingSpecificationProduct, setPendingSpecificationProduct] = useState<any>(null);
  const vehicleType = order?.vehicleDetails?.type || "SUV";

  const handleToggleService = (product: any) => {
    const productKey = normalizeCatalogKey(product.serviceCode || product.id || product.name);
    const isSelected = isCatalogProductSelected(product, selectedServices);
    if (isSelected) {
      const next = String(product?.type ?? "").toLowerCase() === "package"
        ? selectedServices.filter((s: any) => normalizeCatalogKey(s.packageCode) !== productKey)
        : selectedServices.filter((s: any) => normalizeCatalogKey(s.serviceCode || s.catalogId || s.name) !== productKey);
      setSelectedServices(dedupeSelectedServices(next));
    } else {
      if (hasServiceSpecifications(product)) {
        const configuredSpecification = getConfiguredSpecificationSelection(product);
        if (configuredSpecification) {
          const expanded = expandCatalogProductToServices(product, products, vehicleType, configuredSpecification);
          setSelectedServices(dedupeSelectedServices([...selectedServices, ...expanded]));
          return;
        }
        setPendingSpecificationProduct(product);
        return;
      }
      const expanded = expandCatalogProductToServices(product, products, vehicleType);
      setSelectedServices(dedupeSelectedServices([...selectedServices, ...expanded]));
    }
  };

  const [asFilterCategory, setAsFilterCategory] = useState("all");
  const [asFilterType, setAsFilterType] = useState("all");

  const asCategories = useMemo(() => {
    const catMap = new Map<string, { id: string; nameEn: string }>();
    for (const p of products) {
      const catId = String(p?.categoryId || "");
      if (catId && !catMap.has(catId)) {
        catMap.set(catId, { id: catId, nameEn: String(p?.categoryNameEn || p?.categoryCode || catId) });
      }
    }
    return [...catMap.values()].sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  }, [products]);

  const asFilteredProducts = useMemo(() =>
    products.filter((p: any) => {
      const catOk = asFilterCategory === "all" || String(p?.categoryId || "") === asFilterCategory;
      const typeOk = asFilterType === "all" || String(p?.type || "").toLowerCase() === asFilterType;
      return catOk && typeOk;
    }), [products, asFilterCategory, asFilterType]);

  const formatPrice = (price: number) => `QAR ${price.toLocaleString()}`;
  const { subtotal, packageCount } = summarizeServicesPricing(selectedServices);
  const normalizedMaxDiscountPercent = Math.max(0, Math.min(100, Number(maxDiscountPercent || 0)));
  const existingTotalAmount = Math.max(0, toCurrencyNumber(order?.billing?.totalAmount));
  const existingDiscountAmount = Math.max(0, toCurrencyNumber(order?.billing?.discount));
  const combinedTotalAmount = Math.max(0, existingTotalAmount + subtotal);
  const discountAllowance = computeCumulativeDiscountAllowance({
    policyMaxPercent: normalizedMaxDiscountPercent,
    baseAmount: combinedTotalAmount,
    existingDiscountAmount,
  });
  const maxAdditionalDiscountAmount = Math.max(0, Math.min(subtotal, discountAllowance.maxAdditionalDiscountAmount));
  const maxAdditionalDiscountPercent = subtotal > 0 ? (maxAdditionalDiscountAmount / subtotal) * 100 : 0;
  const noRemainingDiscountAllowance = maxAdditionalDiscountAmount <= 0.00001;
  const effectiveDiscountPercent = Math.max(0, Math.min(maxAdditionalDiscountPercent, Number(discountPercent || 0)));
  const discount = (subtotal * effectiveDiscountPercent) / 100;
  const total = subtotal - discount;

  return (
<div className="pim-details-screen jo-details-v3">
      <div className="pim-details-header">
        <div className="pim-details-title-container">
          <h2>
            <i className="fas fa-plus-circle"></i> Add Services to Job Order
          </h2>
        </div>
        <button className="pim-btn-close-details" onClick={onClose}>
          <i className="fas fa-times"></i> Cancel
        </button>
      </div>

      <div className="pim-details-body">
        <div className="form-card">
          <div className="form-card-title">
            <i className="fas fa-concierge-bell"></i>
            <h2>Services Selection</h2>
          </div>

          <div className="form-card-content">
            <p>Select services for {vehicleType}:</p>
            {products.length === 0 ? (
              <div className="empty-state" style={{ padding: "28px 12px" }}>
                <div className="empty-text">No services configured yet</div>
                <div className="empty-subtext">Create services from Service Creation before adding to a job order.</div>
              </div>
            ) : (
            <>
              <div className="svc-filter-bar">
                <div className="svc-filter-row">
                  <span className="svc-filter-label"><i className="fas fa-tags"></i> Category</span>
                  <select
                    className="svc-filter-select"
                    value={asFilterCategory}
                    onChange={(e) => setAsFilterCategory(e.target.value)}
                  >
                    <option value="all">All Categories</option>
                    {asCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.nameEn}</option>
                    ))}
                  </select>
                </div>
                <div className="svc-filter-row">
                  <span className="svc-filter-label"><i className="fas fa-layer-group"></i> Type</span>
                  <div className="svc-type-pills">
                    <button type="button" className={`svc-type-pill${asFilterType === "all" ? " active" : ""}`} onClick={() => setAsFilterType("all")}>All</button>
                    <button type="button" className={`svc-type-pill${asFilterType === "service" ? " active" : ""}`} onClick={() => setAsFilterType("service")}><i className="fas fa-wrench"></i> Services</button>
                    <button type="button" className={`svc-type-pill${asFilterType === "package" ? " active" : ""}`} onClick={() => setAsFilterType("package")}><i className="fas fa-box-open"></i> Packages</button>
                  </div>
                  <span className="svc-filter-count">{asFilteredProducts.length} of {products.length}</span>
                </div>
              </div>
              {asFilteredProducts.length === 0 ? (
                <div className="empty-state" style={{ padding: "24px 12px" }}>
                  <div className="empty-text">No services match your filter</div>
                  <div className="empty-subtext">Try a different category or type.</div>
                </div>
              ) : (
              <div className="services-grid">
                {asFilteredProducts.map((product: any) => (
                  <div key={String(product.id || product.serviceCode || product.name)} className={`service-checkbox ${isCatalogProductSelected(product, selectedServices) ? "selected" : ""}`} onClick={() => handleToggleService(product)}>
                    <div className="service-info">
                      <div className="service-name-row">
                        <div className="service-name" data-no-translate="true">{getServiceDisplayName(product)}</div>
                        {String(product?.type ?? "").toLowerCase() === "package" && (
                          <span className="jo-package-price-badge">
                            <i className="fas fa-box-open" aria-hidden="true"></i>
                            Package Price Applied
                          </span>
                        )}
                      </div>
                      {hasServiceSpecifications(product) && (
                        <div className="empty-subtext" data-no-translate="true">
                          {(() => {
                            const selectedSpecification = getSelectedSpecificationForProduct(product, selectedServices);
                            const label = getServiceSpecificationLabel(selectedSpecification);
                            const colorHex = String(selectedSpecification?.specificationColorHex || "").trim();
                            return label ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                {colorHex ? (
                                  <span
                                    aria-hidden="true"
                                    style={{
                                      width: 10,
                                      height: 10,
                                      borderRadius: 999,
                                      background: colorHex,
                                      border: "1px solid rgba(15, 23, 42, 0.14)",
                                      display: "inline-block",
                                    }}
                                  ></span>
                                ) : null}
                                {`Specification: ${label}`}
                              </span>
                            ) : "Specification required before adding this service.";
                          })()}
                        </div>
                      )}
                    </div>
                    <PermissionGate moduleId="joborder" optionId="joborder_serviceprice">
                      <div className="service-price">{formatPrice(resolveServicePriceForVehicleType(product, vehicleType))}</div>
                    </PermissionGate>
                  </div>
                ))}
              </div>
              )}
            </>
            )}

            <div className="price-summary-box">
              <h4>Price Summary</h4>
              <div className="price-row">
                <span>{packageCount > 0 ? "Packages & Services:" : "Services:"}</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              <PermissionGate moduleId="joborder" optionId="joborder_discount_percent">
                <div className="price-row">
                  <span>Apply Discount:</span>
                  <div>
                    <PermissionGate moduleId="joborder" optionId="joborder_discount_percent">
                      <input
                        type="number"
                        min="0"
                        max={maxAdditionalDiscountPercent}
                        value={Number(effectiveDiscountPercent.toFixed(2))}
                        onChange={(e) =>
                          setDiscountPercent(
                            Math.max(0, Math.min(maxAdditionalDiscountPercent, parseFloat(e.target.value) || 0))
                          )
                        }
                        style={{ width: "80px" }}
                      />
                      <span> %</span>
                    </PermissionGate>
                  </div>
                </div>
              </PermissionGate>
              <PermissionGate moduleId="joborder" optionId="joborder_discount_percent">
                <div className="price-row">
                  <span>Remaining Allowed Discount:</span>
                  <span>
                    {Number(maxAdditionalDiscountPercent.toFixed(2))}% ({formatPrice(maxAdditionalDiscountAmount)})
                  </span>
                </div>
              </PermissionGate>
              {noRemainingDiscountAllowance ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#b91c1c", fontWeight: 600 }}>
                  {t("No additional discount can be applied. The order has already reached the role policy discount limit.")}
                </div>
              ) : null}
              <div className="price-row discount-amount">
                <span>Discount Amount:</span>
                <span>{formatPrice(discount)}</span>
              </div>
              <div className="price-row total">
                <span>Total:</span>
                <span>{formatPrice(total)}</span>
              </div>
            </div>

            <div className="action-buttons">
              <button className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => onSubmit({ selectedServices, discountPercent: effectiveDiscountPercent })}
                disabled={selectedServices.length === 0 || products.length === 0}
              >
                Add Services
              </button>
            </div>

            {pendingSpecificationProduct && (
              <ServiceSpecificationModal
                product={pendingSpecificationProduct}
                onClose={() => setPendingSpecificationProduct(null)}
                onConfirm={(specification: any) => {
                  const expanded = expandCatalogProductToServices(pendingSpecificationProduct, products, vehicleType, specification);
                  setSelectedServices(dedupeSelectedServices([...selectedServices, ...expanded]));
                  setPendingSpecificationProduct(null);
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InspectionModal({ item, onClose }: any) {
  if (!item) return null;
  return (
    <div className="inspection-modal" style={{ display: "flex" }} onClick={onClose}>
      <div className="inspection-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="inspection-modal-header">
          <h3>
            <i className="fas fa-search"></i> {item.name}
          </h3>
          <button className="inspection-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="inspection-modal-body">
          <div className="inspection-detail-section">
            <h4>Details</h4>
            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">Status</span>
                <span className="detail-value">{item.status}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Notes</span>
                <span className="detail-value">{item.notes}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// CONFIRM STEP
// ============================================
function StepFourConfirm({
  orderType,
  customerData,
  vehicleData,
  selectedServices,
  maxDiscountPercent,
  discountAmount,
  orderNotes,
  expectedDeliveryDate,
  expectedDeliveryTime,
  isSubmitting,
  onBack,
  onSubmit,
}: any) {
  const formatPrice = (price: number) => `QAR ${price.toLocaleString()}`;
  const { subtotal } = summarizeServicesPricing(selectedServices);
  const normalizedMaxDiscountPercent = Math.max(0, Math.min(100, Number(maxDiscountPercent ?? 0)));
  const maxDiscountAmountByPolicy = (Math.max(0, subtotal) * normalizedMaxDiscountPercent) / 100;
  const discount = Math.min(
    Math.max(0, Number(discountAmount || 0)),
    Math.max(0, subtotal),
    Math.max(0, maxDiscountAmountByPolicy)
  );
  const discountPercent = subtotal > 0 ? (discount / subtotal) * 100 : 0;
  const total = subtotal - discount;

  const customerMobile = customerData?.mobile || customerData?.phone || "Not provided";
  const heardFrom = String(customerData?.heardFrom ?? "").trim();
  const vehicleType = vehicleData?.vehicleType || vehicleData?.carType || "N/A";
  const vehicleId =
    String(
      vehicleData?.vehicleDetails?.vehicleId ??
      vehicleData?.vehicleDetails?.id ??
      vehicleData?.vehicleId ??
      ""
    ).trim() || "—";
  const plate = vehicleData?.plateNumber || vehicleData?.license || "N/A";
  const vin = vehicleData?.vin || "Not provided";


  return (
    <div className="form-card confirm-review-card">
      <div className="form-card-title">
        <i className="fas fa-check-circle"></i>
        <h2>Order Confirmation</h2>
      </div>

      <div className="form-card-content">
        {/* Top summary strip similar to screenshot */}
        <div className="jo-confirm-top-strip">
          <div className="jo-confirm-top-strip-left">
            <div className="jo-confirm-order-type-line">
              <i className="fas fa-file-alt"></i>
              <div>
                <div className="jo-confirm-strip-title">{orderType === "service" ? "Service Order" : "New Job Order"}</div>
                <div className="jo-confirm-strip-subtitle">
                  {[vehicleData?.make, vehicleData?.model].filter(Boolean).join(" ")} {plate ? `• ${plate}` : ""}
                </div>
              </div>
            </div>
          </div>
          <button className="btn btn-secondary jo-confirm-change-type-btn" onClick={onBack}>
            <i className="fas fa-exchange-alt"></i> Change Selection
          </button>
        </div>

        {/* Customer */}
        <section className="jo-confirm-section">
          <h3>
            <i className="fas fa-user"></i> Customer Information
          </h3>
          <div className="jo-confirm-grid">
            <div className="jo-confirm-item">
              <span>Customer ID</span>
              <strong>{formatCustomerDisplayId(customerData?.id)}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Customer Name</span>
              <strong>{customerData?.name || "N/A"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Mobile Number</span>
              <strong>{customerMobile}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Email Address</span>
              <strong>{customerData?.email || "Not provided"}</strong>
            </div>
            <div className="jo-confirm-item jo-confirm-item-wide">
              <span>Home Address</span>
              <strong>{customerData?.address || "Not provided"}</strong>
            </div>
            {heardFrom && (
              <div className="jo-confirm-item">
                <span>Heard of us from</span>
                <strong>{heardFrom}</strong>
              </div>
            )}
            {heardFrom === "refer_person" && (
              <>
                <div className="jo-confirm-item">
                  <span>Referred Person Name</span>
                  <strong>{customerData?.referralPersonName || "Not provided"}</strong>
                </div>
                <div className="jo-confirm-item">
                  <span>Referred Person Mobile</span>
                  <strong>{customerData?.referralPersonMobile || "Not provided"}</strong>
                </div>
              </>
            )}
            {heardFrom === "social_media" && (
              <div className="jo-confirm-item">
                <span>Social Platform</span>
                <strong>{customerData?.socialPlatform || "Not provided"}</strong>
              </div>
            )}
            {heardFrom === "other" && (
              <div className="jo-confirm-item jo-confirm-item-wide">
                <span>Other Note</span>
                <strong>{customerData?.heardFromOtherNote || "Not provided"}</strong>
              </div>
            )}
            <div className="jo-confirm-item">
              <span>Registered Vehicles</span>
              <strong>{customerData?.vehicles?.length ?? customerData?.registeredVehiclesCount ?? 0}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Completed Services</span>
              <strong>{customerData?.completedServicesCount ?? 0}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Customer Since</span>
              <strong>{customerData?.customerSince || "N/A"}</strong>
            </div>
          </div>
        </section>

        {/* Vehicle */}
        <section className="jo-confirm-section">
          <h3>
            <i className="fas fa-car"></i> Vehicle Information
          </h3>
          <div className="jo-confirm-grid">
            <div className="jo-confirm-item">
              <span>Vehicle ID</span>
              <strong>{vehicleId}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Owned By</span>
              <strong>{customerData?.name || "N/A"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Make</span>
              <strong>{vehicleData?.make || vehicleData?.factory || "N/A"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Model</span>
              <strong>{vehicleData?.model || "N/A"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Year</span>
              <strong>{vehicleData?.year || "N/A"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Color</span>
              <strong>{vehicleData?.color || "N/A"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Plate Number</span>
              <strong>{plate}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>VIN</span>
              <strong>{vin}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>Vehicle Type</span>
              <strong>{vehicleType}</strong>
            </div>
          </div>
        </section>

        {/* Selected services table */}
        <section className="jo-confirm-section">
          <h3>
            <i className="fas fa-clipboard-list"></i> Selected Services
          </h3>

          <div className="jo-confirm-table-wrap">
            <table className="jo-confirm-services-table">
              <thead>
                <tr>
                  <th>Service Name</th>
                  <th style={{ textAlign: "right" }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {groupServicesByPackage(selectedServices).map((group: any) => (
                  <Fragment key={group.key}>
                    {group.packageTitle && (
                      <tr>
                        <td className="jo-package-group-header-cell">
                          <span className="jo-package-group-header-content" data-no-translate="true">
                            <i className="fas fa-box-open jo-package-group-icon" aria-hidden="true"></i>
                            {group.packageTitle}
                          </span>
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 800 }}>
                          {formatPrice(group.packagePrice ?? 0)}
                        </td>
                      </tr>
                    )}
                    {group.items.map((service: any, idx: number) => (
                      <tr key={`${group.key}-${service?.serviceCode || service?.catalogId || service?.name}-${idx}`}>
                        <td data-no-translate="true">
                          <div>{getServiceDisplayName(service)}</div>
                          {getServiceSpecificationLabel(service) && (
                            <div style={{ marginTop: 8 }}>{renderServiceSpecificationBadges(service)}</div>
                          )}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>
                          {group.packageTitle ? "Included in package" : formatPrice(service.price || 0)}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {selectedServices.length === 0 && (
                  <tr>
                    <td colSpan={2} style={{ textAlign: "center", color: "#64748b" }}>
                      No services selected
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Price summary */}
        <section className="jo-confirm-section">
          <h3>
            <i className="fas fa-calculator"></i> Price Summary
          </h3>
          <div className="jo-price-summary-grid">
            <div className="jo-price-box">
              <div className="jo-price-row">
                <span>Subtotal</span>
                <strong>{formatPrice(subtotal)}</strong>
              </div>
              <div className="jo-price-row">
                <span>Discount ({Number(discountPercent.toFixed(2))}%)</span>
                <strong>- {formatPrice(discount)}</strong>
              </div>
            </div>

            <div className="jo-price-box jo-price-box-total">
              <div className="jo-price-row">
                <span>Total</span>
                <strong>{formatPrice(total)}</strong>
              </div>
            </div>
          </div>
        </section>

        {(orderNotes || expectedDeliveryDate || expectedDeliveryTime) && (
          <section className="jo-confirm-section">
            <h3>
              <i className="fas fa-info-circle"></i> Additional Information
            </h3>
            <div className="jo-confirm-grid">
              <div className="jo-confirm-item">
                <span>Expected Delivery Date</span>
                <strong>{expectedDeliveryDate || "Not specified"}</strong>
              </div>
              <div className="jo-confirm-item">
                <span>Expected Delivery Time</span>
                <strong>{expectedDeliveryTime || "Not specified"}</strong>
              </div>
              <div className="jo-confirm-item jo-confirm-item-wide">
                <span>Notes / Comments</span>
                <strong style={{ whiteSpace: "pre-wrap" }}>{orderNotes || "No notes"}</strong>
              </div>
            </div>
          </section>
        )}
      </div>

      <div className="action-buttons confirm-action-buttons">
        <button className="btn btn-secondary" onClick={onBack} disabled={isSubmitting}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <i className="fas fa-spinner fa-spin" style={{ marginRight: 8 }}></i>
              Creating...
            </>
          ) : (
            "Submit Order"
          )}
        </button>
      </div>
    </div>
  );
}

// ============================================
// SIMPLE DISPLAY CARDS
// ============================================
function JobOrderSummaryCard({ order, actorMap }: any) {
  const createdBy = resolveCreatedBy(order, actorMap);
  return (
    <UnifiedJobOrderSummaryCard
      order={order}
      identityToUsernameMap={actorMap}
      createdByOverride={createdBy}
    />
  );
}

function parseServiceDateTime(value: any): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const now = new Date();
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    }
  }

  return null;
}

function formatServiceDuration(startValue: any, endValue: any): string {
  const start = parseServiceDateTime(startValue);
  const end = parseServiceDateTime(endValue);
  if (!start || !end) return "Not started";

  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "0m";

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function resolveCompletedServiceActor(service: any): string {
  const actor = joFirst(
    service?.completedByName,
    service?.completedBy,
    service?.endedBy,
    service?.updatedByName,
    service?.updatedBy,
    service?.actionBy,
    service?.doneBy,
    service?.technicianName,
    service?.technician,
    service?.assignedTo,
    Array.isArray(service?.technicians) ? service.technicians[0] : ""
  );

  const out = toUsernameDisplay(actor);
  return out || "Not assigned";
}

function ServicesCard({ order, onAddService }: any) {
  const serviceProgress = (() => {
    const services = Array.isArray(order?.services) ? order.services : [];
    const total = services.length;
    if (!total) return order.serviceProgressInfo || {};

    const completed = services.filter((service: any) => {
      const status = String(service?.status ?? "").trim().toLowerCase();
      return status === "completed";
    }).length;

    const percent = Math.round((completed / Math.max(1, total)) * 100);
    return {
      ...(order.serviceProgressInfo || {}),
      progress: {
        percent,
        label: `${completed}/${total} completed`,
      },
    };
  })();
  
  return (
    <div className="pim-detail-card" style={{ gridColumn: 'span 12' }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 12px 0' }}>
            <i className="fas fa-tasks"></i> Services Summary ({order.services?.length || 0})
          </h3>
          {/* ✅ NEW: Service Progress Bar */}
          {serviceProgress.progress && (
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <div style={{ flex: 1, minHeight: '8px' }}>
                <div className="epm-progress-bar" style={{ height: '8px' }}>
                  <div 
                    className="epm-progress-fill" 
                    style={{ width: `${serviceProgress.progress.percent}%`, height: '100%' }}
                  ></div>
                </div>
              </div>
              <span className="epm-progress-text" style={{ fontSize: '12px', color: '#666' }}>
                {serviceProgress.progress.label}
              </span>
            </div>
          )}
        </div>
        <PermissionGate moduleId="joborder" optionId="joborder_addservice">
          <button className="btn-add-service" onClick={onAddService} style={{ padding: "8px 16px", fontSize: "14px" }}>
            <i className="fas fa-plus-circle"></i> Add Service
          </button>
        </PermissionGate>
      </div>

      <div className="pim-services-list">
        {order.services && order.services.length > 0 ? (
          groupServicesByPackage(order.services).map((group: any) => (
            <Fragment key={group.key}>
              {group.packageTitle && (
                <div className="jo-package-group-header-block">
                  <div className="jo-package-group-header-content" data-no-translate="true" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                    <span>
                      <i className="fas fa-box-open jo-package-group-icon" aria-hidden="true"></i>
                      {group.packageTitle}
                    </span>
                    <span style={{ fontWeight: 800 }}>{`QAR ${(group.packagePrice ?? 0).toLocaleString()}`}</span>
                  </div>
                </div>
              )}
              {group.items.map((service: any, idx: number) => (
                <div key={`${group.key}-${idx}`} className="pim-service-item">
                  <div className="pim-service-header">
                    <span className="pim-service-name" data-no-translate="true">{getServiceDisplayName(service)}</span>
                    <span className="pim-service-price">
                      {group.packageTitle ? "Included in package" : service.price ? `QAR ${service.price.toLocaleString()}` : "N/A"}
                    </span>
                  </div>
                  <div className="pim-service-meta">
                    {getServiceSpecificationLabel(service) && (
                      <div className="pim-service-meta-row" style={{ gridColumn: 'span 2' }}>
                        <span className="pim-service-meta-label">Specification:</span>
                        <div className="pim-service-meta-value">{renderServiceSpecificationBadges(service)}</div>
                      </div>
                    )}
                    <div className="pim-service-meta-row">
                      <span className="pim-service-meta-label">Status:</span>
                      <span className="pim-service-meta-value">{service.status || 'N/A'}</span>
                    </div>
                    <div className="pim-service-meta-row">
                      <span className="pim-service-meta-label">Technician:</span>
                      <span className="pim-service-meta-value">{resolveCompletedServiceActor(service)}</span>
                    </div>
                    {service.started && (
                      <div className="pim-service-meta-row">
                        <span className="pim-service-meta-label">Started:</span>
                        <span className="pim-service-meta-value">{service.started}</span>
                      </div>
                    )}
                    {service.ended && (
                      <div className="pim-service-meta-row">
                        <span className="pim-service-meta-label">Ended:</span>
                        <span className="pim-service-meta-value">{service.ended}</span>
                      </div>
                    )}
                    <div className="pim-service-meta-row">
                      <span className="pim-service-meta-label">Duration:</span>
                      <span className="pim-service-meta-value">{formatServiceDuration(service.started, service.ended)}</span>
                    </div>
                    {service.notes && (
                      <div className="pim-service-meta-row" style={{ gridColumn: 'span 2' }}>
                        <span className="pim-service-meta-label">Notes:</span>
                        <span className="pim-service-meta-value">{service.notes}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </Fragment>
          ))
        ) : (
          <div className="empty-state" style={{ padding: "30px", margin: '0' }}>
            <div className="empty-icon">
              <i className="fas fa-clipboard-list"></i>
            </div>
            <div className="empty-text">No services added yet</div>
            <div className="empty-subtext">Click "Add Service" to add services to this job order</div>
          </div>
        )}
      </div>
    </div>
  );
}

function BillingCard({ order }: any) {
  return <UnifiedBillingInvoicesSection order={order} className="epm-detail-card" style={{ gridColumn: "span 12" }} />;
}

type DocUi = {
  id?: string;
  name?: string;
  type?: string;
  category?: string;
  addedAt?: string;
  uploadedBy?: string;
  storagePath?: string; // e.g. "job-orders/....pdf"
  url?: string;         // full url or fallback
  paymentReference?: string;
  billReference?: string;
};

function JobOrderDocumentsCard({ order }: any) {
  const docs: DocUi[] = Array.isArray(order?.documents) ? order.documents : [];

  const docGeneratedAt = (doc: DocUi) =>
    String(
      doc?.addedAt ??
        (doc as any)?.generatedAt ??
        (doc as any)?.createdAt ??
        (doc as any)?.uploadedAt ??
        (doc as any)?.timestamp ??
        ""
    ).trim();

  const downloadDocument = async (raw: string) => {
    const linkUrl = await resolveMaybeStorageUrl(raw);
    if (!linkUrl) return;
    window.open(linkUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="pim-detail-card jo-docs-card">
      <h3 className="jo-docs-title">
        <span className="jo-docs-title-left">
          <i className="fas fa-folder-open"></i> Documents ({docs.length})
        </span>
      </h3>

      <div className="pim-card-content jo-docs-content">
        {docs.length ? (
          <div className="jo-docs-list">
            {docs.map((d, idx) => {
              const name = String(d?.name ?? "").trim() || `Document ${idx + 1}`;
              const raw = String(d?.storagePath || d?.url || "").trim();
              const generatedAt = docGeneratedAt(d);
              const meta = [d?.type, d?.category, d?.paymentReference, generatedAt ? `Generated: ${generatedAt}` : ""]
                .filter(Boolean)
                .join(" • ");

              return (
                <div key={d?.id ?? `${name}-${idx}`} className="jo-doc-row">
                  <div className="jo-doc-left">
                    <div className="jo-doc-name">{name}</div>
                    <div className="jo-doc-meta">{meta || "—"}</div>
                  </div>

                  <div className="jo-doc-actions">
                    <PermissionGate moduleId="joborder" optionId="joborder_download">
                      <button
                        type="button"
                        className="btn btn-primary jo-doc-btn"
                        disabled={!raw}
                        onClick={async () => {
                          await downloadDocument(raw);
                        }}
                        title={!raw ? "No file path/url available" : "Download"}
                      >
                        <i className="fas fa-download" /> Download
                      </button>
                    </PermissionGate>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="jo-doc-empty">No documents available.</div>
        )}
      </div>
    </div>
  );
}
// ============================================
// ✅ NEW: QUALITY CHECK CARD
// ============================================
function QualityCheckCard({ order }: any) {
  const services = Array.isArray(order?.services) ? order.services : [];

  const getServiceQcResult = (service: any) => {
    if (!service || typeof service !== "object") return "";
    return joFirst(
      service.qualityCheckResult,
      service.qcResult,
      service.qcStatus,
      service.qualityStatus,
      service.qualityCheckStatus
    );
  };

  const normalizeQcResult = (raw: any): { label: string; className: string } => {
    const normalized = String(raw ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");

    if (normalized === "pass" || normalized === "passed") {
      return { label: "Pass", className: "pass" };
    }
    if (normalized === "failed" || normalized === "fail") {
      return { label: "Failed", className: "failed" };
    }
    if (normalized === "acceptable") {
      return { label: "Acceptable", className: "acceptable" };
    }

    if (!normalized || normalized === "not-evaluated" || normalized === "n-a" || normalized === "na" || normalized === "pending") {
      return { label: "Not Evaluated", className: "not-evaluated" };
    }

    return {
      label: String(raw ?? "Not Evaluated").trim() || "Not Evaluated",
      className: "not-evaluated",
    };
  };

  return (
    <div className="pim-detail-card jo-qc-card">
      <h3 className="jo-qc-heading">
        <span className="jo-qc-title-dot" aria-hidden="true"></span>
        Quality Check List
      </h3>
      <div className="jo-qc-list">
        {services.length > 0 ? (
          services.map((service: any, idx: number) => {
            const serviceName = typeof service === "string" ? service : joFirst(service?.name, `Service ${idx + 1}`);
            const qc = normalizeQcResult(getServiceQcResult(service));

            return (
              <div key={`${serviceName}-${idx}`} className="jo-qc-row">
                <span className="jo-qc-name">{serviceName}</span>
                <span className={`jo-qc-badge jo-qc-${qc.className}`}>{qc.label}</span>
              </div>
            );
          })
        ) : (
          <div className="jo-qc-empty">No services to evaluate</div>
        )}
      </div>
    </div>
  );
}

// ============================================
// ✅ NEW: DELIVERY TRACKING CARD
// ============================================
function DeliveryTrackingCard({ order }: any) {
  const delivery = order.deliveryInfo || {};
  
  if (!delivery.expected && !delivery.actual && !delivery.estimatedHours && !delivery.actualHours) return null;

  const deliveryItems = [
    {
      key: "expected-date",
      label: "Expected Date",
      value: delivery.expectedDate || "Not set",
      icon: "fas fa-calendar-day",
    },
    {
      key: "expected-time",
      label: "Expected Time",
      value: delivery.expectedTime || "Not set",
      icon: "fas fa-clock",
    },
    {
      key: "estimated-duration",
      label: "Estimated Duration",
      value: delivery.estimatedHours || "Not set",
      icon: "fas fa-hourglass-half",
    },
  ];

  return (
    <div className="pim-detail-card jo-delivery-card">
      <h3>
        <i className="fas fa-truck"></i> Delivery & Time Tracking
      </h3>
      <div className="jo-delivery-grid" role="list" aria-label="Delivery and time tracking details">
        {deliveryItems.map((item) => (
          <div key={item.key} className="jo-delivery-tile" role="listitem">
            <div className="jo-delivery-tile-head">
              <i className={item.icon}></i>
              <span>{item.label}</span>
            </div>
            <div className="jo-delivery-tile-value">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// ROADMAP CARD - Timeline Visualization
// ============================================
function RoadmapCard({ order, actorMap }: any) {
  if (!order.roadmap || order.roadmap.length === 0) return null;

  const roadmap = Array.isArray(order?.roadmap) ? order.roadmap : [];
  const normalizeStepName = (name: any) => String(name ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const normalizedWorkStatus = normalizeStepName(order?.workStatus ?? order?.workStatusLabel);
  const progressedToInspectionOrBeyond = new Set([
    "inspection",
    "inprogress",
    "serviceoperation",
    "qualitycheck",
    "ready",
    "completed",
    "cancelled",
  ]).has(normalizedWorkStatus);

  const findStep = (name: string) => roadmap.find((s: any) => normalizeStepName(s?.step) === normalizeStepName(name));
  const findStartedAt = (s: any) => joFirst(s?.startTimestamp, s?.startedAt, s?.startTime, s?.started);
  const findCompletedAt = (s: any) => joFirst(s?.endTimestamp, s?.completedAt, s?.endTime, s?.ended);

  const newRequestStep = findStep("New Request");
  const inspectionStep = findStep("Inspection");
  const newRequestCompletedRaw = findCompletedAt(newRequestStep);
  const inspectionStartedRaw = findStartedAt(inspectionStep);

  const inspectionIndex = roadmap.findIndex((s: any) => normalizeStepName(s?.step) === "inspection");
  const firstLaterStartedAt =
    inspectionIndex >= 0
      ? roadmap.slice(inspectionIndex + 1).map((s: any) => findStartedAt(s)).find((v: string) => !!joStr(v))
      : "";

  const inferredInspectionStartedAt =
    inspectionStartedRaw ||
    newRequestCompletedRaw ||
    firstLaterStartedAt ||
    (progressedToInspectionOrBeyond ? joFirst(order?.updatedAt, order?.lastUpdatedAt) : "");

  const getStepIcon = (stepName: string) => {
    const iconMap: any = {
      "New Request": "fa-plus-circle",
      Inspection: "fa-search",
      Service_Operation: "fa-cogs",
      Inprogress: "fa-cogs",
      "Quality Check": "fa-check-double",
      Ready: "fa-flag-checkered",
      Completed: "fa-check-circle",
      Cancelled: "fa-ban",
    };
    return iconMap[stepName] || "fa-circle";
  };

  const getStepClass = (status: string) => {
    const s = String(status || "").toLowerCase();
    if (s === "inprogress" || s === "active") return "active";
    if (s === "completed") return "completed";
    return "pending";
  };
  

  // ✅ FIX: better actor resolution to avoid wrong field

  const getStatusLabel = (step: any) => step?.stepStatus || step?.status || "Pending";

  return (
    <div className="pim-roadmap-container jo-roadmap-compact">
      <div className="pim-roadmap-title">
        <i className="fas fa-route"></i>
        Job Order Roadmap
      </div>

      <div className="jo-roadmap-list">
        {roadmap.map((step: any, idx: number) => {
          const actorFromStep = resolveRoadmapActor(step, order, actorMap);
          const stepName = normalizeStepName(step?.step);
          const stepLabel = stepName === "inprogress" || stepName === "serviceoperation" ? "Service_Operation" : step?.step;
          const nextStep = roadmap[idx + 1];
          const stepStartedAt = findStartedAt(step);
          const stepCompletedAt = findCompletedAt(step);
          const normalizedStepStatus = normalizeStepName(step?.stepStatus || step?.status);

          const inferredStartedAt =
            stepName === "inspection"
              ? stepStartedAt || inferredInspectionStartedAt
              : stepStartedAt;

          const inferredCompletedAt =
            stepName === "newrequest"
              ? stepCompletedAt || inferredInspectionStartedAt || findStartedAt(nextStep)
              : stepCompletedAt;

          const stepHasProgress =
            !!joStr(inferredStartedAt) ||
            !!joStr(inferredCompletedAt) ||
            normalizedStepStatus === "active" ||
            normalizedStepStatus === "inprogress" ||
            normalizedStepStatus === "completed";

          const fallbackActor = joFirst(step?.updatedByName, step?.updatedBy, order?.updatedByName, order?.updatedBy);
          const actor = stepHasProgress
            ? actorFromStep || resolveActorDisplay(fallbackActor, { identityToUsernameMap: actorMap, fallback: "" })
            : "";
          const completedLabel = inferredCompletedAt || "Not completed";

          const stepClass = getStepClass(step?.stepStatus || step?.status);

          return (
            <div key={idx} className={`jo-roadmap-row ${stepClass}`}>
              <div className="jo-roadmap-row-stage">
                <div className={`jo-roadmap-icon ${stepClass}`}>
                  <i className={`fas ${getStepIcon(step.step)}`}></i>
                </div>
                <div>
                  <div className="jo-roadmap-stage-title">{stepLabel}</div>
                  <div className={`jo-roadmap-status-chip ${stepClass}`}>{getStatusLabel(step)}</div>
                </div>
              </div>

              <div className="jo-roadmap-row-meta">
                <div className="jo-roadmap-meta-block">
                  <span>Started</span>
                  <strong>{inferredStartedAt || "Not started"}</strong>
                </div>
                <div className="jo-roadmap-meta-block">
                  <span>Completed</span>
                  <strong>{completedLabel}</strong>
                </div>
                <div className="jo-roadmap-meta-block">
                  <span>Action done by</span>
                  <strong>{actor}</strong>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// ORDER TYPE SCREENS
// ============================================
function OrderTypeSelection({ vehicleCompletedServices, onSelectOrderType, onBack, orderType }: any) {
  return (
    <div className="form-card">
      <div className="form-card-title">
        <i className="fas fa-list-check"></i>
        <h2>Select Order Type</h2>
      </div>
      <div className="form-card-content">
        <p style={{ marginBottom: "20px", color: "#666", fontSize: "14px" }}>
          This vehicle has {vehicleCompletedServices.length} completed service(s). Choose the type of order you want to create:
        </p>

        <div className="option-selector">
          <div className={`option-btn ${orderType === "new" ? "selected" : ""}`} onClick={() => onSelectOrderType("new")}>
            <i className="fas fa-file-alt" style={{ marginRight: "8px" }}></i>
            New Job Order
          </div>
          <div className={`option-btn ${orderType === "service" ? "selected" : ""}`} onClick={() => onSelectOrderType("service")}>
            <i className="fas fa-tools" style={{ marginRight: "8px" }}></i>
            Service Order
          </div>
        </div>
      </div>

      <div className="action-buttons">
        <button className="btn btn-secondary" onClick={onBack}>
          <i className="fas fa-arrow-left" style={{ marginRight: "8px" }}></i>
          Back
        </button>
      </div>
    </div>
  );
}

function NoCompletedServicesMessage({ onNext, onBack }: any) {
  return (
    <div className="form-card">
      <div className="form-card-title">
        <i className="fas fa-info-circle"></i>
        <h2>Order Type</h2>
      </div>
      <div className="form-card-content">
        <div style={{ marginBottom: "20px", padding: "15px", backgroundColor: "#fff3cd", borderRadius: "8px", border: "1px solid #ffc107" }}>
          <i className="fas fa-exclamation-circle" style={{ color: "#ff9800", marginRight: "8px" }}></i>
          <span style={{ color: "#ff9800", fontWeight: "500" }}>
            This vehicle has no completed services yet. Proceeding with New Job Order.
          </span>
        </div>
      </div>

      <div className="action-buttons">
        <button className="btn btn-secondary" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onNext}>
          Continue
        </button>
      </div>
    </div>
  );
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function getWorkStatusClass(status: any) {
  const statusMap: any = {
    "New Request": "status-new-request",
    Inspection: "status-inspection",
    Service_Operation: "status-inprogress",
    Inprogress: "status-inprogress",
    "Quality Check": "status-quality-check",
    Ready: "status-ready",
    Completed: "status-completed",
    Cancelled: "status-cancelled",
  };
  return statusMap[status] || "status-inprogress";
}

function displayWorkStatusLabel(status: any) {
  const raw = String(status ?? "").trim();
  const compact = raw.toLowerCase().replace(/[\s_]+/g, "");
  if (compact === "inprogress" || compact === "serviceoperation") return "Service_Operation";
  return raw;
}

function getPaymentStatusClass(status: any) {
  const normalized = normalizePaymentStatusLabel(status);
  if (normalized === "Fully Paid") return "payment-full";
  if (normalized === "Partially Paid") return "payment-partial";
  return "payment-unpaid";
}

function normalizePaymentStatusLabel(status: any) {
  return normalizePaymentStatusLabelShared(status);
}

export default JobOrderManagement;