#!/usr/bin/env node
import { inspectPayoutKeyCandidates, PayoutKeyPreflightError } from '../src/payout-key-preflight.mjs';

const args = process.argv.slice(2);
if (args.length !== 4) {
  console.error('Usage: node scripts/payout-key-preflight.mjs <reservations.csv> <passes.csv> <reservation-key-column> <passes-key-column>');
  process.exitCode = 2;
} else {
  try {
    console.log(JSON.stringify(await inspectPayoutKeyCandidates(...args), null, 2));
  } catch (error) {
    console.error(error instanceof PayoutKeyPreflightError ? error.code : 'PREFLIGHT_FAILED');
    process.exitCode = 1;
  }
}
