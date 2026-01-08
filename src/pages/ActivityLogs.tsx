import { useEffect, useState } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import "./activity.css";

const client = generateClient<Schema>();

export default function ActivityLog() {
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    const { data } = await client.models.ActivityLog.list({
      limit: 50,
    });

    setLogs(
      data.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() -
          new Date(a.createdAt).getTime()
      )
    );
  };

  return (
    <div className="activity-page">
      <h2>Activity Log</h2>

      <div className="timeline">
        {logs.map((log) => (
          <div className="timeline-item" key={log.id}>
            <div className={`badge ${log.action.toLowerCase()}`}>
              {log.action}
            </div>

            <div className="content">
              <p className="message">{log.message}</p>
              <span className="meta">
                {log.entityType} •{" "}
                {new Date(log.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
