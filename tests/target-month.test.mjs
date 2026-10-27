import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, ledgerCSV, objectRows, parseCSV, stringifyCSV} from '../src/core.mjs';
import {auditJournalCSV} from '../src/journal-audit.mjs';

const mapping = {id:'予約ID', date:'決済日', amount:'金額', status:'支払状況'};
const csv = [
  '予約ID,決済日,金額,支払状況',
  'A1,2026/09/30,1000,決済済',
  'A2,2026/10/01,1100,決済済',
  'A3,2026/10/31,1200,決済済',
  'A4,2026/11/01,1300,決済済'
].join('\n');
const journal = ledgerCSV(analyze(objectRows(csv).rows, mapping), '普通預金', '売上高', true);

test('selected accounting month blocks previous/next months at inclusive boundaries', () => {
  const audit = auditJournalCSV(journal, {targetMonth:'2026-10'});
  assert.equal(audit.rowCount, 4);
  assert.equal(audit.errors.length, 2);
  assert.match(audit.errors.join(' / '), /2行目: 取引日が指定した対象月（2026-10）の範囲外/);
  assert.match(audit.errors.join(' / '), /5行目: 取引日が指定した対象月（2026-10）の範囲外/);
  const rows = parseCSV(journal);
  assert.deepEqual(auditJournalCSV(stringifyCSV([rows[0], rows[2], rows[3]]), {
    targetMonth:'2026-10'
  }).errors, []);
});

test('invalid accounting month is rejected rather than disabling the guard', () => {
  for (const month of ['2026-00', '2026-13', '2026-1', '2026/10', '2026-10-01', ' 2026-10 ', null, 202610]) {
    assert.match(auditJournalCSV(journal, {targetMonth:month}).errors.join(' / '),
      /対象月はYYYY-MM形式/, String(month));
  }
  assert.deepEqual(auditJournalCSV(journal, {targetMonth:''}), auditJournalCSV(journal));
});

test('month and fiscal year guards both apply; valid fiscal year alone does not allow another month', () => {
  const audit = auditJournalCSV(journal, {
    fiscalYearStart:'2026-10-01', fiscalYearEnd:'2027-09-30', targetMonth:'2026-10'
  });
  assert.match(audit.errors.join(' / '), /会計年度/);
  assert.match(audit.errors.join(' / '), /対象月/);
  const rows = parseCSV(journal);
  assert.deepEqual(auditJournalCSV(stringifyCSV([rows[0], rows[2], rows[3]]), {
    fiscalYearStart:'2026-10-01', fiscalYearEnd:'2027-09-30', targetMonth:'2026-10'
  }).errors, []);
});

test('out-of-month diagnostics use physical line numbers after quoted multiline descriptions', () => {
  const rows = parseCSV(journal);
  rows[1][18] = '予約 A1\n追記';
  const audit = auditJournalCSV(stringifyCSV(rows), {targetMonth:'2026-10'});
  assert.match(audit.errors.join(' / '), /2行目: 取引日が指定した対象月/);
  assert.match(audit.errors.join(' / '), /6行目: 取引日が指定した対象月/);
});

test('month guard does not silently normalize invalid journal dates', () => {
  const rows = parseCSV(journal);
  rows[2][1] = '2026/10/32';
  const audit = auditJournalCSV(stringifyCSV(rows), {targetMonth:'2026-10'});
  assert.match(audit.errors.join(' / '), /3行目: 取引日がyyyy\/MM\/dd形式ではありません/);
});
