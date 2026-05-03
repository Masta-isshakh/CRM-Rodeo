import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentUser } from "aws-amplify/auth";
import { getUrl, remove, uploadData } from "aws-amplify/storage";
import { Document, Packer, Paragraph } from "docx";
import * as XLSX from "xlsx";
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
type SortBy = "custom" | "name" | "modified" | "size";

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

type DepartmentDriveManagerConfig = {
  managers: string[];
  approvalRules: {
    requireApprovalForUpload: boolean;
    requireApprovalForMove: boolean;
    requireApprovalForDelete: boolean;
    requireApprovalForFolderCreate: boolean;
    maxUploadMbWithoutApproval: number;
  };
};

type DepartmentPolicyAction = "upload" | "move" | "delete" | "folder-create";
type ApprovalAction = "UPLOAD" | "MOVE" | "DELETE" | "FOLDER_CREATE";

type DepartmentPolicyBlock = {
  departmentKey: string;
  action: DepartmentPolicyAction;
  message: string;
  managerEmails: string[];
};

const MAX_UPLOAD_MB = 100;
const DEFAULT_QUOTA_MB = 2048;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
const PDF_TYPE = "application/pdf";
const FOLDER_MIME = "application/x.crm.folder";
const DOC_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SHEET_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SLIDES_MIME = "application/x.crm.slides";
const FORM_MIME = "application/x.crm.forms";
const DRIVE_SHARE_RESOLVER_URL = String(import.meta.env.VITE_DRIVE_SHARE_RESOLVER_URL ?? "").trim();
const DEPARTMENT_DRIVE_ROOT = "__department_drives__";
const DEFAULT_QUOTA_KEY = "*";
const DEPARTMENT_QUOTA_PREFIX = "department:";
const DRIVE_EDITOR_CLOSED_EVENT_KEY = "crm.drive.editor.closed";

const EDITOR_KIND_TO_TYPE = {
  doc: "docs",
  sheet: "sheets",
  slides: "slides",
  form: "forms",
} as const;

const EDITOR_KIND_TO_MIME = {
  doc: DOC_MIME,
  sheet: SHEET_MIME,
  slides: SLIDES_MIME,
  form: FORM_MIME,
} as const;

const EDITOR_KIND_DEFAULT_NAME = {
  doc: "Untitled Document",
  sheet: "Untitled Spreadsheet",
  slides: "Untitled Presentation",
  form: "Untitled Form",
} as const;

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

function parseDepartmentManagersConfig(raw: unknown): DepartmentDriveManagerConfig {
  const defaults: DepartmentDriveManagerConfig = {
    managers: [],
    approvalRules: {
      requireApprovalForUpload: false,
      requireApprovalForMove: false,
      requireApprovalForDelete: false,
      requireApprovalForFolderCreate: false,
      maxUploadMbWithoutApproval: 0,
    },
  };

  try {
    if (!raw) return defaults;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      return {
        ...defaults,
        managers: parsed.map(normalizeEmail).filter(Boolean),
      };
    }

    const managers = Array.isArray((parsed as any)?.managers)
      ? (parsed as any).managers.map(normalizeEmail).filter(Boolean)
      : [];
    const rules = (parsed as any)?.approvalRules ?? {};

    return {
      managers,
      approvalRules: {
        requireApprovalForUpload: Boolean(rules?.requireApprovalForUpload),
        requireApprovalForMove: Boolean(rules?.requireApprovalForMove),
        requireApprovalForDelete: Boolean(rules?.requireApprovalForDelete),
        requireApprovalForFolderCreate: Boolean(rules?.requireApprovalForFolderCreate),
        maxUploadMbWithoutApproval: Math.max(0, Number(rules?.maxUploadMbWithoutApproval ?? 0)),
      },
    };
  } catch {
    return defaults;
  }
}

