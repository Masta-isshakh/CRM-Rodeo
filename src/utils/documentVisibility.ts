type CanOptionFn = (moduleId: string, optionId: string, fallback?: boolean) => boolean;

function safeLower(value: any) {
  return String(value ?? "").trim().toLowerCase();
}

export type DocumentVisibilityKind = "bill" | "exitpermit" | "inspection" | "qualitycheck" | "other";

export function getDocumentVisibilityKind(doc: any): DocumentVisibilityKind {
  const type = safeLower(doc?.type);
  const name = safeLower(doc?.name || doc?.title);
  const category = safeLower(doc?.category);
  const storagePath = safeLower(doc?.storagePath || doc?.url || doc?.fileData);
  const billReference = safeLower(doc?.billReference);
  const permitReference = safeLower(doc?.permitReference);

  if (
    type.includes("invoice/bill") ||
    type.includes("bill") ||
    category.includes("billing") ||
    name.startsWith("bill_") ||
    storagePath.includes("/billing/") ||
    Boolean(billReference)
  ) {
    return "bill";
  }

  if (
    type.includes("exit permit") ||
    name.includes("exitpermit") ||
    storagePath.includes("/exit-permits/") ||
    Boolean(permitReference)
  ) {
    return "exitpermit";
  }

  if (
    type.includes("inspection report") ||
    name.includes("inspection_report") ||
    storagePath.includes("/inspection/")
  ) {
    return "inspection";
  }

  if (
    type.includes("quality check report") ||
    name.includes("quality_check") ||
    name.includes("quality-check")
  ) {
    return "qualitycheck";
  }

  return "other";
}

export function canViewDocumentByRole(doc: any, canOption: CanOptionFn): boolean {
  const kind = getDocumentVisibilityKind(doc);

  if (kind === "bill") return canOption("payment", "payment_documents", false);
  if (kind === "exitpermit") return canOption("exitpermit", "exitpermit_documents", false);
  if (kind === "inspection") return canOption("inspection", "inspection_documents", false);
  if (kind === "qualitycheck") return canOption("qualitycheck", "qualitycheck_documents", false);
  return true;
}

export function filterVisibleDocuments<T>(documents: T[], canOption: CanOptionFn): T[] {
  return (Array.isArray(documents) ? documents : []).filter((doc) => canViewDocumentByRole(doc, canOption));
}

export function canViewBillArtifacts(canOption: CanOptionFn): boolean {
  return canOption("payment", "payment_documents", false);
}