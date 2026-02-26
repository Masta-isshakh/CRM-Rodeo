export function normalizeActorIdentity(value: any) {
  return String(value ?? "").trim().toLowerCase();
}

export function resolveActorUsername(user: any, fallback = "system") {
  const username = String(
    user?.username ??
      user?.userName ??
      user?.signInDetails?.username ??
      user?.attributes?.preferred_username ??
      user?.attributes?.username ??
      ""
  ).trim();

  if (username) return normalizeActorIdentity(username);

  const loginId = String(user?.signInDetails?.loginId ?? "").trim();
  if (loginId) return normalizeActorIdentity(loginId);

  const email = String(user?.email ?? user?.attributes?.email ?? "").trim();
  if (email) return normalizeActorIdentity(email);

  const name = String(user?.name ?? "").trim();
  if (name) return normalizeActorIdentity(name);

  return normalizeActorIdentity(fallback || "system");
}
