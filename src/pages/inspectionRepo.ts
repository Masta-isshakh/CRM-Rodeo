// src/pages/inspection/inspectionRepo.ts
import type { Schema } from "../../amplify/data/resource";
import { getDataClient } from "../lib/amplifyClient";
import { uploadData, getUrl } from "aws-amplify/storage";

type InspectionConfigRow = Schema["InspectionConfig"]["type"];
type InspectionStateRow = Schema["InspectionState"]["type"];
type InspectionReportRow = Schema["InspectionReport"]["type"];

function assertModels(client: any) {
  const m = client?.models;
  if (!m?.InspectionConfig || !m?.InspectionState || !m?.InspectionReport || !m?.InspectionPhoto) {
    throw new Error(
      "Amplify models missing on client. Ensure schema deployed and codegen ran. Missing: " +
        JSON.stringify({
          InspectionConfig: !!m?.InspectionConfig,
          InspectionState: !!m?.InspectionState,
          InspectionReport: !!m?.InspectionReport,
          InspectionPhoto: !!m?.InspectionPhoto,
        })
    );
  }
  return m;
}

function safeJsonParse<T>(s: any, fallback: T): T {
  try {
    if (!s) return fallback;
    return JSON.parse(String(s)) as T;
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function safeName(name: string) {
  return String(name || "file")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
}

// ✅ LOAD CONFIG (highest version active)
export async function loadInspectionConfig(defaultConfig: any): Promise<any> {
  const client = getDataClient();
  const models = assertModels(client);
  const key = "default";

  const res = await models.InspectionConfig.list({
    filter: { configKey: { eq: key }, isActive: { eq: true } } as any,
    limit: 50,
  });

  const rows = (res.data ?? []) as any as InspectionConfigRow[];
  if (rows.length) {
    rows.sort((a: any, b: any) => Number(b.version ?? 0) - Number(a.version ?? 0));
    const best = rows[0];
    if (best?.configJson) {
      return safeJsonParse(best.configJson, defaultConfig);
    }
  }

  // seed (admins only)
  try {
    await models.InspectionConfig.create({
      configKey: key,
      version: 1,
      isActive: true,
      configJson: JSON.stringify(defaultConfig),
      updatedAt: nowIso(),
      createdAt: nowIso(),
      updatedBy: "system",
    } as any);
  } catch {
    // ignore
  }

  return defaultConfig;
}

// ✅ 1:1 mapping: InspectionState.id === JobOrder.id
export async function getInspectionState(jobOrderId: string): Promise<any | null> {
  const client = getDataClient();
  const models = assertModels(client);

  const id = String(jobOrderId || "").trim();
  if (!id) return null;

  const got = await models.InspectionState.get({ id } as any);
  const row = (got as any)?.data as InspectionStateRow | undefined;
  if (!row?.id) return null;

  return safeJsonParse(row.stateJson, null);
}

export async function upsertInspectionState(args: {
  jobOrderId: string;
  orderNumber: string;
  status: "IN_PROGRESS" | "PAUSED" | "COMPLETED" | "NOT_REQUIRED";
  inspectionState: any;
  actor?: string;
}): Promise<void> {
  const client = getDataClient();
  const models = assertModels(client);

  const id = String(args.jobOrderId).trim();
  const ts = nowIso();

  const payload = {
    id, // ✅ enforce 1:1 mapping
    jobOrderId: id,
    orderNumber: String(args.orderNumber).trim(),
    status: args.status,
    stateJson: JSON.stringify(args.inspectionState ?? {}),
    updatedAt: ts,
    updatedBy: args.actor ?? "inspector",
  };

  const got = await models.InspectionState.get({ id } as any);
  const row = (got as any)?.data as InspectionStateRow | undefined;

  if (row?.id) {
    await models.InspectionState.update(payload as any);
  } else {
    await models.InspectionState.create({
      ...payload,
      createdAt: ts,
      createdBy: args.actor ?? "inspector",
      startedAt: ts,
    } as any);
  }
}

// ✅ 1:1 mapping: InspectionReport.id === JobOrder.id
export async function saveInspectionReport(args: {
  jobOrderId: string;
  orderNumber: string;
  html: string;
  actor?: string;
}): Promise<void> {
  const client = getDataClient();
  const models = assertModels(client);

  const id = String(args.jobOrderId).trim();
  const ts = nowIso();

  const got = await models.InspectionReport.get({ id } as any);
  const row = (got as any)?.data as InspectionReportRow | undefined;

  if (row?.id) {
    await models.InspectionReport.update({
      id,
      jobOrderId: id,
      orderNumber: String(args.orderNumber).trim(),
      html: String(args.html ?? ""),
      updatedAt: ts,
      updatedBy: args.actor ?? "inspector",
    } as any);
  } else {
    await models.InspectionReport.create({
      id,
      jobOrderId: id,
      orderNumber: String(args.orderNumber).trim(),
      html: String(args.html ?? ""),
      createdAt: ts,
      createdBy: args.actor ?? "inspector",
      updatedAt: ts,
      updatedBy: args.actor ?? "inspector",
    } as any);
  }
}

export async function getInspectionReport(jobOrderId: string): Promise<string | null> {
  const client = getDataClient();
  const models = assertModels(client);

  const id = String(jobOrderId || "").trim();
  if (!id) return null;

  const got = await models.InspectionReport.get({ id } as any);
  const row = (got as any)?.data as any;
  if (!row?.id) return null;

  return String(row.html ?? "") || null;
}

export async function resolveStorageUrl(path: string): Promise<string> {
  const out = await getUrl({ path });
  return out.url.toString();
}

export async function uploadInspectionPhoto(args: {
  jobOrderId: string;
  orderNumber: string;
  sectionKey: string;
  itemId: string;
  file: File;
  actor?: string;
}): Promise<string> {
  const client = getDataClient();
  const models = assertModels(client);

  const orderNumber = String(args.orderNumber).trim();
  const fileName = safeName(args.file.name);
  const storagePath = `job-orders/${orderNumber}/inspection/photos/${args.sectionKey}/${args.itemId}/${Date.now()}-${fileName}`;

  await uploadData({
    path: storagePath,
    data: args.file,
    options: { contentType: args.file.type || "image/jpeg" },
  }).result;

  const ts = nowIso();

  await models.InspectionPhoto.create({
    jobOrderId: String(args.jobOrderId).trim(),
    orderNumber,
    sectionKey: String(args.sectionKey),
    itemId: String(args.itemId),
    storagePath,
    fileName,
    contentType: args.file.type || "image/jpeg",
    size: args.file.size,
    createdAt: ts,
    createdBy: args.actor ?? "inspector",
  } as any);

  return storagePath;
}

export function buildInspectionReportHtml(args: {
  orderNumber: string;
  detailData: any;
  activeJob: any;
  inspectionState: any;
  sectionConfig: any;
  photoUrlMap: Record<string, string>;
}): string {
  const { orderNumber, detailData, activeJob, inspectionState, sectionConfig, photoUrlMap } = args;
  const safe = (value: any, fallback = "N/A") => {
    const text = String(value ?? "").trim();
    return text || fallback;
  };

  const findings: string[] = [];
  for (const sectionKey of ["exterior", "interior"]) {
    const section = sectionConfig?.[sectionKey];
    if (!section) continue;

    let sectionBody = "";
    for (const group of section.groups || []) {
      let groupBody = "";
      for (const item of group.items || []) {
        const st = inspectionState?.[sectionKey]?.items?.[item.id];
        const status = String(st?.status ?? "").trim().toLowerCase();
        if (status !== "attention" && status !== "failed") continue;

        const comment = String(st?.comment || "").trim();
        const photos: string[] = Array.isArray(st?.photos) ? st.photos : [];
        const cls = status === "failed" ? "fail" : "attn";
        const label = status === "failed" ? "Failed" : "Attention";
        const images = photos
          .map((p) => {
            const url = photoUrlMap[p] || "";
            return url ? `<img src="${url}" alt="Inspection photo" />` : "";
          })
          .join("");

        groupBody += `
          <div class="finding">
            <div class="finding-head">
              <strong>${safe(item.name, "Inspection item")}</strong>
              <span class="pill ${cls}">${label}</span>
            </div>
            <div class="comment">${comment || "No comments provided."}</div>
            ${images ? `<div class="photos">${images}</div>` : ""}
          </div>
        `;
      }

      if (groupBody) {
        sectionBody += `<h3>${safe(group.title, "Inspection Group")}</h3>${groupBody}`;
      }
    }

    if (sectionBody) {
      findings.push(`<section class="card"><h2>${safe(section.title, "Inspection Section")}</h2>${sectionBody}</section>`);
    }
  }

  const findingsHtml = findings.length
    ? findings.join("")
    : `<section class="card"><p>No attention or failed findings were recorded. Pass and completed items are excluded from this report.</p></section>`;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Inspection_Report_${orderNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20mm; background: #f4f7fb; color: #172033; }
          * { box-sizing: border-box; }
          .header { background: #123057; color: #fff; padding: 18px; border-radius: 10px; margin-bottom: 14px; }
          .header h1 { margin: 0 0 6px; font-size: 24px; }
          .header p { margin: 0; opacity: .9; font-size: 12px; }
          .card { background: #fff; border: 1px solid #dbe7f5; border-radius: 10px; padding: 14px; margin-bottom: 12px; }
          .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 14px; font-size: 12px; }
          .label { display: block; color: #64748b; font-weight: 700; margin-bottom: 3px; text-transform: uppercase; font-size: 10px; }
          h2 { margin: 0 0 10px; font-size: 16px; color: #123057; }
          h3 { margin: 12px 0 8px; font-size: 13px; color: #475569; }
          .finding { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
          .finding-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
          .pill { border-radius: 999px; padding: 4px 9px; font-weight: 800; font-size: 11px; }
          .attn { background: #fff3cd; color: #b36b00; }
          .fail { background: #fdeaea; color: #c0392b; }
          .comment { margin-top: 6px; color: #475569; font-size: 12px; }
          .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 8px; }
          .photos img { width: 100%; height: 95px; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0; }
          .signature { height: 80px; }
          .line { border-top: 1px solid #94a3b8; margin-top: 34px; padding-top: 6px; color: #64748b; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Inspection Report</h1>
          <p>Attention and failed findings only - Job Order ${orderNumber} - Generated ${new Date().toLocaleString()}</p>
        </div>
        <section class="card">
          <h2>Order Summary</h2>
          <div class="grid">
            <div><span class="label">Customer</span>${safe(activeJob?.customerName)}</div>
            <div><span class="label">Mobile</span>${safe(activeJob?.mobile)}</div>
            <div><span class="label">Vehicle</span>${safe(detailData?.vehicleModel)}</div>
            <div><span class="label">Plate</span>${safe(activeJob?.vehiclePlate)}</div>
            <div><span class="label">Created By</span>${safe(detailData?.createdBy, "-")}</div>
            <div><span class="label">Expected Delivery</span>${safe(detailData?.expectedDelivery)}</div>
          </div>
        </section>
        ${findingsHtml}
        <section class="card signature">
          <h2>Customer Signature (Required)</h2>
          <div class="line">Name: ${safe(activeJob?.customerName, "")}</div>
        </section>
      </body>
    </html>
  `;
}

export function buildInspectionReportHtmlLegacy(args: {
  orderNumber: string;
  detailData: any;
  activeJob: any;
  inspectionState: any;
  sectionConfig: any;
  photoUrlMap: Record<string, string>;
}): string {
  const { orderNumber, detailData, activeJob, inspectionState, sectionConfig, photoUrlMap } = args;

  const statusLabels: Record<string, string> = {
    pass: "Pass",
    attention: "Attention",
    failed: "Failed",
  };

  const css = `
    body { font-family: 'Segoe UI', sans-serif; margin:0; padding:20mm; background:#f3f6fb; color:#2c3e50; }
    * { box-sizing: border-box; }
    .hdr { text-align:center; margin-bottom:22px; padding:18px 10px; background:linear-gradient(135deg,#2c3e50 0%,#3498db 100%); color:#fff; border-radius:12px; }
    .hdr h1 { margin:0 0 6px 0; font-size:26px; }
    .hdr p { margin:0; font-size:12px; opacity:.9; }
    .card { background:#fff; padding:16px; border-radius:10px; margin-bottom:14px; border:1px solid #e6ecf5; box-shadow:0 6px 16px rgba(25,42,70,.08); }
    .title { font-size:16px; margin:0 0 12px 0; padding-bottom:10px; border-bottom:2px solid #eef2f8; font-weight:700; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px 16px; font-size:13px; }
    .lbl { font-weight:600; color:#2c3e50; display:block; margin-bottom:3px; }
    .val { color:#5a6b7d; }
    .sec { margin-top:10px; font-weight:700; }
    .grp { margin:10px 0 6px 8px; font-weight:700; color:#475569; font-size:13px; }
    .row { margin:0 0 8px 14px; font-size:12.5px; }
    .pill { display:inline-block; padding:3px 8px; border-radius:12px; font-weight:700; font-size:11px; margin-left:6px; }
    .pass { background:#e8f5e9; color:#1e8449; }
    .attn { background:#fff3cd; color:#b36b00; }
    .fail { background:#fdeaea; color:#c0392b; }
    .na { background:#ecf0f1; color:#7f8c8d; }
    .photos { display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; margin:8px 0 10px 14px; }
    .photos img { width:100%; height:90px; object-fit:cover; border-radius:6px; border:1px solid #e2e8f0; }
  `;

  const hdr = `
    <div class="hdr">
      <h1>Inspection Result Report</h1>
      <p>Job Order: ${orderNumber} • Generated on ${new Date().toLocaleString()}</p>
    </div>
  `;

  const summary = `
    <div class="card">
      <div class="title">📋 Order Summary</div>
      <div class="grid">
        <div><span class="lbl">Job Order ID</span><span class="val">${orderNumber}</span></div>
        <div><span class="lbl">Request Date</span><span class="val">${detailData?.createDate || "N/A"}</span></div>
        <div><span class="lbl">Created By</span><span class="val">${detailData?.createdBy || "—"}</span></div>
        <div><span class="lbl">Expected Delivery</span><span class="val">${detailData?.expectedDelivery || "N/A"}</span></div>
      </div>
    </div>
  `;

  const customer = `
    <div class="card">
      <div class="title">👤 Customer</div>
      <div class="grid">
        <div><span class="lbl">Name</span><span class="val">${activeJob?.customerName || "N/A"}</span></div>
        <div><span class="lbl">Mobile</span><span class="val">${activeJob?.mobile || "N/A"}</span></div>
        <div><span class="lbl">Email</span><span class="val">${detailData?.email || "N/A"}</span></div>
        <div><span class="lbl">Address</span><span class="val">${detailData?.address || "N/A"}</span></div>
      </div>
    </div>
  `;

  const vehicle = `
    <div class="card">
      <div class="title">🚗 Vehicle</div>
      <div class="grid">
        <div><span class="lbl">Make & Model</span><span class="val">${detailData?.vehicleModel || "N/A"}</span></div>
        <div><span class="lbl">Year</span><span class="val">${detailData?.year || "N/A"}</span></div>
        <div><span class="lbl">Type</span><span class="val">${detailData?.type || "N/A"}</span></div>
        <div><span class="lbl">Color</span><span class="val">${detailData?.color || "N/A"}</span></div>
        <div><span class="lbl">Plate</span><span class="val">${activeJob?.vehiclePlate || "N/A"}</span></div>
        <div><span class="lbl">VIN</span><span class="val">${detailData?.vin || "N/A"}</span></div>
      </div>
    </div>
  `;

  let results = `
    <div class="card">
      <div class="title">✅ Inspection Results</div>
  `;

  for (const sectionKey of ["exterior", "interior"]) {
    const section = sectionConfig?.[sectionKey];
    if (!section) continue;

    results += `<div class="sec">${section.title}</div>`;

    for (const group of section.groups || []) {
      results += `<div class="grp">${group.title}</div>`;

      for (const item of group.items || []) {
        const st = inspectionState?.[sectionKey]?.items?.[item.id];
        const status = st?.status || "not-checked";
        const label = statusLabels[status] || "Not Checked";
        const cls =
          status === "pass" ? "pass" : status === "attention" ? "attn" : status === "failed" ? "fail" : "na";

        const comment = String(st?.comment || "").trim();
        const photos: string[] = Array.isArray(st?.photos) ? st.photos : [];

        results += `<div class="row">${item.name}: <span class="pill ${cls}">${label}</span>${
          comment ? ` <span style="color:#7f8c8d">(${comment})</span>` : ""
        }</div>`;

        if (photos.length) {
          const imgs = photos
            .map((p) => {
              const url = photoUrlMap[p] || "";
              return url ? `<img src="${url}" />` : "";
            })
            .join("");
          if (imgs) results += `<div class="photos">${imgs}</div>`;
        }
      }
    }
  }

  results += `</div>`;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Inspection_Result_${orderNumber}</title>
        <style>${css}</style>
      </head>
      <body>
        ${hdr}
        ${summary}
        ${customer}
        ${vehicle}
        ${results}
      </body>
    </html>
  `;
}

// ---- Admin helpers ----

export async function getActiveInspectionConfigRecord(configKey = "default") {
  const client = getDataClient();
  const models = assertModels(client);

  const res = await models.InspectionConfig.list({
    filter: { configKey: { eq: configKey }, isActive: { eq: true } } as any,
    limit: 50,
  });

  const rows = (res.data ?? []) as any[];
  if (!rows.length) return null;

  rows.sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0));
  return rows[0];
}

export async function saveInspectionConfigToBackend(args: {
  configKey?: string;
  configObject: any;
  actor?: string;
}) {
  const client = getDataClient();
  const models = assertModels(client);

  const ts = nowIso();
  const configKey = args.configKey ?? "default";

  const existing = await getActiveInspectionConfigRecord(configKey);
  const configJson = JSON.stringify(args.configObject ?? [], null, 2);

  if (!existing?.id) {
    await models.InspectionConfig.create({
      configKey,
      version: 1,
      isActive: true,
      configJson,
      createdAt: ts,
      updatedAt: ts,
      updatedBy: args.actor ?? "admin",
    } as any);
    return;
  }

  // overwrite same row, bump version (simple)
  await models.InspectionConfig.update({
    id: existing.id,
    configKey,
    version: Number(existing.version ?? 1) + 1,
    isActive: true,
    configJson,
    updatedAt: ts,
    updatedBy: args.actor ?? "admin",
  } as any);
}
