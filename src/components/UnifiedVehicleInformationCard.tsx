// UnifiedVehicleInformationCard.tsx
// Reusable unified vehicle information card — follows Customer.tsx design language exactly.

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

export function UnifiedVehicleInformationCard({ order, className = "" }: Props) {
  const { t } = useLanguage();
  const vd = order?.vehicleDetails ?? {};

  const make = joFirst(vd?.make, vd?.factory, "—");
  const model = joFirst(vd?.model, "—");
  const subModel = joFirst(vd?.subModel, vd?.submodel, order?.vehicleSubModel, "");
  const makeModel =
    make !== "—" && model !== "—"
      ? [make, model, subModel].filter(Boolean).join(" ")
      : joFirst(make, model, order?.vehicle, "—");
  const year = joFirst(vd?.year, "—");
  const color = joFirst(vd?.color, "—");
  const vehicleType = joFirst(vd?.type, vd?.vehicleType, vd?.carType, "—");
  const plateNumber = joFirst(order?.vehiclePlate, vd?.plateNumber, "—");
  const vin = joFirst(vd?.vin, order?.vin, "—");
  const vehicleId = joFirst(vd?.vehicleId, "—");
  const registrationDate = joFirst(vd?.registrationDate, "—");
  const ownedBy = joFirst(vd?.ownedBy, order?.customerName, "—");

  const infoRow = (label: string, value: React.ReactNode, noBorder = false) => (
    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "9px 0", borderBottom: noBorder ? "none" : "1px solid #EEF2FB", gap: 12 }}>
      <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>{label}</span>
      <span data-no-translate="true" style={{ fontSize: "0.88rem", fontWeight: 700, color: "#102A68", textAlign: "right", wordBreak: "break-word", maxWidth: 220 }}>{value}</span>
    </div>
  );

  // Color swatch
  const colorHexMap: Record<string, string> = {
    white: "#FFFFFF", black: "#1A1A1A", silver: "#C0C0C0", gray: "#808080", grey: "#808080",
    red: "#DC2626", blue: "#2563EB", green: "#16A34A", yellow: "#CA8A04", orange: "#EA580C",
    brown: "#92400E", beige: "#D2B48C", gold: "#B45309", purple: "#7C3AED",
  };
  const colorKey = color.toLowerCase().replace(/\s+/g, "");
  const colorHex = colorHexMap[colorKey];

  return (
    <div className={className} style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 14, boxShadow: "0 10px 28px rgba(51, 84, 160, 0.10)", border: "1px solid #DDE7F6", overflow: "hidden" }}>
      {/* Gradient accent bar */}
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />

      {/* Header */}
      <div style={{ padding: "18px 20px 13px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #E8EEFB" }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)", border: "1px solid #D8E1F7", boxShadow: "0 0 0 4px rgba(101,92,255,0.08), 0 6px 14px rgba(71,88,180,0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5D54FF", flexShrink: 0 }}>
          <i className="fas fa-car" style={{ fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: "#102A68", letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("Vehicle Information")}</h3>
          <span data-no-translate="true" style={{ fontSize: "0.78rem", color: "#8C9ABF", fontWeight: 600 }}>{makeModel} {year !== "—" ? `· ${year}` : ""}</span>
        </div>
        {/* Plate badge */}
        <span data-no-translate="true" style={{ fontSize: "0.76rem", fontWeight: 800, background: "#102A68", color: "#FFFFFF", borderRadius: 8, padding: "4px 10px", flexShrink: 0, letterSpacing: "0.08em" }}>{plateNumber}</span>
      </div>

      {/* Body */}
      <div style={{ padding: "14px 20px 16px" }}>
        {infoRow(t("Make / Model"), makeModel)}
        {subModel && infoRow(t("Sub-Model"), subModel)}
        {infoRow(t("Year"), year)}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid #EEF2FB", gap: 12 }}>
          <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>{t("Color")}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {colorHex && (
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: colorHex, border: "1px solid rgba(0,0,0,0.15)", flexShrink: 0, display: "inline-block" }} />
            )}
            <span data-no-translate="true" style={{ fontSize: "0.88rem", fontWeight: 700, color: "#102A68" }}>{color}</span>
          </div>
        </div>
        {infoRow(t("Vehicle Type"), vehicleType)}
        {infoRow(t("Plate Number"), <span style={{ fontFamily: "monospace", letterSpacing: "0.1em", background: "#F3F4F6", padding: "2px 8px", borderRadius: 6, color: "#102A68" }}>{plateNumber}</span>)}
        {infoRow(t("VIN"), <span style={{ fontFamily: "monospace", fontSize: "0.82rem", letterSpacing: "0.06em" }}>{vin}</span>)}
        {infoRow(t("Vehicle ID"), vehicleId)}
        {infoRow(t("Owned By"), ownedBy)}
        {infoRow(t("Registration Date"), registrationDate, true)}
      </div>
    </div>
  );
}

export default UnifiedVehicleInformationCard;
