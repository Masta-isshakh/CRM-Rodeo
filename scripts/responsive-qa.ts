import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";

type ViewportDef = { name: string; width: number; height: number };
type PageDef = { key: string; label: string; title: string; external?: boolean };
type RunRow = {
  pageKey: string;
  label: string;
  title: string;
  viewport: string;
  width: number;
  height: number;
  status: "pass" | "fail" | "skipped";
  reason?: string;
  measuredWidth?: number;
  expected98pct?: number;
  deltaPx?: number;
  leftGapPx?: number;
  rightGapPx?: number;
  centeredGapDeltaPx?: number;
  passWidth?: boolean;
  passCentered?: boolean;
  hasHorizontalOverflow?: boolean;
  screenshotPath?: string;
};

const BASE_URL = process.env.QA_BASE_URL || "http://localhost:5173";
const QA_EMAIL = process.env.QA_EMAIL || "";
const QA_PASSWORD = process.env.QA_PASSWORD || "";

const VIEWPORTS: ViewportDef[] = [
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "ultrawide-2560x1440", width: 2560, height: 1440 },
];

const TARGET_PAGES: PageDef[] = [
  { key: "dashboard", label: "Dashboard", title: "Dashboard" },
  { key: "customers", label: "Customers", title: "Customers" },
  { key: "vehicles", label: "Vehicles", title: "Vehicles" },
  { key: "jobcards", label: "Job Cards", title: "Job Cards" },
  { key: "servicecreation", label: "Service Creation", title: "Service Creation" },
  { key: "jobhistory", label: "Job History", title: "Job History" },
  { key: "serviceexecution", label: "Service Execution", title: "Service Execution" },
  { key: "paymentinvoices", label: "Payment & Invoices", title: "Payment & Invoices" },
  { key: "qualitycheck", label: "Quality Check", title: "Quality Check" },
  { key: "exitpermit", label: "Exit Permit", title: "Exit Permit" },
  { key: "calltracking", label: "Call Tracking", title: "Call Tracking" },
  { key: "internalchat", label: "Internal Chat", title: "Internal Chat" },
  { key: "emailinbox", label: "Email Inbox", title: "Email Inbox", external: true },
  { key: "inspection", label: "Inspection", title: "Inspection" },
  { key: "tickets", label: "Tickets", title: "Tickets" },
  { key: "employees", label: "Employees", title: "Employees" },
  { key: "inventory", label: "Inventory", title: "Inventory" },
  { key: "activitylog", label: "Activity Log", title: "Activity Log" },
  { key: "users", label: "Users", title: "User Management" },
  { key: "departments", label: "Departments", title: "Departments" },
  { key: "rolespolicies", label: "Roles & Policies", title: "Roles & Policies" },
  { key: "campaignaudience", label: "Campaign Audience", title: "Campaign Audience" },
  { key: "dbcleanup", label: "Database Cleanup", title: "Database Cleanup" },
];

async function waitForAppShell(page: Page): Promise<void> {
  await page.waitForSelector(".layout-root", { timeout: 30_000 });
}

async function loginIfNeeded(page: Page): Promise<void> {
  const hasLayout = await page.locator(".layout-root").first().isVisible().catch(() => false);
  if (hasLayout) return;

  const usernameInput = page.locator('input[name="username"], input[type="email"]');
  const passwordInput = page.locator('input[name="password"], input[type="password"]');

  const hasLogin = await usernameInput.first().isVisible().catch(() => false);
  if (!hasLogin) return;

  if (!QA_EMAIL || !QA_PASSWORD) {
    throw new Error("Authentication required. Provide QA_EMAIL and QA_PASSWORD env vars.");
  }

  await usernameInput.first().fill(QA_EMAIL);
  await passwordInput.first().fill(QA_PASSWORD);

  const submit = page
    .locator('button:has-text("Login"), button:has-text("Sign in"), button:has-text("Sign In"), button[type="submit"]')
    .first();

  await submit.click();
  await waitForAppShell(page);
}

async function ensureSidebarOpen(page: Page, viewport: ViewportDef): Promise<void> {
  if (viewport.width >= 1100) return;

  const sidebarVisible = await page.locator(".drawer.open").isVisible().catch(() => false);
  if (sidebarVisible) return;

  const toggle = page.locator(".menu-toggle").first();
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    await page.waitForSelector(".drawer.open", { timeout: 10_000 });
  }
}

async function openPageByLabel(page: Page, viewport: ViewportDef, item: PageDef): Promise<{ ok: boolean; reason?: string }> {
  if (item.external) return { ok: false, reason: "External page (opens new tab)" };

  await ensureSidebarOpen(page, viewport);

  const navButton = page.locator(".drawer-nav button", { hasText: item.label }).first();
  const visible = await navButton.isVisible().catch(() => false);
  if (!visible) {
    return { ok: false, reason: `Sidebar button not visible: ${item.label}` };
  }

  await navButton.click();

  const titleLocator = page.locator(".topbar-page").first();
  await titleLocator.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(1200);

  const actualTitle = (await titleLocator.textContent())?.trim() || "";
  if (!actualTitle.toLowerCase().includes(item.title.toLowerCase())) {
    return { ok: false, reason: `Title mismatch: expected ${item.title}, got ${actualTitle || "(empty)"}` };
  }

  return { ok: true };
}

