import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {summarizeDemandEvidence} from '../src/demand-evidence.mjs';

const saved = JSON.parse(await readFile(new URL('../docs/demand-evidence.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(saved);
// Date-based rejection tests must remain future-dated as the evidence ledger advances.
const dayAfterEvidenceCheck = new Date(Date.parse(saved.checkedAt + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
const baselineFirsthand = saved.sources.filter(s => s.kind === 'firsthand_workflow').length;
const baselinePublished = saved.sources.filter(s => s.kind === 'firsthand_workflow' &&
  s.bookingProduct === 'STORES予約' && s.bookingUseEvidence?.trim() &&
  /^\d{4}-\d{2}(-\d{2})?$/.test(s.publishedAt ?? '')).length;
const baselineQualified = saved.sources.filter(s => s.kind === 'firsthand_workflow' &&
  s.bookingProduct === 'STORES予約' && s.bookingUseEvidence?.trim() &&
  /^\d{4}-\d{2}(-\d{2})?$/.test(s.publishedAt ?? '') &&
  !/^(未公表|未確認|不明|未記載|なし|unknown|not disclosed)(?:$|[（(\s])/i.test(s.accountingSoftware) &&
  s.accountingSoftwareUseEvidence?.trim() && s.operatorKey?.trim()).length;
const baselineMissing = Math.max(0, 5 - baselineQualified);
const addToFive = data => {
  const needed = Math.max(0, 5 - summarizeDemandEvidence(data).m2QualifiedFirsthandWorkflows);
  data.sources.push(...Array.from({length: needed}, (_, i) => firsthand(1000 + i)));
};
// The evidence registry grows over time: assert its classification, not a stale snapshot total.
const firsthand = n => ({
  id: 'U'+n, kind: 'firsthand_workflow',
  url: 'https://example.org/workflow-'+n, summary: '本人の手作業の説明',
  accountingSoftware: 'freee', accountingSoftwareUseEvidence: '本人がfreee会計で収入取引を登録', observedWork: '月次のCSV加工', publishedAt: '2026-10-29',
  operatorKey: 'synthetic-operator-'+n,
  bookingProduct: 'STORES予約', bookingUseEvidence: '本人が予約画面でCSVを操作した'
});


const addSyntheticInterviewProof = (data, willing = 3) => {
  data.interviews = {
    consented: 5, specificWillingness: willing,
    records: Array.from({length: 5}, (_, i) => ({
      participantKey: 'synthetic-p' + i,
      consentedAt: '2026-10-30', interviewedAt: '2026-10-31',
      consentEvidenceRef: 'synthetic-private-consent-' + i,
      interviewEvidenceRef: 'synthetic-private-interview-' + i,
      willingness: i < willing,
      ...(i < willing ? {
        willingnessPriceJPY: 2980,
        decisionMakerConfirmed: true,
        willingnessTimeframe: '翌月から',
        requiredFeatures: '予約入金と銀行着金の照合',
        willingnessEvidenceRef: 'synthetic-private-price-' + i
      } : {})
    }))
  };
};

test('tracked evidence keeps real users separate from seller and official claims', () => {
  const result = summarizeDemandEvidence(saved);
  assert.equal(result.firsthand_workflow, baselineFirsthand);
  assert.equal(result.official_capability, saved.sources.filter(s => s.kind === 'official_capability').length);
  assert.equal(result.seller_claim, saved.sources.filter(s => s.kind === 'seller_claim').length);
  assert.equal(result.editorial, saved.sources.filter(s => s.kind === 'editorial').length);
  assert.equal(result.consentedInterviews, 0);
  assert.equal(result.confirmedWillingness, 0);
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
  assert.deepEqual(result.missing, {
    firsthandCases: baselineMissing, interviews: 5, willingness: 3, realCsvCompatibility: 1
  });
});

test('M2: freee reservation provider cross-sell is not an independent STORES user', () => {
  const claim = saved.sources.find(s => s.id === 'S003');
  assert.equal(claim.kind, 'seller_claim');
  assert.equal(claim.publishedAt, '2026-10-26');
  const withoutClaim = clone();
  withoutClaim.sources = withoutClaim.sources.filter(s => s.id !== 'S003');
  const baseline = summarizeDemandEvidence(withoutClaim);
  const withClaim = summarizeDemandEvidence(saved);
  assert.equal(withClaim.seller_claim, baseline.seller_claim + 1);
  assert.equal(withClaim.m2QualifiedFirsthandWorkflows, baseline.m2QualifiedFirsthandWorkflows);
  assert.equal(withClaim.targetMfReconciliationWorkflows, baseline.targetMfReconciliationWorkflows);
  assert.equal(withClaim.confirmedWillingness, baseline.confirmedWillingness);
  assert.equal(withClaim.decision, 'INSUFFICIENT_EVIDENCE');
});

test('M2: interview month and crawl date do not substitute for a published period', () => {
  const result = summarizeDemandEvidence(saved);
  assert.equal(result.firsthand_workflow, 7);
  assert.equal(result.publicationDatedFirsthandWorkflows, 5);
  assert.deepEqual(result.publicationMissingIds.sort(), ['U002', 'U003']);
  assert.equal(result.m2QualifiedFirsthandWorkflows, 1);
  assert.deepEqual(result.m2QualifiedIds, ['U001']);
  assert.equal(result.missing.firsthandCases, 4);
  const data = clone();
  const u2 = data.sources.find(s => s.id === 'U002');
  u2.publishedAt = '2025-04'; // Example: only if actual publication month is verified.
  assert.equal(summarizeDemandEvidence(data).publicationDatedFirsthandWorkflows, 6);
  u2.publishedAt = '未記載（取材2025-04）';
  assert.equal(summarizeDemandEvidence(data).publicationDatedFirsthandWorkflows, 5);
});

test('M2: same-operator dated booking post corroborates U002 but cannot date its undated interview', () => {
  const u2 = saved.sources.find(s => s.id === 'U002');
  assert.equal(u2.sameOperatorCorroboration.url, 'https://mimosa-eyedesign.stores.jp/reserve/mimosaeyedesign/blogs/990644');
  assert.equal(u2.sameOperatorCorroboration.publishedAt, '2025-06-19');
  assert.equal(u2.sameOperatorCorroboration.sameOperator, true);
  assert.equal(u2.sameOperatorCorroboration.countsAsSeparateFirsthand, false);
  assert.equal(saved.sources.filter(s => s.url === u2.sameOperatorCorroboration.url).length, 0,
    '同じ店舗の別ページを別の顧客として数えない');
  const result = summarizeDemandEvidence(saved);
  assert.ok(result.publicationMissingIds.includes('U002'), '別ページの投稿日を取材記事の投稿日に移植しない');
  assert.equal(result.m2QualifiedFirsthandWorkflows, 1);
  assert.equal(result.targetMfReconciliationWorkflows, 0);
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
});

test('2024 independent STORES booking receipt workload is not MF reconciliation demand', () => {
  const url = 'https://www.itreview.jp/products/coubic/reviews/183201';
  const matches = saved.sources.filter(s => s.url === url);
  assert.equal(matches.length, 1, '同じ本人レビューを重複計上しない');
  assert.equal(matches[0].kind, 'firsthand_workflow');
  assert.equal(matches[0].publishedAt, '2024-03-22');
  assert.equal(matches[0].accountingSoftware, '未公表');
  assert.match(matches[0].observedWork, /領収書/);
  assert.equal(matches[0].targetMfUser, false);
  assert.equal(summarizeDemandEvidence(saved).decision, 'INSUFFICIENT_EVIDENCE');
});

test('seller and official entries cannot satisfy the firsthand target', () => {
  const data = clone();
  for (let n = 0; n < 10; n++) {
    data.sources.push({id: 'S'+(n+10), kind: 'seller_claim',
      url: 'https://example.org/seller-'+n, summary: '宣伝'});
  }
  assert.equal(summarizeDemandEvidence(data).firsthand_workflow, baselineFirsthand);
  assert.equal(summarizeDemandEvidence(data).missing.firsthandCases, baselineMissing);
});

test('five actual stories alone do not constitute customer interviews or compatibility', () => {
  const data = clone();
  addToFive(data);
  const result = summarizeDemandEvidence(data);
  assert.equal(result.m2QualifiedFirsthandWorkflows, 5);
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.missing.interviews, 5);
  assert.equal(result.missing.realCsvCompatibility, 1);
});

test('only complete requirements allow human Go review, never auto-launch', () => {
  const data = clone();
  addToFive(data);
  addSyntheticInterviewProof(data);
  data.realCsvCompatibilityVerified = true;
  data.realCsvVerification = {
    reviewedAt: '2026-10-31',
    ...Object.fromEntries(["payoutReservations","payoutPassesAndSubscriptions","sharedPayoutKey","bankDepositReconciliation","moneyForwardImport"].map(key =>
      [key, {verified: true, evidenceRef: 'synthetic-test-proof-' + key}]))
  };
  assert.equal(summarizeDemandEvidence(data).decision, 'READY_FOR_HUMAN_GO_REVIEW');
  data.interviews.records[2].willingness = false;
  data.interviews.specificWillingness = 2;
  assert.equal(summarizeDemandEvidence(data).decision, 'INSUFFICIENT_EVIDENCE');
});

test('M5: flipping the real-CSV boolean cannot bypass actual proof references', () => {
  const data = clone();
  addToFive(data);
  addSyntheticInterviewProof(data);
  data.realCsvCompatibilityVerified = true;
  assert.throws(() => summarizeDemandEvidence(data), /実CSV適合.*監査証拠/);
  data.realCsvVerification = {
    reviewedAt: '2026-10-31',
    ...Object.fromEntries(["payoutReservations","payoutPassesAndSubscriptions","sharedPayoutKey","bankDepositReconciliation","moneyForwardImport"].map(key =>
      [key, {verified: true, evidenceRef: 'synthetic-test-proof-' + key}]))
  };
  for (const key of ["payoutReservations","payoutPassesAndSubscriptions","sharedPayoutKey","bankDepositReconciliation","moneyForwardImport"]) {
    const invalid = structuredClone(data);
    invalid.realCsvVerification[key].evidenceRef = '';
    assert.throws(() => summarizeDemandEvidence(invalid), /監査証拠/, key + ': reference is mandatory');
    invalid.realCsvVerification[key].evidenceRef = 'synthetic-test-proof';
    invalid.realCsvVerification[key].verified = false;
    assert.throws(() => summarizeDemandEvidence(invalid), /監査証拠/, key + ': verification is mandatory');
  }
  data.realCsvVerification.reviewedAt = dayAfterEvidenceCheck;
  assert.throws(() => summarizeDemandEvidence(data), /監査証拠/, 'future review date cannot qualify');
  data.realCsvCompatibilityVerified = false;
  assert.equal(summarizeDemandEvidence(data).decision, 'INSUFFICIENT_EVIDENCE');
});

test('M4/M5: aggregate counters cannot fabricate consent or 2,980 yen willingness', () => {
  const data = clone();
  data.interviews = {consented: 5, specificWillingness: 3};
  assert.throws(() => summarizeDemandEvidence(data), /監査証拠/);
  addSyntheticInterviewProof(data);
  assert.equal(summarizeDemandEvidence(data).consentedInterviews, 5);
  assert.equal(summarizeDemandEvidence(data).confirmedWillingness, 3);
  const missingConsent = clone();
  addSyntheticInterviewProof(missingConsent);
  missingConsent.interviews.records[0].consentEvidenceRef = '';
  assert.throws(() => summarizeDemandEvidence(missingConsent), /監査証拠/);
  const duplicate = clone();
  addSyntheticInterviewProof(duplicate);
  duplicate.interviews.records[1].participantKey = duplicate.interviews.records[0].participantKey;
  assert.throws(() => summarizeDemandEvidence(duplicate), /重複/);
  const future = clone();
  addSyntheticInterviewProof(future);
  future.interviews.records[0].interviewedAt = dayAfterEvidenceCheck;
  assert.throws(() => summarizeDemandEvidence(future), /監査証拠/);
  const lowPrice = clone();
  addSyntheticInterviewProof(lowPrice);
  lowPrice.interviews.records[0].willingnessPriceJPY = 1000;
  assert.throws(() => summarizeDemandEvidence(lowPrice), /2,980円/);
  const noBuyer = clone();
  addSyntheticInterviewProof(noBuyer);
  noBuyer.interviews.records[0].decisionMakerConfirmed = false;
  assert.throws(() => summarizeDemandEvidence(noBuyer), /2,980円/);
  const missingPriceProof = clone();
  addSyntheticInterviewProof(missingPriceProof);
  missingPriceProof.interviews.records[0].willingnessEvidenceRef = '';
  assert.throws(() => summarizeDemandEvidence(missingPriceProof), /監査証拠/);
  const wrongCount = clone();
  addSyntheticInterviewProof(wrongCount);
  wrongCount.interviews.specificWillingness = 4;
  assert.throws(() => summarizeDemandEvidence(wrongCount), /件数/);
});

test('duplicate sources and unsupported categories are rejected', () => {
  const data = clone();
  data.sources.push({...data.sources[0], id:'new-id'});
  assert.throws(() => summarizeDemandEvidence(data), /同じ出典/);
  data.sources.pop();
  data.sources.push({...firsthand(200), kind:'unknown'});
  assert.throws(() => summarizeDemandEvidence(data), /不明な証拠/);
});

test('invalid aggregate numbers and unsubstantiated firsthand records are rejected', () => {
  const data = clone();
  data.interviews = {consented:1, specificWillingness:2};
  assert.throws(() => summarizeDemandEvidence(data), /不正/);
  data.interviews = {consented:0, specificWillingness:0};
  data.sources.push({...firsthand(200), observedWork:''});
  assert.throws(() => summarizeDemandEvidence(data), /体験談/);
  data.sources.pop();
  data.checkedAt='2026-02-30';
  assert.throws(() => summarizeDemandEvidence(data), /調査日/);
});

test('MF built-in bank import and auto rules are official alternatives, not paid demand', () => {
  const officialUrls = [
    'https://biz.moneyforward.com/support/account/guide/journal02/jo01.html',
    'https://biz.moneyforward.com/support/account/guide/import/im01.html',
    'https://biz.moneyforward.com/support/account/guide/journal02/jo24.html'
  ];
  for (const url of officialUrls) {
    const matches = saved.sources.filter(item => item.url === url);
    assert.equal(matches.length, 1, '公式の同じ根拠を二重計上しない');
    assert.equal(matches[0].kind, 'official_capability');
  }
  const summary = summarizeDemandEvidence(saved);
  assert.equal(summary.official_capability, saved.sources.filter(s => s.kind === 'official_capability').length);
  assert.equal(summary.firsthand_workflow, baselineFirsthand);
  assert.equal(summary.missing.firsthandCases, baselineMissing);
  assert.equal(summary.missing.interviews, 5);
  assert.equal(summary.missing.willingness, 3);
  assert.equal(summary.decision, 'INSUFFICIENT_EVIDENCE');
});

test('STORES POS, shop, reservation and MF payout claims stay distinct from paid demand', () => {
  const expectedOfficialUrls = [
    'https://biz.moneyforward.com/support/account/faq/specificinformation/sp07.html',
    'https://biz.moneyforward.com/support/account/news/new-feature/20240521.html',
    'https://biz.moneyforward.com/support/account/news/new-feature/20240112.html',
    'https://regi-faq.stores.jp/hc/ja/articles/4408633607833',
    'https://reserve-faq.stores.jp/hc/ja/articles/53033661487001',
    'https://stores.fun/regi/pricing',
    'https://biz.moneyforward.com/support/account/news/new-feature/2025112501.html'
  ];
  for (const url of expectedOfficialUrls) {
    const entries = saved.sources.filter(item => item.url === url);
    assert.equal(entries.length, 1, '連携範囲の公式出典を重複して数えない');
    assert.equal(entries[0].kind, 'official_capability',
      '公式の連携・価格情報は顧客の支払意思ではない');
  }
  const summary = summarizeDemandEvidence(saved);
  assert.equal(summary.official_capability, saved.sources.filter(s => s.kind === 'official_capability').length);
  assert.equal(summary.firsthand_workflow, baselineFirsthand);
  assert.equal(summary.consentedInterviews, 0);
  assert.equal(summary.confirmedWillingness, 0);
  assert.equal(summary.decision, 'INSUFFICIENT_EVIDENCE');
});


test('booking CSV export month and key caveats are official evidence, not new customers', () => {
  const expectedOfficialUrls = [
    'https://reserve-faq.stores.jp/hc/ja/articles/28712681987097',
    'https://reserve-faq.stores.jp/hc/ja/articles/28712690043033'
  ];
  for (const url of expectedOfficialUrls) {
    const entries = saved.sources.filter(item => item.url === url);
    assert.equal(entries.length, 1, '同じ予約CSV仕様を複数件に数えない');
    assert.equal(entries[0].kind, 'official_capability',
      'CSV出力仕様は本人の作業体験談ではない');
  }
  const summary = summarizeDemandEvidence(saved);
  assert.equal(summary.official_capability, saved.sources.filter(s => s.kind === 'official_capability').length);
  assert.equal(summary.firsthand_workflow, baselineFirsthand);
  assert.equal(summary.consentedInterviews, 0);
  assert.equal(summary.confirmedWillingness, 0);
  assert.equal(summary.realCsvCompatibilityVerified, false);
  assert.equal(summary.decision, 'INSUFFICIENT_EVIDENCE');
});


test('payment-rail official facts never count as user pain or paid willingness', () => {
  const expectedOfficialUrls = [
    'https://support.coiney.com/hc/ja/articles/115007912688',
    'https://reserve-faq.stores.jp/hc/ja/articles/53034030789913',
    'https://reserve-faq.stores.jp/hc/ja/articles/28701429334297'
  ];
  for (const url of expectedOfficialUrls) {
    const matches = saved.sources.filter(item => item.url === url);
    assert.equal(matches.length, 1, '支払経路の公式根拠はURLごとに一度だけ');
    assert.equal(matches[0].kind, 'official_capability', '公式仕様を一次体験談と混同しない');
  }
  const summary = summarizeDemandEvidence(saved);
  assert.equal(summary.official_capability, saved.sources.filter(s => s.kind === 'official_capability').length);
  assert.equal(summary.firsthand_workflow, baselineFirsthand);
  assert.equal(summary.consentedInterviews, 0);
  assert.equal(summary.confirmedWillingness, 0);
  assert.equal(summary.realCsvCompatibilityVerified, false);
  assert.equal(summary.decision, 'INSUFFICIENT_EVIDENCE');
});

test('vendor-hosted interviews count as unique first-person workflow reports, not MF demand', () => {
  const expected = [
    ['https://stores.fun/cases/posts/mimosaeyedesign-cross', 'freee', '2025-04'],
    ['https://stores.fun/cases/posts/noue-cross', '未公表', '2025-07']
  ];
  for (const [url, software, interviewedAt] of expected) {
    const entries = saved.sources.filter(source => source.url === url);
    assert.equal(entries.length, 1, '同じ販促インタビューを複数件に数えない');
    assert.equal(entries[0].kind, 'firsthand_workflow', '本人の一人称の具体的な作業のみ計上');
    assert.equal(entries[0].accountingSoftware, software);
    assert.equal(entries[0].interviewedAt, interviewedAt, '取材時期と公開日を混同しない');
    assert.match(entries[0].sourceContext, /販促目的/);
    assert.equal(entries[0].targetMfUser, false);
    assert.ok(entries[0].observedWork);
  }
  const mfCases = saved.sources.filter(source =>
    source.kind === 'firsthand_workflow' && source.targetMfUser === true);
  assert.equal(mfCases.length, 0, 'MF併用の一次体験談はまだ未確認');
  const summary = summarizeDemandEvidence(saved);
  assert.equal(summary.firsthand_workflow, baselineFirsthand);
  assert.equal(summary.missing.firsthandCases, baselineMissing);
  assert.equal(summary.consentedInterviews, 0);
  assert.equal(summary.confirmedWillingness, 0);
  assert.equal(summary.realCsvCompatibilityVerified, false);
  assert.equal(summary.decision, 'INSUFFICIENT_EVIDENCE');
});

test('MF journal duplicate-check and two distinct import paths are alternatives, not user demand', () => {
  const expected = [
    ['O020', 'https://biz.moneyforward.com/support/account/guide/books2/bo01.html'],
    ['O021', 'https://biz.moneyforward.com/support/account/guide/import-books/ib01.html'],
    ['O022', 'https://biz.moneyforward.com/support/account/guide/import/im02.html']
  ];
  for (const [id, url] of expected) {
    const matches = saved.sources.filter(item => item.url === url);
    assert.equal(matches.length, 1, '公式の同一URLは一度だけ記録');
    assert.equal(matches[0].id, id);
    assert.equal(matches[0].kind, 'official_capability');
  }
  const summary = summarizeDemandEvidence(saved);
  assert.equal(summary.official_capability, saved.sources.filter(s => s.kind === 'official_capability').length);
  assert.equal(summary.firsthand_workflow, baselineFirsthand);
  assert.equal(summary.consentedInterviews, 0);
  assert.equal(summary.confirmedWillingness, 0);
  assert.equal(summary.realCsvCompatibilityVerified, false);
  assert.equal(summary.decision, 'INSUFFICIENT_EVIDENCE');
});


test('refund deadline is a documented CSV reconciliation gap, never a paying user', () => {
  const url = 'https://reserve-faq.stores.jp/hc/ja/articles/28712713337369';
  const matches = saved.sources.filter(s => s.url === url);
  assert.equal(matches.length, 1, '返金期限の公式FAQは1つの出典として記録');
  assert.equal(matches[0].id, 'O026');
  assert.equal(matches[0].kind, 'official_capability');
  const result = summarizeDemandEvidence(saved);
  assert.ok(result.official_capability >= 26, '既存公式根拠を欠落させない');
  assert.equal(result.firsthand_workflow, baselineFirsthand);
  assert.equal(result.consentedInterviews, 0);
  assert.equal(result.confirmedWillingness, 0);
  assert.equal(result.realCsvCompatibilityVerified, false);
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
});

test('Issue #3: seven general stories are not qualified STORES Reservation + MF payout users', () => {
  const result = summarizeDemandEvidence(saved);
  assert.equal(result.firsthand_workflow, 7);
  assert.equal(result.targetMfReconciliationWorkflows, 0);
  assert.deepEqual(result.targetMfEvidenceIds, []);
  assert.deepEqual(result.nonTargetFirsthandIds.sort(), ['U001', 'U002', 'U003', 'U004', 'U005', 'U006', 'U007']);
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
});

test('Issue #3: MF mentions require firsthand monthly payout work and publication date', () => {
  const data = clone();
  const item = {...firsthand(999), targetMfUser: true,
    accountingSoftware: 'マネーフォワード クラウド会計',
    publishedAt: '2026-10-29'};
  // This test starts without booking-use proof, unlike the general M2 fixture.
  delete item.bookingProduct;
  delete item.bookingUseEvidence;
  data.sources.push(item);
  assert.throws(() => summarizeDemandEvidence(data), /対象MF月次照合/);
  item.monthlyPayoutReconciliationWork = 'STORES予約の内訳と銀行着金を月末に本人が突合した';
  // Merely mentioning STORES in a payout description is not independently
  // recorded evidence that the author used the booking product.
  assert.throws(() => summarizeDemandEvidence(data), /対象MF月次照合/);
  item.bookingProduct = 'STORES予約';
  item.bookingUseEvidence = '本人がSTORES予約の事前決済を運用していると明記';
  assert.equal(summarizeDemandEvidence(data).targetMfReconciliationWorkflows, 1);
  item.accountingSoftware = 'freee';
  assert.throws(() => summarizeDemandEvidence(data), /対象MF月次照合/);
  item.accountingSoftware = 'マネーフォワード クラウド会計';
  item.publishedAt = '';
  assert.throws(() => summarizeDemandEvidence(data), /対象MF月次照合/);
});

test('Issue #3: seller claims never count as qualified target users even if flagged', () => {
  const data = clone();
  data.sources.push({id: 'S-target', kind: 'seller_claim', url: 'https://example.org/seller-target',
    summary: '宣伝', targetMfUser: true});
  assert.equal(summarizeDemandEvidence(data).targetMfReconciliationWorkflows, 0);
});


test('Issue #3: an MF user recommending STORES cannot be marked as a qualified target', () => {
  const data = clone();
  const item = {...firsthand(998), targetMfUser: true,
    accountingSoftware: 'マネーフォワード クラウド会計',
    monthlyPayoutReconciliationWork: '別サービスの入金を毎月照合',
    publishedAt: '2026-10-29'};
  // This test starts without booking-use proof, unlike the general M2 fixture.
  delete item.bookingProduct;
  delete item.bookingUseEvidence;
  data.sources.push(item);
  assert.throws(() => summarizeDemandEvidence(data), /対象MF月次照合/);
  item.bookingProduct = 'STORES決済';
  item.bookingUseEvidence = 'STORES決済のみ本人利用';
  assert.throws(() => summarizeDemandEvidence(data), /対象MF月次照合/);
  item.bookingProduct = 'STORES予約';
  item.bookingUseEvidence = '';
  assert.throws(() => summarizeDemandEvidence(data), /対象MF月次照合/);
  item.bookingUseEvidence = '本人が予約の事前決済を使用';
  assert.equal(summarizeDemandEvidence(data).targetMfReconciliationWorkflows, 1);
});

test('Issue #3: arbitrary date strings do not satisfy target provenance', () => {
  const data = clone();
  const item = {...firsthand(997), targetMfUser: true,
    accountingSoftware: 'マネーフォワード クラウド会計',
    bookingProduct: 'STORES予約',
    bookingUseEvidence: '本人がSTORES予約を運用',
    monthlyPayoutReconciliationWork: '月末に予約入金と銀行着金を突合',
    publishedAt: '未確認', interviewedAt: '2026-02-30'};
  data.sources.push(item);
  assert.throws(() => summarizeDemandEvidence(data), /対象MF月次照合/);
  item.interviewedAt = '2026-10';
  assert.equal(summarizeDemandEvidence(data).targetMfReconciliationWorkflows, 1);
});

test('M2: a real STORES payment operator who explicitly has not used booking cannot inflate reservation evidence', () => {
  const data = clone();
  // 2023-01-18 article (updated 2024-02-28): https://biz.ukulelelabo.com/stores/
  // The author reports using STORES決済 for lesson fees but explicitly says
  // the STORES reservation product has NOT been adopted. MF is only mentioned as an option.
  data.sources.push({
    id: 'U888', kind: 'firsthand_workflow',
    url: 'https://biz.ukulelelabo.com/stores/',
    summary: 'STORES決済の本人利用。STORES予約は未利用と明記。',
    accountingSoftware: '未確認', observedWork: 'レッスン料の対面決済',
    publishedAt: '2023-01-18', bookingProduct: 'STORES決済',
    bookingUseEvidence: '予約システムはまだ使っていない', targetMfUser: false
  });
  const result = summarizeDemandEvidence(data);
  assert.equal(result.firsthand_workflow, baselineFirsthand + 1);
  assert.equal(result.publicationDatedFirsthandWorkflows, baselinePublished);
  assert.deepEqual(result.nonBookingFirsthandIds, ['U888']);
  assert.equal(result.targetMfReconciliationWorkflows, 0);
  assert.equal(result.missing.firsthandCases, baselineMissing);
});

test('M2: a dated story without actual STORES予約 usage evidence is excluded from the five', () => {
  const data = clone();
  const u7 = data.sources.find(s => s.id === 'U007');
  u7.bookingUseEvidence = '';
  let result = summarizeDemandEvidence(data);
  assert.equal(result.publicationDatedFirsthandWorkflows, baselinePublished - 1);
  assert.deepEqual(result.nonBookingFirsthandIds, ['U007']);
  assert.equal(result.missing.firsthandCases, baselineMissing);
  u7.bookingUseEvidence = 'STORES決済だけを使用';
  u7.bookingProduct = 'STORES決済';
  result = summarizeDemandEvidence(data);
  assert.equal(result.publicationDatedFirsthandWorkflows, baselinePublished - 1);
});


test('M2: dated STORES予約 reviews with undisclosed accounting software are not qualified', () => {
  const data = clone();
  const result = summarizeDemandEvidence(data);
  assert.equal(result.publicationDatedFirsthandWorkflows, 5);
  assert.equal(result.m2QualifiedFirsthandWorkflows, 1);
  assert.deepEqual(result.softwareUnverifiedIds.sort(), ['U004', 'U005', 'U006', 'U007']);
  const u4 = data.sources.find(s => s.id === 'U004');
  u4.accountingSoftware = 'マネーフォワード クラウド会計'; // synthetic metadata, NOT a real observation
  u4.accountingSoftwareUseEvidence = '本人がMF会計を利用'; // synthetic only
  u4.operatorKey = 'synthetic-itreview-operator'; // synthetic only, NOT verified in reality
  const synthetic = summarizeDemandEvidence(data);
  assert.equal(synthetic.m2QualifiedFirsthandWorkflows, 2);
  assert.equal(synthetic.targetMfReconciliationWorkflows, 0);
});


test('M2: an explicitly fictional STORES予約 + freee workflow cannot count as a customer', () => {
  // https://okomari.smilefactory-rakuai.com/articles/83c37864.html
  // The article expressly labels its operator, shop and outcome as fiction.
  const item = saved.sources.find(s => s.id === 'E002');
  assert.ok(item, '架空の顧客事例の出典を追跡する');
  assert.equal(item.kind, 'editorial', 'フィクションは本人一次体験ではない');
  assert.match(item.summary, /フィクション/);
  assert.equal(saved.sources.filter(s => s.url === item.url).length, 1, '出典は重複計上しない');
  const summary = summarizeDemandEvidence(saved);
  assert.equal(summary.editorial, 2);
  assert.equal(summary.m2QualifiedFirsthandWorkflows, 1);
  assert.equal(summary.targetMfReconciliationWorkflows, 0);
  assert.equal(summary.missing.firsthandCases, 4);
  assert.equal(summary.decision, 'INSUFFICIENT_EVIDENCE');
});


test('M2: a product name alone is not proof of actual accounting-software use', () => {
  const data = clone();
  const u1 = data.sources.find(s => s.id === 'U001');
  delete u1.accountingSoftwareUseEvidence;
  const result = summarizeDemandEvidence(data);
  assert.equal(result.m2QualifiedFirsthandWorkflows, 0);
  assert.ok(result.softwareUnverifiedIds.includes('U001'));
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
});

test('M2: freee予約 is not freee会計 even when the booking app was used', () => {
  const data = clone();
  const u1 = data.sources.find(s => s.id === 'U001');
  u1.accountingSoftware = 'freee予約';
  u1.accountingSoftwareUseEvidence = '本人がfreee予約で予約を受け付けた';
  const result = summarizeDemandEvidence(data);
  assert.equal(result.m2QualifiedFirsthandWorkflows, 0);
  assert.ok(result.softwareUnverifiedIds.includes('U001'));
});


test('M2: multiple URLs by the same operator count as one independent user', () => {
  const data = clone();
  const operatorKey = data.sources.find(s => s.id === 'U001').operatorKey;
  data.sources.push({...firsthand(910), operatorKey});
  data.sources.push({...firsthand(911), operatorKey});
  const result = summarizeDemandEvidence(data);
  assert.equal(result.m2QualifiedFirsthandWorkflows, 1);
  assert.deepEqual(result.duplicateOperatorIds, ['U910', 'U911']);
  assert.equal(result.missing.firsthandCases, 4);
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
});

test('M2: operator identity is case- and width-insensitive across URLs', () => {
  const data = clone();
  data.sources.push({...firsthand(914), operatorKey: '  HANDMADE-WORKSHOP-AUTHOR  '});
  data.sources.push({...firsthand(915), operatorKey: 'ｈａｎｄｍａｄｅ-workshop-author'});
  const result = summarizeDemandEvidence(data);
  assert.equal(result.m2QualifiedFirsthandWorkflows, 1, '表記揺れで独立事業者を水増ししない');
  assert.deepEqual(result.duplicateOperatorIds, ['U914', 'U915']);
  assert.equal(result.missing.firsthandCases, 4);
});

test('Issue #3: target MF operator IDs with case/width variants count once', () => {
  const data = clone();
  const mf = (n, operatorKey) => ({
    ...firsthand(n), operatorKey, targetMfUser: true,
    accountingSoftware: 'マネーフォワード クラウド会計',
    accountingSoftwareUseEvidence: '合成例：MF会計を本人が操作',
    monthlyPayoutReconciliationWork: '合成例：予約入金と銀行着金を月次照合'
  });
  data.sources.push(mf(916, 'MF-Operator'), mf(917, 'ｍｆ-operator'));
  const result = summarizeDemandEvidence(data);
  assert.equal(result.targetMfReconciliationWorkflows, 1);
  assert.deepEqual(result.targetMfDuplicateOperatorIds, ['U917']);
  assert.equal(result.m2QualifiedFirsthandWorkflows, 2, '同一MF運営者はM2にも1件だけ');
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
});

test('M2: a different URL without operator identity cannot count as a new person', () => {
  const data = clone();
  const item = {...firsthand(912)};
  delete item.operatorKey;
  data.sources.push(item);
  const result = summarizeDemandEvidence(data);
  assert.equal(result.m2QualifiedFirsthandWorkflows, 1);
  assert.deepEqual(result.operatorUnverifiedIds, ['U912']);
  assert.equal(result.missing.firsthandCases, 4);
});

test('M2: a separately verified operator with all required fields can add one case', () => {
  const data = clone();
  data.sources.push(firsthand(913));
  const result = summarizeDemandEvidence(data);
  assert.equal(result.m2QualifiedFirsthandWorkflows, 2);
  assert.deepEqual(result.m2QualifiedIds, ['U001', 'U913']);
  assert.equal(result.missing.firsthandCases, 3);
});

test('Issue #3: a Money Forward product name without firsthand software-use proof is not target evidence', () => {
  const data = clone();
  const item = {...firsthand(994), targetMfUser: true,
    accountingSoftware: 'マネーフォワード クラウド会計',
    monthlyPayoutReconciliationWork: 'STORES予約の入金内訳と銀行着金を月次で照合',
    accountingSoftwareUseEvidence: ''};
  data.sources.push(item);
  assert.throws(() => summarizeDemandEvidence(data), /対象MF月次照合/,
    'MF製品名の自己申告だけで実使用の証拠にしない');
  item.accountingSoftwareUseEvidence = '本人がマネーフォワード クラウド会計の銀行明細を操作した';
  const result = summarizeDemandEvidence(data);
  assert.equal(result.targetMfReconciliationWorkflows, 1);
  assert.deepEqual(result.targetMfEvidenceIds, ['U994']);
});

test('Issue #3: two MF URLs from one operator and anonymous MF reports never inflate target count', () => {
  const data = clone();
  const mf = n => ({...firsthand(n), targetMfUser: true,
    accountingSoftware: 'マネーフォワード クラウド会計',
    accountingSoftwareUseEvidence: '本人がMFクラウド会計の入金明細を操作',
    monthlyPayoutReconciliationWork: '予約内訳と銀行入金を月次で突合'});
  const first = mf(995);
  const duplicate = {...mf(996), operatorKey: first.operatorKey};
  const anonymous = mf(997);
  delete anonymous.operatorKey;
  data.sources.push(first, duplicate, anonymous);
  const result = summarizeDemandEvidence(data);
  assert.equal(result.targetMfReconciliationWorkflows, 1);
  assert.deepEqual(result.targetMfEvidenceIds, ['U995']);
  assert.deepEqual(result.targetMfDuplicateOperatorIds, ['U996']);
  assert.deepEqual(result.targetMfOperatorUnverifiedIds, ['U997']);
  assert.equal(result.m2QualifiedFirsthandWorkflows, 2, 'M2も同一運営者を重複計上しない');
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
});
