/**
 * Skill 层入口
 *
 * 提供:
 *   - skillRegistry  (注册表)
 *   - Skill interface (类型)
 *   - SkillContext  (skill 内部可用 API)
 *   - loadSkills()  (自动加载所有 .md)
 *
 * architecture:
 *   AI 层
 *     ├── parser / planner / executor
 *     └── skills/  ← 此目录
 *           ├── *.md          (skill 源, 灵活)
 *           ├── types.ts      (类型)
 *           ├── parser.ts     (markdown → TS)
 *           ├── loader.ts     (自动加载)
 *           └── index.ts      (this)
 */

export { skillRegistry, type Skill, type SkillContext, type SkillInput } from './types'
export { parseSkillMarkdown, parseSkillContent, compileSkillCode } from './parser'
export { loadSkills, allSkills } from './loader'

/** 模块加载时自动 load */
import { loadSkills } from './loader'
loadSkills()
