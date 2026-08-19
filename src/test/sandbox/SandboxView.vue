<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, type WatchStopHandle } from 'vue'
import * as THREE from 'three'
import { useThreeScene } from '@/composables/useThreeScene'
import { useModelLibrary } from '@/composables/useModelLibrary'
import { ssp } from '@/ssp'
import { getSspContext, hasSspContext } from '@/ssp/core/context'
import { useChatStore } from '@/stores/chat'
import { runRegisteredTemplate, formatLog, type LogEntry } from './runner'
import { templateRegistry, type TemplateDefinition } from '@/templates/registry'
import {
  createGlbTopologyRuntime,
  extractEmbeddedTopology,
  topologyOverrideTool,
  type GlbTopologyDocument,
  type GlbTopologyAssetMount,
  type TopologyOverrideChangeEvent,
} from '@/adapters/glbTopology'
import {
  validateTopologyOverrideDocument,
  type TopologyOverrideDocument,
  type TopologyOverrideV2Document,
} from '@/adapters/glbTopology/override.js'
import {
  clonePoints,
  createEmptyOverrideDocument,
  deterministicStringify,
  edgeEndpoints,
  findOverrideRecord,
  findNonSameLayerOverrideEdgeIds,
  getEdge,
  getGraph,
  modelToWorld,
  readOverrideRecords,
  sameLayer,
  worldToModel,
  type TopologyEditorPoint,
} from './topologyEditor'
import ChatPanel from '@/views/ChatPanel.vue'

// 把 THREE 挂到 window,方便 console 里直接调试 (沙盒环境不挂会 ReferenceError)
if (typeof window !== 'undefined') {
  ;(window as any).THREE = THREE
}

// 模板状态管理 (passed / skipped / 无状态), localStorage 持久化
export type TemplateStatus = 'default' | 'passed' | 'skipped'

const STATUS_KEY = 'ssp.template-status'

function loadStatus(): Record<string, TemplateStatus> {
  try {
    const raw = localStorage.getItem(STATUS_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, TemplateStatus>
  } catch {
    return {}
  }
}

const templateStatus = ref<Record<string, TemplateStatus>>(loadStatus())

function setStatus(id: string, status: TemplateStatus) {
  if (status === 'default') {
    delete templateStatus.value[id]
  } else {
    templateStatus.value[id] = status
  }
  templateStatus.value = { ...templateStatus.value } // 触发响应式
  try {
    if (Object.keys(templateStatus.value).length === 0) {
      localStorage.removeItem(STATUS_KEY)
    } else {
      localStorage.setItem(STATUS_KEY, JSON.stringify(templateStatus.value))
    }
  } catch {
    // ignore quota / privacy mode errors
  }
}

function getStatus(id: string): TemplateStatus {
  return templateStatus.value[id] ?? 'default'
}

// 右键菜单状态
const contextMenu = ref<{
  templateId: string
  x: number
  y: number
} | null>(null)

function openContextMenu(e: MouseEvent, templateId: string) {
  e.preventDefault()
  e.stopPropagation()
  contextMenu.value = {
    templateId,
    x: e.clientX,
    y: e.clientY,
  }
}

/** Console 复制按钮: 状态 (idle / copied / failed) */
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
const copyBtnLabel = computed(() => {
  if (copyState.value === 'copied') return '已复制'
  if (copyState.value === 'failed') return '复制失败'
  return '复制'
})
const copyBtnTitle = computed(() => {
  if (logs.value.length === 0) return '暂无日志'
  return `复制 ${logs.value.length} 条日志到剪贴板`
})

/** 把所有 console 日志按行拼成文本复制到剪贴板 */
async function copyLogs() {
  if (logs.value.length === 0) return
  const text = logs.value
    .map((entry) => `[${entry.level}] ${formatLog(entry)}`)
    .join('\n')
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      // 兼容旧浏览器: 用临时 textarea + execCommand
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    copyState.value = 'copied'
    setTimeout(() => (copyState.value = 'idle'), 1500)
  } catch {
    copyState.value = 'failed'
    setTimeout(() => (copyState.value = 'idle'), 1500)
  }
}

function closeContextMenu() {
  contextMenu.value = null
}

function applyStatus(status: TemplateStatus) {
  if (contextMenu.value) {
    setStatus(contextMenu.value.templateId, status)
    closeContextMenu()
  }
}

function handleWindowClick(): void {
  if (contextMenu.value) closeContextMenu()
}

function handleWindowKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeContextMenu()
}

