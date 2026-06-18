// src/pages/JobCards.tsx
// Full updated file - paste as-is

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import "./JobCards.css";
import { getUrl } from "aws-amplify/storage";
import { normalizeActorIdentity, resolveActorDisplay, resolveActorUsername } from "../utils/actorIdentity";
import { getUserDirectory } from "../utils/userDirectoryCache";
import { getDataClient } from "../lib/amplifyClient";
import { matchesSearchQuery } from "../lib/searchUtils";
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
  computeCumulativeDiscountAllowance,
  resolveCentralDiscountPercent,
  toCurrencyNumber,
} from "../utils/discountPolicy";
import {
  getPackageGroupKey as getSharedPackageGroupKey,
  summarizeServicesSubtotalPackageAware,
} from "../utils/billingFinance";
import { UnifiedJobOrderSummaryCard } from "../components/UnifiedJobOrderSummaryCard";
import UnifiedBillingInvoicesSection from "../components/UnifiedBillingInvoicesSection";
import { UnifiedJobSummaryCard } from "../components/UnifiedJobSummaryCard";
import { UnifiedCustomerDetailsCard } from "../components/UnifiedCustomerDetailsCard";
import { UnifiedVehicleInformationCard } from "../components/UnifiedVehicleInformationCard";
import { UnifiedRequestedServicesCard } from "../components/UnifiedRequestedServicesCard";
import { UnifiedBillingInvoicesCard } from "../components/UnifiedBillingInvoicesCard";
import { UnifiedDocumentsCard } from "../components/UnifiedDocumentsCard";
import { UnifiedQualityChecklistCard } from "../components/UnifiedQualityChecklistCard";
import { UnifiedDeliveryTimeTrackingCard } from "../components/UnifiedDeliveryTimeTrackingCard";
import { useGlobalLoading } from "../utils/GlobalLoadingContext";
import { UnifiedJobOrderRoadmapCard } from "../components/UnifiedJobOrderRoadmapCard";
import { filterVisibleDocuments } from "../utils/documentVisibility";

function errMsg(e: unknown) {
  const anyE = e as any;
  return String(anyE?.message ?? anyE?.errors?.[0]?.message ?? anyE ?? "Unknown error");
}

async function resolveMaybeStorageUrl(urlOrPath: string): Promise<string> {
  const v = String(urlOrPath || "").trim();
  if (!v) return "";

  // Your storage resource uses "job-orders/*"
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
    fallback: "-",
  });
}

function joIsPlaceholderName(s: string) {
  const t = joStr(s).toLowerCase();
  return (
    !t ||
    t === "-" ||
    t === "--" ||
    t === "-" ||
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
  const { t } = useLanguage();
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
          <h3><i className="fas fa-palette"></i> {t("Service Specification")}</h3>
          <button onClick={onClose}>x</button>
        </div>
        <div className="sc2-modal-body">
          <div className="sc2-grid-1">
            <label>
              <span>{t("Service")}</span>
              <input value={getServiceDisplayName(product)} readOnly />
            </label>
          </div>

          <div className="sc2-grid-2" style={{ marginTop: 16 }}>
            <label>
              <span>{t("Brand")} *</span>
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
              <span>{t("Product")} *</span>
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
              <span>{t("Measurement")} *</span>
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
              {selectedProduct && <div className="sc2-empty">{t("Selected product")}: {selectedProduct.name}</div>}
              {measurement && <div className="sc2-empty">{t("Selected measurement")}: {measurement}</div>}
            </div>
          )}
        </div>
        <div className="sc2-modal-actions">
          <button className="sc2-btn ghost" onClick={onClose}>{t("Cancel")}</button>
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
            {t("Apply Specification")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Best creator name for the order (handles different payload shapes) */
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
    return alt && !joIsPlaceholderName(alt) ? toUsernameDisplay(alt, identityMap) : toUsernameDisplay(primary || "-", identityMap);
  }

  return toUsernameDisplay(primary || "-", identityMap);
}

