import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForBrowserResult} from './browser-status.mjs';

test('browser E2E waits for an asynchronous PASS instead of accepting RUNNING', async () => {
  const states = [undefined, 'RUNNING', 'PASS: finished'];
  let reads = 0;
  const result = await waitForBrowserResult(() => { reads++; return states.shift(); }, {sleep: async () => {}});
  assert.equal(result, 'PASS: finished');
  assert.equal(reads, 3);
});

test('browser E2E preserves an in-page FAIL with its error details', async () => {
  assert.equal(await waitForBrowserResult(async () => 'FAIL: malformed CSV assertion'),
    'FAIL: malformed CSV assertion');
});

test('browser E2E times out on a permanently RUNNING page', async () => {
  let clock = 0;
  await assert.rejects(waitForBrowserResult(() => 'RUNNING', {
    timeoutMs: 30,
    pollMs: 10,
    now: () => clock,
    sleep: async ms => {clock += ms;}
  }), /last status: RUNNING/);
});
