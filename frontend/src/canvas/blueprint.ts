/**
 * 画布蓝图（Canvas Blueprint）纯逻辑模块。
 *
 * 蓝图 = 可复用的画布片段：节点配置 + 连接 + 持久分组 + 相对位置关系。
 * 与画布定义（canvas.json）的区别：
 * - 蓝图不含 `kind`、不绑定画布 scope、不产生产物路径；
 * - 蓝图不携带任何产物文件（生成节点插入到画布后需重新生成）；
 * - 蓝图文件由服务端管理（全局 `server/config/blueprints/{id}.json`、
 *   项目级 `design/{project}/prompt/blueprint/{id}.json`），带 `rev` 与 CAS 保存。
 *
 * 本模块无 Vue / 浏览器依赖，仅依赖类型与既有纯逻辑（groups / groupSelection），便于单元测试。
 */

import type { CanvasConnection, CanvasGroupData, CanvasNodeData, NodeConfig } from './types'
import { newId } from './types'
import {
  DEFAULT_GROUP_COLOR,
  GROUP_HEADER_HEIGHT,
  GROUP_MIN_SIZE,
  asCanvasGroupData,
  boundingRect,
  rectsOverlap,
  type RectLike,
} from './groups'
import { GROUP_FRAME_PADDING, remapNodeConfig } from './groupSelection'

/** 蓝图 schema 版本（结构演进时递增，读取时经 migrateBlueprint 迁移） */
export const BLUEPRINT_SCHEMA_VERSION = 1

/** 蓝图名称最大长度（服务端同样校验） */
export const BLUEPRINT_NAME_MAX = 60
/** 蓝图描述最大长度 */
export const BLUEPRINT_DESC_MAX = 200
/** 单个蓝图节点数上限（防滥用；服务端同样校验） */
export const BLUEPRINT_NODE_LIMIT = 2000

/** 蓝图内容载荷：节点 + 组内连线 + 持久分组（与画布定义同构） */
export interface BlueprintPayload {
  /** 节点列表（id/prototypeId/name/x/y/width/height/config） */
  nodes: CanvasNodeData[]
  /** 连线列表（两端必须都在 nodes 中） */
  connections: CanvasConnection[]
  /** 持久分组列表（名称/颜色/矩形；成员关系仍由几何重叠实时派生） */
  groups: CanvasGroupData[]
}

/**
 * 画布蓝图（磁盘文件内容）。
 */
export interface CanvasBlueprint extends BlueprintPayload {
  /** schema 版本（BLUEPRINT_SCHEMA_VERSION） */
  version: number
  /** 蓝图 id（uuid；服务端以文件名承载，读取时以文件名为准） */
  id: string
  /** 蓝图名称（非空） */
  name: string
  /** 蓝图描述（可空） */
  description: string
  /**
   * 资产项目（资产上下文）：
   * - 项目级蓝图：恒等于所属项目（服务端强制，前端只读展示）；
   * - 全局蓝图：可为 null（未设置时编辑器内资产上传/选择入口置灰）。
   */
  assetProject: string | null
  /** 创建时间（ISO） */
  createdAt: string
  /** 更新时间（ISO，服务端每次保存刷新） */
  updatedAt: string
  /** 保存版本号（服务端维护，前端 CAS 基准） */
  rev?: number
}

/** 蓝图内容统计（列表与详情展示用） */
export interface BlueprintCounts {
  /** 节点数量 */
  nodeCount: number
  /** 连线数量 */
  connectionCount: number
  /** 分组数量 */
  groupCount: number
  /** 节点原型分布（prototypeId → 数量） */
  prototypeCounts: Record<string, number>
}

