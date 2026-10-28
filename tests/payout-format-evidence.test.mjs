import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPayoutFormatEvidence, PAYOUT_BREAKDOWN_ROLES} from '../src/payout-format-evidence.mjs';

const sample = role => ({
  role, product: 'STORES予約', exportSurface: 'payout_history',
  sourceKind: 'official_public_sample', sourceUrl: 'https://example.org/official-public-sample.csv',
  observedAt: '2026-10-29', fileFormat: 'csv',
  headers: ['payout_reference', 'transaction_id', 'amount'],
  identifierColumns: ['payout_reference', 'transaction_id'], rowGrain: 'payment'
});
const both = () => PAYOUT_BREAKDOWN_ROLES.map(sample);
const check = entries => assessPayoutFormatEvidence(entries);

test('synthetic complete metadata still requires manual schema review, never verifies real CSV', () => {
  assert.deepEqual(check(both()), {
    state: 'READY_FOR_MANUAL_SCHEMA_REVIEW', blockers: [], realCsvCompatibilityVerified: false
  });
});

test('historical user CSV claim cannot substitute for current payout breakdowns', () => {
  const entries = both();
  entries[0].sourceKind = 'historical_user_report';
  assert.ok(check(entries).blockers.includes('payout_reservations:SOURCE_NOT_VERIFIABLE'));
});

test('reservation list, analytics, and purchase-history exports cannot substitute for payout history', () => {
  for (const surface of ['reservation_list', 'analytics_report', 'customer_purchase_history', 'shop_order_csv']) {
    const entries = both();
    entries[0].exportSurface = surface;
    assert.ok(check(entries).blockers.includes('payout_reservations:WRONG_EXPORT_SURFACE'));
  }
});

test('one breakdown alone is insufficient even with complete headers', () => {
  assert.ok(check([sample('payout_reservations')]).blockers.includes('MISSING:payout_passes_subscriptions'));
});

test('unknown format, missing headers, identifiers, grain, and date all block', () => {
  const entries = both();
  Object.assign(entries[1], {fileFormat:'xlsx', headers:[], identifierColumns:[], rowGrain:'', observedAt:'2026-02-30'});
  const b = check(entries).blockers;
  for (const suffix of ['CSV_FORMAT_UNCONFIRMED', 'REAL_HEADERS_UNCONFIRMED',
    'IDENTIFIER_COLUMNS_UNCONFIRMED', 'ROW_GRAIN_UNCONFIRMED', 'OBSERVATION_DATE_MISSING']) {
    assert.ok(b.includes('payout_passes_subscriptions:' + suffix));
  }
});

test('permissioned sample must be explicitly authorized; no personal data required', () => {
  const entries = both();
  entries[0].sourceKind = 'permissioned_anonymized_sample';
  entries[0].sourceUrl = undefined;
  assert.ok(check(entries).blockers.includes('payout_reservations:PERMISSION_NOT_CONFIRMED'));
  entries[0].permissionConfirmed = true;
  assert.equal(check(entries).state, 'READY_FOR_MANUAL_SCHEMA_REVIEW');
});

test('duplicate role, unknown role, and missing official URL are rejected', () => {
  const entries = both();
  entries.push(sample('payout_reservations'));
  entries[0].sourceUrl = 'http://example.org/not-verified.csv';
  entries.push({...sample('unrelated'), role: 'unknown'});
  const b = check(entries).blockers;
  assert.ok(b.includes('DUPLICATE_ROLE:payout_reservations'));
  assert.ok(b.includes('INVALID_ROLE:3'));
  assert.ok(b.includes('payout_reservations:OFFICIAL_SAMPLE_URL_MISSING'));
});

test('empty input and invalid type fail closed', () => {
  assert.deepEqual(check([]).blockers, PAYOUT_BREAKDOWN_ROLES.map(role => 'MISSING:' + role));
  assert.throws(() => check(null), /配列/);
});
