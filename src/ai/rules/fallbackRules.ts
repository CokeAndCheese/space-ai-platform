/**
 * fallbackRules —— LLM 不可用时的 regex 兜底
 *
 * Phase 2: 50 个常见 query pattern.
 * 设计: 中文优先 (因为用户用中文), 但保留少量英文 (e.g. "reset view").
 *
 * 优先级: 越具体的 pattern 越靠前 (避免被通用 pattern 抢先匹配).
 */

import {
  createTemplateIntent,
  type FireType,
  type GroupField,
  type Intent,
  type QueryEntity,
  type QueryOperation,
  type QueryOutput,
  type QueryScope,
  type QueryTarget,
  type QueryVisual,
} from '../types/Intent'

interface LegacyQueryIntent {
  action: QueryOperation
  entity?: QueryEntity
  target?: QueryTarget
  scope?: QueryScope
  groupBy?: GroupField
  visual?: QueryVisual
  output?: QueryOutput
}

type FallbackCandidate = Intent | LegacyQueryIntent

interface FallbackRule {
  name: string
  pattern: RegExp
  build: (match: RegExpMatchArray) => FallbackCandidate | null
}

// fireType 中文映射
function chineseToFireType(text: string): FireType | null {
  if (/消火栓|消防栓|hydrant/i.test(text)) return 'HYDRANT'
  if (/烟感|smoke.*detect/i.test(text)) return 'SMOKE_DETECTOR'
  if (/喷淋|sprinkler/i.test(text)) return 'SPRINKLER'
  if (/灭火器|extinguisher/i.test(text)) return 'EXTINGUISHER'
  if (/应急灯|emergency.*light/i.test(text)) return 'EMERGENCY_LIGHT'
  if (/出口|exit.*sign|疏散/i.test(text)) return 'EXIT_SIGN'
  if (/手报|break.*glass/i.test(text)) return 'BREAK_GLASS'
  if (/警铃|alarm.*bell/i.test(text)) return 'ALARM_BELL'
  if (/消防软管|fire.*hose/i.test(text)) return 'FIRE_HOSE'
  if (/防火门|fire.*door/i.test(text)) return 'FIRE_DOOR'
  return null
}

const FLOOR_VISIBILITY_ALL_PATTERN =
  /^(?:恢复|显示|取消\s*隐藏)\s*(?:所有|全部)\s*(?:楼栋|栋楼|建筑|栋)?\s*(\d+)\s*(?:F|层|楼)(?:楼层)?$/i
const FLOOR_VISIBILITY_BUILDING_PATTERN =
  /^(?:恢复|显示|取消\s*隐藏)\s*([ABC])\s*(?:[_-]\s*|(?:栋楼|楼栋|栋|楼)\s*)?(\d+)\s*(?:F|层|楼)(?:楼层)?$/i
const FLOOR_VISIBILITY_BARE_PATTERN =
  /^(?:恢复|显示|取消\s*隐藏)\s*(\d+)\s*(?:F|层|楼)(?:楼层)?$/i
const FLOOR_COLLAPSE_PATTERN =
  /(?:收回|收起|合拢|复原)\s*(?:楼层|楼板)|楼层\s*(?:收回|收起|合拢)|取消\s*(?:炸开|展开|分层)(?:\s*(?:楼层|楼板))?/i
const VISIBILITY_UNDO_PATTERN = /^(?:撤回|撤销)\s*(?:上一步)?$/

