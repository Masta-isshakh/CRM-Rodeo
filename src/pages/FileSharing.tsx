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
type DriveView = "my" | "shared" | "dept" | "org" | "starred" | "trash" | "admin";

type DirectoryUser = {
  email: string;
  fullName: string;
  departmentKey: string;
  departmentName: string;
};

type DriveAlert = {
  level: "warn" | "error" | "info";
  text: string;
};

const MAX_UPLOAD_MB = 100;
const DEFAULT_QUOTA_MB = 2048;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
const PDF_TYPE = "application/pdf";
const FOLDER_MIME = "application/x.crm.folder";

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function safeName(name: string) {
  return String(name || "file")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 140);
}

function normalizeFolderPath(path: unknown) {
  return String(path ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function parseJsonArray(raw: unknown): string[] {
  try {
    if (!raw) return [];
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.map((v) => String(v ?? "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function fileIcon(contentType: string | undefined | null, isFolder: boolean) {
  if (isFolder) return "fas fa-folder";
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
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function folderOf(row: any) {
  return normalizeFolderPath(row?.folderPath);
}

function isFolder(row: any) {
  return Boolean(row?.isFolder) || String(row?.contentType ?? "") === FOLDER_MIME;
}

function isDeleted(row: any) {
  return Boolean(row?.isDeleted);
}

function createShareToken() {
  const seed = `${Date.now()}-${Math.random()}-${Math.random()}`;
  return btoa(seed).replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);
}

export default function FileSharing({ permissions }: PageProps) {
  const { t } = useLanguage();
  const { canOption, departmentKey, isAdminGroup } = usePermissions();
  const client = useMemo(() => getDataClient(), []);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selfEmail, setSelfEmail] = useState("");
  const [selfName, setSelfName] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<DriveView>("my");
  const [currentFolder, setCurrentFolder] = useState("");
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [quotaRows, setQuotaRows] = useState<any[]>([]);
  const [versionRows, setVersionRows] = useState<any[]>([]);
  const [linkRows, setLinkRows] = useState<any[]>([]);
  const [activityRows, setActivityRows] = useState<any[]>([]);
  const [versionTargetId, setVersionTargetId] = useState("");
  const [linkTargetId, setLinkTargetId] = useState("");

  const [files, setFiles] = useState<File[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<ShareScope>("DEPARTMENT");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [newFolderName, setNewFolderName] = useState("");

  const [quotaEmail, setQuotaEmail] = useState("");
  const [quotaMb, setQuotaMb] = useState(String(DEFAULT_QUOTA_MB));
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [quotaNotes, setQuotaNotes] = useState("");
  const [shareExpiryHours, setShareExpiryHours] = useState("24");
  const [shareMaxDownloads, setShareMaxDownloads] = useState("");

  const [preview, setPreview] = useState<{ url: string; type: string; name: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const canManageAll = permissions.canUpdate && canOption("filesharing", "filesharing_manage_all", false);
  const canUpload = permissions.canCreate && canOption("filesharing", "filesharing_upload", false);
  const canShare = canOption("filesharing", "filesharing_share", false);
  const canCreateFolder = canOption("filesharing", "filesharing_folder_create", false);
  const canMove = canOption("filesharing", "filesharing_move", false);
  const canStar = canOption("filesharing", "filesharing_star", false);
  const canRestore = canOption("filesharing", "filesharing_restore", false);
  const canSoftDelete = canOption("filesharing", "filesharing_soft_delete", false);
  const canHardDelete = canOption("filesharing", "filesharing_hard_delete", false);
  const canAdminPanel = canManageAll || canOption("filesharing", "filesharing_admin_panel", false);
  const canManageQuota = canManageAll || canOption("filesharing", "filesharing_quota_manage", false);
  const canCreateShareLink = canOption("filesharing", "filesharing_share_link_create", false);
  const canRevokeShareLink = canOption("filesharing", "filesharing_share_link_revoke", false);
  const canViewVersions = canOption("filesharing", "filesharing_version_view", false);
  const canRestoreVersions = canOption("filesharing", "filesharing_version_restore", false);

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
        // activity logging is best effort
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

      const fileRes = await (client.models as any).FileShareItem.list({ limit: 3000 });
      const fileRows = (fileRes?.data ?? []) as any[];
      setRows(fileRows.sort((a, b) => String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? ""))));

      if ((client.models as any).DriveStorageQuota?.list) {
        const quotaRes = await (client.models as any).DriveStorageQuota.list({ limit: 3000 });
        setQuotaRows((quotaRes?.data ?? []) as any[]);
      } else {
        setQuotaRows([]);
      }

      if ((client.models as any).DriveFileVersion?.list) {
        const versionRes = await (client.models as any).DriveFileVersion.list({ limit: 5000 });
        setVersionRows((versionRes?.data ?? []) as any[]);
      } else {
        setVersionRows([]);
      }

      if ((client.models as any).DriveShareLink?.list) {
        const linksRes = await (client.models as any).DriveShareLink.list({ limit: 5000 });
        setLinkRows((linksRes?.data ?? []) as any[]);
      } else {
        setLinkRows([]);
      }

      const activityRes = await (client.models as any).ActivityLog.list({ limit: 5000 });
      const allActivity = (activityRes?.data ?? []) as any[];
      setActivityRows(allActivity.filter((row) => String(row?.entityType ?? "") === "FILE_SHARE"));
    } catch (error: any) {
      setStatus(error?.message || t("Failed to load drive data."));
    } finally {
      setLoading(false);
    }
  }, [client, permissions.canRead, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const quotaMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const row of quotaRows) {
      const key = normalizeEmail(row?.userEmail);
      if (key) m.set(key, row);
      if (String(row?.userEmail ?? "").trim() === "*") m.set("*", row);
    }
    return m;
  }, [quotaRows]);

  const usageByOwner = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of rows) {
      if (isDeleted(row) || isFolder(row)) continue;
      const owner = normalizeEmail(row?.ownerEmail);
      if (!owner) continue;
      const prev = m.get(owner) ?? 0;
      m.set(owner, prev + Number(row?.sizeBytes ?? 0));
    }
    return m;
  }, [rows]);

  const selfUsageBytes = usageByOwner.get(selfEmail) ?? 0;
  const selfQuotaRow = quotaMap.get(selfEmail) ?? quotaMap.get("*");
  const selfQuotaMb = Math.max(1, Number(selfQuotaRow?.quotaMb ?? DEFAULT_QUOTA_MB));
  const selfUploadBlocked = Boolean(selfQuotaRow?.uploadBlocked);

  const departments = useMemo(() => {
    const set = new Map<string, string>();
    for (const user of directory) {
      if (!user.departmentKey) continue;
      set.set(user.departmentKey, user.departmentName || user.departmentKey);
    }
    return Array.from(set.entries()).map(([key, name]) => ({ key, name }));
  }, [directory]);

  const allFolders = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (isDeleted(row)) continue;
      const folderPath = folderOf(row);
      if (folderPath) set.add(folderPath);
      if (isFolder(row)) {
        const ownFolder = normalizeFolderPath(folderOf(row) ? `${folderOf(row)}/${row.displayName}` : row.displayName);
        if (ownFolder) set.add(ownFolder);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const hasAccess = useCallback(
    (row: any) => {
      const owner = normalizeEmail(row?.ownerEmail);
      if (owner && owner === selfEmail) return true;
      if (canManageAll || isAdminGroup) return true;

      const rowScope = String(row?.visibilityScope ?? "DEPARTMENT").toUpperCase();
      const allowedUsers = parseJsonArray(row?.sharedWithUsersJson).map(normalizeEmail);
      const allowedDepartments = parseJsonArray(row?.sharedWithDepartmentsJson).map((v) => String(v).trim());
      const selfDept = String(departmentKey ?? "").trim();

      if (rowScope === "ORGANIZATION") return true;
      if (rowScope === "PRIVATE") return false;
      if (rowScope === "DEPARTMENT") return selfDept && selfDept === String(row?.ownerDepartmentKey ?? "").trim();
      if (rowScope === "SELECTED_USERS") return allowedUsers.includes(selfEmail);
      if (rowScope === "SELECTED_DEPARTMENTS") return !!selfDept && allowedDepartments.includes(selfDept);
      return false;
    },
    [selfEmail, canManageAll, isAdminGroup, departmentKey]
  );

  const rowsByView = useMemo(() => {
    return rows.filter((row) => {
      const owner = normalizeEmail(row?.ownerEmail);
      const mine = owner === selfEmail;
      const deleted = isDeleted(row);
      const accessible = hasAccess(row);

      if (view === "trash") return deleted && (mine || canManageAll || isAdminGroup);
      if (view === "admin") return canAdminPanel && (canManageAll || isAdminGroup);

      if (deleted) return false;
      if (!accessible && !mine && !canManageAll && !isAdminGroup) return false;

      const scope = String(row?.visibilityScope ?? "DEPARTMENT").toUpperCase();
      if (view === "my") return mine;
      if (view === "shared") return !mine && accessible;
      if (view === "dept") return String(row?.ownerDepartmentKey ?? "").trim() === String(departmentKey ?? "").trim();
      if (view === "org") return scope === "ORGANIZATION";
      if (view === "starred") {
        const stars = parseJsonArray(row?.starredByJson).map(normalizeEmail);
        return stars.includes(selfEmail);
      }
      return accessible;
    });
  }, [rows, view, selfEmail, hasAccess, canManageAll, isAdminGroup, canAdminPanel, departmentKey]);

  const visibleRows = useMemo(() => {
    if (view === "admin") return rowsByView;
    return rowsByView
      .filter((row) => folderOf(row) === normalizeFolderPath(currentFolder))
      .filter((row) => matchesSearchQuery([row?.displayName, row?.description, row?.ownerName, row?.ownerEmail], query));
  }, [rowsByView, view, currentFolder, query]);

  const breadcrumb = useMemo(() => {
    const chunks = normalizeFolderPath(currentFolder).split("/").filter(Boolean);
    const out: { label: string; path: string }[] = [{ label: t("Root"), path: "" }];
    let acc = "";
    for (const part of chunks) {
      acc = acc ? `${acc}/${part}` : part;
      out.push({ label: part, path: acc });
    }
    return out;
  }, [currentFolder, t]);

  const versionsByItem = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const row of versionRows) {
      const id = String(row?.fileShareItemId ?? "").trim();
      if (!id) continue;
      const bucket = map.get(id) ?? [];
      bucket.push(row);
      map.set(id, bucket);
    }
    for (const [id, list] of map.entries()) {
      map.set(id, list.sort((a, b) => Number(b?.versionNumber ?? 0) - Number(a?.versionNumber ?? 0)));
    }
    return map;
  }, [versionRows]);

  const linksByItem = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const row of linkRows) {
      const id = String(row?.fileShareItemId ?? "").trim();
      if (!id) continue;
      const bucket = map.get(id) ?? [];
      bucket.push(row);
      map.set(id, bucket);
    }
    for (const [id, list] of map.entries()) {
      map.set(id, list.sort((a, b) => String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? ""))));
    }
    return map;
  }, [linkRows]);

  const trendRows = useMemo(() => {
    const now = Date.now();
    const lookbackMs = 14 * 24 * 60 * 60 * 1000;
    const recent = activityRows.filter((row) => {
      const ts = Date.parse(String(row?.createdAt ?? ""));
      return Number.isFinite(ts) && now - ts <= lookbackMs;
    });

    const map = new Map<string, { uploads: number; downloads: number; deletes: number }>();
    for (const row of recent) {
      const message = String(row?.message ?? "");
      const actor = normalizeEmail(message.split(" ")[0]);
      if (!actor) continue;
      const prev = map.get(actor) ?? { uploads: 0, downloads: 0, deletes: 0 };
      const action = String(row?.action ?? "").toUpperCase();
      if (action.includes("UPLOAD") || action.includes("VERSION_REPLACE")) prev.uploads += 1;
      if (action.includes("DOWNLOAD")) prev.downloads += 1;
      if (action.includes("DELETE") || action.includes("SOFT_DELETE")) prev.deletes += 1;
      map.set(actor, prev);
    }

    return Array.from(map.entries())
      .map(([email, v]) => ({ email, ...v, activityScore: v.uploads * 2 + v.downloads + v.deletes }))
      .sort((a, b) => b.activityScore - a.activityScore)
      .slice(0, 10);
  }, [activityRows]);

  const adminAlerts = useMemo<DriveAlert[]>(() => {
    const alerts: DriveAlert[] = [];
    let blocked = 0;
    for (const quota of quotaRows) {
      const email = normalizeEmail(quota?.userEmail);
      if (!email || email === "*") continue;
      const usage = usageByOwner.get(email) ?? 0;
      const limitMb = Math.max(1, Number(quota?.quotaMb ?? DEFAULT_QUOTA_MB));
      const usedPct = (usage / (limitMb * 1024 * 1024)) * 100;
      if (usedPct >= 90) {
        alerts.push({ level: usedPct >= 100 ? "error" : "warn", text: `${email} is at ${Math.round(usedPct)}% of quota.` });
      }
      if (quota?.uploadBlocked) blocked += 1;
    }

    if (blocked > 0) alerts.push({ level: "info", text: `${blocked} user account(s) currently blocked from upload.` });

    const expiredLinks = linkRows.filter((l) => !l?.revokedAt && Date.parse(String(l?.expiresAt ?? "")) < Date.now()).length;
    if (expiredLinks > 0) alerts.push({ level: "warn", text: `${expiredLinks} shared link(s) are expired but not revoked.` });

    const trashCount = rows.filter((r) => isDeleted(r)).length;
    if (trashCount > 40) alerts.push({ level: "warn", text: `Trash has ${trashCount} items. Consider retention cleanup.` });

    if (!alerts.length) alerts.push({ level: "info", text: "No critical storage or sharing alerts." });
    return alerts;
  }, [quotaRows, usageByOwner, linkRows, rows]);

  const resetComposer = () => {
    setFiles([]);
    setDisplayName("");
    setDescription("");
    setScope("DEPARTMENT");
    setSelectedUsers([]);
    setSelectedDepartments([]);
    setUploadProgress({});
  };

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

  const createFolder = async () => {
    if (!canCreateFolder) {
      setStatus(t("You do not have permission to create folders."));
      return;
    }
    const clean = safeName(newFolderName).replace(/\.[^/.]+$/, "");
    if (!clean) {
      setStatus(t("Please enter a valid folder name."));
      return;
    }

    const now = new Date().toISOString();
    try {
      const ownerDeptName = directory.find((u) => u.email === selfEmail)?.departmentName || "";
      const created = await (client.models as any).FileShareItem.create({
        fileOwner: selfEmail,
        ownerEmail: selfEmail,
        ownerName: selfName || selfEmail,
        ownerDepartmentKey: departmentKey || "",
        ownerDepartmentName: ownerDeptName,
        displayName: clean,
        description: "",
        storagePath: `file-sharing/folders/${Date.now()}-${clean}.folder`,
        contentType: FOLDER_MIME,
        sizeBytes: 0,
        visibilityScope: "DEPARTMENT",
        folderPath: normalizeFolderPath(currentFolder),
        isFolder: true,
        isDeleted: false,
        sharedWithUsersJson: "[]",
        sharedWithDepartmentsJson: "[]",
        downloadCount: 0,
        createdAt: now,
        updatedAt: now,
        updatedBy: selfEmail,
      });
      await logActivity(created?.data?.id || clean, "CREATE_FOLDER", `${selfEmail} created folder ${clean}`);
      setNewFolderName("");
      await loadData();
    } catch (error: any) {
      setStatus(error?.message || t("Failed to create folder."));
    }
  };

  const uploadFile = async () => {
    if (!canUpload) {
      setStatus(t("You do not have permission to upload files."));
      return;
    }
    if (!files.length) {
      setStatus(t("Please select a file first."));
      return;
    }
    if (selfUploadBlocked) {
      setStatus(t("Your upload permission is blocked by drive administrator."));
      return;
    }

    const oversized = files.filter((f) => f.size / (1024 * 1024) > MAX_UPLOAD_MB);
    if (oversized.length) {
      setStatus(`${t("Max upload size is")} ${MAX_UPLOAD_MB}MB: ${oversized.map((f) => f.name).join(", ")}`);
      return;
    }

    const incoming = files.reduce((sum, f) => sum + f.size, 0);
    const quotaBytes = selfQuotaMb * 1024 * 1024;
    if (selfUsageBytes + incoming > quotaBytes) {
      setStatus(t("Upload exceeds your allocated storage quota."));
      return;
    }

    setSaving(true);
    setStatus("");
    const ownerDeptName = directory.find((u) => u.email === selfEmail)?.departmentName || "";
    const folderPart = normalizeFolderPath(currentFolder);

    for (const f of files) {
      const key = folderPart
        ? `file-sharing/${folderPart}/${Date.now()}-${safeName(f.name)}`
        : `file-sharing/${Date.now()}-${safeName(f.name)}`;
      setUploadProgress((prev) => ({ ...prev, [f.name]: 0 }));
      try {
        await uploadData({
          path: key,
          data: f,
          options: {
            contentType: f.type || "application/octet-stream",
            onProgress: ({ transferredBytes, totalBytes }) => {
              if (!totalBytes) return;
              setUploadProgress((prev) => ({
                ...prev,
                [f.name]: Math.round((transferredBytes / totalBytes) * 100),
              }));
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
          folderPath: folderPart,
          isFolder: false,
          isDeleted: false,
          sharedWithUsersJson: JSON.stringify(selectedUsers),
          sharedWithDepartmentsJson: JSON.stringify(selectedDepartments),
          starredByJson: "[]",
          downloadCount: 0,
          createdAt: now,
          updatedAt: now,
          updatedBy: selfEmail,
        });

        await logActivity(created?.data?.id || key, "UPLOAD", `${selfEmail} uploaded ${f.name}`);
      } catch (error: any) {
        setStatus(error?.message || `${t("Failed to upload file.")} (${f.name})`);
        setSaving(false);
        return;
      }
    }

    resetComposer();
    await loadData();
    setSaving(false);
    setStatus(t("Upload completed."));
  };

  const toggleStar = async (row: any) => {
    if (!canStar) return;
    const stars = parseJsonArray(row?.starredByJson).map(normalizeEmail);
    const next = stars.includes(selfEmail) ? stars.filter((x) => x !== selfEmail) : [...stars, selfEmail];
    await (client.models as any).FileShareItem.update({
      id: row.id,
      starredByJson: JSON.stringify(next),
      updatedAt: new Date().toISOString(),
      updatedBy: selfEmail,
    });
    await loadData();
  };

  const createVersionSnapshot = async (row: any, changeNote: string) => {
    if (isFolder(row)) return;
    const versions = versionRows
      .filter((v) => String(v?.fileShareItemId ?? "") === String(row?.id ?? ""))
      .sort((a, b) => Number(a?.versionNumber ?? 0) - Number(b?.versionNumber ?? 0));
    const lastVersion = versions.length ? versions[versions.length - 1] : null;
    const nextVersion = (lastVersion?.versionNumber ?? 0) + 1;

    await (client.models as any).DriveFileVersion.create({
      fileShareItemId: row.id,
      ownerEmail: normalizeEmail(row?.ownerEmail),
      versionNumber: nextVersion,
      storagePath: String(row?.storagePath ?? ""),
      contentType: String(row?.contentType ?? "") || undefined,
      sizeBytes: Number(row?.sizeBytes ?? 0),
      changeNote,
      createdAt: new Date().toISOString(),
      createdBy: selfEmail,
    });
  };

  const replaceWithNewVersion = async (row: any) => {
    if (!canUpload || isFolder(row)) return;
    const owner = normalizeEmail(row?.ownerEmail);
    if (owner !== selfEmail && !canManageAll && !isAdminGroup) {
      setStatus(t("You can only version your own files unless you are admin."));
      return;
    }

    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = false;
    picker.onchange = async () => {
      const file = picker.files?.[0];
      if (!file) return;
      const key = `file-sharing/${Date.now()}-${safeName(file.name)}`;
      try {
        await createVersionSnapshot(row, "Auto snapshot before replace");
        await uploadData({
          path: key,
          data: file,
          options: { contentType: file.type || "application/octet-stream" },
        }).result;

        await (client.models as any).FileShareItem.update({
          id: row.id,
          displayName: file.name,
          storagePath: key,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          updatedAt: new Date().toISOString(),
          updatedBy: selfEmail,
        });
        await logActivity(row.id, "VERSION_REPLACE", `${selfEmail} uploaded new version for ${row?.displayName}`);
        await loadData();
      } catch (error: any) {
        setStatus(error?.message || t("Failed to upload new version."));
      }
    };
    picker.click();
  };

  const restoreVersion = async (row: any, version: any) => {
    if (!canRestoreVersions && !canManageAll && !isAdminGroup) {
      setStatus(t("You do not have permission to restore versions."));
      return;
    }
    try {
      await createVersionSnapshot(row, `Snapshot before restore to v${version?.versionNumber}`);
      await (client.models as any).FileShareItem.update({
        id: row.id,
        storagePath: String(version?.storagePath ?? row?.storagePath ?? ""),
        contentType: String(version?.contentType ?? row?.contentType ?? "") || undefined,
        sizeBytes: Number(version?.sizeBytes ?? row?.sizeBytes ?? 0),
        updatedAt: new Date().toISOString(),
        updatedBy: selfEmail,
      });
      await logActivity(row.id, "VERSION_RESTORE", `${selfEmail} restored ${row?.displayName} to v${version?.versionNumber}`);
      await loadData();
    } catch (error: any) {
      setStatus(error?.message || t("Failed to restore selected version."));
    }
  };

  const createSharedLink = async (row: any) => {
    if (!canCreateShareLink) {
      setStatus(t("You do not have permission to create shared links."));
      return;
    }
    if (isFolder(row)) {
      setStatus(t("Shared links are supported for files only."));
      return;
    }

    const hours = Math.max(1, Number(shareExpiryHours || 24));
    const maxDownloads = Number(shareMaxDownloads || 0);
    const expiresAtMs = Date.now() + hours * 60 * 60 * 1000;
    const expiresAtIso = new Date(expiresAtMs).toISOString();
    const token = createShareToken();

    try {
      await (client.models as any).DriveShareLink.create({
        fileShareItemId: row.id,
        token,
        createdBy: selfEmail,
        displayName: String(row?.displayName ?? ""),
        storagePath: String(row?.storagePath ?? ""),
        expiresAt: expiresAtIso,
        maxDownloads: maxDownloads > 0 ? maxDownloads : undefined,
        downloadCount: 0,
        createdAt: new Date().toISOString(),
      });

      const expiresIn = Math.min(604800, hours * 3600);
      const urlObj = await getUrl({
        path: String(row?.storagePath ?? ""),
        options: { expiresIn },
      });
      const url = urlObj.url.toString();
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // Clipboard may be unavailable; status includes the URL.
      }

      await logActivity(row.id, "SHARE_LINK_CREATE", `${selfEmail} created expiring link for ${row?.displayName}`);
      await loadData();
      setStatus(`${t("Shared link created.")} ${url}`);
    } catch (error: any) {
      setStatus(error?.message || t("Failed to create shared link."));
    }
  };

  const revokeSharedLink = async (link: any) => {
    if (!canRevokeShareLink && !canManageAll && !isAdminGroup) {
      setStatus(t("You do not have permission to revoke shared links."));
      return;
    }
    try {
      await (client.models as any).DriveShareLink.update({
        id: link.id,
        revokedAt: new Date().toISOString(),
      });
      await logActivity(String(link?.fileShareItemId ?? link?.id ?? ""), "SHARE_LINK_REVOKE", `${selfEmail} revoked shared link`);
      await loadData();
    } catch (error: any) {
      setStatus(error?.message || t("Failed to revoke shared link."));
    }
  };

  const openPreview = async (row: any) => {
    const ct = String(row?.contentType ?? "");
    const canPreview = IMAGE_TYPES.includes(ct) || ct === PDF_TYPE;
    if (!canPreview || isFolder(row)) return;
    try {
      const out = await getUrl({ path: String(row?.storagePath ?? ""), options: { expiresIn: 300 } });
      setPreview({ url: out.url.toString(), type: ct, name: String(row?.displayName || "File") });
    } catch {
      setStatus(t("Preview is not available for this file."));
    }
  };

  const downloadFile = async (row: any) => {
    if (isFolder(row)) return;
    try {
      const out = await getUrl({ path: String(row?.storagePath ?? "") });
      window.open(out.url.toString(), "_blank", "noopener,noreferrer");
      await (client.models as any).FileShareItem.update({
        id: row.id,
        downloadCount: Number(row?.downloadCount ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: selfEmail,
      });
      await logActivity(row.id, "DOWNLOAD", `${selfEmail} downloaded ${row?.displayName || row?.storagePath}`);
      await loadData();
    } catch (error: any) {
      setStatus(error?.message || t("Failed to download file."));
    }
  };

  const moveRow = async (row: any) => {
    if (!canMove) {
      setStatus(t("You do not have permission to move files."));
      return;
    }
    const target = normalizeFolderPath(window.prompt(t("Move to folder path (empty for root):"), String(row?.folderPath ?? "")));
    try {
      await (client.models as any).FileShareItem.update({
        id: row.id,
        folderPath: target,
        updatedAt: new Date().toISOString(),
        updatedBy: selfEmail,
      });
      await logActivity(row.id, "MOVE", `${selfEmail} moved ${row?.displayName || row?.storagePath} to ${target || "root"}`);
      await loadData();
    } catch (error: any) {
      setStatus(error?.message || t("Failed to move file."));
    }
  };

  const deleteRow = async (row: any) => {
    const owner = normalizeEmail(row?.ownerEmail);
    const mine = owner === selfEmail;
    const canDeleteOwn = canOption("filesharing", "filesharing_delete_own", false) && mine;
    const canDeleteAny = canOption("filesharing", "filesharing_delete_any", false) || canManageAll;

    if (!canDeleteOwn && !canDeleteAny && !isAdminGroup) {
      setStatus(t("You do not have permission to delete this item."));
      return;
    }

    const doHardDelete = (canHardDelete || isAdminGroup) && (canManageAll || isAdminGroup) && !canSoftDelete;

    try {
      if (!doHardDelete) {
        await (client.models as any).FileShareItem.update({
          id: row.id,
          isDeleted: true,
          deletedAt: new Date().toISOString(),
          deletedBy: selfEmail,
          updatedAt: new Date().toISOString(),
          updatedBy: selfEmail,
        });
        await logActivity(row.id, "SOFT_DELETE", `${selfEmail} moved ${row?.displayName} to trash`);
      } else {
        if (!isFolder(row) && row?.storagePath) {
          await remove({ path: String(row.storagePath) });
        }
        await (client.models as any).FileShareItem.delete({ id: String(row.id) });
        await logActivity(row.id, "DELETE", `${selfEmail} permanently deleted ${row?.displayName}`);
      }
      await loadData();
    } catch (error: any) {
      setStatus(error?.message || t("Failed to delete item."));
    }
  };

  const restoreRow = async (row: any) => {
    if (!canRestore && !isAdminGroup) {
      setStatus(t("You do not have permission to restore files."));
      return;
    }
    try {
      await (client.models as any).FileShareItem.update({
        id: row.id,
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        updatedAt: new Date().toISOString(),
        updatedBy: selfEmail,
      });
      await logActivity(row.id, "RESTORE", `${selfEmail} restored ${row?.displayName}`);
      await loadData();
    } catch (error: any) {
      setStatus(error?.message || t("Failed to restore file."));
    }
  };

  const saveQuota = async (targetEmailRaw: string) => {
    if (!canManageQuota && !isAdminGroup) {
      setStatus(t("You do not have permission to manage storage quotas."));
      return;
    }

    const target = targetEmailRaw === "*" ? "*" : normalizeEmail(targetEmailRaw);
    const nextQuotaMb = Math.max(1, Number(quotaMb || DEFAULT_QUOTA_MB));
    if (!target) {
      setStatus(t("Please choose a user."));
      return;
    }

    const existing = quotaRows.find((q) => normalizeEmail(q?.userEmail) === target || (target === "*" && String(q?.userEmail) === "*"));
    const payload = {
      userEmail: target,
      quotaMb: nextQuotaMb,
      uploadBlocked: quotaBlocked,
      notes: String(quotaNotes || "").trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: selfEmail,
    };

    try {
      if (existing?.id) {
        await (client.models as any).DriveStorageQuota.update({ id: existing.id, ...payload });
      } else {
        await (client.models as any).DriveStorageQuota.create(payload);
      }
      await logActivity(target, "QUOTA", `${selfEmail} updated quota for ${target}`);
      await loadData();
      setStatus(t("Storage quota updated."));
    } catch (error: any) {
      setStatus(error?.message || t("Failed to update storage quota."));
    }
  };

  if (!permissions.canRead) {
    return <div className="filesharing-page"><div className="filesharing-empty">{t("No access")}</div></div>;
  }

  return (
    <div className="filesharing-page drive-v2">
      {preview && (
        <div className="filesharing-modal-backdrop" onClick={() => setPreview(null)}>
          <div className="filesharing-modal" onClick={(e) => e.stopPropagation()}>
            <div className="filesharing-modal-header">
              <span>{preview.name}</span>
              <button type="button" className="filesharing-modal-close" onClick={() => setPreview(null)}>x</button>
            </div>
            <div className="filesharing-modal-body">
              {IMAGE_TYPES.includes(preview.type) ? <img src={preview.url} alt={preview.name} /> : <iframe src={preview.url} title={preview.name} />}
            </div>
          </div>
        </div>
      )}

      <section className="drive-hero">
        <div>
          <h1>{t("Shared Drive Command Center")}</h1>
          <p>{t("Enterprise storage, Google Drive familiarity, and admin-level control in one unified workspace.")}</p>
        </div>
        <div className="drive-metrics">
          <div><strong>{rows.filter((r) => !isDeleted(r)).length}</strong><span>{t("Active Items")}</span></div>
          <div><strong>{formatBytes(selfUsageBytes)}</strong><span>{t("My Usage")}</span></div>
          <div><strong>{selfQuotaMb} MB</strong><span>{t("My Quota")}</span></div>
        </div>
      </section>

      <section className="drive-toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search by name, description, or owner")} />
        <button type="button" onClick={() => void loadData()} disabled={loading}>{t("Refresh")}</button>
      </section>

      <section className="drive-shell">
        <aside className="drive-sidebar">
          <button type="button" className={view === "my" ? "active" : ""} onClick={() => { setView("my"); setCurrentFolder(""); }}>{t("My Drive")}</button>
          <button type="button" className={view === "shared" ? "active" : ""} onClick={() => { setView("shared"); setCurrentFolder(""); }}>{t("Shared With Me")}</button>
          <button type="button" className={view === "dept" ? "active" : ""} onClick={() => { setView("dept"); setCurrentFolder(""); }}>{t("Department Drive")}</button>
          <button type="button" className={view === "org" ? "active" : ""} onClick={() => { setView("org"); setCurrentFolder(""); }}>{t("Organization")}</button>
          <button type="button" className={view === "starred" ? "active" : ""} onClick={() => { setView("starred"); setCurrentFolder(""); }}>{t("Starred")}</button>
          <button type="button" className={view === "trash" ? "active" : ""} onClick={() => { setView("trash"); setCurrentFolder(""); }}>{t("Trash")}</button>
          {canAdminPanel ? <button type="button" className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}>{t("Drive Admin")}</button> : null}

          {view !== "admin" ? (
            <div className="drive-folder-tree">
              <h4>{t("Folders")}</h4>
              <button type="button" className={!currentFolder ? "active" : ""} onClick={() => setCurrentFolder("")}>{t("Root")}</button>
              {allFolders.map((f) => (
                <button key={f} type="button" className={currentFolder === f ? "active" : ""} onClick={() => setCurrentFolder(f)}>{f}</button>
              ))}
            </div>
          ) : null}
        </aside>

        <div className="drive-main">
          {view !== "admin" ? (
            <>
              <div className="drive-breadcrumb">
                {breadcrumb.map((node) => (
                  <button key={node.path || "root"} type="button" onClick={() => setCurrentFolder(node.path)}>{node.label}</button>
                ))}
              </div>

              <PermissionGate moduleId="filesharing" optionId="filesharing_upload">
                <section className="filesharing-composer drive-card">
                  <div className="drive-card-title">{t("Upload and Share")}</div>
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

                  <div className="filesharing-grid">
                    {files.length === 1 ? <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t("Display name (optional)")} /> : null}
                    <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Description (optional)")} />
                    {canShare ? (
                      <select value={scope} onChange={(e) => setScope(e.target.value as ShareScope)}>
                        <option value="PRIVATE">{t("Private")}</option>
                        <option value="DEPARTMENT">{t("Department")}</option>
                        <option value="SELECTED_USERS">{t("Selected users")}</option>
                        <option value="SELECTED_DEPARTMENTS">{t("Selected departments")}</option>
                        <option value="ORGANIZATION">{t("Organization")}</option>
                      </select>
                    ) : null}
                  </div>

                  {scope === "SELECTED_USERS" && canShare ? (
                    <div className="filesharing-picks">
                      {directory.filter((u) => u.email !== selfEmail).slice(0, 100).map((u) => (
                        <label key={u.email}>
                          <input
                            type="checkbox"
                            checked={selectedUsers.includes(u.email)}
                            onChange={(e) => setSelectedUsers((prev) => e.target.checked ? [...prev, u.email] : prev.filter((x) => x !== u.email))}
                          />
                          <span>{u.fullName} ({u.email})</span>
                        </label>
                      ))}
                    </div>
                  ) : null}

                  {scope === "SELECTED_DEPARTMENTS" && canShare ? (
                    <div className="filesharing-picks">
                      {departments.map((d) => (
                        <label key={d.key}>
                          <input
                            type="checkbox"
                            checked={selectedDepartments.includes(d.key)}
                            onChange={(e) => setSelectedDepartments((prev) => e.target.checked ? [...prev, d.key] : prev.filter((x) => x !== d.key))}
                          />
                          <span>{d.name}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}

                  {files.length ? (
                    <div className="filesharing-selected-files">
                      {files.map((f, idx) => (
                        <div key={`${f.name}-${idx}`} className="filesharing-selected-file">
                          <i className={fileIcon(f.type, false)} />
                          <span className="filesharing-selected-file-name">{f.name}</span>
                          <span className="filesharing-selected-file-size">{formatBytes(f.size)}</span>
                          {uploadProgress[f.name] !== undefined ? (
                            <div className="filesharing-progress-bar"><div className="filesharing-progress-fill" style={{ width: `${uploadProgress[f.name]}%` }} /></div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="drive-inline-actions">
                    {canCreateFolder ? (
                      <>
                        <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder={t("New folder name")} />
                        <button type="button" onClick={() => void createFolder()}>{t("Create Folder")}</button>
                      </>
                    ) : null}
                    <button type="button" className="filesharing-primary" onClick={() => void uploadFile()} disabled={!files.length || saving || !canUpload}>
                      {saving ? t("Uploading...") : t("Upload")}
                    </button>
                  </div>
                </section>
              </PermissionGate>

              <section className="filesharing-list drive-card">
                <div className="drive-card-title">{t("Drive Items")} ({visibleRows.length})</div>
                {visibleRows.length === 0 ? <div className="filesharing-empty">{t("No items found")}</div> : null}

                {visibleRows.map((row) => {
                  const folder = isFolder(row);
                  const ct = String(row?.contentType ?? "");
                  const stars = parseJsonArray(row?.starredByJson).map(normalizeEmail);
                  const starred = stars.includes(selfEmail);
                  return (
                    <div key={row.id} className="filesharing-item">
                      <div className="filesharing-item-left">
                        <div className={`filesharing-file-icon ${folder ? "folder" : ct === PDF_TYPE ? "pdf" : ct.startsWith("image/") ? "image" : ""}`}>
                          <i className={fileIcon(ct, folder)} />
                        </div>
                      </div>

                      <div className="filesharing-item-main">
                        <button type="button" className="drive-name-link" onClick={() => { if (folder) setCurrentFolder(normalizeFolderPath(currentFolder ? `${currentFolder}/${row.displayName}` : row.displayName)); }}>
                          {String(row?.displayName || t("Untitled"))}
                        </button>
                        <div className="filesharing-meta">
                          {String(row?.ownerName || row?.ownerEmail || "-")} • {String(row?.ownerDepartmentName || t("No department"))} • {String(row?.visibilityScope || "DEPARTMENT")} • {formatBytes(Number(row?.sizeBytes ?? 0))}
                        </div>
                        {row?.description ? <div className="filesharing-desc">{String(row.description)}</div> : null}
                      </div>

                      <div className="filesharing-item-actions">
                        {canStar ? <button type="button" onClick={() => void toggleStar(row)} title={t("Star")}>{starred ? "★" : "☆"}</button> : null}
                        {!folder ? <PermissionGate moduleId="filesharing" optionId="filesharing_download"><button type="button" onClick={() => void downloadFile(row)}>{t("Download")}</button></PermissionGate> : null}
                        {!folder ? <PermissionGate moduleId="filesharing" optionId="filesharing_view"><button type="button" onClick={() => void openPreview(row)}>{t("Preview")}</button></PermissionGate> : null}
                        {!folder && canCreateShareLink ? <button type="button" onClick={() => void createSharedLink(row)}>{t("Create Link")}</button> : null}
                        {!folder && canCreateShareLink ? <button type="button" onClick={() => setLinkTargetId((prev) => prev === row.id ? "" : row.id)}>{t("Links")}</button> : null}
                        {!folder && canViewVersions ? <button type="button" onClick={() => setVersionTargetId((prev) => prev === row.id ? "" : row.id)}>{t("Versions")}</button> : null}
                        {!folder && canUpload ? <button type="button" onClick={() => void replaceWithNewVersion(row)}>{t("Upload New Version")}</button> : null}
                        {canMove ? <button type="button" onClick={() => void moveRow(row)}>{t("Move")}</button> : null}
                        {!isDeleted(row) ? <button type="button" className="danger" onClick={() => void deleteRow(row)}>{t("Delete")}</button> : null}
                        {view === "trash" ? <button type="button" onClick={() => void restoreRow(row)}>{t("Restore")}</button> : null}
                      </div>

                      {linkTargetId === row.id ? (
                        <div className="drive-subpanel">
                          <div className="drive-subpanel-title">{t("Shared Links")}</div>
                          <div className="drive-inline-actions">
                            <input value={shareExpiryHours} onChange={(e) => setShareExpiryHours(e.target.value)} placeholder={t("Expiry hours")} />
                            <input value={shareMaxDownloads} onChange={(e) => setShareMaxDownloads(e.target.value)} placeholder={t("Max downloads (optional)")} />
                            <button type="button" onClick={() => void createSharedLink(row)}>{t("Generate")}</button>
                          </div>
                          {(linksByItem.get(String(row.id)) ?? []).slice(0, 6).map((link) => {
                            const expired = Date.parse(String(link?.expiresAt ?? "")) < Date.now();
                            const revoked = Boolean(link?.revokedAt);
                            return (
                              <div key={link.id} className="drive-link-row">
                                <div>
                                  <strong>{revoked ? t("Revoked") : expired ? t("Expired") : t("Active")}</strong>
                                  <span>{t("Expires")}: {String(link?.expiresAt ?? "-")}</span>
                                </div>
                                <div className="drive-inline-actions">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        const hoursLeft = Math.max(1, Math.ceil((Date.parse(String(link?.expiresAt ?? "")) - Date.now()) / 3600000));
                                        const out = await getUrl({ path: String(row?.storagePath ?? ""), options: { expiresIn: Math.min(604800, hoursLeft * 3600) } });
                                        const linkUrl = out.url.toString();
                                        try { await navigator.clipboard.writeText(linkUrl); } catch {}
                                        setStatus(`${t("Link copied")}: ${linkUrl}`);
                                      } catch {
                                        setStatus(t("Unable to regenerate signed link for this entry."));
                                      }
                                    }}
                                  >
                                    {t("Copy")}
                                  </button>
                                  {!revoked && (canRevokeShareLink || canManageAll || isAdminGroup) ? (
                                    <button type="button" className="danger" onClick={() => void revokeSharedLink(link)}>{t("Revoke")}</button>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      {versionTargetId === row.id ? (
                        <div className="drive-subpanel">
                          <div className="drive-subpanel-title">{t("Version History")}</div>
                          {(versionsByItem.get(String(row.id)) ?? []).slice(0, 10).map((v) => (
                            <div key={v.id} className="drive-version-row">
                              <div>
                                <strong>v{v.versionNumber}</strong>
                                <span>{String(v?.createdAt ?? "-")} • {formatBytes(Number(v?.sizeBytes ?? 0))}</span>
                              </div>
                              {canRestoreVersions || canManageAll || isAdminGroup ? (
                                <button type="button" onClick={() => void restoreVersion(row, v)}>{t("Restore")}</button>
                              ) : null}
                            </div>
                          ))}
                          {!(versionsByItem.get(String(row.id)) ?? []).length ? <div className="filesharing-empty">{t("No saved versions yet")}</div> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            </>
          ) : null}

          {view === "admin" && canAdminPanel ? (
            <section className="drive-card drive-admin-grid">
              <div>
                <div className="drive-card-title">{t("Storage Governance")}</div>
                <div className="drive-inline-actions">
                  <select value={quotaEmail} onChange={(e) => setQuotaEmail(e.target.value)}>
                    <option value="">{t("Select user")}</option>
                    {directory.map((u) => <option key={u.email} value={u.email}>{u.fullName} ({u.email})</option>)}
                  </select>
                  <input value={quotaMb} onChange={(e) => setQuotaMb(e.target.value)} placeholder={t("Quota MB")} />
                </div>
                <div className="drive-inline-actions">
                  <label><input type="checkbox" checked={quotaBlocked} onChange={(e) => setQuotaBlocked(e.target.checked)} /> {t("Block uploads")}</label>
                  <input value={quotaNotes} onChange={(e) => setQuotaNotes(e.target.value)} placeholder={t("Admin notes")}/>
                </div>
                <div className="drive-inline-actions">
                  <button type="button" onClick={() => void saveQuota(quotaEmail)} disabled={!canManageQuota}>{t("Save User Quota")}</button>
                  <button type="button" onClick={() => void saveQuota("*")} disabled={!canManageQuota}>{t("Save Default Quota")}</button>
                </div>
              </div>

              <div>
                <div className="drive-card-title">{t("Usage Matrix")}</div>
                <div className="drive-usage-list">
                  {directory.map((u) => {
                    const usage = usageByOwner.get(u.email) ?? 0;
                    const q = quotaMap.get(u.email) ?? quotaMap.get("*");
                    const userQuotaMb = Number(q?.quotaMb ?? DEFAULT_QUOTA_MB);
                    const usedPct = Math.min(100, Math.round((usage / (userQuotaMb * 1024 * 1024)) * 100));
                    return (
                      <div key={u.email} className="drive-usage-row">
                        <div>
                          <strong>{u.fullName}</strong>
                          <span>{u.email}</span>
                        </div>
                        <div>{formatBytes(usage)} / {userQuotaMb} MB</div>
                        <div className="drive-usage-bar"><span style={{ width: `${usedPct}%` }} /></div>
                      </div>
                    );
                  })}
                </div>

                <div className="drive-card-title drive-top-gap">{t("Usage Trends (14 Days)")}</div>
                <div className="drive-trend-list">
                  {trendRows.map((row) => (
                    <div key={row.email} className="drive-trend-row">
                      <div>{row.email}</div>
                      <div>{t("Uploads")}: {row.uploads}</div>
                      <div>{t("Downloads")}: {row.downloads}</div>
                      <div>{t("Deletes")}: {row.deletes}</div>
                    </div>
                  ))}
                  {!trendRows.length ? <div className="filesharing-empty">{t("No file activity in the last 14 days")}</div> : null}
                </div>

                <div className="drive-card-title drive-top-gap">{t("Alert Center")}</div>
                <div className="drive-alert-list">
                  {adminAlerts.map((a, idx) => (
                    <div key={`${a.level}-${idx}`} className={`drive-alert ${a.level}`}>
                      {a.text}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </section>

      {status ? <div className="filesharing-status">{status}</div> : null}
    </div>
  );
}
