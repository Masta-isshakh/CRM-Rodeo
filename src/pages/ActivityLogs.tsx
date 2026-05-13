// src/pages/ActivityLogs.tsx
import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import "./activity.css";
import type { PageProps } from "../lib/PageProps";
import PermissionGate from "./PermissionGate";

const client = generateClient<Schema>();
type LogRow = Schema["ActivityLog"]["type"];

function safeDate(val: unknown): string {
  if (!val) return "\u2014";
  const d = new Date(String(val));
  return isNaN(d.getTime()) ? "\u2014" : d.toLocaleString();
}

export default function ActivityLog({ permissions }: PageProps) {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await client.models.ActivityLog.list({ limit: 50 });
      const sorted = [...(data ?? [])].sort(
        (a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime()
      );
      setLogs(sorted);
    } catch (err) {
      setError("Failed to load activity logs. Please try again.");
      console.error("[ActivityLogs] fetchLogs error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="activity-page">
      {!permissions.canRead ? (
        <div style={{ padding: 24 }}>You don't have access to this page.</div>
      ) : (
        <>
      <div className="activity-header">
        <h2>Activity Log</h2>
        <button className="activity-refresh-btn" onClick={() => void fetchLogs()} disabled={loading} aria-label="Refresh logs">
          {loading ? "Loading\u2026" : "\u21bb Refresh"}
        </button>
      </div>

      {error && (
        <div className="activity-error" role="alert">
          {error}
          <button onClick={() => void fetchLogs()} className="activity-retry-btn">Retry</button>
        </div>
      )}

      <PermissionGate moduleId="activitylog" optionId="activitylog_view">
        {loading ? (
          <div className="activity-loading">
            <div className="activity-spinner" aria-hidden="true" />
            <span>Loading activity logs\u2026</span>
          </div>
        ) : (
          <div className="timeline">
            {logs.map((log) => (
              <div className="timeline-item" key={log.id}>
                <div className={`badge ${String(log.action || "").toLowerCase()}`}>
                  {log.action}
                </div>

                <div className="content">
                  <p className="message">{log.message}</p>
                  <span className="meta">
                    {log.entityType} \u2022 {safeDate(log.createdAt)}
                  </span>
                </div>
              </div>
            ))}
            {!logs.length && <div className="activity-empty">No logs yet.</div>}
          </div>
        )}
      </PermissionGate>
        </>
      )}
    </div>
  );
}