function fileIcon(contentType: string | undefined | null, isFolder: boolean) {
  if (isFolder) return "fas fa-folder";
  const ct = String(contentType ?? "");
  if (ct === DOC_MIME) return "fas fa-file-lines";
  if (ct === SHEET_MIME) return "fas fa-table";
  if (ct === SLIDES_MIME) return "fas fa-chalkboard";
  if (ct === FORM_MIME) return "fas fa-list-check";
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

function departmentQuotaKey(deptKey: string) {
  const clean = String(deptKey ?? "").trim();
  return clean ? `${DEPARTMENT_QUOTA_PREFIX}${clean}` : "";
}

function departmentDrivePath(deptKey: string) {
  return normalizeFolderPath(`${DEPARTMENT_DRIVE_ROOT}/${String(deptKey ?? "").trim()}`);
}

function isDepartmentDriveRoot(row: any) {
  if (!isFolder(row)) return false;
  const deptKey = String(row?.ownerDepartmentKey ?? "").trim();
  return Boolean(deptKey) && (folderOf(row) === DEPARTMENT_DRIVE_ROOT || folderOf(row) === departmentDrivePath(deptKey));
}

function getFolderTargetPath(row: any) {
  if (isDepartmentDriveRoot(row)) return departmentDrivePath(String(row?.ownerDepartmentKey ?? "").trim());
  const parent = folderOf(row);
  return normalizeFolderPath(parent ? `${parent}/${String(row?.displayName ?? "")}` : String(row?.displayName ?? ""));
}

async function buildDocxBlob(text: string) {
  const lines = String(text ?? "").split(/\r?\n/);
  const paragraphs = lines.length ? lines.map((line) => new Paragraph(line || " ")) : [new Paragraph("")];
  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBlob(doc);
}

function buildXlsxBlob(sheetData?: Record<string, string>) {
  const grid: string[][] = [];
  if (sheetData && Object.keys(sheetData).length) {
    let maxRow = 0;
    let maxCol = 0;
    for (const key of Object.keys(sheetData)) {
      const [r, c] = key.split(",");
      const rowIndex = Number(r);
      const colIndex = Number(c);
      if (Number.isFinite(rowIndex) && rowIndex > maxRow) maxRow = rowIndex;
      if (Number.isFinite(colIndex) && colIndex > maxCol) maxCol = colIndex;
    }

    for (let row = 0; row <= maxRow; row += 1) {
      const cols: string[] = [];
      for (let col = 0; col <= maxCol; col += 1) {
        cols.push(String(sheetData[`${row},${col}`] ?? ""));
      }
      grid.push(cols);
    }
  }

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(grid);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new Blob([buffer], { type: SHEET_MIME });
}

function editorKindFromRow(row: any): keyof typeof EDITOR_KIND_TO_TYPE | "" {
  const rawKind = String(row?.kind ?? "").trim().toLowerCase();
  if (rawKind === "doc" || rawKind === "sheet" || rawKind === "slides" || rawKind === "form") return rawKind;

  const normalizedType = String(row?.contentType ?? "").trim().toLowerCase();
  if (normalizedType === DOC_MIME || normalizedType === "application/x.crm.doc" || normalizedType === "application/x.crm.docs" || normalizedType === "application/msword") return "doc";
  if (normalizedType === SHEET_MIME || normalizedType === "application/x.crm.sheet" || normalizedType === "application/x.crm.sheets" || normalizedType === "text/csv") return "sheet";
  if (normalizedType === SLIDES_MIME || normalizedType === "application/x.crm.slide") return "slides";
  if (normalizedType === FORM_MIME || normalizedType === "application/x.crm.form") return "form";

  return "";
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
  const [sortBy, setSortBy] = useState<SortBy>("custom");
  const [currentFolder, setCurrentFolder] = useState("");
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [composerMode, setComposerMode] = useState<"upload" | "folder" | null>(null);
  const [isNewMenuOpen, setIsNewMenuOpen] = useState(false);
  const [pendingFileDialog, setPendingFileDialog] = useState(false);
  const [openOfficeModal, setOpenOfficeModal] = useState<{ kind: "doc" | "sheet"; displayName: string; protocolUrl: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastSelectedId, setLastSelectedId] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ rowId: string; x: number; y: number } | null>(null);
  const [rowMenuId, setRowMenuId] = useState("");
  const [dragTargetPath, setDragTargetPath] = useState("");
  const [reorderTarget, setReorderTarget] = useState<{ rowId: string; position: "before" | "after" } | null>(null);

  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [departmentSpaceRows, setDepartmentSpaceRows] = useState<any[]>([]);
  const [quotaRows, setQuotaRows] = useState<any[]>([]);
  const [versionRows, setVersionRows] = useState<any[]>([]);
  const [linkRows, setLinkRows] = useState<any[]>([]);
  const [approvalRows, setApprovalRows] = useState<any[]>([]);
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
  const [quotaEditorTarget, setQuotaEditorTarget] = useState(DEFAULT_QUOTA_KEY);
  const [shareExpiryHours, setShareExpiryHours] = useState("24");
  const [shareMaxDownloads, setShareMaxDownloads] = useState("");
  const [driveDepartmentKey, setDriveDepartmentKey] = useState("");
  const [driveName, setDriveName] = useState("");
  const [driveDescription, setDriveDescription] = useState("");
  const [driveManagers, setDriveManagers] = useState<string[]>([]);
  const [driveRequireApprovalForUpload, setDriveRequireApprovalForUpload] = useState(false);
  const [driveRequireApprovalForMove, setDriveRequireApprovalForMove] = useState(false);
  const [driveRequireApprovalForDelete, setDriveRequireApprovalForDelete] = useState(false);
  const [driveRequireApprovalForFolderCreate, setDriveRequireApprovalForFolderCreate] = useState(false);
  const [driveMaxUploadWithoutApprovalMb, setDriveMaxUploadWithoutApprovalMb] = useState("0");

  const [preview, setPreview] = useState<{ url: string; type: string; name: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const dragIdsRef = useRef<string[]>([]);

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
  const canViewAnalytics = canManageAll || canOption("filesharing", "filesharing_view_analytics", false);
  const canCrossDepartment = canManageAll || canOption("filesharing", "filesharing_cross_department", false);

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

      if ((client.models as any).DriveDepartmentSpace?.list) {
        const spaceRes = await (client.models as any).DriveDepartmentSpace.list({ limit: 1000 });
        const nativeSpaces = ((spaceRes?.data ?? []) as any[]).slice();

        const canMigrateLegacy = canAdminPanel || canManageAll || isAdminGroup;
        if (canMigrateLegacy && (client.models as any).DriveDepartmentSpace?.create) {
          const existingKeys = new Set(nativeSpaces.map((row) => String(row?.departmentKey ?? "").trim()).filter(Boolean));
          const legacyRoots = fileRows.filter((row) => !isDeleted(row) && isDepartmentDriveRoot(row));
          let migrated = 0;

          for (const legacyRow of legacyRoots) {
            const deptKey = String(legacyRow?.ownerDepartmentKey ?? "").trim();
            if (!deptKey || existingKeys.has(deptKey)) continue;

            const deptName = String(legacyRow?.ownerDepartmentName ?? deptKey).trim();
            const managerConfig: DepartmentDriveManagerConfig = {
              managers: [normalizeEmail(legacyRow?.ownerEmail)].filter(Boolean),
              approvalRules: {
                requireApprovalForUpload: false,
                requireApprovalForMove: false,
                requireApprovalForDelete: false,
                requireApprovalForFolderCreate: false,
                maxUploadMbWithoutApproval: 0,
              },
            };

            const created = await (client.models as any).DriveDepartmentSpace.create({
              departmentKey: deptKey,
              departmentName: deptName,
              displayName: String(legacyRow?.displayName ?? `${deptName} Drive`).trim(),
              description: String(legacyRow?.description ?? `${deptName} managed shared drive`).trim(),
              rootFolderPath: departmentDrivePath(deptKey),
              managersJson: JSON.stringify(managerConfig),
              uploadBlocked: false,
              sortOrder: Number(legacyRow?.sortOrder ?? migrated * 1024 + 1024),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              updatedBy: email,
            });

            if (created?.data) {
              nativeSpaces.push(created.data);
              existingKeys.add(deptKey);
              migrated += 1;
            }
          }

          if (migrated > 0) {
            setStatus(`${t("Migrated legacy department drives:")} ${migrated}`);
          }
        }

        setDepartmentSpaceRows(nativeSpaces);
      } else {
        setDepartmentSpaceRows([]);
      }

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

      if ((client.models as any).DriveApprovalRequest?.list) {
        const approvalRes = await (client.models as any).DriveApprovalRequest.list({ limit: 3000 });
        setApprovalRows((approvalRes?.data ?? []) as any[]);
      } else {
        setApprovalRows([]);
      }

      const activityRes = await (client.models as any).ActivityLog.list({ limit: 5000 });
      const allActivity = (activityRes?.data ?? []) as any[];
      setActivityRows(allActivity.filter((row) => String(row?.entityType ?? "") === "FILE_SHARE"));
    } catch (error: any) {
      setStatus(error?.message || t("Failed to load drive data."));
    } finally {
      setLoading(false);
    }
  }, [client, permissions.canRead, t, canAdminPanel, canManageAll, isAdminGroup]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const onEditorClosed = (event: StorageEvent) => {
      if (event.key !== DRIVE_EDITOR_CLOSED_EVENT_KEY || !event.newValue) return;
      void loadData();
    };

    window.addEventListener("storage", onEditorClosed);
    return () => window.removeEventListener("storage", onEditorClosed);
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

  useEffect(() => {
    const closeRowMenu = () => setRowMenuId("");
    window.addEventListener("click", closeRowMenu);
    window.addEventListener("scroll", closeRowMenu, true);
    return () => {
      window.removeEventListener("click", closeRowMenu);
      window.removeEventListener("scroll", closeRowMenu, true);
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

  useEffect(() => {
    if (!quotaEmail) return;
    const existing = quotaMap.get(normalizeEmail(quotaEmail));
    setQuotaMb(String(existing?.quotaMb ?? DEFAULT_QUOTA_MB));
    setQuotaBlocked(Boolean(existing?.uploadBlocked));
    setQuotaNotes(String(existing?.notes ?? ""));
  }, [quotaEmail, quotaMap]);

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
  const selfQuotaRow = quotaMap.get(selfEmail) ?? quotaMap.get(departmentQuotaKey(String(departmentKey ?? "").trim())) ?? quotaMap.get(DEFAULT_QUOTA_KEY);
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

  const departmentUsageMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (isDeleted(row) || isFolder(row)) continue;
      const key = String(row?.ownerDepartmentKey ?? "").trim();
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + Number(row?.sizeBytes ?? 0));
    }
    return map;
  }, [rows]);

  const departmentSpaceByKey = useMemo(() => {
    const map = new Map<string, any>();
    for (const row of departmentSpaceRows) {
      const key = String(row?.departmentKey ?? "").trim();
      if (key) map.set(key, row);
    }
    return map;
  }, [departmentSpaceRows]);

  const departmentDriveRows = useMemo(() => {
    const nativeSpaces = departmentSpaceRows
      .filter((row) => {
        const key = String(row?.departmentKey ?? "").trim();
        return canManageAll || isAdminGroup || key === String(departmentKey ?? "").trim() || canCrossDepartment;
      })
      .map((row) => ({
        id: String(row?.id ?? row?.departmentKey ?? ""),
        ownerDepartmentKey: String(row?.departmentKey ?? "").trim(),
        ownerDepartmentName: String(row?.departmentName ?? "").trim(),
        displayName: String(row?.displayName ?? row?.departmentName ?? "").trim(),
        description: String(row?.description ?? "").trim(),
        folderPath: normalizeFolderPath(String(row?.rootFolderPath ?? "")),
        isFolder: true,
        contentType: FOLDER_MIME,
        sortOrder: Number(row?.sortOrder ?? 0),
        _nativeSpaceId: String(row?.id ?? ""),
        _managerConfig: parseDepartmentManagersConfig(row?.managersJson),
      }));

    const nativeByDept = new Map(nativeSpaces.map((row) => [String(row?.ownerDepartmentKey ?? "").trim(), row]));
    const legacyFallback = rows
      .filter((row) => !isDeleted(row) && isDepartmentDriveRoot(row))
      .filter((row) => {
        const key = String(row?.ownerDepartmentKey ?? "").trim();
        return canManageAll || isAdminGroup || key === String(departmentKey ?? "").trim() || canCrossDepartment;
      })
      .map((row) => {
        const key = String(row?.ownerDepartmentKey ?? "").trim();
        if (nativeByDept.has(key)) return null;
        return {
          ...row,
          _nativeSpaceId: "",
          _managerConfig: parseDepartmentManagersConfig("[]"),
        };
      })
      .filter(Boolean) as any[];

    return [...nativeSpaces, ...legacyFallback].sort(
      (a, b) => Number(a?.sortOrder ?? 0) - Number(b?.sortOrder ?? 0) || String(a?.ownerDepartmentName ?? a?.displayName ?? "").localeCompare(String(b?.ownerDepartmentName ?? b?.displayName ?? ""))
    );
  }, [departmentSpaceRows, rows, canManageAll, isAdminGroup, departmentKey, canCrossDepartment]);

  const resolveDepartmentKeyFromPath = useCallback((path: string) => {
    const clean = normalizeFolderPath(path);
    if (!clean.startsWith(`${DEPARTMENT_DRIVE_ROOT}/`)) return "";
    const parts = clean.split("/").filter(Boolean);
    return String(parts[1] ?? "").trim();
  }, []);

  const resolveDepartmentDrivePolicyBlock = useCallback(
    (
      folderPath: string,
      action: DepartmentPolicyAction,
      uploadSizeMb?: number
    ): DepartmentPolicyBlock | null => {
      const deptKey = resolveDepartmentKeyFromPath(folderPath);
      if (!deptKey) return null;
      if (canManageAll || isAdminGroup) return null;

      const space = departmentSpaceByKey.get(deptKey);
      const managerConfig = parseDepartmentManagersConfig(space?.managersJson);
      if (managerConfig.managers.includes(normalizeEmail(selfEmail))) return null;

      if (action === "upload") {
        if (!managerConfig.approvalRules.requireApprovalForUpload) return null;
        const maxBypassMb = Math.max(0, Number(managerConfig.approvalRules.maxUploadMbWithoutApproval ?? 0));
        if (Number.isFinite(uploadSizeMb) && maxBypassMb > 0 && Number(uploadSizeMb ?? 0) <= maxBypassMb) return null;
      }
      if (action === "move" && !managerConfig.approvalRules.requireApprovalForMove) return null;
      if (action === "delete" && !managerConfig.approvalRules.requireApprovalForDelete) return null;
      if (action === "folder-create" && !managerConfig.approvalRules.requireApprovalForFolderCreate) return null;

      const managerNames = managerConfig.managers
        .map((email) => directory.find((u) => u.email === email)?.fullName || email)
        .slice(0, 3)
        .join(", ");
      const suffix = managerNames ? ` ${t("Managers")}: ${managerNames}` : "";
      return {
        departmentKey: deptKey,
        action,
        managerEmails: managerConfig.managers,
        message: `${t("This action requires a department drive manager approval.")}${suffix}`,
      };
    },
    [resolveDepartmentKeyFromPath, canManageAll, isAdminGroup, departmentSpaceByKey, selfEmail, directory, t]
  );

  const isDepartmentDriveManager = useCallback(
    (deptKey: string) => {
      const key = String(deptKey ?? "").trim();
      if (!key) return false;
      const space = departmentSpaceByKey.get(key);
      const managerConfig = parseDepartmentManagersConfig(space?.managersJson);
      return managerConfig.managers.includes(normalizeEmail(selfEmail));
    },
    [departmentSpaceByKey, selfEmail]
  );

  const submitApprovalRequest = useCallback(
    async (block: DepartmentPolicyBlock, payload: Record<string, unknown>, itemId?: string) => {
      if (!(client.models as any).DriveApprovalRequest?.create) {
        setStatus(block.message);
        return;
      }

      const deptName = departments.find((d) => d.key === block.departmentKey)?.name || block.departmentKey;
      const actionMap: Record<DepartmentPolicyAction, ApprovalAction> = {
        upload: "UPLOAD",
        move: "MOVE",
        delete: "DELETE",
        "folder-create": "FOLDER_CREATE",
      };

      try {
        await (client.models as any).DriveApprovalRequest.create({
          departmentKey: block.departmentKey,
          departmentName: deptName,
          actionType: actionMap[block.action],
          requestStatus: "PENDING",
          folderPath: String(payload?.folderPath ?? ""),
          itemId: itemId || "",
          payloadJson: JSON.stringify(payload ?? {}),
          managerEmailsJson: JSON.stringify(block.managerEmails ?? []),
          requestedByEmail: selfEmail,
          requestedByName: selfName || selfEmail,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        await logActivity(block.departmentKey, "APPROVAL_REQUEST", `${selfEmail} submitted approval request for ${actionMap[block.action]}`);
        await loadData();
        setStatus(`${block.message} ${t("Request submitted to managers.")}`);
      } catch (error: any) {
        setStatus(error?.message || t("Failed to submit approval request."));
      }
    },
    [client, departments, selfEmail, selfName, t, logActivity, loadData]
  );

  const handleApprovalDecision = useCallback(
    async (row: any, requestStatus: "APPROVED" | "REJECTED" | "CANCELLED", executeAfterApprove = false) => {
      const id = String(row?.id ?? "").trim();
      if (!id) return;
      const deptKey = String(row?.departmentKey ?? "").trim();
      const canResolve = canManageAll || isAdminGroup || isDepartmentDriveManager(deptKey);
      const isRequester = normalizeEmail(row?.requestedByEmail) === selfEmail;

      if (requestStatus === "CANCELLED") {
        if (!isRequester && !canResolve) return;
      } else if (!canResolve) {
        return;
      }

      const executeApprovedAction = async () => {
        const action = String(row?.actionType ?? "").toUpperCase();
        let payload: any = {};
        try {
          payload = JSON.parse(String(row?.payloadJson ?? "{}"));
        } catch {
          payload = {};
        }

        if (action === "MOVE") {
          const targetFolder = normalizeFolderPath(String(payload?.targetFolderPath ?? payload?.folderPath ?? ""));
          const itemIds = Array.isArray(payload?.itemIds)
            ? payload.itemIds.map((v: unknown) => String(v ?? "").trim()).filter(Boolean)
            : [String(row?.itemId ?? payload?.itemId ?? "").trim()].filter(Boolean);
          const items = itemIds
            .map((itemId: string) => rows.find((r) => String(r?.id ?? "") === itemId))
            .filter(Boolean) as any[];
          if (!items.length) throw new Error(t("Cannot execute move. The original file(s) could not be found."));

          const targetSiblings = rows.filter((r) => !isDeleted(r) && folderOf(r) === targetFolder);
          const baseSortOrder = targetSiblings.reduce((max, r) => Math.max(max, Number(r?.sortOrder ?? 0)), 0) + 1024;
          await Promise.all(
            items.map((item, index) =>
              (client.models as any).FileShareItem.update({
                id: item.id,
                folderPath: targetFolder,
                sortOrder: baseSortOrder + index,
                updatedAt: new Date().toISOString(),
                updatedBy: selfEmail,
              })
            )
          );
          await logActivity("bulk", "MOVE", `${selfEmail} executed approved move for ${items.length} item(s)`);
          await loadData();
          return;
        }

        if (action === "DELETE") {
          const itemId = String(row?.itemId ?? payload?.itemId ?? "").trim();
          const item = rows.find((r) => String(r?.id ?? "") === itemId);
          if (!item) throw new Error(t("Cannot execute delete. The target file no longer exists."));
          await (client.models as any).FileShareItem.update({
            id: itemId,
            isDeleted: true,
            deletedAt: new Date().toISOString(),
            deletedBy: selfEmail,
            updatedAt: new Date().toISOString(),
            updatedBy: selfEmail,
          });
          await logActivity(itemId, "SOFT_DELETE", `${selfEmail} executed approved delete for ${item?.displayName ?? itemId}`);
          await loadData();
          return;
        }

        if (action === "FOLDER_CREATE") {
          const proposedName = safeName(String(payload?.proposedFolderName ?? "Approved Folder")).replace(/\.[^/.]+$/, "");
          if (!proposedName) throw new Error(t("Cannot execute folder creation. Folder name is missing."));
          const targetFolder = normalizeFolderPath(String(payload?.folderPath ?? ""));
          const ownerDeptName = directory.find((u) => u.email === selfEmail)?.departmentName || "";
          const now = new Date().toISOString();

          await (client.models as any).FileShareItem.create({
            fileOwner: selfEmail,
            ownerEmail: selfEmail,
            ownerName: selfName || selfEmail,
            ownerDepartmentKey: departmentKey || "",
            ownerDepartmentName: ownerDeptName,
            displayName: proposedName,
            description: "",
            storagePath: `file-sharing/folders/${Date.now()}-${proposedName}.folder`,
            contentType: FOLDER_MIME,
            sizeBytes: 0,
            visibilityScope: "DEPARTMENT",
            folderPath: targetFolder,
            isFolder: true,
            isDeleted: false,
            sharedWithUsersJson: "[]",
            sharedWithDepartmentsJson: "[]",
            sortOrder: rows
              .filter((r) => !isDeleted(r) && folderOf(r) === targetFolder)
              .reduce((max, r) => Math.max(max, Number(r?.sortOrder ?? 0)), 0) + 1024,
            downloadCount: 0,
            createdAt: now,
            updatedAt: now,
            updatedBy: selfEmail,
          });
          await logActivity(String((row?.id ?? deptKey) || "approval"), "CREATE_FOLDER", `${selfEmail} executed approved folder creation for ${proposedName}`);
          await loadData();
          return;
        }

        if (action === "UPLOAD") {
          throw new Error(t("Upload approvals cannot be auto-executed because file data is not stored in the request."));
        }

        throw new Error(t("Unsupported approval action."));
      };

      try {
        let note = requestStatus === "APPROVED" ? "Approved by manager" : requestStatus === "REJECTED" ? "Rejected by manager" : "Cancelled by requester";
        if (executeAfterApprove && requestStatus === "APPROVED") {
          try {
            await executeApprovedAction();
            note = "Approved and executed by manager";
          } catch (executeError: any) {
            const reason = String(executeError?.message || "Execution failed").slice(0, 500);
            note = `Execution failed: ${reason}`;
          }
        }

        await (client.models as any).DriveApprovalRequest.update({
          id,
          requestStatus,
          resolvedByEmail: selfEmail,
          resolvedAt: new Date().toISOString(),
          resolutionNote: note,
          updatedAt: new Date().toISOString(),
        });
        await logActivity(id, "APPROVAL_DECISION", `${selfEmail} set ${requestStatus}`);
        await loadData();
        if (executeAfterApprove && requestStatus === "APPROVED") {
          setStatus(note.startsWith("Execution failed:") ? t("Approval saved, but execution failed. See row badge for details.") : t("Approved request executed successfully."));
        } else {
          setStatus(t("Approval queue updated."));
        }
      } catch (error: any) {
        setStatus(error?.message || t("Failed to update approval request."));
      }
    },
    [canManageAll, isAdminGroup, isDepartmentDriveManager, selfEmail, t, client, logActivity, loadData, directory, selfName, departmentKey, rows]
  );

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
      if (view === "dept") {
        const driveKey = String(row?.ownerDepartmentKey ?? "").trim();
        return canManageAll || isAdminGroup || canCrossDepartment || driveKey === String(departmentKey ?? "").trim();
      }
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
      : view === "dept" && !currentFolder
        ? departmentDriveRows
        : rowsByView.filter((row) => folderOf(row) === normalizeFolderPath(currentFolder));

    const searched = withFolder.filter((row) => matchesSearchQuery([row?.displayName, row?.description, row?.ownerName, row?.ownerEmail], query));

    return searched.sort((a, b) => {
      if (sortBy === "custom") return Number(a?.sortOrder ?? 0) - Number(b?.sortOrder ?? 0) || String(a?.displayName ?? "").localeCompare(String(b?.displayName ?? ""));
      if (sortBy === "name") return String(a?.displayName ?? "").localeCompare(String(b?.displayName ?? ""));
      if (sortBy === "size") return Number(b?.sizeBytes ?? 0) - Number(a?.sizeBytes ?? 0);
      return String(b?.updatedAt ?? b?.createdAt ?? "").localeCompare(String(a?.updatedAt ?? a?.createdAt ?? ""));
    });
  }, [rowsByView, view, currentFolder, query, sortBy, departmentDriveRows]);

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

  const activeLinks = useMemo(
    () => linkRows.filter((row) => !row?.revokedAt && Date.parse(String(row?.expiresAt ?? "")) > Date.now()),
    [linkRows]
  );

  const pendingApprovalsCount = useMemo(
    () => approvalRows.filter((row) => String(row?.requestStatus ?? "").toUpperCase() === "PENDING").length,
    [approvalRows]
  );

  const approvalQueueRows = useMemo(() => {
    return approvalRows
      .filter((row) => {
        const deptKey = String(row?.departmentKey ?? "").trim();
        const isRequester = normalizeEmail(row?.requestedByEmail) === selfEmail;
        return canManageAll || isAdminGroup || isDepartmentDriveManager(deptKey) || isRequester;
      })
      .sort((a, b) => String(b?.updatedAt ?? b?.createdAt ?? "").localeCompare(String(a?.updatedAt ?? a?.createdAt ?? "")))
      .slice(0, 40);
  }, [approvalRows, selfEmail, canManageAll, isAdminGroup, isDepartmentDriveManager]);

  const totalUsageBytes = useMemo(() => Array.from(usageByOwner.values()).reduce((sum, value) => sum + value, 0), [usageByOwner]);

  const nearQuotaCount = useMemo(() => {
    return directory.filter((user) => {
      const quota = quotaMap.get(user.email) ?? quotaMap.get("*");
      const limitMb = Math.max(1, Number(quota?.quotaMb ?? DEFAULT_QUOTA_MB));
      const usage = usageByOwner.get(user.email) ?? 0;
      return usage / (limitMb * 1024 * 1024) >= 0.85;
    }).length;
  }, [directory, quotaMap, usageByOwner]);

  const blockedUsersCount = useMemo(
    () => quotaRows.filter((row) => normalizeEmail(row?.userEmail) && normalizeEmail(row?.userEmail) !== "*" && row?.uploadBlocked).length,
    [quotaRows]
  );

  const teamSpaces = useMemo(() => {
    return departments
      .map((dept) => {
        const drive = departmentDriveRows.find((row) => String(row?.ownerDepartmentKey ?? "").trim() === dept.key);
        const drivePath = departmentDrivePath(dept.key);
        const items = rows.filter((row) => !isDeleted(row) && folderOf(row).startsWith(drivePath) && hasAccess(row));
        const filesCount = items.filter((row) => !isFolder(row)).length;
        const foldersCount = items.filter((row) => isFolder(row)).length;
        return {
          ...dept,
          drive,
          filesCount,
          foldersCount,
          totalBytes: items.reduce((sum, row) => sum + Number(row?.sizeBytes ?? 0), 0),
        };
      })
      .filter((dept) => Boolean(dept.drive) || dept.filesCount > 0 || dept.foldersCount > 0)
      .sort((a, b) => b.filesCount - a.filesCount)
      .slice(0, 6);
  }, [departments, departmentDriveRows, rows, hasAccess]);

  useEffect(() => {
    if (view === "dept" && !currentFolder && departmentDriveRows.length === 1) {
      setCurrentFolder(departmentDrivePath(String(departmentDriveRows[0]?.ownerDepartmentKey ?? "").trim()));
    }
  }, [view, currentFolder, departmentDriveRows]);

  useEffect(() => {
    if (!quotaEditorTarget) return;
    const existing = quotaMap.get(quotaEditorTarget);
    setQuotaMb(String(existing?.quotaMb ?? DEFAULT_QUOTA_MB));
    setQuotaBlocked(Boolean(existing?.uploadBlocked));
    setQuotaNotes(String(existing?.notes ?? ""));
    if (quotaEditorTarget === DEFAULT_QUOTA_KEY) {
      setQuotaEmail("");
      return;
    }
    if (quotaEditorTarget.startsWith(DEPARTMENT_QUOTA_PREFIX)) {
      setQuotaEmail("");
      return;
    }
    setQuotaEmail(quotaEditorTarget);
  }, [quotaEditorTarget, quotaMap]);

  const quickAccessRows = useMemo(() => {
    return rowsByView
      .filter((row) => !isDeleted(row))
      .slice(0, 8);
  }, [rowsByView]);

  const capabilityRows = useMemo(
    () => [
      { label: t("Upload and create"), enabled: canUpload || canCreateFolder },
      { label: t("Sharing and links"), enabled: canShare || canCreateShareLink },
      { label: t("Version history"), enabled: canViewVersions || canRestoreVersions },
      { label: t("Quota governance"), enabled: canManageQuota },
      { label: t("Analytics and oversight"), enabled: canViewAnalytics },
      { label: t("Cross-department access"), enabled: canCrossDepartment },
    ],
    [t, canUpload, canCreateFolder, canShare, canCreateShareLink, canViewVersions, canRestoreVersions, canManageQuota, canViewAnalytics, canCrossDepartment]
  );

  const approvalActionLabel = useCallback(
    (action: string) => {
      const key = String(action ?? "").toUpperCase();
      if (key === "UPLOAD") return t("Upload");
      if (key === "MOVE") return t("Move");
      if (key === "DELETE") return t("Delete");
      if (key === "FOLDER_CREATE") return t("Create Folder");
      return key || t("Unknown");
    },
    [t]
  );

  const approvalExecutionResult = useCallback(
    (row: any): { label: string; className: "success" | "error" | "pending"; reason: string } => {
      const status = String(row?.requestStatus ?? "").toUpperCase();
      const note = String(row?.resolutionNote ?? "").trim();
      if (status === "PENDING") return { label: t("Pending"), className: "pending", reason: "" };
      if (status === "APPROVED" && note.toLowerCase().startsWith("execution failed:")) {
        const reason = note.slice("Execution failed:".length).trim();
        return { label: t("Failed"), className: "error", reason };
      }
      if (status === "APPROVED") {
        return { label: t("Executed"), className: "success", reason: note || t("Action completed successfully") };
      }
      if (status === "REJECTED") return { label: t("Rejected"), className: "error", reason: note || t("Rejected by manager") };
      if (status === "CANCELLED") return { label: t("Cancelled"), className: "pending", reason: note || t("Cancelled by requester") };
      return { label: status || t("Unknown"), className: "pending", reason: note };
    },
    [t]
  );

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

  const getSiblingRows = useCallback(
    (folderPath: string) => {
      const cleanFolder = normalizeFolderPath(folderPath);
      return rows
        .filter((row) => !isDeleted(row) && folderOf(row) === cleanFolder)
        .sort((a, b) => Number(a?.sortOrder ?? 0) - Number(b?.sortOrder ?? 0) || String(a?.displayName ?? "").localeCompare(String(b?.displayName ?? "")));
    },
    [rows]
  );

  const getNextSortOrder = useCallback(
    (folderPath: string) => {
      const siblings = getSiblingRows(folderPath);
      const maxValue = siblings.reduce((max, row) => Math.max(max, Number(row?.sortOrder ?? 0)), 0);
      return maxValue + 1024;
    },
    [getSiblingRows]
  );

  const persistSiblingOrder = useCallback(
    async (orderedRows: any[], folderPath: string) => {
      const cleanFolder = normalizeFolderPath(folderPath);
      await Promise.all(
        orderedRows.map((row, index) =>
          (client.models as any).FileShareItem.update({
            id: row.id,
            folderPath: cleanFolder,
            sortOrder: (index + 1) * 1024,
            updatedAt: new Date().toISOString(),
            updatedBy: selfEmail,
          })
        )
      );
    },
    [client, selfEmail]
  );

  const reorderRows = useCallback(
    async (dragIds: string[], targetRowId: string, position: "before" | "after") => {
      const targetRow = rowById.get(targetRowId);
      if (!targetRow) return;
      const folderPath = folderOf(targetRow);
      const siblings = getSiblingRows(folderPath);
      const dragged = dragIds.map((id) => rowById.get(id)).filter((row) => row && folderOf(row) === folderPath && String(row?.id ?? "") !== String(targetRowId));
      if (!dragged.length) return;

      const draggedIds = new Set(dragged.map((row) => String(row?.id ?? "")));
      const remaining = siblings.filter((row) => !draggedIds.has(String(row?.id ?? "")));
      const targetIndex = remaining.findIndex((row) => String(row?.id ?? "") === String(targetRowId));
      if (targetIndex < 0) return;
      const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
      remaining.splice(insertIndex, 0, ...dragged);
      await persistSiblingOrder(remaining, folderPath);
      await logActivity("bulk", "REORDER", `${selfEmail} reordered ${dragged.length} item(s)`);
      setSortBy("custom");
      setReorderTarget(null);
      await loadData();
    },
    [rowById, getSiblingRows, persistSiblingOrder, logActivity, selfEmail, loadData]
  );

  const moveRowsToFolder = useCallback(
    async (items: any[], target: string) => {
      const cleanTarget = normalizeFolderPath(target);
      const targetBlock = resolveDepartmentDrivePolicyBlock(cleanTarget, "move");
      if (targetBlock) {
        await submitApprovalRequest(targetBlock, {
          folderPath: cleanTarget,
          targetFolderPath: cleanTarget,
          itemIds: items.map((row) => String(row?.id ?? "")).filter(Boolean),
          itemNames: items.map((row) => String(row?.displayName ?? "")).filter(Boolean),
        });
        return;
      }
      for (const row of items) {
        const sourceBlock = resolveDepartmentDrivePolicyBlock(folderOf(row), "move");
        if (sourceBlock) {
          await submitApprovalRequest(
            sourceBlock,
            {
              folderPath: folderOf(row),
              sourceFolderPath: folderOf(row),
              targetFolderPath: cleanTarget,
              itemIds: [String(row?.id ?? "")].filter(Boolean),
              itemNames: [String(row?.displayName ?? "")].filter(Boolean),
            },
            String(row?.id ?? "")
          );
          return;
        }
      }
      const baseSortOrder = getNextSortOrder(cleanTarget);
      await Promise.all(
        items.map((row, index) =>
          (client.models as any).FileShareItem.update({
            id: row.id,
            folderPath: cleanTarget,
            sortOrder: baseSortOrder + index,
            updatedAt: new Date().toISOString(),
            updatedBy: selfEmail,
          })
        )
      );
      await logActivity("bulk", "MOVE", `${selfEmail} moved ${items.length} item(s) to ${cleanTarget || "root"}`);
      setSelectedIds([]);
      setDragTargetPath("");
      await loadData();
    },
    [client, selfEmail, logActivity, loadData, getNextSortOrder, resolveDepartmentDrivePolicyBlock, submitApprovalRequest]
  );

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
    const approvalBlock = resolveDepartmentDrivePolicyBlock(currentFolder, "folder-create");
    if (approvalBlock) {
      await submitApprovalRequest(approvalBlock, {
        folderPath: normalizeFolderPath(currentFolder),
        proposedFolderName: clean,
      });
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
        sortOrder: getNextSortOrder(currentFolder),
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
      const relativeDirectory = getRelativeDirectory(entry.relativePath);
      const targetFolder = normalizeFolderPath([folderPart, relativeDirectory].filter(Boolean).join("/"));
      const block = resolveDepartmentDrivePolicyBlock(targetFolder, "upload", entry.file.size / (1024 * 1024));
      if (block) {
        setSaving(false);
        await submitApprovalRequest(block, {
          folderPath: targetFolder,
          files: files.map((item) => ({
            name: item.file.name,
            sizeBytes: item.file.size,
            contentType: item.file.type,
          })),
        });
        return;
      }
    }

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
          sortOrder: getNextSortOrder(targetFolder),
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

  const openEditorInNewTab = (kind: "doc" | "sheet" | "slides" | "form", fileId?: string, fileName?: string) => {
    const editorType = EDITOR_KIND_TO_TYPE[kind];
    const params = new URLSearchParams({ editor: editorType });
    if (fileId) params.set("fileId", fileId);
    if (fileName) params.set("fileName", fileName);
    const editorUrl = `/editor.html?${params.toString()}`;

    window.open(editorUrl, "_blank", "noopener,noreferrer,width=1400,height=900");
  };

  const openDesktopOfficeApp = async (row: any) => {
    const kind = editorKindFromRow(row);
    if (kind !== "doc" && kind !== "sheet") return false;

    const fileId = String(row?.id ?? "").trim();
    const contentType = String(row?.contentType ?? "").trim().toLowerCase();
    let storagePath = String(row?.storagePath ?? "").trim();
    if (!storagePath) return false;

    const needsDocUpgrade = kind === "doc" && (contentType !== DOC_MIME || !storagePath.toLowerCase().endsWith(".docx"));
    const needsSheetUpgrade = kind === "sheet" && (contentType !== SHEET_MIME || !storagePath.toLowerCase().endsWith(".xlsx"));

    if (fileId && (needsDocUpgrade || needsSheetUpgrade)) {
      try {
        const upgradedPath = kind === "doc"
          ? `file-sharing/editors/doc/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.docx`
          : `file-sharing/editors/sheet/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.xlsx`;

        const blob = kind === "doc"
          ? await buildDocxBlob(String(row?.description ?? ""))
          : (() => {
              let parsed: Record<string, string> = {};
              try {
                const raw = JSON.parse(String(row?.description ?? "{}"));
                if (raw && typeof raw === "object") parsed = raw as Record<string, string>;
              } catch {
                parsed = {};
              }
              return buildXlsxBlob(parsed);
            })();

        await uploadData({ path: upgradedPath, data: blob, options: { contentType: kind === "doc" ? DOC_MIME : SHEET_MIME } }).result;
        await (client.models as any).FileShareItem.update({
          id: fileId,
          storagePath: upgradedPath,
          contentType: kind === "doc" ? DOC_MIME : SHEET_MIME,
          sizeBytes: blob.size,
          updatedAt: new Date().toISOString(),
          updatedBy: selfEmail,
        });
        storagePath = upgradedPath;
      } catch {
        setStatus(t("Failed to convert this file to a native Office format."));
        return false;
      }
    }

    try {
      const out = await getUrl({ path: storagePath });
      const fileUrl = out.url.toString();
      const protocolUrl = kind === "doc"
        ? `ms-word:ofe|u|${fileUrl}`
        : `ms-excel:ofe|u|${fileUrl}`;

      // Show beautiful custom modal before triggering protocol URL
      const displayName = String(row?.displayName ?? (kind === "doc" ? "Document" : "Spreadsheet"));
      setOpenOfficeModal({ kind, displayName, protocolUrl });
      await logActivity(String(row?.id ?? storagePath), "OPEN_DESKTOP", `${selfEmail} opened ${displayName} in desktop app flow`);
      return true;
    } catch {
      setStatus(t("Unable to launch desktop Office app for this file."));
      return false;
    }
  };

  const launchDesktopOfficeProtocol = (protocolUrl: string) => {
    try {
      const probe = document.createElement("iframe");
      probe.style.display = "none";
      probe.setAttribute("aria-hidden", "true");
      probe.src = protocolUrl;
      document.body.appendChild(probe);
      window.setTimeout(() => {
        try {
          document.body.removeChild(probe);
        } catch {
          // noop
        }
      }, 1200);
    } catch {
      window.location.href = protocolUrl;
    }
  };

  const createTemplateAndOpenEditor = async (kind: "doc" | "sheet" | "slides" | "form") => {
    if (!canUpload) {
      setStatus(t("You do not have permission to create files."));
      return;
    }

    if (selfUploadBlocked) {
      setStatus(t("Your upload permission is blocked by drive administrator."));
      return;
    }

    const ownerDeptName = directory.find((u) => u.email === selfEmail)?.departmentName || "";
    const targetFolder = normalizeFolderPath(currentFolder);
    const block = resolveDepartmentDrivePolicyBlock(targetFolder, "upload", 0);
    if (block) {
      await submitApprovalRequest(block, {
        folderPath: targetFolder,
        templateKind: kind,
        itemName: EDITOR_KIND_DEFAULT_NAME[kind],
      });
      return;
    }

    setSaving(true);
    setStatus("");
    setIsNewMenuOpen(false);

    try {
      const now = new Date().toISOString();
      const storagePath = kind === "doc"
        ? `file-sharing/editors/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.docx`
        : kind === "sheet"
          ? `file-sharing/editors/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.xlsx`
          : `file-sharing/editors/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;

      const initialPayload = kind === "form"
            ? JSON.stringify({ fields: [], description: "" })
            : JSON.stringify([{ id: "1", title: "Slide Title", content: "Click to add subtitle" }]);

      const initialBlob = kind === "doc"
        ? await buildDocxBlob("")
        : kind === "sheet"
          ? buildXlsxBlob()
          : new Blob([initialPayload], { type: "application/json" });

      const initialContentType = kind === "doc"
        ? DOC_MIME
        : kind === "sheet"
          ? SHEET_MIME
          : "application/json";

      await uploadData({ path: storagePath, data: initialBlob, options: { contentType: initialContentType } }).result;

      const created = await (client.models as any).FileShareItem.create({
        fileOwner: selfEmail,
        ownerEmail: selfEmail,
        ownerName: selfName || selfEmail,
        ownerDepartmentKey: departmentKey || "",
        ownerDepartmentName: ownerDeptName,
        displayName: EDITOR_KIND_DEFAULT_NAME[kind],
        description: kind === "sheet" ? "{}" : kind === "form" ? JSON.stringify({ fields: [], description: "" }) : kind === "slides" ? JSON.stringify([{ id: "1", title: "Slide Title", content: "Click to add subtitle" }]) : "",
        storagePath,
        contentType: kind === "doc" ? DOC_MIME : kind === "sheet" ? SHEET_MIME : EDITOR_KIND_TO_MIME[kind],
        sizeBytes: initialBlob.size,
        visibilityScope: scope,
        folderPath: targetFolder,
        isFolder: false,
        isDeleted: false,
        sharedWithUsersJson: JSON.stringify(selectedUsers),
        sharedWithDepartmentsJson: JSON.stringify(selectedDepartments),
        starredByJson: "[]",
        sortOrder: getNextSortOrder(targetFolder),
        downloadCount: 0,
        kind,
        createdAt: now,
        updatedAt: now,
        updatedBy: selfEmail,
      });

      const newId = String(created?.data?.id ?? "");
      const newName = String(created?.data?.displayName ?? EDITOR_KIND_DEFAULT_NAME[kind]);
      await logActivity(newId || `editor-${kind}`, "CREATE_FILE", `${selfEmail} created ${kind} file ${newName}`);
      await loadData();

      if (kind === "doc" || kind === "sheet") {
        await openDesktopOfficeApp({
          ...(created?.data ?? {}),
          id: newId,
          displayName: newName,
          kind,
          storagePath,
        });
        return;
      }

      openEditorInNewTab(kind, newId, newName);
    } catch (error: any) {
      setStatus(error?.message || t("Failed to create file."));
    } finally {
      setSaving(false);
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
      await moveRowsToFolder([row], target);
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
    const deptFolder = folderOf(row) || departmentDrivePath(String(row?.ownerDepartmentKey ?? "").trim());
    const approvalBlock = resolveDepartmentDrivePolicyBlock(deptFolder, "delete");
    if (approvalBlock) {
      await submitApprovalRequest(
        approvalBlock,
        {
          folderPath: deptFolder,
          itemId: String(row?.id ?? ""),
          itemName: String(row?.displayName ?? ""),
        },
        String(row?.id ?? "")
      );
      return;
    }

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

    const rawTarget = String(targetEmailRaw ?? "").trim();
    const target = rawTarget === DEFAULT_QUOTA_KEY || rawTarget.startsWith(DEPARTMENT_QUOTA_PREFIX) ? rawTarget : normalizeEmail(rawTarget);
    const nextQuotaMb = Math.max(1, Number(quotaMb || DEFAULT_QUOTA_MB));
    if (!target) return setStatus(t("Please choose a user."));

    const existing = quotaRows.find((q) => String(q?.userEmail ?? "").trim() === target || normalizeEmail(q?.userEmail) === target);
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
      setQuotaEditorTarget(target);
      setStatus(t("Storage quota updated."));
    } catch (error: any) {
      setStatus(error?.message || t("Failed to update storage quota."));
    }
  };

  const saveDepartmentDrive = async () => {
    if (!canAdminPanel) return setStatus(t("You do not have permission to manage department drives."));
    const targetDept = departments.find((dept) => dept.key === driveDepartmentKey);
    if (!targetDept) return setStatus(t("Please choose a department."));

    const existing = departmentSpaceRows.find((row) => String(row?.departmentKey ?? "").trim() === targetDept.key);
    const existingRoot = rows.find((row) => !isDeleted(row) && isDepartmentDriveRoot(row) && String(row?.ownerDepartmentKey ?? "").trim() === targetDept.key);
    const nextName = String(driveName || `${targetDept.name} Drive`).trim();
    const rootPath = departmentDrivePath(targetDept.key);
    const payload = {
      departmentKey: targetDept.key,
      departmentName: targetDept.name,
      displayName: nextName,
      description: String(driveDescription || `${targetDept.name} managed shared drive`).trim(),
      rootFolderPath: rootPath,
      managersJson: JSON.stringify({
        managers: driveManagers.map(normalizeEmail).filter(Boolean),
        approvalRules: {
          requireApprovalForUpload: driveRequireApprovalForUpload,
          requireApprovalForMove: driveRequireApprovalForMove,
          requireApprovalForDelete: driveRequireApprovalForDelete,
          requireApprovalForFolderCreate: driveRequireApprovalForFolderCreate,
          maxUploadMbWithoutApproval: Math.max(0, Number(driveMaxUploadWithoutApprovalMb || 0)),
        },
      }),
      sortOrder: existing?.sortOrder ?? departmentDriveRows.length * 1024 + 1024,
      updatedAt: new Date().toISOString(),
      updatedBy: selfEmail,
    };

    try {
      if (existing?.id) {
        await (client.models as any).DriveDepartmentSpace.update({ id: existing.id, ...payload });
      } else {
        await (client.models as any).DriveDepartmentSpace.create({
          ...payload,
          uploadBlocked: false,
          createdAt: new Date().toISOString(),
        });
      }

      if (existingRoot?.id) {
        await (client.models as any).FileShareItem.update({
          id: existingRoot.id,
          displayName: nextName,
          description: String(driveDescription || `${targetDept.name} managed shared drive`).trim(),
          sortOrder: payload.sortOrder,
          updatedAt: new Date().toISOString(),
          updatedBy: selfEmail,
        });
      } else {
        await (client.models as any).FileShareItem.create({
          fileOwner: selfEmail,
          ownerEmail: selfEmail,
          ownerName: selfName || selfEmail,
          ownerDepartmentKey: targetDept.key,
          ownerDepartmentName: targetDept.name,
          displayName: nextName,
          description: String(driveDescription || `${targetDept.name} managed shared drive`).trim(),
          storagePath: `file-sharing/drives/${targetDept.key}/.drive-folder`,
          contentType: FOLDER_MIME,
          sizeBytes: 0,
          visibilityScope: "DEPARTMENT",
          folderPath: DEPARTMENT_DRIVE_ROOT,
          isFolder: true,
          isDeleted: false,
          sharedWithUsersJson: "[]",
          sharedWithDepartmentsJson: JSON.stringify([targetDept.key]),
          starredByJson: "[]",
          sortOrder: payload.sortOrder,
          downloadCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          updatedBy: selfEmail,
        });
      }
      await logActivity(targetDept.key, "DEPARTMENT_DRIVE", `${selfEmail} provisioned drive ${nextName}`);
      setDriveName("");
      setDriveDescription("");
      setDriveManagers([]);
      setDriveRequireApprovalForUpload(false);
      setDriveRequireApprovalForMove(false);
      setDriveRequireApprovalForDelete(false);
      setDriveRequireApprovalForFolderCreate(false);
      setDriveMaxUploadWithoutApprovalMb("0");
      await loadData();
      setStatus(t("Department drive saved."));
    } catch (error: any) {
      setStatus(error?.message || t("Failed to save department drive."));
    }
  };

  const openFileInEditor = (row: any) => {
    const kind = editorKindFromRow(row);
    const editorType = kind ? EDITOR_KIND_TO_TYPE[kind] : "";
    if (!editorType) return false;

    const fileId = String(row?.id ?? "");
    const fileName = String(row?.displayName ?? "");
    const editorUrl = `/editor.html?editor=${editorType}&fileId=${encodeURIComponent(fileId)}&fileName=${encodeURIComponent(fileName)}`;

    window.open(editorUrl, "_blank", "noopener,noreferrer,width=1400,height=900");
    return true;
  };

  const openRow = async (row: any) => {
    if (isFolder(row)) {
      if (isDepartmentDriveRoot(row)) {
        setView("dept");
        setCurrentFolder(departmentDrivePath(String(row?.ownerDepartmentKey ?? "").trim()));
      } else {
        setView("my");
        setCurrentFolder(getFolderTargetPath(row));
      }
      return;
    }

    const kind = editorKindFromRow(row);

    // Docs/Sheets are desktop-only by policy.
    if (kind === "doc" || kind === "sheet") {
      await openDesktopOfficeApp(row);
      return;
    }

    // Then try in-browser editor for drive-native editor types.
    if (openFileInEditor(row)) {
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
      await moveRowsToFolder(selectedRows, target);
    } catch (error: any) {
      setStatus(error?.message || t("Failed to move selected items."));
    }
  };

  const handleItemDragStart = (row: any) => {
    if (!canMove) return;
    const rowId = String(row?.id ?? "");
    dragIdsRef.current = selectedIds.includes(rowId) ? selectedRows.map((item) => String(item?.id ?? "")).filter(Boolean) : [rowId];
  };

  const handleFolderDragOver = (event: React.DragEvent, targetPath: string) => {
    if (!canMove || !dragIdsRef.current.length) return;
    event.preventDefault();
    setDragTargetPath(normalizeFolderPath(targetPath));
  };

  const handleFolderDrop = async (event: React.DragEvent, targetPath: string) => {
    if (!canMove || !dragIdsRef.current.length) return;
    event.preventDefault();
    const items = dragIdsRef.current.map((id) => rowById.get(id)).filter(Boolean);
    dragIdsRef.current = [];
    try {
      await moveRowsToFolder(items, targetPath);
    } catch (error: any) {
      setStatus(error?.message || t("Failed to move dragged items."));
    }
  };

  const handleRowReorderDragOver = (event: React.DragEvent, row: any) => {
    if (!canMove || !dragIdsRef.current.length || sortBy !== "custom") return;
    const rowId = String(row?.id ?? "");
    if (!rowId || dragIdsRef.current.includes(rowId)) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setReorderTarget({ rowId, position });
  };

  const handleRowReorderDrop = async (event: React.DragEvent, row: any) => {
    if (!canMove || !dragIdsRef.current.length || sortBy !== "custom") return;
    event.preventDefault();
    const draggedIds = [...dragIdsRef.current];
    dragIdsRef.current = [];
    try {
      await reorderRows(draggedIds, String(row?.id ?? ""), reorderTarget?.rowId === String(row?.id ?? "") ? reorderTarget.position : "after");
    } catch (error: any) {
      setStatus(error?.message || t("Failed to reorder dragged items."));
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
      {openOfficeModal && (
        <div className="filesharing-modal-backdrop office-launch-backdrop" onClick={() => setOpenOfficeModal(null)}>
          <div className="office-launch-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="office-launch-close" onClick={() => setOpenOfficeModal(null)}>&#x2715;</button>
            <div className="office-launch-icon-wrap">
              {openOfficeModal.kind === "doc" ? (
                <span className="office-launch-icon office-launch-icon--word">
                  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" width="48" height="48">
                    <rect width="48" height="48" rx="10" fill="#2B579A"/>
                    <path d="M28 10h-14a2 2 0 0 0-2 2v24a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2V18l-8-8z" fill="white" fillOpacity="0.15"/>
                    <path d="M28 10v8h8" fill="white" fillOpacity="0.3"/>
                    <text x="24" y="32" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="Arial">W</text>
                  </svg>
                </span>
              ) : (
                <span className="office-launch-icon office-launch-icon--excel">
                  <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" width="48" height="48">
                    <rect width="48" height="48" rx="10" fill="#217346"/>
                    <path d="M28 10h-14a2 2 0 0 0-2 2v24a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2V18l-8-8z" fill="white" fillOpacity="0.15"/>
                    <path d="M28 10v8h8" fill="white" fillOpacity="0.3"/>
                    <text x="24" y="32" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="Arial">X</text>
                  </svg>
                </span>
              )}
            </div>
            <div className="office-launch-title">
              {openOfficeModal.kind === "doc" ? t("Opening in Microsoft Word") : t("Opening in Microsoft Excel")}
            </div>
            <div className="office-launch-filename">{openOfficeModal.displayName}</div>
            <p className="office-launch-hint">
              {openOfficeModal.kind === "doc"
                ? t("This document will open in Microsoft Word on your computer.")
                : t("This spreadsheet will open in Microsoft Excel on your computer.")}
            </p>
            <div className="office-launch-actions">
              <button
                type="button"
                className="office-launch-btn office-launch-btn--primary"
                onClick={() => {
                  launchDesktopOfficeProtocol(openOfficeModal.protocolUrl);
                  setTimeout(() => setOpenOfficeModal(null), 1200);
                }}
              >
                <i className={openOfficeModal.kind === "doc" ? "fas fa-file-word" : "fas fa-file-excel"} />
                {openOfficeModal.kind === "doc" ? t("Open in Word") : t("Open in Excel")}
              </button>
              <button type="button" className="office-launch-btn office-launch-btn--secondary" onClick={() => setOpenOfficeModal(null)}>
                {t("Cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
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
            <option value="custom">{t("Custom order")}</option>
            <option value="modified">{t("Last modified")}</option>
            <option value="name">{t("Name")}</option>
            <option value="size">{t("Size")}</option>
          </select>
          <button type="button" onClick={() => void loadData()} disabled={loading}>{t("Refresh")}</button>
        </div>
      </section>

      <section className="drive-workspace-strip">
        <div className="drive-workspace-copy">
          <div className="drive-workspace-kicker">{t("Company workspace")}</div>
          <h1>{t("Simple department sharing, modern drive style")}</h1>
          <p>
            {t("Upload, organize, share, and govern files from one workspace while keeping quota and permission control in admin hands.")}
          </p>
          <div className="drive-chip-row">
            <span className="drive-chip"><i className="fas fa-hdd" /> {formatBytes(selfUsageBytes)} / {selfQuotaMb} MB</span>
            <span className="drive-chip"><i className="fas fa-building" /> {directory.find((u) => u.email === selfEmail)?.departmentName || t("No department")}</span>
            <span className="drive-chip"><i className="fas fa-link" /> {activeLinks.length} {t("active links")}</span>
          </div>
        </div>
        <div className="drive-workspace-actions">
          {canUpload ? <button type="button" className="filesharing-primary" onClick={openUploadPicker}><i className="fas fa-file-arrow-up" /> {t("Upload")}</button> : null}
          {canCreateFolder ? <button type="button" onClick={openNewFolderComposer}><i className="fas fa-folder-plus" /> {t("Folder")}</button> : null}
          {canAdminPanel ? <button type="button" onClick={() => setView("admin")}><i className="fas fa-shield-halved" /> {t("Admin console")}</button> : null}
        </div>
      </section>

      <section className="drive-shell">
        <aside className="drive-sidebar">
          <section className="drive-storage-card">
            <div className="drive-storage-card-top">
              <strong>{t("My storage")}</strong>
              <span>{Math.min(100, Math.round((selfUsageBytes / (selfQuotaMb * 1024 * 1024)) * 100))}%</span>
            </div>
            <div className="drive-usage-bar"><span style={{ width: `${Math.min(100, Math.round((selfUsageBytes / (selfQuotaMb * 1024 * 1024)) * 100))}%` }} /></div>
            <div className="drive-storage-card-meta">
              <span>{formatBytes(selfUsageBytes)}</span>
              <span>{selfQuotaMb} MB</span>
            </div>
            {selfUploadBlocked ? <div className="drive-alert error">{t("Uploads are currently blocked for your account.")}</div> : null}
          </section>

          <div className="drive-new-wrap">
            <button type="button" className="drive-new-button" onClick={() => setIsNewMenuOpen((prev) => !prev)}>
              <i className="fas fa-plus" /> {t("New")}
            </button>
            {isNewMenuOpen ? (
              <div className="drive-new-menu">
                {canCreateFolder ? <button type="button" onClick={openNewFolderComposer}><i className="fas fa-folder" /> {t("New folder")}</button> : null}
                {canUpload ? <button type="button" onClick={openUploadPicker}><i className="fas fa-file-arrow-up" /> {t("File upload")}</button> : null}
                {canUpload ? <button type="button" onClick={openFolderPicker}><i className="fas fa-folder-plus" /> {t("Folder upload")}</button> : null}
                <div className="drive-new-menu-separator" />
                {canUpload ? <button type="button" onClick={() => void createTemplateAndOpenEditor("doc")}><i className="fas fa-file-lines" /> {t("Docs")}</button> : null}
                {canUpload ? <button type="button" onClick={() => void createTemplateAndOpenEditor("sheet")}><i className="fas fa-table" /> {t("Sheets")}</button> : null}
                {canUpload ? <button type="button" onClick={() => void createTemplateAndOpenEditor("slides")}><i className="fas fa-chalkboard" /> {t("Slides")}</button> : null}
                {canUpload ? <button type="button" onClick={() => void createTemplateAndOpenEditor("form")}><i className="fas fa-list-check" /> {t("Forms")}</button> : null}
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
              <h4>{t("Workspaces")}</h4>
              {departmentDriveRows.map((row) => {
                const targetPath = departmentDrivePath(String(row?.ownerDepartmentKey ?? "").trim());
                return (
                  <button
                    key={`drive-${row.id}`}
                    type="button"
                    className={currentFolder === targetPath ? "active" : dragTargetPath === targetPath ? "drag-target" : ""}
                    onClick={() => {
                      setView("dept");
                      setCurrentFolder(targetPath);
                    }}
                    onDragOver={(event) => handleFolderDragOver(event, targetPath)}
                    onDragLeave={() => setDragTargetPath("")}
                    onDrop={(event) => void handleFolderDrop(event, targetPath)}
                  >
                    <i className="fas fa-building" /> {String(row?.ownerDepartmentName || row?.displayName || t("Department Drive"))}
                  </button>
                );
              })}
              <h4>{t("Folders")}</h4>
              <button
                type="button"
                className={!currentFolder ? "active" : dragTargetPath === "" ? "drag-target" : ""}
                onClick={() => setCurrentFolder("")}
                onDragOver={(event) => handleFolderDragOver(event, "")}
                onDragLeave={() => setDragTargetPath("")}
                onDrop={(event) => void handleFolderDrop(event, "")}
              >
                {t("Root")}
              </button>
              {allFolders.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={currentFolder === f ? "active" : dragTargetPath === f ? "drag-target" : ""}
                  onClick={() => setCurrentFolder(f)}
                  onDragOver={(event) => handleFolderDragOver(event, f)}
                  onDragLeave={() => setDragTargetPath("")}
                  onDrop={(event) => void handleFolderDrop(event, f)}
                >
                  {f}
                </button>
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
                  <h1>{view === "home" ? t("Welcome to Drive") : t("Drive Workspace")}</h1>
                  <p>{view === "home" ? t("Find your recent and suggested content quickly.") : t("Files, folders, sharing, versioning, and governance in one place.")}</p>
                </div>
                <div className="drive-metrics">
                  <div><strong>{rows.filter((r) => !isDeleted(r)).length}</strong><span>{t("Active items")}</span></div>
                  <div><strong>{formatBytes(selfUsageBytes)}</strong><span>{t("My usage")}</span></div>
                  <div><strong>{selfQuotaMb} MB</strong><span>{t("My quota")}</span></div>
                </div>
              </section>

              <section className="drive-overview-grid">
                <div className="drive-overview-card">
                  <span>{t("Quick access")}</span>
                  <strong>{quickAccessRows.length}</strong>
                  <small>{t("Recent files and folders ready to open")}</small>
                </div>
                <div className="drive-overview-card">
                  <span>{t("Shared with me")}</span>
                  <strong>{rows.filter((row) => !isDeleted(row) && normalizeEmail(row?.ownerEmail) !== selfEmail && hasAccess(row)).length}</strong>
                  <small>{t("Items from other users you can open now")}</small>
                </div>
                <div className="drive-overview-card">
                  <span>{t("Department spaces")}</span>
                  <strong>{teamSpaces.length}</strong>
                  <small>{t("Shared team areas available in your workspace")}</small>
                </div>
                <div className="drive-overview-card">
                  <span>{t("Active links")}</span>
                  <strong>{activeLinks.length}</strong>
                  <small>{t("External shares currently live")}</small>
                </div>
              </section>

              <div className="drive-breadcrumb">
                {breadcrumb.map((node) => (
                  <button
                    key={node.path || "root"}
                    type="button"
                    className={dragTargetPath === node.path ? "drag-target" : ""}
                    onClick={() => setCurrentFolder(node.path)}
                    onDragOver={(event) => handleFolderDragOver(event, node.path)}
                    onDragLeave={() => setDragTargetPath("")}
                    onDrop={(event) => void handleFolderDrop(event, node.path)}
                  >
                    {node.label}
                  </button>
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
                    <div className="drive-card-title">{t("Quick access")}</div>
                    <div className="drive-quick-access-grid">
                      {quickAccessRows.length ? quickAccessRows.map((row) => (
                        <button key={row.id} type="button" className="drive-quick-access-card" onClick={() => void openRow(row)}>
                          <div className="drive-quick-access-icon"><i className={fileIcon(String(row?.contentType ?? ""), isFolder(row))} /></div>
                          <div>
                            <strong>{String(row?.displayName || t("Untitled"))}</strong>
                            <span>{String(row?.ownerName || row?.ownerEmail || "-")}</span>
                          </div>
                        </button>
                      )) : <div className="filesharing-empty">{t("No quick access items yet")}</div>}
                    </div>
                  </section>

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

                  <section className="drive-card">
                    <div className="drive-card-title">{t("Department spaces")}</div>
                    <div className="drive-team-grid">
                      {teamSpaces.length ? teamSpaces.map((space) => (
                        <div key={space.key} className="drive-team-card">
                          <div className="drive-team-card-head">
                            <strong>{space.name}</strong>
                            <span>{space.foldersCount} {t("folders")}</span>
                          </div>
                          <div className="drive-team-card-meta">
                            <span>{space.filesCount} {t("files")}</span>
                            <span>{formatBytes(space.totalBytes)}</span>
                          </div>
                          <button type="button" onClick={() => { setView("dept"); setCurrentFolder(departmentDrivePath(space.key)); }}>{t("Open workspace")}</button>
                        </div>
                      )) : <div className="filesharing-empty">{t("No department spaces available yet")}</div>}
                    </div>
                  </section>
                </section>
              ) : null}

              {view !== "home" ? <section className="drive-card">
                <div className="drive-card-title">{t("Drive items")} ({visibleRows.length})</div>
                {visibleRows.length === 0 ? <div className="filesharing-empty">{t("No items found")}</div> : null}

                {layout === "list" && visibleRows.length ? (
                  <div className="drive-list-header">
                    <span>{t("Name")}</span>
                    <span>{t("Owner / visibility")}</span>
                    <span>{t("Size")}</span>
                    <span>{t("Actions")}</span>
                  </div>
                ) : null}

                <div className={layout === "grid" ? "drive-items-grid" : "drive-items-list"}>
                  {visibleRows.map((row) => {
                    const folder = isFolder(row);
                    const ct = String(row?.contentType ?? "");
                    const stars = parseJsonArray(row?.starredByJson).map(normalizeEmail);
                    const starred = stars.includes(selfEmail);

                    return (
                      <div
                        key={row.id}
                        className={`filesharing-item ${layout === "grid" ? "as-grid" : ""} ${selectedIds.includes(String(row?.id ?? "")) ? "is-selected" : ""} ${reorderTarget?.rowId === String(row?.id ?? "") ? `reorder-${reorderTarget.position}` : ""}`}
                        draggable={canMove}
                        onDragStart={() => handleItemDragStart(row)}
                        onDragEnd={() => { setDragTargetPath(""); setReorderTarget(null); }}
                        onDragOver={layout === "list" && sortBy === "custom" ? (event) => handleRowReorderDragOver(event, row) : folder ? (event) => handleFolderDragOver(event, getFolderTargetPath(row)) : undefined}
                        onDrop={layout === "list" && sortBy === "custom" ? (event) => void handleRowReorderDrop(event, row) : folder ? (event) => void handleFolderDrop(event, getFolderTargetPath(row)) : undefined}
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

                        <div className="filesharing-item-size">
                          <strong>{folder ? t("Folder") : formatBytes(Number(row?.sizeBytes ?? 0))}</strong>
                          <span>{String(row?.updatedAt ?? row?.createdAt ?? "")}</span>
                        </div>

                        <div className="filesharing-item-actions">
                          {canStar ? <button type="button" onClick={(event) => { event.stopPropagation(); void toggleStar(row); }} title={t("Star")}>{starred ? "★" : "☆"}</button> : null}
                          <button type="button" title={t("Open")} onClick={(event) => { event.stopPropagation(); void openRow(row); }}><i className="fas fa-arrow-up-right-from-square" /></button>
                          <div className="drive-row-menu-wrap">
                            <button type="button" title={t("More actions")} onClick={(event) => { event.stopPropagation(); setRowMenuId((prev) => prev === String(row?.id ?? "") ? "" : String(row?.id ?? "")); }}><i className="fas fa-ellipsis-vertical" /></button>
                            {rowMenuId === String(row?.id ?? "") ? (
                              <div className="drive-inline-menu" onClick={(event) => event.stopPropagation()}>
                                {!folder ? <PermissionGate moduleId="filesharing" optionId="filesharing_download"><button type="button" onClick={() => void downloadFile(row)}>{t("Download")}</button></PermissionGate> : null}
                                {!folder ? <PermissionGate moduleId="filesharing" optionId="filesharing_view"><button type="button" onClick={() => void openPreview(row)}>{t("Preview")}</button></PermissionGate> : null}
                                {canRenameRow(row) ? <button type="button" onClick={() => beginRename(row)}>{t("Rename")}</button> : null}
                                {canMove ? <button type="button" onClick={() => void moveRow(row)}>{t("Move")}</button> : null}
                                {!folder && canCreateShareLink ? <button type="button" onClick={() => setLinkTargetId((prev) => prev === row.id ? "" : row.id)}>{t("Links")}</button> : null}
                                {!folder && canViewVersions ? <button type="button" onClick={() => setVersionTargetId((prev) => prev === row.id ? "" : row.id)}>{t("Versions")}</button> : null}
                                {!folder && canUpload ? <button type="button" onClick={() => void replaceWithNewVersion(row)}>{t("Upload version")}</button> : null}
                                {view === "trash" ? <button type="button" onClick={() => void restoreRow(row)}>{t("Restore")}</button> : null}
                                {!isDeleted(row) ? <button type="button" className="danger" onClick={() => void deleteRow(row)}>{t("Delete")}</button> : null}
                              </div>
                            ) : null}
                          </div>
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
            <section className="drive-admin-layout">
              <section className="drive-admin-summary-grid">
                <div className="drive-overview-card">
                  <span>{t("Total storage")}</span>
                  <strong>{formatBytes(totalUsageBytes)}</strong>
                  <small>{t("Across all visible owners")}</small>
                </div>
                <div className="drive-overview-card">
                  <span>{t("Users near quota")}</span>
                  <strong>{nearQuotaCount}</strong>
                  <small>{t("Above 85% of their allocation")}</small>
                </div>
                <div className="drive-overview-card">
                  <span>{t("Blocked uploads")}</span>
                  <strong>{blockedUsersCount}</strong>
                  <small>{t("Accounts currently prevented from uploading")}</small>
                </div>
                <div className="drive-overview-card">
                  <span>{t("Pending approvals")}</span>
                  <strong>{pendingApprovalsCount}</strong>
                  <small>{t("Manager decisions waiting in queue")}</small>
                </div>
                <div className="drive-overview-card">
                  <span>{t("Live shared links")}</span>
                  <strong>{activeLinks.length}</strong>
                  <small>{t("External sharing links still active")}</small>
                </div>
              </section>

              <section className="drive-card drive-admin-grid">
                <div>
                <div className="drive-card-title">{t("Storage governance")}</div>
                <p className="drive-admin-intro">{t("Allocate storage, block uploads, and watch usage before departments hit capacity.")}</p>
                <div className="drive-card-title drive-top-gap">{t("Quota target")}</div>
                <div className="drive-quota-targets">
                  <button type="button" className={quotaEditorTarget === DEFAULT_QUOTA_KEY ? "active" : ""} onClick={() => setQuotaEditorTarget(DEFAULT_QUOTA_KEY)}>{t("Default policy")}</button>
                  {departments.map((dept) => {
                    const target = departmentQuotaKey(dept.key);
                    return <button key={target} type="button" className={quotaEditorTarget === target ? "active" : ""} onClick={() => setQuotaEditorTarget(target)}>{dept.name}</button>;
                  })}
                </div>
                <div className="drive-inline-actions">
                  <select value={quotaEmail} onChange={(e) => { setQuotaEmail(e.target.value); setQuotaEditorTarget(e.target.value || DEFAULT_QUOTA_KEY); }}>
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
                  <button type="button" onClick={() => void saveQuota(quotaEditorTarget)} disabled={!canManageQuota}>{t("Save quota policy")}</button>
                  <button type="button" onClick={() => setQuotaEditorTarget(DEFAULT_QUOTA_KEY)}>{t("Reset target")}</button>
                </div>
                <div className="drive-card-title drive-top-gap">{t("Department drives")}</div>
                <div className="drive-inline-actions">
                  <select value={driveDepartmentKey} onChange={(e) => {
                    const nextKey = e.target.value;
                    setDriveDepartmentKey(nextKey);
                    const dept = departments.find((item) => item.key === nextKey);
                    const existing = departmentDriveRows.find((row) => String(row?.ownerDepartmentKey ?? "").trim() === nextKey);
                    const nativeSpace = departmentSpaceRows.find((row) => String(row?.departmentKey ?? "").trim() === nextKey);
                    const managerConfig = parseDepartmentManagersConfig(nativeSpace?.managersJson);
                    setDriveName(existing?.displayName ?? `${dept?.name ?? nextKey} Drive`);
                    setDriveDescription(existing?.description ?? `${dept?.name ?? nextKey} managed shared drive`);
                    setDriveManagers(managerConfig.managers);
                    setDriveRequireApprovalForUpload(Boolean(managerConfig.approvalRules.requireApprovalForUpload));
                    setDriveRequireApprovalForMove(Boolean(managerConfig.approvalRules.requireApprovalForMove));
                    setDriveRequireApprovalForDelete(Boolean(managerConfig.approvalRules.requireApprovalForDelete));
                    setDriveRequireApprovalForFolderCreate(Boolean(managerConfig.approvalRules.requireApprovalForFolderCreate));
                    setDriveMaxUploadWithoutApprovalMb(String(Number(managerConfig.approvalRules.maxUploadMbWithoutApproval || 0)));
                  }}>
                    <option value="">{t("Select department")}</option>
                    {departments.map((dept) => <option key={dept.key} value={dept.key}>{dept.name}</option>)}
                  </select>
                  <input value={driveName} onChange={(e) => setDriveName(e.target.value)} placeholder={t("Drive name")} />
                </div>
                <div className="drive-inline-actions">
                  <input value={driveDescription} onChange={(e) => setDriveDescription(e.target.value)} placeholder={t("Drive description")} />
                </div>
                <div className="drive-inline-actions">
                  <select
                    value=""
                    onChange={(e) => {
                      const email = normalizeEmail(e.target.value);
                      if (!email) return;
                      setDriveManagers((prev) => (prev.includes(email) ? prev : [...prev, email]));
                    }}
                  >
                    <option value="">{t("Add manager")}</option>
                    {directory
                      .filter((u) => !driveDepartmentKey || String(u.departmentKey ?? "").trim() === driveDepartmentKey)
                      .map((u) => (
                        <option key={u.email} value={u.email}>{u.fullName} ({u.email})</option>
                      ))}
                  </select>
                  <input
                    value={driveMaxUploadWithoutApprovalMb}
                    onChange={(e) => setDriveMaxUploadWithoutApprovalMb(e.target.value)}
                    placeholder={t("Upload bypass MB")}
                  />
                </div>
                {driveManagers.length ? (
                  <div className="drive-inline-actions">
                    {driveManagers.map((email) => (
                      <button key={email} type="button" onClick={() => setDriveManagers((prev) => prev.filter((v) => v !== email))}>
                        {directory.find((u) => u.email === email)?.fullName || email} ×
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="drive-inline-actions">
                  <label><input type="checkbox" checked={driveRequireApprovalForUpload} onChange={(e) => setDriveRequireApprovalForUpload(e.target.checked)} /> {t("Require manager approval for uploads")}</label>
                  <label><input type="checkbox" checked={driveRequireApprovalForMove} onChange={(e) => setDriveRequireApprovalForMove(e.target.checked)} /> {t("Require manager approval for moves")}</label>
                </div>
                <div className="drive-inline-actions">
                  <label><input type="checkbox" checked={driveRequireApprovalForDelete} onChange={(e) => setDriveRequireApprovalForDelete(e.target.checked)} /> {t("Require manager approval for deletes")}</label>
                  <label><input type="checkbox" checked={driveRequireApprovalForFolderCreate} onChange={(e) => setDriveRequireApprovalForFolderCreate(e.target.checked)} /> {t("Require manager approval for folder creation")}</label>
                </div>
                <div className="drive-inline-actions">
                  <button type="button" onClick={() => void saveDepartmentDrive()} disabled={!driveDepartmentKey}>{t("Save department drive")}</button>
                </div>
                <div className="drive-card-title drive-top-gap">{t("Admin capabilities")}</div>
                <div className="drive-capability-list">
                  {capabilityRows.map((row) => (
                    <div key={row.label} className={`drive-capability-row${row.enabled ? " is-enabled" : ""}`}>
                      <span>{row.label}</span>
                      <strong>{row.enabled ? t("Enabled") : t("Disabled")}</strong>
                    </div>
                  ))}
                </div>
                <div className="drive-admin-note">{t("Detailed role permissions remain controlled from Roles & Policies Admin, while this console focuses on storage governance and operational oversight.")}</div>
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

                <div className="drive-card-title drive-top-gap">{t("Approval queue and execution status")}</div>
                <div className="drive-trend-list">
                  {approvalQueueRows.map((row) => {
                    let payload: any = {};
                    try {
                      payload = JSON.parse(String(row?.payloadJson ?? "{}"));
                    } catch {
                      payload = {};
                    }
                    const deptKey = String(row?.departmentKey ?? "").trim();
                    const requesterEmail = normalizeEmail(row?.requestedByEmail);
                    const isRequester = requesterEmail === selfEmail;
                    const canResolve = canManageAll || isAdminGroup || isDepartmentDriveManager(deptKey);
                    const itemSummary = String(payload?.itemName ?? payload?.proposedFolderName ?? payload?.targetFolderPath ?? payload?.folderPath ?? "-");
                    const execution = approvalExecutionResult(row);
                    return (
                      <div key={String(row?.id ?? `${deptKey}-${itemSummary}`)} className="drive-trend-row drive-approval-row">
                        <div>
                          <strong>{approvalActionLabel(String(row?.actionType ?? ""))}</strong>
                          <div>{String((row?.departmentName ?? deptKey) || "-")}</div>
                        </div>
                        <div>{String((row?.requestedByName ?? requesterEmail) || "-")}</div>
                        <div>{itemSummary}</div>
                        <div>
                          <span className={`drive-approval-badge ${execution.className}`}>{execution.label}</span>
                          {execution.reason ? <div className="drive-approval-reason">{execution.reason}</div> : null}
                        </div>
                        <div className="drive-approval-actions">
                          {String(row?.requestStatus ?? "").toUpperCase() === "PENDING" && canResolve ? (
                            <>
                              <button type="button" onClick={() => void handleApprovalDecision(row, "APPROVED", true)}>{t("Approve & Execute")}</button>
                              <button type="button" onClick={() => void handleApprovalDecision(row, "APPROVED")}>{t("Approve")}</button>
                              <button type="button" onClick={() => void handleApprovalDecision(row, "REJECTED")}>{t("Reject")}</button>
                            </>
                          ) : null}
                          {String(row?.requestStatus ?? "").toUpperCase() === "PENDING" && !canResolve && isRequester ? (
                            <button type="button" onClick={() => void handleApprovalDecision(row, "CANCELLED")}>{t("Cancel")}</button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {!approvalQueueRows.length ? <div className="filesharing-empty">{t("No approval requests yet")}</div> : null}
                </div>

                <div className="drive-card-title drive-top-gap">{t("Department quotas")}</div>
                <div className="drive-trend-list">
                  {departments.map((dept) => {
                    const target = departmentQuotaKey(dept.key);
                    const row = quotaMap.get(target);
                    const usage = departmentUsageMap.get(dept.key) ?? 0;
                    return (
                      <div key={target} className="drive-trend-row drive-link-analytics-row">
                        <div>{dept.name}</div>
                        <div>{formatBytes(usage)}</div>
                        <div>{Number(row?.quotaMb ?? DEFAULT_QUOTA_MB)} MB</div>
                        <button type="button" onClick={() => setQuotaEditorTarget(target)}>{t("Edit")}</button>
                      </div>
                    );
                  })}
                </div>

                <div className="drive-card-title drive-top-gap">{t("User quota overrides")}</div>
                <div className="drive-trend-list">
                  {directory.map((user) => {
                    const row = quotaMap.get(user.email);
                    const effective = row ?? quotaMap.get(departmentQuotaKey(user.departmentKey)) ?? quotaMap.get(DEFAULT_QUOTA_KEY);
                    return (
                      <div key={user.email} className="drive-trend-row drive-user-limit-row">
                        <div>{user.fullName}</div>
                        <div>{user.email}</div>
                        <div>{Number(effective?.quotaMb ?? DEFAULT_QUOTA_MB)} MB</div>
                        <button type="button" onClick={() => setQuotaEditorTarget(user.email)}>{row ? t("Override") : t("Set")}</button>
                      </div>
                    );
                  })}
                </div>

                {canViewAnalytics ? (
                  <>
                    <div className="drive-card-title drive-top-gap">{t("Active shared links")}</div>
                    <div className="drive-trend-list">
                      {activeLinks.slice(0, 8).map((link) => (
                        <div key={link.id} className="drive-trend-row drive-link-analytics-row">
                          <div>{String(link?.displayName ?? t("Untitled"))}</div>
                          <div>{t("Expires")}: {String(link?.expiresAt ?? "-")}</div>
                          <div>{t("Downloads")}: {Number(link?.downloadCount ?? 0)}</div>
                        </div>
                      ))}
                      {!activeLinks.length ? <div className="filesharing-empty">{t("No active shared links right now")}</div> : null}
                    </div>
                  </>
                ) : null}
              </div>
              </section>
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
