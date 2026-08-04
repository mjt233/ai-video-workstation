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

/** 自动搭画布结果：应新增的节点、连线与生成节点 prompt */
export interface AutoBuildResult {
  nodes: CanvasNodeData[]
  connections: CanvasConnection[]
  generateNodeId: string
  prompt: string
}

/** 引用解析结果 */
export interface RefResolution {
  /** 资产项目相对路径（assert/ 下） */
  assetPath: string
  /** 锚点节点显示名 */
  label: string
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
  if (!trimmed || trimmed === 'prev' || trimmed.startsWith('prev')) return null
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
    if (shotRef) refs.push({ assetPath: shotRef.assetPath, label: shotRef.label })
    for (const ch of d.登场角色 ?? []) {
      const charRef = resolveCharacterRef(ch)
      if (charRef) refs.push({ assetPath: charRef.assetPath, label: charRef.label })
    }
  }
  return refs
}
