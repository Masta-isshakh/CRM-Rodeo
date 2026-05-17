const fs = require('fs');
const path = require('path');

const inputPath = 'qa-artifacts/loading-audit/loading-audit.json';
const outputPath = 'qa-artifacts/loading-audit/loading-audit-strict-async.json';
const summaryPath = 'qa-artifacts/loading-audit/loading-audit-strict-async-summary.json';

if (!fs.existsSync(inputPath)) {
    console.error('Input file not found');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const entries = data.entries || [];

const uiPatterns = [
    /^\(\) => set/i,
    /set[A-Z]/,
    /onClose/i,
    /onCancel/i,
    /onBack/i,
    /onToggle/i,
    /stopPropagation/i,
    /preventDefault/i,
    /setPage\(/i,
    /setPreviewPage\(/i,
    /setResultsViewMode\(/i,
    /setPreviewViewMode\(/i,
    /\bclear\b/i,
    /\btoggle\b/i,
    /\bopen\b/i,
    /\bclose\b/i
];

const businessPatterns = [
    /withLoading/i,
    /showLoading/i,
    /hideLoading/i,
    /await/i,
    /\bvoid\s/i,
    /save|submit|create|update|delete|remove|import|export|upload|download|approve|reject|cancelled|send|refresh|load|fetch|restore|move|share|bulk|confirm/i
];

const filtered = entries.filter(entry => {
    const action = entry.action || '';
    const isBusiness = businessPatterns.some(p => p.test(action));
    if (isBusiness) return true;
    const isUI = uiPatterns.some(p => p.test(action));
    if (isUI) return false;
    return false;
});

const seen = new Set();
const unique = filtered.filter(entry => {
    const key = entry.page + '|' + entry.action + '|' + (entry['line-reference'] || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
});

unique.sort((a, b) => {
    if (a.page !== b.page) return (a.page || '').localeCompare(b.page || '');
    const lineA = parseInt((a['line-reference'] || '').split(':').pop()) || 0;
    const lineB = parseInt((b['line-reference'] || '').split(':').pop()) || 0;
    return lineA - lineB;
});

fs.writeFileSync(outputPath, JSON.stringify({ entries: unique }, null, 2));

const counts = unique.reduce((acc, entry) => {
    const status = entry['loader-status'] || 'not-covered'; 
    acc[status] = (acc[status] || 0) + 1;
    return acc;
}, {});

const issues = unique.filter(e => {
    const s = e['loader-status'] || 'not-covered';
    return s === 'not-covered' || s === 'needs-review';
}).slice(0, 50);

const summary = {
    generatedAt: new Date().toISOString(),
    sourceReport: inputPath,
    totalEntries: unique.length,
    counts,
    'top-50-issues': issues
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log(JSON.stringify({
    counts,
    first10Issues: issues.slice(0, 10)
}, null, 2));
