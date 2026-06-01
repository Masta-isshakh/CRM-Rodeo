import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { Schema } from "../../data/resource";

type AnyObj = Record<string, unknown>;
type ModelData = AnyObj[];

type SchedulePayload = {
  modelKey?: string;
  selectedFields?: string[];
  filters?: {
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    field1?: string;
    value1?: string;
    field2?: string;
    value2?: string;
    field3?: string;
    value3?: string;
  };
};

const REGION = String(process.env.SES_REGION ?? "eu-west-1").trim() || "eu-west-1";
const FROM_EMAIL = String(process.env.SES_FROM_EMAIL ?? "").trim();
const REPORT_MAX_ROWS = Math.max(100, Number(process.env.REPORT_MAX_ROWS ?? "3000") || 3000);

const ses = new SESv2Client({ region: REGION });

async function configureClient() {
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as any);
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function dateInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function toRows(raw: AnyObj[]): ModelData {
  return raw.map((row) => {
    const out: AnyObj = {};
    for (const [key, value] of Object.entries(row ?? {})) {
      if (key === "__typename") continue;
      if (
        value == null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        out[key] = value;
      } else {
        out[key] = JSON.stringify(value);
      }
    }
    return out;
  });
}

function parseFilters(jsonText: string): SchedulePayload {
  if (!jsonText) return {};
  try {
    const parsed = JSON.parse(jsonText) as SchedulePayload;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function safeFields(fields: unknown, fallback: string[]): string[] {
  if (!Array.isArray(fields)) return fallback;
  const cleaned = fields.map((f) => text(f)).filter(Boolean);
  return cleaned.length > 0 ? cleaned : fallback;
}

async function listAll(client: ReturnType<typeof generateClient<Schema>>, modelName: string, limit = 3000) {
  const model = (client.models as AnyObj)?.[modelName] as AnyObj;
  const listFn = model?.list as ((args: AnyObj) => Promise<{ data?: AnyObj[] }>) | undefined;
  if (!listFn) return [] as AnyObj[];
  const res = await listFn({ limit });
  return (res?.data ?? []) as AnyObj[];
}

function applyFilters(rows: ModelData, payload: SchedulePayload): ModelData {
  const filters = payload.filters ?? {};
  const search = text(filters.search).toLowerCase();
  const dateFrom = text(filters.dateFrom);
  const dateTo = text(filters.dateTo);
  const field1 = text(filters.field1);
  const value1 = text(filters.value1);
  const field2 = text(filters.field2);
  const value2 = text(filters.value2);
  const field3 = text(filters.field3);
  const value3 = text(filters.value3);

  return rows.filter((row) => {
    if (field1 && value1 && text(row[field1]) !== value1) return false;
    if (field2 && value2 && text(row[field2]) !== value2) return false;
    if (field3 && value3 && text(row[field3]) !== value3) return false;

    if (dateFrom || dateTo) {
      const dateRaw = text(row.createdAt) || text(row.updatedAt) || text(row.date);
      const d = dateInput(dateRaw);
      if (!d) return false;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
    }

    if (search) {
      const hit = Object.values(row).some((v) => text(v).toLowerCase().includes(search));
      if (!hit) return false;
    }

    return true;
  });
}

function toCsvAttachment(rows: ModelData, fields: string[]) {
  const data = rows.map((row) => {
    const out: AnyObj = {};
    for (const key of fields) out[key] = row[key] ?? "";
    return out;
  });
  const sheet = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Report");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { fileName: "scheduled-report.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: buffer };
}

function toPdfAttachment(rows: ModelData, fields: string[]) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  let y = 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Scheduled Report", 10, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Generated at: ${new Date().toISOString()}`, 10, y);
  y += 8;

  const cols = fields.slice(0, 9);
  const colWidth = 30;
  let x = 8;
  doc.setFont("helvetica", "bold");
  for (const c of cols) {
    doc.rect(x, y, colWidth, 7);
    doc.text(c.slice(0, 16), x + 1, y + 4.5);
    x += colWidth;
  }
  y += 7;

  doc.setFont("helvetica", "normal");
  for (const row of rows.slice(0, 120)) {
    if (y > 188) {
      doc.addPage("a4", "landscape");
      y = 12;
    }
    x = 8;
    for (const c of cols) {
      doc.rect(x, y, colWidth, 6.6);
      const value = text(row[c]).slice(0, 24);
      doc.text(value || "-", x + 1, y + 4.2);
      x += colWidth;
    }
    y += 6.6;
  }

  const arrayBuffer = doc.output("arraybuffer") as ArrayBuffer;
  return { fileName: "scheduled-report.pdf", contentType: "application/pdf", data: Buffer.from(arrayBuffer) };
}

function chunkBase64(input: string): string {
  return input.replace(/(.{76})/g, "$1\r\n");
}

