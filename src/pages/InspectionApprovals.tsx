import { useEffect, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { getCurrentUser } from "aws-amplify/auth";
import type { PageProps } from "../lib/PageProps";

const client = generateClient<Schema>();

// Safe row type (prevents TS errors on row.customerName, row.phone, etc.)
type CallRow =
  (Schema extends { CallTracking: { type: infer T } } ? T : any) &
  Record<string, any>;

type Outcome = "NO_ANSWER" | "ANSWERED" | "BOOKED" | "FOLLOW_UP" | "NOT_INTERESTED";

export default function CallTracking({ permissions }: PageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const Model = (client.models as any).CallTracking as any;

  const [items, setItems] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  // create / edit form state
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("ANSWERED");
  const [followUpAt, setFollowUpAt] = useState("");
  const [notes, setNotes] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<CallRow | null>(null);

  const load = async () => {
    setLoading(true);
    setStatusMsg("");
    try {
      if (!Model) throw new Error("Model CallTracking not found in Schema. Check your amplify data models.");
      const res = await Model.list({ limit: 2000 });
      const sorted = [...(res.data ?? [])].sort((a: any, b: any) =>
        String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
      );
      setItems(sorted);
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || "Failed to load call tracking.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setCustomerName("");
    setPhone("");
    setSource("");
    setOutcome("ANSWERED");
    setFollowUpAt("");
    setNotes("");
  };

  const create = async () => {
    if (!permissions.canCreate) return;

    setStatusMsg("");
    try {
      if (!customerName.trim() || !phone.trim()) {
        throw new Error("Customer name and phone are required.");
      }

      const u = await getCurrentUser();
      const createdBy = u.signInDetails?.loginId || u.username;

      await Model.create({
        customerName: customerName.trim(),
        phone: phone.trim(),
        source: source.trim() || undefined,
        outcome,
        followUpAt: followUpAt ? new Date(followUpAt).toISOString() : undefined,
        notes: notes.trim() || undefined,
        createdBy,
        createdAt: new Date().toISOString(),
      });

      resetForm();
      await load();
      setStatusMsg("Call record saved.");
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || "Failed to save call record.");
    }
  };

  const openEdit = (row: CallRow) => {
    if (!permissions.canUpdate) return;

    setEditing(row);
    setCustomerName(String(row.customerName ?? ""));
    setPhone(String(row.phone ?? ""));
    setSource(String(row.source ?? ""));
    setOutcome((row.outcome as Outcome) || "ANSWERED");

    // datetime-local expects: YYYY-MM-DDTHH:mm
    const dt = row.followUpAt ? new Date(String(row.followUpAt)) : null;
    setFollowUpAt(dt ? dt.toISOString().slice(0, 16) : "");

    setNotes(String(row.notes ?? ""));
    setEditOpen(true);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditing(null);
    resetForm();
  };

  const saveEdit = async () => {
    if (!permissions.canUpdate) return;
    if (!editing?.id) return;

    setStatusMsg("");
    try {
      if (!customerName.trim() || !phone.trim()) {
        throw new Error("Customer name and phone are required.");
      }

      await Model.update({
        id: editing.id,
        customerName: customerName.trim(),
        phone: phone.trim(),
        source: source.trim() || undefined,
        outcome,
        followUpAt: followUpAt ? new Date(followUpAt).toISOString() : undefined,
        notes: notes.trim() || undefined,
      });

      closeEdit();
      await load();
      setStatusMsg("Call record updated.");
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || "Update failed.");
    }
  };

  const remove = async (id: string) => {
    if (!permissions.canDelete) return;

    const ok = confirm("Delete this call record?");
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
      <h2>Call Tracking</h2>

      {permissions.canCreate && (
        <div style={{ display: "grid", gap: 12, maxWidth: 720, padding: 12, border: "1px solid #ddd", borderRadius: 8, background: "#fff" }}>
          <TextField label="Customer name" value={customerName} onChange={(e) => setCustomerName((e.target as HTMLInputElement).value)} />
          <TextField label="Phone" value={phone} onChange={(e) => setPhone((e.target as HTMLInputElement).value)} />
          <TextField label="Source (Instagram, WhatsApp, etc.)" value={source} onChange={(e) => setSource((e.target as HTMLInputElement).value)} />

          <SelectField label="Outcome" value={outcome} onChange={(e) => setOutcome((e.target as HTMLSelectElement).value as Outcome)}>
            <option value="NO_ANSWER">NO_ANSWER</option>
            <option value="ANSWERED">ANSWERED</option>
            <option value="BOOKED">BOOKED</option>
            <option value="FOLLOW_UP">FOLLOW_UP</option>
            <option value="NOT_INTERESTED">NOT_INTERESTED</option>
          </SelectField>

          <TextField label="Follow-up date/time (optional)" type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt((e.target as HTMLInputElement).value)} />
          <TextField label="Notes" value={notes} onChange={(e) => setNotes((e.target as HTMLInputElement).value)} />

          <Button variation="primary" onClick={create}>Save call</Button>
        </div>
      )}

      {statusMsg && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 8, background: "#fff" }}>
          {statusMsg}
        </div>
      )}

      {/* Edit modal */}
      {editOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "grid", placeItems: "center", zIndex: 50 }}>
          <div style={{ width: "min(760px, 92vw)", background: "#fff", borderRadius: 10, padding: 16, border: "1px solid #eee" }}>
            <h3 style={{ marginTop: 0 }}>Edit call record</h3>

            <div style={{ display: "grid", gap: 12 }}>
              <TextField label="Customer name" value={customerName} onChange={(e) => setCustomerName((e.target as HTMLInputElement).value)} />
              <TextField label="Phone" value={phone} onChange={(e) => setPhone((e.target as HTMLInputElement).value)} />
              <TextField label="Source" value={source} onChange={(e) => setSource((e.target as HTMLInputElement).value)} />

              <SelectField label="Outcome" value={outcome} onChange={(e) => setOutcome((e.target as HTMLSelectElement).value as Outcome)}>
                <option value="NO_ANSWER">NO_ANSWER</option>
                <option value="ANSWERED">ANSWERED</option>
                <option value="BOOKED">BOOKED</option>
                <option value="FOLLOW_UP">FOLLOW_UP</option>
                <option value="NOT_INTERESTED">NOT_INTERESTED</option>
              </SelectField>

              <TextField label="Follow-up date/time" type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt((e.target as HTMLInputElement).value)} />
              <TextField label="Notes" value={notes} onChange={(e) => setNotes((e.target as HTMLInputElement).value)} />

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <Button onClick={closeEdit}>Cancel</Button>
                <Button variation="primary" onClick={saveEdit} isDisabled={!permissions.canUpdate}>Save changes</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Recent calls</h3>
          <Button onClick={load} isLoading={loading}>Refresh</Button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {items.map((x: any) => (
            <div key={x.id} style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, background: "#fff" }}>
              <div style={{ fontWeight: 700 }}>{x.customerName} • {x.phone}</div>
              <div style={{ opacity: 0.85, marginTop: 4 }}>
                Outcome: <b>{String(x.outcome ?? "")}</b>
                {x.source ? ` • Source: ${x.source}` : ""}
              </div>

              {x.followUpAt && (
                <div style={{ opacity: 0.8, marginTop: 4 }}>
                  Follow-up: {new Date(String(x.followUpAt)).toLocaleString()}
                </div>
              )}

              {x.notes && <div style={{ opacity: 0.8, marginTop: 6 }}>{x.notes}</div>}

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {permissions.canUpdate && <Button onClick={() => openEdit(x)}>Edit</Button>}
                {permissions.canDelete && <Button variation="destructive" onClick={() => remove(x.id)}>Delete</Button>}
              </div>
            </div>
          ))}

          {!items.length && <div style={{ opacity: 0.8 }}>No call records yet.</div>}
        </div>
      </div>
    </div>
  );
}
