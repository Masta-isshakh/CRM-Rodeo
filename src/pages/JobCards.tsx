import { useEffect, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient<Schema>();

type Status = "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";

export default function JobCards() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const [title, setTitle] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>("OPEN");

  const load = async () => {
    setLoading(true);
    setStatusMsg("");
    try {
      const res = await client.models.JobCard.list({ limit: 100 });
      setItems(res.data ?? []);
    } catch (e: any) {
      setStatusMsg(e?.message || "Failed to load job cards.");
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
      if (!title.trim() || !customerName.trim()) {
        throw new Error("Title and Customer Name are required.");
      }
      const u = await getCurrentUser();
      const createdBy = u.signInDetails?.loginId || u.username;

      await client.models.JobCard.create({
        title: title.trim(),
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        vehicle: vehicle.trim() || undefined,
        plateNumber: plateNumber.trim() || undefined,
        serviceType: serviceType.trim() || undefined,
        notes: notes.trim() || undefined,
        status,
        createdBy,
        createdAt: new Date().toISOString(),
      });

      setTitle("");
      setCustomerName("");
      setCustomerPhone("");
      setVehicle("");
      setPlateNumber("");
      setServiceType("");
      setNotes("");
      setStatus("OPEN");

      await load();
      setStatusMsg("Job card created.");
    } catch (e: any) {
      setStatusMsg(e?.message || "Failed to create job card.");
    }
  };

  const updateStatus = async (id: string, next: Status) => {
    setStatusMsg("");
    try {
      await client.models.JobCard.update({ id, status: next });
      await load();
      setStatusMsg("Status updated.");
    } catch (e: any) {
      setStatusMsg(e?.message || "Failed to update status.");
    }
  };

  const remove = async (id: string) => {
    setStatusMsg("");
    try {
      await client.models.JobCard.delete({ id });
      await load();
      setStatusMsg("Deleted.");
    } catch (e: any) {
      setStatusMsg(e?.message || "Delete failed.");
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Job Cards</h2>

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
        <TextField label="Title" value={title} onChange={(e) => setTitle((e.target as HTMLInputElement).value)} />
        <TextField label="Customer name" value={customerName} onChange={(e) => setCustomerName((e.target as HTMLInputElement).value)} />
        <TextField label="Customer phone" value={customerPhone} onChange={(e) => setCustomerPhone((e.target as HTMLInputElement).value)} />
        <TextField label="Vehicle" value={vehicle} onChange={(e) => setVehicle((e.target as HTMLInputElement).value)} />
        <TextField label="Plate number" value={plateNumber} onChange={(e) => setPlateNumber((e.target as HTMLInputElement).value)} />
        <TextField label="Service type" value={serviceType} onChange={(e) => setServiceType((e.target as HTMLInputElement).value)} />
        <TextField label="Notes" value={notes} onChange={(e) => setNotes((e.target as HTMLInputElement).value)} />

        <SelectField
          label="Status"
          value={status}
          onChange={(e) => setStatus((e.target as HTMLSelectElement).value as Status)}
        >
          <option value="OPEN">OPEN</option>
          <option value="IN_PROGRESS">IN_PROGRESS</option>
          <option value="DONE">DONE</option>
          <option value="CANCELLED">CANCELLED</option>
        </SelectField>

        <Button variation="primary" onClick={create}>
          Create job card
        </Button>

        {statusMsg && <div style={{ padding: 8 }}>{statusMsg}</div>}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>List</h3>
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
              <div style={{ fontWeight: 700 }}>{x.title}</div>
              <div style={{ opacity: 0.85 }}>
                {x.customerName} {x.phone ? `• ${x.phone}` : ""}
              </div>
              <div style={{ opacity: 0.75, marginTop: 6 }}>
                Status: <b>{x.status}</b>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <Button onClick={() => updateStatus(x.id, "OPEN")}>OPEN</Button>
                <Button onClick={() => updateStatus(x.id, "IN_PROGRESS")}>IN_PROGRESS</Button>
                <Button onClick={() => updateStatus(x.id, "DONE")}>DONE</Button>
                <Button onClick={() => updateStatus(x.id, "CANCELLED")}>CANCELLED</Button>
                <Button variation="destructive" onClick={() => remove(x.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {!items.length && <div style={{ opacity: 0.8 }}>No job cards yet.</div>}
        </div>
      </div>
    </div>
  );
}
