/**
 * Skill markdown parser
 *
 * 解析 .md 文件:
 *   - YAML frontmatter (id, intent, inputSchema, returns, ...)
 *   - description (## 描述 段)
 *   - code (## 代码 段, TS 代码)
 *   - examples (## Examples 段)
 *   - guard (## Guard 段)
 *
 * 编译成 Skill 对象 (execute 函数从 ## 代码 段编译).
 */

import type { Skill, SkillInput } from './types'

/** 极简 YAML 解析 (只支持 key: value 和 list) */
function parseYamlFrontmatter(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // 跳过空行和注释
    if (!line.trim() || line.trim().startsWith('#')) {
      i++
      continue
    }
    // top-level key: value
    const m = line.match(/^(\w+):\s*(.*)$/)
    if (!m) {
      i++
      continue
    }
    const [, key, rawValue] = m
    i++

    // multi-line list (indent)
    if (rawValue.trim() === '' && i < lines.length && lines[i].startsWith('  ')) {
      const list: string[] = []
      while (i < lines.length && lines[i].startsWith('  ')) {
        const item = lines[i].replace(/^\s*-\s*/, '').trim()
        if (item) list.push(item)
        i++
      }
      result[key] = list
      continue
    }

    // multi-line object (key: { ... }) - inputSchema
    if (rawValue.trim() === '' && i < lines.length && !lines[i].startsWith('  ')) {
      // sub key (no indent)
      const obj: Record<string, unknown> = {}
      while (i < lines.length && lines[i].startsWith('  ')) {
        const sub = lines[i].slice(2)
        const sm = sub.match(/^(\w+):\s*(.*)$/)
        if (!sm) {
          i++
          continue
        }
        const [, skey, sval] = sm
        // list value?
        if (sval.trim() === '' && i + 1 < lines.length && lines[i + 1].startsWith('    ')) {
          i++
          const list: string[] = []
          while (i < lines.length && lines[i].startsWith('    ')) {
            const item = lines[i].replace(/^\s*-\s*/, '').trim()
            if (item) list.push(item)
            i++
          }
          obj[skey] = list
        } else if (sval.trim() === '{' || sval.trim() === '') {
          // nested object - skip for now, just store string
          obj[skey] = sval.trim()
          i++
        } else {
          obj[skey] = sval.trim().replace(/^["']|["']$/g, '')
          i++
        }
      }
      result[key] = obj
      continue
    }

    result[key] = rawValue.trim().replace(/^["']|["']$/g, '')
  }
  return result
}

/** 解析 markdown 的 ## section */
function extractSection(markdown: string, heading: string): string | null {
  const re = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |\\Z)`, 'm')
  const m = markdown.match(re)
  return m ? m[1].trim() : null
}

/** 提取 ## 代码 section 里的 typescript code block */
function extractCode(markdown: string): string {
  const section = extractSection(markdown, '代码')
  if (!section) throw new Error('skill 必须有 ## 代码 section')
  const m = section.match(/```(?:typescript|ts)\n([\s\S]+?)\n```/)
  if (!m) throw new Error('skill ## 代码 section 必须有 typescript code block')
  return m[1]
}

/** 提取 ## Examples */
function extractExamples(markdown: string): Array<{ query: string; params: Record<string, unknown> }> {
  const section = extractSection(markdown, 'Examples')
  if (!section) return []
  const examples: Array<{ query: string; params: Record<string, unknown> }> = []
  // 匹配 "- 用户: "..." → params: {...}"
  const re = /-\s*用户:\s*"([^"]+)"\s*→\s*params:\s*(\{[^}]+\})/g
  let m
  while ((m = re.exec(section)) !== null) {
    try {
      examples.push({
        query: m[1],
        params: JSON.parse(m[2]),
      })
    } catch {
      // skip parse error
    }
  }
  return examples
}

/** 提取 ## Guard 列表 */
function extractGuard(markdown: string): string[] {
  const section = extractSection(markdown, 'Guard')
  if (!section) return []
  return section
    .split('\n')
    .map(l => l.replace(/^-\s*/, '').trim())
    .filter(Boolean)
}

/** 解析 markdown skill 文件 */
export function parseSkillMarkdown(_filePath: string): Skill {
  // 读取 (Vite import.meta.glob)
  // 此函数接收文件内容,由调用方读取
  throw new Error('use parseSkillContent(content, filePath)')
}

/** 解析 markdown 内容 */
export function parseSkillContent(content: string, sourceFile?: string): Skill {
  // 1. 分离 frontmatter
  const fmMatch = content.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/)
  if (!fmMatch) {
    throw new Error(`skill 缺少 YAML frontmatter: ${sourceFile ?? '<content>'}`)
  }
  const fm = parseYamlFrontmatter(fmMatch[1])
  const body = fmMatch[2]

  // 2. 提取 description (## 描述 或 ## description)
  const description =
    extractSection(body, '描述') ??
    extractSection(body, 'description') ??
    (typeof fm.description === 'string' ? fm.description : '')

  // 3. 提取 code
  const code = extractCode(body)

  // 4. 提取 examples / guard
  const examples = extractExamples(body)
  const guard = extractGuard(body)

  // 5. 编译 execute 函数
  const execute = compileSkillCode(code)

  // 6. normalize inputSchema
  const inputSchema = normalizeInputSchema(fm.inputSchema)

  return {
    id: String(fm.id ?? ''),
    intent: Array.isArray(fm.intent) ? fm.intent.map(String) : [],
    inputSchema,
    returns: typeof fm.returns === 'string' ? fm.returns : undefined,
    description,
    execute,
    examples,
    guard,
    sourceFile,
  }
}

/** 标准化 inputSchema — frontmatter 简化写法 → SkillInput */
function normalizeInputSchema(raw: unknown): Record<string, SkillInput> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, SkillInput> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') {
      // 简化写法: floors: number[]
      out[k] = {
        name: k,
        type: (v as any) as SkillInput['type'] ?? 'string',
        required: !v.includes('optional'),
        desc: '',
      }
    } else if (typeof v === 'object' && v !== null) {
      const vo = v as Record<string, unknown>
      out[k] = {
        name: k,
        type: (vo.type as SkillInput['type']) ?? 'string',
        required: vo.required as boolean | undefined,
        default: vo.default,
        enum: vo.enum as unknown[] | undefined,
        desc: vo.desc as string | undefined,
      }
    }
  }
  return out
}

/**
 * 编译 skill 的 ## 代码 section 成 execute 函数.
 *
 * 用 new Function + 沙箱 ctx 注入实现 (运行时编译, 无外部依赖).
 * ⚠️ 注意: 这是受信任的本地 skill 文件, 不是 untrusted user input.
 */
export function compileSkillCode(code: string): (params: any, ctx: any) => Promise<unknown> {
  // 包装成 async function
  // 期望: code 是一个函数体, 含 `return ...`
  const wrapped = `
"use strict";
return (async function execute(params, ctx) {
${code}
});
`
  // 用 new Function 编译 (替代 eval, 稍安全一点)
  // eslint-disable-next-line no-new-func
  const factory = new Function(wrapped)
  return factory()
}
