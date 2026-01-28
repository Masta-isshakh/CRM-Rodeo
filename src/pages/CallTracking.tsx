import { useEffect, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { getCurrentUser } from "aws-amplify/auth";
import { PageProps } from "../lib/PageProps";

const client = generateClient<Schema>();

type Outcome =
  | "NO_ANSWER"
  | "ANSWERED"
  | "BOOKED"
  | "FOLLOW_UP"
  | "NOT_INTERESTED";

export default function CallTracking({ permissions }: PageProps) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("ANSWERED");
  const [followUpAt, setFollowUpAt] = useState("");
  const [notes, setNotes] = useState("");

  const load = async () => {
    setLoading(true);
    setStatusMsg("");
    try {
      const res = await client.models.CallTracking.list({ limit: 100 });
      setItems(res.data ?? []);
    } catch (e: any) {
      setStatusMsg(e?.message || "Failed to load call tracking.");
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
      if (!customerName.trim() || !phone.trim()) {
        throw new Error("Customer name and phone are required.");
      }
      const u = await getCurrentUser();
      const createdBy = u.signInDetails?.loginId || u.username;

      await client.models.CallTracking.create({
        customerName: customerName.trim(),
        phone: phone.trim(),
        source: source.trim() || undefined,
        outcome,
        followUpAt: followUpAt ? new Date(followUpAt).toISOString() : undefined,
        notes: notes.trim() || undefined,
        createdBy,
        createdAt: new Date().toISOString(),
      });

      setCustomerName("");
      setPhone("");
      setSource("");
      setOutcome("ANSWERED");
      setFollowUpAt("");
      setNotes("");

      await load();
      setStatusMsg("Call record saved.");
    } catch (e: any) {
      setStatusMsg(e?.message || "Failed to save call record.");
    }
  };

  const remove = async (id: string) => {
    setStatusMsg("");
    try {
      await client.models.CallTracking.delete({ id });
      await load();
      setStatusMsg("Deleted.");
    } catch (e: any) {
      setStatusMsg(e?.message || "Delete failed.");
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Call Tracking</h2>

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
        <TextField label="Customer name" value={customerName} onChange={(e) => setCustomerName((e.target as HTMLInputElement).value)} />
        <TextField label="Phone" value={phone} onChange={(e) => setPhone((e.target as HTMLInputElement).value)} />
        <TextField label="Source (Instagram, WhatsApp, etc.)" value={source} onChange={(e) => setSource((e.target as HTMLInputElement).value)} />

        <SelectField
          label="Outcome"
          value={outcome}
          onChange={(e) => setOutcome((e.target as HTMLSelectElement).value as Outcome)}
        >
          <option value="NO_ANSWER">NO_ANSWER</option>
          <option value="ANSWERED">ANSWERED</option>
          <option value="BOOKED">BOOKED</option>
          <option value="FOLLOW_UP">FOLLOW_UP</option>
          <option value="NOT_INTERESTED">NOT_INTERESTED</option>
        </SelectField>

        <TextField
          label="Follow-up date/time (optional)"
          type="datetime-local"
          value={followUpAt}
          onChange={(e) => setFollowUpAt((e.target as HTMLInputElement).value)}
        />

        <TextField label="Notes" value={notes} onChange={(e) => setNotes((e.target as HTMLInputElement).value)} />

        <Button variation="primary" onClick={create}>
          Save call
        </Button>

        {statusMsg && <div style={{ padding: 8 }}>{statusMsg}</div>}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Recent calls</h3>
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
              <div style={{ fontWeight: 700 }}>
                {x.customerName} • {x.phone}
              </div>
              <div style={{ opacity: 0.85, marginTop: 4 }}>
                Outcome: <b>{x.outcome}</b>
                {x.source ? ` • Source: ${x.source}` : ""}
              </div>
              {x.followUpAt && (
                <div style={{ opacity: 0.8, marginTop: 4 }}>
                  Follow-up: {new Date(x.followUpAt).toLocaleString()}
                </div>
              )}
              {x.notes && <div style={{ opacity: 0.8, marginTop: 6 }}>{x.notes}</div>}

              <div style={{ marginTop: 10 }}>
                <Button variation="destructive" onClick={() => remove(x.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {!items.length && <div style={{ opacity: 0.8 }}>No call records yet.</div>}
        </div>
      </div>
    </div>
  );
}
