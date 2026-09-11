/**
 * 粘贴落点计算与载荷实例化（纯逻辑，无 Vue / 浏览器依赖，便于单元测试）。
 *
 * ## 为什么需要「零重叠 + 净距」落点
 *
 * 持久分组**没有成员列表**：成员关系由几何实时派生 —— 节点矩形与分组矩形
 * 重叠面积 > 0（`groups.ts: rectsOverlap`）即为组内成员，拖动分组时的跟随集
 * （`groups.ts: collectDragFollowSet`）同样按该几何规则推导。
 *
 * 因此「复制分组 + 组内节点后粘贴」若沿用固定小偏移（历史实现为 30px），
 * 副本分组矩形必然仍压住原节点，立刻产生三类故障：
 * 1. 拖副本分组 → 原节点被当作「与副本重叠的成员」一起被拖走；
 * 2. 拖原分组 → 副本节点同样被带走（两个分组互相抓对方节点）；
 * 3. 副本节点与原节点几乎重合，肉眼与操作上都「分不开」。
 *
 * 故本模块把落点规则收敛为一条**硬约束**：
 * **副本包围盒（节点 ∪ 分组）必须与画布上已有的任何节点 / 分组矩形零重叠，且留有
 * 不小于 `PASTE_CLEARANCE` 的净距**（不允许贴边紧邻：贴边后轻推十几像素即变重叠）。
 * 首选落点为「原内容右下方向外错开一个身位 + `PASTE_CASCADE_GAP`」，被已有内容占据时
 * 沿 +x 逐级探测（再换下方泳道），最终兜底把副本放到全部阻挡内容的右侧 —— 绝不退回重叠位置。
 */

import { boundingRect, rectsOverlap, type RectLike } from './groups'
import { remapNodeConfig } from './groupSelection'
import type { NodeClipboardPayload } from './nodeClipboard'
import { newId, type CanvasConnection, type CanvasGroupData, type NodeConfig } from './types'

/** 首选落点与源内容之间的间隙（流坐标像素；= 原内容包围盒尺寸 + 该值） */
export const PASTE_CASCADE_GAP = 30

/**
 * 落点与画布已有内容之间要求的最小净距（流坐标像素）。
 *
 * 比「零重叠」更严一档：若副本允许**贴边紧邻**（边贴边不算重叠），用户随后把任一方
 * 轻推十几像素就会立刻变成重叠，重新触发「互相抓走节点」的老问题。故碰撞判定按
 * `PASTE_CLEARANCE` 外扩占用矩形后再判交叠（首选落点自带 `PASTE_CASCADE_GAP` ≥ 该值，
 * 天然满足；探测步长 `PASTE_PROBE_STEP` 与之相等，恰好一步即可补齐净距）。
 */
export const PASTE_CLEARANCE = 30

/** 碰撞探测的单步位移（流坐标像素） */
export const PASTE_PROBE_STEP = 30

/** 单条泳道内的最大探测步数（即最远向右探测 PASTE_PROBE_STEP × 该值 像素） */
export const PASTE_PROBE_LIMIT = 60

/** 最大探测泳道数（每条泳道在 y 方向下移「源内容包围盒高度 + 间隙」） */
export const PASTE_PROBE_LANES = 8

/** 粘贴落点计算结果 */
export interface PastePlacement {
  /** 相对源内容坐标的平移量（整数流坐标像素） */
  offset: { x: number; y: number }
  /** 最终落点是否被探测挪动过（false = 直接采用首选错位落点） */
  cascaded: boolean
}

/** 粘贴载荷实例化结果 */
export interface InstantiatedClipboard {
  /** 换新 id、按落点平移后的载荷（可直接 push 进画布数据） */
  payload: NodeClipboardPayload
  /** 旧节点 id → 新节点 id 映射（调用方按需做后续联动） */
  idMap: Map<string, string>
}

/**
 * 深拷贝画布片段（纯 JSON 数据，无函数字段）。
 *
 * @param value 任意 JSON 值
 * @returns 深拷贝结果
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 计算粘贴内容的包围盒（节点 ∪ 分组）。
 *
 * 分组矩形必须计入：分组是成员派生的判定主体，也是落点碰撞的主要风险来源。
 *
 * @param payload 粘贴载荷
 * @returns 包围盒（流坐标）；内容为空返回 null
 */
