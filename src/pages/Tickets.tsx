import { useEffect, useMemo, useState } from "react";
import { Button } from "@aws-amplify/ui-react";

import type { Schema } from "../../amplify/data/resource";
import type { PageProps } from "../lib/PageProps";
import PermissionGate from "./PermissionGate";
import { useLanguage } from "../i18n/LanguageContext";
import { useGlobalLoading } from "../utils/GlobalLoadingContext";
import { getDataClient } from "../lib/amplifyClient";

const client = getDataClient();

type TicketRow = Schema["Ticket"]["type"];
type CustomerRow = Schema["Customer"]["type"];

const STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
const PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function statusTone(status: string) {
  const normalized = String(status ?? "").toUpperCase();
  if (normalized === "RESOLVED" || normalized === "CLOSED") return "#0f766e";
  if (normalized === "IN_PROGRESS") return "#1d4ed8";
  return "#7c2d12";
}

function priorityTone(priority: string) {
  const normalized = String(priority ?? "").toUpperCase();
  if (normalized === "URGENT") return "#b91c1c";
  if (normalized === "HIGH") return "#c2410c";
  if (normalized === "MEDIUM") return "#1d4ed8";
  return "#475569";
}

export default function Tickets({ permissions }: PageProps) {
  const { t } = useLanguage();
  const { withLoading } = useGlobalLoading();

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("OPEN");
  const [priority, setPriority] = useState<(typeof PRIORITY_OPTIONS)[number]>("MEDIUM");
  const [assignedTo, setAssignedTo] = useState("");
  const [customerId, setCustomerId] = useState("");

  const [editingId, setEditingId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState<(typeof STATUS_OPTIONS)[number]>("OPEN");
  const [editPriority, setEditPriority] = useState<(typeof PRIORITY_OPTIONS)[number]>("MEDIUM");
  const [editAssignedTo, setEditAssignedTo] = useState("");
  const [editCustomerId, setEditCustomerId] = useState("");

  const canCreate = permissions.canCreate;
  const canUpdate = permissions.canUpdate;
  const canDelete = permissions.canDelete;

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    setStatusMsg("");
    try {
      const [ticketRes, customerRes] = await withLoading(
        Promise.all([
          client.models.Ticket.list({ limit: 500 }),
          client.models.Customer.list({ limit: 2000 }),
        ]),
        t("Loading tickets...")
      );

      const sortedTickets = [...(ticketRes.data ?? [])].sort(
        (a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
      );
      const sortedCustomers = [...(customerRes.data ?? [])].sort(
        (a, b) => `${a.name ?? ""} ${a.lastname ?? ""}`.localeCompare(`${b.name ?? ""} ${b.lastname ?? ""}`)
      );

      setTickets(sortedTickets);
      setCustomers(sortedCustomers);
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || t("Failed to load tickets."));
    } finally {
      setLoading(false);
    }
  };

  const customerLabelById = useMemo(() => {
    const map = new Map<string, string>();
    customers.forEach((customer) => {
      const label = `${String(customer.name ?? "").trim()} ${String(customer.lastname ?? "").trim()}`.trim() || String(customer.email ?? customer.phone ?? customer.id);
      map.set(customer.id, label);
    });
    return map;
  }, [customers]);

  const filteredTickets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (statusFilter !== "ALL" && String(ticket.status ?? "") !== statusFilter) return false;
      if (!query) return true;
      const haystack = [
        ticket.title,
        ticket.description,
        ticket.status,
        ticket.priority,
        ticket.assignedTo,
        customerLabelById.get(String(ticket.customerId ?? "")) ?? "",
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ");
      return haystack.includes(query);
    });
  }, [tickets, statusFilter, searchQuery, customerLabelById]);

  const summary = useMemo(() => {
    return {
      total: tickets.length,
      open: tickets.filter((ticket) => String(ticket.status ?? "") === "OPEN").length,
      inProgress: tickets.filter((ticket) => String(ticket.status ?? "") === "IN_PROGRESS").length,
      resolved: tickets.filter((ticket) => ["RESOLVED", "CLOSED"].includes(String(ticket.status ?? ""))).length,
    };
  }, [tickets]);

  const resetCreateForm = () => {
    setTitle("");
    setDescription("");
    setStatus("OPEN");
    setPriority("MEDIUM");
    setAssignedTo("");
    setCustomerId("");
  };

  const createTicket = async () => {
    if (!canCreate) return;
    setStatusMsg("");
    try {
      const titleValue = title.trim();
      if (!titleValue) throw new Error(t("Title is required."));
      if (!customerId) throw new Error(t("Customer is required."));

      await client.models.Ticket.create({
        customerId,
        title: titleValue,
        description: description.trim() || undefined,
        status,
        priority,
        assignedTo: assignedTo.trim() || undefined,
        createdAt: new Date().toISOString(),
      } as any);

      resetCreateForm();
      await load();
      setStatusMsg(t("Ticket created successfully."));
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || t("Failed to create ticket."));
    }
  };

  const startEdit = (ticket: TicketRow) => {
    if (!canUpdate) return;
    setEditingId(ticket.id);
    setEditTitle(String(ticket.title ?? ""));
    setEditDescription(String(ticket.description ?? ""));
    setEditStatus((String(ticket.status ?? "OPEN") as (typeof STATUS_OPTIONS)[number]) || "OPEN");
    setEditPriority((String(ticket.priority ?? "MEDIUM") as (typeof PRIORITY_OPTIONS)[number]) || "MEDIUM");
    setEditAssignedTo(String(ticket.assignedTo ?? ""));
    setEditCustomerId(String(ticket.customerId ?? ""));
  };

  const cancelEdit = () => {
    setEditingId("");
    setEditTitle("");
    setEditDescription("");
    setEditStatus("OPEN");
    setEditPriority("MEDIUM");
    setEditAssignedTo("");
    setEditCustomerId("");
  };

  const saveEdit = async () => {
    if (!canUpdate || !editingId) return;
    setStatusMsg("");
    try {
      const titleValue = editTitle.trim();
      if (!titleValue) throw new Error(t("Title is required."));
      if (!editCustomerId) throw new Error(t("Customer is required."));

      await client.models.Ticket.update({
        id: editingId,
        customerId: editCustomerId,
        title: titleValue,
        description: editDescription.trim() || undefined,
        status: editStatus,
        priority: editPriority,
        assignedTo: editAssignedTo.trim() || undefined,
      } as any);

      cancelEdit();
      await load();
      setStatusMsg(t("Ticket updated successfully."));
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || t("Failed to update ticket."));
    }
  };

  const remove = async (id: string) => {
    if (!canDelete) return;
    const ok = confirm(t("Delete this ticket?"));
    if (!ok) return;

    setStatusMsg("");
    try {
      await client.models.Ticket.delete({ id });
      await load();
      setStatusMsg(t("Ticket deleted successfully."));
    } catch (e: any) {
      console.error(e);
      setStatusMsg(e?.message || t("Delete failed."));
    }
  };

  if (!permissions.canRead) {
    return <div style={{ padding: 24 }}>{t("You do not have access to this page.")}</div>;
  }

  return (
    <div className="vehicle-page customer-page customer-dashboard-shell theme-elegant-glass">
      <main className="main-content customer-dashboard-main" style={{ padding: "16px 8px" }}>
        <div style={{ width: "min(98%, 1380px)", margin: "0 auto", display: "grid", gap: 16 }}>
          <header style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, alignItems: "center", border: "1px solid #DDE7F6", borderRadius: 16, background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", boxShadow: "0 10px 28px rgba(51,84,160,0.10)", padding: "16px 18px" }}>
            <div style={{ width: 50, height: 50, borderRadius: 14, display: "grid", placeItems: "center", background: "linear-gradient(135deg, #1544B3 0%, #32C5FF 100%)", color: "#fff", fontSize: 20 }}>
              <i className="fas fa-ticket-alt"></i>
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 900, color: "#123057" }}>{t("Ticket Management")}</h1>
              <div style={{ color: "#6B7A90", fontSize: 14 }}>{t("Manage customer support tickets, ownership, priorities, and lifecycle status.")}</div>
            </div>
            <PermissionGate moduleId="tickets" optionId="tickets_refresh">
              <Button onClick={() => void load()} isLoading={loading}>{t("Refresh")}</Button>
            </PermissionGate>
          </header>

          <section style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
            {[
              { label: t("Total Tickets"), value: summary.total, color: "#1d4ed8" },
              { label: t("Open"), value: summary.open, color: "#7c2d12" },
              { label: t("In Progress"), value: summary.inProgress, color: "#1d4ed8" },
              { label: t("Resolved / Closed"), value: summary.resolved, color: "#0f766e" },
            ].map((item) => (
              <div key={item.label} style={{ border: "1px solid #DDE7F6", borderRadius: 14, background: "#fff", boxShadow: "0 8px 22px rgba(51,84,160,0.08)", padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#7E8FB9", letterSpacing: "0.05em", textTransform: "uppercase" }}>{item.label}</div>
                <div style={{ marginTop: 6, fontSize: 28, fontWeight: 900, color: item.color }}>{item.value}</div>
              </div>
            ))}
          </section>

          {canCreate && (
            <PermissionGate moduleId="tickets" optionId="tickets_create">
              <section style={{ border: "1px solid #DDE7F6", borderRadius: 16, background: "#fff", boxShadow: "0 10px 28px rgba(51,84,160,0.08)", padding: 18, display: "grid", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#123057" }}>{t("Create Ticket")}</h2>
                  <div style={{ color: "#6B7A90", fontSize: 13 }}>{t("Use this form to register a new customer support case.")}</div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#51627E" }}>{t("Customer")}</span>
                    <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ minHeight: 40, border: "1px solid #DDE7F6", borderRadius: 10, padding: "0 12px" }}>
                      <option value="">{t("Select customer")}</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>{customerLabelById.get(customer.id)}</option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#51627E" }}>{t("Assigned To")}</span>
                    <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder={t("Technician or owner")} style={{ minHeight: 40, border: "1px solid #DDE7F6", borderRadius: 10, padding: "0 12px" }} />
                  </label>

                  <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#51627E" }}>{t("Title")}</span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Short summary of the issue")} style={{ minHeight: 40, border: "1px solid #DDE7F6", borderRadius: 10, padding: "0 12px" }} />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#51627E" }}>{t("Status")}</span>
                    <select value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUS_OPTIONS)[number])} style={{ minHeight: 40, border: "1px solid #DDE7F6", borderRadius: 10, padding: "0 12px" }}>
                      {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#51627E" }}>{t("Priority")}</span>
                    <select value={priority} onChange={(e) => setPriority(e.target.value as (typeof PRIORITY_OPTIONS)[number])} style={{ minHeight: 40, border: "1px solid #DDE7F6", borderRadius: 10, padding: "0 12px" }}>
                      {PRIORITY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#51627E" }}>{t("Description")}</span>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Describe the customer issue, expected action, and context")} rows={4} style={{ border: "1px solid #DDE7F6", borderRadius: 10, padding: 12, resize: "vertical" }} />
                  </label>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button variation="primary" onClick={() => void createTicket()}>{t("Create Ticket")}</Button>
                </div>
              </section>
            </PermissionGate>
          )}

          <section style={{ border: "1px solid #DDE7F6", borderRadius: 16, background: "#fff", boxShadow: "0 10px 28px rgba(51,84,160,0.08)", padding: 18, display: "grid", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#123057" }}>{t("Ticket Records")}</h2>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t("Search tickets...")} style={{ minHeight: 40, width: 260, border: "1px solid #DDE7F6", borderRadius: 10, padding: "0 12px" }} />
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ minHeight: 40, border: "1px solid #DDE7F6", borderRadius: 10, padding: "0 12px" }}>
                  <option value="ALL">{t("All statuses")}</option>
                  {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
            </div>

            {statusMsg ? (
              <div style={{ padding: 12, borderRadius: 10, border: "1px solid #DDE7F6", background: "#F8FBFF", color: "#123057", fontWeight: 700 }}>{statusMsg}</div>
            ) : null}

            {filteredTickets.length === 0 ? (
              <div style={{ padding: 26, textAlign: "center", color: "#6B7A90" }}>{loading ? t("Loading tickets...") : t("No tickets found.")}</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {filteredTickets.map((ticket) => {
                  const isEditing = editingId === ticket.id;
                  return (
                    <div key={ticket.id} style={{ border: "1px solid #DDE7F6", borderRadius: 14, background: "linear-gradient(180deg, #FFFFFF 0%, #F8FBFF 100%)", padding: 16, boxShadow: "0 8px 22px rgba(51,84,160,0.06)" }}>
                      {isEditing ? (
                        <div style={{ display: "grid", gap: 12 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 800, color: "#51627E" }}>{t("Customer")}</span>
                              <select value={editCustomerId} onChange={(e) => setEditCustomerId(e.target.value)} style={{ minHeight: 40, border: "1px solid #DDE7F6", borderRadius: 10, padding: "0 12px" }}>
                                <option value="">{t("Select customer")}</option>
                                {customers.map((customer) => (
                                  <option key={customer.id} value={customer.id}>{customerLabelById.get(customer.id)}</option>
                                ))}
                              </select>
                            </label>
                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 800, color: "#51627E" }}>{t("Assigned To")}</span>
                              <input value={editAssignedTo} onChange={(e) => setEditAssignedTo(e.target.value)} style={{ minHeight: 40, border: "1px solid #DDE7F6", borderRadius: 10, padding: "0 12px" }} />
                            </label>
                            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
                              <span style={{ fontSize: 12, fontWeight: 800, color: "#51627E" }}>{t("Title")}</span>
                              <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={{ minHeight: 40, border: "1px solid #DDE7F6", borderRadius: 10, padding: "0 12px" }} />
                            </label>
                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 800, color: "#51627E" }}>{t("Status")}</span>
                              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as (typeof STATUS_OPTIONS)[number])} style={{ minHeight: 40, border: "1px solid #DDE7F6", borderRadius: 10, padding: "0 12px" }}>
                                {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                              </select>
                            </label>
                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 800, color: "#51627E" }}>{t("Priority")}</span>
                              <select value={editPriority} onChange={(e) => setEditPriority(e.target.value as (typeof PRIORITY_OPTIONS)[number])} style={{ minHeight: 40, border: "1px solid #DDE7F6", borderRadius: 10, padding: "0 12px" }}>
                                {PRIORITY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                              </select>
                            </label>
                            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
                              <span style={{ fontSize: 12, fontWeight: 800, color: "#51627E" }}>{t("Description")}</span>
                              <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} style={{ border: "1px solid #DDE7F6", borderRadius: 10, padding: 12, resize: "vertical" }} />
                            </label>
                          </div>
                          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                            <Button onClick={cancelEdit}>{t("Cancel")}</Button>
                            <PermissionGate moduleId="tickets" optionId="tickets_edit">
                              <Button variation="primary" onClick={() => void saveEdit()}>{t("Save")}</Button>
                            </PermissionGate>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontSize: 18, fontWeight: 900, color: "#123057" }}>{String(ticket.title ?? "—")}</div>
                              <div style={{ marginTop: 6, color: "#6B7A90", fontSize: 13 }}>{customerLabelById.get(String(ticket.customerId ?? "")) ?? "—"} • {fmtDate(ticket.createdAt)}</div>
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ padding: "6px 10px", borderRadius: 999, background: `${statusTone(String(ticket.status ?? "OPEN"))}12`, color: statusTone(String(ticket.status ?? "OPEN")), fontSize: 12, fontWeight: 800 }}>{String(ticket.status ?? "OPEN")}</span>
                              <span style={{ padding: "6px 10px", borderRadius: 999, background: `${priorityTone(String(ticket.priority ?? "MEDIUM"))}12`, color: priorityTone(String(ticket.priority ?? "MEDIUM")), fontSize: 12, fontWeight: 800 }}>{String(ticket.priority ?? "MEDIUM")}</span>
                            </div>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 12 }}>
                            <div style={{ color: "#123057", fontSize: 13 }}><strong>{t("Assigned To")}:</strong> {String(ticket.assignedTo ?? "—")}</div>
                            <div style={{ color: "#123057", fontSize: 13 }}><strong>{t("Customer")}:</strong> {customerLabelById.get(String(ticket.customerId ?? "")) ?? "—"}</div>
                          </div>

                          <div style={{ marginTop: 12, color: "#4B5C74", fontSize: 14, lineHeight: 1.6 }}>{String(ticket.description ?? "") || t("No description provided.")}</div>

                          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                            {canUpdate && (
                              <PermissionGate moduleId="tickets" optionId="tickets_edit">
                                <Button onClick={() => startEdit(ticket)}>{t("Edit")}</Button>
                              </PermissionGate>
                            )}
                            {canDelete && (
                              <PermissionGate moduleId="tickets" optionId="tickets_delete">
                                <Button variation="destructive" onClick={() => void remove(ticket.id)}>{t("Delete")}</Button>
                              </PermissionGate>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
