import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {summarizeDemandEvidence} from '../src/demand-evidence.mjs';

const saved = JSON.parse(await readFile(new URL('../docs/demand-evidence.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(saved);
const firsthand = n => ({
  id: 'U'+n, kind: 'firsthand_workflow',
  url: 'https://example.org/workflow-'+n, summary: '本人の手作業の説明',
  accountingSoftware: 'freee', observedWork: '月次のCSV加工'
});

test('tracked evidence keeps real users separate from seller and official claims', () => {
  const result = summarizeDemandEvidence(saved);
  assert.equal(result.firsthand_workflow, 3);
  assert.equal(result.official_capability, 19);
  assert.equal(result.seller_claim, 2);
  assert.equal(result.editorial, 1);
  assert.equal(result.consentedInterviews, 0);
  assert.equal(result.confirmedWillingness, 0);
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
  assert.deepEqual(result.missing, {
    firsthandCases: 2, interviews: 5, willingness: 3, realCsvCompatibility: 1
  });
});

test('seller and official entries cannot satisfy the firsthand target', () => {
  const data = clone();
  for (let n = 0; n < 10; n++) {
    data.sources.push({id: 'S'+(n+10), kind: 'seller_claim',
      url: 'https://example.org/seller-'+n, summary: '宣伝'});
  }
  assert.equal(summarizeDemandEvidence(data).firsthand_workflow, 3);
  assert.equal(summarizeDemandEvidence(data).missing.firsthandCases, 2);
});

test('five actual stories alone do not constitute customer interviews or compatibility', () => {
  const data = clone();
  data.sources.push(...[4,5].map(firsthand));
  const result = summarizeDemandEvidence(data);
  assert.equal(result.firsthand_workflow, 5);
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.missing.interviews, 5);
  assert.equal(result.missing.realCsvCompatibility, 1);
});

test('only complete requirements allow human Go review, never auto-launch', () => {
  const data = clone();
  data.sources.push(...[4,5].map(firsthand));
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
  assert.equal(summary.official_capability, 19);
  assert.equal(summary.firsthand_workflow, 3);
  assert.equal(summary.missing.firsthandCases, 2);
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
  assert.equal(summary.official_capability, 19);
  assert.equal(summary.firsthand_workflow, 3);
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
  assert.equal(summary.official_capability, 19);
  assert.equal(summary.firsthand_workflow, 3);
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
  assert.equal(summary.official_capability, 19);
  assert.equal(summary.firsthand_workflow, 3);
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
  assert.equal(summary.firsthand_workflow, 3);
  assert.equal(summary.missing.firsthandCases, 2);
  assert.equal(summary.consentedInterviews, 0);
  assert.equal(summary.confirmedWillingness, 0);
  assert.equal(summary.realCsvCompatibilityVerified, false);
  assert.equal(summary.decision, 'INSUFFICIENT_EVIDENCE');
});
