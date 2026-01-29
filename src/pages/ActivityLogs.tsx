// src/pages/ActivityLogs.tsx
import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import "./activity.css";
import type { PageProps } from "../lib/PageProps";

const client = generateClient<Schema>();
type LogRow = Schema["ActivityLog"]["type"];

export default function ActivityLog({ permissions }: PageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const [logs, setLogs] = useState<LogRow[]>([]);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    const { data } = await client.models.ActivityLog.list({ limit: 50 });
    const sorted = [...(data ?? [])].sort(
      (a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime()
    );
    setLogs(sorted);
  };

  return (
    <div className="activity-page">
      <h2>Activity Log</h2>

      <div className="timeline">
        {logs.map((log) => (
          <div className="timeline-item" key={log.id}>
            <div className={`badge ${String(log.action || "").toLowerCase()}`}>
              {log.action}
            </div>

            <div className="content">
              <p className="message">{log.message}</p>
              <span className="meta">
                {log.entityType} • {new Date(String(log.createdAt)).toLocaleString()}
              </span>
            </div>
          </div>
        ))}
        {!logs.length && <div style={{ opacity: 0.8 }}>No logs yet.</div>}
      </div>
    </div>
  );
}
