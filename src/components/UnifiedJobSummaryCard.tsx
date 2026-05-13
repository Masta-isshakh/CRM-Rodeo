// UnifiedJobSummaryCard.tsx
// Reusable unified job summary card — follows Customer.tsx design language exactly.

import { useLanguage } from "../i18n/LanguageContext";
import { resolveActorDisplay } from "../utils/actorIdentity";

function joStr(v: any) { return String(v ?? "").trim(); }
function joFirst(...vals: any[]): string {
  for (const v of vals) { const s = joStr(v); if (s) return s; }
  return "—";
}

const WORK_STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  "New Request":       { bg: "#EFF6FF", color: "#1D4ED8", border: "#BFDBFE" },
  "Inspection":        { bg: "#FEF3C7", color: "#92400E", border: "#FDE68A" },
  "Service_Operation": { bg: "#EDE9FE", color: "#5B21B6", border: "#C4B5FD" },
  "Inprogress":        { bg: "#EDE9FE", color: "#5B21B6", border: "#C4B5FD" },
  "Quality Check":     { bg: "#FFF7ED", color: "#C2410C", border: "#FED7AA" },
  "Ready":             { bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7" },
  "Completed":         { bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7" },
  "Cancelled":         { bg: "#FEE2E2", color: "#991B1B", border: "#FECACA" },
};

const PAYMENT_STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  "Paid":         { bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7" },
  "Full Payment": { bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7" },
  "Partial":      { bg: "#FEF9C3", color: "#713F12", border: "#FDE68A" },
  "Unpaid":       { bg: "#FEE2E2", color: "#991B1B", border: "#FECACA" },
};

interface Props {
  order: any;
  actorMap?: Record<string, string>;
  className?: string;
  /** Override for createdBy display */
  createdByOverride?: string;
  /** Optional override for work status label */
  workStatusOverride?: string;
  /** Optional override for payment status label */
  paymentStatusOverride?: string;
  /** Override for identityToUsernameMap (alias for actorMap) */
  identityToUsernameMap?: Record<string, string>;
}

export function UnifiedJobSummaryCard({
  order,
  actorMap,
  identityToUsernameMap,
  createdByOverride,
  workStatusOverride,
  paymentStatusOverride,
  className = "",
}: Props) {
  const { t } = useLanguage();
  const map = actorMap ?? identityToUsernameMap;

  const orderId = joFirst(order?.id, order?.orderNumber, order?.jobOrderId, "JO-000000");
  const workStatus = joFirst(workStatusOverride, order?.workStatus, "New Request");
  const paymentStatus = joFirst(paymentStatusOverride, order?.paymentStatus, "Unpaid");
  const orderType = joFirst(order?.orderType, "—");
  const createDate = joFirst(order?.createDate, order?.createdAt, order?.createdDate, "—");
  const expectedDelivery = joFirst(
    order?.jobOrderSummary?.expectedDelivery,
    order?.expectedDelivery,
    order?.expectedDeliveryDate,
    "—"
  );
  const assignedTech = joFirst(
    resolveActorDisplay(joFirst(order?.assignedTechnician, order?.assignedTech, order?.technician, order?.assignedTo), { identityToUsernameMap: map, fallback: "" }),
    "Not assigned"
  );
  const createdBy = createdByOverride || joFirst(
    resolveActorDisplay(joFirst(order?.jobOrderSummary?.createdByName, order?.jobOrderSummary?.createdBy, order?.createdByName, order?.createdBy), { identityToUsernameMap: map, fallback: "" }),
    "—"
  );
  const totalAmount = joFirst(order?.billing?.totalAmount, order?.billing?.netAmount, order?.totalAmount, order?.netAmount, "—");
  const customerNotes = joFirst(order?.customerNotes, order?.notes, order?.jobOrderSummary?.notes, "—");

  const wsColor = WORK_STATUS_COLORS[workStatus] ?? { bg: "#F3F4F6", color: "#374151", border: "#D1D5DB" };
  const pmColor = PAYMENT_STATUS_COLORS[paymentStatus] ?? { bg: "#F3F4F6", color: "#374151", border: "#D1D5DB" };

  const infoRow = (label: string, value: React.ReactNode, noBorder = false) => (
    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "9px 0", borderBottom: noBorder ? "none" : "1px solid #EEF2FB", gap: 12 }}>
      <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: "0.88rem", fontWeight: 700, color: "#102A68", textAlign: "right" }}>{value}</span>
    </div>
  );

  return (
    <div className={className} style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 14, boxShadow: "0 10px 28px rgba(51, 84, 160, 0.10)", border: "1px solid #DDE7F6", overflow: "hidden" }}>
      {/* Gradient accent bar */}
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />

      {/* Header */}
      <div style={{ padding: "18px 20px 13px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #E8EEFB" }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)", border: "1px solid #D8E1F7", boxShadow: "0 0 0 4px rgba(101,92,255,0.08), 0 6px 14px rgba(71,88,180,0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5D54FF", flexShrink: 0 }}>
          <i className="fas fa-clipboard-list" style={{ fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: "#102A68", letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("Job Summary")}</h3>
          <span style={{ fontSize: "0.78rem", color: "#8C9ABF", fontWeight: 600 }}>{orderId}</span>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "14px 20px 16px" }}>
        {/* Status badges row */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.74rem", fontWeight: 800, padding: "4px 10px", borderRadius: 20, background: wsColor.bg, color: wsColor.color, border: `1px solid ${wsColor.border}`, letterSpacing: "0.03em" }}>
            <i className="fas fa-circle" style={{ fontSize: 7, marginRight: 5, verticalAlign: "middle" }} />
            {workStatus}
          </span>
          <span style={{ fontSize: "0.74rem", fontWeight: 800, padding: "4px 10px", borderRadius: 20, background: pmColor.bg, color: pmColor.color, border: `1px solid ${pmColor.border}` }}>
            <i className="fas fa-credit-card" style={{ fontSize: 9, marginRight: 5, verticalAlign: "middle" }} />
            {paymentStatus}
          </span>
        </div>

        {infoRow(t("Order Type"), orderType)}
        {infoRow(t("Created"), createDate)}
        {infoRow(t("Expected Delivery"), expectedDelivery)}
        {infoRow(t("Assigned Technician"), assignedTech)}
        {infoRow(t("Created By"), createdBy)}
        {infoRow(t("Total Amount"), <span style={{ color: "#4E40F8", fontWeight: 800 }}>{totalAmount}</span>)}
        {infoRow(t("Notes"), <span style={{ color: customerNotes === "—" ? "#8C9ABF" : "#102A68", fontStyle: customerNotes === "—" ? "italic" : "normal", maxWidth: 220, wordBreak: "break-word", textAlign: "right" }}>{customerNotes}</span>, true)}
      </div>
    </div>
  );
}

export default UnifiedJobSummaryCard;
