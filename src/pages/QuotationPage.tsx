import { useEffect, useMemo, useState } from "react";
import { useGlobalLoading } from "../utils/GlobalLoadingContext";
import { jsPDF } from "jspdf";
import "./QuotationPage.css";
import PermissionGate from "./PermissionGate";
import { useLanguage } from "../i18n/LanguageContext";
import { usePermissions } from "../lib/userPermissions";
import { getDataClient } from "../lib/amplifyClient";
import logo from "../assets/logo.jpeg";
import {
  listServiceCatalog,
  resolveServicePriceForVehicleType,
  type ServiceCatalogItem,
} from "./serviceCatalogRepo";
import {
  clampTotalDiscountAmount,
  computeCumulativeDiscountAllowance,
  resolveCentralDiscountPercent,
  toCurrencyNumber,
} from "../utils/discountPolicy";
import { summarizeServicesSubtotalPackageAware } from "../utils/billingFinance";

type QuotationLine = {
  name: string;
  nameAr?: string;
  price: number;
  serviceCode?: string;
  catalogId?: string;
  packageCode?: string;
  packageName?: string;
  packageNameAr?: string;
  packagePrice?: number;
};

type QuotationDisplayLine = {
  key: string;
  label: string;
  price: number | null;
  isPackage: boolean;
  isIncludedService: boolean;
};

type CustomerInfo = {
  fullName: string;
  mobile: string;
  email: string;
  vehiclePlate: string;
  vehicleType: string;
  notes: string;
};

