import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { constants as osConstants } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
export const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')
export const DEFAULT_MANIFEST_PATH = path.join(PROJECT_ROOT, 'src/model-manifest.json')

const nodeScript = (name) => path.join(PROJECT_ROOT, 'scripts', name)
const localBin = (...parts) => path.join(PROJECT_ROOT, 'node_modules', ...parts)
const nodeCommand = (name, file, args = []) =>
  Object.freeze({ name, command: process.execPath, args: Object.freeze([file, ...args]) })

export const R1_COMMANDS = Object.freeze([
  nodeCommand('test:topology', nodeScript('test-topology.mjs')),
  nodeCommand('test:topology-sidecar', nodeScript('test-topology-sidecar.mjs')),
  nodeCommand(
    'test:topology-scene-lifecycle',
    nodeScript('test-topology-scene-lifecycle.mjs'),
  ),
  nodeCommand('test:topology-quick-action', nodeScript('test-topology-quick-action.mjs')),
  nodeCommand('test:templates-v3', nodeScript('test-template-v3.mjs')),
  nodeCommand('audit:topology-boundary', nodeScript('audit-topology-boundary.mjs')),
  nodeCommand('audit:templates', nodeScript('audit-template-schema.mjs')),
  nodeCommand('audit:ai-boundary', nodeScript('audit-ai-boundary.mjs')),
  nodeCommand('typecheck', localBin('vue-tsc', 'bin', 'vue-tsc.js'), ['--noEmit']),
  nodeCommand('build', localBin('vite', 'bin', 'vite.js'), ['build']),
])

const GIT_STATUS_ARGS = Object.freeze([
  '--no-optional-locks',
  'status',
  '--porcelain=v2',
  '--branch',
  '--show-stash',
  '--untracked-files=all',
  '-z',
])

export const MAX_GIT_PORCELAIN_BYTES = 16 * 1024 * 1024
export const MAX_COLLECTED_STDERR_BYTES = 64 * 1024

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function limitedMessage(value, limit = 600) {
  const text = value instanceof Error ? value.message : String(value)
  return text.replace(/[\r\n]+/g, ' ').slice(0, limit)
}

function signalExitCode(signal) {
  const signalNumber = osConstants.signals?.[signal]
  return typeof signalNumber === 'number' ? 128 + signalNumber : 1
}

export function collectCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const stdoutLimitBytes = options.stdoutLimitBytes ?? MAX_GIT_PORCELAIN_BYTES
    const stderrLimitBytes = options.stderrLimitBytes ?? MAX_COLLECTED_STDERR_BYTES
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let stdoutLength = 0
    let stderrLength = 0
    let stdoutExceeded = false
    let stderrTruncated = false
    let settled = false

    child.stdout.on('data', (chunk) => {
      if (stdoutExceeded) return
      const bytes = Buffer.from(chunk)
      const remaining = stdoutLimitBytes - stdoutLength
      if (bytes.length > remaining) {
        if (remaining > 0) stdout.push(bytes.subarray(0, remaining))
        stdoutLength = stdoutLimitBytes
        stdoutExceeded = true
        child.kill('SIGTERM')
        return
      }
      stdout.push(bytes)
      stdoutLength += bytes.length
    })
    child.stderr.on('data', (chunk) => {
      if (stderrTruncated) return
      const bytes = Buffer.from(chunk)
      const remaining = stderrLimitBytes - stderrLength
      if (bytes.length > remaining) {
        if (remaining > 0) stderr.push(bytes.subarray(0, remaining))
        stderrLength = stderrLimitBytes
        stderrTruncated = true
        return
      }
      stderr.push(bytes)
      stderrLength += bytes.length
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      const stderrBytes = Buffer.concat(stderr)
      if (stdoutExceeded) {
        reject(new Error(`${command} stdout exceeded ${String(stdoutLimitBytes)} bytes`))
        return
      }
      if (stderrTruncated) {
        const detail = limitedMessage(stderrBytes.toString('utf8'))
        reject(
          new Error(
            `${command} stderr exceeded ${String(stderrLimitBytes)} bytes (${signal === null ? `exit ${String(code)}` : `signal ${signal}`})${detail ? `: ${detail}` : ''} [stderr truncated]`,
          ),
        )
        return
      }
      if (code !== 0 || signal !== null) {
        const detail = limitedMessage(stderrBytes.toString('utf8'))
        reject(
          new Error(
            `${command} failed (${signal === null ? `exit ${String(code)}` : `signal ${signal}`})${detail ? `: ${detail}` : ''}`,
          ),
        )
        return
      }
      resolve(Buffer.concat(stdout))
    })
  })
}

export async function captureIntegritySnapshot({
  repoRoot = PROJECT_ROOT,
  manifestPath = path.join(repoRoot, 'src/model-manifest.json'),
} = {}) {
  const manifestBytes = await readFile(manifestPath)
  const porcelainBytes = await collectCommand('git', GIT_STATUS_ARGS, {
    cwd: repoRoot,
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
    },
  })

  return {
    manifestBytes,
    manifestSha256: sha256Hex(manifestBytes),
    porcelainBytes,
    porcelainSha256: sha256Hex(porcelainBytes),
  }
}

