import { randomBytes } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rmdir,
  unlink,
} from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'

export const DAILY_QUOTA_LIMIT = 100
export const DAILY_QUOTA_TIME_ZONE = 'Asia/Shanghai'

const STATE_SCHEMA_VERSION = 1
const STATE_MAX_BYTES = 1_024
const STATE_KEYS = ['count', 'date', 'schemaVersion', 'timeZone']

export class DailyQuotaError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DailyQuotaError'
    this.code = code
  }
}

function quotaError(code, message) {
  return new DailyQuotaError(code, message)
}

function storageError() {
  return quotaError('DAILY_QUOTA_UNAVAILABLE', 'Daily quota storage unavailable')
}

function strictInteger(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') {
    return { value: fallback, valid: true }
  }
  const text = String(value)
  if (!/^\d+$/.test(text)) return { value: fallback, valid: false }
  const parsed = Number(text)
  return {
    value: parsed,
    valid: Number.isSafeInteger(parsed) && parsed >= min && parsed <= max,
  }
}

export function loadDailyQuotaConfig(env = process.env) {
  const limit = strictInteger(
    env.LLM_DAILY_LIMIT,
    DAILY_QUOTA_LIMIT,
    DAILY_QUOTA_LIMIT,
    DAILY_QUOTA_LIMIT,
  )
  const lockTimeoutMs = strictInteger(env.LLM_QUOTA_LOCK_TIMEOUT_MS, 2_000, 100, 30_000)
  const timeZone = String(env.LLM_QUOTA_TIME_ZONE ?? DAILY_QUOTA_TIME_ZONE).trim()
  const stateFile = String(env.LLM_QUOTA_STATE_FILE ?? '').trim()
  const valid = limit.valid
    && limit.value === DAILY_QUOTA_LIMIT
    && lockTimeoutMs.valid
    && timeZone === DAILY_QUOTA_TIME_ZONE
    && isAbsolute(stateFile)

  return {
    limit: limit.value,
    lockTimeoutMs: lockTimeoutMs.value,
    stateFile,
    timeZone,
    valid,
  }
}

function formatDateInTimeZone(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw storageError()
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date)
  const byType = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]))
  return `${byType.year}-${byType.month}-${byType.day}`
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
}

function validateConfig(config) {
  if (!config?.valid
    || config.limit !== DAILY_QUOTA_LIMIT
    || config.timeZone !== DAILY_QUOTA_TIME_ZONE
    || !isAbsolute(config.stateFile)
    || !Number.isSafeInteger(config.lockTimeoutMs)
    || config.lockTimeoutMs < 100
    || config.lockTimeoutMs > 30_000) {
    throw new TypeError('Invalid daily quota configuration')
  }
}

