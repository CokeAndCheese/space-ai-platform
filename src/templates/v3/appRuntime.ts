import { ssp } from '../../ssp'
import { v3TemplateRegistry } from './appRegistry'
import { AtomicTemplateRuntime } from './runtime'

/** The only application-level injection point from v3 templates into SSP. */
export const v3TemplateRuntime = new AtomicTemplateRuntime(v3TemplateRegistry, ssp)
