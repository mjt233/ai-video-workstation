/**
 * 连线流向箭头动画参数计算。
 *
 * 背景：箭头以 `offset-path: path(<连线 d>)` + `offset-distance: 0% → 100%` 驱动，
 * 而 `offset-distance` 是**弧长百分比**——若动画时长写死（如 1.4s），线速度就等于
 * `弧长 / 时长`，随连线长度线性增长，长连线箭头会快到肉眼无法分辨。
 *
 * 本模块把「固定时长」换算为「固定线速度 + 固定箭头密度」：
 * 1. 由连线贝塞尔几何解析真实弧长（流坐标 px）；
 * 2. 时长 = 弧长 / 线速度（并设下限，避免极短连线高频闪动）；
 * 3. 箭头数量按目标间距推导（并设上限），沿路径**等距**分布（相邻箭头动画延迟差 =
 *    时长 / 数量，负延迟实现预分布）——长连线靠"多箭头"而非"加速"解决稀疏感。
 *
 * 纯逻辑、无 Vue/DOM 依赖，可直接单元测试（见 edgeFlow.test.ts）。
 */

/** 箭头线速度（流坐标 px/s）：整体快慢的唯一旋钮，调大则所有连线同步变快 */
export const EDGE_FLOW_SPEED = 110

/** 目标箭头间距（流坐标 px）：决定箭头视觉密度，调小则箭头更密 */
export const EDGE_FLOW_ARROW_SPACING = 220

/** 单条连线的箭头数量上限（DOM 节点与动画开销上限；超长连线靠拉大间距而非继续加箭头） */
export const EDGE_FLOW_MAX_ARROWS = 6

/** 极短连线的最短动画时长（秒）：避免箭头以高频闪烁方式掠过 */
export const EDGE_FLOW_MIN_DURATION = 0.8

/**
 * 弧长相对变化超过该比例才重新计时。
 * 拖动/缩放节点时连线几何每帧变化，而浏览器按 `进度 = 已过时间 / 时长` 重算位置，
 * 每帧改时长会让箭头瞬间跳位；阈值内复用旧时长，箭头沿变化中的路径平滑跟随。
 */
export const EDGE_FLOW_RETIME_RATIO = 0.15

/** 弧长折线逼近的采样段数（24 段误差 < 0.1%，远优于动画计时所需精度） */
const ARC_SAMPLES = 24

/** 时序缓存条目上限（超出按插入序淘汰，避免画布长期运行后 Map 无限增长） */
const CACHE_LIMIT = 200

/** 平面坐标点（流坐标 px） */
export interface Point {
  /** x 坐标（流坐标 px） */
  x: number
  /** y 坐标（流坐标 px） */
  y: number
}

/** 单段三次贝塞尔曲线（起点 p0 → 控制点 c1 → 控制点 c2 → 终点 p3） */
export interface CubicCurve {
  /** 曲线起点（连线 source 端） */
  p0: Point
  /** 第一控制点（贴近起点） */
  c1: Point
  /** 第二控制点（贴近终点） */
  c2: Point
  /** 曲线终点（连线 target 端） */
  p3: Point
}

/** 连线流向箭头动画参数（与连线长度解耦的观感参数） */
export interface EdgeFlowParams {
  /** 连线弧长（流坐标 px），用于调试与测试断言 */
  length: number
  /** 一次走完全程的动画时长（秒），写入元素内联 animation-duration */
  duration: number
  /** 沿路径等距渲染的箭头数量，供模板 v-for 使用 */
  count: number
  /** 相邻箭头的动画延迟差（秒，取负值作 animation-delay 实现等距预分布） */
  delayStep: number
}

/** 连线时序缓存（按连线 id 记忆上次参数，拖动期间抑制时长抖动） */
export interface EdgeFlowCache {
  /**
   * 取连线箭头动画参数。
   *
   * @param edgeId 连线 id（缓存键）
   * @param pathD 连线路径 d 串（与 BezierEdge 渲染所用完全一致）
   * @returns 动画参数（阈值内复用上次返回的同一对象引用）
   */
  get: (edgeId: string, pathD: string) => EdgeFlowParams
  /** 清空缓存（画布重建/切换分镜时调用，避免旧几何参数残留） */
  clear: () => void
  /** 当前缓存条目数（测试断言用） */
  readonly size: number
}

/** 数值提取正则：匹配整数、小数与科学计数法（连线 d 串中仅含坐标数值） */
const NUMBER_RE = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

/**
 * 从连线路径 d 串解析单段三次贝塞尔几何。
 *
 * Vue Flow 的 `getBezierPath` 恒返回 `M{x},{y} C{c1x},{c1y} {c2x},{c2y} {x},{y}`
 * （单段三次贝塞尔，共 8 个数值）；解析失败返回 null，调用方回退到弦长估算。
 *
 * @param pathD 连线路径 d 串
 * @returns 贝塞尔几何，或无法解析时为 null
 */
export function parseCubicPath(pathD: string): CubicCurve | null {
  const nums = pathD.match(NUMBER_RE)
  if (!nums || nums.length !== 8) return null
  const [p0x, p0y, c1x, c1y, c2x, c2y, p3x, p3y] = nums.map(Number)
  if ([p0x, p0y, c1x, c1y, c2x, c2y, p3x, p3y].some((n) => !Number.isFinite(n))) return null
  return {
    p0: { x: p0x, y: p0y },
    c1: { x: c1x, y: c1y },
    c2: { x: c2x, y: c2y },
    p3: { x: p3x, y: p3y },
  }
}