onMounted(() => {
  // 仅在菜单已打开时, 其它位置的右键/点击关闭它
  // 不全局拦截 contextmenu, 否则会拦截掉模板按钮的 openContextMenu
  window.addEventListener('click', handleWindowClick)
  window.addEventListener('keydown', handleWindowKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', handleWindowClick)
  window.removeEventListener('keydown', handleWindowKeydown)
})

type TemplateMeta = Readonly<TemplateDefinition> & { filename: string }

// 加载 ssp 模块源码 (raw 字符串, 不编译)
// as: 'raw' 直接拿源码, 用于右侧面板展示
const sspModules = import.meta.glob('@/ssp/**/*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>

// === 模型构件树 (Models tab) ===
interface ModelNode {
  /** 节点 id (scene tree 里唯一) */
  id: string
  /** 显示名 */
  name: string
  /** 子节点 */
  children: ModelNode[]
  /** 节点 userData.floorName (仅楼层根节点有) */
  floorName?: string
  /** 节点 userData.renderType (mesh 才有) */
  renderType?: string
  /** mesh count (用于分组显示) */
  meshCount?: number
}

/** 触发刷新的 tick — 用 setInterval 周期递增, 触发 modelTree 重新计算 */
const sceneTick = ref(0)
let sceneTickTimer: number | null = null

/** 周期性扫描 scene, 重建构件树 */
const modelTree = computed<ModelNode[]>(() => {
  // 读 sceneTick, 形成依赖
  void sceneTick.value
  if (!hasSspContext()) return []
  try {
    const ctx = getSspContext()
    return buildModelTree(ctx.scene)
  } catch {
    return []
  }
})

/** 总 mesh 数 (所有楼层加和) */
const totalMeshCount = computed(() =>
  modelTree.value.reduce((sum, n) => sum + (n.meshCount ?? 0), 0),
)

function buildModelTree(scene: THREE.Scene): ModelNode[] {
  // 一级: 找出 scene 里所有带 floorName 的 GLB root
  // 二级: 每个 root 下的 mesh 按 renderType 分组
  // 三级: 同 renderType 的 mesh 列表
  const floors: ModelNode[] = []
  for (const child of scene.children) {
    const floorName = child.userData?.floorName as string | undefined
    if (!floorName) continue
    // 按 renderType 分组
    const byType = new Map<string, THREE.Object3D[]>()
    let totalMeshes = 0
    child.traverse((obj) => {
      const mesh = obj as THREE.Object3D
      const rt = mesh.userData?.renderType as string | undefined
      if (!rt) return
      if (!byType.has(rt)) byType.set(rt, [])
      byType.get(rt)!.push(mesh)
      totalMeshes++
    })
    const typeNodes: ModelNode[] = []
    for (const [rt, meshes] of byType) {
      // 子构件: 按 name 排序, 同名合并
      const childNodes: ModelNode[] = []
      const nameMap = new Map<string, number>()
      for (const m of meshes) {
        const n = m.name || '(unnamed)'
        nameMap.set(n, (nameMap.get(n) ?? 0) + 1)
      }
      for (const [n, cnt] of nameMap) {
        childNodes.push({
          id: `${floorName}::${rt}::${n}`,
          name: cnt > 1 ? `${n} × ${cnt}` : n,
          children: [],
        })
      }
      typeNodes.push({
        id: `${floorName}::${rt}`,
        name: rt,
        children: childNodes,
        floorName,
        renderType: rt,
        meshCount: meshes.length,
      })
    }
    // 按 renderType 名字排序
    typeNodes.sort((a, b) => a.name.localeCompare(b.name))
    floors.push({
      id: floorName,
      name: floorName,
      children: typeNodes,
      floorName,
      meshCount: totalMeshes,
    })
  }
  // 按 floorName 排序 (B1 在前, 楼层数字大在后)
  floors.sort((a, b) => a.floorName!.localeCompare(b.floorName!))
  return floors
}

/** 搜索过滤 */
const treeSearch = ref('')
const treeSearchLower = computed(() => treeSearch.value.toLowerCase().trim())

/** 树展开状态 (节点 id → 是否展开) */
const expandedNodes = ref<Set<string>>(new Set())

/** 扁平化 + 过滤后的树 (用于渲染) */
interface TreeRow {
  node: ModelNode
  depth: number
  expanded: boolean
  hasChildren: boolean
}
const visibleTreeRows = computed<TreeRow[]>(() => {
  const q = treeSearchLower.value
  const expanded = expandedNodes.value
  const rows: TreeRow[] = []
  const walk = (nodes: ModelNode[], depth: number) => {
    for (const node of nodes) {
      // 搜索过滤: 节点名匹配 OR 任一子节点匹配 (OR 递归)
      const matchNode = !q || node.name.toLowerCase().includes(q)
      // 子节点是否有匹配
      const anyChildMatch = (n: ModelNode): boolean => {
        if (!q) return false
        if (n.name.toLowerCase().includes(q)) return true
        return n.children.some(anyChildMatch)
      }
      const childMatches = node.children.some(anyChildMatch)
      // 没匹配上且 子节点也没匹配 — 跳过
      if (!matchNode && !childMatches) continue
      const hasChildren = node.children.length > 0
      const isExpanded = expanded.has(node.id) || (q.length > 0 && childMatches)
      rows.push({ node, depth, expanded: isExpanded, hasChildren })
      if (hasChildren && isExpanded) {
        walk(node.children, depth + 1)
      }
    }
  }
  walk(modelTree.value, 0)
  return rows
})

function toggleNode(id: string) {
  const set = new Set(expandedNodes.value)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  expandedNodes.value = set
}

/** 展开所有 / 折叠所有 */
function expandAll() {
  const set = new Set<string>()
  const walk = (nodes: ModelNode[]) => {
    for (const n of nodes) {
      set.add(n.id)
      walk(n.children)
    }
  }
  walk(modelTree.value)
  expandedNodes.value = set
}
function collapseAll() {
  expandedNodes.value = new Set()
}

/** 点击节点 — 在 3D 视图中相机飞行到该对象 */
function focusNode(node: ModelNode) {
  if (!node.floorName || !node.renderType) return
  if (!hasSspContext()) return
  // 找对应对象
  const ctx = getSspContext()
  // 简化: 用 floorName 找 GLB root
  const obj = ctx.scene.getObjectByName(node.floorName)
  if (obj) {
    ssp.cameraController.flyToObject(obj as any).catch(() => {})
  }
}

/** 启动 scene tick 定时器 — 每 1.5s 扫一次 */
onMounted(() => {
  sceneTickTimer = window.setInterval(() => {
    sceneTick.value++
  }, 1500)
})
onBeforeUnmount(() => {
  if (sceneTickTimer !== null) {
    window.clearInterval(sceneTickTimer)
    sceneTickTimer = null
  }
})

interface SspModuleMeta {
  /** 一级分类: 模块名 (camera / scene / objects / core 等) */
  category: string
  /** 文件名 (cameraController.ts) */
  filename: string
  /** 完整源码 */
  source: string
  /** 行数 */
  lines: number
}

/** 把 ssp 模块组织成分组结构, 按模块名分组 */
const sspModuleList = computed<SspModuleMeta[]>(() => {
  return Object.entries(sspModules)
    .map(([path, source]) => {
      const parts = path.split('/').filter((s) => !s.startsWith('@'))
      parts.pop() // 去 filename
      const category = parts.pop() ?? 'root'
      const filename = path.split('/').pop() ?? ''
      return {
        category,
        filename,
        source,
        lines: source.split('\n').length,
      }
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.filename.localeCompare(b.filename))
})

const sspGroups = computed(() => {
  const map = new Map<string, SspModuleMeta[]>()
  for (const m of sspModuleList.value) {
    if (!map.has(m.category)) map.set(m.category, [])
    map.get(m.category)!.push(m)
  }
  return Array.from(map.entries()).map(([category, modules]) => ({ category, modules }))
})

/** sidebar tab: 'templates' | 'models' | 'ssp' */
const sidebarTab = ref<'templates' | 'models' | 'ssp'>('templates')
const selectedSspFile = ref<{ category: string; filename: string; source: string } | null>(null)

/** 默认选中第一个 ssp 文件, 方便用户查看 */
if (sspModuleList.value.length > 0 && !selectedSspFile.value) {
  const first = sspModuleList.value[0]
  selectedSspFile.value = { category: first.category, filename: first.filename, source: first.source }
}

/** ssp 模块代码复制 */
async function copySspSource(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    return true
  } catch {
    return false
  }
}
const sspCopyState = ref<'idle' | 'copied' | 'failed'>('idle')
async function handleCopySsp() {
  if (!selectedSspFile.value) return
  const ok = await copySspSource(selectedSspFile.value.source)
  sspCopyState.value = ok ? 'copied' : 'failed'
  setTimeout(() => (sspCopyState.value = 'idle'), 1500)
}

watch(sidebarTab, (tab) => {
  if (tab === 'ssp' && !selectedSspFile.value && sspModuleList.value.length > 0) {
    const first = sspModuleList.value[0]
    selectedSspFile.value = { category: first.category, filename: first.filename, source: first.source }
  }
})

interface TemplateGroup {
  /** 一级分类: core-api / combo / workflow */
  category: string
  /** 二级分类: camera / poi / scene / ... */
  subcategory: string
  templates: TemplateMeta[]
}

const templates = computed<TemplateMeta[]>(() => {
  return templateRegistry.all().map((definition) => ({
    ...definition,
    filename: definition.filename ?? `${definition.id}.json`,
  }))
})

/**
 * 总统计 — 按模板状态聚合
 */
const stats = computed(() => {
  let passed = 0
  let skipped = 0
  let pending = 0
  for (const t of templates.value) {
    const s = getStatus(t.id)
    if (s === 'passed') passed++
    else if (s === 'skipped') skipped++
    else pending++
  }
  return { passed, skipped, pending, total: templates.value.length }
})

/**
 * 过滤: 是否显示未测模板 (默认显示所有,后续可加 toggle)
 */
const filterMode = ref<'all' | 'pending' | 'passed' | 'skipped'>('all')

const visibleTemplates = computed(() => {
  if (filterMode.value === 'all') return templates.value
  return templates.value.filter((t) => {
    if (filterMode.value === 'pending') return getStatus(t.id) === 'default'
    return getStatus(t.id) === filterMode.value
  })
})

const visibleGroups = computed<TemplateGroup[]>(() => {
  const map = new Map<string, TemplateGroup>()
  for (const t of visibleTemplates.value) {
    const key = `${t.category}/${t.subcategory}`
    if (!map.has(key)) {
      map.set(key, {
        category: t.category,
        subcategory: t.subcategory,
        templates: [],
      })
    }
    map.get(key)!.templates.push(t)
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return a.subcategory.localeCompare(b.subcategory)
  })
})

/** 一键清空所有状态 */
function clearAllStatus() {
  if (!confirm('清空所有模板的测试状态? (passed/skipped 标记都会丢失)')) return
  templateStatus.value = {}
  try {
    localStorage.removeItem(STATUS_KEY)
  } catch {
    // ignore
  }
}

function passedInGroup(g: TemplateGroup): TemplateMeta[] {
  return g.templates.filter((t) => getStatus(t.id) === 'passed')
}

function skippedInGroup(g: TemplateGroup): TemplateMeta[] {
  return g.templates.filter((t) => getStatus(t.id) === 'skipped')
}

const selectedId = ref<string>('')
const selected = computed<TemplateMeta | undefined>(() =>
  templates.value.find((t) => t.id === selectedId.value),
)

// 自动选中第一个模板
if (templates.value.length > 0 && !selectedId.value) {
  selectedId.value = templates.value[0].id
}

// console 日志
const logs = ref<LogEntry[]>([])
const running = ref(false)
const lastDuration = ref(0)

async function execute() {
  if (!selected.value || running.value) return
  logs.value = []
  running.value = true
  try {
    const result = await runRegisteredTemplate(
      selected.value.id,
      selected.value.testParams ?? {},
    )
    logs.value = result.logs
    lastDuration.value = result.durationMs
  } finally {
    running.value = false
  }
}

// 模型库
const lib = useModelLibrary()
const chat = useChatStore()
const embeddedTopologyRuntime = createGlbTopologyRuntime(ssp.topologyTool)

interface EmbeddedTopologySummary {
  assetId: string
  graphIds: readonly string[]
  graphCount: number
  nodeCount: number
  edgeCount: number
  componentCount: number
  isolatedCount: number
  unresolvedCount: number
  error?: string
}

const embeddedTopologySummaries = ref<EmbeddedTopologySummary[]>([])
const embeddedTopologyMessage = ref('')

interface TopologyEditorAsset {
  assetId: string
  root: THREE.Object3D
  originalTopology: GlbTopologyDocument
}

const topologyEditorEnabled = ref(false)
const topologyEditorSearch = ref('')
const topologyEditorAssets = ref<TopologyEditorAsset[]>([])
const topologyEditorAssetId = ref('')
const topologyEditorGraphId = ref('')
const topologyEditorEdgeId = ref('')
const topologyEditorVia = ref<TopologyEditorPoint[]>([])
const topologyEditorViaIndex = ref(-1)
const topologyEditorError = ref('')
const topologyEditorMessage = ref('')
const topologyOverrideFileInput = ref<HTMLInputElement | null>(null)
const topologyOverrideRevision = ref(0)
const topologyEditorNodeId = ref('')
const topologyEditorRemovedNodeId = ref('')
const topologyEditorRemovedEdgeId = ref('')
const topologyEditorNewNodeId = ref('')
const topologyEditorNewNodeLayerId = ref('')
const topologyEditorNewNodeKind = ref('SPACE')
const topologyEditorNewNodeX = ref(0)
const topologyEditorNewNodeY = ref(0)
const topologyEditorNewNodeZ = ref(0)
const topologyEditorNewEdgeId = ref('')
const topologyEditorNewEdgeSource = ref('')
const topologyEditorNewEdgeTarget = ref('')
const topologyEditorOverlay = new THREE.Group()
topologyEditorOverlay.name = 'sandbox_topology_path_editor_overlay'
const editorRaycaster = new THREE.Raycaster()
let editorCanvas: HTMLCanvasElement | null = null
let editorBindTimer: number | null = null
let activeViaDrag: {
  index: number
  plane: THREE.Plane
  localY: number
  controlsEnabled: boolean
} | null = null

const topologyEditorAsset = computed(() =>
  topologyEditorAssets.value.find((asset) => asset.assetId === topologyEditorAssetId.value),
)
const topologyEditorBaselineGraph = computed(() =>
  topologyEditorAsset.value
    ? getGraph(topologyEditorAsset.value.originalTopology, topologyEditorGraphId.value)
    : undefined,
)
const topologyEditorEffectiveTopology = computed(() => {
  void topologyOverrideRevision.value
  const asset = topologyEditorAsset.value
  const graphId = topologyEditorGraphId.value
  if (!asset || !graphId) return asset?.originalTopology
  try {
    return topologyOverrideTool.getEffectiveTopology({ assetId: asset.assetId, graphId })
  } catch {
    return asset.originalTopology
  }
})
const topologyEditorGraph = computed(() => (
  topologyEditorEffectiveTopology.value
    ? getGraph(topologyEditorEffectiveTopology.value, topologyEditorGraphId.value)
    : undefined
))
const topologyEditorEdge = computed(() => getEdge(topologyEditorGraph.value, topologyEditorEdgeId.value))
const topologyEditorGraphOptions = computed(() => topologyEditorAsset.value?.originalTopology.graphs ?? [])
const topologyEditorEdgeOptions = computed(() => {
  const query = topologyEditorSearch.value.trim().toLowerCase()
  return (topologyEditorGraph.value?.edges ?? []).filter((edge) => {
    if (!query) return true
    return [edge.id, edge.source, edge.target].some((value) => value.toLowerCase().includes(query))
  })
})
const topologyEditorCanEdit = computed(() => topologyEditorEnabled.value && Boolean(topologyEditorEdge.value))
const topologyEditorIsSameLayer = computed(() => sameLayer(topologyEditorGraph.value, topologyEditorEdge.value))
const topologyEditorNodeOptions = computed(() => topologyEditorGraph.value?.nodes ?? [])
const topologyEditorRemovedNodeOptions = computed(() => {
  const effectiveIds = new Set(topologyEditorGraph.value?.nodes.map((node) => node.id) ?? [])
  return (topologyEditorBaselineGraph.value?.nodes ?? []).filter((node) => !effectiveIds.has(node.id))
})
const topologyEditorRemovedEdgeOptions = computed(() => {
  const effectiveIds = new Set(topologyEditorGraph.value?.edges.map((edge) => edge.id) ?? [])
  return (topologyEditorBaselineGraph.value?.edges ?? []).filter((edge) => !effectiveIds.has(edge.id))
})

function topologySourceAsset(asset: TopologyEditorAsset | undefined, graphId: string): string | undefined {
  if (!asset) return undefined
  const graph = getGraph(asset.originalTopology, graphId)
  const graphSourceAsset = graph?.data?.sourceAsset
  if (typeof graphSourceAsset === 'string' && graphSourceAsset.length > 0) return graphSourceAsset
  const diagnosticSource = asset.originalTopology.diagnostics?.source
  if (diagnosticSource && typeof diagnosticSource === 'object') {
    const sourceAsset = (diagnosticSource as Record<string, unknown>).asset
    if (typeof sourceAsset === 'string' && sourceAsset.length > 0) return sourceAsset
  }
  return undefined
}

const topologyOverrideDocument = computed<TopologyOverrideV2Document>(() => {
  void topologyOverrideRevision.value
  const assetId = topologyEditorAssetId.value
  const graphId = topologyEditorGraphId.value
  if (!assetId || !graphId) {
    return createEmptyOverrideDocument(graphId, topologySourceAsset(topologyEditorAsset.value, graphId))
  }
  try {
    return topologyOverrideTool.getDocument({ assetId, graphId }) as TopologyOverrideV2Document
  } catch {
    return createEmptyOverrideDocument(graphId, topologySourceAsset(topologyEditorAsset.value, graphId))
  }
})

function topologyEditorTarget(): { assetId: string; graphId: string } | null {
  const assetId = topologyEditorAssetId.value
  const graphId = topologyEditorGraphId.value
  return assetId && graphId ? { assetId, graphId } : null
}

function readSelectedViaFromDocument(): TopologyEditorPoint[] {
  const record = findOverrideRecord(
    topologyOverrideDocument.value,
    topologyEditorGraphId.value,
    topologyEditorEdgeId.value,
  )
  if (record) return clonePoints(record.path.via)
  return clonePoints(topologyEditorEdge.value?.path?.via ?? [])
}

function syncTopologyEditorSelection(): void {
  topologyEditorVia.value = readSelectedViaFromDocument()
  topologyEditorViaIndex.value = -1
  topologyEditorError.value = ''
  updateTopologyEditorOverlay()
}

function upsertSelectedTopologyOverride(): boolean {
  const target = topologyEditorTarget()
  const edgeId = topologyEditorEdgeId.value
  const edge = topologyEditorEdge.value
  if (!target || !edgeId || !edge) return false
  try {
    topologyOverrideTool.mutate({
      action: 'OVERRIDE_EDGE_PATH',
      target,
      edgeId,
      path: { type: 'POLYLINE', via: clonePoints(topologyEditorVia.value) },
    })
    topologyEditorError.value = ''
    return true
  } catch (error) {
    topologyEditorError.value = error instanceof Error ? error.message : String(error)
    return false
  }
}

function removeSelectedTopologyOverride(): boolean {
  const target = topologyEditorTarget()
  const edgeId = topologyEditorEdgeId.value
  if (!target || !edgeId) return false
  try {
    topologyOverrideTool.mutate({
      action: 'RESET_EDGE_PATH',
      target,
      edgeId,
    })
    topologyEditorError.value = ''
    return true
  } catch (error) {
    topologyEditorError.value = error instanceof Error ? error.message : String(error)
    return false
  }
}

function replaceTopologyEditorSummary(assetId: string, topology: GlbTopologyDocument, mount: GlbTopologyAssetMount): void {
  const index = embeddedTopologySummaries.value.findIndex((summary) => summary.assetId === assetId)
  if (index < 0) return
  const summary = embeddedTopologySummaries.value[index]
  const next: EmbeddedTopologySummary = {
    ...summary,
    graphIds: mount.graphIds,
    graphCount: topology.graphs.length,
    nodeCount: topology.graphs.reduce((sum, graph) => sum + graph.nodes.length, 0),
    edgeCount: topology.graphs.reduce((sum, graph) => sum + graph.edges.length, 0),
    componentCount: topology.diagnostics?.components?.length ?? 0,
    isolatedCount: topology.graphs.reduce((sum, graph) => {
      const endpointIds = new Set(graph.edges.flatMap((edge) => [edge.source, edge.target]))
      return sum + graph.nodes.filter((node) => !endpointIds.has(node.id)).length
    }, 0),
    unresolvedCount: topology.diagnostics?.unresolvedNodes?.length ?? 0,
    error: undefined,
  }
  embeddedTopologySummaries.value = embeddedTopologySummaries.value.map((item, itemIndex) =>
    itemIndex === index ? next : item,
  )
}

function applyTopologyEditorPreview(): void {
  const asset = topologyEditorAsset.value
  const target = topologyEditorTarget()
  if (!asset || !target) return
  try {
    const errors = validateTopologyOverrideDocument(topologyOverrideDocument.value)
    if (errors.length > 0) throw new Error(errors.join('\n'))
    const nonSameLayerEdges = findNonSameLayerOverrideEdgeIds(
      asset.originalTopology,
      topologyOverrideDocument.value,
    )
    if (nonSameLayerEdges.length > 0) {
      throw new Error(`路径编辑器只支持同层边：${nonSameLayerEdges.join('、')}`)
    }
    const editedTopology = topologyOverrideTool.getEffectiveTopology(target)
    const mount = embeddedTopologyRuntime.attach({ assetId: asset.assetId, root: asset.root, topology: editedTopology })
    replaceTopologyEditorSummary(asset.assetId, editedTopology, mount)
    setEmbeddedGraphVisible(true)
    topologyEditorMessage.value = `已应用 ${topologyOverrideDocument.value.operations.length} 条人工覆盖操作`
    topologyEditorError.value = ''
    updateTopologyEditorOverlay()
  } catch (error) {
    topologyEditorError.value = error instanceof Error ? error.message : String(error)
  }
}

function runTopologyMutation(
  mutation: Parameters<typeof topologyOverrideTool.mutate>[0],
  successMessage: string,
): boolean {
  try {
    topologyOverrideTool.mutate(mutation)
    topologyOverrideRevision.value += 1
    topologyEditorMessage.value = successMessage
    topologyEditorError.value = ''
    return true
  } catch (error) {
    topologyEditorError.value = error instanceof Error ? error.message : String(error)
    return false
  }
}

function addTopologyEditorNode(): void {
  const target = topologyEditorTarget()
  const id = topologyEditorNewNodeId.value.trim()
  const layerId = topologyEditorNewNodeLayerId.value || topologyEditorGraph.value?.layers[0]?.id || ''
  if (!target || !id || !layerId) {
    topologyEditorError.value = '新增节点需要 node ID 和 layer ID'
    return
  }
  const kind = topologyEditorNewNodeKind.value.trim()
  if (runTopologyMutation({
    action: 'ADD_NODE',
    target,
    node: {
      id,
      layerId,
      position: {
        x: topologyEditorNewNodeX.value,
        y: topologyEditorNewNodeY.value,
        z: topologyEditorNewNodeZ.value,
      },
      ...(kind ? { kind } : {}),
    },
  }, `已新增人工节点 ${id}`)) {
    topologyEditorNodeId.value = id
    topologyEditorNewNodeId.value = ''
  }
}

function removeTopologyEditorNode(): void {
  const target = topologyEditorTarget()
  const nodeId = topologyEditorNodeId.value
  if (!target || !nodeId) return
  if (runTopologyMutation({ action: 'REMOVE_NODE', target, nodeId }, `已删除节点 ${nodeId}；关联边已级联删除`)) {
    topologyEditorNodeId.value = topologyEditorGraph.value?.nodes[0]?.id ?? ''
    topologyEditorRemovedNodeId.value = nodeId
  }
}

function restoreTopologyEditorNode(): void {
  const target = topologyEditorTarget()
  const nodeId = topologyEditorRemovedNodeId.value
  if (!target || !nodeId) return
  if (runTopologyMutation({ action: 'RESTORE_NODE', target, nodeId }, `已恢复基线节点 ${nodeId}；关联边需单独恢复`)) {
    topologyEditorNodeId.value = nodeId
    topologyEditorRemovedNodeId.value = ''
  }
}

function addTopologyEditorEdge(): void {
  const target = topologyEditorTarget()
  const graph = topologyEditorGraph.value
  const id = topologyEditorNewEdgeId.value.trim()
  const source = graph?.nodes.find((node) => node.id === topologyEditorNewEdgeSource.value)
  const endpoint = graph?.nodes.find((node) => node.id === topologyEditorNewEdgeTarget.value)
  if (!target || !graph || !id || !source || !endpoint) {
    topologyEditorError.value = '新增边需要 edge ID、source 和 target'
    return
  }
  const crossesLayer = source.layerId !== endpoint.layerId
  if (runTopologyMutation({
    action: 'ADD_EDGE',
    target,
    edge: {
      id,
      source: source.id,
      target: endpoint.id,
      relation: crossesLayer ? 'CONNECTOR' : 'LINK',
      direction: 'BIDIRECTIONAL',
      mode: crossesLayer ? 'CONNECTOR' : 'WALK',
    },
  }, `已新增人工边 ${id}`)) {
    topologyEditorEdgeId.value = id
    topologyEditorNewEdgeId.value = ''
  }
}

function removeTopologyEditorEdge(): void {
  const target = topologyEditorTarget()
  const edgeId = topologyEditorEdgeId.value
  if (!target || !edgeId) return
  if (runTopologyMutation({ action: 'REMOVE_EDGE', target, edgeId }, `已删除边 ${edgeId}`)) {
    topologyEditorEdgeId.value = topologyEditorGraph.value?.edges[0]?.id ?? ''
    topologyEditorRemovedEdgeId.value = edgeId
  }
}

function restoreTopologyEditorEdge(): void {
  const target = topologyEditorTarget()
  const edgeId = topologyEditorRemovedEdgeId.value
  if (!target || !edgeId) return
  if (runTopologyMutation({ action: 'RESTORE_EDGE', target, edgeId }, `已恢复基线边 ${edgeId}`)) {
    topologyEditorEdgeId.value = edgeId
    topologyEditorRemovedEdgeId.value = ''
  }
}

function addTopologyEditorMidpoint(): void {
  const graph = topologyEditorGraph.value
  const edge = topologyEditorEdge.value
  if (!graph || !edge) return
  if (!topologyEditorIsSameLayer.value) {
    topologyEditorError.value = '仅支持同层边的水平路径微调'
    return
  }
  if (topologyEditorVia.value.length >= 64) {
    topologyEditorError.value = '单条边最多 64 个 via 点'
    return
  }
  const endpoints = edgeEndpoints(graph, edge)
  if (!endpoints) return
  const points = [endpoints[0], ...topologyEditorVia.value, endpoints[1]]
  let segmentIndex = 0
  let longest = -1
  for (let index = 0; index < points.length - 1; index++) {
    const distance = new THREE.Vector3(points[index + 1].x, points[index + 1].y, points[index + 1].z)
      .distanceTo(new THREE.Vector3(points[index].x, points[index].y, points[index].z))
    if (distance > longest) {
      longest = distance
      segmentIndex = index
    }
  }
  const start = points[segmentIndex]
  const end = points[segmentIndex + 1]
  const midpoint = { x: (start.x + end.x) / 2, y: start.y, z: (start.z + end.z) / 2 }
  topologyEditorVia.value.splice(segmentIndex, 0, midpoint)
  topologyEditorVia.value = [...topologyEditorVia.value]
  topologyEditorViaIndex.value = segmentIndex
  if (!upsertSelectedTopologyOverride()) topologyEditorVia.value.splice(segmentIndex, 1)
  updateTopologyEditorOverlay()
}

function deleteTopologyEditorVia(): void {
  const index = topologyEditorViaIndex.value
  if (index < 0 || index >= topologyEditorVia.value.length) return
  const removed = topologyEditorVia.value.splice(index, 1)[0]
  topologyEditorVia.value = [...topologyEditorVia.value]
  topologyEditorViaIndex.value = -1
  if (!upsertSelectedTopologyOverride()) {
    topologyEditorVia.value.splice(index, 0, removed)
    topologyEditorVia.value = [...topologyEditorVia.value]
  }
  updateTopologyEditorOverlay()
}

function resetTopologyEditorEdge(): void {
  if (!removeSelectedTopologyOverride()) return
  topologyEditorVia.value = readSelectedViaFromDocument()
  topologyEditorViaIndex.value = -1
  topologyEditorMessage.value = '已恢复原始边路径并更新生效图'
  updateTopologyEditorOverlay()
}

function disposeTopologyEditorOverlay(): void {
  while (topologyEditorOverlay.children.length > 0) {
    const child = topologyEditorOverlay.children.pop()!
    child.traverse((object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else material?.dispose()
    })
  }
}

function updateTopologyEditorOverlay(): void {
  disposeTopologyEditorOverlay()
  const asset = topologyEditorAsset.value
  const graph = topologyEditorGraph.value
  const edge = topologyEditorEdge.value
  if (!topologyEditorEnabled.value || !asset || !graph || !edge) return
  const endpoints = edgeEndpoints(graph, edge)
  if (!endpoints) return
  const localPoints = [endpoints[0], ...topologyEditorVia.value, endpoints[1]]
  const worldPoints = localPoints.map((point) => modelToWorld(point, asset.root))
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(worldPoints),
    new THREE.LineBasicMaterial({
      color: 0xff8a00,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
    }),
  )
  line.renderOrder = 1000
  line.userData.topologyEditorLine = true
  line.userData.topologyEditorOverlay = true
  topologyEditorOverlay.add(line)
  topologyEditorVia.value.forEach((point, index) => {
    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 20, 12),
      new THREE.MeshBasicMaterial({
        color: index === topologyEditorViaIndex.value ? 0xfff176 : 0xff8a00,
        depthTest: false,
        depthWrite: false,
      }),
    )
    handle.position.copy(modelToWorld(point, asset.root))
    handle.renderOrder = 1001
    handle.userData.topologyEditorViaIndex = index
    handle.userData.topologyEditorOverlay = true
    topologyEditorOverlay.add(handle)
  })
  if (topologyEditorOverlay.parent !== threeScene.scene) threeScene.scene.add(topologyEditorOverlay)
}