export function clipboardBounds(payload: NodeClipboardPayload): RectLike | null {
  return boundingRect([...payload.nodes, ...payload.groups])
}

/**
 * 判断「把源内容按给定偏移平移后」其包围盒是否与占用矩形列表冲突。
 *
 * 判定口径比「重叠」严一档：按 `PASTE_CLEARANCE` 外扩占用矩形后判交叠，
 * 保证落点与已有内容之间留有可推动的净距（见 `PASTE_CLEARANCE` 注释）。
 *
 * @param bounds 源内容包围盒
 * @param entries 占用矩形列表（画布已有节点与分组）
 * @param offset 候选平移量
 * @returns 存在重叠或净距不足返回 true
 */
function collidesAt(bounds: RectLike, entries: readonly RectLike[], offset: { x: number; y: number }): boolean {
  const target: RectLike = {
    x: bounds.x + offset.x - PASTE_CLEARANCE,
    y: bounds.y + offset.y - PASTE_CLEARANCE,
    width: bounds.width + PASTE_CLEARANCE * 2,
    height: bounds.height + PASTE_CLEARANCE * 2,
  }
  return entries.some((entry) => rectsOverlap(target, entry))
}

/** 候选落点（局部接口，仅本模块使用） */
interface PasteCandidate {
  /** 相对源内容坐标的平移量 */
  offset: { x: number; y: number }
  /** 是否属于「被探测挪动」而非首选错位落点 */
  cascaded: boolean
}

/**
 * 计算粘贴落点（**保证副本包围盒与画布已有内容零重叠且留有不小于 `PASTE_CLEARANCE` 的净距**）。
 *
 * 候选顺序：
 * 1. **首选错位**：`(宽 + 间隙, 高 + 间隙)` —— 副本落在原内容右下方一个身位，
 *    保留副本与原内容的相对空间关系（分组相对位置完全不变）；
 * 2. **向右探测**：沿 +x 以 `PASTE_PROBE_STEP` 逐级右移（每条泳道最多 `PASTE_PROBE_LIMIT` 步），
 *    用于首选落点被画布上其他内容占据、但右侧存在空隙的场景；
 * 3. **换泳道**：仍未命中时向下换 `PASTE_PROBE_LANES` 条泳道重复向右探测
 *    （每条泳道 y 下移「源内容高度 + 间隙」，保证不同泳道之间不会互相重叠）；
 * 4. **兜底**：把副本整体放到「与首选落点相交的全部阻挡内容」并集的右侧 + 净距 + 间隙
 *    （y 取首选值），保证函数一定返回一个满足净距要求的落点（永不退回重叠位置）。
 *
 * 注 1：源内容本身（被复制的原件）永远占据其原始矩形，故它总是参与碰撞判定 ——
 * 这是「副本不与原件重叠」这一核心保证的来源。
 * 注 2：判定带 `PASTE_CLEARANCE` 净距，故副本与已有内容不会「贴边紧邻」
 * （贴边后轻推十几像素即变重叠，等于把老问题推迟一次操作）。
 *
 * @param payload 粘贴载荷（节点列表 + 组内连线 + 分组列表）
 * @param occupied 画布当前占用矩形（已有节点与分组；见 `CanvasNodeData` / `CanvasGroupData` 均满足 `RectLike`）
 * @returns 落点（无内容可粘贴时返回零偏移且 `cascaded=false`）
 */
