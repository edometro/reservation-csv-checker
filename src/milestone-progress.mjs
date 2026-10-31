import {summarizeDemandEvidence} from './demand-evidence.mjs';
import {assessPayoutFormatEvidence} from './payout-format-evidence.mjs';

const STATES = new Set(['not_started', 'in_progress', 'blocked', 'done', 'overdue']);
const WORK_PRIORITIES = new Set(['active', 'parked']);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// M3 is an evidence-backed acquisition/schema milestone, not full MF import compatibility.
// Synthetic tests may exercise this gate, but production evidence references must be audited.
function hasM3SourceEvidence(source) {
  return source && source.provenanceVerified === true && source.csvFormatVerified === true &&
    source.actualHeadersVerified === true && typeof source.evidenceRef === 'string' &&
    source.evidenceRef.trim().length > 0;
}

function hasM3AcceptanceEvidence(v, asOf) {
  return v && hasM3SourceEvidence(v.reservations) &&
    hasM3SourceEvidence(v.passesAndSubscriptions) && v.commonPayoutKeyVerified === true &&
    typeof v.commonPayoutKeyEvidenceRef === 'string' && v.commonPayoutKeyEvidenceRef.trim().length > 0 &&
    v.acceptanceCriteriaDocumented === true &&
    Array.isArray(v.formatEvidence) &&
    assessPayoutFormatEvidence(v.formatEvidence, {asOf}).state === 'READY_FOR_MANUAL_SCHEMA_REVIEW';
}

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
    if (!m || typeof m.id !== 'string' || seen.has(m.id) || !validDate(m.dueDate) || !STATES.has(m.status) ||
        (m.workPriority !== undefined && !WORK_PRIORITIES.has(m.workPriority))) {
      throw new Error('ID・期限・状態が不正または重複しています');
    }
    seen.add(m.id);
    // Completion requires more than counts; never infer "done" from numeric progress.
    if (m.status === 'done' && ((m.id === 'M2' && summary.m2QualifiedFirsthandWorkflows < 5) ||
        (m.id === 'M3' && !hasM3AcceptanceEvidence(ledger.m3Verification, asOf)) ||
        (m.id === 'M4' && summary.consentedInterviews < 5) ||
        (m.id === 'M5' && (summary.confirmedWillingness < 3 || !summary.realCsvCompatibilityVerified)))) {
      throw new Error(`${m.id}は完了と記録されていますが必須証拠が不足しています`);
    }
    const effectiveStatus = m.status !== 'done' && m.dueDate < asOf ? 'overdue' : m.status;
    return {...m, effectiveStatus};
  });
  const next = milestones.filter(m => m.effectiveStatus !== 'done')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;
  // The oldest overdue milestone stays visible, but may be blocked on access.
  // Select exactly one independently actionable work item for this run.
  const activeWork = milestones.filter(m => m.effectiveStatus !== 'done' && m.workPriority === 'active');
  if (activeWork.length > 1) throw new Error('同時にactiveの未完了マイルストーンは1件までです');
  const work = activeWork[0] ?? null;
  return {asOf, snapshot, decision: summary.decision, drift, milestones, nextDue: next && {
    id: next.id, dueDate: next.dueDate, status: next.effectiveStatus, blocker: next.blocker ?? null
  }, nextWork: work && {
    id: work.id, dueDate: work.dueDate, status: work.effectiveStatus, blocker: work.blocker ?? null
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

/**
 * Keep the current Markdown status table consistent with the JSON ledger.
 * Historical dated research notes are intentionally preserved verbatim.
 */
export function synchronizeMilestoneMarkdown(markdown, ledger, asOf) {
  if (!validDate(asOf)) throw new Error('判定日が不正です（YYYY-MM-DD）');
  const heading = '## 進捗（日本時間）';
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error('Markdownの進捗表がありません');
  const nextHeading = markdown.indexOf('\n## ', start + heading.length);
  const end = nextHeading < 0 ? markdown.length : nextHeading;
  const current = markdown.slice(start, end);
  const byId = new Map(ledger.milestones.map(m => [m.id, m]));
  const seen = new Set();
  const snapshot = ledger.evidenceSnapshot;
  const rows = current.replace(/^\|\s*(M[1-6])\s*\|[^\r\n]*$/gm, (line, id) => {
    const m = byId.get(id);
    const cells = line.split('|');
    if (!m || cells.length !== 7 || seen.has(id)) throw new Error('Markdownの進捗表が不正です');
    seen.add(id);
    cells[5] = ` **${m.status}** `;
    if (id === 'M2') {
      const n = snapshot.m2QualifiedFirsthandWorkflows;
      cells[4] = ` 全条件充足${n}/5（不足${Math.max(0, 5 - n)}）、対象MF月次照合${snapshot.targetMfFirsthandWorkflows}件 `;
    } else if (id === 'M4') {
      cells[4] = ` 同意済み${snapshot.consentedInterviews}/5。外部連絡は個別承認制 `;
    } else if (id === 'M5') {
      cells[4] = ` 支払意思${snapshot.specificWillingness}/3、実CSV適合 ${snapshot.realCsvCompatibilityVerified} `;
    }
    return cells.join('|');
  });
  for (const id of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']) {
    if (!seen.has(id)) throw new Error(`Markdownの進捗表に${id}がありません`);
  }
  const section = rows.replace(/\|\s*\d{4}-\d{2}-\d{2}時点の実績\s*\|/,
    `| ${asOf}時点の実績 |`);
  if (section === current && !current.includes(`${asOf}時点の実績`)) {
    throw new Error('Markdownの進捗表の日付見出しが不正です');
  }
  const content = markdown.slice(0, start) + section + markdown.slice(end);
  return {content, changed: content !== markdown};
}
