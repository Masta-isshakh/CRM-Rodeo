import { getDataClient } from "../lib/amplifyClient";

export type ServiceCatalogType = "service" | "package";

export type ServiceCategoryItem = {
  id: string;
  categoryCode: string;
  nameEn: string;
  nameAr: string;
  descriptionEn?: string;
  descriptionAr?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type ServiceCatalogItem = {
  id: string;
  serviceCode: string;
  name: string;
  nameAr?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  categoryId?: string;
  categoryCode?: string;
  categoryNameEn?: string;
  categoryNameAr?: string;
  type: ServiceCatalogType;
  suvPrice: number;
  sedanPrice: number;
  hatchbackPrice?: number;
  truckPrice?: number;
  coupePrice?: number;
  otherPrice?: number;
  includedServiceCodes: string[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

function parseIncludedCodes(raw: unknown): string[] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.map((v) => String(v || "").trim()).filter(Boolean);
  }

  const text = String(raw).trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => String(v || "").trim()).filter(Boolean);
    }
  } catch {
    return text
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }

  return [];
}

function toCatalogType(value: unknown): ServiceCatalogType {
  return String(value || "SERVICE").toUpperCase() === "PACKAGE" ? "package" : "service";
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function mapCategoryRow(row: any): ServiceCategoryItem {
  return {
    id: String(row?.id || ""),
    categoryCode: String(row?.categoryCode || "").trim(),
    nameEn: String(row?.nameEn || "").trim(),
    nameAr: String(row?.nameAr || "").trim(),
    descriptionEn: row?.descriptionEn ? String(row.descriptionEn) : undefined,
    descriptionAr: row?.descriptionAr ? String(row.descriptionAr) : undefined,
    isActive: row?.isActive !== false,
    createdAt: row?.createdAt ? String(row.createdAt) : undefined,
    updatedAt: row?.updatedAt ? String(row.updatedAt) : undefined,
  };
}

function mapServiceRow(row: any): ServiceCatalogItem {
  return {
    id: String(row?.id || ""),
    serviceCode: String(row?.serviceCode || "").trim(),
    name: String(row?.name || "").trim(),
    nameAr: row?.nameAr ? String(row.nameAr).trim() : undefined,
    descriptionEn: row?.descriptionEn ? String(row.descriptionEn) : undefined,
    descriptionAr: row?.descriptionAr ? String(row.descriptionAr) : undefined,
    categoryId: row?.categoryId ? String(row.categoryId) : undefined,
    categoryCode: row?.categoryCode ? String(row.categoryCode) : undefined,
    categoryNameEn: row?.categoryNameEn ? String(row.categoryNameEn) : undefined,
    categoryNameAr: row?.categoryNameAr ? String(row.categoryNameAr) : undefined,
    type: toCatalogType(row?.type),
    suvPrice: toNumber(row?.suvPrice),
    sedanPrice: toNumber(row?.sedanPrice),
    hatchbackPrice: toOptionalNumber(row?.hatchbackPrice),
    truckPrice: toOptionalNumber(row?.truckPrice),
    coupePrice: toOptionalNumber(row?.coupePrice),
    otherPrice: toOptionalNumber(row?.otherPrice),
    includedServiceCodes: parseIncludedCodes(row?.includedServiceCodesJson),
    isActive: row?.isActive !== false,
    createdAt: row?.createdAt ? String(row.createdAt) : undefined,
    updatedAt: row?.updatedAt ? String(row.updatedAt) : undefined,
  };
}

function compareServiceCode(a: string, b: string) {
  const am = a.match(/^([A-Za-z]+)(\d+)$/);
  const bm = b.match(/^([A-Za-z]+)(\d+)$/);

  if (!am || !bm) return a.localeCompare(b);

  if (am[1] !== bm[1]) return am[1].localeCompare(bm[1]);

  return Number(am[2]) - Number(bm[2]);
}

function sortCatalog(items: ServiceCatalogItem[]): ServiceCatalogItem[] {
  return [...items].sort((a, b) => {
    const byCode = compareServiceCode(a.serviceCode, b.serviceCode);
    if (byCode !== 0) return byCode;
    return a.name.localeCompare(b.name);
  });
}

export async function listServiceCategories(includeInactive = false): Promise<ServiceCategoryItem[]> {
  const client = getDataClient();

  const out: any[] = [];
  let nextToken: string | null | undefined = undefined;
  let pageResult: any;

  do {
    pageResult = await (client.models as any).ServiceCategory.list({
      limit: 1000,
      nextToken,
      ...(includeInactive ? {} : ({ filter: { isActive: { ne: false } } } as any)),
    } as any);

    out.push(...(pageResult?.data || []));
    nextToken = pageResult?.nextToken;
  } while (nextToken);

  return out
    .map(mapCategoryRow)
    .filter((c) => !!c.id && !!c.categoryCode && !!c.nameEn)
    .sort((a, b) => compareServiceCode(a.categoryCode, b.categoryCode));
}

export async function listServiceCatalog(includeInactive = false): Promise<ServiceCatalogItem[]> {
  const client = getDataClient();

  const out: any[] = [];
  let nextToken: string | null | undefined = undefined;
  let pageResult: any;

  do {
    pageResult = await client.models.ServiceCatalog.list({
      limit: 1000,
      nextToken,
      ...(includeInactive ? {} : ({ filter: { isActive: { ne: false } } } as any)),
    } as any);

    out.push(...(pageResult?.data || []));
    nextToken = pageResult?.nextToken;
  } while (nextToken);

  return sortCatalog(out.map(mapServiceRow).filter((s) => !!s.id && !!s.name && !!s.serviceCode));
}

export async function createServiceCatalogItem(input: {
  serviceCode: string;
  name: string;
  nameAr?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  categoryId?: string;
  categoryCode?: string;
  categoryNameEn?: string;
  categoryNameAr?: string;
  type: ServiceCatalogType;
  suvPrice: number;
  sedanPrice: number;
  hatchbackPrice?: number;
  truckPrice?: number;
  coupePrice?: number;
  otherPrice?: number;
  includedServiceCodes?: string[];
  isActive?: boolean;
}) {
  const client = getDataClient();

  const payload = {
    serviceCode: String(input.serviceCode || "").trim(),
    name: String(input.name || "").trim(),
    nameAr: input.nameAr ? String(input.nameAr).trim() : undefined,
    descriptionEn: input.descriptionEn ? String(input.descriptionEn).trim() : undefined,
    descriptionAr: input.descriptionAr ? String(input.descriptionAr).trim() : undefined,
    categoryId: input.categoryId || undefined,
    categoryCode: input.categoryCode ? String(input.categoryCode).trim() : undefined,
    categoryNameEn: input.categoryNameEn ? String(input.categoryNameEn).trim() : undefined,
    categoryNameAr: input.categoryNameAr ? String(input.categoryNameAr).trim() : undefined,
    type: input.type === "package" ? "PACKAGE" : "SERVICE",
    suvPrice: toNumber(input.suvPrice),
    sedanPrice: toNumber(input.sedanPrice),
    hatchbackPrice: toOptionalNumber(input.hatchbackPrice),
    truckPrice: toOptionalNumber(input.truckPrice),
    coupePrice: toOptionalNumber(input.coupePrice),
    otherPrice: toOptionalNumber(input.otherPrice),
    includedServiceCodesJson: JSON.stringify(input.includedServiceCodes || []),
    isActive: input.isActive !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const res = await client.models.ServiceCatalog.create(payload as any);
  if ((res as any)?.errors?.length) {
    throw new Error(String((res as any).errors[0]?.message || "Failed to create service"));
  }

  return mapServiceRow((res as any)?.data);
}

export async function updateServiceCatalogItem(input: {
  id: string;
  serviceCode: string;
  name: string;
  nameAr?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  categoryId?: string;
  categoryCode?: string;
  categoryNameEn?: string;
  categoryNameAr?: string;
  type: ServiceCatalogType;
  suvPrice: number;
  sedanPrice: number;
  hatchbackPrice?: number;
  truckPrice?: number;
  coupePrice?: number;
  otherPrice?: number;
  includedServiceCodes?: string[];
  isActive?: boolean;
}) {
  const client = getDataClient();

  const payload = {
    id: input.id,
    serviceCode: String(input.serviceCode || "").trim(),
    name: String(input.name || "").trim(),
    nameAr: input.nameAr ? String(input.nameAr).trim() : undefined,
    descriptionEn: input.descriptionEn ? String(input.descriptionEn).trim() : undefined,
    descriptionAr: input.descriptionAr ? String(input.descriptionAr).trim() : undefined,
    categoryId: input.categoryId || undefined,
    categoryCode: input.categoryCode ? String(input.categoryCode).trim() : undefined,
    categoryNameEn: input.categoryNameEn ? String(input.categoryNameEn).trim() : undefined,
    categoryNameAr: input.categoryNameAr ? String(input.categoryNameAr).trim() : undefined,
    type: input.type === "package" ? "PACKAGE" : "SERVICE",
    suvPrice: toNumber(input.suvPrice),
    sedanPrice: toNumber(input.sedanPrice),
    hatchbackPrice: toOptionalNumber(input.hatchbackPrice),
    truckPrice: toOptionalNumber(input.truckPrice),
    coupePrice: toOptionalNumber(input.coupePrice),
    otherPrice: toOptionalNumber(input.otherPrice),
    includedServiceCodesJson: JSON.stringify(input.includedServiceCodes || []),
    isActive: input.isActive !== false,
    updatedAt: new Date().toISOString(),
  };

  const res = await client.models.ServiceCatalog.update(payload as any);
  if ((res as any)?.errors?.length) {
    throw new Error(String((res as any).errors[0]?.message || "Failed to update service"));
  }

  return mapServiceRow((res as any)?.data);
}

export async function deleteServiceCatalogItem(id: string) {
  const client = getDataClient();
  const res = await client.models.ServiceCatalog.delete({ id } as any);
  if ((res as any)?.errors?.length) {
    throw new Error(String((res as any).errors[0]?.message || "Failed to delete service"));
  }
}

export async function createServiceCategoryItem(input: {
  categoryCode: string;
  nameEn: string;
  nameAr: string;
  descriptionEn?: string;
  descriptionAr?: string;
  isActive?: boolean;
}) {
  const client = getDataClient();

  const payload = {
    categoryCode: String(input.categoryCode || "").trim(),
    nameEn: String(input.nameEn || "").trim(),
    nameAr: String(input.nameAr || "").trim(),
    descriptionEn: input.descriptionEn ? String(input.descriptionEn).trim() : undefined,
    descriptionAr: input.descriptionAr ? String(input.descriptionAr).trim() : undefined,
    isActive: input.isActive !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const res = await (client.models as any).ServiceCategory.create(payload as any);
  if ((res as any)?.errors?.length) {
    throw new Error(String((res as any).errors[0]?.message || "Failed to create category"));
  }

  return mapCategoryRow((res as any)?.data);
}

export async function updateServiceCategoryItem(input: {
  id: string;
  categoryCode: string;
  nameEn: string;
  nameAr: string;
  descriptionEn?: string;
  descriptionAr?: string;
  isActive?: boolean;
}) {
  const client = getDataClient();

  const payload = {
    id: input.id,
    categoryCode: String(input.categoryCode || "").trim(),
    nameEn: String(input.nameEn || "").trim(),
    nameAr: String(input.nameAr || "").trim(),
    descriptionEn: input.descriptionEn ? String(input.descriptionEn).trim() : undefined,
    descriptionAr: input.descriptionAr ? String(input.descriptionAr).trim() : undefined,
    isActive: input.isActive !== false,
    updatedAt: new Date().toISOString(),
  };

  const res = await (client.models as any).ServiceCategory.update(payload as any);
  if ((res as any)?.errors?.length) {
    throw new Error(String((res as any).errors[0]?.message || "Failed to update category"));
  }

  return mapCategoryRow((res as any)?.data);
}

export async function deleteServiceCategoryItem(id: string) {
  const client = getDataClient();
  const res = await (client.models as any).ServiceCategory.delete({ id } as any);
  if ((res as any)?.errors?.length) {
    throw new Error(String((res as any).errors[0]?.message || "Failed to delete category"));
  }
}

export function resolveServicePriceForVehicleType(
  service: Pick<
    ServiceCatalogItem,
    "suvPrice" | "sedanPrice" | "hatchbackPrice" | "truckPrice" | "coupePrice" | "otherPrice"
  >,
  vehicleType: unknown
) {
  const vt = String(vehicleType || "").toUpperCase();
  if (vt.includes("SUV") || vt.includes("4X4") || vt.includes("PICKUP")) return toNumber(service.suvPrice);
  if (vt.includes("TRUCK")) return toNumber(service.truckPrice ?? service.suvPrice);
  if (vt.includes("HATCH")) return toNumber(service.hatchbackPrice ?? service.sedanPrice);
  if (vt.includes("COUPE")) return toNumber(service.coupePrice ?? service.sedanPrice);
  if (vt.includes("OTHER")) return toNumber(service.otherPrice ?? service.sedanPrice);
  return toNumber(service.sedanPrice);
}
