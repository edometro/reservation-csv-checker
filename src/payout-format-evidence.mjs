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
// A third-party HTTPS URL is not evidence of an official STORES export.
// Hostname equality/suffix checks prevent stores.jp.evil.example lookalikes.
// Off-domain samples require separate manual provenance handling, not an
// automatic "official_public_sample" pass.
const isOfficialStoresSampleUrl = value => {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    const domains = ['stores.jp', 'stores.fun', 'stores.app'];
    return url.protocol === 'https:' && !url.username && !url.password &&
      !url.port && domains.some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  } catch { return false; }
};

export function assessPayoutFormatEvidence(entries, {asOf} = {}) {
  if (!Array.isArray(entries)) throw new TypeError('検証対象は配列で指定してください');
  const blockers = [];
  const seen = new Set();
  const payoutJoinSemantics = new Map();
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
    } else if (entry.sourceKind === 'official_public_sample' && !isOfficialStoresSampleUrl(entry.sourceUrl)) {
      blockers.push(prefix + 'OFFICIAL_SAMPLE_URL_UNTRUSTED');
    } else if (entry.sourceKind === 'permissioned_anonymized_sample' && entry.permissionConfirmed !== true) {
      blockers.push(prefix + 'PERMISSION_NOT_CONFIRMED');
    }
    if (!isDate(entry.observedAt)) blockers.push(prefix + 'OBSERVATION_DATE_MISSING');
    else if (asOf && entry.observedAt > asOf) blockers.push(prefix + 'OBSERVATION_DATE_IN_FUTURE');
    if (entry.fileFormat !== 'csv') blockers.push(prefix + 'CSV_FORMAT_UNCONFIRMED');
    if (!isNonEmptyNames(entry.headers)) blockers.push(prefix + 'REAL_HEADERS_UNCONFIRMED');
    if (!isNonEmptyNames(entry.identifierColumns)) blockers.push(prefix + 'IDENTIFIER_COLUMNS_UNCONFIRMED');
    else if (!Array.isArray(entry.headers) || entry.identifierColumns.some(name => !entry.headers.includes(name))) {
      blockers.push(prefix + 'IDENTIFIER_COLUMNS_NOT_IN_HEADERS');
    }
    if (!isNonEmptyString(entry.rowGrain)) blockers.push(prefix + 'ROW_GRAIN_UNCONFIRMED');
    // Per-file identifiers are not evidence that both exports belong to the same payout.
    // The join claim must name an observed column and its intended semantic identity.
    // A matching claim still requires manual verification against a real sample.
    const join = entry.payoutJoin;
    if (!join || !isNonEmptyString(join.column) ||
        !Array.isArray(entry.headers) || !entry.headers.includes(join.column) ||
        !Array.isArray(entry.identifierColumns) || !entry.identifierColumns.includes(join.column) ||
        !isNonEmptyString(join.semanticKey) || !isNonEmptyString(join.evidenceNote)) {
      blockers.push(prefix + 'PAYOUT_JOIN_UNPROVEN');
    } else {
      payoutJoinSemantics.set(entry.role, join.semanticKey.trim());
    }
  }
  for (const role of PAYOUT_BREAKDOWN_ROLES) {
    if (!seen.has(role)) blockers.push('MISSING:' + role);
  }
  if (payoutJoinSemantics.size === PAYOUT_BREAKDOWN_ROLES.length &&
      new Set(payoutJoinSemantics.values()).size !== 1) {
    blockers.push('PAYOUT_JOIN_SEMANTICS_MISMATCH');
  }
  return {
    state: blockers.length ? 'INSUFFICIENT_EVIDENCE' : 'READY_FOR_MANUAL_SCHEMA_REVIEW',
    blockers,
    // Always false: a metadata-only gate cannot verify real CSV compatibility.
    realCsvCompatibilityVerified: false
  };
}
