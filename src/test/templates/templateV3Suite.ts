import * as THREE from 'three'
import { ssp } from '../../ssp'
import { fallbackParse, isVisibilityUndoQuery } from '../../ai/rules/fallbackRules'
import { ChatContext, type ChatTurn } from '../../ai/context/chatContext'
import { createTemplateIntent } from '../../ai/types/Intent'
import { clearSspContext, setSspContext } from '../../ssp/core/context'
import { templateCatalog, resolveAiTemplateId } from '../../templates/catalog'
import { executeTemplate } from '../../templates/runtime'
import {
  executeHostTemplateAction,
  getVisibilityUndoState,
  invalidateVisibilityUndo,
} from '../../templates/hostActions'
import {
  VisibilityUndoCoordinator,
  type VisibilityUndoReceipt,
} from '../../adapters/visibilityUndo'
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
    name: 'visibility undo phrases use a narrow host-only route and never become an Intent',
    run: () => {
      for (const query of ['撤回', '撤销', '撤回上一步', '撤销 上一步', '  撤回  ']) {
        equal(isVisibilityUndoQuery(query), true, `positive undo route: ${query}`)
        equal(fallbackParse(query), null, `host-only undo must not become fallback Intent: ${query}`)
      }
      for (const query of ['请撤回', '撤回一下', '撤回刚才的隐藏', '撤回上两步', '撤回并显示']) {
        equal(isVisibilityUndoQuery(query), false, `negative undo route: ${query}`)
      }
    },
  },
  {
    name: 'chat store routes natural-language undo through host action without calling the LLM',
    run: async () => {
      const scene = new THREE.Scene()
      const door = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
      Object.assign(door.userData, { sid: 'DOOR_A_1F_CHAT_UNDO', renderType: 'DOOR' })
      scene.add(door)
      setSspContext({
        scene,
        camera: new THREE.PerspectiveCamera(),
        renderer: {} as THREE.WebGLRenderer,
        domElement: {} as HTMLElement,
      })

      const previousStorage = globalThis.localStorage
      const storageData = new Map<string, string>()
      const storage = {
        getItem: (key: string) => storageData.get(key) ?? null,
        setItem: (key: string, value: string) => { storageData.set(key, value) },
        removeItem: (key: string) => { storageData.delete(key) },
        clear: () => { storageData.clear() },
        key: (index: number) => [...storageData.keys()][index] ?? null,
        get length() { return storageData.size },
      } as Storage
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
      const previousFetch = globalThis.fetch
      let llmCalls = 0
      const llmUserPrompts: string[] = []
      globalThis.fetch = (async () => {
        llmCalls += 1
        throw new Error('LLM must not be called for host undo')
      }) as typeof fetch

      try {
        invalidateVisibilityUndo()
        await executeTemplate('query-scene', {
          operation: 'hide',
          target: { renderType: 'DOOR' },
        })
        equal(door.visible, false, 'fixture should be hidden before natural-language undo')

        const { createPinia, setActivePinia } = await import('pinia')
        const { useChatStore } = await import('../../stores/chat')
        setActivePinia(createPinia())
        const chat = useChatStore()
        await chat.sendQuery('撤回')

        equal(llmCalls, 0, 'natural-language undo must not call LLM')
        equal(door.visible, true, 'natural-language undo restores the hidden object')
        const undoTurn = chat.turns[chat.turns.length - 1]
        assert(undoTurn?.role === 'assistant', 'natural-language undo appends an assistant result')
        equal(undoTurn.llmVisible, false, 'host assistant turn is hidden from LLM history')
        equal(undoTurn.intent, undefined, 'host-only undo assistant result has no Intent')
        assert(undoTurn.resultMessage?.includes('精确恢复 1 个对象'), 'undo result is explicit')
        equal(chat.turns[0]?.llmVisible, false, 'host user turn is hidden from LLM history')

        await chat.sendQuery('撤销上一步')
        equal(llmCalls, 0, 'no-record undo must not call LLM')
        equal(chat.lastError, '当前没有可撤回的显示操作', 'no-record undo has a friendly deterministic error')
        const noRecordTurn = chat.turns[chat.turns.length - 1]
        equal(noRecordTurn?.resultMessage, '当前没有可撤回的显示操作', 'no-record assistant result is explicit')

        const entries = JSON.parse(storageData.get('ai_template_log_v2') ?? '[]') as Array<{
          errored: boolean
          errorMsg?: string
        }>
        equal(entries[entries.length - 2]?.errored, false, 'successful host undo is not an audit error')
        equal(entries[entries.length - 1]?.errored, true, 'rejected host undo is an audit error')
        equal(entries[entries.length - 1]?.errorMsg, '当前没有可撤回的显示操作', 'rejected host undo audit reason')

        globalThis.fetch = (async (_input, init) => {
          llmCalls += 1
          const body = JSON.parse(String(init?.body ?? '{}')) as {
            messages?: Array<{ content?: unknown }>
          }
          llmUserPrompts.push(String(body.messages?.[1]?.content ?? ''))
          return new Response(JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  action: 'template',
                  templateId: 'query-scene',
                  params: { operation: 'list', target: { renderType: 'DOOR' } },
                }),
              },
            }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }) as typeof fetch
        await chat.sendQuery('列出所有门')
        equal(llmCalls, 1, 'ordinary query still calls LLM')
        assert(!llmUserPrompts[0]?.includes('撤回'), 'LLM history omits host undo turns')
        assert(!llmUserPrompts[0]?.includes('精确恢复'), 'LLM history omits host assistant result')
      } finally {
        globalThis.fetch = previousFetch
        if (previousStorage === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
        else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage })
        invalidateVisibilityUndo()
        clearSspContext()
        door.geometry.dispose()
        ;(door.material as THREE.Material).dispose()
      }
    },
  },
  {
    name: 'chat context keeps ordinary history and inheritance through host-turn churn',
    run: () => {
      const context = new ChatContext()
      const latestIntent = createTemplateIntent('query-scene', {
        operation: 'hide',
        scope: { buildings: ['B'], levels: [2] },
      })
      const ordinaryTurns: ChatTurn[] = []
      for (let index = 0; index < 5; index++) {
        ordinaryTurns.push(
          { role: 'user', content: `普通查询 ${index}`, timestamp: index * 2 },
          {
            role: 'assistant',
            content: `普通结果 ${index}`,
            intent: index === 4 ? latestIntent : createTemplateIntent('query-scene', {
              operation: 'list',
              target: { renderType: 'DOOR' },
            }),
            resultSids: index === 4 ? ['DOOR_B_2F_001'] : undefined,
            timestamp: index * 2 + 1,
          },
        )
      }
      ordinaryTurns.forEach((turn) => context.push(turn))
      for (let index = 0; index < 12; index++) {
        context.push({ role: 'user', content: `撤回 ${index}`, llmVisible: false, timestamp: 100 + index * 2 })
        context.push({ role: 'assistant', content: `已撤回第 ${index} 次`, llmVisible: false, timestamp: 101 + index * 2 })
      }

      equal(context.turns.length, 10, 'UI transcript keeps its existing ring capacity')
      equal(context.getHistoryForLLM().length, 5, 'LLM context keeps the latest five ordinary turns')
      assert(
        context.getHistoryForLLM().every((turn) => !turn.content.startsWith('撤回')),
        'LLM context excludes all host turns after churn',
      )
      equal(context.lastIntent, latestIntent, 'lastIntent survives host-turn churn')
      deepEqual(context.lastResultSids, ['DOOR_B_2F_001'], 'lastResultSids survive host-turn churn')

      const inherited = context.applyInheritance(createTemplateIntent('query-scene', {
        operation: 'show',
        scope: { levels: [2] },
      }), '也显示')
      deepEqual(
        (inherited.params as { scope?: { buildings?: string[]; levels?: number[] } }).scope,
        { buildings: ['B'], levels: [2] },
        'floor inheritance reads the ordinary context ring',
      )

      context.clear()
      equal(context.turns.length, 0, 'clear empties the UI ring')
      equal(context.getHistoryForLLM().length, 0, 'clear empties the context ring')
      equal(context.lastIntent, null, 'clear empties context intent')
    },
  },
  {
    name: 'unified catalog is v3-first and host emergency template is not AI-visible',
    run: () => {
      equal(templateCatalog.isV3('resetVisibility'), true, 'resetVisibility generation')
      equal(resolveAiTemplateId('resetVisibility'), 'resetVisibility', 'v3 AI id')
      equal(resolveAiTemplateId('clearAllHighlights'), null, 'host emergency AI id')
      equal(resolveAiTemplateId('undoVisibility'), null, 'visibility undo host action AI id')
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
      assert(!prompt.includes('undoVisibility'), 'AI prompt must hide visibility undo host action')
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
    name: 'query-scene hide and show keep one precise latest visibility undo',
    run: async () => {
      const scene = new THREE.Scene()
      const doorVisible = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
      const doorHidden = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
      const windowHidden = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
      Object.assign(doorVisible.userData, { sid: 'DOOR_A_1F_001', renderType: 'DOOR' })
      Object.assign(doorHidden.userData, { sid: 'DOOR_A_1F_002', renderType: 'DOOR' })
      Object.assign(windowHidden.userData, { sid: 'WINDOW_A_1F_001', renderType: 'WINDOW' })
      doorHidden.visible = false
      windowHidden.visible = false
      scene.add(doorVisible, doorHidden, windowHidden)
      setSspContext({
        scene,
        camera: new THREE.PerspectiveCamera(),
        renderer: {} as THREE.WebGLRenderer,
        domElement: {} as HTMLElement,
      })
      invalidateVisibilityUndo()
      try {
        await executeTemplate('query-scene', {
          operation: 'hide',
          target: { renderType: 'DOOR' },
        })
        equal(doorVisible.visible, false, 'hide visible door')
        equal(doorHidden.visible, false, 'hide must preserve already hidden door')
        deepEqual(
          getVisibilityUndoState(),
          { canUndo: true, operation: 'hide', changedCount: 1 },
          'hide transaction state',
        )

        const hideUndo = await executeHostTemplateAction('undoVisibility') as VisibilityUndoReceipt
        deepEqual(
          hideUndo,
          { action: 'undoVisibility', undone: true, operation: 'hide', changedCount: 1 },
          'hide undo receipt',
        )
        equal(doorVisible.visible, true, 'hide undo restores visible door')
        equal(doorHidden.visible, false, 'hide undo preserves pre-hidden door')

        await executeTemplate('query-scene', {
          operation: 'hide',
          target: { renderType: 'DOOR' },
        })
        await executeTemplate('query-scene', {
          operation: 'show',
          target: { renderType: 'WINDOW' },
        })
        deepEqual(
          getVisibilityUndoState(),
          { canUndo: true, operation: 'show', changedCount: 1 },
          'show replaces the previous hide transaction',
        )
        const showUndo = await executeHostTemplateAction('undoVisibility') as VisibilityUndoReceipt
        equal(showUndo.undone, true, 'show undo succeeds')
        equal(windowHidden.visible, false, 'show undo restores pre-hidden window')
        equal(doorVisible.visible, false, 'show undo must not undo the previous hide')
        const secondUndo = await executeHostTemplateAction('undoVisibility') as VisibilityUndoReceipt
        equal(secondUndo.undone, false, 'single-step history is consumed')
        equal(secondUndo.reason, 'no-transaction', 'no second undo or redo history')
      } finally {
        invalidateVisibilityUndo()
        clearSspContext()
        for (const mesh of [doorVisible, doorHidden, windowHidden]) {
          mesh.geometry.dispose()
          ;(mesh.material as THREE.Material).dispose()
        }
      }
    },
  },
  {
    name: 'query-scene isolate undo restores non-SID and pre-hidden meshes exactly',
    run: async () => {
      const scene = new THREE.Scene()
      const target = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
      const nonSidVisible = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
      const nonSidHidden = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
      const helper = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
      Object.assign(target.userData, { sid: 'DOOR_A_1F_003', renderType: 'DOOR' })
      nonSidHidden.visible = false
      helper.name = 'ssp_helper_route'
      scene.add(target, nonSidVisible, nonSidHidden, helper)
      setSspContext({
        scene,
        camera: new THREE.PerspectiveCamera(),
        renderer: {} as THREE.WebGLRenderer,
        domElement: {} as HTMLElement,
      })
      invalidateVisibilityUndo()
      try {
        await executeTemplate('query-scene', {
          operation: 'isolate',
          target: { renderType: 'DOOR' },
        })
        equal(target.visible, true, 'isolate target remains visible')
        equal(nonSidVisible.visible, false, 'isolate hides visible non-SID mesh')
        equal(nonSidHidden.visible, false, 'isolate keeps pre-hidden non-SID mesh hidden')
        equal(helper.visible, true, 'isolate ignores helpers')
        deepEqual(
          getVisibilityUndoState(),
          { canUndo: true, operation: 'isolate', changedCount: 1 },
          'isolate records every real change rather than returned SIDs',
        )
        const receipt = await executeHostTemplateAction('undoVisibility') as VisibilityUndoReceipt
        equal(receipt.undone, true, 'isolate undo succeeds')
        equal(nonSidVisible.visible, true, 'isolate undo restores non-SID visible mesh')
        equal(nonSidHidden.visible, false, 'isolate undo preserves pre-hidden mesh')
        equal(helper.visible, true, 'isolate undo leaves helper unchanged')
      } finally {
        invalidateVisibilityUndo()
        clearSspContext()
        for (const mesh of [target, nonSidVisible, nonSidHidden, helper]) {
          mesh.geometry.dispose()
          ;(mesh.material as THREE.Material).dispose()
        }
      }
    },
  },
  {
    name: 'visibility undo fails closed for conflicts and rolls back partial undo',
    run: async () => {
      const scene = new THREE.Scene()
      const first = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
      const second = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
      scene.add(first, second)
      const coordinator = new VisibilityUndoCoordinator()
      const setVisible = (object: THREE.Object3D, visible: boolean) => {
        object.visible = visible
      }

      const rollbackCoordinator = new VisibilityUndoCoordinator()
      await expectRejects(
        () => rollbackCoordinator.run(scene, 'hide', () => {
          first.visible = false
          throw new Error('injected operation failure')
        }, setVisible),
        'injected operation failure',
        'failed visibility operation',
      )
      equal(first.visible, true, 'failed visibility operation restores the before state')
      equal(rollbackCoordinator.getState().canUndo, false, 'failed operation creates no undo')

      await coordinator.run(scene, 'hide', () => {
        first.visible = false
        second.visible = false
      }, setVisible)
      first.visible = true
      const conflict = coordinator.undo(scene, setVisible)
      equal(conflict.undone, false, 'after-state conflict rejects undo')
      equal(conflict.reason, 'after-conflict', 'after-state conflict reason')
      equal(second.visible, false, 'conflict rejection performs no partial writes')
      equal(coordinator.getState().canUndo, false, 'stale transaction is invalidated')

      first.visible = true
      second.visible = true
      await coordinator.run(scene, 'hide', () => {
        first.visible = false
        second.visible = false
      }, setVisible)
      const failedUndo = coordinator.undo(scene, (object, visible) => {
        if (object === second && visible) throw new Error('injected setter failure')
        object.visible = visible
      })
      equal(failedUndo.undone, false, 'partial undo is rejected')
      equal(failedUndo.reason, 'undo-failed', 'successful compensation reports undo failure')
      equal(first.visible, false, 'partial undo is compensated to post-operation state')
      equal(second.visible, false, 'failed entry remains at post-operation state')

      coordinator.invalidate()
      equal(coordinator.getState().canUndo, false, 'model generation invalidation clears undo')
      scene.remove(first)
      const missing = coordinator.undo(scene, setVisible)
      equal(missing.reason, 'no-transaction', 'invalidated generation cannot be undone')

      for (const mesh of [first, second]) {
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
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
