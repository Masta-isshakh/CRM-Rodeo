import { translateTextValue } from "../i18n/translations";

const STORAGE_KEY = "crm.serviceTechnicians.catalog.v1";
const CHANGE_EVENT = "service-technicians:changed";

export type ServiceTechnicianItem = {
  id: string;
  serviceId: string;
  nameEn: string;
  nameAr: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeBilingualName(nameEn: unknown, nameAr: unknown): { en: string; ar: string } {
  const en = normalizeText(nameEn);
  const arRaw = normalizeText(nameAr);
  if (arRaw) return { en, ar: arRaw };
  if (!en) return { en: "", ar: "" };
  const translated = normalizeText(translateTextValue(en, "ar"));
  return { en, ar: translated && translated !== en ? translated : en };
}

function makeId() {
  return `svc-tech-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseCatalog(raw: string | null): ServiceTechnicianItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: any): ServiceTechnicianItem | null => {
        const id = normalizeText(item?.id) || makeId();
        const serviceId = normalizeText(item?.serviceId);
        const names = normalizeBilingualName(item?.nameEn, item?.nameAr);
        const nameEn = names.en;
        const nameAr = names.ar;
        if (!serviceId || (!nameEn && !nameAr)) return null;

        const createdAt = normalizeText(item?.createdAt) || new Date().toISOString();
        const updatedAt = normalizeText(item?.updatedAt) || createdAt;

        return {
          id,
          serviceId,
          nameEn,
          nameAr,
          description: normalizeText(item?.description),
          createdAt,
          updatedAt,
        };
      })
      .filter(Boolean) as ServiceTechnicianItem[];
  } catch {
    return [];
  }
}

function readCatalog(): ServiceTechnicianItem[] {
  if (typeof window === "undefined") return [];
  try {
    return parseCatalog(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeCatalog(items: ServiceTechnicianItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function listServiceTechnicianCatalog(): ServiceTechnicianItem[] {
  const rows = readCatalog();
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function addServiceTechnicianCatalogItem(input: {
  serviceId: string;
  nameEn: string;
  nameAr: string;
  description?: string;
}): ServiceTechnicianItem {
  const serviceId = normalizeText(input.serviceId);
  const names = normalizeBilingualName(input.nameEn, input.nameAr);
  const nameEn = names.en;
  const nameAr = names.ar;
  const description = normalizeText(input.description);

  if (!serviceId) throw new Error("Service ID is required.");
  if (!nameEn && !nameAr) throw new Error("At least one service name is required.");

  const existing = readCatalog();
  const duplicate = existing.find((item) => normalizeText(item.serviceId).toLowerCase() === serviceId.toLowerCase());
  if (duplicate) {
    throw new Error("Service ID already exists.");
  }

  const now = new Date().toISOString();
  const created: ServiceTechnicianItem = {
    id: makeId(),
    serviceId,
    nameEn,
    nameAr,
    description,
    createdAt: now,
    updatedAt: now,
  };

  writeCatalog([created, ...existing]);
  return created;
}

export function updateServiceTechnicianCatalogItem(
  id: string,
  updates: {
    serviceId: string;
    nameEn: string;
    nameAr: string;
    description?: string;
  },
): ServiceTechnicianItem {
  const normalizedId = normalizeText(id);
  if (!normalizedId) throw new Error("Service item ID is required.");

  const serviceId = normalizeText(updates.serviceId);
  const names = normalizeBilingualName(updates.nameEn, updates.nameAr);
  const nameEn = names.en;
  const nameAr = names.ar;
  const description = normalizeText(updates.description);

  if (!serviceId) throw new Error("Service ID is required.");
  if (!nameEn && !nameAr) throw new Error("At least one service name is required.");

  const existing = readCatalog();
  const index = existing.findIndex((item) => item.id === normalizedId);
  if (index < 0) throw new Error("Service item not found.");

  const duplicate = existing.find(
    (item) =>
      item.id !== normalizedId &&
      normalizeText(item.serviceId).toLowerCase() === serviceId.toLowerCase(),
  );
  if (duplicate) {
    throw new Error("Service ID already exists.");
  }

  const current = existing[index];
  const updated: ServiceTechnicianItem = {
    ...current,
    serviceId,
    nameEn,
    nameAr,
    description,
    updatedAt: new Date().toISOString(),
  };

  const next = [...existing];
  next[index] = updated;
  writeCatalog(next);
  return updated;
}

export function removeServiceTechnicianCatalogItem(id: string) {
  const normalizedId = normalizeText(id);
  if (!normalizedId) return;

  const existing = readCatalog();
  const next = existing.filter((item) => item.id !== normalizedId);
  if (next.length === existing.length) return;
  writeCatalog(next);
}

export function getServiceTechnicianCatalogChangeEventName() {
  return CHANGE_EVENT;
}
