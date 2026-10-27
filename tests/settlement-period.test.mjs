import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMonthlySettlementPeriod as classify} from '../src/settlement-period.mjs';

const monthly = paymentTimestamp => classify({paymentTimestamp, payoutCycle:'monthly'});

test('official example: August 1 01:00 JST belongs to July UTC bucket and nominal August payout', () => {
  assert.deepEqual(monthly('2026-08-01T01:00:00+09:00'), {
    status:'MONTHLY_PERIOD_ONLY', settlementMonthUTC:'2026-07', nominalPayoutMonth:'2026-08'
  });
});

test('official example: August 1 10:00 JST belongs to August UTC bucket and nominal September payout', () => {
  assert.deepEqual(monthly('2026-08-01T10:00:00+09:00'), {
    status:'MONTHLY_PERIOD_ONLY', settlementMonthUTC:'2026-08', nominalPayoutMonth:'2026-09'
  });
});

test('JST 08:59:59 / 09:00:00 is the UTC calendar-month boundary', () => {
  assert.equal(monthly('2026-08-01T08:59:59+09:00').settlementMonthUTC, '2026-07');
  assert.equal(monthly('2026-08-01T09:00:00+09:00').settlementMonthUTC, '2026-08');
});

test('year rollover and different explicit timezone representations are consistent', () => {
  const a = monthly('2027-01-01T08:59:59+09:00');
  const b = monthly('2026-12-31T23:59:59Z');
  assert.deepEqual(a, b);
  assert.equal(a.settlementMonthUTC, '2026-12');
  assert.equal(a.nominalPayoutMonth, '2027-01');
  assert.equal(monthly('2027-01-01T09:00:00+09:00').nominalPayoutMonth, '2027-02');
});

test('UTC offset is applied rather than assuming input is already JST', () => {
  const a = monthly('2026-07-31T16:00:00Z');
  const b = monthly('2026-08-01T01:00:00+09:00');
  const c = monthly('2026-07-31T12:00:00-04:00');
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

test('weekly payouts are not inferred from a monthly formula', () => {
  assert.deepEqual(classify({
    paymentTimestamp:'2026-08-01T01:00:00+09:00', payoutCycle:'weekly'
  }), {status:'REQUIRES_CONFIRMATION', settlementMonthUTC:null, nominalPayoutMonth:null});
  assert.throws(() => classify({
    paymentTimestamp:'2026-08-01T01:00:00+09:00', payoutCycle:'unknown'
  }), /入金サイクル/);
});

test('timestamps without explicit timezone and invalid calendar times are rejected', () => {
  for (const value of [
    '2026-08-01', '2026-08-01 01:00:00', '2026-08-01T01:00:00',
    '2026-02-30T01:00:00+09:00', '2026-08-01T24:00:00+09:00',
    '2026-08-01T01:60:00+09:00', '2026-08-01T01:00:60+09:00',
    '2026-08-01T01:00:00+15:00', '2026-08-01T01:00:00+14:30',
    '2026-08-01T01:00:00+09:60', null, 0
  ]) {
    assert.throws(() => monthly(value), /決済日時|タイムゾーン/, String(value));
  }
});

test('leap day and milliseconds are handled without rounding into the next month', () => {
  assert.equal(monthly('2028-03-01T08:59:59.999+09:00').settlementMonthUTC, '2028-02');
  assert.equal(monthly('2028-03-01T09:00:00.000+09:00').settlementMonthUTC, '2028-03');
  assert.throws(() => monthly('2027-02-29T23:00:00Z'), /決済日時/);
});
