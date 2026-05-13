// UnifiedDocumentsCard.tsx
// Reusable unified documents card — follows Customer.tsx design language exactly.

import { useLanguage } from "../i18n/LanguageContext";
import { getUrl } from "aws-amplify/storage";
import PermissionGate from "../pages/PermissionGate";

function joStr(v: any) { return String(v ?? "").trim(); }
function joFirst(...vals: any[]): string {
  for (const v of vals) { const s = joStr(v); if (s) return s; }
  return "—";
}

async function resolveMaybeStorageUrl(urlOrPath: string): Promise<string> {
  const v = joStr(urlOrPath);
  if (!v) return "";
  if (v.startsWith("job-orders/")) {
    const out = await getUrl({ path: v });
    return out.url.toString();
  }
  return v;
}

function getDocTypeIcon(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("pdf")) return "fa-file-pdf";
  if (t.includes("image") || t.includes("jpg") || t.includes("jpeg") || t.includes("png")) return "fa-file-image";
  if (t.includes("word") || t.includes("doc")) return "fa-file-word";
  if (t.includes("excel") || t.includes("xls") || t.includes("csv")) return "fa-file-excel";
  if (t.includes("video") || t.includes("mp4")) return "fa-file-video";
  if (t.includes("zip") || t.includes("archive")) return "fa-file-archive";
  return "fa-file-alt";
}

function getDocTypeColor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("pdf")) return "#DC2626";
  if (t.includes("image") || t.includes("jpg") || t.includes("jpeg") || t.includes("png")) return "#0891B2";
  if (t.includes("word") || t.includes("doc")) return "#2563EB";
  if (t.includes("excel") || t.includes("xls") || t.includes("csv")) return "#16A34A";
  if (t.includes("video") || t.includes("mp4")) return "#7C3AED";
  return "#6B7280";
}

interface Props {
  order: any;
  className?: string;
}

export function UnifiedDocumentsCard({ order, className = "" }: Props) {
  const { t } = useLanguage();
  const docs: any[] = Array.isArray(order?.documents) ? order.documents : [];

  const handleDownload = async (raw: string) => {
    const url = await resolveMaybeStorageUrl(raw);
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className={className} style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 14, boxShadow: "0 10px 28px rgba(51, 84, 160, 0.10)", border: "1px solid #DDE7F6", overflow: "hidden" }}>
      {/* Gradient accent bar */}
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />

      {/* Header */}
      <div style={{ padding: "18px 20px 13px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #E8EEFB" }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)", border: "1px solid #D8E1F7", boxShadow: "0 0 0 4px rgba(101,92,255,0.08), 0 6px 14px rgba(71,88,180,0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5D54FF", flexShrink: 0 }}>
          <i className="fas fa-folder-open" style={{ fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: "#102A68", letterSpacing: "0.05em", textTransform: "uppercase" }}>{t("Documents")}</h3>
          <span style={{ fontSize: "0.78rem", color: "#8C9ABF", fontWeight: 600 }}>{docs.length} {t("file(s)")}</span>
        </div>
        {docs.length > 0 && (
          <span style={{ fontSize: "0.74rem", fontWeight: 800, background: "linear-gradient(90deg, #EEF4FF 0%, #E8F7FF 100%)", color: "#4E40F8", border: "1px solid #C8D9FA", borderRadius: 8, padding: "3px 10px" }}>
            {docs.length}
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "14px 20px 16px" }}>
        {docs.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {docs.map((doc: any, idx: number) => {
              const name = joStr(doc?.name) || `Document ${idx + 1}`;
              const raw = joStr(doc?.storagePath || doc?.url);
              const docType = joFirst(doc?.type, doc?.category, "file");
              const category = joFirst(doc?.category, doc?.type, "—");
              const addedAt = joFirst(doc?.addedAt, doc?.generatedAt, doc?.createdAt, doc?.uploadedAt, doc?.timestamp);
              const uploadedBy = joFirst(doc?.uploadedBy, doc?.addedBy, "—");
              const typeIcon = getDocTypeIcon(docType);
              const typeColor = getDocTypeColor(docType);

              return (
                <div key={doc?.id ?? `${name}-${idx}`} style={{ background: "linear-gradient(180deg, #FBFCFF 0%, #F8FAFF 100%)", border: "1px solid #E8EEFB", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 12 }}>
                  {/* Icon */}
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: `${typeColor}15`, border: `1px solid ${typeColor}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <i className={`fas ${typeIcon}`} style={{ fontSize: 18, color: typeColor }} />
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#102A68", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 12px" }}>
                      {category !== "—" && (
                        <span style={{ fontSize: "0.74rem", color: "#8C9ABF", fontWeight: 600 }}>
                          <i className="fas fa-tag" style={{ marginRight: 4, fontSize: 10 }} />{category}
                        </span>
                      )}
                      {addedAt !== "—" && (
                        <span style={{ fontSize: "0.74rem", color: "#8C9ABF", fontWeight: 600 }}>
                          <i className="fas fa-clock" style={{ marginRight: 4, fontSize: 10 }} />{addedAt}
                        </span>
                      )}
                      {uploadedBy !== "—" && (
                        <span style={{ fontSize: "0.74rem", color: "#8C9ABF", fontWeight: 600 }}>
                          <i className="fas fa-user" style={{ marginRight: 4, fontSize: 10 }} />{uploadedBy}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Download button */}
                  <PermissionGate moduleId="joborder" optionId="joborder_download">
                    <button
                      type="button"
                      disabled={!raw}
                      title={!raw ? t("No file available") : t("Download")}
                      onClick={async () => { await handleDownload(raw); }}
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 8, background: raw ? "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)" : "#E5E7EB", color: raw ? "#FFFFFF" : "#9CA3AF", border: "none", cursor: raw ? "pointer" : "not-allowed", fontSize: "0.78rem", fontWeight: 700, boxShadow: raw ? "0 4px 10px rgba(78,64,248,0.20)" : "none", flexShrink: 0, whiteSpace: "nowrap" }}
                    >
                      <i className="fas fa-download" style={{ fontSize: 11 }} />
                      {t("Download")}
                    </button>
                  </PermissionGate>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "32px 20px", border: "2px dashed #DDE7F6", borderRadius: 10 }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "linear-gradient(180deg, #EEF3FF 0%, #E8F7FF 100%)", border: "1px solid #D8E1F7", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <i className="fas fa-folder-open" style={{ color: "#8C9ABF", fontSize: 20 }} />
            </div>
            <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#102A68", marginBottom: 6 }}>{t("No documents available")}</div>
            <div style={{ fontSize: "0.78rem", color: "#8C9ABF" }}>{t("Documents will appear here once uploaded")}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default UnifiedDocumentsCard;
