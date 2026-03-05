import { normalizeIdentity } from "./userDirectoryCache";

export type UserOption = { value: string; label: string };

type OptionInput =
  | string
  | {
      value?: any;
      label?: any;
    }
  | null
  | undefined;

type DedupeUserOptionsConfig = {
  dedupeByLabel?: boolean;
};

function isEmailLike(value: any) {
  const normalized = normalizeIdentity(value);
  return normalized.includes("@");
}

function extractEmailCandidate(value: any) {
  const normalized = normalizeIdentity(value);
  if (!normalized) return "";
  if (normalized.includes("::")) {
    const parts = normalized.split("::");
    const rhs = normalizeIdentity(parts[parts.length - 1]);
    return isEmailLike(rhs) ? rhs : "";
  }
  return isEmailLike(normalized) ? normalized : "";
}

function toIdentityEmailKey(value: any) {
  const email = extractEmailCandidate(value);
  return email ? `email:${email}` : "";
}

function getCachedRootAdminEmail() {
  try {
    if (typeof window === "undefined") return "";
    const raw = String(window.localStorage.getItem("crm.rootAdminEmail") ?? "").trim().toLowerCase();
    if (!raw || raw === "root-admin@system") return "";
    return extractEmailCandidate(raw);
  } catch {
    return "";
  }
}

function displayNameQuality(value: any) {
  const raw = String(value ?? "").trim();
  const normalized = normalizeIdentity(raw);
  if (!normalized) return 0;
  if (normalized === "unknown" || normalized === "system" || normalized === "system user" || normalized === "n/a" || normalized === "na") {
    return 0;
  }
  if (isEmailLike(normalized)) return 1;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return 3;
  return 2;
}

function choosePreferredOption(current: UserOption, incoming: UserOption): UserOption {
  const currentIsEmailValue = isEmailLike(current.value);
  const incomingIsEmailValue = isEmailLike(incoming.value);

  let preferred = current;
  if (!currentIsEmailValue && incomingIsEmailValue) {
    preferred = incoming;
  }

  const preferredLabel =
    displayNameQuality(incoming.label) > displayNameQuality(preferred.label)
      ? incoming.label
      : preferred.label;

  return {
    value: preferred.value,
    label: preferredLabel,
  };
}

function collapseUserOptionsByLabel(options: UserOption[]): UserOption[] {
  const byLabel = new Map<string, UserOption>();

  for (const option of options || []) {
    const labelKey = normalizeIdentity(option.label);
    if (!labelKey) continue;

    const existing = byLabel.get(labelKey);
    if (!existing) {
      byLabel.set(labelKey, option);
      continue;
    }

    byLabel.set(labelKey, choosePreferredOption(existing, option));
  }

  return Array.from(byLabel.values());
}

function buildCanonicalIdentity(user: any) {
  const email =
    extractEmailCandidate(user?.email) ||
    extractEmailCandidate(user?.profileOwner) ||
    extractEmailCandidate(user?.id) ||
    extractEmailCandidate(user?.sub);

  if (email) {
    return {
      key: `email:${email}`,
      value: email,
      email,
    };
  }

  const id = normalizeIdentity(user?.id);
  if (id) {
    return { key: `id:${id}`, value: id, email: "" };
  }

  const profileOwner = normalizeIdentity(user?.profileOwner);
  if (profileOwner) {
    return { key: `profileOwner:${profileOwner}`, value: profileOwner, email: "" };
  }

  const sub = normalizeIdentity(user?.sub);
  if (sub) {
    return { key: `sub:${sub}`, value: sub, email: "" };
  }

  const name = normalizeIdentity(user?.name);
  if (name) {
    return { key: `name:${name}`, value: name, email: "" };
  }

  return { key: "", value: "", email: "" };
}

export function dedupeTextOptions(values: Array<any>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of values || []) {
    const label = String(raw ?? "").trim();
    const key = normalizeIdentity(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }

  return out;
}

