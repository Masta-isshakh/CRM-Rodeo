// src/pages/serviceexecution/ServiceExecutionModule.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGlobalLoading } from "../utils/GlobalLoadingContext";
import { createPortal, flushSync } from "react-dom";
import "./ServiceExecutionModule.css";
import "./JobOrderHistory.css";
import "./JobCards.css";

import ServiceSummaryCard from "./ServiceSummaryCard";
import PermissionGate from "./PermissionGate";
import UnifiedJobOrderRoadmap from "../components/UnifiedJobOrderRoadmap";
import { UnifiedCustomerInfoCard, UnifiedVehicleInfoCard } from "../components/UnifiedCustomerVehicleCards";
import { UnifiedJobOrderSummaryCard } from "../components/UnifiedJobOrderSummaryCard";
import UnifiedBillingInvoicesSection from "../components/UnifiedBillingInvoicesSection";
import { matchesSearchQuery } from "../lib/searchUtils";

import { getDataClient } from "../lib/amplifyClient";

import {
  cancelJobOrderByOrderNumber,
  getJobOrderByOrderNumber,
} from "./jobOrderRepo";

import { getUrl } from "aws-amplify/storage";
import { getUserDirectory, normalizeIdentity } from "../utils/userDirectoryCache";
import {
  buildAssigneeOptionsFromDirectory,
} from "../utils/userOptionDedupe";
import { usePermissions } from "../lib/userPermissions";
import { resolveActorUsername, resolveOrderCreatedBy } from "../utils/actorIdentity";
import {
  computePaymentSnapshot,
  derivePaymentStatusFromFinancials,
  pickBillingFirstValue,
  pickPaymentEnum,
  pickPaymentLabel,
  normalizePaymentStatusLabel as normalizePaymentStatusLabelShared,
} from "../utils/paymentStatus";
import { useLanguage } from "../i18n/LanguageContext";
import { filterVisibleDocuments } from "../utils/documentVisibility";

// -------------------- helpers --------------------
function safeJsonParse<T>(raw: any, fallback: T): T {
  try {
    if (raw == null) return fallback;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return fallback;
      return JSON.parse(s) as T;
    }
    return raw as T;
  } catch {
    return fallback;
  }
}

function slugify(s: string) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 50);
}

function stableServiceId(orderNumber: string, raw: any, idx: number) {
  const fromRaw = String(raw?.id ?? "").trim();
  if (fromRaw) return fromRaw;
  const name = slugify(String(raw?.name ?? `service-${idx + 1}`));
  return `SVC-${orderNumber}-${idx + 1}-${name || "x"}`;
}

function resolveActorEmail(user: any) {
  const raw = String(
    user?.email ?? user?.attributes?.email ?? user?.signInDetails?.loginId ?? user?.name ?? user?.username ?? ""
  ).trim();
  return raw.includes("@") ? raw : "";
}

function pickEmailLike(...values: any[]) {
  for (const value of values) {
    const out = String(value ?? "").trim().toLowerCase();
    if (out.includes("@")) return out;
  }
  return "";
}

function displayNameQuality(value: any) {
  const name = String(value ?? "").trim();
  const normalized = normalizeIdentity(name);
  if (!normalized) return 0;
  if (normalized === "unknown" || normalized === "system" || normalized === "system user" || normalized === "n/a" || normalized === "na") {
    return 0;
  }
  if (normalized.includes("@")) return 1;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return 3;
  return 2;
}

function parseBooleanLike(value: any): boolean | undefined {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  if (["true", "1", "yes", "enabled", "active", "confirmed"].includes(normalized)) return true;
  if (["false", "0", "no", "disabled", "inactive", "unconfirmed"].includes(normalized)) return false;
  return undefined;
}

function dedupeDirectoryUsers(users: any[]) {
  const merged = new Map<string, any>();

  const keyFor = (u: any) => {
    const email = pickEmailLike(u?.email, u?.username, u?.attributes?.email);
    if (email) return `email:${email}`;
    const id = normalizeIdentity(u?.id);
    if (id) return `id:${id}`;
    const profileOwner = normalizeIdentity(u?.profileOwner);
    if (profileOwner) return `profileOwner:${profileOwner}`;
    const sub = normalizeIdentity(u?.sub);
    if (sub) return `sub:${sub}`;
    return "";
  };

  for (const user of users || []) {
    const key = keyFor(user);
    if (!key) continue;

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...user });
      continue;
    }

    const currentName = String(existing?.name ?? "").trim();
    const incomingName = String(user?.name ?? "").trim();
    const bestName = displayNameQuality(incomingName) > displayNameQuality(currentName) ? incomingName : currentName;

    const existingEnabled = parseBooleanLike(existing?.enabled);
    const incomingEnabled = parseBooleanLike(user?.enabled);
    const mergedEnabled =
      existingEnabled === false || incomingEnabled === false
        ? false
        : existingEnabled ?? incomingEnabled;

    const existingIsActive = parseBooleanLike(existing?.isActive);
    const incomingIsActive = parseBooleanLike(user?.isActive);
    const mergedIsActive =
      existingIsActive === false || incomingIsActive === false
        ? false
        : existingIsActive ?? incomingIsActive;

    merged.set(key, {
      ...existing,
      ...user,
      name: bestName || currentName || incomingName,
      email: pickEmailLike(existing?.email, user?.email, existing?.username, user?.username),
      id: existing?.id ?? user?.id,
      profileOwner: existing?.profileOwner ?? user?.profileOwner,
      sub: existing?.sub ?? user?.sub,
      enabled: mergedEnabled,
      isActive: mergedIsActive,
    });
  }

  return Array.from(merged.values());
}

function resolveActorName(user: any) {
  return resolveActorUsername(user, "serviceexec");
}

function normalizeActorDisplay(value: any, fallback = "-") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  if (normalized === "system" || normalized === "system user" || normalized === "unknown" || normalized === "not assigned") {
    return fallback;
  }
  const at = raw.indexOf("@");
  if (at > 0) return raw.slice(0, at).toLowerCase();
  return raw;
}

function normalizeStepName(value: any) {
  return String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

function isServiceOperationStep(value: any) {
  const n = normalizeStepName(value);
  return n === "inprogress" || n === "serviceoperation";
}

function normalizeWorkStatusLabel(value: any, fallback = "Service_Operation") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return isServiceOperationStep(raw) ? "Service_Operation" : raw;
}

function normalizePaymentStatusLabel(value: any) {
  return normalizePaymentStatusLabelShared(value);
}

function isServiceExecutionWorkStatus(value: any) {
  const n = normalizeStepName(value);
  return n === "inprogress" || n === "serviceoperation";
}

function mapExitPermitStatusToUi(v: any, hasPermitId = false) {
  const s = String(v ?? "").trim().toUpperCase();
  if (hasPermitId) return "Completed";
  if (s === "APPROVED" || s === "CREATED" || s === "COMPLETED") return "Completed";
  return "Not Created";
}

function permitStatusClass(status: any) {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "completed") return "permit-completed";
  if (s === "not created") return "permit-pending";
  if (s === "pending") return "permit-pending";
  if (s === "rejected") return "permit-rejected";
  return "permit-not-required";
}

function firstNonEmptyText(...values: any[]) {
  for (const value of values) {
    const out = String(value ?? "").trim();
    if (out) return out;
  }
  return "";
}

