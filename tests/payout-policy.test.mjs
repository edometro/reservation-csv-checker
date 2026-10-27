import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPayoutFeeScenario as classify} from '../src/payout-policy.mjs';

const evaluate = (payoutAmountYen, transferUnderThreshold, transferDate='2026-10-27') =>
  classify({payoutAmountYen, transferUnderThreshold, transferDate});

test('default setting carries 9,999 yen forward with no transfer fee', () => {
  assert.deepEqual(evaluate(9999, false), {
    status: 'CARRIED_OVER', transferFeeYen: 0, adminFeeYen: 0, totalFeesYen: 0
  });
});

test('opt-in under-threshold transfer incurs both documented fees', () => {
  assert.deepEqual(evaluate(9999, true), {
    status: 'FEE_SCENARIO', transferFeeYen: 275, adminFeeYen: 275, totalFeesYen: 550
  });
});

test('10,000 yen is not below threshold regardless of preference', () => {
  for (const flag of [true, false]) {
    assert.deepEqual(evaluate(10000, flag), {
      status: 'FEE_SCENARIO', transferFeeYen: 275, adminFeeYen: 0, totalFeesYen: 275
    });
  }
});

test('transfer-date cutoff is inclusive, not based on sales date', () => {
  assert.equal(evaluate(10000, false, '2026-08-24').status, 'OUT_OF_SCOPE');
  assert.equal(evaluate(10000, false, '2026-08-25').totalFeesYen, 275);
});

test('zero yen is unknown rather than pretending to pay a negative balance', () => {
  assert.deepEqual(evaluate(0, true), {
    status: 'REQUIRES_CONFIRMATION', transferFeeYen: null,
    adminFeeYen: null, totalFeesYen: null
  });
});

test('amount not exceeding the fee is not treated as a confirmed transfer', () => {
  for (const amount of [1, 274, 275, 549, 550]) {
    assert.equal(evaluate(amount, true).status, 'REQUIRES_CONFIRMATION');
    assert.equal(evaluate(amount, false).status, 'CARRIED_OVER');
  }
  assert.equal(evaluate(551, true).totalFeesYen, 550);
});

test('invalid dates, amounts and unknown payout preference are rejected', () => {
  for (const date of ['2026-02-30', '2026-8-25', '', 'not-a-date']) {
    assert.throws(() => evaluate(10000, false, date), /振込日/);
  }
  for (const amount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
    assert.throws(() => evaluate(amount, false), /入金対象額/);
  }
  assert.throws(() => classify({transferDate:'2026-10-27', payoutAmountYen:10000,
    transferUnderThreshold:'false'}), /振込設定/);
});
