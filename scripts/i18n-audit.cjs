const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, "src");
const translationsPath = path.join(srcRoot, "i18n", "translations.ts");

function walk(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      out.push(...walk(full));
      continue;
    }
    if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function normalize(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function shouldSkipText(text) {
  if (!text) return true;
  const t = normalize(text);
  if (!t) return true;
  if (t.length < 2) return true;
  if (/^[0-9\s.,:%()\-+/*#]+$/.test(t)) return true;
  if (/^(fa[srldb]?\s+fa-|https?:\/\/|\/|#|--)/i.test(t)) return true;
  if (/^[A-Z0-9_\-:.]+$/.test(t) && !/\s/.test(t)) return true;
  if (/^[{}[\]<>="'`|\\]+$/.test(t)) return true;
  return false;
}

function loadDictionaryKeys() {
  const raw = fs.readFileSync(translationsPath, "utf8");
  const keys = new Set();
  const pairRegex = /\[\s*"([^"]+)"\s*,\s*"[^"]*"\s*\]/g;
  let m;
  while ((m = pairRegex.exec(raw)) !== null) {
    const key = normalize(m[1]);
    if (key) keys.add(key);
  }
  return keys;
}

function lineAt(sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function isStringLiteralLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function readJsxAttrString(init) {
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression && isStringLiteralLike(init.expression)) {
    return init.expression.text;
  }
  return null;
}

function collectFromFile(filePath, dict) {
  const rel = path.relative(repoRoot, filePath).replace(/\\/g, "/");
  const code = fs.readFileSync(filePath, "utf8");
  const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const missing = [];

  function add(text, pos, kind) {
    const normalized = normalize(text);
    if (shouldSkipText(normalized)) return;
    if (dict.has(normalized)) return;
    missing.push({
      file: rel,
      line: lineAt(sf, pos),
      text: normalized,
      kind,
    });
  }

  function visit(node) {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments.length > 0) {
        const arg = node.arguments[0];
        if (isStringLiteralLike(arg)) add(arg.text, arg.pos, "t-call");
      }
    }

    if (ts.isJsxText(node)) {
      add(node.getText(sf), node.pos, "jsx-text");
    }

    if (ts.isJsxAttribute(node)) {
      const attr = node.name.text;
      if (["placeholder", "title", "aria-label", "alt"].includes(attr)) {
        const v = readJsxAttrString(node.initializer);
        if (v) add(v, node.pos, `attr:${attr}`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);

  const uniq = new Map();
  for (const item of missing) {
    const k = `${item.file}:${item.line}:${item.text}:${item.kind}`;
    if (!uniq.has(k)) uniq.set(k, item);
  }

  return Array.from(uniq.values()).sort((a, b) => a.line - b.line);
}

function main() {
  const dict = loadDictionaryKeys();
  const files = walk(srcRoot)
    .filter((f) => f.includes(`${path.sep}pages${path.sep}`) || f.includes(`${path.sep}components${path.sep}`) || f.includes(`${path.sep}App.tsx`));

  const byFile = [];
  let total = 0;

  for (const f of files) {
    const result = collectFromFile(f, dict);
    if (result.length > 0) {
      total += result.length;
      byFile.push({ file: path.relative(repoRoot, f).replace(/\\/g, "/"), items: result });
    }
  }

  byFile.sort((a, b) => a.file.localeCompare(b.file));

  const out = [];
  out.push("# Missing Arabic Translation Audit");
  out.push("");
  out.push(`- Files scanned: ${files.length}`);
  out.push(`- Missing candidate strings: ${total}`);
  out.push("");
  out.push("Note: This report is static and conservative; it focuses on UI strings likely visible to users.");
  out.push("");

  for (const group of byFile) {
    out.push(`## ${group.file}`);
    out.push("");
    for (const item of group.items) {
      const safeText = item.text.replace(/\|/g, "\\|");
      out.push(`- ${group.file}:${item.line} [${item.kind}] \`${safeText}\``);
    }
    out.push("");
  }

  const reportPath = path.join(repoRoot, "docs", "i18n-missing-report.md");
  fs.writeFileSync(reportPath, out.join("\n"), "utf8");

  console.log(`Report generated: ${reportPath}`);
  console.log(`Files with missing strings: ${byFile.length}`);
  console.log(`Total missing candidate strings: ${total}`);
}

main();
