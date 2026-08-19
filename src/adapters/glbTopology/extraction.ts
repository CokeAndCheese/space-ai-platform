import type * as THREE from 'three'
import { validateEmbeddedTopology } from './validation'
import type { GlbTopologyDocument } from './types'

function embeddedValue(root: THREE.Object3D): unknown {
  const userData = root.userData as Record<string, unknown> | undefined
  if (!userData) return undefined
  if (userData.sspTopology !== undefined) return userData.sspTopology

  const extras = userData.extras
  if (extras !== null && typeof extras === 'object' && !Array.isArray(extras)) {
    return (extras as Record<string, unknown>).sspTopology
  }
  return undefined
}

/** Read and validate scene.extras.sspTopology as exposed by GLTFLoader userData. */
export function extractEmbeddedTopology(root: THREE.Object3D): GlbTopologyDocument | null {
  const value = embeddedValue(root)
  return value === undefined ? null : validateEmbeddedTopology(value)
}

export const readEmbeddedTopology = extractEmbeddedTopology
