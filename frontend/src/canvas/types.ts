/**
 * 资产画布数据模型。
 *
 * 画布定义（节点、连线、坐标、配置）持久化为 canvas.json（prompt/ 下）；
 * 生成产物为磁盘文件（assert/{scope}/canvas/{nodeId}/v{n}.jpg）。
 */

/** 数据流类型：连接是否允许由端口数据类型决定（ComfyUI 思路） */
export type DataType = 'image' | 'text'

/** 端口：节点的输入/输出接口，每个端口有固定类型 */
export interface Port {
  /** 端口唯一标识（节点内唯一） */
  id: string
  /** 端口数据类型，连接时校验 */
  type: DataType
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
  createdAt: string
  updatedAt: string
}

/** 当前 schema 版本 */
export const CANVAS_SCHEMA_VERSION = 1

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
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
  }
}
