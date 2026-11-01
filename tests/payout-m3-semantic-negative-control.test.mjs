import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectPayoutHeaders } from '../src/payout-header-preflight.mjs';
import { inspectPayoutKeyCandidates } from '../src/payout-key-preflight.mjs';

// Synthetic negative control for M3: matching strings in both exports cannot
// establish payout-key semantics or reject an A/B cross-payout misjoin.
// These files are NOT STORES exports and contain no real customer data.
test('M3: two matching candidate keys remain insufficient when A/B row semantics are swapped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'm3-semantic-negative-'));
  try {
    const reservations = join(dir, 'reservations.csv');
    const passes = join(dir, 'passes.csv');
    await writeFile(reservations,
      '候補キー,予約識別子,合成金額\nPAY-A,PRIVATE_SYNTHETIC_R_A,1000\nPAY-B,PRIVATE_SYNTHETIC_R_B,2000\n');
    // Both candidate keys occur, but their corresponding A/B business
    // meanings are deliberately reversed. The CLI cannot observe this.
    await writeFile(passes,
      '候補キー,月謝識別子,合成金額\nPAY-A,PRIVATE_SYNTHETIC_M_B,8000\nPAY-B,PRIVATE_SYNTHETIC_M_A,4000\n');

    const headerReport = await inspectPayoutHeaders(reservations, passes);
    const keyReport = await inspectPayoutKeyCandidates(reservations, passes, '候補キー', '候補キー');

    assert.equal(headerReport.state, 'HEADERS_OBSERVED_MANUAL_REVIEW_REQUIRED');
    assert.equal(headerReport.realCsvCompatibilityVerified, false);
    assert.equal(keyReport.sharedKeyCount, 2);
    assert.equal(keyReport.state, 'TWO_SHARED_KEYS_OBSERVED_MANUAL_REVIEW_REQUIRED');
    assert.equal(keyReport.keySemanticsVerified, false);
    assert.equal(keyReport.crossPayoutMisjoinRejected, false);
    assert.equal(keyReport.bankReconciliationVerified, false);
    assert.equal(keyReport.mfImportVerified, false);
    assert.equal(keyReport.realCsvCompatibilityVerified, false);
    const publicReport = JSON.stringify({ headerReport, keyReport });
    assert.equal(publicReport.includes('PRIVATE_SYNTHETIC_'), false);
    assert.equal(publicReport.includes(dir), false);
    assert.equal(publicReport.includes('PAY-A'), false);
    assert.equal(publicReport.includes('PAY-B'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
