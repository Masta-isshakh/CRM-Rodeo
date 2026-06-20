// src/pages/ActivityLogs.tsx
import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import "./activity.css";
import type { PageProps } from "../lib/PageProps";
import PermissionGate from "./PermissionGate";
import { useGlobalLoading } from "../utils/GlobalLoadingContext";
import { useLanguage } from "../i18n/LanguageContext";
import { translateTextValue } from "../i18n/translations";

const client = generateClient<Schema>();
type LogRow = Schema["ActivityLog"]["type"];

function safeDate(val: unknown): string {
  if (!val) return "\u2014";
  const d = new Date(String(val));
  return isNaN(d.getTime()) ? "\u2014" : d.toLocaleString();
}

function humanizeActivityText(value: string): string {
  return String(value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function formatActivityAction(action: unknown, language: string, t: (text: string) => string): string {
  const raw = String(action ?? "").trim();
  if (!raw) return "-";
  const humanized = humanizeActivityText(raw);
  if (language !== "ar") return humanized;

  const direct = t(humanized);
  if (direct && direct !== humanized) return direct;

  const translated = translateTextValue(humanized, "ar");
  if (translated && translated !== humanized) return translated;

  return humanized;
}

function formatActivityMessage(message: unknown, language: string, t: (text: string) => string): string {
  const raw = String(message ?? "").trim();
  if (!raw) return "-";
  if (language !== "ar") return raw;

  const protectedTokens: string[] = [];
  const tokenized = raw.replace(/(https?:\/\/\S+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\b\d{4,}\b)/gi, (match) => {
    const idx = protectedTokens.push(match) - 1;
    return `__TK${idx}__`;
  });

  let normalized = humanizeActivityText(tokenized);
  const templateReplacements: Array<[RegExp, string]> = [
    [/^Created\s+(.+)$/i, "تم الإنشاء $1"],
    [/^Updated\s+(.+)$/i, "تم التحديث $1"],
    [/^Deleted\s+(.+)$/i, "تم الحذف $1"],
    [/^Sent\s+(.+)$/i, "تم الإرسال $1"],
    [/^Failed\s+to\s+(.+)$/i, "فشل في $1"],
    [/^Processing\s+(.+)$/i, "جار معالجة $1"],
    [/^Scheduled\s+(.+)$/i, "تمت الجدولة $1"],
    [/^Queue\s+(.+)$/i, "الطابور $1"],
    [/^SMS\s+batch\s+(.+)$/i, "دفعة الرسائل النصية $1"],
    [/^WhatsApp\s+batch\s+(.+)$/i, "دفعة واتساب $1"],
    [/^Drive\s+share\s+link\s+(.+)$/i, "رابط مشاركة درايف $1"],
    [/^File\s+share\s+link\s+(.+)$/i, "رابط مشاركة الملف $1"],
    [/^Quota\s+(.+)$/i, "الحصة $1"],
  ];

  templateReplacements.forEach(([pattern, replacement]) => {
    normalized = normalized.replace(pattern, replacement);
  });

  const translated = translateTextValue(normalized, "ar");
  const localized = translated && translated !== normalized ? translated : t(normalized);

  return localized.replace(/__TK(\d+)__/g, (_whole, indexText) => {
    const idx = Number(indexText);
    return Number.isInteger(idx) && idx >= 0 && idx < protectedTokens.length ? protectedTokens[idx] : _whole;
  });
}

export default function ActivityLog({ permissions }: PageProps) {
  const { t, language } = useLanguage();
  const { withLoading } = useGlobalLoading();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchLogs();
    const id = window.setInterval(() => {
      void fetchLogs(true);
    }, 30000);
    return () => window.clearInterval(id);
  }, []);

  const fetchLogs = async (silent = false) => {
    setLoading(true);
    if (!silent) setError(null);
    try {
      const all: LogRow[] = [];
      let nextToken: string | null | undefined = undefined;

      do {
        const response: any = await withLoading(
          client.models.ActivityLog.list({ limit: 200, nextToken } as any),
          silent ? "Refreshing activity logs..." : "Loading activity logs..."
        );
        const pageRows = (response?.data ?? []) as LogRow[];
        all.push(...pageRows);
        nextToken = response?.nextToken;
      } while (nextToken);

      const sorted = [...all].sort(
        (a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime()
      );
      setLogs(sorted);
    } catch (err) {
      if (!silent) setError(t("Failed to load activity logs. Please try again."));
      console.error("[ActivityLogs] fetchLogs error:", err);
    } finally {
      setLoading(false);
    }
  };

  const actorOf = (log: LogRow) =>
    String((log as any)?.actor ?? (log as any)?.username ?? (log as any)?.userEmail ?? (log as any)?.createdBy ?? "System");

  const entityOf = (log: LogRow) => {
    const entityType = String((log as any)?.entityType ?? "-");
    const entityId = String((log as any)?.entityId ?? "").trim();
    return entityId ? `${entityType} • ${entityId}` : entityType;
  };

  return (
    <div className="vehicle-page customer-page customer-dashboard-shell theme-elegant-glass">
      <main className="main-content customer-dashboard-main" style={{ padding: "16px 8px" }}>
      <div className="activity-page customer-table-card-shell">
      {!permissions.canRead ? (
        <div style={{ padding: 24 }}>{t("You don't have access to this page.")}</div>
      ) : (
        <>
      <div className="activity-header">
        <h2>{t("Activity Log")}</h2>
        <button className="activity-refresh-btn" onClick={() => void fetchLogs()} disabled={loading} aria-label={t("Refresh logs")}>
          {loading ? t("Loading...") : `${"\u21bb"} ${t("Refresh")}`}
        </button>
      </div>

      {error && (
        <div className="activity-error" role="alert">
          {error}
          <button onClick={() => void fetchLogs()} className="activity-retry-btn">{t("Retry")}</button>
        </div>
      )}

      <PermissionGate moduleId="activitylog" optionId="activitylog_view">
        {loading ? (
          <div className="activity-loading">
            <div className="activity-spinner" aria-hidden="true" />
            <span>{t("Loading activity logs...")}</span>
          </div>
        ) : (
          <div className="timeline">
            {logs.map((log) => (
              <div className="timeline-item" key={log.id}>
                <div className={`badge ${String(log.action || "").toLowerCase().replace(/\s+/g, "-")}`}>
                  {formatActivityAction(log.action, language, t)}
                </div>

                <div className="content">
                  <p className="message">{formatActivityMessage(log.message, language, t)}</p>
                  <span className="meta">
                    {actorOf(log)} \u2022 {entityOf(log)} \u2022 {safeDate(log.createdAt)}
                  </span>
                </div>
              </div>
            ))}
            {!logs.length && <div className="activity-empty">{t("No logs yet.")}</div>}
          </div>
        )}
      </PermissionGate>
        </>
      )}
      </div>
      </main>
    </div>
  );
}
