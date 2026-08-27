import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  PROJECT_ROOT,
  R1_COMMANDS,
  captureIntegritySnapshot,
  collectCommand,
  compareIntegritySnapshots,
  runVerification,
} from './verify-r1-local.mjs'

const quietLogger = { log() {}, error() {} }

function run(command, args, cwd) {
  return collectCommand(command, args, {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
  })
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'space-ai-r1-gate-'))
  const src = path.join(root, 'src')
  await mkdir(src, { recursive: true })
  const manifestPath = path.join(src, 'model-manifest.json')
  await writeFile(manifestPath, '{"owner":"baseline"}\n', 'utf8')
  await writeFile(path.join(root, 'tracked.txt'), 'tracked\n', 'utf8')
  await run('git', ['init', '--quiet'], root)
  await run('git', ['add', 'src/model-manifest.json', 'tracked.txt'], root)
  await writeFile(manifestPath, '{"owner":"user-dirty"}\n', 'utf8')
  return { root, manifestPath }
}

async function withFixture(test) {
  const fixture = await createFixture()
  try {
    await test(fixture)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
}

const nodeStep = (name, source, args = []) => ({
  name,
  command: process.execPath,
  args: ['-e', source, ...args],
})

const packageJson = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8'))
assert.equal(packageJson.scripts.predev, undefined)
assert.equal(packageJson.scripts.prebuild, undefined)
assert.equal(packageJson.scripts['list-models'], 'node scripts/list-models.mjs')
assert.equal(packageJson.scripts.dev, 'vite')
assert.equal(packageJson.scripts.build, 'vue-tsc --noEmit && vite build')
assert.equal(packageJson.scripts['verify:r1'], 'node scripts/verify-r1-local.mjs')
assert.deepEqual(
  R1_COMMANDS.map((step) => step.name),
  [
    'test:topology',
    'test:topology-sidecar',
    'test:topology-scene-lifecycle',
    'test:topology-quick-action',
    'test:templates-v3',
    'audit:topology-boundary',
    'audit:templates',
    'audit:ai-boundary',
    'typecheck',
    'build',
  ],
)

await assert.rejects(
  collectCommand(
    process.execPath,
    ['-e', "process.stdout.write('x'.repeat(4096))"],
    {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 256,
    },
  ),
  /stdout exceeded 1024 bytes/,
)

await assert.rejects(
  collectCommand(
    process.execPath,
    ['-e', "process.stderr.write('x'.repeat(4096)); process.exit(9)"],
    {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 256,
    },
  ),
  (error) => {
    assert.equal(error instanceof Error, true)
    assert.match(error.message, /exit 9/)
    assert.match(error.message, /\[stderr truncated\]/)
    assert.equal(error.message.length < 1000, true)
    return true
  },
)

await assert.rejects(
  collectCommand(
    process.execPath,
    ['-e', "process.stderr.write('x'.repeat(4096)); process.exit(0)"],
    {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 256,
    },
  ),
  (error) => {
    assert.equal(error instanceof Error, true)
    assert.match(error.message, /stderr exceeded 256 bytes \(exit 0\)/)
    assert.match(error.message, /\[stderr truncated\]/)
    assert.equal(error.message.length < 1000, true)
    return true
  },
)
assert.equal(R1_COMMANDS.every((step) => step.command === process.execPath), true)
assert.deepEqual(
  R1_COMMANDS.map((step) => step.args),
  [
    [path.join(PROJECT_ROOT, 'scripts/test-topology.mjs')],
    [path.join(PROJECT_ROOT, 'scripts/test-topology-sidecar.mjs')],
    [path.join(PROJECT_ROOT, 'scripts/test-topology-scene-lifecycle.mjs')],
    [path.join(PROJECT_ROOT, 'scripts/test-topology-quick-action.mjs')],
    [path.join(PROJECT_ROOT, 'scripts/test-template-v3.mjs')],
    [path.join(PROJECT_ROOT, 'scripts/audit-topology-boundary.mjs')],
    [path.join(PROJECT_ROOT, 'scripts/audit-template-schema.mjs')],
    [path.join(PROJECT_ROOT, 'scripts/audit-ai-boundary.mjs')],
    [path.join(PROJECT_ROOT, 'node_modules/vue-tsc/bin/vue-tsc.js'), '--noEmit'],
    [path.join(PROJECT_ROOT, 'node_modules/vite/bin/vite.js'), 'build'],
  ],
)

await withFixture(async ({ root, manifestPath }) => {
  const before = await captureIntegritySnapshot({ repoRoot: root, manifestPath })
  const after = await captureIntegritySnapshot({ repoRoot: root, manifestPath })
  assert.deepEqual(compareIntegritySnapshots(before, after), {
    manifestUnchanged: true,
    porcelainUnchanged: true,
  })

  const result = await runVerification({
    repoRoot: root,
    manifestPath,
    steps: [nodeStep('success', 'process.exit(0)')],
    logger: quietLogger,
    handleSignals: false,
  })
  assert.equal(result.exitCode, 0)
  assert.deepEqual(result.integrity, {
    manifestUnchanged: true,
    porcelainUnchanged: true,
  })
})

await withFixture(async ({ root, manifestPath }) => {
  const markerPath = path.join(root, 'must-not-run.txt')
  const result = await runVerification({
    repoRoot: root,
    manifestPath,
    steps: [
      nodeStep('failure', 'process.exit(7)'),
      nodeStep(
        'later-step',
        "require('node:fs').writeFileSync(process.argv[1], 'unexpected')",
        [markerPath],
      ),
    ],
    logger: quietLogger,
    handleSignals: false,
  })
  assert.equal(result.exitCode, 7)
  await assert.rejects(readFile(markerPath))
  assert.deepEqual(result.integrity, {
    manifestUnchanged: true,
    porcelainUnchanged: true,
  })
})

await withFixture(async ({ root, manifestPath }) => {
  const result = await runVerification({
    repoRoot: root,
    manifestPath,
    steps: [
      nodeStep(
        'mutate-manifest',
        "require('node:fs').writeFileSync(process.argv[1], 'changed\\n')",
        [manifestPath],
      ),
    ],
    logger: quietLogger,
    handleSignals: false,
  })
  assert.equal(result.exitCode, 1)
  assert.equal(result.integrity?.manifestUnchanged, false)
  assert.equal(await readFile(manifestPath, 'utf8'), 'changed\n')
})

await withFixture(async ({ root, manifestPath }) => {
  const untrackedPath = path.join(root, 'created-by-command.txt')
  const result = await runVerification({
    repoRoot: root,
    manifestPath,
    steps: [
      nodeStep(
        'mutate-status',
        "require('node:fs').writeFileSync(process.argv[1], 'created\\n')",
        [untrackedPath],
      ),
    ],
    logger: quietLogger,
    handleSignals: false,
  })
  assert.equal(result.exitCode, 1)
  assert.equal(result.integrity?.manifestUnchanged, true)
  assert.equal(result.integrity?.porcelainUnchanged, false)
})

await withFixture(async ({ root, manifestPath }) => {
  const markerPath = path.join(root, 'must-not-run-after-pollution.txt')
  const result = await runVerification({
    repoRoot: root,
    manifestPath,
    steps: [
      nodeStep(
        'mutate-and-fail',
        "require('node:fs').writeFileSync(process.argv[1], 'changed-before-failure\\n'); process.exit(7)",
        [manifestPath],
      ),
      nodeStep(
        'later-step',
        "require('node:fs').writeFileSync(process.argv[1], 'unexpected')",
        [markerPath],
      ),
    ],
    logger: quietLogger,
    handleSignals: false,
  })
  assert.equal(result.exitCode, 7)
  assert.equal(result.integrity?.manifestUnchanged, false)
  assert.equal(await readFile(manifestPath, 'utf8'), 'changed-before-failure\n')
  await assert.rejects(readFile(markerPath))
})

console.log('[verify:r1:test] package wiring plus 5 integrity and 3 bounded-output tests passed')
