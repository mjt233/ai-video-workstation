/**
 * 资产画布数据模型。
 *
 * 画布定义（节点、连线、分组、坐标、配置）持久化为 canvas.json（prompt/ 下）；
 * 生成产物为磁盘文件（assert/{scope}/canvas/{nodeId}/v{n}.jpg）。
 */

import { asCanvasGroupData } from './groups'

/**
 * 数据流类型：连接是否允许由端口数据类型决定（ComfyUI 思路）。
 *
 * - image / video / audio / text：具体媒体类型，连接时要求一致；
 * - media：任意媒体输入口（如生成视频节点），可接受 image/video/audio/text 来源。
 */
export type DataType = 'image' | 'video' | 'audio' | 'text' | 'media'

/**
 * 端口可接受的数据类型：
 * 单一类型（如 'image'），或多个类型的数组（如 AI文本生成节点的 ['media', 'text'] ——
 * 任意一个匹配即可连接，容忍多种来源挂到同一输入点）。
 */
export type PortType = DataType | DataType[]

/** 端口：节点的输入/输出接口，每个端口有固定（或一组可接受的）类型 */
export interface Port {
  /** 端口唯一标识（节点内唯一） */
  id: string
  /** 端口数据类型（单一类型或可接受的多类型数组），连接时校验 */
  type: PortType
  /** 端口显示名 */
  label?: string
}

/** 画布类型：场景画布 / 分镜画布 */
export type CanvasKind = 'stage' | 'scene'

/** 画布连线 */
export interface CanvasConnection {
  id: string
  fromNodeId: string
  fromPortId: string
  toNodeId: string
  toPortId: string
}

/** 节点配置（各原型自定义，见具体节点） */
export type NodeConfig = Record<string, unknown>

/** 持久化的节点数据（不含运行时方法） */
export interface CanvasNodeData {
  id: string
  prototypeId: string
  name: string
  x: number
  y: number
  width: number
  height: number
  config: NodeConfig
}

/** 画布定义（canvas.json 内容） */
export interface CanvasData {
  version: number
  kind: CanvasKind
  nodes: CanvasNodeData[]
  connections: CanvasConnection[]
  /** 持久分组列表（旧文件无此字段，迁移时补空数组） */
  groups: CanvasGroupData[]
  createdAt: string
  updatedAt: string
}

/**
 * 持久分组（可视化容器）：
 * - 成员关系由「节点矩形与分组矩形是否重叠」**实时派生**，不落盘成员列表；
 * - 分组本身是一个矩形（x/y/width/height）+ 标题 + 主题色；
 * - 渲染为 Vue Flow 节点（type: canvas-group），低于真实节点层级。
 */
export interface CanvasGroupData {
  /** 分组 id（newId() 生成） */
  id: string
  /** 标题（双击标题条可改；默认 `分组 N`） */
  name: string
  /** 主题色 hex（取预设色板，如 #1976D2） */
  color: string
  /** 分组矩形左上角 x（流坐标） */
  x: number
  /** 分组矩形左上角 y（流坐标） */
  y: number
  /** 分组矩形宽度（流坐标像素） */
  width: number
  /** 分组矩形高度（流坐标像素） */
  height: number
}

/**
 * 当前 schema 版本。
 * v1 → v2：新增 groups[]（持久分组），旧文件迁移时补空数组。
 */
export const CANVAS_SCHEMA_VERSION = 2

/**
 * 生成唯一 id（优先 crypto.randomUUID，退化用时间戳+随机数）。
 *
 * @returns 唯一字符串
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 创建默认画布数据。
 *
 * @param kind 画布类型
 * @returns 空画布定义
 */
export function createCanvasData(kind: CanvasKind): CanvasData {
  const now = new Date().toISOString()
  return {
    version: CANVAS_SCHEMA_VERSION,
    kind,
    nodes: [],
    connections: [],
    groups: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 计算下一版本号（历史长度 + 1）。
 *
 * @param history 历史版本列表
 * @returns 下一版本号
 */
export function nextVersion(history: { version: number }[]): number {
  return history.length + 1
}

/**
 * 迁移持久分组列表：逐项最小结构校验，非法项丢弃并输出警告（不抛错，保证旧/损坏文件仍可加载）。
 *
 * @param raw 原始 groups 字段值（可能不存在 / 非数组）
 * @returns 规范化后的分组列表（无 groups 字段时为空数组）
 */
function migrateGroups(raw: unknown): CanvasGroupData[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    console.warn('[canvas] canvas.json 的 groups 字段不是数组，已忽略该字段')
    return []
  }
  const groups: CanvasGroupData[] = []
  for (const item of raw) {
    const group = asCanvasGroupData(item)
    if (!group) {
      console.warn('[canvas] canvas.json 中存在结构非法的分组项，已丢弃', item)
      continue
    }
    groups.push(group)
  }
  return groups
}

/**
 * 读取时迁移/校验画布数据；结构不合法时抛出错误。
 *
 * @param raw 反序列化后的原始数据
 * @returns 规范化后的画布定义
 * @throws Error 当 raw 不是对象时
 */
export function migrateCanvasData(raw: unknown): CanvasData {
  if (!raw || typeof raw !== 'object') {
    throw new Error('画布数据格式错误')
  }
  const obj = raw as Partial<CanvasData>
  const kind: CanvasKind = obj.kind === 'scene' ? 'scene' : 'stage'
  return {
    version: CANVAS_SCHEMA_VERSION,
    kind,
    nodes: Array.isArray(obj.nodes) ? obj.nodes : [],
    connections: Array.isArray(obj.connections) ? obj.connections : [],
    groups: migrateGroups(obj.groups),
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
  }
}
