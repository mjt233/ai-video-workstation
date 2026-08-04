import { newId, type CanvasConnection, type CanvasData, type CanvasNodeData } from './types'

/**
 * 自动搭画布纯函数：根据资产引用列表生成/合并画布结构。
 * 幂等：已存在同路径锚点或生成节点时不重复创建，只补充缺失引用。
 */

/** 锚点引用：一个加载图片节点要绑定的资产 */
export interface AutoBuildRef {
  /** 资产项目相对路径（assert/ 下） */
  assetPath: string
  /** 锚点节点显示名 */
  label: string
}

/** 引用解析结果（与 AutoBuildRef 同构，别名复用） */
export type RefResolution = AutoBuildRef

/** 自动搭画布结果：应新增的节点、连线与生成节点 prompt */
export interface AutoBuildResult {
  nodes: CanvasNodeData[]
  connections: CanvasConnection[]
  generateNodeId: string
  prompt: string
}

/**
 * 解析分镜 stage.json 的「基础场景」引用为 assert 路径（对齐服务端 resolveStageAssetPath）。
 * 支持：`场景/标签`、`场景/标签@变体`、`custom/{路径}`；prev 返回 null（由调用方异步解析）。
 *
 * @param baseStage 基础场景引用
 * @returns 解析结果或 null（prev / 空 / 格式无效）
 */
export function resolveShotStageRef(baseStage: string): RefResolution | null {
  const trimmed = baseStage.trim()
  if (!trimmed || trimmed === 'prev') return null
  if (trimmed.startsWith('custom/')) {
    return { assetPath: `assert/custom/${trimmed.slice('custom/'.length)}`, label: trimmed }
  }
  const at = trimmed.indexOf('@')
  const main = at >= 0 ? trimmed.slice(0, at) : trimmed
  const variantId = at >= 0 ? trimmed.slice(at + 1).trim() : ''
  const slash = main.indexOf('/')
  if (slash <= 0 || slash === main.length - 1) return null
  const stageName = main.slice(0, slash)
  const stageLabel = main.slice(slash + 1)
  if (variantId) {
    return { assetPath: `assert/stage/${stageName}/variants/${stageLabel}/${variantId}.jpg`, label: trimmed }
  }
  return { assetPath: `assert/stage/${stageName}/${stageLabel}.jpg`, label: trimmed }
}

/**
 * 解析分镜 stage.json 的「登场角色」引用为 assert 路径（对齐服务端 resolveCharacterAssetPath）。
 * 支持：`角色名`、`角色名@变体`、`custom/{路径}`。
 *
 * @param character 角色引用
 * @returns 解析结果或 null（空 / 格式无效）
 */
export function resolveCharacterRef(character: string): RefResolution | null {
  const trimmed = character.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('custom/')) {
    return { assetPath: `assert/custom/${trimmed.slice('custom/'.length)}`, label: trimmed }
  }
  const at = trimmed.indexOf('@')
  if (at < 0) {
    return { assetPath: `assert/character/${trimmed}/appearance.jpg`, label: trimmed }
  }
  const name = trimmed.slice(0, at).trim()
  const variantId = trimmed.slice(at + 1).trim()
  if (!name || !variantId) return null
  return { assetPath: `assert/character/${name}/variants/${variantId}.jpg`, label: trimmed }
}

/**
 * 从 assert/stage 资产路径推导「基础场景」引用（与 resolveShotStageRef 互为反方向）。
 * - assert/stage/{场景}/{标签}.jpg → {场景}/{标签}
 * - assert/stage/{场景}/variants/{标签}/{变体}.jpg → {场景}/{标签}@{变体}
 *
 * @param path 资产项目相对路径（assert/ 下）
 * @returns 基础场景引用；非 assert/stage/ 路径或格式无效返回空串
 */