function updateTopologyEditorOverlayPositions(): void {
  const asset = topologyEditorAsset.value
  const graph = topologyEditorGraph.value
  const edge = topologyEditorEdge.value
  if (!asset || !graph || !edge) return
  const endpoints = edgeEndpoints(graph, edge)
  if (!endpoints) return
  const worldPoints = [endpoints[0], ...topologyEditorVia.value, endpoints[1]]
    .map((point) => modelToWorld(point, asset.root))
  const line = topologyEditorOverlay.children.find((child) => child.userData.topologyEditorLine) as THREE.Line | undefined
  line?.geometry.setFromPoints(worldPoints)
  for (const child of topologyEditorOverlay.children) {
    const index = child.userData.topologyEditorViaIndex
    if (typeof index === 'number' && topologyEditorVia.value[index]) {
      child.position.copy(modelToWorld(topologyEditorVia.value[index], asset.root))
    }
  }
}

async function focusTopologyEditorEdge(): Promise<void> {
  updateTopologyEditorOverlay()
  if (topologyEditorOverlay.children.length === 0) return
  try {
    const box = new THREE.Box3().setFromObject(topologyEditorOverlay)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const maxDimension = Math.max(size.x, size.y, size.z)
    const fov = THREE.MathUtils.degToRad(threeScene.camera.fov)
    const distance = Math.max(3, (maxDimension / 2) / Math.tan(fov / 2) * 2.4)
    const position = center.clone().add(
      new THREE.Vector3(1, 1.25, 1).normalize().multiplyScalar(distance),
    )
    await threeScene.controls.setLookAt(
      position.x, position.y, position.z,
      center.x, center.y, center.z,
      true,
    )
    topologyEditorError.value = ''
  } catch (error) {
    topologyEditorError.value = error instanceof Error ? error.message : String(error)
  }
}

