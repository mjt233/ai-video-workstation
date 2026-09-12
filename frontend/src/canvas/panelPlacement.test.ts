import { describe, expect, it } from 'vitest'
import {
  PANEL_GAP,
  PANEL_HEADER_FALLBACK_HEIGHT,
  PANEL_SIDE_MIN_WIDTH,
  PANEL_VIEWPORT_MARGIN,
  computePanelPlacement,
  type PanelPlacementInput,
  type PanelRect,
} from './panelPlacement'

/**
 * 构造面板定位输入（测试用默认值：1000×800 可视区、400×200 节点位于 300/300、
 * 设计宽度 440、实测高度 300、高度上限 520）。
 *
 * @param patch 覆盖字段
 * @returns 完整的定位输入
 */
function makeInput(patch: Partial<PanelPlacementInput> = {}): PanelPlacementInput {
  const base: PanelPlacementInput = {
    nodeRect: { x: 300, y: 300, width: 400, height: 200 },
    headerHeight: PANEL_HEADER_FALLBACK_HEIGHT,
    viewWidth: 1000,
    viewHeight: 800,
    designWidth: 440,
    panelHeight: 300,
    maxHeight: 520,
    zoom: 1,
    previousSide: null,
  }
  return { ...base, ...patch }
}

/**
 * 把定位结果还原成面板矩形（供重叠/裁切断言使用）。
 *
 * @param result 定位结果
 * @param height 面板实际高度（测试中显式给定）
 * @returns 面板屏幕矩形
 */
function toRect(result: { left: number; top: number; width: number }, height: number): PanelRect {
  return { x: result.left, y: result.top, width: result.width, height }
}

/**
 * 计算矩形重叠面积。
 *
 * @param a 矩形 A
 * @param b 矩形 B
 * @returns 重叠面积（像素²）
 */
