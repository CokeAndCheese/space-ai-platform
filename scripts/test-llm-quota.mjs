import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDailyQuota,
  DAILY_QUOTA_LIMIT,
  DAILY_QUOTA_TIME_ZONE,
  initializeDailyQuota,
  loadDailyQuotaConfig,
} from '../server/llm-quota.mjs'

const DAY_ONE = '2026-09-10T15:59:00.000Z'
const DAY_TWO = '2026-09-10T16:01:00.000Z'
const quotaModuleUrl = new URL('../server/llm-quota.mjs', import.meta.url).href
const temporaryRoot = await mkdtemp(join(tmpdir(), 'space-ai-quota-test-'))
let passed = 0

function quotaConfig(stateFile, overrides = {}) {
  return {
    limit: DAILY_QUOTA_LIMIT,
    lockTimeoutMs: 2_000,
    stateFile,
    timeZone: DAILY_QUOTA_TIME_ZONE,
    valid: true,
    ...overrides,
  }
}

function fixedClock(value) {
  return () => new Date(value)
}

async function makeFixture(name) {
  const directory = join(temporaryRoot, name)
  await mkdir(directory, { mode: 0o700 })
  return {
    directory,
    stateFile: join(directory, 'daily-quota.json'),
  }
}

async function expectQuotaError(action, code) {
  let caught
  try {
    await action()
  } catch (error) {
    caught = error
  }
  assert.ok(caught, `Expected ${code}`)
  assert.equal(caught.code, code)
  assert.ok(!caught.message.includes(temporaryRoot), 'error must not disclose the storage path')
  return caught
}

async function check(name, action) {
  await action()
  passed += 1
  process.stdout.write(`ok ${passed} - ${name}\n`)
}

async function readState(stateFile) {
  return JSON.parse(await readFile(stateFile, 'utf8'))
}

async function writeState(stateFile, state) {
  await writeFile(stateFile, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(stateFile, 0o600)
}

function validState(overrides = {}) {
  return {
    schemaVersion: 1,
    timeZone: DAILY_QUOTA_TIME_ZONE,
    date: '2026-09-10',
    count: 0,
    ...overrides,
  }
}

function runQuotaWorker(stateFile, attempts) {
  const source = `
    import { createDailyQuota } from ${JSON.stringify(quotaModuleUrl)}
    const quota = createDailyQuota({
      limit: 100,
      lockTimeoutMs: 20000,
      stateFile: process.env.QUOTA_STATE_FILE,
      timeZone: 'Asia/Shanghai',
      valid: true,
    }, { clock: () => new Date(process.env.QUOTA_CLOCK) })
    let success = 0
    let exceeded = 0
    let other = 0
    for (let index = 0; index < Number(process.env.QUOTA_ATTEMPTS); index += 1) {
      try {
        await quota.reserve()
        success += 1
      } catch (error) {
        if (error?.code === 'DAILY_QUOTA_EXCEEDED') exceeded += 1
        else other += 1
      }
    }
    process.stdout.write(JSON.stringify({ success, exceeded, other }))
  `

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
      env: {
        QUOTA_ATTEMPTS: String(attempts),
        QUOTA_CLOCK: DAY_ONE,
        QUOTA_STATE_FILE: stateFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`quota worker exited ${code}: ${Buffer.concat(stderr).toString('utf8').slice(0, 500)}`))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')))
      } catch {
        reject(new Error('quota worker returned invalid output'))
      }
    })
  })
}

