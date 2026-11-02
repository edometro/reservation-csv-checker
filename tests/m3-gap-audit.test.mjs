import test from 'node:test';
import assert from 'node:assert/strict';
import {buildM3GapAudit} from '../src/m3-gap-audit.mjs';

const ledger = {
  milestones: [{id: 'M3', dueDate: '2026-11-03', status: 'blocked'}],
  m3Verification: {
    reservations: {provenanceVerified: false, csvFormatVerified: false, actualHeadersVerified: false, evidenceRef: null},
    passesAndSubscriptions: {provenanceVerified: false, csvFormatVerified: false, actualHeadersVerified: false, evidenceRef: null},
    commonPayoutKeyVerified: false, commonPayoutKeyEvidenceRef: null,
    acceptanceCriteriaDocumented: true, formatEvidence: []
  }
};

test('M3の未取得2内訳と共通キー・A/B正負例を具体的に列挙する', () => {
  const report = buildM3GapAudit(ledger, '2026-11-02');
  assert.equal(report.effectiveStatus, 'blocked');
  assert.ok(report.missing.includes('payout_reservations:actualHeadersVerified'));
  assert.ok(report.missing.includes('payout_passes_subscriptions:provenanceVerified'));
  assert.ok(report.missing.includes('format:MISSING:payout_reservations'));
  assert.ok(report.missing.includes('join:JOIN_OBSERVATION_MISSING'));
  assert.ok(report.missing.includes('manualReview:HUMAN_REVIEW_MISSING'));
  assert.equal(report.manualReviewGate, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(report.realCsvCompatibilityVerified, false);
  assert.equal(report.commercialGoAuthorized, false);
});

test('11月4日から未達M3をoverdueとし、台帳を変更しない', () => {
  const before = structuredClone(ledger);
  const report = buildM3GapAudit(ledger, '2026-11-04');
  assert.equal(report.effectiveStatus, 'overdue');
  assert.deepEqual(ledger, before);
});

test('参照文字列・顧客の列名・データをレポートに露出しない', () => {
  const copy = structuredClone(ledger);
  copy.m3Verification.reservations.evidenceRef = 'PRIVATE_CUSTOMER_REFERENCE';
  copy.m3Verification.formatEvidence = [{role: 'payout_reservations', headers: ['PRIVATE_CUSTOMER_HEADER']}];
  const output = JSON.stringify(buildM3GapAudit(copy, '2026-11-02'));
  assert.ok(!output.includes('PRIVATE_CUSTOMER_REFERENCE'));
  assert.ok(!output.includes('PRIVATE_CUSTOMER_HEADER'));
});

test('不正な判定日を拒否する', () => {
  assert.throws(() => buildM3GapAudit(ledger, '2026-11-31'), /INVALID_AS_OF/);
});

test('M3監査の人手確認欄は機密参照を出力せず、将来日付も拒否する', () => {
  const copy = structuredClone(ledger);
  copy.m3Verification.manualReview = {
    humanReviewed: true, authenticCurrentExportsConfirmed: true,
    twoPayoutCasesReviewed: true, syntheticOnly: false,
    reviewedAt: '2026-11-03', reviewerRole: 'authorized_reviewer',
    reviewEvidenceRef: 'PRIVATE_REVIEW_REFERENCE'
  };
  const report = buildM3GapAudit(copy, '2026-11-02');
  assert.ok(report.missing.includes('manualReview:HUMAN_REVIEW_DATE_IN_FUTURE'));
  assert.ok(!JSON.stringify(report).includes('PRIVATE_REVIEW_REFERENCE'));
  assert.equal(report.realCsvCompatibilityVerified, false);
});