/** 蓝图列表项（服务端 `GET /api/blueprints` 返回：元信息 + 内容统计） */
export interface BlueprintListItem extends BlueprintCounts {
  /** 蓝图 id */
  id: string
  /** 蓝图名称 */
  name: string
  /** 蓝图描述 */
  description: string
  /** 资产项目（可空） */
  assetProject: string | null
  /** 创建时间（ISO） */
  createdAt: string
  /** 更新时间（ISO） */
  updatedAt: string
  /** 保存版本号 */
  rev: number
}

/**
 * 深拷贝画布片段数据（纯 JSON 数据，无函数字段）。
 *
 * @param value 任意 JSON 值
 * @returns 深拷贝结果
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 从画布数据中捕获蓝图内容（多选节点 → 蓝图）。
 *
 * 捕获规则：
 * - 节点：选中集内的全部节点（保持原始坐标，实例化时再归一化）；
 * - 连线：**两端都在选中集内**的连线（跨选中边界的连线不入蓝图）；
 * - 持久分组：**必须被显式选中**（分组选中集），且「**成员节点全部在选中集内**」。
 *   即：只选中分组内的全部节点、但未选中分组本身时，分组**不**入蓝图（避免"我只想要这些
 *   节点"的语义被扩成"连框一起要"）；反向半截情况（分组已选中但存在成员节点未选中）同样
 *   不收纳，避免把半截分组带出、插入后分组矩形内出现本不属于蓝图的空白区域。
 *   成员判定与画布一致，即「节点矩形与分组矩形重叠面积 > 0」。
 *
 * @param canvas 画布片段（节点/连线/分组；可为 canvas.json 全量数据）
 * @param nodeIds 选中节点 id 列表
 * @param groupIds 选中分组 id 列表（缺省为空 = 不带入任何分组）
 * @returns 蓝图内容载荷（深拷贝；无有效节点时为空载荷）
 */
export function captureBlueprintFromCanvas(
  canvas: { nodes: CanvasNodeData[]; connections: CanvasConnection[]; groups?: CanvasGroupData[] },
  nodeIds: readonly string[],
  groupIds: readonly string[] = [],
): BlueprintPayload {
  const idSet = new Set(nodeIds)
  const nodes = canvas.nodes.filter((n) => idSet.has(n.id)).map((n) => clone(n))
  if (nodes.length === 0) return { nodes: [], connections: [], groups: [] }
  const connections = canvas.connections
    .filter((c) => idSet.has(c.fromNodeId) && idSet.has(c.toNodeId))
    .map((c) => clone(c))
  const groupIdSet = new Set(groupIds)
  const groups = (canvas.groups ?? [])
    .filter((g) => {
      // 分组本身未选中：不带入（仅选中组内全部节点 ≠ 选中分组）
      if (!groupIdSet.has(g.id)) return false
      const members = canvas.nodes.filter((n) => rectsOverlap(g, n))
      return members.every((n) => idSet.has(n.id))
    })
    .map((g) => clone(g))
  return { nodes, connections, groups }
}

/**
 * 计算蓝图内容的包围盒（节点 ∪ 分组；实例化时用于把内容对齐到插入点）。
 *
 * @param blueprint 蓝图内容载荷
 * @returns 包围盒；内容为空返回 null
 */
export function blueprintBounds(blueprint: BlueprintPayload): RectLike | null {
  return boundingRect([...blueprint.nodes, ...blueprint.groups])
}

/**
 * 剥离节点运行时字段：产物引用与文本历史。
 *
 * 这些字段指向「某张画布」的产物文件或历史快照，蓝图作为模板不应携带
 * （插入后按目标画布的固定产物路径重新推导）。其余配置（提示词、工作流、
 * 参数、导演台素材块、输入顺序、资产路径等）完整保留。
 *
 * @param config 节点配置
 * @returns 剥离后的配置（浅拷贝）
 */
export function stripRuntimeConfig(config: NodeConfig): NodeConfig {
  const next: NodeConfig = { ...config }
  delete next.current
  delete next.history
  delete next.outputHistory
  return next
}

