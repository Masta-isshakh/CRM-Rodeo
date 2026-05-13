// UnifiedJobOrderRoadmapCard.tsx
// Reusable unified job order roadmap card — follows Customer.tsx design language exactly.
// Renders a beautiful timeline visualization of the job order progress steps.

import { useLanguage } from "../i18n/LanguageContext";
import { resolveActorDisplay } from "../utils/actorIdentity";

function joStr(v: any) { return String(v ?? "").trim(); }
function joFirst(...vals: any[]): string {
  for (const v of vals) { const s = joStr(v); if (s) return s; }
  return "—";
}

function normStep(v: any) { return joStr(v).toLowerCase().replace(/[^a-z]/g, ""); }

function isPlaceholderName(v: string) {
  const lower = v.toLowerCase().trim();
  return !lower || lower === "system" || lower === "system user" || lower === "systemuser" || lower === "—" || lower === "not assigned" || lower === "n/a";
}

function resolveActor(step: any, order: any, actorMap?: Record<string, string>): string {
  const stepName = normStep(step?.step);
  const isNewRequest = stepName === "newrequest";

  const candidates = [
    step?.actionByName, step?.actionBy, step?.performedBy, step?.doneBy,
    step?.updatedByName, step?.updatedBy, step?.createdByName, step?.createdBy,
    step?.technicianName, step?.technician,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const s = joStr(candidate);
    if (!s || isPlaceholderName(s)) continue;
    return resolveActorDisplay(s, { identityToUsernameMap: actorMap, fallback: "" }) || s;
  }

  if (isNewRequest) {
    const createdBy = joFirst(
      order?.jobOrderSummary?.createdByName, order?.jobOrderSummary?.createdBy,
      order?.createdByName, order?.createdBy
    );
    if (createdBy && !isPlaceholderName(createdBy)) {
      return resolveActorDisplay(createdBy, { identityToUsernameMap: actorMap, fallback: "" }) || createdBy;
    }
  }
  return "";
}

type StepStatus = "completed" | "active" | "pending";

function resolveStepStatus(step: any): StepStatus {
  const s = normStep(step?.stepStatus || step?.status);
  if (s === "completed") return "completed";
  if (s === "active" || s === "inprogress") return "active";
  return "pending";
}

const STEP_CONFIGS: Record<string, { icon: string; color: string; label: string }> = {
  newrequest:       { icon: "fa-plus-circle",     color: "#4E40F8", label: "New Request" },
  inspection:       { icon: "fa-search",           color: "#0891B2", label: "Inspection" },
  serviceoperation: { icon: "fa-cogs",             color: "#7C3AED", label: "Service Operation" },
  inprogress:       { icon: "fa-cogs",             color: "#7C3AED", label: "In Progress" },
  qualitycheck:     { icon: "fa-check-double",     color: "#D97706", label: "Quality Check" },
  ready:            { icon: "fa-flag-checkered",   color: "#059669", label: "Ready" },
  completed:        { icon: "fa-check-circle",     color: "#059669", label: "Completed" },
  cancelled:        { icon: "fa-ban",              color: "#DC2626", label: "Cancelled" },
};

