import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import type { Schema } from "../../amplify/data/resource";
import { getDataClient } from "../lib/amplifyClient";
import { useLanguage } from "../i18n/LanguageContext";
import "./CampaignAudienceAdmin.css";

type CampaignLead = Schema["CampaignAudienceLead"]["type"];
type CampaignImportBatch = Schema["CampaignAudienceImportBatch"]["type"];
type ParsedRow = Record<string, unknown>;

type MappingField =
  | "customerName"
  | "mobileNumber"
  | "serviceName"
  | "serviceDate"
  | "vehiclePlateNumber"
  | "vehicleMake"
  | "vehicleModel"
  | "notes";

type ColumnMapping = Record<MappingField, string>;
type SheetData = { columns: string[]; rows: ParsedRow[]; totalColumns: number; removedEmptyColumns: number };
type AgePreset = "any" | "3m" | "6m" | "12m";

type PreparedLead = {
  importBatchId: string;
  sourceFileName: string;
  sourceSheetName: string;
  sourceRowNumber: number;
  dedupeKey: string;
  customerName?: string;
  customerNameLower?: string;
  mobileNumber: string;
  normalizedMobileNumber: string;
  serviceName: string;
  serviceNameLower: string;
  serviceDate: string;
  vehiclePlateNumber?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  notes?: string;
  rawJson: string;
  importedAt: string;
};

type ImportSummary = {
  totalRows: number;
  validRows: number;
  importedRows: number;
  skippedRows: number;
  duplicateRows: number;
  errors: string[];
};

type DynamicFilterOperator = "contains" | "equals" | "startsWith" | "empty" | "notEmpty";

type DynamicFilterRule = {
  id: string;
  column: string;
  operator: DynamicFilterOperator;
  value: string;
};

type RelativeDateMode = "any" | "olderThan" | "newerThan" | "dateRange";

type ResultsViewMode = "table" | "cards";
type PreviewViewMode = "table" | "cards";

const PAGE_SIZE = 50;
const MOBILE_BREAKPOINT = 900;
const PREVIEW_PAGE_SIZE = 30;
const RESULTS_VIEW_STORAGE_KEY = "crm.campaignAudience.resultsViewMode";
const PREVIEW_VIEW_STORAGE_KEY = "crm.campaignAudience.previewViewMode";
const AUDIENCE_COLUMN_STORAGE_KEY = "audienceColumn";
const RELATIVE_DATE_MODE_STORAGE_KEY = "crm.campaignAudience.relativeDateMode";
const DATE_FROM_STORAGE_KEY = "crm.campaignAudience.dateFrom";
const DATE_TO_STORAGE_KEY = "crm.campaignAudience.dateTo";

function readStoredViewMode<T extends "table" | "cards">(storageKey: string): T | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === "table" || value === "cards") return value as T;
  } catch {
    // ignore storage access issues
  }
  return null;
}

const EMPTY_MAPPING: ColumnMapping = {
  customerName: "",
  mobileNumber: "",
  serviceName: "",
  serviceDate: "",
  vehiclePlateNumber: "",
  vehicleMake: "",
  vehicleModel: "",
  notes: "",
};

const HEADER_MATCHERS: Record<MappingField, string[]> = {
  customerName: ["customer", "customer name", "name", "client", "client name", "full name"],
  mobileNumber: ["mobile", "mobile number", "phone", "phone number", "customer phone", "telephone", "whatsapp"],
  serviceName: ["service", "service name", "job", "job name", "description", "service performed"],
  serviceDate: ["service date", "date", "job date", "created at", "invoice date", "visit date"],
  vehiclePlateNumber: ["plate", "plate number", "license", "registration", "car plate"],
  vehicleMake: ["make", "brand", "vehicle make", "factory"],
  vehicleModel: ["model", "vehicle model", "car model"],
  notes: ["note", "notes", "comment", "comments", "remarks"],
};

const AGE_PRESET_RANGES: Record<Exclude<AgePreset, "any">, { minDays: number; maxDays: number; label: string }> = {
  "3m": { minDays: 75, maxDays: 105, label: "Around 3 months ago" },
  "6m": { minDays: 165, maxDays: 195, label: "Around 6 months ago" },
  "12m": { minDays: 350, maxDays: 380, label: "Around 12 months ago" },
};

function normalizeHeader(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function parseWorksheetData(worksheet: XLSX.WorkSheet): SheetData {
  const ref = worksheet["!ref"];
  if (!ref) return { columns: [], rows: [], totalColumns: 0, removedEmptyColumns: 0 };

  const range = XLSX.utils.decode_range(ref);
  const matrix: string[][] = [];

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row: string[] = [];
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
      const addr = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = worksheet[addr];
      if (!cell) {
        row.push("");
        continue;
      }

      const formatted = toText(XLSX.utils.format_cell(cell));
      if (/^#+$/.test(formatted)) {
        const recoveredDate = parseExcelDate((cell as { v?: unknown }).v);
        row.push(recoveredDate ?? toText((cell as { v?: unknown }).v));
        continue;
      }

      row.push(formatted);
    }
    matrix.push(row);
  }

  if (matrix.length === 0 || matrix[0].length === 0) {
    return { columns: [], rows: [], totalColumns: 0, removedEmptyColumns: 0 };
  }

  const headerRow = matrix[0] ?? [];
  const dataRows = matrix.slice(1);

  const keepIndexes = headerRow
    .map((_, index) => index)
    .filter((index) => matrix.some((row) => toText(row[index]) !== ""));

  const totalColumns = headerRow.length;
  const removedEmptyColumns = Math.max(0, totalColumns - keepIndexes.length);

  const uniqueColumns: string[] = [];
  const seenColumns = new Map<string, number>();

  for (const index of keepIndexes) {
    const rawHeader = toText(headerRow[index]);
    const baseHeader = rawHeader || `Column ${index + 1}`;
    const seenCount = seenColumns.get(baseHeader) ?? 0;
    seenColumns.set(baseHeader, seenCount + 1);
    uniqueColumns.push(seenCount === 0 ? baseHeader : `${baseHeader} (${seenCount + 1})`);
  }

  const rows: ParsedRow[] = dataRows
    .filter((row) => keepIndexes.some((index) => toText(row[index]) !== ""))
    .map((row) => {
      const parsed: ParsedRow = {};
      uniqueColumns.forEach((column, idx) => {
        parsed[column] = toText(row[keepIndexes[idx]]);
      });
      return parsed;
    });

  return { columns: uniqueColumns, rows, totalColumns, removedEmptyColumns };
}

