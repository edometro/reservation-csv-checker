import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {summarizeDemandEvidence} from '../src/demand-evidence.mjs';

const saved = JSON.parse(await readFile(new URL('../docs/demand-evidence.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(saved);
const baselineFirsthand = saved.sources.filter(s => s.kind === 'firsthand_workflow').length;
const baselinePublished = saved.sources.filter(s => s.kind === 'firsthand_workflow' &&
  s.bookingProduct === 'STORES予約' && s.bookingUseEvidence?.trim() &&
  /^\d{4}-\d{2}(-\d{2})?$/.test(s.publishedAt ?? '')).length;
const baselineQualified = saved.sources.filter(s => s.kind === 'firsthand_workflow' &&
  s.bookingProduct === 'STORES予約' && s.bookingUseEvidence?.trim() &&
  /^\d{4}-\d{2}(-\d{2})?$/.test(s.publishedAt ?? '') &&
  !/^(未公表|未確認|不明|未記載|なし|unknown|not disclosed)(?:$|[（(\s])/i.test(s.accountingSoftware)).length;
const baselineMissing = Math.max(0, 5 - baselineQualified);
const addToFive = data => {
  const needed = Math.max(0, 5 - summarizeDemandEvidence(data).m2QualifiedFirsthandWorkflows);
  data.sources.push(...Array.from({length: needed}, (_, i) => firsthand(1000 + i)));
};
// The evidence registry grows over time: assert its classification, not a stale snapshot total.
const firsthand = n => ({
  id: 'U'+n, kind: 'firsthand_workflow',
  url: 'https://example.org/workflow-'+n, summary: '本人の手作業の説明',
  accountingSoftware: 'freee', observedWork: '月次のCSV加工', publishedAt: '2026-10-29',
  bookingProduct: 'STORES予約', bookingUseEvidence: '本人が予約画面でCSVを操作した'
});

test('tracked evidence keeps real users separate from seller and official claims', () => {
  const result = summarizeDemandEvidence(saved);
  assert.equal(result.firsthand_workflow, baselineFirsthand);
  assert.equal(result.official_capability, saved.sources.filter(s => s.kind === 'official_capability').length);
  assert.equal(result.seller_claim, 2);
  assert.equal(result.editorial, 1);
  assert.equal(result.consentedInterviews, 0);
  assert.equal(result.confirmedWillingness, 0);
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
  assert.deepEqual(result.missing, {
    firsthandCases: baselineMissing, interviews: 5, willingness: 3, realCsvCompatibility: 1
  });
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
  data.interviews = {consented: 5, specificWillingness: 3};
  data.realCsvCompatibilityVerified = true;
  assert.equal(summarizeDemandEvidence(data).decision, 'READY_FOR_HUMAN_GO_REVIEW');
  data.interviews.specificWillingness = 2;
  assert.equal(summarizeDemandEvidence(data).decision, 'INSUFFICIENT_EVIDENCE');
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
  const synthetic = summarizeDemandEvidence(data);
  assert.equal(synthetic.m2QualifiedFirsthandWorkflows, 2);
  assert.equal(synthetic.targetMfReconciliationWorkflows, 0);
});
