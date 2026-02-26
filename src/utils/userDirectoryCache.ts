type UserEntry = {
  name: string;
  email: string;
};

export type UserDirectory = {
  users: UserEntry[];
  emailToNameMap: Record<string, string>;
  nameToEmailMap: Record<string, string>;
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

  for (const row of rows ?? []) {
    const email = normalizeIdentity(row?.email);
    if (!email) continue;

    const name = String(row?.fullName ?? row?.name ?? row?.email ?? "").trim() || email;

    users.push({ name, email });

    if (!emailToNameMap[email]) emailToNameMap[email] = name;

    const nameKey = normalizeIdentity(name);
    if (nameKey && !nameToEmailMap[nameKey]) nameToEmailMap[nameKey] = email;
  }

  return {
    users,
    emailToNameMap,
    nameToEmailMap,
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
