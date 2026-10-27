// Research-only source coverage gate. Does not parse real STORES CSV or calculate payouts.
// STORES' official help describes two separate payout breakdown downloads.
export const REQUIRED_PAYOUT_SOURCES = Object.freeze([
  'payout_reservations',
  'payout_passes_subscriptions',
  'bank_deposit'
]);
const ALLOWED = new Set([...REQUIRED_PAYOUT_SOURCES, 'reservation_list']);

export function assessPayoutSourceCoverage({
  payoutReference, sources, schemaVerified = false, linkageVerified = false
}) {
  if (typeof payoutReference !== 'string' || !payoutReference.trim()) {
    throw new Error('入金対象を識別する参照値が必要です');
  }
  if (!Array.isArray(sources)) throw new Error('データソース一覧が必要です');
  if (typeof schemaVerified !== 'boolean' || typeof linkageVerified !== 'boolean') {
    throw new Error('検証状態は真偽値で指定してください');
  }
  const present = new Map();
  for (const source of sources) {
    if (!source || !ALLOWED.has(source.role) ||
        typeof source.payoutReference !== 'string' ||
        !source.payoutReference.trim() ||
        typeof source.finalized !== 'boolean') {
      throw new Error('データソースの区分・参照値・確定状態が不正です');
    }
    if (present.has(source.role)) {
      throw new Error('同じ区分のソースが複数あります。統合条件を確認してください');
    }
    present.set(source.role, source);
  }
  const blockers = [];
  for (const role of REQUIRED_PAYOUT_SOURCES) {
    if (!present.has(role)) blockers.push('MISSING:' + role);
  }
  for (const source of sources) {
    if (source.payoutReference !== payoutReference) {
      blockers.push('REFERENCE_MISMATCH:' + source.role);
    }
    if (REQUIRED_PAYOUT_SOURCES.includes(source.role) && !source.finalized) {
      blockers.push('NOT_FINALIZED:' + source.role);
    }
  }
  if (!schemaVerified) blockers.push('REAL_CSV_SCHEMA_UNVERIFIED');
  if (!linkageVerified) blockers.push('PAYOUT_TO_BANK_LINK_UNVERIFIED');
  return {
    state: blockers.length === 0 ? 'READY_FOR_MANUAL_REVIEW' : 'INSUFFICIENT_EVIDENCE',
    blockers
  };
}
