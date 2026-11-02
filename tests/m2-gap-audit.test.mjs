import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {buildM2GapAudit} from '../src/m2-gap-audit.mjs';

const registry = JSON.parse(await readFile(new URL('../docs/demand-evidence.json', import.meta.url), 'utf8'));

test('M2 report is consistent with the real registry and does not invent eligible users', () => {
  const report = buildM2GapAudit(registry);
  assert.equal(report.qualified, 1);
  assert.equal(report.missing, 4);
  assert.equal(report.targetMfMonthlyReconciliation, 0);
  assert.equal(report.sources.length, 7);
  assert.equal(report.sources.find(row => row.id === 'U001').qualified, true);
  assert.deepEqual(report.sources.find(row => row.id === 'U001').missingConditions, []);
  assert.deepEqual(report.sources.find(row => row.id === 'U002').missingConditions,
    ['SOURCE_PUBLICATION_PERIOD_UNVERIFIED']);
  const u3 = report.sources.find(row => row.id === 'U003');
  assert.ok(u3.missingConditions.includes('SOURCE_PUBLICATION_PERIOD_UNVERIFIED'));
  assert.ok(u3.missingConditions.includes('ACCOUNTING_SOFTWARE_USE_UNVERIFIED'));
  for (const id of ['U004', 'U005', 'U006', 'U007']) {
    const row = report.sources.find(row => row.id === id);
    assert.ok(row.missingConditions.includes('ACCOUNTING_SOFTWARE_USE_UNVERIFIED'));
    assert.ok(row.missingConditions.includes('INDEPENDENT_OPERATOR_UNVERIFIED'));
  }
});

test('M2 report does not count a second URL from the same operator', () => {
  const data = structuredClone(registry);
  const original = data.sources.find(source => source.id === 'U001');
  data.sources.push({...original, id: 'U999', url: 'https://example.org/synthetic-second-url'});
  const report = buildM2GapAudit(data);
  assert.equal(report.qualified, 1);
  assert.ok(report.sources.find(row => row.id === 'U999').missingConditions.includes('DUPLICATE_OPERATOR'));
});

test('M2 report never uses an interview month as the source publication period', () => {
  const data = structuredClone(registry);
  const source = data.sources.find(item => item.id === 'U002');
  source.interviewedAt = '2025-04';
  const row = buildM2GapAudit(data).sources.find(item => item.id === 'U002');
  assert.ok(row.missingConditions.includes('SOURCE_PUBLICATION_PERIOD_UNVERIFIED'));
  assert.equal(row.qualified, false);
});

test('M2 CLI prints machine-readable gap report without claiming five users', () => {
  const output = execFileSync(process.execPath, ['scripts/m2-gap-audit.mjs'], {encoding: 'utf8'});
  const report = JSON.parse(output);
  assert.equal(report.qualified, 1);
  assert.equal(report.missing, 4);
  assert.equal(report.sources.length, 7);
});


test('M2: spreadsheet and CSV-only users are not accounting-software evidence', () => {
  const baseline = buildM2GapAudit(registry);
  const original = registry.sources.find(source => source.id === 'U001');
  for (const [index, label] of ['Excel', 'Google Sheets', 'Google スプレッドシート', 'Numbers', 'CSV', '手書き帳簿'].entries()) {
    const data = structuredClone(registry);
    data.sources.push({
      ...original,
      id: 'U900',
      url: 'https://example.org/synthetic-spreadsheet-' + index,
      operatorKey: 'synthetic-other-operator',
      accountingSoftware: label,
      accountingSoftwareUseEvidence: '本人が' + label + 'で月次の売上表を管理した合成例'
    });
    const report = buildM2GapAudit(data);
    assert.equal(report.qualified, baseline.qualified, label + ' must not increase M2');
    assert.equal(report.missing, baseline.missing);
    const candidate = report.sources.find(row => row.id === 'U900');
    assert.equal(candidate.qualified, false);
    assert.ok(candidate.missingConditions.includes('ACCOUNTING_SOFTWARE_USE_UNVERIFIED'));
  }
});
