/**
 * 画布组合式共享类型：store/generation 公开 API 类型与注入参数约定。
 *
 * 设计约定（见 docs/asset-canvas.md）：
 * - 只有 AssetCanvas 调用 useVueFlow()（工具栏/面板/菜单是其兄弟节点，不能依赖 inject），
 *   Vue Flow 工具以函数参数注入各组合式，保证单实例安全且便于测试；
 * - store/gen 实例同样以参数注入，组合式不自行创建单例。
 */

import type { ComputedRef, Ref } from 'vue'
import type { GraphNode } from '@vue-flow/core'
import type { useCanvasStore } from '../../../canvas/useCanvasStore'
import type { useCanvasGeneration } from '../../../canvas/useCanvasGeneration'
import type { CanvasNodeData } from '../../../canvas/types'

/** 画布 store 公开 API 类型（useCanvasStore 返回值） */
export type CanvasStoreApi = ReturnType<typeof useCanvasStore>

/** 画布生成组合式公开 API 类型（useCanvasGeneration 返回值） */
export type CanvasGenerationApi = ReturnType<typeof useCanvasGeneration>

/** 节点 id → 节点数据索引（各组合式共享，由 AssetCanvas 创建并注入） */
export type NodeMap = ComputedRef<Record<string, CanvasNodeData>>

/** 操作反馈提示函数（snackbar 状态由 AssetCanvas 持有） */
export type ShowSnackbar = (text: string, color?: 'success' | 'error' | 'primary') => void

/** Vue Flow 屏幕坐标 → 流坐标换算函数 */
export type ScreenToFlow = (pos: { x: number; y: number }) => { x: number; y: number }

/** Vue Flow 按 id 查询内部节点（findNode 结构签名） */
export type FindNode = (id: string) => GraphNode | undefined

/** Vue Flow 程序化写入选中态（addSelectedNodes 结构签名） */
export type AddSelectedNodes = (nodes: GraphNode[]) => void

/** 可读写的字符串 ref（跨组合式共享状态时用） */
export type WritableStringRef = Ref<string>
