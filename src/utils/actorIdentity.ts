export function normalizeActorIdentity(value: any) {
  return String(value ?? "").trim().toLowerCase();
}

function usernameFromEmail(email: string) {
  const normalized = normalizeActorIdentity(email);
  const at = normalized.indexOf("@");
  return at > 0 ? normalized.slice(0, at) : normalized;
}

function looksLikeOpaqueActorId(value: string) {
  const v = normalizeActorIdentity(value);
  if (!v) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) return true;
  if (/^[a-f0-9-]{24,}$/i.test(v) && !v.includes("@")) return true;
  return false;
}

function isPlaceholderActor(value: string) {
  const normalized = normalizeActorIdentity(value);
  return (
    !normalized ||
    normalized === "-" ||
    normalized === "--" ||
    normalized === "—" ||
    normalized === "null" ||
    normalized === "undefined" ||
    normalized === "system" ||
    normalized === "system user" ||
    normalized === "unknown" ||
    normalized === "not assigned" ||
    normalized === "n/a" ||
    normalized === "na"
  );
}

export function isPlaceholderActorValue(value: any) {
  return isPlaceholderActor(String(value ?? "").trim());
}

export function firstPreferredActorValue(...values: any[]) {
  const normalized = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  const nonPlaceholder = normalized.find((value) => !isPlaceholderActor(value));
  return nonPlaceholder ?? normalized[0] ?? "";
}

export function resolveActorUsername(user: any, fallback = "system") {
  const loginId = String(user?.signInDetails?.loginId ?? "").trim();
  if (loginId && !looksLikeOpaqueActorId(loginId)) return normalizeActorIdentity(loginId);

  const email = String(user?.email ?? user?.attributes?.email ?? "").trim();
  if (email) return normalizeActorIdentity(email);

  const preferredUsername = String(user?.attributes?.preferred_username ?? user?.signInDetails?.username ?? "").trim();
  if (preferredUsername && !looksLikeOpaqueActorId(preferredUsername)) return normalizeActorIdentity(preferredUsername);

  const username = String(user?.username ?? user?.userName ?? user?.attributes?.username ?? "").trim();
  if (username && !looksLikeOpaqueActorId(username)) return normalizeActorIdentity(username);

  const name = String(user?.name ?? "").trim();
  if (name && !looksLikeOpaqueActorId(name)) return normalizeActorIdentity(name);

  return normalizeActorIdentity(fallback || "system");
}

export function resolveActorDisplay(
  value: any,
  options?: {
    fallback?: string;
    identityToUsernameMap?: Record<string, string>;
  }
) {
  const fallback = String(options?.fallback ?? "—").trim() || "—";
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  const normalized = normalizeActorIdentity(raw);
  const mapped = options?.identityToUsernameMap?.[normalized];
  const resolved = String(mapped ?? raw).trim();
  if (!resolved) return fallback;
  if (isPlaceholderActor(resolved)) return fallback;

  if (resolved.includes("::")) {
    const [, rhs = ""] = resolved.split("::");
    const maybeEmail = rhs.trim();
    if (maybeEmail.includes("@")) return usernameFromEmail(maybeEmail);
  }

  if (resolved.includes("@")) {
    return usernameFromEmail(resolved);
  }

  if (looksLikeOpaqueActorId(resolved)) {
    return fallback;
  }

  return normalizeActorIdentity(resolved);
}

function normalizeStepKey(value: any) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
}

function findNewRequestStep(roadmap: any[]) {
  return (Array.isArray(roadmap) ? roadmap : []).find((step: any) => normalizeStepKey(step?.step) === "newrequest");
}

export function resolveOrderCreatedBy(
  order: any,
  options?: {
    fallback?: string;
    identityToUsernameMap?: Record<string, string>;
  }
) {
  const summary = order?.jobOrderSummary ?? order?.summary ?? {};
  const roadmap = Array.isArray(order?.roadmap) ? order.roadmap : [];
  const newRequestStep = findNewRequestStep(roadmap);

  const actor = firstPreferredActorValue(
    summary?.createdByName,
    summary?.createdBy,
    summary?.createBy,
    summary?.createdByUser,
    summary?.createdByUserName,
    summary?.updatedBy,
    order?.createdByName,
    order?.createdBy,
    order?.createdByUserName,
    order?.updatedBy,
    newRequestStep?.actionBy,
    newRequestStep?.updatedBy,
    newRequestStep?.createdBy,
    order?.createdByDisplay,
    order?.createdByEmail,
    order?.creatorName,
    order?.createdUserName,
    order?.customerDetails?.createdBy,
    order?.vehicleDetails?.createdBy
  );

  return resolveActorDisplay(actor, {
    identityToUsernameMap: options?.identityToUsernameMap,
    fallback: options?.fallback ?? "—",
  });
}

export function resolveOrderUpdatedBy(
  order: any,
  options?: {
    fallback?: string;
    identityToUsernameMap?: Record<string, string>;
  }
) {
  const summary = order?.jobOrderSummary ?? order?.summary ?? {};
  const roadmap = Array.isArray(order?.roadmap) ? order.roadmap : [];
  const latestStepWithActor = roadmap
    .slice()
    .reverse()
    .find((step: any) => String(step?.actionBy ?? step?.updatedBy ?? "").trim());

  const actor = firstPreferredActorValue(
    summary?.updatedByName,
    summary?.updatedBy,
    order?.updatedByName,
    order?.updatedBy,
    latestStepWithActor?.actionBy,
    latestStepWithActor?.updatedBy,
    resolveOrderCreatedBy(order, { fallback: "" })
  );

  return resolveActorDisplay(actor, {
    identityToUsernameMap: options?.identityToUsernameMap,
    fallback: options?.fallback ?? "—",
  });
}
