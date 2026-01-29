import { useEffect, useMemo, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient<Schema>();

type TicketRow = Schema["Ticket"]["type"];

export default function Tickets({ permissions }: PageProps) {
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>You don’t have access to this page.</div>;
  }

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  // create form
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("OPEN");

  // editing
  const [editingId, setEditingId] = useState<string>("");
  const [editTitle, setEditTitle] = useState("");
  const [editStatus, setEditStatus] = useState("");

  const load = async () => {
    setLoading(true);
    setStatusMsg("");
    try {
      const res = await client.models.Ticket.list({ limit: 2000 });
      const sorted = [...(res.data ?? [])].sort((a, b) =>
        String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
      );
      setTickets(sorted);
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || "Failed to load tickets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const knownStatuses = useMemo(() => {
    const set = new Set<string>();
    for (const t of tickets) if (t.status) set.add(String(t.status));
    // fallback if list empty
    if (!set.size) set.add("OPEN");
    return Array.from(set);
  }, [tickets]);

  const create = async () => {
    if (!permissions.canCreate) return;

    setStatusMsg("");
    try {
      const t = title.trim();
      if (!t) throw new Error("Title is required.");

      // Only include fields that are very likely in your model: title/status/createdAt/createdBy
      const u = await getCurrentUser();
      const createdBy = u.signInDetails?.loginId || u.username;

      await client.models.Ticket.create({
        title: t,
        status,
        createdBy,
        createdAt: new Date().toISOString(),
      } as any);

      setTitle("");
      setStatus("OPEN");
      await load();
      setStatusMsg("Ticket created.");
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || "Failed to create ticket.");
    }
  };

  const startEdit = (row: TicketRow) => {
    if (!permissions.canUpdate) return;

    setEditingId(row.id);
    setEditTitle(String(row.title ?? ""));
    setEditStatus(String(row.status ?? "OPEN"));
  };

  const cancelEdit = () => {
    setEditingId("");
    setEditTitle("");
    setEditStatus("");
  };

  const saveEdit = async () => {
    if (!permissions.canUpdate) return;
    if (!editingId) return;

    setStatusMsg("");
    try {
      const t = editTitle.trim();
      if (!t) throw new Error("Title is required.");

      await client.models.Ticket.update({
        id: editingId,
        title: t,
        status: editStatus || "OPEN",
      } as any);

      cancelEdit();
      await load();
      setStatusMsg("Ticket updated.");
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || "Update failed.");
    }
  };

  const remove = async (id: string) => {
    if (!permissions.canDelete) return;

    const ok = confirm("Delete this ticket?");
    if (!ok) return;

    setStatusMsg("");
    try {
      await client.models.Ticket.delete({ id });
      await load();
      setStatusMsg("Ticket deleted.");
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || "Delete failed.");
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Support Tickets</h2>

      {permissions.canCreate && (
        <div style={{ display: "grid", gap: 12, maxWidth: 720, padding: 12, border: "1px solid #ddd", borderRadius: 8, background: "#fff" }}>
          <TextField label="Title" value={title} onChange={(e) => setTitle((e.target as HTMLInputElement).value)} />
          <SelectField label="Status" value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
            {knownStatuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </SelectField>
          <Button variation="primary" onClick={create}>
            Create ticket
          </Button>
        </div>
      )}

      {statusMsg && (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #eee", borderRadius: 8, background: "#fff" }}>
          {statusMsg}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Tickets</h3>
          <Button onClick={load} isLoading={loading}>Refresh</Button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {tickets.map((t) => (
            <div key={t.id} style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, background: "#fff" }}>
              {editingId === t.id ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <TextField label="Title" value={editTitle} onChange={(e) => setEditTitle((e.target as HTMLInputElement).value)} />
                  <SelectField label="Status" value={editStatus} onChange={(e) => setEditStatus((e.target as HTMLSelectElement).value)}>
                    {knownStatuses.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </SelectField>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button variation="primary" onClick={saveEdit} isDisabled={!permissions.canUpdate}>Save</Button>
                    <Button onClick={cancelEdit}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontWeight: 700 }}>{String(t.title ?? "")}</div>
                  <div style={{ opacity: 0.85 }}>
                    Status: <b>{String(t.status ?? "")}</b>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {permissions.canUpdate && <Button onClick={() => startEdit(t)}>Edit</Button>}
                    {permissions.canDelete && (
                      <Button variation="destructive" onClick={() => remove(t.id)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}

          {!tickets.length && <div style={{ opacity: 0.8 }}>No tickets yet.</div>}
        </div>
      </div>
    </div>
  );
}
