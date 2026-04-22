import type { CSSProperties } from "react";
import { toMoney } from "../utils/paymentStatus";
import { getPackageGroupKey, resolveDynamicBillingSnapshot } from "../utils/billingFinance";
import { useLanguage } from "../i18n/LanguageContext";
import "../pages/PaymentInvoiceManagment.css";

type UnifiedBillingInvoicesSectionProps = {
  order: any;
  className?: string;
  style?: CSSProperties;
  paymentRows?: any[];
};

type InvoiceUi = {
  id: string;
  number: string;
  amount: number;
  discount: number;
  status: string;
  paymentMethod?: string | null;
  services: string[];
  createdAt?: string | null;
};

type PackageAuditLine = {
  key: string;
  title: string;
  itemCount: number;
  total: number;
};

function normalizeInvoiceStatus(status: any): "paid" | "partial" | "unpaid" {
  const s = String(status ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!s) return "unpaid";
  if (s.includes("fullypaid") || s === "paid") return "paid";
  if (s.includes("partial") || s.includes("partially")) return "partial";
  if (s.includes("unpaid") || s.includes("notpaid")) return "unpaid";
  return "unpaid";
}

function getInvoiceStatusClass(status: string): string {
  const normalized = normalizeInvoiceStatus(status);
  if (normalized === "unpaid") return "pim-payment-unpaid";
  if (normalized === "partial") return "pim-payment-partial";
  if (normalized === "paid") return "pim-payment-full";
  return "pim-payment-unpaid";
}

function asArrayOfStrings(input: any): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function normalizeInvoiceServices(inv: any): string[] {
  const direct = asArrayOfStrings(inv?.services);
  if (direct.length > 0) return direct;

  if (Array.isArray(inv?.items)) {
    const fromItems = inv.items
      .map((item: any) => String(item?.serviceName ?? item?.name ?? item?.title ?? "").trim())
      .filter(Boolean);
    if (fromItems.length > 0) return fromItems;
  }

  return [];
}

function formatInvoiceStatusForUi(status: any, t: (englishText: string) => string): string {
  const normalized = normalizeInvoiceStatus(status);
  if (normalized === "paid") return t("Fully Paid");
  if (normalized === "partial") return t("Partially Paid");
  return t("Unpaid");
}

function toLocalizedDateTime(value: any, locale: string): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildPackageAuditBreakdown(services: any[]) {
  const packageMap = new Map<string, PackageAuditLine>();
  let standaloneCount = 0;
  let standaloneTotal = 0;

  for (const service of services) {
    const servicePrice = Math.max(0, toMoney(service?.price));
    const packagePrice = Math.max(0, toMoney(service?.packagePrice));
    const groupKey = getPackageGroupKey(service);

    if (!groupKey) {
      standaloneCount += 1;
      standaloneTotal += servicePrice;
      continue;
    }

    const packageTitle = String(service?.packageName ?? service?.packageCode ?? service?.groupName ?? "Package").trim() || "Package";
    const line = packageMap.get(groupKey) ?? {
      key: groupKey,
      title: packageTitle,
      itemCount: 0,
      total: 0,
    };

    line.itemCount += 1;
    if (line.total <= 0) {
      line.total = packagePrice > 0 ? packagePrice : servicePrice;
    }

    packageMap.set(groupKey, line);
  }

  return {
    packageLines: [...packageMap.values()],
    standaloneCount,
    standaloneTotal,
  };
}

