import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessPayoutSourceCoverage,
  REQUIRED_PAYOUT_SOURCES
} from '../src/payout-source-coverage.mjs';

const reference = 'synthetic-payout-2026-08-25';
const makeSource = role => ({role, payoutReference: reference, finalized: true});
const makeInput = () => ({
  payoutReference: reference,
  sources: REQUIRED_PAYOUT_SOURCES.map(makeSource),
  schemaVerified: false,
  linkageVerified: false
});

test('reservation-only CSV cannot substantiate a bank payout', () => {
  const result = assessPayoutSourceCoverage({
    ...makeInput(), sources: [makeSource('reservation_list')]
  });
  assert.equal(result.state, 'INSUFFICIENT_EVIDENCE');
  assert.deepEqual(result.blockers.slice(0, 3), REQUIRED_PAYOUT_SOURCES.map(r => 'MISSING:' + r));
});

test('missing pass/subscription payout breakdown blocks complete reconciliation', () => {
  const input = makeInput();
  input.sources = input.sources.filter(s => s.role !== 'payout_passes_subscriptions');
  const result = assessPayoutSourceCoverage(input);
  assert.ok(result.blockers.includes('MISSING:payout_passes_subscriptions'));
});

test('pending payout and unmatched bank reference are flagged separately', () => {
  const input = makeInput();
  input.sources[0].finalized = false;
  input.sources[2].payoutReference = 'different-payout';
  const result = assessPayoutSourceCoverage(input);
  assert.ok(result.blockers.includes('NOT_FINALIZED:payout_reservations'));
  assert.ok(result.blockers.includes('REFERENCE_MISMATCH:bank_deposit'));
});

test('both payout files alone cannot be claimed to match a bank deposit', () => {
  const input = makeInput();
  input.sources = input.sources.filter(s => s.role !== 'bank_deposit');
  input.schemaVerified = true;
  input.linkageVerified = true;
  assert.deepEqual(assessPayoutSourceCoverage(input).blockers, ['MISSING:bank_deposit']);
});

test('all sources present is insufficient without real schema and linkage evidence', () => {
  const result = assessPayoutSourceCoverage(makeInput());
  assert.deepEqual(result.blockers, [
    'REAL_CSV_SCHEMA_UNVERIFIED',
    'PAYOUT_TO_BANK_LINK_UNVERIFIED'
  ]);
  assert.equal(result.state, 'INSUFFICIENT_EVIDENCE');
});

test('only complete manually asserted evidence permits manual review, not auto-import', () => {
  const input = {...makeInput(), schemaVerified:true, linkageVerified:true};
  const result = assessPayoutSourceCoverage(input);
  assert.deepEqual(result, {state:'READY_FOR_MANUAL_REVIEW', blockers:[]});
});

test('duplicate and unknown source roles fail closed', () => {
  const input = makeInput();
  input.sources.push(makeSource('payout_reservations'));
  assert.throws(() => assessPayoutSourceCoverage(input), /同じ区分/);
  input.sources.pop();
  input.sources.push(makeSource('unrecognized'));
  assert.throws(() => assessPayoutSourceCoverage(input), /不正/);
});

test('invalid references and unverified status types are rejected', () => {
  const input = makeInput();
  input.payoutReference = '';
  assert.throws(() => assessPayoutSourceCoverage(input), /参照値/);
  input.payoutReference = reference;
  input.sources[0].finalized = 'yes';
  assert.throws(() => assessPayoutSourceCoverage(input), /不正/);
  input.sources[0].finalized = true;
  input.schemaVerified = 'yes';
  assert.throws(() => assessPayoutSourceCoverage(input), /真偽値/);
});
