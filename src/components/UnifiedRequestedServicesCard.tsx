// UnifiedRequestedServicesCard.tsx
// Reusable unified requested services & tasks card — follows Customer.tsx design language exactly.

import { Fragment } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { resolveActorDisplay } from "../utils/actorIdentity";
import PermissionGate from "../pages/PermissionGate";

function joStr(v: any) { return String(v ?? "").trim(); }
function joFirst(...vals: any[]): string {
  for (const v of vals) { const s = joStr(v); if (s) return s; }
  return "—";
}

function getServiceDisplayName(service: any): string {
  const name = joStr(service?.name);
  const nameAr = joStr(service?.nameAr);
  if (name && nameAr && name !== nameAr) return `${name} / ${nameAr}`;
  return name || nameAr || "Unnamed Service";
}

function formatDuration(startValue: any, endValue: any): string {
  const raw = (v: any) => String(v ?? "").trim();
  const parseDate = (v: any): Date | null => {
    const s = raw(v);
    if (!s || s === "Not started" || s === "Not completed") return null;
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    const hhmm = s.match(/^(\d{1,2}):(\d{2})$/);
    if (hhmm) {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), +hhmm[1], +hhmm[2], 0, 0);
    }
    return null;
  };
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start || !end) return "—";
  const diffMs = end.getTime() - start.getTime();
  if (!isFinite(diffMs) || diffMs <= 0) return "0m";
  const totalMin = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function normalizePkgKey(v: any) { return joStr(v).toLowerCase().replace(/[^a-z0-9]/g, ""); }

function groupServices(services: any[]) {
  const groups: Array<{ key: string; packageTitle: string | null; items: any[]; packagePrice: number | null }> = [];
  const pkgIndex = new Map<string, number>();

  for (const service of services ?? []) {
    const pkgCode = normalizePkgKey(service?.packageCode);
    const pkgName = joStr(service?.packageName);
    const pkgKey = pkgCode || (pkgName ? `pkg:${normalizePkgKey(pkgName)}` : "");

    if (!pkgKey) {
      groups.push({ key: `single-${groups.length}`, packageTitle: null, items: [service], packagePrice: null });
      continue;
    }
    const idx = pkgIndex.get(pkgKey);
    if (typeof idx === "number") {
      groups[idx].items.push(service);
    } else {
      const pkgPrice = parseFloat(joStr(service?.packagePrice)) || null;
      pkgIndex.set(pkgKey, groups.length);
      groups.push({ key: `pkg-${pkgKey}`, packageTitle: `Package: ${pkgName || pkgCode}`, items: [service], packagePrice: pkgPrice });
    }
  }
  return groups;
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

function getSpecLabel(service: any): string {
  const brand = joStr(service?.specificationBrandName);
  const product = joStr(service?.specificationProductName);
  const measurement = joStr(service?.specificationMeasurement);
  if (brand && product && measurement) return `${brand} / ${product} / ${measurement}`;
  if (brand && product) return `${brand} / ${product}`;
  return brand || product || measurement || "";
}

const SERVICE_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  "Completed": { bg: "#D1FAE5", color: "#065F46" },
  "completed": { bg: "#D1FAE5", color: "#065F46" },
  "In Progress": { bg: "#EDE9FE", color: "#5B21B6" },
  "inprogress": { bg: "#EDE9FE", color: "#5B21B6" },
  "Pending": { bg: "#FEF9C3", color: "#713F12" },
  "New": { bg: "#EFF6FF", color: "#1D4ED8" },
};

interface Props {
  order: any;
  actorMap?: Record<string, string>;
  onAddService?: () => void;
  className?: string;
}