function pointerRay(event: PointerEvent): THREE.Ray | null {
  if (!editorCanvas) return null
  const bounds = editorCanvas.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  )
  editorRaycaster.setFromCamera(ndc, threeScene.camera)
  return editorRaycaster.ray.clone()
}

function findRenderedTopologySelection(object: THREE.Object3D): { assetId: string; graphId: string; edgeId: string } | null {
  let current: THREE.Object3D | null = object
  while (current) {
    const runtimeGraphId = current.userData.__sspTopologyGraphId
    const edgeId = current.userData.__sspTopologyEdgeId
    if (typeof runtimeGraphId === 'string' && typeof edgeId === 'string') {
      for (const asset of topologyEditorAssets.value) {
        const summary = embeddedTopologySummaries.value.find((item) => item.assetId === asset.assetId)
        const graphIndex = summary?.graphIds.indexOf(runtimeGraphId) ?? -1
        const graph = graphIndex >= 0 ? asset.originalTopology.graphs[graphIndex] : undefined
        if (graph?.edges.some((edge) => edge.id === edgeId)) {
          return { assetId: asset.assetId, graphId: graph.id ?? '', edgeId }
        }
      }
    }
    for (const asset of topologyEditorAssets.value) {
      const summary = embeddedTopologySummaries.value.find((item) => item.assetId === asset.assetId)
      if (!summary) continue
      for (const graphId of summary.graphIds) {
        const graph = asset.originalTopology.graphs.find((candidate) =>
          graphId.endsWith(`:${candidate.id}`) || graphId.includes(`:${candidate.id}~`),
        )
        if (!graph) continue
        const edge = graph.edges.find((candidate) => current!.name === `topology_edge_${graphId}_${candidate.id}`)
        if (edge) return { assetId: asset.assetId, graphId: graph.id ?? '', edgeId: edge.id }
      }
    }
    current = current.parent
  }
  return null
}

function renderedTopologyPickTargets(): THREE.Object3D[] {
  const graphIds = new Set(embeddedTopologySummaries.value.flatMap((summary) => summary.graphIds))
  const targets: THREE.Object3D[] = []
  threeScene.scene.traverse((object) => {
    if (
      typeof object.userData.__sspTopologyEdgeId === 'string'
      && graphIds.has(object.userData.__sspTopologyGraphId)
    ) {
      targets.push(object)
    }
  })
  return targets
}

function handleTopologyEditorPointerDown(event: PointerEvent): void {
  if (!topologyEditorEnabled.value || event.button !== 0) return
  const ray = pointerRay(event)
  if (!ray) return
  const hits = editorRaycaster.intersectObjects(topologyEditorOverlay.children, true)
  const handle = hits.find((hit) => typeof hit.object.userData.topologyEditorViaIndex === 'number')
  if (handle) {
    if (!topologyEditorIsSameLayer.value) {
      topologyEditorError.value = '跨层边仅可查看；V1 编辑器只允许同层水平微调'
      return
    }
    topologyEditorViaIndex.value = handle.object.userData.topologyEditorViaIndex as number
    const asset = topologyEditorAsset.value
    const point = topologyEditorVia.value[topologyEditorViaIndex.value]
    if (!asset || !point) return
    const normal = new THREE.Vector3(0, 1, 0).transformDirection(asset.root.matrixWorld)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, modelToWorld(point, asset.root))
    activeViaDrag = {
      index: topologyEditorViaIndex.value,
      plane,
      localY: point.y,
      controlsEnabled: threeScene.controls.enabled,
    }
    threeScene.controls.enabled = false
    updateTopologyEditorOverlay()
    event.preventDefault()
    return
  }
  const sceneHits = editorRaycaster.intersectObjects(renderedTopologyPickTargets(), true)
  const selectionHit = sceneHits[0]
  const selection = selectionHit ? findRenderedTopologySelection(selectionHit.object) : null
  if (selection) {
    topologyEditorAssetId.value = selection.assetId
    topologyEditorGraphId.value = selection.graphId
    topologyEditorEdgeId.value = selection.edgeId
  }
}

function handleTopologyEditorPointerMove(event: PointerEvent): void {
  if (!activeViaDrag) return
  const ray = pointerRay(event)
  if (!ray) return
  const worldPoint = ray.intersectPlane(activeViaDrag.plane, new THREE.Vector3())
  if (!worldPoint) return
  const asset = topologyEditorAsset.value
  if (!asset) return
  const next = worldToModel(worldPoint, asset.root)
  next.y = activeViaDrag.localY
  if (![next.x, next.y, next.z].every(Number.isFinite)) return
  topologyEditorVia.value[activeViaDrag.index] = next
  topologyEditorVia.value = [...topologyEditorVia.value]
  updateTopologyEditorOverlayPositions()
  event.preventDefault()
}

function finishTopologyEditorDrag(): void {
  if (!activeViaDrag) return
  threeScene.controls.enabled = activeViaDrag.controlsEnabled
  activeViaDrag = null
  if (!upsertSelectedTopologyOverride()) {
    topologyEditorVia.value = readSelectedViaFromDocument()
    topologyEditorViaIndex.value = -1
    updateTopologyEditorOverlay()
  }
}

function bindTopologyEditorCanvas(): void {
  if (editorCanvas || viewDisposed) return
  if (!hasSspContext()) {
    editorBindTimer = window.setTimeout(bindTopologyEditorCanvas, 50)
    return
  }
  const canvas = threeScene.renderer?.domElement
  if (!canvas) {
    editorBindTimer = window.setTimeout(bindTopologyEditorCanvas, 50)
    return
  }
  editorCanvas = canvas
  canvas.addEventListener('pointerdown', handleTopologyEditorPointerDown)
  window.addEventListener('pointermove', handleTopologyEditorPointerMove)
  window.addEventListener('pointerup', finishTopologyEditorDrag)
  window.addEventListener('pointercancel', finishTopologyEditorDrag)
}

function unbindTopologyEditorCanvas(): void {
  finishTopologyEditorDrag()
  if (editorCanvas) editorCanvas.removeEventListener('pointerdown', handleTopologyEditorPointerDown)
  window.removeEventListener('pointermove', handleTopologyEditorPointerMove)
  window.removeEventListener('pointerup', finishTopologyEditorDrag)
  window.removeEventListener('pointercancel', finishTopologyEditorDrag)
  editorCanvas = null
  if (editorBindTimer !== null) window.clearTimeout(editorBindTimer)
  editorBindTimer = null
}

function importTopologyOverrideFile(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result))
      const errors = validateTopologyOverrideDocument(parsed)
      if (errors.length > 0) throw new Error(errors.join('\n'))
      const document = parsed as TopologyOverrideDocument | TopologyOverrideV2Document
      const assets = topologyEditorAssets.value.filter((candidate) => {
        if (!getGraph(candidate.originalTopology, document.target.graphId)) return false
        const sourceAsset = topologySourceAsset(candidate, document.target.graphId)
        return document.target.sourceAsset === undefined || document.target.sourceAsset === sourceAsset
      })
      if (assets.length === 0) throw new Error(`找不到 override 目标图：${document.target.graphId}`)
      if (assets.length > 1) {
        throw new Error(`override 目标图不唯一：${document.target.graphId}；请提供 target.sourceAsset`)
      }
      const asset = assets[0]
      const nonSameLayerEdges = findNonSameLayerOverrideEdgeIds(asset.originalTopology, document)
      if (nonSameLayerEdges.length > 0) {
        throw new Error(`路径编辑器只支持同层边：${nonSameLayerEdges.join('、')}`)
      }
      topologyEditorAssetId.value = asset.assetId
      topologyEditorGraphId.value = document.target.graphId
      topologyEditorEdgeId.value = readOverrideRecords(document)[0]?.edgeId
        ?? getGraph(asset.originalTopology, document.target.graphId)?.edges[0]?.id
        ?? ''
      const normalized = topologyOverrideTool.replaceDocument(
        { assetId: asset.assetId, graphId: document.target.graphId },
        document,
      )
      topologyOverrideRevision.value += 1
      topologyEditorMessage.value = `已导入 ${normalized.operations.length} 条人工覆盖操作`
      topologyEditorError.value = ''
      syncTopologyEditorSelection()
    } catch (error) {
      topologyEditorError.value = error instanceof Error ? error.message : String(error)
    } finally {
      input.value = ''
    }
  }
  reader.onerror = () => {
    topologyEditorError.value = '无法读取 override JSON'
    input.value = ''
  }
  reader.readAsText(file)
}