export function UnifiedBillingInvoicesSection({ order, className = "", style, paymentRows }: UnifiedBillingInvoicesSectionProps) {
  const { language, t } = useLanguage();
  const locale = language === "ar" ? "ar-QA" : "en-QA";
  const formatMoney = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "QAR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);

  const billing = order?.billing ?? {};
  const dynamicBilling = resolveDynamicBillingSnapshot(order, { paymentRows });
  const paymentSnap = dynamicBilling.paymentSnap;
  const resolvedBillId =
    String(
      dynamicBilling.billId ??
        order?.billReference ??
        order?.billing?.billReference ??
        order?.billing?.billId ??
        order?.orderNumber ??
        order?.id ??
        ""
    ).trim() || "—";
  const serviceAudit = buildPackageAuditBreakdown(Array.isArray(order?.services) ? order.services : []);
  const paymentActivityLog = Array.isArray(order?.paymentActivityLog) ? order.paymentActivityLog : [];

  const invoices: InvoiceUi[] = Array.isArray(billing?.invoices)
    ? billing.invoices.map((inv: any, idx: number) => ({
        id: String(inv?.id ?? idx),
        number: String(inv?.number ?? inv?.invoiceNumber ?? inv?.billReference ?? "—"),
        amount: Math.max(0, toMoney(inv?.amount ?? inv?.totalAmount ?? inv?.netAmount)),
        discount: Math.max(0, toMoney(inv?.discount ?? inv?.discountAmount)),
        status: formatInvoiceStatusForUi(inv?.status ?? inv?.paymentStatusLabel ?? inv?.paymentStatus, t),
        paymentMethod: inv?.paymentMethod ?? inv?.method ?? null,
        services: normalizeInvoiceServices(inv),
        createdAt: inv?.createdAt ?? inv?.issuedAt ?? inv?.invoiceDate ?? null,
      }))
    : [];

  return (
    <div className={`pim-detail-card bi-unified-card ${className}`.trim()} style={style}>
      <h3>
        <i className="fas fa-receipt"></i> {t("Billing & Invoices")}
      </h3>

      <div className="pim-billing-grid bi-summary">
        <div className="pim-billing-item bi-row"><span className="bi-label">{t("Bill ID")}</span><strong className="bi-value">{resolvedBillId}</strong></div>
        <div className="pim-billing-item bi-row"><span className="bi-label">{t("Total")}</span><strong className="bi-value">{formatMoney(paymentSnap.totalAmount)}</strong></div>
        <div className="pim-billing-item bi-row"><span className="bi-label">{t("Discount")}</span><strong className="pim-green bi-value">{formatMoney(paymentSnap.discount)}</strong></div>
        <div className="pim-billing-item bi-row"><span className="bi-label">{t("Net")}</span><strong className="bi-value">{formatMoney(paymentSnap.netAmount)}</strong></div>
        <div className="pim-billing-item bi-row"><span className="bi-label">{t("Paid")}</span><strong className="pim-green bi-value">{formatMoney(paymentSnap.amountPaid)}</strong></div>
        <div className="pim-billing-item bi-row"><span className="bi-label">{t("Balance Due")}</span><strong className="pim-red bi-value">{formatMoney(paymentSnap.balanceDue)}</strong></div>
      </div>

      {(serviceAudit.packageLines.length > 0 || serviceAudit.standaloneCount > 0) && (
        <div className="pim-subcard bi-package-audit-wrap">
          <div className="pim-subtitle bi-package-audit-title">
            <i className="fas fa-boxes"></i> {t("Package Pricing Audit")}
          </div>

          <div className="bi-package-audit-table-wrap">
            <table className="bi-package-audit-table">
              <thead>
                <tr>
                  <th>{t("Package / Group")}</th>
                  <th style={{ textAlign: "center" }}>{t("Included Services")}</th>
                  <th style={{ textAlign: "right" }}>{t("Total")}</th>
                </tr>
              </thead>
              <tbody>
                {serviceAudit.packageLines.map((line) => (
                  <tr key={line.key}>
                    <td>
                      <span className="bi-package-name"><i className="fas fa-box-open"></i> {line.title}</span>
                    </td>
                    <td style={{ textAlign: "center" }}>{line.itemCount}</td>
                    <td style={{ textAlign: "right", fontWeight: 900 }}>{formatMoney(line.total)}</td>
                  </tr>
                ))}
                {serviceAudit.standaloneCount > 0 && (
                  <tr>
                    <td>
                      <span className="bi-package-name"><i className="fas fa-tools"></i> {t("Individual Services (Non-package)")}</span>
                    </td>
                    <td style={{ textAlign: "center" }}>{serviceAudit.standaloneCount}</td>
                    <td style={{ textAlign: "right", fontWeight: 900 }}>{formatMoney(serviceAudit.standaloneTotal)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="pim-subcard bi-invoices-wrap">
        <div className="pim-subtitle bi-invoices-title">
          <i className="fas fa-file-invoice"></i> {t("Invoices")} ({invoices.length})
        </div>

        {invoices.length === 0 ? (
          <div className="pim-empty-inline">{t("No invoices found in normalized tables.")}</div>
        ) : (
          <div className="pim-invoices">
            {invoices.map((inv) => (
              <div key={inv.id} className="pim-invoice bi-invoice-card">
                <div className="pim-invoice-head">
                  <div className="pim-invoice-left">
                    <div className="pim-invoice-number">{t("Invoice #")} {inv.number}</div>
                    {inv.createdAt ? (
                      <div className="pim-invoice-date">
                        {toLocalizedDateTime(inv.createdAt, locale)}
                      </div>
                    ) : null}
                  </div>
                  <div className="pim-invoice-right">
                    <div className="pim-invoice-amount">{formatMoney(inv.amount)}</div>
                    <span className={`pim-badge ${getInvoiceStatusClass(inv.status)}`}>{inv.status}</span>
                  </div>
                </div>

                <div className="pim-invoice-meta">
                  <div><span>{t("Discount")}</span><strong>{formatMoney(inv.discount)}</strong></div>
                  <div><span>{t("Payment Method")}</span><strong>{inv.paymentMethod || "—"}</strong></div>
                </div>

                <div className="pim-invoice-services">
                  <div className="pim-invoice-services-title">
                    <i className="fas fa-list-ul"></i> {t("Services Included")}
                  </div>
                  {inv.services.length === 0 ? (
                    <div className="pim-empty-inline">{t("No services linked to this invoice.")}</div>
                  ) : (
                    <ul className="pim-invoice-services-list">
                      {inv.services.map((serviceName, idx) => (
                        <li key={idx}><i className="fas fa-check-circle"></i> {serviceName}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pim-subcard">
        <div className="pim-subtitle"><i className="fas fa-history"></i> {t("Payment Activity Log")}</div>

        {paymentActivityLog.length ? (
          <div className="pim-table-wrap">
            <table className="pim-table">
              <thead>
                <tr>
                  <th>{t("Serial")}</th>
                  <th>{t("Amount")}</th>
                  <th>{t("Method")}</th>
                  <th>{t("Cashier")}</th>
                  <th>{t("Timestamp")}</th>
                </tr>
              </thead>
              <tbody>
                {[...paymentActivityLog].reverse().map((payment: any, idx: number) => (
                  <tr key={idx}>
                    <td>{payment?.serial ?? idx + 1}</td>
                    <td>{formatMoney(Math.max(0, toMoney(payment?.amount)))}</td>
                    <td>{String(payment?.paymentMethod ?? payment?.method ?? "—")}</td>
                    <td>{String(payment?.cashierName ?? payment?.cashier ?? payment?.createdBy ?? "—")}</td>
                    <td>{toLocalizedDateTime(payment?.timestamp ?? payment?.paidAt ?? payment?.createdAt, locale) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="pim-empty-inline">{t("No payment activity yet.")}</div>
        )}
      </div>
    </div>
  );
}

export default UnifiedBillingInvoicesSection;