function normalizePhone(value: unknown): { display: string; normalized: string } {
  const display = toText(value);
  const normalized = display.replace(/[^\d]/g, "");
  return { display, normalized };
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateString(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return formatIsoDate(direct);

  const dateMatch = value.match(/^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})$/);
  if (!dateMatch) return null;

  const first = Number(dateMatch[1]);
  const second = Number(dateMatch[2]);
  const third = Number(dateMatch[3]);

  let year = first;
  let month = second;
  let day = third;

  if (first <= 31 && third >= 1000) {
    day = first;
    month = second;
    year = third;
  }

  const candidate = new Date(year, month - 1, day);
  if (Number.isNaN(candidate.getTime())) return null;
  return formatIsoDate(candidate);
}

function parseExcelDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatIsoDate(value);

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y && parsed?.m && parsed?.d) {
      return formatIsoDate(new Date(parsed.y, parsed.m - 1, parsed.d));
    }
  }

  return parseDateString(toText(value));
}

function dedupeKeyOf(mobileDigits: string, serviceName: string, serviceDate: string, customerName: string): string {
  return [mobileDigits, normalizeHeader(serviceName), serviceDate, normalizeHeader(customerName)].join("|");
}

function scoreHeaderMatch(header: string, variants: string[]): number {
  const normalized = normalizeHeader(header);
  let best = 0;
  for (const variant of variants) {
    const target = normalizeHeader(variant);
    if (normalized === target) return 100;
    if (normalized.startsWith(target) || normalized.endsWith(target)) best = Math.max(best, 75);
    if (normalized.includes(target)) best = Math.max(best, 50);
  }
  return best;
}

