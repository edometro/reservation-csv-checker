import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('CI checks main pushes and PRs without duplicating feature-branch pushes', () => {
  const triggerBlock = workflow.match(/^on:\s*\n([\s\S]*?)(?=^[^\s#]|\Z)/m)?.[1] ?? '';
  assert.match(triggerBlock, /^  push:\s*\n    branches:\s*\[main\]\s*$/m);
  assert.match(triggerBlock, /^  pull_request:\s*$/m);
  assert.doesNotMatch(triggerBlock, /^  push:\s*$/m, 'unrestricted push would duplicate PR runs');
});

test('only superseded PR runs are cancelled, not main-branch checks', () => {
  assert.match(workflow, /^concurrency:\s*$/m);
  assert.match(workflow, /^  group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\s*$/m);
  assert.match(workflow, /^  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}\s*$/m);
});
