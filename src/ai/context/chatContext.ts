/**
 * ChatContext —— 多轮对话状态管理
 *
 * 设计:
 *   - 不持久化 (刷新即清)
 *   - 默认 10 轮, 只传最后 5 给 LLM
 *   - Intent scope 默认继承 (用户没说就沿用上次的)
 *   - 代词解析 (它们 / 上面那些 / 同上次)
 */

import type {
  Building,
  Intent,
  QuerySceneParams,
  QueryScope,
} from '../types/Intent'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  /** Host-only UI commands stay visible in the transcript but never enter LLM context. */
  llmVisible?: boolean
  intent?: Intent
  resultSids?: string[]
  resultCount?: number
  resultMessage?: string
  resultData?: unknown
  /**
   * 分组结果 (compare action 用, e.g. {A: [sid...], B: [sid...]}).
   * 跟 resultSids 同时存在. UI 可选展示其中一个.
   */
  resultGrouped?: Record<string, string[]>
  timestamp: number
}

const MAX_TURNS = 10
const MAX_CONTEXT_TURNS = 10
const MAX_TURNS_TO_LLM = 5
const FLOOR_CONTEXT_OPERATIONS = new Set(['show', 'hide', 'isolate', 'focus'])

interface FloorIdentity {
  building: Building
  level: number
  floorName: string
}

type FloorContextResolution =
  | { kind: 'resolved'; floor: FloorIdentity }
  | { kind: 'blocked' }
  | { kind: 'irrelevant' }

export class ChatContext {
  turns: ChatTurn[] = []
  private contextTurns: ChatTurn[] = []

  /** 添加一轮 user/assistant */
  push(turn: ChatTurn): void {
    this.turns.push(turn)
    while (this.turns.length > MAX_TURNS) this.turns.shift()
    if (turn.llmVisible !== false) {
      this.contextTurns.push(turn)
      while (this.contextTurns.length > MAX_CONTEXT_TURNS) this.contextTurns.shift()
    }
  }

  /** 取最后 N 轮给 LLM */
  getHistoryForLLM(): ChatTurn[] {
    return this.contextTurns.slice(-MAX_TURNS_TO_LLM)
  }

  /** 用户数量 */
  get userTurnCount(): number {
    return this.turns.filter(t => t.role === 'user').length
  }

  /** 上一轮的 Intent (assistant) */
  get lastIntent(): Intent | null {
    for (let i = this.contextTurns.length - 1; i >= 0; i--) {
      if (this.contextTurns[i].role === 'assistant' && this.contextTurns[i].intent) {
        return this.contextTurns[i].intent!
      }
    }
    return null
  }

  /** 上一轮的结果 sids */
  get lastResultSids(): string[] {
    for (let i = this.contextTurns.length - 1; i >= 0; i--) {
      if (this.contextTurns[i].role === 'assistant' && this.contextTurns[i].resultSids) {
        return this.contextTurns[i].resultSids!
      }
    }
    return []
  }

  /** 清除所有 */
  clear(): void {
    this.turns = []
    this.contextTurns = []
  }

  /**
   * 引用解析 + Intent 继承
   * 输入: 用户的 query + LLM 给的 Intent
   * 输出: 增强后的模板调用 (仅 query-scene 继承 scope)
   */
  applyInheritance(intent: Intent, rawQuery: string): Intent {
    const last = this.lastIntent
    if (intent.templateId !== 'query-scene') {
      return intent
    }

    let enhanced = intent

    if (last?.templateId === 'query-scene') {
      // 代词检测: 用户引用上次的结果
      const isReference = /它们|那些|上(面|次)|同(上次|前)|一样|也/i.test(rawQuery)
      if (isReference) {
        const currentParams = enhanced.params as QuerySceneParams
        const lastParams = last.params as QuerySceneParams
        const mergedScope = mergeScope(lastParams.scope, currentParams.scope)
        enhanced = withScope(enhanced, mergedScope)
      }
    }

    return this.resolveBareFloorScope(enhanced)
  }

  /**
   * 楼层状态操作中的单独 `1F` 不是全局唯一标识。
   * 只从最近一个相关且唯一的楼层上下文补全；一旦最近相关轮次
   * 是歧义的，立即停止，不回退到更早的旧楼层。
   */
  private resolveBareFloorScope(intent: Intent): Intent {
    const params = intent.params as QuerySceneParams
    const scope = params.scope
    if (!FLOOR_CONTEXT_OPERATIONS.has(params.operation) ||
        scope?.levels?.length !== 1 ||
        scope.buildings?.length ||
        scope.floorNames?.length) {
      return intent
    }

    const requestedLevel = scope.levels[0]
    for (let index = this.contextTurns.length - 1; index >= 0; index--) {
      const turn = this.contextTurns[index]
      if (turn.role !== 'assistant' || turn.intent?.templateId !== 'query-scene') continue

      const resolution = floorContextFromTurn(turn, requestedLevel)
      if (resolution.kind === 'irrelevant') continue
      if (resolution.kind === 'blocked') return intent

      return withScope(intent, {
        ...scope,
        buildings: [resolution.floor.building],
        floorNames: [resolution.floor.floorName],
      })
    }

    return intent
  }
}

