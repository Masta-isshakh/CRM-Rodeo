import { useEffect, useMemo, useState } from "react";
import { useGlobalLoading } from "../utils/GlobalLoadingContext";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import "./QuotationPage.css";
import PermissionGate from "./PermissionGate";
import { useLanguage } from "../i18n/LanguageContext";
import { usePermissions } from "../lib/userPermissions";
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

export default function QuotationPage({ currentUser }: { currentUser?: any; permissions?: any }) {
  const { t } = useLanguage();
  const { canOption, getOptionNumber } = usePermissions();
  const { withLoading } = useGlobalLoading();

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
  const [discountAmount, setDiscountAmount] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingCatalog(true);
      setStatus("");
      try {
        const rows = await listServiceCatalog();
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
  }, [t]);

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
    if (selectedServiceCategory === "all") return servicesOnly;
    return servicesOnly.filter((item) => {
      const category = String(item.categoryNameEn || item.categoryCode || item.categoryId || "").trim();
      return category === selectedServiceCategory;
    });
  }, [servicesOnly, selectedServiceCategory]);

  const packagesOnly = useMemo(
    () => catalog.filter((item) => String(item.type).toLowerCase() === "package"),
    [catalog]
  );

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
    const docTextSize = 10;
    const docTitleSize = 12;
    const quoteNumber = `QT-${Date.now().toString().slice(-8)}`;
    const issuedAt = new Date();
    const issuedAtDisplay = issuedAt.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    let logoDataUrl = "";
    try {
      const logoRes = await fetch(logo);
      if (logoRes.ok) logoDataUrl = await blobToDataUrl(await logoRes.blob());
    } catch {
      logoDataUrl = "";
    }

    let qrDataUrl = "";
    try {
      qrDataUrl = await QRCode.toDataURL(
        [
          `Quotation: ${quoteNumber}`,
          `Customer: ${safeText(customer.fullName) || "-"}`,
          `Mobile: ${safeText(customer.mobile) || "-"}`,
          `Net: ${netAmount.toFixed(2)} QAR`,
        ].join(" | "),
        { errorCorrectionLevel: "M", margin: 1, width: 180 },
      );
    } catch {
      qrDataUrl = "";
    }

    doc.setDrawColor(40, 40, 40);
    doc.setLineWidth(0.3);

    // Header
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "JPEG", marginX + 3, 8, 15, 15);
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(docTextSize);
    doc.text(issuedAtDisplay, pageW / 2, 12, { align: "center" });

    doc.setFontSize(docTitleSize);
    doc.text("Rodeo Drive", pageW - marginX, 11, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(docTextSize);
    doc.text("for trading & services", pageW - marginX, 14.6, { align: "right" });
    drawArabicLine(doc, "روديو درايف للتجارة والخدمات", pageW - marginX, 16.8, 46, docTextSize, "bold");

    // Quotation details block
    const infoTop = 40;
    const infoH = 33;
    const leftX = marginX + 3;
    const leftW = 74;
    const centerX = leftX + leftW;
    const centerW = 44;
    const rightX = centerX + centerW;

    doc.rect(marginX, infoTop, contentW, infoH);
    doc.line(centerX, infoTop, centerX, infoTop + infoH);
    doc.line(rightX, infoTop, rightX, infoTop + infoH);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(docTextSize);
    doc.text("QUOTATION #", rightX + 2, infoTop + 5.2);
    drawArabicLine(doc, "رقم الفاتورة", pageW - marginX - 2, infoTop + 1.8, 22, docTextSize, "bold");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(docTextSize);
    doc.text(quoteNumber, rightX + 2, infoTop + 10.2);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(docTextSize);
    doc.text("Name:", leftX + 1, infoTop + 9.3);
    doc.text("Area:", leftX + 1, infoTop + 14.2);
    doc.text("Email:", leftX + 1, infoTop + 19.1);
    doc.text("Phone:", leftX + 1, infoTop + 24);
    doc.setFont("helvetica", "normal");
    doc.text(safeText(customer.fullName) || "-", leftX + 23, infoTop + 9.3);
    doc.text("-", leftX + 23, infoTop + 14.2);
    doc.text(safeText(customer.email) || "-", leftX + 23, infoTop + 19.1);
    doc.text(safeText(customer.mobile) || "-", leftX + 23, infoTop + 24);

    drawArabicLine(doc, "اسم العميل:", centerX + centerW - 2, infoTop + 5.8, centerW - 4, docTextSize, "normal");
    drawArabicLine(doc, "اسم المنطقة:", centerX + centerW - 2, infoTop + 10.7, centerW - 4, docTextSize, "normal");
    drawArabicLine(doc, "الإيميل:", centerX + centerW - 2, infoTop + 15.6, centerW - 4, docTextSize, "normal");
    drawArabicLine(doc, "رقم الهاتف:", centerX + centerW - 2, infoTop + 20.5, centerW - 4, docTextSize, "normal");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(docTextSize);
    doc.text("Year:", rightX + 2, infoTop + 14.7);
    doc.text("Model:", rightX + 2, infoTop + 19.6);
    doc.text("Color:", rightX + 2, infoTop + 24.5);
    doc.text("Plate #", rightX + 2, infoTop + 29.4);
    doc.setFont("helvetica", "normal");
    doc.text("-", rightX + 24, infoTop + 14.7);
    doc.text(safeText(customer.vehicleType) || "-", rightX + 24, infoTop + 19.6);
    doc.text("-", rightX + 24, infoTop + 24.5);
    doc.text(safeText(customer.vehiclePlate) || "-", rightX + 24, infoTop + 29.4);

    drawArabicLine(doc, "سنة الصنع:", pageW - marginX - 2, infoTop + 11.2, 20, docTextSize, "normal");
    drawArabicLine(doc, "الموديل:", pageW - marginX - 2, infoTop + 16.1, 20, docTextSize, "normal");
    drawArabicLine(doc, "اللون:", pageW - marginX - 2, infoTop + 21.0, 20, docTextSize, "normal");
    drawArabicLine(doc, "رقم اللوحة:", pageW - marginX - 2, infoTop + 25.9, 20, docTextSize, "normal");

    // Services table
    const footerTop = pageH - 42;
    const tableTop = 78;
    const rowH = 8.8;
    const reservedBelowTable = 90;
    const maxRowsForLayout = Math.max(4, Math.floor((footerTop - tableTop - reservedBelowTable) / rowH));
    const rowsCount = Math.max(1, Math.min(quotationDisplayLines.length, maxRowsForLayout));
    const tableH = rowH * (rowsCount + 1);
    const amountW = 34;
    const descW = contentW - amountW;
    const amountRightX = pageW - marginX - 2;

    doc.rect(marginX, tableTop, contentW, tableH);
    doc.line(marginX + descW, tableTop, marginX + descW, tableTop + tableH);
    doc.line(marginX, tableTop + rowH, marginX + contentW, tableTop + rowH);
    for (let i = 1; i <= rowsCount; i += 1) {
      doc.line(marginX, tableTop + rowH + i * rowH, marginX + contentW, tableTop + rowH + i * rowH);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(docTextSize);
    doc.text("Service", marginX + 2, tableTop + 7.8);
    drawArabicLine(doc, "الخدمة", marginX + descW - 5, tableTop + 1.7, 20, docTextSize, "bold");
    doc.text("AMOUNT", amountRightX, tableTop + 8.4, { align: "right" });
    drawArabicLine(doc, "مبلغ الخدمة", amountRightX, tableTop + 1.1, amountW - 6, docTextSize, "bold");

    const shown = quotationDisplayLines.slice(0, rowsCount);
    shown.forEach((line, idx) => {
      const y = tableTop + rowH + idx * rowH + 5;
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
      doc.text(englishLine, englishX, y + 1.8);
      if (titleParts.ar) {
        drawArabicLine(
          doc,
          titleParts.ar,
          arabicRightX,
          y - 0.4,
          arabicW,
          docTextSize,
          isPackageHeader ? "bold" : "normal",
          isIncludedService ? "#718096" : "#111827"
        );
      }
      const amountText = line.price == null ? "" : formatMoney(toMoney(line.price));
      doc.text(amountText, amountRightX, y + 1.8, { align: "right" });
    });
    doc.setTextColor(17, 24, 39);

    // Totals block
    const totalsTop = tableTop + tableH + 4;
    const totalsW = 74;
    const totalsX = pageW - marginX - totalsW;
    const totalsRowH = 6;
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

    doc.rect(totalsX, totalsTop, totalsW, totalsRowH * totals.length);
    for (let i = 1; i < totals.length; i += 1) {
      doc.line(totalsX, totalsTop + i * totalsRowH, totalsX + totalsW, totalsTop + i * totalsRowH);
    }
    doc.line(totalsX + 45, totalsTop, totalsX + 45, totalsTop + totalsRowH * totals.length);

    totals.forEach(([en, ar, value], idx) => {
      const y = totalsTop + idx * totalsRowH + 4.3;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(docTextSize);
      doc.text(en, totalsX + 2, y);
      drawArabicLine(doc, ar, totalsX + 42.5, y - 2.5, 16, docTextSize, "bold", en === "DISCOUNT" ? "#cc1f1a" : "#111827");
      if (en === "DISCOUNT") doc.setTextColor(204, 31, 26);
      doc.text(en === "TAX RATE" ? `${value}%` : formatMoney(Number(value || 0)), totalsX + totalsW - 2, y, { align: "right" });
      doc.setTextColor(17, 24, 39);
    });

    // Remarks and terms
    const remarksTop = totalsTop + totalsRowH * totals.length + 3;
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
    const remarksFirstY = remarksTop + 4.8;
    const remarksFirstLines = drawWrapped(
      "1) The customer agrees to the terms and conditions mentioned in the vehicle receipt paper and the services mentioned in this invoice.",
      remarksLeftX,
      remarksFirstY,
      remarksLeftW,
      remarksLineHeight,
      "left"
    );
    const remarksSecondY = remarksFirstY + remarksFirstLines * remarksLineHeight + 1.2;
    drawWrapped(
      "2) Warranty terms and conditions apply to the services provided in this invoice and it is the customer's responsibility to read them before ordering the services.",
      remarksLeftX,
      remarksSecondY,
      remarksLeftW,
      remarksLineHeight,
      "left"
    );
    const remarksArabicLineGap = 0.4;
    const remarksArabicLineHeight = 4.4 + remarksArabicLineGap;
    const remarksArabicFirstY = remarksFirstY - 0.2;
    const remarksArabicFirstLines = drawWrappedArabicLines(
      doc,
      "1) يوافق العميل على الشروط والأحكام المذكورة في ورقة استلام المركبة والخدمات المذكورة في هذه الفاتورة.",
      remarksRightX,
      remarksArabicFirstY,
      remarksRightW,
      remarksTextSize,
      "normal",
      "#181818",
      remarksArabicLineGap
    );
    const remarksArabicSecondY = remarksArabicFirstY + remarksArabicFirstLines * remarksArabicLineHeight + 1.2;
    drawWrappedArabicLines(
      doc,
      "2) تنطبق شروط وأحكام الضمان على الخدمات المقدمة في هذه الفاتورة وتقع مسؤولية قراءتها على العميل قبل طلب الخدمات.",
      remarksRightX,
      remarksArabicSecondY,
      remarksRightW,
      remarksTextSize,
      "normal",
      "#181818",
      remarksArabicLineGap
    );

    // Footer with QR and contact
    doc.line(marginX, footerTop, pageW - marginX, footerTop);
    if (qrDataUrl) {
      doc.addImage(qrDataUrl, "PNG", marginX + 1.5, footerTop + 2.2, 20, 20);
      doc.setFont("helvetica", "bold");
      doc.setFillColor(0, 0, 0);
      doc.setTextColor(255, 255, 255);
      doc.rect(marginX + 1.5, footerTop + 22.5, 20, 5.5, "F");
      doc.setFontSize(7.5);
      doc.text("SCAN ME", marginX + 11.5, footerTop + 26.2, { align: "center" });
      doc.setTextColor(17, 24, 39);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.8);
    doc.text("Address", marginX + 55, footerTop + 6);
    doc.text("Contact", marginX + 106, footerTop + 6);
    doc.text("WEB", marginX + 141, footerTop + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.text("Shop No SYS 062, Block 21, Barwa", marginX + 55, footerTop + 10.2);
    doc.text("Commercial Avenue, Industrial Area", marginX + 55, footerTop + 14.2);
    doc.text("Rd. Doha", marginX + 55, footerTop + 18.2);
    doc.text("+974 4431 1871", marginX + 106, footerTop + 10.2);
    doc.text("+974 3320 2409", marginX + 106, footerTop + 14.2);
    doc.text("support@rod.qa", marginX + 106, footerTop + 18.2);
    doc.text("www.rod.qa", marginX + 141, footerTop + 10.2);
    doc.text("@rodeo.drive.qa", marginX + 141, footerTop + 14.2);

    doc.setFillColor(239, 239, 239);
    const footerSummaryX = pageW - marginX - 62;
    const footerSummaryW = 62;
    const footerSummaryY = footerTop + 18.4;
    const footerSummaryRowH = 5.8;
    const footerSummaryRows: Array<{ label: string; value: string }> = [
      { label: "TOTAL SERVICES", value: `${formatMoney(subtotal)} QAR` },
      { label: "TOTAL DISCOUNT", value: `${formatMoney(safeDiscount)} QAR` },
      { label: "NET TOTAL", value: `${formatMoney(netAmount)} QAR` },
    ];

    doc.rect(footerSummaryX, footerSummaryY, footerSummaryW, footerSummaryRowH * footerSummaryRows.length, "F");
    doc.setDrawColor(210, 210, 210);
    doc.setLineWidth(0.2);
    for (let i = 1; i < footerSummaryRows.length; i += 1) {
      doc.line(
        footerSummaryX,
        footerSummaryY + i * footerSummaryRowH,
        footerSummaryX + footerSummaryW,
        footerSummaryY + i * footerSummaryRowH
      );
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.6);
    footerSummaryRows.forEach((row, idx) => {
      const y = footerSummaryY + idx * footerSummaryRowH + 4;
      doc.text(row.label, footerSummaryX + 2, y);
      doc.text(row.value, footerSummaryX + footerSummaryW - 2, y, { align: "right" });
    });

    const pdfBlob = doc.output("blob") as Blob;
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const opened = window.open(pdfUrl, "_blank", "noopener,noreferrer");
    if (!opened) {
      setStatus(t("Popup blocked. Please allow popups and try again."));
      URL.revokeObjectURL(pdfUrl);
      return;
    }
    opened.focus();
    window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
    setStatus(t("Quotation opened in a new tab."));
  };

  return (
    <div className="quotation-page">
      <div className="quotation-hero">
        <div className="quotation-hero-main">
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
              <label className="quotation-notes-field">
                <span>{t("Notes")}</span>
                <textarea value={customer.notes} onChange={(e) => updateCustomer("notes", e.target.value)} rows={4} />
              </label>
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
                </div>
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
    </div>
  );
}
