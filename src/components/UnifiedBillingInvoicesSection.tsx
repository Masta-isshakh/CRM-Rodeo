import type { CSSProperties } from "react";
import { toMoney } from "../utils/paymentStatus";
import { getPackageGroupKey, resolveDynamicBillingSnapshot } from "../utils/billingFinance";
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

function fmtQar(value: number): string {
  return `QAR ${Number.isFinite(value) ? value.toFixed(2) : "0.00"}`;
}

function getInvoiceStatusClass(status: string): string {
  const s = String(status || "").toLowerCase();
  if (s.includes("unpaid")) return "pim-payment-unpaid";
  if (s.includes("partial")) return "pim-payment-partial";
  if (s.includes("paid")) return "pim-payment-full";
  return "pim-payment-unpaid";
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
  const billing = order?.billing ?? {};
  const dynamicBilling = resolveDynamicBillingSnapshot(order, { paymentRows });
  const paymentSnap = dynamicBilling.paymentSnap;
  const serviceAudit = buildPackageAuditBreakdown(Array.isArray(order?.services) ? order.services : []);
  const paymentActivityLog = Array.isArray(order?.paymentActivityLog) ? order.paymentActivityLog : [];

  const invoices: InvoiceUi[] = Array.isArray(billing?.invoices)
    ? billing.invoices.map((inv: any, idx: number) => ({
        id: String(inv?.id ?? idx),
        number: String(inv?.number ?? "—"),
        amount: Math.max(0, toMoney(inv?.amount)),
        discount: Math.max(0, toMoney(inv?.discount)),
        status: String(inv?.status ?? "Unpaid"),
        paymentMethod: inv?.paymentMethod ?? null,
        services: Array.isArray(inv?.services) ? inv.services.map((s: any) => String(s)) : [],
        createdAt: inv?.createdAt ?? null,
      }))
    : [];

  return (
    <div className={`pim-detail-card bi-unified-card ${className}`.trim()} style={style}>
      <h3>
        <i className="fas fa-receipt"></i> Billing & Invoices
      </h3>

      <div className="pim-billing-grid bi-summary">
        <div className="pim-billing-item bi-row"><span className="bi-label">Bill ID</span><strong className="bi-value">{dynamicBilling.billId || "—"}</strong></div>
        <div className="pim-billing-item bi-row"><span className="bi-label">Total</span><strong className="bi-value">{fmtQar(paymentSnap.totalAmount)}</strong></div>
        <div className="pim-billing-item bi-row"><span className="bi-label">Discount</span><strong className="pim-green bi-value">{fmtQar(paymentSnap.discount)}</strong></div>
        <div className="pim-billing-item bi-row"><span className="bi-label">Net</span><strong className="bi-value">{fmtQar(paymentSnap.netAmount)}</strong></div>
        <div className="pim-billing-item bi-row"><span className="bi-label">Paid</span><strong className="pim-green bi-value">{fmtQar(paymentSnap.amountPaid)}</strong></div>
        <div className="pim-billing-item bi-row"><span className="bi-label">Balance Due</span><strong className="pim-red bi-value">{fmtQar(paymentSnap.balanceDue)}</strong></div>
      </div>

      {(serviceAudit.packageLines.length > 0 || serviceAudit.standaloneCount > 0) && (
        <div className="pim-subcard bi-package-audit-wrap">
          <div className="pim-subtitle bi-package-audit-title">
            <i className="fas fa-boxes"></i> Package Pricing Audit
          </div>

          <div className="bi-package-audit-table-wrap">
            <table className="bi-package-audit-table">
              <thead>
                <tr>
                  <th>Package / Group</th>
                  <th style={{ textAlign: "center" }}>Included Services</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {serviceAudit.packageLines.map((line) => (
                  <tr key={line.key}>
                    <td>
                      <span className="bi-package-name"><i className="fas fa-box-open"></i> {line.title}</span>
                    </td>
                    <td style={{ textAlign: "center" }}>{line.itemCount}</td>
                    <td style={{ textAlign: "right", fontWeight: 900 }}>{fmtQar(line.total)}</td>
                  </tr>
                ))}
                {serviceAudit.standaloneCount > 0 && (
                  <tr>
                    <td>
                      <span className="bi-package-name"><i className="fas fa-tools"></i> Individual Services (Non-package)</span>
                    </td>
                    <td style={{ textAlign: "center" }}>{serviceAudit.standaloneCount}</td>
                    <td style={{ textAlign: "right", fontWeight: 900 }}>{fmtQar(serviceAudit.standaloneTotal)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="pim-subcard bi-invoices-wrap">
        <div className="pim-subtitle bi-invoices-title">
          <i className="fas fa-file-invoice"></i> Invoices ({invoices.length})
        </div>

        {invoices.length === 0 ? (
          <div className="pim-empty-inline">No invoices found in normalized tables.</div>
        ) : (
          <div className="pim-invoices">
            {invoices.map((inv) => (
              <div key={inv.id} className="pim-invoice bi-invoice-card">
                <div className="pim-invoice-head">
                  <div className="pim-invoice-left">
                    <div className="pim-invoice-number">Invoice #{inv.number}</div>
                    {inv.createdAt ? (
                      <div className="pim-invoice-date">
                        {new Date(String(inv.createdAt)).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    ) : null}
                  </div>
                  <div className="pim-invoice-right">
                    <div className="pim-invoice-amount">{fmtQar(inv.amount)}</div>
                    <span className={`pim-badge ${getInvoiceStatusClass(inv.status)}`}>{inv.status}</span>
                  </div>
                </div>

                <div className="pim-invoice-meta">
                  <div><span>Discount</span><strong>{fmtQar(inv.discount)}</strong></div>
                  <div><span>Payment Method</span><strong>{inv.paymentMethod || "—"}</strong></div>
                </div>

                <div className="pim-invoice-services">
                  <div className="pim-invoice-services-title">
                    <i className="fas fa-list-ul"></i> Services Included
                  </div>
                  {inv.services.length === 0 ? (
                    <div className="pim-empty-inline">No services linked to this invoice.</div>
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
        <div className="pim-subtitle"><i className="fas fa-history"></i> Payment Activity Log</div>

        {paymentActivityLog.length ? (
          <div className="pim-table-wrap">
            <table className="pim-table">
              <thead>
                <tr>
                  <th>Serial</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Cashier</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {[...paymentActivityLog].reverse().map((payment: any, idx: number) => (
                  <tr key={idx}>
                    <td>{payment?.serial ?? idx + 1}</td>
                    <td>{String(payment?.amount ?? "—")}</td>
                    <td>{String(payment?.paymentMethod ?? payment?.method ?? "—")}</td>
                    <td>{String(payment?.cashierName ?? payment?.cashier ?? payment?.createdBy ?? "—")}</td>
                    <td>{String(payment?.timestamp ?? payment?.paidAt ?? payment?.createdAt ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="pim-empty-inline">No payment activity yet.</div>
        )}
      </div>
    </div>
  );
}

export default UnifiedBillingInvoicesSection;