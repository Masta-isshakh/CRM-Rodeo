export function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function splitSearchTerms(value: unknown): string[] {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(" ") : [];
}

export function buildSearchHaystack(values: unknown[]): string {
  return normalizeSearchText(
    values
      .filter((value) => value != null)
      .map((value) => String(value))
      .join(" ")
  );
}

export function matchesSearchQuery(values: unknown[], query: unknown): boolean {
  const terms = splitSearchTerms(query);
  if (!terms.length) return true;

  const haystack = buildSearchHaystack(values);
  return terms.every((term) => haystack.includes(term));
}