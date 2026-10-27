import {readFile} from 'node:fs/promises';
import {summarizeDemandEvidence} from '../src/demand-evidence.mjs';

const contents = await readFile(new URL('../docs/demand-evidence.json', import.meta.url), 'utf8');
const summary = summarizeDemandEvidence(JSON.parse(contents));
console.log(JSON.stringify(summary, null, 2));
