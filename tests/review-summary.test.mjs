import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, objectRows, parseCSV, summarizeAnalysis} from '../src/core.mjs';
import {summarizeReviewReasons, reviewReasonsCSV} from '../src/review-summary.mjs';

const mapping = {id:'予約ID', date:'決済日', amount:'金額', status:'支払状況'};

test('review reasons show counts and amounts without double-counting within a reason', () => {
  const rows = objectRows([
    '予約ID,決済日,金額,支払状況',
    'OK,2026/10/01,1200,決済済',
    'WAIT,2026/10/02,3000,未決済',
    'DUP,2026/10/03,500,未決済',
    'DUP,2026/10/03,500,未決済',
    'BAD,2026/10/04,不明,未決済'
  ].join('\n')).rows;
  const findings = analyze(rows, mapping);
  const reasons = summarizeReviewReasons(findings);
  const byReason = new Map(reasons.map(item => [item.reason, item]));
  assert.deepEqual(
    {candidate:summarizeAnalysis(findings).candidateYen, review:summarizeAnalysis(findings).reviewYen},
    {candidate:1200n, review:4000n}
  );
  assert.deepEqual(byReason.get('キャンセル・返金・未決済等の確認が必要'), {
    reason:'キャンセル・返金・未決済等の確認が必要',
    count:4, amountYen:4000n, unknownAmountCount:1
  });
  assert.deepEqual(byReason.get('ファイル内の取引ID重複'), {
    reason:'ファイル内の取引ID重複',
    count:2, amountYen:1000n, unknownAmountCount:0
  });
  assert.equal(byReason.get('金額形式エラーまたは0円').unknownAmountCount, 1);
  assert.equal(reasons[0].count, 4);
  // 4000 + 1000 exceeds the actual 4000 review amount: categories overlap.
  assert.ok(reasons.reduce((sum, item) => sum + item.amountYen, 0n) > 4000n);
});

test('review summary CSV has no individual IDs and is safe to open in spreadsheets', () => {
  const csv = reviewReasonsCSV([
    {ready:false, amount:500, flags:['=SUM(1,1)', '=SUM(1,1)'], id:'PRIVATE-ID'},
    {ready:false, amount:null, flags:['@HYPERLINK(1)'], id:'PRIVATE-OTHER'},
    {ready:true, amount:900, flags:[], id:'PRIVATE-PAID'}
  ]);
  const parsed = parseCSV(csv);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].length, 4);
  assert.deepEqual(parsed[1], ["'=SUM(1,1)", '1', '500', '0']);
  assert.deepEqual(parsed[2], ["'@HYPERLINK(1)", '1', '0', '1']);
  assert.doesNotMatch(csv, /PRIVATE-/);
});

test('empty and missing-reason review results are handled explicitly', () => {
  assert.deepEqual(summarizeReviewReasons([]), []);
  assert.equal(parseCSV(reviewReasonsCSV([])).length, 1);
  const [fallback] = summarizeReviewReasons([{ready:false, amount:100, flags:[]}]);
  assert.equal(fallback.count, 1);
  assert.match(fallback.reason, /理由が未設定/);
});

test('review reason totals use BigInt for large safe integer amounts', () => {
  const max = Number.MAX_SAFE_INTEGER;
  const [entry] = summarizeReviewReasons([
    {ready:false, amount:max, flags:['要確認']},
    {ready:false, amount:max, flags:['要確認']}
  ]);
  assert.equal(entry.amountYen, BigInt(max) * 2n);
  assert.equal(parseCSV(reviewReasonsCSV([{ready:false, amount:max, flags:['要確認']}]))[1][2], String(max));
});
