/**
 * IntentLogger —— 把每次 AI 调用记录到 localStorage (最多 100 条)
 *
 * 受 Hermes 启发: AI 层的 audit 显式 hook, 不靠 LLM 自报.
 */

import type { Intent } from '../types/Intent'

// v2 intentionally does not replay legacy action/skill intents.
const STORAGE_KEY = 'ai_template_log_v2'
const MAX_ENTRIES = 100

export interface IntentLogEntry {
  id: string
  timestamp: number
  query: string
  intent?: Intent
  rawContent?: string
  thinking?: string
  /** 'llm' | 'fallback' | 'mock' | 'user-edit' */
  source: 'llm' | 'fallback' | 'mock' | 'user-edit'
  errored: boolean
  errorMsg?: string
  durationMs?: number
  /** 用户重放时, 把这一条的 Intent 注入 chat */
  replay?: boolean
}

export class IntentLogger {
  private storage: Storage = localStorage

  log(entry: Omit<IntentLogEntry, 'id' | 'timestamp'>): IntentLogEntry {
    const full: IntentLogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...entry,
    }
    const logs = this.readAll()
    logs.push(full)
    while (logs.length > MAX_ENTRIES) logs.shift()
    this.writeAll(logs)
    return full
  }

  readAll(): IntentLogEntry[] {
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  }

  findById(id: string): IntentLogEntry | null {
    return this.readAll().find(e => e.id === id) ?? null
  }

  clear(): void {
    this.storage.removeItem(STORAGE_KEY)
  }

  private writeAll(logs: IntentLogEntry[]): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(logs))
    } catch (err) {
      console.warn('[IntentLogger] 写入失败:', err)
    }
  }
}

export const intentLogger = new IntentLogger()
