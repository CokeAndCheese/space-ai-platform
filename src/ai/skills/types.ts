/**
 * Skill —— AI 层内部的复合能力
 *
 * Skill 是 markdown 文档 (.md),通过预编译映射成 TS 函数.
 * LLM 看到 skill 描述 + inputSchema + intent,
 * Runtime 调 skill.execute(params, ctx).
 *
 * Skill 内部调 atomic templates, 严格遵守 narrow waist:
 *   skill → template → ssp-shim
 */

/** skill 输入参数 (runtime 校验用) */
export interface SkillInput {
  name: string
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'object'
  required?: boolean
  default?: unknown
  enum?: unknown[]
  desc?: string
}

/** SkillContext —— skill 内部可用 API */
export interface SkillContext {
  /** 调 atomic template (走 executor) */
  runTemplate(name: string, params?: Record<string, unknown>): Promise<unknown>
  /** 延时 (ms) */
  sleep(ms: number): Promise<void>
  /** 写日志 */
  log(message: string, data?: unknown): void
  /** 触发其他 skill (skill 嵌套) */
  runSkill(name: string, params?: Record<string, unknown>): Promise<unknown>
  /** 当前场景的所有 mesh roots (用于 fitScene 等) */
  getSceneRoots(): any[]
  /** 当前 store (应用层) */
  store: {
    setMainViewpoint(vp: any): void
    getMainViewpoint(): any
  }
}

/** Skill 接口 */
export interface Skill {
  /** skill id (Intent.name 用) */
  id: string
  /** 触发场景 (LLM prompt 注入) */
  intent: string[]
  /** 输入参数 schema */
  inputSchema: Record<string, SkillInput>
  /** 输出 (可选) */
  returns?: string
  /** 描述 (LLM 看) */
  description: string
  /** TS 代码 (解析自 markdown 的 ## 代码 section, 预编译) */
  execute(params: Record<string, unknown>, ctx: SkillContext): Promise<unknown>
  /** examples (LLM 看) */
  examples?: Array<{ query: string; params: Record<string, unknown> }>
  /** guard 注意事项 */
  guard?: string[]
  /** 来源 markdown 文件 (debug 用) */
  sourceFile?: string
}

/** Skill registry */
export class SkillRegistry {
  private map = new Map<string, Skill>()

  register(skill: Skill): void {
    if (this.map.has(skill.id)) {
      console.warn(`[skills] duplicate skill id: ${skill.id}, overwriting`)
    }
    this.map.set(skill.id, skill)
  }

  get(id: string): Skill | undefined {
    return this.map.get(id)
  }

  all(): Skill[] {
    return Array.from(this.map.values())
  }

  /** LLM prompt 用的列表 (转成字符串) */
  toPromptSection(): string {
    const lines: string[] = []
    for (const s of this.all()) {
      lines.push(`### skill: ${s.id}`)
      lines.push(`触发场景: ${s.intent.join(', ')}`)
      lines.push(`描述: ${s.description}`)
      const params = Object.entries(s.inputSchema)
        .map(([k, v]) => `${k}(${v.type}${v.required ? ', 必填' : ''}${v.default !== undefined ? `, default=${JSON.stringify(v.default)}` : ''}${v.enum ? `, enum=[${v.enum.join(',')}]` : ''})`)
        .join(', ')
      lines.push(`输入: { ${params} }`)
      if (s.examples && s.examples.length) {
        lines.push('Examples:')
        for (const e of s.examples) {
          lines.push(`  - 用户: "${e.query}" → params: ${JSON.stringify(e.params)}`)
        }
      }
      lines.push('')
    }
    return lines.join('\n')
  }
}

/** 全局 registry 单例 */
export const skillRegistry = new SkillRegistry()
