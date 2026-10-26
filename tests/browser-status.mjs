/** Poll until the in-page E2E harness has finished, rather than snapshotting a running page. */
export async function waitForBrowserResult(readStatus, {
  timeoutMs = 35000,
  pollMs = 100,
  now = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  const deadline = now() + timeoutMs;
  let status = '';
  do {
    status = (await readStatus()) ?? '';
    if (status.startsWith('PASS:') || status.startsWith('FAIL:')) return status;
    if (now() >= deadline) break;
    await sleep(pollMs);
  } while (true);
  throw new Error(`Browser E2E timed out waiting for PASS/FAIL; last status: ${status.slice(0, 500)}`);
}
