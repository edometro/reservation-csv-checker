import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {evaluateMilestones, synchronizeMilestoneLedger, synchronizeMilestoneMarkdown} from '../src/milestone-progress.mjs';

const registry = {
  checkedAt: '2026-10-28', interviews: {consented: 0, specificWillingness: 0},
  realCsvCompatibilityVerified: false,
  sources: Array.from({length: 5}, (_, i) => ({id: `U${i}`, kind: 'firsthand_workflow',
    url: `https://example.org/review/${i}`, summary: '本人の具体的な作業',
    accountingSoftware: 'freee', accountingSoftwareUseEvidence: '本人がfreee会計で帳簿を管理', observedWork: '予約受付', publishedAt: '2026-10-28',
    operatorKey: `synthetic-operator-${i}`,
    bookingProduct: 'STORES予約', bookingUseEvidence: '本人がSTORES予約で予約を受けた'}))
};
const baseline = () => ({
  evidenceSnapshot: {}, commercialGate: {status: 'INSUFFICIENT_EVIDENCE'},
  milestones: [
    {id: 'M1', dueDate: '2026-10-29', status: 'done'},
    {id: 'M2', dueDate: '2026-10-31', status: 'done'},
    {id: 'M3', dueDate: '2026-11-03', status: 'in_progress'},
    {id: 'M4', dueDate: '2026-11-07', status: 'blocked', blocker: '外部連絡の承認なし'},
    {id: 'M5', dueDate: '2026-11-10', status: 'blocked'}
  ]
});

test('期限翌日にblockedもoverdue、doneは維持、次期限は最古の未達', () => {
  const result = evaluateMilestones(baseline(), registry, '2026-11-08');
  assert.deepEqual(result.milestones.map(m => m.effectiveStatus),
    ['done', 'done', 'overdue', 'overdue', 'blocked']);
  assert.equal(result.nextDue.id, 'M3');
  assert.equal(result.snapshot.targetMfFirsthandWorkflows, 0);
  assert.equal(result.snapshot.publicationDatedFirsthandWorkflows, 5);
  assert.equal(result.snapshot.m2QualifiedFirsthandWorkflows, 5);
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
});

test('M2: 取材時期だけの5件を完了と誤判定しない', () => {
  const undated = structuredClone(registry);
  undated.sources[0].publishedAt = '未記載（取材2026-10）';
  const ledger = baseline();
  assert.throws(() => evaluateMilestones(ledger, undated, '2026-10-29'), /M2.*不足/);
  ledger.milestones[1].status = 'in_progress';
  const result = evaluateMilestones(ledger, undated, '2026-11-01');
  assert.equal(result.nextDue.id, 'M2');
  assert.equal(result.milestones[1].effectiveStatus, 'overdue');
});

test('期限当日はoverdueにせず、翌日から判定', () => {
  const result = evaluateMilestones(baseline(), registry, '2026-11-03');
  assert.equal(result.milestones[2].effectiveStatus, 'in_progress');
  assert.equal(evaluateMilestones(baseline(), registry, '2026-11-04').milestones[2].effectiveStatus, 'overdue');
});

test('証拠の集計値を実データから計算し、差分を表示・同期する', () => {
  const ledger = baseline();
  const result = evaluateMilestones(ledger, registry, '2026-11-08');
  assert.ok(result.drift.some(x => x.field === 'firsthandWorkflows'));
  const {updated, changed} = synchronizeMilestoneLedger(ledger, result);
  assert.equal(changed, true);
  assert.equal(updated.evidenceSnapshot.firsthandWorkflows, 5);
  assert.equal(updated.milestones[3].status, 'overdue');
  const again = evaluateMilestones(updated, registry, '2026-11-08');
  assert.equal(again.drift.length, 0);
  assert.equal(synchronizeMilestoneLedger(updated, again).changed, false);
});

test('数字だけで未達のM4/M5を自動完了させず、虚偽の完了を拒否する', () => {
  const ledger = baseline();
  ledger.milestones[3].status = 'done';
  assert.throws(() => evaluateMilestones(ledger, registry, '2026-11-08'), /M4.*不足/);
  ledger.milestones[3].status = 'blocked';
  ledger.milestones[4].status = 'done';
  assert.throws(() => evaluateMilestones(ledger, registry, '2026-11-08'), /M5.*不足/);
});

