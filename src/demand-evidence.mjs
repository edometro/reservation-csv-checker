/** Evidence accounting for a demand-validation gate. Never treat seller ads or official FAQs as customers. */
export const SOURCE_KINDS = Object.freeze([
  'firsthand_workflow', 'official_capability', 'seller_claim', 'editorial'
]);
const TYPES = new Set(SOURCE_KINDS);
// M5: a single boolean is not evidence that the two payout files, bank deposit,
// and Money Forward import were actually checked. Keep private CSVs out of Git.
const CSV_PROOF_KEYS = ["payoutReservations","payoutPassesAndSubscriptions","sharedPayoutKey","bankDepositReconciliation","moneyForwardImport"];
const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const countMissing = (actual, required) => Math.max(0, required - actual);
// Operator IDs are internal anonymous identifiers, not case-sensitive names.
// Canonicalize before deduplication so alternate case / Unicode width cannot inflate M2 or MF counts.
const normalizeOperatorKey = value => typeof value === 'string' ? value.trim().normalize('NFKC').toLowerCase() : '';
// Interview dates and crawl dates are not publication dates. Month precision is allowed.
const validPublicationPeriod = value => validDate(value) ||
  (typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && validDate(value + '-01'));
// A future-dated article or interview cannot be observed as firsthand evidence.
// For YYYY-MM, the first day of the month is the earliest possible publication.
const isFutureEvidencePeriod = (value, checkedAt) => validPublicationPeriod(value) &&
  (value.length === 7 ? value + '-01' : value) > checkedAt;

function hasRealCsvProof(verification, checkedAt) {
  return verification && validDate(verification.reviewedAt) &&
    verification.reviewedAt <= checkedAt && CSV_PROOF_KEYS.every(key => {
      const check = verification[key];
      return check?.verified === true && typeof check.evidenceRef === 'string' &&
        check.evidenceRef.trim().length > 0;
    });
}


/**
 * M4/M5: aggregate counters alone are not proof of consent or willingness.
 * Store only anonymous participant keys and opaque audit references in Git.
 * The actual consent/interview evidence stays outside the public repository.
 */
function validateInterviewEvidence(interviews, checkedAt) {
  if (!Array.isArray(interviews.records)) {
    if (interviews.consented === 0 && interviews.specificWillingness === 0) return;
    throw new Error('同意済みヒアリングと支払意思には匿名の監査証拠が必要です');
  }
  if (interviews.records.length !== interviews.consented) {
    throw new Error('同意済みヒアリング件数と監査証拠件数が一致しません');
  }
  const seen = new Set();
  let willingness = 0;
  const hasRef = value => typeof value === 'string' && value.trim().length > 0;
  for (const record of interviews.records) {
    if (!record || typeof record.participantKey !== 'string' ||
        !/^[a-zA-Z0-9_-]{3,64}$/.test(record.participantKey) ||
        seen.has(record.participantKey.toLowerCase())) {
      throw new Error('面談参加者の匿名識別子が不正または重複しています');
    }
    seen.add(record.participantKey.toLowerCase());
    if (!validDate(record.consentedAt) || !validDate(record.interviewedAt) ||
        record.consentedAt > record.interviewedAt || record.interviewedAt > checkedAt ||
        !hasRef(record.consentEvidenceRef) || !hasRef(record.interviewEvidenceRef)) {
      throw new Error('同意・実施日時または面談の監査証拠が不足しています');
    }
    if (record.willingness === true) {
      if (!Number.isSafeInteger(record.willingnessPriceJPY) ||
          record.willingnessPriceJPY < 2980 ||
          record.decisionMakerConfirmed !== true ||
          !hasRef(record.willingnessTimeframe) ||
          !hasRef(record.requiredFeatures) ||
          !hasRef(record.willingnessEvidenceRef)) {
        throw new Error('2,980円の支払意思には価格・決裁者・時期・機能・監査証拠が必要です');
      }
      willingness++;
    } else if (record.willingness !== false) {
      throw new Error('支払意思の確認状態が不正です');
    }
  }
  if (willingness !== interviews.specificWillingness) {
    throw new Error('支払意思件数と匿名の監査証拠件数が一致しません');
  }
}

