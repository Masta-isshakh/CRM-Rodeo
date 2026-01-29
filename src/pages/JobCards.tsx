import { useEffect, useState } from "react";
import { Button, TextField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { getCurrentUser } from "aws-amplify/auth";
import type { PageProps } from "../lib/PageProps";

const client = generateClient<Schema>();

type Row =
  (Schema extends { InspectionApproval: { type: infer T } } ? T : any) &
  Record<string, any>;

type Status = "PENDING" | "APPROVED" | "REJECTED";

export default function InspectionApprovals({ permissions }: PageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const Model = (client.models as any).InspectionApproval as any;

  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const [customerName, setCustomerName] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [inspectionNotes, setInspectionNotes] = useState("");
  const [amountQuoted, setAmountQuoted] = useState("");
  const [jobCardId, setJobCardId] = useState("");

  const load = async () => {
    setLoading(true);
    setStatusMsg("");
    try {
      if (!Model) throw new Error("Model InspectionApproval not found in Schema. Check your amplify data models.");
      const res = await Model.list({ limit: 2000 });
      const sorted = [...(res.data ?? [])].sort((a: any, b: any) =>
        String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
      );
      setItems(sorted);
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || "Failed to load inspections.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    setCustomerName("");
    setVehicle("");
    setInspectionNotes("");
    setAmountQuoted("");
    setJobCardId("");
  };

  const create = async () => {
    if (!permissions.canCreate) return;

    setStatusMsg("");
    try {
      if (!customerName.trim()) throw new Error("Customer name is required.");

      const u = await getCurrentUser();
      const createdBy = u.signInDetails?.loginId || u.username;

      const quoted = amountQuoted.trim() === "" ? undefined : Number(amountQuoted);
      if (quoted !== undefined && Number.isNaN(quoted)) throw new Error("Amount quoted must be a number.");

      await Model.create({
        jobCardId: jobCardId.trim() || undefined,
        customerName: customerName.trim(),
        vehicle: vehicle.trim() || undefined,
        inspectionNotes: inspectionNotes.trim() || undefined,
        amountQuoted: quoted,
        status: "PENDING",
        createdBy,
        createdAt: new Date().toISOString(),
      });

      reset();
      await load();
      setStatusMsg("Inspection created.");
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || "Failed to create inspection.");
    }
  };

  const setDecision = async (id: string, decision: Status) => {
    if (!permissions.canApprove) return;

    setStatusMsg("");
    try {
      const u = await getCurrentUser();
      const approvedBy = u.signInDetails?.loginId || u.username;

      await Model.update({
        id,
        status: decision,
        approvedBy,
        approvedAt: new Date().toISOString(),
      });

      await load();
      setStatusMsg(`Inspection ${decision.toLowerCase()}.`);
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || "Update failed.");
    }
  };

  const remove = async (id: string) => {
    if (!permissions.canDelete) return;

    const ok = confirm("Delete this inspection?");
    if (!ok) return;

    setStatusMsg("");
    try {
      await Model.delete({ id });
      await load();
      setStatusMsg("Deleted.");
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || "Delete failed.");
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Inspection Approvals</h2>

      {permissions.canCreate && (
        <div style={{ display: "grid", gap: 12, maxWidth: 720, padding: 12, border: "1px solid #ddd", borderRadius: 8, background: "#fff" }}>
          <h3 style={{ margin: 0 }}>Create inspection</h3>

          <TextField label="JobCard ID (optional)" value={jobCardId} onChange={(e) => setJobCardId((e.target as HTMLInputElement).value)} />
          <TextField label="Customer name" value={customerName} onChange={(e) => setCustomerName((e.target as HTMLInputElement).value)} />
          <TextField label="Vehicle" value={vehicle} onChange={(e) => setVehicle((e.target as HTMLInputElement).value)} />
          <TextField label="Inspection notes" value={inspectionNotes} onChange={(e) => setInspectionNotes((e.target as HTMLInputElement).value)} />
          <TextField label="Amount quoted" value={amountQuoted} onChange={(e) => setAmountQuoted((e.target as HTMLInputElement).value)} />

          <Button variation="primary" onClick={create}>Create inspection</Button>
        </div>
      )}

      {statusMsg && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 8, background: "#fff" }}>
          {statusMsg}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Inspections</h3>
          <Button onClick={load} isLoading={loading}>Refresh</Button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {items.map((x: any) => (
            <div key={x.id} style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, background: "#fff" }}>
              <div style={{ fontWeight: 700 }}>{x.customerName}</div>
              <div style={{ opacity: 0.85 }}>
                Status: <b>{String(x.status ?? "")}</b>
                {typeof x.amountQuoted === "number" ? ` • QAR ${x.amountQuoted}` : ""}
              </div>

              {x.vehicle && <div style={{ opacity: 0.8, marginTop: 4 }}>Vehicle: {x.vehicle}</div>}
              {x.inspectionNotes && <div style={{ opacity: 0.8, marginTop: 6 }}>{x.inspectionNotes}</div>}

              {x.approvedBy && x.status !== "PENDING" && (
                <div style={{ opacity: 0.75, marginTop: 6 }}>
                  Decision by: {x.approvedBy}
                  {x.approvedAt ? ` • ${new Date(String(x.approvedAt)).toLocaleString()}` : ""}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {permissions.canApprove && (
                  <>
                    <Button onClick={() => setDecision(x.id, "APPROVED")} isDisabled={x.status === "APPROVED"}>
                      Approve
                    </Button>
                    <Button variation="destructive" onClick={() => setDecision(x.id, "REJECTED")} isDisabled={x.status === "REJECTED"}>
                      Reject
                    </Button>
                  </>
                )}

                {permissions.canDelete && (
                  <Button variation="destructive" onClick={() => remove(x.id)}>
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))}

          {!items.length && <div style={{ opacity: 0.8 }}>No inspections yet.</div>}
        </div>
      </div>
    </div>
  );
}
