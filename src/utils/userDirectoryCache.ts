import { fetchAuthSession, fetchUserAttributes, getCurrentUser } from "aws-amplify/auth";

type UserEntry = {
  name: string;
  email: string;
  id?: string;
  profileOwner?: string;
  sub?: string;
};

export type UserDirectory = {
  users: UserEntry[];
  emailToNameMap: Record<string, string>;
  nameToEmailMap: Record<string, string>;
  // Backward-compatible property name used throughout the app;
  // values are display names (fullName), not usernames.
  identityToUsernameMap: Record<string, string>;
  loadedAt: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;

let userDirectoryCache: UserDirectory | null = null;
let userDirectoryInflight: Promise<UserDirectory> | null = null;

export function invalidateUserDirectoryCache() {
  userDirectoryCache = null;
  userDirectoryInflight = null;
}

export function normalizeIdentity(value: any) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeIdentityLoose(value: any) {
  return normalizeIdentity(value).replace(/[^a-z0-9]/g, "");
}

function parseProfileOwner(profileOwnerRaw: any) {
  const normalized = normalizeIdentity(profileOwnerRaw);
  if (!normalized) return { normalized: "", sub: "", email: "" };
  const [lhs = "", rhs = ""] = normalized.split("::");
  return {
    normalized,
    sub: lhs.trim(),
    email: rhs.trim(),
  };
}

function toDisplayName(row: any, fallbackEmail: string) {
  const direct = [
    row?.fullName,
    row?.fullname,
    row?.full_name,
    row?.displayName,
    row?.name,
    row?.given_name && row?.family_name ? `${row.given_name} ${row.family_name}` : "",
    row?.firstName && row?.lastName ? `${row.firstName} ${row.lastName}` : "",
  ]
    .map((v) => String(v ?? "").trim())
    .find(Boolean);

  return direct || fallbackEmail || "unknown";
}

function isPlaceholderName(value: string) {
  const v = normalizeIdentity(value);
  return !v || v === "unknown" || v === "system" || v === "system user" || v === "n/a" || v === "na";
}

function isEmailLike(value: string) {
  const v = String(value ?? "").trim();
  return v.includes("@");
}

function isUsernameLike(value: string) {
  const v = String(value ?? "").trim();
  if (!v) return false;
  if (v.includes(" ")) return false;
  if (isEmailLike(v)) return false;
  return /^[a-z0-9._-]{3,}$/i.test(v);
}

function displayNameQuality(value: string) {
  const name = String(value ?? "").trim();
  if (isPlaceholderName(name)) return 0;
  if (isEmailLike(name)) return 1;
  if (isUsernameLike(name)) return 1;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return 3;
  return 2;
}

function maybeSetDisplayName(target: Record<string, string>, key: string, candidate: string) {
  const normalizedKey = String(key ?? "").trim();
  if (!normalizedKey) return;
  const next = String(candidate ?? "").trim();
  if (!next) return;

  const existing = String(target[normalizedKey] ?? "").trim();
  if (!existing || displayNameQuality(next) > displayNameQuality(existing)) {
    target[normalizedKey] = next;
  }
}

function buildDirectory(rows: any[]): UserDirectory {
  const users: UserEntry[] = [];
  const emailToNameMap: Record<string, string> = {};
  const nameToEmailMap: Record<string, string> = {};
  const identityToUsernameMap: Record<string, string> = {};

  const toUsername = (emailLike: string) => {
    const normalized = normalizeIdentity(emailLike);
    const at = normalized.indexOf("@");
    return at > 0 ? normalized.slice(0, at) : normalized;
  };

  for (const row of rows ?? []) {
    const owner = parseProfileOwner(row?.profileOwner);
    const email = normalizeIdentity(row?.email) || owner.email;
    const id = normalizeIdentity(row?.id);
    const profileOwner = owner.normalized;
    const sub = owner.sub;
    const name = toDisplayName(row, email);
    const username = email ? toUsername(email) : "";

    if (!email && !id && !profileOwner && !sub) continue;

    users.push({ name, email, id: id || undefined, profileOwner: profileOwner || undefined, sub: sub || undefined });

    if (email) {
      maybeSetDisplayName(emailToNameMap, email, name);
    }

    const nameKey = normalizeIdentity(name);
    if (nameKey && email && !nameToEmailMap[nameKey]) nameToEmailMap[nameKey] = email;

    const identityKeys = [email, id, profileOwner, sub, nameKey, username].filter(Boolean);
    for (const key of identityKeys) {
      maybeSetDisplayName(identityToUsernameMap, key, name);

      const loose = normalizeIdentityLoose(key);
      if (loose) {
        maybeSetDisplayName(identityToUsernameMap, loose, name);
      }
    }
  }

  return {
    users,
    emailToNameMap,
    nameToEmailMap,
    identityToUsernameMap,
    loadedAt: Date.now(),
  };
}

async function getCurrentAuthDisplaySeed() {
  try {
    const [user, attrs, session] = await Promise.all([
      getCurrentUser().catch(() => null),
      fetchUserAttributes().catch(() => ({} as any)),
      fetchAuthSession({ forceRefresh: true }).catch(() => null),
    ]);

    const idPayload: any = session?.tokens?.idToken?.payload ?? {};

    const email = normalizeIdentity((attrs as any)?.email ?? idPayload?.email ?? user?.signInDetails?.loginId ?? "");
    const displayName =
      String((attrs as any)?.name ?? "").trim() ||
      String(idPayload?.name ?? "").trim() ||
      `${String(idPayload?.given_name ?? "").trim()} ${String(idPayload?.family_name ?? "").trim()}`.trim() ||
      `${String((attrs as any)?.given_name ?? "").trim()} ${String((attrs as any)?.family_name ?? "").trim()}`.trim();

    if (!displayName) return null;

    const username = email ? email.split("@")[0] : "";
    const userName = normalizeIdentity(user?.username ?? user?.userId ?? "");
    const loginId = normalizeIdentity(user?.signInDetails?.loginId ?? idPayload?.username ?? "");
    const preferredUsername = normalizeIdentity((attrs as any)?.preferred_username ?? idPayload?.preferred_username ?? "");

    return {
      displayName,
      email,
      username,
      userName,
      loginId,
      preferredUsername,
    };
  } catch {
    return null;
  }
}

export async function getUserDirectory(client: any, forceRefresh = false): Promise<UserDirectory> {
  if (!forceRefresh && userDirectoryCache && Date.now() - userDirectoryCache.loadedAt < CACHE_TTL_MS) {
    return userDirectoryCache;
  }

  if (!forceRefresh && userDirectoryInflight) {
    return userDirectoryInflight;
  }

  userDirectoryInflight = (async () => {
    try {
      const allRows: any[] = [];

      try {
        let nextToken: string | null | undefined = null;
        let guard = 0;
        do {
          let pageResult: any;
          pageResult = await client.models.UserProfile.list({
            limit: 2000,
            nextToken: nextToken ?? undefined,
          });
          const pageData = Array.isArray(pageResult?.data) ? pageResult.data : [];
          allRows.push(...pageData);
          nextToken = pageResult?.nextToken;
          guard += 1;
        } while (nextToken && guard < 50);
      } catch {
      }

      try {
        let nextToken: string | null | undefined = null;
        let guard = 0;
        do {
          let employeePage: any;
          employeePage = await client.models.Employee.list({
            limit: 2000,
            nextToken: nextToken ?? undefined,
          });
          const employees = Array.isArray(employeePage?.data) ? employeePage.data : [];
          for (const employee of employees) {
            const email = String(employee?.email ?? "").trim();
            const fullName = `${String(employee?.firstName ?? "").trim()} ${String(employee?.lastName ?? "").trim()}`.trim();
            if (!email && !fullName) continue;
            allRows.push({
              id: employee?.id,
              email,
              fullName,
            });
          }
          nextToken = employeePage?.nextToken;
          guard += 1;
        } while (nextToken && guard < 50);
      } catch {
      }

      const authSeed = await getCurrentAuthDisplaySeed();
      if (authSeed) {
        allRows.push({
          email: authSeed.email,
          fullName: authSeed.displayName,
          id: authSeed.userName || undefined,
          profileOwner: authSeed.loginId?.includes("::") ? authSeed.loginId : undefined,
        });
        if (authSeed.username) {
          allRows.push({
            email: authSeed.username,
            fullName: authSeed.displayName,
          });
        }
        if (authSeed.preferredUsername) {
          allRows.push({
            email: authSeed.preferredUsername,
            fullName: authSeed.displayName,
          });
        }
      }

      const directory = buildDirectory(allRows);
      userDirectoryCache = directory;
      return directory;
    } finally {
      userDirectoryInflight = null;
    }
  })();

  return userDirectoryInflight;
}