export function compareIntegritySnapshots(before, after) {
  return {
    manifestUnchanged: before.manifestBytes.equals(after.manifestBytes),
    porcelainUnchanged: before.porcelainBytes.equals(after.porcelainBytes),
  }
}

function executeStep(step, { repoRoot, signalState }) {
  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      cwd: repoRoot,
      env: process.env,
      shell: false,
      stdio: 'inherit',
    })
    signalState.activeChild = child
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      if (signalState.activeChild === child) signalState.activeChild = null
      resolve(result)
    }

    child.once('error', (error) => {
      finish({ exitCode: 127, signal: null, error })
    })
    child.once('close', (code, signal) => {
      finish({
        exitCode: signal === null ? (code ?? 1) : signalExitCode(signal),
        signal,
        error: null,
      })
    })
  })
}

function installSignalForwarding(signalState, logger) {
  const handlers = new Map()
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => {
      if (signalState.received === null) {
        signalState.received = signal
        logger.error(`[verify:r1] received ${signal}; stopping after integrity verification`)
      }
      const child = signalState.activeChild
      if (child && child.exitCode === null && child.signalCode === null) {
        try {
          child.kill(signal)
        } catch (error) {
          logger.error(`[verify:r1] could not forward ${signal}: ${limitedMessage(error)}`)
        }
      }
    }
    process.on(signal, handler)
    handlers.set(signal, handler)
  }
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler)
  }
}

export async function runVerification({
  repoRoot = PROJECT_ROOT,
  manifestPath = path.join(repoRoot, 'src/model-manifest.json'),
  steps = R1_COMMANDS,
  logger = console,
  handleSignals = true,
} = {}) {
  let before = null
  let after = null
  let commandFailure = null
  let internalFailure = null
  const signalState = { activeChild: null, received: null }
  const removeSignalHandlers = handleSignals
    ? installSignalForwarding(signalState, logger)
    : () => {}

  try {
    before = await captureIntegritySnapshot({ repoRoot, manifestPath })
    logger.log(`[verify:r1] manifest before sha256=${before.manifestSha256}`)
    logger.log(`[verify:r1] git porcelain before sha256=${before.porcelainSha256}`)

    for (let index = 0; index < steps.length; index += 1) {
      if (signalState.received !== null) break
      const step = steps[index]
      logger.log(`[verify:r1] RUN ${String(index + 1)}/${String(steps.length)} ${step.name}`)
      const result = await executeStep(step, { repoRoot, signalState })
      if (result.exitCode !== 0) {
        commandFailure = { step: step.name, ...result }
        const detail = result.error ? `: ${limitedMessage(result.error)}` : ''
        logger.error(
          `[verify:r1] FAIL ${step.name} (exit ${String(result.exitCode)})${detail}`,
        )
        break
      }
      logger.log(`[verify:r1] PASS ${step.name}`)
    }
  } catch (error) {
    internalFailure = error
    logger.error(`[verify:r1] gate error: ${limitedMessage(error)}`)
  } finally {
    try {
      if (before !== null) {
        after = await captureIntegritySnapshot({ repoRoot, manifestPath })
        logger.log(`[verify:r1] manifest after sha256=${after.manifestSha256}`)
        logger.log(`[verify:r1] git porcelain after sha256=${after.porcelainSha256}`)
      }
    } catch (error) {
      internalFailure ??= error
      logger.error(`[verify:r1] final integrity snapshot failed: ${limitedMessage(error)}`)
    }
    removeSignalHandlers()
  }

  let integrity = null
  if (before !== null && after !== null) {
    integrity = compareIntegritySnapshots(before, after)
    if (!integrity.manifestUnchanged) {
      logger.error('[verify:r1] manifest bytes changed; no restore or overwrite was attempted')
    }
    if (!integrity.porcelainUnchanged) {
      logger.error('[verify:r1] git porcelain changed; no reset, staging, or cleanup was attempted')
    }
  }

  const integrityFailed =
    integrity === null || !integrity.manifestUnchanged || !integrity.porcelainUnchanged
  let exitCode = 0
  if (commandFailure !== null) {
    exitCode = commandFailure.exitCode
  } else if (signalState.received !== null) {
    exitCode = signalExitCode(signalState.received)
  } else if (internalFailure !== null) {
    exitCode = 2
  } else if (integrityFailed) {
    exitCode = 1
  }

  if (exitCode === 0) {
    logger.log('[verify:r1] PASS all commands; manifest bytes and git porcelain are unchanged')
  } else {
    logger.error(`[verify:r1] FAILED (exit ${String(exitCode)})`)
  }

  return {
    exitCode,
    commandFailure,
    internalFailure,
    integrity,
    before: before === null
      ? null
      : {
          manifestSha256: before.manifestSha256,
          porcelainSha256: before.porcelainSha256,
        },
    after: after === null
      ? null
      : {
          manifestSha256: after.manifestSha256,
          porcelainSha256: after.porcelainSha256,
        },
  }
}

async function main() {
  if (process.argv.length !== 2) {
    console.error('[verify:r1] this command does not accept arguments')
    process.exitCode = 2
    return
  }
  const result = await runVerification()
  process.exitCode = result.exitCode
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isMain) {
  main().catch((error) => {
    console.error(`[verify:r1] fatal: ${limitedMessage(error)}`)
    process.exitCode = 2
  })
}
