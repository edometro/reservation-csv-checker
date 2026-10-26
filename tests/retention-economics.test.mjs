import test from 'node:test';
import assert from 'node:assert/strict';
import {
  replacementCustomersNeeded, acquisitionBudget, monthlyProfitAfterReplacement
} from '../src/retention-economics.mjs';

const assumptions = {
  monthlyPriceYen: 2980, variableCostYen: 300, fixedCostYen: 10000,
  monthlyChurnBps: 500, acquisitionCostYen: 5000
};

test('5% monthly churn requires three whole-customer replacements for 42 or 47 active users', () => {
  assert.equal(replacementCustomersNeeded({activeCustomers: 42, monthlyChurnBps: 500}), 3);
  assert.equal(replacementCustomersNeeded({activeCustomers: 47, monthlyChurnBps: 500}), 3);
  assert.equal(replacementCustomersNeeded({activeCustomers: 40, monthlyChurnBps: 500}), 2);
  assert.equal(replacementCustomersNeeded({activeCustomers: 1, monthlyChurnBps: 1}), 1);
  assert.equal(replacementCustomersNeeded({activeCustomers: 0, monthlyChurnBps: 10000}), 0);
  assert.equal(replacementCustomersNeeded({activeCustomers: 42, monthlyChurnBps: 0}), 0);
  assert.equal(replacementCustomersNeeded({activeCustomers: 42, monthlyChurnBps: 10000}), 42);
});

test('CAC and churn can invalidate the earlier 42-customer profit target', () => {
  assert.equal(monthlyProfitAfterReplacement({activeCustomers: 42, ...assumptions}), 87560);
  assert.equal(monthlyProfitAfterReplacement({activeCustomers: 46, ...assumptions}), 98280);
  assert.equal(monthlyProfitAfterReplacement({activeCustomers: 47, ...assumptions}), 100960);
  assert.equal(monthlyProfitAfterReplacement({
    activeCustomers: 42, ...assumptions, monthlyChurnBps: 0
  }), 102560);
  assert.equal(monthlyProfitAfterReplacement({activeCustomers: 0, ...assumptions}), -10000);
});

test('upfront acquisition budget is separate from recurring replacement costs', () => {
  assert.equal(acquisitionBudget({newCustomers: 42, acquisitionCostYen: 5000}), 210000);
  assert.equal(acquisitionBudget({newCustomers: 0, acquisitionCostYen: 5000}), 0);
  assert.equal(acquisitionBudget({newCustomers: 47, acquisitionCostYen: 5000}), 235000);
});

test('invalid financial inputs and churn rates fail closed', () => {
  assert.throws(() => replacementCustomersNeeded({activeCustomers: 10, monthlyChurnBps: 10001}), /10000以下/);
  assert.throws(() => replacementCustomersNeeded({activeCustomers: 10, monthlyChurnBps: 12.5}), /安全な整数/);
  assert.throws(() => replacementCustomersNeeded({activeCustomers: -1, monthlyChurnBps: 500}), /安全な整数/);
  assert.throws(() => acquisitionBudget({newCustomers: 1, acquisitionCostYen: -1}), /安全な整数/);
  assert.throws(() => monthlyProfitAfterReplacement({
    activeCustomers: 42, ...assumptions, acquisitionCostYen: NaN
  }), /安全な整数/);
  assert.throws(() => monthlyProfitAfterReplacement({
    activeCustomers: Number.MAX_SAFE_INTEGER, ...assumptions,
    monthlyPriceYen: Number.MAX_SAFE_INTEGER
  }), /安全な整数範囲/);
  assert.throws(() => acquisitionBudget({
    newCustomers: Number.MAX_SAFE_INTEGER, acquisitionCostYen: 2
  }), /安全な整数範囲/);
});
