import test from 'node:test';
import assert from 'node:assert/strict';
import {customersNeeded, projectedMonthlyProfit} from '../src/unit-economics.mjs';

test('monthly profit target requires rounding customer count upward',()=>{
  const base={targetProfitYen:100000,variableCostYen:300,fixedCostYen:10000};
  assert.equal(customersNeeded({...base,monthlyPriceYen:1980}),66);
  assert.equal(customersNeeded({...base,monthlyPriceYen:2980}),42);
  assert.equal(customersNeeded({...base,monthlyPriceYen:4980}),24);
  assert.equal(projectedMonthlyProfit({customers:41,monthlyPriceYen:2980,variableCostYen:300,fixedCostYen:10000}),99880);
  assert.equal(projectedMonthlyProfit({customers:42,monthlyPriceYen:2980,variableCostYen:300,fixedCostYen:10000}),102560);
});

test('zero or negative contribution margin is not a viable price',()=>{
  const base={targetProfitYen:100000,variableCostYen:300,fixedCostYen:10000};
  assert.equal(customersNeeded({...base,monthlyPriceYen:300}),null);
  assert.equal(customersNeeded({...base,monthlyPriceYen:299}),null);
  assert.equal(projectedMonthlyProfit({customers:20,monthlyPriceYen:200,variableCostYen:300,fixedCostYen:10000}),-12000);
});

test('exact integer division and zero target are handled',()=>{
  assert.equal(customersNeeded({targetProfitYen:100,fixedCostYen:0,monthlyPriceYen:50,variableCostYen:0}),2);
  assert.equal(customersNeeded({targetProfitYen:0,fixedCostYen:0,monthlyPriceYen:50,variableCostYen:0}),0);
  assert.equal(customersNeeded({targetProfitYen:1,fixedCostYen:0,monthlyPriceYen:50,variableCostYen:0}),1);
});

test('reject non-integer and invalid financial assumptions',()=>{
  const base={targetProfitYen:100000,monthlyPriceYen:2980,variableCostYen:300,fixedCostYen:10000};
  assert.throws(()=>customersNeeded({...base,monthlyPriceYen:2980.5}),/安全な整数/);
  assert.throws(()=>customersNeeded({...base,variableCostYen:-1}),/安全な整数/);
  assert.throws(()=>projectedMonthlyProfit({customers:NaN,monthlyPriceYen:2980,variableCostYen:300,fixedCostYen:10000}),/安全な整数/);
  assert.throws(()=>customersNeeded({...base,targetProfitYen:Number.MAX_SAFE_INTEGER}),/安全な整数範囲/);
});