try {
  await check('configuration is fixed to 100/day, Shanghai, and an absolute state path', async () => {
    const fixture = await makeFixture('config')
    const defaults = loadDailyQuotaConfig({ LLM_QUOTA_STATE_FILE: fixture.stateFile })
    assert.equal(defaults.valid, true)
    assert.equal(defaults.limit, 100)
    assert.equal(defaults.timeZone, 'Asia/Shanghai')
    for (const env of [
      {},
      { LLM_QUOTA_STATE_FILE: 'relative.json' },
      { LLM_QUOTA_STATE_FILE: fixture.stateFile, LLM_DAILY_LIMIT: '101' },
      { LLM_QUOTA_STATE_FILE: fixture.stateFile, LLM_DAILY_LIMIT: 'unlimited' },
      { LLM_QUOTA_STATE_FILE: fixture.stateFile, LLM_QUOTA_TIME_ZONE: 'UTC' },
      { LLM_QUOTA_STATE_FILE: fixture.stateFile, LLM_QUOTA_LOCK_TIMEOUT_MS: '0' },
    ]) {
      const candidate = loadDailyQuotaConfig(env)
      assert.equal(candidate.valid, false)
      assert.throws(() => createDailyQuota(candidate), TypeError)
    }
  })

  await check('reserve fails closed when state is missing and does not initialize it', async () => {
    const fixture = await makeFixture('missing')
    const quota = createDailyQuota(quotaConfig(fixture.stateFile), { clock: fixedClock(DAY_ONE) })
    await expectQuotaError(() => quota.reserve(), 'DAILY_QUOTA_UNAVAILABLE')
    await assert.rejects(access(fixture.stateFile))
    assert.deepEqual(await readdir(fixture.directory), [])
  })

  await check('explicit initialize creates a durable mode-0600 zero state', async () => {
    const fixture = await makeFixture('initialize')
    const initialized = await initializeDailyQuota(
      quotaConfig(fixture.stateFile),
      { clock: fixedClock(DAY_ONE) },
    )
    assert.equal(initialized.date, '2026-09-10')
    assert.equal(initialized.count, 0)
    assert.equal(initialized.remaining, 100)
    assert.equal((await lstat(fixture.stateFile)).mode & 0o777, 0o600)
    assert.deepEqual(await readState(fixture.stateFile), validState())
  })

  await check('initialize uses exclusive create and never overwrites an existing state', async () => {
    const fixture = await makeFixture('initialize-exclusive')
    const quota = createDailyQuota(quotaConfig(fixture.stateFile), { clock: fixedClock(DAY_ONE) })
    await quota.initialize()
    const before = await readFile(fixture.stateFile)
    await expectQuotaError(() => quota.initialize(), 'DAILY_QUOTA_ALREADY_INITIALIZED')
    assert.deepEqual(await readFile(fixture.stateFile), before)
  })

  await check('inspect reports health without consuming or rewriting quota', async () => {
    const fixture = await makeFixture('inspect')
    const quota = createDailyQuota(quotaConfig(fixture.stateFile), { clock: fixedClock(DAY_ONE) })
    await quota.initialize()
    await quota.reserve()
    const before = await readFile(fixture.stateFile)
    const status = await quota.inspect()
    assert.equal(status.count, 1)
    assert.equal(status.remaining, 99)
    assert.deepEqual(await readFile(fixture.stateFile), before)
  })

  await check('exactly 100 reservations succeed and reservation 101 is rejected', async () => {
    const fixture = await makeFixture('limit')
    const quota = createDailyQuota(quotaConfig(fixture.stateFile, { lockTimeoutMs: 10_000 }), { clock: fixedClock(DAY_ONE) })
    await quota.initialize()
    for (let count = 1; count <= 100; count += 1) {
      const reservation = await quota.reserve()
      assert.equal(reservation.count, count)
      assert.equal(reservation.remaining, 100 - count)
    }
    const before = await readFile(fixture.stateFile)
    await expectQuotaError(() => quota.reserve(), 'DAILY_QUOTA_EXCEEDED')
    assert.deepEqual(await readFile(fixture.stateFile), before)
  })

  await check('a recreated quota instance preserves the persisted count', async () => {
    const fixture = await makeFixture('restart')
    const config = quotaConfig(fixture.stateFile)
    const first = createDailyQuota(config, { clock: fixedClock(DAY_ONE) })
    await first.initialize()
    await first.reserve()
    await first.reserve()
    const afterRestart = createDailyQuota(config, { clock: fixedClock(DAY_ONE) })
    assert.equal((await afterRestart.reserve()).count, 3)
    assert.equal((await readState(fixture.stateFile)).count, 3)
  })

  await check('Asia/Shanghai midnight starts the next daily counter', async () => {
    const fixture = await makeFixture('day-boundary')
    const config = quotaConfig(fixture.stateFile)
    const dayOne = createDailyQuota(config, { clock: fixedClock(DAY_ONE) })
    await dayOne.initialize()
    assert.equal((await dayOne.reserve()).count, 1)
    const dayTwo = createDailyQuota(config, { clock: fixedClock(DAY_TWO) })
    const reservation = await dayTwo.reserve()
    assert.equal(reservation.date, '2026-09-11')
    assert.equal(reservation.count, 1)
  })

  await check('calendar rollback fails closed without changing the state', async () => {
    const fixture = await makeFixture('rollback')
    const config = quotaConfig(fixture.stateFile)
    const dayTwo = createDailyQuota(config, { clock: fixedClock(DAY_TWO) })
    await dayTwo.initialize()
    await dayTwo.reserve()
    const before = await readFile(fixture.stateFile)
    const rolledBack = createDailyQuota(config, { clock: fixedClock(DAY_ONE) })
    await expectQuotaError(() => rolledBack.reserve(), 'DAILY_QUOTA_CLOCK_ROLLBACK')
    assert.deepEqual(await readFile(fixture.stateFile), before)
  })

  await check('concurrent in-process instances share one atomic 100-count ceiling', async () => {
    const fixture = await makeFixture('multi-instance')
    const config = quotaConfig(fixture.stateFile, { lockTimeoutMs: 20_000 })
    await createDailyQuota(config, { clock: fixedClock(DAY_ONE) }).initialize()
    const quotas = Array.from({ length: 6 }, () => createDailyQuota(config, { clock: fixedClock(DAY_ONE) }))
    const outcomes = await Promise.all(Array.from({ length: 120 }, async (_, index) => {
      try {
        await quotas[index % quotas.length].reserve()
        return 'success'
      } catch (error) {
        return error?.code
      }
    }))
    assert.equal(outcomes.filter((value) => value === 'success').length, 100)
    assert.equal(outcomes.filter((value) => value === 'DAILY_QUOTA_EXCEEDED').length, 20)
    assert.equal((await readState(fixture.stateFile)).count, 100)
  })

  await check('concurrent child processes cannot reserve more than 100 total', async () => {
    const fixture = await makeFixture('multi-process')
    const config = quotaConfig(fixture.stateFile, { lockTimeoutMs: 20_000 })
    await createDailyQuota(config, { clock: fixedClock(DAY_ONE) }).initialize()
    const results = await Promise.all(Array.from({ length: 5 }, () => runQuotaWorker(fixture.stateFile, 25)))
    assert.equal(results.reduce((sum, result) => sum + result.success, 0), 100)
    assert.equal(results.reduce((sum, result) => sum + result.exceeded, 0), 25)
    assert.equal(results.reduce((sum, result) => sum + result.other, 0), 0)
    assert.equal((await readState(fixture.stateFile)).count, 100)
  })

  await check('partial or malformed state fails closed and is not replaced', async () => {
    const fixture = await makeFixture('partial')
    await writeFile(fixture.stateFile, '{"schemaVersion":1', { encoding: 'utf8', mode: 0o600 })
    await chmod(fixture.stateFile, 0o600)
    const before = await readFile(fixture.stateFile)
    const quota = createDailyQuota(quotaConfig(fixture.stateFile), { clock: fixedClock(DAY_ONE) })
    const error = await expectQuotaError(() => quota.reserve(), 'DAILY_QUOTA_UNAVAILABLE')
    assert.ok(!error.message.includes('schemaVersion'))
    assert.deepEqual(await readFile(fixture.stateFile), before)
  })

  await check('oversized state is rejected before it is read or replaced', async () => {
    const fixture = await makeFixture('oversized-state')
    await writeFile(fixture.stateFile, 'x'.repeat(1_025), { encoding: 'utf8', mode: 0o600 })
    await chmod(fixture.stateFile, 0o600)
    const before = await readFile(fixture.stateFile)
    const quota = createDailyQuota(quotaConfig(fixture.stateFile), { clock: fixedClock(DAY_ONE) })
    await expectQuotaError(() => quota.reserve(), 'DAILY_QUOTA_UNAVAILABLE')
    assert.deepEqual(await readFile(fixture.stateFile), before)
  })

  await check('invalid schema, date, count, and extra fields all fail closed', async () => {
    const fixture = await makeFixture('invalid-state')
    const quota = createDailyQuota(quotaConfig(fixture.stateFile), { clock: fixedClock(DAY_ONE) })
    for (const state of [
      validState({ schemaVersion: 2 }),
      validState({ date: '2026-02-30' }),
      validState({ count: 101 }),
      validState({ count: -1 }),
      { ...validState(), unexpected: true },
    ]) {
      await writeState(fixture.stateFile, state)
      const before = await readFile(fixture.stateFile)
      await expectQuotaError(() => quota.reserve(), 'DAILY_QUOTA_UNAVAILABLE')
      assert.deepEqual(await readFile(fixture.stateFile), before)
    }
  })

  await check('symbolic-link and permissive-mode states are rejected', async () => {
    const fixture = await makeFixture('state-file-safety')
    const target = join(fixture.directory, 'target.json')
    await writeState(target, validState())
    await symlink(target, fixture.stateFile)
    const linkedQuota = createDailyQuota(quotaConfig(fixture.stateFile), { clock: fixedClock(DAY_ONE) })
    await expectQuotaError(() => linkedQuota.reserve(), 'DAILY_QUOTA_UNAVAILABLE')

    const modeFixture = await makeFixture('state-mode')
    await writeState(modeFixture.stateFile, validState())
    await chmod(modeFixture.stateFile, 0o644)
    const modeQuota = createDailyQuota(quotaConfig(modeFixture.stateFile), { clock: fixedClock(DAY_ONE) })
    await expectQuotaError(() => modeQuota.reserve(), 'DAILY_QUOTA_UNAVAILABLE')
  })

  await check('an existing lock times out without breaking or mutating it', async () => {
    const fixture = await makeFixture('locked')
    const config = quotaConfig(fixture.stateFile, { lockTimeoutMs: 100 })
    const quota = createDailyQuota(config, { clock: fixedClock(DAY_ONE) })
    await quota.initialize()
    const before = await readFile(fixture.stateFile)
    await mkdir(`${fixture.stateFile}.lock`, { mode: 0o700 })
    await expectQuotaError(() => quota.reserve(), 'DAILY_QUOTA_BUSY')
    assert.deepEqual(await readFile(fixture.stateFile), before)
    assert.equal((await lstat(`${fixture.stateFile}.lock`)).isDirectory(), true)
  })

  await check('unwritable storage fails closed and preserves the last state', async () => {
    const fixture = await makeFixture('unwritable')
    const quota = createDailyQuota(quotaConfig(fixture.stateFile), { clock: fixedClock(DAY_ONE) })
    await quota.initialize()
    const before = await readFile(fixture.stateFile)
    await chmod(fixture.directory, 0o500)
    try {
      await expectQuotaError(() => quota.reserve(), 'DAILY_QUOTA_UNAVAILABLE')
    } finally {
      await chmod(fixture.directory, 0o700)
    }
    assert.deepEqual(await readFile(fixture.stateFile), before)
  })

  assert.equal(passed, 17)
  console.log(`LLM daily quota tests: ${passed}/${passed} passed`)
} finally {
  await chmod(temporaryRoot, 0o700).catch(() => {})
  await rm(temporaryRoot, { force: true, recursive: true })
}
