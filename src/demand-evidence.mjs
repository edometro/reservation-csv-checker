/** Evidence accounting for a demand-validation gate. Never treat seller ads or official FAQs as customers. */
export const SOURCE_KINDS = Object.freeze([
  'firsthand_workflow', 'official_capability', 'seller_claim', 'editorial'
]);
const TYPES = new Set(SOURCE_KINDS);
const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const countMissing = (actual, required) => Math.max(0, required - actual);
// Interview dates and crawl dates are not publication dates. Month precision is allowed.
const validPublicationPeriod = value => validDate(value) ||
  (typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && validDate(value + '-01'));

export function summarizeDemandEvidence(registry) {
  if (!registry || !Array.isArray(registry.sources)) {
    throw new Error('証拠の一覧がありません');
  }
  if (!validDate(registry.checkedAt)) throw new Error('調査日が不正です');
  const ids = new Set(), urls = new Set();
  const targetMfEvidenceIds = [], nonTargetFirsthandIds = [];
  const publicationDatedIds = [], publicationMissingIds = [];
  const counts = Object.fromEntries(SOURCE_KINDS.map(kind => [kind, 0]));
  for (const item of registry.sources) {
    if (!item || !TYPES.has(item.kind)) throw new Error('不明な証拠区分です');
    if (typeof item.id !== 'string' || !item.id ||
        typeof item.url !== 'string' || !/^https:\/\/[^\s]+$/.test(item.url) ||
        typeof item.summary !== 'string' || !item.summary.trim()) {
      throw new Error('出典の識別子・URL・概要が不足しています');
    }
    const normalizedUrl = item.url.replace(/\/$/, '');
    if (ids.has(item.id) || urls.has(normalizedUrl)) {
      throw new Error('同じ出典を複数件に数えることはできません');
    }
    ids.add(item.id);
    urls.add(normalizedUrl);
    if (item.kind === 'firsthand_workflow' &&
        (!item.accountingSoftware || !item.observedWork)) {
      throw new Error('実利用者の体験談には会計ソフト名と観察できた作業が必要です');
    }
    if (item.kind === 'firsthand_workflow') {
      if (validPublicationPeriod(item.publishedAt)) publicationDatedIds.push(item.id);
      else publicationMissingIds.push(item.id);
      if (item.targetMfUser === true) {
        // Generic MF users and STORES recommendations are not payout-reconciliation evidence.
        const softwareMatches = /マネーフォワード|Money\s*Forward|MF\s*クラウド/i.test(item.accountingSoftware);
        // A Money Forward user recommending STORES is not a STORES Reservation user.
        // Require a separately observed use of the exact booking product, not just a
        // generic payout story. These are metadata checks; source truth is reviewed manually.
        const reservationUseRecorded = item.bookingProduct === 'STORES予約' &&
          typeof item.bookingUseEvidence === 'string' && item.bookingUseEvidence.trim().length > 0;
        const workflowRecorded = typeof item.monthlyPayoutReconciliationWork === 'string' &&
          item.monthlyPayoutReconciliationWork.trim().length > 0;
        // A crawl date, malformed string, or interview date masquerading as a
        // publication date must not satisfy the provenance requirement.
        const dated = validPublicationPeriod(item.publishedAt) ||
          validPublicationPeriod(item.interviewedAt);
        if (!softwareMatches || !reservationUseRecorded || !workflowRecorded || !dated) {
          throw new Error(`${item.id}: 対象MF月次照合の本人証拠にはSTORES予約の本人利用・MF会計・具体的月次照合作業・有効な掲載/取材時期が必要です`);
        }
        targetMfEvidenceIds.push(item.id);
      } else {
        nonTargetFirsthandIds.push(item.id);
      }
    }
    counts[item.kind]++;
  }
  const interviews = registry.interviews;
  if (!interviews || !Number.isSafeInteger(interviews.consented) || interviews.consented < 0 ||
      !Number.isSafeInteger(interviews.specificWillingness) ||
      interviews.specificWillingness < 0 ||
      interviews.specificWillingness > interviews.consented) {
    throw new Error('許諾済みヒアリング数と支払意思確認数が不正です');
  }
  if (typeof registry.realCsvCompatibilityVerified !== 'boolean') {
    throw new Error('実CSVの適合確認状況が不正です');
  }
  const missing = {
    firsthandCases: countMissing(publicationDatedIds.length, 5),
    interviews: countMissing(interviews.consented, 5),
    willingness: countMissing(interviews.specificWillingness, 3),
    realCsvCompatibility: registry.realCsvCompatibilityVerified ? 0 : 1
  };
  return {
    ...counts,
    publicationDatedFirsthandWorkflows: publicationDatedIds.length,
    publicationDatedIds,
    publicationMissingIds,
    // Diagnostic only: five general stories are not five qualified target users.
    targetMfReconciliationWorkflows: targetMfEvidenceIds.length,
    targetMfEvidenceIds,
    nonTargetFirsthandIds,
    consentedInterviews: interviews.consented,
    confirmedWillingness: interviews.specificWillingness,
    realCsvCompatibilityVerified: registry.realCsvCompatibilityVerified,
    missing,
    decision: Object.values(missing).every(v => v === 0) ? 'READY_FOR_HUMAN_GO_REVIEW' : 'INSUFFICIENT_EVIDENCE'
  };
}