export function deriveStageRefFromAssetPath(path: string): string {
  if (!path.startsWith('assert/stage/')) return ''
  const rest = path.slice('assert/stage/'.length).replace(/\.(jpg|jpeg|png|webp)$/i, '')
  const vIdx = rest.indexOf('/variants/')
  if (vIdx > 0) {
    const stageName = rest.slice(0, vIdx)
    const rest2 = rest.slice(vIdx + '/variants/'.length)
    const slash = rest2.indexOf('/')
    if (slash > 0) {
      const stageLabel = rest2.slice(0, slash)
      const variantId = rest2.slice(slash + 1)
      if (stageLabel && variantId) return `${stageName}/${stageLabel}@${variantId}`
    }
    return ''
  }
  const idx = rest.lastIndexOf('/')
  if (idx > 0) {
    const name = rest.slice(0, idx)
    const label = rest.slice(idx + 1)
    if (name && label) return `${name}/${label}`
  }
  return ''
}

/**
 * 识别旧版自动搭画布的错误变体路径（历史数据：`assert/stage/{场景}/{标签}@{变体}.jpg`），
 * 返回规范路径 `assert/stage/{场景}/variants/{标签}/{变体}.jpg`；非旧版错误格式返回 null。
 *
 * @param assetPath 加载节点的资产路径
 * @returns 旧版路径与规范路径；无法识别时返回 null
 */
export function normalizeLegacyVariantPath(assetPath: string): { legacy: string; canonical: string } | null {
  const m = assetPath.match(/^assert\/stage\/([^/]+)\/([^/@]+)@([^/]+)\.jpg$/)
  if (!m) return null
  const [, stage, label, variant] = m
  return {
    legacy: assetPath,
    canonical: `assert/stage/${stage}/variants/${label}/${variant}.jpg`,
  }
}

/**
 * 从现有画布 + 引用列表生成自动搭画布结果。
 *
 * @param data 现有画布（用于幂等判断）
 * @param refs 锚点引用列表
 * @param prompt 生成节点 prompt 初稿
 * @param x 锚点起始 x
 * @param y 锚点起始 y
 * @returns 应新增/更新的节点与连线
 */
export function buildAutoCanvas(data: CanvasData, refs: AutoBuildRef[], prompt: string, x = 80, y = 80): AutoBuildResult {
  const nodes: CanvasNodeData[] = []
  const connections: CanvasConnection[] = []
  const existingPaths = new Set(data.nodes.map((n) => (typeof n.config.assetPath === 'string' ? n.config.assetPath : '')))

  // 生成节点：复用现有 image-generate 节点，否则新建
  let generateNode = data.nodes.find((n) => n.prototypeId === 'image-generate')
  if (!generateNode) {
    generateNode = {
      id: newId(),
      prototypeId: 'image-generate',
      name: '生成图片',
      x: x + 320,
      y,
      width: 240,
      height: 160,
      config: {},
    }
    nodes.push(generateNode)
  }
  const generateId = generateNode.id

  // 锚点节点：为缺失的引用创建加载图片节点
  let cursor = 0
  for (const ref of refs) {
    if (existingPaths.has(ref.assetPath)) continue
    const anchor: CanvasNodeData = {
      id: newId(),
      prototypeId: 'image-loader',
      name: ref.label,
      x,
      y: y + cursor * 160,
      width: 220,
      height: 150,
      config: { assetPath: ref.assetPath },
    }
    nodes.push(anchor)
    existingPaths.add(ref.assetPath)
    connections.push({
      id: newId(),
      fromNodeId: anchor.id,
      fromPortId: 'out',
      toNodeId: generateId,
      toPortId: 'in',
    })
    cursor += 1
  }

  return { nodes, connections, generateNodeId: generateId, prompt }
}

/**
 * 生成节点配置的 prompt 初稿。
 *
 * @param prompt 已有 prompt
 * @param extra 追加内容
 * @returns 合并后的 prompt（已有时追加换行，否则取 extra）
 */
export function mergePrompt(prompt: string, extra: string): string {
  if (prompt.trim()) return `${prompt.trim()}\n${extra.trim()}`
  return extra.trim()
}

/** 从分镜 stage.json 提取自动搭画布引用（角色/场景；prev 由调用方另行解析） */
export function buildShotRefsFromStage(stageDefs: unknown[]): AutoBuildRef[] {
  const refs: AutoBuildRef[] = []
  for (const def of stageDefs ?? []) {
    const d = def as { 基础场景?: string; 登场角色?: string[] }
    const shotRef = resolveShotStageRef(d.基础场景 ?? '')
    if (shotRef) refs.push(shotRef)
    for (const ch of d.登场角色 ?? []) {
      const charRef = resolveCharacterRef(ch)
      if (charRef) refs.push(charRef)
    }
  }
  return refs
}

