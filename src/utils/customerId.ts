export function formatCustomerDisplayId(rawId: unknown): string {
  const raw = String(rawId ?? "").trim();
  if (!raw) return "—";

  const normalized = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (!normalized) return "—";

  return `CUS-${normalized.slice(-6)}`;
}