export function summarizeDemandEvidence(registry) {
  if (!registry || !Array.isArray(registry.sources)) {
    throw new Error('証拠の一覧がありません');
  }
  if (!validDate(registry.checkedAt)) throw new Error('調査日が不正です');
  const ids = new Set(), urls = new Set();
  const targetMfEvidenceIds = [], nonTargetFirsthandIds = [];
  const targetMfOperators = new Set(), targetMfOperatorUnverifiedIds = [], targetMfDuplicateOperatorIds = [];
  const publicationDatedIds = [], publicationMissingIds = [], nonBookingFirsthandIds = [];
  const m2QualifiedIds = [], softwareUnverifiedIds = [];
  const operatorUnverifiedIds = [], duplicateOperatorIds = [], qualifiedOperators = new Set();
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
        (isFutureEvidencePeriod(item.publishedAt, registry.checkedAt) ||
         (item.targetMfUser === true && isFutureEvidencePeriod(item.interviewedAt, registry.checkedAt)))) {
      throw new Error('本人一次証拠の掲載・取材時期が調査日より未来です');
    }
    if (item.kind === 'firsthand_workflow' &&
        (typeof item.accountingSoftware !== 'string' || !item.accountingSoftware.trim() || !item.observedWork)) {
      throw new Error('実利用者の体験談には会計ソフト名と観察できた作業が必要です');
    }
    if (item.kind === 'firsthand_workflow') {
      // M2 is specifically about STORES Reservation operators, not any STORES
      // product or generic accounting-software review. A product mention alone
      // is insufficient: require separately recorded firsthand usage.
      const reservationUseRecorded = item.bookingProduct === 'STORES予約' &&
        typeof item.bookingUseEvidence === 'string' && item.bookingUseEvidence.trim().length > 0;
      if (reservationUseRecorded) {
        if (validPublicationPeriod(item.publishedAt)) {
          publicationDatedIds.push(item.id);
          // M2 requires a recorded accounting-software identity. "未公表" is
          // honest provenance metadata, but not evidence of a named product.
          const software = item.accountingSoftware.trim();
          // Product name alone is not proof of actual accounting-software use.
          // freee予約 is a booking product, not freee会計.
          const hasUseProof = typeof item.accountingSoftwareUseEvidence === 'string' &&
            item.accountingSoftwareUseEvidence.trim().length > 0;
          const isOtherProduct = /予約|booking|coubic|レジ|決済|ネットショップ/i.test(software);
          const isUnverified = /^(未公表|未確認|不明|未記載|なし|unknown|not disclosed)(?:$|[（(\s])/i.test(software);
          if (isUnverified || isOtherProduct || !hasUseProof) {
            softwareUnverifiedIds.push(item.id);
          } else {
            // Different URLs from the same operator are one independent M2 case.
            // An anonymous source URL is not proof of a distinct operator.
            const operatorKey = normalizeOperatorKey(item.operatorKey);
            if (!operatorKey) operatorUnverifiedIds.push(item.id);
            else if (qualifiedOperators.has(operatorKey)) duplicateOperatorIds.push(item.id);
            else {
              qualifiedOperators.add(operatorKey);
              m2QualifiedIds.push(item.id);
            }
          }
        } else publicationMissingIds.push(item.id);
      } else {
        nonBookingFirsthandIds.push(item.id);
      }
      if (item.targetMfUser === true) {
        // Generic MF users and STORES recommendations are not payout-reconciliation evidence.
        const softwareMatches = /マネーフォワード|Money\s*Forward|MF\s*クラウド/i.test(item.accountingSoftware);
        // A Money Forward user recommending STORES is not a STORES Reservation user.
        // Require a separately observed use of the exact booking product, not just a
        // generic payout story. These are metadata checks; source truth is reviewed manually.
        const workflowRecorded = typeof item.monthlyPayoutReconciliationWork === 'string' &&
          item.monthlyPayoutReconciliationWork.trim().length > 0;
        // A crawl date, malformed string, or interview date masquerading as a
        // publication date must not satisfy the provenance requirement.
        const dated = validPublicationPeriod(item.publishedAt) ||
          validPublicationPeriod(item.interviewedAt);
        const softwareUseRecorded = typeof item.accountingSoftwareUseEvidence === 'string' &&
          item.accountingSoftwareUseEvidence.trim().length > 0;
        if (!softwareMatches || !softwareUseRecorded || !reservationUseRecorded || !workflowRecorded || !dated) {
          throw new Error(`${item.id}: 対象MF月次照合の本人証拠にはSTORES予約の本人利用・MF会計・具体的月次照合作業・有効な掲載/取材時期が必要です`);
        }
        // Multiple URLs from one operator are not independent MF users.
        // Unknown operator identity is insufficient for a target-user count.
        const operatorKey = normalizeOperatorKey(item.operatorKey);
        if (!operatorKey) targetMfOperatorUnverifiedIds.push(item.id);
        else if (targetMfOperators.has(operatorKey)) targetMfDuplicateOperatorIds.push(item.id);
        else {
          targetMfOperators.add(operatorKey);
          targetMfEvidenceIds.push(item.id);
        }
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
  validateInterviewEvidence(interviews, registry.checkedAt);
  if (typeof registry.realCsvCompatibilityVerified !== 'boolean') {
    throw new Error('実CSVの適合確認状況が不正です');
  }
  if (registry.realCsvCompatibilityVerified && !hasRealCsvProof(registry.realCsvVerification, registry.checkedAt)) {
    throw new Error('実CSV適合をtrueにするには2内訳・共通振込キー・銀行着金照合・MF実取込の監査証拠が必要です');
  }
  const missing = {
    firsthandCases: countMissing(m2QualifiedIds.length, 5),
    interviews: countMissing(interviews.consented, 5),
    willingness: countMissing(interviews.specificWillingness, 3),
    realCsvCompatibility: registry.realCsvCompatibilityVerified ? 0 : 1
  };
  return {
    ...counts,
    publicationDatedFirsthandWorkflows: publicationDatedIds.length,
    m2QualifiedFirsthandWorkflows: m2QualifiedIds.length,
    m2QualifiedIds,
    softwareUnverifiedIds,
    operatorUnverifiedIds,
    duplicateOperatorIds,
    publicationDatedIds,
    publicationMissingIds,
    nonBookingFirsthandIds,
    // Diagnostic only: five general stories are not five qualified target users.
    targetMfReconciliationWorkflows: targetMfEvidenceIds.length,
    targetMfEvidenceIds,
    targetMfOperatorUnverifiedIds,
    targetMfDuplicateOperatorIds,
    nonTargetFirsthandIds,
    consentedInterviews: interviews.consented,
    confirmedWillingness: interviews.specificWillingness,
    realCsvCompatibilityVerified: registry.realCsvCompatibilityVerified,
    missing,
    decision: Object.values(missing).every(v => v === 0) ? 'READY_FOR_HUMAN_GO_REVIEW' : 'INSUFFICIENT_EVIDENCE'
  };
}
