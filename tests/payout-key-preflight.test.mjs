import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectPayoutKeyCandidates } from '../src/payout-key-preflight.mjs';

async function withFiles(a, b, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'payout-keys-'));
  try {
    const first = join(dir, 'a.csv'), second = join(dir, 'b.csv');
    await writeFile(first, a); await writeFile(second, b);
    return await fn(first, second, dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const a = '振込番号,予約,金額\nA,SECRET_PERSON_A,100\nB,SECRET_PERSON_B,200\nA,SECRET_PERSON_C,300\n';
const b = '\ufeff"振込,番号",内訳,金額\r\nA,"SECRET\nMEMBER",40\r\nB,SECRET_MEMBER_B,80\r\n';

test('two distinct shared payout keys are observed without exposing row data or identifiers', async () => {
  await withFiles(a, b, async (first, second, dir) => {
    const r = await inspectPayoutKeyCandidates(first, second, '振込番号', '振込,番号');
    assert.equal(r.state, 'TWO_SHARED_KEYS_OBSERVED_MANUAL_REVIEW_REQUIRED');
    assert.equal(r.sharedKeyCount, 2);
    assert.equal(r.reservations.rowCount, 3);
    assert.equal(r.reservations.distinctKeyCount, 2);
    assert.equal(r.keySemanticsVerified, false);
    assert.equal(r.crossPayoutMisjoinRejected, false);
    assert.equal(r.realCsvCompatibilityVerified, false);
    assert.equal(JSON.stringify(r).includes('SECRET'), false);
    assert.equal(JSON.stringify(r).includes(dir), false);
  });
});

test('one shared payout key is not accepted as two-payout evidence', async () => {
  await withFiles(a, '振込番号,内訳\nA,SECRET\nC,SECRET\n', async (x, y) => {
    const r = await inspectPayoutKeyCandidates(x, y, '振込番号', '振込番号');
    assert.equal(r.state, 'INSUFFICIENT_SHARED_KEYS');
    assert.equal(r.sharedKeyCount, 1);
    assert.equal(r.onlyReservationsKeyCount, 1);
    assert.equal(r.onlyPassesSubscriptionsKeyCount, 1);
  });
});

test('same column names with different payout keys do not pass', async () => {
  await withFiles(a, '振込番号,内訳\nX,SECRET\nY,SECRET\n', async (x, y) => {
    assert.equal((await inspectPayoutKeyCandidates(x, y, '振込番号', '振込番号')).sharedKeyCount, 0);
  });
});

test('missing columns, blank keys, malformed rows and duplicates fail closed', async () => {
  await withFiles(a, b, async (x, y) => {
    await assert.rejects(() => inspectPayoutKeyCandidates(x, y, 'nonexistent', '振込,番号'), { code: 'KEY_COLUMN_NOT_FOUND' });
    await assert.rejects(() => inspectPayoutKeyCandidates(x, x, '振込番号', '振込番号'), { code: 'TWO_DISTINCT_FILES_REQUIRED' });
  });
  await withFiles(a, a, async (x, y) => {
    await assert.rejects(() => inspectPayoutKeyCandidates(x, y, '振込番号', '振込番号'), { code: 'DUPLICATE_EXPORT_CONTENT' });
  });
  await withFiles(a, '振込番号,内訳\n,SECRET\n', async (x, y) => {
    await assert.rejects(() => inspectPayoutKeyCandidates(x, y, '振込番号', '振込番号'), { code: 'EMPTY_PAYOUT_KEY' });
  });
  await withFiles(a, '振込番号,内訳\nA,SECRET,EXTRA\n', async (x, y) => {
    await assert.rejects(() => inspectPayoutKeyCandidates(x, y, '振込番号', '振込番号'), { code: 'ROW_WIDTH_MISMATCH' });
  });
});

test('reordered rows and different line endings or BOM cannot masquerade as two exports', async () => {
  const reordered = '振込番号,予約,金額\\nA,SECRET_PERSON_C,300\\nB,SECRET_PERSON_B,200\\nA,SECRET_PERSON_A,100\\n'.replace(/\\n/g, '\n');
  await withFiles(a, reordered, async (x, y) => {
    await assert.rejects(() => inspectPayoutKeyCandidates(x, y, '振込番号', '振込番号'), { code: 'DUPLICATE_EXPORT_CONTENT' });
  });
  await withFiles(a, '\ufeff' + a.replace(/\n/g, '\r\n'), async (x, y) => {
    await assert.rejects(() => inspectPayoutKeyCandidates(x, y, '振込番号', '振込番号'), { code: 'DUPLICATE_EXPORT_CONTENT' });
  });
});

test('reordered columns of the same export are not independent breakdowns', async () => {
  const columnsReordered = '金額,予約,振込番号\n100,SECRET_PERSON_A,A\n200,SECRET_PERSON_B,B\n300,SECRET_PERSON_C,A\n';
  await withFiles(a, columnsReordered, async (x, y) => {
    await assert.rejects(() => inspectPayoutKeyCandidates(x, y, '振込番号', '振込番号'), { code: 'DUPLICATE_EXPORT_CONTENT' });
  });
});

test('symlink source is refused', async () => {
  await withFiles(a, b, async (x, y, dir) => {
    const alias = join(dir, 'alias.csv');
    await symlink(x, alias);
    await assert.rejects(() => inspectPayoutKeyCandidates(alias, y, '振込番号', '振込,番号'), { code: 'UNSAFE_FILE_TYPE' });
  });
});