function exportTopologyOverride(): void {
  const errors = validateTopologyOverrideDocument(topologyOverrideDocument.value)
  if (errors.length > 0) {
    topologyEditorError.value = errors.join('\n')
    return
  }
  const blob = new Blob([deterministicStringify(topologyOverrideDocument.value)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'topology-overrides.json'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  topologyEditorMessage.value = '已导出确定性 override JSON'
}

watch(topologyEditorAssetId, () => {
  const asset = topologyEditorAsset.value
  if (!asset?.originalTopology.graphs.some((graph) => graph.id === topologyEditorGraphId.value)) {
    topologyEditorGraphId.value = asset?.originalTopology.graphs[0]?.id ?? ''
  }
})
watch(topologyEditorGraphId, () => {
  if (!topologyEditorGraph.value?.edges.some((edge) => edge.id === topologyEditorEdgeId.value)) {
    topologyEditorEdgeId.value = topologyEditorGraph.value?.edges[0]?.id ?? ''
  }
  if (!topologyEditorGraph.value?.nodes.some((node) => node.id === topologyEditorNodeId.value)) {
    topologyEditorNodeId.value = topologyEditorGraph.value?.nodes[0]?.id ?? ''
  }
  topologyEditorNewNodeLayerId.value = topologyEditorGraph.value?.layers[0]?.id ?? ''
  topologyEditorNewEdgeSource.value = topologyEditorGraph.value?.nodes[0]?.id ?? ''
  topologyEditorNewEdgeTarget.value = topologyEditorGraph.value?.nodes[1]?.id
    ?? topologyEditorGraph.value?.nodes[0]?.id
    ?? ''
  topologyEditorRemovedNodeId.value = topologyEditorRemovedNodeOptions.value[0]?.id ?? ''
  topologyEditorRemovedEdgeId.value = topologyEditorRemovedEdgeOptions.value[0]?.id ?? ''
})
watch(topologyEditorEdgeId, syncTopologyEditorSelection)
watch(topologyOverrideRevision, () => {
  if (!topologyEditorGraph.value?.edges.some((edge) => edge.id === topologyEditorEdgeId.value)) {
    topologyEditorEdgeId.value = topologyEditorGraph.value?.edges[0]?.id ?? ''
  }
  if (!topologyEditorGraph.value?.nodes.some((node) => node.id === topologyEditorNodeId.value)) {
    topologyEditorNodeId.value = topologyEditorGraph.value?.nodes[0]?.id ?? ''
  }
  if (!topologyEditorRemovedNodeOptions.value.some((node) => node.id === topologyEditorRemovedNodeId.value)) {
    topologyEditorRemovedNodeId.value = topologyEditorRemovedNodeOptions.value[0]?.id ?? ''
  }
  if (!topologyEditorRemovedEdgeOptions.value.some((edge) => edge.id === topologyEditorRemovedEdgeId.value)) {
    topologyEditorRemovedEdgeId.value = topologyEditorRemovedEdgeOptions.value[0]?.id ?? ''
  }
  syncTopologyEditorSelection()
})
watch(topologyEditorEnabled, (enabled) => {
  if (!enabled) {
    finishTopologyEditorDrag()
    disposeTopologyEditorOverlay()
    topologyEditorViaIndex.value = -1
  } else {
    updateTopologyEditorOverlay()
  }
})

function handleTopologyOverrideChange(event: TopologyOverrideChangeEvent): void {
  const asset = topologyEditorAssets.value.find((candidate) => candidate.assetId === event.target.assetId)
  if (!asset) throw new Error(`找不到人工覆盖目标模型：${event.target.assetId}`)
  const mount = embeddedTopologyRuntime.attach({
    assetId: asset.assetId,
    root: asset.root,
    topology: event.effectiveTopology,
  })
  replaceTopologyEditorSummary(asset.assetId, event.effectiveTopology, mount)
  setEmbeddedGraphVisible(true)
  if (topologyEditorAssetId.value === asset.assetId) {
    topologyEditorMessage.value = `人工覆盖已生效：${event.summary.count} 条操作`
  }
  // The service commits its document only after this synchronous mount
  // callback succeeds. Refresh reactive reads in the next microtask so AI
  // mutations cannot leave the editor caching the pre-commit document.
  queueMicrotask(() => {
    topologyOverrideRevision.value += 1
    if (topologyEditorAssetId.value === asset.assetId) updateTopologyEditorOverlay()
  })
}

function clearEmbeddedTopology(): void {
  disposeTopologyEditorOverlay()
  topologyEditorOverlay.removeFromParent()
  embeddedTopologyRuntime.clear()
  for (const asset of topologyEditorAssets.value) topologyOverrideTool.unregisterAsset(asset.assetId)
  embeddedTopologySummaries.value = []
  topologyEditorAssets.value = []
  topologyEditorAssetId.value = ''
  topologyEditorGraphId.value = ''
  topologyEditorEdgeId.value = ''
  topologyEditorNodeId.value = ''
  topologyEditorRemovedNodeId.value = ''
  topologyEditorRemovedEdgeId.value = ''
  topologyEditorNewNodeId.value = ''
  topologyEditorNewEdgeId.value = ''
  topologyEditorNewEdgeSource.value = ''
  topologyEditorNewEdgeTarget.value = ''
  topologyEditorVia.value = []
  topologyEditorViaIndex.value = -1
  topologyOverrideRevision.value += 1
  embeddedTopologyMessage.value = ''
}

function attachEmbeddedTopology(infos: readonly { floorName: string; root: THREE.Object3D }[]): void {
  const summaries: EmbeddedTopologySummary[] = []
  for (const info of infos) {
    let registeredOverrideAsset = false
    try {
      const topology = extractEmbeddedTopology(info.root)
      if (!topology) continue
      topologyOverrideTool.registerAsset({
        assetId: info.floorName,
        topology,
        onChange: handleTopologyOverrideChange,
      })
      registeredOverrideAsset = true
      const mount = embeddedTopologyRuntime.attach({
        assetId: info.floorName,
        root: info.root,
        topology,
      })
      topologyEditorAssets.value.push({
        assetId: info.floorName,
        root: info.root,
        originalTopology: topology,
      })
      summaries.push({
        assetId: info.floorName,
        graphIds: mount.graphIds,
        graphCount: topology.graphs.length,
        nodeCount: topology.graphs.reduce((sum, graph) => sum + graph.nodes.length, 0),
        edgeCount: topology.graphs.reduce((sum, graph) => sum + graph.edges.length, 0),
        componentCount: topology.diagnostics?.components?.length ?? 0,
        isolatedCount: topology.graphs.reduce((sum, graph) => {
          const endpointIds = new Set(graph.edges.flatMap((edge) => [edge.source, edge.target]))
          return sum + graph.nodes.filter((node) => !endpointIds.has(node.id)).length
        }, 0),
        unresolvedCount: topology.diagnostics?.unresolvedNodes?.length ?? 0,
      })
    } catch (error) {
      if (registeredOverrideAsset) topologyOverrideTool.unregisterAsset(info.floorName)
      embeddedTopologyRuntime.detach(info.floorName)
      const message = error instanceof Error ? error.message : String(error)
      summaries.push({
        assetId: info.floorName,
        graphIds: [],
        graphCount: 0,
        nodeCount: 0,
        edgeCount: 0,
        componentCount: 0,
        isolatedCount: 0,
        unresolvedCount: 0,
        error: message,
      })
      console.warn(`[Sandbox] embedded topology rejected for ${info.floorName}:`, error)
    }
  }
  embeddedTopologySummaries.value = summaries
  if (!topologyEditorAssetId.value && topologyEditorAssets.value.length > 0) {
    topologyEditorAssetId.value = topologyEditorAssets.value[0].assetId
    topologyEditorGraphId.value = topologyEditorAssets.value[0].originalTopology.graphs[0]?.id ?? ''
    topologyEditorEdgeId.value = topologyEditorAssets.value[0].originalTopology.graphs[0]?.edges[0]?.id ?? ''
    topologyEditorNodeId.value = topologyEditorAssets.value[0].originalTopology.graphs[0]?.nodes[0]?.id ?? ''
    topologyEditorNewNodeLayerId.value = topologyEditorAssets.value[0].originalTopology.graphs[0]?.layers[0]?.id ?? ''
    topologyEditorNewEdgeSource.value = topologyEditorAssets.value[0].originalTopology.graphs[0]?.nodes[0]?.id ?? ''
    topologyEditorNewEdgeTarget.value = topologyEditorAssets.value[0].originalTopology.graphs[0]?.nodes[1]?.id
      ?? topologyEditorNewEdgeSource.value
  }
  updateTopologyEditorOverlay()
  embeddedTopologyMessage.value = summaries.length > 0
    ? `已加载 ${summaries.reduce((sum, item) => sum + item.graphCount, 0)} 张嵌入路径图`
    : '当前模型没有 scene.extras.sspTopology'
}

function ownedTopologyMounts(): GlbTopologyAssetMount[] {
  return embeddedTopologySummaries.value
    .map((summary) => embeddedTopologyRuntime.get(summary.assetId))
    .filter((mount): mount is GlbTopologyAssetMount => mount !== null)
}

function setEmbeddedGraphVisible(visible: boolean): void {
  for (const summary of embeddedTopologySummaries.value) {
    for (const graphId of summary.graphIds) {
      ssp.topologyTool.setEdgeVisualState(
        graphId,
        { all: true },
        {
          visible,
          color: '#00e5ff',
          width: 0.06,
          opacity: 0.82,
          depthTest: false,
          flow: null,
        },
      )
    }
  }
  embeddedTopologyMessage.value = visible ? '已显示嵌入路径图' : '已隐藏嵌入路径图'
}

function sampleConnectedPair(graphId: string): readonly [string, string] | null {
  const graph = ssp.topologyTool.getGraph(graphId)
  if (!graph) return null
  const groups = new Map<string, typeof graph.nodes[number][]>()
  for (const node of graph.nodes) {
    const componentId = typeof node.data?.componentId === 'string'
      ? node.data.componentId
      : '__unknown__'
    const entries = groups.get(componentId) ?? []
    entries.push(node)
    groups.set(componentId, entries)
  }
  const candidates = [...groups.values()].filter((entries) => entries.length >= 2)
  candidates.sort((left, right) => right.length - left.length)
  const nodes = candidates[0]
  if (!nodes) return null
  const seed = nodes.reduce((best, node) => node.id.localeCompare(best.id) < 0 ? node : best)
  const farthestFrom = (anchor: typeof seed): typeof seed | null => {
    let best: typeof seed | null = null
    let bestDistance = -1
    for (const candidate of nodes) {
      if (candidate.id === anchor.id) continue
      const a = anchor.position
      const b = candidate.position
      const distance = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2
      if (distance > bestDistance || (distance === bestDistance && candidate.id.localeCompare(best?.id ?? '') < 0)) {
        bestDistance = distance
        best = candidate
      }
    }
    return best
  }
  const first = farthestFrom(seed)
  if (!first) return null
  const second = farthestFrom(first)
  return second ? [first.id, second.id] : null
}

function renderEmbeddedSampleRoute(): void {
  for (const mount of ownedTopologyMounts()) {
    for (const routeId of mount.routeIds) mount.removeRoute(routeId)
  }
  for (const summary of embeddedTopologySummaries.value) {
    const mount = embeddedTopologyRuntime.get(summary.assetId)
    if (!mount) continue
    for (const graphId of summary.graphIds) {
      const pair = sampleConnectedPair(graphId)
      if (!pair) continue
      const result = ssp.topologyTool.findPath({
        graphId,
        startNodeId: pair[0],
        goalNodeId: pair[1],
      })
      if (!result.ok) continue
      const rendered = mount.renderRoute({
        route: result.route,
        style: { color: '#ff3b30', width: 0.14, opacity: 0.96, depthTest: false },
        flow: { active: true, speed: 2.2, spacing: 0.9, color: '#fff176', size: 0.07 },
      })
      if (rendered.rendered) {
        embeddedTopologyMessage.value = `示例路径：${pair[0]} → ${pair[1]}，长度 ${result.route.totalLength.toFixed(2)}`
        return
      }
    }
  }
  embeddedTopologyMessage.value = '没有找到可渲染的连通节点对'
}

function unloadManagedModels(): void {
  if (!ssp.hasContext()) return
  clearEmbeddedTopology()
  ssp.topologyTool.removeAll()
  ssp.modelTool.unloadAll()
}

// 注: 用户切换模型由 App.vue 全局下拉框处理 (lib.selectModel).
// 这里只需要 watch lib.url 触发加载, 不再需要 onChangeModel / modelsByGroup.

// 3D 场景 — modelUrl 用空字符串(不自动加载), 由 modelTool 完全接管
const threeScene = useThreeScene({
  modelUrl: computed(() => ''),
  onModelUnload: unloadManagedModels,
})

const {
  containerRef,
  loading: rendererLoading,
  errorMsg: rendererError,
  currentModelUrl: rendererModelUrl,
} = threeScene

const modelLoading = ref(false)
const modelError = ref('')
const requestedModelUrl = ref('')
const loading = computed(() => rendererLoading.value || modelLoading.value)
const errorMsg = computed(() => modelError.value || rendererError.value)
const currentModelUrl = computed(() => requestedModelUrl.value || rendererModelUrl.value)

/**
 * 监听 lib.url 变化, 由 modelTool 接管加载
 *   触发时机: onMounted (确保 ssp context 已初始化)
 *   之后: lib.selectModel 触发
 */
let modelLoadRequest = 0
let viewDisposed = false
let contextRetryTimer: number | null = null
let stopUrlWatch: WatchStopHandle | null = null

async function handleUrlChange(url: string): Promise<void> {
  const request = ++modelLoadRequest
  requestedModelUrl.value = url
  modelError.value = ''
  if (!url) {
    unloadManagedModels()
    modelLoading.value = false
    console.log('[Sandbox] cleared scene (no GLB loaded)')
    return
  }
  const rec = lib.models.value.find((m) => m.url === url)
  if (!rec) {
    modelLoading.value = false
    modelError.value = `模型不在清单中：${url}`
    console.warn('[Sandbox] unknown url in lib:', url)
    return
  }
  modelLoading.value = true
  try {
    unloadManagedModels()
    if (rec.kind === 'scene') {
      console.log(`[Sandbox] loading scene '${rec.filename}' (${rec.sizeMB} MB)...`)
      const infos = await ssp.modelTool.loadSubcategory(rec.filename)
      if (request !== modelLoadRequest) return
      attachEmbeddedTopology(infos)
      console.log(`[Sandbox] loaded ${infos.length} GLB in '${rec.filename}'`)
      await chat.fitScene('iso')
      if (request !== modelLoadRequest) return
      await chat.sendQuery('__capture_main_viewpoint__', { internal: true, forceFallback: true })
    } else {
      const info = await ssp.modelTool.loadFloor(rec.url)
      if (request !== modelLoadRequest) return
      attachEmbeddedTopology([info])
      console.log(`[Sandbox] loaded 1 GLB: ${info.floorName}`)
      await chat.fitScene('iso')
      if (request !== modelLoadRequest) return
      await chat.sendQuery('__capture_main_viewpoint__', { internal: true, forceFallback: true })
    }
  } catch (err) {
    if (request === modelLoadRequest) {
      modelError.value = err instanceof Error ? err.message : String(err)
      console.warn('[Sandbox] model load failed:', err)
    }
  } finally {
    if (request === modelLoadRequest) modelLoading.value = false
  }
}

onMounted(() => {
  bindTopologyEditorCanvas()
  // 等 ssp context 初始化完成, 触发 handleUrlChange 一次
  // 然后启动 lib.url 的 watch
  const tryTrigger = () => {
    if (viewDisposed) return
    if (ssp.hasContext()) {
      void handleUrlChange(lib.url.value)
      stopUrlWatch?.()
      stopUrlWatch = watch(lib.url, (url) => {
        void handleUrlChange(url)
      })
    } else {
      contextRetryTimer = window.setTimeout(tryTrigger, 50)
    }
  }
  tryTrigger()
})

onBeforeUnmount(() => {
  viewDisposed = true
  unbindTopologyEditorCanvas()
  clearEmbeddedTopology()
  modelLoadRequest++
  modelLoading.value = false
  stopUrlWatch?.()
  stopUrlWatch = null
  if (contextRetryTimer !== null) {
    window.clearTimeout(contextRetryTimer)
    contextRetryTimer = null
  }
})

/**
 * (删除:flyToSceneCenter 已被 ssp.cameraController.fitScene() 替代)
 */
</script>

<template>
  <div class="sandbox">
    <!-- 左侧:模板列表 -->
    <aside class="sandbox-side">
      <div class="side-header">
        <div class="side-tabs">
          <button
            class="side-tab"
            :class="{ active: sidebarTab === 'templates' }"
            @click="sidebarTab = 'templates'"
          >
            Templates
          </button>
          <button
            class="side-tab"
            :class="{ active: sidebarTab === 'models' }"
            @click="sidebarTab = 'models'"
          >
            Models
          </button>
          <button
            class="side-tab"
            :class="{ active: sidebarTab === 'ssp' }"
            @click="sidebarTab = 'ssp'"
          >
            ssp
          </button>
        </div>
        <span class="side-count">{{ visibleTemplates.length }} / {{ templates.length }}</span>
      </div>

      <!-- 测试进度统计条 -->
      <div class="side-stats" v-if="stats.total > 0">
        <button
          class="stat-pill stat-passed"
          :class="{ active: filterMode === 'passed' }"
          @click="filterMode = filterMode === 'passed' ? 'all' : 'passed'"
          :title="`${stats.passed} 条已通过 — 点击只看通过的`"
        >
          <span class="stat-icon">✓</span> {{ stats.passed }}
        </button>
        <button
          class="stat-pill stat-skipped"
          :class="{ active: filterMode === 'skipped' }"
          @click="filterMode = filterMode === 'skipped' ? 'all' : 'skipped'"
          :title="`${stats.skipped} 条已放弃 — 点击只看放弃的`"
        >
          <span class="stat-icon">✗</span> {{ stats.skipped }}
        </button>
        <button
          class="stat-pill stat-pending"
          :class="{ active: filterMode === 'pending' }"
          @click="filterMode = filterMode === 'pending' ? 'all' : 'pending'"
          :title="`${stats.pending} 条未测试 — 点击只看未测的`"
        >
          <span class="stat-icon">·</span> {{ stats.pending }}
        </button>
        <button
          class="stat-pill stat-clear"
          v-if="stats.passed > 0 || stats.skipped > 0"
          @click="clearAllStatus"
          title="清空所有状态"
        >
          ↺
        </button>
      </div>

      <!-- 进度条 (passed / skipped) -->
      <div class="side-progress" v-if="stats.total > 0">
        <div
          class="progress-segment progress-passed"
          :style="{ width: `${(stats.passed / stats.total) * 100}%` }"
        ></div>
        <div
          class="progress-segment progress-skipped"
          :style="{ width: `${(stats.skipped / stats.total) * 100}%` }"
        ></div>
      </div>

      <div class="side-list">
        <!-- Templates tab -->
        <template v-if="sidebarTab === 'templates'">
        <div v-if="visibleTemplates.length === 0" class="empty">
          <p v-if="filterMode !== 'all'">当前过滤条件下没有模板。</p>
          <p v-else>还没有模板。</p>
          <p class="hint">
            <span v-if="filterMode !== 'all'">点击上方按钮切换过滤。</span>
            <span v-else>把 JSON 放到 <code>src/templates/&lt;category&gt;/&lt;subcategory&gt;/</code> 后刷新页面。</span>
          </p>
        </div>
        <div v-for="g in visibleGroups" :key="`${g.category}/${g.subcategory}`" class="template-group">
          <div class="group-header">
            <span class="group-category">{{ g.category }}</span>
            <span class="group-sub">/ {{ g.subcategory }}</span>
            <span class="group-stats">
              <span v-if="passedInGroup(g).length > 0" class="group-stat-passed">✓{{ passedInGroup(g).length }}</span>
              <span v-if="skippedInGroup(g).length > 0" class="group-stat-skipped">✗{{ skippedInGroup(g).length }}</span>
              <span class="group-stat-total">{{ g.templates.length }}</span>
            </span>
          </div>
          <button
            v-for="t in g.templates"
            :key="t.id"
            class="template-item"
            :class="{
              active: t.id === selectedId,
              'status-passed': getStatus(t.id) === 'passed',
              'status-skipped': getStatus(t.id) === 'skipped',
            }"
            :title="`左键选中 / 右键设置状态 (当前: ${getStatus(t.id)})`"
            @click="selectedId = t.id"
            @contextmenu.stop="openContextMenu($event, t.id)"
          >
            <span class="status-icon" v-if="getStatus(t.id) === 'passed'">✓</span>
            <span class="status-icon skipped" v-else-if="getStatus(t.id) === 'skipped'">✗</span>
            <span class="template-id">{{ t.id }}</span>
          </button>
        </div>
        </template>

        <!-- Models tab: 模型构件树 -->
        <template v-else-if="sidebarTab === 'models'">
          <!-- 搜索 + 操作 -->
          <div class="models-toolbar">
            <input
              v-model="treeSearch"
              type="text"
              class="models-search"
              placeholder="搜索构件…"
            />
            <button class="btn-mini" @click="expandAll" title="展开所有">⊞</button>
            <button class="btn-mini" @click="collapseAll" title="折叠所有">⊟</button>
          </div>

          <div v-if="modelTree.length === 0" class="empty">
            <p>场景为空。</p>
            <p class="hint">先在右上 MODEL 下拉框加载一个 GLB。</p>
          </div>

          <div class="tree-list">
            <div
              v-for="row in visibleTreeRows"
              :key="row.node.id"
              class="tree-row"
              :class="{ leaf: !row.hasChildren }"
              :style="{ paddingLeft: 8 + row.depth * 16 + 'px' }"
            >
              <button
                v-if="row.hasChildren"
                class="tree-toggle"
                :class="{ open: row.expanded }"
                @click.stop="toggleNode(row.node.id)"
                :aria-label="row.expanded ? '折叠' : '展开'"
              >▶</button>
              <span v-else class="tree-toggle leaf-dot">·</span>
              <button
                class="tree-label"
                :class="{ folder: row.hasChildren, leaf: !row.hasChildren }"
                @click="row.hasChildren ? toggleNode(row.node.id) : focusNode(row.node)"
              >
                <span class="tree-icon">{{ row.hasChildren ? (row.expanded ? '📂' : '📁') : '🧩' }}</span>
                <span class="tree-name">{{ row.node.name }}</span>
                <span v-if="row.node.meshCount !== undefined" class="tree-count">{{ row.node.meshCount }}</span>
              </button>
            </div>
          </div>

          <section class="path-editor-section">
            <div class="path-editor-title">
              <strong>人工拓扑覆盖</strong>
              <label class="path-editor-toggle">
                <input v-model="topologyEditorEnabled" type="checkbox" />
                启用编辑
              </label>
            </div>
            <div v-if="topologyEditorAssets.length === 0" class="path-editor-empty">
              当前模型没有可编辑的嵌入 topology。
            </div>
            <template v-else>
              <select v-model="topologyEditorAssetId" class="path-editor-select">
                <option v-for="asset in topologyEditorAssets" :key="asset.assetId" :value="asset.assetId">
                  {{ asset.assetId }}
                </option>
              </select>
              <select v-model="topologyEditorGraphId" class="path-editor-select">
                <option v-for="graph in topologyEditorGraphOptions" :key="graph.id" :value="graph.id">
                  graph: {{ graph.id }}
                </option>
              </select>
              <input
                v-model="topologyEditorSearch"
                class="path-editor-search"
                type="search"
                placeholder="搜索 edge / source / target…"
              />
              <select v-model="topologyEditorEdgeId" class="path-editor-select">
                <option v-for="edge in topologyEditorEdgeOptions" :key="edge.id" :value="edge.id">
                  {{ edge.id }} · {{ edge.source }} → {{ edge.target }}
                </option>
              </select>
              <div class="path-editor-actions">
                <button class="btn-mini" :disabled="!topologyEditorCanEdit || !topologyEditorIsSameLayer" @click="addTopologyEditorMidpoint">+ 中点</button>
                <button class="btn-mini" :disabled="!topologyEditorCanEdit" @click="focusTopologyEditorEdge">聚焦边</button>
                <button class="btn-mini" :disabled="topologyEditorViaIndex < 0 || !topologyEditorIsSameLayer" @click="deleteTopologyEditorVia">删除 via</button>
                <button class="btn-mini" :disabled="!topologyEditorCanEdit" @click="resetTopologyEditorEdge">重置边</button>
              </div>
              <div class="path-editor-actions">
                <button class="btn-mini path-editor-danger" :disabled="!topologyEditorCanEdit" @click="removeTopologyEditorEdge">删除当前边</button>
                <select v-model="topologyEditorRemovedEdgeId" class="path-editor-inline-select">
                  <option value="">选择已删除基线边</option>
                  <option v-for="edge in topologyEditorRemovedEdgeOptions" :key="`removed-edge:${edge.id}`" :value="edge.id">
                    {{ edge.id }}
                  </option>
                </select>
                <button class="btn-mini" :disabled="!topologyEditorRemovedEdgeId" @click="restoreTopologyEditorEdge">恢复边</button>
              </div>

              <details class="path-editor-details">
                <summary>节点增删</summary>
                <select v-model="topologyEditorNodeId" class="path-editor-select">
                  <option v-for="node in topologyEditorNodeOptions" :key="node.id" :value="node.id">
                    {{ node.id }} · {{ node.kind || 'NODE' }}
                  </option>
                </select>
                <div class="path-editor-actions">
                  <button class="btn-mini path-editor-danger" :disabled="!topologyEditorNodeId" @click="removeTopologyEditorNode">删除节点</button>
                  <select v-model="topologyEditorRemovedNodeId" class="path-editor-inline-select">
                    <option value="">选择已删除基线节点</option>
                    <option v-for="node in topologyEditorRemovedNodeOptions" :key="`removed-node:${node.id}`" :value="node.id">
                      {{ node.id }}
                    </option>
                  </select>
                  <button class="btn-mini" :disabled="!topologyEditorRemovedNodeId" @click="restoreTopologyEditorNode">恢复节点</button>
                </div>
                <input v-model="topologyEditorNewNodeId" class="path-editor-search" placeholder="新 node ID" />
                <div class="path-editor-grid">
                  <select v-model="topologyEditorNewNodeLayerId" class="path-editor-select">
                    <option v-for="layer in topologyEditorGraph?.layers || []" :key="layer.id" :value="layer.id">{{ layer.id }}</option>
                  </select>
                  <input v-model="topologyEditorNewNodeKind" class="path-editor-search" placeholder="kind" />
                </div>
                <div class="path-editor-grid path-editor-grid-3">
                  <input v-model.number="topologyEditorNewNodeX" class="path-editor-search" type="number" step="0.1" placeholder="x" />
                  <input v-model.number="topologyEditorNewNodeY" class="path-editor-search" type="number" step="0.1" placeholder="y" />
                  <input v-model.number="topologyEditorNewNodeZ" class="path-editor-search" type="number" step="0.1" placeholder="z" />
                </div>
                <button class="btn-mini path-editor-wide" :disabled="!topologyEditorNewNodeId.trim()" @click="addTopologyEditorNode">新增节点</button>
              </details>

              <details class="path-editor-details">
                <summary>新增边</summary>
                <input v-model="topologyEditorNewEdgeId" class="path-editor-search" placeholder="新 edge ID" />
                <select v-model="topologyEditorNewEdgeSource" class="path-editor-select">
                  <option v-for="node in topologyEditorNodeOptions" :key="`source:${node.id}`" :value="node.id">source · {{ node.id }}</option>
                </select>
                <select v-model="topologyEditorNewEdgeTarget" class="path-editor-select">
                  <option v-for="node in topologyEditorNodeOptions" :key="`target:${node.id}`" :value="node.id">target · {{ node.id }}</option>
                </select>
                <button
                  class="btn-mini path-editor-wide"
                  :disabled="!topologyEditorNewEdgeId.trim() || !topologyEditorNewEdgeSource || !topologyEditorNewEdgeTarget"
                  @click="addTopologyEditorEdge"
                >新增双向边</button>
              </details>

              <div class="path-editor-actions">
                <button class="btn-mini" @click="topologyOverrideFileInput?.click()">导入 JSON</button>
                <button class="btn-mini" @click="exportTopologyOverride">导出 JSON</button>
                <button class="btn-mini path-editor-apply" :disabled="!topologyEditorCanEdit" @click="applyTopologyEditorPreview">应用预览</button>
              </div>
              <input ref="topologyOverrideFileInput" type="file" accept="application/json,.json" hidden @change="importTopologyOverrideFile" />
              <p class="path-editor-hint">
                生成图保持不变；当前 {{ topologyOverrideDocument.operations.length }} 条操作全部写入人工覆盖层。橙色线为 live preview；当前 {{ topologyEditorVia.length }} / 64 个 via。
              </p>
              <p v-if="topologyEditorEdge && !topologyEditorIsSameLayer" class="path-editor-hint">
                跨层边不支持路径微调；可删除/恢复，新增跨层边要求两端共享 connectorId。
              </p>
              <p v-if="topologyEditorMessage" class="path-editor-status">{{ topologyEditorMessage }}</p>
              <p v-if="topologyEditorError" class="path-editor-error">{{ topologyEditorError }}</p>
            </template>
          </section>
        </template>

        <!-- ssp tab -->
        <template v-else>
          <div v-if="sspGroups.length === 0" class="empty">
            <p>没找到 ssp 模块源码。</p>
          </div>
          <div v-for="g in sspGroups" :key="g.category" class="template-group">
            <div class="group-header">
              <span class="group-cat">{{ g.category }}</span>
              <span class="group-stat-total">{{ g.modules.length }}</span>
            </div>
            <button
              v-for="m in g.modules"
              :key="m.filename"
              class="template-item ssp-item"
              :class="{
                active:
                  selectedSspFile &&
                  selectedSspFile.category === m.category &&
                  selectedSspFile.filename === m.filename,
              }"
              :title="`${m.category}/${m.filename} (${m.lines} 行)`"
              @click="selectedSspFile = { category: m.category, filename: m.filename, source: m.source }"
            >
              <span class="status-icon">·</span>
              <span class="template-id">{{ m.filename }}</span>
              <span class="ssp-lines">{{ m.lines }}</span>
            </button>
          </div>
        </template>
      </div>
    </aside>

    <!-- 中间:3D 画布 + 底部面板 -->
    <section class="sandbox-main">
      <div ref="containerRef" class="three-container">
        <div v-if="loading" class="overlay">
          <div class="spinner"></div>
          <p>模型加载中…</p>
          <p class="overlay-hint">{{ currentModelUrl }}</p>
        </div>
        <div v-if="errorMsg" class="overlay error">
          <p>{{ errorMsg }}</p>
        </div>

        <!-- 模型选择器在 App.vue 顶部 (全局), 这里只显示当前选了什么 -->
        <div class="current-model-banner">
          <span class="current-model-label">当前模型:</span>
          <code class="current-model-url">{{ lib.url.value || '(空场景)' }}</code>
        </div>
      </div>

      <div class="bottom-panel">
        <!-- 模板 tab: 显示代码 + console -->
        <template v-if="sidebarTab === 'templates'">
        <!-- 上半:代码区 -->
        <div class="code-section">
          <div class="section-header">
            <span class="section-title">
              {{ selected ? selected.id : '未选中模板' }}
            </span>
            <div class="section-actions">
              <span v-if="lastDuration" class="duration">{{ lastDuration.toFixed(1) }}ms</span>
              <button
                class="btn primary"
                :disabled="!selected || running"
                @click="execute"
              >
                {{ running ? '执行中…' : '▶ 执行' }}
              </button>
            </div>
          </div>

          <div v-if="selected" class="code-body">
            <div class="meta-row">
              <span class="meta-key">method:</span>
              <code class="meta-val">{{ selected.method ?? '-' }}</code>
            </div>
            <div class="meta-row">
              <span class="meta-key">signature:</span>
              <code class="meta-val">{{ selected.signature ?? '-' }}</code>
            </div>
            <pre class="code-block"><code>{{ selected.code }}</code></pre>
            <div v-if="selected.example" class="example">
              <div class="meta-key">example:</div>
              <pre class="code-block alt"><code>{{ selected.example }}</code></pre>
            </div>
          </div>
          <div v-else class="code-empty">从左侧选一个模板开始</div>
        </div>

        <!-- 下半:console -->
        <div class="console-section">
          <div class="section-header">
            <span class="section-title">Console</span>
            <div class="section-actions">
              <button
                class="btn ghost"
                :disabled="logs.length === 0"
                @click="copyLogs"
                :title="copyBtnTitle"
              >{{ copyBtnLabel }}</button>
              <button class="btn ghost" :disabled="logs.length === 0" @click="logs = []">清空</button>
            </div>
          </div>
          <div class="console-body">
            <div v-if="logs.length === 0" class="console-empty">等待执行…</div>
            <div
              v-for="(entry, i) in logs"
              :key="i"
              class="log-line"
              :class="`log-${entry.level}`"
            >
              <span class="log-tag">[{{ entry.level }}]</span>
              <span class="log-text">{{ formatLog(entry) }}</span>
            </div>
          </div>
        </div>
        </template>

        <!-- Models tab: 树选中节点信息 -->
        <template v-else-if="sidebarTab === 'models'">
          <div class="models-info-section">
            <div class="section-header">
              <span class="section-title">
                构件详情
              </span>
              <div class="section-actions">
                <span class="duration">总楼层: {{ modelTree.length }}</span>
                <span class="duration">总 mesh: {{ totalMeshCount }}</span>
                <button
                  class="btn ghost"
                  :disabled="embeddedTopologySummaries.every((summary) => summary.graphIds.length === 0)"
                  @click="setEmbeddedGraphVisible(true)"
                >显示路径图</button>
                <button
                  class="btn ghost"
                  :disabled="embeddedTopologySummaries.every((summary) => summary.graphIds.length === 0)"
                  @click="setEmbeddedGraphVisible(false)"
                >隐藏路径图</button>
                <button
                  class="btn primary"
                  :disabled="embeddedTopologySummaries.every((summary) => summary.graphIds.length === 0)"
                  @click="renderEmbeddedSampleRoute"
                >测试寻路</button>
              </div>
            </div>
            <div v-if="modelTree.length === 0" class="code-empty">
              暂无模型。请从右上 MODEL 下拉框加载 GLB。
            </div>
            <div v-else class="models-info-body">
              <p class="info-tip">
                点击左侧构件树中的子构件可在 3D 视图中聚焦相机。<br />
                工具栏的 <kbd>⊞</kbd> / <kbd>⊟</kbd> 可展开/折叠所有层级。
              </p>
              <p class="info-tip">
                <strong>Embedded topology:</strong>
                {{ embeddedTopologyMessage || '等待模型 topology 检查' }}
              </p>
              <ul v-if="embeddedTopologySummaries.length > 0" class="info-list">
                <li v-for="summary in embeddedTopologySummaries" :key="`topology:${summary.assetId}`">
                  <strong>{{ summary.assetId }}</strong>
                  <span v-if="summary.error" class="info-meta">校验失败：{{ summary.error }}</span>
                  <span v-else class="info-meta">
                    {{ summary.graphCount }} graph · {{ summary.nodeCount }} nodes ·
                    {{ summary.edgeCount }} edges · {{ summary.componentCount }} components ·
                    {{ summary.isolatedCount }} isolated · {{ summary.unresolvedCount }} diagnostics
                  </span>
                </li>
              </ul>
              <ul class="info-list">
                <li v-for="floor in modelTree" :key="floor.id">
                  <strong>{{ floor.name }}</strong>
                  <span class="info-meta">
                    {{ floor.children.length }} 类型 · {{ floor.meshCount }} mesh
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </template>

        <!-- ssp tab: 显示源码 -->
        <template v-else>
          <div class="ssp-source-section">
            <div class="section-header">
              <span class="section-title">
                {{ selectedSspFile ? `${selectedSspFile.category}/${selectedSspFile.filename}` : '未选中文件' }}
              </span>
              <div class="section-actions">
                <span v-if="selectedSspFile" class="duration">{{ selectedSspFile.source.split('\n').length }} 行</span>
                <button
                  class="btn ghost"
                  :disabled="!selectedSspFile"
                  @click="handleCopySsp"
                  :title="sspCopyState === 'copied' ? '已复制到剪贴板' : '复制源码'"
                >{{ sspCopyState === 'copied' ? '已复制' : sspCopyState === 'failed' ? '复制失败' : '复制' }}</button>
              </div>
            </div>
            <pre v-if="selectedSspFile" class="code-block ssp-source-block"><code>{{ selectedSspFile.source }}</code></pre>
            <div v-else class="code-empty">从左侧选一个 ssp 模块查看</div>
          </div>
        </template>
      </div>
    </section>

    <!-- 右键状态菜单 (fixed 定位到鼠标位置) -->
    <div
      v-if="contextMenu"
      class="status-menu"
      :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
      @click.stop
      @contextmenu.stop.prevent
    >
      <div class="status-menu-title">设置状态</div>
      <button class="status-menu-item status-menu-passed" @click="applyStatus('passed')">
        <span class="status-menu-icon">✓</span> 通过
      </button>
      <button class="status-menu-item status-menu-skipped" @click="applyStatus('skipped')">
        <span class="status-menu-icon">✗</span> 放弃
      </button>
      <button class="status-menu-item status-menu-default" @click="applyStatus('default')">
        <span class="status-menu-icon">·</span> 重置 (无状态)
      </button>
    </div>

    <!-- AI 对话面板 (右侧抽屉) -->
    <ChatPanel />
  </div>
