import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, objectRows, summarizeAnalysis} from '../src/core.mjs';

const mapping = {id:'予約ID',date:'決済日',amount:'決済金額',status:'決済状況'};

test('amount breakdown keeps unpaid, duplicate and invalid rows out of candidate total', () => {
  const csv = [
    '予約ID,決済日,決済金額,決済状況',
    'A1,2026/10/01,1200,決済済',
    'A2,2026/10/02,3000,未決済',
    'A3,2026/10/03,金額不明,決済済',
    'A4,2026/10/04,500,決済済',
    'A4,2026/10/04,500,決済済'
  ].join('\n');
  const summary = summarizeAnalysis(analyze(objectRows(csv).rows, mapping));
  assert.deepEqual(summary, {
    candidateCount:1, reviewCount:4, candidateYen:1200n,
    reviewYen:4000n, unknownAmountCount:1
  });
  assert.equal(summary.candidateYen.toLocaleString('ja-JP'), '1,200');
});

test('amount breakdown sums large individually safe yen values without rounding', () => {
  const csv = [
    '予約ID,決済日,決済金額,決済状況',
    'L1,2026/10/01,9007199254740991,決済済',
    'L2,2026/10/02,9007199254740991,決済済',
    'L3,2026/10/03,9007199254740991,未決済'
  ].join('\n');
  const summary = summarizeAnalysis(analyze(objectRows(csv).rows, mapping));
  assert.equal(summary.candidateYen, 18014398509481982n);
  assert.equal(summary.reviewYen, 9007199254740991n);
  assert.equal(summary.unknownAmountCount, 0);
});

test('empty analysis has zero totals and zero unknown amounts', () => {
  assert.deepEqual(summarizeAnalysis([]), {
    candidateCount:0, reviewCount:0, candidateYen:0n, reviewYen:0n,
    unknownAmountCount:0
  });
});
