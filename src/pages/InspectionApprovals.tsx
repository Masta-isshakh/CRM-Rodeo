import { useEffect, useState } from "react";
import { Button, TextField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient<Schema>();

type Status = "PENDING" | "APPROVED" | "REJECTED";

export default function InspectionApprovals(props: { canApprove: boolean }) {
  const { canApprove } = props;

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  // Create form (only shown if canApprove)
  const [customerName, setCustomerName] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [inspectionNotes, setInspectionNotes] = useState("");
  const [amountQuoted, setAmountQuoted] = useState("");
  const [jobCardId, setJobCardId] = useState("");

  const load = async () => {
    setLoading(true);
    setStatusMsg("");
    try {
      const res = await client.models.InspectionApproval.list({ limit: 100 });
      setItems(res.data ?? []);
    } catch (e: any) {
      setStatusMsg(e?.message || "Failed to load inspections.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setStatusMsg("");
    try {
      if (!canApprove) {
        throw new Error("You do not have permission to create inspections.");
      }
      if (!customerName.trim()) throw new Error("Customer name is required.");

      const u = await getCurrentUser();
      const createdBy = u.signInDetails?.loginId || u.username;

      const quoted =
        amountQuoted.trim() === "" ? undefined : Number(amountQuoted);

      if (quoted !== undefined && Number.isNaN(quoted)) {
        throw new Error("Amount quoted must be a number.");
      }

      await client.models.InspectionApproval.create({
        jobCardId: jobCardId.trim() || undefined,
        customerName: customerName.trim(),
        vehicle: vehicle.trim() || undefined,
        inspectionNotes: inspectionNotes.trim() || undefined,
        amountQuoted: quoted,
        status: "PENDING",
        createdBy,
        createdAt: new Date().toISOString(),
      });

      setCustomerName("");
      setVehicle("");
      setInspectionNotes("");
      setAmountQuoted("");
      setJobCardId("");

      await load();
      setStatusMsg("Inspection created.");
    } catch (e: any) {
      setStatusMsg(e?.message || "Failed to create inspection.");
    }
  };

  const setDecision = async (id: string, decision: Status) => {
    setStatusMsg("");
    try {
      if (!canApprove) {
        throw new Error("You do not have permission to approve/reject.");
      }
      const u = await getCurrentUser();
      const approvedBy = u.signInDetails?.loginId || u.username;

      await client.models.InspectionApproval.update({
        id,
        status: decision,
        approvedBy,
        approvedAt: new Date().toISOString(),
      });

      await load();
      setStatusMsg(`Inspection ${decision.toLowerCase()}.`);
    } catch (e: any) {
      setStatusMsg(e?.message || "Update failed.");
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Inspection Approval</h2>
      <p style={{ opacity: 0.8 }}>
        Sales can view inspections. Only Admin and Sales Manager can approve/reject.
      </p>

      {/* Create (only for approvers) */}
      {canApprove && (
        <div
          style={{
            display: "grid",
            gap: 12,
            maxWidth: 720,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 8,
            background: "#fff",
          }}
        >
          <h3 style={{ margin: 0 }}>Create inspection</h3>

          <TextField
            label="JobCard ID (optional)"
            value={jobCardId}
            onChange={(e) => setJobCardId((e.target as HTMLInputElement).value)}
          />
          <TextField
            label="Customer name"
            value={customerName}
            onChange={(e) => setCustomerName((e.target as HTMLInputElement).value)}
          />
          <TextField
            label="Vehicle"
            value={vehicle}
            onChange={(e) => setVehicle((e.target as HTMLInputElement).value)}
          />
          <TextField
            label="Inspection notes"
            value={inspectionNotes}
            onChange={(e) => setInspectionNotes((e.target as HTMLInputElement).value)}
          />
          <TextField
            label="Amount quoted"
            value={amountQuoted}
            onChange={(e) => setAmountQuoted((e.target as HTMLInputElement).value)}
          />

          <Button variation="primary" onClick={create}>
            Create inspection
          </Button>
        </div>
      )}

      {statusMsg && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 8, background: "#fff" }}>
          {statusMsg}
        </div>
      )}

      {/* List */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Inspections</h3>
          <Button onClick={load} isLoading={loading}>
            Refresh
          </Button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {items.map((x) => (
            <div
              key={x.id}
              style={{
                padding: 12,
                border: "1px solid #ddd",
                borderRadius: 8,
                background: "#fff",
              }}
            >
              <div style={{ fontWeight: 700 }}>{x.customerName}</div>
              <div style={{ opacity: 0.85 }}>
                Status: <b>{x.status}</b>
                {typeof x.amountQuoted === "number" ? ` • QAR ${x.amountQuoted}` : ""}
              </div>
              {x.vehicle && <div style={{ opacity: 0.8, marginTop: 4 }}>Vehicle: {x.vehicle}</div>}
              {x.inspectionNotes && <div style={{ opacity: 0.8, marginTop: 6 }}>{x.inspectionNotes}</div>}

              {x.approvedBy && (
                <div style={{ opacity: 0.75, marginTop: 6 }}>
                  {x.status !== "PENDING" ? `Decision by: ${x.approvedBy}` : ""}
                  {x.approvedAt ? ` • ${new Date(x.approvedAt).toLocaleString()}` : ""}
                </div>
              )}

              {/* Approve/reject buttons only if allowed */}
              {canApprove && (
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <Button onClick={() => setDecision(x.id, "APPROVED")}>
                    Approve
                  </Button>
                  <Button variation="destructive" onClick={() => setDecision(x.id, "REJECTED")}>
                    Reject
                  </Button>
                </div>
              )}
            </div>
          ))}

          {!items.length && <div style={{ opacity: 0.8 }}>No inspections yet.</div>}
        </div>
      </div>
    </div>
  );
}