</template>

<style scoped>
.sandbox {
  width: 100%;
  height: 100%;
  display: flex;
  background: #0a0a0e;
}

.sandbox-side {
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid #2a2a35;
  display: flex;
  flex-direction: column;
  background: #13131a;
}

.side-header {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid #2a2a35;
  flex-shrink: 0;
}

.side-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: #fff;
}

.side-tabs {
  display: flex;
  gap: 4px;
  background: #0e0e14;
  padding: 2px;
  border-radius: 4px;
}

.side-tab {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  padding: 4px 10px;
  border-radius: 3px;
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.side-tab:hover {
  color: #ccc;
}

.side-tab.active {
  background: #2a3550;
  color: #fff;
}

.side-count {
  margin-left: auto;
  font-size: 11px;
  color: #888;
  background: #1f1f28;
  padding: 2px 6px;
  border-radius: 3px;
}

/* ssp 源码视图 */
.ssp-source-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ssp-source-block {
  flex: 1;
  margin: 0;
  padding: 12px 16px;
  overflow: auto;
  font-family: 'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  color: #c8d3f0;
  background: #0a0a10;
  border-radius: 4px;
}

.ssp-item .ssp-lines {
  margin-left: auto;
  font-size: 10px;
  color: #666;
  background: #1f1f28;
  padding: 1px 5px;
  border-radius: 3px;
}

.template-item.ssp-item {
  font-family: 'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

/* === Models 构件树 === */
.models-toolbar {
  display: flex;
  gap: 4px;
  padding: 6px;
  border-bottom: 1px solid #1f1f28;
}

.models-search {
  flex: 1;
  background: #0e0e14;
  border: 1px solid #2a2a35;
  border-radius: 3px;
  padding: 5px 8px;
  font-size: 12px;
  color: #e6e6e6;
  outline: none;
  font-family: inherit;
}

.models-search:focus {
  border-color: #2a3550;
}

.btn-mini {
  font-size: 12px;
  padding: 4px 8px;
  background: #1f1f28;
  color: #aaa;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.btn-mini:hover {
  background: #2a3550;
  color: #fff;
}

.tree-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 4px;
}

.tree-row {
  display: flex;
  align-items: center;
  height: 24px;
  border-radius: 3px;
}

.tree-row:hover {
  background: #1a1a22;
}

.tree-toggle {
  width: 16px;
  height: 16px;
  background: transparent;
  border: none;
  color: #888;
  font-size: 9px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s;
  flex-shrink: 0;
}

.tree-toggle.open {
  transform: rotate(90deg);
  color: #ccc;
}

.tree-toggle.leaf-dot {
  font-size: 14px;
  cursor: default;
}

.tree-label {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: #c8d3f0;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  padding: 2px 4px;
  border-radius: 3px;
  min-width: 0;
}

.tree-label:hover {
  background: #2a3550;
}

.tree-label.folder {
  color: #fff;
  font-weight: 500;
}

.tree-icon {
  font-size: 11px;
  flex-shrink: 0;
}

.tree-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}

