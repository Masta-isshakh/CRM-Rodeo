import { useEffect, useMemo, useState } from "react";
import { Button, TextField, SelectField } from "@aws-amplify/ui-react";

import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";
import { getCurrentUser } from "aws-amplify/auth";
import { resolveActorUsername } from "../utils/actorIdentity";
import PermissionGate from "./PermissionGate";
import { useLanguage } from "../i18n/LanguageContext";

import { getDataClient } from "../lib/amplifyClient";
const client = getDataClient();

type TicketRow = Schema["Ticket"]["type"];

export default function Tickets({ permissions }: PageProps) {
  const { t } = useLanguage();
  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>{t("You don’t have access to this page.")}</div>;
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
      const res = await client.models.Ticket.list({ limit: 500 });
      const sorted = [...(res.data ?? [])].sort((a, b) =>
        String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
      );
      setTickets(sorted);
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || t("Failed to load tickets."));
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
      const titleValue = title.trim();
      if (!titleValue) throw new Error(t("Title is required."));

      // Only include fields that are very likely in your model: title/status/createdAt/createdBy
      const u = await getCurrentUser();
        const createdBy = resolveActorUsername(u, "system");

      await client.models.Ticket.create({
        title: titleValue,
        status,
        createdBy,
        createdAt: new Date().toISOString(),
      } as any);

      setTitle("");
      setStatus("OPEN");
      await load();
      setStatusMsg(t("Ticket created."));
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || t("Failed to create ticket."));
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
      const titleValue = editTitle.trim();
      if (!titleValue) throw new Error(t("Title is required."));

      await client.models.Ticket.update({
        id: editingId,
        title: titleValue,
        status: editStatus || "OPEN",
      } as any);

      cancelEdit();
      await load();
      setStatusMsg(t("Ticket updated."));
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || t("Update failed."));
    }
  };

  const remove = async (id: string) => {
    if (!permissions.canDelete) return;

    const ok = confirm(t("Delete this ticket?"));
    if (!ok) return;

    setStatusMsg("");
    try {
      await client.models.Ticket.delete({ id });
      await load();
      setStatusMsg(t("Ticket deleted."));
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || t("Delete failed."));
    }
  };

  return (
    <div style={{ padding: 16, width: "min(100%, 1100px)", margin: "0 auto", boxSizing: "border-box" }}>
      <h2>{t("Support Tickets")}</h2>

      {permissions.canCreate && (
        <PermissionGate moduleId="tickets" optionId="tickets_create">
        <div style={{ display: "grid", gap: 12, width: "min(100%, 880px)", padding: 12, border: "1px solid #ddd", borderRadius: 8, background: "#fff", boxSizing: "border-box" }}>
          <TextField label={t("Title")} value={title} onChange={(e) => setTitle((e.target as HTMLInputElement).value)} />
          <SelectField label={t("Status")} value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
            {knownStatuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </SelectField>
          <Button variation="primary" onClick={create}>
            {t("Create ticket")}
          </Button>
        </div>
        </PermissionGate>
      )}

      {statusMsg && (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #eee", borderRadius: 8, background: "#fff" }}>
          {statusMsg}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>{t("Tickets")}</h3>
          <PermissionGate moduleId="tickets" optionId="tickets_refresh">
            <Button onClick={load} isLoading={loading}>{t("Refresh")}</Button>
          </PermissionGate>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {tickets.map((ticket) => (
            <div key={ticket.id} style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, background: "#fff" }}>
              {editingId === ticket.id ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <TextField label={t("Title")} value={editTitle} onChange={(e) => setEditTitle((e.target as HTMLInputElement).value)} />
                  <SelectField label={t("Status")} value={editStatus} onChange={(e) => setEditStatus((e.target as HTMLSelectElement).value)}>
                    {knownStatuses.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </SelectField>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <PermissionGate moduleId="tickets" optionId="tickets_edit">
                      <Button variation="primary" onClick={saveEdit} isDisabled={!permissions.canUpdate}>{t("Save")}</Button>
                    </PermissionGate>
                    <Button onClick={cancelEdit}>{t("Cancel")}</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontWeight: 700 }}>{String(ticket.title ?? "")}</div>
                  <div style={{ opacity: 0.85 }}>
                    {t("Status:")} <b>{String(ticket.status ?? "")}</b>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    {permissions.canUpdate && (
                      <PermissionGate moduleId="tickets" optionId="tickets_edit">
                        <Button onClick={() => startEdit(ticket)}>{t("Edit")}</Button>
                      </PermissionGate>
                    )}
                    {permissions.canDelete && (
                      <PermissionGate moduleId="tickets" optionId="tickets_delete">
                        <Button variation="destructive" onClick={() => remove(ticket.id)}>
                          {t("Delete")}
                        </Button>
                      </PermissionGate>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}

          {!tickets.length && <div style={{ opacity: 0.8 }}>{t("No tickets yet.")}</div>}
        </div>
      </div>
    </div>
  );
}
