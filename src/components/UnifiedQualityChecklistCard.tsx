// UnifiedQualityChecklistCard.tsx
// Reusable unified quality checklist card — follows Customer.tsx design language exactly.

import { useLanguage } from "../i18n/LanguageContext";
import { resolveActorDisplay } from "../utils/actorIdentity";

function joStr(v: any) { return String(v ?? "").trim(); }
function joFirst(...vals: any[]): string {
  for (const v of vals) { const s = joStr(v); if (s) return s; }
  return "—";
}

function getServiceName(service: any, idx: number): string {
  const name = joStr(service?.name);
  const nameAr = joStr(service?.nameAr);
  if (name && nameAr && name !== nameAr) return `${name} / ${nameAr}`;
  return name || nameAr || `Service ${idx + 1}`;
}

function getQcResult(service: any) {
  const raw = joFirst(
    service?.qualityCheckResult, service?.qcResult, service?.qcStatus,
    service?.qualityStatus, service?.qualityCheckStatus
  );
  const key = raw.toLowerCase().replace(/[\s_]+/g, "-");
  if (key === "pass" || key === "passed")       return { label: "Pass",          style: { bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7" }, icon: "fa-check-circle" };
  if (key === "failed" || key === "fail")        return { label: "Failed",        style: { bg: "#FEE2E2", color: "#991B1B", border: "#FECACA" }, icon: "fa-times-circle" };
  if (key === "acceptable")                      return { label: "Acceptable",    style: { bg: "#FEF9C3", color: "#713F12", border: "#FDE68A" }, icon: "fa-minus-circle" };
  return                                                { label: "Not Evaluated", style: { bg: "#F3F4F6", color: "#6B7280", border: "#D1D5DB" }, icon: "fa-question-circle" };
}

function resolveServiceActor(service: any, actorMap?: Record<string, string>): string {
  const raw = joFirst(
    service?.completedByName, service?.completedBy, service?.endedBy,
    service?.updatedByName, service?.updatedBy, service?.actionBy,
    service?.doneBy, service?.technicianName, service?.technician, service?.assignedTo
  );
  if (!raw || raw === "—") return "Not assigned";
  return resolveActorDisplay(raw, { identityToUsernameMap: actorMap, fallback: "Not assigned" });
}

interface Props {
  order: any;
  actorMap?: Record<string, string>;
  className?: string;
}

export function UnifiedQualityChecklistCard({ order, actorMap, className = "" }: Props) {
  const { t } = useLanguage();
  const services: any[] = Array.isArray(order?.services) ? order.services : [];

  const passCount = services.filter((s) => { const k = joStr(s?.qualityCheckResult || s?.qcResult || s?.qcStatus).toLowerCase(); return k === "pass" || k === "passed"; }).length;
  const failCount = services.filter((s) => { const k = joStr(s?.qualityCheckResult || s?.qcResult || s?.qcStatus).toLowerCase(); return k === "failed" || k === "fail"; }).length;
  const evalCount = services.filter((s) => joStr(s?.qualityCheckResult || s?.qcResult || s?.qcStatus).trim()).length;

  return (
    <div className={className} style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 14, boxShadow: "0 10px 28px rgba(51, 84, 160, 0.10)", border: "1px solid #DDE7F6", overflow: "hidden" }}>
      {/* Gradient accent bar */}
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />

      {/* Header */}
      <div style={{ padding: "18px 20px 13px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #E8EEFB" }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)", border: "1px solid #D8E1F7", boxShadow: "0 0 0 4px rgba(101,92,255,0.08), 0 6px 14px rgba(71,88,180,0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5D54FF", flexShrink: 0 }}>
          <i className="fas fa-clipboard-check" style={{ fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: "#102A68", letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("Quality Check List")}</h3>
          <span style={{ fontSize: "0.78rem", color: "#8C9ABF", fontWeight: 600 }}>{evalCount}/{services.length} {t("evaluated")}</span>
        </div>
        {/* QC score summary */}
        {services.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: "0.72rem", fontWeight: 800, padding: "3px 9px", borderRadius: 12, background: "#D1FAE5", color: "#065F46", border: "1px solid #6EE7B7" }}>
              <i className="fas fa-check" style={{ marginRight: 4 }} />{passCount} {t("Pass")}
            </span>
            {failCount > 0 && (
              <span style={{ fontSize: "0.72rem", fontWeight: 800, padding: "3px 9px", borderRadius: 12, background: "#FEE2E2", color: "#991B1B", border: "1px solid #FECACA" }}>
                <i className="fas fa-times" style={{ marginRight: 4 }} />{failCount} {t("Failed")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "14px 20px 16px" }}>
        {services.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {services.map((service: any, idx: number) => {
              const name = getServiceName(service, idx);
              const qc = getQcResult(service);
              const tech = resolveServiceActor(service, actorMap);
              const notes = joFirst(service?.qualityCheckNotes, service?.qcNotes, service?.qualityNotes);

              return (
                <div key={`${name}-${idx}`} style={{ background: "linear-gradient(180deg, #FBFCFF 0%, #F8FAFF 100%)", border: "1px solid #E8EEFB", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 12 }}>
                  {/* Result icon */}
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: qc.style.bg, border: `1px solid ${qc.style.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <i className={`fas ${qc.icon}`} style={{ fontSize: 14, color: qc.style.color }} />
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#102A68", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-no-translate="true">{name}</span>
                      <span style={{ fontSize: "0.72rem", fontWeight: 800, padding: "3px 10px", borderRadius: 12, background: qc.style.bg, color: qc.style.color, border: `1px solid ${qc.style.border}`, flexShrink: 0 }}>{t(qc.label)}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.77rem" }}>
                        <span style={{ color: "#8C9ABF", fontWeight: 700 }}>{t("Technician")}</span>
                        <span style={{ color: "#102A68", fontWeight: 600 }}>{tech}</span>
                      </div>
                      {notes !== "—" && (
                        <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "space-between", fontSize: "0.77rem", marginTop: 3 }}>
                          <span style={{ color: "#8C9ABF", fontWeight: 700 }}>{t("Notes")}</span>
                          <span style={{ color: "#102A68", fontWeight: 600, textAlign: "right", maxWidth: "60%" }}>{notes}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "32px 20px", border: "2px dashed #DDE7F6", borderRadius: 10 }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "linear-gradient(180deg, #EEF3FF 0%, #E8F7FF 100%)", border: "1px solid #D8E1F7", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <i className="fas fa-clipboard-check" style={{ color: "#8C9ABF", fontSize: 20 }} />
            </div>
            <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#102A68", marginBottom: 6 }}>{t("No services to evaluate")}</div>
            <div style={{ fontSize: "0.78rem", color: "#8C9ABF" }}>{t("Quality checks will appear here once services are completed")}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default UnifiedQualityChecklistCard;