/** Roadmap actor should represent who performed the step (NOT assignment) */
function resolveRoadmapActor(step: any, order: any, identityMap?: Record<string, string>) {
  const stepName = joStr(step?.step).toLowerCase();
  const isNewRequestStep = stepName === "new request" || stepName === "newrequest";

  const actor = joFirstPreferredActor(
    // action performer fields first
    step?.actionByName,
    step?.actionBy,
    step?.performedBy,
    step?.doneBy,
    step?.updatedByName,
    step?.updatedBy,
    step?.createdByName,
    step?.createdBy,

    // only then allow technician fields (some steps may use it as performer)
    step?.technicianName,
    step?.technician,

    // New Request fallback to createdBy
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
  const { t } = useLanguage();
  const { showLoading, hideLoading, withLoading } = useGlobalLoading();
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

  // Success popup state
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [submittedOrderId, setSubmittedOrderId] = useState("");
  const [lastCreatedOrderSnapshot, setLastCreatedOrderSnapshot] = useState<any>(null);
  const [lastAction, setLastAction] = useState<"create" | "cancel" | "addService">("create");
  const [showAddServiceSuccessPopup, setShowAddServiceSuccessPopup] = useState(false);
  const [addServiceSuccessData, setAddServiceSuccessData] = useState({ orderId: "", invoiceId: "" });
  const [serviceCatalog, setServiceCatalog] = useState<ServiceCatalogItem[]>([]);

  // Error popup state
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorTitle, setErrorTitle] = useState("Operation failed");
  const [errorMessage, setErrorMessage] = useState<React.ReactNode>(null);
  const [errorDetails, setErrorDetails] = useState<string | undefined>(undefined);
  const [errorRetry, setErrorRetry] = useState<(() => void) | undefined>(undefined);
  const [actorIdentityMap, setActorIdentityMap] = useState<Record<string, string>>({});
  const detailsViewCacheRef = useRef<Map<string, any>>(new Map());

  const buildReceiptDocument = async (order: any, fallbackJobId?: string) => {
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = 210;
      const pageH = 297;
      const marginX = 12;
      const pagePadTop = 5;
      const pagePadBottom = 5;
      const contentW = pageW - marginX * 2;
      const BILL_TITLE_FONT_SIZE = 8.6;
      const BILL_BODY_FONT_SIZE = 7.1;

      const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
      const dash = (value: unknown) => text(value) || "-";
      const fmtMoney = (value: unknown) => `QAR ${toCurrencyNumber(value).toFixed(2)}`;
      const cleanFileToken = (value: string) => String(value || "job-order-receipt").replace(/[^a-zA-Z0-9_-]/g, "_");
      const containsArabic = (value: string) => /[\u0600-\u06FF]/.test(String(value ?? ""));
      const formatDateOnly = (raw: unknown) => {
        const value = text(raw);
        if (!value) return "-";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;
        return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      };
      const formatDateTime = (raw: unknown) => {
        const value = text(raw);
        if (!value) return "-";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;
        return d.toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      };

      const jobId = dash(order?.id ?? fallbackJobId);
      const createdAt = order?.createdAt || order?.jobOrderSummary?.createDate || order?.createDate;
      const createdAtDisplay = formatDateTime(createdAt);
      const expectedDelivery = [
        text(order?.expectedDeliveryDate),
        text(order?.expectedDeliveryTime),
      ].filter(Boolean).join(" ") || text(order?.jobOrderSummary?.expectedDelivery);
      const createdBy = dash(
        order?.createdByName ||
        resolveActorDisplay(order?.createdBy, {
          fallback: order?.createdBy || "System",
          identityToUsernameMap: actorIdentityMap,
        }) ||
        order?.createdBy
      );
      const billing = order?.billing ?? {};
      const totalAmount = toCurrencyNumber(billing.totalAmount ?? order?.totalAmount);
      const discount = toCurrencyNumber(billing.discount ?? order?.discountAmount ?? order?.discount);
      const netAmount = toCurrencyNumber(billing.netAmount ?? order?.netAmount ?? Math.max(0, totalAmount - discount));
      const amountPaid = toCurrencyNumber(billing.amountPaid ?? order?.amountPaid);
      const balanceDue = toCurrencyNumber(billing.balanceDue ?? order?.balanceDue ?? Math.max(0, netAmount - amountPaid));
      const services = Array.isArray(order?.services)
        ? order.services
        : Array.isArray(order?.selectedServices)
          ? order.selectedServices
          : [];

      const logoDataUrl = await (async () => {
        try {
          const logoRes = await fetch("/vite.png");
          if (!logoRes.ok) return "";
          const blob = await logoRes.blob();
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Failed to read logo"));
            reader.readAsDataURL(blob);
          });
        } catch {
          return "";
        }
      })();

      const roundedLogoDataUrl = await (async () => {
        if (!logoDataUrl || typeof document === "undefined") return logoDataUrl;
        try {
          const sourceImg = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = logoDataUrl;
          });

          const side = Math.max(1, Math.min(sourceImg.naturalWidth || 256, sourceImg.naturalHeight || 256));
          const sx = Math.max(0, Math.floor(((sourceImg.naturalWidth || side) - side) / 2));
          const sy = Math.max(0, Math.floor(((sourceImg.naturalHeight || side) - side) / 2));
          const canvas = document.createElement("canvas");
          canvas.width = side;
          canvas.height = side;
          const ctx = canvas.getContext("2d");
          if (!ctx) return logoDataUrl;
          ctx.clearRect(0, 0, side, side);
          ctx.save();
          ctx.beginPath();
          ctx.arc(side / 2, side / 2, side / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(sourceImg, sx, sy, side, side, 0, 0, side, side);
          ctx.restore();
          return canvas.toDataURL("image/png");
        } catch {
          return logoDataUrl;
        }
      })();

      const qrPayload = [
        `Receipt: ${jobId}`,
        `Bill: ${dash(billing.billId)}`,
        `Customer: ${dash(order?.customerName)}`,
        `Vehicle: ${dash(order?.vehiclePlate || order?.vehicleDetails?.plateNumber)}`,
        `Net: ${netAmount.toFixed(2)}`,
        `Due: ${balanceDue.toFixed(2)}`,
        `Created: ${createdAtDisplay}`,
      ].join(" | ");

      const qrDataUrl = await QRCode.toDataURL(qrPayload, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 240,
      });

      const drawArabicLine = (
        value: string,
        xRightMm: number,
        yTopMm: number,
        maxWidthMm: number,
        fontPx: number,
        style: "normal" | "italic" | "bold" | "bolditalic",
        colorHex = "#181818",
      ) => {
        const safeValue = dash(value);
        if (typeof document === "undefined") {
          doc.setFont("helvetica", style === "bolditalic" || style === "bold" ? "bold" : "normal");
          doc.setFontSize(fontPx);
          doc.text(safeValue, xRightMm, yTopMm + 3.4, { align: "right" });
          return;
        }

        const pxPerMm = 96 / 25.4;
        const scale = 2;
        const arabicVisualScale = 1.14;
        const lineH = Math.max(4.4, fontPx * 0.52);
        const widthPx = Math.max(1, Math.ceil(maxWidthMm * pxPerMm * scale));
        const heightPx = Math.max(1, Math.ceil(lineH * pxPerMm * scale));
        const canvas = document.createElement("canvas");
        canvas.width = widthPx;
        canvas.height = heightPx;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          doc.setFont("helvetica", style === "bolditalic" || style === "bold" ? "bold" : "normal");
          doc.setFontSize(fontPx);
          doc.text(safeValue, xRightMm, yTopMm + 3.4, { align: "right" });
          return;
        }

        const fontWeight = style.includes("bold") ? "700" : "400";
        const fontStyle = style.includes("italic") ? "italic" : "normal";
        ctx.clearRect(0, 0, widthPx, heightPx);
        ctx.fillStyle = colorHex;
        ctx.direction = "rtl";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.font = `${fontStyle} ${fontWeight} ${Math.round(fontPx * arabicVisualScale * scale)}px Tahoma, Arial, "Segoe UI", sans-serif`;
        ctx.fillText(safeValue, widthPx - 2, heightPx / 2 + 0.5);

        doc.addImage(canvas.toDataURL("image/png"), "PNG", xRightMm - maxWidthMm, yTopMm, maxWidthMm, lineH);
      };

      const splitArabicTextToLines = (
        value: string,
        maxWidthMm: number,
        fontPx: number,
        style: "normal" | "italic" | "bold" | "bolditalic",
      ) => {
        const normalized = text(value);
        if (!normalized) return [""];

        const words = normalized.split(/\s+/).filter(Boolean);
        if (!words.length) return [normalized];

        if (typeof document === "undefined") {
          const approxCharsPerLine = Math.max(12, Math.floor(maxWidthMm * 2.2));
          const lines: string[] = [];
          let current = "";
          for (const word of words) {
            const candidate = current ? `${current} ${word}` : word;
            if (candidate.length <= approxCharsPerLine) current = candidate;
            else {
              if (current) lines.push(current);
              current = word;
            }
          }
          if (current) lines.push(current);
          return lines;
        }

        const pxPerMm = 96 / 25.4;
        const scale = 2;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return [normalized];

        const fontWeight = style.includes("bold") ? "700" : "400";
        const fontStyle = style.includes("italic") ? "italic" : "normal";
        const arabicVisualScale = 1.14;
        ctx.font = `${fontStyle} ${fontWeight} ${Math.round(fontPx * arabicVisualScale * scale)}px Tahoma, Arial, "Segoe UI", sans-serif`;

        const maxWidthPx = Math.max(1, maxWidthMm * pxPerMm * scale);
        const lines: string[] = [];
        let current = "";

        for (const word of words) {
          const candidate = current ? `${current} ${word}` : word;
          if (ctx.measureText(candidate).width <= maxWidthPx) current = candidate;
          else {
            if (current) lines.push(current);
            current = word;
          }
        }

        if (current) lines.push(current);
        return lines.length ? lines : [normalized];
      };

      const drawSmartPdfLine = (
        value: string,
        xLeftMm: number,
        baselineYMm: number,
        maxWidthMm: number,
        style: "normal" | "italic" | "bold" | "bolditalic" = "normal",
        colorHex = "#111827"
      ) => {
        const safeValue = dash(value);
        if (containsArabic(safeValue)) {
          drawArabicLine(safeValue, xLeftMm + maxWidthMm, baselineYMm - 3.4, maxWidthMm, BILL_BODY_FONT_SIZE, style, colorHex);
          return;
        }

        doc.setFont("helvetica", style === "bolditalic" || style === "bold" ? "bold" : "normal");
        doc.setFontSize(BILL_BODY_FONT_SIZE);
        doc.setTextColor(colorHex);
        const clipped = doc.splitTextToSize(safeValue, maxWidthMm) as string[];
        doc.text(String(clipped[0] || "-"), xLeftMm, baselineYMm);
      };

      const clipText = (value: string, maxWidth: number) => {
        const safeValue = dash(value);
        if (containsArabic(safeValue)) return safeValue;
        if (doc.getTextWidth(safeValue) <= maxWidth) return safeValue;
        let out = safeValue;
        while (out.length > 1 && doc.getTextWidth(`${out}...`) > maxWidth) out = out.slice(0, -1);
        return `${out}...`;
      };

      const mmPerPx = 25.4 / 96;
      const gridGap = 14 * mmPerPx;
      const headerLogoW = 58 * mmPerPx;
      const headerLogoH = 58 * mmPerPx;
      const footerQrSize = 42 * mmPerPx;

      const sideColW = (contentW - headerLogoW - gridGap * 2) / 2;
      const leftColX = marginX;
      const centerColX = leftColX + sideColW + gridGap;
      const rightColRightX = pageW - marginX;

      const footerSideColW = (contentW - footerQrSize - gridGap * 2) / 2;
      const footerLeftColX = marginX;
      const footerCenterColX = footerLeftColX + footerSideColW + gridGap;
      const footerRightColRightX = pageW - marginX;

      const headerPadY = 1.4;
      const headerContentTop = pagePadTop + headerPadY;
      const headerBottom = pagePadTop + headerPadY * 2 + headerLogoH + 0.8;

      const footerPadTop = 2;
      const footerBasePadY = 1.5;
      const footerTop = pageH - pagePadBottom - (footerPadTop + footerBasePadY + footerQrSize + 4.8);
      const footerContentTop = footerTop + footerPadTop;
      const pageContentBottom = footerTop - 4;
      const footerLineH = Math.max(3.6, BILL_BODY_FONT_SIZE * 0.42);

      const drawLetterhead = () => {
        doc.setDrawColor(44, 62, 80);
        doc.setLineWidth(0.53);
        doc.line(marginX, headerBottom, pageW - marginX, headerBottom);
        doc.line(marginX, footerTop, pageW - marginX, footerTop);

        doc.setTextColor(24, 24, 24);
        doc.setFont("helvetica", "bolditalic");
        doc.setFontSize(BILL_TITLE_FONT_SIZE);
        doc.text("RODEO DRIVE", leftColX, headerContentTop + 4.8);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(BILL_BODY_FONT_SIZE);
        doc.text("Gloss Perfected", leftColX, headerContentTop + 8.7);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(BILL_BODY_FONT_SIZE);
        doc.text("Doha, Qatar", leftColX, headerContentTop + 12.4);

        if (roundedLogoDataUrl) {
          const headerLogoSize = Math.min(headerLogoW, headerLogoH);
          const headerLogoX = centerColX + (headerLogoW - headerLogoSize) / 2;
          const headerLogoY = headerContentTop + (headerLogoH - headerLogoSize) / 2;
          doc.addImage(roundedLogoDataUrl, "PNG", headerLogoX, headerLogoY, headerLogoSize, headerLogoSize);
        }

        drawArabicLine("روديو درايف", rightColRightX, headerContentTop + 2.6, sideColW, BILL_TITLE_FONT_SIZE, "bolditalic");
        drawArabicLine("اللمعان المثالي", rightColRightX, headerContentTop + 6.8, sideColW, BILL_BODY_FONT_SIZE, "italic");
        drawArabicLine("الدوحة، قطر", rightColRightX, headerContentTop + 11.0, sideColW, BILL_BODY_FONT_SIZE, "normal");

        doc.setTextColor(24, 24, 24);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(BILL_BODY_FONT_SIZE);
        doc.text("info@rodeodrive.qa", footerLeftColX, footerContentTop + footerLineH * 1.4);
        doc.text("www.rodeodrive.qa", footerLeftColX, footerContentTop + footerLineH * 2.5);

        doc.addImage(qrDataUrl, "PNG", footerCenterColX, footerContentTop, footerQrSize, footerQrSize);

        drawArabicLine("info@rodeodrive.qa", footerRightColRightX, footerContentTop + footerLineH * 1.4 - 2.8, footerSideColW, BILL_BODY_FONT_SIZE, "normal");
        drawArabicLine("www.rodeodrive.qa", footerRightColRightX, footerContentTop + footerLineH * 2.5 - 2.8, footerSideColW, BILL_BODY_FONT_SIZE, "normal");
      };

      const ensureSpace = (currentY: number, needed: number) => (
        currentY + needed > pageContentBottom ? currentY : currentY
      );

      const drawInfoBox = (
        x: number,
        y: number,
        w: number,
        h: number,
        title: string,
        titleAr: string,
        rows: Array<[string, string]>,
      ) => {
        doc.setFillColor(248, 250, 253);
        doc.setDrawColor(220, 226, 234);
        doc.roundedRect(x, y, w, h, 1.5, 1.5, "FD");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(BILL_TITLE_FONT_SIZE);
        doc.setTextColor(20, 31, 46);
        doc.text(title, x + 3, y + 5);
        drawArabicLine(titleAr, x + w - 3, y + 1.8, 32, BILL_TITLE_FONT_SIZE, "bolditalic");

        let rowY = y + 10.3;
        rows.forEach(([label, value]) => {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(6.2);
          doc.setTextColor(107, 114, 128);
          doc.text(label, x + 3, rowY);
          drawSmartPdfLine(value, x + 31, rowY, w - 34, "normal", "#111827");
          rowY += 3.75;
        });
      };

      const serviceRows: Array<{ label: string; amount: number | null; muted?: boolean; bold?: boolean }> = [];
      const serviceGroups = groupServicesByPackage(services);
      serviceGroups.forEach((group) => {
        if (group.packageTitle) {
          const fallbackTotal = group.items.reduce((sum, item) => sum + toCurrencyNumber(item?.price), 0);
          serviceRows.push({
            label: group.packageTitle,
            amount: group.packagePrice ?? fallbackTotal,
            bold: true,
          });
          group.items.forEach((item) => {
            const spec = getServiceSpecificationLabel(item);
            serviceRows.push({
              label: `- ${getServiceDisplayName(item)}${spec ? ` (${spec})` : ""}`,
              amount: null,
              muted: true,
            });
          });
          return;
        }

        group.items.forEach((item) => {
          const spec = getServiceSpecificationLabel(item);
          serviceRows.push({
            label: `${getServiceDisplayName(item)}${spec ? ` (${spec})` : ""}`,
            amount: toCurrencyNumber(item?.price),
          });
        });
      });

      drawLetterhead();

      let cursorY = headerBottom + 5.5;
      doc.setTextColor(20, 31, 46);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(BILL_TITLE_FONT_SIZE);
      doc.text("JOB ORDER RECEIPT", marginX, cursorY);
      drawArabicLine("إيصال أمر العمل", pageW - marginX, cursorY - 3.1, 42, BILL_TITLE_FONT_SIZE, "bolditalic");

      doc.setFont("helvetica", "normal");
      doc.setFontSize(BILL_BODY_FONT_SIZE);
      doc.text(`Receipt #: ${jobId}`, marginX, cursorY + 4.8);
      doc.text(`Date: ${formatDateOnly(createdAt)}`, marginX + 55, cursorY + 4.8);
      drawSmartPdfLine(`Created By: ${createdBy}`, marginX + 100, cursorY + 4.8, pageW - marginX - (marginX + 100));
      drawArabicLine(`رقم الإيصال: ${jobId} | التاريخ: ${formatDateOnly(createdAt)}`, pageW - marginX, cursorY + 6.9, 96, BILL_BODY_FONT_SIZE, "normal");

      doc.setDrawColor(188, 196, 206);
      doc.setLineWidth(0.3);
      doc.line(marginX, cursorY + 12.2, pageW - marginX, cursorY + 12.2);
      cursorY += 15.5;

      const infoGap = 4;
      const infoW = (contentW - infoGap) / 2;
      const infoRows = 5;
      const infoH = 10.3 + (infoRows * 3.75) + 3;
      drawInfoBox(marginX, cursorY, infoW, infoH, "CUSTOMER", "العميل", [
        ["Name", dash(order?.customerName || order?.customerDetails?.name)],
        ["Mobile", dash(order?.mobile || order?.customerMobile || order?.customerDetails?.mobile)],
        ["Customer ID", dash(order?.customerDetails?.customerId || order?.customerDetails?.id)],
        ["Email", dash(order?.customerDetails?.email)],
        ["Address", dash(order?.customerDetails?.address)],
      ]);
      drawInfoBox(marginX + infoW + infoGap, cursorY, infoW, infoH, "VEHICLE", "المركبة", [
        ["Plate", dash(order?.vehiclePlate || order?.vehicleDetails?.plateNumber)],
        ["Vehicle", dash(`${dash(order?.vehicleDetails?.make)} ${dash(order?.vehicleDetails?.model)}`.replace(/ -/g, "").replace(/- /g, ""))],
        ["Year / Type", dash([order?.vehicleDetails?.year, order?.vehicleDetails?.type].filter(Boolean).join(" / "))],
        ["Color", dash(order?.vehicleDetails?.color)],
        ["VIN", dash(order?.vehicleDetails?.vin)],
      ]);
      cursorY += infoH + 4;

      const detailsRows = 5;
      const detailsH = 10.3 + (detailsRows * 3.75) + 3;
      cursorY = ensureSpace(cursorY, detailsH + 4);
      drawInfoBox(marginX, cursorY, contentW, detailsH, "JOB ORDER DETAILS", "تفاصيل أمر العمل", [
        ["Order Type", dash(order?.orderType)],
        ["Work Status", dash(order?.workStatus)],
        ["Payment Status", dash(order?.paymentStatus)],
        ["Bill ID", dash(billing.billId)],
        ["Expected Delivery", dash(expectedDelivery)],
      ]);
      cursorY += detailsH + 12;

      const customerNote = dash(order?.customerNotes || order?.notes || order?.orderNotes);
      if (customerNote !== "-") {
        const noteLines = containsArabic(customerNote)
          ? splitArabicTextToLines(customerNote, contentW - 6, BILL_BODY_FONT_SIZE, "normal")
          : (doc.splitTextToSize(customerNote, contentW - 6) as string[]);
        const displayLines = noteLines.slice(0, 4);
        const noteH = Math.max(14, displayLines.length * 3.4 + 9);
        cursorY = ensureSpace(cursorY, noteH + 5);
        doc.setFillColor(248, 251, 255);
        doc.setDrawColor(220, 226, 234);
        doc.roundedRect(marginX, cursorY, contentW, noteH, 1.5, 1.5, "FD");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(BILL_TITLE_FONT_SIZE);
        doc.setTextColor(20, 31, 46);
        doc.text("Customer Note", marginX + 3, cursorY + 5);
        drawArabicLine("ملاحظة العميل", pageW - marginX - 3, cursorY + 1.8, 32, BILL_TITLE_FONT_SIZE, "bolditalic");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(BILL_BODY_FONT_SIZE);
        if (containsArabic(customerNote)) {
          noteLines.slice(0, 4).forEach((line, idx) => {
            drawArabicLine(line, pageW - marginX - 3, cursorY + 7.2 + idx * 3.6, contentW - 6, BILL_BODY_FONT_SIZE, "normal");
          });
        } else {
          doc.text(noteLines.slice(0, 4), marginX + 3, cursorY + 10);
        }
        cursorY += noteH + 10;
      }

      const tableHeaderH = 6.4;
      const rowH = 5.8;
      const noW = 10;
      const amountW = 28;
      const descW = contentW - noW - amountW;
      const drawServiceHeader = (y: number) => {
        doc.setFillColor(44, 62, 80);
        doc.setTextColor(255, 255, 255);
        doc.rect(marginX, y, contentW, tableHeaderH, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(BILL_BODY_FONT_SIZE);
        doc.text("No", marginX + noW / 2, y + 4.4, { align: "center" });
        doc.text("Description", marginX + noW + 2, y + 4.4);
        doc.text("Amount", pageW - marginX - 2, y + 4.4, { align: "right" });
        return y + tableHeaderH;
      };

      cursorY = ensureSpace(cursorY, tableHeaderH + rowH + 4);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(BILL_TITLE_FONT_SIZE);
      doc.setTextColor(20, 31, 46);
      doc.text("REQUESTED SERVICES", marginX, cursorY);
      drawArabicLine("الخدمات المطلوبة", pageW - marginX, cursorY - 3.1, 42, BILL_TITLE_FONT_SIZE, "bolditalic");
      cursorY += 7;
      cursorY = drawServiceHeader(cursorY);

      if (!serviceRows.length) {
        doc.setDrawColor(220, 226, 234);
        doc.rect(marginX, cursorY, contentW, rowH);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(107, 114, 128);
        doc.text("No services listed", marginX + noW + 2, cursorY + 4.1);
        cursorY += rowH;
      }

      const reservedAfterServices = 58;
      const maxServiceRows = Math.max(1, Math.floor((pageContentBottom - cursorY - reservedAfterServices) / rowH));
      const visibleServiceRows =
        serviceRows.length > maxServiceRows
          ? [
              ...serviceRows.slice(0, Math.max(0, maxServiceRows - 1)),
              {
                label: `+${serviceRows.length - Math.max(0, maxServiceRows - 1)} more services on job card`,
                amount: null,
                muted: true,
                bold: true,
              },
            ]
          : serviceRows;

      visibleServiceRows.forEach((row, idx) => {
        if (cursorY + rowH > pageContentBottom - reservedAfterServices) return;
        if (idx % 2 === 0) {
          doc.setFillColor(250, 252, 255);
          doc.rect(marginX, cursorY, contentW, rowH, "F");
        }
        if (row.muted) {
          doc.setFillColor(241, 245, 249);
          doc.rect(marginX + 0.3, cursorY + 0.3, contentW - 0.6, rowH - 0.6, "F");
        }
        doc.setDrawColor(220, 226, 234);
        doc.setLineWidth(0.22);
        doc.rect(marginX, cursorY, contentW, rowH);
        doc.setFont("helvetica", row.bold ? "bold" : "normal");
        doc.setFontSize(BILL_BODY_FONT_SIZE);
        doc.setTextColor(row.muted ? 113 : 20, row.muted ? 128 : 31, row.muted ? 150 : 46);
        doc.text(String(idx + 1), marginX + noW / 2, cursorY + 4.1, { align: "center" });
        const description = clipText(row.label, descW - 4);
        if (containsArabic(description)) {
          drawArabicLine(description, marginX + noW + descW - 2, cursorY + 1.1, descW - 4, BILL_BODY_FONT_SIZE, row.bold ? "bold" : "normal", row.muted ? "#718096" : "#111827");
        } else {
          doc.text(description, marginX + noW + (row.muted ? 5 : 2), cursorY + 4.1);
        }
        doc.setTextColor(20, 31, 46);
        doc.text(row.amount == null ? "" : fmtMoney(row.amount), pageW - marginX - 2, cursorY + 4.1, { align: "right" });
        cursorY += rowH;
      });
      cursorY += 3;

      const summaryH = 17;
      cursorY = ensureSpace(cursorY, summaryH + 26);
      doc.setDrawColor(188, 196, 206);
      doc.setFillColor(246, 249, 252);
      doc.roundedRect(marginX, cursorY, contentW, summaryH, 1.5, 1.5, "FD");
      const summaryRows = [
        ["Total", "الإجمالي", totalAmount],
        ["Discount", "الخصم", discount],
        ["Net", "الصافي", netAmount],
        ["Paid", "المدفوع", amountPaid],
        ["Balance Due", "المتبقي", balanceDue],
      ] as const;
      const summaryColW = contentW / summaryRows.length;
      summaryRows.forEach(([enLabel, arLabel, value], idx) => {
        const colLeft = marginX + idx * summaryColW;
        const colCenter = colLeft + summaryColW / 2;
        const isBalance = idx === summaryRows.length - 1;
        if (idx > 0) doc.line(colLeft, cursorY, colLeft, cursorY + summaryH);
        if (isBalance) {
          doc.setFillColor(44, 62, 80);
          doc.rect(colLeft, cursorY, summaryColW, summaryH, "F");
        }
        doc.setTextColor(isBalance ? 255 : 20, isBalance ? 255 : 31, isBalance ? 255 : 46);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6);
        doc.text(enLabel, colCenter, cursorY + 4.1, { align: "center" });
        drawArabicLine(arLabel, colLeft + summaryColW - 1.6, cursorY + 4.9, summaryColW - 3.2, 5.8, "normal", isBalance ? "#FFFFFF" : "#181818");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.8);
        doc.text(fmtMoney(value), colCenter, cursorY + 12.1, { align: "center" });
      });
      cursorY += summaryH + 10;

      cursorY = ensureSpace(cursorY, 27);
      const signatureW = (contentW - 14) / 2;
      const signatureY = cursorY + 8;
      const drawSignature = (x: number, title: string, titleAr: string, name: string) => {
        doc.setDrawColor(90, 103, 125);
        doc.setLineWidth(0.35);
        doc.line(x, signatureY + 8.5, x + signatureW, signatureY + 8.5);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(BILL_BODY_FONT_SIZE);
        doc.setTextColor(20, 31, 46);
        doc.text(title, x, signatureY + 12.8);
        drawArabicLine(titleAr, x + signatureW, signatureY + 9.5, 42, BILL_BODY_FONT_SIZE, "bolditalic");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(107, 114, 128);
        drawSmartPdfLine(`Name: ${name}`, x, signatureY + 17, signatureW);
        doc.text("Date:", x, signatureY + 20.8);
      };
      drawSignature(marginX, "Customer Signature", "توقيع العميل", dash(order?.customerName));
      drawSignature(marginX + signatureW + 14, "Created By Signature", "توقيع العميل", createdBy);

      const fileName = `job-order-receipt-${cleanFileToken(jobId)}.pdf`;
      return { doc, fileName };
  };

  const downloadReceiptForOrder = async (order: any, fallbackJobId?: string) => {
    try {
      const { doc, fileName } = await buildReceiptDocument(order, fallbackJobId);
      doc.save(fileName);
    } catch (e) {
      showError({
        title: t("Receipt generation failed"),
        message: errMsg(e),
      });
    }
  };

  const printReceiptForOrder = async (order: any, fallbackJobId?: string) => {
    try {
      const { doc } = await buildReceiptDocument(order, fallbackJobId);
      (doc as any).autoPrint?.();
      const blob = doc.output("blob");
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    } catch (e) {
      showError({
        title: t("Receipt generation failed"),
        message: errMsg(e),
      });
    }
  };

  const printCreatedReceipt = async () => {
    if (!lastCreatedOrderSnapshot) return;
    await printReceiptForOrder(lastCreatedOrderSnapshot, submittedOrderId);
  };


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
      const orders = await withLoading(listJobOrdersForMain(), t("Loading job cards..."));
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

  useEffect(() => {
    if (screenState !== "main" && searchQuery) setSearchQuery("");
  }, [screenState, searchQuery]);

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

  // Add service submit with ErrorPopup + SuccessPopup
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

    const requestedAdditionalDiscount = Math.max(
      0,
      Math.min(subtotal, (subtotal * Number(discountPercent || 0)) / 100)
    );
    const maxAdditionalDiscountAmount = Math.max(
      0,
      Math.min(subtotal, discountAllowance.maxAdditionalDiscountAmount)
    );
    const discount = Math.min(requestedAdditionalDiscount, maxAdditionalDiscountAmount);
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
      showLoading(t("Saving services..."));
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
        title: t("Add services failed"),
        message: (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("Could not add services to this job order.")}</div>
            <div>{errMsg(e)}</div>
          </div>
        ),
        details: String((e as any)?.stack ?? ""),
        onRetry: () => void handleAddServiceSubmit({ selectedServices, discountPercent }),
      });
      setScreenState("details");
    } finally {
      setLoadingOrders(false);
      hideLoading();
    }
  };

  // Cancel: uses ErrorPopup + refresh
  const handleCancelOrder = async () => {
    if (!cancelOrderId) return;

    const orderToCancel = demoOrders.find((o) => o.id === cancelOrderId);
    if (!orderToCancel) {
      showError({
        title: t("Cancel failed"),
        message: t("Order not found in the current list. Please refresh and try again."),
        onRetry: () => void refreshMainOrders(),
      });
      return;
    }

    if (orderToCancel.workStatus === "Cancelled") {
      showError({
        title: t("Already cancelled"),
        message: `${t("Job Order")} ${cancelOrderId} ${t("is already cancelled.")}`,
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
        title: t("Cancel failed"),
        message: (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("Could not cancel this job order.")}</div>
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

    return matchesSearchQuery(
      [order.id, order.customerName, order.mobile, order.vehiclePlate, order.workStatus],
      searchQuery
    );
  });

  const paginatedOrders = filteredOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const openDetailsView = async (order: any) => {
    const orderKey = String(order?.id ?? "").trim();
    if (!orderKey) return;

    const immediateDetails = detailsViewCacheRef.current.get(orderKey) ?? order;
    flushSync(() => {
      setCurrentDetailsOrder(immediateDetails);
      setScreenState("details");
    });

    try {
      const fresh = await getJobOrderByOrderNumber(orderKey);
      const resolvedDetails = fresh || immediateDetails;
      detailsViewCacheRef.current.set(orderKey, resolvedDetails);
      setCurrentDetailsOrder((prev: any) =>
        String(prev?.id ?? "").trim() === orderKey ? resolvedDetails : prev
      );
    } catch (e) {
      console.error(e);
      showError({
        title: t("Load details failed"),
        message: t("Could not load latest details. Showing available data."),
        details: String((e as any)?.stack ?? ""),
        onRetry: () => void openDetailsView(order),
      });
    }
  };

  const handleButtonPressFeedback = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest("button, [role='button']") as HTMLElement | null;
    if (!target) return;
    if ((target as HTMLButtonElement).disabled || target.getAttribute("aria-disabled") === "true") return;

    target.classList.remove("jo-btn-clicked");
    void target.offsetWidth;
    target.classList.add("jo-btn-clicked");

    window.setTimeout(() => {
      target.classList.remove("jo-btn-clicked");
    }, 180);
  }, []);

  return (
    <div className="job-order-management" onPointerDownCapture={handleButtonPressFeedback}>
      {screenState === "main" && (
        <MainScreen
          orders={paginatedOrders}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onViewDetails={openDetailsView}
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
          onDownloadReceipt={(orderForReceipt: any) => void downloadReceiptForOrder(orderForReceipt, String(orderForReceipt?.id ?? ""))}
          onPrintReceipt={(orderForReceipt: any) => void printReceiptForOrder(orderForReceipt, String(orderForReceipt?.id ?? ""))}
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
              setLastCreatedOrderSnapshot({ ...newOrder });
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
                title: t("Create job order failed"),
                message: (
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("Your job order was not created.")}</div>
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
          isSubmitting={loadingOrders}
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
          title={lastAction === "cancel" ? t("Order Cancelled") : t("Order Created")}
          subtitle={lastAction === "cancel" ? t("Your action was successful") : t("Your job order has been created successfully")}
          message={
            lastAction === "cancel" ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ padding: "12px 14px", background: "linear-gradient(90deg, rgba(16,185,129,0.08) 0%, rgba(37,214,232,0.04) 100%)", borderRadius: 10, border: "1px solid rgba(16,185,129,0.2)" }}>
                    <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#102A68", marginBottom: 6 }}>
                      <i className="fas fa-check-circle" style={{ color: "#10B981", marginRight: 8 }} />
                      {t("Status")}
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "#10B981", fontWeight: 800 }}>
                      {t("Order Marked as Cancelled")}
                    </div>
                  </div>
                  <div style={{ padding: "12px 14px", background: "#F0F4FF", borderRadius: 10, border: "1px solid #DDE7F6" }}>
                    <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                      {t("Job Order ID")}
                    </div>
                    <div style={{ fontSize: "0.9rem", fontWeight: 800, color: "#4E40F8", fontFamily: "monospace" }}>
                      {submittedOrderId}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ padding: "12px 14px", background: "linear-gradient(90deg, rgba(16,185,129,0.08) 0%, rgba(37,214,232,0.04) 100%)", borderRadius: 10, border: "1px solid rgba(16,185,129,0.2)" }}>
                    <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#102A68", marginBottom: 6 }}>
                      <i className="fas fa-check-circle" style={{ color: "#10B981", marginRight: 8 }} />
                      {t("Status")}
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "#10B981", fontWeight: 800 }}>
                      {t("Successfully Created")}
                    </div>
                  </div>
                  <div style={{ padding: "12px 14px", background: "#F0F4FF", borderRadius: 10, border: "1px solid #DDE7F6" }}>
                    <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                      {t("Job Order ID")}
                    </div>
                    <div style={{ fontSize: "0.9rem", fontWeight: 800, color: "#4E40F8", fontFamily: "monospace" }}>
                      {submittedOrderId}
                    </div>
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#8C9ABF", fontWeight: 600, paddingTop: 6, borderTop: "1px solid #EEF2FB" }}>
                    {t("Your order has been added to the system and is ready for processing.")}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button type="button" className="quotation-inline-reset-btn" onClick={printCreatedReceipt}>
                      <i className="fas fa-print" /> {t("Print Receipt")}
                    </button>
                  </div>
                </div>
              </>
            )
          }
          autoCloseMs={lastAction === "cancel" ? 2200 : undefined}
        />
      )}

      {/* ✅ Add Service Success Popup */}
      {showAddServiceSuccessPopup && (
        <SuccessPopup
          isVisible={true}
          onClose={() => setShowAddServiceSuccessPopup(false)}
          title={t("Services Added")}
          subtitle={t("Services have been added to the job order")}
          message={
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ padding: "12px 14px", background: "linear-gradient(90deg, rgba(16,185,129,0.08) 0%, rgba(37,214,232,0.04) 100%)", borderRadius: 10, border: "1px solid rgba(16,185,129,0.2)" }}>
                  <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#102A68", marginBottom: 6 }}>
                    <i className="fas fa-check-circle" style={{ color: "#10B981", marginRight: 8 }} />
                    {t("Status")}
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#10B981", fontWeight: 800 }}>
                    {t("Services Added Successfully")}
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ padding: "12px 14px", background: "#F0F4FF", borderRadius: 10, border: "1px solid #DDE7F6" }}>
                    <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                      {t("Order ID")}
                    </div>
                    <div style={{ fontSize: "0.88rem", fontWeight: 800, color: "#4E40F8", fontFamily: "monospace", wordBreak: "break-all" }}>
                      {addServiceSuccessData.orderId}
                    </div>
                  </div>
                  <div style={{ padding: "12px 14px", background: "#ECFFF8", borderRadius: 10, border: "1px solid #A5F3FC" }}>
                    <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                      {t("Invoice ID")}
                    </div>
                    <div style={{ fontSize: "0.88rem", fontWeight: 800, color: "#0F766E", fontFamily: "monospace", wordBreak: "break-all" }}>
                      {addServiceSuccessData.invoiceId}
                    </div>
                  </div>
                </div>
              </div>
            </>
          }
          autoCloseMs={2200}
        />
      )}

      {/* Error Popup */}
      <ErrorPopup
        isVisible={errorOpen}
        onClose={() => setErrorOpen(false)}
        title={errorTitle}
        message={errorMessage || t("Unknown error")}
        details={errorDetails}
        onRetry={errorRetry}
      />

      {/* Cancel Confirmation Modal */}
      <div className={`cancel-modal-overlay ${showCancelConfirmation && cancelOrderId ? "active" : ""}`}>
        <div className="cancel-modal">
          <div className="cancel-modal-header">
            <h3>
              <i className="fas fa-exclamation-triangle"></i> {t("Confirm Cancellation")}
            </h3>
          </div>
          <div className="cancel-modal-body">
            <div className="cancel-warning">
              <i className="fas fa-exclamation-circle"></i>
              <div className="cancel-warning-text">
                <p>
                  {t("You are about to cancel order")} <strong>{cancelOrderId}</strong>.
                </p>
                <p>{t("This action cannot be undone.")}</p>
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
                <i className="fas fa-times"></i> {t("Keep Order")}
              </button>
              <button className="btn-confirm-cancel" onClick={handleCancelOrder} disabled={loadingOrders}>
                <i className="fas fa-ban"></i> {loadingOrders ? t("Cancelling...") : t("Cancel Order")}
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
  activeDropdownId,
}: any) {
  const { t } = useLanguage();
  if (orders.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <i className="fas fa-search"></i>
        </div>
        <div className="empty-text">{t("No matching job orders found")}</div>
        <div className="empty-subtext">{t("Try adjusting your search terms or click \"New Job Order\" to create one")}</div>
      </div>
    );
  }

  return (
    <div className="table-wrapper customer-table-card-shell jc-job-table-shell">
      <table className="customers-table customer-dashboard-table job-order-table jc-job-table">
          <thead>
            <tr>
              <th>{t("Create Date")}</th>
              <th>{t("Job Card ID")}</th>
              <th>{t("Order Type")}</th>
              <th>{t("Customer Name")}</th>
              <th>{t("Mobile Number")}</th>
              <th>{t("Vehicle Plate")}</th>
              <th>{t("Work Status")}</th>
              <th>{t("Payment Status")}</th>
              <th>{t("Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order: any) => (
              <tr key={order.id}>
                <td data-label={t("Create Date")}>{order.createDate}</td>
                <td data-label={t("Job Card ID")}>{order.id}</td>
                <td data-label={t("Order Type")}>
                  <span className={`order-type-badge ${order.orderType === "New Job Order" ? "order-type-new-job" : "order-type-service"}`}>
                    {t(order.orderType)}
                  </span>
                </td>
                <td data-label={t("Customer Name")}>{order.customerName}</td>
                <td data-label={t("Mobile Number")}>{order.mobile}</td>
                <td data-label={t("Vehicle Plate")}>{order.vehiclePlate}</td>
                <td data-label={t("Work Status")}>
                  <span className={`status-badge ${getWorkStatusClass(order.workStatus)}`}>{displayWorkStatusLabel(order.workStatus)}</span>
                </td>
                <td data-label={t("Payment Status")}>
                  <span className={`status-badge ${getPaymentStatusClass(order.paymentStatus)}`}>{normalizePaymentStatusLabel(order.paymentStatus)}</span>
                </td>
                <td data-label={t("Actions")}>
                  <PermissionGate moduleId="joborder" optionId="joborder_actions">
                    <div className="action-dropdown-container">
                      <button
                        className={`btn-action-dropdown${activeDropdownId === order.id ? " active" : ""}`}
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
                        <i className="fas fa-cogs"></i> {t("Actions")} <i className="fas fa-chevron-down"></i>
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
  onRefresh,
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
  const { t } = useLanguage();
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
    <div className="vehicle-page customer-page customer-dashboard-shell theme-elegant-glass" id="mainScreen" style={{ background: "linear-gradient(145deg, #f8fafe 0%, #eef3ff 100%)", minHeight: "100vh" }}>
      <main className="main-content customer-dashboard-main" style={{ padding: "16px 8px" }}>
        <section style={{ position: "relative", overflow: "hidden", marginBottom: 10, background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 12, boxShadow: "0 10px 24px rgba(51, 84, 160, 0.08)", border: "1px solid #DDE7F6" }}>
          <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />
          <div aria-hidden="true" style={{ position: "absolute", top: -18, right: -22, height: 96, width: 202, background: "linear-gradient(to bottom left, rgba(67, 24, 255, 0.18), rgba(67, 24, 255, 0))", borderBottomLeftRadius: 999, pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", right: 28, top: 26, width: 44, height: 44, borderRadius: 14, opacity: 0.35, backgroundImage: "radial-gradient(circle, rgba(116, 137, 191, 0.55) 1.4px, transparent 1.5px)", backgroundSize: "10px 10px", pointerEvents: "none" }} />
          <div style={{ position: "relative", zIndex: 1, padding: "17px 24px 17px", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 17 }}>
                <div style={{ width: 42, height: 42, borderRadius: "50%", background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)", border: "1px solid #D8E1F7", boxShadow: "0 0 0 4px rgba(101, 92, 255, 0.08), 0 6px 14px rgba(71, 88, 180, 0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5D54FF" }}>
                  <i className="fas fa-clipboard-list" style={{ fontSize: 16 }} />
                </div>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#102A68", lineHeight: 1.15, letterSpacing: "-0.03em" }}>{t("Job Orders")}</h1>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", fontSize: "0.88rem", fontWeight: 700, cursor: "pointer" }} type="button">
                  <i className="fas fa-palette" />
                  {t("Elegant Glass")}
                </button>

                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <i className="fas fa-search" style={{ position: "absolute", left: 10, color: "#8C9ABF", fontSize: 12, pointerEvents: "none" }} />
                  <input
                    type="text"
                    style={{ paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderRadius: 8, border: "1px solid #DDE7F6", background: "#FAFBFF", color: "#102A68", fontSize: "0.88rem", fontWeight: 700, outline: "none", minWidth: 220 }}
                    placeholder={t("Search by any job order details")}
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <button style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", fontSize: "0.88rem", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }} onClick={() => void onRefresh()} disabled={loading} type="button">
                  <i className="fas fa-sync" /> {loading ? t("Loading...") : t("Refresh")}
                </button>

                <PermissionGate moduleId="joborder" optionId="joborder_add">
                  <button style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 8, border: "none", background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", color: "#fff", fontSize: "0.88rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 12px rgba(78, 64, 248, 0.25)" }} onClick={onNewJob} type="button">
                    <i className="fas fa-plus-circle" /> {t("Add New Job Order")}
                  </button>
                </PermissionGate>
              </div>
            </div>
            <p style={{ margin: 0, marginLeft: 59, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: "#8C9ABF", fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1.35 }}>
              <span aria-hidden="true" style={{ width: 2, height: 12, borderRadius: 999, background: "linear-gradient(180deg, #25D6E8 0%, #4E40F8 100%)", boxShadow: "0 0 0 2px rgba(78, 64, 248, 0.10)" }} />
              <span style={{ color: "#7E8FB9" }}>{t("Unified daily brief for service, quality, finance, and staffing.")}</span>
            </p>
          </div>
        </section>

        <section style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: "8px 4px", marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: "#8C9ABF", fontWeight: 600 }}>
            {loading ? (
              t("Loading job orders...")
            ) : totalCount === 0 ? (
              t("No job orders found")
            ) : (
              <>
                {t("Showing")} {Math.min((currentPage - 1) * pageSize + 1, totalCount)}-
                {Math.min(currentPage * pageSize, totalCount)} {t("of")} <strong style={{ color: "#102A68", fontSize: "0.88rem", fontWeight: 700 }}>{totalCount}</strong> {t("job orders")}
                {searchQuery && <span style={{ color: "#5D54FF" }}> {`(${t("Filtered by:")}: "${searchQuery}")`}</span>}
              </>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label htmlFor="pageSizeSelect" style={{ fontSize: 10, color: "#8C9ABF", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em" }}>{t("Records per page:")}</label>
            <select
              id="pageSizeSelect"
              style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #DDE7F6", background: "#FAFBFF", color: "#112A6D", fontSize: "0.88rem", fontWeight: 700, outline: "none" }}
              value={pageSize}
              onChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
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
            <JobOrderRecordsTable orders={orders} onToggleActions={toggleActionDropdown} activeDropdownId={activeDropdown} />

            {orders.length > 0 && totalPages > 1 && (
              <div className="pagination" style={{ borderTop: "1px solid #E4ECF7", padding: "10px 0 4px" }}>
                <button className="pagination-btn" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>
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
                      <button key={pageNum} className={`pagination-btn ${pageNum === currentPage ? "active" : ""}`} onClick={() => onPageChange(pageNum)}>
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button className="pagination-btn" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>
                  <i className="fas fa-chevron-right" />
                </button>
              </div>
            )}
          </div>
        </section>
      </main>



      {typeof document !== "undefined" &&
        createPortal(
          <div
            className={`action-dropdown-menu show action-dropdown-menu-fixed ${activeDropdown ? "open" : "closed"}`}
            style={activeDropdown ? { position: "fixed", top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px`, zIndex: 10050, minWidth: 230, background: "#FFFFFF", border: "1px solid #DDE7F6", borderRadius: 10, boxShadow: "0 18px 32px rgba(28, 45, 94, 0.18)", padding: 6 } : { top: "-9999px", left: "-9999px" }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <PermissionGate moduleId="joborder" optionId="joborder_viewdetails">
              <button
                className="dropdown-item view"
                type="button"
                onClick={() => {
                  if (!activeDropdown) return;
                  const targetOrder = ordersById.get(String(activeDropdown));
                  if (targetOrder) onViewDetails(targetOrder);
                  activeDropdownRef.current = null;
                  setActiveDropdown(null);
                }}
                style={{ width: "100%", border: "none", background: "transparent", color: "#2A3B66", fontSize: "0.84rem", fontWeight: 600, padding: "9px 10px", borderRadius: 8, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left" }}
              >
                <i className="fas fa-eye"></i> {t("View Details")}
              </button>
            </PermissionGate>

            <PermissionGate moduleId="joborder" optionId="joborder_cancel">
              <>
                <div className="dropdown-divider" style={{ height: 1, background: "#E6ECF8", margin: "4px 6px" }}></div>
                <button
                  className="dropdown-item delete"
                  type="button"
                  onClick={() => {
                    if (!activeDropdown) return;
                    if (activeDropdown) onCancelOrder(activeDropdown);
                    activeDropdownRef.current = null;
                    setActiveDropdown(null);
                  }}
                  style={{ width: "100%", border: "none", background: "transparent", color: "#D14343", fontSize: "0.84rem", fontWeight: 700, padding: "9px 10px", borderRadius: 8, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left" }}
                >
                  <i className="fas fa-times-circle"></i> {t("Cancel Order")}
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
function DetailsScreen({ order, onClose, onAddService, currentUser: _currentUser, actorMap, onDownloadReceipt, onPrintReceipt }: any) {
  const { t } = useLanguage();
  const displayOrderId = joFirst(order?.id, order?.orderNumber, order?.jobOrderId, "JO-000000");
  const displayWorkStatus = displayWorkStatusLabel(order?.workStatus);
  const displayCreateDate = joFirst(order?.createDate, order?.createdAt, order?.createdDate, "N/A");
  const createdByDisplay = resolveCreatedBy(order, actorMap);

  return (
    <div style={{ background: "linear-gradient(145deg, #f8fafe 0%, #eef3ff 100%)", minHeight: "100vh" }}>
      {/* -- Page Header -- */}
      <div style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderBottom: "1px solid #DDE7F6", padding: "0 0 0", marginBottom: 0, boxShadow: "0 4px 18px rgba(51,84,160,0.07)" }}>
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />
        <div style={{ maxWidth: 1560, margin: "0 auto", padding: "16px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            {/* Back */}
            <button
              onClick={onClose}
              type="button"
              style={{ display: "flex", alignItems: "center", gap: 7, border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", fontWeight: 800, borderRadius: 9, padding: "8px 16px", cursor: "pointer", fontSize: "0.84rem" }}
            >
              <i className="fas fa-chevron-left" style={{ fontSize: 11 }} />
              {t("Back to Job Cards")}
            </button>

            {/* Title center */}
            <div style={{ flex: 1, minWidth: 200, textAlign: "center" }}>
              <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 800, color: "#102A68", letterSpacing: "0.01em" }}>{displayOrderId}</h1>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 5 }}>
                <span className={`status-badge ${getWorkStatusClass(order?.workStatus)}`} style={{ fontSize: "0.78rem", fontWeight: 800 }}>{displayWorkStatus}</span>
                <span style={{ fontSize: "0.78rem", color: "#8C9ABF", fontWeight: 600 }}>{t("Created")}: {displayCreateDate}</span>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <PermissionGate moduleId="joborder" optionId="joborder_print">
                <button
                  type="button"
                  onClick={() => window.print()}
                  style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", fontWeight: 700, borderRadius: 9, padding: "8px 14px", cursor: "pointer", fontSize: "0.82rem" }}
                >
                  <i className="fas fa-print" style={{ fontSize: 12 }} /> {t("Print")}
                </button>
              </PermissionGate>
            </div>
          </div>
        </div>
      </div>

      {/* -- Content -- */}
      <div style={{ maxWidth: 1560, margin: "0 auto", padding: "16px 8px 40px" }}>
        {/* One-column stack: each card on its own row */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <PermissionGate moduleId="joborder" optionId="joborder_summary">
            <UnifiedJobSummaryCard order={order} actorMap={actorMap} createdByOverride={createdByDisplay} />
          </PermissionGate>

          <PermissionGate moduleId="joborder" optionId="joborder_customer">
            <UnifiedCustomerDetailsCard order={order} />
          </PermissionGate>

          <PermissionGate moduleId="joborder" optionId="joborder_vehicle">
            <UnifiedVehicleInformationCard order={order} />
          </PermissionGate>

          <PermissionGate moduleId="joborder" optionId="joborder_services">
            <UnifiedRequestedServicesCard order={order} actorMap={actorMap} onAddService={onAddService} />
          </PermissionGate>

          <UnifiedBillingInvoicesCard order={order} />
          <JobOrderReceiptDocumentCard
            order={order}
            onDownloadReceipt={onDownloadReceipt}
            onPrintReceipt={onPrintReceipt}
          />
          <UnifiedDocumentsCard order={order} />
          <UnifiedQualityChecklistCard order={order} actorMap={actorMap} />
          <UnifiedDeliveryTimeTrackingCard order={order} />
          <UnifiedJobOrderRoadmapCard order={order} actorMap={actorMap} />
        </div>

        {/* Keep legacy wrappers type-checked until all modules migrate to unified cards. */}
        {false && (
          <>
            <JobOrderSummaryCard order={order} actorMap={actorMap} className="" />
            <ServicesCard order={order} onAddService={onAddService} className="" />
            <BillingCard order={order} className="" />
            <JobOrderDocumentsCard order={order} className="" />
            <QualityCheckCard order={order} className="" />
            <DeliveryTrackingCard order={order} className="" />
            <RoadmapCard order={order} actorMap={actorMap} className="" />
          </>
        )}
      </div>
    </div>
  );
}

function JobOrderReceiptDocumentCard({ order, onDownloadReceipt, onPrintReceipt }: any) {
  const { t } = useLanguage();
  const receiptId = joFirst(order?.id, order?.orderNumber, order?.jobOrderId, "Job Order");
  const createdAt = joFirst(order?.createdAt, order?.createDate, order?.jobOrderSummary?.createDate, "N/A");

  return (
    <div className="customer-details-card customer-details-card--wide bg-white rounded-2xl border-none shadow-[0_8px_24px_rgba(112,144,176,0.12)] p-6">
      <div className="mb-6 flex items-center justify-between gap-3" style={{ flexWrap: "wrap" }}>
        <div className="flex items-center gap-2">
          <i className="fas fa-receipt text-[#2B3674]"></i>
          <h3 className="customer-details-card-title text-lg font-bold text-[#2B3674]">{t("Job Order Receipt")}</h3>
        </div>
        <span className="status-badge status-new-request" style={{ fontSize: "0.72rem" }}>
          PDF
        </span>
      </div>

      <div className="customer-details-info-row rounded-xl border border-[#F1F4FA] p-4">
        <div className="border-b border-[#F1F4FA] pb-3">
          <span className="customer-details-info-label">{t("Document")}</span>
          <span className="customer-details-info-value">{t("Job Order Receipt")} - {receiptId}</span>
        </div>
        <div className="mt-3 border-b border-[#F1F4FA] pb-3">
          <span className="customer-details-info-label">{t("Generated")}</span>
          <span className="customer-details-info-value">{createdAt}</span>
        </div>
        <div className="mt-3" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <PermissionGate moduleId="joborder" optionId="joborder_download">
            <button
              type="button"
              onClick={() => onDownloadReceipt?.(order)}
              className="rounded-xl bg-[#4318FF] px-5 py-3 text-sm font-bold text-white transition-all hover:bg-[#3A14DF] shadow-[0_8px_22px_rgba(67,24,255,0.25)]"
            >
              <i className="fas fa-download mr-2" />
              {t("Download")}
            </button>
          </PermissionGate>
          <PermissionGate moduleId="joborder" optionId="joborder_print">
            <button
              type="button"
              onClick={() => onPrintReceipt?.(order)}
              className="rounded-xl border border-[#DDE7F6] bg-[#F7F9FF] px-5 py-3 text-sm font-bold text-[#5D54FF] transition-all hover:bg-[#EEF3FF]"
            >
              <i className="fas fa-print mr-2" />
              {t("Print")}
            </button>
          </PermissionGate>
        </div>
      </div>
    </div>
  );
}


// ============================================
// NEW JOB SCREEN
// ============================================
function NewJobScreen({ currentUser, products = [], onClose, onSubmit, prefill }: any) {
  const client = useMemo(() => getDataClient(), []);
  const { canOption, getOptionNumber } = usePermissions();
  const { t } = useLanguage();
  const [step, setStep] = useState(1);
  const [orderType, setOrderType] = useState<any>(null);
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
    return () => { cancelled = true; };
  }, [client]);

  const formatAmount = (value: any) => `QAR ${Number(value || 0).toLocaleString()}`;

  const handleVehicleSelected = async (vehicleInfo: any) => {
    setVehicleData(vehicleInfo);
    const plate = vehicleInfo.plateNumber || vehicleInfo.license || "";
    const completed = plate ? await listCompletedOrdersByPlateNumber(plate) : [];
    setVehicleCompletedServices(completed);
    if (orderType === "service" && completed.length === 0) setOrderType("new");
  };

  useEffect(() => {
    if (!prefill) return;
    if (prefill.customerData) { setCustomerType("existing"); setCustomerData(prefill.customerData); }
    if (prefill.vehicleData) { void handleVehicleSelected(prefill.vehicleData); }
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
      const customerName = String(customerData?.name ?? customerData?.displayName ?? customerData?.fullName ?? [customerData?.firstName, customerData?.lastName].filter(Boolean).join(" ")).trim();
      const customerMobile = String(customerData?.mobile ?? customerData?.phone ?? customerData?.phoneNumber ?? "").trim();
      const vehiclePlate = String(vehicleData?.plateNumber ?? vehicleData?.license ?? vehicleData?.licensePlate ?? vehicleData?.plate ?? vehicleData?.registrationNumber ?? "").trim();
      const safeCustomerName = customerName || "Walk-in Customer";
      const safeCustomerMobile = customerMobile || "N/A";
      const safeVehiclePlate = vehiclePlate || "N/A";
      const servicesToBill = orderType === "service" ? additionalServices : selectedServices;
      const { subtotal } = summarizeServicesPricing(servicesToBill);
      const maxAllowedDiscountAmount = (Math.max(0, subtotal) * centralDiscountPercent) / 100;
      const discount = Math.min(Math.max(0, discountAmount || 0), Math.max(0, subtotal), Math.max(0, maxAllowedDiscountAmount));
      const discountPercent = subtotal > 0 ? (discount / subtotal) * 100 : 0;
      const netAmount = subtotal - discount;
      const billId = `BILL-${year}-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;
      const invoiceNumber = `INV-${year}-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`;
      const actorIdentity = authEmail || resolveActorUsername(currentUser, "system");
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
        services: (orderType === "service" ? additionalServices : selectedServices).map((s: any) => ({
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
          notes: orderType === "service" ? "Additional service for completed order" : "New service request",
        })),
        billing: {
          billId,
          totalAmount: formatAmount(subtotal),
          discount: formatAmount(discount),
          netAmount: formatAmount(netAmount),
          amountPaid: formatAmount(0),
          balanceDue: formatAmount(netAmount),
          paymentMethod: null,
          invoices: [{
            number: invoiceNumber,
            amount: formatAmount(netAmount),
            discount: formatAmount(discount),
            status: "Unpaid",
            paymentMethod: null,
            services: servicesToBill.map((s: any) => getServiceDisplayName(s)),
          }],
        },
        roadmap: [
          { step: "New Request", stepStatus: "Active", startTimestamp: new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }), endTimestamp: null, actionBy: actorIdentity, actionByName: actorDisplayName, status: "InProgress" },
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
    <div className="pim-details-screen jo-wizard-screen" style={{ background: "linear-gradient(145deg, #f8fafe 0%, #eef3ff 100%)", minHeight: "100vh", padding: 0 }}>
      <div style={{ maxWidth: 1560, margin: "0 auto", padding: "16px 8px" }}>
        <div className="pim-details-header jo-wizard-header" style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", border: "1px solid #DDE7F6", borderRadius: 14, boxShadow: "0 10px 28px rgba(51,84,160,0.10)", padding: "16px 18px", marginBottom: 16 }}>
          <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", borderTopLeftRadius: 14, borderTopRightRadius: 14 }} />
          <div className="pim-details-title-container" style={{ paddingTop: 8 }}>
            <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800, color: "#102A68" }}><i className="fas fa-plus-circle"></i> {t("Create New Job Order")}</h2>
          </div>
          <button className="pim-btn-close-details jo-wizard-cancel-btn" onClick={onClose} style={{ border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", fontWeight: 700, borderRadius: 9, padding: "8px 14px" }}>
            <i className="fas fa-times"></i> {t("Cancel")}
          </button>
        </div>
        <div className="pim-details-body jo-wizard-body" style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", border: "1px solid #DDE7F6", borderRadius: 14, boxShadow: "0 10px 28px rgba(51,84,160,0.10)", padding: "16px 18px 22px" }}>
          <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", borderTopLeftRadius: 14, borderTopRightRadius: 14 }} />
          <div className="progress-bar jo-wizard-stepper" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(64px, 1fr))", gap: 10, margin: "8px 0 20px" }}>
          {[1, 2, 3, 4, 5].map((s) => (
            <div key={s} className={`progress-step ${s < step ? "completed" : s === step ? "active" : ""}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <span style={{ width: 36, height: 36, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.86rem", fontWeight: 800, color: s === step ? "#FFFFFF" : s < step ? "#FFFFFF" : "#8C9ABF", background: s === step || s < step ? "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)" : "#EEF3FF", boxShadow: s === step ? "0 8px 18px rgba(78,64,248,0.25)" : "none" }}>{s}</span>
              <div className="step-label" style={{ fontSize: "0.72rem", fontWeight: 700, color: s === step ? "#102A68" : "#8C9ABF", textAlign: "center", lineHeight: 1.2 }}>{[t("Customer"), t("Vehicle"), t("Order Type"), t("Services"), t("Confirm")][s - 1]}</div>
            </div>
          ))}
        </div>
        {step === 1 && (
          <StepOneCustomer customerType={customerType} setCustomerType={setCustomerType} customerData={customerData} setCustomerData={setCustomerData} onNext={() => setStep(2)} onCancel={onClose} actorUsername={actorUsername} />
        )}
        {step === 2 && (
          <StepTwoVehicle vehicleData={vehicleData} setVehicleData={setVehicleData} customerData={customerData} setCustomerData={setCustomerData} onVehicleSelected={handleVehicleSelected} onNext={() => setStep(3)} onBack={() => setStep(1)} actorUsername={actorUsername} />
        )}
        {step === 3 && vehicleCompletedServices.length > 0 && (
          <OrderTypeSelection vehicleCompletedServices={vehicleCompletedServices} orderType={orderType} onSelectOrderType={(type: any) => { setOrderType(type); setStep(4); }} onBack={() => setStep(2)} />
        )}
        {step === 3 && vehicleCompletedServices.length === 0 && (
          <NoCompletedServicesMessage onNext={() => { setOrderType("new"); setStep(4); }} onBack={() => setStep(2)} />
        )}
        {step === 4 && (
          <StepThreeServices products={products} selectedServices={orderType === "service" ? additionalServices : selectedServices} setSelectedServices={orderType === "service" ? setAdditionalServices : setSelectedServices} vehicleType={vehicleData?.carType || vehicleData?.vehicleType || "SUV"} maxDiscountPercent={centralDiscountPercent} discountAmount={discountAmount} setDiscountAmount={setDiscountAmount} orderNotes={orderNotes} setOrderNotes={setOrderNotes} expectedDeliveryDate={expectedDeliveryDate} setExpectedDeliveryDate={setExpectedDeliveryDate} expectedDeliveryTime={expectedDeliveryTime} setExpectedDeliveryTime={setExpectedDeliveryTime} onNext={() => setStep(5)} onBack={() => setStep(3)} orderType={orderType} vehicleCompletedServices={vehicleCompletedServices} />
        )}
          {step === 5 && (
            <StepFourConfirm orderType={orderType} customerData={customerData} vehicleData={vehicleData} selectedServices={orderType === "service" ? additionalServices : selectedServices} maxDiscountPercent={centralDiscountPercent} discountAmount={discountAmount} orderNotes={orderNotes} expectedDeliveryDate={expectedDeliveryDate} expectedDeliveryTime={expectedDeliveryTime} isSubmitting={isSubmitting} onBack={() => setStep(4)} onSubmit={handleSubmit} />
          )}
        </div>
      </div>

      {/* Premium Loading Overlay */}
      {isSubmitting && (
        <div className="loading-overlay">
          <div className="loading-container">
            <div className="jo-create-spinner-wrapper">
              <div className="jo-create-spinner" />
              <div className="jo-create-pulse-ring" />
            </div>
            <div className="loading-text">
              <h3>
                {t("Creating Job Order")}
                <span className="loading-dots">
                  <span className="loading-dot" />
                  <span className="loading-dot" />
                  <span className="loading-dot" />
                </span>
              </h3>
              <p>{t("Please wait while we process your order")}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// CUSTOMER STEP (backend search/create)
// ============================================
function StepOneCustomer({ customerType, setCustomerType, customerData, setCustomerData, onNext, onCancel, actorUsername }: any) {
  const { t } = useLanguage();
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

  const clearCustomerSelection = () => {
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
  };

  useEffect(() => {
    if (customerData) {
      setVerifiedCustomer(customerData);
      return;
    }
    clearCustomerSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerType]);

  const sourceLabel = (src: string) => {
    if (src === "walk_in") return t("Walk-in");
    if (src === "refer_person") return t("Refer by person");
    if (src === "social_media") return t("Social media");
    if (src === "other") return t("Other");
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
    <div className="form-card bg-white rounded-2xl border-none shadow-[0_8px_24px_rgba(112,144,176,0.12)] p-6 [&_label]:text-sm [&_label]:font-semibold [&_label]:text-[#2B3674] [&_label]:mb-2 [&_label]:block [&_input]:w-full [&_input]:bg-white [&_input]:border [&_input]:border-[#E7EDF8] [&_input]:rounded-xl [&_input]:px-4 [&_input]:py-3 [&_input]:text-sm [&_input]:text-[#2B3674] [&_input]:placeholder:text-[#A3AED0] [&_input]:focus:outline-none [&_input]:focus:ring-2 [&_input]:focus:ring-[#4318FF]/20 [&_input]:focus:border-[#4318FF] [&_input]:transition-all [&_select]:w-full [&_select]:bg-white [&_select]:border [&_select]:border-[#E7EDF8] [&_select]:rounded-xl [&_select]:px-4 [&_select]:py-3 [&_select]:text-sm [&_select]:text-[#2B3674] [&_select]:focus:outline-none [&_select]:focus:ring-2 [&_select]:focus:ring-[#4318FF]/20 [&_select]:focus:border-[#4318FF] [&_select]:transition-all">
      <div className="form-card-title mb-6 flex items-center gap-2">
        <i className="fas fa-user"></i>
        <h2 className="text-lg font-bold text-[#2B3674]">{t("Customer Information")}</h2>
      </div>
      <div className="form-card-content">
        <div className="option-selector grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className={`option-btn rounded-xl border px-4 py-3 font-bold transition-all cursor-pointer ${customerType === "new" ? "bg-[#4318FF] text-white border-[#4318FF]" : "bg-[#F4F7FE] text-[#A3AED0] border-[#E7EDF8]"}`} onClick={() => { clearCustomerSelection(); setCustomerType("new"); }}>
            {t("New Customer")}
          </div>
          <div className={`option-btn rounded-xl border px-4 py-3 font-bold transition-all cursor-pointer ${customerType === "existing" ? "bg-[#4318FF] text-white border-[#4318FF]" : "bg-[#F4F7FE] text-[#A3AED0] border-[#E7EDF8]"}`} onClick={() => { clearCustomerSelection(); setCustomerType("existing"); }}>
            {t("Existing Customer")}
          </div>
        </div>

        {customerType === "new" && !verifiedCustomer && (
          <div>
            <div className="form-row grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="form-group">
                <label>{t("Full Name")} *</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="form-group">
                <label>{t("Phone")} *</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="form-row grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="form-group">
                <label>{t("Email")}</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder={t("Optional")} />
              </div>
              <div className="form-group">
                <label>{t("Address")}</label>
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("Optional")} />
              </div>
            </div>

            <div className="form-row grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="form-group">
                <label>{t("Heard of us from")} *</label>
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
                  <option value="">{t("Select...")}</option>
                  <option value="walk_in">{t("Walk-in")}</option>
                  <option value="refer_person">{t("Refer by person")}</option>
                  <option value="social_media">{t("Social media")}</option>
                  <option value="other">{t("Other")}</option>
                </select>
              </div>
            </div>

            {heardFrom === "refer_person" && (
              <div className="form-row grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="form-group">
                  <label>{t("Referred Person Name")} *</label>
                  <input value={referralPersonName} onChange={(e) => setReferralPersonName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>{t("Referred Person Mobile")} *</label>
                  <input value={referralPersonMobile} onChange={(e) => setReferralPersonMobile(e.target.value)} />
                </div>
              </div>
            )}

            {heardFrom === "social_media" && (
              <div className="form-row grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="form-group">
                  <label>{t("Platform")} *</label>
                  <select value={socialPlatform} onChange={(e) => setSocialPlatform(e.target.value)}>
                    <option value="">{t("Select...")}</option>
                    <option value="instagram">Instagram</option>
                    <option value="twitter">Twitter</option>
                    <option value="tiktok">TikTok</option>
                    <option value="website">Website</option>
                  </select>
                </div>
              </div>
            )}

            {heardFrom === "other" && (
              <div className="form-row grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="form-group">
                  <label>{t("Other Note")} *</label>
                  <input value={heardFromOtherNote} onChange={(e) => setHeardFromOtherNote(e.target.value)} />
                </div>
              </div>
            )}
            <button
              className="btn btn-primary bg-[#4318FF] text-white rounded-xl px-6 py-3 font-bold hover:bg-[#3A14DF] transition-all shadow-[0_8px_22px_rgba(67,24,255,0.25)]"
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
              {saving ? t("Saving...") : t("Save Customer")}
            </button>
          </div>
        )}

        {customerType === "existing" && (
          <div>
            <div className="form-group" style={{ position: "relative" }}>
              <label>{t("Search Customer")}</label>
              <div className="smart-search-wrapper">
                <i className="fas fa-search" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#888" }}></i>
                <input
                  type="text"
                  className="smart-search-input"
                  placeholder={t("Search by name, customer ID, mobile, or email...")}
                  value={smartSearch}
                  onChange={(e) => setSmartSearch(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && void handleVerifySearch()}
                  style={{ paddingLeft: "40px" }}
                />
              </div>
              <button className="btn btn-primary" onClick={() => void handleVerifySearch()} style={{ marginTop: "10px" }}>
                <i className="fas fa-search"></i> {t("Verify Customer")}
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
                      <span className="verified-label">{t("Heard of us from")}:</span>
                      <span className="verified-value">{sourceLabel(String(verifiedCustomer.heardFrom || ""))}</span>
                    </div>
                  )}
                  {String(verifiedCustomer.heardFrom ?? "") === "refer_person" && (
                    <>
                      <div className="verified-row">
                        <span className="verified-label">{t("Referred Name")}:</span>
                        <span className="verified-value">{verifiedCustomer.referralPersonName || "-"}</span>
                      </div>
                      <div className="verified-row">
                        <span className="verified-label">{t("Referred Mobile")}:</span>
                        <span className="verified-value">{verifiedCustomer.referralPersonMobile || "-"}</span>
                      </div>
                    </>
                  )}
                  {String(verifiedCustomer.heardFrom ?? "") === "social_media" && (
                    <div className="verified-row">
                      <span className="verified-label">{t("Platform")}:</span>
                      <span className="verified-value">{verifiedCustomer.socialPlatform || "-"}</span>
                    </div>
                  )}
                  {String(verifiedCustomer.heardFrom ?? "") === "other" && (
                    <div className="verified-row">
                      <span className="verified-label">{t("Other Note")}:</span>
                      <span className="verified-value">{verifiedCustomer.heardFromOtherNote || "-"}</span>
                    </div>
                  )}
                  <div className="verified-row">
                    <span className="verified-label">{t("Registered Vehicles")}:</span>
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
                  <span className="verified-label">{t("Heard of us from")}:</span>
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
                <span>{t("Duplicate Customer Warning")}</span>
              </div>
              <div className="warning-dialog-body">
                <p>{t("This customer already exists in the system.")}</p>
                <p>
                  <strong>Name:</strong> {pendingCustomer?.name}
                </p>
                <p>
                  <strong>Mobile:</strong> {pendingCustomer?.mobile}
                </p>
                <p className="warning-message">{t("Are you sure you want to save as a new customer?")}</p>
              </div>
              <div className="warning-dialog-footer">
                <button className="btn btn-danger" onClick={() => void handleConfirmDuplicate()}>
                  <i className="fas fa-check"></i> {t("Yes, Save Anyway")}
                </button>
                <button className="btn btn-secondary" onClick={handleCancelDuplicate}>
                  <i className="fas fa-times"></i> {t("No, Cancel")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="action-buttons mt-8 flex flex-wrap justify-end gap-3">
        <button className="btn btn-secondary bg-white text-[#2B3674] border border-[#E7EDF8] rounded-xl px-6 py-3 font-bold hover:bg-[#F4F7FE]" onClick={onCancel}>
          {t("Cancel")}
        </button>
        <button className="btn btn-primary bg-[#4318FF] text-white rounded-xl px-6 py-3 font-bold hover:bg-[#3A14DF] transition-all shadow-[0_8px_22px_rgba(67,24,255,0.25)]" onClick={onNext} disabled={!customerData}>
          {t("Next: Vehicle")}
        </button>
      </div>
    </div>
  );
}

// ============================================
// VEHICLE STEP
// ============================================
function StepTwoVehicle({ vehicleData, setVehicleData, customerData, setCustomerData, onVehicleSelected, onNext, onBack, actorUsername }: any) {
  const { t } = useLanguage();
  const [showNewVehicleForm, setShowNewVehicleForm] = useState(false);
  const [factory, setFactory] = useState(QATAR_MANUFACTURERS[0] ?? "Toyota");
  const [model, setModel] = useState("");
  const [year, setYear] = useState<any>(new Date().getFullYear());
  const [license, setLicense] = useState("");
  const [carType, setCarType] = useState("SUV");
  const [color, setColor] = useState("");
  const [vinNumber, setVinNumber] = useState(""); // NEW manual VIN
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
    if (!(factory && model && year && license && carType && color && vinNumber.trim())) return;

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
    <div className="form-card bg-white rounded-2xl border-none shadow-[0_8px_24px_rgba(112,144,176,0.12)] p-6 [&_label]:text-sm [&_label]:font-semibold [&_label]:text-[#2B3674] [&_label]:mb-2 [&_label]:block [&_input]:w-full [&_input]:bg-white [&_input]:border [&_input]:border-[#E7EDF8] [&_input]:rounded-xl [&_input]:px-4 [&_input]:py-3 [&_input]:text-sm [&_input]:text-[#2B3674] [&_input]:placeholder:text-[#A3AED0] [&_input]:focus:outline-none [&_input]:focus:ring-2 [&_input]:focus:ring-[#4318FF]/20 [&_input]:focus:border-[#4318FF] [&_input]:transition-all [&_select]:w-full [&_select]:bg-white [&_select]:border [&_select]:border-[#E7EDF8] [&_select]:rounded-xl [&_select]:px-4 [&_select]:py-3 [&_select]:text-sm [&_select]:text-[#2B3674] [&_select]:focus:outline-none [&_select]:focus:ring-2 [&_select]:focus:ring-[#4318FF]/20 [&_select]:focus:border-[#4318FF] [&_select]:transition-all">
      <div className="form-card-title mb-6 flex items-center gap-2">
        <i className="fas fa-car"></i>
        <h2 className="text-lg font-bold text-[#2B3674]">{t("Vehicle Information")}</h2>
      </div>
      <div className="form-card-content">
        {hasVehicles && !showNewVehicleForm && !vehicleData && (
          <div>
            <div className="info-banner" style={{ marginBottom: "20px" }}>
              <i className="fas fa-info-circle"></i>
              <span>This customer has {customerData.vehicles.length} registered vehicle(s). Select one or add a new vehicle.</span>
            </div>

            <h3 style={{ marginBottom: "15px", fontSize: "16px", fontWeight: "600" }}>{t("Registered Vehicles")}</h3>
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
                    <i className="fas fa-check"></i> {t("Select")}
                  </button>
                </div>
              ))}
            </div>

            <button className="btn btn-secondary" onClick={() => setShowNewVehicleForm(true)} style={{ marginTop: "15px" }}>
              <i className="fas fa-plus"></i> {t("Add New Vehicle")}
            </button>
          </div>
        )}

        {(showNewVehicleForm || !hasVehicles) && !vehicleData && (
          <div>
            {hasVehicles && (
              <button className="btn btn-link" onClick={() => setShowNewVehicleForm(false)} style={{ marginBottom: "15px", padding: "8px 12px", fontSize: "14px" }}>
                <i className="fas fa-arrow-left"></i> {t("Back to Vehicle Selection")}
              </button>
            )}

            <div className="form-row grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="form-group">
                <label>{t("Manufacturer")} *</label>
                <select value={factory} onChange={(e) => setFactory(e.target.value)}>
                  {manufacturerOptions.map((manufacturer) => (
                    <option key={manufacturer} value={manufacturer}>
                      {manufacturer}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>{t("Model")} *</label>
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

            <div className="form-row grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="form-group">
                <label>{t("Year")} *</label>
                <select value={year} onChange={(e) => setYear(e.target.value)}>
                  {Array.from({ length: 20 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>{t("License Plate")} *</label>
                <input value={license} onChange={(e) => setLicense(e.target.value)} placeholder="e.g., 123456" />
              </div>
            </div>

            {/* NEW ROW: VIN + Vehicle Type */}
            <div className="form-row grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="form-group">
                <label>{t("VIN Number")} *</label>
                <input
                  value={vinNumber}
                  onChange={(e) => setVinNumber(e.target.value.toUpperCase())}
                  placeholder="e.g., JTDBR32E720054321"
                  maxLength={30}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t("Vehicle Type")} *</label>
                <select value={carType} onChange={(e) => setCarType(e.target.value)}>
                  <option>{t("SUV")}</option>
                  <option>{t("Sedan")}</option>
                  <option>{t("Hatchback")}</option>
                  <option>{t("Coupe")}</option>
                  <option>{t("Truck")}</option>
                </select>
              </div>
            </div>

            <div className="form-row grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="form-group">
                <label>{t("Color")} *</label>
                <select value={color} onChange={(e) => setColor(e.target.value)}>
                  <option value="">{t("Select color")}</option>
                  {colorOptions.map((colorName) => (
                    <option key={colorName} value={colorName}>
                      {colorName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              className="btn btn-success bg-[#4318FF] text-white rounded-xl px-6 py-3 font-bold hover:bg-[#3A14DF] transition-all shadow-[0_8px_22px_rgba(67,24,255,0.25)]"
              onClick={() => void handleSaveNewVehicle()}
              disabled={!(factory && model && year && license && carType && color && vinNumber.trim())}
            >
              <i className="fas fa-save"></i> {t("Save Vehicle")}
            </button>
          </div>
        )}

        {vehicleData && (
          <div className="verified-customer-display" style={{ marginTop: "0" }}>
            <div className="verified-header">
              <i className="fas fa-check-circle"></i>
              <span>{t("Vehicle Selected")}</span>
            </div>
            <div className="verified-info">
              <div className="verified-row">
                <span className="verified-label">{t("Vehicle")}:</span>
                <span className="verified-value">
                  {vehicleData.make} {vehicleData.model} ({vehicleData.year})
                </span>
              </div>
              <div className="verified-row">
                <span className="verified-label">{t("License Plate")}:</span>
                <span className="verified-value">{vehicleData.plateNumber}</span>
              </div>
              <div className="verified-row">
                <span className="verified-label">{t("Type")}:</span>
                <span className="verified-value">{vehicleData.vehicleType}</span>
              </div>
              <div className="verified-row">
                <span className="verified-label">{t("Color")}:</span>
                <span className="verified-value">{vehicleData.color}</span>
              </div>
              {vehicleData.vin && (
                <div className="verified-row">
                  <span className="verified-label">{t("VIN")}:</span>
                  <span className="verified-value">{vehicleData.vin}</span>
                </div>
              )}
            </div>
            <button className="btn btn-change-customer" onClick={() => setVehicleData(null)}>
              <i className="fas fa-sync-alt"></i> {t("Change Vehicle")}
            </button>
          </div>
        )}
      </div>

      <div className="action-buttons mt-8 flex flex-wrap justify-end gap-3">
        <button className="btn btn-secondary bg-white text-[#2B3674] border border-[#E7EDF8] rounded-xl px-6 py-3 font-bold hover:bg-[#F4F7FE]" onClick={onBack}>
          {t("Back")}
        </button>
        <button className="btn btn-primary bg-[#4318FF] text-white rounded-xl px-6 py-3 font-bold hover:bg-[#3A14DF] transition-all shadow-[0_8px_22px_rgba(67,24,255,0.25)]" onClick={onNext} disabled={!vehicleData}>
          {t("Next: Services")}
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
  const { t } = useLanguage();
  const [pendingSpecificationProduct, setPendingSpecificationProduct] = useState<any>(null);
  const [pendingSelectionMode, setPendingSelectionMode] = useState<"paid" | "complimentary">("paid");
  const [selectedCompletedOrderId, setSelectedCompletedOrderId] = useState("");

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

  const completedOrderHistory = useMemo(() => {
    return (vehicleCompletedServices ?? []).map((order: any, idx: number) => {
      const orderId = String(order?.id || order?.orderNumber || `Completed-${idx + 1}`).trim();
      const services = Array.isArray(order?.services) ? order.services : [];
      return {
        orderId,
        workStatus: String(order?.workStatus || "Completed").trim() || "Completed",
        servicesCount: services.length,
        services,
      };
    });
  }, [vehicleCompletedServices]);

  const complimentaryServices = useMemo(
    () => (selectedServices ?? []).filter((s: any) => Boolean(s?.isComplimentaryFromCompletedOrder)),
    [selectedServices]
  );

  const paidSelectedServices = useMemo(
    () => (selectedServices ?? []).filter((s: any) => !Boolean(s?.isComplimentaryFromCompletedOrder)),
    [selectedServices]
  );

  const mapComplimentaryService = useCallback((svc: any, idx: number) => {
    const svcKey = normalizeCatalogKey(svc?.serviceCode || svc?.catalogId || svc?.name || idx);
    return {
      name: svc?.name,
      nameAr: svc?.nameAr,
      price: 0,
      serviceCode: svc?.serviceCode || undefined,
      catalogId: svc?.catalogId || undefined,
      specificationBrandId: svc?.specificationBrandId || undefined,
      specificationBrandName: svc?.specificationBrandName || undefined,
      specificationColorHex: svc?.specificationColorHex || undefined,
      specificationProductId: svc?.specificationProductId || undefined,
      specificationProductName: svc?.specificationProductName || undefined,
      specificationMeasurement: svc?.specificationMeasurement || undefined,
      isComplimentaryFromCompletedOrder: true,
      complimentaryKey: svcKey,
    };
  }, []);

  const selectCompletedOrderAndApply = useCallback((orderId: string) => {
    const match = completedOrderHistory.find((o: any) => o.orderId === orderId);
    if (!match) return;
    setSelectedCompletedOrderId(orderId);
    const complimentary = (match.services ?? []).map((svc: any, idx: number) => mapComplimentaryService(svc, idx));
    setSelectedServices(dedupeSelectedServices([...complimentary, ...paidSelectedServices]));
  }, [completedOrderHistory, mapComplimentaryService, paidSelectedServices, setSelectedServices]);

  useEffect(() => {
    if (!useCompletedPool) {
      if (selectedCompletedOrderId) setSelectedCompletedOrderId("");
      return;
    }
    if (selectedCompletedOrderId) return;
    const first = completedOrderHistory[0]?.orderId;
    if (!first) return;
    selectCompletedOrderAndApply(first);
  }, [completedOrderHistory, selectCompletedOrderAndApply, selectedCompletedOrderId, useCompletedPool]);

  const handleToggleCompletedService = (svc: any) => {
    const svcKey = normalizeCatalogKey(svc?.serviceCode || svc?.catalogId || svc?.name || "");
    const isSelected = complimentaryServices.some(
      (s: any) => normalizeCatalogKey(s?.complimentaryKey || s?.serviceCode || s?.catalogId || s?.name) === svcKey
    );
    if (isSelected) {
      setSelectedServices(
        selectedServices.filter(
          (s: any) =>
            !(
              s?.isComplimentaryFromCompletedOrder &&
              normalizeCatalogKey(s?.complimentaryKey || s?.serviceCode || s?.catalogId || s?.name) === svcKey
            )
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
      setPendingSelectionMode("complimentary");
      setPendingSpecificationProduct(catalogProduct);
      return;
    }
    // No spec flow - add directly as complimentary (price 0)
    setSelectedServices(
      dedupeSelectedServices([
        ...selectedServices,
        {
          name: svc.name,
          nameAr: svc.nameAr,
          price: 0,
          serviceCode: svc.serviceCode || undefined,
          catalogId: svc.catalogId || undefined,
          specificationBrandId: svc.specificationBrandId || undefined,
          specificationBrandName: svc.specificationBrandName || undefined,
          specificationColorHex: svc.specificationColorHex || undefined,
          specificationProductId: svc.specificationProductId || undefined,
          specificationProductName: svc.specificationProductName || undefined,
          specificationMeasurement: svc.specificationMeasurement || undefined,
          isComplimentaryFromCompletedOrder: true,
          complimentaryKey: svcKey,
        },
      ])
    );
  };

  const handleToggleService = (product: any) => {
    const productKey = normalizeCatalogKey(product.serviceCode || product.id || product.name);
    const isSelected = useCompletedPool
      ? isCatalogProductSelected(product, paidSelectedServices)
      : isCatalogProductSelected(product, selectedServices);
    if (isSelected) {
      if (useCompletedPool) {
        const nextPaid = String(product?.type ?? "").toLowerCase() === "package"
          ? paidSelectedServices.filter((s: any) => normalizeCatalogKey(s.packageCode) !== productKey)
          : paidSelectedServices.filter((s: any) => normalizeCatalogKey(s.serviceCode || s.catalogId || s.name) !== productKey);
        setSelectedServices(dedupeSelectedServices([...complimentaryServices, ...nextPaid]));
      } else {
        const next = String(product?.type ?? "").toLowerCase() === "package"
          ? selectedServices.filter((s: any) => normalizeCatalogKey(s.packageCode) !== productKey)
          : selectedServices.filter((s: any) => normalizeCatalogKey(s.serviceCode || s.catalogId || s.name) !== productKey);
        setSelectedServices(dedupeSelectedServices(next));
      }
    } else {
      if (hasServiceSpecifications(product)) {
        setPendingSelectionMode("paid");
        const configuredSpecification = getConfiguredSpecificationSelection(product);
        if (configuredSpecification) {
          const expanded = expandCatalogProductToServices(product, products, vehicleType, configuredSpecification);
          if (useCompletedPool) {
            setSelectedServices(dedupeSelectedServices([...complimentaryServices, ...paidSelectedServices, ...expanded]));
          } else {
            setSelectedServices(dedupeSelectedServices([...selectedServices, ...expanded]));
          }
          return;
        }
        setPendingSpecificationProduct(product);
        return;
      }
      const expanded = expandCatalogProductToServices(product, products, vehicleType);
      if (useCompletedPool) {
        setSelectedServices(dedupeSelectedServices([...complimentaryServices, ...paidSelectedServices, ...expanded]));
      } else {
        setSelectedServices(dedupeSelectedServices([...selectedServices, ...expanded]));
      }
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
    <div className="form-card jo-services-premium-card bg-white rounded-2xl border-none shadow-[0_8px_24px_rgba(112,144,176,0.12)] p-6 [&_label]:text-sm [&_label]:font-semibold [&_label]:text-[#2B3674] [&_label]:mb-2 [&_label]:block [&_textarea]:w-full [&_textarea]:bg-white [&_textarea]:border [&_textarea]:border-[#E7EDF8] [&_textarea]:rounded-xl [&_textarea]:px-4 [&_textarea]:py-3 [&_textarea]:text-sm [&_textarea]:text-[#2B3674] [&_textarea]:placeholder:text-[#A3AED0] [&_textarea]:focus:outline-none [&_textarea]:focus:ring-2 [&_textarea]:focus:ring-[#4318FF]/20 [&_textarea]:focus:border-[#4318FF] [&_textarea]:transition-all [&_input]:bg-white [&_input]:border [&_input]:border-[#E7EDF8] [&_input]:rounded-xl [&_input]:px-3 [&_input]:py-2 [&_input]:text-sm [&_input]:text-[#2B3674]">
      <div className="form-card-title mb-6 flex items-center gap-2">
        <i className="fas fa-concierge-bell"></i>
        <h2 className="text-lg font-bold text-[#2B3674]">{t("Services Selection")}</h2>
      </div>

      <div className="form-card-content jo-services-premium-content">

        {/* -- COMPLETED SERVICES MODE (service order + completed history) -- */}
        {useCompletedPool ? (
          <>
            <div className="jo-completed-svc-banner">
              <i className="fas fa-history"></i>
              <span>{t("Select from previously completed services for this vehicle")}</span>
            </div>

            <div className="jo-completed-orders-wrap">
              <div className="jo-completed-orders-title">
                <i className="fas fa-list-check"></i> {t("Completed Job Orders for this Vehicle")}
              </div>
              <div className="jo-completed-orders-grid">
                {completedOrderHistory.map((entry: any) => (
                  <button
                    key={entry.orderId}
                    type="button"
                    className={`jo-completed-order-card${selectedCompletedOrderId === entry.orderId ? " selected" : ""}`}
                    onClick={() => selectCompletedOrderAndApply(entry.orderId)}
                  >
                    <div className="jo-completed-order-id">{entry.orderId}</div>
                    <div className="jo-completed-order-meta">
                      <span className="jo-completed-order-status">{entry.workStatus}</span>
                      <span className="jo-completed-order-count">
                        {entry.servicesCount} {t("service")}{entry.servicesCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="jo-completed-svc-banner" style={{ marginBottom: 10 }}>
              <i className="fas fa-gift"></i>
              <span>{t("Services from the selected completed order are included for free (QAR 0)")}</span>
            </div>

            <div className="jo-completed-svc-grid">
              {completedOrdersServices.map((svc: any, idx: number) => {
                const svcKey = normalizeCatalogKey(svc?.serviceCode || svc?.catalogId || svc?.name);
                const isSelected = complimentaryServices.some(
                  (s: any) => normalizeCatalogKey(s?.complimentaryKey || s?.serviceCode || s?.catalogId || s?.name) === svcKey
                );
                const catalogProduct = products.find(
                  (p: any) =>
                    normalizeCatalogKey(p?.serviceCode || p?.id || p?.name) === svcKey
                );
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
                      QAR 0
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="jo-completed-orders-wrap" style={{ marginTop: 14 }}>
              <div className="jo-completed-orders-title">
                <i className="fas fa-plus-circle"></i> {t("Add Other Paid Services")}
              </div>
              <div className="svc-filter-bar">
                <div className="svc-filter-row">
                  <span className="svc-filter-label"><i className="fas fa-tags"></i> {t("Category")}</span>
                  <select
                    className="svc-filter-select"
                    value={filterCategory}
                    onChange={(e) => { setFilterCategory(e.target.value); }}
                  >
                    <option value="all">{t("All Categories")}</option>
                    {svcCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.nameEn}</option>
                    ))}
                  </select>
                </div>
                <div className="svc-filter-row">
                  <span className="svc-filter-label"><i className="fas fa-layer-group"></i> {t("Type")}</span>
                  <div className="svc-type-pills">
                    <button type="button" className={`svc-type-pill${filterType === "all" ? " active" : ""}`} onClick={() => setFilterType("all")}>{t("All")}</button>
                    <button type="button" className={`svc-type-pill${filterType === "service" ? " active" : ""}`} onClick={() => setFilterType("service")}><i className="fas fa-wrench"></i> {t("Services")}</button>
                    <button type="button" className={`svc-type-pill${filterType === "package" ? " active" : ""}`} onClick={() => setFilterType("package")}><i className="fas fa-box-open"></i> {t("Packages")}</button>
                  </div>
                  <span className="svc-filter-count">{filteredProducts.length} {t("of")} {products.length}</span>
                </div>
              </div>

              {filteredProducts.length === 0 ? (
                <div className="empty-state" style={{ padding: "20px 12px" }}>
                  <div className="empty-text">{t("No services match your filter")}</div>
                </div>
              ) : (
                <div className="services-grid" style={{ marginTop: 10 }}>
                  {filteredProducts.map((product: any) => {
                    const paidSelected = isCatalogProductSelected(product, paidSelectedServices);
                    return (
                      <div
                        key={String(product.id || product.serviceCode || product.name)}
                        className={`service-checkbox ${paidSelected ? "selected" : ""}`}
                        onClick={() => handleToggleService(product)}
                      >
                        <div className="service-info">
                          <div className="service-name-row">
                            <div className="service-name" data-no-translate="true">{getServiceDisplayName(product)}</div>
                            {String(product?.type ?? "").toLowerCase() === "package" && (
                              <span className="jo-package-price-badge">
                                <i className="fas fa-box-open" aria-hidden="true"></i>
                                {t("Package Price Applied")}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="service-price">{formatPrice(resolveServicePriceForVehicleType(product, vehicleType))}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          /* -- CATALOG MODE (new order or no completed services) -- */
          <>
            <p>{t("Select services for")} {vehicleType}:</p>

            {products.length === 0 ? (
              <div className="empty-state" style={{ padding: "30px 12px" }}>
                <div className="empty-text">{t("No services configured yet")}</div>
                <div className="empty-subtext">{t("Please create services from the Service Creation page first.")}</div>
              </div>
            ) : (
            <>
              <div className="svc-filter-bar">
                <div className="svc-filter-row">
                  <span className="svc-filter-label"><i className="fas fa-tags"></i> {t("Category")}</span>
                  <select
                    className="svc-filter-select"
                    value={filterCategory}
                    onChange={(e) => { setFilterCategory(e.target.value); }}
                  >
                    <option value="all">{t("All Categories")}</option>
                    {svcCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.nameEn}</option>
                    ))}
                  </select>
                </div>
                <div className="svc-filter-row">
                  <span className="svc-filter-label"><i className="fas fa-layer-group"></i> {t("Type")}</span>
                  <div className="svc-type-pills">
                    <button type="button" className={`svc-type-pill${filterType === "all" ? " active" : ""}`} onClick={() => setFilterType("all")}>{t("All")}</button>
                    <button type="button" className={`svc-type-pill${filterType === "service" ? " active" : ""}`} onClick={() => setFilterType("service")}><i className="fas fa-wrench"></i> {t("Services")}</button>
                    <button type="button" className={`svc-type-pill${filterType === "package" ? " active" : ""}`} onClick={() => setFilterType("package")}><i className="fas fa-box-open"></i> {t("Packages")}</button>
                  </div>
                  <span className="svc-filter-count">{filteredProducts.length} {t("of")} {products.length}</span>
                </div>
              </div>
              {filteredProducts.length === 0 ? (
                <div className="empty-state" style={{ padding: "24px 12px" }}>
                  <div className="empty-text">{t("No services match your filter")}</div>
                  <div className="empty-subtext">{t("Try a different category or type.")}</div>
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
                            {t("Package Price Applied")}
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
                                {`${t("Specification")}: ${label}`}
                              </span>
                            ) : t("Specification required before adding this service.");
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

        <div className="jo-services-notes-block">
          <label className="jo-services-input-label">
            <i className="fas fa-sticky-note"></i>
            {t("Notes / Comments (Optional)")}
          </label>
          <textarea
            className="jo-services-textarea"
            value={orderNotes}
            onChange={(e) => setOrderNotes(e.target.value)}
            placeholder={t("Add any special instructions, notes, or comments for this order...")}
            rows={4}
          />
        </div>

        <div className="jo-services-delivery-block">
          <label className="jo-services-input-label">
            <i className="fas fa-calendar-check"></i>
            {t("Expected Delivery Date & Time")}
          </label>
          <div className="jo-services-datetime-grid">
            <div>
              <input
                className="jo-services-input"
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
              />
            </div>
            <div>
              <input
                className="jo-services-input"
                type="time"
                value={expectedDeliveryTime}
                onChange={(e) => setExpectedDeliveryTime(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="price-summary-box jo-services-price-summary">
          <h4>{t("Price Summary")}</h4>
          <div className="price-row">
            <span>{packageCount > 0 ? t("Packages & Services:") : t("Services:")}</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          <div className="price-row">
            <span>{t("Apply Discount:")}</span>
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
            <span>{t("Discount Amount (QAR):")}</span>
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
            <span>{t("Max Allowed Discount:")}</span>
            <span>{Number(normalizedMaxDiscountPercent.toFixed(2))}%</span>
          </div>
          <div className="price-row discount-amount">
            <span>{t("Discount Amount:")}</span>
            <span>{formatPrice(discount)}</span>
          </div>
          <div className="price-row total">
            <span>{t("Total:")}</span>
            <span>{formatPrice(total)}</span>
          </div>
        </div>
      </div>

      <div className="action-buttons mt-8 flex flex-wrap justify-end gap-3">
        <button className="btn btn-secondary bg-white text-[#2B3674] border border-[#E7EDF8] rounded-xl px-6 py-3 font-bold hover:bg-[#F4F7FE]" onClick={onBack}>
          {t("Back")}
        </button>
        <button className="btn btn-primary bg-[#4318FF] text-white rounded-xl px-6 py-3 font-bold hover:bg-[#3A14DF] transition-all shadow-[0_8px_22px_rgba(67,24,255,0.25)]" onClick={onNext} disabled={selectedServices.length === 0 || (!useCompletedPool && products.length === 0)}>
          {t("Next: Confirm")}
        </button>
      </div>

      {pendingSpecificationProduct && (
        <ServiceSpecificationModal
          product={pendingSpecificationProduct}
          onClose={() => setPendingSpecificationProduct(null)}
          onConfirm={(specification: any) => {
            const expanded = expandCatalogProductToServices(pendingSpecificationProduct, products, vehicleType, specification);
            if (pendingSelectionMode === "complimentary") {
              const complimentaryExpanded = expanded.map((item: any, idx: number) => ({
                ...item,
                price: 0,
                isComplimentaryFromCompletedOrder: true,
                complimentaryKey: normalizeCatalogKey(item?.serviceCode || item?.catalogId || item?.name || idx),
              }));
              setSelectedServices(dedupeSelectedServices([...selectedServices, ...complimentaryExpanded]));
            } else if (useCompletedPool) {
              setSelectedServices(dedupeSelectedServices([...complimentaryServices, ...paidSelectedServices, ...expanded]));
            } else {
              setSelectedServices(dedupeSelectedServices([...selectedServices, ...expanded]));
            }
            setPendingSpecificationProduct(null);
            setPendingSelectionMode("paid");
          }}
        />
      )}
    </div>
  );
}

// ============================================
// ADD SERVICE SCREEN
// ============================================
function AddServiceScreen({ order, products = [], maxDiscountPercent = 0, onClose, onSubmit, isSubmitting = false }: any) {
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
  const discount = Math.max(0, Math.min(maxAdditionalDiscountAmount, (subtotal * effectiveDiscountPercent) / 100));
  const total = subtotal - discount;

  return (
    <div className="pim-details-screen customer-details-screen dashboard-customer-details-bg customer-details-exact theme-elegant-glass jc-skin jo-details-v3" style={{ background: "linear-gradient(145deg, #f8fafe 0%, #eef3ff 100%)", minHeight: "100vh", padding: 0 }}>
      <div style={{ maxWidth: 1560, margin: "0 auto", padding: "16px 8px 32px" }}>
        <section style={{ position: "relative", overflow: "hidden", marginBottom: 14, background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 12, boxShadow: "0 10px 24px rgba(51, 84, 160, 0.08)", border: "1px solid #DDE7F6" }}>
          <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />
          <div aria-hidden="true" style={{ position: "absolute", top: -18, right: -22, height: 96, width: 202, background: "linear-gradient(to bottom left, rgba(67, 24, 255, 0.18), rgba(67, 24, 255, 0))", borderBottomLeftRadius: 999, pointerEvents: "none" }} />
          <div style={{ position: "relative", zIndex: 1, padding: "17px 24px 17px", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <button onClick={onClose} type="button" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", fontSize: "0.88rem", fontWeight: 700, cursor: "pointer" }}>
                <i className="fas fa-arrow-left"></i> {t("Back to Job Order")}
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", fontSize: "0.88rem", fontWeight: 700, cursor: "pointer" }}>
                  <i className="fas fa-palette"></i>
                  {t("Elegant Glass")}
                </button>
                <button onClick={onClose} type="button" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", fontSize: "0.88rem", fontWeight: 700, cursor: "pointer" }}>
                  <i className="fas fa-times"></i> {t("Cancel")}
                </button>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 17, flexWrap: "wrap" }}>
              <div style={{ width: 42, height: 42, borderRadius: "50%", background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)", border: "1px solid #D8E1F7", boxShadow: "0 0 0 4px rgba(101, 92, 255, 0.08), 0 6px 14px rgba(71, 88, 180, 0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5D54FF" }}>
                <i className="fas fa-concierge-bell" style={{ fontSize: 16 }} />
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#102A68", lineHeight: 1.15, letterSpacing: "-0.03em" }}>{t("Add Services to Job Order")}</h1>
                <p style={{ margin: "4px 0 0", fontSize: "0.84rem", color: "#8C9ABF", fontWeight: 600 }}>{order?.id || ""}</p>
              </div>
            </div>
          </div>
        </section>

        <div className="pim-details-body customer-details-body">
          <div className="form-card customer-details-card customer-details-card--wide" style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", border: "1px solid #DDE7F6", borderRadius: 14, boxShadow: "0 10px 28px rgba(51, 84, 160, 0.10)", overflow: "hidden", padding: "18px 20px 20px" }}>
          <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)" }} />
          <div className="form-card-title">
            <i className="fas fa-concierge-bell"></i>
            <h2>{t("Services Selection")}</h2>
          </div>

          <div className="form-card-content">
            <p>{t("Select services for")} {vehicleType}:</p>
            {products.length === 0 ? (
              <div className="empty-state" style={{ padding: "28px 12px" }}>
                <div className="empty-text">{t("No services configured yet")}</div>
                <div className="empty-subtext">{t("Create services from Service Creation before adding to a job order.")}</div>
              </div>
            ) : (
            <>
              <div className="svc-filter-bar">
                <div className="svc-filter-row">
                  <span className="svc-filter-label"><i className="fas fa-tags"></i> {t("Category")}</span>
                  <select
                    className="svc-filter-select"
                    value={asFilterCategory}
                    onChange={(e) => setAsFilterCategory(e.target.value)}
                  >
                    <option value="all">{t("All Categories")}</option>
                    {asCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.nameEn}</option>
                    ))}
                  </select>
                </div>
                <div className="svc-filter-row">
                  <span className="svc-filter-label"><i className="fas fa-layer-group"></i> {t("Type")}</span>
                  <div className="svc-type-pills">
                    <button type="button" className={`svc-type-pill${asFilterType === "all" ? " active" : ""}`} onClick={() => setAsFilterType("all")}>{t("All")}</button>
                    <button type="button" className={`svc-type-pill${asFilterType === "service" ? " active" : ""}`} onClick={() => setAsFilterType("service")}><i className="fas fa-wrench"></i> {t("Services")}</button>
                    <button type="button" className={`svc-type-pill${asFilterType === "package" ? " active" : ""}`} onClick={() => setAsFilterType("package")}><i className="fas fa-box-open"></i> {t("Packages")}</button>
                  </div>
                  <span className="svc-filter-count">{asFilteredProducts.length} of {products.length}</span>
                </div>
              </div>
              {asFilteredProducts.length === 0 ? (
                <div className="empty-state" style={{ padding: "24px 12px" }}>
                  <div className="empty-text">{t("No services match your filter")}</div>
                  <div className="empty-subtext">{t("Try a different category or type.")}</div>
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
                            {t("Package Price Applied")}
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
                                {`${t("Specification")}: ${label}`}
                              </span>
                            ) : t("Specification required before adding this service.");
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
              <h4>{t("Price Summary")}</h4>
              <div className="price-row">
                <span>{packageCount > 0 ? t("Packages & Services:") : t("Services:")}</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              <PermissionGate moduleId="joborder" optionId="joborder_discount_percent">
                <div className="price-row">
                  <span>{t("Apply Discount:")}</span>
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
                  <span>{t("Remaining Allowed Discount:")}</span>
                  <span>
                    {Number(maxAdditionalDiscountPercent.toFixed(2))}% ({formatPrice(maxAdditionalDiscountAmount)})
                  </span>
                </div>
              </PermissionGate>
              {noRemainingDiscountAllowance ? (
                <div className="jo-services-discount-warning">
                  {t("No additional discount can be applied. The order has already reached the role policy discount limit.")}
                </div>
              ) : null}
              <div className="price-row discount-amount">
                <span>{t("Discount Amount:")}</span>
                <span>{formatPrice(discount)}</span>
              </div>
              <div className="price-row total">
                <span>{t("Total:")}</span>
                <span>{formatPrice(total)}</span>
              </div>
            </div>

            <div className="action-buttons">
              <button className="btn btn-secondary" onClick={onClose}>
                {t("Cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => onSubmit({ selectedServices, discountPercent: effectiveDiscountPercent })}
                disabled={isSubmitting || selectedServices.length === 0 || products.length === 0}
              >
                {isSubmitting ? t("Saving...") : t("Add Services")}
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
    </div>
  );
}

function InspectionModal({ item, onClose }: any) {
  const { t } = useLanguage();
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
            <h4>{t("Details")}</h4>
            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">{t("Status")}</span>
                <span className="detail-value">{item.status}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{t("Notes")}</span>
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
  const { t } = useLanguage();
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
    ).trim() || "-";
  const plate = vehicleData?.plateNumber || vehicleData?.license || "N/A";
  const vin = vehicleData?.vin || "Not provided";


  return (
    <div className="form-card confirm-review-card bg-white rounded-2xl border-none shadow-[0_8px_24px_rgba(112,144,176,0.12)] p-6">
      <div className="form-card-title mb-6 flex items-center gap-2">
        <i className="fas fa-check-circle"></i>
        <h2 className="text-lg font-bold text-[#2B3674]">{t("Order Confirmation")}</h2>
      </div>

      <div className="form-card-content">
        {/* Top summary strip similar to screenshot */}
        <div className="jo-confirm-top-strip">
          <div className="jo-confirm-top-strip-left">
            <div className="jo-confirm-order-type-line">
              <i className="fas fa-file-alt"></i>
              <div>
                <div className="jo-confirm-strip-title">{orderType === "service" ? t("Service Order") : t("New Job Order")}</div>
                <div className="jo-confirm-strip-subtitle">
                  {[vehicleData?.make, vehicleData?.model].filter(Boolean).join(" ")} {plate ? `* ${plate}` : ""}
                </div>
              </div>
            </div>
          </div>
          <button className="btn btn-secondary jo-confirm-change-type-btn" onClick={onBack}>
            <i className="fas fa-exchange-alt"></i> {t("Change Selection")}
          </button>
        </div>

        {/* Customer */}
        <section className="jo-confirm-section">
          <h3>
            <i className="fas fa-user"></i> {t("Customer Information")}
          </h3>
          <div className="jo-confirm-grid">
            <div className="jo-confirm-item">
              <span>{t("Customer ID")}</span>
              <strong>{formatCustomerDisplayId(customerData?.id)}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>{t("Customer Name")}</span>
              <strong>{customerData?.name || "N/A"}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>{t("Mobile Number")}</span>
              <strong>{customerMobile}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>{t("Email Address")}</span>
              <strong>{customerData?.email || "Not provided"}</strong>
            </div>
            <div className="jo-confirm-item jo-confirm-item-wide">
              <span>{t("Home Address")}</span>
              <strong>{customerData?.address || t("Not provided")}</strong>
            </div>
            {heardFrom && (
              <div className="jo-confirm-item">
                <span>{t("Heard of us from")}</span>
                <strong>{heardFrom}</strong>
              </div>
            )}
            {heardFrom === "refer_person" && (
              <>
                <div className="jo-confirm-item">
                  <span>{t("Referred Person Name")}</span>
                  <strong>{customerData?.referralPersonName || t("Not provided")}</strong>
                </div>
                <div className="jo-confirm-item">
                  <span>{t("Referred Person Mobile")}</span>
                  <strong>{customerData?.referralPersonMobile || t("Not provided")}</strong>
                </div>
              </>
            )}
            {heardFrom === "social_media" && (
              <div className="jo-confirm-item">
                <span>{t("Social Platform")}</span>
                <strong>{customerData?.socialPlatform || t("Not provided")}</strong>
              </div>
            )}
            {heardFrom === "other" && (
              <div className="jo-confirm-item jo-confirm-item-wide">
                <span>{t("Other Note")}</span>
                <strong>{customerData?.heardFromOtherNote || t("Not provided")}</strong>
              </div>
            )}
            <div className="jo-confirm-item">
              <span>{t("Registered Vehicles")}</span>
              <strong>{customerData?.vehicles?.length ?? customerData?.registeredVehiclesCount ?? 0}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>{t("Completed Services")}</span>
              <strong>{customerData?.completedServicesCount ?? 0}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>{t("Customer Since")}</span>
              <strong>{customerData?.customerSince || t("N/A")}</strong>
            </div>
          </div>
        </section>

        {/* Vehicle */}
        <section className="jo-confirm-section">
          <h3>
            <i className="fas fa-car"></i> {t("Vehicle Information")}
          </h3>
          <div className="jo-confirm-grid">
            <div className="jo-confirm-item">
              <span>{t("Vehicle ID")}</span>
              <strong>{vehicleId}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>{t("Owned By")}</span>
              <strong>{customerData?.name || t("N/A")}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>{t("Make")}</span>
              <strong>{vehicleData?.make || vehicleData?.factory || t("N/A")}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>{t("Model")}</span>
              <strong>{vehicleData?.model || t("N/A")}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>{t("Year")}</span>
              <strong>{vehicleData?.year || t("N/A")}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>{t("Color")}</span>
              <strong>{vehicleData?.color || t("N/A")}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>{t("Plate Number")}</span>
              <strong>{plate}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>{t("VIN")}</span>
              <strong>{vin}</strong>
            </div>
            <div className="jo-confirm-item">
              <span>{t("Vehicle Type")}</span>
              <strong>{vehicleType}</strong>
            </div>
          </div>
        </section>

        {/* Selected services table */}
        <section className="jo-confirm-section">
          <h3>
            <i className="fas fa-clipboard-list"></i> {t("Selected Services")}
          </h3>

          <div className="jo-confirm-table-wrap">
            <table className="jo-confirm-services-table">
              <thead>
                <tr>
                  <th>{t("Service Name")}</th>
                  <th style={{ textAlign: "right" }}>{t("Price")}</th>
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
                          {group.packageTitle ? t("Included in package") : formatPrice(service.price || 0)}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {selectedServices.length === 0 && (
                  <tr>
                    <td colSpan={2} style={{ textAlign: "center", color: "#64748b" }}>
                      {t("No services selected")}
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
            <i className="fas fa-calculator"></i> {t("Price Summary")}
          </h3>
          <div className="jo-price-summary-grid">
            <div className="jo-price-box">
              <div className="jo-price-row">
                <span>{t("Subtotal")}</span>
                <strong>{formatPrice(subtotal)}</strong>
              </div>
              <div className="jo-price-row">
                <span>{`${t("Discount")} (${Number(discountPercent.toFixed(2))}%)`}</span>
                <strong>- {formatPrice(discount)}</strong>
              </div>
            </div>

            <div className="jo-price-box jo-price-box-total">
              <div className="jo-price-row">
                <span>{t("Total")}</span>
                <strong>{formatPrice(total)}</strong>
              </div>
            </div>
          </div>
        </section>

        {(orderNotes || expectedDeliveryDate || expectedDeliveryTime) && (
          <section className="jo-confirm-section">
            <h3>
              <i className="fas fa-info-circle"></i> {t("Additional Information")}
            </h3>
            <div className="jo-confirm-grid">
              <div className="jo-confirm-item">
                <span>{t("Expected Delivery Date")}</span>
                <strong>{expectedDeliveryDate || t("Not specified")}</strong>
              </div>
              <div className="jo-confirm-item">
                <span>{t("Expected Delivery Time")}</span>
                <strong>{expectedDeliveryTime || t("Not specified")}</strong>
              </div>
              <div className="jo-confirm-item jo-confirm-item-wide">
                <span>{t("Notes / Comments")}</span>
                <strong style={{ whiteSpace: "pre-wrap" }}>{orderNotes || t("No notes")}</strong>
              </div>
            </div>
          </section>
        )}
      </div>

      <div className="action-buttons confirm-action-buttons mt-8 flex flex-wrap justify-end gap-3">
        <button className="btn btn-secondary bg-white text-[#2B3674] border border-[#E7EDF8] rounded-xl px-6 py-3 font-bold hover:bg-[#F4F7FE]" onClick={onBack} disabled={isSubmitting}>
          {t("Back")}
        </button>
        <button className="btn btn-primary bg-[#4318FF] text-white rounded-xl px-6 py-3 font-bold hover:bg-[#3A14DF] transition-all shadow-[0_8px_22px_rgba(67,24,255,0.25)]" onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <i className="fas fa-spinner fa-spin" style={{ marginRight: 8 }}></i>
              {t("Creating...")}
            </>
          ) : (
            t("Submit Order")
          )}
        </button>
      </div>
    </div>
  );
}

// ============================================
// SIMPLE DISPLAY CARDS
// ============================================
function JobOrderSummaryCard({ order, actorMap, className = "" }: any) {
  const createdBy = resolveCreatedBy(order, actorMap);
  return (
    <UnifiedJobOrderSummaryCard
      order={order}
      identityToUsernameMap={actorMap}
      createdByOverride={createdBy}
      className={className}
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

function ServicesCard({ order, onAddService, className = "" }: any) {
  const { t } = useLanguage();
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
    <div className={`pim-detail-card customer-details-card ${className}`.trim()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
        <h3 className="customer-details-card-title" style={{ margin: 0 }}>
          <i className="fas fa-tasks"></i> {t("Services Summary")} ({order.services?.length || 0})
        </h3>
        <PermissionGate moduleId="joborder" optionId="joborder_addservice">
          <button className="btn-add-service" onClick={onAddService} style={{ whiteSpace: 'nowrap', padding: '8px 14px', fontSize: '13px', background: '#0891b2', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <i className="fas fa-plus-circle"></i> {t("Add Service")}
          </button>
        </PermissionGate>
      </div>

      {serviceProgress.progress && (
        <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ flex: 1, height: '6px', background: '#E5E7EB', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: `${serviceProgress.progress.percent}%`, height: '100%', background: '#05CD99', transition: 'width 0.3s' }}></div>
          </div>
          <span style={{ fontSize: '12px', color: '#A3AED0', fontWeight: '600', whiteSpace: 'nowrap' }}>{serviceProgress.progress.label}</span>
        </div>
      )}

      <div className="pim-services-list">
        {order.services && order.services.length > 0 ? (
          groupServicesByPackage(order.services).map((group: any) => (
            <Fragment key={group.key}>
              {group.packageTitle && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: '12px 0', borderBottom: '1px solid #F1F4FA', marginBottom: '8px' }}>
                  <span style={{ fontWeight: '600', color: '#2B3674' }}>
                    <i className="fas fa-box-open" style={{ marginRight: '8px', color: '#A3AED0' }}></i>
                    {group.packageTitle}
                  </span>
                  <span style={{ fontWeight: '700', color: '#2B3674' }}>{`QAR ${(group.packagePrice ?? 0).toLocaleString()}`}</span>
                </div>
              )}
              {group.items.map((service: any, idx: number) => (
                <div key={`${group.key}-${idx}`} style={{ paddingBottom: '12px', borderBottom: '1px solid #F1F4FA', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontWeight: '600', color: '#2B3674' }} data-no-translate="true">{getServiceDisplayName(service)}</span>
                    <span style={{ fontSize: '13px', color: '#A3AED0' }}>
                      {group.packageTitle ? t("Included in package") : service.price ? `QAR ${service.price.toLocaleString()}` : t("N/A")}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gap: '6px', fontSize: '13px' }}>
                    {getServiceSpecificationLabel(service) && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                        <span style={{ color: '#A3AED0', fontWeight: '600' }}>{t("Specification")}:</span>
                        <div>{renderServiceSpecificationBadges(service)}</div>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <span style={{ color: '#A3AED0', fontWeight: '600' }}>{t("Status")}:</span>
                      <span style={{ color: '#2B3674', fontWeight: '600' }}>{service.status || t("N/A")}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <span style={{ color: '#A3AED0', fontWeight: '600' }}>{t("Technician")}:</span>
                      <span style={{ color: '#2B3674', fontWeight: '600' }}>{resolveCompletedServiceActor(service)}</span>
                    </div>
                    {service.started && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                        <span style={{ color: '#A3AED0', fontWeight: '600' }}>{t("Started")}:</span>
                        <span style={{ color: '#2B3674', fontWeight: '600' }}>{service.started}</span>
                      </div>
                    )}
                    {service.ended && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                        <span style={{ color: '#A3AED0', fontWeight: '600' }}>{t("Ended")}:</span>
                        <span style={{ color: '#2B3674', fontWeight: '600' }}>{service.ended}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <span style={{ color: '#A3AED0', fontWeight: '600' }}>{t("Duration")}:</span>
                      <span style={{ color: '#2B3674', fontWeight: '600' }}>{formatServiceDuration(service.started, service.ended)}</span>
                    </div>
                    {service.notes && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                        <span style={{ color: '#A3AED0', fontWeight: '600' }}>{t("Notes")}:</span>
                        <span style={{ color: '#2B3674', fontWeight: '600' }}>{service.notes}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </Fragment>
          ))
        ) : (
          <div style={{ textAlign: "center", padding: "30px", margin: '0', color: '#A3AED0' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>
              <i className="fas fa-clipboard-list"></i>
            </div>
            <div style={{ fontSize: '16px', color: '#2B3674', fontWeight: '600', marginBottom: '6px' }}>{t("No services added yet")}</div>
            <div style={{ fontSize: '13px', color: '#A3AED0' }}>{t("Click \"Add Service\" to add services to this job order")}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function BillingCard({ order, className = "" }: any) {
  const { t } = useLanguage();
  const billing = order?.billing || {};
  const summaryCells = [
    { key: "total", label: t("Total Amount"), value: joFirst(billing?.totalAmount, order?.totalAmount, "N/A") },
    { key: "discount", label: t("Discount"), value: joFirst(billing?.discount, order?.discountAmount, "N/A") },
    { key: "net", label: t("Net Amount"), value: joFirst(billing?.netAmount, order?.netAmount, "N/A") },
    { key: "payment", label: t("Payment Status"), value: normalizePaymentStatusLabel(order?.paymentStatus) },
  ];

  return (
    <div className={`customer-details-card customer-details-card--wide bg-white rounded-2xl border-none shadow-[0_8px_24px_rgba(112,144,176,0.12)] p-6 ${className}`.trim()}>
      <div className="mb-6 flex items-center gap-2">
        <i className="fas fa-file-invoice-dollar text-[#2B3674]"></i>
        <h3 className="customer-details-card-title text-lg font-bold text-[#2B3674]">{t("Billing & Invoices")}</h3>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {summaryCells.map((cell) => (
          <div key={cell.key} className="customer-details-info-row">
            <span className="customer-details-info-label">{cell.label}</span>
            <span className="customer-details-info-value">{joFirst(cell.value, "N/A")}</span>
          </div>
        ))}
      </div>

      <UnifiedBillingInvoicesSection order={order} className="customer-details-unified-billing" style={{ gridColumn: "span 12" }} />
    </div>
  );
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

function JobOrderDocumentsCard({ order, className = "" }: any) {
  const { t } = useLanguage();
  const { canOption } = usePermissions();
  const docs: DocUi[] = filterVisibleDocuments(Array.isArray(order?.documents) ? order.documents : [], canOption);

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
    <div className={`customer-details-card customer-details-card--wide bg-white rounded-2xl border-none shadow-[0_8px_24px_rgba(112,144,176,0.12)] p-6 ${className}`.trim()}>
      <div className="mb-6 flex items-center gap-2">
        <i className="fas fa-folder-open text-[#2B3674]"></i>
        <h3 className="customer-details-card-title text-lg font-bold text-[#2B3674]">{t("Documents")} ({docs.length})</h3>
      </div>

      {docs.length ? (
        <div className="flex flex-col gap-3">
          {docs.map((d, idx) => {
            const name = String(d?.name ?? "").trim() || `Document ${idx + 1}`;
            const raw = String(d?.storagePath || d?.url || "").trim();
            const generatedAt = docGeneratedAt(d);
            const typeAndCategory = [d?.type, d?.category].filter(Boolean).join(" / ") || "N/A";

            return (
              <div key={d?.id ?? `${name}-${idx}`} className="customer-details-info-row rounded-xl border border-[#F1F4FA] p-4">
                <div className="border-b border-[#F1F4FA] pb-3">
                  <span className="customer-details-info-label">{t("Document")}</span>
                  <span className="customer-details-info-value">{name}</span>
                </div>
                <div className="mt-3 border-b border-[#F1F4FA] pb-3">
                  <span className="customer-details-info-label">{t("Type")}</span>
                  <span className="customer-details-info-value">{typeAndCategory}</span>
                </div>
                <div className="mt-3 border-b border-[#F1F4FA] pb-3">
                  <span className="customer-details-info-label">{t("Generated")}</span>
                  <span className="customer-details-info-value">{joFirst(generatedAt, "N/A")}</span>
                </div>
                <div className="mt-3">
                  <span className="customer-details-info-label">{t("Action")}</span>
                  <PermissionGate moduleId="joborder" optionId="joborder_download">
                    <button
                      type="button"
                      disabled={!raw}
                      onClick={async () => {
                        await downloadDocument(raw);
                      }}
                      className="mt-2 rounded-xl bg-[#4318FF] px-6 py-3 text-sm font-bold text-white transition-all hover:bg-[#3A14DF] shadow-[0_8px_22px_rgba(67,24,255,0.25)] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-[#A3AED0]"
                      title={!raw ? t("No file path/url available") : t("Download")}
                    >
                      <i className="fas fa-download mr-2" />
                      {t("Download")}
                    </button>
                  </PermissionGate>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm font-semibold text-[#64748b]">
          {t("No documents available.")}
        </div>
      )}
    </div>
  );
}
// ============================================
// NEW: QUALITY CHECK CARD
// ============================================
function QualityCheckCard({ order, className = "" }: any) {
  const { t } = useLanguage();
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
      return { label: t("Pass"), className: "pass" };
    }
    if (normalized === "failed" || normalized === "fail") {
      return { label: t("Failed"), className: "failed" };
    }
    if (normalized === "acceptable") {
      return { label: t("Acceptable"), className: "acceptable" };
    }

    if (!normalized || normalized === "not-evaluated" || normalized === "n-a" || normalized === "na" || normalized === "pending") {
      return { label: t("Not Evaluated"), className: "not-evaluated" };
    }

    return {
      label: String(raw ?? t("Not Evaluated")).trim() || t("Not Evaluated"),
      className: "not-evaluated",
    };
  };

  return (
    <div className={`customer-details-card customer-details-card--wide bg-white rounded-2xl border-none shadow-[0_8px_24px_rgba(112,144,176,0.12)] p-6 ${className}`.trim()}>
      <div className="mb-6 flex items-center gap-2">
        <i className="fas fa-check-circle text-[#2B3674]"></i>
        <h3 className="customer-details-card-title text-lg font-bold text-[#2B3674]">{t("Quality Check List")}</h3>
      </div>

      {services.length > 0 ? (
        <div className="flex flex-col gap-3">
          {services.map((service: any, idx: number) => {
            const serviceName = typeof service === "string" ? service : joFirst(service?.name, `Service ${idx + 1}`);
            const qc = normalizeQcResult(getServiceQcResult(service));
            const tech = resolveCompletedServiceActor(service);

            return (
              <div key={`${serviceName}-${idx}`} className="customer-details-info-row rounded-xl border border-[#F1F4FA] p-4">
                <div className="border-b border-[#F1F4FA] pb-3">
                  <span className="customer-details-info-label">{t("Service")}</span>
                  <span className="customer-details-info-value">{serviceName}</span>
                </div>
                <div className="mt-3 border-b border-[#F1F4FA] pb-3">
                  <span className="customer-details-info-label">{t("Result")}</span>
                  <span
                    className="mt-1 inline-flex rounded-full px-2 py-1 text-xs font-bold text-white"
                    style={{ background: qc.className === "pass" ? "#05CD99" : qc.className === "failed" ? "#DC2626" : qc.className === "acceptable" ? "#FFA234" : "#8F9BBA" }}
                  >
                    {qc.label}
                  </span>
                </div>
                <div className="mt-3">
                  <span className="customer-details-info-label">{t("Technician")}</span>
                  <span className="customer-details-info-value">{tech}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm font-semibold text-[#64748b]">
          {t("No services to evaluate")}
        </div>
      )}
    </div>
  );
}

// ============================================
// NEW: DELIVERY TRACKING CARD
// ============================================
function DeliveryTrackingCard({ order, className = "" }: any) {
  const { t } = useLanguage();
  const delivery = order.deliveryInfo || {};
  
  if (!delivery.expected && !delivery.actual && !delivery.estimatedHours && !delivery.actualHours) return null;

  const deliveryItems = [
    {
      key: "expected-date",
      label: `${t("Expected Date")}:`,
      value: delivery.expectedDate || t("Not provided"),
    },
    {
      key: "expected-time",
      label: `${t("Expected Time")}:`,
      value: delivery.expectedTime || t("Not provided"),
    },
    {
      key: "estimated-duration",
      label: `${t("Estimated Duration")}:`,
      value: delivery.estimatedHours || t("Not provided"),
    },
  ];

  return (
    <div className={`customer-details-card customer-details-card--wide bg-white rounded-2xl border-none shadow-[0_8px_24px_rgba(112,144,176,0.12)] p-6 ${className}`.trim()}>
      <div className="mb-6 flex items-center gap-2">
        <i className="fas fa-truck text-[#2B3674]"></i>
        <h3 className="customer-details-card-title text-lg font-bold text-[#2B3674]">{t("Delivery & Time Tracking")}</h3>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {deliveryItems.map((item) => (
          <div key={item.key} className="customer-details-info-row">
            <span className="customer-details-info-label">{item.label}</span>
            <span className="customer-details-info-value">{joFirst(item.value, "N/A")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// ROADMAP CARD - Timeline Visualization
// ============================================
function RoadmapCard({ order, actorMap, className = "" }: any) {
  const { t } = useLanguage();
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
  

  // FIX: better actor resolution to avoid wrong field

  const getStatusLabel = (step: any) => step?.stepStatus || step?.status || "Pending";

  return (
    <div className={`customer-details-card customer-details-card--wide bg-white rounded-2xl border-none shadow-[0_8px_24px_rgba(112,144,176,0.12)] p-6 ${className}`.trim()}>
      <div className="mb-6 flex items-center gap-2">
        <i className="fas fa-route text-[#2B3674]"></i>
        <h3 className="customer-details-card-title text-lg font-bold text-[#2B3674]">{t("Job Order Roadmap")}</h3>
      </div>

      <div className="flex flex-col gap-3">
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
          const statusColor = stepClass === 'active' ? '#39BFFF' : stepClass === 'completed' ? '#05CD99' : '#8F9BBA';

          return (
            <div key={idx} className="rounded-xl border border-[#F1F4FA] p-4">
              <div className="border-b border-[#F1F4FA] pb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#A3AED0]">{t("Step")}</span>
                <div className="flex items-center gap-2">
                  <span
                    style={{ background: statusColor }}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs text-white"
                  >
                    <i className={`fas ${getStepIcon(step.step)}`}></i>
                  </span>
                  <span className="mt-1 block text-sm font-bold text-[#2B3674]">{stepLabel}</span>
                </div>
              </div>
              <div className="mt-3 border-b border-[#F1F4FA] pb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#A3AED0]">{t("Status")}</span>
                <span className="mt-1 block text-sm font-bold text-[#2B3674]">{getStatusLabel(step)}</span>
              </div>
              <div className="mt-3 border-b border-[#F1F4FA] pb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#A3AED0]">{t("Started")}</span>
                <span className="mt-1 block text-sm font-bold text-[#2B3674]">{inferredStartedAt || t("Not started")}</span>
              </div>
              <div className="mt-3 border-b border-[#F1F4FA] pb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#A3AED0]">{t("Completed")}</span>
                <span className="mt-1 block text-sm font-bold text-[#2B3674]">{completedLabel}</span>
              </div>

              <div className="mt-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#A3AED0]">{t("Action done by")}</span>
                <span className="mt-1 block text-sm font-bold text-[#2B3674]">{actor || t("Not assigned")}</span>
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
  const { t } = useLanguage();
  return (
    <div className="form-card bg-white rounded-2xl border-none shadow-[0_8px_24px_rgba(112,144,176,0.12)] p-6">
      <div className="form-card-title mb-6 flex items-center gap-2">
        <i className="fas fa-list-check"></i>
        <h2 className="text-lg font-bold text-[#2B3674]">{t("Select Order Type")}</h2>
      </div>
      <div className="form-card-content">
        <p className="mb-5 text-sm text-[#A3AED0]">
          {t("This vehicle has")} {vehicleCompletedServices.length} {t("completed service(s). Choose the type of order you want to create:")}
        </p>

        <div className="option-selector grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className={`option-btn rounded-xl border px-4 py-4 font-bold transition-all cursor-pointer ${orderType === "new" ? "bg-[#4318FF] text-white border-[#4318FF]" : "bg-[#F4F7FE] text-[#A3AED0] border-[#E7EDF8]"}`} onClick={() => onSelectOrderType("new")}>
            <i className="fas fa-file-alt" style={{ marginRight: "8px" }}></i>
            {t("New Job Order")}
          </div>
          <div className={`option-btn rounded-xl border px-4 py-4 font-bold transition-all cursor-pointer ${orderType === "service" ? "bg-[#4318FF] text-white border-[#4318FF]" : "bg-[#F4F7FE] text-[#A3AED0] border-[#E7EDF8]"}`} onClick={() => onSelectOrderType("service")}>
            <i className="fas fa-tools" style={{ marginRight: "8px" }}></i>
            {t("Service Order")}
          </div>
        </div>
      </div>

      <div className="action-buttons mt-8 flex justify-end">
        <button className="btn btn-secondary bg-white text-[#2B3674] border border-[#E7EDF8] rounded-xl px-6 py-3 font-bold hover:bg-[#F4F7FE]" onClick={onBack}>
          <i className="fas fa-arrow-left" style={{ marginRight: "8px" }}></i>
          {t("Back")}
        </button>
      </div>
    </div>
  );
}

function NoCompletedServicesMessage({ onNext, onBack }: any) {
  const { t } = useLanguage();
  return (
    <div className="form-card bg-white rounded-2xl border-none shadow-[0_8px_24px_rgba(112,144,176,0.12)] p-6">
      <div className="form-card-title mb-6 flex items-center gap-2">
        <i className="fas fa-info-circle"></i>
        <h2 className="text-lg font-bold text-[#2B3674]">{t("Order Type")}</h2>
      </div>
      <div className="form-card-content">
        <div className="mb-5 rounded-xl border border-[#E7EDF8] bg-[#F4F7FE] p-4 text-sm">
          <i className="fas fa-exclamation-circle mr-2 text-[#A3AED0]" />
          <span className="font-semibold text-[#2B3674]">
            {t("This vehicle has no completed services yet. Proceeding with New Job Order.")}
          </span>
        </div>
      </div>

      <div className="action-buttons jo-services-actions mt-8 flex flex-wrap justify-end gap-3">
        <button className="btn btn-secondary bg-white text-[#2B3674] border border-[#E7EDF8] rounded-xl px-6 py-3 font-bold hover:bg-[#F4F7FE]" onClick={onBack}>
          {t("Back")}
        </button>
        <button className="btn btn-primary bg-[#4318FF] text-white rounded-xl px-6 py-3 font-bold hover:bg-[#3A14DF] transition-all shadow-[0_8px_22px_rgba(67,24,255,0.25)]" onClick={onNext}>
          {t("Continue")}
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


