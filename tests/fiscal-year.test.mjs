import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze, ledgerCSV, objectRows, parseCSV, stringifyCSV} from '../src/core.mjs';
import {auditJournalCSV} from '../src/journal-audit.mjs';

const mapping = {id:'予約ID', date:'決済日', amount:'金額', status:'支払状況'};
const source = [
  '予約ID,決済日,金額,支払状況',
  'A1,2026/09/30,1000,決済済',
  'A2,2026/10/01,1100,決済済',
  'A3,2027/09/30,1200,決済済',
  'A4,2027/10/01,1300,決済済'
].join('\n');
const journal = ledgerCSV(analyze(objectRows(source).rows, mapping), '普通預金', '売上高', true);

test('optional fiscal-year range blocks only dates outside inclusive boundaries', () => {
  const audit = auditJournalCSV(journal, {fiscalYearStart:'2026-10-01', fiscalYearEnd:'2027-09-30'});
  assert.equal(audit.rowCount, 4);
  assert.equal(audit.errors.length, 2);
  assert.match(audit.errors.join(' / '), /2行目: 取引日が指定した会計年度/);
  assert.match(audit.errors.join(' / '), /5行目: 取引日が指定した会計年度/);
  assert.doesNotMatch(audit.errors.join(' / '), /3行目:|4行目:/);
  const rows = parseCSV(journal);
  assert.deepEqual(auditJournalCSV(stringifyCSV([rows[0], rows[2], rows[3]]), {
    fiscalYearStart:'2026-10-01', fiscalYearEnd:'2027-09-30'
  }).errors, []);
});

test('missing, malformed, impossible, and reversed accounting-year dates fail closed', () => {
  const options = [
    {fiscalYearStart:'2026-10-01'},
    {fiscalYearEnd:'2027-09-30'},
    {fiscalYearStart:'2026/10/01', fiscalYearEnd:'2027-09-30'},
    {fiscalYearStart:'2026-02-30', fiscalYearEnd:'2027-09-30'},
    {fiscalYearStart:'2027-10-01', fiscalYearEnd:'2026-09-30'}
  ];
  for (const option of options) {
    assert.ok(auditJournalCSV(journal, option).errors.some(error => error.includes('会計年度')), JSON.stringify(option));
  }
});

test('without accounting-year input, existing journal structural audit remains unchanged', () => {
  const baseline = auditJournalCSV(journal);
  assert.deepEqual(auditJournalCSV(journal, {}), baseline);
  assert.deepEqual(auditJournalCSV(journal, {fiscalYearStart:'', fiscalYearEnd:''}), baseline);
  assert.deepEqual(baseline.errors, []);
});

test('fiscal-year range is checked on physical CSV lines after quoted multiline fields', () => {
  const rows = parseCSV(journal);
  rows[1][18] = '予約 A1\n追記';
  const audit = auditJournalCSV(stringifyCSV(rows), {
    fiscalYearStart:'2026-10-01', fiscalYearEnd:'2027-09-30'
  });
  assert.match(audit.errors.join(' / '), /2行目: 取引日が指定した会計年度/);
  assert.match(audit.errors.join(' / '), /6行目: 取引日が指定した会計年度/);
});
