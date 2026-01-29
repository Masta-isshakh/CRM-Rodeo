export const DEPT_PREFIX = "DEPT_";

/** Convert a human label to a Cognito group key (DEPT_*) */
export function toDeptKey(label: string) {
  const base = label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${DEPT_PREFIX}${base}`;
}

/** Convert a DEPT_* key to a nice label */
export function keyToLabel(key: string) {
  const raw = key.startsWith(DEPT_PREFIX) ? key.slice(DEPT_PREFIX.length) : key;
  const spaced = raw.replace(/_+/g, " ").trim().toLowerCase();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** True if group is a department group (DEPT_*) */
export function isDeptGroup(groupName?: string) {
  return !!groupName && groupName.startsWith(DEPT_PREFIX);
}
