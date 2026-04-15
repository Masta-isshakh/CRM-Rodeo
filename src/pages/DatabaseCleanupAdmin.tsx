import { useState } from "react";
import { getDataClient } from "../lib/amplifyClient";

// All models to delete (UserProfile is intentionally excluded to preserve users)
const MODELS_TO_CLEAN = [
  "AppRole",
  "RolePolicy",
  "DepartmentRoleLink",
  "RoleOptionToggle",
  "RoleOptionNumber",
  "JobOrderPayment",
  "JobOrderServiceItem",
  "JobOrderInvoiceService",
  "JobOrderInvoice",
  "JobOrderRoadmapStep",
  "JobOrderDocumentItem",
  "ServiceApprovalRequest",
  "InspectionPhoto",
  "InspectionState",
  "InspectionReport",
  "JobOrder",
  "JobCard",
  "InspectionApproval",
  "InspectionConfig",
  "TicketComment",
  "Ticket",
  "Deal",
  "Contact",
  "Vehicle",
  "Customer",
  "Employee",
  "CallTracking",
  "ServiceCatalog",
  "ServiceCategory",
  "ServiceBrandSpecification",
  "InventoryTransaction",
  "InventoryProduct",
  "InventorySubcategory",
  "InventoryCategory",
  "ActivityLog",
  "InternalChatMessage",
  "ChatReadReceipt",
] as const;

const CONFIRM_PHRASE = "DELETE ALL DATA";

interface DeleteResult {
  model: string;
  deleted: number;
  errors: number;
}

async function deleteAllFromModel(
  client: ReturnType<typeof getDataClient>,
  modelName: string,
  onProgress: (msg: string) => void
): Promise<DeleteResult> {
  const model = (client.models as Record<string, any>)[modelName];
  if (!model) {
    onProgress(`⚠ ${modelName}: model not found, skipping`);
    return { model: modelName, deleted: 0, errors: 0 };
  }

  let deleted = 0;
  let errors = 0;
  let nextToken: string | null | undefined = undefined;

  do {
    let res: any;
    try {
      res = await model.list({ limit: 500, nextToken });
    } catch {
      onProgress(`✗ ${modelName}: failed to list records`);
      errors++;
      break;
    }

    const items: { id: string }[] = res?.data ?? [];
    nextToken = res?.nextToken;

    for (const item of items) {
      try {
        await model.delete({ id: item.id });
        deleted++;
      } catch {
        errors++;
      }
    }

    if (items.length > 0) {
      onProgress(`${modelName}: deleted ${deleted} so far…`);
    }
  } while (nextToken);

  return { model: modelName, deleted, errors };
}

export default function DatabaseCleanupAdmin() {
  const [confirmText, setConfirmText] = useState("");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<DeleteResult[]>([]);
  const [done, setDone] = useState(false);

  const appendLog = (msg: string) =>
    setLog((prev) => [...prev, msg]);

  const handleCleanup = async () => {
    if (confirmText !== CONFIRM_PHRASE) return;
    setRunning(true);
    setLog([]);
    setResults([]);
    setDone(false);

    const client = getDataClient();
    const allResults: DeleteResult[] = [];

    for (const modelName of MODELS_TO_CLEAN) {
      appendLog(`▶ Cleaning ${modelName}…`);
      const result = await deleteAllFromModel(client, modelName, appendLog);
      allResults.push(result);
      appendLog(`✓ ${modelName}: ${result.deleted} deleted, ${result.errors} errors`);
    }

    setResults(allResults);
    setDone(true);
    setRunning(false);
    appendLog("━━━ Cleanup complete ━━━");
  };

  const totalDeleted = results.reduce((s, r) => s + r.deleted, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors, 0);

  return (
    <div style={{ padding: "32px", maxWidth: "780px", margin: "0 auto", fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "8px", color: "#c0392b" }}>
        Database Cleanup
      </h1>
      <p style={{ color: "#555", marginBottom: "24px", fontSize: "14px" }}>
        This will permanently delete <strong>all records</strong> from the database, except user profiles.
        Roles, departments, job orders, customers, vehicles, services, and all other data will be erased.
        This action <strong>cannot be undone</strong>.
      </p>

      <div
        style={{
          background: "#fff8f0",
          border: "1.5px solid #e67e22",
          borderRadius: "8px",
          padding: "16px 20px",
          marginBottom: "24px",
        }}
      >
        <p style={{ fontWeight: 600, marginBottom: "10px", color: "#b7420a" }}>
          Models that will be wiped:
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "4px 16px",
            fontSize: "12px",
            color: "#444",
          }}
        >
          {MODELS_TO_CLEAN.map((m) => (
            <span key={m}>• {m}</span>
          ))}
        </div>
      </div>

      {!done && !running && (
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{ display: "block", fontWeight: 600, marginBottom: "6px", fontSize: "14px" }}
          >
            Type <code style={{ background: "#eee", padding: "2px 6px", borderRadius: "4px" }}>{CONFIRM_PHRASE}</code> to unlock:
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            style={{
              width: "300px",
              padding: "10px 12px",
              border: "1.5px solid #ccc",
              borderRadius: "6px",
              fontSize: "14px",
              fontFamily: "monospace",
            }}
          />
        </div>
      )}

      {!done && (
        <button
          onClick={handleCleanup}
          disabled={running || confirmText !== CONFIRM_PHRASE}
          style={{
            background: confirmText === CONFIRM_PHRASE && !running ? "#c0392b" : "#e0e0e0",
            color: confirmText === CONFIRM_PHRASE && !running ? "#fff" : "#999",
            border: "none",
            borderRadius: "6px",
            padding: "12px 28px",
            fontSize: "15px",
            fontWeight: 600,
            cursor: confirmText === CONFIRM_PHRASE && !running ? "pointer" : "not-allowed",
            marginBottom: "24px",
          }}
        >
          {running ? "Deleting…" : "Delete All Data"}
        </button>
      )}

      {log.length > 0 && (
        <div
          style={{
            background: "#1e1e1e",
            color: "#d4d4d4",
            borderRadius: "8px",
            padding: "16px",
            fontSize: "12px",
            fontFamily: "monospace",
            maxHeight: "340px",
            overflowY: "auto",
            marginBottom: "20px",
          }}
        >
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {done && (
        <div
          style={{
            background: "#eafaf1",
            border: "1.5px solid #27ae60",
            borderRadius: "8px",
            padding: "16px 20px",
            fontSize: "14px",
            color: "#1e8449",
          }}
        >
          <strong>Cleanup complete.</strong> Total deleted: {totalDeleted} records.{" "}
          {totalErrors > 0 && (
            <span style={{ color: "#c0392b" }}>Errors: {totalErrors} (check console for details).</span>
          )}
        </div>
      )}
    </div>
  );
}