async function sendEmailWithAttachment(params: {
  to: string;
  subject: string;
  bodyText: string;
  fileName: string;
  contentType: string;
  binaryData: Buffer;
}) {
  const boundaryMixed = `mix_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const boundaryAlt = `alt_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const attachmentBase64 = chunkBase64(params.binaryData.toString("base64"));

  const raw = [
    `From: ${FROM_EMAIL}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary=\"${boundaryMixed}\"`,
    "",
    `--${boundaryMixed}`,
    `Content-Type: multipart/alternative; boundary=\"${boundaryAlt}\"`,
    "",
    `--${boundaryAlt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    params.bodyText,
    "",
    `--${boundaryAlt}--`,
    "",
    `--${boundaryMixed}`,
    `Content-Type: ${params.contentType}; name=\"${params.fileName}\"`,
    `Content-Disposition: attachment; filename=\"${params.fileName}\"`,
    "Content-Transfer-Encoding: base64",
    "",
    attachmentBase64,
    "",
    `--${boundaryMixed}--`,
    "",
  ].join("\r\n");

  const command = new SendEmailCommand({
    FromEmailAddress: FROM_EMAIL,
    Destination: { ToAddresses: [params.to] },
    Content: {
      Raw: {
        Data: new TextEncoder().encode(raw),
      },
    },
  });

  await ses.send(command);
}

async function loadModelRows(client: ReturnType<typeof generateClient<Schema>>, modelKey: string): Promise<ModelData> {
  if (modelKey === "Customer") return toRows(await listAll(client, "Customer", REPORT_MAX_ROWS));
  if (modelKey === "Vehicle") return toRows(await listAll(client, "Vehicle", REPORT_MAX_ROWS));
  if (modelKey === "Employee") return toRows(await listAll(client, "Employee", REPORT_MAX_ROWS));
  if (modelKey === "ServiceCatalog") return toRows(await listAll(client, "ServiceCatalog", REPORT_MAX_ROWS));
  if (modelKey === "UserProfile") return toRows(await listAll(client, "UserProfile", REPORT_MAX_ROWS));
  if (modelKey === "Ticket") return toRows(await listAll(client, "Ticket", REPORT_MAX_ROWS));

  const [jobOrders, serviceItems] = await Promise.all([
    listAll(client, "JobOrder", REPORT_MAX_ROWS),
    listAll(client, "JobOrderServiceItem", REPORT_MAX_ROWS * 2),
  ]);
  const servicesByOrder = new Map<string, string[]>();
  for (const svc of serviceItems) {
    const id = text(svc.jobOrderId);
    const name = text(svc.name);
    if (!id || !name) continue;
    const list = servicesByOrder.get(id) ?? [];
    list.push(name);
    servicesByOrder.set(id, list);
  }

  return toRows(
    jobOrders.map((j) => ({
      ...j,
      services: (servicesByOrder.get(text(j.id)) ?? []).join(", "),
    }))
  );
}

export const handler = async () => {
  const client = await configureClient();

  if (!FROM_EMAIL) {
    return { ok: false, message: "SES_FROM_EMAIL is not configured." };
  }

  const nowIso = new Date().toISOString();
  const schedulesRes = await client.models.ScheduledReport.list({
    limit: 200,
    filter: {
      status: { eq: "PENDING" as any },
    } as any,
  });

  const schedules = ((schedulesRes?.data ?? []) as AnyObj[])
    .filter((s) => {
      const sendAt = text(s.sendAt);
      return !!sendAt && sendAt <= nowIso;
    })
    .slice(0, 50);

  let sent = 0;
  let failed = 0;

  for (const schedule of schedules) {
    const id = text(schedule.id);
    const to = text(schedule.recipientEmail).toLowerCase();
    const reportFormat = text(schedule.reportFormat).toUpperCase() === "EXCEL" ? "EXCEL" : "PDF";
    const title = text(schedule.title) || "Scheduled Report";

    try {
      const payload = parseFilters(text(schedule.filtersJson));
      const modelKey = text(payload.modelKey || schedule.reportModel) || "JobOrder";

      const rows = applyFilters(await loadModelRows(client, modelKey), payload).slice(0, REPORT_MAX_ROWS);
      const defaultFields = Object.keys(rows[0] ?? {}).slice(0, 12);
      const fields = safeFields(payload.selectedFields ?? JSON.parse(text(schedule.selectedFieldsJson) || "[]"), defaultFields);

      const attachment = reportFormat === "EXCEL" ? toCsvAttachment(rows, fields) : toPdfAttachment(rows, fields);

      await sendEmailWithAttachment({
        to,
        subject: `${title} (${modelKey})`,
        bodyText: `Your scheduled report is attached.\nModel: ${modelKey}\nRows: ${rows.length}\nGenerated: ${new Date().toISOString()}`,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        binaryData: attachment.data,
      });

      await client.models.ScheduledReport.update({
        id,
        status: "SENT",
        lastRunAt: new Date().toISOString(),
        errorMessage: null,
        fileName: attachment.fileName,
        updatedAt: new Date().toISOString(),
      } as any);
      sent += 1;
    } catch (error: any) {
      await client.models.ScheduledReport.update({
        id,
        status: "FAILED",
        errorMessage: String(error?.message ?? error).slice(0, 1800),
        lastRunAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any);
      failed += 1;
    }
  }

  return {
    ok: failed === 0,
    scanned: schedules.length,
    sent,
    failed,
    region: REGION,
  };
};
