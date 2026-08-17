import * as THREE from 'three'
import { ssp } from '../../ssp'
import { fallbackParse } from '../../ai/rules/fallbackRules'
import { clearSspContext, setSspContext } from '../../ssp/core/context'
import { templateCatalog, resolveAiTemplateId } from '../../templates/catalog'
import { executeTemplate } from '../../templates/runtime'
import { executeHostTemplateAction } from '../../templates/hostActions'
import { ExecutionScope } from '../../templates/v3/execution'
import { schemaAtPath, validateAndApplyDefaults } from '../../templates/v3/jsonSchema'
import { SspCapabilityManifest } from '../../templates/v3/manifest'
import { V3TemplateRegistry } from '../../templates/v3/registry'
import { AtomicTemplateRuntime } from '../../templates/v3/runtime'
import { v3TemplateRegistry } from '../../templates/v3/appRegistry'
import type {
  AtomicTemplateDefinition,
  AtomicCapabilityContract,
  JsonSchema,
  SspCapability,
} from '../../templates/v3/types'

type TestBody = () => void | Promise<void>

interface TestCase {
  name: string
  run: TestBody
}

export interface TemplateV3SuiteResult {
  passed: number
  names: readonly string[]
  durationMs: number
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`)
  }
}

function expectThrows(run: () => unknown, includes: string, message: string): void {
  try {
    run()
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    assert(text.includes(includes), `${message}: expected error containing "${includes}", got "${text}"`)
    return
  }
  throw new Error(`${message}: expected an exception`)
}

async function expectRejects(
  run: () => Promise<unknown>,
  includes: string,
  message: string,
): Promise<void> {
  try {
    await run()
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    assert(text.includes(includes), `${message}: expected error containing "${includes}", got "${text}"`)
    return
  }
  throw new Error(`${message}: expected a rejection`)
}

function capability(
  id: string,
  params: SspCapability['params'],
  returnType: string,
  overrides: Partial<SspCapability> = {},
): SspCapability {
  const [namespace, method] = id.split('.')
  return {
    id,
    namespace,
    method,
    params,
    returnType,
    async: false,
    classification: 'mapped',
    templatePolicy: 'allowed',
    ...overrides,
  }
}

const EMPTY_INPUT: JsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}

function atomicDefinition(
  overrides: Partial<AtomicTemplateDefinition> & Pick<AtomicTemplateDefinition, 'id' | 'call' | 'output'>,
): AtomicTemplateDefinition {
  return {
    schemaVersion: 3,
    version: '1.0.0',
    kind: 'atomic',
    title: 'Contract fixture',
    description: 'Template v3 atomic contract fixture.',
    intents: ['contract fixture'],
    input: EMPTY_INPUT,
    effects: ['scene.read'],
    risk: 'read',
    ai: { exposed: true },
    ...overrides,
  }
}

function registry(
  definitions: AtomicTemplateDefinition[],
  capabilities: SspCapability[],
): V3TemplateRegistry {
  const hydratedCapabilities = capabilities.map((entry) => {
    const matching = definitions.filter((definition) => definition.call.method === entry.id)
    const atomicContract = entry.atomicContract ?? inferAtomicContract(entry, matching)
    return {
      ...entry,
      mappedTemplates: entry.mappedTemplates ?? matching.map((definition) => definition.id),
      atomicContract,
    }
  })
  return new V3TemplateRegistry(
    definitions.map((definition, index) => ({
      source: `fixture-${index}.json`,
      definition,
    })),
    { capabilities: hydratedCapabilities },
  )
}

function inferAtomicContract(
  capabilityEntry: SspCapability,
  definitions: AtomicTemplateDefinition[],
): AtomicCapabilityContract | undefined {
  const definition = definitions[0]
  if (!definition) return undefined
  const args = (capabilityEntry.params ?? []).map((parameter, index) => {
    const binding = definition.call.args[index]
    const schema = binding && '$input' in binding
      ? schemaAtPath(definition.input, binding.$input)
      : {}
    return { required: parameter.required, schema }
  })
  const result = definition.call.result.kind === 'direct'
    ? { kind: 'public-data' as const, schema: definition.output }
    : definition.call.result.kind === 'receipt'
      ? { kind: 'void' as const }
      : { kind: definition.call.result.kind }
  return {
    templateIds: definitions.map((item) => item.id),
    args,
    result,
  }
}

const INTEGER_OUTPUT: JsonSchema = {
  type: 'object',
  required: ['value'],
  properties: {
    value: { type: 'integer', minimum: 0, maximum: 1000 },
  },
  additionalProperties: false,
}

const tests: TestCase[] = [
  {
    name: 'application registry loads four unique manifest-backed atomic templates',
    run: () => {
      const definitions = v3TemplateRegistry.all()
      equal(definitions.length, 4, 'v3 atomic template count')
      deepEqual(
        definitions.map((definition) => definition.id).sort(),
        ['getViewpoint', 'resetVisibility', 'setBackgroundColor', 'setFog'],
        'registered v3 ids',
      )
      equal(v3TemplateRegistry.aiExposed().length, 1, 'only one atomic template should be AI-exposed')
      equal(v3TemplateRegistry.aiExposed()[0]?.id, 'resetVisibility', 'AI-exposed atomic id')
    },
  },
  {
    name: 'manifest rejects unknown, host-only, blocked, and emergency-global methods',
    run: () => {
      const hostOnly = capability('hostTool.reset', [], 'void', {
        classification: 'mapped',
        templatePolicy: 'host-only',
      })
      const blocked = capability('blockedTool.run', [], 'void', {
        classification: 'mapped',
        templatePolicy: 'blocked',
      })
      const emergency = capability('objectsTool.clearAllHighlights', [], 'void', {
        templatePolicy: 'host-only',
      })
      const manifest = new SspCapabilityManifest({ capabilities: [hostOnly, blocked, emergency] })
      expectThrows(() => manifest.require('missingTool.run'), 'Unknown SSP capability', 'unknown method')
      expectThrows(() => manifest.require(hostOnly.id), 'not template-allowed', 'host-only method')
      expectThrows(() => manifest.require(blocked.id), 'not template-allowed', 'blocked method')
      expectThrows(() => manifest.require(emergency.id), 'not template-allowed', 'emergency method')
    },
  },
  {
    name: 'registry rejects arbitrary code and duplicate atomic method bindings',
    run: () => {
      const readCapability = capability('fixtureTool.read', [], '{ value: number }')
      const definition = atomicDefinition({
        id: 'fixture.read',
        output: INTEGER_OUTPUT,
        call: { method: readCapability.id, args: [], result: { kind: 'direct' } },
      })
      expectThrows(
        () => registry([{ ...definition, code: 'return 1' } as AtomicTemplateDefinition], [readCapability]),
        'unsupported field',
        'arbitrary code field',
      )
      expectThrows(
        () => registry([definition, { ...definition, id: 'fixture.read-again' }], [readCapability]),
        'Duplicate atomic method binding',
        'duplicate method binding',
      )
      expectThrows(
        () => registry([definition], [{
          ...readCapability,
          mappedTemplates: ['another-template'],
        }]),
        'not approved by the SSP manifest',
        'template-to-method approval',
      )
      const readContract = inferAtomicContract(readCapability, [definition])!
      for (const mappedTemplates of [undefined, []] as const) {
        expectThrows(
          () => new V3TemplateRegistry(
            [{ source: 'missing-mapping.json', definition }],
            { capabilities: [{ ...readCapability, mappedTemplates, atomicContract: readContract }] },
          ),
          'non-empty mappedTemplates',
          'missing or empty template allow-list',
        )
      }
      expectThrows(
        () => registry([{
          ...definition,
          id: 'fixture.optional-required',
          input: {
            type: 'object',
            properties: { value: { type: 'integer' } },
            additionalProperties: false,
          },
          call: {
            method: 'fixtureTool.required',
            args: [{ $input: 'value' }],
            result: { kind: 'direct' },
          },
        }], [capability(
          'fixtureTool.required',
          [{ name: 'value', required: true }],
          '{ value: number }',
        )]),
        'may resolve to undefined',
        'required SSP input binding',
      )
      expectThrows(
        () => registry([{
          ...definition,
          id: 'fixture.effectful-timeout',
          timeoutMs: 10,
          effects: ['scene.write'],
          risk: 'visual',
          call: {
            method: 'fixtureTool.effectful',
            args: [],
            result: { kind: 'direct' },
          },
        }], [capability(
          'fixtureTool.effectful',
          [],
          '{ value: number }',
          { async: true },
        )]),
        'only supported for async read-only',
        'effectful timeout',
      )
      const literalCapability = capability(
        'fixtureTool.literal',
        [{ name: 'value', required: true }],
        '{ value: number }',
      )
      expectThrows(
        () => registry([{
          ...definition,
          id: 'fixture.literal',
          call: {
            method: literalCapability.id,
            args: [{ $literal: 'x'.repeat(4097) }],
            result: { kind: 'direct' },
          },
        }], [literalCapability]),
        'bounded, plain JSON',
        'bounded literal',
      )

      const typedDefinition = atomicDefinition({
        id: 'fixture.typed',
        input: {
          type: 'object',
          required: ['value'],
          properties: { value: { type: 'integer', minimum: 0, maximum: 10 } },
          additionalProperties: false,
        },
        output: INTEGER_OUTPUT,
        call: {
          method: 'fixtureTool.typed',
          args: [{ $input: 'value' }],
          result: { kind: 'direct' },
        },
      })
      const typedCapability = capability(
        'fixtureTool.typed',
        [{ name: 'value', required: true, type: 'number' }],
        '{ value: number }',
        {
          mappedTemplates: [typedDefinition.id],
          atomicContract: {
            templateIds: [typedDefinition.id],
            args: [{ required: true, schema: { type: 'string' } }],
            result: { kind: 'public-data', schema: INTEGER_OUTPUT },
          },
        },
      )
      expectThrows(
        () => registry([typedDefinition], [typedCapability]),
        'input schema does not match',
        'Manifest argument schema mismatch',
      )
      expectThrows(
        () => registry([typedDefinition], [{
          ...typedCapability,
          atomicContract: {
            templateIds: [typedDefinition.id],
            args: [{ required: true, schema: typedDefinition.input.properties!.value }],
            result: { kind: 'public-data', schema: { type: 'string' } },
          },
        }]),
        'public-data schema conflicts',
        'Manifest direct return schema mismatch',
      )
      const refDefinition = atomicDefinition({
        id: 'fixture.ref-primitive',
        output: EMPTY_INPUT,
        call: {
          method: 'fixtureTool.flag',
          args: [],
          result: { kind: 'object-ref', receipt: {} },
        },
      })
      expectThrows(
        () => registry([refDefinition], [capability(
          'fixtureTool.flag',
          [],
          'boolean',
          {
            mappedTemplates: [refDefinition.id],
            atomicContract: {
              templateIds: [refDefinition.id],
              args: [],
              result: { kind: 'object-ref' },
            },
          },
        )]),
        'requires an object SSP return',
        'object-ref primitive return',
      )
    },
  },
  {
    name: 'input validation is closed, bounded, defaulted, and rejects internal-ref markers',
    run: () => {
      const definition = atomicDefinition({
        id: 'fixture.default',
        input: {
          type: 'object',
          properties: {
            count: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
          },
          additionalProperties: false,
        },
        output: INTEGER_OUTPUT,
        call: {
          method: 'fixtureTool.defaulted',
          args: [{ $input: 'count' }],
          result: { kind: 'direct' },
        },
      })
      const fixtureRegistry = registry(
        [definition],
        [capability('fixtureTool.defaulted', [{ name: 'count', required: true }], '{ value: number }')],
      )
      deepEqual(fixtureRegistry.prepareInput(definition.id, {}), { count: 3 }, 'schema default')
      expectThrows(
        () => fixtureRegistry.prepareInput(definition.id, { unknown: true }),
        'unknown property',
        'unknown input property',
      )
      expectThrows(
        () => fixtureRegistry.prepareInput(definition.id, { toString: 'prototype-key' }),
        'unknown property',
        'Object.prototype key must not bypass a closed schema',
      )
      expectThrows(
        () => fixtureRegistry.prepareInput(definition.id, { count: 2, nested: { token: 'forged' } }),
        'unknown property',
        'forged token input',
      )
      expectThrows(
        () => validateAndApplyDefaults({
          type: 'object',
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              maxItems: 200,
              items: { type: 'string', maxLength: 4096 },
            },
          },
          additionalProperties: false,
        }, { items: Array.from({ length: 20 }, () => 'x'.repeat(4096)) }),
        'serialized size limit',
        'serialized input bound',
      )
      expectThrows(
        () => validateAndApplyDefaults({
          type: 'object',
          properties: {},
          additionalProperties: false,
          anyOf: [{
            type: 'object',
            properties: {},
            additionalProperties: false,
          }],
        }, {}),
        'cannot be combined with anyOf',
        'anyOf sibling constraints',
      )
    },
  },
  {
    name: 'direct runtime preserves receiver identity and projects undeclared fields',
    run: async () => {
      const definition = atomicDefinition({
        id: 'fixture.read',
        input: {
          type: 'object',
          required: ['value'],
          properties: { value: { type: 'integer', minimum: 0, maximum: 1000 } },
          additionalProperties: false,
        },
        output: INTEGER_OUTPUT,
        call: {
          method: 'fixtureTool.read',
          args: [{ $input: 'value' }],
          result: { kind: 'direct' },
        },
      })
      const fixtureRegistry = registry(
        [definition],
        [capability('fixtureTool.read', [{ name: 'value', required: true }], '{ value: number }')],
      )
      const controller = {
        offset: 4,
        read(value: number) {
          return { value: value + this.offset, secret: 'must not escape' }
        },
      }
      const runtime = new AtomicTemplateRuntime(fixtureRegistry, { fixtureTool: controller })
      deepEqual(await runtime.execute(definition.id, { value: 6 }), { value: 10 }, 'projected direct result')
    },
  },
  {
    name: 'receipt runtime applies call defaults and enforces AI exposure',
    run: async () => {
      let received: unknown
      const definition = atomicDefinition({
        id: 'fixture.write',
        ai: { exposed: false },
        input: {
          type: 'object',
          properties: {
            options: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        output: {
          type: 'object',
          required: ['ok'],
          properties: { ok: { const: true } },
          additionalProperties: false,
        },
        effects: ['scene.write'],
        risk: 'visual',
        call: {
          method: 'fixtureTool.write',
          args: [{ $input: 'options', default: {} }],
          result: { kind: 'receipt', value: { ok: true } },
        },
      })
      const fixtureRegistry = registry(
        [definition],
        [capability('fixtureTool.write', [{ name: 'options', required: false }], 'void')],
      )
      const runtime = new AtomicTemplateRuntime(fixtureRegistry, {
        fixtureTool: {
          write(options: unknown) {
            received = options
          },
        },
      })
      await expectRejects(
        () => runtime.execute(definition.id, {}),
        'not AI-exposed',
        'hidden atomic AI gate',
      )
      deepEqual(
        await runtime.execute(definition.id, {}, { aiOnly: false }),
        { ok: true },
        'static receipt',
      )
      deepEqual(received, {}, 'call argument default')
    },
  },
  {
    name: 'ObjectRef is opaque, identity-bound, execution-local, and never public',
    run: async () => {
      const rawObject = { name: 'runtime-only-object' }
      const definition = atomicDefinition({
        id: 'fixture.object-ref',
        output: {
          type: 'object',
          required: ['found'],
          properties: { found: { const: true } },
          additionalProperties: false,
        },
        call: {
          method: 'fixtureTool.find',
          args: [],
          result: { kind: 'object-ref', receipt: { found: true } },
        },
      })
      const fixtureRegistry = registry(
        [definition],
        [capability('fixtureTool.find', [], 'Record<string, unknown>')],
      )
      const runtime = new AtomicTemplateRuntime(fixtureRegistry, {
        fixtureTool: { find: () => rawObject },
      })
      const firstScope = new ExecutionScope()
      const secondScope = new ExecutionScope()
      const result = await runtime.executeInScope(definition.id, {}, firstScope)
      deepEqual(result.public, { found: true }, 'public ObjectRef receipt')
      const ref = result.internal
      assert(ref && typeof ref === 'object', 'internal ObjectRef should exist')
      equal(firstScope.resolve(ref as never), rawObject, 'same-scope identity resolution')
      expectThrows(
        () => firstScope.resolve({ ...(ref as object) } as never),
        'Forged or cross-scope',
        'copied ObjectRef',
      )
      expectThrows(
        () => secondScope.resolve(ref as never),
        'Forged or cross-scope',
        'cross-scope ObjectRef',
      )
      assert(!JSON.stringify(result.public).includes('token'), 'public output must not contain a token')
      firstScope.close()
      expectThrows(() => firstScope.resolve(ref as never), 'closed', 'closed ObjectRef scope')
      secondScope.close()
    },
  },
  {
    name: 'public projection rejects cyclic and invalid declared output',
    run: async () => {
      const cycle: Record<string, unknown> = { value: 1 }
      cycle.nested = cycle
      const definition = atomicDefinition({
        id: 'fixture.cycle',
        output: {
          type: 'object',
          required: ['value', 'nested'],
          properties: {
            value: { type: 'integer', minimum: 0, maximum: 1000 },
            nested: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        call: { method: 'fixtureTool.cycle', args: [], result: { kind: 'direct' } },
      })
      const fixtureRegistry = registry(
        [definition],
        [capability('fixtureTool.cycle', [], '{ value: number }')],
      )
      const runtime = new AtomicTemplateRuntime(fixtureRegistry, {
        fixtureTool: { cycle: () => cycle },
      })
      await expectRejects(
        () => runtime.execute(definition.id, {}),
        'cyclic output',
        'cyclic public output',
      )
    },
  },
  {
    name: 'unified catalog is v3-first and host emergency template is not AI-visible',
    run: () => {
      equal(templateCatalog.isV3('resetVisibility'), true, 'resetVisibility generation')
      equal(resolveAiTemplateId('resetVisibility'), 'resetVisibility', 'v3 AI id')
      equal(resolveAiTemplateId('clearAllHighlights'), null, 'host emergency AI id')
      equal(fallbackParse('__clear_highlight__'), null, 'host command must not become fallback Intent')
      equal(fallbackParse('清除高亮'), null, 'natural language must not select host emergency action')
      expectThrows(
        () => templateCatalog.prepareParams('resetVisibility', { unknown: true }),
        'unknown property',
        'v3 catalog strict input',
      )
      const prompt = templateCatalog.toAiPromptSection()
      assert(prompt.includes('resetVisibility'), 'v3 AI prompt should include resetVisibility')
      assert(!prompt.includes('clearAllHighlights'), 'AI prompt must hide clearAllHighlights')
    },
  },
  {
    name: 'host clear-highlights adapter works without entering the AI catalog',
    run: async () => {
      const scene = new THREE.Scene()
      const material = new THREE.MeshStandardMaterial({ emissive: 0x010203 })
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
      mesh.userData.sid = 'host-clear-fixture'
      scene.add(mesh)
      setSspContext({
        scene,
        camera: new THREE.PerspectiveCamera(),
        renderer: {} as THREE.WebGLRenderer,
        domElement: {} as HTMLElement,
      })
      try {
        ssp.objectsTool.setHighlight(mesh, '#ff0000')
        assert(
          (mesh.material as THREE.MeshStandardMaterial).emissive.getHex() !== 0x010203,
          'fixture should be highlighted first',
        )
        await expectRejects(
          () => executeTemplate('clearAllHighlights', {}, { aiOnly: false }),
          'host-only template requires the explicit host action adapter',
          'generic template runtime host-only bypass',
        )
        assert(
          (mesh.material as THREE.MeshStandardMaterial).emissive.getHex() !== 0x010203,
          'rejected generic execution must leave the highlight intact',
        )
        const result = await executeHostTemplateAction('clearAllHighlights')
        assert(result && typeof result === 'object', 'host action should return its legacy receipt')
        equal((result as Record<string, unknown>).cleared, true, 'host clear receipt')
        equal(mesh.material, material, 'host action should restore the original material reference')
        equal(material.emissive.getHex(), 0x010203, 'host action should restore the material')
        equal(resolveAiTemplateId('clearAllHighlights'), null, 'host action must remain AI-hidden')
      } finally {
        clearSspContext()
        mesh.geometry.dispose()
        material.dispose()
      }
    },
  },
  {
    name: 'migrated scene and camera templates consume declared params and return projected receipts',
    run: async () => {
      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(55)
      camera.position.set(3, 4, 5)
      setSspContext({
        scene,
        camera,
        renderer: {} as THREE.WebGLRenderer,
        domElement: {} as HTMLElement,
      })
      try {
        deepEqual(
          await executeTemplate(
            'setBackgroundColor',
            { color: '#123456' },
            { aiOnly: false },
          ),
          { ok: true },
          'background receipt',
        )
        assert(scene.background instanceof THREE.Color, 'background should be a THREE.Color')
        equal(scene.background.getHex(), 0x123456, 'declared background color')

        deepEqual(
          await executeTemplate(
            'setFog',
            { options: { color: '#abcdef', near: 2, far: 20, visible: true } },
            { aiOnly: false },
          ),
          { ok: true },
          'fog receipt',
        )
        assert(scene.fog instanceof THREE.Fog, 'fog should use the declared linear options')
        equal(scene.fog.near, 2, 'declared fog near')
        equal(scene.fog.far, 20, 'declared fog far')
        equal(scene.fog.color.getHex(), 0xabcdef, 'declared fog color')

        deepEqual(
          await executeTemplate('getViewpoint', {}, { aiOnly: false }),
          {
            position: { x: 3, y: 4, z: 5 },
            target: { x: 0, y: 0, z: 0 },
            fov: 55,
          },
          'projected viewpoint',
        )
      } finally {
        clearSspContext()
      }
    },
  },
  {
    name: 'unified runtime executes migrated ids through v3 and never falls through to v2',
    run: async () => {
      const scene = new THREE.Scene()
      const hidden = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
      hidden.visible = false
      scene.add(hidden)
      setSspContext({
        scene,
        camera: new THREE.PerspectiveCamera(),
        renderer: {} as THREE.WebGLRenderer,
        domElement: {} as HTMLElement,
      })
      try {
        const result = await executeTemplate('resetVisibility', {}, { aiOnly: true })
        assert(result && typeof result === 'object', 'v3 resetVisibility should return a record')
        assert(!('message' in result), 'legacy resetVisibility message must not leak through v3')
        equal((result as Record<string, unknown>).hiddenBefore, 1, 'v3 hidden count')
        await expectRejects(
          () => executeTemplate('getViewpoint', {}, { aiOnly: true }),
          'not AI-exposed',
          'hidden v3 id must not fall through to legacy',
        )
      } finally {
        clearSspContext()
        hidden.geometry.dispose()
        ;(hidden.material as THREE.Material).dispose()
      }
    },
  },
]

export async function runTemplateV3Suite(): Promise<TemplateV3SuiteResult> {
  const start = performance.now()
  const names: string[] = []
  for (const test of tests) {
    await test.run()
    names.push(test.name)
    console.log(`[templates:v3:test] PASS ${test.name}`)
  }
  return {
    passed: names.length,
    names,
    durationMs: performance.now() - start,
  }
}
