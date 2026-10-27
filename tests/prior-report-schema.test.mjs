import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, objectRows, parseCSV, priorIdSet, reportCSV, stringifyCSV} from '../src/core.mjs';

const mapping = {id:'予約ID', date:'決済日', amount:'決済金額', status:'決済状況'};
const source = [
  '予約ID,決済日,決済金額,決済状況',
  'WAIT-001,2026/10/01,1200,未決済',
  'PAID-002,2026/10/01,1300,決済済'
].join('\n');
const report = reportCSV(analyze(objectRows(source).rows, mapping));

test('unaltered validation report matches candidates only', () => {
  assert.deepEqual([...priorIdSet(report, '取引ID')], ['PAID-002']);
});

test('adding a notes column to a validation report must not count review rows as exported', () => {
  const rows = parseCSV(report);
  rows.forEach((row, index) => row.push(index === 0 ? 'メモ' : '手動編集'));
  assert.throws(() => priorIdSet(stringifyCSV(rows), '取引ID'), /検査レポート形式が変更/);
});

test('reordering validation report columns must not downgrade to generic source CSV', () => {
  const rows = parseCSV(report);
  for (const row of rows) [row[0], row[1]] = [row[1], row[0]];
  assert.throws(() => priorIdSet(stringifyCSV(rows), '取引ID'), /検査レポート形式が変更/);
});

test('renaming the verdict column must not silently include unpaid review rows', () => {
  const rows = parseCSV(report);
  rows[0][6] = '判定結果';
  assert.throws(() => priorIdSet(stringifyCSV(rows), '取引ID'), /検査レポート形式が変更/);
});

test('renamed transaction-ID header in a prior report is rejected instead of marking unpaid rows as exported', () => {
  const rows = parseCSV(report);
  rows[0][1] = '予約ID';
  // Previously this was treated as a generic CSV and returned both WAIT-001 and PAID-002.
  assert.throws(() => priorIdSet(stringifyCSV(rows), '予約ID'), /検査レポート形式が変更/);
});

test('renaming the ID and verdict headers together still rejects a recognizable report', () => {
  const rows = parseCSV(report);
  rows[0][1] = '予約ID';
  rows[0][6] = '判定結果';
  assert.throws(() => priorIdSet(stringifyCSV(rows), '予約ID'), /検査レポート形式が変更/);
});

test('renaming the ID and original-line headers together still rejects a recognizable report', () => {
  const rows = parseCSV(report);
  rows[0][1] = '予約ID';
  rows[0][0] = '元行番号';
  assert.throws(() => priorIdSet(stringifyCSV(rows), '予約ID'), /検査レポート形式が変更/);
});

test('ordinary source CSV with similar financial fields remains valid for exact ID matching', () => {
  const csv = '予約ID,取引日,金額,支払状況,予約状況,理由\nA-1,2026/10/01,1200,決済済,確定,通常\n';
  assert.deepEqual([...priorIdSet(csv, '予約ID')], ['A-1']);
});

test('ordinary transaction CSVs remain supported for exact ID matching', () => {
  assert.deepEqual([...priorIdSet('取引ID,備考\nA-1,通常\nA-2,通常\n', '取引ID')], ['A-1', 'A-2']);
});
