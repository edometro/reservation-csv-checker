import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('CI checks main pushes and PRs without duplicating feature-branch pushes', () => {
  const triggerBlock = workflow.split(/^concurrency:/m)[0];
  assert.match(triggerBlock, /^on:[ \t]*$/m);
  assert.match(triggerBlock, /^  push:[ \t]*\n    branches:[ \t]*\[main\][ \t]*$/m);
  assert.match(triggerBlock, /^  pull_request:[ \t]*$/m);
});

test('only superseded PR runs are cancelled, not main-branch checks', () => {
  assert.match(workflow, /^concurrency:[ \t]*$/m);
  assert.match(workflow, /^  group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}[ \t]*$/m);
  assert.match(workflow, /^  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}[ \t]*$/m);
});
