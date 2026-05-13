// UnifiedCustomerDetailsCard.tsx
// Reusable unified customer details card — follows Customer.tsx design language exactly.

import { useLanguage } from "../i18n/LanguageContext";

function joStr(v: any) { return String(v ?? "").trim(); }
function joFirst(...vals: any[]): string {
  for (const v of vals) { const s = joStr(v); if (s) return s; }
  return "—";
}
function joNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function heardFromLabel(value: string): string {
  const key = joStr(value).toLowerCase();
  if (!key) return "—";
  if (key === "refer_person" || key === "referral") return "Referral";
  if (key === "social_media") return "Social Media";
  if (key === "walk_in") return "Walk-in";
  return value;
}

interface Props {
  order: any;
  className?: string;
}

export function UnifiedCustomerDetailsCard({ order, className = "" }: Props) {
  const { t } = useLanguage();

  const cd = order?.customerDetails ?? {};
  const vd = order?.vehicleDetails ?? {};
  const heardFromValue = joFirst(
    cd?.heardFrom,
    cd?.source,
    cd?.leadSource,
    order?.heardFrom,
    order?.source,
    order?.leadSource,
    "—"
  );
  const heardFromKey = joStr(heardFromValue).toLowerCase();
  const heardFromDisplay = heardFromLabel(heardFromValue);
  const customerName = joFirst(order?.customerName, cd?.fullName, cd?.name, "—");
  const customerId = joFirst(cd?.customerId, order?.customerId, "—");
  const phone = joFirst(order?.mobile, order?.phone, cd?.mobile, cd?.phone, "—");
  const email = joFirst(order?.email, cd?.email, order?.customerEmail, "—");
  const address = joFirst(cd?.address, order?.address, "—");
  const heardFrom = heardFromDisplay;
  const referralName = joFirst(cd?.referralPersonName, cd?.referralName, order?.referralPersonName, order?.referralName, "—");
  const referralMobile = joFirst(cd?.referralPersonMobile, cd?.referralMobile, order?.referralPersonMobile, order?.referralMobile, "—");
  const socialPlatform = joFirst(cd?.socialPlatform, cd?.platform, order?.socialPlatform, order?.platform, "—");
  const heardFromOtherNote = joFirst(cd?.heardFromOtherNote, cd?.otherSourceNote, order?.heardFromOtherNote, order?.otherSourceNote, "—");
  const customerSince = joFirst(cd?.customerSince, order?.createdAt, "—");
  const registeredVehiclesCount = joNum(
    cd?.registeredVehiclesCount ??
    order?.registeredVehiclesCount ??
    order?.vehicles?.length ??
    cd?.vehicles?.length
  );
  const registeredVehicles = joStr(cd?.registeredVehicles)
    || (registeredVehiclesCount !== null ? String(registeredVehiclesCount) : "—");
  const completedServices = joFirst(cd?.completedServicesCount != null ? String(cd.completedServicesCount) : "", "0");
  // Vehicle quick-view fields
  const vehicleMake = joFirst(vd?.make, vd?.factory, order?.vehicleMake, "—");
  const vehicleModel = joFirst(vd?.model, order?.vehicleModel, "—");
  const vehicleMakeModel = vehicleMake !== "—" && vehicleModel !== "—" ? `${vehicleMake} ${vehicleModel}` : joFirst(vehicleMake, vehicleModel, order?.vehicle, "—");
  const vehicleYear = joFirst(vd?.year, order?.vehicleYear, "—");
  const vehicleColor = joFirst(vd?.color, order?.color, "—");
  const vehiclePlate = joFirst(order?.vehiclePlate, vd?.plateNumber, order?.plateNumber, "—");

  const infoRow = (label: string, value: React.ReactNode, noBorder = false) => (
    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "9px 0", borderBottom: noBorder ? "none" : "1px solid #EEF2FB", gap: 12 }}>
      <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: "0.88rem", fontWeight: 700, color: "#102A68", textAlign: "right", wordBreak: "break-word", maxWidth: 220 }}>{value}</span>
    </div>
  );

  return (
    <div className={className} style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 14, boxShadow: "0 10px 28px rgba(51, 84, 160, 0.10)", border: "1px solid #DDE7F6", overflow: "hidden" }}>
      {/* Gradient accent bar */}
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />

      {/* Header */}
      <div style={{ padding: "18px 20px 13px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #E8EEFB" }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)", border: "1px solid #D8E1F7", boxShadow: "0 0 0 4px rgba(101,92,255,0.08), 0 6px 14px rgba(71,88,180,0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5D54FF", flexShrink: 0 }}>
          <i className="fas fa-user" style={{ fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: "#102A68", letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("Customer Details")}</h3>
          <span style={{ fontSize: "0.78rem", color: "#8C9ABF", fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{customerName}</span>
        </div>
        {/* Customer ID badge */}
        <span style={{ fontSize: "0.72rem", fontWeight: 800, background: "linear-gradient(90deg, #EEF4FF 0%, #E8F7FF 100%)", color: "#4E40F8", border: "1px solid #C8D9FA", borderRadius: 8, padding: "3px 9px", flexShrink: 0 }}>{customerId}</span>
      </div>

      {/* Body */}
      <div style={{ padding: "14px 20px 16px" }}>
        {infoRow(t("Full Name"), customerName)}
        {infoRow(t("Phone"), <a href={`tel:${phone}`} style={{ color: "#4E40F8", textDecoration: "none", fontWeight: 700 }}>{phone}</a>)}
        {infoRow(t("Email"), <a href={`mailto:${email}`} style={{ color: "#4E40F8", textDecoration: "none", fontWeight: 700, wordBreak: "break-all" }}>{email}</a>)}
        {infoRow(t("Address"), address)}
        {infoRow(t("Heard From"), heardFrom)}
        {heardFromKey.includes("referral") && infoRow(t("Referral Name"), referralName)}
        {heardFromKey.includes("referral") && infoRow(t("Referral Mobile"), referralMobile)}
        {(heardFromKey.includes("social") || heardFromKey.includes("instagram") || heardFromKey.includes("facebook") || heardFromKey.includes("tiktok")) && infoRow(t("Platform"), socialPlatform)}
        {(heardFromKey === "other" || heardFromKey.includes("other")) && infoRow(t("Source Note"), heardFromOtherNote)}
        {infoRow(t("Customer Since"), customerSince)}

        {/* Vehicle quick-view */}
        <div style={{ marginTop: 14, marginBottom: 2, padding: "10px 14px", background: "linear-gradient(135deg, #F5F7FF 0%, #EEF3FF 100%)", borderRadius: 10, border: "1px solid #DCE8FF" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <i className="fas fa-car" style={{ color: "#5D54FF", fontSize: 10 }} />
            {t("Vehicle")}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 800, color: "#102A68" }}>{vehicleMakeModel}{vehicleYear !== "—" ? ` · ${vehicleYear}` : ""}</span>
            {vehicleColor !== "—" && <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#5D6B8A" }}>{vehicleColor}</span>}
            <span style={{ fontFamily: "monospace", fontSize: "0.82rem", fontWeight: 800, color: "#FFFFFF", background: "#102A68", borderRadius: 6, padding: "1px 8px", letterSpacing: "0.08em" }}>{vehiclePlate}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <div style={{ flex: 1, background: "linear-gradient(135deg, #F0F4FF 0%, #EEF7FF 100%)", borderRadius: 10, padding: "10px 14px", border: "1px solid #DCE8FF", textAlign: "center" }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#4E40F8" }}>{registeredVehicles}</div>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 2 }}>{t("Vehicles")}</div>
          </div>
          <div style={{ flex: 1, background: "linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)", borderRadius: 10, padding: "10px 14px", border: "1px solid #BBF7D0", textAlign: "center" }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#059669" }}>{completedServices}</div>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 2 }}>{t("Jobs Done")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UnifiedCustomerDetailsCard;
