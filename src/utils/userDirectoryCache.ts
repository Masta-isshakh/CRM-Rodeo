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
  identityToUsernameMap: Record<string, string>;
  loadedAt: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;

let userDirectoryCache: UserDirectory | null = null;
let userDirectoryInflight: Promise<UserDirectory> | null = null;

export function normalizeIdentity(value: any) {
  return String(value ?? "").trim().toLowerCase();
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

  const extractSub = (profileOwnerRaw: string) => {
    const normalized = normalizeIdentity(profileOwnerRaw);
    if (!normalized) return "";
    const [lhs = ""] = normalized.split("::");
    return lhs.trim();
  };

  for (const row of rows ?? []) {
    const email = normalizeIdentity(row?.email);
    if (!email) continue;

    const name = String(row?.fullName ?? row?.name ?? row?.email ?? "").trim() || email;
    const id = normalizeIdentity(row?.id);
    const profileOwner = normalizeIdentity(row?.profileOwner);
    const sub = extractSub(profileOwner);
    const username = toUsername(email);

    users.push({ name, email, id: id || undefined, profileOwner: profileOwner || undefined, sub: sub || undefined });

    if (!emailToNameMap[email]) emailToNameMap[email] = name;

    const nameKey = normalizeIdentity(name);
    if (nameKey && !nameToEmailMap[nameKey]) nameToEmailMap[nameKey] = email;

    const identityKeys = [email, id, profileOwner, sub, nameKey].filter(Boolean);
    for (const key of identityKeys) {
      if (!identityToUsernameMap[key]) {
        identityToUsernameMap[key] = username;
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

export async function getUserDirectory(client: any, forceRefresh = false): Promise<UserDirectory> {
  if (!forceRefresh && userDirectoryCache && Date.now() - userDirectoryCache.loadedAt < CACHE_TTL_MS) {
    return userDirectoryCache;
  }

  if (!forceRefresh && userDirectoryInflight) {
    return userDirectoryInflight;
  }

  userDirectoryInflight = (async () => {
    try {
      const res = await client.models.UserProfile.list({ limit: 2000 });
      const directory = buildDirectory(res?.data ?? []);
      userDirectoryCache = directory;
      return directory;
    } finally {
      userDirectoryInflight = null;
    }
  })();

  return userDirectoryInflight;
}