function parseState(bytes, config) {
  if (bytes.length < 1 || bytes.length > STATE_MAX_BYTES) throw storageError()
  let state
  try {
    state = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw storageError()
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw storageError()
  if (Object.keys(state).sort().join('\0') !== STATE_KEYS.join('\0')) throw storageError()
  if (state.schemaVersion !== STATE_SCHEMA_VERSION || state.timeZone !== config.timeZone) throw storageError()
  if (typeof state.date !== 'string' || !isCalendarDate(state.date)) throw storageError()
  if (!Number.isSafeInteger(state.count) || state.count < 0 || state.count > config.limit) throw storageError()
  return state
}

async function ensureStorageParent(stateFile) {
  let stats
  try {
    stats = await lstat(dirname(stateFile))
  } catch {
    throw storageError()
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw storageError()
}

async function readInitializedState(config) {
  let stats
  try {
    stats = await lstat(config.stateFile)
  } catch {
    throw storageError()
  }
  if (!stats.isFile()
    || stats.isSymbolicLink()
    || (stats.mode & 0o777) !== 0o600
    || stats.size < 1
    || stats.size > STATE_MAX_BYTES) {
    throw storageError()
  }
  let bytes
  try {
    bytes = await readFile(config.stateFile)
  } catch {
    throw storageError()
  }
  return parseState(bytes, config)
}

async function syncParentDirectory(stateFile) {
  let directory
  try {
    directory = await open(dirname(stateFile), 'r')
    await directory.sync()
  } catch {
    throw storageError()
  } finally {
    await directory?.close().catch(() => {})
  }
}

async function writeInitialState(config, state) {
  let handle
  try {
    handle = await open(config.stateFile, 'wx', 0o600)
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw quotaError('DAILY_QUOTA_ALREADY_INITIALIZED', 'Daily quota is already initialized')
    }
    throw storageError()
  }

  try {
    await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8')
    await handle.chmod(0o600)
    await handle.sync()
  } catch {
    throw storageError()
  } finally {
    await handle.close().catch(() => {})
  }
  await syncParentDirectory(config.stateFile)
}

async function persistReservation(config, state) {
  const temporary = `${config.stateFile}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`
  let handle
  let renamed = false
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8')
    await handle.chmod(0o600)
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporary, config.stateFile)
    renamed = true
    await chmod(config.stateFile, 0o600)
    await syncParentDirectory(config.stateFile)
  } catch (error) {
    if (error instanceof DailyQuotaError) throw error
    throw storageError()
  } finally {
    await handle?.close().catch(() => {})
    if (!renamed) await unlink(temporary).catch(() => {})
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function acquireLock(config) {
  const lockPath = `${config.stateFile}.lock`
  const deadline = Date.now() + config.lockTimeoutMs
  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 })
      return lockPath
    } catch (error) {
      if (error?.code !== 'EEXIST') throw storageError()
      if (Date.now() >= deadline) {
        throw quotaError('DAILY_QUOTA_BUSY', 'Daily quota reservation unavailable')
      }
      await wait(20)
    }
  }
}

async function releaseLock(lockPath) {
  try {
    await rmdir(lockPath)
  } catch {
    throw storageError()
  }
}

async function withLock(config, operation) {
  await ensureStorageParent(config.stateFile)
  const lockPath = await acquireLock(config)
  let result
  let operationError
  try {
    result = await operation()
  } catch (error) {
    operationError = error instanceof DailyQuotaError ? error : storageError()
  }
  try {
    await releaseLock(lockPath)
  } catch (error) {
    operationError = error
  }
  if (operationError) throw operationError
  return result
}

export function createDailyQuota(config, dependencies = {}) {
  validateConfig(config)
  const clock = dependencies.clock ?? (() => new Date())

  return {
    async inspect() {
      const date = formatDateInTimeZone(clock(), config.timeZone)
      await ensureStorageParent(config.stateFile)
      const state = await readInitializedState(config)
      if (date < state.date) {
        throw quotaError('DAILY_QUOTA_CLOCK_ROLLBACK', 'Daily quota clock moved backwards')
      }
      return {
        date: state.date,
        count: state.count,
        limit: config.limit,
        remaining: state.date === date ? config.limit - state.count : config.limit,
      }
    },

    async initialize() {
      const date = formatDateInTimeZone(clock(), config.timeZone)
      return withLock(config, async () => {
        const initial = {
          schemaVersion: STATE_SCHEMA_VERSION,
          timeZone: config.timeZone,
          date,
          count: 0,
        }
        await writeInitialState(config, initial)
        return { ...initial, limit: config.limit, remaining: config.limit }
      })
    },

    async reserve() {
      const date = formatDateInTimeZone(clock(), config.timeZone)
      return withLock(config, async () => {
        const previous = await readInitializedState(config)
        if (date < previous.date) {
          throw quotaError('DAILY_QUOTA_CLOCK_ROLLBACK', 'Daily quota clock moved backwards')
        }
        const count = previous.date === date ? previous.count : 0
        if (count >= config.limit) {
          throw quotaError('DAILY_QUOTA_EXCEEDED', 'Daily AI request quota exceeded')
        }
        const next = {
          schemaVersion: STATE_SCHEMA_VERSION,
          timeZone: config.timeZone,
          date,
          count: count + 1,
        }
        await persistReservation(config, next)
        return {
          date,
          count: next.count,
          limit: config.limit,
          remaining: config.limit - next.count,
        }
      })
    },
  }
}

export async function initializeDailyQuota(config, dependencies = {}) {
  return createDailyQuota(config, dependencies).initialize()
}
