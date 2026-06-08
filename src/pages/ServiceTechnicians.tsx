import { useMemo, useState } from "react";
import type { PageProps } from "../lib/PageProps";
import { useLanguage } from "../i18n/LanguageContext";
import { usePermissions } from "../lib/userPermissions";
import PermissionGate from "./PermissionGate";
import {
  addServiceTechnicianCatalogItem,
  listServiceTechnicianCatalog,
  removeServiceTechnicianCatalogItem,
  updateServiceTechnicianCatalogItem,
  type ServiceTechnicianItem,
} from "./serviceTechnicianCatalogRepo";

type FormState = {
  serviceId: string;
  nameEn: string;
  nameAr: string;
  description: string;
};

const EMPTY_FORM: FormState = {
  serviceId: "",
  nameEn: "",
  nameAr: "",
  description: "",
};

export default function ServiceTechnicians({ permissions }: PageProps) {
  const { t } = useLanguage();
  const { canOption, isAdminGroup } = usePermissions();

  const allowOption = (optionId: string, fallback = true) => {
    if (isAdminGroup) return true;
    return canOption("servicetech", optionId, fallback);
  };

  const canList = allowOption("servicetech_list", true);
  const canSearch = allowOption("servicetech_search", true);
  const canAdd = allowOption("servicetech_add", permissions.canCreate || permissions.canUpdate);
  const canEdit = allowOption("servicetech_edit", permissions.canUpdate);
  const canDelete = allowOption("servicetech_delete", permissions.canDelete || permissions.canUpdate);

  const [rows, setRows] = useState<ServiceTechnicianItem[]>(() => listServiceTechnicianCatalog());
  const [query, setQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [error, setError] = useState("");
  const [editError, setEditError] = useState("");

  if (!permissions.canRead || !canList) {
    return <div style={{ padding: 24 }}>{t("You don't have access to this page.")}</div>;
  }

  const hasUnsavedEditChanges = (item: ServiceTechnicianItem | null) => {
    if (!item) return false;
    return (
      String(editForm.serviceId ?? "") !== String(item.serviceId ?? "") ||
      String(editForm.nameEn ?? "") !== String(item.nameEn ?? "") ||
      String(editForm.nameAr ?? "") !== String(item.nameAr ?? "") ||
      String(editForm.description ?? "") !== String(item.description ?? "")
    );
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((item) => {
      const hay = [item.serviceId, item.nameEn, item.nameAr, item.description].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setError("");
  };

  const refreshRows = () => {
    setRows(listServiceTechnicianCatalog());
  };

  const openCreate = () => {
    if (!canAdd) return;
    resetForm();
    setShowModal(true);
  };

  const handleCreate = () => {
    if (!canAdd) return;
    setSaving(true);
    try {
      addServiceTechnicianCatalogItem({
        serviceId: form.serviceId,
        nameEn: form.nameEn,
        nameAr: form.nameAr,
        description: form.description,
      });
      refreshRows();
      setShowModal(false);
      resetForm();
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "Failed to create service."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    if (!canDelete) return;
    removeServiceTechnicianCatalogItem(id);
    if (editingId === id) {
      setEditingId(null);
      setEditForm(EMPTY_FORM);
      setEditError("");
    }
    refreshRows();
  };

  const startEdit = (item: ServiceTechnicianItem) => {
    if (!canEdit) return;
    if (editingId && editingId !== item.id) {
      const current = rows.find((row) => row.id === editingId) ?? null;
      if (hasUnsavedEditChanges(current)) {
        const shouldSwitch = window.confirm(t("You have unsaved changes. Switch rows and discard current edits?"));
        if (!shouldSwitch) return;
      }
    }
    setEditingId(item.id);
    setEditForm({
      serviceId: item.serviceId,
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      description: item.description,
    });
    setEditError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
    setEditError("");
  };

  const handleSaveEdit = () => {
    if (!canEdit || !editingId) return;
    setSavingEdit(true);
    try {
      updateServiceTechnicianCatalogItem(editingId, {
        serviceId: editForm.serviceId,
        nameEn: editForm.nameEn,
        nameAr: editForm.nameAr,
        description: editForm.description,
      });
      refreshRows();
      cancelEdit();
    } catch (e: any) {
      setEditError(String(e?.message ?? e ?? "Failed to update service."));
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div
      className="vehicle-page customer-page customer-dashboard-shell theme-executive-minimal"
      style={{ background: "linear-gradient(145deg, #f8fafe 0%, #eef3ff 100%)", minHeight: "100vh" }}
    >
      <main className="main-content customer-dashboard-main" style={{ padding: "16px 8px" }}>
        <section style={{ position: "relative", overflow: "hidden", marginBottom: 10, background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 12, boxShadow: "0 10px 24px rgba(51, 84, 160, 0.08)", border: "1px solid #DDE7F6" }}>
          <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />
          <div aria-hidden="true" style={{ position: "absolute", top: -18, right: -22, height: 96, width: 202, background: "linear-gradient(to bottom left, rgba(67, 24, 255, 0.18), rgba(67, 24, 255, 0))", borderBottomLeftRadius: 999, pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", right: 28, top: 26, width: 44, height: 44, borderRadius: 14, opacity: 0.35, backgroundImage: "radial-gradient(circle, rgba(116, 137, 191, 0.55) 1.4px, transparent 1.5px)", backgroundSize: "10px 10px", pointerEvents: "none" }} />

          <div style={{ position: "relative", zIndex: 1, padding: "17px 24px 17px", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 17 }}>
                <div style={{ width: 42, height: 42, borderRadius: "50%", background: "linear-gradient(180deg, #FFFFFF 0%, #EEF3FF 100%)", border: "1px solid #D8E1F7", boxShadow: "0 0 0 4px rgba(101, 92, 255, 0.08), 0 6px 14px rgba(71, 88, 180, 0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5D54FF" }}>
                  <i className="fas fa-user-cog" style={{ fontSize: 16 }} />
                </div>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#102A68", lineHeight: 1.15, letterSpacing: "-0.03em" }}>{t("Service Technicians")}</h1>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {canSearch ? (
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <i className="fas fa-search" style={{ position: "absolute", left: 10, color: "#8C9ABF", fontSize: 12, pointerEvents: "none" }} />
                    <input
                      type="text"
                      style={{ paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderRadius: 8, border: "1px solid #DDE7F6", background: "#FAFBFF", color: "#102A68", fontSize: "0.88rem", fontWeight: 700, outline: "none", minWidth: 240 }}
                      placeholder={t("Search services")}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                ) : null}

                <PermissionGate moduleId="servicetech" optionId="servicetech_refresh">
                  <button
                    type="button"
                    onClick={refreshRows}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #DDE7F6", background: "#F7F9FF", color: "#5D54FF", fontSize: "0.88rem", fontWeight: 700, cursor: "pointer" }}
                  >
                    <i className="fas fa-sync" /> {t("Refresh")}
                  </button>
                </PermissionGate>

                {canAdd ? (
                  <PermissionGate moduleId="servicetech" optionId="servicetech_add">
                    <button
                      type="button"
                      onClick={openCreate}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 8, border: "none", background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", color: "#fff", fontSize: "0.88rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 12px rgba(78, 64, 248, 0.25)" }}
                    >
                      <i className="fas fa-plus-circle" /> {t("Add Service Technicians")}
                    </button>
                  </PermissionGate>
                ) : null}
              </div>
            </div>

            <p style={{ margin: 0, marginLeft: 59, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: "#8C9ABF", fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1.35 }}>
              <span aria-hidden="true" style={{ width: 2, height: 12, borderRadius: 999, background: "linear-gradient(180deg, #25D6E8 0%, #4E40F8 100%)", boxShadow: "0 0 0 2px rgba(78, 64, 248, 0.10)" }} />
              <span style={{ color: "#7E8FB9" }}>{t("Create and manage technician service capabilities in Arabic and English.")}</span>
            </p>
            {editingId && (() => {
              const editingRow = rows.find((item) => item.id === editingId) ?? null;
              return hasUnsavedEditChanges(editingRow) ? (
                <div style={{ marginLeft: 59, marginTop: 2, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: "#C06A00", fontWeight: 700, letterSpacing: "0.01em" }}>
                  <i className="fas fa-exclamation-circle" />
                  {t("Unsaved changes")}
                </div>
              ) : null;
            })()}
          </div>
        </section>

        <section style={{ position: "relative", background: "linear-gradient(180deg, #FBFCFF 0%, #FFFFFF 100%)", borderRadius: 12, boxShadow: "0 10px 24px rgba(51, 84, 160, 0.08)", border: "1px solid #DDE7F6", overflow: "hidden", marginBottom: 6 }}>
          <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", zIndex: 2 }} />
          <div className="table-wrapper customer-table-card-shell" style={{ borderRadius: 16, border: "1px solid #DCE6F8", background: "linear-gradient(180deg, #FFFFFF 0%, #F8FBFF 100%)", boxShadow: "0 14px 34px rgba(15, 42, 102, 0.12)", padding: 10, overflowX: "auto", overflowY: "hidden", WebkitOverflowScrolling: "touch", position: "relative", marginTop: 4 }}>
            <table className="customers-table customer-dashboard-table" style={{ width: "100%", minWidth: 980, borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "16%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "28%" }} />
                <col style={{ width: "20%" }} />
              </colgroup>
              <thead>
                <tr style={{ background: "linear-gradient(90deg, #EEF4FF 0%, #E8F7FF 100%)" }}>
                  <th style={{ padding: "9px 12px", borderBottom: "1px solid #D9E5FA", textAlign: "left", fontSize: 10.8, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#111827" }}>{t("Service ID")}</th>
                  <th style={{ padding: "9px 12px", borderBottom: "1px solid #D9E5FA", textAlign: "left", fontSize: 10.8, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#111827" }}>{t("Service Name (English)")}</th>
                  <th style={{ padding: "9px 12px", borderBottom: "1px solid #D9E5FA", textAlign: "left", fontSize: 10.8, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#111827" }}>{t("Service Name (Arabic)")}</th>
                  <th style={{ padding: "9px 12px", borderBottom: "1px solid #D9E5FA", textAlign: "left", fontSize: 10.8, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#111827" }}>{t("Service Description")}</th>
                  <th style={{ padding: "9px 12px", borderBottom: "1px solid #D9E5FA", textAlign: "right", fontSize: 10.8, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#111827" }}>{t("Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#8C9ABF", fontWeight: 700 }}>{t("No service technicians found.")}</td>
                  </tr>
                ) : (
                  <>
                    {filtered.map((item, idx) => (
                    <tr key={item.id} style={{ background: idx % 2 === 0 ? "rgba(255,255,255,0.96)" : "rgba(246,250,255,0.96)" }}>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #E7EEFC", color: "#0F2A66", fontWeight: 700 }}>
                        {editingId === item.id ? (
                          <input
                            value={editForm.serviceId}
                            onChange={(e) => setEditForm((p) => ({ ...p, serviceId: e.target.value }))}
                            style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 8, border: "1px solid #C8D5EE", background: "#FFFFFF", color: "#0F2A66", fontWeight: 700 }}
                          />
                        ) : (
                          item.serviceId
                        )}
                      </td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #E7EEFC", color: "#0F2A66", fontWeight: 700 }}>
                        {editingId === item.id ? (
                          <input
                            value={editForm.nameEn}
                            onChange={(e) => setEditForm((p) => ({ ...p, nameEn: e.target.value }))}
                            style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 8, border: "1px solid #C8D5EE", background: "#FFFFFF", color: "#0F2A66", fontWeight: 700 }}
                          />
                        ) : (
                          item.nameEn || "—"
                        )}
                      </td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #E7EEFC", color: "#0F2A66", fontWeight: 700 }}>
                        {editingId === item.id ? (
                          <input
                            value={editForm.nameAr}
                            onChange={(e) => setEditForm((p) => ({ ...p, nameAr: e.target.value }))}
                            style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 8, border: "1px solid #C8D5EE", background: "#FFFFFF", color: "#0F2A66", fontWeight: 700 }}
                          />
                        ) : (
                          item.nameAr || "—"
                        )}
                      </td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #E7EEFC", color: "#0F2A66", fontWeight: 700 }}>
                        {editingId === item.id ? (
                          <textarea
                            value={editForm.description}
                            onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                            rows={2}
                            style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 8, border: "1px solid #C8D5EE", background: "#FFFFFF", color: "#0F2A66", fontWeight: 700, resize: "vertical" }}
                          />
                        ) : (
                          item.description || "—"
                        )}
                      </td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid #E7EEFC", textAlign: "right" }}>
                        {editingId === item.id ? (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <PermissionGate moduleId="servicetech" optionId="servicetech_edit">
                              <button
                                type="button"
                                onClick={handleSaveEdit}
                                disabled={savingEdit}
                                style={{ border: "none", borderRadius: 8, background: savingEdit ? "#9EC5F8" : "#2B7FFF", color: "#fff", fontSize: "0.8rem", fontWeight: 700, cursor: savingEdit ? "not-allowed" : "pointer", padding: "6px 10px" }}
                              >
                                <i className="fas fa-save" /> {savingEdit ? t("Saving...") : t("Save")}
                              </button>
                            </PermissionGate>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={savingEdit}
                              style={{ border: "1px solid #C8D5EE", borderRadius: 8, background: "#fff", color: "#5D54FF", fontSize: "0.8rem", fontWeight: 700, cursor: savingEdit ? "not-allowed" : "pointer", padding: "6px 10px" }}
                            >
                              <i className="fas fa-times" /> {t("Cancel")}
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                            {canEdit ? (
                              <PermissionGate moduleId="servicetech" optionId="servicetech_edit">
                                <button
                                  type="button"
                                  onClick={() => startEdit(item)}
                                  style={{ border: "none", background: "transparent", color: "#2B7FFF", fontSize: "0.84rem", fontWeight: 700, cursor: "pointer" }}
                                >
                                  <i className="fas fa-pen" /> {t("Edit")}
                                </button>
                              </PermissionGate>
                            ) : null}
                            {canDelete ? (
                              <PermissionGate moduleId="servicetech" optionId="servicetech_delete">
                                <button
                                  type="button"
                                  onClick={() => handleDelete(item.id)}
                                  style={{ border: "none", background: "transparent", color: "#D14343", fontSize: "0.84rem", fontWeight: 700, cursor: "pointer" }}
                                >
                                  <i className="fas fa-trash" /> {t("Delete")}
                                </button>
                              </PermissionGate>
                            ) : null}
                            {!canEdit && !canDelete ? <span style={{ color: "#8C9ABF" }}>—</span> : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                    {editingId && editError ? (
                      <tr key="edit-error-row" style={{ background: "rgba(255,246,246,0.98)" }}>
                        <td colSpan={5} style={{ padding: "8px 12px", borderBottom: "1px solid #E7EEFC", color: "#D14343", fontWeight: 700, fontSize: "0.84rem" }}>
                          <i className="fas fa-exclamation-circle" style={{ marginRight: 6 }} />
                          {editError}
                        </td>
                      </tr>
                    ) : null}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10, 28, 80, 0.45)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 14px", zIndex: 9999 }}>
          <div style={{ background: "linear-gradient(145deg, #f8fafe 0%, #eef3ff 100%)", border: "1px solid #DDE7F6", borderRadius: 18, boxShadow: "0 24px 64px rgba(51, 84, 160, 0.22), 0 4px 20px rgba(78, 64, 248, 0.12)", overflow: "hidden", maxWidth: 560, width: "92vw" }}>
            <div style={{ height: 4, background: "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)" }} />
            <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid #E8EEFB", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#102A68", letterSpacing: "-0.02em" }}>
                <i className="fas fa-user-cog" style={{ marginRight: 8, color: "#5D54FF" }} />
                {t("Add Service Technicians")}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                disabled={saving}
                style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid #DDE7F6", background: "linear-gradient(160deg, #FFFFFF 0%, #F0F4FF 100%)", color: "#8C9ABF", cursor: "pointer" }}
              >
                <i className="fas fa-times" />
              </button>
            </div>

            <div style={{ padding: "20px 24px" }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", marginBottom: 6, fontSize: 10.5, fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.08em" }}>{t("Service ID")} *</label>
                <input value={form.serviceId} onChange={(e) => setForm((p) => ({ ...p, serviceId: e.target.value }))} placeholder={t("Enter service ID")} style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 9, border: "1.5px solid #D5DEEF", background: "#F7F9FF", fontSize: "0.9rem", fontWeight: 600, color: "#0F2A66" }} />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", marginBottom: 6, fontSize: 10.5, fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.08em" }}>{t("Service Name (English)")} *</label>
                <input value={form.nameEn} onChange={(e) => setForm((p) => ({ ...p, nameEn: e.target.value }))} placeholder={t("Enter service name in English")} style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 9, border: "1.5px solid #D5DEEF", background: "#F7F9FF", fontSize: "0.9rem", fontWeight: 600, color: "#0F2A66" }} />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", marginBottom: 6, fontSize: 10.5, fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.08em" }}>{t("Service Name (Arabic)")} *</label>
                <input value={form.nameAr} onChange={(e) => setForm((p) => ({ ...p, nameAr: e.target.value }))} placeholder={t("Enter service name in Arabic")} style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 9, border: "1.5px solid #D5DEEF", background: "#F7F9FF", fontSize: "0.9rem", fontWeight: 600, color: "#0F2A66" }} />
              </div>

              <div style={{ marginBottom: 6 }}>
                <label style={{ display: "block", marginBottom: 6, fontSize: 10.5, fontWeight: 700, color: "#8C9ABF", textTransform: "uppercase", letterSpacing: "0.08em" }}>{t("Service Description")}</label>
                <textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder={t("Enter service description")} rows={3} style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 9, border: "1.5px solid #D5DEEF", background: "#F7F9FF", fontSize: "0.9rem", fontWeight: 600, color: "#0F2A66", resize: "vertical" }} />
              </div>

              {error ? <div style={{ marginTop: 8, color: "#D14343", fontWeight: 700, fontSize: "0.84rem" }}><i className="fas fa-exclamation-circle" style={{ marginRight: 6 }} />{error}</div> : null}
            </div>

            <div style={{ padding: "14px 24px 20px", borderTop: "1px solid #E8EEFB", display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={handleCreate}
                disabled={saving}
                style={{ background: saving ? "linear-gradient(90deg, #b0aef8 0%, #a0e6ee 100%)" : "linear-gradient(90deg, #4E40F8 0%, #25D6E8 100%)", color: "#fff", border: "none", borderRadius: 9, padding: "10px 24px", fontSize: "0.85rem", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", boxShadow: saving ? "none" : "0 4px 14px rgba(78, 64, 248, 0.30)" }}
              >
                <i className="fas fa-save" style={{ marginRight: 6 }} />
                {saving ? t("Saving...") : t("Create Service")}
              </button>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                disabled={saving}
                style={{ border: "1.5px solid #C8D5EE", background: "linear-gradient(160deg, #FFFFFF 0%, #F0F4FF 100%)", color: "#5D54FF", borderRadius: 9, padding: "10px 20px", fontSize: "0.85rem", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}
              >
                <i className="fas fa-times" style={{ marginRight: 6 }} />
                {t("Cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
