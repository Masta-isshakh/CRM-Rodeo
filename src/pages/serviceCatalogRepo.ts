import { getDataClient } from "../lib/amplifyClient";

export type ServiceCatalogType = "service" | "package";

export type ServiceCatalogItem = {
  id: string;
  serviceCode: string;
  name: string;
  type: ServiceCatalogType;
  suvPrice: number;
  sedanPrice: number;
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

function mapServiceRow(row: any): ServiceCatalogItem {
  return {
    id: String(row?.id || ""),
    serviceCode: String(row?.serviceCode || "").trim(),
    name: String(row?.name || "").trim(),
    type: toCatalogType(row?.type),
    suvPrice: toNumber(row?.suvPrice),
    sedanPrice: toNumber(row?.sedanPrice),
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
  type: ServiceCatalogType;
  suvPrice: number;
  sedanPrice: number;
  includedServiceCodes?: string[];
  isActive?: boolean;
}) {
  const client = getDataClient();

  const payload = {
    serviceCode: String(input.serviceCode || "").trim(),
    name: String(input.name || "").trim(),
    type: input.type === "package" ? "PACKAGE" : "SERVICE",
    suvPrice: toNumber(input.suvPrice),
    sedanPrice: toNumber(input.sedanPrice),
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
  type: ServiceCatalogType;
  suvPrice: number;
  sedanPrice: number;
  includedServiceCodes?: string[];
  isActive?: boolean;
}) {
  const client = getDataClient();

  const payload = {
    id: input.id,
    serviceCode: String(input.serviceCode || "").trim(),
    name: String(input.name || "").trim(),
    type: input.type === "package" ? "PACKAGE" : "SERVICE",
    suvPrice: toNumber(input.suvPrice),
    sedanPrice: toNumber(input.sedanPrice),
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

export function resolveServicePriceForVehicleType(
  service: Pick<ServiceCatalogItem, "suvPrice" | "sedanPrice">,
  vehicleType: unknown
) {
  const vt = String(vehicleType || "").toUpperCase();
  const isSuv = vt.includes("SUV") || vt.includes("4X4") || vt.includes("TRUCK") || vt.includes("PICKUP");
  return isSuv ? toNumber(service.suvPrice) : toNumber(service.sedanPrice);
}
