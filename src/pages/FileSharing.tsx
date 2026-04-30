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
type DriveView = "home" | "my" | "shared" | "dept" | "org" | "starred" | "recent" | "trash" | "admin";
type LayoutMode = "list" | "grid";
type SortBy = "name" | "modified" | "size";

type UploadQueueItem = {
  id: string;
  file: File;
  relativePath: string;
  source: "files" | "folder";
};

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
const DRIVE_SHARE_RESOLVER_URL = String(import.meta.env.VITE_DRIVE_SHARE_RESOLVER_URL ?? "").trim();

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

function getFileRelativePath(file: File) {
  const candidate = String((file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "").trim();
  return candidate || file.name;
}

function createUploadQueueItems(fileList: Iterable<File> | ArrayLike<File>, source: "files" | "folder") {
  return Array.from(fileList).map((file) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    relativePath: source === "folder" ? getFileRelativePath(file) : file.name,
    source,
  }));
}

function getRelativeDirectory(relativePath: string) {
  const clean = normalizeFolderPath(relativePath);
  const parts = clean.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
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
  const [view, setView] = useState<DriveView>("home");
  const [layout, setLayout] = useState<LayoutMode>("list");
  const [sortBy, setSortBy] = useState<SortBy>("modified");
  const [currentFolder, setCurrentFolder] = useState("");
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [composerMode, setComposerMode] = useState<"upload" | "folder" | null>(null);
  const [isNewMenuOpen, setIsNewMenuOpen] = useState(false);
  const [pendingFileDialog, setPendingFileDialog] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastSelectedId, setLastSelectedId] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ rowId: string; x: number; y: number } | null>(null);

  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [quotaRows, setQuotaRows] = useState<any[]>([]);
  const [versionRows, setVersionRows] = useState<any[]>([]);
  const [linkRows, setLinkRows] = useState<any[]>([]);
  const [activityRows, setActivityRows] = useState<any[]>([]);
  const [versionTargetId, setVersionTargetId] = useState("");
  const [linkTargetId, setLinkTargetId] = useState("");

  const [files, setFiles] = useState<UploadQueueItem[]>([]);
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
  const uploadInputRef = useRef<HTMLInputElement>(null);

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
        // best effort
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
      setRows(fileRows.sort((a, b) => String(b?.updatedAt ?? b?.createdAt ?? "").localeCompare(String(a?.updatedAt ?? a?.createdAt ?? ""))));

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

  useEffect(() => {
    if (!pendingFileDialog || composerMode !== "upload") return;
    uploadInputRef.current?.click();
    setPendingFileDialog(false);
  }, [pendingFileDialog, composerMode]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, []);

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
      m.set(owner, (m.get(owner) ?? 0) + Number(row?.sizeBytes ?? 0));
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
      if (view === "home") return !deleted && accessible;

      if (deleted) return false;
      if (!accessible && !mine && !canManageAll && !isAdminGroup) return false;

      const scopeValue = String(row?.visibilityScope ?? "DEPARTMENT").toUpperCase();
      if (view === "my") return mine;
      if (view === "shared") return !mine && accessible;
      if (view === "dept") return String(row?.ownerDepartmentKey ?? "").trim() === String(departmentKey ?? "").trim();
      if (view === "org") return scopeValue === "ORGANIZATION";
      if (view === "starred") return parseJsonArray(row?.starredByJson).map(normalizeEmail).includes(selfEmail);
      if (view === "recent") {
        const ts = Date.parse(String(row?.updatedAt ?? row?.createdAt ?? ""));
        return Number.isFinite(ts) && Date.now() - ts <= 30 * 24 * 60 * 60 * 1000;
      }
      return accessible;
    });
  }, [rows, view, selfEmail, hasAccess, canManageAll, isAdminGroup, canAdminPanel, departmentKey]);

  const visibleRows = useMemo(() => {
    const withFolder = view === "admin" || view === "home" || view === "shared" || view === "recent" || view === "starred"
      ? rowsByView
      : rowsByView.filter((row) => folderOf(row) === normalizeFolderPath(currentFolder));

    const searched = withFolder.filter((row) => matchesSearchQuery([row?.displayName, row?.description, row?.ownerName, row?.ownerEmail], query));

    return searched.sort((a, b) => {
      if (sortBy === "name") return String(a?.displayName ?? "").localeCompare(String(b?.displayName ?? ""));
      if (sortBy === "size") return Number(b?.sizeBytes ?? 0) - Number(a?.sizeBytes ?? 0);
      return String(b?.updatedAt ?? b?.createdAt ?? "").localeCompare(String(a?.updatedAt ?? a?.createdAt ?? ""));
    });
  }, [rowsByView, view, currentFolder, query, sortBy]);

  const rowById = useMemo(() => {
    const m = new Map<string, any>();
    for (const row of rows) {
      if (row?.id) m.set(String(row.id), row);
    }
    return m;
  }, [rows]);

  const selectedRows = useMemo(
    () => selectedIds.map((id) => rowById.get(id)).filter(Boolean),
    [selectedIds, rowById]
  );

  useEffect(() => {
    const liveIds = new Set(rows.map((row) => String(row?.id ?? "")).filter(Boolean));
    setSelectedIds((prev) => prev.filter((id) => liveIds.has(id)));
    setLastSelectedId((prev) => (liveIds.has(prev) ? prev : ""));
    if (renamingId && !liveIds.has(renamingId)) {
      setRenamingId("");
      setRenameValue("");
    }
  }, [rows, renamingId]);

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
      if (usedPct >= 90) alerts.push({ level: usedPct >= 100 ? "error" : "warn", text: `${email} is at ${Math.round(usedPct)}% of quota.` });
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

  const homeFolderRows = useMemo(() => rowsByView.filter((row) => isFolder(row)).slice(0, 6), [rowsByView]);
  const homeFileRows = useMemo(() => rowsByView.filter((row) => !isFolder(row)).slice(0, 8), [rowsByView]);

  const resetComposer = () => {
    setFiles([]);
    setDisplayName("");
    setDescription("");
    setScope("DEPARTMENT");
    setSelectedUsers([]);
    setSelectedDepartments([]);
    setUploadProgress({});
    setComposerMode(null);
    setIsNewMenuOpen(false);
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
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) {
      setComposerMode("upload");
      setFiles((prev) => [...prev, ...createUploadQueueItems(dropped, "files")]);
    }
  }, []);

  const openUploadPicker = () => {
    if (!canUpload) return setStatus(t("You do not have permission to upload files."));
    setComposerMode("upload");
    setIsNewMenuOpen(false);
    setPendingFileDialog(true);
  };

  const openFolderPicker = () => {
    if (!canUpload) return setStatus(t("You do not have permission to upload files."));
    setComposerMode("upload");
    setIsNewMenuOpen(false);
    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = true;
    picker.setAttribute("webkitdirectory", "");
    picker.onchange = () => {
      const picked = Array.from(picker.files ?? []);
      if (picked.length) setFiles((prev) => [...prev, ...createUploadQueueItems(picked, "folder")]);
    };
    picker.click();
  };

  const openNewFolderComposer = () => {
    if (!canCreateFolder) return setStatus(t("You do not have permission to create folders."));
    setComposerMode("folder");
    setIsNewMenuOpen(false);
  };

  const createFolder = async () => {
    if (!canCreateFolder) return setStatus(t("You do not have permission to create folders."));
    const clean = safeName(newFolderName).replace(/\.[^/.]+$/, "");
    if (!clean) return setStatus(t("Please enter a valid folder name."));

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
    if (!canUpload) return setStatus(t("You do not have permission to upload files."));
    if (!files.length) return setStatus(t("Please select a file first."));
    if (selfUploadBlocked) return setStatus(t("Your upload permission is blocked by drive administrator."));

    const oversized = files.filter((entry) => entry.file.size / (1024 * 1024) > MAX_UPLOAD_MB);
    if (oversized.length) return setStatus(`${t("Max upload size is")} ${MAX_UPLOAD_MB}MB: ${oversized.map((entry) => entry.file.name).join(", ")}`);

    const incoming = files.reduce((sum, entry) => sum + entry.file.size, 0);
    const quotaBytes = selfQuotaMb * 1024 * 1024;
    if (selfUsageBytes + incoming > quotaBytes) return setStatus(t("Upload exceeds your allocated storage quota."));

    setSaving(true);
    setStatus("");
    const ownerDeptName = directory.find((u) => u.email === selfEmail)?.departmentName || "";
    const folderPart = normalizeFolderPath(currentFolder);

    for (const entry of files) {
      const f = entry.file;
      const relativeDirectory = getRelativeDirectory(entry.relativePath);
      const targetFolder = normalizeFolderPath([folderPart, relativeDirectory].filter(Boolean).join("/"));
      const key = targetFolder ? `file-sharing/${targetFolder}/${Date.now()}-${safeName(f.name)}` : `file-sharing/${Date.now()}-${safeName(f.name)}`;
      setUploadProgress((prev) => ({ ...prev, [entry.id]: 0 }));
      try {
        await uploadData({
          path: key,
          data: f,
          options: {
            contentType: f.type || "application/octet-stream",
            onProgress: ({ transferredBytes, totalBytes }) => {
              if (!totalBytes) return;
              setUploadProgress((prev) => ({ ...prev, [entry.id]: Math.round((transferredBytes / totalBytes) * 100) }));
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
          displayName: String(files.length === 1 && !relativeDirectory && displayName ? displayName : f.name).trim(),
          description: String(description || "").trim(),
          storagePath: key,
          contentType: f.type || "application/octet-stream",
          sizeBytes: f.size,
          visibilityScope: scope,
          folderPath: targetFolder,
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

  const createTemplateDocument = async (kind: "doc" | "sheet" | "slides") => {
    if (!canUpload) return setStatus(t("You do not have permission to upload files."));
    if (selfUploadBlocked) return setStatus(t("Your upload permission is blocked by drive administrator."));

    const map = {
      doc: {
        name: `Untitled Document ${new Date().toISOString().slice(0, 10)}.txt`,
        contentType: "text/plain",
        body: "Untitled document\n\nStart writing here...\n",
      },
      sheet: {
        name: `Untitled Sheet ${new Date().toISOString().slice(0, 10)}.csv`,
        contentType: "text/csv",
        body: "Column A,Column B,Column C\n",
      },
      slides: {
        name: `Untitled Slides ${new Date().toISOString().slice(0, 10)}.txt`,
        contentType: "text/plain",
        body: "Untitled presentation\n\n- Slide 1\n",
      },
    } as const;

    const template = map[kind];
    const blob = new Blob([template.body], { type: template.contentType });
    const folderPart = normalizeFolderPath(currentFolder);
    const key = folderPart ? `file-sharing/${folderPart}/${Date.now()}-${safeName(template.name)}` : `file-sharing/${Date.now()}-${safeName(template.name)}`;

    try {
      const ownerDeptName = directory.find((u) => u.email === selfEmail)?.departmentName || "";
      await uploadData({ path: key, data: blob, options: { contentType: template.contentType } }).result;
      const now = new Date().toISOString();
      await (client.models as any).FileShareItem.create({
        fileOwner: selfEmail,
        ownerEmail: selfEmail,
        ownerName: selfName || selfEmail,
        ownerDepartmentKey: departmentKey || "",
        ownerDepartmentName: ownerDeptName,
        displayName: template.name,
        description: kind === "doc" ? "Google Docs style file" : kind === "sheet" ? "Google Sheets style file" : "Google Slides style file",
        storagePath: key,
        contentType: template.contentType,
        sizeBytes: blob.size,
        visibilityScope: "DEPARTMENT",
        folderPath: folderPart,
        isFolder: false,
        isDeleted: false,
        sharedWithUsersJson: "[]",
        sharedWithDepartmentsJson: "[]",
        starredByJson: "[]",
        downloadCount: 0,
        createdAt: now,
        updatedAt: now,
        updatedBy: selfEmail,
      });
      await logActivity(key, "UPLOAD", `${selfEmail} created ${kind} template file`);
      setIsNewMenuOpen(false);
      await loadData();
      setStatus(t("New file created."));
    } catch (error: any) {
      setStatus(error?.message || t("Failed to create new file."));
    }
  };

  const toggleStar = async (row: any) => {
    if (!canStar) return;
    const stars = parseJsonArray(row?.starredByJson).map(normalizeEmail);
    const next = stars.includes(selfEmail) ? stars.filter((x) => x !== selfEmail) : [...stars, selfEmail];
    await (client.models as any).FileShareItem.update({ id: row.id, starredByJson: JSON.stringify(next), updatedAt: new Date().toISOString(), updatedBy: selfEmail });
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
        await uploadData({ path: key, data: file, options: { contentType: file.type || "application/octet-stream" } }).result;

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
    if (!canRestoreVersions && !canManageAll && !isAdminGroup) return setStatus(t("You do not have permission to restore versions."));
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
    if (!canCreateShareLink) return setStatus(t("You do not have permission to create shared links."));
    if (isFolder(row)) return setStatus(t("Shared links are supported for files only."));

    const hours = Math.max(1, Number(shareExpiryHours || 24));
    const maxDownloads = Number(shareMaxDownloads || 0);
    const token = createShareToken();

    try {
      await (client.models as any).DriveShareLink.create({
        fileShareItemId: row.id,
        token,
        createdBy: selfEmail,
        displayName: String(row?.displayName ?? ""),
        storagePath: String(row?.storagePath ?? ""),
        expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
        maxDownloads: maxDownloads > 0 ? maxDownloads : undefined,
        downloadCount: 0,
        createdAt: new Date().toISOString(),
      });

      const resolver = DRIVE_SHARE_RESOLVER_URL;
      const url = resolver ? `${window.location.origin}/share.html?t=${encodeURIComponent(token)}&r=${encodeURIComponent(resolver)}` : "";
      try { if (url) await navigator.clipboard.writeText(url); } catch {}

      await logActivity(row.id, "SHARE_LINK_CREATE", `${selfEmail} created expiring link for ${row?.displayName}`);
      await loadData();
      setStatus(!resolver ? `${t("Shared link created, but resolver URL is missing.")} Set VITE_DRIVE_SHARE_RESOLVER_URL.` : `${t("Shared link created.")} ${url}`);
    } catch (error: any) {
      setStatus(error?.message || t("Failed to create shared link."));
    }
  };

  const revokeSharedLink = async (link: any) => {
    if (!canRevokeShareLink && !canManageAll && !isAdminGroup) return setStatus(t("You do not have permission to revoke shared links."));
    try {
      await (client.models as any).DriveShareLink.update({ id: link.id, revokedAt: new Date().toISOString() });
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
    if (!canMove) return setStatus(t("You do not have permission to move files."));
    const target = normalizeFolderPath(window.prompt(t("Move to folder path (empty for root):"), String(row?.folderPath ?? "")));
    try {
      await (client.models as any).FileShareItem.update({ id: row.id, folderPath: target, updatedAt: new Date().toISOString(), updatedBy: selfEmail });
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

    if (!canDeleteOwn && !canDeleteAny && !isAdminGroup) return setStatus(t("You do not have permission to delete this item."));

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
        if (!isFolder(row) && row?.storagePath) await remove({ path: String(row.storagePath) });
        await (client.models as any).FileShareItem.delete({ id: String(row.id) });
        await logActivity(row.id, "DELETE", `${selfEmail} permanently deleted ${row?.displayName}`);
      }
      await loadData();
    } catch (error: any) {
      setStatus(error?.message || t("Failed to delete item."));
    }
  };

  const restoreRow = async (row: any) => {
    if (!canRestore && !isAdminGroup) return setStatus(t("You do not have permission to restore files."));
    try {
      await (client.models as any).FileShareItem.update({ id: row.id, isDeleted: false, deletedAt: null, deletedBy: null, updatedAt: new Date().toISOString(), updatedBy: selfEmail });
      await logActivity(row.id, "RESTORE", `${selfEmail} restored ${row?.displayName}`);
      await loadData();
    } catch (error: any) {
      setStatus(error?.message || t("Failed to restore file."));
    }
  };

  const saveQuota = async (targetEmailRaw: string) => {
    if (!canManageQuota && !isAdminGroup) return setStatus(t("You do not have permission to manage storage quotas."));

    const target = targetEmailRaw === "*" ? "*" : normalizeEmail(targetEmailRaw);
    const nextQuotaMb = Math.max(1, Number(quotaMb || DEFAULT_QUOTA_MB));
    if (!target) return setStatus(t("Please choose a user."));

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

  const openRow = async (row: any) => {
    if (isFolder(row)) {
      setView("my");
      setCurrentFolder(normalizeFolderPath(folderOf(row) ? `${folderOf(row)}/${row.displayName}` : row.displayName));
      return;
    }

    const ct = String(row?.contentType ?? "");
    if (IMAGE_TYPES.includes(ct) || ct === PDF_TYPE) {
      await openPreview(row);
      return;
    }

    await downloadFile(row);
  };

  const canRenameRow = useCallback(
    (row: any) => normalizeEmail(row?.ownerEmail) === selfEmail || canManageAll || isAdminGroup,
    [selfEmail, canManageAll, isAdminGroup]
  );

  const beginRename = (row: any) => {
    if (!canRenameRow(row)) {
      setStatus(t("You do not have permission to rename this item."));
      return;
    }
    setRenamingId(String(row?.id ?? ""));
    setRenameValue(String(row?.displayName ?? ""));
    setContextMenu(null);
  };

  const submitRename = async (row: any) => {
    const next = safeName(renameValue).trim();
    if (!next) {
      setStatus(t("Please enter a valid file or folder name."));
      return;
    }
    try {
      await (client.models as any).FileShareItem.update({
        id: row.id,
        displayName: next,
        updatedAt: new Date().toISOString(),
        updatedBy: selfEmail,
      });
      await logActivity(row.id, "RENAME", `${selfEmail} renamed ${row?.displayName} to ${next}`);
      setRenamingId("");
      setRenameValue("");
      await loadData();
    } catch (error: any) {
      setStatus(error?.message || t("Failed to rename item."));
    }
  };

  const canDeleteRow = useCallback(
    (row: any) => {
      const owner = normalizeEmail(row?.ownerEmail);
      const mine = owner === selfEmail;
      const canDeleteOwn = canOption("filesharing", "filesharing_delete_own", false) && mine;
      const canDeleteAny = canOption("filesharing", "filesharing_delete_any", false) || canManageAll;
      return canDeleteOwn || canDeleteAny || isAdminGroup;
    },
    [selfEmail, canManageAll, isAdminGroup, canOption]
  );

  const bulkMove = async () => {
    if (!selectedRows.length) return;
    if (!canMove) return setStatus(t("You do not have permission to move files."));
    const target = normalizeFolderPath(window.prompt(t("Move selected items to folder path (empty for root):"), currentFolder));
    try {
      await Promise.all(
        selectedRows.map((row) =>
          (client.models as any).FileShareItem.update({
            id: row.id,
            folderPath: target,
            updatedAt: new Date().toISOString(),
            updatedBy: selfEmail,
          })
        )
      );
      await logActivity("bulk", "MOVE", `${selfEmail} moved ${selectedRows.length} item(s) to ${target || "root"}`);
      setSelectedIds([]);
      await loadData();
    } catch (error: any) {
      setStatus(error?.message || t("Failed to move selected items."));
    }
  };

  const bulkDelete = async () => {
    if (!selectedRows.length) return;
    const deletable = selectedRows.filter((row) => canDeleteRow(row));
    if (!deletable.length) return setStatus(t("You do not have permission to delete selected items."));

    try {
      for (const row of deletable) {
        const doHardDelete = (canHardDelete || isAdminGroup) && (canManageAll || isAdminGroup) && !canSoftDelete;
        if (!doHardDelete) {
          await (client.models as any).FileShareItem.update({
            id: row.id,
            isDeleted: true,
            deletedAt: new Date().toISOString(),
            deletedBy: selfEmail,
            updatedAt: new Date().toISOString(),
            updatedBy: selfEmail,
          });
        } else {
          if (!isFolder(row) && row?.storagePath) await remove({ path: String(row.storagePath) });
          await (client.models as any).FileShareItem.delete({ id: String(row.id) });
        }
      }
      await logActivity("bulk", "DELETE", `${selfEmail} deleted ${deletable.length} item(s)`);
      setSelectedIds([]);
      await loadData();
    } catch (error: any) {
      setStatus(error?.message || t("Failed to delete selected items."));
    }
  };

  const bulkStar = async () => {
    if (!selectedRows.length || !canStar) return;
    const allStarred = selectedRows.every((row) => parseJsonArray(row?.starredByJson).map(normalizeEmail).includes(selfEmail));

    try {
      await Promise.all(
        selectedRows.map((row) => {
          const stars = parseJsonArray(row?.starredByJson).map(normalizeEmail);
          const next = allStarred ? stars.filter((x) => x !== selfEmail) : Array.from(new Set([...stars, selfEmail]));
          return (client.models as any).FileShareItem.update({
            id: row.id,
            starredByJson: JSON.stringify(next),
            updatedAt: new Date().toISOString(),
            updatedBy: selfEmail,
          });
        })
      );
      await logActivity("bulk", "STAR", `${selfEmail} ${allStarred ? "unstarred" : "starred"} ${selectedRows.length} item(s)`);
      await loadData();
    } catch (error: any) {
      setStatus(error?.message || t("Failed to update starred items."));
    }
  };

  const bulkShare = async () => {
    if (!selectedRows.length) return;
    if (!canCreateShareLink) return setStatus(t("You do not have permission to create shared links."));
    const filesOnly = selectedRows.filter((row) => !isFolder(row));
    if (!filesOnly.length) return setStatus(t("Select at least one file to create shared links."));

    const hours = Math.max(1, Number(shareExpiryHours || 24));
    const maxDownloads = Number(shareMaxDownloads || 0);
    const links: string[] = [];

    try {
      for (const row of filesOnly) {
        const token = createShareToken();
        await (client.models as any).DriveShareLink.create({
          fileShareItemId: row.id,
          token,
          createdBy: selfEmail,
          displayName: String(row?.displayName ?? ""),
          storagePath: String(row?.storagePath ?? ""),
          expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
          maxDownloads: maxDownloads > 0 ? maxDownloads : undefined,
          downloadCount: 0,
          createdAt: new Date().toISOString(),
        });
        if (DRIVE_SHARE_RESOLVER_URL) {
          links.push(`${window.location.origin}/share.html?t=${encodeURIComponent(token)}&r=${encodeURIComponent(DRIVE_SHARE_RESOLVER_URL)}`);
        }
      }
      if (links.length) {
        try {
          await navigator.clipboard.writeText(links.join("\n"));
        } catch {
          // ignore clipboard errors
        }
      }
      await logActivity("bulk", "SHARE_LINK_CREATE", `${selfEmail} created links for ${filesOnly.length} item(s)`);
      await loadData();
      setStatus(links.length ? `${t("Shared links created and copied.")} (${filesOnly.length})` : t("Shared links created."));
    } catch (error: any) {
      setStatus(error?.message || t("Failed to create shared links for selected files."));
    }
  };

  const handleRowPointerSelect = (event: React.MouseEvent, rowId: string) => {
    if ((event.target as HTMLElement).closest("button,input,select,textarea,a,label")) return;

    const isToggle = event.ctrlKey || event.metaKey;
    const isRange = event.shiftKey && lastSelectedId;

    if (isRange) {
      const ids = visibleRows.map((row) => String(row?.id ?? "")).filter(Boolean);
      const a = ids.indexOf(lastSelectedId);
      const b = ids.indexOf(rowId);
      if (a >= 0 && b >= 0) {
        const [start, end] = a < b ? [a, b] : [b, a];
        setSelectedIds((prev) => Array.from(new Set([...prev, ...ids.slice(start, end + 1)])));
        return;
      }
    }

    if (isToggle) {
      setSelectedIds((prev) => (prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId]));
      setLastSelectedId(rowId);
      return;
    }

    setSelectedIds([rowId]);
    setLastSelectedId(rowId);
  };

  const onRowContextMenu = (event: React.MouseEvent, row: any) => {
    event.preventDefault();
    const rowId = String(row?.id ?? "");
    if (!rowId) return;
    if (!selectedIds.includes(rowId)) {
      setSelectedIds([rowId]);
      setLastSelectedId(rowId);
    }
    setContextMenu({ rowId, x: event.clientX, y: event.clientY });
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

      <section className="drive-topbar">
        <div className="drive-topbar-brand">{t("Drive")}</div>
        <div className="drive-topbar-search">
          <i className="fas fa-search" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search in Drive")} />
        </div>
        <div className="drive-topbar-actions">
          <button type="button" onClick={() => setLayout((v) => (v === "list" ? "grid" : "list"))}>{layout === "list" ? t("Grid") : t("List")}</button>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
            <option value="modified">{t("Last modified")}</option>
            <option value="name">{t("Name")}</option>
            <option value="size">{t("Size")}</option>
          </select>
          <button type="button" onClick={() => void loadData()} disabled={loading}>{t("Refresh")}</button>
        </div>
      </section>

      <section className="drive-shell">
        <aside className="drive-sidebar">
          <div className="drive-new-wrap">
            <button type="button" className="drive-new-button" onClick={() => setIsNewMenuOpen((prev) => !prev)}>
              <i className="fas fa-plus" /> {t("New")}
            </button>
            {isNewMenuOpen ? (
              <div className="drive-new-menu">
                {canUpload ? <button type="button" onClick={openUploadPicker}><i className="fas fa-file-arrow-up" /> {t("File upload")}</button> : null}
                {canUpload ? <button type="button" onClick={openFolderPicker}><i className="fas fa-folder-plus" /> {t("Folder upload")}</button> : null}
                {canCreateFolder ? <button type="button" onClick={openNewFolderComposer}><i className="fas fa-folder" /> {t("New folder")}</button> : null}
                {canUpload ? <button type="button" onClick={() => void createTemplateDocument("doc")}><i className="fas fa-file-lines" /> {t("Google Docs")}</button> : null}
                {canUpload ? <button type="button" onClick={() => void createTemplateDocument("sheet")}><i className="fas fa-table" /> {t("Google Sheets")}</button> : null}
                {canUpload ? <button type="button" onClick={() => void createTemplateDocument("slides")}><i className="fas fa-chalkboard" /> {t("Google Slides")}</button> : null}
                <button type="button" onClick={() => { setIsNewMenuOpen(false); void loadData(); }}><i className="fas fa-rotate" /> {t("Refresh")}</button>
              </div>
            ) : null}
          </div>

          <button type="button" className={view === "home" ? "active" : ""} onClick={() => { setView("home"); setCurrentFolder(""); }}>{t("Home")}</button>
          <button type="button" className={view === "my" ? "active" : ""} onClick={() => { setView("my"); setCurrentFolder(""); }}>{t("My Drive")}</button>
          <button type="button" className={view === "shared" ? "active" : ""} onClick={() => { setView("shared"); setCurrentFolder(""); }}>{t("Shared with me")}</button>
          <button type="button" className={view === "recent" ? "active" : ""} onClick={() => { setView("recent"); setCurrentFolder(""); }}>{t("Recent")}</button>
          <button type="button" className={view === "starred" ? "active" : ""} onClick={() => { setView("starred"); setCurrentFolder(""); }}>{t("Starred")}</button>
          <button type="button" className={view === "dept" ? "active" : ""} onClick={() => { setView("dept"); setCurrentFolder(""); }}>{t("Department")}</button>
          <button type="button" className={view === "org" ? "active" : ""} onClick={() => { setView("org"); setCurrentFolder(""); }}>{t("Organization")}</button>
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

        <main className="drive-main">
          <input
            ref={uploadInputRef}
            id="fs-file-input"
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) setFiles((prev) => [...prev, ...createUploadQueueItems(picked, "files")]);
              e.target.value = "";
            }}
          />

          {view !== "admin" ? (
            <>
              <section className="drive-hero">
                <div>
                  <h1>{view === "home" ? t("Welcome to Drive") : t("Google Drive-style Workspace")}</h1>
                  <p>{view === "home" ? t("Find your recent and suggested content quickly.") : t("Files, folders, sharing, versioning, and governance in one place.")}</p>
                </div>
                <div className="drive-metrics">
                  <div><strong>{rows.filter((r) => !isDeleted(r)).length}</strong><span>{t("Active items")}</span></div>
                  <div><strong>{formatBytes(selfUsageBytes)}</strong><span>{t("My usage")}</span></div>
                  <div><strong>{selfQuotaMb} MB</strong><span>{t("My quota")}</span></div>
                </div>
              </section>

              <div className="drive-breadcrumb">
                {breadcrumb.map((node) => (
                  <button key={node.path || "root"} type="button" onClick={() => setCurrentFolder(node.path)}>{node.label}</button>
                ))}
              </div>

              {selectedIds.length ? (
                <section className="drive-card drive-bulk-bar">
                  <strong>{selectedIds.length} {t("selected")}</strong>
                  <div className="drive-inline-actions">
                    {canMove ? <button type="button" onClick={() => void bulkMove()}>{t("Move")}</button> : null}
                    {canCreateShareLink ? <button type="button" onClick={() => void bulkShare()}>{t("Share")}</button> : null}
                    {canStar ? <button type="button" onClick={() => void bulkStar()}>{t("Star")}</button> : null}
                    <button type="button" className="danger" onClick={() => void bulkDelete()}>{t("Delete")}</button>
                    <button type="button" onClick={() => setSelectedIds([])}>{t("Clear")}</button>
                  </div>
                </section>
              ) : null}

              {(composerMode === "upload" && canUpload) || (composerMode === "folder" && canCreateFolder) ? (
                <section className="filesharing-composer drive-card">
                  <div className="drive-card-title">{composerMode === "folder" ? t("Create folder") : t("Upload to Drive")}</div>
                  {composerMode === "upload" ? (
                    <>
                      <div ref={dropRef} className={`filesharing-dropzone${dragging ? " dragging" : ""}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={openUploadPicker}>
                        <i className="fas fa-cloud-arrow-up" />
                        <span>{t("Drop files here or click to upload")}</span>
                        <span className="filesharing-dropzone-sub">{t("Max")}: {MAX_UPLOAD_MB}MB {t("per file")}</span>
                      </div>

                      <div className="filesharing-grid">
                        {files.length === 1 && files[0]?.source === "files" ? <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t("Display name (optional)")} /> : null}
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
                    </>
                  ) : null}

                  {composerMode === "folder" ? (
                    <div className="drive-inline-actions drive-inline-actions-stack">
                      <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder={t("New folder name")} />
                      <button type="button" className="filesharing-primary" onClick={() => void createFolder()}>{t("Create folder")}</button>
                      <button type="button" onClick={resetComposer}>{t("Cancel")}</button>
                    </div>
                  ) : null}

                  {scope === "SELECTED_USERS" && canShare ? (
                    <div className="filesharing-picks">
                      {directory.filter((u) => u.email !== selfEmail).slice(0, 100).map((u) => (
                        <label key={u.email}>
                          <input type="checkbox" checked={selectedUsers.includes(u.email)} onChange={(e) => setSelectedUsers((prev) => e.target.checked ? [...prev, u.email] : prev.filter((x) => x !== u.email))} />
                          <span>{u.fullName} ({u.email})</span>
                        </label>
                      ))}
                    </div>
                  ) : null}

                  {scope === "SELECTED_DEPARTMENTS" && canShare ? (
                    <div className="filesharing-picks">
                      {departments.map((d) => (
                        <label key={d.key}>
                          <input type="checkbox" checked={selectedDepartments.includes(d.key)} onChange={(e) => setSelectedDepartments((prev) => e.target.checked ? [...prev, d.key] : prev.filter((x) => x !== d.key))} />
                          <span>{d.name}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}

                  {composerMode === "upload" && files.length ? (
                    <div className="filesharing-selected-files">
                      {files.map((entry) => (
                        <div key={entry.id} className="filesharing-selected-file">
                          <i className={fileIcon(entry.file.type, false)} />
                          <span className="filesharing-selected-file-name">{entry.relativePath}</span>
                          <span className="filesharing-selected-file-size">{formatBytes(entry.file.size)}</span>
                          {uploadProgress[entry.id] !== undefined ? <div className="filesharing-progress-bar"><div className="filesharing-progress-fill" style={{ width: `${uploadProgress[entry.id]}%` }} /></div> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {composerMode === "upload" ? (
                    <div className="drive-inline-actions">
                      <button type="button" onClick={openUploadPicker}>{t("Add files")}</button>
                      <button type="button" onClick={openFolderPicker}>{t("Add folder")}</button>
                      <button type="button" className="filesharing-primary" onClick={() => void uploadFile()} disabled={!files.length || saving || !canUpload}>{saving ? t("Uploading...") : t("Upload")}</button>
                      <button type="button" onClick={resetComposer}>{t("Cancel")}</button>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {view === "home" ? (
                <section className="drive-home-grid">
                  <section className="drive-card">
                    <div className="drive-card-title">{t("Suggested folders")}</div>
                    <div className="drive-suggested-grid">
                      {homeFolderRows.length ? homeFolderRows.map((row) => (
                        <button key={row.id} type="button" className="drive-suggested-card" onClick={() => void openRow(row)}>
                          <div className="drive-suggested-card-head"><span><i className="fas fa-folder" /> {String(row?.displayName || t("Untitled"))}</span></div>
                          <span>{String(row?.ownerName || row?.ownerEmail || "-")}</span>
                        </button>
                      )) : <div className="filesharing-empty">{t("No folders to suggest yet")}</div>}
                    </div>
                  </section>

                  <section className="drive-card">
                    <div className="drive-card-title">{t("Suggested files")}</div>
                    <div className="drive-items-grid">
                      {homeFileRows.length ? homeFileRows.map((row) => {
                        const ct = String(row?.contentType ?? "");
                        return (
                          <button key={row.id} type="button" className="drive-home-file-card" onClick={() => void openRow(row)}>
                            <div className="drive-home-file-card-title"><i className={fileIcon(ct, false)} /> {String(row?.displayName || t("Untitled"))}</div>
                            <span>{String(row?.ownerName || row?.ownerEmail || "-")}</span>
                            <span>{formatBytes(Number(row?.sizeBytes ?? 0))}</span>
                          </button>
                        );
                      }) : <div className="filesharing-empty">{t("No recent files yet")}</div>}
                    </div>
                  </section>
                </section>
              ) : null}

              {view !== "home" ? <section className="drive-card">
                <div className="drive-card-title">{t("Drive items")} ({visibleRows.length})</div>
                {visibleRows.length === 0 ? <div className="filesharing-empty">{t("No items found")}</div> : null}

                <div className={layout === "grid" ? "drive-items-grid" : "drive-items-list"}>
                  {visibleRows.map((row) => {
                    const folder = isFolder(row);
                    const ct = String(row?.contentType ?? "");
                    const stars = parseJsonArray(row?.starredByJson).map(normalizeEmail);
                    const starred = stars.includes(selfEmail);

                    return (
                      <div
                        key={row.id}
                        className={`filesharing-item ${layout === "grid" ? "as-grid" : ""} ${selectedIds.includes(String(row?.id ?? "")) ? "is-selected" : ""}`}
                        onClick={(event) => handleRowPointerSelect(event, String(row?.id ?? ""))}
                        onDoubleClick={() => void openRow(row)}
                        onContextMenu={(event) => onRowContextMenu(event, row)}
                      >
                        <div className="filesharing-item-left">
                          <div className={`filesharing-file-icon ${folder ? "folder" : ct === PDF_TYPE ? "pdf" : ct.startsWith("image/") ? "image" : ""}`}>
                            <i className={fileIcon(ct, folder)} />
                          </div>
                        </div>

                        <div className="filesharing-item-main">
                          {renamingId === String(row?.id ?? "") ? (
                            <form
                              className="drive-rename-form"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void submitRename(row);
                              }}
                            >
                              <input
                                value={renameValue}
                                onChange={(event) => setRenameValue(event.target.value)}
                                autoFocus
                                onKeyDown={(event) => {
                                  if (event.key === "Escape") {
                                    setRenamingId("");
                                    setRenameValue("");
                                  }
                                }}
                              />
                              <button type="submit">{t("Save")}</button>
                            </form>
                          ) : (
                            <button type="button" className="drive-name-link" onClick={() => void openRow(row)}>{String(row?.displayName || t("Untitled"))}</button>
                          )}
                          <div className="filesharing-meta">{String(row?.ownerName || row?.ownerEmail || "-")} • {String(row?.ownerDepartmentName || t("No department"))} • {String(row?.visibilityScope || "DEPARTMENT")} • {formatBytes(Number(row?.sizeBytes ?? 0))}</div>
                          {row?.description ? <div className="filesharing-desc">{String(row.description)}</div> : null}
                        </div>

                        <div className="filesharing-item-actions">
                          {canStar ? <button type="button" onClick={() => void toggleStar(row)} title={t("Star")}>{starred ? "★" : "☆"}</button> : null}
                          {!folder ? <PermissionGate moduleId="filesharing" optionId="filesharing_download"><button type="button" onClick={() => void downloadFile(row)}>{t("Download")}</button></PermissionGate> : null}
                          {!folder ? <PermissionGate moduleId="filesharing" optionId="filesharing_view"><button type="button" onClick={() => void openPreview(row)}>{t("Preview")}</button></PermissionGate> : null}
                          {!folder && canCreateShareLink ? <button type="button" onClick={() => void createSharedLink(row)}>{t("Create link")}</button> : null}
                          {canRenameRow(row) ? <button type="button" onClick={() => beginRename(row)}>{t("Rename")}</button> : null}
                          {!folder && canCreateShareLink ? <button type="button" onClick={() => setLinkTargetId((prev) => prev === row.id ? "" : row.id)}>{t("Links")}</button> : null}
                          {!folder && canViewVersions ? <button type="button" onClick={() => setVersionTargetId((prev) => prev === row.id ? "" : row.id)}>{t("Versions")}</button> : null}
                          {!folder && canUpload ? <button type="button" onClick={() => void replaceWithNewVersion(row)}>{t("Upload version")}</button> : null}
                          {canMove ? <button type="button" onClick={() => void moveRow(row)}>{t("Move")}</button> : null}
                          {!isDeleted(row) ? <button type="button" className="danger" onClick={() => void deleteRow(row)}>{t("Delete")}</button> : null}
                          {view === "trash" ? <button type="button" onClick={() => void restoreRow(row)}>{t("Restore")}</button> : null}
                        </div>

                        {linkTargetId === row.id ? (
                          <div className="drive-subpanel">
                            <div className="drive-subpanel-title">{t("Shared links")}</div>
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
                                          if (!DRIVE_SHARE_RESOLVER_URL) return setStatus("VITE_DRIVE_SHARE_RESOLVER_URL is missing.");
                                          const linkUrl = `${window.location.origin}/share.html?t=${encodeURIComponent(String(link?.token ?? ""))}&r=${encodeURIComponent(DRIVE_SHARE_RESOLVER_URL)}`;
                                          try { await navigator.clipboard.writeText(linkUrl); } catch {}
                                          setStatus(`${t("Link copied")}: ${linkUrl}`);
                                        } catch {
                                          setStatus(t("Unable to copy this shared link."));
                                        }
                                      }}
                                    >
                                      {t("Copy")}
                                    </button>
                                    {!revoked && (canRevokeShareLink || canManageAll || isAdminGroup) ? <button type="button" className="danger" onClick={() => void revokeSharedLink(link)}>{t("Revoke")}</button> : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}

                        {versionTargetId === row.id ? (
                          <div className="drive-subpanel">
                            <div className="drive-subpanel-title">{t("Version history")}</div>
                            {(versionsByItem.get(String(row.id)) ?? []).slice(0, 10).map((v) => (
                              <div key={v.id} className="drive-version-row">
                                <div>
                                  <strong>v{v.versionNumber}</strong>
                                  <span>{String(v?.createdAt ?? "-")} • {formatBytes(Number(v?.sizeBytes ?? 0))}</span>
                                </div>
                                {canRestoreVersions || canManageAll || isAdminGroup ? <button type="button" onClick={() => void restoreVersion(row, v)}>{t("Restore")}</button> : null}
                              </div>
                            ))}
                            {!(versionsByItem.get(String(row.id)) ?? []).length ? <div className="filesharing-empty">{t("No saved versions yet")}</div> : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section> : null}
            </>
          ) : null}

          {view === "admin" && canAdminPanel ? (
            <section className="drive-card drive-admin-grid">
              <div>
                <div className="drive-card-title">{t("Storage governance")}</div>
                <div className="drive-inline-actions">
                  <select value={quotaEmail} onChange={(e) => setQuotaEmail(e.target.value)}>
                    <option value="">{t("Select user")}</option>
                    {directory.map((u) => <option key={u.email} value={u.email}>{u.fullName} ({u.email})</option>)}
                  </select>
                  <input value={quotaMb} onChange={(e) => setQuotaMb(e.target.value)} placeholder={t("Quota MB")} />
                </div>
                <div className="drive-inline-actions">
                  <label><input type="checkbox" checked={quotaBlocked} onChange={(e) => setQuotaBlocked(e.target.checked)} /> {t("Block uploads")}</label>
                  <input value={quotaNotes} onChange={(e) => setQuotaNotes(e.target.value)} placeholder={t("Admin notes")} />
                </div>
                <div className="drive-inline-actions">
                  <button type="button" onClick={() => void saveQuota(quotaEmail)} disabled={!canManageQuota}>{t("Save user quota")}</button>
                  <button type="button" onClick={() => void saveQuota("*")} disabled={!canManageQuota}>{t("Save default quota")}</button>
                </div>
              </div>

              <div>
                <div className="drive-card-title">{t("Usage matrix")}</div>
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

                <div className="drive-card-title drive-top-gap">{t("Usage trends (14 days)")}</div>
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

                <div className="drive-card-title drive-top-gap">{t("Alert center")}</div>
                <div className="drive-alert-list">
                  {adminAlerts.map((a, idx) => <div key={`${a.level}-${idx}`} className={`drive-alert ${a.level}`}>{a.text}</div>)}
                </div>
              </div>
            </section>
          ) : null}
        </main>
      </section>

      {status ? <div className="filesharing-status">{status}</div> : null}

      {contextMenu ? (
        <div className="drive-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
          {(() => {
            const row = rowById.get(contextMenu.rowId);
            if (!row) return null;
            const folder = isFolder(row);
            return (
              <>
                <button type="button" onClick={() => { setContextMenu(null); void openRow(row); }}>{folder ? t("Open") : t("Open / Preview")}</button>
                {!folder ? <button type="button" onClick={() => { setContextMenu(null); void downloadFile(row); }}>{t("Download")}</button> : null}
                {canRenameRow(row) ? <button type="button" onClick={() => beginRename(row)}>{t("Rename")}</button> : null}
                {canMove ? <button type="button" onClick={() => { setContextMenu(null); void moveRow(row); }}>{t("Move")}</button> : null}
                {!folder && canCreateShareLink ? <button type="button" onClick={() => { setContextMenu(null); void createSharedLink(row); }}>{t("Create link")}</button> : null}
                {canStar ? <button type="button" onClick={() => { setContextMenu(null); void toggleStar(row); }}>{t("Star")}</button> : null}
                {canDeleteRow(row) ? <button type="button" className="danger" onClick={() => { setContextMenu(null); void deleteRow(row); }}>{t("Delete")}</button> : null}
              </>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}
