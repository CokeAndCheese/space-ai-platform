/**
 * Skill loader —— 自动加载 src/ai/skills/*.md
 *
 * Vite 用 import.meta.glob 静态导入所有 .md 文件,
 * 然后逐个解析成 Skill 注册到 registry.
 */

import { parseSkillContent } from './parser'
import type { Skill } from './types'
import { skillRegistry } from './types'

/**
 * Vite glob 导入所有 .md skill 文件.
 * eager: true → 立即加载 (block)
 * query: '?raw' → 原始文本 (不是 import 字符串)
 * import: 'default' → 默认导出 = 文件内容
 */
const skillModules = import.meta.glob<string>('./*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})

/** 自动加载所有 skill */
export function loadSkills(): Skill[] {
  const loaded: Skill[] = []
  for (const [filePath, content] of Object.entries(skillModules)) {
    try {
      const skill = parseSkillContent(content, filePath)
      skillRegistry.register(skill)
      loaded.push(skill)
      console.log(`[skills] loaded: ${skill.id} (${filePath})`)
    } catch (err) {
      console.error(`[skills] failed to parse ${filePath}:`, err)
    }
  }
  return loaded
}

/** 自动执行 (模块加载时) */
const _allSkills = loadSkills()
export const allSkills = _allSkills