async function measureLayout(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector(".content > *") as HTMLElement | null;
    const content = document.querySelector(".content") as HTMLElement | null;

    if (!root || !content) {
      return {
        ok: false,
        reason: "Could not find .content > * or .content",
      };
    }

    const vp = document.documentElement.clientWidth;
    const rect = root.getBoundingClientRect();
    const expected = vp * 0.98;
    const delta = Math.abs(rect.width - expected);
    const leftGap = rect.left;
    const rightGap = vp - rect.right;
    const centeredGapDelta = Math.abs(leftGap - rightGap);
    const hasHorizontalOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;

    return {
      ok: true,
      measuredWidth: Number(rect.width.toFixed(2)),
      expected98pct: Number(expected.toFixed(2)),
      deltaPx: Number(delta.toFixed(2)),
      leftGapPx: Number(leftGap.toFixed(2)),
      rightGapPx: Number(rightGap.toFixed(2)),
      centeredGapDeltaPx: Number(centeredGapDelta.toFixed(2)),
      passWidth: delta <= 2,
      passCentered: centeredGapDelta <= 2,
      hasHorizontalOverflow,
    };
  });
}

function toMarkdown(rows: RunRow[]): string {
  const headers = ["Page", "390", "768", "1440", "2560"];
  const byPage = new Map<string, RunRow[]>();
  for (const row of rows) {
    const list = byPage.get(row.pageKey) ?? [];
    list.push(row);
    byPage.set(row.pageKey, list);
  }

  const lines: string[] = [];
  lines.push("# Responsive QA Matrix");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);

  for (const item of TARGET_PAGES) {
    const list = byPage.get(item.key) ?? [];
    const pick = (name: string) => list.find((r) => r.viewport === name);
    const cell = (name: string) => {
      const row = pick(name);
      if (!row) return "-";
      if (row.status === "pass") return "PASS";
      if (row.status === "fail") return `FAIL (${row.reason || ""})`;
      return `SKIP (${row.reason || ""})`;
    };

    lines.push(
      `| ${item.label} | ${cell("mobile-390x844")} | ${cell("tablet-768x1024")} | ${cell("desktop-1440x900")} | ${cell("ultrawide-2560x1440")} |`
    );
  }

  lines.push("");
  lines.push("## Detailed Rows");
  lines.push("");
  for (const row of rows) {
    lines.push(
      `- ${row.label} @ ${row.viewport}: ${row.status.toUpperCase()}${row.reason ? ` - ${row.reason}` : ""}${
        row.screenshotPath ? ` - ${row.screenshotPath}` : ""
      }`
    );
  }

  return lines.join("\n");
}

async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "qa-artifacts", "responsive", runId);
  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const rows: RunRow[] = [];

  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await loginIfNeeded(page);
    await waitForAppShell(page);

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(700);

      for (const item of TARGET_PAGES) {
        const baseRow: RunRow = {
          pageKey: item.key,
          label: item.label,
          title: item.title,
          viewport: vp.name,
          width: vp.width,
          height: vp.height,
          status: "skipped",
        };

        const nav = await openPageByLabel(page, vp, item);
        if (!nav.ok) {
          rows.push({ ...baseRow, reason: nav.reason || "Navigation failed" });
          continue;
        }

        const measurement = await measureLayout(page);
        if (!measurement.ok) {
          rows.push({ ...baseRow, status: "fail", reason: measurement.reason });
          continue;
        }

        const shotName = `${item.key}__${vp.name}.png`;
        const shotPath = path.join(outDir, shotName);
        await page.screenshot({ path: shotPath, fullPage: true });

        const pass = measurement.passWidth && measurement.passCentered && !measurement.hasHorizontalOverflow;
        rows.push({
          ...baseRow,
          status: pass ? "pass" : "fail",
          reason: pass
            ? undefined
            : `passWidth=${measurement.passWidth}, passCentered=${measurement.passCentered}, overflow=${measurement.hasHorizontalOverflow}`,
          measuredWidth: measurement.measuredWidth,
          expected98pct: measurement.expected98pct,
          deltaPx: measurement.deltaPx,
          leftGapPx: measurement.leftGapPx,
          rightGapPx: measurement.rightGapPx,
          centeredGapDeltaPx: measurement.centeredGapDeltaPx,
          passWidth: measurement.passWidth,
          passCentered: measurement.passCentered,
          hasHorizontalOverflow: measurement.hasHorizontalOverflow,
          screenshotPath: shotPath,
        });
      }
    }
  } finally {
    await browser.close();
  }

  const jsonPath = path.join(outDir, "responsive-matrix.json");
  const mdPath = path.join(outDir, "responsive-matrix.md");

  await fs.writeFile(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: BASE_URL, rows }, null, 2), "utf8");
  await fs.writeFile(mdPath, toMarkdown(rows), "utf8");

  const failCount = rows.filter((r) => r.status === "fail").length;
  const passCount = rows.filter((r) => r.status === "pass").length;
  const skipCount = rows.filter((r) => r.status === "skipped").length;

  console.log(`Responsive QA complete. pass=${passCount}, fail=${failCount}, skipped=${skipCount}`);
  console.log(`Artifacts: ${outDir}`);

  if (failCount > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error("Responsive QA failed:", error);
  process.exit(1);
});
