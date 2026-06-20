// UnifiedBillingInvoicesCard.tsx
// Reusable unified billing & invoices card — follows Customer.tsx design language exactly.

import { useLanguage } from "../i18n/LanguageContext";
import { normalizePaymentStatusLabel } from "../utils/paymentStatus";

function joStr(v: any) { return String(v ?? "").trim(); }
function joFirst(...vals: any[]): string {
  for (const v of vals) { const s = joStr(v); if (s) return s; }
  return "—";
}

function toCurrencyDisplay(v: any): string {
  const s = joStr(v);
  if (!s || s === "—") return "—";
  if (s.startsWith("QAR")) return s;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  if (isNaN(n)) return s;
  return `QAR ${n.toLocaleString()}`;
}

function normalizeChoiceLabel(value: string): string {
  return joStr(value)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
}

const PAYMENT_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  "Paid":         { bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7" },
  "Full Payment": { bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7" },
  "Partial":      { bg: "#FEF9C3", color: "#713F12", border: "#FDE68A" },
  "Partial Payment": { bg: "#FEF9C3", color: "#713F12", border: "#FDE68A" },
  "Unpaid":       { bg: "#FEE2E2", color: "#991B1B", border: "#FECACA" },
};

interface Props {
  order: any;
  className?: string;
  /** Override for identityToUsernameMap */
  identityToUsernameMap?: Record<string, string>;
  /** Override style to pass to root element */
  style?: React.CSSProperties;
}

export function UnifiedBillingInvoicesCard({ order, className = "", style }: Props) {
  const { t } = useLanguage();
  const billing = order?.billing ?? {};

  const totalAmount = toCurrencyDisplay(joFirst(billing?.totalAmount, order?.totalAmount));
  const discount = toCurrencyDisplay(joFirst(billing?.discount, order?.discountAmount));
  const netAmount = toCurrencyDisplay(joFirst(billing?.netAmount, order?.netAmount));
  const amountPaid = toCurrencyDisplay(joFirst(billing?.amountPaid, "0"));
  const balanceDue = toCurrencyDisplay(joFirst(billing?.balanceDue, billing?.netAmount, order?.netAmount));
  const paymentMethodRaw = joFirst(billing?.paymentMethod, "—");
  const paymentMethod = paymentMethodRaw === "—" ? "—" : t(normalizeChoiceLabel(paymentMethodRaw));
  const paymentStatus = normalizePaymentStatusLabel(joFirst(order?.paymentStatus, "Unpaid"));
  const paymentStatusLabel = t(normalizeChoiceLabel(paymentStatus));
  const pmColors = PAYMENT_COLORS[paymentStatus] ?? { bg: "#F3F4F6", color: "#374151", border: "#D1D5DB" };

  const invoices: any[] = Array.isArray(billing?.invoices) ? billing.invoices : [];

  const summaryItems = [
    { key: "total",   label: t("Total Amount"),   value: totalAmount,   icon: "fa-file-invoice-dollar", highlight: false },
    { key: "discount",label: t("Discount"),        value: discount,      icon: "fa-tag",                 highlight: false },
    { key: "net",     label: t("Net Amount"),      value: netAmount,     icon: "fa-calculator",          highlight: true  },
    { key: "paid",    label: t("Amount Paid"),     value: amountPaid,    icon: "fa-check-circle",        highlight: false },
    { key: "balance", label: t("Balance Due"),     value: balanceDue,    icon: "fa-exclamation-circle",  highlight: false },
    { key: "method",  label: t("Payment Method"),  value: paymentMethod, icon: "fa-credit-card",         highlight: false },
  ];

  return (
    <div className={className} style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 14, boxShadow: "0 10px 28px rgba(51, 84, 160, 0.10)", border: "1px solid #DDE7F6", overflow: "hidden", ...style }}>
      {/* Gradient accent bar */}
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />

      {/* Header */}
      <div style={{ padding: "18px 20px 13px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #E8EEFB" }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)", border: "1px solid #D8E1F7", boxShadow: "0 0 0 4px rgba(101,92,255,0.08), 0 6px 14px rgba(71,88,180,0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5D54FF", flexShrink: 0 }}>
          <i className="fas fa-file-invoice-dollar" style={{ fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: "#102A68", letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("Billing & Invoices")}</h3>
          <span style={{ fontSize: "0.78rem", color: "#8C9ABF", fontWeight: 600 }}>{invoices.length} {t("invoice(s)")}</span>
        </div>
        <span style={{ fontSize: "0.74rem", fontWeight: 800, padding: "4px 12px", borderRadius: 20, background: pmColors.bg, color: pmColors.color, border: `1px solid ${pmColors.border}`, flexShrink: 0 }}>
          {paymentStatusLabel}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: "14px 20px 16px" }}>
        {/* Summary grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 18 }}>
          {summaryItems.map((item) => (
            <div key={item.key} style={{ background: item.highlight ? "linear-gradient(135deg, #EEF4FF 0%, #E8F7FF 100%)" : "linear-gradient(180deg, #FBFCFF 0%, #F8FAFF 100%)", borderRadius: 10, padding: "10px 12px", border: item.highlight ? "1px solid #C8D9FA" : "1px solid #E8EEFB", textAlign: "center" }}>
              <i className={`fas ${item.icon}`} style={{ fontSize: 12, color: item.highlight ? "#4E40F8" : "#8C9ABF", marginBottom: 4, display: "block" }} />
              <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: "0.88rem", fontWeight: 800, color: item.highlight ? "#4E40F8" : "#102A68" }}>{item.value}</div>
            </div>
          ))}
        </div>

        {/* Invoices list */}
        {invoices.length > 0 && (
          <>
            <div style={{ fontSize: "0.74rem", fontWeight: 800, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <i className="fas fa-receipt" style={{ color: "#4E40F8" }} />
              {t("Invoices")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {invoices.map((inv: any, idx: number) => {
                const invNum = joFirst(inv?.number, inv?.invoiceNumber, `INV-${idx + 1}`);
                const invAmount = toCurrencyDisplay(joFirst(inv?.amount, inv?.netAmount));
                const invDiscount = toCurrencyDisplay(joFirst(inv?.discount));
                const invStatus = joFirst(inv?.status, "Unpaid");
                const invStatusLabel = t(normalizeChoiceLabel(invStatus));
                const invMethodRaw = joFirst(inv?.paymentMethod, "—");
                const invMethod = invMethodRaw === "—" ? "—" : t(normalizeChoiceLabel(invMethodRaw));
                const invServices = Array.isArray(inv?.services) ? inv.services : [];
                const invStatusColors = PAYMENT_COLORS[invStatus] ?? { bg: "#F3F4F6", color: "#374151", border: "#D1D5DB" };

                return (
                  <div key={invNum + idx} style={{ background: "linear-gradient(180deg, #FBFCFF 0%, #F8FAFF 100%)", border: "1px solid #E8EEFB", borderRadius: 10, padding: "12px 14px" }}>
                    {/* Invoice header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: "0.86rem", color: "#102A68", fontFamily: "monospace", letterSpacing: "0.04em" }}>{invNum}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{ fontWeight: 800, fontSize: "0.88rem", color: "#4E40F8" }}>{invAmount}</span>
                        <span style={{ fontSize: "0.72rem", fontWeight: 700, padding: "3px 9px", borderRadius: 12, background: invStatusColors.bg, color: invStatusColors.color, border: `1px solid ${invStatusColors.border}` }}>{invStatusLabel}</span>
                      </div>
                    </div>
                    {/* Invoice details */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
                      {invDiscount && invDiscount !== "—" && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.77rem" }}>
                          <span style={{ color: "#8C9ABF", fontWeight: 700 }}>{t("Discount")}</span>
                          <span style={{ color: "#102A68", fontWeight: 600 }}>{invDiscount}</span>
                        </div>
                      )}
                      {invMethod !== "—" && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.77rem" }}>
                          <span style={{ color: "#8C9ABF", fontWeight: 700 }}>{t("Method")}</span>
                          <span style={{ color: "#102A68", fontWeight: 600 }}>{invMethod}</span>
                        </div>
                      )}
                    </div>
                    {/* Invoice services */}
                    {invServices.length > 0 && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #EEF2FB" }}>
                        <div style={{ fontSize: "0.72rem", color: "#8C9ABF", fontWeight: 700, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("Services")}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {invServices.map((svc: string, sIdx: number) => (
                            <span key={sIdx} style={{ fontSize: "0.74rem", padding: "2px 8px", background: "#EEF4FF", color: "#4E40F8", borderRadius: 6, fontWeight: 600 }} data-no-translate="true">{svc}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default UnifiedBillingInvoicesCard;