/** instantiateBlueprint 选项 */
export interface InstantiateOptions {
  /** 插入锚点（流坐标）：蓝图内容包围盒左上角对齐到该点 */
  origin: { x: number; y: number }
  /** 是否额外创建「独立分组」把全部内容包住（分组名 = 蓝图名） */
  asGroup?: boolean
  /** 独立分组名称（缺省「蓝图」；通常传蓝图名） */
  groupName?: string
  /** 独立分组主题色（缺省色板首色） */
  groupColor?: string
  /** 独立分组左/右/下内边距（流坐标像素；缺省与多选群组留白一致 12px） */
  padding?: number
  /**
   * 独立分组顶部额外内边距（流坐标像素；缺省 GROUP_HEADER_HEIGHT = 28）。
   * 用于容纳分组标题条：顶部内边距合计 `padding + topInset`，保证最上方内容不被标题条压住。
   */
  topInset?: number
}

/**
 * 实例化蓝图：把蓝图内容转换为可直接写入画布的数据。
 *
 * 处理内容：
 * 1. **归一化**：内容包围盒左上角对齐 `origin`（`asGroup` 时在独立分组内居中）；
 * 2. **id 重映射**：节点/连线/分组全部换新 id，并把节点配置里的节点引用
 *    （`config.inputOrder`、导演台 `imageClips/audioClips[].sourceNodeId`）重映射到新 id
 *    （复用 `remapNodeConfig`）；
 * 3. **剥离运行时字段**：`current` / `history` / `outputHistory`（见 `stripRuntimeConfig`）；
 * 4. **独立分组**：`asGroup=true` 时额外生成一个分组矩形（名称 = `groupName`），
 *    尺寸 = 内容包围盒 + 左右/下内边距 `padding` + 顶部 `padding + topInset`
 *    （`topInset` 容纳标题条，缺省 28px，故顶部合计 40px），不小于分组最小尺寸，
 *    内容整体内缩，从而「所有节点嵌套放置在该分组内」；蓝图内原有分组同时平移，相对关系不变。
 *
 * 注意：节点 `config.assetPath` 等资产路径**原样保留**（跨项目插入是否可用由用户自行处理）。
 *
 * @param blueprint 蓝图内容载荷
 * @param options 实例化选项
 * @returns 可直接写入画布的内容载荷（新 id、新坐标；内容为空时返回空载荷）
 */
export function instantiateBlueprint(blueprint: BlueprintPayload, options: InstantiateOptions): BlueprintPayload {
  const bounds = blueprintBounds(blueprint)
  if (!bounds) return { nodes: [], connections: [], groups: [] }
  const padding = options.padding ?? GROUP_FRAME_PADDING
  const topInset = options.topInset ?? GROUP_HEADER_HEIGHT
  const originX = Math.round(options.origin.x)
  const originY = Math.round(options.origin.y)

  /** 内容相对原蓝图的位移（未创建独立分组时 = 锚点 - 包围盒左上角） */
  let dx = originX - bounds.x
  let dy = originY - bounds.y
  const groups: CanvasGroupData[] = []

  if (options.asGroup) {
    const width = Math.max(GROUP_MIN_SIZE.width, Math.round(bounds.width + padding * 2))
    const height = Math.max(GROUP_MIN_SIZE.height, Math.round(bounds.height + padding * 2 + topInset))
    // 内容在独立分组内居中：顶部至少 padding + topInset（容纳标题条），左右/下至少 padding，
    // 撑到最小尺寸时的富余空间上下平分。
    const extraY = height - (bounds.height + padding * 2 + topInset)
    dx = originX + Math.floor((width - bounds.width) / 2) - bounds.x
    dy = originY + padding + topInset + Math.floor(extraY / 2) - bounds.y
    groups.push({
      id: newId(),
      name: options.groupName?.trim() || '蓝图',
      color: options.groupColor ?? DEFAULT_GROUP_COLOR,
      x: originX,
      y: originY,
      width,
      height,
    })
  }

  const idMap = new Map<string, string>()
  for (const n of blueprint.nodes) idMap.set(n.id, newId())

  const nodes = blueprint.nodes.map((n) => {
    const copy = clone(n)
    copy.id = idMap.get(n.id) ?? copy.id
    copy.x = Math.round(n.x + dx)
    copy.y = Math.round(n.y + dy)
    copy.config = stripRuntimeConfig(remapNodeConfig(clone(n.config), idMap))
    return copy
  })

  const connections = blueprint.connections
    .filter((c) => idMap.has(c.fromNodeId) && idMap.has(c.toNodeId))
    .map((c) => ({
      id: newId(),
      fromNodeId: idMap.get(c.fromNodeId) as string,
      fromPortId: c.fromPortId,
      toNodeId: idMap.get(c.toNodeId) as string,
      toPortId: c.toPortId,
    }))

  for (const g of blueprint.groups) {
    groups.push({
      ...clone(g),
      id: newId(),
      x: Math.round(g.x + dx),
      y: Math.round(g.y + dy),
    })
  }

  return { nodes, connections, groups }
}