function toNum(v: any): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "");
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fmtQar(n: number) {
  return `QAR ${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
}

function toBilingualName(nameEn: any, nameAr: any, fallback = "Unnamed service") {
  const en = String(nameEn || "").trim();
  const ar = String(nameAr || "").trim();
  if (en && ar) return `${en} / ${ar}`;
  return en || ar || fallback;
}

type AssigneeOption = { value: string; label: string };
type ServiceExecutionTab = "assigned" | "unassigned" | "team" | "completed";

function normalizeServices(orderNumber: string, services: any[]) {
  const list = Array.isArray(services) ? services : [];
  return list.map((s: any, idx: number) => {
    const id = stableServiceId(orderNumber, s, idx);
    const order = Number(s?.order ?? idx + 1);

    const startTime = s?.startTime ?? null;
    const endTime = s?.endTime ?? null;

    return {
      ...s,
      id,
      order,
      name: String(s?.name ?? `Service ${idx + 1}`),
      price: typeof s?.price === "number" ? s.price : s?.price ? Number(s.price) : undefined,

      status: String(s?.status ?? "Pending"),
      assignedTo: s?.assignedTo ?? null,
      technicians: Array.isArray(s?.technicians) ? s.technicians : [],
      technicianServiceAssignments:
        s?.technicianServiceAssignments && typeof s.technicianServiceAssignments === "object"
          ? Object.entries(s.technicianServiceAssignments as Record<string, unknown>).reduce<Record<string, string[]>>(
              (acc, [key, values]) => {
                if (!Array.isArray(values)) return acc;
                const normalizedKey = normalizeIdentity(key);
                if (!normalizedKey) return acc;
                acc[normalizedKey] = values.map((value) => String(value ?? "").trim()).filter(Boolean);
                return acc;
              },
              {}
            )
          : {},

      startTime,
      endTime,
      started: s?.started ?? (startTime ? String(startTime) : "Not started"),
      ended: s?.ended ?? (endTime ? String(endTime) : "Not completed"),

      requestedAction: s?.requestedAction ?? null,
      approvalStatus: s?.approvalStatus ?? null,

      notes: s?.notes ?? "",
    };
  });
}

function normalizeServiceStatus(value: any) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_]+/g, "");
}

function isCompletedServiceStatus(value: any) {
  return normalizeServiceStatus(value) === "completed";
}

function isInactiveServiceStatus(value: any) {
  const status = normalizeServiceStatus(value);
  return status === "completed" || status === "cancelled" || status === "canceled" || status === "postponed";
}

function hasOnlyFinalizedServices(services: any[]) {
  const list = Array.isArray(services) ? services : [];
  return list.length > 0 && list.every((service: any) => isInactiveServiceStatus(service?.status));
}

function getCompletedTaskReason(services: any[]) {
  const list = Array.isArray(services) ? services : [];
  if (!list.length) return "Completed+Cancelled/Postponed";

  const hasCancelledOrPostponed = list.some((service: any) => {
    const status = normalizeServiceStatus(service?.status);
    return status === "cancelled" || status === "canceled" || status === "postponed";
  });

  return hasCancelledOrPostponed ? "Completed+Cancelled/Postponed" : "All Completed";
}

function pickNextActiveService(services: any[]) {
  return (services || []).find((s: any) => !isInactiveServiceStatus(s?.status));
}

function getServiceOperationStep(job: any) {
  return (job?.roadmap || []).find((s: any) => isServiceOperationStep(s.step));
}

function isServiceExecutionTaskCandidate(job: any) {
  return Boolean(getServiceOperationStep(job) || isServiceExecutionWorkStatus(job?.workStatus));
}

function isServiceExecutionActiveTask(job: any) {
  const inprogressStep = getServiceOperationStep(job);
  const roadmapActive = inprogressStep && inprogressStep.stepStatus === "Active";
  const workStatusActive = isServiceExecutionWorkStatus(job.workStatus);
  return Boolean(roadmapActive || workStatusActive);
}

function isCompletedServiceExecutionTask(job: any) {
  return isServiceExecutionTaskCandidate(job) && hasOnlyFinalizedServices(job?.services);
}

function mapServiceExecutionWorkStatusToDbStatus(value: any) {
  const raw = String(value ?? "").trim().toLowerCase();
  const compact = raw.replace(/[\s_]+/g, "");

  if (raw === "cancelled" || raw === "canceled") return "CANCELLED";
  if (raw === "completed") return "COMPLETED";
  if (raw === "ready" || raw === "quality check") return "READY";
  if (compact === "inprogress" || compact === "serviceoperation" || raw === "inspection") return "IN_PROGRESS";
  if (compact === "draft") return "DRAFT";
  return "OPEN";
}

async function resolveMaybeStorageUrl(urlOrPath: string): Promise<string> {
  const v = String(urlOrPath || "").trim();
  if (!v) return "";
  if (v.startsWith("job-orders/")) {
    const out = await getUrl({ path: v });
    return out.url.toString();
  }
  return v;
}

// -------------------- main component --------------------
const ServiceExecutionModule = ({ currentUser }: any) => {
  const client = useMemo(() => getDataClient(), []);
  const { isAdminGroup, canOption } = usePermissions();
  const { t } = useLanguage();
  const { withLoading, showLoading, hideLoading } = useGlobalLoading();

  // live list from backend
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // user lists (optional)
  const [systemUsers, setSystemUsers] = useState<any[]>([]);
  const [activeProfileByEmail, setActiveProfileByEmail] = useState<Record<string, boolean>>({});
  const [profileDeptByEmail, setProfileDeptByEmail] = useState<Record<string, { departmentKey: string; departmentName: string }>>({});
  const [actorLabelMap, setActorLabelMap] = useState<Record<string, string>>({});

  const activeSystemUsers = useMemo(() => {
    return (systemUsers ?? []).filter((u) => {
      const cognitoEnabled =
        parseBooleanLike(u?.enabled ?? u?.status ?? u?.userStatus) ?? true;
      if (!cognitoEnabled) return false;

      const userMarkedActive = parseBooleanLike(u?.isActive);
      if (userMarkedActive === false) return false;

      const emailKey = normalizeIdentity(
        pickEmailLike(u?.email, u?.attributes?.email, u?.username)
      );
      if (!emailKey) return false;
      return activeProfileByEmail[emailKey] !== false;
    });
  }, [systemUsers, activeProfileByEmail]);

  const activeDirectoryEmails = useMemo(() => {
    const set = new Set<string>();
    for (const user of activeSystemUsers) {
      const email = pickEmailLike(user?.email, user?.attributes?.email, user?.username);
      if (email) set.add(email);
    }
    return set;
  }, [activeSystemUsers]);

  const activeActorLabelMap = useMemo(() => {
    const filtered: Record<string, string> = {};
    for (const [rawIdentity, label] of Object.entries(actorLabelMap || {})) {
      const email = pickEmailLike(rawIdentity);
      if (!email) continue;
      if (activeDirectoryEmails.has(email) || activeProfileByEmail[email] === true) {
        filtered[rawIdentity] = label;
      }
    }
    return filtered;
  }, [actorLabelMap, activeDirectoryEmails, activeProfileByEmail]);

  const cachedRootAdminEmail = useMemo(() => {
    try {
      if (typeof window === "undefined") return "";
      return pickEmailLike(window.localStorage.getItem("crm.rootAdminEmail"));
    } catch {
      return "";
    }
  }, []);

  const isRootAdminOption = (value: any, label: any) => {
    const normalizedValue = normalizeIdentity(value);
    const normalizedLabel = normalizeIdentity(label);
    const normalizedRootEmail = normalizeIdentity(cachedRootAdminEmail);

    if (normalizedRootEmail && normalizedValue === normalizedRootEmail) return true;
    if (normalizedValue === "root-admin@system") return true;
    if (normalizedLabel === "root admin" || normalizedLabel === "root-admin") return true;
    return false;
  };

  const assigneeOptions = useMemo<AssigneeOption[]>(
    () =>
      buildAssigneeOptionsFromDirectory(activeSystemUsers, activeActorLabelMap, currentUser).filter(
        (opt) => !isRootAdminOption(opt.value, opt.label)
      ),
    [activeSystemUsers, activeActorLabelMap, currentUser, cachedRootAdminEmail]
  );

  const operationAssigneeOptions = useMemo<AssigneeOption[]>(() => {
    const opsRegex = /(^|[^a-z])operations?([^a-z]|$)/i;
    const isOperationsDept = (deptKey: string, deptName: string) =>
      opsRegex.test(String(deptKey ?? "").toLowerCase()) || opsRegex.test(String(deptName ?? "").toLowerCase());

    const operationIdentities = new Set<string>();
    const addIdentity = (value: any) => {
      const key = normalizeIdentity(value);
      if (key) operationIdentities.add(key);
    };

    for (const user of activeSystemUsers || []) {
      const email = pickEmailLike(user?.email, user?.attributes?.email, user?.username);
      const emailKey = normalizeIdentity(email);

      const directDeptKey = String(user?.departmentKey ?? user?.attributes?.departmentKey ?? user?.attributes?.["custom:departmentKey"] ?? "").trim();
      const directDeptName = String(user?.departmentName ?? user?.attributes?.departmentName ?? user?.attributes?.department ?? user?.attributes?.["custom:departmentName"] ?? "").trim();

      let inOperations = isOperationsDept(directDeptKey, directDeptName);
      if (!inOperations && emailKey) {
        const prof = profileDeptByEmail[emailKey];
        if (prof) inOperations = isOperationsDept(prof.departmentKey, prof.departmentName);
      }

      if (!inOperations) continue;

      addIdentity(email);
      addIdentity(user?.name);
      addIdentity(user?.fullName);
      addIdentity(user?.displayName);
      if (emailKey) addIdentity(actorLabelMap[emailKey]);
    }

    for (const [email, dept] of Object.entries(profileDeptByEmail)) {
      if (activeProfileByEmail[email] === false) continue;
      if (!isOperationsDept(dept.departmentKey, dept.departmentName)) continue;
      addIdentity(email);
      addIdentity(actorLabelMap[email]);
    }

    return assigneeOptions.filter((opt) => {
      const valueKey = normalizeIdentity(opt.value);
      const labelKey = normalizeIdentity(opt.label);
      return operationIdentities.has(valueKey) || operationIdentities.has(labelKey);
    });
  }, [assigneeOptions, activeSystemUsers, profileDeptByEmail, activeProfileByEmail, actorLabelMap]);

  const technicianNames = useMemo(() => {
    const opsRegex = /(^|[^a-z])operations?([^a-z]|$)/i;
    const out = new Map<string, string>();

    const addTech = (value: any) => {
      const label = String(value ?? "").trim();
      if (!label) return;
      const key = normalizeIdentity(label);
      if (!key || out.has(key)) return;
      out.set(key, label);
    };

    const isOperationsDept = (deptKey: string, deptName: string) =>
      opsRegex.test(String(deptKey ?? "").toLowerCase()) || opsRegex.test(String(deptName ?? "").toLowerCase());

    // Primary source: active users currently loaded in directory/list-users response.
    for (const user of activeSystemUsers) {
      const email = normalizeIdentity(pickEmailLike(user?.email, user?.attributes?.email, user?.username));
      const directDeptKey = String(user?.departmentKey ?? user?.attributes?.departmentKey ?? user?.attributes?.["custom:departmentKey"] ?? "").trim();
      const directDeptName = String(user?.departmentName ?? user?.attributes?.departmentName ?? user?.attributes?.department ?? user?.attributes?.["custom:departmentName"] ?? "").trim();

      let inOperations = isOperationsDept(directDeptKey, directDeptName);
      if (!inOperations && email) {
        const prof = profileDeptByEmail[email];
        if (prof) inOperations = isOperationsDept(prof.departmentKey, prof.departmentName);
      }
      if (!inOperations) continue;

      addTech(
        String(user?.name ?? "").trim() ||
        String(user?.fullName ?? "").trim() ||
        String(user?.displayName ?? "").trim() ||
        (email || "")
      );
    }

    // Fallback source: UserProfile rows (covers users missing from activeSystemUsers).
    for (const [email, dept] of Object.entries(profileDeptByEmail)) {
      if (activeProfileByEmail[email] === false) continue;
      if (!isOperationsDept(dept.departmentKey, dept.departmentName)) continue;
      addTech(String(actorLabelMap[email] ?? "").trim() || email);
    }

    return Array.from(out.values()).sort((a, b) => a.localeCompare(b));
  }, [activeSystemUsers, profileDeptByEmail, activeProfileByEmail, actorLabelMap]);

  const assigneeLabelByValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const opt of assigneeOptions) {
      map.set(normalizeIdentity(opt.value), opt.label);
    }
    return map;
  }, [assigneeOptions]);

  const nameToEmailMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of systemUsers) {
      const n = normalizeIdentity(u?.name);
      const e = normalizeIdentity(u?.email);
      if (n && e) map.set(n, e);
    }
    return map;
  }, [systemUsers]);

  const emailToNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of systemUsers) {
      const n = normalizeIdentity(u?.name);
      const e = normalizeIdentity(u?.email);
      if (n && e) map.set(e, n);
    }
    return map;
  }, [systemUsers]);

  const currentUserIdentitySet = useMemo(() => {
    const values = [
      currentUser?.name,
      currentUser?.email,
      currentUser?.username,
      currentUser?.userName,
      currentUser?.attributes?.email,
      currentUser?.signInDetails?.loginId,
    ];
    const set = new Set<string>();
    for (const v of values) {
      const normalized = normalizeIdentity(v);
      if (normalized) set.add(normalized);
    }
    return set;
  }, [currentUser]);

  const isAssignedToCurrentUser = (assignedTo: any) => {
    const assigned = normalizeIdentity(assignedTo);
    if (!assigned) return false;

    if (currentUserIdentitySet.has(assigned)) return true;

    const assignedEmail = nameToEmailMap.get(assigned);
    if (assignedEmail && currentUserIdentitySet.has(assignedEmail)) return true;

    const assignedName = emailToNameMap.get(assigned);
    if (assignedName && currentUserIdentitySet.has(assignedName)) return true;

    for (const identity of currentUserIdentitySet) {
      const mappedEmail = nameToEmailMap.get(identity);
      if (mappedEmail && mappedEmail === assigned) return true;

      const mappedName = emailToNameMap.get(identity);
      if (mappedName && mappedName === assigned) return true;
    }

    return false;
  };

  const getAssigneeDisplayName = (assignedTo: any) => {
    const normalized = normalizeIdentity(assignedTo);
    if (!normalized) return "-";
    const rawLabel = assigneeLabelByValue.get(normalized) ?? String(assignedTo ?? "").trim();
    return rawLabel || "-";
  };

  // UI state
  const [currentTab, setCurrentTab] = useState<ServiceExecutionTab>("assigned");
  const [currentSearch, setCurrentSearch] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);

  const [showDetails, setShowDetails] = useState(false);
  const [currentDetailsJob, setCurrentDetailsJob] = useState<any | null>(null);
  const [isFinishingWork, setIsFinishingWork] = useState(false);
  const [isAddingService, setIsAddingService] = useState(false);

  // âœ… THIS is what enables Edit/Add service to work
  const [detailsEditMode, setDetailsEditMode] = useState(false);

  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const activeDropdownRef = useRef<string | null>(null);
  const pendingPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistJobRef = useRef<any | null>(null);
  const detailsCacheRef = useRef<Map<string, any>>(new Map());
  const paymentRowsCacheRef = useRef<Map<string, any[]>>(new Map());
  const normalizedInvoicesCacheRef = useRef<Map<string, any[]>>(new Map());
  const customerDetailsCacheRef = useRef<Map<string, any>>(new Map());

  const canOpenServiceActions = canOption("serviceexec", "serviceexec_actions", true);
  const canViewUnassignedTab = canOption("serviceexec", "serviceexec_unassigned_tab", canOpenServiceActions);
  const canViewTeamTab = canOption("serviceexec", "serviceexec_team_tab", canOpenServiceActions);
  const canEditService = canOption("serviceexec", "serviceexec_edit", isAdminGroup);
  const canAssignService = canOption("serviceexec", "serviceexec_assign", canEditService);

  // close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: any) => {
      const isDropdownButton = event.target.closest(".btn-action-dropdown");
      const isDropdownMenu = event.target.closest(".action-dropdown-menu");
      if (!isDropdownButton && !isDropdownMenu) {
        activeDropdownRef.current = null;
        setActiveDropdown(null);
      }
    };

    if (activeDropdown) {
      document.addEventListener("pointerdown", handleClickOutside, true);
      return () => document.removeEventListener("pointerdown", handleClickOutside, true);
    }
  }, [activeDropdown]);

  const toggleActionDropdown = useCallback((orderId: string, anchorEl: HTMLElement) => {
    const isActive = activeDropdownRef.current === orderId;
    if (isActive) {
      activeDropdownRef.current = null;
      setActiveDropdown(null);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    const menuHeight = 140;
    const menuWidth = 200;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    flushSync(() => {
      activeDropdownRef.current = orderId;
      setDropdownPosition({ top, left });
      setActiveDropdown(orderId);
    });
  }, []);

  // Load users
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const directory = await getUserDirectory(client);
        if (cancelled) return;

        const identityMap: Record<string, string> = {
          ...(directory.identityToUsernameMap ?? {}),
        };

        const mergedUsers: any[] = Array.isArray(directory.users) ? [...directory.users] : [];

        try {
          const profileRes = await client.models.UserProfile.list({
            limit: 20000,
          } as any);
          const profileMap: Record<string, boolean> = {};
          const deptMap: Record<string, { departmentKey: string; departmentName: string }> = {};
          for (const row of profileRes?.data ?? []) {
            const emailKey = normalizeIdentity((row as any)?.email);
            if (!emailKey) continue;
            profileMap[emailKey] = Boolean((row as any)?.isActive ?? true);
            deptMap[emailKey] = {
              departmentKey: String((row as any)?.departmentKey ?? "").trim(),
              departmentName: String((row as any)?.departmentName ?? "").trim(),
            };
          }
          setActiveProfileByEmail(profileMap);
          setProfileDeptByEmail(deptMap);
        } catch {
          setActiveProfileByEmail({});
          setProfileDeptByEmail({});
        }

        try {
          const systemUsersRes = await (client.queries as any).systemListUsers?.();
          const raw = (systemUsersRes as any)?.data ?? systemUsersRes;
          const parsed = safeJsonParse<any>(raw, raw);
          const listed = Array.isArray(parsed?.users) ? parsed.users : Array.isArray(parsed) ? parsed : [];

          for (const user of listed) {
            const email = pickEmailLike(user?.email, user?.username, user?.attributes?.email);
            const fullName = String(user?.fullName ?? user?.name ?? user?.displayName ?? "").trim();
            const sub = String(user?.sub ?? user?.userId ?? user?.id ?? "").trim();
            if (!email && !fullName && !sub) continue;

            const profileOwner = email && sub ? `${sub}::${email}` : undefined;

            mergedUsers.push({
              name: fullName || email || sub,
              email: email || "",
              id: sub || undefined,
              profileOwner,
              sub: sub || undefined,
              enabled: parseBooleanLike(user?.enabled ?? user?.status ?? user?.userStatus),
              isActive: parseBooleanLike(user?.isActive),
            });

            if (email && fullName) {
              identityMap[normalizeIdentity(email)] = fullName;
            }
          }
        } catch {
          // Fallback to directory users only
        }

        setSystemUsers(dedupeDirectoryUsers(mergedUsers));
        setActorLabelMap(identityMap);
      } catch {
        setSystemUsers([]);
        setActiveProfileByEmail({});
        setProfileDeptByEmail({});
        setActorLabelMap({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Live backend list
  useEffect(() => {
    let firstEmission = true;
    showLoading("Loading service execution jobs...");
    const sub = (client.models.JobOrder as any)
      .observeQuery({
        limit: 500,
      })
      .subscribe(({ items }: any) => {
        const mapped = (items ?? []).map((row: any) => {
          const parsed = safeJsonParse<any>(row.dataJson, {});
          const roadmap = Array.isArray(parsed.roadmap) ? parsed.roadmap : [];
          const orderNumber = String(row.orderNumber ?? "");
          const services = normalizeServices(orderNumber, Array.isArray(parsed.services) ? parsed.services : []);
          return {
            _backendId: row.id,
            id: orderNumber,
            orderType: row.orderType ?? parsed.orderType ?? "Job Order",
            customerName: row.customerName ?? parsed.customerName ?? "",
            mobile: row.customerPhone ?? parsed.customerPhone ?? "",
            vehiclePlate: row.plateNumber ?? parsed.plateNumber ?? "",
            createDate: row.createdAt
              ? new Date(String(row.createdAt)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
              : "",
            workStatus: normalizeWorkStatusLabel(parsed.workStatusLabel ?? row.workStatusLabel),
            paymentStatus: derivePaymentStatusFromFinancials({
              paymentEnum: pickPaymentEnum(row, parsed),
              paymentLabel: pickPaymentLabel(row, parsed),
              totalAmount: pickBillingFirstValue("totalAmount", row, parsed),
              discount: pickBillingFirstValue("discount", row, parsed),
              amountPaid: pickBillingFirstValue("amountPaid", row, parsed),
              netAmount: pickBillingFirstValue("netAmount", row, parsed),
              balanceDue: pickBillingFirstValue("balanceDue", row, parsed),
            }),
            roadmap,
            services,
          };
        });
        setJobs(mapped);
        if (firstEmission) {
          firstEmission = false;
          hideLoading();
        }
      });

    return () => {
      if (firstEmission) hideLoading();
      sub.unsubscribe();
    };
  }, [client, hideLoading, showLoading]);

  // tab/search resets
  useEffect(() => setCurrentPage(1), [currentTab, currentSearch, pageSize]);

  useEffect(() => {
    if (currentTab === "team" && !canViewTeamTab) {
      setCurrentTab("assigned");
      return;
    }
    if (currentTab === "unassigned" && !canViewUnassignedTab) {
      setCurrentTab("assigned");
    }
  }, [currentTab, canViewTeamTab, canViewUnassignedTab]);

  // filter: must be Service_Operation step active
  const filteredJobs = useMemo(() => {
    let list = [...jobs];

    list = list.filter((job) => {
      if (currentTab === "completed") return isCompletedServiceExecutionTask(job);
      return isServiceExecutionActiveTask(job) && !isCompletedServiceExecutionTask(job);
    });

    if (currentTab === "completed") {
      // Completed tasks are already isolated above.
    } else if (currentTab === "unassigned" && canViewUnassignedTab) {
      list = list.filter((j) => {
        const nextService = pickNextActiveService(j.services);
        return nextService && !nextService.assignedTo;
      });
    } else if (currentTab === "team" && canViewTeamTab) {
      list = list.filter((j) => {
        const nextService = pickNextActiveService(j.services);
        return nextService && nextService.assignedTo && !isAssignedToCurrentUser(nextService.assignedTo);
      });
    } else {
      list = list.filter((j) => {
        const nextService = pickNextActiveService(j.services);
        return nextService && isAssignedToCurrentUser(nextService.assignedTo);
      });
    }

    if (currentSearch.trim()) {
      list = list.filter((j) => {
        return matchesSearchQuery(
          [j.id, j.customerName, j.vehiclePlate, j.mobile, j.workStatus, j.orderType],
          currentSearch
        );
      });
    }

    return list;
  }, [jobs, currentTab, currentSearch, currentUser, nameToEmailMap, emailToNameMap, currentUserIdentitySet, canViewTeamTab, canViewUnassignedTab]);

  const counts = useMemo(() => {
    const base = jobs.filter((job) => {
      return isServiceExecutionActiveTask(job) && !isCompletedServiceExecutionTask(job);
    });

    const assigned = base.filter((j) => {
      const nextService = pickNextActiveService(j.services);
      return nextService && isAssignedToCurrentUser(nextService.assignedTo);
    }).length;

    const unassigned = canViewUnassignedTab ? base.filter((j) => {
      const nextService = pickNextActiveService(j.services);
      return nextService && !nextService.assignedTo;
    }).length : 0;

    const team = canViewTeamTab ? base.filter((j) => {
      const nextService = pickNextActiveService(j.services);
      return nextService && nextService.assignedTo && !isAssignedToCurrentUser(nextService.assignedTo);
    }).length : 0;

    const completed = jobs.filter((j) => isCompletedServiceExecutionTask(j)).length;

    return { assigned, unassigned, team, completed };
  }, [jobs, currentUser, nameToEmailMap, emailToNameMap, currentUserIdentitySet, canViewTeamTab, canViewUnassignedTab]);

  // pagination
  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredJobs.length);
  const paginatedJobs = filteredJobs.slice(startIndex, endIndex);

  const openDetailsView = async (orderNumber: string, listJob?: any) => {
    const orderKey = String(orderNumber ?? "").trim();
    if (!orderKey) return;

    const cachedDetails = detailsCacheRef.current.get(orderKey);
    if (cachedDetails) {
      flushSync(() => { setCurrentDetailsJob(cachedDetails); setDetailsEditMode(false); setShowDetails(true); });
      return;
    }

    // Instant stub from list row so UI shows immediately
    if (listJob) {
      flushSync(() => {
        setCurrentDetailsJob({ ...listJob, services: listJob.services ?? [], roadmap: listJob.roadmap ?? [], documents: [], billing: null, exitPermit: null, customerDetails: null, vehicleDetails: null });
        setDetailsEditMode(false);
        setShowDetails(true);
      });
    }

    setLoading(true);
    try {
      await withLoading((async () => {
      const detailed = await getJobOrderByOrderNumber(orderKey);
      if (!detailed?._backendId) throw new Error(t("Order not found in backend."));

      const backendId = String(detailed._backendId);

      const rowRes = await client.models.JobOrder.get({ id: detailed._backendId } as any);
      const row = (rowRes as any)?.data ?? null;
      const parsed = safeJsonParse<any>(row?.dataJson, {});

      const [paymentRows, normalizedInvoices, customerDetails] = await Promise.all([
        (async () => {
          const cached = paymentRowsCacheRef.current.get(backendId);
          if (cached) return cached;

          try {
            const byIdx = await (client.models.JobOrderPayment as any).listPaymentsByJobOrder?.({
              jobOrderId: backendId,
              limit: 500,
            });
            const value = byIdx?.data ?? [];
            paymentRowsCacheRef.current.set(backendId, value);
            return value;
          } catch {
            const pRes = await client.models.JobOrderPayment.list({
              limit: 500,
              filter: { jobOrderId: { eq: backendId } } as any,
            });
            const value = pRes?.data ?? [];
            paymentRowsCacheRef.current.set(backendId, value);
            return value;
          }
        })(),
        (async () => {
          const cached = normalizedInvoicesCacheRef.current.get(backendId);
          if (cached) return cached;

          try {
            let invRows: any[] = [];
            try {
              const byIdxInv = await (client.models.JobOrderInvoice as any).listInvoicesByJobOrder?.({
                jobOrderId: backendId,
                limit: 500,
              });
              invRows = byIdxInv?.data ?? [];
            } catch {
              const invRes = await client.models.JobOrderInvoice.list({
                limit: 500,
                filter: { jobOrderId: { eq: backendId } } as any,
              });
              invRows = invRes?.data ?? [];
            }

            invRows.sort((a, b) => String(a?.createdAt ?? "").localeCompare(String(b?.createdAt ?? "")));

            const value = await Promise.all(
              invRows.map(async (inv) => {
                const invoiceId = String(inv?.id ?? "");
                let svcRows: any[] = [];
                try {
                  const byIdxSvc = await (client.models.JobOrderInvoiceService as any).listInvoiceServicesByInvoice?.({
                    invoiceId,
                    limit: 500,
                  });
                  svcRows = byIdxSvc?.data ?? [];
                } catch {
                  const svcRes = await client.models.JobOrderInvoiceService.list({
                    limit: 500,
                    filter: { invoiceId: { eq: invoiceId } } as any,
                  });
                  svcRows = svcRes?.data ?? [];
                }

                return {
                  id: invoiceId,
                  number: String(inv?.number ?? "—"),
                  amount: toNum(inv?.amount),
                  discount: toNum(inv?.discount),
                  status: String(inv?.status ?? "Unpaid"),
                  paymentMethod: inv?.paymentMethod ?? null,
                  createdAt: inv?.createdAt ?? null,
                  services: svcRows.map((s) => String(s?.serviceName ?? "").trim()).filter(Boolean),
                };
              })
            );
            normalizedInvoicesCacheRef.current.set(backendId, value);
            return value;
          } catch {
            normalizedInvoicesCacheRef.current.set(backendId, []);
            return [];
          }
        })(),
        (async () => {
          const customerKey = String(row?.customerId ?? "").trim();
          if (customerKey && customerDetailsCacheRef.current.has(customerKey)) {
            return customerDetailsCacheRef.current.get(customerKey);
          }

          const out: any = {};
          if (!row?.customerId) return out;
          try {
            const cRes = await client.models.Customer.get({ id: row.customerId } as any);
            const c = (cRes as any)?.data;
            if (c?.id) {
              out.customerId = c.id;
              out.email = c.email ?? row.customerEmail ?? null;
              out.address = c.notes ?? row.customerNotes ?? null;
              out.customerSince = c.createdAt
                ? new Date(String(c.createdAt)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                : "";
            }
          } catch {}
          if (customerKey) customerDetailsCacheRef.current.set(customerKey, out);
          return out;
        })(),
      ]);

      const vehicleDetails: any = {
        make: row?.vehicleMake ?? null,
        model: row?.vehicleModel ?? null,
        year: row?.vehicleYear ?? null,
        type: row?.vehicleType ?? null,
        color: row?.color ?? null,
        plateNumber: row?.plateNumber ?? detailed.vehiclePlate ?? null,
        vin: row?.vin ?? null,
      };

      const paymentActivityLog = [...paymentRows]
        .sort((a, b) => String(a?.paidAt ?? a?.createdAt ?? "").localeCompare(String(b?.paidAt ?? b?.createdAt ?? "")))
        .map((p, idx) => ({
          serial: idx + 1,
          amount: fmtQar(toNum(p?.amount)),
          discount: fmtQar(0),
          paymentMethod: String(p?.method ?? "Cash"),
          cashierName: String(p?.createdBy ?? "").trim(),
          timestamp: p?.paidAt
            ? new Date(String(p.paidAt)).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : (p?.createdAt
                ? new Date(String(p.createdAt)).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                : "-"),
        }));

      const totalAmountRaw = toNum(pickBillingFirstValue("totalAmount", detailed, row, parsed));
      const discountRaw = toNum(pickBillingFirstValue("discount", detailed, row, parsed));
      const amountPaidRaw = toNum(pickBillingFirstValue("amountPaid", detailed, row, parsed));
      const paymentSnap = computePaymentSnapshot(totalAmountRaw, discountRaw, amountPaidRaw);

      const billing = {
        billId: String(row?.billId ?? parsed?.billing?.billId ?? detailed?.billing?.billId ?? ""),
        totalAmount: fmtQar(paymentSnap.totalAmount),
        discount: fmtQar(paymentSnap.discount),
        netAmount: fmtQar(paymentSnap.netAmount),
        amountPaid: fmtQar(paymentSnap.amountPaid),
        balanceDue: fmtQar(paymentSnap.balanceDue),
        paymentMethod: String(row?.paymentMethod ?? parsed?.billing?.paymentMethod ?? detailed?.billing?.paymentMethod ?? ""),
        invoices: normalizedInvoices,
      };

      const services = normalizeServices(String(detailed.id), detailed.services || []);

      const merged = {
        ...detailed,
        customerName: row?.customerName ?? detailed.customerName,
        mobile: row?.customerPhone ?? detailed.mobile,
        vehiclePlate: row?.plateNumber ?? detailed.vehiclePlate,
        orderType: row?.orderType ?? detailed.orderType,
        paymentStatus: derivePaymentStatusFromFinancials({
          paymentEnum: pickPaymentEnum(detailed, row, parsed),
          paymentLabel: pickPaymentLabel(detailed, row, parsed),
          totalAmount: pickBillingFirstValue("totalAmount", detailed, row, parsed),
          discount: pickBillingFirstValue("discount", detailed, row, parsed),
          amountPaid: pickBillingFirstValue("amountPaid", detailed, row, parsed),
          netAmount: pickBillingFirstValue("netAmount", detailed, row, parsed),
          balanceDue: pickBillingFirstValue("balanceDue", detailed, row, parsed),
        }),
        customerDetails: Object.keys(customerDetails).length ? customerDetails : detailed.customerDetails,
        vehicleDetails,
        billing,
        paymentActivityLog,
        _paymentRows: paymentRows,
        services,
      };

      detailsCacheRef.current.set(orderKey, merged);
      flushSync(() => { setCurrentDetailsJob(merged); setDetailsEditMode(false); setShowDetails(true); });
      })(), t("Loading service details..."));
    } catch (e) {
      console.warn("Service execution details load failed:", e);
    } finally {
      setLoading(false);
    }
  };

  const closeDetails = () => {
    const orderKey = String(currentDetailsJob?.id ?? "").trim();
    if (orderKey) detailsCacheRef.current.delete(orderKey);
    if (pendingPersistTimer.current) {
      clearTimeout(pendingPersistTimer.current);
      pendingPersistTimer.current = null;
    }
    pendingPersistJobRef.current = null;
    setShowDetails(false);
    setCurrentDetailsJob(null);
    setDetailsEditMode(false);
  };

  const syncJobIntoList = useCallback((job: any) => {
    const orderKey = String(job?.id ?? job?.orderNumber ?? "").trim();
    if (!orderKey) return;

    setJobs((prev) =>
      prev.map((existing) => {
        const existingKey = String(existing?.id ?? existing?.orderNumber ?? "").trim();
        if (existingKey !== orderKey) return existing;

        return {
          ...existing,
          services: normalizeServices(orderKey, Array.isArray(job?.services) ? job.services : existing.services || []),
          roadmap: Array.isArray(job?.roadmap) ? job.roadmap : existing.roadmap,
          workStatus: normalizeWorkStatusLabel(job?.workStatus ?? job?.workStatusLabel ?? existing.workStatus),
        };
      })
    );
  }, []);

  const persistJobWithOptions = async (
    job: any,
    options?: {
      refetchDetails?: boolean;
    }
  ): Promise<boolean> => {
    const refetchDetails = options?.refetchDetails ?? true;
    setLoading(true);
    try {
      const orderNumber = String(job?.id ?? job?.orderNumber ?? "").trim();
      const backendId = String(job?._backendId ?? "").trim();
      if (!orderNumber || !backendId) throw new Error("Missing service execution order reference.");

      const rowRes = await (client.models.JobOrder as any).get({ id: backendId } as any);
      const row = (rowRes as any)?.data ?? {};
      const parsed = safeJsonParse<any>(row?.dataJson, {});
      const services = normalizeServices(orderNumber, Array.isArray(job?.services) ? job.services : Array.isArray(parsed?.services) ? parsed.services : []);
      const roadmap = Array.isArray(job?.roadmap) ? job.roadmap : Array.isArray(parsed?.roadmap) ? parsed.roadmap : [];
      const workStatusLabel = normalizeWorkStatusLabel(
        job?.workStatus ?? job?.workStatusLabel ?? parsed?.workStatusLabel ?? row?.workStatusLabel
      );
      const paymentStatusLabel = String(row?.paymentStatusLabel ?? parsed?.paymentStatusLabel ?? job?.paymentStatusLabel ?? job?.paymentStatus ?? "").trim();
      const completedServiceCount = services.filter((service: any) => isCompletedServiceStatus(service?.status)).length;
      const totalServiceCount = services.length;

      const dataJson = JSON.stringify({
        ...parsed,
        vehicleDetails: job?.vehicleDetails ?? parsed?.vehicleDetails ?? {},
        services,
        documents: Array.isArray(job?.documents) ? job.documents : Array.isArray(parsed?.documents) ? parsed.documents : [],
        billing: job?.billing ?? parsed?.billing ?? {},
        roadmap,
        exitPermit: job?.exitPermit ?? parsed?.exitPermit ?? {},
        exitPermitInfo: job?.exitPermitInfo ?? parsed?.exitPermitInfo ?? {},
        additionalServiceRequests: Array.isArray(job?.additionalServiceRequests)
          ? job.additionalServiceRequests
          : Array.isArray(parsed?.additionalServiceRequests)
            ? parsed.additionalServiceRequests
            : [],
        customerNotes: job?.customerNotes ?? parsed?.customerNotes ?? null,
        expectedDeliveryDate: job?.expectedDeliveryDate ?? parsed?.expectedDeliveryDate ?? null,
        expectedDeliveryTime: job?.expectedDeliveryTime ?? parsed?.expectedDeliveryTime ?? null,
        workStatusLabel,
        paymentStatusLabel: paymentStatusLabel || parsed?.paymentStatusLabel,
      });

      const out = await (client.models.JobOrder as any).update({
        id: backendId,
        status: mapServiceExecutionWorkStatusToDbStatus(workStatusLabel),
        workStatusLabel,
        totalServiceCount,
        completedServiceCount,
        pendingServiceCount: Math.max(0, totalServiceCount - completedServiceCount),
        dataJson,
        updatedBy: resolveActorName(currentUser),
      } as any);

      if ((out as any)?.errors?.length) {
        throw new Error((out as any).errors.map((err: any) => err?.message || String(err)).join(" | "));
      }

      detailsCacheRef.current.delete(orderNumber);
      syncJobIntoList({ ...job, services, roadmap, workStatus: workStatusLabel });
      if (refetchDetails && job?.id) {
        const refreshed = await getJobOrderByOrderNumber(job.id);
        if (refreshed) setCurrentDetailsJob((prev: any) => ({ ...prev, ...refreshed }));
      }
      return true;
    } catch (e) {
      console.warn("Service execution save failed:", e);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const schedulePersistJob = (job: any) => {
    pendingPersistJobRef.current = job;
    if (pendingPersistTimer.current) {
      clearTimeout(pendingPersistTimer.current);
    }

    pendingPersistTimer.current = setTimeout(() => {
      const nextJob = pendingPersistJobRef.current;
      pendingPersistJobRef.current = null;
      pendingPersistTimer.current = null;
      if (nextJob) {
        void persistJobWithOptions(nextJob, {
          refetchDetails: false,
        });
      }
    }, 150);
  };

  const flushScheduledPersist = async () => {
    if (pendingPersistTimer.current) {
      clearTimeout(pendingPersistTimer.current);
      pendingPersistTimer.current = null;
    }

    const pending = pendingPersistJobRef.current;
    pendingPersistJobRef.current = null;
    if (pending) {
      await persistJobWithOptions(pending, {
        refetchDetails: false,
      });
    }
  };

  useEffect(() => {
    return () => {
      if (pendingPersistTimer.current) {
        clearTimeout(pendingPersistTimer.current);
      }
      pendingPersistJobRef.current = null;
    };
  }, []);

  const handleServicesReorder = (reorderedServices: any[]) => {
    if (!currentDetailsJob) return;
    const updated = { ...currentDetailsJob, services: normalizeServices(currentDetailsJob.id, reorderedServices) };
    setCurrentDetailsJob(updated);
    syncJobIntoList(updated);
    schedulePersistJob(updated);
  };

  const handleServiceUpdate = (serviceId: string, updates: any) => {
    if (!currentDetailsJob) return;
    const updated = { ...currentDetailsJob };
    const services = normalizeServices(updated.id, updated.services || []);
    const svc = services.find((s: any) => s.id === serviceId);
    if (!svc) return;
    Object.assign(svc, updates);
    updated.services = services;
    setCurrentDetailsJob(updated);
    syncJobIntoList(updated);
    schedulePersistJob(updated);
  };

  // Add service/package directly to JobOrder (no approval flow)
  const handleAddService = async (serviceName: string, price: number): Promise<boolean> => {
    if (!currentDetailsJob || isAddingService) return false;

    const newService = {
      id: `SVC-${currentDetailsJob.id}-${Date.now()}`,
      order: (currentDetailsJob.services?.length ?? 0) + 1,
      name: serviceName,
      price,
      status: "Pending",
      assignedTo: resolveActorEmail(currentUser) || currentUser?.name || null,
      technicians: [],
      technicianServiceAssignments: {},
      startTime: null,
      endTime: null,
      notes: "Added from Service Execution module",
    };

    const updated = {
      ...currentDetailsJob,
      services: normalizeServices(currentDetailsJob.id, [...(currentDetailsJob.services || []), newService]),
    };

    setCurrentDetailsJob(updated);
    syncJobIntoList(updated);

    try {
      setIsAddingService(true);

      // Persist immediately so Add Service stays disabled until backend save finishes.
      const saved = await withLoading(
        persistJobWithOptions(updated, {
          refetchDetails: false,
        }),
        t("Saving services...")
      );
      if (!saved) return false;
      return true;
    } finally {
      setIsAddingService(false);
    }
  };

  const allServicesCompleted = useMemo(() => {
    return hasOnlyFinalizedServices(currentDetailsJob?.services || []);
  }, [currentDetailsJob]);

  const canFinishWork = useMemo(() => {
    if (!currentDetailsJob) return false;
    return isServiceExecutionWorkStatus(currentDetailsJob.workStatus || currentDetailsJob.workStatusLabel);
  }, [currentDetailsJob]);

  const handleFinishWork = async () => {
    if (!currentDetailsJob || !allServicesCompleted || !canFinishWork || isFinishingWork) return;

    setIsFinishingWork(true);
    try {
      await flushScheduledPersist();

      const updated = { ...currentDetailsJob };
      const now = new Date().toLocaleString();
      const actorEmail = resolveActorName(currentUser);

      const roadmap = Array.isArray(updated.roadmap) ? [...updated.roadmap] : [];
      const inprogressStep = roadmap.find((s: any) => isServiceOperationStep(s.step));
      if (inprogressStep) {
        inprogressStep.stepStatus = "Completed";
        inprogressStep.endTimestamp = now;
        inprogressStep.actionBy = actorEmail;
      }
      const qcStep = roadmap.find((s: any) => s.step === "Quality Check");
      if (qcStep) {
        qcStep.stepStatus = "Active";
        qcStep.startTimestamp = qcStep.startTimestamp || now;
        qcStep.actionBy = actorEmail;
      }

      updated.roadmap = roadmap;
      updated.workStatus = "Quality Check";
      updated.workStatusLabel = "Quality Check";
      updated.updatedBy = actorEmail;

      // Optimistic UI transition to keep finish action snappy.
      setCurrentDetailsJob(updated);
      syncJobIntoList(updated);
      await persistJobWithOptions(updated, {
        refetchDetails: false,
      });
    } finally {
      setIsFinishingWork(false);
    }
  };

  const handleShowCancelConfirmation = (orderId: string) => {
    setCancelOrderId(orderId);
    setShowCancelConfirmation(true);
    setActiveDropdown(null);
  };

  const handleCancelOrder = async () => {
    if (!cancelOrderId) return;
    setLoading(true);
    try {
      await cancelJobOrderByOrderNumber(cancelOrderId);
      closeDetails();
    } catch (e) {
      console.warn("Service execution cancel failed:", e);
    } finally {
      setLoading(false);
      setShowCancelConfirmation(false);
      setCancelOrderId(null);
    }
  };

  // ---------------- DETAILS SCREEN ----------------
  if (showDetails && currentDetailsJob) {
    const roadmap = Array.isArray(currentDetailsJob.roadmap) ? currentDetailsJob.roadmap : [];

    return (
      <div className="service-execution-wrapper">
        <div className="service-details-screen jo-details-v3">
          <div className="service-details-header">
            <div className="service-details-title-container">
              <div className="service-kicker">
                <i className="fas fa-stream" style={{ marginRight: 6 }}></i>
                {t("History Details")}
              </div>
              <h2>
                <span className="service-title-icon" aria-hidden="true">
                  <i className="fas fa-clipboard-list"></i>
                </span>
                {t("Job Order Details")} - <span className="service-order-id">{currentDetailsJob.id}</span>
              </h2>
            </div>
            <button className="service-btn-close-details" onClick={closeDetails}>
              <i className="fas fa-times"></i> {t("Close Details")}
            </button>
          </div>

          <div className="service-details-body">
            <div className="service-details-grid">
              <PermissionGate moduleId="serviceexec" optionId="serviceexec_services">
                <ServiceSummaryCard
                  jobId={currentDetailsJob.id}
                  jobOrderBackendId={currentDetailsJob._backendId}
                  orderNumber={currentDetailsJob.id}
                  vehicleType={currentDetailsJob?.vehicleDetails?.type}
                  services={currentDetailsJob.services || []}
                  onServicesReorder={handleServicesReorder}
                  onServiceUpdate={handleServiceUpdate}
                  onAddService={handleAddService}
                  onFinishWork={handleFinishWork}
                  allServicesCompleted={allServicesCompleted}
                  canFinishWork={canFinishWork}
                  isFinishingWork={isFinishingWork}
                  editMode={detailsEditMode}
                  setEditMode={setDetailsEditMode}
                  availableTechs={technicianNames}
                  availableAssignees={operationAssigneeOptions}
                  isAdmin={canAssignService}
                  isAddingService={isAddingService}
                />
              </PermissionGate>

              <PermissionGate moduleId="serviceexec" optionId="serviceexec_summary">
                <JobOrderSummaryCard order={currentDetailsJob} identityToUsernameMap={actorLabelMap} />
              </PermissionGate>

              <PermissionGate moduleId="serviceexec" optionId="serviceexec_roadmap">
                <div className="jh-card jh-span-2">
                  {roadmap.length === 0 ? (
                    <div className="jh-empty-inline">{t("No roadmap data.")}</div>
                  ) : (
                    <UnifiedJobOrderRoadmap order={{ ...currentDetailsJob, roadmap }} />
                  )}
                </div>
              </PermissionGate>

              <PermissionGate moduleId="serviceexec" optionId="serviceexec_customer">
                <CustomerInfoCard order={currentDetailsJob} />
              </PermissionGate>

              <PermissionGate moduleId="serviceexec" optionId="serviceexec_vehicle">
                <VehicleInfoCard order={currentDetailsJob} />
              </PermissionGate>

              {currentDetailsJob.customerNotes && (
                <PermissionGate moduleId="serviceexec" optionId="serviceexec_notes">
                  <CustomerNotesCard order={currentDetailsJob} />
                </PermissionGate>
              )}

              <PermissionGate moduleId="serviceexec" optionId="serviceexec_quality">
                <QualityCheckListCard order={currentDetailsJob} />
              </PermissionGate>

              <PermissionGate moduleId="serviceexec" optionId="serviceexec_billing">
                <BillingCard order={currentDetailsJob} />
              </PermissionGate>

              <PermissionGate moduleId="serviceexec" optionId="serviceexec_exitpermit">
                <ExitPermitDetailsCard order={currentDetailsJob} />
              </PermissionGate>

              <PermissionGate moduleId="serviceexec" optionId="serviceexec_documents">
                <DocumentsCard order={currentDetailsJob} resolveUrl={resolveMaybeStorageUrl} />
              </PermissionGate>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- LIST SCREEN ----------------
  const tabTitle =
    currentTab === "completed"
      ? t("Completed tasks")
      : currentTab === "unassigned"
        ? t("Unassigned tasks")
        : currentTab === "team"
          ? t("Team tasks")
          : t("Assigned to me");

  return (
    <div className="service-execution-wrapper">
      <div className="app-container">
        <header className="app-header crm-unified-header">
          <div className="header-left">
            <div className="service-kicker">
              <i className="fas fa-clipboard-check"></i> {t("Records")}
            </div>
            <h1>
              <span className="service-title-icon" aria-hidden="true">
                <i className="fas fa-clipboard-check"></i>
              </span>
              {t("Services & Work Management")}
            </h1>
            <p className="service-header-sub">{t("Track assignments, execution progress, and service operations in one place.")}</p>
          </div>

          <div className="header-search-group search-section">
            <div className="search-container">
              <i className="fas fa-search search-icon"></i>
              <input
                type="text"
                className="smart-search-input"
                placeholder={t("Search by Job ID, Customer, Plate...")}
                value={currentSearch}
                onChange={(e) => setCurrentSearch(e.target.value)}
              />
            </div>
          </div>
        </header>

        <div className="task-tabs">
          <div className={`task-tab ${currentTab === "assigned" ? "active" : ""}`} onClick={() => setCurrentTab("assigned")}>
            <i className="fas fa-user-check"></i> {t("Assign to me")} ({counts.assigned})
          </div>
          {canViewUnassignedTab && (
            <div className={`task-tab ${currentTab === "unassigned" ? "active" : ""}`} onClick={() => setCurrentTab("unassigned")}>
              <i className="fas fa-user-slash"></i> {t("Unassigned tasks")} ({counts.unassigned})
            </div>
          )}
          {canViewTeamTab && (
            <div className={`task-tab ${currentTab === "team" ? "active" : ""}`} onClick={() => setCurrentTab("team")}>
              <i className="fas fa-users"></i> {t("Team tasks")} ({counts.team})
            </div>
          )}
          <div className={`task-tab completed ${currentTab === "completed" ? "active" : ""}`} onClick={() => setCurrentTab("completed")}>
            <i className="fas fa-circle-check"></i> {t("Completed tasks")} ({counts.completed})
          </div>
        </div>

        <section className="results-section">
          <div className="section-header">
            <h2>
              <i className="fas fa-tasks"></i> {tabTitle}
            </h2>
            <div className="pim-pagination-controls">
              <label htmlFor="pageSizeSelect">{t("Records per page:")}</label>
              <select
                id="pageSizeSelect"
                className="pim-page-size-select"
                value={pageSize}
                onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              >
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>

          {filteredJobs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-text">{loading ? t("Loading...") : t("No tasks in this view")}</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper">
                <table className="job-order-table">
                  <thead>
                    <tr>
                      <th>{t("Create Date")}</th>
                      <th>{t("Job Card ID")}</th>
                      <th>{t("Order Type")}</th>
                      <th>{t("Customer Name")}</th>
                      <th>{t("Vehicle Plate")}</th>
                      <th>{t("Assigned To")}</th>
                      <th>{t("Assigned Service")}</th>
                      <th>{t("Actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedJobs.map((job) => {
                      const currentService = pickNextActiveService(job.services);
                      const completedTask = isCompletedServiceExecutionTask(job);
                      const completedTaskReason = completedTask ? getCompletedTaskReason(job.services) : "";
                      const serviceDisplay = currentService
                        ? `${toBilingualName(currentService.name, (currentService as any).nameAr)} (${currentService.status})`
                        : completedTask
                          ? `${t("Completed services")} (${Array.isArray(job.services) ? job.services.length : 0})`
                          : t("No active services");
                      const assignedToDisplay = currentService?.assignedTo
                        ? getAssigneeDisplayName(currentService.assignedTo)
                        : completedTask
                          ? t("Completed")
                          : "-";

                      return (
                        <tr key={job.id}>
                          <td>{job.createDate}</td>
                          <td><strong>{job.id}</strong></td>
                          <td>{job.orderType}</td>
                          <td>{job.customerName}</td>
                          <td>{job.vehiclePlate}</td>
                          <td>{assignedToDisplay}</td>
                          <td data-no-translate="true">
                            <div className="sem-service-cell">
                              <span>{serviceDisplay}</span>
                              {completedTask ? (
                                <span className={`sem-completion-reason-badge ${completedTaskReason === "All Completed" ? "all-completed" : "mixed-completed"}`}>
                                  {t(completedTaskReason)}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            <PermissionGate moduleId="serviceexec" optionId="serviceexec_actions">
                              <div className="action-dropdown-container">
                                <button
                                  className={`btn-action-dropdown ${activeDropdown === job.id ? "active" : ""}`}
                                  onClick={(e) => toggleActionDropdown(job.id, e.currentTarget as HTMLElement)}
                                >
                                  <i className="fas fa-cogs"></i> {t("Actions")} <i className="fas fa-chevron-down"></i>
                                </button>
                              </div>
                            </PermissionGate>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {typeof document !== "undefined" &&
                  createPortal(
                    <PermissionGate moduleId="serviceexec" optionId="serviceexec_actions">
                      <div
                        className={`action-dropdown-menu show action-dropdown-menu-fixed ${activeDropdown ? "open" : "closed"}`}
                        style={activeDropdown ? { top: `${dropdownPosition.top}px`, left: `${dropdownPosition.left}px` } : { top: "-9999px", left: "-9999px" }}
                      >
                        <button
                          className="dropdown-item view"
                          onClick={() => {
                            if (!activeDropdown) return;
                            const target = activeDropdown;
                            const listJob = jobs.find(j => String(j.id ?? "") === String(target ?? "") || String(j.orderNumber ?? "") === String(target ?? ""));
                            activeDropdownRef.current = null;
                            setActiveDropdown(null);
                            void openDetailsView(target, listJob);
                          }}
                        >
                          <i className="fas fa-eye"></i> {t("View Details")}
                        </button>
                        <div className="dropdown-divider"></div>
                        <button className="dropdown-item delete" onClick={() => {
                          if (!activeDropdown) return;
                          const target = activeDropdown;
                          activeDropdownRef.current = null;
                          setActiveDropdown(null);
                          handleShowCancelConfirmation(target);
                        }}>
                          <i className="fas fa-times-circle"></i> {t("Cancel Order")}
                        </button>
                      </div>
                    </PermissionGate>,
                    document.body
                  )}
              </div>

              {totalPages > 1 && (
                <div className="pim-pagination">
                  <button className="pim-pagination-btn" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
                    <i className="fas fa-chevron-left"></i>
                  </button>

                  <div className="pim-page-numbers">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum: number;
                      if (totalPages <= 5) pageNum = i + 1;
                      else {
                        const start = Math.max(1, currentPage - 2);
                        const end = Math.min(totalPages, start + 4);
                        const adjustedStart = Math.max(1, end - 4);
                        pageNum = adjustedStart + i;
                      }
                      return (
                        <button
                          key={pageNum}
                          className={`pim-pagination-btn ${pageNum === currentPage ? "active" : ""}`}
                          onClick={() => setCurrentPage(pageNum)}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>

                  <button className="pim-pagination-btn" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                    <i className="fas fa-chevron-right"></i>
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <div className="service-footer">
          <p></p>
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      <PermissionGate moduleId="serviceexec" optionId="serviceexec_actions">
        <div className={`cancel-modal-overlay ${showCancelConfirmation && cancelOrderId ? "active" : ""}`}>
          <div className="cancel-modal">
            <div className="cancel-modal-header">
              <h3>
                <i className="fas fa-exclamation-triangle"></i> {t("Confirm Cancellation")}
              </h3>
            </div>
            <div className="cancel-modal-body">
              <div className="cancel-warning">
                <i className="fas fa-exclamation-circle"></i>
                <div className="cancel-warning-text">
                  <p>
                    {t("You are about to cancel order")} <strong>{cancelOrderId}</strong>.
                  </p>
                  <p>{t("This action cannot be undone.")}</p>
                </div>
              </div>
              <div className="cancel-modal-actions">
                <button
                  className="btn-cancel"
                  onClick={() => {
                    setShowCancelConfirmation(false);
                    setCancelOrderId(null);
                  }}
                >
                  <i className="fas fa-times"></i> {t("Keep Order")}
                </button>
                <button className="btn-confirm-cancel" onClick={() => void handleCancelOrder()} disabled={loading}>
                  <i className="fas fa-ban"></i> {loading ? t("Cancelling...") : t("Cancel Order")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </PermissionGate>
    </div>
  );
};

// -------------------- cards --------------------
function CustomerInfoCard({ order }: any) {
  return <UnifiedCustomerInfoCard order={order} className="cv-unified-card" />;
}

function VehicleInfoCard({ order }: any) {
  return <UnifiedVehicleInfoCard order={order} className="cv-unified-card" />;
}

function JobOrderSummaryCard({ order, identityToUsernameMap }: any) {
  const createdByDisplay = resolveOrderCreatedBy(order, {
    identityToUsernameMap,
    fallback: "-",
  });
  const normalizedWorkStatus = normalizeWorkStatusLabel(order?.summary?.workStatus || order?.workStatus);
  const normalizedPaymentStatus = normalizePaymentStatusLabel(order?.summary?.paymentStatus || order?.paymentStatus);

  return (
    <UnifiedJobOrderSummaryCard
      order={order}
      className="jh-summary-card"
      identityToUsernameMap={identityToUsernameMap}
      createdByOverride={createdByDisplay}
      workStatusOverride={normalizedWorkStatus}
      paymentStatusOverride={normalizedPaymentStatus}
    />
  );
}

function CustomerNotesCard({ order }: any) {
  const { t } = useLanguage();
  return (
    <div className="epm-detail-card sem-highlight-card">
      <h3><i className="fas fa-comment-dots"></i> {t("Customer Notes")}</h3>
      <div className="sem-highlight-content">
        {order.customerNotes}
      </div>
    </div>
  );
}

function DocumentsCard({ order, resolveUrl }: any) {
  const { t } = useLanguage();
  const { canOption } = usePermissions();
  const documents = filterVisibleDocuments(Array.isArray(order.documents) ? order.documents : [], canOption);
  if (documents.length === 0) return null;

  return (
    <div className="pim-detail-card">
      <h3><i className="fas fa-folder-open"></i> {t("Documents")}</h3>
      <div className="sem-docs-list">
        {documents.map((doc: any, idx: number) => (
          <div key={idx} className="sem-doc-item">
            <div className="sem-doc-item-left">
              <div className="sem-doc-item-head">
                <i className="fas fa-file-alt sem-doc-icon"></i>
                <div>
                  <div className="sem-doc-name">{doc.name}</div>
                  <div className="sem-doc-meta">
                    {doc.type} {doc.category ? `â€¢ ${doc.category}` : ""}
                    {doc.paymentReference ? ` â€¢ ${doc.paymentReference}` : ""}
                    {String(doc?.addedAt ?? doc?.generatedAt ?? doc?.createdAt ?? doc?.uploadedAt ?? doc?.timestamp ?? "").trim()
                      ? ` â€¢ ${t("Generated:")} ${String(doc?.addedAt ?? doc?.generatedAt ?? doc?.createdAt ?? doc?.uploadedAt ?? doc?.timestamp ?? "").trim()}`
                      : ""}
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={async () => {
                const raw = doc.storagePath || doc.url || "";
                const linkUrl = await resolveUrl(raw);
                if (!linkUrl) return;
                window.open(linkUrl, "_blank", "noopener,noreferrer");
              }}
              className="sem-doc-download-btn"
            >
              <i className="fas fa-download"></i> {t("Download")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function QualityCheckListCard({ order }: any) {
  const { t } = useLanguage();
  const services = Array.isArray(order.services) ? order.services : [];
  return (
    <div className="pim-detail-card sem-highlight-card">
      <h3><i className="fas fa-clipboard-check"></i> {t("Quality Check List")}</h3>
      <div className="sem-qc-list">
        {services.length > 0 ? (
          services.map((service: any, idx: number) => {
            const serviceName = service?.name || `Service ${idx + 1}`;
            const result = service?.qualityCheckResult || service?.qcResult || t("Not Evaluated");
            return (
              <div key={`${serviceName}-${idx}`} className="sem-qc-item">
                <span className="sem-qc-service">{serviceName}</span>
                <span className="sem-qc-result">
                  {result}
                </span>
              </div>
            );
          })
        ) : (
          <div className="sem-empty-inline">{t("No services to evaluate")}</div>
        )}
      </div>
    </div>
  );
}

function BillingCard({ order }: any) {
  return <UnifiedBillingInvoicesSection order={order} className="jh-card jh-span-2" />;
}

function ExitPermitDetailsCard({ order }: any) {
  const { t } = useLanguage();
  const permit = order?.exitPermit ?? {};
  const permitInfo = order?.exitPermitInfo ?? {};

  const status = mapExitPermitStatusToUi(
    order?.exitPermitStatus ?? permit?.status ?? permitInfo?.status,
    Boolean(firstNonEmptyText(permit?.permitId, permitInfo?.permitId))
  );

  const permitId = firstNonEmptyText(permit?.permitId, permitInfo?.permitId) || "-";
  const createDate = firstNonEmptyText(permit?.createDate, permitInfo?.createDate, order?.exitPermitDate) || "-";
  const nextServiceDate = firstNonEmptyText(permit?.nextServiceDate, permitInfo?.nextServiceDate, order?.nextServiceDate) || "-";
  const createdBy = normalizeActorDisplay(
    firstNonEmptyText(permit?.createdBy, permitInfo?.createdBy, permitInfo?.actionBy),
    "-"
  );
  const collectedBy = firstNonEmptyText(permit?.collectedBy, permitInfo?.collectedBy) || "-";
  const collectedByMobile = firstNonEmptyText(
    permit?.collectedByMobile,
    permitInfo?.collectedByMobile,
    permitInfo?.mobileNumber
  ) || "-";

  return (
    <div className="epm-detail-card ex-unified-card">
      <h3><i className="fas fa-id-card"></i> {t("Exit Permit")}</h3>
      <div className="epm-card-content ex-unified-grid">
        <div className="epm-info-item"><span className="epm-info-label">{t("Status")}</span><span className="epm-info-value"><span className={`epm-status-badge status-badge ${permitStatusClass(status)}`}>{status}</span></span></div>
        <div className="epm-info-item"><span className="epm-info-label">{t("Permit ID")}</span><span className="epm-info-value">{permitId}</span></div>
        <div className="epm-info-item"><span className="epm-info-label">{t("Create Date")}</span><span className="epm-info-value">{createDate}</span></div>
        <div className="epm-info-item"><span className="epm-info-label">{t("Next Service")}</span><span className="epm-info-value">{nextServiceDate}</span></div>
        <div className="epm-info-item"><span className="epm-info-label">{t("Created By")}</span><span className="epm-info-value">{createdBy}</span></div>
        <div className="epm-info-item"><span className="epm-info-label">{t("Collected By")}</span><span className="epm-info-value">{collectedBy}</span></div>
        <div className="epm-info-item"><span className="epm-info-label">{t("Mobile")}</span><span className="epm-info-value">{collectedByMobile}</span></div>
      </div>
    </div>
  );
}

export default ServiceExecutionModule;