export function dedupeUserOptions(values: OptionInput[], config: DedupeUserOptionsConfig = {}): UserOption[] {
  const out: UserOption[] = [];
  const seenValues = new Set<string>();
  const seenLabels = new Set<string>();
  const dedupeByLabel = Boolean(config.dedupeByLabel);

  for (const item of values || []) {
    const rawValue = typeof item === "string" ? item : item?.value;
    const rawLabel = typeof item === "string" ? item : item?.label ?? item?.value;

    const value = normalizeIdentity(rawValue);
    const label = String(rawLabel ?? rawValue ?? "").trim() || value;
    const labelKey = normalizeIdentity(label);

    if (!value || seenValues.has(value)) continue;
    if (dedupeByLabel && labelKey && seenLabels.has(labelKey)) continue;

    seenValues.add(value);
    if (labelKey) seenLabels.add(labelKey);
    out.push({ value, label });
  }

  return out;
}

export function buildAssigneeOptionsFromDirectory(
  users: any[],
  identityToUsernameMap: Record<string, string> = {},
  currentUser?: any
): UserOption[] {
  const merged = new Map<string, UserOption>();

  const pickBetterLabel = (currentLabel: string, incomingLabel: string) => {
    if (!currentLabel) return incomingLabel;
    if (!incomingLabel) return currentLabel;
    return displayNameQuality(incomingLabel) > displayNameQuality(currentLabel) ? incomingLabel : currentLabel;
  };

  const upsert = (identityKey: string, value: string, label: string) => {
    if (!identityKey || !value) return;
    const existing = merged.get(identityKey);
    if (!existing) {
      merged.set(identityKey, { value: normalizeIdentity(value), label: String(label ?? value).trim() || normalizeIdentity(value) });
      return;
    }

    merged.set(identityKey, {
      value: existing.value || normalizeIdentity(value),
      label: pickBetterLabel(existing.label, String(label ?? value).trim()),
    });
  };

  for (const user of users || []) {
    const identity = buildCanonicalIdentity(user);
    if (!identity.key || !identity.value) continue;

    const emailKey = identity.email || normalizeIdentity(user?.email);
    const identityLabelFromMap =
      (emailKey ? identityToUsernameMap[emailKey] : "") ||
      identityToUsernameMap[normalizeIdentity(user?.id)] ||
      identityToUsernameMap[normalizeIdentity(user?.profileOwner)] ||
      identityToUsernameMap[normalizeIdentity(user?.sub)] ||
      "";

    const label = user?.name || identityLabelFromMap || identity.email || identity.value;
    upsert(identity.key, identity.value, label);
  }

  for (const [rawIdentity, displayName] of Object.entries(identityToUsernameMap || {})) {
    const emailKey = toIdentityEmailKey(rawIdentity);
    if (!emailKey) continue;
    const email = emailKey.replace(/^email:/, "");
    upsert(emailKey, email, String(displayName ?? email).trim() || email);
  }

  const meEmail =
    extractEmailCandidate(currentUser?.email) ||
    extractEmailCandidate(currentUser?.attributes?.email) ||
    extractEmailCandidate(currentUser?.signInDetails?.loginId);
  const meValue = meEmail || normalizeIdentity(currentUser?.username || currentUser?.userName || currentUser?.name);
  if (meValue) {
    const meKey = meEmail ? `email:${meEmail}` : `current:${meValue}`;
    upsert(meKey, meValue, currentUser?.name || meEmail || meValue);
  }

  const cachedRootAdminEmail = getCachedRootAdminEmail();
  if (cachedRootAdminEmail) {
    const cachedRootLabel =
      identityToUsernameMap[cachedRootAdminEmail] ||
      identityToUsernameMap[normalizeIdentity(cachedRootAdminEmail)] ||
      "Root Admin";
    upsert(`email:${cachedRootAdminEmail}`, cachedRootAdminEmail, cachedRootLabel);
  }

  const normalized = dedupeUserOptions(Array.from(merged.values()));
  const collapsedByLabel = collapseUserOptionsByLabel(normalized);
  return dedupeUserOptions(collapsedByLabel);
}

export function buildTechnicianNamesFromDirectory(
  users: any[],
  identityToUsernameMap: Record<string, string> = {},
  currentUser?: any
): string[] {
  const assignees = buildAssigneeOptionsFromDirectory(users, identityToUsernameMap, currentUser);
  return dedupeTextOptions(assignees.map((x) => x.label));
}