type QuotationHistoryRow = {
  id: string;
  quoteNumber: string;
  customerName: string;
  customerMobile: string;
  customerEmail: string;
  vehicleType: string;
  vehiclePlate: string;
  subtotal: number;
  discountAmount: number;
  netAmount: number;
  validityUntil: string;
  servicesJson: string;
  customerNotes: string;
  remarksEn: string;
  remarksAr: string;
  generatedBy: string;
  createdAt: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toDateInputValue(date: Date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function parseDateInputValue(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function dt(value: unknown): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateInput(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

function resolveValidityWindow(issuedAt: Date, selectedDateValue: string) {
  const issued = new Date(issuedAt.getFullYear(), issuedAt.getMonth(), issuedAt.getDate());
  const requested = parseDateInputValue(selectedDateValue);
  const fallback = addDays(issued, 7);
  const safeValidUntil = requested && requested.getTime() >= issued.getTime() ? requested : fallback;
  const safeValidityDays = Math.max(1, Math.ceil((safeValidUntil.getTime() - issued.getTime()) / DAY_MS));
  return { safeValidUntil, safeValidityDays };
}

function buildDefaultRemarkEnglish(validityDays: number) {
  return [
    "1) The customer agrees to the terms and conditions mentioned in the vehicle receipt paper and the services mentioned in this invoice.",
    "2) Warranty terms and conditions apply to the services provided in this invoice and it is the customer's responsibility to read them before ordering the services.",
    `3) This quotation is valid for ${validityDays} day(s) from issuance date.`,
  ].join("\n");
}

function buildDefaultRemarkArabic(validityDays: number) {
  return [
    "1) يوافق العميل على الشروط والأحكام المذكورة في ورقة استلام المركبة والخدمات المذكورة في هذه الفاتورة.",
    "2) تنطبق شروط وأحكام الضمان على الخدمات المقدمة في هذه الفاتورة وتقع مسؤولية قراءتها على العميل قبل طلب الخدمات.",
    `3) عرض السعر هذا صالح لمدة ${validityDays} يومًا من تاريخ الإصدار.`,
  ].join("\n");
}

function getDefaultRemarks(validityDateValue: string) {
  const { safeValidityDays } = resolveValidityWindow(new Date(), validityDateValue);
  return {
    english: buildDefaultRemarkEnglish(safeValidityDays),
    arabic: buildDefaultRemarkArabic(safeValidityDays),
  };
}

function normalizeMultilineText(value: unknown) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function toMoney(value: unknown) {
  return Math.max(0, toCurrencyNumber(value));
}

function formatMoney(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function toBilingualName(nameEn: unknown, nameAr: unknown, fallback = "Unnamed service") {
  const en = String(nameEn || "").trim();
  const ar = String(nameAr || "").trim();
  if (en && ar) return `${en} / ${ar}`;
  return en || ar || fallback;
}

function hasArabicChars(value: string) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

function splitBilingualLabel(label: string) {
  const normalized = safeText(label);
  if (!normalized) return { en: "", ar: "" };

  const slashParts = normalized.split("/").map((part) => part.trim()).filter(Boolean);
  if (slashParts.length >= 2) {
    return {
      en: slashParts[0] || "",
      ar: slashParts.slice(1).join(" / "),
    };
  }

  if (hasArabicChars(normalized)) return { en: "", ar: normalized };
  return { en: normalized, ar: "" };
}

function dedupeServices(items: QuotationLine[]) {
  const out: QuotationLine[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const code = normalizeKey(item.serviceCode || item.catalogId || item.name);
    const packageCode = normalizeKey(item.packageCode);
    const key = packageCode ? `${packageCode}::${code}` : code;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function extractQuotationIncludedServiceLabels(item: QuotationLine): string[] {
  const rawCandidates = [
    (item as any)?.includedServices,
    (item as any)?.includedServiceNames,
    (item as any)?.services,
    (item as any)?.items,
  ];

  for (const candidate of rawCandidates) {
    if (!Array.isArray(candidate)) continue;
    const labels = candidate
      .map((entry: any) => {
        if (typeof entry === "string") return entry.trim();
        return toBilingualName(entry?.name, entry?.nameAr, String(entry?.serviceName ?? entry?.title ?? "").trim() || "Service");
      })
      .filter(Boolean);
    if (labels.length > 0) return labels;
  }

  return [];
}

function buildQuotationDisplayLines(items: QuotationLine[], t: (englishText: string) => string): QuotationDisplayLine[] {
  const packageMap = new Map<
    string,
    {
      title: string;
      packagePrice: number | null;
      fallbackTotal: number;
      includedServices: string[];
    }
  >();
  const packageOrder: string[] = [];
  const standalone: QuotationDisplayLine[] = [];

  for (const item of items) {
    const serviceLabel = toBilingualName(item.name, item.nameAr, t("Service"));
    const servicePrice = Math.max(0, toMoney(item.price));
    const packageCode = normalizeKey(item.packageCode);
    const packageName = String(item.packageName || item.packageNameAr || item.packageCode || "").trim();
    const packageKey = packageCode || (packageName ? `pkg:${normalizeKey(packageName)}` : "");
    const includedFromPayload = extractQuotationIncludedServiceLabels(item);
    const fallbackPackageKey = `pkg:${normalizeKey(item.packageName || item.packageCode || item.name || item.serviceCode || item.catalogId || "package")}`;
    const effectivePackageKey = packageKey || (includedFromPayload.length > 0 ? fallbackPackageKey : "");

    if (!effectivePackageKey) {
      standalone.push({
        key: `single:${serviceLabel}:${standalone.length}`,
        label: serviceLabel,
        price: servicePrice,
        isPackage: false,
        isIncludedService: false,
      });
      continue;
    }

    const current = packageMap.get(effectivePackageKey);
    if (!current) packageOrder.push(effectivePackageKey);

    const packagePriceRaw = toMoney(item.packagePrice);
    const packagePrice = packagePriceRaw > 0 ? packagePriceRaw : null;
    const includedLabels = packageKey ? [serviceLabel] : includedFromPayload;
    const mergedIncluded = Array.from(new Set([...(current?.includedServices ?? []), ...includedLabels]));

    packageMap.set(effectivePackageKey, {
      title: packageName || t("Package"),
      packagePrice: current?.packagePrice ?? packagePrice,
      fallbackTotal: (current?.fallbackTotal ?? 0) + servicePrice,
      includedServices: mergedIncluded,
    });
  }

  const grouped: QuotationDisplayLine[] = [];
  for (const key of packageOrder) {
    const group = packageMap.get(key);
    if (!group) continue;

    grouped.push({
      key: `pkg:${key}`,
      label: `${t("Package")}: ${group.title}`,
      price: group.packagePrice ?? group.fallbackTotal,
      isPackage: true,
      isIncludedService: false,
    });

    group.includedServices.forEach((serviceLabel, idx) => {
      grouped.push({
        key: `pkg:${key}:svc:${idx}`,
        label: `  - ${serviceLabel}`,
        price: null,
        isPackage: false,
        isIncludedService: true,
      });
    });
  }

  return [...grouped, ...standalone];
}

function expandCatalogProduct(product: ServiceCatalogItem, allCatalog: ServiceCatalogItem[], vehicleType: string): QuotationLine[] {
  const isPackage = String(product.type || "").toLowerCase() === "package";
  const productCode = String(product.serviceCode || product.id || product.name || "").trim();
  if (!productCode) return [];

  if (!isPackage) {
    return [
      {
        name: product.name,
        nameAr: product.nameAr,
        price: resolveServicePriceForVehicleType(product, vehicleType),
        serviceCode: product.serviceCode || undefined,
        catalogId: product.id || undefined,
      },
    ];
  }

  const byCode = new Map<string, ServiceCatalogItem>();
  for (const candidate of allCatalog) {
    const code = normalizeKey(candidate.serviceCode || candidate.id || candidate.name);
    if (!code) continue;
    byCode.set(code, candidate);
  }

  const includedCodes = Array.isArray(product.includedServiceCodes) ? product.includedServiceCodes : [];
  const resolvedPackagePrice = Math.max(0, toMoney(resolveServicePriceForVehicleType(product, vehicleType)));

  const expanded = includedCodes
    .map((code) => byCode.get(normalizeKey(code)))
    .filter((child): child is ServiceCatalogItem => Boolean(child))
    .map((child) => ({
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

  if (expanded.length > 0) return dedupeServices(expanded);

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

function safeText(value: unknown) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function drawArabicLine(
  doc: jsPDF,
  text: string,
  xRightMm: number,
  yTopMm: number,
  maxWidthMm: number,
  fontPx: number,
  style: "normal" | "italic" | "bold" | "bolditalic",
  colorHex = "#181818",
) {
  if (typeof document === "undefined") {
    doc.setFont("helvetica", style === "bolditalic" ? "bold" : style === "bold" ? "bold" : "normal");
    doc.setFontSize(fontPx);
    doc.text(text, xRightMm, yTopMm + 3.4, { align: "right" });
    return;
  }

  const pxPerMm = 96 / 25.4;
  const scale = 2;
  const lineH = Math.max(4.4, fontPx * 0.45);
  const widthPx = Math.max(1, Math.ceil(maxWidthMm * pxPerMm * scale));
  const heightPx = Math.max(1, Math.ceil(lineH * pxPerMm * scale));
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    doc.setFont("helvetica", style === "bolditalic" ? "bold" : style === "bold" ? "bold" : "normal");
    doc.setFontSize(style === "bolditalic" ? 12 : 9);
    doc.text(text, xRightMm, yTopMm + 3.4, { align: "right" });
    return;
  }

  const fontWeight = style.includes("bold") ? "700" : "400";
  const fontStyle = style.includes("italic") ? "italic" : "normal";
  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = colorHex;
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = `${fontStyle} ${fontWeight} ${Math.round(fontPx * scale)}px Tahoma, Arial, \"Segoe UI\", sans-serif`;
  ctx.fillText(text, widthPx - 2, heightPx / 2 + 0.5);

  doc.addImage(canvas.toDataURL("image/png"), "PNG", xRightMm - maxWidthMm, yTopMm, maxWidthMm, lineH);
}

function splitArabicTextToLines(
  text: string,
  maxWidthMm: number,
  fontPx: number,
  style: "normal" | "italic" | "bold" | "bolditalic",
) {
  const normalized = String(text ?? "").trim();
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
  ctx.font = `${fontStyle} ${fontWeight} ${Math.round(fontPx * scale)}px Tahoma, Arial, "Segoe UI", sans-serif`;

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
}

function drawWrappedArabicLines(
  doc: jsPDF,
  text: string,
  xRightMm: number,
  yTopMm: number,
  maxWidthMm: number,
  fontPx: number,
  style: "normal" | "italic" | "bold" | "bolditalic",
  colorHex = "#181818",
  lineGapMm = 0.8,
) {
  const lineHeightMm = 4.4 + lineGapMm;
  const lines = splitArabicTextToLines(text, maxWidthMm, fontPx, style);
  lines.forEach((line, idx) => {
    drawArabicLine(doc, line, xRightMm, yTopMm + idx * lineHeightMm, maxWidthMm, fontPx, style, colorHex);
  });
  return lines.length;
}

function drawPdfSmartText(
  doc: jsPDF,
  value: string,
  xLeftMm: number,
  baselineYMm: number,
  maxWidthMm: number,
  fontPx: number,
  style: "normal" | "italic" | "bold" | "bolditalic" = "normal",
  colorHex = "#111827"
) {
  const safeValue = safeText(value) || "-";
  if (hasArabicChars(safeValue)) {
    drawArabicLine(doc, safeValue, xLeftMm + maxWidthMm, baselineYMm - 3.4, maxWidthMm, fontPx, style, colorHex);
    return;
  }

  doc.setFont("helvetica", style === "bolditalic" ? "bold" : style === "bold" ? "bold" : "normal");
  doc.setFontSize(fontPx);
  doc.setTextColor(colorHex);
  const clipped = doc.splitTextToSize(safeValue, maxWidthMm) as string[];
  doc.text(String(clipped[0] || "-"), xLeftMm, baselineYMm);
}

export default function QuotationPage({ currentUser }: { currentUser?: any; permissions?: any }) {
  const { t } = useLanguage();
  const { canOption, getOptionNumber } = usePermissions();
  const { withLoading } = useGlobalLoading();
  const client = useMemo(() => getDataClient(), []);

  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [status, setStatus] = useState("");

  const [customer, setCustomer] = useState<CustomerInfo>({
    fullName: "",
    mobile: "",
    email: "",
    vehiclePlate: "",
    vehicleType: "SUV",
    notes: "",
  });

  const [selectedCatalogIds, setSelectedCatalogIds] = useState<string[]>([]);
  const [selectedServiceCategory, setSelectedServiceCategory] = useState("all");
  const [serviceSearchTerm, setServiceSearchTerm] = useState("");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [validityUntilDate, setValidityUntilDate] = useState(() => toDateInputValue(addDays(new Date(), 7)));
  const [remarkEnTouched, setRemarkEnTouched] = useState(false);
  const [remarkArTouched, setRemarkArTouched] = useState(false);
  const [remarkEnglish, setRemarkEnglish] = useState(() => buildDefaultRemarkEnglish(7));
  const [remarkArabic, setRemarkArabic] = useState(() => buildDefaultRemarkArabic(7));
  const [quotationHistoryOpen, setQuotationHistoryOpen] = useState(false);
  const [quotationHistoryLoading, setQuotationHistoryLoading] = useState(false);
  const [quotationHistoryRows, setQuotationHistoryRows] = useState<QuotationHistoryRow[]>([]);
  const [quotationHistorySearch, setQuotationHistorySearch] = useState("");
  const [quotationHistoryDateFrom, setQuotationHistoryDateFrom] = useState("");
  const [quotationHistoryDateTo, setQuotationHistoryDateTo] = useState("");

  const filteredQuotationHistoryRows = useMemo(() => {
    const q = normalizeKey(quotationHistorySearch);
    return quotationHistoryRows.filter((row) => {
      const created = row.createdAt ? dateInput(new Date(row.createdAt)) : "";
      const fromOk = !quotationHistoryDateFrom || (created && created >= quotationHistoryDateFrom);
      const toOk = !quotationHistoryDateTo || (created && created <= quotationHistoryDateTo);
      if (!fromOk || !toOk) return false;
      if (!q) return true;

      const searchText = [
        row.quoteNumber,
        row.customerName,
        row.customerMobile,
        row.customerEmail,
        row.vehicleType,
        row.vehiclePlate,
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ");

      return searchText.includes(q);
    });
  }, [quotationHistoryRows, quotationHistorySearch, quotationHistoryDateFrom, quotationHistoryDateTo]);

  const loadQuotationHistory = async () => {
    setQuotationHistoryLoading(true);
    try {
      const res = await client.models.QuotationHistory.list({ limit: 2000 } as any);
      const rows = Array.isArray((res as any)?.data) ? (res as any).data : [];
      const normalized: QuotationHistoryRow[] = rows
        .map((row: any) => ({
          id: String(row?.id ?? `${row?.quoteNumber ?? "quotation"}-${row?.createdAt ?? Math.random()}`),
          quoteNumber: String(row?.quoteNumber ?? ""),
          customerName: String(row?.customerName ?? ""),
          customerMobile: String(row?.customerMobile ?? ""),
          customerEmail: String(row?.customerEmail ?? ""),
          vehicleType: String(row?.vehicleType ?? ""),
          vehiclePlate: String(row?.vehiclePlate ?? ""),
          subtotal: toMoney(row?.subtotal),
          discountAmount: toMoney(row?.discountAmount),
          netAmount: toMoney(row?.netAmount),
          validityUntil: String(row?.validityUntil ?? ""),
          servicesJson: String(row?.servicesJson ?? ""),
          customerNotes: String(row?.customerNotes ?? ""),
          remarksEn: String(row?.remarksEn ?? ""),
          remarksAr: String(row?.remarksAr ?? ""),
          generatedBy: String(row?.generatedBy ?? ""),
          createdAt: String(row?.createdAt ?? ""),
        }))
        .sort((a: QuotationHistoryRow, b: QuotationHistoryRow) => {
          const at = new Date(a.createdAt).getTime();
          const bt = new Date(b.createdAt).getTime();
          return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
        });
      setQuotationHistoryRows(normalized);
    } catch (error) {
      console.error("Failed to load quotation history", error);
    } finally {
      setQuotationHistoryLoading(false);
    }
  };

  useEffect(() => {
    void loadQuotationHistory();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingCatalog(true);
      setStatus("");
      try {
        const rows = await withLoading(listServiceCatalog(), t("Loading quotation services..."));
        if (!mounted) return;
        setCatalog(rows.filter((item) => item.isActive !== false));
      } catch (e: any) {
        if (!mounted) return;
        setStatus(String(e?.message || t("Failed to load services and packages.")));
      } finally {
        if (mounted) setLoadingCatalog(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [t, withLoading]);

  const maxDiscountPercent = useMemo(
    () => resolveCentralDiscountPercent(canOption, getOptionNumber),
    [canOption, getOptionNumber]
  );

  const selectedProducts = useMemo(() => {
    const set = new Set(selectedCatalogIds);
    return catalog.filter((item) => set.has(item.id));
  }, [catalog, selectedCatalogIds]);

  const selectedLines = useMemo(() => {
    const vehicleType = customer.vehicleType;
    return dedupeServices(
      selectedProducts.flatMap((product) => expandCatalogProduct(product, catalog, vehicleType))
    );
  }, [selectedProducts, catalog, customer.vehicleType]);

  const quotationDisplayLines = useMemo(
    () => buildQuotationDisplayLines(selectedLines, t),
    [selectedLines, t]
  );

  const subtotal = useMemo(() => summarizeServicesSubtotalPackageAware(selectedLines), [selectedLines]);

  const discountAllowance = useMemo(
    () =>
      computeCumulativeDiscountAllowance({
        policyMaxPercent: maxDiscountPercent,
        baseAmount: subtotal,
        existingDiscountAmount: 0,
      }),
    [maxDiscountPercent, subtotal]
  );

  const maxAllowedDiscountAmount = useMemo(
    () => Math.max(0, Math.min(subtotal, discountAllowance.maxAllowedTotalDiscountAmount)),
    [subtotal, discountAllowance.maxAllowedTotalDiscountAmount]
  );

  const safeDiscount = useMemo(() => {
    const requestedTotal = Math.max(0, Number(discountAmount || 0));
    const clamped = clampTotalDiscountAmount(requestedTotal, discountAllowance);
    return Math.max(0, Math.min(subtotal, clamped));
  }, [discountAmount, discountAllowance, subtotal]);

  const discountPercent = subtotal > 0 ? (safeDiscount / subtotal) * 100 : 0;
  const netAmount = Math.max(0, subtotal - safeDiscount);

  const servicesOnly = useMemo(
    () => catalog.filter((item) => String(item.type).toLowerCase() !== "package"),
    [catalog]
  );

  const serviceCategories = useMemo(() => {
    const unique = new Set<string>();
    for (const item of servicesOnly) {
      const value = String(item.categoryNameEn || item.categoryCode || item.categoryId || "").trim();
      if (value) unique.add(value);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [servicesOnly]);

  const visibleServices = useMemo(() => {
    const searchQuery = normalizeKey(serviceSearchTerm);

    return servicesOnly.filter((item) => {
      const category = String(item.categoryNameEn || item.categoryCode || item.categoryId || "").trim();
      const matchesCategory = selectedServiceCategory === "all" || category === selectedServiceCategory;
      if (!matchesCategory) return false;

      if (!searchQuery) return true;

      const searchableText = [
        item.name,
        item.nameAr,
        item.serviceCode,
        item.categoryNameEn,
        item.categoryCode,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      return searchableText.includes(searchQuery);
    });
  }, [servicesOnly, selectedServiceCategory, serviceSearchTerm]);

  const packagesOnly = useMemo(
    () => catalog.filter((item) => String(item.type).toLowerCase() === "package"),
    [catalog]
  );

  const canViewRemarks = canOption("quotation", "quotation_remarks_view", false);
  const canEditRemarks = canOption("quotation", "quotation_remarks_edit", false);

  useEffect(() => {
    const { safeValidityDays } = resolveValidityWindow(new Date(), validityUntilDate);
    if (!remarkEnTouched) setRemarkEnglish(buildDefaultRemarkEnglish(safeValidityDays));
    if (!remarkArTouched) setRemarkArabic(buildDefaultRemarkArabic(safeValidityDays));
  }, [validityUntilDate, remarkEnTouched, remarkArTouched]);

  const toggleCatalogSelection = (itemId: string) => {
    setSelectedCatalogIds((prev) => {
      if (prev.includes(itemId)) return prev.filter((id) => id !== itemId);
      return [...prev, itemId];
    });
  };

  const updateCustomer = (field: keyof CustomerInfo, value: string) => {
    setCustomer((prev) => ({ ...prev, [field]: value }));
  };

  const requiredReady = customer.fullName.trim() && customer.mobile.trim() && selectedLines.length > 0;

  const buildQuotationHistoryPdfBlob = async (row: QuotationHistoryRow) => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = 210;
    const pageH = 297;
    const marginX = 8;
    const contentW = pageW - marginX * 2;
    const docTextSize = 9.8;
    const docTitleSize = 13;
    const docLabelSize = 9.2;
    const docSectionTitleSize = 10.6;
    const quoteNumber = row.quoteNumber || `QT-${Date.now().toString().slice(-8)}`;
    const issuedAt = dt(row.createdAt) ?? new Date();
    const validitySource = row.validityUntil ? dateInput(new Date(row.validityUntil)) : "";
    const { safeValidityDays, safeValidUntil } = resolveValidityWindow(issuedAt, validitySource);
    const effectiveRemarkLinesEnglish = normalizeMultilineText(row.remarksEn).length > 0
      ? normalizeMultilineText(row.remarksEn)
      : normalizeMultilineText(buildDefaultRemarkEnglish(safeValidityDays));
    const effectiveRemarkLinesArabic = normalizeMultilineText(row.remarksAr).length > 0
      ? normalizeMultilineText(row.remarksAr)
      : normalizeMultilineText(buildDefaultRemarkArabic(safeValidityDays));
    const issuedAtDisplay = issuedAt.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    const validUntilDisplay = safeValidUntil.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    let selectedLinesFromHistory: QuotationLine[] = [];
    try {
      const parsed = JSON.parse(row.servicesJson || "[]");
      if (Array.isArray(parsed)) selectedLinesFromHistory = parsed as QuotationLine[];
    } catch {
      selectedLinesFromHistory = [];
    }
    const quotationDisplayLinesFromHistory = buildQuotationDisplayLines(selectedLinesFromHistory, t);

    let logoDataUrl = "";
    try {
      const logoRes = await fetch(logo);
      if (logoRes.ok) logoDataUrl = await blobToDataUrl(await logoRes.blob());
    } catch {
      logoDataUrl = "";
    }

    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(0.38);
    const tintPanel = { r: 251, g: 252, b: 254 };
    const tintHeader = { r: 246, g: 248, b: 251 };
    const tintTotals = { r: 248, g: 250, b: 253 };
    const borderStrong = { r: 30, g: 41, b: 59 };
    const borderSoft = { r: 162, g: 174, b: 190 };

    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "JPEG", marginX + 3, 8, 15, 15);
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(docLabelSize);
    doc.text(issuedAtDisplay, pageW / 2, 12, { align: "center" });

    doc.setFontSize(docTitleSize);
    doc.text("Rodeo Drive", pageW - marginX, 11, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(docLabelSize);
    doc.text("for trading & services", pageW - marginX, 14.6, { align: "right" });
    drawArabicLine(doc, "روديو درايف للتجارة والخدمات", pageW - marginX, 16.8, 46, docLabelSize, "bold");

    const infoTop = 38;
    const infoH = 38;
    const leftX = marginX + 3;
    const leftW = 74;
    const centerX = leftX + leftW;
    const centerW = 44;
    const rightX = centerX + centerW;
    const leftLabelX = leftX + 1;
    const leftValueX = leftX + 23;
    const rightLabelX = rightX + 2;
    const rightValueX = rightX + 27;
    const rightCellCenterX = rightX + (pageW - marginX - rightX) / 2;

    doc.setFillColor(tintPanel.r, tintPanel.g, tintPanel.b);
    doc.roundedRect(marginX, infoTop, contentW, infoH, 1.8, 1.8, "FD");
    doc.line(centerX, infoTop, centerX, infoTop + infoH);
    doc.line(rightX, infoTop, rightX, infoTop + infoH);
    doc.setDrawColor(borderSoft.r, borderSoft.g, borderSoft.b);
    doc.setLineWidth(0.5);
    doc.line(marginX, infoTop, marginX + contentW, infoTop);
    doc.setDrawColor(borderStrong.r, borderStrong.g, borderStrong.b);
    doc.setLineWidth(0.38);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(docSectionTitleSize);
    doc.text("QUOTATION #", rightLabelX, infoTop + 5.6);
    drawArabicLine(doc, "رقم الفاتورة", pageW - marginX - 2, infoTop + 2.1, 22, docSectionTitleSize, "bold");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(docSectionTitleSize);
    doc.text(quoteNumber, rightCellCenterX, infoTop + 11.8, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(docLabelSize);
    doc.text("Name:", leftLabelX, infoTop + 10.2);
    doc.text("Email:", leftLabelX, infoTop + 16.5);
    doc.text("Phone:", leftLabelX, infoTop + 22.8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(docTextSize);
    drawPdfSmartText(doc, row.customerName, leftValueX, infoTop + 10.2, leftW - 26, docTextSize);
    drawPdfSmartText(doc, row.customerEmail, leftValueX, infoTop + 16.5, leftW - 26, docTextSize);
    drawPdfSmartText(doc, row.customerMobile, leftValueX, infoTop + 22.8, leftW - 26, docTextSize);

    drawArabicLine(doc, "اسم العميل:", centerX + centerW - 2, infoTop + 7.1, centerW - 4, docLabelSize, "normal");
    drawArabicLine(doc, "الإيميل:", centerX + centerW - 2, infoTop + 13.4, centerW - 4, docLabelSize, "normal");
    drawArabicLine(doc, "رقم الهاتف:", centerX + centerW - 2, infoTop + 19.7, centerW - 4, docLabelSize, "normal");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(docLabelSize);
    doc.text("Valid For:", rightLabelX, infoTop + 17.6);
    doc.text("Valid Until:", rightLabelX, infoTop + 23.2);
    doc.text("Model:", rightLabelX, infoTop + 28.8);
    doc.text("Plate #", rightLabelX, infoTop + 34.4);
    doc.setFont("helvetica", "normal");
    const rightValueMaxW = pageW - marginX - rightValueX - 2;
    drawPdfSmartText(doc, `${safeValidityDays} day(s)`, rightValueX, infoTop + 17.6, rightValueMaxW, docTextSize);
    drawPdfSmartText(doc, validUntilDisplay, rightValueX, infoTop + 23.2, rightValueMaxW, docTextSize);
    drawPdfSmartText(doc, safeText(row.vehicleType) || "-", rightValueX, infoTop + 28.8, rightValueMaxW, docTextSize);
    drawPdfSmartText(doc, safeText(row.vehiclePlate) || "-", rightValueX, infoTop + 34.4, rightValueMaxW, docTextSize);

    drawArabicLine(doc, "صالحة لمدة:", pageW - marginX - 2, infoTop + 14.3, 20, docLabelSize, "normal");
    drawArabicLine(doc, "تاريخ الانتهاء:", pageW - marginX - 2, infoTop + 19.9, 20, docLabelSize, "normal");
    drawArabicLine(doc, "الموديل:", pageW - marginX - 2, infoTop + 25.5, 20, docLabelSize, "normal");
    drawArabicLine(doc, "رقم اللوحة:", pageW - marginX - 2, infoTop + 31.1, 20, docLabelSize, "normal");

    const footerTop = pageH - 42;
    const tableTop = 81;
    const rowH = 9.2;
    const reservedBelowTable = 62;
    const maxRowsForLayout = Math.max(4, Math.floor((footerTop - tableTop - reservedBelowTable) / rowH));
    const rowsCount = Math.max(1, Math.min(quotationDisplayLinesFromHistory.length, maxRowsForLayout));
    const tableH = rowH * (rowsCount + 1);
    const amountW = 40;
    const descW = contentW - amountW;
    const amountRightX = pageW - marginX - 4;

    doc.setFillColor(tintPanel.r, tintPanel.g, tintPanel.b);
    doc.roundedRect(marginX, tableTop, contentW, tableH, 1.6, 1.6, "FD");
    doc.line(marginX + descW, tableTop, marginX + descW, tableTop + tableH);
    doc.setFillColor(tintHeader.r, tintHeader.g, tintHeader.b);
    doc.rect(marginX + 0.2, tableTop + 0.2, contentW - 0.4, rowH - 0.4, "F");
    doc.line(marginX, tableTop + rowH, marginX + contentW, tableTop + rowH);
    for (let i = 1; i <= rowsCount; i += 1) {
      doc.line(marginX, tableTop + rowH + i * rowH, marginX + contentW, tableTop + rowH + i * rowH);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(docLabelSize);
    doc.text("Service", marginX + 2, tableTop + 6.6);
    drawArabicLine(doc, "الخدمة", marginX + descW - 5, tableTop + 0.8, 20, docLabelSize, "bold");
    doc.text("AMOUNT", amountRightX - 1.2, tableTop + 6.6, { align: "right" });
    drawArabicLine(doc, "مبلغ الخدمة", amountRightX, tableTop + 0.8, amountW - 10, docLabelSize, "bold");

    const shown = quotationDisplayLinesFromHistory.slice(0, rowsCount);
    shown.forEach((line, idx) => {
      const y = tableTop + rowH + idx * rowH + 6.4;
      if (line.isIncludedService) {
        const rowTop = tableTop + rowH + idx * rowH;
        doc.setFillColor(241, 245, 249);
        doc.rect(marginX + 0.3, rowTop + 0.3, contentW - 0.6, rowH - 0.6, "F");
      }
      const isPackageHeader = line.isPackage;
      const isIncludedService = line.isIncludedService;
      doc.setFont("helvetica", isPackageHeader ? "bold" : "normal");
      doc.setFontSize(docTextSize);
      if (isIncludedService) {
        doc.setTextColor(113, 128, 150);
      } else {
        doc.setTextColor(17, 24, 39);
      }
      const fullTitle = safeText(line.label || t("Service"));
      const hadBullet = /^\s*-\s*/.test(fullTitle);
      const titleNoBullet = fullTitle.replace(/^\s*-\s*/, "").trim();
      const titleParts = splitBilingualLabel(titleNoBullet);
      const englishPrefix = isIncludedService && hadBullet ? "- " : "";
      const englishRaw = `${englishPrefix}${titleParts.en || (!titleParts.ar ? titleNoBullet : "")}`.trim();
      const englishX = marginX + (isIncludedService ? 6.5 : 2);
      const arabicRightX = marginX + descW - 5;
      const arabicW = 40;
      const englishW = Math.max(28, descW - arabicW - (isIncludedService ? 11 : 8));
      const englishLines = doc.splitTextToSize(englishRaw || "-", englishW) as string[];
      const englishLine = String(englishLines[0] || englishRaw || "-");
      doc.text(englishLine, englishX, y);
      if (titleParts.ar) {
        drawArabicLine(
          doc,
          titleParts.ar,
          arabicRightX,
          y - 2.0,
          arabicW,
          docTextSize,
          isPackageHeader ? "bold" : "normal",
          isIncludedService ? "#718096" : "#111827"
        );
      }
      const amountText = line.price == null ? "" : formatMoney(toMoney(line.price));
      doc.text(amountText, amountRightX, y, { align: "right" });
    });
    doc.setTextColor(17, 24, 39);

    const totalsTop = tableTop + tableH + 8.5;
    const totalsW = 78;
    const totalsX = pageW - marginX - totalsW;
    const totalsRowH = 7;
    const taxRate = 0;
    const totals = [
      ["TOTAL", "الإجمالي", row.subtotal],
      ["DISCOUNT", "الخصم", row.discountAmount],
      ["NET TOTAL", "الصافي", row.netAmount],
      ["TAX RATE", "الضريبة", taxRate],
    ] as const;

    const drawWrapped = (
      text: string,
      x: number,
      y: number,
      maxWidth: number,
      lineHeight: number,
      align: "left" | "right" = "left"
    ) => {
      const lines = doc.splitTextToSize(String(text || "-"), maxWidth) as string[];
      lines.forEach((line, idx) => {
        doc.text(line, x, y + idx * lineHeight, align === "right" ? { align: "right" } : undefined);
      });
      return lines.length;
    };

    doc.setDrawColor(borderSoft.r, borderSoft.g, borderSoft.b);
    doc.setLineWidth(0.42);
    doc.line(marginX, totalsTop - 1.5, pageW - marginX, totalsTop - 1.5);
    doc.setDrawColor(borderStrong.r, borderStrong.g, borderStrong.b);
    doc.setLineWidth(0.38);
    doc.setFillColor(tintTotals.r, tintTotals.g, tintTotals.b);
    doc.roundedRect(totalsX, totalsTop, totalsW, totalsRowH * totals.length, 1.6, 1.6, "FD");
    for (let i = 1; i < totals.length; i += 1) {
      doc.line(totalsX, totalsTop + i * totalsRowH, totalsX + totalsW, totalsTop + i * totalsRowH);
    }
    doc.line(totalsX + 48, totalsTop, totalsX + 48, totalsTop + totalsRowH * totals.length);

    totals.forEach(([en, ar, value], idx) => {
      const y = totalsTop + idx * totalsRowH + 4.9;
      if (en === "NET TOTAL") {
        doc.setFillColor(244, 248, 252);
        doc.rect(totalsX + 0.2, totalsTop + idx * totalsRowH + 0.2, totalsW - 0.4, totalsRowH - 0.4, "F");
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(docLabelSize);
      doc.text(en, totalsX + 2, y);
      drawArabicLine(doc, ar, totalsX + 45.5, y - 2.5, 16, docLabelSize, "bold", en === "DISCOUNT" ? "#cc1f1a" : "#111827");
      if (en === "DISCOUNT") doc.setTextColor(204, 31, 26);
      doc.text(en === "TAX RATE" ? `${value}%` : formatMoney(Number(value || 0)), totalsX + totalsW - 2, y, { align: "right" });
      doc.setTextColor(17, 24, 39);
    });

    const customerNote = safeText(row.customerNotes).trim();
    let customerNoteBoxHeight = 0;
    if (customerNote) {
      const noteTop = totalsTop + totalsRowH * totals.length + 8;
      const noteW = contentW - 2;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Customer Note", marginX + 1, noteTop);
      drawArabicLine(doc, "ملاحظة العميل", pageW - marginX - 1, noteTop - 3.1, 24, 10, "bold");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.2);
      const noteHasArabic = hasArabicChars(customerNote);
      const noteLines = noteHasArabic
        ? splitArabicTextToLines(customerNote, noteW - 6, 9.2, "normal")
        : (doc.splitTextToSize(customerNote, noteW - 4) as string[]);
      const noteBoxH = Math.max(12, noteLines.length * 4.8 + 8);
      customerNoteBoxHeight = noteBoxH;
      doc.setDrawColor(220, 231, 246);
      doc.setFillColor(248, 251, 255);
      doc.roundedRect(marginX + 0.5, noteTop + 2, noteW, noteBoxH, 2.5, 2.5, "FD");
      if (noteHasArabic) {
        drawWrappedArabicLines(
          doc,
          customerNote,
          pageW - marginX - 3,
          noteTop + 4.2,
          noteW - 4,
          9.2,
          "normal",
          "#1f2937",
          0.6
        );
      } else {
        doc.text(noteLines, marginX + 3, noteTop + 7.2);
      }
    }

    const remarksTop = totalsTop + totalsRowH * totals.length + (customerNote ? customerNoteBoxHeight + 16 : 10);
    const remarksLeftX = marginX + 1;
    const remarksLeftW = 118;
    const remarksRightX = pageW - marginX - 1;
    const remarksRightW = 66;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Remarks", remarksLeftX, remarksTop);
    drawArabicLine(doc, "إيضاحات", remarksRightX, remarksTop - 3.1, 16, 10, "bold");
    doc.setFont("helvetica", "normal");
    const remarksTextSize = 10;
    doc.setFontSize(remarksTextSize);
    const remarksLineHeight = 4.7;
    const remarksArabicLineGap = 0.4;
    const remarksArabicLineHeight = 4.4 + remarksArabicLineGap;
    let remarksEnglishY = remarksTop + 6.2;
    effectiveRemarkLinesEnglish.forEach((line) => {
      const lineCount = drawWrapped(line, remarksLeftX, remarksEnglishY, remarksLeftW, remarksLineHeight, "left");
      remarksEnglishY += lineCount * remarksLineHeight + 1.2;
    });

    let remarksArabicY = remarksTop + 6.0;
    effectiveRemarkLinesArabic.forEach((line) => {
      const lineCount = drawWrappedArabicLines(
        doc,
        line,
        remarksRightX,
        remarksArabicY,
        remarksRightW,
        remarksTextSize,
        "normal",
        "#181818",
        remarksArabicLineGap
      );
      remarksArabicY += lineCount * remarksArabicLineHeight + 1.2;
    });

    doc.line(marginX, footerTop, pageW - marginX, footerTop);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.8);
    doc.text("Website", marginX + 16, footerTop + 10.2, { align: "right" });
    doc.text("Email", marginX + 16, footerTop + 16.2, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    doc.text("rodeodrive.qa", marginX + 18, footerTop + 10.2);
    doc.text("info@rodeodrive.qa", marginX + 18, footerTop + 16.2);

    return doc.output("blob") as Blob;
  };

  const openQuotationHistoryEntry = async (row: QuotationHistoryRow) => {
    try {
      const blob = await buildQuotationHistoryPdfBlob(row);
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        URL.revokeObjectURL(url);
        setStatus(t("Popup blocked. Please allow popups and try again."));
        return;
      }
      opened.focus();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      console.error("Failed to open quotation from history", error);
      setStatus(t("Failed to open quotation from history."));
    }
  };

  const downloadQuotationHistoryEntry = async (row: QuotationHistoryRow) => {
    try {
      const blob = await buildQuotationHistoryPdfBlob(row);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${row.quoteNumber || "quotation-history"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (error) {
      console.error("Failed to download quotation from history", error);
      setStatus(t("Failed to download quotation from history."));
    }
  };

  const deleteQuotationHistoryEntry = async (row: QuotationHistoryRow) => {
    const confirmed = window.confirm(t("Delete this quotation history entry?"));
    if (!confirmed) return;

    try {
      await client.models.QuotationHistory.delete({ id: row.id } as any);
      setQuotationHistoryRows((prev) => prev.filter((item) => item.id !== row.id));
      setStatus(t("Quotation history entry deleted."));
    } catch (error) {
      console.error("Failed to delete quotation history", error);
      setStatus(t("Failed to delete quotation history entry."));
    }
  };

  const buildQuotationPdf = async () => {
    if (!requiredReady) {
      setStatus(t("Please complete customer info and select at least one service/package."));
      return;
    }

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = 210;
    const pageH = 297;
    const marginX = 8;
    const contentW = pageW - marginX * 2;
    const docTextSize = 9.8;
    const docTitleSize = 13;
    const docLabelSize = 9.2;
    const docSectionTitleSize = 10.6;
    const quoteNumber = `QT-${Date.now().toString().slice(-8)}`;
    const issuedAt = new Date();
    const { safeValidityDays, safeValidUntil } = resolveValidityWindow(issuedAt, validityUntilDate);
    const remarkLinesEnglish = normalizeMultilineText(remarkEnglish);
    const remarkLinesArabic = normalizeMultilineText(remarkArabic);
    const effectiveRemarkLinesEnglish =
      remarkLinesEnglish.length > 0 ? remarkLinesEnglish : normalizeMultilineText(buildDefaultRemarkEnglish(safeValidityDays));
    const effectiveRemarkLinesArabic =
      remarkLinesArabic.length > 0 ? remarkLinesArabic : normalizeMultilineText(buildDefaultRemarkArabic(safeValidityDays));
    const issuedAtDisplay = issuedAt.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    const validUntilDisplay = safeValidUntil.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    let logoDataUrl = "";
    try {
      const logoRes = await fetch(logo);
      if (logoRes.ok) logoDataUrl = await blobToDataUrl(await logoRes.blob());
    } catch {
      logoDataUrl = "";
    }

    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(0.38);
    const tintPanel = { r: 251, g: 252, b: 254 };
    const tintHeader = { r: 246, g: 248, b: 251 };
    const tintTotals = { r: 248, g: 250, b: 253 };
    const borderStrong = { r: 30, g: 41, b: 59 };
    const borderSoft = { r: 162, g: 174, b: 190 };

    // Header
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "JPEG", marginX + 3, 8, 15, 15);
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(docLabelSize);
    doc.text(issuedAtDisplay, pageW / 2, 12, { align: "center" });

    doc.setFontSize(docTitleSize);
    doc.text("Rodeo Drive", pageW - marginX, 11, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(docLabelSize);
    doc.text("for trading & services", pageW - marginX, 14.6, { align: "right" });
    drawArabicLine(doc, "روديو درايف للتجارة والخدمات", pageW - marginX, 16.8, 46, docLabelSize, "bold");

    // Quotation details block
    const infoTop = 38;
    const infoH = 38;
    const leftX = marginX + 3;
    const leftW = 74;
    const centerX = leftX + leftW;
    const centerW = 44;
    const rightX = centerX + centerW;
    const leftLabelX = leftX + 1;
    const leftValueX = leftX + 23;
    const rightLabelX = rightX + 2;
    const rightValueX = rightX + 27;
    const rightCellCenterX = rightX + (pageW - marginX - rightX) / 2;

    doc.setFillColor(tintPanel.r, tintPanel.g, tintPanel.b);
    doc.roundedRect(marginX, infoTop, contentW, infoH, 1.8, 1.8, "FD");
    doc.line(centerX, infoTop, centerX, infoTop + infoH);
    doc.line(rightX, infoTop, rightX, infoTop + infoH);
    doc.setDrawColor(borderSoft.r, borderSoft.g, borderSoft.b);
    doc.setLineWidth(0.5);
    doc.line(marginX, infoTop, marginX + contentW, infoTop);
    doc.setDrawColor(borderStrong.r, borderStrong.g, borderStrong.b);
    doc.setLineWidth(0.38);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(docSectionTitleSize);
    doc.text("QUOTATION #", rightLabelX, infoTop + 5.6);
    drawArabicLine(doc, "رقم الفاتورة", pageW - marginX - 2, infoTop + 2.1, 22, docSectionTitleSize, "bold");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(docSectionTitleSize);
    doc.text(quoteNumber, rightCellCenterX, infoTop + 11.8, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(docLabelSize);
    doc.text("Name:", leftLabelX, infoTop + 10.2);
    doc.text("Email:", leftLabelX, infoTop + 16.5);
    doc.text("Phone:", leftLabelX, infoTop + 22.8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(docTextSize);
    drawPdfSmartText(doc, customer.fullName, leftValueX, infoTop + 10.2, leftW - 26, docTextSize);
    drawPdfSmartText(doc, customer.email, leftValueX, infoTop + 16.5, leftW - 26, docTextSize);
    drawPdfSmartText(doc, customer.mobile, leftValueX, infoTop + 22.8, leftW - 26, docTextSize);

    drawArabicLine(doc, "اسم العميل:", centerX + centerW - 2, infoTop + 7.1, centerW - 4, docLabelSize, "normal");
    drawArabicLine(doc, "الإيميل:", centerX + centerW - 2, infoTop + 13.4, centerW - 4, docLabelSize, "normal");
    drawArabicLine(doc, "رقم الهاتف:", centerX + centerW - 2, infoTop + 19.7, centerW - 4, docLabelSize, "normal");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(docLabelSize);
    doc.text("Valid For:", rightLabelX, infoTop + 17.6);
    doc.text("Valid Until:", rightLabelX, infoTop + 23.2);
    doc.text("Model:", rightLabelX, infoTop + 28.8);
    doc.text("Plate #", rightLabelX, infoTop + 34.4);
    doc.setFont("helvetica", "normal");
    const rightValueMaxW = pageW - marginX - rightValueX - 2;
    drawPdfSmartText(doc, `${safeValidityDays} day(s)`, rightValueX, infoTop + 17.6, rightValueMaxW, docTextSize);
    drawPdfSmartText(doc, validUntilDisplay, rightValueX, infoTop + 23.2, rightValueMaxW, docTextSize);
    drawPdfSmartText(doc, safeText(customer.vehicleType) || "-", rightValueX, infoTop + 28.8, rightValueMaxW, docTextSize);
    drawPdfSmartText(doc, safeText(customer.vehiclePlate) || "-", rightValueX, infoTop + 34.4, rightValueMaxW, docTextSize);

    drawArabicLine(doc, "صالحة لمدة:", pageW - marginX - 2, infoTop + 14.3, 20, docLabelSize, "normal");
    drawArabicLine(doc, "تاريخ الانتهاء:", pageW - marginX - 2, infoTop + 19.9, 20, docLabelSize, "normal");
    drawArabicLine(doc, "الموديل:", pageW - marginX - 2, infoTop + 25.5, 20, docLabelSize, "normal");
    drawArabicLine(doc, "رقم اللوحة:", pageW - marginX - 2, infoTop + 31.1, 20, docLabelSize, "normal");

    // Services table
    const footerTop = pageH - 42;
    const tableTop = 81;
    const rowH = 9.2;
    const reservedBelowTable = 62;
    const maxRowsForLayout = Math.max(4, Math.floor((footerTop - tableTop - reservedBelowTable) / rowH));
    const rowsCount = Math.max(1, Math.min(quotationDisplayLines.length, maxRowsForLayout));
    const tableH = rowH * (rowsCount + 1);
    const amountW = 40;
    const descW = contentW - amountW;
    const amountRightX = pageW - marginX - 4;

    doc.setFillColor(tintPanel.r, tintPanel.g, tintPanel.b);
    doc.roundedRect(marginX, tableTop, contentW, tableH, 1.6, 1.6, "FD");
    doc.line(marginX + descW, tableTop, marginX + descW, tableTop + tableH);
    doc.setFillColor(tintHeader.r, tintHeader.g, tintHeader.b);
    doc.rect(marginX + 0.2, tableTop + 0.2, contentW - 0.4, rowH - 0.4, "F");
    doc.line(marginX, tableTop + rowH, marginX + contentW, tableTop + rowH);
    for (let i = 1; i <= rowsCount; i += 1) {
      doc.line(marginX, tableTop + rowH + i * rowH, marginX + contentW, tableTop + rowH + i * rowH);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(docLabelSize);
    doc.text("Service", marginX + 2, tableTop + 6.6);
    drawArabicLine(doc, "الخدمة", marginX + descW - 5, tableTop + 0.8, 20, docLabelSize, "bold");
    doc.text("AMOUNT", amountRightX - 1.2, tableTop + 6.6, { align: "right" });
    drawArabicLine(doc, "مبلغ الخدمة", amountRightX, tableTop + 0.8, amountW - 10, docLabelSize, "bold");

    const shown = quotationDisplayLines.slice(0, rowsCount);
    shown.forEach((line, idx) => {
      const y = tableTop + rowH + idx * rowH + 6.4;
      if (line.isIncludedService) {
        const rowTop = tableTop + rowH + idx * rowH;
        doc.setFillColor(241, 245, 249);
        doc.rect(marginX + 0.3, rowTop + 0.3, contentW - 0.6, rowH - 0.6, "F");
      }
      const isPackageHeader = line.isPackage;
      const isIncludedService = line.isIncludedService;
      doc.setFont("helvetica", isPackageHeader ? "bold" : "normal");
      doc.setFontSize(docTextSize);
      if (isIncludedService) {
        doc.setTextColor(113, 128, 150);
      } else {
        doc.setTextColor(17, 24, 39);
      }
      const fullTitle = safeText(line.label || t("Service"));
      const hadBullet = /^\s*-\s*/.test(fullTitle);
      const titleNoBullet = fullTitle.replace(/^\s*-\s*/, "").trim();
      const titleParts = splitBilingualLabel(titleNoBullet);
      const englishPrefix = isIncludedService && hadBullet ? "- " : "";
      const englishRaw = `${englishPrefix}${titleParts.en || (!titleParts.ar ? titleNoBullet : "")}`.trim();
      const englishX = marginX + (isIncludedService ? 6.5 : 2);
      const arabicRightX = marginX + descW - 5;
      const arabicW = 40;
      const englishW = Math.max(28, descW - arabicW - (isIncludedService ? 11 : 8));
      const englishLines = doc.splitTextToSize(englishRaw || "-", englishW) as string[];
      const englishLine = String(englishLines[0] || englishRaw || "-");
      doc.text(englishLine, englishX, y);
      if (titleParts.ar) {
        drawArabicLine(
          doc,
          titleParts.ar,
          arabicRightX,
          y - 2.0,
          arabicW,
          docTextSize,
          isPackageHeader ? "bold" : "normal",
          isIncludedService ? "#718096" : "#111827"
        );
      }
      const amountText = line.price == null ? "" : formatMoney(toMoney(line.price));
      doc.text(amountText, amountRightX, y, { align: "right" });
    });
    doc.setTextColor(17, 24, 39);

    // Totals block
    const totalsTop = tableTop + tableH + 8.5;
    const totalsW = 78;
    const totalsX = pageW - marginX - totalsW;
    const totalsRowH = 7;
    const taxRate = 0;
    const totals = [
      ["TOTAL", "الإجمالي", subtotal],
      ["DISCOUNT", "الخصم", safeDiscount],
      ["NET TOTAL", "الصافي", netAmount],
      ["TAX RATE", "الضريبة", taxRate],
    ] as const;

    const drawWrapped = (
      text: string,
      x: number,
      y: number,
      maxWidth: number,
      lineHeight: number,
      align: "left" | "right" = "left"
    ) => {
      const lines = doc.splitTextToSize(String(text || "-"), maxWidth) as string[];
      lines.forEach((line, idx) => {
        doc.text(line, x, y + idx * lineHeight, align === "right" ? { align: "right" } : undefined);
      });
      return lines.length;
    };

    doc.setDrawColor(borderSoft.r, borderSoft.g, borderSoft.b);
    doc.setLineWidth(0.42);
    doc.line(marginX, totalsTop - 1.5, pageW - marginX, totalsTop - 1.5);
    doc.setDrawColor(borderStrong.r, borderStrong.g, borderStrong.b);
    doc.setLineWidth(0.38);
    doc.setFillColor(tintTotals.r, tintTotals.g, tintTotals.b);
    doc.roundedRect(totalsX, totalsTop, totalsW, totalsRowH * totals.length, 1.6, 1.6, "FD");
    for (let i = 1; i < totals.length; i += 1) {
      doc.line(totalsX, totalsTop + i * totalsRowH, totalsX + totalsW, totalsTop + i * totalsRowH);
    }
    doc.line(totalsX + 48, totalsTop, totalsX + 48, totalsTop + totalsRowH * totals.length);

    totals.forEach(([en, ar, value], idx) => {
      const y = totalsTop + idx * totalsRowH + 4.9;
      if (en === "NET TOTAL") {
        doc.setFillColor(244, 248, 252);
        doc.rect(totalsX + 0.2, totalsTop + idx * totalsRowH + 0.2, totalsW - 0.4, totalsRowH - 0.4, "F");
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(docLabelSize);
      doc.text(en, totalsX + 2, y);
      drawArabicLine(doc, ar, totalsX + 45.5, y - 2.5, 16, docLabelSize, "bold", en === "DISCOUNT" ? "#cc1f1a" : "#111827");
      if (en === "DISCOUNT") doc.setTextColor(204, 31, 26);
      doc.text(en === "TAX RATE" ? `${value}%` : formatMoney(Number(value || 0)), totalsX + totalsW - 2, y, { align: "right" });
      doc.setTextColor(17, 24, 39);
    });

    const customerNote = safeText(customer.notes).trim();
    let customerNoteBoxHeight = 0;
    if (customerNote) {
      const noteTop = totalsTop + totalsRowH * totals.length + 8;
      const noteW = contentW - 2;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Customer Note", marginX + 1, noteTop);
      drawArabicLine(doc, "ملاحظة العميل", pageW - marginX - 1, noteTop - 3.1, 24, 10, "bold");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.2);
      const noteHasArabic = hasArabicChars(customerNote);
      const noteLines = noteHasArabic
        ? splitArabicTextToLines(customerNote, noteW - 6, 9.2, "normal")
        : (doc.splitTextToSize(customerNote, noteW - 4) as string[]);
      const noteBoxH = Math.max(12, noteLines.length * 4.8 + 8);
      customerNoteBoxHeight = noteBoxH;
      doc.setDrawColor(220, 231, 246);
      doc.setFillColor(248, 251, 255);
      doc.roundedRect(marginX + 0.5, noteTop + 2, noteW, noteBoxH, 2.5, 2.5, "FD");
      if (noteHasArabic) {
        drawWrappedArabicLines(
          doc,
          customerNote,
          pageW - marginX - 3,
          noteTop + 4.2,
          noteW - 4,
          9.2,
          "normal",
          "#1f2937",
          0.6
        );
      } else {
        doc.text(noteLines, marginX + 3, noteTop + 7.2);
      }
    }

    // Remarks and terms
    const remarksTop = totalsTop + totalsRowH * totals.length + (customerNote ? customerNoteBoxHeight + 16 : 10);
    const remarksLeftX = marginX + 1;
    const remarksLeftW = 118;
    const remarksRightX = pageW - marginX - 1;
    const remarksRightW = 66;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Remarks", remarksLeftX, remarksTop);
    drawArabicLine(doc, "إيضاحات", remarksRightX, remarksTop - 3.1, 16, 10, "bold");
    doc.setFont("helvetica", "normal");
    const remarksTextSize = 10;
    doc.setFontSize(remarksTextSize);
    const remarksLineHeight = 4.7;
    const remarksArabicLineGap = 0.4;
    const remarksArabicLineHeight = 4.4 + remarksArabicLineGap;
    let remarksEnglishY = remarksTop + 6.2;
    effectiveRemarkLinesEnglish.forEach((line) => {
      const lineCount = drawWrapped(line, remarksLeftX, remarksEnglishY, remarksLeftW, remarksLineHeight, "left");
      remarksEnglishY += lineCount * remarksLineHeight + 1.2;
    });

    let remarksArabicY = remarksTop + 6.0;
    effectiveRemarkLinesArabic.forEach((line) => {
      const lineCount = drawWrappedArabicLines(
        doc,
        line,
        remarksRightX,
        remarksArabicY,
        remarksRightW,
        remarksTextSize,
        "normal",
        "#181818",
        remarksArabicLineGap
      );
      remarksArabicY += lineCount * remarksArabicLineHeight + 1.2;
    });

    // Footer with website and email only
    doc.line(marginX, footerTop, pageW - marginX, footerTop);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.8);
    doc.text("Website", marginX + 16, footerTop + 10.2, { align: "right" });
    doc.text("Email", marginX + 16, footerTop + 16.2, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    doc.text("rodeodrive.qa", marginX + 18, footerTop + 10.2);
    doc.text("info@rodeodrive.qa", marginX + 18, footerTop + 16.2);

    const pdfBlob = doc.output("blob") as Blob;

    let historyWarning = "";
    try {
      const historyCreate = await client.models.QuotationHistory.create({
        quoteNumber,
        title: "Quotation",
        customerName: safeText(customer.fullName) || "Unknown Customer",
        customerMobile: safeText(customer.mobile),
        customerEmail: safeText(customer.email),
        vehicleType: safeText(customer.vehicleType),
        vehiclePlate: safeText(customer.vehiclePlate),
        validityUntil: safeValidUntil.toISOString(),
        subtotal,
        discountAmount: safeDiscount,
        netAmount,
        servicesJson: JSON.stringify(selectedLines),
        customerNotes: safeText(customer.notes),
        remarksEn: effectiveRemarkLinesEnglish.join("\n"),
        remarksAr: effectiveRemarkLinesArabic.join("\n"),
        generatedBy: String(currentUser?.email || currentUser?.name || "System"),
        createdAt: new Date().toISOString(),
      } as any);
      if (Array.isArray((historyCreate as any)?.errors) && (historyCreate as any).errors.length > 0) {
        historyWarning = t("Quotation generated but history record failed to save.");
      } else {
        void loadQuotationHistory();
      }
    } catch (error) {
      console.error("Failed to save quotation history", error);
      historyWarning = t("Quotation generated but history record failed to save.");
    }

    const pdfUrl = URL.createObjectURL(pdfBlob);
    const opened = window.open(pdfUrl, "_blank", "noopener,noreferrer");
    if (!opened) {
      setStatus(
        historyWarning
          ? `${t("Popup blocked. Please allow popups and try again.")} ${historyWarning}`
          : t("Popup blocked. Please allow popups and try again.")
      );
      URL.revokeObjectURL(pdfUrl);
      return;
    }
    opened.focus();
    window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
    const successStatus = t("Quotation opened in a new tab.");
    setStatus(historyWarning ? `${successStatus} ${historyWarning}` : successStatus);
  };

  return (
    <div className="quotation-page">
      <div className="quotation-hero">
        <div className="quotation-hero-main" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 560px", minWidth: 260 }}>
            <div className="quotation-kicker">
              <i className="fas fa-file-invoice" style={{ marginRight: 6 }} />
              {t("Records")}
            </div>
            <div className="quotation-hero-title-row">
              <span className="quotation-title-icon" aria-hidden="true">
                <i className="fas fa-file-signature" />
              </span>
              <h1>{t("Quotation Builder")}</h1>
            </div>
            <p>{t("Create customer quotations with live service/package pricing and policy-based discount limits.")}</p>
          </div>
          <button
            type="button"
            className="quotation-generate-btn"
            style={{ minWidth: 220, marginLeft: "auto" }}
            onClick={() => {
              setQuotationHistoryOpen(true);
              void loadQuotationHistory();
            }}
          >
            <i className="fas fa-history" /> {t("View Quotation History")}
          </button>
        </div>
      </div>

      {quotationHistoryOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2,6,23,0.45)",
            display: "grid",
            placeItems: "center",
            zIndex: 1200,
            padding: 12,
          }}
          onClick={() => setQuotationHistoryOpen(false)}
        >
          <section
            className="quotation-card"
            style={{ width: "min(1120px, 98vw)", maxHeight: "90vh", overflow: "auto", margin: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h3 style={{ margin: 0 }}><i className="fas fa-history" /> {t("Quotation History")}</h3>
              <button type="button" className="quotation-inline-reset-btn" onClick={() => setQuotationHistoryOpen(false)}>
                {t("Close")}
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) repeat(2,minmax(150px,180px))", gap: 10, marginTop: 10 }}>
              <input
                className="quotation-input"
                placeholder={t("Search quotations...")}
                value={quotationHistorySearch}
                onChange={(e) => setQuotationHistorySearch(e.target.value)}
              />
              <input
                className="quotation-input"
                type="date"
                value={quotationHistoryDateFrom}
                onChange={(e) => setQuotationHistoryDateFrom(e.target.value)}
                title={t("Date from")}
              />
              <input
                className="quotation-input"
                type="date"
                value={quotationHistoryDateTo}
                onChange={(e) => setQuotationHistoryDateTo(e.target.value)}
                title={t("Date to")}
              />
            </div>

            {quotationHistoryLoading ? <div className="quotation-muted" style={{ marginTop: 10 }}>{t("Loading quotation history...")}</div> : null}
            {!quotationHistoryLoading && filteredQuotationHistoryRows.length === 0 ? (
              <div className="quotation-muted" style={{ marginTop: 10 }}>{t("No quotations found yet.")}</div>
            ) : null}

            {!quotationHistoryLoading && filteredQuotationHistoryRows.length > 0 ? (
              <div style={{ overflowX: "auto", marginTop: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #d1d5db", padding: "8px" }}>{t("Created At")}</th>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #d1d5db", padding: "8px" }}>{t("Quotation #")}</th>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #d1d5db", padding: "8px" }}>{t("Customer")}</th>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #d1d5db", padding: "8px" }}>{t("Mobile")}</th>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #d1d5db", padding: "8px" }}>{t("Vehicle")}</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #d1d5db", padding: "8px" }}>{t("Net")}</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #d1d5db", padding: "8px" }}>{t("Actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQuotationHistoryRows.map((row) => {
                      const createdLabel = row.createdAt ? new Date(row.createdAt).toLocaleString() : "-";
                      const vehicleLabel = [row.vehicleType, row.vehiclePlate].filter(Boolean).join(" / ") || "-";
                      return (
                        <tr
                          key={row.id}
                          onClick={() => void openQuotationHistoryEntry(row)}
                          style={{ cursor: "pointer" }}
                          title={t("Click to open quotation")}
                        >
                          <td style={{ borderBottom: "1px solid #eef2f7", padding: "8px" }}>{createdLabel}</td>
                          <td style={{ borderBottom: "1px solid #eef2f7", padding: "8px", fontWeight: 600 }}>{row.quoteNumber || "-"}</td>
                          <td style={{ borderBottom: "1px solid #eef2f7", padding: "8px" }}>{row.customerName || "-"}</td>
                          <td style={{ borderBottom: "1px solid #eef2f7", padding: "8px" }}>{row.customerMobile || "-"}</td>
                          <td style={{ borderBottom: "1px solid #eef2f7", padding: "8px" }}>{vehicleLabel}</td>
                          <td style={{ borderBottom: "1px solid #eef2f7", padding: "8px", textAlign: "right" }}>{formatMoney(row.netAmount)}</td>
                          <td style={{ borderBottom: "1px solid #eef2f7", padding: "8px", textAlign: "right" }}>
                            <div style={{ display: "inline-flex", gap: 8 }}>
                              <button
                                type="button"
                                className="quotation-inline-reset-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void downloadQuotationHistoryEntry(row);
                                }}
                              >
                                <i className="fas fa-download" /> {t("Download")}
                              </button>
                              <button
                                type="button"
                                className="quotation-inline-reset-btn"
                                style={{ background: "#fee2e2", borderColor: "#fecaca", color: "#991b1b" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void deleteQuotationHistoryEntry(row);
                                }}
                              >
                                <i className="fas fa-trash" /> {t("Delete")}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {status ? <div className="quotation-status">{status}</div> : null}

      <div className="quotation-grid">
        <PermissionGate moduleId="quotation" optionId="quotation_customer">
          <section className="quotation-card">
            <h3><i className="fas fa-user" /> {t("Customer Information")}</h3>
            <div className="quotation-form-grid">
              <label>
                <span>{t("Customer Name")}</span>
                <input value={customer.fullName} onChange={(e) => updateCustomer("fullName", e.target.value)} />
              </label>
              <label>
                <span>{t("Mobile")}</span>
                <input value={customer.mobile} onChange={(e) => updateCustomer("mobile", e.target.value)} />
              </label>
              <label>
                <span>{t("Email")}</span>
                <input value={customer.email} onChange={(e) => updateCustomer("email", e.target.value)} />
              </label>
              <label>
                <span>{t("Vehicle Plate")}</span>
                <input value={customer.vehiclePlate} onChange={(e) => updateCustomer("vehiclePlate", e.target.value)} />
              </label>
              <label>
                <span>{t("Vehicle Type")}</span>
                <select value={customer.vehicleType} onChange={(e) => updateCustomer("vehicleType", e.target.value)}>
                  <option value="SUV">{t("SUV")}</option>
                  <option value="SEDAN">{t("Sedan")}</option>
                  <option value="HATCHBACK">{t("Hatchback")}</option>
                  <option value="TRUCK">{t("Truck")}</option>
                  <option value="COUPE">{t("Coupe")}</option>
                  <option value="OTHER">{t("Other")}</option>
                </select>
              </label>
              <label>
                <span>{t("Quotation Valid Until")}</span>
                <input
                  type="date"
                  value={validityUntilDate}
                  onChange={(e) => setValidityUntilDate(e.target.value)}
                />
              </label>
              <label className="quotation-notes-field">
                <span>{t("Notes")}</span>
                <textarea value={customer.notes} onChange={(e) => updateCustomer("notes", e.target.value)} rows={4} />
              </label>
              {canViewRemarks ? (
                <>
                  <label className="quotation-notes-field">
                    <span className="quotation-label-with-action">
                      <span>{t("Remarks (English)")}</span>
                      {canEditRemarks ? (
                        <button
                          type="button"
                          className="quotation-inline-reset-btn"
                          onClick={() => {
                            const defaults = getDefaultRemarks(validityUntilDate);
                            setRemarkEnTouched(false);
                            setRemarkEnglish(defaults.english);
                          }}
                        >
                          {t("Reset to default")}
                        </button>
                      ) : null}
                    </span>
                    <textarea
                      value={remarkEnglish}
                      onChange={(e) => {
                        setRemarkEnTouched(true);
                        setRemarkEnglish(e.target.value);
                      }}
                      rows={4}
                      readOnly={!canEditRemarks}
                    />
                  </label>
                  <label className="quotation-notes-field">
                    <span className="quotation-label-with-action">
                      <span>{t("Remarks (Arabic)")}</span>
                      {canEditRemarks ? (
                        <button
                          type="button"
                          className="quotation-inline-reset-btn"
                          onClick={() => {
                            const defaults = getDefaultRemarks(validityUntilDate);
                            setRemarkArTouched(false);
                            setRemarkArabic(defaults.arabic);
                          }}
                        >
                          {t("Reset to default")}
                        </button>
                      ) : null}
                    </span>
                    <textarea
                      value={remarkArabic}
                      onChange={(e) => {
                        setRemarkArTouched(true);
                        setRemarkArabic(e.target.value);
                      }}
                      rows={4}
                      readOnly={!canEditRemarks}
                    />
                  </label>
                  {!canEditRemarks ? <div className="quotation-muted">{t("Remarks are view-only for your role.")}</div> : null}
                </>
              ) : null}
            </div>
          </section>
        </PermissionGate>

        <PermissionGate moduleId="quotation" optionId="quotation_catalog">
          <section className="quotation-card">
            <h3><i className="fas fa-tags" /> {t("Services & Packages")}</h3>
            {loadingCatalog ? <div className="quotation-muted">{t("Loading services and packages...")}</div> : null}
            {!loadingCatalog && !catalog.length ? <div className="quotation-muted">{t("No active services/packages found.")}</div> : null}

            {!loadingCatalog && catalog.length > 0 ? (
              <>
                <div className="quotation-subtitle">{t("Packages")}</div>
                <div className="quotation-catalog-grid">
                  {packagesOnly.map((item) => {
                    const selected = selectedCatalogIds.includes(item.id);
                    const price = resolveServicePriceForVehicleType(item, customer.vehicleType);
                    return (
                      <button
                        type="button"
                        key={item.id}
                        className={`quotation-chip ${selected ? "selected" : ""}`}
                        onClick={() => toggleCatalogSelection(item.id)}
                      >
                        <strong data-no-translate="true">{toBilingualName(item.name, item.nameAr, t("Package"))}</strong>
                        <span>{item.serviceCode}</span>
                        <span>{formatMoney(price)}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="quotation-subtitle">{t("Services")}</div>
                <div className="quotation-discount-row" style={{ marginBottom: 10 }}>
                  <label>
                    <span>{t("Service Category")}</span>
                    <select value={selectedServiceCategory} onChange={(e) => setSelectedServiceCategory(e.target.value)}>
                      <option value="all">{t("All Categories")}</option>
                      {serviceCategories.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{t("Search Services")}</span>
                    <div className="quotation-search-input-wrap">
                      <input
                        type="search"
                        value={serviceSearchTerm}
                        onChange={(e) => setServiceSearchTerm(e.target.value)}
                        placeholder={t("Type service name or code")}
                        className="quotation-search-input"
                      />
                      {serviceSearchTerm.trim() ? (
                        <button
                          type="button"
                          className="quotation-search-clear"
                          onClick={() => setServiceSearchTerm("")}
                          aria-label={t("Clear search")}
                          title={t("Clear search")}
                        >
                          <i className="fas fa-times" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </label>
                </div>
                {visibleServices.length === 0 ? (
                  <div className="quotation-muted" style={{ marginBottom: 10 }}>
                    {t("No services match this filter/search.")}
                  </div>
                ) : null}
                <div className="quotation-catalog-grid">
                  {visibleServices.map((item) => {
                    const selected = selectedCatalogIds.includes(item.id);
                    const price = resolveServicePriceForVehicleType(item, customer.vehicleType);
                    return (
                      <button
                        type="button"
                        key={item.id}
                        className={`quotation-chip ${selected ? "selected" : ""}`}
                        onClick={() => toggleCatalogSelection(item.id)}
                      >
                        <strong data-no-translate="true">{toBilingualName(item.name, item.nameAr, t("Service"))}</strong>
                        <span>{item.serviceCode}</span>
                        <span>{`${item.categoryNameEn || item.categoryCode || t("Uncategorized")} • ${formatMoney(price)}`}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
          </section>
        </PermissionGate>

        <PermissionGate moduleId="quotation" optionId="quotation_discount">
          <section className="quotation-card">
            <h3><i className="fas fa-percent" /> {t("Discount")}</h3>
            <div className="quotation-discount-row">
              <label>
                <span>{t("Discount Amount")}</span>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, maxAllowedDiscountAmount)}
                  step={0.01}
                  value={Number(discountAmount || 0)}
                  onChange={(e) => setDiscountAmount(Math.max(0, Number(e.target.value || 0)))}
                />
              </label>
              <label>
                <span>{t("Discount %")}</span>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, maxDiscountPercent)}
                  step={0.01}
                  value={Number(discountPercent.toFixed(2))}
                  onChange={(e) => {
                    const pct = Math.max(0, Math.min(maxDiscountPercent, Number(e.target.value || 0)));
                    setDiscountAmount((subtotal * pct) / 100);
                  }}
                />
              </label>
            </div>
            <div className="quotation-muted">
              {t("Max discount allowed by policy:")} {Number(maxDiscountPercent.toFixed(2))}% ({formatMoney(maxAllowedDiscountAmount)})
            </div>
          </section>
        </PermissionGate>

        <PermissionGate moduleId="quotation" optionId="quotation_summary">
          <section className="quotation-card">
            <h3><i className="fas fa-receipt" /> {t("Quotation Summary")}</h3>
            <div className="quotation-summary-list">
              {quotationDisplayLines.length === 0 ? <div className="quotation-muted">{t("No selected lines yet.")}</div> : null}
              {quotationDisplayLines.length > 0 ? (
                <div className="quotation-summary-head">
                  <span>{t("Service / Package")}</span>
                  <span>{t("Price")}</span>
                </div>
              ) : null}
              {quotationDisplayLines.map((line) => (
                <div key={line.key} className={`quotation-summary-row${line.isIncludedService ? " quotation-summary-row-included" : ""}`}>
                  <div>
                    <strong data-no-translate="true">{line.label}</strong>
                    {line.isPackage ? <small>{t("Included services are listed below without prices.")}</small> : null}
                  </div>
                  <div>{line.price == null ? "" : formatMoney(toMoney(line.price))}</div>
                </div>
              ))}
            </div>

            <div className="quotation-totals">
              <div><span>{t("Subtotal")}</span><strong>{formatMoney(subtotal)}</strong></div>
              <div><span>{t("Discount")}</span><strong>- {formatMoney(safeDiscount)}</strong></div>
              <div className="net"><span>{t("Net Quotation")}</span><strong>{formatMoney(netAmount)}</strong></div>
            </div>
          </section>
        </PermissionGate>
      </div>

      <div className="quotation-footer-note">
        {t("Prepared by")}: {String(currentUser?.email || currentUser?.name || "System")}
      </div>

      <div className="quotation-bottom-actions">
        <PermissionGate moduleId="quotation" optionId="quotation_generatepdf">
          <button
            type="button"
            className="quotation-generate-btn"
            onClick={() => void withLoading(buildQuotationPdf(), t("Generating PDF…"))}
            disabled={!requiredReady}
          >
            <i className="fas fa-file-pdf" /> {t("Generate Quotation PDF")}
          </button>
        </PermissionGate>
      </div>
    </div>
  );
}
