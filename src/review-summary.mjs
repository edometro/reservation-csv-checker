import {stringifyCSV} from './core.mjs';

/**
 * Aggregate why rows need manual review. Reasons are NOT mutually exclusive:
 * one row may contribute to multiple counts and amounts. Never sum reason
 * totals to estimate sales, receipts or the overall review amount.
 */
export function summarizeReviewReasons(findings) {
  const totals = new Map();
  for (const finding of findings) {
    if (finding.ready) continue;
    const reasons = new Set(finding.flags?.length ? finding.flags : ['理由が未設定です（元CSVを確認してください）']);
    for (const reason of reasons) {
      if (typeof reason !== 'string' || !reason.trim()) continue;
      if (!totals.has(reason)) {
        totals.set(reason, {reason, count: 0, amountYen: 0n, unknownAmountCount: 0});
      }
      const entry = totals.get(reason);
      entry.count++;
      if (Number.isSafeInteger(finding.amount) && finding.amount > 0) {
        entry.amountYen += BigInt(finding.amount);
      } else {
        entry.unknownAmountCount++;
      }
    }
  }
  return [...totals.values()].sort((a, b) =>
    b.count - a.count || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
}

// Keep a summary safe when opened in spreadsheet software. No transaction IDs
// or personal information are included in this aggregate export.
function spreadsheetSafe(value) {
  const text = String(value).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return /^[=+\-@]/u.test(text) ? "'" + text : text;
}

export function reviewReasonsCSV(findings) {
  return stringifyCSV([
    ['要確認理由', '該当件数（理由間で重複あり）', '対象金額(円)（理由間で重複あり）', '金額不明件数'],
    ...summarizeReviewReasons(findings).map(item => [
      spreadsheetSafe(item.reason), item.count, item.amountYen.toString(), item.unknownAmountCount
    ])
  ]);
}