const RULES: FallbackRule[] = [
  // ===== -1. 系统特殊 query (UI 控件走 narrow waist) =====
  {
    name: 'system-fit-scene',
    pattern: /^__fit_scene__$/,
    build: () => ({
      action: 'template',
      templateId: 'fitScene',
      params: { view: 'iso' },
    }),
  },
  {
    name: 'system-reset-visibility',
    pattern: /^__reset_visibility__$/,
    build: () => ({
      action: 'template',
      templateId: 'resetVisibility',
      params: {},
    }),
  },
  {
    name: 'system-main-viewpoint',
    pattern: /^(__main_viewpoint__|回到主视角|reset view|飞回主视角)$/i,
    build: () => ({
      action: 'template',
      templateId: 'flyToMainViewpoint',
      params: {},
    }),
  },
  {
    name: 'system-capture-main-viewpoint',
    pattern: /^(__capture_main_viewpoint__|设为主视角|capture main viewpoint)$/i,
    build: () => ({
      action: 'template',
      templateId: 'captureMainViewpoint',
      params: {},
    }),
  },
  {
    name: 'explode-floors',
    pattern: /(炸开|展开|分层展示|拉开)\s*(所有|全部)?\s*(楼层|楼板)|楼层\s*(炸开|展开)/i,
    build: () => ({
      action: 'template',
      templateId: 'explode-floor',
      params: {},
    }),
  },
  {
    name: 'collapse-floors',
    pattern: FLOOR_COLLAPSE_PATTERN,
    build: () => ({
      action: 'template',
      templateId: 'collapse-floor',
      params: {},
    }),
  },
  {
    name: 'show-floor-all-buildings',
    pattern: FLOOR_VISIBILITY_ALL_PATTERN,
    build: (m) => ({
      action: 'show',
      scope: {
        buildings: ['A', 'B', 'C'],
        levels: [parseInt(m[1], 10)],
      },
    }),
  },
  {
    name: 'show-floor-by-name',
    pattern: FLOOR_VISIBILITY_BUILDING_PATTERN,
    build: (m) => ({
      action: 'show',
      scope: { floorNames: [`${m[1].toUpperCase()}_${parseInt(m[2], 10)}F`] },
    }),
  },
  {
    name: 'show-floor-by-level',
    pattern: FLOOR_VISIBILITY_BARE_PATTERN,
    build: (m) => ({
      action: 'show',
      scope: { levels: [parseInt(m[1], 10)] },
    }),
  },
  // ===== 0. 房间/空间类 (高优先级, 特定) =====
  {
    name: 'locate-toilet-by-floor',
    pattern: /(\d+)\s*[Ff层楼]?\s*的?\s*(男|女)?\s*厕|洗手间|卫生间/,
    build: (m) => ({
      action: 'locate',
      target: { renderType: 'SPACE', spaceType: 'TOILET' },
      scope: { levels: [parseInt(m[1] || '1')] },
      visual: { color: '#F48FB1' },
    }),
  },
  {
    name: 'locate-meeting-room',
    pattern: /会议室|meeting.*room/i,
    build: () => ({
      action: 'locate',
      target: { renderType: 'SPACE', spaceType: 'MEETING_ROOM' },
      visual: { color: '#F48FB1' },
    }),
  },
  {
    name: 'locate-office',
    pattern: /办公室|办公区|office/i,
    build: () => ({
      action: 'locate',
      target: { renderType: 'SPACE', spaceType: 'OFFICE' },
      visual: { color: '#F48FB1' },
    }),
  },
  {
    name: 'locate-kitchen',
    pattern: /厨房|kitchen/i,
    build: () => ({
      action: 'locate',
      target: { renderType: 'SPACE', spaceType: 'KITCHEN' },
      visual: { color: '#F48FB1' },
    }),
  },

  // ===== 1. 楼层定位 (高优先级) =====
  {
    name: 'fly-to-floor-cn',
    pattern: /飞(到|去)\s*([ABC])\s*[栋楼#]?\s*(\d+)\s*[Ff层]/,
    build: (m) => ({
      action: 'focus',
      scope: {
        buildings: [m[2] as 'A' | 'B' | 'C'],
        levels: [parseInt(m[3])],
      },
    }),
  },
  {
    name: 'fly-to-floor-simple',
    pattern: /飞到\s*([ABC])\s*[栋楼]?\s*(\d+)/,
    build: (m) => ({
      action: 'focus',
      scope: {
        buildings: [m[1] as 'A' | 'B' | 'C'],
        levels: [parseInt(m[2])],
      },
    }),
  },
  {
    name: 'fly-to-roof',
    pattern: /飞(到|去)?\s*(屋顶|楼顶|roof|ding)/i,
    build: () => ({
      action: 'focus',
      scope: { floorTypes: ['ROOF'] },
    }),
  },
  {
    name: 'fly-to-tower',
    pattern: /飞(到|去)?\s*塔楼|tower/i,
    build: () => ({
      action: 'focus',
      scope: { floorTypes: ['TOWER'] },
    }),
  },
  {
    name: 'fly-to-basement',
    pattern: /飞(到|去)?\s*(地下|b\d|地下室|basement)/i,
    build: () => ({
      action: 'focus',
      scope: { floorTypes: ['BASEMENT'] },
    }),
  },

  // ===== 2. 镜头控制 =====
  {
    name: 'reset-view-cn',
    pattern: /(回到|回去|reset).*?(主视角|home|主视图|总览)/i,
    build: () => ({ action: 'template', templateId: 'flyToMainViewpoint', params: {} }),
  },
  {
    name: 'orbit-around',
    pattern: /(环绕|orbit|围绕|转一圈).*?(楼|楼层|floor|building)/i,
    build: () => ({ action: 'template', templateId: 'fitScene', params: { view: 'iso' } }),
  },

  // ===== 3. 消防/安防 (高优先级, 中文) =====
  {
    name: 'list-hydrant-by-building-floor',
    pattern: /([ABC])\s*[栋楼#]?\s*(\d+)\s*[Ff层]?\s*(有|的|里|有哪些)?\s*(消火栓|消防栓)/,
    build: (m) => ({
      action: 'list',
      target: { renderType: 'FACILITY', fireType: 'HYDRANT' },
      scope: { buildings: [m[1] as 'A' | 'B' | 'C'], levels: [parseInt(m[2])] },
    }),
  },
  {
    name: 'list-hydrant-by-building',
    pattern: /([ABC])\s*[栋楼#]?\s*的?\s*(消火栓|消防栓)/,
    build: (m) => ({
      action: 'list',
      target: { renderType: 'FACILITY', fireType: 'HYDRANT' },
      scope: { buildings: [m[1] as 'A' | 'B' | 'C'] },
    }),
  },
  {
    name: 'list-hydrant',
    pattern: /(所有|全部)?\s*(消火栓|消防栓|hydrant)/i,
    build: () => ({
      action: 'list',
      target: { renderType: 'FACILITY', fireType: 'HYDRANT' },
    }),
  },
  {
    name: 'flash-emergency-light',
    pattern: /(应急灯|emergency.*light)/i,
    build: () => ({
      action: 'flash',
      target: { renderType: 'FACILITY', fireType: 'EMERGENCY_LIGHT' },
      visual: { color: '#FF1744', duration: 3000 },
    }),
  },
  {
    name: 'flash-exit-sign',
    pattern: /(出口|出口指示|exit.*sign|疏散)/i,
    build: () => ({
      action: 'flash',
      target: { renderType: 'FACILITY', fireType: 'EXIT_SIGN' },
      visual: { color: '#FF1744', duration: 3000 },
    }),
  },
  {
    name: 'flash-smoke-detector',
    pattern: /(烟感|感烟|smoke.*detect)/i,
    build: () => ({
      action: 'flash',
      target: { renderType: 'FACILITY', fireType: 'SMOKE_DETECTOR' },
      visual: { color: '#FF1744', duration: 3000 },
    }),
  },
  {
    name: 'flash-sprinkler',
    pattern: /(喷淋|sprinkler)/i,
    build: () => ({
      action: 'flash',
      target: { renderType: 'FACILITY', fireType: 'SPRINKLER' },
      visual: { color: '#FF1744', duration: 3000 },
    }),
  },
  {
    name: 'flash-fire-alarm-bell',
    pattern: /(警铃|火警铃|alarm.*bell)/i,
    build: () => ({
      action: 'flash',
      target: { renderType: 'FACILITY', fireType: 'ALARM_BELL' },
      visual: { color: '#FF1744', duration: 3000 },
    }),
  },

  // ===== 4. 数量统计 =====
  {
    name: 'count-windows-by-building',
    pattern: /([ABC])\s*[栋楼#]?\s*(有)?多少\s*(窗户|window)/i,
    build: (m) => ({
      action: 'count',
      target: { renderType: 'WINDOW' },
      scope: { buildings: [m[1] as 'A' | 'B' | 'C'] },
    }),
  },
  {
    name: 'count-doors-by-floor',
    pattern: /(\d+)\s*[Ff层]?\s*(有)?多少\s*(门|door)/i,
    build: (m) => ({
      action: 'count',
      target: { renderType: 'DOOR' },
      scope: { levels: [parseInt(m[1])] },
    }),
  },
  {
    name: 'count-fire-type-by-building',
    pattern: /([ABC])\s*[栋楼#]?\s*(有)?多少\s*(消防|消火栓|应急|烟感|喷淋|灭火|防火)/i,
    build: (m) => {
      const fullText = m[0]
      const ft = chineseToFireType(fullText) || 'HYDRANT'
      return {
        action: 'count',
        target: { renderType: 'FACILITY', fireType: ft },
        scope: { buildings: [m[1] as 'A' | 'B' | 'C'] },
      }
    },
  },
  {
    name: 'count-all-windows',
    pattern: /一共|总共|全部\s*多少\s*(窗户|window)/i,
    build: () => ({
      action: 'count',
      target: { renderType: 'WINDOW' },
    }),
  },

  // ===== 5. 高亮/列表 (通用) =====
  {
    name: 'highlight-windows',
    pattern: /(高亮|标红|标记|显示)\s*(所有|全部)?\s*(窗户|window)/i,
    build: () => ({
      action: 'highlight',
      target: { renderType: 'WINDOW' },
      visual: { color: '#4FC3F7' },
    }),
  },
  {
    name: 'highlight-doors',
    pattern: /(高亮|标红|标记|显示)\s*(所有|全部)?\s*(门|door)/i,
    build: () => ({
      action: 'highlight',
      target: { renderType: 'DOOR' },
      visual: { color: '#FFD54F' },
    }),
  },
  {
    name: 'list-all-windows',
    pattern: /(所有|全部)\s*窗户/i,
    build: () => ({
      action: 'list',
      target: { renderType: 'WINDOW' },
    }),
  },
  {
    name: 'list-all-doors',
    pattern: /(所有|全部)\s*门/i,
    build: () => ({
      action: 'list',
      target: { renderType: 'DOOR' },
    }),
  },
  {
    name: 'list-elevators',
    pattern: /(所有|全部)?\s*(电梯|elevator)/i,
    build: () => ({
      action: 'list',
      target: { renderType: 'ELEVATOR' },
    }),
  },
  {
    name: 'list-stairs',
    pattern: /(所有|全部)?\s*(楼梯|stair)/i,
    build: () => ({
      action: 'list',
      target: { renderType: 'STAIR' },
    }),
  },

  // ===== 6. 方向定位 =====
  {
    name: 'locate-doors-east',
    pattern: /(东|east)\s*侧?\s*(门|door)/i,
    build: () => ({
      action: 'highlight',
      target: { renderType: 'DOOR' },
      scope: { directions: ['E'] },
      visual: { color: '#FFD54F' },
    }),
  },
  {
    name: 'locate-doors-west',
    pattern: /(西|west)\s*侧?\s*(门|door)/i,
    build: () => ({
      action: 'highlight',
      target: { renderType: 'DOOR' },
      scope: { directions: ['W'] },
      visual: { color: '#FFD54F' },
    }),
  },
  {
    name: 'locate-windows-south',
    pattern: /(南|south)\s*侧?\s*(窗户|window)/i,
    build: () => ({
      action: 'highlight',
      target: { renderType: 'WINDOW' },
      scope: { directions: ['S'] },
      visual: { color: '#4FC3F7' },
    }),
  },
  {
    name: 'locate-windows-north',
    pattern: /(北|north)\s*侧?\s*(窗户|window)/i,
    build: () => ({
      action: 'highlight',
      target: { renderType: 'WINDOW' },
      scope: { directions: ['N'] },
      visual: { color: '#4FC3F7' },
    }),
  },

  // ===== 7. 对比/汇总 =====
  {
    name: 'compare-buildings',
    pattern: /对比\s*([ABC])\s*[栋楼]?\s*(和|与|跟|vs)\s*([ABC])\s*[栋楼]?/i,
    build: (m) => ({
      action: 'compare',
      scope: { buildings: [m[1] as 'A' | 'B' | 'C', m[3] as 'A' | 'B' | 'C'] },
      groupBy: 'building',
      output: { format: 'table' },
    }),
  },
  {
    name: 'compare-windows-per-floor',
    pattern: /每\s*层\s*窗户\s*(对比|比较|数量)/i,
    build: () => ({
      action: 'compare',
      target: { renderType: 'WINDOW' },
      groupBy: 'level',
      output: { format: 'table' },
    }),
  },
  {
    name: 'summarize-floors',
    pattern: /(每栋|每楼|所有)\s*(有)?多少\s*层/i,
    build: () => ({
      action: 'summarize',
      entity: 'floor',
      groupBy: 'building',
    }),
  },

  // ===== 8. 隐藏/显示/隔离 =====
  {
    name: 'hide-doors',
    pattern: /(隐藏|hide)\s*(所有|全部)?\s*(门|door)/i,
    build: () => ({
      action: 'hide',
      target: { renderType: 'DOOR' },
    }),
  },
  {
    name: 'hide-windows',
    pattern: /(隐藏|hide)\s*(所有|全部)?\s*(窗户|window)/i,
    build: () => ({
      action: 'hide',
      target: { renderType: 'WINDOW' },
    }),
  },
  {
    name: 'isolate-elevators',
    pattern: /(隔离|只显示|isolate)\s*(电梯|elevator)/i,
    build: () => ({
      action: 'isolate',
      target: { renderType: 'ELEVATOR' },
    }),
  },

  // ===== 9. Highlight 颜色相关 =====
  {
    name: 'highlight-red',
    pattern: /(高亮|标红|标记|显示).*?(红色|红)/i,
    build: () => ({
      action: 'highlight',
      visual: { color: '#FF5252' },
    }),
  },
  {
    name: 'highlight-blue',
    pattern: /(高亮|标蓝|标记|显示).*?(蓝色|蓝)/i,
    build: () => ({
      action: 'highlight',
      visual: { color: '#4FC3F7' },
    }),
  },
  {
    name: 'highlight-yellow',
    pattern: /(高亮|标黄|标记|显示).*?(黄色|黄)/i,
    build: () => ({
      action: 'highlight',
      visual: { color: '#FFD54F' },
    }),
  },
  {
    name: 'highlight-green',
    pattern: /(高亮|标绿|标记|显示).*?(绿色|绿)/i,
    build: () => ({
      action: 'highlight',
      visual: { color: '#4DB6AC' },
    }),
  },

  // ===== 10. 比较 / 数量 (数字表达) =====
  {
    name: 'how-many-floors',
    pattern: /(有|共)\s*多少\s*层/i,
    build: () => ({
      action: 'count',
      entity: 'floor',
      scope: {},
      groupBy: 'building',
      output: { format: 'table' },
    }),
  },
  {
    name: 'total-facility-count',
    pattern: /(总共|一共|全部)\s*(有)?多少\s*(消防|消防设备|设施|设备)/i,
    build: () => ({
      action: 'count',
      target: { renderType: 'FACILITY' },
      groupBy: 'fireType',
      output: { format: 'table' },
    }),
  },

  // ===== 11. SID 直接定位 =====
  {
    name: 'focus-by-sid',
    pattern: /(DOOR|WINDOW|CEILING|WALL|ELEVATOR|STAIR|SPACE|FACILITY)_([ABC])_(\d+[Ff]|T|DING)_(\w+)/i,
    build: (m) => ({
      action: 'focus',
      target: { sid: m[0].toUpperCase() },
    }),
  },

  // ===== 12. 简单动作 =====
  {
    name: 'show-help',
    pattern: /(帮助|help|你能做什么|怎么用|介绍)/i,
    build: () => ({ action: 'template', templateId: 'help', params: {} }),
  },
]

/** 需要跳过 LLM 的楼层可见性指令。 */
export function isFloorVisibilityQuery(query: string): boolean {
  const normalized = query.trim()
  return FLOOR_VISIBILITY_ALL_PATTERN.test(normalized) ||
    FLOOR_VISIBILITY_BUILDING_PATTERN.test(normalized) ||
    FLOOR_VISIBILITY_BARE_PATTERN.test(normalized)
}

/**
 * Host-only visibility undo phrases. This intentionally matches only narrow,
 * unambiguous commands; broad requests remain ordinary natural language and
 * may still be handled by the model/fallback parser.
 */
export function isVisibilityUndoQuery(query: string): boolean {
  return VISIBILITY_UNDO_PATTERN.test(query.trim())
}

/** 必须稳定路由到 collapse-floor，不能交给 LLM 猜模板。 */
export function isFloorCollapseQuery(query: string): boolean {
  return FLOOR_COLLAPSE_PATTERN.test(query.trim())
}

/** 尝试 regex 兜底, 成功返回 Intent, 失败返回 null */
export function fallbackParse(query: string): Intent | null {
  for (const rule of RULES) {
    const m = query.match(rule.pattern)
    if (m) {
      try {
        const candidate = rule.build(m)
        if (!candidate) continue
        if (candidate.action === 'template') {
          return createTemplateIntent(candidate.templateId, candidate.params)
        }
        const { action, ...params } = candidate
        return createTemplateIntent('query-scene', { operation: action, ...params })
      } catch { /* continue */ }
    }
  }
  return null
}

/** 列出所有 fallback rules (UI 调试用) */
export function listFallbackRules(): Array<{ name: string; pattern: string }> {
  return RULES.map(r => ({
    name: r.name,
    pattern: r.pattern.source,
  }))
}

/** 总 rule 数 */
export function fallbackRuleCount(): number {
  return RULES.length
}