/** 子场景衍生变体元数据（读 prompt/stage/{stage}/variants/{label}/{id}.json） */
export interface StageVariantRef {
  /** 变体 id */
  id: string
  /** 衍生描述（生成节点 prompt） */
  desc: string
  /** 父变体 id（同 label 内，可选） */
  parentId?: string
  /** 额外引用资产路径（assert/ 开头，可选） */
  refs: string[]
  /** 变体是否已有生成图（自动搭画布时复制既有图片作为节点当前产物） */
  hasImage?: boolean
}

/**
 * 自动搭「子场景画布」：基础加载图片节点 + 每个衍生变体一个生成图片节点 + 变体 refs 加载图片节点。
 * 连线规则：根变体 ← 基础加载节点；嵌套变体 ← 父变体生成节点；变体 refs ← 各自加载节点。
 * 层级布局：根变体在第 1 列（x + H_STEP）、子变体在第 2 列（x + 2*H_STEP）、孙变体第 3 列……
 * 按深度分列（列间距 H_STEP=320），同层变体纵向堆叠（行间距 V_STEP=160），
 * 变体 refs 的加载节点放在所属变体所在列底部（同列、接在变体行之后）。
 * 幂等：加载节点按 config.assetPath、生成节点按 config.autoRef（stage:{label}@{id}）判重；
 * 已存在节点只补缺连线，不重复创建。
 *
 * @param data 现有画布（幂等判断）
 * @param label 子场景标签
 * @param baseAssetPath 子场景基础图路径（assert/stage/{stage}/{label}.jpg）
 * @param variants 变体元数据列表
 * @param x 基础加载节点 x
 * @param y 基础加载节点 y
 * @param outputBase 可选。生成节点产物目录基路径（如 assert/stage/{stage}/canvas/{label}）。
 *   当某变体 hasImage 且传了 outputBase 时，预置该生成节点 config.current/history 指向
 *   {outputBase}/{nodeId}/v1.jpg（实际把既有变体图复制到该路径由调用方完成）。
 * @returns 应新增的节点与连线
 */
