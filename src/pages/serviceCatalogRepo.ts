import { getDataClient } from "../lib/amplifyClient";

export type ServiceCatalogType = "service" | "package";

export type ServiceSpecificationProduct = {
  id: string;
  name: string;
  measurements: string[];
};

export type ServiceSpecificationBrand = {
  id: string;
  name: string;
  colorHex: string;
  products: ServiceSpecificationProduct[];
};

export type ServiceBrandSpecificationItem = {
  id: string;
  specificationCode: string;
  brandName: string;
  colorHex: string;
  specifications: ServiceSpecificationBrand[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

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
  specificationId?: string;
  specificationName?: string;
  specificationColorHex?: string;
  specificationProductId?: string;
  specificationProductName?: string;
  specificationMeasurement?: string;
  type: ServiceCatalogType;
  suvPrice: number;
  sedanPrice: number;
  hatchbackPrice?: number;
  truckPrice?: number;
  coupePrice?: number;
  otherPrice?: number;
  includedServiceCodes: string[];
  hasSpecifications: boolean;
  specifications: ServiceSpecificationBrand[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

function parseSpecifications(raw: unknown): ServiceSpecificationBrand[] {
  if (!raw) return [];

  const parsed = (() => {
    if (Array.isArray(raw)) return raw;
    const text = String(raw).trim();
    if (!text) return [];
    try {
      return JSON.parse(text);
    } catch {
      return [];
    }
  })();

  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((entry: any, brandIndex: number) => {
      const name = String(entry?.name || "").trim();
      const colorHex = String(entry?.colorHex || "").trim() || "#1F2937";
      const products = Array.isArray(entry?.products)
        ? entry.products
            .map((product: any, productIndex: number) => ({
              id: String(product?.id || `product-${brandIndex + 1}-${productIndex + 1}`).trim(),
              name: String(product?.name || "").trim(),
              measurements: Array.isArray(product?.measurements)
                ? product.measurements.map((measurement: any) => String(measurement || "").trim()).filter(Boolean)
                : [],
            }))
            .filter((product: ServiceSpecificationProduct) => !!product.name)
        : [];

      return {
        id: String(entry?.id || `brand-${brandIndex + 1}`).trim(),
        name,
        colorHex,
        products,
      };
    })
    .filter((brand: ServiceSpecificationBrand) => !!brand.name && brand.products.length > 0);
}

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

function mapBrandSpecificationRow(row: any): ServiceBrandSpecificationItem {
  const parsedSpecifications = parseSpecifications(row?.specificationsJson);
  const brandName = String(row?.brandName || "").trim();
  const colorHex = String(row?.colorHex || "").trim() || parsedSpecifications[0]?.colorHex || "#1F2937";
  const specifications = parsedSpecifications.length
    ? parsedSpecifications.map((brand, index) =>
        index === 0
          ? {
              ...brand,
              name: brandName || brand.name,
              colorHex: colorHex || brand.colorHex,
            }
          : brand
      )
    : [];

  return {
    id: String(row?.id || ""),
    specificationCode: String(row?.specificationCode || "").trim(),
    brandName,
    colorHex,
    specifications,
    isActive: row?.isActive !== false,
    createdAt: row?.createdAt ? String(row.createdAt) : undefined,
    updatedAt: row?.updatedAt ? String(row.updatedAt) : undefined,
  };
}

function mapServiceRow(row: any, specificationsById?: Map<string, ServiceBrandSpecificationItem>): ServiceCatalogItem {
  const storedSpecifications = parseSpecifications(row?.specificationsJson);
  const specificationId = row?.specificationId ? String(row.specificationId).trim() : undefined;
  const specification = specificationId ? specificationsById?.get(specificationId) : undefined;
  const specifications = specification?.specifications?.length ? specification.specifications : storedSpecifications;
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
    specificationId,
    specificationName: specification?.brandName || (row?.specificationName ? String(row.specificationName) : undefined),
    specificationColorHex: specification?.colorHex || (row?.specificationColorHex ? String(row.specificationColorHex) : undefined),
    specificationProductId: row?.specificationProductId ? String(row.specificationProductId).trim() : undefined,
    specificationProductName: row?.specificationProductName ? String(row.specificationProductName).trim() : undefined,
    specificationMeasurement: row?.specificationMeasurement ? String(row.specificationMeasurement).trim() : undefined,
    type: toCatalogType(row?.type),
    suvPrice: toNumber(row?.suvPrice),
    sedanPrice: toNumber(row?.sedanPrice),
    hatchbackPrice: toOptionalNumber(row?.hatchbackPrice),
    truckPrice: toOptionalNumber(row?.truckPrice),
    coupePrice: toOptionalNumber(row?.coupePrice),
    otherPrice: toOptionalNumber(row?.otherPrice),
    includedServiceCodes: parseIncludedCodes(row?.includedServiceCodesJson),
    hasSpecifications: specifications.length > 0,
    specifications,
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

  const specifications = await listServiceBrandSpecifications(includeInactive);
  const specificationsById = new Map<string, ServiceBrandSpecificationItem>();
  specifications.forEach((specification) => specificationsById.set(specification.id, specification));

  return sortCatalog(out.map((row) => mapServiceRow(row, specificationsById)).filter((s) => !!s.id && !!s.name && !!s.serviceCode));
}

export async function listServiceBrandSpecifications(includeInactive = false): Promise<ServiceBrandSpecificationItem[]> {
  const client = getDataClient();

  const out: any[] = [];
  let nextToken: string | null | undefined = undefined;
  let pageResult: any;

  do {
    pageResult = await (client.models as any).ServiceBrandSpecification.list({
      limit: 1000,
      nextToken,
      ...(includeInactive ? {} : ({ filter: { isActive: { ne: false } } } as any)),
    } as any);

    out.push(...(pageResult?.data || []));
    nextToken = pageResult?.nextToken;
  } while (nextToken);

  return out
    .map(mapBrandSpecificationRow)
    .filter((specification) => !!specification.id && !!specification.specificationCode && !!specification.brandName)
    .sort((a, b) => compareServiceCode(a.specificationCode, b.specificationCode));
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
  specificationId?: string;
  specificationName?: string;
  specificationColorHex?: string;
  specificationProductId?: string;
  specificationProductName?: string;
  specificationMeasurement?: string;
  type: ServiceCatalogType;
  suvPrice: number;
  sedanPrice: number;
  hatchbackPrice?: number;
  truckPrice?: number;
  coupePrice?: number;
  otherPrice?: number;
  includedServiceCodes?: string[];
  hasSpecifications?: boolean;
  specifications?: ServiceSpecificationBrand[];
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
    specificationId: input.specificationId || undefined,
    specificationName: input.specificationName ? String(input.specificationName).trim() : undefined,
    specificationColorHex: input.specificationColorHex ? String(input.specificationColorHex).trim() : undefined,
    specificationProductId: input.specificationProductId ? String(input.specificationProductId).trim() : undefined,
    specificationProductName: input.specificationProductName ? String(input.specificationProductName).trim() : undefined,
    specificationMeasurement: input.specificationMeasurement ? String(input.specificationMeasurement).trim() : undefined,
    type: input.type === "package" ? "PACKAGE" : "SERVICE",
    suvPrice: toNumber(input.suvPrice),
    sedanPrice: toNumber(input.sedanPrice),
    hatchbackPrice: toOptionalNumber(input.hatchbackPrice),
    truckPrice: toOptionalNumber(input.truckPrice),
    coupePrice: toOptionalNumber(input.coupePrice),
    otherPrice: toOptionalNumber(input.otherPrice),
    includedServiceCodesJson: JSON.stringify(input.includedServiceCodes || []),
    hasSpecifications: input.type === "service" && input.hasSpecifications === true,
    specificationsJson: JSON.stringify(input.type === "service" ? input.specifications || [] : []),
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
  specificationId?: string;
  specificationName?: string;
  specificationColorHex?: string;
  specificationProductId?: string;
  specificationProductName?: string;
  specificationMeasurement?: string;
  type: ServiceCatalogType;
  suvPrice: number;
  sedanPrice: number;
  hatchbackPrice?: number;
  truckPrice?: number;
  coupePrice?: number;
  otherPrice?: number;
  includedServiceCodes?: string[];
  hasSpecifications?: boolean;
  specifications?: ServiceSpecificationBrand[];
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
    specificationId: input.specificationId || undefined,
    specificationName: input.specificationName ? String(input.specificationName).trim() : undefined,
    specificationColorHex: input.specificationColorHex ? String(input.specificationColorHex).trim() : undefined,
    specificationProductId: input.specificationProductId ? String(input.specificationProductId).trim() : undefined,
    specificationProductName: input.specificationProductName ? String(input.specificationProductName).trim() : undefined,
    specificationMeasurement: input.specificationMeasurement ? String(input.specificationMeasurement).trim() : undefined,
    type: input.type === "package" ? "PACKAGE" : "SERVICE",
    suvPrice: toNumber(input.suvPrice),
    sedanPrice: toNumber(input.sedanPrice),
    hatchbackPrice: toOptionalNumber(input.hatchbackPrice),
    truckPrice: toOptionalNumber(input.truckPrice),
    coupePrice: toOptionalNumber(input.coupePrice),
    otherPrice: toOptionalNumber(input.otherPrice),
    includedServiceCodesJson: JSON.stringify(input.includedServiceCodes || []),
    hasSpecifications: input.type === "service" && input.hasSpecifications === true,
    specificationsJson: JSON.stringify(input.type === "service" ? input.specifications || [] : []),
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

export async function createServiceBrandSpecificationItem(input: {
  specificationCode: string;
  brandName: string;
  colorHex: string;
  specifications: ServiceSpecificationBrand[];
  isActive?: boolean;
}) {
  const client = getDataClient();

  const payload = {
    specificationCode: String(input.specificationCode || "").trim(),
    brandName: String(input.brandName || "").trim(),
    colorHex: String(input.colorHex || "").trim() || "#1F2937",
    specificationsJson: JSON.stringify(input.specifications || []),
    isActive: input.isActive !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const res = await (client.models as any).ServiceBrandSpecification.create(payload as any);
  if ((res as any)?.errors?.length) {
    throw new Error(String((res as any).errors[0]?.message || "Failed to create brand specification"));
  }

  return mapBrandSpecificationRow((res as any)?.data);
}

export async function updateServiceBrandSpecificationItem(input: {
  id: string;
  specificationCode: string;
  brandName: string;
  colorHex: string;
  specifications: ServiceSpecificationBrand[];
  isActive?: boolean;
}) {
  const client = getDataClient();

  const payload = {
    id: input.id,
    specificationCode: String(input.specificationCode || "").trim(),
    brandName: String(input.brandName || "").trim(),
    colorHex: String(input.colorHex || "").trim() || "#1F2937",
    specificationsJson: JSON.stringify(input.specifications || []),
    isActive: input.isActive !== false,
    updatedAt: new Date().toISOString(),
  };

  const res = await (client.models as any).ServiceBrandSpecification.update(payload as any);
  if ((res as any)?.errors?.length) {
    throw new Error(String((res as any).errors[0]?.message || "Failed to update brand specification"));
  }

  return mapBrandSpecificationRow((res as any)?.data);
}

export async function deleteServiceBrandSpecificationItem(id: string) {
  const client = getDataClient();
  const res = await (client.models as any).ServiceBrandSpecification.delete({ id } as any);
  if ((res as any)?.errors?.length) {
    throw new Error(String((res as any).errors[0]?.message || "Failed to delete brand specification"));
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
