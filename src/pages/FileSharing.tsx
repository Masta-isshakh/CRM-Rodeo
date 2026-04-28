import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentUser } from "aws-amplify/auth";
import { getUrl, remove, uploadData } from "aws-amplify/storage";
import type { PageProps } from "../lib/PageProps";
import { getDataClient } from "../lib/amplifyClient";
import { matchesSearchQuery } from "../lib/searchUtils";
import { useLanguage } from "../i18n/LanguageContext";
import { usePermissions } from "../lib/userPermissions";
import PermissionGate from "./PermissionGate";
import "./FileSharing.css";

type ShareScope = "PRIVATE" | "DEPARTMENT" | "SELECTED_USERS" | "SELECTED_DEPARTMENTS" | "ORGANIZATION";

type DirectoryUser = {
  email: string;
  fullName: string;
  departmentKey: string;
  departmentName: string;
};

const MAX_UPLOAD_MB = 100;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
const PDF_TYPE = "application/pdf";

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function safeName(name: string) {
  return String(name || "file")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 140);
}

function safeJsonArray(raw: unknown): string[] {
  try {
    if (!raw) return [];
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.map((v) => String(v ?? "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function fileIcon(contentType: string | undefined | null) {
  const ct = String(contentType ?? "");
  if (IMAGE_TYPES.includes(ct)) return "fas fa-image";
  if (ct === PDF_TYPE) return "fas fa-file-pdf";
  if (ct.startsWith("video/")) return "fas fa-file-video";
  if (ct.startsWith("audio/")) return "fas fa-file-audio";
  if (ct.includes("spreadsheet") || ct.includes("excel")) return "fas fa-file-excel";
  if (ct.includes("word")) return "fas fa-file-word";
  if (ct.includes("zip") || ct.includes("compressed")) return "fas fa-file-zipper";
  return "fas fa-file";
}

function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileSharing({ permissions }: PageProps) {
  const { t } = useLanguage();
  const { canOption, departmentKey } = usePermissions();
  const client = useMemo(() => getDataClient(), []);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selfEmail, setSelfEmail] = useState("");
  const [selfName, setSelfName] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [rows, setRows] = useState<any[]>([]);

  // Batch files
  const [files, setFiles] = useState<File[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<ShareScope>("DEPARTMENT");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);

  // Drag-drop
  const [dragging, setDragging] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // Preview modal
  const [preview, setPreview] = useState<{ url: string; type: string; name: string } | null>(null);

  const canManageAll = permissions.canUpdate && canOption("filesharing", "filesharing_manage_all", false);

  const logActivity = useCallback(
    async (entityId: string, action: string, message: string) => {
      try {
        await (client.models as any).ActivityLog.create({
          entityType: "FILE_SHARE",
          entityId,
          action,
          message,
          createdAt: new Date().toISOString(),
        });
      } catch {
        // activity logging is best-effort
      }
    },
    [client]
  );

  const loadData = useCallback(async () => {
    if (!permissions.canRead) return;
    setLoading(true);
    setStatus("");

    try {
      const auth = await getCurrentUser();
      const email = normalizeEmail(auth?.signInDetails?.loginId ?? auth?.username ?? "");
      setSelfEmail(email);

      const userRes = await (client.models as any).UserProfile.list({ limit: 2000 });
      const users = ((userRes?.data ?? []) as any[])
        .map((u) => ({
          email: normalizeEmail(u?.email),
          fullName: String(u?.fullName ?? u?.email ?? "").trim(),
          departmentKey: String(u?.departmentKey ?? "").trim(),
          departmentName: String(u?.departmentName ?? "").trim(),
        }))
        .filter((u) => !!u.email)
        .sort((a, b) => a.fullName.localeCompare(b.fullName));

      setDirectory(users);
      const me = users.find((u) => u.email === email);
      setSelfName(me?.fullName || email || t("You"));

      const fileRes = await (client.models as any).FileShareItem.list({ limit: 2000 });
      const fileRows = (fileRes?.data ?? []) as any[];
      setRows(fileRows.sort((a, b) => String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? ""))));
    } catch (error: any) {
      setStatus(error?.message || t("Failed to load file sharing data."));
    } finally {
      setLoading(false);
    }
  }, [client, permissions.canRead, t]);

  // Drag-drop handlers
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!dropRef.current?.contains(e.relatedTarget as Node)) setDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) => f.size / (1024 * 1024) <= MAX_UPLOAD_MB);
    if (dropped.length) setFiles((prev) => [...prev, ...dropped]);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const departments = useMemo(() => {
    const set = new Map<string, string>();
    for (const user of directory) {
      if (!user.departmentKey) continue;
      set.set(user.departmentKey, user.departmentName || user.departmentKey);
    }
    return Array.from(set.entries()).map(([key, name]) => ({ key, name }));
  }, [directory]);

  const visibleRows = useMemo(() => {
    const selfDept = String(departmentKey ?? "").trim();

    const canAccess = (row: any) => {
      const owner = normalizeEmail(row?.ownerEmail);
      if (owner && owner === selfEmail) return true;
      if (canManageAll) return true;

      const rowScope = String(row?.visibilityScope ?? "DEPARTMENT").toUpperCase();
      const allowedUsers = safeJsonArray(row?.sharedWithUsersJson).map(normalizeEmail);
      const allowedDepartments = safeJsonArray(row?.sharedWithDepartmentsJson);

      if (rowScope === "ORGANIZATION") return true;
      if (rowScope === "PRIVATE") return false;
      if (rowScope === "DEPARTMENT") return selfDept && selfDept === String(row?.ownerDepartmentKey ?? "").trim();
      if (rowScope === "SELECTED_USERS") return allowedUsers.includes(selfEmail);
      if (rowScope === "SELECTED_DEPARTMENTS") return !!selfDept && allowedDepartments.includes(selfDept);
      return false;
    };

    return rows
      .filter(canAccess)
      .filter((row) =>
        matchesSearchQuery(
          [row?.displayName, row?.description, row?.ownerName, row?.ownerEmail, row?.ownerDepartmentName],
          query
        )
      );
  }, [rows, query, selfEmail, departmentKey, canManageAll]);

  const resetComposer = () => {
    setFiles([]);
    setDisplayName("");
    setDescription("");
    setScope("DEPARTMENT");
    setSelectedUsers([]);
    setSelectedDepartments([]);
    setUploadProgress({});
  };

  const uploadFile = async () => {
    if (!files.length) {
      setStatus(t("Please select a file first."));
      return;
    }

    const oversized = files.filter((f) => f.size / (1024 * 1024) > MAX_UPLOAD_MB);
    if (oversized.length) {
      setStatus(`${t("Max upload size is")} ${MAX_UPLOAD_MB}MB: ${oversized.map((f) => f.name).join(", ")}`);
      return;
    }

    setSaving(true);
    setStatus("");
    const ownerDeptName = directory.find((u) => u.email === selfEmail)?.departmentName || "";

    for (const f of files) {
      const key = `file-sharing/${Date.now()}-${safeName(f.name)}`;
      setUploadProgress((prev) => ({ ...prev, [f.name]: 0 }));
      try {
        await uploadData({
          path: key,
          data: f,
          options: {
            contentType: f.type || "application/octet-stream",
            onProgress: ({ transferredBytes, totalBytes }) => {
              if (totalBytes) {
                setUploadProgress((prev) => ({
                  ...prev,
                  [f.name]: Math.round((transferredBytes / totalBytes) * 100),
                }));
              }
            },
          },
        }).result;

        const now = new Date().toISOString();
        const created = await (client.models as any).FileShareItem.create({
          fileOwner: selfEmail,
          ownerEmail: selfEmail,
          ownerName: selfName || selfEmail,
          ownerDepartmentKey: departmentKey || "",
          ownerDepartmentName: ownerDeptName,
          displayName: String(files.length === 1 && displayName ? displayName : f.name).trim(),
          description: String(description || "").trim(),
          storagePath: key,
          contentType: f.type || "application/octet-stream",
          sizeBytes: f.size,
          visibilityScope: scope,
          sharedWithUsersJson: JSON.stringify(selectedUsers),
          sharedWithDepartmentsJson: JSON.stringify(selectedDepartments),
          downloadCount: 0,
          createdAt: now,
          updatedAt: now,
          updatedBy: selfEmail,
        });

        await logActivity(
          created?.data?.id || key,
          "UPLOAD",
          `${selfEmail} uploaded "${f.name}" with scope ${scope}`
        );
      } catch (err: any) {
        setStatus(err?.message || `${t("Failed to upload file.")} (${f.name})`);
        setSaving(false);
        return;
      }
    }

    resetComposer();
    await loadData();
    setStatus(t("File uploaded and shared successfully."));
    setSaving(false);
  };

  const openPreview = async (row: any) => {
    try {
      const ct = String(row?.contentType ?? "");
      const canPreview = IMAGE_TYPES.includes(ct) || ct === PDF_TYPE;
      if (!canPreview) return;
      const out = await getUrl({ path: String(row?.storagePath ?? ""), options: { expiresIn: 300 } });
      setPreview({ url: out.url.toString(), type: ct, name: String(row?.displayName || row?.storagePath || "File") });
    } catch {
      // silently ignore preview errors
    }
  };

  const downloadFile = async (row: any) => {
    try {
      const out = await getUrl({ path: String(row?.storagePath ?? "") });
      window.open(out.url.toString(), "_blank", "noopener,noreferrer");

      const currentCount = Number(row?.downloadCount ?? 0);
      await (client.models as any).FileShareItem.update({
        id: row.id,
        downloadCount: Number.isFinite(currentCount) ? currentCount + 1 : 1,
        updatedAt: new Date().toISOString(),
        updatedBy: selfEmail,
      });

      await logActivity(
        row.id,
        "DOWNLOAD",
        `${selfEmail} downloaded "${row?.displayName || row?.storagePath}"`
      );
    } catch (error: any) {
      setStatus(error?.message || t("Failed to download file."));
    }
  };

  const deleteFile = async (row: any) => {
    const owner = normalizeEmail(row?.ownerEmail);
    const canDeleteOwn = canOption("filesharing", "filesharing_delete_own", false) && owner === selfEmail;
    const canDeleteAny = canOption("filesharing", "filesharing_delete_any", false);

    if (!canDeleteOwn && !canDeleteAny) {
      setStatus(t("You do not have permission to delete this file."));
      return;
    }

    if (!window.confirm(t("Delete this file permanently?"))) return;

    try {
      if (row?.storagePath) {
        await remove({ path: String(row.storagePath) });
      }
      await (client.models as any).FileShareItem.delete({ id: String(row.id) });
      await logActivity(
        row.id,
        "DELETE",
        `${selfEmail} deleted "${row?.displayName || row?.storagePath}"`
      );
      await loadData();
      setStatus(t("File deleted."));
    } catch (error: any) {
      setStatus(error?.message || t("Failed to delete file."));
    }
  };

  if (!permissions.canRead) {
    return <div className="filesharing-page"><div className="filesharing-empty">{t("No access")}</div></div>;
  }

  const previewableTypes = [...IMAGE_TYPES, PDF_TYPE];

  return (
    <div className="filesharing-page">
      {/* Preview Modal */}
      {preview && (
        <div className="filesharing-modal-backdrop" onClick={() => setPreview(null)}>
          <div className="filesharing-modal" onClick={(e) => e.stopPropagation()}>
            <div className="filesharing-modal-header">
              <span>{preview.name}</span>
              <button type="button" className="filesharing-modal-close" onClick={() => setPreview(null)}>✕</button>
            </div>
            <div className="filesharing-modal-body">
              {IMAGE_TYPES.includes(preview.type) ? (
                <img src={preview.url} alt={preview.name} />
              ) : (
                <iframe src={preview.url} title={preview.name} />
              )}
            </div>
          </div>
        </div>
      )}

      <div className="filesharing-hero">
        <h1>{t("File Sharing")}</h1>
        <p>{t("Share files securely with your team, departments, or the whole organization in one click.")}</p>
      </div>

      <div className="filesharing-toolbar">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search files, owner, or department")}
        />
        <button type="button" onClick={() => void loadData()} disabled={loading}>{t("Refresh")}</button>
      </div>

      <PermissionGate moduleId="filesharing" optionId="filesharing_upload">
        <section className="filesharing-composer">
          <h2>{t("Upload and Share")}</h2>

          {/* Drag-drop zone */}
          <div
            ref={dropRef}
            className={`filesharing-dropzone${dragging ? " dragging" : ""}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => document.getElementById("fs-file-input")?.click()}
          >
            <i className="fas fa-cloud-arrow-up" />
            <span>{t("Drop files here or click to browse")}</span>
            <span className="filesharing-dropzone-sub">{t("Max")} {MAX_UPLOAD_MB}MB {t("per file")}</span>
          </div>
          <input
            id="fs-file-input"
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) setFiles((prev) => [...prev, ...picked]);
              e.target.value = "";
            }}
          />

          {/* Selected files list */}
          {files.length > 0 && (
            <div className="filesharing-selected-files">
              {files.map((f, idx) => (
                <div key={`${f.name}-${idx}`} className="filesharing-selected-file">
                  <i className={fileIcon(f.type)} />
                  <span className="filesharing-selected-file-name">{f.name}</span>
                  <span className="filesharing-selected-file-size">{formatBytes(f.size)}</span>
                  {uploadProgress[f.name] !== undefined && (
                    <div className="filesharing-progress-bar">
                      <div className="filesharing-progress-fill" style={{ width: `${uploadProgress[f.name]}%` }} />
                    </div>
                  )}
                  <button
                    type="button"
                    className="filesharing-remove-file"
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="filesharing-grid">
            {files.length === 1 && (
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t("Display name (optional)")} />
            )}
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Description (optional)")} />

            <PermissionGate moduleId="filesharing" optionId="filesharing_share">
              <select value={scope} onChange={(e) => setScope(e.target.value as ShareScope)}>
                <option value="PRIVATE">{t("Private (only me)")}</option>
                <option value="DEPARTMENT">{t("My department")}</option>
                <option value="SELECTED_USERS">{t("Selected users")}</option>
                <option value="SELECTED_DEPARTMENTS">{t("Selected departments")}</option>
                <option value="ORGANIZATION">{t("Organization-wide")}</option>
              </select>
            </PermissionGate>
          </div>

          {scope === "SELECTED_USERS" && (
            <PermissionGate moduleId="filesharing" optionId="filesharing_share">
              <div className="filesharing-picks">
                {directory
                  .filter((u) => u.email !== selfEmail)
                  .filter((u) => canOption("filesharing", "filesharing_cross_department", false) || u.departmentKey === departmentKey)
                  .slice(0, 80)
                  .map((u) => {
                    const checked = selectedUsers.includes(u.email);
                    return (
                      <label key={u.email}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setSelectedUsers((prev) =>
                              e.target.checked ? [...prev, u.email] : prev.filter((x) => x !== u.email)
                            );
                          }}
                        />
                        <span>{u.fullName} ({u.email})</span>
                      </label>
                    );
                  })}
              </div>
            </PermissionGate>
          )}

          {scope === "SELECTED_DEPARTMENTS" && (
            <PermissionGate moduleId="filesharing" optionId="filesharing_share">
              <div className="filesharing-picks">
                {departments
                  .filter((d) => canOption("filesharing", "filesharing_cross_department", false) || d.key === departmentKey)
                  .map((d) => {
                    const checked = selectedDepartments.includes(d.key);
                    return (
                      <label key={d.key}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setSelectedDepartments((prev) =>
                              e.target.checked ? [...prev, d.key] : prev.filter((x) => x !== d.key)
                            );
                          }}
                        />
                        <span>{d.name}</span>
                      </label>
                    );
                  })}
              </div>
            </PermissionGate>
          )}

          <button type="button" className="filesharing-primary" onClick={() => void uploadFile()} disabled={saving || !files.length}>
            {saving ? t("Uploading...") : files.length > 1 ? `${t("Upload")} ${files.length} ${t("files")}` : t("Upload Now")}
          </button>
        </section>
      </PermissionGate>

      <section className="filesharing-list">
        <h2>{t("Shared Files")} ({visibleRows.length})</h2>
        {visibleRows.length === 0 ? <div className="filesharing-empty">{t("No files found.")}</div> : null}

        {visibleRows.map((row) => {
          const owner = normalizeEmail(row?.ownerEmail);
          const mine = owner === selfEmail;
          const ct = String(row?.contentType ?? "");
          const canPreview = previewableTypes.includes(ct);
          return (
            <div key={row.id} className="filesharing-item">
              <div className="filesharing-item-left">
                <div className={`filesharing-file-icon ${ct === PDF_TYPE ? "pdf" : ct.startsWith("image/") ? "image" : ""}`}>
                  <i className={fileIcon(ct)} />
                </div>
              </div>
              <div className="filesharing-item-main">
                <div className="filesharing-name">{String(row?.displayName || t("Untitled file"))}</div>
                <div className="filesharing-meta">
                  {String(row?.ownerName || row?.ownerEmail || "—")} • {String(row?.ownerDepartmentName || t("No department"))} • {String(row?.visibilityScope || "DEPARTMENT")} {row?.sizeBytes ? `• ${formatBytes(row.sizeBytes)}` : ""} {row?.downloadCount ? `• ↓${row.downloadCount}` : ""}
                </div>
                {row?.description ? <div className="filesharing-desc">{String(row.description)}</div> : null}
              </div>

              <div className="filesharing-item-actions">
                {canPreview && (
                  <PermissionGate moduleId="filesharing" optionId="filesharing_view">
                    <button type="button" className="filesharing-preview-btn" onClick={() => void openPreview(row)} title={t("Preview")}>
                      <i className="fas fa-eye" />
                    </button>
                  </PermissionGate>
                )}

                <PermissionGate moduleId="filesharing" optionId="filesharing_download">
                  <button type="button" onClick={() => void downloadFile(row)}>{t("Download")}</button>
                </PermissionGate>

                <PermissionGate moduleId="filesharing" optionId="filesharing_delete_own">
                  {(mine || canOption("filesharing", "filesharing_delete_any", false)) ? (
                    <button type="button" className="danger" onClick={() => void deleteFile(row)}>{t("Delete")}</button>
                  ) : null}
                </PermissionGate>
              </div>
            </div>
          );
        })}
      </section>

      {status ? <div className="filesharing-status">{status}</div> : null}
    </div>
  );
}
