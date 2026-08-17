import { V3TemplateRegistry } from './registry'
import type { AtomicTemplateDefinition } from './types'

const importedAtomicTemplates = import.meta.glob<AtomicTemplateDefinition>('./atomic/**/*.json', {
  eager: true,
  import: 'default',
})

const taggedDefinitions = Object.entries(importedAtomicTemplates).map(
  ([source, definition]) => ({ source, definition }),
)

export const v3TemplateRegistry = new V3TemplateRegistry(taggedDefinitions)
