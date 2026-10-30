import {readFile} from 'node:fs/promises';
import {buildM2GapAudit} from '../src/m2-gap-audit.mjs';

const contents = await readFile(new URL('../docs/demand-evidence.json', import.meta.url), 'utf8');
console.log(JSON.stringify(buildM2GapAudit(JSON.parse(contents)), null, 2));
