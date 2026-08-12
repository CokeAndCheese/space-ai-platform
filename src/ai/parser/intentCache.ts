/**
 * intentCache —— LRU 缓存: query → Intent
 *
 * 避免重复 query 重复调 LLM, 省 token 省时间
 *
 * 缓存策略:
 *   - key = normalized query (trim + lowercase + 去标点)
 *   - 命中阈值: 同 query 重复 ≥1 次直接返回
 *   - LRU: 最近 50 条
 *   - 跨 session 不持久化 (refresh 即清)
 *
 * ⚠️ 注意:
 *   - 只缓存确定的 Intent (LLM 返回 + Zod 验证通过的)
 *   - Fallback regex / user-edit 不缓存 (用户可能改了 Intent)
 */

import { tryParseIntent, type Intent } from '../types/Intent'

interface CacheEntry {
  intent: Intent
  timestamp: number
  source: 'llm' | 'fallback'
}

const MAX_SIZE = 50

class IntentCache {
  private cache = new Map<string, CacheEntry>()

  /** 标准化 query 作 key */
  private normalize(query: string): string {
    return query.trim().toLowerCase().replace(/[?!.。,，、\s]+/g, ' ').trim()
  }

  get(query: string): Intent | null {
    const key = this.normalize(query)
    const entry = this.cache.get(key)
    if (!entry) return null
    const validated = tryParseIntent(entry.intent)
    if (!validated) {
      this.cache.delete(key)
      return null
    }
    entry.intent = validated
    // LRU: 移到最后
    this.cache.delete(key)
    this.cache.set(key, entry)
    return validated
  }

  set(query: string, intent: Intent, source: 'llm' | 'fallback' = 'llm'): void {
    const key = this.normalize(query)
    if (this.cache.has(key)) this.cache.delete(key)
    this.cache.set(key, { intent, timestamp: Date.now(), source })

    // LRU 淘汰
    while (this.cache.size > MAX_SIZE) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }
  }

  clear(): void {
    this.cache.clear()
  }

  size(): number {
    return this.cache.size
  }

  /** 调试: 列出最近 N 条 */
  recent(n: number = 10): Array<{ query: string; intent: Intent; timestamp: number }> {
    return Array.from(this.cache.entries())
      .slice(-n)
      .map(([query, e]) => ({ query, intent: e.intent, timestamp: e.timestamp }))
      .reverse()
  }
}

export const intentCache = new IntentCache()
