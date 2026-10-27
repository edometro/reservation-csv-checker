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
  assert.equal(result.firsthand_workflow, 1);
  assert.equal(result.official_capability, 2);
  assert.equal(result.seller_claim, 2);
  assert.equal(result.editorial, 1);
  assert.equal(result.consentedInterviews, 0);
  assert.equal(result.confirmedWillingness, 0);
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
  assert.deepEqual(result.missing, {
    firsthandCases: 4, interviews: 5, willingness: 3, realCsvCompatibility: 1
  });
});

test('seller and official entries cannot satisfy the firsthand target', () => {
  const data = clone();
  for (let n = 0; n < 10; n++) {
    data.sources.push({id: 'S'+(n+10), kind: 'seller_claim',
      url: 'https://example.org/seller-'+n, summary: '宣伝'});
  }
  assert.equal(summarizeDemandEvidence(data).firsthand_workflow, 1);
  assert.equal(summarizeDemandEvidence(data).missing.firsthandCases, 4);
});

test('five actual stories alone do not constitute customer interviews or compatibility', () => {
  const data = clone();
  data.sources.push(...[2,3,4,5].map(firsthand));
  const result = summarizeDemandEvidence(data);
  assert.equal(result.firsthand_workflow, 5);
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.missing.interviews, 5);
  assert.equal(result.missing.realCsvCompatibility, 1);
});

test('only complete requirements allow human Go review, never auto-launch', () => {
  const data = clone();
  data.sources.push(...[2,3,4,5].map(firsthand));
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
