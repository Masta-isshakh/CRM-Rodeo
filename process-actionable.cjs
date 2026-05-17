const fs = require('fs');
const path = require('path');

const sourcePath = 'qa-artifacts/loading-audit/loading-audit-strict-async.json';
const rawData = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const data = rawData.entries || rawData;

const keepRegex = /withLoading|showLoading|hideLoading|await|void\s+|save|submit|create|update|delete|remove|import|export|upload|download|approve|reject|restore|move|share|bulk|confirm|send|refresh|load|fetch|sync|revoke|cancel\s*order|handle\w+/i;
const excludeRegex = /set[A-Z]\w*\(|set[A-Z]\w*$|onClose|onCancel|onBack|onToggle|onInput|onKeyDown|stopPropagation|preventDefault|openUploadPicker|openFolderPicker|openNewFolderComposer|openRow|openShareModal|closeShareModal|toggle|layout|viewmode|previewpage|resultsviewmode|page\(|draft|focus|clear|reset(?!.*(password|session|token))/i;

let filtered = data.filter(entry => {
  const action = entry.action || '';
  const status = entry['loader-status'];

  if (status === 'covered') return true;

  const matchesKeep = keepRegex.test(action);
  const matchesExclude = excludeRegex.test(action);

  if (status === 'needs-review') {
    return matchesKeep && !matchesExclude;
  }
  if (status === 'not-covered') {
    return matchesKeep && !matchesExclude;
  }
  return false;
});

// Deduplicate
const seen = new Set();
filtered = filtered.filter(entry => {
  const key = `${entry.page}|${entry.action}|${entry['line-reference']}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

// Sort helper for line numbers
const getLine = (ref) => {
  if (typeof ref === 'number') return ref;
  if (typeof ref === 'string') {
    const parts = ref.split(':');
    return parseInt(parts[parts.length - 1], 10) || 0;
  }
  return 0;
};

// Sort
filtered.sort((a, b) => {
  if (a.page < b.page) return -1;
  if (a.page > b.page) return 1;
  return getLine(a['line-reference']) - getLine(b['line-reference']);
});

fs.writeFileSync('qa-artifacts/loading-audit/loading-audit-strict-async-actionable.json', JSON.stringify(filtered, null, 2));

const notCovered = filtered.filter(e => e['loader-status'] === 'not-covered');
const needsReview = filtered.filter(e => e['loader-status'] === 'needs-review');
const covered = filtered.filter(e => e['loader-status'] === 'covered');

const summary = {
  generatedAt: new Date().toISOString(),
  sourceReport: sourcePath,
  totalEntries: filtered.length,
  counts: {
    'covered': covered.length,
    'not-covered': notCovered.length,
    'needs-review': needsReview.length
  },
  actionableNotCovered: notCovered,
  actionableNeedsReview: needsReview,
  'top-50-priority': [...notCovered, ...needsReview].slice(0, 50)
};

fs.writeFileSync('qa-artifacts/loading-audit/loading-audit-strict-async-actionable-summary.json', JSON.stringify(summary, null, 2));

console.log(JSON.stringify({
  counts: summary.counts,
  priorityFirst15: summary['top-50-priority'].slice(0, 15)
}, null, 2));
