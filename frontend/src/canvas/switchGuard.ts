/**
 * 画布淘汰守卫（世代号）：把「画布切换」与「视口适应」两件事的世代号**分开**。
 *
 * 由 `AssetCanvas.applySwitch` 的 Loading 丢失缺陷提炼（见
 * `docs/plans/bug/2026-09-12-ai-text-node-loading-lost-on-canvas-switch.md`）：
 * 二者原本共用一个 `fitViewSeq`，而切换流程中途调用 `scheduleFitCanvas()`（视口任务）
 * 把这个共用的号自增了，于是切换收尾处的 `seq === fitViewSeq` 恒不成立，
 * **切回画布时的 AI 文本节点 Loading 恢复（`restoreLlmSessions`）从未执行**。
 *
 * 不变式（`switchGuard.test.ts` 锁死）：
 * - 视口任务的世代号推进（`beginFit` / `beginSwitch` 内部的视口对准）**不得**让切换守卫失效；
 * - 每类守卫各自只认自己最近一次分配的世代号，旧世代号永远判为过期（丢弃过期异步结果）。
 *
 * 两类守卫**不共用一个计数器池**（哪怕只是「同池不同槽」也不做）：本缺陷要避免的正是
 * 共用计数器带来的隐性耦合，因此刻意用相互独立的私有变量实现，语义一眼可辨。
 */

/** 画布淘汰守卫（世代号分配 + 时效判定） */
export interface SwitchGuard {
  /**
   * 分配一个新的画布切换世代号（每次 `applySwitch` 开始时调用）。
   *
   * @returns 本次切换的世代号（调用方持有它参与后续 `isCurrentSwitch` 判定）
   */
  beginSwitch(): number
  /**
   * 判定某个切换世代号是否仍是当前有效世代。
   *
   * @param seq 待判定的世代号（通常来自 `beginSwitch`）
   * @returns 仍是最近一次分配的世代号返回 true；已被新的切换顶替返回 false
   */
  isCurrentSwitch(seq: number): boolean
  /**
   * 分配一个新的视口适应世代号（每次 `scheduleFitCanvas` 调用）。
   *
   * @returns 本次视口任务的世代号（传给 `fitCanvasToNodes`）
   */
  beginFit(): number
  /**
   * 判定某个视口世代号是否仍是当前有效世代（过期请求丢弃）。
   *
   * @returns 仍是最近一次分配的世代号返回 true；已被新的视口请求顶替返回 false
   */
  isCurrentFit(seq: number): boolean
}

/**
 * 创建画布淘汰守卫。
 *
 * @returns 世代号分配与判定方法（切换 / 视口各自独立计数）
 */
export function createSwitchGuard(): SwitchGuard {
  /** 最近一次画布切换的世代号 */
  let switchGen = 0
  /** 最近一次视口适应请求的世代号 */
  let fitGen = 0
  return {
    beginSwitch: () => (switchGen += 1),
    isCurrentSwitch: (seq: number) => seq === switchGen,
    beginFit: () => (fitGen += 1),
    isCurrentFit: (seq: number) => seq === fitGen,
  }
}