/**
 * 生成不重复的默认蓝图名称（`蓝图 N`，N 为最小未占用编号）。
 * 只识别形如 `蓝图 3` / `蓝图3` 的既有名称，其他自定义名称不占用编号。
 *
 * @param existing 现有蓝图列表（只需 name 字段）
 * @returns 默认名称（如 `蓝图 1`）
 */
export function defaultBlueprintName(existing: readonly { name?: string }[]): string {
  const used = new Set<number>()
  for (const item of existing) {
    const matched = /^蓝图\s*(\d+)$/.exec((item.name ?? '').trim())
    if (matched) used.add(Number.parseInt(matched[1], 10))
  }
  let n = 1
  while (used.has(n)) n += 1
  return `蓝图 ${n}`
}

/**
 * 计算蓝图内容统计（列表展示用）。
 *
 * @param blueprint 蓝图内容载荷
 * @returns 节点/连线/分组数量与节点原型分布
 */
export function blueprintSummary(blueprint: BlueprintPayload): BlueprintCounts {
  const prototypeCounts: Record<string, number> = {}
  for (const n of blueprint.nodes) {
    prototypeCounts[n.prototypeId] = (prototypeCounts[n.prototypeId] ?? 0) + 1
  }
  return {
    nodeCount: blueprint.nodes.length,
    connectionCount: blueprint.connections.length,
    groupCount: blueprint.groups.length,
    prototypeCounts,
  }
}

/**
 * 校验并还原节点数据（最小结构校验；损坏项丢弃）。
 *
 * @param value 反序列化值
 * @returns 节点数据；结构非法返回 null
 */
function asBlueprintNode(value: unknown): CanvasNodeData | null {
  if (typeof value !== 'object' || value === null) return null
  const n = value as Partial<CanvasNodeData>
  if (typeof n.id !== 'string' || !n.id) return null
  if (typeof n.prototypeId !== 'string' || !n.prototypeId) return null
  if (typeof n.name !== 'string') return null
  if (typeof n.x !== 'number' || typeof n.y !== 'number') return null
  if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return null
  if (typeof n.width !== 'number' || typeof n.height !== 'number') return null
  if (!Number.isFinite(n.width) || !Number.isFinite(n.height)) return null
  if (typeof n.config !== 'object' || n.config === null) return null
  return {
    id: n.id,
    prototypeId: n.prototypeId,
    name: n.name,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    config: n.config as NodeConfig,
  }
}

/**
 * 校验并还原连线数据（最小结构校验；损坏项丢弃）。
 *
 * @param value 反序列化值
 * @returns 连线数据；结构非法返回 null
 */
