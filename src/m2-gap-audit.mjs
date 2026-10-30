import {summarizeDemandEvidence} from './demand-evidence.mjs';

// A diagnostic report, not a substitute for manually verifying the source URL.
// Never turn a missing publication date, unknown operator, or unverified software
// into a qualified firsthand user just to meet a deadline.
const validDate = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validPublication = value => validDate(value) ||
  (typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
const unknownSoftware = value => typeof value !== 'string' ||
  /^(未公表|未確認|不明|未記載|なし|unknown|not disclosed)(?:$|[（(\s])/i.test(value.trim()) ||
  /予約|booking|coubic|レジ|決済|ネットショップ/i.test(value);

export function buildM2GapAudit(registry) {
  const summary = summarizeDemandEvidence(registry);
  const qualified = new Set(summary.m2QualifiedIds);
  const duplicates = new Set(summary.duplicateOperatorIds);
  const rows = registry.sources
    .filter(source => source.kind === 'firsthand_workflow')
    .map(source => {
      const missingConditions = [];
      if (source.bookingProduct !== 'STORES予約' ||
          !source.bookingUseEvidence?.trim()) {
        missingConditions.push('STORES_RESERVATION_USE_UNVERIFIED');
      }
      if (!validPublication(source.publishedAt)) {
        missingConditions.push('SOURCE_PUBLICATION_PERIOD_UNVERIFIED');
      }
      if (unknownSoftware(source.accountingSoftware) ||
          !source.accountingSoftwareUseEvidence?.trim()) {
        missingConditions.push('ACCOUNTING_SOFTWARE_USE_UNVERIFIED');
      }
      if (!source.operatorKey?.trim()) {
        missingConditions.push('INDEPENDENT_OPERATOR_UNVERIFIED');
      }
      if (duplicates.has(source.id)) {
        missingConditions.push('DUPLICATE_OPERATOR');
      }
      const accepted = qualified.has(source.id);
      if (accepted && missingConditions.length) {
        throw new Error(source.id + ': M2集計と不足条件が矛盾しています');
      }
      if (!accepted && missingConditions.length === 0) {
        missingConditions.push('MANUAL_SOURCE_REVIEW_REQUIRED');
      }
      return {id: source.id, url: source.url, qualified: accepted, missingConditions};
    });
  if (rows.filter(row => row.qualified).length !== summary.m2QualifiedFirsthandWorkflows) {
    throw new Error('M2集計と監査レポートの件数が一致しません');
  }
  return {
    checkedAt: registry.checkedAt,
    dueDate: '2026-10-31',
    target: 5,
    qualified: summary.m2QualifiedFirsthandWorkflows,
    missing: summary.missing.firsthandCases,
    targetMfMonthlyReconciliation: summary.targetMfReconciliationWorkflows,
    note: '公開一次証拠のメタデータ監査。URLの真偽・実CSV適合・有料需要を自動認定しない。未承認の連絡・実顧客CSV取得は禁止。',
    sources: rows
  };
}
