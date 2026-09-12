import { beforeEach, describe, expect, it } from 'vitest'
import { createSwitchGuard } from './switchGuard'

/**
 * 缺陷回归：`AssetCanvas.applySwitch` 与 `scheduleFitCanvas` 曾经**共用一个世代号**
 * （`fitViewSeq`）。切换流程中途会调用 `scheduleFitCanvas()` 把它自增，于是切换收尾处的
 * `seq === fitViewSeq` 恒不成立 → 切回画布时的 AI 文本节点 Loading 恢复（`restoreLlmSessions`）
 * 从未执行（只有刷新页面才恢复）。
 *
 * 缺陷记录：`docs/plans/bug/2026-09-12-ai-text-node-loading-lost-on-canvas-switch.md`。
 *
 * 下面用一个最小流程模型复刻 `applySwitch` 的调用顺序与异步交错：
 * 分配世代号 → 切生成目标 → 守卫① → 切 store → 守卫② → 恢复 ffmpeg/工作流（无守卫）
 * → `scheduleFitCanvas()`（分配**视口**世代号）→ await 产物刷新 → 收尾恢复（受守卫）。
 */
const restoreCalls = { withSharedCounter: 0, withGuard: 0 }

/**
 * 用「共用计数器」复刻历史缺陷实现：切换与视口共用同一个号。
 *
 * @returns 收尾恢复步骤是否执行
 */
function switchFlowWithSharedCounter(): boolean {
  let sharedSeq = 0
  const switchSeq = (sharedSeq += 1)
  if (switchSeq !== sharedSeq) return false
  if (switchSeq !== sharedSeq) return false
  // scheduleFitCanvas()：视口任务把共用的号推进了
  sharedSeq += 1
  if (switchSeq !== sharedSeq) return false
  restoreCalls.withSharedCounter += 1
  return true
}

/**
 * 用 `switchGuard` 复刻修复后的实现：切换与视口各自独立计数。
 *
 * @returns 收尾恢复步骤是否执行
 */
function switchFlowWithGuard(): boolean {
  const guard = createSwitchGuard()
  const switchSeq = guard.beginSwitch()
  if (!guard.isCurrentSwitch(switchSeq)) return false
  if (!guard.isCurrentSwitch(switchSeq)) return false
  // scheduleFitCanvas()：只推进视口世代号
  guard.beginFit()
  if (!guard.isCurrentSwitch(switchSeq)) return false
  restoreCalls.withGuard += 1
  return true
}

describe('切换 Loading 恢复回归（世代号职责分离）', () => {
  beforeEach(() => {
    restoreCalls.withSharedCounter = 0
    restoreCalls.withGuard = 0
  })

  it('共用计数器时切换收尾的恢复步骤永不执行（历史缺陷）', () => {
    expect(switchFlowWithSharedCounter()).toBe(false)
    expect(restoreCalls.withSharedCounter).toBe(0)
  })

  it('拆分世代号后切换收尾的恢复步骤正常执行（修复）', () => {
    expect(switchFlowWithGuard()).toBe(true)
    expect(restoreCalls.withGuard).toBe(1)
  })
})

describe('createSwitchGuard：两类世代号互不影响', () => {
  it('视口世代号推进不得使切换世代号失效', () => {
    const guard = createSwitchGuard()
    const switchSeq = guard.beginSwitch()
    guard.beginFit()
    guard.beginFit()
    expect(guard.isCurrentSwitch(switchSeq)).toBe(true)
  })

  it('切换世代号推进不得使视口世代号失效', () => {
    const guard = createSwitchGuard()
    const fitSeq = guard.beginFit()
    guard.beginSwitch()
    guard.beginSwitch()
    expect(guard.isCurrentFit(fitSeq)).toBe(true)
  })

  it('连续切换：只有最新世代号有效（过期异步结果丢弃）', () => {
    const guard = createSwitchGuard()
    const first = guard.beginSwitch()
    const second = guard.beginSwitch()
    expect(guard.isCurrentSwitch(first)).toBe(false)
    expect(guard.isCurrentSwitch(second)).toBe(true)
  })

  it('连续视口请求：只有最新世代号有效', () => {
    const guard = createSwitchGuard()
    const first = guard.beginFit()
    const second = guard.beginFit()
    expect(guard.isCurrentFit(first)).toBe(false)
    expect(guard.isCurrentFit(second)).toBe(true)
  })

  it('交替分配：两类世代号各自计数、互不串号', () => {
    const guard = createSwitchGuard()
    const s1 = guard.beginSwitch()
    const f1 = guard.beginFit()
    const s2 = guard.beginSwitch()
    const f2 = guard.beginFit()
    expect([s1, s2]).toEqual([1, 2])
    expect([f1, f2]).toEqual([1, 2])
    expect(guard.isCurrentSwitch(s1)).toBe(false)
    expect(guard.isCurrentSwitch(s2)).toBe(true)
    expect(guard.isCurrentFit(f1)).toBe(false)
    expect(guard.isCurrentFit(f2)).toBe(true)
  })

  it('世代号从 1 开始分配（0 是「尚未分配」的初始值）', () => {
    const guard = createSwitchGuard()
    expect(guard.beginSwitch()).toBe(1)
    expect(guard.beginFit()).toBe(1)
    // 已分配后，初始值 0 判为过期
    expect(guard.isCurrentSwitch(0)).toBe(false)
    expect(guard.isCurrentFit(0)).toBe(false)
  })
})
