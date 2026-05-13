// UnifiedDeliveryTimeTrackingCard.tsx
// Reusable unified delivery & time tracking card — follows Customer.tsx design language exactly.

import { useLanguage } from "../i18n/LanguageContext";

function joStr(v: any) { return String(v ?? "").trim(); }
function joFirst(...vals: any[]): string {
  for (const v of vals) { const s = joStr(v); if (s) return s; }
  return "—";
}

interface Props {
  order: any;
  className?: string;
}

export function UnifiedDeliveryTimeTrackingCard({ order, className = "" }: Props) {
  const { t } = useLanguage();

  const delivery = order?.deliveryInfo ?? {};

  // Resolve from multiple possible field names
  const expectedDate = joFirst(delivery?.expectedDate, order?.expectedDeliveryDate, order?.jobOrderSummary?.expectedDeliveryDate);
  const expectedTime = joFirst(delivery?.expectedTime, order?.expectedDeliveryTime, order?.jobOrderSummary?.expectedDeliveryTime);
  const estimatedDuration = joFirst(delivery?.estimatedHours, delivery?.estimatedDuration, order?.estimatedHours);
  const actualDate = joFirst(delivery?.actualDate, order?.actualDeliveryDate, delivery?.deliveredDate);
  const actualTime = joFirst(delivery?.actualTime, order?.actualDeliveryTime);
  const actualDuration = joFirst(delivery?.actualHours, delivery?.actualDuration, order?.actualHours);
  const deliveryStatus = joFirst(delivery?.status, order?.deliveryStatus);
  const deliveredBy = joFirst(delivery?.deliveredBy, delivery?.deliveredByName, order?.deliveredBy);
  const expectedDelivery = joFirst(order?.jobOrderSummary?.expectedDelivery, order?.expectedDelivery);

  // Check if there's any delivery data to show
  const hasData = expectedDate !== "—" || expectedTime !== "—" || estimatedDuration !== "—" ||
                  actualDate !== "—" || actualTime !== "—" || expectedDelivery !== "—";

  // Determine delivery status color
  const isDelivered = joStr(deliveryStatus).toLowerCase().includes("deliver") || joStr(deliveryStatus).toLowerCase() === "completed";
  const isOverdue = false; // Could be computed based on dates

  const statusConfig = isDelivered
    ? { bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7", icon: "fa-check-circle", label: t("Delivered") }
    : isOverdue
    ? { bg: "#FEE2E2", color: "#991B1B", border: "#FECACA", icon: "fa-exclamation-circle", label: t("Overdue") }
    : { bg: "#EFF6FF", color: "#1D4ED8", border: "#BFDBFE", icon: "fa-clock", label: t("Pending") };

  const infoRow = (label: string, value: string, icon: string, highlight = false) => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: highlight ? "linear-gradient(135deg, #EEF4FF 0%, #E8F7FF 100%)" : "linear-gradient(180deg, #FBFCFF 0%, #F8FAFF 100%)", borderRadius: 10, border: highlight ? "1px solid #C8D9FA" : "1px solid #E8EEFB" }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: highlight ? "linear-gradient(180deg, #EEF4FF 0%, #E8F7FF 100%)" : "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <i className={`fas ${icon}`} style={{ fontSize: 12, color: highlight ? "#4E40F8" : "#8C9ABF" }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: "0.88rem", fontWeight: 700, color: highlight ? "#4E40F8" : "#102A68" }}>{value}</div>
      </div>
    </div>
  );

  if (!hasData) return null;

  return (
    <div className={className} style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 14, boxShadow: "0 10px 28px rgba(51, 84, 160, 0.10)", border: "1px solid #DDE7F6", overflow: "hidden" }}>
      {/* Gradient accent bar */}
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />

      {/* Header */}
      <div style={{ padding: "18px 20px 13px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #E8EEFB" }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)", border: "1px solid #D8E1F7", boxShadow: "0 0 0 4px rgba(101,92,255,0.08), 0 6px 14px rgba(71,88,180,0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5D54FF", flexShrink: 0 }}>
          <i className="fas fa-truck" style={{ fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: "#102A68", letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("Delivery & Time Tracking")}</h3>
          <span style={{ fontSize: "0.78rem", color: "#8C9ABF", fontWeight: 600 }}>{t("Schedule & completion times")}</span>
        </div>
        {deliveryStatus && (
          <span style={{ fontSize: "0.74rem", fontWeight: 800, padding: "4px 12px", borderRadius: 20, background: statusConfig.bg, color: statusConfig.color, border: `1px solid ${statusConfig.border}`, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
            <i className={`fas ${statusConfig.icon}`} style={{ fontSize: 10 }} />
            {statusConfig.label}
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "14px 20px 16px" }}>
        {/* Expected delivery section */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <i className="fas fa-calendar-check" style={{ color: "#4E40F8" }} />
            {t("Expected Delivery")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
            {expectedDelivery !== "—"
              ? infoRow(t("Expected"), expectedDelivery, "fa-calendar", true)
              : (<>
                  {expectedDate !== "—" && infoRow(t("Date"), expectedDate, "fa-calendar", true)}
                  {expectedTime !== "—" && infoRow(t("Time"), expectedTime, "fa-clock", true)}
                </>)
            }
            {estimatedDuration !== "—" && infoRow(t("Est. Duration"), estimatedDuration, "fa-hourglass-half")}
          </div>
        </div>

        {/* Actual delivery section */}
        {(actualDate !== "—" || actualTime !== "—" || actualDuration !== "—") && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <i className="fas fa-check-circle" style={{ color: "#059669" }} />
              {t("Actual Delivery")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
              {actualDate !== "—" && infoRow(t("Date"), actualDate, "fa-calendar-day")}
              {actualTime !== "—" && infoRow(t("Time"), actualTime, "fa-clock")}
              {actualDuration !== "—" && infoRow(t("Duration"), actualDuration, "fa-stopwatch")}
              {deliveredBy !== "—" && infoRow(t("Delivered By"), deliveredBy, "fa-user-check")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default UnifiedDeliveryTimeTrackingCard;
