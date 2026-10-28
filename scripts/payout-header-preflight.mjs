#!/usr/bin/env node
import { inspectPayoutHeaders, PayoutHeaderError } from '../src/payout-header-preflight.mjs';

const args = process.argv.slice(2);
const showHeaders = args.includes('--show-headers');
const paths = args.filter(x => x !== '--show-headers');
if (paths.length !== 2) {
  console.error('Usage: node scripts/payout-header-preflight.mjs <reservations.csv> <passes-subscriptions.csv> [--show-headers]');
  process.exitCode = 2;
} else {
  try {
    const result = await inspectPayoutHeaders(paths[0], paths[1]);
    // Default output excludes header labels, which may contain custom or sensitive text.
    if (!showHeaders) for (const entry of result.exports) delete entry.headers;
    else console.error('CAUTION: header labels may be sensitive; never paste this output into a public issue or repository.');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof PayoutHeaderError ? error.code : 'FILE_READ_FAILED');
    process.exitCode = 1;
  }
}
