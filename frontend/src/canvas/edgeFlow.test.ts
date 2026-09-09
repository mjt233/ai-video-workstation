import { describe, expect, it } from 'vitest'
import {
  EDGE_FLOW_ARROW_SPACING,
  EDGE_FLOW_MAX_ARROWS,
  EDGE_FLOW_MIN_DURATION,
  EDGE_FLOW_SPEED,
  createEdgeFlowCache,
  cubicLength,
  cubicPointAt,
  edgeFlowParams,
  paramsForLength,
  parseCubicPath,
} from './edgeFlow'

/** 构造一条长度恰为 length 的水平直线贝塞尔（控制点在两端，退化为直线） */
function straightPath(length: number): string {
  return `M0,0 C0,0 ${length},0 ${length},0`
}

describe('parseCubicPath', () => {
  it('解析 getBezierPath 产出的单段三次贝塞尔', () => {
    const curve = parseCubicPath('M0,0 C0,50 100,50 100,100')
    expect(curve).toEqual({
      p0: { x: 0, y: 0 },
      c1: { x: 0, y: 50 },
      c2: { x: 100, y: 50 },
      p3: { x: 100, y: 100 },
    })
  })

  it('支持负数、小数与紧凑写法', () => {
    const curve = parseCubicPath('M-10.5,0 C0,-50.25 100,50 100,-100')
    expect(curve).toEqual({
      p0: { x: -10.5, y: 0 },
      c1: { x: 0, y: -50.25 },
      c2: { x: 100, y: 50 },
      p3: { x: 100, y: -100 },
    })
  })

  it('数值个数不为 8 时返回 null（调用方回退弦长）', () => {
    expect(parseCubicPath('M0,0 L100,100')).toBeNull()
    expect(parseCubicPath('')).toBeNull()
  })
})

describe('cubicLength', () => {
  it('直线贝塞尔弧长等于端点距离', () => {
    const curve = parseCubicPath(straightPath(240))!
    expect(cubicLength(curve)).toBeCloseTo(240, 3)
  })

  it('曲线弧长与密集采样基准一致（误差 < 0.5%）', () => {
    const curve = parseCubicPath('M0,0 C0,200 300,-100 300,300')!
    const dense = cubicLength(curve, 2000)
    expect(Math.abs(cubicLength(curve) - dense) / dense).toBeLessThan(0.005)
  })

  it('cubicPointAt 端点即 p0 / p3', () => {
    const curve = parseCubicPath('M10,20 C0,0 100,100 200,20')!
    expect(cubicPointAt(curve, 0)).toEqual(curve.p0)
    expect(cubicPointAt(curve, 1)).toEqual(curve.p3)
  })
})

describe('paramsForLength', () => {
  it('短连线：单个箭头且时长不低于下限', () => {
    const p = paramsForLength(80)
    expect(p.count).toBe(1)
    expect(p.duration).toBe(EDGE_FLOW_MIN_DURATION)
    expect(p.delayStep).toBe(EDGE_FLOW_MIN_DURATION)
  })

  it('中等连线：时长 = 弧长 / 线速度，箭头按目标间距分档', () => {
    const p = paramsForLength(900)
    expect(p.duration).toBeCloseTo(900 / EDGE_FLOW_SPEED, 6)
    expect(p.count).toBe(Math.round(900 / EDGE_FLOW_ARROW_SPACING))
  })

  it('超长连线：箭头数量封顶，时长继续随弧长增长', () => {
    const p = paramsForLength(5000)
    expect(p.count).toBe(EDGE_FLOW_MAX_ARROWS)
    expect(p.duration).toBeCloseTo(5000 / EDGE_FLOW_SPEED, 6)
  })

  it('箭头沿路径等距：delayStep × 线速度 = 弧长 / 数量', () => {
    const p = paramsForLength(1500)
    expect(p.delayStep * EDGE_FLOW_SPEED).toBeCloseTo(p.length / p.count, 6)
  })

  it('有效线速度对长度单调不减且恒不超过设定速度（长线绝不比短线快）', () => {
    const lengths = [40, 88, 120, 400, 900, 1500, 3000, 8000]
    const speeds = lengths.map((l) => {
      const p = paramsForLength(l)
      return p.length / p.duration
    })
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]).toBeGreaterThanOrEqual(speeds[i - 1] - 1e-9)
    }
    for (const s of speeds) expect(s).toBeLessThanOrEqual(EDGE_FLOW_SPEED + 1e-9)
  })

  it('非法弧长（0/NaN/负数）回退为最小时长与单箭头', () => {
    for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = paramsForLength(bad)
      expect(p.length).toBe(0)
      expect(p.count).toBe(1)
      expect(p.duration).toBe(EDGE_FLOW_MIN_DURATION)
    }
  })
})

describe('edgeFlowParams', () => {
  it('由 d 串推导参数（等价于按解析出的弧长换算）', () => {
    const p = edgeFlowParams(straightPath(660))
    expect(p.length).toBeCloseTo(660, 3)
    expect(p.count).toBe(3)
    expect(p.duration).toBeCloseTo(660 / EDGE_FLOW_SPEED, 6)
  })

  it('无法解析为三次贝塞尔时回退到首尾点距离', () => {
    const p = edgeFlowParams('M0,0 L300,400')
    expect(p.length).toBeCloseTo(500, 6)
  })
})

describe('createEdgeFlowCache', () => {
  it('弧长小幅变化（阈值内）复用同一参数对象，避免动画跳位', () => {
    const cache = createEdgeFlowCache()
    const first = cache.get('e1', straightPath(1000))
    const second = cache.get('e1', straightPath(1100))
    expect(second).toBe(first)
  })

  it('弧长显著变化（超阈值）重新计时', () => {
    const cache = createEdgeFlowCache()
    const first = cache.get('e1', straightPath(1000))
    const second = cache.get('e1', straightPath(1400))
    expect(second).not.toBe(first)
    expect(second.length).toBeCloseTo(1400, 3)
  })

  it('箭头数量跨档即使弧长在阈值内也重新计时', () => {
    const cache = createEdgeFlowCache()
    // 500 → 数量 2；560 → 数量 3（弧长变化 12% < 15% 阈值）
    const first = cache.get('e1', straightPath(500))
    expect(first.count).toBe(2)
    const second = cache.get('e1', straightPath(560))
    expect(second.count).toBe(3)
    expect(second).not.toBe(first)
  })

  it('不同连线互不干扰', () => {
    const cache = createEdgeFlowCache()
    const a = cache.get('e1', straightPath(1000))
    const b = cache.get('e2', straightPath(2000))
    expect(a.length).toBeCloseTo(1000, 3)
    expect(b.length).toBeCloseTo(2000, 3)
  })

  it('超出上限按插入序淘汰最旧条目', () => {
    const cache = createEdgeFlowCache(2)
    const first = cache.get('e1', straightPath(1000))
    cache.get('e2', straightPath(1000))
    cache.get('e3', straightPath(1000))
    expect(cache.size).toBe(2)
    // e1 已被淘汰 → 再次获取为重新计算的**新对象**（命中缓存则应为同一引用）
    expect(cache.get('e1', straightPath(1000))).not.toBe(first)
  })

  it('clear 清空全部条目', () => {
    const cache = createEdgeFlowCache()
    cache.get('e1', straightPath(1000))
    cache.clear()
    expect(cache.size).toBe(0)
  })
})
