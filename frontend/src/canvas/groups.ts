/**
 * 持久分组（节点分组框）纯逻辑：几何重叠/包含判定、拖动跟随集推导、初始矩形、命名与配色。
 *
 * 与 groupSelection.ts 的区别：
 * - groupSelection.ts 是「多选临时群组」（合成节点 __group-frame / __group-dot，不入 store）；
 * - 本模块是「持久分组」（canvas.json 的 groups[]，成员关系由几何重叠实时派生、不落盘）。
 *
 * 本模块无 Vue / 浏览器依赖，仅依赖类型定义，便于单元测试。
 */

import type { CanvasGroupData, CanvasNodeData } from './types'

/** 矩形几何（流坐标像素；CanvasGroupData / CanvasNodeData 均满足该结构） */
export interface RectLike {
  /** 左上角 x */
  x: number
  /** 左上角 y */
  y: number
  /** 宽度 */
  width: number
  /** 高度 */
  height: number
}

/** 分组主题色预设色板（8 色；标题条 / 边框 / 填充由同一颜色按不同透明度派生） */
export const GROUP_PALETTE = [
  '#1976D2', // 蓝（默认）
  '#0097A7', // 青
  '#2E7D32', // 绿
  '#EF6C00', // 橙
  '#7B1FA2', // 紫
  '#C62828', // 红
  '#546E7A', // 灰
  '#6D4C41', // 棕
] as const

/** 默认分组主题色（色板首色：蓝） */
export const DEFAULT_GROUP_COLOR: string = GROUP_PALETTE[0]

/** 分组框最小尺寸（流坐标像素；缩放到此值即停止） */
export const GROUP_MIN_SIZE = { width: 160, height: 100 } as const

/**
 * 分组标题条高度（流坐标像素）。
 *
 * 分组框顶部渲染一条该高度的标题条（拖动 / 双击改名 / 色点改色），故创建分组时顶部留白
 * 必须在常规四周留白之外**额外**加上该高度，否则组内最上方节点会被标题条压住。
 *
 * 单一来源：`CanvasGroupNode.vue` 经 CSS 变量 `--canvas-group-header-height` 引用同一值，
 * 改这里即可同时生效（勿在 CSS 里写死像素）。
 */
export const GROUP_HEADER_HEIGHT = 28

/**
 * 「完全包含」判定容差（流坐标像素）。
 * 用于「框选矩形是否完全包含分组矩形」：允许框选矩形比分组矩形小 2px 仍判定为包含，
 * 避免取整/缩放换算误差导致明明框住了却不选中。
 */
export const GROUP_CONTAIN_TOLERANCE = 2

/** 区分「点击分组标题条」与「拖动分组」的最小位移（屏幕像素） */
export const GROUP_DRAG_MIN_PX = 4

/** 分组默认标题前缀（`分组 N`） */
export const GROUP_NAME_PREFIX = '分组'

/**
 * hex 颜色转 rgba() 字符串（分组配色统一入口：同一主题色按不同透明度派生三档视觉）。
 *
 * @param hex 颜色（支持 `#RGB` / `#RRGGBB`，可省略 `#`；非法值回退黑色）
 * @param alpha 透明度 0~1
 * @returns `rgba(r, g, b, a)` 字符串
 */
