import {readFile} from 'node:fs/promises';
import {buildM3GapAudit} from '../src/m3-gap-audit.mjs';

const ledger = JSON.parse(await readFile(new URL('../docs/milestones.json', import.meta.url), 'utf8'));
const asOf = process.argv[2] ?? new Date().toLocaleDateString('sv-SE', {timeZone: 'Asia/Tokyo'});
console.log(JSON.stringify(buildM3GapAudit(ledger, asOf), null, 2));
