import { describe, expect, it } from 'vitest'
import {
  PANEL_GAP,
  PANEL_HEADER_FALLBACK_HEIGHT,
  PANEL_SIDE_MIN_HEIGHT,
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
  it('空间充足时放在节点正下方并水平居中（保持既有视觉语言）', () => {
    const input = makeInput()
    const result = computePanelPlacement(input)
    expect(result.side).toBe('below')
    expect(result.width).toBe(440)
    // 下方空间充足（800 - 500 - 12 - 8 = 280 < 面板高度 300）→ 收窄到可用空间并内部滚动
    expect(result.maxHeight).toBe(280)
    expect(result.top).toBe(300 + 200 + PANEL_GAP)
    // 水平中心与节点中心（300 + 200）对齐
    expect(result.left + result.width / 2).toBe(500)
    expect(result.overlapsNode).toBe(false)
    expect(result.overlapsHeader).toBe(false)
  })

  it('下方放不下但上方放得下时翻转到节点上方', () => {
    // 节点贴视口底边：下方只剩 800 - (500 + 200) - 12 - 8 = 80px
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
    // 垂直居中于节点：200 + (500 - 300) / 2
    expect(result.top).toBe(300)
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

  it('左右贴靠宽度不低于最小宽度 320px', () => {
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
    // 上方可用 180px、下方可用 280px，两者都收窄；上方收窄后不与标题条重叠 → 选上方
    expect(result.side).toBe('above')
    expect(result.maxHeight).toBe(180)
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
    const base = makeInput()
    const below = computePanelPlacement(base)
    expect(below.side).toBe('below')
    const again = computePanelPlacement({ ...base, previousSide: 'below' })
    expect(again.side).toBe('below')
    // 上次方向失效（下方空间不足）时按优先级重新选择
    const moved = computePanelPlacement({
      ...base,
      nodeRect: { x: 300, y: 560, width: 400, height: 200 },
      previousSide: 'below',
    })
    expect(moved.side).toBe('above')
  })

  it('滞回让位于更优位置：上次方向不再可行时改向且不遮挡节点', () => {
    // 节点宽 440 且高 520：左右空白不足 320、上下高度不足 240 → 可行候选只有 below / above
    const base = makeInput({
      nodeRect: { x: 300, y: 100, width: 440, height: 520 },
      panelHeight: 300,
      maxHeight: 300,
      previousSide: 'below',
    })
    // 无其他节点：below 可行且与 above 同分 → 滞回保持 below
    expect(computePanelPlacement(base).side).toBe('below')
    // 下方出现其他节点后 below 仍可行（障碍物只影响同级排序），保持 below
    const withObstacle = computePanelPlacement({
      ...base,
      obstacles: [{ x: 300, y: 632, width: 440, height: 160 }],
    })
    expect(withObstacle.side).toBe('below')
    // 视口高度不足时 below 不再可行 → 改向 above，且不遮挡节点/标题条
    const constrained = computePanelPlacement({
      ...base,
      viewHeight: 420,
      previousSide: 'below',
    })
    expect(constrained.side).toBe('above')
    expect(constrained.overlapsNode).toBe(false)
    expect(constrained.overlapsHeader).toBe(false)
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

  it('左右贴靠的垂直收窄：高度上限随可用空间缩小', () => {
    const input = makeInput({
      nodeRect: { x: 300, y: 100, width: 280, height: 600 },
      viewHeight: 800,
      panelHeight: 520,
      maxHeight: 520,
    })
    const result = computePanelPlacement(input)
    expect(result.side).toBe('right')
    // 可用高度 = 800 - 8 - (100 - 12) = 704 > 520，高度上限保持 520
    expect(result.maxHeight).toBe(520)
    const tight = computePanelPlacement(makeInput({
      nodeRect: { x: 300, y: 300, width: 280, height: 400 },
      viewHeight: 800,
      panelHeight: 520,
      maxHeight: 520,
    }))
    expect(tight.side).toBe('right')
    // 可用高度 = 800 - 8 - (300 - 12) = 504 < 520 → 收窄（仍优于上下方向只留 80px/280px）
    expect(tight.maxHeight).toBe(504)
    expect(tight.maxHeight).toBeGreaterThanOrEqual(PANEL_SIDE_MIN_HEIGHT)
  })

  it('左右贴靠高度收窄后仍垂直居中且不越界', () => {
    const input = makeInput({
      nodeRect: { x: 300, y: 300, width: 280, height: 400 },
      viewHeight: 800,
      panelHeight: 520,
      maxHeight: 520,
    })
    const result = computePanelPlacement(input)
    const rect = toRect(result, result.maxHeight)
    expect(rect.y).toBeGreaterThanOrEqual(PANEL_VIEWPORT_MARGIN)
    expect(rect.y + rect.height).toBeLessThanOrEqual(input.viewHeight - PANEL_VIEWPORT_MARGIN)
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