const STATUS_STYLES: Record<StepStatus, { bg: string; color: string; border: string; connectorColor: string }> = {
  completed: { bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7", connectorColor: "#10B981" },
  active:    { bg: "#EEF4FF", color: "#4E40F8", border: "#C8D9FA", connectorColor: "#4E40F8" },
  pending:   { bg: "#F3F4F6", color: "#9CA3AF", border: "#E5E7EB", connectorColor: "#E5E7EB" },
};

interface Props {
  order: any;
  actorMap?: Record<string, string>;
  className?: string;
  /** Override for identityToUsernameMap */
  identityToUsernameMap?: Record<string, string>;
  currentUser?: any;
}

export function UnifiedJobOrderRoadmapCard({ order, actorMap, identityToUsernameMap, className = "" }: Props) {
  const { t } = useLanguage();
  const map = actorMap ?? identityToUsernameMap;

  const roadmap: any[] = Array.isArray(order?.roadmap) ? order.roadmap : [];
  if (!roadmap.length) return null;

  const completedCount = roadmap.filter((s) => resolveStepStatus(s) === "completed").length;
  const progressPct = roadmap.length ? Math.round((completedCount / roadmap.length) * 100) : 0;

  return (
    <div className={className} style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 14, boxShadow: "0 10px 28px rgba(51, 84, 160, 0.10)", border: "1px solid #DDE7F6", overflow: "hidden" }}>
      {/* Gradient accent bar */}
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />

      {/* Header */}
      <div style={{ padding: "18px 20px 13px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #E8EEFB" }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)", border: "1px solid #D8E1F7", boxShadow: "0 0 0 4px rgba(101,92,255,0.08), 0 6px 14px rgba(71,88,180,0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5D54FF", flexShrink: 0 }}>
          <i className="fas fa-route" style={{ fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: "#102A68", letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("Job Order Roadmap")}</h3>
          <span style={{ fontSize: "0.78rem", color: "#8C9ABF", fontWeight: 600 }}>{completedCount}/{roadmap.length} {t("steps completed")}</span>
        </div>
      </div>

      {/* Overall progress bar */}
      <div style={{ padding: "10px 20px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, height: 6, background: "#E8EEFB", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${progressPct}%`, height: "100%", background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", borderRadius: 3, transition: "width 0.4s ease" }} />
          </div>
          <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#8C9ABF", whiteSpace: "nowrap" }}>{progressPct}%</span>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ padding: "16px 20px 16px" }}>
        {roadmap.map((step: any, idx: number) => {
          const stepKey = normStep(step?.step);
          const config = STEP_CONFIGS[stepKey] ?? { icon: "fa-circle", color: "#8C9ABF", label: step?.step || "Step" };
          const status = resolveStepStatus(step);
          const statusStyle = STATUS_STYLES[status];
          const isLast = idx === roadmap.length - 1;

          const startedAt = joFirst(step?.startTimestamp, step?.startedAt, step?.startTime, step?.started);
          const completedAt = joFirst(step?.endTimestamp, step?.completedAt, step?.endTime, step?.ended);
          const actor = resolveActor(step, order, map);
          const statusLabel = joFirst(step?.stepStatus, step?.status, "Pending");

          // Display step label
          const displayLabel = stepKey === "inprogress" || stepKey === "serviceoperation"
            ? t("Service Operation")
            : step?.step || config.label;

          return (
            <div key={idx} style={{ display: "flex", gap: 14, marginBottom: isLast ? 0 : 4 }}>
              {/* Timeline column */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                {/* Step circle */}
                <div style={{ width: 38, height: 38, borderRadius: "50%", background: status === "pending" ? "#F3F4F6" : `${config.color}18`, border: `2px solid ${status === "pending" ? "#E5E7EB" : config.color}`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1, boxShadow: status === "active" ? `0 0 0 4px ${config.color}20` : "none" }}>
                  {status === "completed"
                    ? <i className="fas fa-check" style={{ fontSize: 14, color: "#059669" }} />
                    : <i className={`fas ${config.icon}`} style={{ fontSize: 13, color: status === "pending" ? "#9CA3AF" : config.color }} />
                  }
                </div>
                {/* Connector line */}
                {!isLast && (
                  <div style={{ width: 2, flex: 1, minHeight: 20, background: status === "completed" ? `linear-gradient(180deg, ${config.color} 0%, #E5E7EB 100%)` : "#E5E7EB", margin: "4px 0" }} />
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1, paddingBottom: isLast ? 0 : 14, minWidth: 0 }}>
                <div style={{ background: "linear-gradient(180deg, #FBFCFF 0%, #F8FAFF 100%)", border: `1px solid ${status === "active" ? config.color + "40" : "#E8EEFB"}`, borderRadius: 10, padding: "11px 14px", boxShadow: status === "active" ? `0 4px 12px ${config.color}12` : "none" }}>
                  {/* Step title row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: "0.88rem", color: status === "pending" ? "#9CA3AF" : "#102A68" }}>{displayLabel}</span>
                    <span style={{ fontSize: "0.72rem", fontWeight: 800, padding: "3px 9px", borderRadius: 12, background: statusStyle.bg, color: statusStyle.color, border: `1px solid ${statusStyle.border}`, flexShrink: 0 }}>
                      {t(statusLabel)}
                    </span>
                  </div>

                  {/* Detail rows - only show if there's data */}
                  {(startedAt !== "—" || completedAt !== "—" || actor) && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
                      {startedAt !== "—" && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.76rem" }}>
                          <span style={{ color: "#8C9ABF", fontWeight: 700 }}>{t("Started")}</span>
                          <span style={{ color: "#102A68", fontWeight: 600, textAlign: "right" }}>{startedAt}</span>
                        </div>
                      )}
                      {completedAt !== "—" && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.76rem" }}>
                          <span style={{ color: "#8C9ABF", fontWeight: 700 }}>{t("Completed")}</span>
                          <span style={{ color: "#102A68", fontWeight: 600, textAlign: "right" }}>{completedAt}</span>
                        </div>
                      )}
                      {actor && (
                        <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "space-between", fontSize: "0.76rem", marginTop: 2 }}>
                          <span style={{ color: "#8C9ABF", fontWeight: 700 }}>{t("Action By")}</span>
                          <span style={{ color: "#102A68", fontWeight: 600 }}>{actor}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default UnifiedJobOrderRoadmapCard;