.tree-count {
  font-size: 10px;
  color: #888;
  background: #1f1f28;
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}

.path-editor-section {
  flex-shrink: 0;
  padding: 8px;
  border-top: 1px solid #2a2a35;
  background: #101017;
}

.path-editor-title,
.path-editor-toggle,
.path-editor-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.path-editor-title {
  justify-content: space-between;
  color: #fff;
  font-size: 12px;
  margin-bottom: 7px;
}

.path-editor-toggle {
  color: #aaa;
  font-size: 10px;
  font-weight: 400;
}

.path-editor-select,
.path-editor-search,
.path-editor-inline-select {
  width: 100%;
  box-sizing: border-box;
  margin-top: 5px;
  padding: 5px 6px;
  border: 1px solid #2a2a35;
  border-radius: 3px;
  background: #0e0e14;
  color: #d8def5;
  font: 11px inherit;
}

.path-editor-inline-select {
  flex: 2;
  min-width: 0;
  margin-top: 0;
}

.path-editor-actions {
  margin-top: 6px;
}

.path-editor-actions .btn-mini {
  flex: 1;
  min-width: 0;
  padding-left: 4px;
  padding-right: 4px;
}

.path-editor-apply {
  color: #fff;
  background: #2a4ad0;
}

.path-editor-danger {
  color: #ff9c9c;
}