function autoMapColumns(columns: string[]): ColumnMapping {
  const mapping = { ...EMPTY_MAPPING };
  const unused = [...columns];

  (Object.keys(EMPTY_MAPPING) as MappingField[]).forEach((field) => {
    let bestColumn = "";
    let bestScore = 0;

    for (const column of unused) {
      const score = scoreHeaderMatch(column, HEADER_MATCHERS[field]);
      if (score > bestScore) {
        bestColumn = column;
        bestScore = score;
      }
    }

    if (bestColumn && bestScore >= 50) {
      mapping[field] = bestColumn;
      const index = unused.indexOf(bestColumn);
      if (index >= 0) unused.splice(index, 1);
    }
  });

  return mapping;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function csvEscape(value: unknown): string {
  const text = toText(value).replace(/"/g, '""');
  return `"${text}"`;
}

function downloadTextFile(fileName: string, content: string, mimeType: string, withBom = false) {
  const data = withBom ? `\uFEFF${content}` : content;
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function listAllRecords(model: any, limit = 1000): Promise<any[]> {
  const out: any[] = [];
  let nextToken: string | null | undefined;

  do {
    const response = await model.list({ limit, nextToken });
    out.push(...(response?.data ?? []));
    nextToken = response?.nextToken;
  } while (nextToken);

  return out;
}

function formatDateForUi(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function isDateColumnName(column: string): boolean {
  const normalized = normalizeHeader(column);
  return (
    normalized.includes("date") ||
    normalized.includes("created") ||
    normalized.includes("visit") ||
    normalized.includes("invoice") ||
    normalized.includes("service date") ||
    normalized.includes("تاريخ") ||
    normalized.includes("موعد") ||
    normalized.includes("اليوم")
  );
}

function isServiceDateColumnName(column: string): boolean {
  const normalized = normalizeHeader(column);
  return (
    normalized.includes("service date") ||
    normalized.includes("job date") ||
    normalized.includes("invoice date") ||
    normalized.includes("visit date") ||
    normalized === "date" ||
    normalized.includes("تاريخ الخدمة") ||
    normalized.includes("تاريخ الزيارة") ||
    normalized.includes("تاريخ الفاتورة")
  );
}

function normalizeDateForExport(rawValue: unknown, fallback?: unknown): string {
  const parsed = parseExcelDate(rawValue) ?? parseExcelDate(fallback);
  return parsed ?? toText(rawValue);
}

function getAgeInDays(serviceDate: string): number | null {
  const date = new Date(serviceDate);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / 86400000);
}

function parseRawRowJson(rawJson: unknown): ParsedRow {
  const rawText = toText(rawJson);
  if (!rawText) return {};

  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ParsedRow;
    }
  } catch {
    // ignore malformed legacy rows
  }

  return {};
}

function dynamicRuleMatches(value: string, operator: DynamicFilterOperator, needle: string): boolean {
  const raw = toText(value);
  const left = normalizeHeader(raw);
  const right = normalizeHeader(needle);

  switch (operator) {
    case "contains":
      return !right || left.includes(right);
    case "equals":
      return !right || left === right;
    case "startsWith":
      return !right || left.startsWith(right);
    case "empty":
      return raw === "";
    case "notEmpty":
      return raw !== "";
    default:
      return true;
  }
}

export default function CampaignAudienceAdmin() {
  const client = getDataClient();
  const { t } = useLanguage();

  const [batches, setBatches] = useState<CampaignImportBatch[]>([]);
  const [leads, setLeads] = useState<CampaignLead[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState("");

  const [selectedFileName, setSelectedFileName] = useState("");
  const [sheets, setSheets] = useState<Record<string, SheetData>>({});
  const [selectedSheet, setSelectedSheet] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [isReadingWorkbook, setIsReadingWorkbook] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageInput, setPreviewPageInput] = useState("1");

  const [isMobileViewport, setIsMobileViewport] = useState(
    typeof window !== "undefined" ? window.innerWidth <= MOBILE_BREAKPOINT : false
  );
  const [resultsViewMode, setResultsViewMode] = useState<ResultsViewMode>(
    (() => {
      if (typeof window === "undefined") return "table";
      const stored = readStoredViewMode<ResultsViewMode>(RESULTS_VIEW_STORAGE_KEY);
      if (stored) return stored;
      return window.innerWidth <= MOBILE_BREAKPOINT ? "cards" : "table";
    })()
  );
  const [previewViewMode, setPreviewViewMode] = useState<PreviewViewMode>(
    (() => {
      if (typeof window === "undefined") return "table";
      const stored = readStoredViewMode<PreviewViewMode>(PREVIEW_VIEW_STORAGE_KEY);
      if (stored) return stored;
      return window.innerWidth <= MOBILE_BREAKPOINT ? "cards" : "table";
    })()
  );

  const [searchText] = useState("");
  const [audienceColumn, setAudienceColumn] = useState(() => localStorage.getItem(AUDIENCE_COLUMN_STORAGE_KEY) ?? "");
  const [serviceKeywordFilter, setServiceKeywordFilter] = useState("");
  const [relativeDateMode, setRelativeDateMode] = useState<RelativeDateMode>(() => {
    const saved = localStorage.getItem(RELATIVE_DATE_MODE_STORAGE_KEY);
    if (saved === "any" || saved === "olderThan" || saved === "newerThan" || saved === "dateRange") return saved;
    return "any";
  });
  const [relativeDateMonths, setRelativeDateMonths] = useState(3);
  const [nameFilter] = useState("");
  const [mobileFilter] = useState("");
  const [serviceFilter] = useState("all");
  const [batchFilter] = useState("all");
  const [dynamicFilters] = useState<DynamicFilterRule[]>([
    { id: `rule-${Date.now()}`, column: "", operator: "contains", value: "" },
  ]);
  const [agePreset] = useState<AgePreset>("any");
  const [dateFrom, setDateFrom] = useState(() => localStorage.getItem(DATE_FROM_STORAGE_KEY) ?? "");
  const [dateTo, setDateTo] = useState(() => localStorage.getItem(DATE_TO_STORAGE_KEY) ?? "");
  const [uniqueByMobile, setUniqueByMobile] = useState(true);
  const [page, setPage] = useState(1);

  const activeSheet = selectedSheet ? sheets[selectedSheet] : undefined;
  const availableColumns = activeSheet?.columns ?? [];
  const previewRows = useMemo(() => activeSheet?.rows ?? [], [activeSheet]);

  const previewDisplayColumns = useMemo(() => {
    return availableColumns;
  }, [availableColumns]);

  const previewTotalPages = Math.max(1, Math.ceil(previewRows.length / PREVIEW_PAGE_SIZE));
  const previewPagedRows = useMemo(
    () => previewRows.slice((previewPage - 1) * PREVIEW_PAGE_SIZE, previewPage * PREVIEW_PAGE_SIZE),
    [previewPage, previewRows]
  );

  const rawRowByLeadId = useMemo(() => {
    const map = new Map<string, ParsedRow>();
    leads.forEach((lead) => {
      const id = toText(lead.id);
      if (!id) return;
      map.set(id, parseRawRowJson(lead.rawJson));
    });
    return map;
  }, [leads]);

  const uploadedColumns = useMemo(() => {
    const columns: string[] = [];
    const seen = new Set<string>();

    for (const row of rawRowByLeadId.values()) {
      Object.keys(row).forEach((key) => {
        const column = toText(key);
        if (!column || seen.has(column)) return;
        seen.add(column);
        columns.push(column);
      });
    }

    return columns;
  }, [rawRowByLeadId]);

  const activeDynamicFilters = useMemo(
    () =>
      dynamicFilters.filter(
        (rule) => rule.column && (rule.operator === "empty" || rule.operator === "notEmpty" || toText(rule.value) !== "")
      ),
    [dynamicFilters]
  );

  useEffect(() => {
    localStorage.setItem(RELATIVE_DATE_MODE_STORAGE_KEY, relativeDateMode);
  }, [relativeDateMode]);

  useEffect(() => {
    localStorage.setItem(DATE_FROM_STORAGE_KEY, dateFrom);
  }, [dateFrom]);

  useEffect(() => {
    localStorage.setItem(DATE_TO_STORAGE_KEY, dateTo);
  }, [dateTo]);

  useEffect(() => {
    if (uploadedColumns.length === 0) {
      setAudienceColumn("");
      return;
    }

    const saved = localStorage.getItem(AUDIENCE_COLUMN_STORAGE_KEY);
    if (saved && uploadedColumns.includes(saved)) {
      if (audienceColumn !== saved) setAudienceColumn(saved);
      return;
    }
    if (audienceColumn && uploadedColumns.includes(audienceColumn)) return;

    const mobileRegex = /mobile|phone|whatsapp|telephone|موبايل|جوال|هاتف|واتساب|رقم/i;
    const preferred =
      uploadedColumns.find((column) => mobileRegex.test(column)) ?? uploadedColumns[0] ?? "";
    if (preferred) localStorage.setItem(AUDIENCE_COLUMN_STORAGE_KEY, preferred);
    setAudienceColumn(preferred);
  }, [audienceColumn, uploadedColumns]);

  useEffect(() => {
    const onResize = () => {
      const nextIsMobile = window.innerWidth <= MOBILE_BREAKPOINT;
      setIsMobileViewport(nextIsMobile);
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (previewPage > previewTotalPages) {
      setPreviewPage(previewTotalPages);
    }
  }, [previewPage, previewTotalPages]);

  useEffect(() => {
    setPreviewPageInput(String(previewPage));
  }, [previewPage]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RESULTS_VIEW_STORAGE_KEY, resultsViewMode);
    } catch {
      // ignore storage access issues
    }
  }, [resultsViewMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREVIEW_VIEW_STORAGE_KEY, previewViewMode);
    } catch {
      // ignore storage access issues
    }
  }, [previewViewMode]);

  const loadExistingData = useCallback(async () => {
    setLoadingData(true);
    setDataError("");
    try {
      const [allBatches, allLeads] = await Promise.all([
        listAllRecords((client.models as any).CampaignAudienceImportBatch),
        listAllRecords((client.models as any).CampaignAudienceLead),
      ]);

      setBatches(
        [...allBatches].sort(
          (a, b) => new Date(b.importedAt ?? "").getTime() - new Date(a.importedAt ?? "").getTime()
        )
      );

      setLeads(
        [...allLeads].sort(
          (a, b) => new Date(b.serviceDate ?? "").getTime() - new Date(a.serviceDate ?? "").getTime()
        )
      );
    } catch (error: any) {
      setDataError(
        error?.message
          ? `${error.message}. Deploy the updated Amplify schema before using this page.`
          : "Failed to load campaign data. Deploy the updated Amplify schema before using this page."
      );
    } finally {
      setLoadingData(false);
    }
  }, [client.models]);

  useEffect(() => {
    void loadExistingData();
  }, [loadExistingData]);

  useEffect(() => {
    setPage(1);
  }, [
    audienceColumn,
    serviceKeywordFilter,
    relativeDateMode,
    relativeDateMonths,
    searchText,
    nameFilter,
    mobileFilter,
    serviceFilter,
    batchFilter,
    dynamicFilters,
    agePreset,
    dateFrom,
    dateTo,
    uniqueByMobile,
  ]);

  const activeBatchMeta = useMemo(() => {
    return batches.find((batch) => String(batch.batchId ?? "") === batchFilter) ?? null;
  }, [batchFilter, batches]);

  const filteredRows = useMemo(() => {
    const keyword = normalizeHeader(searchText);
    const serviceKeyword = normalizeHeader(serviceKeywordFilter);
    const nameNeedle = normalizeHeader(nameFilter);
    const mobileDigits = mobileFilter.replace(/[^\d]/g, "");
    const thresholdDays = Math.max(1, relativeDateMonths) * 30;

    let result = leads.filter((lead) => {
      const leadId = toText(lead.id);
      const rawRow = rawRowByLeadId.get(leadId) ?? {};
      const rawValues = Object.values(rawRow).map((value) => toText(value));
      const serviceDate = toText(lead.serviceDate);
      const ageDays = getAgeInDays(serviceDate);
      const matchesBatch = batchFilter === "all" || String(lead.importBatchId ?? "") === batchFilter;
      const matchesService = serviceFilter === "all" || toText(lead.serviceName) === serviceFilter;
      const matchesName = !nameNeedle || normalizeHeader(lead.customerName ?? "").includes(nameNeedle);
      const matchesMobile = !mobileDigits || toText(lead.normalizedMobileNumber).includes(mobileDigits);
      const haystack = normalizeHeader(
        [lead.customerName, lead.mobileNumber, lead.serviceName, lead.vehiclePlateNumber, lead.vehicleMake, lead.vehicleModel, lead.notes, ...rawValues]
          .filter(Boolean)
          .join(" ")
      );
      const matchesKeyword = !keyword || haystack.includes(keyword);
      const matchesServiceKeyword =
        !serviceKeyword ||
        normalizeHeader(lead.serviceName ?? "").includes(serviceKeyword) ||
        normalizeHeader(rawValues.join(" ")).includes(serviceKeyword);
      const matchesDateRange =
        relativeDateMode !== "dateRange" ||
        ((!dateFrom || serviceDate >= dateFrom) && (!dateTo || serviceDate <= dateTo));

      let matchesAgePreset = true;
      if (agePreset !== "any") {
        const range = AGE_PRESET_RANGES[agePreset];
        matchesAgePreset = ageDays != null && ageDays >= range.minDays && ageDays <= range.maxDays;
      }

      let matchesRelativeDate = true;
      if (relativeDateMode === "olderThan" || relativeDateMode === "newerThan") {
        if (ageDays == null) {
          matchesRelativeDate = false;
        } else if (relativeDateMode === "olderThan") {
          matchesRelativeDate = ageDays >= thresholdDays;
        } else {
          matchesRelativeDate = ageDays <= thresholdDays;
        }
      }

      const matchesDynamicFilters = activeDynamicFilters.every((rule) => {
        const value = toText(rawRow[rule.column]);
        return dynamicRuleMatches(value, rule.operator, rule.value);
      });

      return (
        matchesBatch &&
        matchesService &&
        matchesName &&
        matchesMobile &&
        matchesKeyword &&
        matchesServiceKeyword &&
        matchesDateRange &&
        matchesAgePreset &&
        matchesRelativeDate &&
        matchesDynamicFilters
      );
    });

    result = [...result].sort(
      (a, b) => new Date(b.serviceDate ?? "").getTime() - new Date(a.serviceDate ?? "").getTime()
    );

    if (!uniqueByMobile) return result;

    const seen = new Set<string>();
    return result.filter((lead) => {
      const key = toText(lead.normalizedMobileNumber);
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [
    activeDynamicFilters,
    agePreset,
    batchFilter,
    dateFrom,
    dateTo,
    leads,
    mobileFilter,
    nameFilter,
    rawRowByLeadId,
    searchText,
    serviceFilter,
    serviceKeywordFilter,
    uniqueByMobile,
    relativeDateMode,
    relativeDateMonths,
  ]);

  const selectedColumnValues = useMemo(() => {
    if (!audienceColumn) return [] as string[];

    const values = filteredRows
      .map((lead) => {
        const leadId = toText(lead.id);
        const rawRow = rawRowByLeadId.get(leadId) ?? {};
        return toText(rawRow[audienceColumn]);
      })
      .filter(Boolean);

    return Array.from(new Set(values));
  }, [audienceColumn, filteredRows, rawRowByLeadId]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pagedRows = useMemo(() => filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filteredRows, page]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const uniqueMobileCount = useMemo(() => {
    return new Set(filteredRows.map((lead) => toText(lead.normalizedMobileNumber)).filter(Boolean)).size;
  }, [filteredRows]);

  const resultDisplayColumns = useMemo(() => {
    if (uploadedColumns.length > 0) return uploadedColumns;
    return [
      "Customer Name",
      "Mobile Number",
      "Service Name",
      "Service Date",
      "Plate Number",
      "Vehicle Make",
      "Vehicle Model",
      "Notes",
    ];
  }, [uploadedColumns]);

  const latestBatch = batches[0] ?? null;

  const parseWorkbookFile = async (file: File) => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true, cellNF: true, cellText: true });
    const nextSheets: Record<string, SheetData> = {};

    workbook.SheetNames.forEach((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      nextSheets[sheetName] = parseWorksheetData(worksheet);
    });

    const firstSheet = workbook.SheetNames[0] ?? "";
    setSelectedFileName(file.name);
    setSheets(nextSheets);
    setSelectedSheet(firstSheet);
    setMapping(autoMapColumns(nextSheets[firstSheet]?.columns ?? []));
    setPreviewPage(1);
    if (isMobileViewport) {
      const previewStored = readStoredViewMode<PreviewViewMode>(PREVIEW_VIEW_STORAGE_KEY);
      const resultsStored = readStoredViewMode<ResultsViewMode>(RESULTS_VIEW_STORAGE_KEY);
      if (!previewStored) setPreviewViewMode("cards");
      if (!resultsStored) setResultsViewMode("cards");
    }
    setImportSummary(null);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsReadingWorkbook(true);
    try {
      await parseWorkbookFile(file);
    } catch (error: any) {
      setImportSummary({
        totalRows: 0,
        validRows: 0,
        importedRows: 0,
        skippedRows: 0,
        duplicateRows: 0,
        errors: [error?.message ?? "Failed to read workbook."],
      });
    } finally {
      setIsReadingWorkbook(false);
    }
  };

  const handleSheetChange = (sheetName: string) => {
    setSelectedSheet(sheetName);
    setMapping(autoMapColumns(sheets[sheetName]?.columns ?? []));
    setPreviewPage(1);
    setImportSummary(null);
  };

  const jumpToPreviewPage = () => {
    const numeric = Number.parseInt(previewPageInput, 10);
    if (!Number.isFinite(numeric)) {
      setPreviewPageInput(String(previewPage));
      return;
    }
    const next = Math.max(1, Math.min(previewTotalPages, numeric));
    setPreviewPage(next);
  };

  const buildPreparedLead = (
    row: ParsedRow,
    rowNumber: number,
    batchId: string,
    existingDedupeKeys: Set<string>,
    inFileDedupeKeys: Set<string>
  ): { lead?: PreparedLead; error?: string; duplicate?: boolean } => {
    const customerName = toText(row[mapping.customerName]);
    const phone = normalizePhone(mapping.mobileNumber ? row[mapping.mobileNumber] : "");
    const mobileDisplay = phone.display || phone.normalized || `row-${rowNumber}`;
    const mobileNormalized = phone.normalized || `row-${rowNumber}`;
    const serviceName = toText(mapping.serviceName ? row[mapping.serviceName] : "") || "Imported";
    const serviceDate = (mapping.serviceDate ? parseExcelDate(row[mapping.serviceDate]) : null) ?? formatIsoDate(new Date());

    const dedupeKey = dedupeKeyOf(mobileNormalized, serviceName, serviceDate, customerName);
    if (existingDedupeKeys.has(dedupeKey) || inFileDedupeKeys.has(dedupeKey)) {
      return { duplicate: true };
    }

    inFileDedupeKeys.add(dedupeKey);
    const importedAt = new Date().toISOString();

    return {
      lead: {
        importBatchId: batchId,
        sourceFileName: selectedFileName,
        sourceSheetName: selectedSheet,
        sourceRowNumber: rowNumber,
        dedupeKey,
        customerName: customerName || undefined,
        customerNameLower: customerName ? normalizeHeader(customerName) : undefined,
        mobileNumber: mobileDisplay,
        normalizedMobileNumber: mobileNormalized,
        serviceName,
        serviceNameLower: normalizeHeader(serviceName),
        serviceDate,
        vehiclePlateNumber: toText(row[mapping.vehiclePlateNumber]) || undefined,
        vehicleMake: toText(row[mapping.vehicleMake]) || undefined,
        vehicleModel: toText(row[mapping.vehicleModel]) || undefined,
        notes: toText(row[mapping.notes]) || undefined,
        rawJson: JSON.stringify(row),
        importedAt,
      },
    };
  };

  const clearExistingDataset = async () => {
    const leadModel = (client.models as any).CampaignAudienceLead;
    const batchModel = (client.models as any).CampaignAudienceImportBatch;
    const [existingLeads, existingBatches] = await Promise.all([
      listAllRecords(leadModel),
      listAllRecords(batchModel),
    ]);

    for (const leadChunk of chunkArray(existingLeads, 25)) {
      await Promise.allSettled(leadChunk.map((lead) => leadModel.delete({ id: lead.id })));
    }
    for (const batchChunk of chunkArray(existingBatches, 25)) {
      await Promise.allSettled(batchChunk.map((batch) => batchModel.delete({ id: batch.id })));
    }
  };

  const handleImport = async () => {
    if (!activeSheet || !selectedFileName || !selectedSheet) return;


    if (replaceExisting) {
      const confirmed = window.confirm(
        "This will replace the current campaign audience dataset in the database. Continue?"
      );
      if (!confirmed) return;
    }

    setImporting(true);
    setImportProgress("Preparing workbook rows...");
    setImportSummary(null);

    const batchId = `campaign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const existingDedupeKeys = replaceExisting
      ? new Set<string>()
      : new Set(leads.map((lead) => toText(lead.dedupeKey)).filter(Boolean));
    const inFileDedupeKeys = new Set<string>();
    const preparedLeads: PreparedLead[] = [];
    const errors: string[] = [];
    let duplicateRows = 0;

    try {
      if (replaceExisting) {
        setImportProgress("Clearing existing campaign audience data...");
        await clearExistingDataset();
      }

      const batchCreate = await (client.models as any).CampaignAudienceImportBatch.create({
        batchId,
        fileName: selectedFileName,
        sheetName: selectedSheet,
        status: "IN_PROGRESS",
        totalRows: activeSheet.rows.length,
        validRows: 0,
        importedRows: 0,
        skippedRows: 0,
        duplicateRows: 0,
        mappingJson: JSON.stringify(mapping),
        notes: replaceExisting ? "Replaced previous campaign dataset" : "Appended to existing campaign dataset",
        importedAt: new Date().toISOString(),
        createdBy: "browser-import",
      });

      const batchRecordId = batchCreate?.data?.id;

      activeSheet.rows.forEach((row, index) => {
        const result = buildPreparedLead(row, index + 2, batchId, existingDedupeKeys, inFileDedupeKeys);
        if (result.duplicate) {
          duplicateRows += 1;
          return;
        }
        if (result.error) {
          if (errors.length < 60) errors.push(result.error);
          return;
        }
        if (result.lead) preparedLeads.push(result.lead);
      });

      const skippedRows = activeSheet.rows.length - preparedLeads.length - duplicateRows;

      if (preparedLeads.length === 0) {
        if (batchRecordId) {
          await (client.models as any).CampaignAudienceImportBatch.update({
            id: batchRecordId,
            status: "FAILED",
            validRows: 0,
            importedRows: 0,
            skippedRows,
            duplicateRows,
            completedAt: new Date().toISOString(),
            notes: errors[0] ?? "No valid rows were found in the workbook.",
          });
        }

        setImportSummary({
          totalRows: activeSheet.rows.length,
          validRows: 0,
          importedRows: 0,
          skippedRows,
          duplicateRows,
          errors: errors.length ? errors : ["No valid rows were found in the workbook."],
        });
        return;
      }

      let importedRows = 0;
      for (const [chunkIndex, group] of chunkArray(preparedLeads, 25).entries()) {
        setImportProgress(`Uploading batch ${chunkIndex + 1} of ${Math.ceil(preparedLeads.length / 25)}...`);
        const results = await Promise.allSettled(
          group.map((lead) => (client.models as any).CampaignAudienceLead.create(lead))
        );
        results.forEach((result, resultIndex) => {
          if (result.status === "fulfilled") {
            importedRows += 1;
            return;
          }
          const rowNumber = group[resultIndex]?.sourceRowNumber ?? "?";
          if (errors.length < 60) {
            errors.push(`Row ${rowNumber}: ${result.reason?.message ?? "failed to import."}`);
          }
        });
      }

      if (batchRecordId) {
        await (client.models as any).CampaignAudienceImportBatch.update({
          id: batchRecordId,
          status: importedRows > 0 ? "COMPLETED" : "FAILED",
          validRows: preparedLeads.length,
          importedRows,
          skippedRows,
          duplicateRows,
          completedAt: new Date().toISOString(),
          notes:
            errors.length > 0
              ? `${errors.length} validation/import issues were captured. Review the import summary.`
              : replaceExisting
                ? "Campaign dataset imported successfully and replaced previous data."
                : "Campaign dataset imported successfully.",
        });
      }

      setImportSummary({
        totalRows: activeSheet.rows.length,
        validRows: preparedLeads.length,
        importedRows,
        skippedRows,
        duplicateRows,
        errors,
      });

      setImportProgress(importedRows > 0 ? "Import finished successfully." : "Import finished with no inserted rows.");
      await loadExistingData();
    } catch (error: any) {
      setImportSummary({
        totalRows: activeSheet.rows.length,
        validRows: preparedLeads.length,
        importedRows: 0,
        skippedRows: activeSheet.rows.length,
        duplicateRows,
        errors: [error?.message ?? "Import failed."],
      });
      setImportProgress("Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const handleCopyMobiles = async () => {
    const values = selectedColumnValues;

    if (values.length === 0) return;
    if (!navigator.clipboard?.writeText) {
      window.alert("Clipboard access is not available in this browser.");
      return;
    }

    await navigator.clipboard.writeText(values.join("\n"));
    window.alert("Filtered values copied to the clipboard.");
  };

  const handleExportCsv = () => {
    const columns = resultDisplayColumns;
    const lines = [
      columns.map((column) => csvEscape(column)).join(","),
      ...filteredRows.map((lead) => {
        const leadId = toText(lead.id);
        const rawRow = rawRowByLeadId.get(leadId) ?? {};
        return columns
          .map((column) => {
            const rawValue = rawRow[column];
            if (!isDateColumnName(column)) return csvEscape(rawValue);
            const fallback = isServiceDateColumnName(column) ? lead.serviceDate : undefined;
            return csvEscape(normalizeDateForExport(rawValue, fallback));
          })
          .join(",");
      }),
    ];

    downloadTextFile(`campaign-audience-${Date.now()}.csv`, lines.join("\r\n"), "text/csv;charset=utf-8", true);
  };

  return (
    <div className="campaign-admin-page">
      <section className="campaign-hero crm-unified-header">
        <div>
          <h1>
            <i className="fas fa-bullhorn" aria-hidden="true" />
            {t("Campaign Audience")}
          </h1>
          <p>
            {t("Upload a large Excel file once, keep the imported dataset in the database, and filter it safely for WhatsApp campaigns.")}
          </p>
        </div>
        <div className="campaign-hero-stats">
          <div className="campaign-stat-card">
            <span>{t("Imported rows")}</span>
            <strong>{leads.length.toLocaleString()}</strong>
          </div>
          <div className="campaign-stat-card">
            <span>{t("Unique mobiles")}</span>
            <strong>{new Set(leads.map((lead) => toText(lead.normalizedMobileNumber)).filter(Boolean)).size.toLocaleString()}</strong>
          </div>
          <div className="campaign-stat-card">
            <span>{t("Last import")}</span>
            <strong>{latestBatch ? formatDateForUi(toText(latestBatch.importedAt)) : "—"}</strong>
          </div>
        </div>
      </section>

      <div className="campaign-grid">
        <section className="campaign-card">
          <div className="campaign-card-head">
            <div>
              <h2>{t("Excel Import")}</h2>
              <p>{t("Preview the workbook and upload all records into the campaign audience database table.")}</p>
            </div>
          </div>

          <div className="campaign-upload-row">
            <label className="campaign-file-input">
              <input type="file" accept=".xlsx,.xls,.xlsb,.csv" onChange={handleFileChange} disabled={isReadingWorkbook || importing} />
              <span><i className="fas fa-file-excel" aria-hidden="true" /> {isReadingWorkbook ? t("Reading file...") : t("Choose Excel file")}</span>
            </label>
            <div className="campaign-file-meta">
              <strong>{selectedFileName || t("No file selected")}</strong>
              <span>{activeSheet ? `${activeSheet.rows.length.toLocaleString()} ${t("rows")}` : t("Select a workbook to begin")}</span>
            </div>
          </div>

          {Object.keys(sheets).length > 0 && (
            <>
              <div className="campaign-import-controls">
                <label>
                  <span>{t("Sheet")}</span>
                  <select value={selectedSheet} onChange={(e) => handleSheetChange(e.target.value)}>
                    {Object.keys(sheets).map((sheetName) => (
                      <option key={sheetName} value={sheetName}>{sheetName}</option>
                    ))}
                  </select>
                </label>

                <label className="campaign-checkbox">
                  <input
                    type="checkbox"
                    checked={replaceExisting}
                    onChange={(e) => setReplaceExisting(e.target.checked)}
                  />
                  <span>{t("Replace current campaign dataset before import")}</span>
                </label>
              </div>

              <div className="campaign-preview-wrap">
                <div className="campaign-preview-head">
                  <h3>{t("Preview")}</h3>
                  <span className="campaign-preview-metrics">
                    {`${t("Rows are paginated in groups of 30")} • ${t("Visible columns")}: ${previewDisplayColumns.length.toLocaleString()} / ${t("Removed empty")}: ${(activeSheet?.removedEmptyColumns ?? 0).toLocaleString()}`}
                    <span
                      className="campaign-metric-tooltip"
                      role="img"
                      aria-label={t("Removed empty means columns with no values in all rows.")}
                      title={t("Removed empty means columns with no values in all rows.")}
                    >
                      ⓘ
                    </span>
                  </span>
                </div>
                <div className="campaign-view-mode-toggle">
                  <button
                    type="button"
                    className={`campaign-view-btn${previewViewMode === "table" ? " active" : ""}`}
                    onClick={() => setPreviewViewMode("table")}
                  >
                    <i className="fas fa-table" aria-hidden="true" /> {t("Table")}
                  </button>
                  <button
                    type="button"
                    className={`campaign-view-btn${previewViewMode === "cards" ? " active" : ""}`}
                    onClick={() => setPreviewViewMode("cards")}
                  >
                    <i className="fas fa-grip" aria-hidden="true" /> {t("Cards")}
                  </button>
                </div>
                <div className="campaign-scroll-hint">
                  <i className="fas fa-arrows-left-right" aria-hidden="true" />
                  <span>{t("Scroll horizontally to view all columns")}</span>
                </div>
                <div className="campaign-table-wrap preview-scroll-region">
                  {previewViewMode === "table" ? (
                    <table className="campaign-table preview">
                      <thead>
                        <tr>
                          {previewDisplayColumns.map((column) => (
                            <th key={column}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewPagedRows.map((row, index) => (
                          <tr key={`preview-${index}-${previewPage}`}>
                            {previewDisplayColumns.map((column) => (
                              <td key={`${index}-${column}`}>{toText(row[column]) || "—"}</td>
                            ))}
                          </tr>
                        ))}
                        {previewPagedRows.length === 0 && (
                          <tr>
                            <td colSpan={Math.max(previewDisplayColumns.length, 1)} className="campaign-empty-cell">
                              {t("No rows found in this sheet.")}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <div className="campaign-cards-list preview-cards">
                      {previewPagedRows.map((row, index) => (
                        <article key={`preview-card-${index}-${previewPage}`} className="campaign-data-card preview-all-columns">
                          <header>
                            <strong>{`${t("Row")} ${(previewPage - 1) * PREVIEW_PAGE_SIZE + index + 2}`}</strong>
                          </header>
                          <div className="campaign-data-grid-wrap">
                            <div className="campaign-data-grid">
                              {previewDisplayColumns.map((column) => (
                                <div key={`${index}-${column}`}>
                                  <span>{column}</span>
                                  <strong>{toText(row[column]) || "—"}</strong>
                                </div>
                              ))}
                            </div>
                          </div>
                        </article>
                      ))}
                      {previewPagedRows.length === 0 && <div className="campaign-empty-cell">{t("No rows found in this sheet.")}</div>}
                    </div>
                  )}
                </div>
                {previewRows.length > 0 && (
                  <div className="campaign-pagination preview-pagination">
                    <button
                      className="pagination-btn"
                      type="button"
                      disabled={previewPage === 1}
                      onClick={() => setPreviewPage(1)}
                      aria-label={t("First page")}
                    >
                      <i className="fas fa-angles-left" aria-hidden="true" />
                    </button>
                    <button
                      className="pagination-btn"
                      type="button"
                      disabled={previewPage === 1}
                      onClick={() => setPreviewPage((current) => Math.max(1, current - 1))}
                      aria-label={t("Previous page")}
                    >
                      <i className="fas fa-chevron-left" aria-hidden="true" />
                    </button>
                    <span>{`${t("Page")} ${previewPage} ${t("of")} ${previewTotalPages} • ${t("Rows")} ${((previewPage - 1) * PREVIEW_PAGE_SIZE + 1).toLocaleString()}-${Math.min(previewPage * PREVIEW_PAGE_SIZE, previewRows.length).toLocaleString()} ${t("of")} ${previewRows.length.toLocaleString()}`}</span>
                    <button
                      className="pagination-btn"
                      type="button"
                      disabled={previewPage === previewTotalPages}
                      onClick={() => setPreviewPage((current) => Math.min(previewTotalPages, current + 1))}
                      aria-label={t("Next page")}
                    >
                      <i className="fas fa-chevron-right" aria-hidden="true" />
                    </button>
                    <button
                      className="pagination-btn"
                      type="button"
                      disabled={previewPage === previewTotalPages}
                      onClick={() => setPreviewPage(previewTotalPages)}
                      aria-label={t("Last page")}
                    >
                      <i className="fas fa-angles-right" aria-hidden="true" />
                    </button>
                    <div className="campaign-preview-jump">
                      <label htmlFor="preview-page-input">{t("Jump to page")}</label>
                      <input
                        id="preview-page-input"
                        type="number"
                        min={1}
                        max={previewTotalPages}
                        value={previewPageInput}
                        onChange={(e) => setPreviewPageInput(e.target.value)}
                        onBlur={jumpToPreviewPage}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            jumpToPreviewPage();
                          }
                        }}
                      />
                      <button type="button" className="pagination-btn" onClick={jumpToPreviewPage}>
                        {t("Go")}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="campaign-import-actions">
                <button className="btn btn-primary" type="button" disabled={importing} onClick={handleImport}>
                  <i className="fas fa-database" aria-hidden="true" />
                  {importing ? t("Importing...") : t("Import into database")}
                </button>
                {importProgress && <span className="campaign-progress-text">{importProgress}</span>}
              </div>
            </>
          )}

          {importSummary && (
            <div className="campaign-summary-panel">
              <div className="campaign-summary-grid">
                <div><span>{t("Total rows")}</span><strong>{importSummary.totalRows.toLocaleString()}</strong></div>
                <div><span>{t("Valid rows")}</span><strong>{importSummary.validRows.toLocaleString()}</strong></div>
                <div><span>{t("Imported rows")}</span><strong>{importSummary.importedRows.toLocaleString()}</strong></div>
                <div><span>{t("Skipped rows")}</span><strong>{importSummary.skippedRows.toLocaleString()}</strong></div>
                <div><span>{t("Duplicates")}</span><strong>{importSummary.duplicateRows.toLocaleString()}</strong></div>
              </div>
              {importSummary.errors.length > 0 && (
                <div className="campaign-error-list">
                  {importSummary.errors.slice(0, 20).map((message, index) => (
                    <div key={`err-${index}`}>{message}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="campaign-card">
          <div className="campaign-card-head">
            <div>
              <h2>{t("Campaign Filters")}</h2>
              <p>{t("Filter by service date, service name, customer name, phone number, batch, and export the audience list for WhatsApp.")}</p>
            </div>
            <div className="campaign-filter-actions">
              <button className="btn btn-secondary" type="button" onClick={handleCopyMobiles} disabled={filteredRows.length === 0}>
                <i className="fas fa-copy" aria-hidden="true" /> {t("Copy mobile numbers")}
              </button>
              <button className="btn btn-secondary" type="button" onClick={handleExportCsv} disabled={filteredRows.length === 0}>
                <i className="fas fa-file-export" aria-hidden="true" /> {t("Export CSV")}
              </button>
            </div>
          </div>

          <div className="campaign-view-mode-toggle results-view-toggle">
            <button
              type="button"
              className={`campaign-view-btn${resultsViewMode === "table" ? " active" : ""}`}
              onClick={() => setResultsViewMode("table")}
            >
              <i className="fas fa-table" aria-hidden="true" /> {t("Table view")}
            </button>
            <button
              type="button"
              className={`campaign-view-btn${resultsViewMode === "cards" ? " active" : ""}`}
              onClick={() => setResultsViewMode("cards")}
            >
              <i className="fas fa-id-card" aria-hidden="true" /> {t("Card view")}
            </button>
          </div>

          {loadingData ? (
            <div className="campaign-empty-state">{t("Loading campaign audience data...")}</div>
          ) : dataError ? (
            <div className="campaign-error-banner">{dataError}</div>
          ) : (
            <>
              <div className="campaign-filter-grid">
                <label>
                  <span>{t("Result column")}</span>
                  <select value={audienceColumn} onChange={(e) => { setAudienceColumn(e.target.value); localStorage.setItem(AUDIENCE_COLUMN_STORAGE_KEY, e.target.value); }}>
                    <option value="">{t("Select column")}</option>
                    {uploadedColumns.map((column) => (
                      <option key={`audience-col-${column}`} value={column}>{column}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t("Service contains")}</span>
                  <input
                    value={serviceKeywordFilter}
                    onChange={(e) => setServiceKeywordFilter(e.target.value)}
                    placeholder={t("e.g. polish, full ppf")}
                  />
                </label>
                <label>
                  <span>{t("Service age")}</span>
                  <div className="campaign-relative-date-controls">
                    <select value={relativeDateMode} onChange={(e) => setRelativeDateMode(e.target.value as RelativeDateMode)}>
                      <option value="any">{t("Any")}</option>
                      <option value="olderThan">{t("Older than")}</option>
                      <option value="newerThan">{t("Newer than")}</option>
                      <option value="dateRange">{t("Date range")}</option>
                    </select>
                    <select
                      value={relativeDateMonths}
                      onChange={(e) => setRelativeDateMonths(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                      disabled={relativeDateMode === "any" || relativeDateMode === "dateRange"}
                    >
                      {Array.from({ length: 48 }, (_, idx) => idx + 1).map((month) => (
                        <option key={`month-${month}`} value={month}>{`${month} ${month === 1 ? t("month") : t("months")}`}</option>
                      ))}
                    </select>
                    {relativeDateMode === "dateRange" && (
                      <>
                        <input
                          type="date"
                          value={dateFrom}
                          onChange={(e) => setDateFrom(e.target.value)}
                          aria-label={t("Service date from")}
                        />
                        <input
                          type="date"
                          value={dateTo}
                          onChange={(e) => setDateTo(e.target.value)}
                          aria-label={t("Service date to")}
                        />
                      </>
                    )}
                  </div>
                </label>

              </div>

              <div className="campaign-column-preview-panel">
                <div className="campaign-column-preview-head">
                  <strong>{audienceColumn || t("Selected column values")}</strong>
                  <span>{`${selectedColumnValues.length.toLocaleString()} ${t("unique values")}`}</span>
                </div>
                <div className="campaign-column-preview-values">
                  {selectedColumnValues.slice(0, 400).map((value) => (
                    <span key={`value-${value}`} className="campaign-column-chip">{value}</span>
                  ))}
                  {selectedColumnValues.length === 0 && <div className="campaign-empty-cell">{t("No values match the current real-time filters.")}</div>}
                </div>
              </div>

              <div className="campaign-toggle-row">
                <label className="campaign-checkbox">
                  <input type="checkbox" checked={uniqueByMobile} onChange={(e) => setUniqueByMobile(e.target.checked)} />
                  <span>{t("Show unique mobile numbers only")}</span>
                </label>
                {activeBatchMeta && (
                  <div className="campaign-batch-note">
                    <i className="fas fa-layer-group" aria-hidden="true" />
                    <span>{`${activeBatchMeta.fileName} • ${formatDateForUi(toText(activeBatchMeta.importedAt))}`}</span>
                  </div>
                )}
              </div>

              <div className="campaign-summary-grid top-gap">
                <div><span>{t("Filtered rows")}</span><strong>{filteredRows.length.toLocaleString()}</strong></div>
                <div><span>{t("Unique mobiles")}</span><strong>{uniqueMobileCount.toLocaleString()}</strong></div>
                <div><span>{t("Pages")}</span><strong>{totalPages.toLocaleString()}</strong></div>
                <div><span>{t("Selected batch")}</span><strong>{batchFilter === "all" ? t("All") : activeBatchMeta?.fileName || "—"}</strong></div>
              </div>

              {resultsViewMode === "table" ? (
                <div className="campaign-table-wrap main-table">
                  <table className="campaign-table main">
                    <thead>
                      <tr>
                        {resultDisplayColumns.map((column) => (
                          <th key={`col-${column}`}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedRows.map((lead) => {
                        const leadId = toText(lead.id);
                        const rawRow = rawRowByLeadId.get(leadId) ?? {};
                        return (
                        <tr key={String(lead.id)}>
                          {resultDisplayColumns.map((column) => {
                            const rawValue = toText(rawRow[column]);
                            const isDateLike = isDateColumnName(column);
                            const fallback = isServiceDateColumnName(column) ? lead.serviceDate : undefined;
                            const value = isDateLike ? formatDateForUi(normalizeDateForExport(rawValue, fallback)) : rawValue;
                            return <td key={`${String(lead.id)}-${column}`}>{value || "—"}</td>;
                          })}
                        </tr>
                        );
                      })}
                      {pagedRows.length === 0 && (
                        <tr>
                          <td colSpan={Math.max(1, resultDisplayColumns.length)} className="campaign-empty-cell">{t("No rows match the current filters.")}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="campaign-cards-list">
                  {pagedRows.map((lead) => {
                    const leadId = toText(lead.id);
                    const rawRow = rawRowByLeadId.get(leadId) ?? {};
                    const cardTitle =
                      toText(rawRow["Customer Name"]) ||
                      toText(rawRow["customerName"]) ||
                      toText(lead.customerName) ||
                      "—";
                    const cardDate =
                      toText(rawRow["Service Date"]) ||
                      toText(rawRow["serviceDate"]) ||
                      toText(lead.serviceDate);
                    return (
                    <article key={String(lead.id)} className="campaign-data-card">
                      <header>
                        <strong>{cardTitle}</strong>
                        <span>{formatDateForUi(cardDate)}</span>
                      </header>
                      <div className="campaign-data-grid">
                        {resultDisplayColumns.map((column) => {
                          const rawValue = toText(rawRow[column]);
                          const isDateLike = isDateColumnName(column);
                          const fallback = isServiceDateColumnName(column) ? lead.serviceDate : undefined;
                          const value = isDateLike ? formatDateForUi(normalizeDateForExport(rawValue, fallback)) : rawValue;
                          return (
                            <div key={`${String(lead.id)}-card-${column}`}>
                              <span>{column}</span>
                              <strong>{value || "—"}</strong>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                    );
                  })}
                  {pagedRows.length === 0 && <div className="campaign-empty-cell">{t("No rows match the current filters.")}</div>}
                </div>
              )}

              <div className="campaign-pagination">
                <button className="pagination-btn" type="button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  <i className="fas fa-chevron-left" aria-hidden="true" />
                </button>
                <span>{`${t("Page")} ${page} ${t("of")} ${totalPages}`}</span>
                <button className="pagination-btn" type="button" disabled={page === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                  <i className="fas fa-chevron-right" aria-hidden="true" />
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}