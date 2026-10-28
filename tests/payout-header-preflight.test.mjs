import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePayoutHeader, inspectPayoutHeaders, MAX_HEADER_BYTES } from '../src/payout-header-preflight.mjs';

const parse = value => parsePayoutHeader(Buffer.from(value));

test('UTF-8 BOM, CRLF and quoted commas preserve the actual first-record columns', () => {
  const result = parse('\ufeff"入金,番号",金額,日時\r\nSECRET_CUSTOMER,100,2026-10-01');
  assert.deepEqual(result.headers, ['入金,番号', '金額', '日時']);
  assert.equal(result.columnCount, 3);
  assert.equal(JSON.stringify(result).includes('SECRET_CUSTOMER'), false);
});

test('quoted newlines and escaped double-quotes in a header are parsed', () => {
  assert.deepEqual(parse('"line\nname","quoted""field",amount\nprivate,1,2').headers,
    ['line\nname', 'quoted"field', 'amount']);
});

test('duplicate, empty, and malformed header labels are rejected', () => {
  assert.throws(() => parse('id,id\n1,2'), { code: 'DUPLICATE_COLUMN_NAMES' });
  assert.throws(() => parse('id,\n1,2'), { code: 'INVALID_COLUMN_NAME' });
  assert.throws(() => parse('"id"suffix,amount\n1,2'), { code: 'MALFORMED_CSV_HEADER' });
  assert.throws(() => parse('"id,amount'), { code: 'UNTERMINATED_QUOTED_HEADER' });
});

test('binary Excel, invalid UTF-8, and one-column files fail closed', () => {
  assert.throws(() => parsePayoutHeader(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])), { code: 'NON_CSV_OFFICE_FORMAT' });
  assert.throws(() => parsePayoutHeader(Buffer.from([0xff, 0xfe, 0x00, 0x00])), { code: 'NOT_UTF8' });
  assert.throws(() => parse('single\nvalue'), { code: 'TOO_FEW_COLUMNS' });
});

test('large unbroken headers are rejected', () => {
  assert.throws(() => parsePayoutHeader(Buffer.from('a,'.padEnd(MAX_HEADER_BYTES + 1, 'b'))), { code: 'HEADER_TOO_LARGE' });
});

test('two different synthetic files are read without exposing rows or granting compatibility', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'payout-preflight-'));
  try {
    const a = join(dir, 'reservations.csv');
    const b = join(dir, 'passes.csv');
    await writeFile(a, 'payout_ref,amount\nSENSITIVE_RESERVATION,100\n');
    await writeFile(b, 'payout_ref,amount\nSENSITIVE_SUBSCRIPTION,200\n');
    const report = await inspectPayoutHeaders(a, b);
    assert.equal(report.exports.length, 2);
    assert.equal(report.state, 'HEADERS_OBSERVED_MANUAL_REVIEW_REQUIRED');
    assert.equal(report.realCsvCompatibilityVerified, false);
    assert.equal(report.payoutJoinVerified, false);
    assert.equal(report.bankReconciliationVerified, false);
    assert.equal(report.mfImportVerified, false);
    assert.equal(JSON.stringify(report).includes('SENSITIVE_'), false);
    assert.equal(JSON.stringify(report).includes(dir), false);
    await assert.rejects(() => inspectPayoutHeaders(a, a), { code: 'TWO_DISTINCT_FILES_REQUIRED' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
