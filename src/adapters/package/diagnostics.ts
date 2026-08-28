import type { PackageDiagnostic, PackageDiagnosticCode, PackagePhase } from './types'

export function sanitizeManifestUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined
  try {
    const parsed = new URL(uri)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '[redacted]'
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return '[redacted]'
  }
}

export function packageDiagnostic(
  code: PackageDiagnosticCode,
  phase: PackagePhase,
  path: string,
  details: Record<string, string | number | boolean | null> = {},
  context: { manifestUri?: string; assetId?: string } = {},
): PackageDiagnostic {
  return Object.freeze({
    code,
    phase,
    path: path.startsWith('/') ? path : '/',
    manifestUri: sanitizeManifestUri(context.manifestUri),
    assetId: context.assetId,
    details: Object.freeze({ ...details }),
  })
}

export function failure(
  code: PackageDiagnosticCode,
  phase: PackagePhase,
  path: string,
  details: Record<string, string | number | boolean | null> = {},
  context: { manifestUri?: string; assetId?: string } = {},
) {
  return { ok: false as const, diagnostic: packageDiagnostic(code, phase, path, details, context) }
}