export function hexToRgba(hex: string, alpha = 1): string {
  const matched = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? '').trim())
  let r = 0
  let g = 0
  let b = 0
  if (matched) {
    const digits = matched[1].length === 3
      ? matched[1].split('').map((c) => c + c).join('')
      : matched[1]
    r = Number.parseInt(digits.slice(0, 2), 16)
    g = Number.parseInt(digits.slice(2, 4), 16)
    b = Number.parseInt(digits.slice(4, 6), 16)
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * 两个矩形是否重叠（**面积 > 0**；边贴边相切返回 false）。
 *
 * 分组成员判定即以此为准：节点矩形与分组矩形重叠即视为组内成员。
 *
 * @param a 矩形 A
 * @param b 矩形 B
 * @returns 重叠返回 true
 */
export function rectsOverlap(a: RectLike, b: RectLike): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * `outer` 是否完全包含 `inner`（可指定容差）。
 *
 * @param outer 外层矩形
 * @param inner 内层矩形
 * @param tolerance 容差（流坐标像素；默认 0 表示严格包含）
 * @returns 完全包含返回 true
 */
export function rectContains(outer: RectLike, inner: RectLike, tolerance = 0): boolean {
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance
}

/**
 * 与分组矩形重叠的节点列表（分组成员，顺序与入参一致）。
 *
 * @param group 分组矩形
 * @param nodes 候选节点列表（画布真实节点）
 * @returns 组内节点列表
 */
export function nodesInGroup(group: RectLike, nodes: CanvasNodeData[]): CanvasNodeData[] {
  return nodes.filter((n) => rectsOverlap(group, n))
}

/**
 * 该节点所属的全部分组（一个节点可同时属于多个重叠分组）。
 *
 * @param groups 分组列表
 * @param node 节点（矩形）
 * @returns 命中的分组列表
 */
export function groupsOfNode(groups: CanvasGroupData[], node: RectLike): CanvasGroupData[] {
  return groups.filter((g) => rectsOverlap(g, node))
}

/**
 * 计算拖动某个分组时的「跟随集」（规则 R2）：
 * 1. 从被拖分组出发，递归收集**被当前集合中任一矩形完全包含**的其他分组
 *    （嵌套的子分组整体跟随，避免出现「被掏空的空框」）；收敛到不再增长为止；
 * 2. 再收集**与集合中任一矩形重叠**的节点（去重，保证每个节点只平移一次）。
 *
 * 可证明性质：若 B ⊆ A，则 B 的任意成员节点必与 A 重叠 ⇒ B 的节点必在 A 的跟随集内，
 * 故嵌套结构在拖动中保持完整。拖动内层分组时，外层分组不满足「被内层完全包含」，不会跟随。
 *
 * @param groups 全部分组
 * @param nodes 全部节点
 * @param rootGroupId 被拖动的分组 id
 * @returns 跟随平移的分组 id 列表（含 rootGroupId 自身）与节点 id 列表（已去重）；
 *   rootGroupId 不存在时两者均为空数组
 */
export function collectDragFollowSet(
  groups: CanvasGroupData[],
  nodes: CanvasNodeData[],
  rootGroupId: string,
): { groupIds: string[]; nodeIds: string[] } {
  const root = groups.find((g) => g.id === rootGroupId)
  if (!root) return { groupIds: [], nodeIds: [] }

  const collected = new Map<string, CanvasGroupData>([[root.id, root]])
  let grew = true
  while (grew) {
    grew = false
    for (const g of groups) {
      if (collected.has(g.id)) continue
      for (const outer of collected.values()) {
        if (rectContains(outer, g)) {
          collected.set(g.id, g)
          grew = true
          break
        }
      }
    }
  }

  const nodeIds = new Set<string>()
  for (const n of nodes) {
    for (const g of collected.values()) {
      if (rectsOverlap(g, n)) {
        nodeIds.add(n.id)
        break
      }
    }
  }

  return { groupIds: [...collected.keys()], nodeIds: [...nodeIds] }
}

/**
 * 计算一组矩形的包围盒（含四周留白）。
 *
 * 多选包围盒用：选中节点矩形 ∪ 选中分组矩形（FR-7.4：虚线框必须把选中分组框也包住）。
 *
 * @param rects 矩形列表（节点与分组混合，只取几何字段）
 * @param padding 四周留白（流坐标像素；多选虚线框用 GROUP_FRAME_PADDING = 12）
 * @returns 包围盒；列表为空返回 null
 */
export function boundingRect(rects: RectLike[], padding = 0): RectLike | null {
  if (rects.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }
  return {
    x: Math.round(minX - padding),
    y: Math.round(minY - padding),
    width: Math.round(maxX - minX + padding * 2),
    height: Math.round(maxY - minY + padding * 2),
  }
}

/**
 * 由节点列表计算创建分组时的初始矩形（节点包围盒 + 四周留白 + 顶部额外留白）。
 * 结果不小于 GROUP_MIN_SIZE；未达最小尺寸时以包围盒中心为基准对称扩张。
 *
 * 顶部留白 = `padding + topInset`（`topInset` 用于容纳分组标题条，传 `GROUP_HEADER_HEIGHT`），
 * 左右/下留白 = `padding`。对称扩张只会让矩形上边缘继续上移，
 * 故**顶部间距恒 ≥ padding + topInset**（小节点场景间距只会更大，不会被扩张吃掉）。
 *
 * @param nodes 选中的节点列表（至少一个）
 * @param padding 左/右/下留白（流坐标像素；创建分组用 GROUP_FRAME_PADDING = 12）
 * @param topInset 顶部额外留白（流坐标像素；创建分组用 GROUP_HEADER_HEIGHT = 28，缺省 0）
 * @returns 初始矩形；节点为空返回 null
 */
export function groupRectFromNodes(nodes: CanvasNodeData[], padding = 0, topInset = 0): RectLike | null {
  if (nodes.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  }
  const rawX = Math.round(minX - padding)
  const rawY = Math.round(minY - padding - topInset)
  const rawWidth = Math.round(maxX - minX + padding * 2)
  const rawHeight = Math.round(maxY - minY + padding * 2 + topInset)
  const width = Math.max(GROUP_MIN_SIZE.width, rawWidth)
  const height = Math.max(GROUP_MIN_SIZE.height, rawHeight)
  return {
    x: rawX - Math.floor((width - rawWidth) / 2),
    y: rawY - Math.floor((height - rawHeight) / 2),
    width,
    height,
  }
}

/**
 * 生成不重复的默认分组标题（`分组 N`，N 为最小未占用编号）。
 * 只识别形如 `分组 3` / `分组3` 的既有标题；其他自定义标题不占用编号。
 *
 * @param groups 现有分组列表
 * @returns 默认标题（如 `分组 1`）
 */
export function defaultGroupName(groups: CanvasGroupData[]): string {
  const used = new Set<number>()
  for (const g of groups) {
    const matched = /^分组\s*(\d+)$/.exec((g.name ?? '').trim())
    if (matched) used.add(Number.parseInt(matched[1], 10))
  }
  let n = 1
  while (used.has(n)) n += 1
  return `${GROUP_NAME_PREFIX} ${n}`
}

/**
 * 校验并还原持久分组数据（最小结构校验：防止损坏/伪造的 canvas.json 分组项进入渲染）。
 *
 * @param value 反序列化值
 * @returns 分组数据；结构非法返回 null
 */
export function asCanvasGroupData(value: unknown): CanvasGroupData | null {
  if (typeof value !== 'object' || value === null) return null
  const g = value as Partial<CanvasGroupData>
  if (typeof g.id !== 'string' || g.id === '') return null
  if (typeof g.name !== 'string' || typeof g.color !== 'string') return null
  if (typeof g.x !== 'number' || typeof g.y !== 'number') return null
  if (typeof g.width !== 'number' || typeof g.height !== 'number') return null
  if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) return null
  if (!Number.isFinite(g.width) || !Number.isFinite(g.height)) return null
  return {
    id: g.id,
    name: g.name,
    color: g.color,
    x: g.x,
    y: g.y,
    width: g.width,
    height: g.height,
  }
}
