/**
 * Sandbox adapter for the shared template runtime.
 *
 * 设计:
 *   - Registry/compilation/execution are shared with the AI path
 *   - 临时接管 console.log/warn/error/info,执行完还原
 *   - 失败不抛出,把错误也作为一条 log 返回
 *
 */

import { executeTemplate } from '@/templates/runtime'
import { templateRegistry } from '@/templates/registry'

export type LogLevel = 'log' | 'warn' | 'error' | 'info'

export interface LogEntry {
  level: LogLevel
  time: number
  args: unknown[]
}

export interface RunResult {
  logs: LogEntry[]
  /** 是否抛出错误(运行时) */
  errored: boolean
  /** 错误信息 (如果有) */
  errorMsg?: string
  /** 执行耗时 ms */
  durationMs: number
}

type ConsoleSnapshot = {
  log: typeof console.log
  warn: typeof console.warn
  error: typeof console.error
  info: typeof console.info
}

interface CaptureResult {
  logs: LogEntry[]
  failed: boolean
  error?: unknown
}

function captureConsole(run: () => Promise<void>): Promise<CaptureResult> {
  const logs: LogEntry[] = []
  const orig: ConsoleSnapshot = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  }
  const wrap = (level: LogLevel) => (...args: unknown[]) => {
    logs.push({ level, time: Date.now(), args })
    // 同时打到浏览器 devtools
    ;(orig[level] as any)(...args)
  }
  console.log = wrap('log')
  console.warn = wrap('warn')
  console.error = wrap('error')
  console.info = wrap('info')

  return run().then(
    () => ({ logs, failed: false }),
    (err) => {
      // 同步 throw (如 new Function SyntaxError) 也会到这
      // 转成 log entry 保留
      const msg = err instanceof Error ? err.message : String(err)
      logs.push({ level: 'error', time: Date.now(), args: [msg] })
      return { logs, failed: true, error: err }
    },
  ).finally(() => {
    console.log = orig.log
    console.warn = orig.warn
    console.error = orig.error
    console.info = orig.info
  })
}

/**
 * Execute a registered template. AI-enabled templates take the exact strict
 * path used by PlanExecutor; demo-only API examples retain their fixed inputs.
 */
export async function runRegisteredTemplate(
  templateId: string,
  params: Record<string, unknown> = {},
): Promise<RunResult> {
  const start = performance.now()
  const logs: LogEntry[] = []

  // 用 try/catch 包住,失败也返回 logs
  try {
    const definition = templateRegistry.require(templateId)
    const validateAsAi = definition.aiEnabled === true
    const captured = await captureConsole(async () => {
      const result = await executeTemplate(templateId, params, {
        aiOnly: validateAsAi,
        validateParams: validateAsAi,
      })
      if (result !== undefined) console.log('[template result]', result)
    })
    logs.push(...captured.logs)
    if (captured.failed) {
      const err = captured.error
      const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
      return {
        logs,
        errored: true,
        errorMsg: msg,
        durationMs: performance.now() - start,
      }
    }
    logs.push({
      level: 'info',
      time: Date.now(),
      args: [`[template:${templateId}] completed`],
    })
    return {
      logs,
      errored: false,
      durationMs: performance.now() - start,
    }
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
    logs.push({ level: 'error', time: Date.now(), args: [msg] })
    return {
      logs,
      errored: true,
      errorMsg: msg,
      durationMs: performance.now() - start,
    }
  }
}

/** 序列化 log entry 用于显示 */
export function formatLog(entry: LogEntry): string {
  return entry.args
    .map((a) => {
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a, null, 2)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}