export function UnifiedRequestedServicesCard({ order, actorMap, onAddService, className = "" }: Props) {
  const { t } = useLanguage();
  const services = Array.isArray(order?.services) ? order.services : [];
  const groups = groupServices(services);

  const completedCount = services.filter((s: any) => joStr(s?.status).toLowerCase() === "completed").length;
  const progressPct = services.length ? Math.round((completedCount / services.length) * 100) : 0;

  return (
    <div className={className} style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 14, boxShadow: "0 10px 28px rgba(51, 84, 160, 0.10)", border: "1px solid #DDE7F6", overflow: "hidden" }}>
      {/* Gradient accent bar */}
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />

      {/* Header */}
      <div style={{ padding: "18px 20px 13px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #E8EEFB" }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)", border: "1px solid #D8E1F7", boxShadow: "0 0 0 4px rgba(101,92,255,0.08), 0 6px 14px rgba(71,88,180,0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5D54FF", flexShrink: 0 }}>
          <i className="fas fa-screwdriver-wrench" style={{ fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: "#102A68", letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("Requested Services & Tasks")}</h3>
          <span style={{ fontSize: "0.78rem", color: "#8C9ABF", fontWeight: 600 }}>{services.length} {t("service(s)")}</span>
        </div>
        {onAddService && (
          <PermissionGate moduleId="joborder" optionId="joborder_addservice">
            <button
              type="button"
              onClick={onAddService}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", color: "#FFFFFF", border: "none", cursor: "pointer", fontSize: "0.8rem", fontWeight: 700, boxShadow: "0 4px 12px rgba(78,64,248,0.25)", whiteSpace: "nowrap", flexShrink: 0 }}
            >
              <i className="fas fa-plus" style={{ fontSize: 11 }} />
              {t("Add Service")}
            </button>
          </PermissionGate>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "14px 20px 16px" }}>
        {/* Progress bar */}
        {services.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1, height: 6, background: "#E8EEFB", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${progressPct}%`, height: "100%", background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", borderRadius: 3, transition: "width 0.4s ease" }} />
            </div>
            <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#8C9ABF", whiteSpace: "nowrap" }}>{completedCount}/{services.length} {t("done")}</span>
          </div>
        )}

        {services.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {groups.map((group) => (
              <Fragment key={group.key}>
                {group.packageTitle && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "linear-gradient(90deg, #EEF4FF 0%, #E8F7FF 100%)", borderRadius: 8, border: "1px solid #DCE8FF" }}>
                    <span style={{ fontWeight: 800, fontSize: "0.8rem", color: "#102A68", display: "flex", alignItems: "center", gap: 7 }}>
                      <i className="fas fa-box-open" style={{ color: "#4E40F8", fontSize: 12 }} />
                      {group.packageTitle}
                    </span>
                    {group.packagePrice != null && (
                      <span style={{ fontWeight: 800, fontSize: "0.82rem", color: "#4E40F8" }}>QAR {group.packagePrice.toLocaleString()}</span>
                    )}
                  </div>
                )}
                {group.items.map((service: any, idx: number) => {
                  const svcName = getServiceDisplayName(service);
                  const status = joStr(service?.status) || "New";
                  const statusColors = SERVICE_STATUS_COLORS[status] ?? { bg: "#F3F4F6", color: "#374151" };
                  const tech = resolveServiceActor(service, actorMap);
                  const specLabel = getSpecLabel(service);
                  const duration = formatDuration(service?.started, service?.ended);
                  const priceLabel = group.packageTitle ? t("Included in package") : (service?.price ? `QAR ${Number(service.price).toLocaleString()}` : "—");

                  return (
                    <div key={`${group.key}-${idx}`} style={{ background: "linear-gradient(180deg, #FBFCFF 0%, #F8FAFF 100%)", border: "1px solid #E8EEFB", borderRadius: 10, padding: "12px 14px" }}>
                      {/* Service title row */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#102A68", flex: 1 }} data-no-translate="true">{svcName}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                          <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#4E40F8" }}>{priceLabel}</span>
                          <span style={{ fontSize: "0.71rem", fontWeight: 700, padding: "3px 9px", borderRadius: 12, background: statusColors.bg, color: statusColors.color }}>{status}</span>
                        </div>
                      </div>
                      {/* Detail rows */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
                        {specLabel && (
                          <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "space-between", fontSize: "0.78rem", padding: "3px 0", borderBottom: "1px solid #EEF2FB" }}>
                            <span style={{ color: "#8C9ABF", fontWeight: 700 }}>{t("Specification")}</span>
                            <span style={{ color: "#102A68", fontWeight: 600, textAlign: "right" }} data-no-translate="true">{specLabel}</span>
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", padding: "3px 0" }}>
                          <span style={{ color: "#8C9ABF", fontWeight: 700 }}>{t("Technician")}</span>
                          <span style={{ color: "#102A68", fontWeight: 600 }}>{tech}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", padding: "3px 0" }}>
                          <span style={{ color: "#8C9ABF", fontWeight: 700 }}>{t("Duration")}</span>
                          <span style={{ color: "#102A68", fontWeight: 600 }}>{duration}</span>
                        </div>
                        {service?.started && service.started !== "Not started" && (
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", padding: "3px 0" }}>
                            <span style={{ color: "#8C9ABF", fontWeight: 700 }}>{t("Started")}</span>
                            <span style={{ color: "#102A68", fontWeight: 600 }}>{service.started}</span>
                          </div>
                        )}
                        {service?.ended && service.ended !== "Not completed" && (
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", padding: "3px 0" }}>
                            <span style={{ color: "#8C9ABF", fontWeight: 700 }}>{t("Ended")}</span>
                            <span style={{ color: "#102A68", fontWeight: 600 }}>{service.ended}</span>
                          </div>
                        )}
                        {service?.notes && (
                          <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "space-between", fontSize: "0.78rem", padding: "3px 0" }}>
                            <span style={{ color: "#8C9ABF", fontWeight: 700 }}>{t("Notes")}</span>
                            <span style={{ color: "#102A68", fontWeight: 600, textAlign: "right", maxWidth: "60%" }}>{service.notes}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "32px 20px", border: "2px dashed #DDE7F6", borderRadius: 10 }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "linear-gradient(180deg, #EEF3FF 0%, #E8F7FF 100%)", border: "1px solid #D8E1F7", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <i className="fas fa-clipboard-list" style={{ color: "#8C9ABF", fontSize: 20 }} />
            </div>
            <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#102A68", marginBottom: 6 }}>{t("No services added yet")}</div>
            <div style={{ fontSize: "0.78rem", color: "#8C9ABF" }}>{t("Use Add Service to append tasks to this job card")}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default UnifiedRequestedServicesCard;