function overlapArea(a: PanelRect, b: PanelRect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

describe('computePanelPlacement', () => {
  it('下方空间不足时优先贴靠左右侧（贴靠只换行、不压缩面板高度）', () => {
    // 下方只剩 280px < 面板 300px（需收窄）；右侧空白 292px 足够 → 贴靠右侧保持完整高度
    const input = makeInput()
    const result = computePanelPlacement(input)
    expect(result.side).toBe('right')
    expect(result.width).toBe(280)
    // 面板高度用满下方空间（顶边对齐节点顶边，不垂直居中）
    expect(result.maxHeight).toBe(492)
    expect(result.top).toBe(300)
    expect(result.overlapsNode).toBe(false)
  })

  it('下方放不下但上方放得下时翻转到节点上方', () => {
    // 节点贴视口底边：下方只剩 800 - (500 + 200) - 12 - 8 = 80px；上方可用 480px
    const input = makeInput({ nodeRect: { x: 300, y: 500, width: 400, height: 200 } })
    const result = computePanelPlacement(input)
    expect(result.side).toBe('above')
    expect(result.top).toBe(500 - PANEL_GAP - 300)
    expect(result.overlapsNode).toBe(false)
  })

  it('上下都放不下时贴靠到节点右侧并自适应收窄宽度', () => {
    // 节点占据 200~700 垂直空间：上下均不足 300px；右侧空白 420 - 12 - 8 = 400px
    const input = makeInput({
      nodeRect: { x: 300, y: 200, width: 280, height: 500 },
      panelHeight: 300,
    })
    const result = computePanelPlacement(input)
    expect(result.side).toBe('right')
    // 宽度取可用空白（400）而非设计宽度（440）
    expect(result.width).toBe(400)
    expect(result.width).toBeLessThan(input.designWidth)
    expect(result.left).toBe(300 + 280 + PANEL_GAP)
    // 顶边与节点顶边对齐（不与节点垂直居中），高度用满下方空间
    expect(result.top).toBe(200)
    expect(result.overlapsNode).toBe(false)
  })

  it('右侧空间不足最小宽度时改用左侧', () => {
    // 节点贴右边缘：右侧只剩 1000 - 820 - 12 - 8 = 160px < 320px
    const input = makeInput({
      nodeRect: { x: 600, y: 200, width: 220, height: 500 },
      panelHeight: 300,
    })
    const result = computePanelPlacement(input)
    expect(result.side).toBe('left')
    // 左侧空白 600 - 12 - 8 = 580px，取设计宽度 440
    expect(result.width).toBe(440)
    expect(result.left).toBe(600 - PANEL_GAP - 440)
    expect(result.overlapsNode).toBe(false)
  })

  it('左右贴靠宽度不低于最小宽度 280px', () => {
    // 节点位于 0，右侧空白 1000 - 300 - 12 - 8 = 680px（充足）；节点很高迫使贴靠
    const input = makeInput({
      nodeRect: { x: 0, y: 200, width: 300, height: 500 },
      panelHeight: 300,
    })
    const result = computePanelPlacement(input)
    expect(result.side).toBe('right')
    // 可用 680 > 设计宽度 440，仍按设计宽度渲染
    expect(result.width).toBe(440)
    // 反例：可用空白 340 时收窄到 340（≥320）
    const tight = computePanelPlacement(makeInput({
      nodeRect: { x: 0, y: 200, width: 640, height: 500 },
      panelHeight: 300,
    }))
    expect(tight.side).toBe('right')
    expect(tight.width).toBe(340)
  })

  it('左右垂直空间低于 240px 时不作为可行候选，但仍优于遮挡节点', () => {
    // 可视区高 200，节点占满整个高度：左右可用高度不足，上下也放不下
    const input = makeInput({
      nodeRect: { x: 0, y: 0, width: 200, height: 200 },
      viewWidth: 1000,
      viewHeight: 200,
      panelHeight: 180,
      maxHeight: 180,
    })
    const result = computePanelPlacement(input)
    // 左右贴靠高度被压到 180 < 240 → 不可行，但仍可能作为降级选项被选中；
    // 无论如何都不能覆盖节点标题条
    const rect = toRect(result, Math.min(input.panelHeight, result.maxHeight))
    const headerRect: PanelRect = { x: 0, y: 0, width: 200, height: PANEL_HEADER_FALLBACK_HEIGHT }
    expect(overlapArea(rect, headerRect)).toBe(0)
  })

  it('面板高于可视区（无任何可行候选）时优先保证标题条可见', () => {
    // 视口 500 高、面板 600 高：上下都放不下完整面板
    const input = makeInput({
      nodeRect: { x: 300, y: 200, width: 400, height: 200 },
      viewHeight: 500,
      panelHeight: 600,
      maxHeight: 600,
    })
    const result = computePanelPlacement(input)
    const rect = toRect(result, Math.min(input.panelHeight, result.maxHeight))
    const headerRect: PanelRect = {
      x: 300,
      y: 200,
      width: 400,
      height: PANEL_HEADER_FALLBACK_HEIGHT,
    }
    // 上方可用 180px、下方可用 280px、右侧可用 292px：右侧空间最大 → 选右侧（裁切最少）
    expect(result.side).toBe('right')
    expect(result.maxHeight).toBe(392)
    expect(overlapArea(rect, headerRect)).toBe(0)
  })

  it('同级择优：可行候选之间优先选择不压住其他节点的方向', () => {
    // 节点位于左上区域，下方与右侧空间都充足（面板高度 ≥ 240 保证左右贴靠可行）
    const base = makeInput({
      nodeRect: { x: 220, y: 60, width: 200, height: 120 },
      panelHeight: 260,
      maxHeight: 260,
    })
    // 无其他节点：默认放下方（优先级最高）
    expect(computePanelPlacement(base).side).toBe('below')
    // 下方被其他节点占据：改为右侧（同级排序里的障碍物优先项）
    const occupiedBelow = computePanelPlacement({
      ...base,
      obstacles: [{ x: 220, y: 200, width: 440, height: 300 }],
    })
    expect(occupiedBelow.side).toBe('right')
    expect(occupiedBelow.overlapsNode).toBe(false)
  })

  it('滞回：上次方向仍可行时保持不变', () => {
    // 面板 200px：下方 280px 足够 → 完整放下、无需收窄
    const base = makeInput({ panelHeight: 200, maxHeight: 200 })
    expect(computePanelPlacement(base).side).toBe('below')
    expect(computePanelPlacement({ ...base, previousSide: 'below' }).side).toBe('below')
    // 上次方向失效（下方空间不足、需收窄）时改向不收缩的方向
    const moved = computePanelPlacement({
      ...base,
      nodeRect: { x: 300, y: 560, width: 400, height: 200 },
      previousSide: 'below',
    })
    expect(moved.side).toBe('above')
    expect(moved.maxHeight).toBe(200)
  })

  it('滞回让位于更优位置：上次方向压住其他节点时改向且不遮挡节点', () => {
    // 节点宽 480：左侧空白 292px（可行）、右侧空白 220px（不足）
    // 面板 250px：下方可用 280px → below 完整放下；视口压缩后 below 才失效
    const base = makeInput({
      nodeRect: { x: 300, y: 300, width: 480, height: 200 },
      panelHeight: 250,
      maxHeight: 250,
      previousSide: 'below',
    })
    // 无其他节点：below 与 left 同为完整高度 → 方向优先级让 below 胜出（滞回保持）
    expect(computePanelPlacement(base).side).toBe('below')
    // 下方被其他节点占据：below 压住该节点 → 改向不压任何节点的上方
    const occupiedBelow = computePanelPlacement({
      ...base,
      obstacles: [{ x: 300, y: 520, width: 440, height: 80 }],
    })
    expect(occupiedBelow.side).toBe('above')
    expect(occupiedBelow.overlapsNode).toBe(false)
    // 视口压缩后 below 需收窄（< 最小高度）→ 改向 above，且不遮挡节点/标题条
    const constrained = computePanelPlacement({
      ...base,
      viewHeight: 620,
      previousSide: 'below',
    })
    expect(constrained.side).toBe('above')
    expect(constrained.overlapsNode).toBe(false)
    expect(constrained.overlapsHeader).toBe(false)
  })

  it('都只能收窄时优先可见高度更大者，而不是「不压住其他节点」的方向', () => {
    // 视口 1000×800；节点 700,200,100×100：下方可用 480、上方 180、右侧 180（不足最小宽度）、
    // 左侧可用高度 592 —— 四个方向都放不下 700px 高的面板，只能收窄
    const input = makeInput({
      nodeRect: { x: 700, y: 200, width: 100, height: 100 },
      viewWidth: 1000,
      viewHeight: 800,
      designWidth: 440,
      panelHeight: 700,
      maxHeight: 700,
      // 左侧位置被其他节点完全占据：排序若先比障碍物重叠，会退而求其次选更矮的下方位置
      // （可见高度 480 < 592），而这正是面板方向抖动的成因之一
      obstacles: [{ x: 200, y: 200, width: 440, height: 592 }],
    })
    const result = computePanelPlacement(input)
    expect(result.side).toBe('left')
    expect(result.maxHeight).toBe(592)
  })

  it('滞回稳定：把本次结果回传为 previousSide 后重复计算结果不变（不会来回跳位）', () => {
    const cases: PanelPlacementInput[] = [
      makeInput(),
      makeInput({ nodeRect: { x: 700, y: 200, width: 100, height: 100 }, panelHeight: 700, maxHeight: 700 }),
      makeInput({ nodeRect: { x: 300, y: 200, width: 280, height: 500 } }),
      makeInput({ nodeRect: { x: 300, y: 500, width: 400, height: 200 } }),
      makeInput({ viewHeight: 500, panelHeight: 600, maxHeight: 600 }),
    ]
    for (const input of cases) {
      const first = computePanelPlacement(input)
      const again = computePanelPlacement({ ...input, previousSide: first.side })
      expect(again.side).toBe(first.side)
      expect(again.left).toBeCloseTo(first.left, 5)
      expect(again.top).toBeCloseTo(first.top, 5)
      expect(again.width).toBeCloseTo(first.width, 5)
      expect(again.maxHeight).toBeCloseTo(first.maxHeight, 5)
    }
  })

  it('高度未测量时返回 unmeasured（组件先隐藏面板）', () => {
    const result = computePanelPlacement(makeInput({ panelHeight: 0 }))
    expect(result.unmeasured).toBe(true)
  })

  it('可视区尺寸为 0（画布 Tab 隐藏）时不钳制、退化为节点下方', () => {
    const result = computePanelPlacement(makeInput({ viewWidth: 0, viewHeight: 0 }))
    expect(result.side).toBe('below')
    expect(result.width).toBe(440)
    expect(result.top).toBe(300 + 200 + PANEL_GAP)
    expect(result.unmeasured).toBe(false)
  })

  it('面板宽于可视区时收窄到可视区宽度', () => {
    const input = makeInput({
      nodeRect: { x: 100, y: 100, width: 200, height: 100 },
      viewWidth: 360,
      viewHeight: 600,
      designWidth: 440,
      panelHeight: 200,
      maxHeight: 200,
    })
    const result = computePanelPlacement(input)
    expect(result.width).toBeLessThanOrEqual(360 - PANEL_VIEWPORT_MARGIN * 2)
    expect(result.left).toBeGreaterThanOrEqual(PANEL_VIEWPORT_MARGIN)
  })

  it('结果始终完整落在可视区内', () => {
    const cases: PanelPlacementInput[] = [
      makeInput(),
      makeInput({ nodeRect: { x: 0, y: 0, width: 200, height: 200 } }),
      makeInput({ nodeRect: { x: 800, y: 700, width: 200, height: 100 } }),
      makeInput({ nodeRect: { x: 300, y: 200, width: 280, height: 500 } }),
      makeInput({ panelHeight: 700, maxHeight: 700 }),
    ]
    for (const input of cases) {
      const result = computePanelPlacement(input)
      const rect = toRect(result, Math.min(input.panelHeight, result.maxHeight))
      expect(rect.x).toBeGreaterThanOrEqual(PANEL_VIEWPORT_MARGIN - 0.001)
      expect(rect.y).toBeGreaterThanOrEqual(PANEL_VIEWPORT_MARGIN - 0.001)
      expect(rect.x + rect.width).toBeLessThanOrEqual(input.viewWidth - PANEL_VIEWPORT_MARGIN + 0.001)
      expect(rect.y + rect.height).toBeLessThanOrEqual(input.viewHeight - PANEL_VIEWPORT_MARGIN + 0.001)
    }
  })

  it('左右贴靠不与节点垂直居中：顶边对齐节点顶边、高度用满下方空间', () => {
    // 节点靠上：下方空间充足 → 面板高度不被压缩
    const topAligned = computePanelPlacement(makeInput({
      nodeRect: { x: 300, y: 100, width: 280, height: 600 },
      viewHeight: 800,
      panelHeight: 520,
      maxHeight: 520,
    }))
    expect(topAligned.side).toBe('right')
    expect(topAligned.top).toBe(100)
    expect(topAligned.maxHeight).toBe(520)
    // 节点靠下：下方空间不足 → 底边对齐节点底边，用满上方空间
    const bottomAligned = computePanelPlacement(makeInput({
      nodeRect: { x: 300, y: 500, width: 280, height: 200 },
      viewHeight: 800,
      panelHeight: 520,
      maxHeight: 520,
    }))
    expect(bottomAligned.side).toBe('right')
    expect(bottomAligned.top).toBe(700 - 520)
    expect(bottomAligned.maxHeight).toBe(520)
  })

  it('左右贴靠高度不足时才收窄，且不越出可视区', () => {
    // 节点上下都贴边：上下可用高度都只有 300px 左右
    const tight = computePanelPlacement(makeInput({
      nodeRect: { x: 300, y: 250, width: 280, height: 300 },
      viewHeight: 800,
      panelHeight: 520,
      maxHeight: 520,
    }))
    expect(tight.side).toBe('right')
    // 顶边对齐节点顶边：可用高度 = 800 - 8 - 250 = 542 > 520 → 不收窄
    expect(tight.maxHeight).toBe(520)
    const rect = toRect(tight, Math.min(520, tight.maxHeight))
    expect(rect.y).toBeGreaterThanOrEqual(PANEL_VIEWPORT_MARGIN)
    expect(rect.y + rect.height).toBeLessThanOrEqual(800 - PANEL_VIEWPORT_MARGIN)
  })

  it('节点放大到占满视口时仍能找到不遮挡节点的位置', () => {
    const input = makeInput({
      nodeRect: { x: 100, y: 50, width: 440, height: 700 },
      viewWidth: 1000,
      viewHeight: 800,
      panelHeight: 400,
      maxHeight: 400,
    })
    const result = computePanelPlacement(input)
    expect(result.side).toBe('right')
    expect(result.width).toBeGreaterThanOrEqual(PANEL_SIDE_MIN_WIDTH)
    expect(result.overlapsNode).toBe(false)
    expect(result.overlapsHeader).toBe(false)
  })
})

describe('computePanelPlacement 宽度下限偏好（sideMinWidth）', () => {
  /** 节点右侧只剩 350px 空白（≥ 最小贴靠宽度 280，但低于期望下限 440） */
  const NARROW_RIGHT = { x: 300, y: 300, width: 330, height: 200 }

  it('上下方能按设计宽度放下时，不为了贴靠把宽度缩到下限以下', () => {
    // 下方可用 280px ≥ 面板 200px → 下方可行且宽度 = 设计宽度 560
    const input = makeInput({
      nodeRect: NARROW_RIGHT,
      designWidth: 560,
      sideMinWidth: 440,
      panelHeight: 200,
    })
    const result = computePanelPlacement(input)
    expect(result.side).toBe('below')
    expect(result.width).toBe(560)
  })

  it('宽度达标优先于「不压住其他节点」：宁可压住别的节点也要保住设计宽度', () => {
    // 节点很高（上下都放不下）且贴近右缘：右侧只剩 280px、左侧有 600px（可取设计宽度 560），
    // 但左侧候选会压住障碍物节点
    const input = makeInput({
      nodeRect: { x: 620, y: 200, width: 80, height: 500 },
      designWidth: 560,
      sideMinWidth: 440,
      panelHeight: 300,
      obstacles: [{ x: 100, y: 200, width: 400, height: 400 }],
    })
    const result = computePanelPlacement(input)
    expect(result.side).toBe('left')
    expect(result.width).toBe(560)
    // 不传下限时保持原行为：按「不压住其他节点」挑右侧的 280px 窄面板
    const legacy = computePanelPlacement({ ...input, sideMinWidth: undefined })
    expect(legacy.side).toBe('right')
    expect(legacy.width).toBe(PANEL_SIDE_MIN_WIDTH)
  })

  it('宽度下限不是可行性门槛：上下都放不下时，窄的贴靠候选照旧可用', () => {
    // 节点很高：下方只剩 80px、上方 180px（都需收窄）→ 只能贴靠左侧（280px < 下限 440）
    const input = makeInput({
      nodeRect: { x: 300, y: 200, width: 640, height: 500 },
      designWidth: 560,
      sideMinWidth: 440,
      panelHeight: 300,
    })
    const result = computePanelPlacement(input)
    expect(result.side).toBe('left')
    expect(result.width).toBe(PANEL_SIDE_MIN_WIDTH)
    expect(result.overlapsNode).toBe(false)
  })
})
