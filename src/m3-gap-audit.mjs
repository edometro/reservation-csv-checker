import {assessPayoutFormatEvidence, assessPayoutJoinDiscrimination, assessM3ManualReview} from './payout-format-evidence.mjs';

// Evidence-gap report only. It does not inspect CSVs, validate provenance,
// certify accounting accuracy, or change the commercial Go/No-Go decision.
export function buildM3GapAudit(ledger, asOf) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(asOf)) ||
      new Date(asOf).toISOString().slice(0, 10) !== asOf) {
    throw new Error('INVALID_AS_OF');
  }
  const milestone = ledger?.milestones?.find(m => m.id === 'M3');
  if (!milestone || !ledger.m3Verification) throw new Error('M3_LEDGER_MISSING');
  const v = ledger.m3Verification;
  const format = assessPayoutFormatEvidence(v.formatEvidence ?? [], {asOf});
  const join = assessPayoutJoinDiscrimination(v.joinDiscrimination);
  const review = assessM3ManualReview(v.manualReview, {asOf});
  const missing = [];
  for (const [role, entry] of [
    ['payout_reservations', v.reservations],
    ['payout_passes_subscriptions', v.passesAndSubscriptions]
  ]) {
    for (const key of ['provenanceVerified', 'csvFormatVerified', 'actualHeadersVerified']) {
      if (entry?.[key] !== true) missing.push(role + ':' + key);
    }
    if (typeof entry?.evidenceRef !== 'string' || !entry.evidenceRef.trim()) {
      missing.push(role + ':evidenceRef');
    }
  }
  if (v.commonPayoutKeyVerified !== true) missing.push('commonPayoutKeyVerified');
  if (typeof v.commonPayoutKeyEvidenceRef !== 'string' || !v.commonPayoutKeyEvidenceRef.trim()) {
    missing.push('commonPayoutKeyEvidenceRef');
  }
  if (v.acceptanceCriteriaDocumented !== true) missing.push('acceptanceCriteriaDocumented');
  missing.push(...format.blockers.map(x => 'format:' + x));
  missing.push(...join.blockers.map(x => 'join:' + x));
  missing.push(...review.blockers.map(x => 'manualReview:' + x));
  const effectiveStatus = milestone.status !== 'done' && milestone.dueDate < asOf
    ? 'overdue' : milestone.status;
  return {
    milestone: 'M3',
    asOf,
    dueDate: milestone.dueDate,
    effectiveStatus,
    missing,
    formatGate: format.state,
    joinGate: join.state,
    manualReviewGate: review.state,
    // Never equate metadata-only checks with real CSV compatibility.
    realCsvCompatibilityVerified: false,
    commercialGoAuthorized: false,
    nextAction: missing.length
      ? '真正な現行2内訳の公式公開サンプル、または個別承認済みの匿名化サンプル/公式回答が得られるまでM3は未検証。期限超過後はM2の一次証拠を優先。'
      : '人手の真正性監査済み。実CSV・銀行/MF適合は別途検証。'
  };
}
