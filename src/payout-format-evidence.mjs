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


/**
 * M3 two-payout discrimination gate. Labels A/B are local, non-sensitive
 * audit labels, never transaction IDs or payout amounts. This only checks
 * that an auditable observation was *claimed*; human review of the source
 * and actual matching is still required.
 */
export function assessPayoutJoinDiscrimination(evidence) {
  const blockers = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return {state: 'INSUFFICIENT_EVIDENCE', blockers: ['JOIN_OBSERVATION_MISSING']};
  }
  if (!Number.isSafeInteger(evidence.distinctPayoutsObserved) ||
      evidence.distinctPayoutsObserved < 2) {
    blockers.push('TWO_DISTINCT_PAYOUTS_NOT_OBSERVED');
  }
  if (!Array.isArray(evidence.checks) || evidence.checks.length !== 2 ||
      new Set(evidence.checks.map(check => check?.payoutLabel)).size !== 2 ||
      !['A', 'B'].every(label => evidence.checks.some(check => check?.payoutLabel === label))) {
    blockers.push('A_B_OBSERVATIONS_MISSING_OR_DUPLICATE');
  } else {
    for (const check of evidence.checks) {
      const prefix = check.payoutLabel + ':';
      if (check.reservationsPresent !== true || check.passesAndSubscriptionsPresent !== true) {
        blockers.push(prefix + 'BOTH_BREAKDOWNS_NOT_OBSERVED');
      }
      if (check.withinPayoutMatchVerified !== true) blockers.push(prefix + 'POSITIVE_MATCH_UNVERIFIED');
      if (check.otherPayoutMismatchVerified !== true) blockers.push(prefix + 'CROSS_PAYOUT_NEGATIVE_UNVERIFIED');
      if (!isNonEmptyString(check.evidenceRef)) blockers.push(prefix + 'AUDIT_REFERENCE_MISSING');
    }
  }
  if (!isNonEmptyString(evidence.keyMeaningEvidenceRef)) blockers.push('KEY_MEANING_AUDIT_MISSING');
  return {
    state: blockers.length ? 'INSUFFICIENT_EVIDENCE' : 'READY_FOR_MANUAL_JOIN_REVIEW',
    blockers
  };
}
