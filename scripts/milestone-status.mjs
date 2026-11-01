import {readFile, writeFile} from 'node:fs/promises';
import {evaluateMilestones, synchronizeMilestoneLedger, synchronizeMilestoneMarkdown} from '../src/milestone-progress.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
const asOfIndex = args.indexOf('--as-of');
if (args.some((arg, i) => !['--write', '--as-of'].includes(arg) && i !== asOfIndex + 1) ||
    (asOfIndex >= 0 && !args[asOfIndex + 1])) {
  throw new Error('使用法: npm run milestones -- [--as-of YYYY-MM-DD] [--write]');
}
const asOf = asOfIndex >= 0 ? args[asOfIndex + 1] : new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
const ledgerUrl = new URL('../docs/milestones.json', import.meta.url);
const [ledger, registry, markdown] = await Promise.all([
  readFile(ledgerUrl, 'utf8').then(JSON.parse),
  readFile(new URL('../docs/demand-evidence.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../docs/MILESTONES.md', import.meta.url), 'utf8')
]);
const evaluation = evaluateMilestones(ledger, registry, asOf);
const {updated, changed} = synchronizeMilestoneLedger(ledger, evaluation);
const markdownSync = synchronizeMilestoneMarkdown(markdown, updated, asOf);
if (write && changed) await writeFile(ledgerUrl, JSON.stringify(updated, null, 2) + '\n');
if (write && markdownSync.changed) await writeFile(new URL('../docs/MILESTONES.md', import.meta.url), markdownSync.content);
console.log(JSON.stringify({asOf, decision: evaluation.decision, evidence: evaluation.snapshot,
  milestones: evaluation.milestones.map(m => ({id: m.id, dueDate: m.dueDate, stored: m.status, effective: m.effectiveStatus})),
  nextDue: evaluation.nextDue, nextUpcomingDue: evaluation.nextUpcomingDue, nextWork: evaluation.nextWork, drift: evaluation.drift, ledgerUpdated: write && changed, markdownUpdated: write && markdownSync.changed}, null, 2));