.path-editor-details {
  margin-top: 7px;
  padding: 5px 6px 7px;
  border: 1px solid #252532;
  border-radius: 4px;
  color: #aeb7d1;
  font-size: 10px;
}

.path-editor-details summary {
  cursor: pointer;
  color: #d8def5;
  user-select: none;
}

.path-editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
}

.path-editor-grid-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.path-editor-wide {
  width: 100%;
  margin-top: 6px;
}

.path-editor-hint,
.path-editor-status,
.path-editor-error,
.path-editor-empty {
  margin: 7px 0 0;
  font-size: 10px;
  line-height: 1.45;
}

.path-editor-hint,
.path-editor-empty {
  color: #777;
}

.path-editor-status {
  color: #67d8a0;
}

.path-editor-error {
  color: #ff7777;
  overflow-wrap: anywhere;
}

/* Models tab 右侧详情面板 */
.models-info-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.models-info-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.info-tip {
  font-size: 12px;
  color: #aaa;
  line-height: 1.6;
  margin: 0 0 16px 0;
  padding: 10px 12px;
  background: #0e0e14;
  border-radius: 4px;
  border: 1px solid #1f1f28;
}

.info-tip kbd {
  display: inline-block;
  padding: 1px 6px;
  background: #1f1f28;
  border: 1px solid #2a2a35;
  border-radius: 3px;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  color: #fff;
}

.info-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.info-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  background: #0e0e14;
  border: 1px solid #1f1f28;
  border-radius: 4px;
  font-size: 12px;
}

.info-list li strong {
  color: #fff;
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
}

.info-list li .info-meta {
  color: #888;
  font-size: 11px;
}

.side-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.empty {
  padding: 20px 12px;
  color: #888;
  font-size: 12px;
  text-align: center;
}

.empty .hint {
  margin-top: 8px;
  font-size: 11px;
  color: #666;
}

.empty code {
  background: #1f1f28;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.template-group {
  margin-bottom: 8px;
}

.group-header {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 4px 10px 4px 10px;
  margin-top: 4px;
  font-size: 10px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  border-bottom: 1px solid #2a2a35;
}

.group-category {
  color: #c0c0d0;
  font-weight: 600;
}

.group-sub {
  color: #666;
}

.group-stats {
  margin-left: auto;
  display: flex;
  gap: 4px;
  align-items: baseline;
}

.group-stat-passed {
  color: #4ade80;
  font-size: 9px;
  font-weight: 600;
}

.group-stat-skipped {
  color: #f87171;
  font-size: 9px;
  font-weight: 600;
}

.group-stat-total {
  color: #555;
  font-size: 9px;
}

/* 测试进度统计条 (顶部四个 pill) */
.side-stats {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid #2a2a35;
  background: rgba(0, 0, 0, 0.15);
}

.stat-pill {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid #2a2a35;
  border-radius: 3px;
  color: #888;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}

.stat-pill:hover {
  background: rgba(255, 255, 255, 0.05);
}

.stat-pill.active {
  border-color: currentColor;
}

.stat-passed {
  color: #4ade80;
}

.stat-passed.active {
  background: rgba(74, 222, 128, 0.12);
}

.stat-skipped {
  color: #f87171;
}

.stat-skipped.active {
  background: rgba(248, 113, 113, 0.12);
}

.stat-pending {
  color: #888;
}

.stat-pending.active {
  background: rgba(255, 255, 255, 0.06);
  color: #c0c0d0;
}

.stat-clear {
  flex: 0 0 30px;
  color: #888;
}

.stat-clear:hover {
  color: #f87171;
}

.stat-icon {
  font-size: 10px;
  font-weight: 700;
}

/* 进度条 (水平条状) */
.side-progress {
  display: flex;
  height: 3px;
  background: #1a1a24;
  border-bottom: 1px solid #2a2a35;
}

.progress-segment {
  height: 100%;
  transition: width 0.2s;
}

.progress-passed {
  background: #4ade80;
}

.progress-skipped {
  background: #f87171;
}

.template-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px 7px 20px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: #ccc;
  margin-bottom: 1px;
  transition: background 0.1s;
}

.template-item.status-passed {
  color: #4ade80;
  background: rgba(74, 222, 128, 0.06);
}

.template-item.status-passed .template-id {
  color: #4ade80;
}

.template-item.status-skipped {
  color: #f87171;
  background: rgba(248, 113, 113, 0.06);
  opacity: 0.7;
}

.template-item.status-skipped .template-id {
  color: #f87171;
  text-decoration: line-through;
  text-decoration-color: rgba(248, 113, 113, 0.5);
}

.template-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.template-item.status-passed:hover {
  background: rgba(74, 222, 128, 0.12);
}

.template-item.status-skipped:hover {
  background: rgba(248, 113, 113, 0.1);
  opacity: 1;
}

.status-icon {
  flex-shrink: 0;
  width: 14px;
  font-size: 11px;
  font-weight: 700;
  color: #4ade80;
}

.status-icon.skipped {
  color: #f87171;
}

/* 右键状态菜单 */
.status-menu {
  position: fixed;
  z-index: 1000;
  background: #1a1a24;
  border: 1px solid #2a2a35;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 160px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  font-size: 13px;
}

.status-menu-title {
  padding: 6px 12px;
  font-size: 10px;
  color: #888;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  border-bottom: 1px solid #2a2a35;
  margin-bottom: 4px;
}

.status-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  background: transparent;
  border: none;
  color: #ccc;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
}

.status-menu-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.status-menu-passed:hover {
  background: rgba(74, 222, 128, 0.15);
  color: #4ade80;
}

.status-menu-skipped:hover {
  background: rgba(248, 113, 113, 0.15);
  color: #f87171;
}

.status-menu-default:hover {
  background: rgba(255, 255, 255, 0.08);
}

.status-menu-icon {
  width: 14px;
  text-align: center;
  font-weight: 700;
}

.template-item.active {
  background: #2a2a3a;
  border-color: #3a3a4a;
  color: #fff;
}

.template-id {
  font-size: 12px;
  font-weight: 500;
}

.template-sub {
  /* unused — category/subcategory 现在显示在 .group-header */
  display: none;
}

.sandbox-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.three-container {
  position: relative;
  flex: 1;
  min-height: 0;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  font-size: 14px;
}

.overlay.error {
  color: #ff6b6b;
  white-space: pre-line;
  text-align: center;
  padding: 20px;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.overlay-hint {
  font-size: 11px;
  color: #888;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}

.current-model-banner {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(15, 15, 21, 0.85);
  backdrop-filter: blur(6px);
  border: 1px solid #2a2a35;
  border-radius: 6px;
  font-size: 12px;
  z-index: 10;
}

.current-model-label {
  color: #888;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.current-model-url {
  background: transparent;
  color: #4FC3F7;
  font-size: 11px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}

.bottom-panel {
  height: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #0f0f15;
  border-top: 1px solid #2a2a35;
}

.code-section,
.console-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.code-section {
  flex: 1;
  border-bottom: 1px solid #2a2a35;
}

.section-header {
  display: flex;
  align-items: center;
  padding: 8px 14px;
  background: #13131a;
  border-bottom: 1px solid #2a2a35;
  flex-shrink: 0;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  letter-spacing: 0.5px;
}

.section-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}

.duration {
  font-size: 11px;
  color: #888;
}

.btn {
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.1s;
}

.btn.primary {
  background: #2a4ad0;
  color: #fff;
}

.btn.primary:hover:not(:disabled) {
  background: #3458e8;
}

.btn.primary:disabled {
  background: #1a1f2e;
  color: #555;
  cursor: not-allowed;
}

.btn.ghost {
  background: transparent;
  color: #aaa;
  border-color: #2a2a35;
}

.btn.ghost:hover:not(:disabled) {
  background: #1f1f28;
  color: #fff;
}

.btn.ghost:disabled {
  color: #555;
  cursor: not-allowed;
}

.code-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
}

.meta-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
  align-items: baseline;
}

.meta-key {
  color: #888;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
  width: 80px;
}

.meta-val {
  color: #c0c0d0;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
  word-break: break-all;
}

.code-block {
  background: #13131a;
  border: 1px solid #2a2a35;
  border-radius: 4px;
  padding: 10px 12px;
  margin: 8px 0;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #e6e6e6;
  overflow-x: auto;
  white-space: pre-wrap;
}

.code-block.alt {
  background: #1a1a22;
}

.code-empty {
  padding: 40px;
  text-align: center;
  color: #555;
  font-size: 13px;
}

.example {
  margin-top: 6px;
}

.console-section {
  height: 110px;
}

.console-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px 14px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
  line-height: 1.5;
}

.console-empty {
  color: #555;
  padding: 6px 0;
}

.log-line {
  display: flex;
  gap: 8px;
  padding: 2px 0;
}

.log-tag {
  color: #666;
  flex-shrink: 0;
  width: 50px;
}

.log-log .log-text {
  color: #e6e6e6;
}

.log-warn .log-tag {
  color: #e0a040;
}
.log-warn .log-text {
  color: #e0c890;
}

.log-error .log-tag {
  color: #e06060;
}
.log-error .log-text {
  color: #ff9090;
}

.log-info .log-tag {
  color: #60a0e0;
}
.log-info .log-text {
  color: #90c0ff;
}

.log-text {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
