/**
 * 画布运行模式（provide / inject）。
 *
 * 同一套画布组件被两种场景复用：
 * - `mode='canvas'`：分镜/场景资产画布（默认；生成、上传产物、历史、自动搭画布等全部能力）；
 * - `mode='blueprint'`：蓝图编辑器（`AssetCanvas` 由 `BlueprintEditDialog` 内嵌渲染）。
 *
 * 蓝图模式下节点主体与编辑器组件需要隐藏/禁用「执行类动作」（生成、上传产物、历史、
 * 设为分镜场景图等），并据此调整资产类入口的可用性；这些组件分散在
 * `components/canvas/nodes/*` 与 `components/canvas/editors/*`，由本模块提供统一注入点，
 * 避免为每个组件新增 props。
 *
 * 约定：`AssetCanvas` 是唯一 provide 方；未注入时 `useCanvasMode()` 返回主画布默认值，
 * 因此现有组件在未接入时行为完全不变。
 */

import { inject, provide, type InjectionKey } from 'vue'

/** 画布模式 */
export type CanvasMode = 'canvas' | 'blueprint'

/** 画布模式上下文 */
export interface CanvasModeContext {
  /** 当前模式（'canvas' 主画布 / 'blueprint' 蓝图编辑器） */
  mode: CanvasMode
  /**
   * 资产项目是否就绪：
   * - 主画布恒为 true（项目由路由参数提供）；
   * - 蓝图模式要求蓝图已设置且存在的 `assetProject`，否则上传/选择资产入口置灰。
   */
  assetProjectReady: boolean
  /**
   * 资产项目名（蓝图模式的资产上下文；主画布为空串）。
   * 仅用于提示文案，实际预览/上传/选择用的 project 由 AssetCanvas 的 `project` prop 提供。
   */
  assetProject: string
}

/** 主画布默认上下文（未注入时的回退值） */
export const DEFAULT_CANVAS_MODE_CONTEXT: CanvasModeContext = {
  mode: 'canvas',
  assetProjectReady: true,
  assetProject: '',
}

/** 画布模式注入键 */
export const CANVAS_MODE_KEY: InjectionKey<CanvasModeContext> = Symbol('canvas-mode')

/**
 * 提供画布模式上下文（仅 AssetCanvas 调用）。
 *
 * @param context 模式上下文（可为 reactive 对象，字段变化会实时反映到注入方）
 */
export function provideCanvasMode(context: CanvasModeContext): void {
  provide(CANVAS_MODE_KEY, context)
}

/**
 * 读取画布模式上下文（节点主体 / 编辑器组件调用）。
 *
 * @returns 模式上下文；未注入时返回主画布默认值
 */
export function useCanvasMode(): CanvasModeContext {
  return inject(CANVAS_MODE_KEY, DEFAULT_CANVAS_MODE_CONTEXT)
}

/**
 * 是否处于蓝图模式（便捷判定）。
 *
 * @returns 蓝图模式返回 true
 */
export function useIsBlueprintMode(): boolean {
  return useCanvasMode().mode === 'blueprint'
}
