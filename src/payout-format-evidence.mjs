// M3 research gate: assess the provenance and schema metadata of payout exports.
// This does not parse CSV, verify the claims, reconcile a payout, or grant a commercial Go.
export const PAYOUT_BREAKDOWN_ROLES = Object.freeze([
  'payout_reservations',
  'payout_passes_subscriptions'
]);

const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0;
const isNonEmptyNames = value => Array.isArray(value) && value.length > 0 &&
  value.every(isNonEmptyString) && new Set(value).size === value.length;
const isHttpsUrl = value => {
  if (!isNonEmptyString(value)) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};

export function assessPayoutFormatEvidence(entries) {
  if (!Array.isArray(entries)) throw new TypeError('検証対象は配列で指定してください');
  const blockers = [];
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object' || !PAYOUT_BREAKDOWN_ROLES.includes(entry.role)) {
      blockers.push(`INVALID_ROLE:${index}`);
      continue;
    }
    if (seen.has(entry.role)) {
      blockers.push(`DUPLICATE_ROLE:${entry.role}`);
      continue;
    }
    seen.add(entry.role);
    const prefix = entry.role + ':';
    if (entry.product !== 'STORES予約' || entry.exportSurface !== 'payout_history') {
      blockers.push(prefix + 'WRONG_EXPORT_SURFACE');
    }
    if (!['official_public_sample', 'permissioned_anonymized_sample'].includes(entry.sourceKind)) {
      blockers.push(prefix + 'SOURCE_NOT_VERIFIABLE');
    } else if (entry.sourceKind === 'official_public_sample' && !isHttpsUrl(entry.sourceUrl)) {
      blockers.push(prefix + 'OFFICIAL_SAMPLE_URL_MISSING');
    } else if (entry.sourceKind === 'permissioned_anonymized_sample' && entry.permissionConfirmed !== true) {
      blockers.push(prefix + 'PERMISSION_NOT_CONFIRMED');
    }
    if (!isDate(entry.observedAt)) blockers.push(prefix + 'OBSERVATION_DATE_MISSING');
    if (entry.fileFormat !== 'csv') blockers.push(prefix + 'CSV_FORMAT_UNCONFIRMED');
    if (!isNonEmptyNames(entry.headers)) blockers.push(prefix + 'REAL_HEADERS_UNCONFIRMED');
    if (!isNonEmptyNames(entry.identifierColumns)) blockers.push(prefix + 'IDENTIFIER_COLUMNS_UNCONFIRMED');
    if (!isNonEmptyString(entry.rowGrain)) blockers.push(prefix + 'ROW_GRAIN_UNCONFIRMED');
  }
  for (const role of PAYOUT_BREAKDOWN_ROLES) {
    if (!seen.has(role)) blockers.push('MISSING:' + role);
  }
  return {
    state: blockers.length ? 'INSUFFICIENT_EVIDENCE' : 'READY_FOR_MANUAL_SCHEMA_REVIEW',
    blockers,
    // Always false: a metadata-only gate cannot verify real CSV compatibility.
    realCsvCompatibilityVerified: false
  };
}
