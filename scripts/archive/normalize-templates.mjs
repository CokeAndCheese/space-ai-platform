/**
 * Normalize template schema
 *
 * Convert soonspace-skill style JSON (category + dot-separated id) into our schema:
 *   { id, category, subcategory, intent, method, signature, code, ... }
 *
 * Subdirectory rules:
 *   - core-api / SCOPE.id.json   -> category=core-api, subcategory=SCOPE
 *   - combo-workflow / SCOPE.id.json -> category=combo-workflow, subcategory=SCOPE
 *   - uspace-* / SCOPE.id.json   -> category=uspace, subcategory=SCOPE
 *   - query-model / id.json      -> category=query-model, subcategory=model
 *
 * Rewrite rules:
 *   - new id = remove SCOPE prefix from filename
 *   - keep other soonspace-specific fields (method, code, sdk) intact for later translation
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const TEMPLATES_DIR = path.resolve('src/templates')

function deriveFromFilename(filename) {
  // e.g. 'camera.flyTo.json' -> subcategory='camera', id='flyTo'
  const stem = filename.replace(/\.json$/, '')
  const parts = stem.split('.')
  if (parts.length >= 2) {
    return { subcategory: parts[0], fileId: parts.slice(1).join('.') }
  }
  return { subcategory: 'uncategorized', fileId: stem }
}

function deriveFromSubdir(dirParts, filename) {
  // dirParts = ['src', 'templates', 'core-api', 'camera']  ->  subcategory='camera'
  const subcategory = dirParts[dirParts.length - 1]
  const fileId = filename.replace(/\.json$/, '')
  return { subcategory, fileId }
}

async function* walkJsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      yield* walkJsonFiles(full)
    } else if (e.isFile() && e.name.endsWith('.json')) {
      yield full
    }
  }
}

function getCategoryFromDir(dirParts) {
  // dirParts = ['src', 'templates', 'core-api', ...]
  return dirParts[2] || 'uncategorized'
}

async function main() {
  let count = 0
  for await (const filePath of walkJsonFiles(TEMPLATES_DIR)) {
    const rel = path.relative(TEMPLATES_DIR, filePath)
    const parts = rel.split(path.sep)
    const filename = parts[parts.length - 1]
    const category = getCategoryFromDir(['src', 'templates', ...parts.slice(0, -1)])

    let subcategory, fileId
    if (parts.length === 2) {
      // Flat: category / filename.json
      const r = deriveFromFilename(filename)
      subcategory = r.subcategory
      fileId = r.fileId
    } else {
      // Subdirectory: category / subcategory / id.json
      const r = deriveFromSubdir(['src', 'templates', ...parts.slice(0, -1)], filename)
      subcategory = r.subcategory
      fileId = r.fileId
    }

    const raw = await fs.readFile(filePath, 'utf8')
    const json = JSON.parse(raw)
    json.id = fileId
    if (!json.subcategory) {
      json.subcategory = subcategory
    }

    await fs.writeFile(filePath, JSON.stringify(json, null, 2) + '\n', 'utf8')
    count++
  }
  console.log('[normalize-templates] processed ' + count + ' templates')
}

main().catch((err) => {
  console.error('[normalize-templates] failed:', err)
  process.exit(1)
})