export function buildSubSceneAutoCanvas(
  data: CanvasData,
  label: string,
  baseAssetPath: string,
  variants: StageVariantRef[],
  x = 80,
  y = 80,
  outputBase?: string,
): AutoBuildResult {
  const nodes: CanvasNodeData[] = []
  const connections: CanvasConnection[] = []
  const existingPaths = new Set(
    data.nodes.map((n) => (typeof n.config.assetPath === 'string' ? n.config.assetPath : '')),
  )
  const hasConnection = (fromId: string, toId: string) =>
    data.connections.some((c) => c.fromNodeId === fromId && c.toNodeId === toId) ||
    connections.some((c) => c.fromNodeId === fromId && c.toNodeId === toId)
  const addConnection = (fromId: string, toId: string) => {
    if (fromId && toId && !hasConnection(fromId, toId)) {
      connections.push({ id: newId(), fromNodeId: fromId, fromPortId: 'out', toNodeId: toId, toPortId: 'in' })
    }
  }

  // 层级布局：各列（x 列索引，0=基础加载列）已占用最大 y；预置自既有节点，避免增量重跑重叠
  const H_STEP = 320
  const V_STEP = 160
  const columnOf = (nx: number) => Math.round((nx - x) / H_STEP)
  const columnMaxY = new Map<number, number>()
  for (const n of data.nodes) {
    const col = columnOf(n.x)
    const cur = columnMaxY.get(col)
    if (cur === undefined || n.y > cur) columnMaxY.set(col, n.y)
  }
  /** 取某列下一个可用 y（该列最大 y + 行间距），并占用该行 */
  const nextYInColumn = (column: number) => {
    const ny = (columnMaxY.get(column) ?? y - V_STEP) + V_STEP
    columnMaxY.set(column, ny)
    return ny
  }

  // 基础加载图片节点：只建一个，所有根变体共用
  let baseId = ''
  if (existingPaths.has(baseAssetPath)) {
    baseId = data.nodes.find((n) => n.config.assetPath === baseAssetPath)?.id ?? ''
  } else {
    baseId = newId()
    nodes.push({
      id: baseId,
      prototypeId: 'image-loader',
      name: label,
      x,
      y,
      width: 220,
      height: 150,
      config: { assetPath: baseAssetPath },
    })
    existingPaths.add(baseAssetPath)
    // 占用基础加载列（第 0 列）该行；若基础节点为复用的既有节点，其 y 已由上方预置循环计入
    columnMaxY.set(0, Math.max(columnMaxY.get(0) ?? y - V_STEP, y))
  }

  // 计算各变体深度：根=0；父缺失/父不在列表按根处理；成环/自环按根处理（visiting 防无限递归）
  const byId = new Map(variants.map((v) => [v.id, v]))
  const depthById = new Map<string, number>()
  const visiting = new Set<string>()
  const resolveDepth = (id: string): number => {
    const memo = depthById.get(id)
    if (memo !== undefined) return memo
    if (visiting.has(id)) return 0 // 成环/自环：按根处理
    visiting.add(id)
    const v = byId.get(id)
    const d = v?.parentId && byId.has(v.parentId) ? resolveDepth(v.parentId) + 1 : 0
    depthById.set(id, d)
    return d
  }
  const depthByVariant = new Map<string, number>()
  for (const v of variants) depthByVariant.set(v.id, resolveDepth(v.id))

  // 每个变体一个生成图片节点（autoRef 幂等；按深度分列布局）
  const genIdByVariant = new Map<string, string>()
  for (const v of variants) {
    const autoRef = `stage:${label}@${v.id}`
    const existing = data.nodes.find((n) => n.config.autoRef === autoRef)
    if (existing) {
      genIdByVariant.set(v.id, existing.id)
      continue
    }
    const genId = newId()
    const level = depthByVariant.get(v.id) ?? 0
    const config: Record<string, unknown> = { prompt: v.desc, autoRef }
    // 变体已有生成图：预置 current/history 指向画布产物 v1（实际复制由调用方完成）
    if (v.hasImage && outputBase) {
      const outPath = `${outputBase}/${genId}/v1.jpg`
      const now = new Date().toISOString()
      config.current = { version: 1, path: outPath, date: now }
      config.history = [{ version: 1, path: outPath, date: now }]
    }
    nodes.push({
      id: genId,
      prototypeId: 'image-generate',
      name: v.id,
      x: x + (level + 1) * H_STEP,
      y: nextYInColumn(level + 1),
      width: 240,
      height: 160,
      config,
    })
    genIdByVariant.set(v.id, genId)
  }

  // 连线 + refs 加载节点（assetPath 共享；refs 放在所属变体所在列底部）
  const refLoaderIds = new Map<string, string>()
  for (const v of variants) {
    const genId = genIdByVariant.get(v.id)
    if (!genId) continue
    const inputNodeId = v.parentId ? (genIdByVariant.get(v.parentId) ?? '') : baseId
    addConnection(inputNodeId, genId)
    const level = depthByVariant.get(v.id) ?? 0
    for (const ref of v.refs) {
      let loaderId = refLoaderIds.get(ref)
      if (loaderId == null) {
        if (ref === baseAssetPath) {
          // ref 指向基础图本身：直接用基础加载节点
          loaderId = baseId
        } else if (existingPaths.has(ref)) {
          loaderId = data.nodes.find((n) => n.config.assetPath === ref)?.id ?? ''
        } else {
          loaderId = newId()
          nodes.push({
            id: loaderId,
            prototypeId: 'image-loader',
            name: ref.split('/').pop() ?? ref,
            x: x + (level + 1) * H_STEP,
            y: nextYInColumn(level + 1),
            width: 220,
            height: 150,
            config: { assetPath: ref },
          })
          existingPaths.add(ref)
        }
        refLoaderIds.set(ref, loaderId)
      }
      addConnection(loaderId, genId)
    }
  }

  const firstGenId = genIdByVariant.values().next().value ?? ''
  return { nodes, connections, generateNodeId: firstGenId, prompt: '' }
}