export function clipboardPlacementOffset(
  payload: NodeClipboardPayload,
  occupied: { nodes?: readonly RectLike[]; groups?: readonly RectLike[] },
): PastePlacement {
  const bounds = clipboardBounds(payload)
  if (!bounds) return { offset: { x: 0, y: 0 }, cascaded: false }

  const entries: RectLike[] = [...(occupied.nodes ?? []), ...(occupied.groups ?? [])]
  const gap = PASTE_CASCADE_GAP
  const primary: PasteCandidate = {
    offset: { x: Math.round(bounds.width) + gap, y: Math.round(bounds.height) + gap },
    cascaded: false,
  }
  const candidates: PasteCandidate[] = [primary]
  const laneStep = Math.round(bounds.height) + gap
  for (let lane = 0; lane < PASTE_PROBE_LANES; lane += 1) {
    for (let step = 0; step < PASTE_PROBE_LIMIT; step += 1) {
      candidates.push({
        offset: {
          x: primary.offset.x + (step + 1) * PASTE_PROBE_STEP,
          y: primary.offset.y + lane * laneStep,
        },
        cascaded: true,
      })
    }
  }
  for (const candidate of candidates) {
    if (!collidesAt(bounds, entries, candidate.offset)) return candidate
  }

  // 兜底：把副本整体放到「阻挡首选落点的全部内容」右侧，并额外留出净距 —— 与这些内容
  // 必然满足净距要求，且首选落点未被任何内容阻挡时阻挡集为空（此时候选列表早已命中，
  // 不会走到这里）。
  const target: RectLike = {
    x: bounds.x + primary.offset.x,
    y: bounds.y + primary.offset.y,
    width: bounds.width,
    height: bounds.height,
  }
  const blockers = entries.filter((entry) => rectsOverlap(target, entry))
  const rightEdge = blockers.reduce(
    (max, entry) => Math.max(max, entry.x + entry.width + PASTE_CLEARANCE),
    target.x,
  )
  return { offset: { x: Math.round(rightEdge - bounds.x) + gap, y: primary.offset.y }, cascaded: true }
}

/**
 * 实例化粘贴载荷：深拷贝 + 节点/连线/分组全部换新 id + 按落点平移 + 节点配置引用重映射。
 *
 * 与 `blueprint.ts: instantiateBlueprint` 的分工：本函数用于「复制粘贴」（偏移量由
 * `clipboardPlacementOffset` 决定），蓝图插入则按插入锚点归一化坐标（另有独立入口）。
 *
 * 处理内容：
 * 1. 节点：新 id、`x/y` 平移（取整）、`config` 内节点引用重映射（`inputOrder`、
 *    导演台素材块 `sourceNodeId`，见 `groupSelection.ts: remapNodeConfig`）；
 * 2. 连线：新 id，两端节点 id 映射到新节点（映射缺失时沿用原 id，保持结构可诊断）；
 * 3. 分组：新 id、`x/y` 平移（取整），成员关系仍由几何重叠自然成立。
 *
 * @param payload 粘贴载荷（坐标按平移取整写回，调用方传入的载荷本身不被修改）
 * @param offset 平移量（流坐标像素，来自 `clipboardPlacementOffset`）
 * @returns 实例化后的载荷与旧→新节点 id 映射
 */
export function instantiateClipboard(
  payload: NodeClipboardPayload,
  offset: { x: number; y: number },
): InstantiatedClipboard {
  const dx = Math.round(offset.x)
  const dy = Math.round(offset.y)
  const idMap = new Map<string, string>()
  for (const n of payload.nodes) idMap.set(n.id, newId())

  const nodes = payload.nodes.map((n) => {
    const copy = clone(n)
    copy.id = idMap.get(n.id) ?? copy.id
    copy.x = Math.round(n.x + dx)
    copy.y = Math.round(n.y + dy)
    copy.config = remapNodeConfig(clone(n.config) as NodeConfig, idMap)
    return copy
  })

  const connections: CanvasConnection[] = payload.connections.map((c) => ({
    id: newId(),
    fromNodeId: idMap.get(c.fromNodeId) ?? c.fromNodeId,
    fromPortId: c.fromPortId,
    toNodeId: idMap.get(c.toNodeId) ?? c.toNodeId,
    toPortId: c.toPortId,
  }))

  const groups: CanvasGroupData[] = payload.groups.map((g) => ({
    ...g,
    id: newId(),
    x: Math.round(g.x + dx),
    y: Math.round(g.y + dy),
  }))

  return { payload: { nodes, connections, groups }, idMap }
}