test('不正日付・重複IDを拒否する', () => {
  assert.throws(() => evaluateMilestones(baseline(), registry, '2026-02-30'), /判定日/);
  const ledger = baseline();
  ledger.milestones[1].id = 'M1';
  assert.throws(() => evaluateMilestones(ledger, registry, '2026-10-28'), /重複/);
});

test('公開台帳を実際の証拠データから再集計しても有料化No-Goを維持する', async () => {
  const [ledger, evidence] = await Promise.all([
    readFile(new URL('../docs/milestones.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../docs/demand-evidence.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const result = evaluateMilestones(ledger, evidence, '2026-10-28');
  assert.equal(result.decision, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.snapshot.firsthandWorkflows, 7);
  assert.equal(result.snapshot.targetMfFirsthandWorkflows, 0);
  assert.equal(result.snapshot.realCsvCompatibilityVerified, false);
  assert.equal(result.drift.length, 0, '証拠台帳とマイルストーンの集計が一致する');
});

test('M2: five dated stories from other STORES products do not qualify', () => {
  const data = structuredClone(registry);
  data.sources[0].bookingProduct = 'STORES決済';
  const ledger = baseline();
  assert.throws(() => evaluateMilestones(ledger, data, '2026-10-29'), /M2.*不足/);
  ledger.milestones[1].status = 'in_progress';
  const result = evaluateMilestones(ledger, data, '2026-11-01');
  assert.equal(result.snapshot.publicationDatedFirsthandWorkflows, 4);
  assert.equal(result.milestones[1].effectiveStatus, 'overdue');
});


test('M2: five dated stories without accounting-software names cannot be marked done', () => {
  const data = structuredClone(registry);
  data.sources.forEach(s => { s.accountingSoftware = '未公表'; });
  const ledger = baseline();
  assert.throws(() => evaluateMilestones(ledger, data, '2026-10-29'), /M2.*不足/);
  ledger.milestones[1].status = 'in_progress';
  const result = evaluateMilestones(ledger, data, '2026-11-01');
  assert.equal(result.snapshot.publicationDatedFirsthandWorkflows, 5);
  assert.equal(result.snapshot.m2QualifiedFirsthandWorkflows, 0);
  assert.equal(result.milestones[1].effectiveStatus, 'overdue');
});

test('現在の進捗表は台帳のblocked状態と適格件数に同期し、履歴は変更しない', async () => {
  const [markdown, ledger] = await Promise.all([
    readFile(new URL('../docs/MILESTONES.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/milestones.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const synced = synchronizeMilestoneMarkdown(markdown, ledger, '2026-10-31');
  assert.equal(synced.changed, false, '公開済み進捗表が台帳と一致する');
  assert.match(synced.content, /\| M2 \|[^\n]*全条件充足1\/5[^\n]*\*\*blocked\*\*/);
  assert.equal(synchronizeMilestoneMarkdown(synced.content, ledger, '2026-10-31').changed, false);
});

test('期限翌日にoverdueを進捗表へ反映し、古い研究記録は残す', async () => {
  const [markdown, ledger, evidence] = await Promise.all([
    readFile(new URL('../docs/MILESTONES.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/milestones.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../docs/demand-evidence.json', import.meta.url), 'utf8').then(JSON.parse)
  ]);
  const evaluation = evaluateMilestones(ledger, evidence, '2026-11-01');
  const {updated} = synchronizeMilestoneLedger(ledger, evaluation);
  const synced = synchronizeMilestoneMarkdown(markdown, updated, '2026-11-01');
  assert.match(synced.content, /\| M2 \|[^\n]*\*\*overdue\*\*/);
  assert.match(synced.content, /\| 2026-11-01時点の実績 \|/);
  assert.equal(synchronizeMilestoneMarkdown(synced.content, updated, '2026-11-01').changed, false);
  assert.ok(synced.content.includes('### 2026-10-29：ITreview'));
});

test('進捗表の欠落は黙って通さない', () => {
  assert.throws(() => synchronizeMilestoneMarkdown('# 欠落', baseline(), '2026-10-30'), /進捗表/);
});
