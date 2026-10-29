import {summarizeDemandEvidence} from './demand-evidence.mjs';

const STATES = new Set(['not_started', 'in_progress', 'blocked', 'done', 'overdue']);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function evaluateMilestones(ledger, registry, asOf) {
  if (!validDate(asOf)) throw new Error('判定日が不正です（YYYY-MM-DD）');
  if (!ledger || !Array.isArray(ledger.milestones) || !ledger.evidenceSnapshot || !ledger.commercialGate) {
    throw new Error('マイルストーン台帳の形式が不正です');
  }
  const summary = summarizeDemandEvidence(registry);
  const snapshot = {
    checkedAt: registry.checkedAt,
    firsthandWorkflows: summary.firsthand_workflow,
    publicationDatedFirsthandWorkflows: summary.publicationDatedFirsthandWorkflows,
    m2QualifiedFirsthandWorkflows: summary.m2QualifiedFirsthandWorkflows,
    targetMfFirsthandWorkflows: summary.targetMfReconciliationWorkflows,
    consentedInterviews: summary.consentedInterviews,
    specificWillingness: summary.confirmedWillingness,
    realCsvCompatibilityVerified: summary.realCsvCompatibilityVerified,
    officialCapabilities: summary.official_capability,
    sellerClaims: summary.seller_claim,
    editorial: summary.editorial,
    sourceCount: registry.sources.length
  };
  const drift = Object.entries(snapshot).filter(([key, value]) => ledger.evidenceSnapshot[key] !== value)
    .map(([key, value]) => ({field: key, stored: ledger.evidenceSnapshot[key], actual: value}));
  if (ledger.commercialGate.status !== summary.decision) {
    drift.push({field: 'commercialGate.status', stored: ledger.commercialGate.status, actual: summary.decision});
  }
  const seen = new Set();
  const milestones = ledger.milestones.map(m => {
    if (!m || typeof m.id !== 'string' || seen.has(m.id) || !validDate(m.dueDate) || !STATES.has(m.status)) {
      throw new Error('ID・期限・状態が不正または重複しています');
    }
    seen.add(m.id);
    // Completion requires more than counts; never infer "done" from numeric progress.
    if (m.status === 'done' && ((m.id === 'M2' && summary.m2QualifiedFirsthandWorkflows < 5) ||
        (m.id === 'M4' && summary.consentedInterviews < 5) ||
        (m.id === 'M5' && (summary.confirmedWillingness < 3 || !summary.realCsvCompatibilityVerified)))) {
      throw new Error(`${m.id}は完了と記録されていますが必須証拠が不足しています`);
    }
    const effectiveStatus = m.status !== 'done' && m.dueDate < asOf ? 'overdue' : m.status;
    return {...m, effectiveStatus};
  });
  const next = milestones.filter(m => m.effectiveStatus !== 'done')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;
  return {asOf, snapshot, decision: summary.decision, drift, milestones, nextDue: next && {
    id: next.id, dueDate: next.dueDate, status: next.effectiveStatus, blocker: next.blocker ?? null
  }};
}

export function synchronizeMilestoneLedger(ledger, evaluation) {
  const updated = structuredClone(ledger);
  updated.evidenceSnapshot = evaluation.snapshot;
  updated.commercialGate.status = evaluation.decision;
  updated.milestones = evaluation.milestones.map(({effectiveStatus, ...m}) => ({...m, status: effectiveStatus}));
  const changed = JSON.stringify(updated.evidenceSnapshot) !== JSON.stringify(ledger.evidenceSnapshot) ||
    updated.commercialGate.status !== ledger.commercialGate.status ||
    updated.milestones.some((m, i) => m.status !== ledger.milestones[i].status);
  if (changed) updated.updatedAt = evaluation.asOf;
  return {updated, changed};
}
