import { useEffect, useMemo, useState } from "react";
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
    doc.setFontSize(style === "bolditalic" ? 12 : 9);
    doc.text(text, xRightMm, yTopMm + 3.4, { align: "right" });
    return;
  }

  const pxPerMm = 96 / 25.4;
  const scale = 2;
  const lineH = 4.4;
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

export default function QuotationPage({ currentUser }: { currentUser?: any; permissions?: any }) {
  const { t } = useLanguage();
  const { canOption, getOptionNumber } = usePermissions();

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
    doc.setFontSize(8.6);
    doc.text(issuedAtDisplay, pageW / 2, 12, { align: "center" });

    doc.setFontSize(12);
    doc.text("Rodeo Drive", pageW - marginX, 11, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    doc.text("for trading & services", pageW - marginX, 14.6, { align: "right" });
    drawArabicLine(doc, "روديو درايف للتجارة والخدمات", pageW - marginX, 16.8, 46, 10, "bold");

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
    doc.setFontSize(10);
    doc.text("QUOTATION #", rightX + 2, infoTop + 5.2);
    drawArabicLine(doc, "رقم الفاتورة", pageW - marginX - 2, infoTop + 1.8, 22, 8, "bold");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text(quoteNumber, rightX + 2, infoTop + 10.2);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.8);
    doc.text("Name:", leftX + 1, infoTop + 9.3);
    doc.text("Area:", leftX + 1, infoTop + 14.2);
    doc.text("Email:", leftX + 1, infoTop + 19.1);
    doc.text("Phone:", leftX + 1, infoTop + 24);
    doc.setFont("helvetica", "normal");
    doc.text(safeText(customer.fullName) || "-", leftX + 23, infoTop + 9.3);
    doc.text("-", leftX + 23, infoTop + 14.2);
    doc.text(safeText(customer.email) || "-", leftX + 23, infoTop + 19.1);
    doc.text(safeText(customer.mobile) || "-", leftX + 23, infoTop + 24);

    drawArabicLine(doc, "اسم العميل:", centerX + centerW - 2, infoTop + 5.8, centerW - 4, 8, "normal");
    drawArabicLine(doc, "اسم المنطقة:", centerX + centerW - 2, infoTop + 10.7, centerW - 4, 8, "normal");
    drawArabicLine(doc, "الإيميل:", centerX + centerW - 2, infoTop + 15.6, centerW - 4, 8, "normal");
    drawArabicLine(doc, "رقم الهاتف:", centerX + centerW - 2, infoTop + 20.5, centerW - 4, 8, "normal");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.8);
    doc.text("Year:", rightX + 2, infoTop + 14.7);
    doc.text("Model:", rightX + 2, infoTop + 19.6);
    doc.text("Color:", rightX + 2, infoTop + 24.5);
    doc.text("Plate #", rightX + 2, infoTop + 29.4);
    doc.setFont("helvetica", "normal");
    doc.text("-", rightX + 24, infoTop + 14.7);
    doc.text(safeText(customer.vehicleType) || "-", rightX + 24, infoTop + 19.6);
    doc.text("-", rightX + 24, infoTop + 24.5);
    doc.text(safeText(customer.vehiclePlate) || "-", rightX + 24, infoTop + 29.4);

    drawArabicLine(doc, "سنة الصنع:", pageW - marginX - 2, infoTop + 11.2, 20, 8, "normal");
    drawArabicLine(doc, "الموديل:", pageW - marginX - 2, infoTop + 16.1, 20, 8, "normal");
    drawArabicLine(doc, "اللون:", pageW - marginX - 2, infoTop + 21.0, 20, 8, "normal");
    drawArabicLine(doc, "رقم اللوحة:", pageW - marginX - 2, infoTop + 25.9, 20, 8, "normal");

    // Services table
    const tableTop = 78;
    const rowsCount = 11;
    const rowH = 7.2;
    const tableH = rowH * (rowsCount + 1);
    const amountW = 28;
    const descW = contentW - amountW;

    doc.rect(marginX, tableTop, contentW, tableH);
    doc.line(marginX + descW, tableTop, marginX + descW, tableTop + tableH);
    doc.line(marginX, tableTop + rowH, marginX + contentW, tableTop + rowH);
    for (let i = 1; i <= rowsCount; i += 1) {
      doc.line(marginX, tableTop + rowH + i * rowH, marginX + contentW, tableTop + rowH + i * rowH);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.4);
    doc.text("Service / الخدمة", marginX + 2, tableTop + 5.1);
    doc.text("AMOUNT | المبلغ", pageW - marginX - 2, tableTop + 5.1, { align: "right" });

    const shown = selectedLines.slice(0, rowsCount);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.1);
    shown.forEach((line, idx) => {
      const y = tableTop + rowH + idx * rowH + 5;
      const title = safeText(toBilingualName(line.name, line.nameAr, t("Service")));
      const titleClipped = title.length > 62 ? `${title.slice(0, 62)}...` : title;
      doc.text(titleClipped, marginX + 2, y);
      doc.text(formatMoney(toMoney(line.price)), pageW - marginX - 2, y, { align: "right" });
    });

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

    doc.rect(totalsX, totalsTop, totalsW, totalsRowH * totals.length);
    for (let i = 1; i < totals.length; i += 1) {
      doc.line(totalsX, totalsTop + i * totalsRowH, totalsX + totalsW, totalsTop + i * totalsRowH);
    }
    doc.line(totalsX + 45, totalsTop, totalsX + 45, totalsTop + totalsRowH * totals.length);

    totals.forEach(([en, ar, value], idx) => {
      const y = totalsTop + idx * totalsRowH + 4.3;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.3);
      doc.text(en, totalsX + 2, y);
      drawArabicLine(doc, ar, totalsX + 42.5, y - 2.5, 16, 8, "bold", en === "DISCOUNT" ? "#cc1f1a" : "#111827");
      if (en === "DISCOUNT") doc.setTextColor(204, 31, 26);
      doc.text(en === "TAX RATE" ? `${value}%` : formatMoney(Number(value || 0)), totalsX + totalsW - 2, y, { align: "right" });
      doc.setTextColor(17, 24, 39);
    });

    // Remarks and terms
    const remarksTop = totalsTop + totalsRowH * totals.length + 5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.2);
    doc.text("Remarks", marginX + 1, remarksTop);
    drawArabicLine(doc, "إيضاحات", marginX + 86, remarksTop - 3.1, 18, 8, "bold");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.9);
    doc.text("1) The customer agrees to the terms and conditions mentioned in the vehicle receipt paper and the services mentioned in this invoice", marginX + 1, remarksTop + 4.8);
    doc.text("2) Warranty terms and conditions apply to the services provided in this invoice and it is the customer's responsibility to read them before ordering the services.", marginX + 1, remarksTop + 8.8);
    drawArabicLine(doc, "1) يوافق العميل على الشروط والأحكام المذكورة في ورقة استلام المركبة والخدمات المذكورة في هذه الفاتورة.", pageW - marginX - 1, remarksTop + 3.0, 118, 7, "normal");
    drawArabicLine(doc, "2) تنطبق شروط وأحكام الضمان على الخدمات المقدمة في هذه الفاتورة وتقع مسؤولية قراءتها على العميل قبل طلب الخدمات.", pageW - marginX - 1, remarksTop + 7.2, 118, 7, "normal");

    // Footer with QR and contact
    const footerTop = pageH - 42;
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
    doc.rect(pageW - marginX - 54, footerTop + 20.8, 54, 16, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.6);
    doc.text("TOTAL SERVICES", pageW - marginX - 52, footerTop + 25.8);
    doc.text("TOTAL TAX", pageW - marginX - 52, footerTop + 30.3);
    doc.text("400 QAR", pageW - marginX - 2, footerTop + 25.8, { align: "right" });
    doc.text(`${formatMoney(netAmount)} QAR`, pageW - marginX - 2, footerTop + 35.1, { align: "right" });
    drawArabicLine(doc, "الإجمالي مع الضريبة", pageW - marginX - 2, footerTop + 31.8, 33, 8, "bold");

    const fileName = `${safeText(t("Quotation")) || "Quotation"}_${quoteNumber}.pdf`;
    doc.save(fileName);
    setStatus(t("Quotation PDF generated successfully."));
  };

  return (
    <div className="quotation-page">
      <div className="quotation-hero">
        <div>
          <h2><i className="fas fa-file-signature" /> {t("Quotation Builder")}</h2>
          <p>{t("Create customer quotations with live service/package pricing and policy-based discount limits.")}</p>
        </div>
        <PermissionGate moduleId="quotation" optionId="quotation_generatepdf">
          <button
            type="button"
            className="quotation-generate-btn"
            onClick={() => void buildQuotationPdf()}
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
                  <option value="SUV">SUV</option>
                  <option value="SEDAN">Sedan</option>
                  <option value="HATCHBACK">Hatchback</option>
                  <option value="TRUCK">Truck</option>
                  <option value="COUPE">Coupe</option>
                  <option value="OTHER">Other</option>
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
                        <strong>{toBilingualName(item.name, item.nameAr, "Package")}</strong>
                        <span>{item.serviceCode}</span>
                        <span>{formatMoney(price)}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="quotation-subtitle">{t("Services")}</div>
                <div className="quotation-catalog-grid">
                  {servicesOnly.map((item) => {
                    const selected = selectedCatalogIds.includes(item.id);
                    const price = resolveServicePriceForVehicleType(item, customer.vehicleType);
                    return (
                      <button
                        type="button"
                        key={item.id}
                        className={`quotation-chip ${selected ? "selected" : ""}`}
                        onClick={() => toggleCatalogSelection(item.id)}
                      >
                        <strong>{toBilingualName(item.name, item.nameAr, "Service")}</strong>
                        <span>{item.serviceCode}</span>
                        <span>{formatMoney(price)}</span>
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
              {selectedLines.length === 0 ? <div className="quotation-muted">{t("No selected lines yet.")}</div> : null}
              {selectedLines.map((line, idx) => (
                <div key={`${line.packageCode || "single"}-${line.serviceCode || line.catalogId || idx}`} className="quotation-summary-row">
                  <div>
                    <strong>{toBilingualName(line.name, line.nameAr, "Service")}</strong>
                    {line.packageName ? <small>{t("Package")}: {line.packageName}</small> : null}
                  </div>
                  <div>{formatMoney(toMoney(line.price))}</div>
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