function mergeScope(parent?: QueryScope, child?: QueryScope): QueryScope {
  let floorNames = child?.floorNames
  if (floorNames === undefined && parent?.floorNames !== undefined) {
    // 当本轮明确说了楼层数字时，只能继承同一层的唯一 floorName。
    // 避免“也恢复1F”把上轮 A_2F 合并成 levels=[1]+floorNames=[A_2F]。
    if (!child?.levels?.length) {
      floorNames = parent.floorNames
    } else if (parent.floorNames.length === 1) {
      const floor = parseFloorName(parent.floorNames[0])
      if (floor && child.levels.includes(floor.level)) floorNames = parent.floorNames
    }
  }

  return {
    buildings: child?.buildings ?? parent?.buildings,
    levels: child?.levels ?? parent?.levels,
    floorNames,
    floorTypes: child?.floorTypes ?? parent?.floorTypes,
    directions: child?.directions ?? parent?.directions,
  }
}

function withScope(intent: Intent, scope: QueryScope): Intent {
  return {
    ...intent,
    params: {
      ...intent.params,
      scope,
    },
  }
}

function floorContextFromTurn(turn: ChatTurn, requestedLevel: number): FloorContextResolution {
  const params = turn.intent!.params as QuerySceneParams
  const scope = params.scope

  if (scope?.floorNames?.length) {
    return resolveFloorNames(scope.floorNames, requestedLevel)
  }

  if (scope?.buildings?.length) {
    const buildings = unique(scope.buildings)
    if (buildings.length !== 1) return { kind: 'blocked' }
    return {
      kind: 'resolved',
      floor: makeFloorIdentity(buildings[0], requestedLevel),
    }
  }

  const targetSid = params.target?.sid
  if (targetSid) {
    const floor = parseSidFloor(targetSid)
    if (floor) {
      return floor.level === requestedLevel
        ? { kind: 'resolved', floor }
        : { kind: 'blocked' }
    }
  }

  const dataFloorNames = readResultFloorNames(turn.resultData)
  if (dataFloorNames !== null) {
    return resolveFloorNames(dataFloorNames, requestedLevel)
  }

  const dataBuildings = readResultBuildings(turn.resultData)
  if (dataBuildings !== null) {
    const buildings = unique(dataBuildings)
    if (buildings.length !== 1) return { kind: 'blocked' }
    return {
      kind: 'resolved',
      floor: makeFloorIdentity(buildings[0], requestedLevel),
    }
  }

  if (turn.resultSids !== undefined) {
    // 结果被截断时，可见 SID 不能代表完整上下文。
    if (turn.resultCount !== undefined && turn.resultCount > turn.resultSids.length) {
      return { kind: 'blocked' }
    }
    const floorNames = unique(
      turn.resultSids
        .map(parseSidFloor)
        .filter((floor): floor is FloorIdentity => floor !== null)
        .map(floor => floor.floorName),
    )
    if (floorNames.length > 0) return resolveFloorNames(floorNames, requestedLevel)
    if (turn.resultCount === 0) return { kind: 'blocked' }
  }

  return { kind: 'irrelevant' }
}

function resolveFloorNames(
  floorNames: readonly string[],
  requestedLevel: number,
): FloorContextResolution {
  const uniqueNames = unique(floorNames.map(name => name.toUpperCase()))
  if (uniqueNames.length !== 1) return { kind: 'blocked' }
  const floor = parseFloorName(uniqueNames[0])
  if (!floor || floor.level !== requestedLevel) return { kind: 'blocked' }
  return { kind: 'resolved', floor }
}

function readResultFloorNames(data: unknown): string[] | null {
  if (!isRecord(data)) return null
  for (const key of ['matchedFloorNames', 'floorNames', 'candidates']) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue
    const value = data[key]
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  }
  return null
}

function readResultBuildings(data: unknown): Building[] | null {
  if (!isRecord(data) || !Object.prototype.hasOwnProperty.call(data, 'matchedBuildings')) return null
  const value = data.matchedBuildings
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.toUpperCase())
    .filter((item): item is Building => item === 'A' || item === 'B' || item === 'C')
}

function parseSidFloor(sid: string): FloorIdentity | null {
  const match = sid.toUpperCase().match(/_([ABC])_(\d+)F(?:_|$)/)
  if (!match) return null
  return makeFloorIdentity(match[1] as Building, Number(match[2]))
}

function parseFloorName(floorName: string): FloorIdentity | null {
  const match = floorName.trim().toUpperCase().match(/^([ABC])_(\d+)F$/)
  if (!match) return null
  return makeFloorIdentity(match[1] as Building, Number(match[2]))
}

function makeFloorIdentity(building: Building, level: number): FloorIdentity {
  return { building, level, floorName: `${building}_${level}F` }
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export const chatContext = new ChatContext()