function asBlueprintConnection(value: unknown): CanvasConnection | null {
  if (typeof value !== 'object' || value === null) return null
  const c = value as Partial<CanvasConnection>
  if (typeof c.id !== 'string' || !c.id) return null
  if (typeof c.fromNodeId !== 'string' || typeof c.fromPortId !== 'string') return null
  if (typeof c.toNodeId !== 'string' || typeof c.toPortId !== 'string') return null
  return { id: c.id, fromNodeId: c.fromNodeId, fromPortId: c.fromPortId, toNodeId: c.toNodeId, toPortId: c.toPortId }
}

/**
 * 校验并迁移蓝图数据（读取文件 / 导入 JSON 时调用）。
 *
 * 容错策略与 `migrateCanvasData` 一致：结构非法的条目**丢弃并 `console.warn`**，
 * 保证旧/损坏文件仍可打开；仅当整体不是对象时返回 null。
 * 另外做完整性收敛：丢弃端点不存在的连线（防止悬空连线进入渲染）。
 *
 * @param raw 反序列化后的原始数据
 * @returns 规范化后的蓝图；整体非法时返回 null
 */
export function migrateBlueprint(raw: unknown): CanvasBlueprint | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Partial<CanvasBlueprint>

  const nodes: CanvasNodeData[] = []
  if (Array.isArray(obj.nodes)) {
    for (const item of obj.nodes) {
      const node = asBlueprintNode(item)
      if (!node) {
        console.warn('[blueprint] 蓝图存在结构非法的节点项，已丢弃', item)
        continue
      }
      nodes.push(node)
    }
  } else if (obj.nodes !== undefined) {
    console.warn('[blueprint] 蓝图的 nodes 字段不是数组，已忽略该字段')
  }

  const nodeIds = new Set(nodes.map((n) => n.id))
  const connections: CanvasConnection[] = []
  if (Array.isArray(obj.connections)) {
    for (const item of obj.connections) {
      const conn = asBlueprintConnection(item)
      if (!conn) {
        console.warn('[blueprint] 蓝图存在结构非法的连线项，已丢弃', item)
        continue
      }
      if (!nodeIds.has(conn.fromNodeId) || !nodeIds.has(conn.toNodeId)) {
        console.warn('[blueprint] 蓝图连线端点不存在，已丢弃', conn.id)
        continue
      }
      connections.push(conn)
    }
  } else if (obj.connections !== undefined) {
    console.warn('[blueprint] 蓝图的 connections 字段不是数组，已忽略该字段')
  }

  const groups: CanvasGroupData[] = []
  if (Array.isArray(obj.groups)) {
    for (const item of obj.groups) {
      const group = asCanvasGroupData(item)
      if (!group) {
        console.warn('[blueprint] 蓝图存在结构非法的分组项，已丢弃', item)
        continue
      }
      groups.push(group)
    }
  } else if (obj.groups !== undefined) {
    console.warn('[blueprint] 蓝图的 groups 字段不是数组，已忽略该字段')
  }

  const now = new Date().toISOString()
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim().slice(0, BLUEPRINT_NAME_MAX) : '未命名蓝图'
  const description = typeof obj.description === 'string' ? obj.description.slice(0, BLUEPRINT_DESC_MAX) : ''
  const assetProject = typeof obj.assetProject === 'string' && obj.assetProject.trim() ? obj.assetProject.trim() : null
  const revRaw = Number(obj.rev)

  return {
    version: BLUEPRINT_SCHEMA_VERSION,
    id: typeof obj.id === 'string' ? obj.id : '',
    name,
    description,
    assetProject,
    nodes,
    connections,
    groups,
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : now,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : now,
    ...(Number.isInteger(revRaw) && revRaw >= 0 ? { rev: revRaw } : {}),
  }
}

/**
 * 蓝图内容是否为空（无任何节点）。
 *
 * @param blueprint 蓝图内容载荷
 * @returns 无节点返回 true
 */
export function isBlueprintEmpty(blueprint: BlueprintPayload): boolean {
  return blueprint.nodes.length === 0
}