/**
 * 三次贝塞尔在参数 t 处的坐标（de Casteljau 展开式）。
 *
 * @param curve 贝塞尔几何
 * @param t 参数，取值 [0, 1]
 * @returns 曲线上的点
 */
export function cubicPointAt(curve: CubicCurve, t: number): Point {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * curve.p0.x + b * curve.c1.x + c * curve.c2.x + d * curve.p3.x,
    y: a * curve.p0.y + b * curve.c1.y + c * curve.c2.y + d * curve.p3.y,
  }
}

/**
 * 三次贝塞尔弧长（折线逼近：均匀采样 ARC_SAMPLES 段累加弦长）。
 *
 * @param curve 贝塞尔几何
 * @param samples 采样段数（默认 24，越大越精确）
 * @returns 弧长（流坐标 px）
 */
export function cubicLength(curve: CubicCurve, samples = ARC_SAMPLES): number {
  const steps = Math.max(Math.trunc(samples), 1)
  let total = 0
  let prev = curve.p0
  for (let i = 1; i <= steps; i++) {
    const next = i === steps ? curve.p3 : cubicPointAt(curve, i / steps)
    total += Math.hypot(next.x - prev.x, next.y - prev.y)
    prev = next
  }
  return total
}

/**
 * 路径 d 串的直线距离估算（无法解析为三次贝塞尔时的回退：首尾点距离）。
 *
 * @param pathD 连线路径 d 串
 * @returns 首尾点欧氏距离；数值不足时返回 0
 */
function chordLength(pathD: string): number {
  const nums = pathD.match(NUMBER_RE)?.map(Number)
  if (!nums || nums.length < 4) return 0
  const x1 = nums[0]
  const y1 = nums[1]
  const x2 = nums[nums.length - 2]
  const y2 = nums[nums.length - 1]
  if (![x1, y1, x2, y2].every((n) => Number.isFinite(n))) return 0
  return Math.hypot(x2 - x1, y2 - y1)
}

/**
 * 由弧长推导箭头动画参数（本模块的核心换算）。
 *
 * - 时长 = max(弧长 / 线速度, 下限)：极短连线不会高频闪烁；
 * - 数量 = clamp(round(弧长 / 目标间距), 1, 上限)：密度与长度解耦，超长连线不再堆箭头；
 * - 延迟差 = 时长 / 数量：N 个箭头沿路径等距分布，任意时刻都在均匀"流淌"。
 *
 * 由此得到的有效线速度 `弧长 / 时长` 对长度单调不减且恒 ≤ EDGE_FLOW_SPEED，
 * 即长连线永远不会比短连线快。
 *
 * @param length 连线弧长（流坐标 px）
 * @returns 箭头动画参数
 */
export function paramsForLength(length: number): EdgeFlowParams {
  const safe = Number.isFinite(length) && length > 0 ? length : 0
  const duration = Math.max(safe / EDGE_FLOW_SPEED, EDGE_FLOW_MIN_DURATION)
  const count = Math.min(Math.max(Math.round(safe / EDGE_FLOW_ARROW_SPACING), 1), EDGE_FLOW_MAX_ARROWS)
  return { length: safe, duration, count, delayStep: duration / count }
}

/**
 * 由连线路径 d 串推导箭头动画参数（解析弧长 → paramsForLength）。
 *
 * @param pathD 连线路径 d 串
 * @returns 箭头动画参数
 */
export function edgeFlowParams(pathD: string): EdgeFlowParams {
  const curve = parseCubicPath(pathD)
  return paramsForLength(curve ? cubicLength(curve) : chordLength(pathD))
}

/**
 * 创建连线时序缓存。
 *
 * 拖动/缩放节点时连线几何每帧变化：若每帧重算时长，浏览器按新时长重算 `offset-distance`
 * 进度，箭头会瞬间跳位。缓存按连线 id 记忆上次参数，弧长变化小于 EDGE_FLOW_RETIME_RATIO
 * （且箭头数量未跨档）时复用旧参数——箭头沿变化中的路径平滑跟随、速度不变；仅在布局
 * 实质变化时才重新计时。
 *
 * @param limit 缓存条目上限（超出按插入序淘汰最旧条目）
 * @returns 缓存实例
 */
export function createEdgeFlowCache(limit = CACHE_LIMIT): EdgeFlowCache {
  const cache = new Map<string, EdgeFlowParams>()
  return {
    get(edgeId: string, pathD: string): EdgeFlowParams {
      const next = edgeFlowParams(pathD)
      const prev = cache.get(edgeId)
      let result = next
      if (prev) {
        const ratio = prev.length > 0 ? Math.abs(next.length - prev.length) / prev.length : 1
        if (ratio < EDGE_FLOW_RETIME_RATIO && prev.count === next.count) result = prev
      }
      // 重插一次以维持 LRU 顺序（Map 保留插入序，淘汰时取首个键）
      cache.delete(edgeId)
      cache.set(edgeId, result)
      if (cache.size > limit) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      return result
    },
    clear(): void {
      cache.clear()
    },
    get size(): number {
      return cache.size
    },
  }
}
