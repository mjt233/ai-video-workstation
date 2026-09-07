/**
 * 资产拖放入画布组合式：承接 AssetTree 拖到画布时的菜单状态与节点创建动作。
 *
 * - drop 到画布后 openAt：在释放位置弹出菜单（锚点坐标相对画布容器），异步构建媒体分组；
 * - selectItem：点击菜单条目创建节点（单层布局：图片/音频/视频各占一行，点条目名即添加）；
 * - 创建节点：按媒体类型选用加载图片/音频/视频原型，以释放点为中心摆放（减去默认尺寸一半），
 *   名称按 assetDrop 构建的 nodeName 写入（与创建同一次撤销）。
 */

import { reactive } from 'vue'
import {
  clearCanvasDragPayload,
  loadCanvasDropMenuGroups,
  type CanvasAssetDragPayload,
  type CanvasDropMenuItem,
  type CanvasDropMenuGroup,
} from '../../../canvas/assetDrop'
import { DEFAULT_NODE_SIZE } from '../../../canvas/useCanvasStore'
import { getPrototype } from '../../../canvas/registry'
import type { CanvasStoreApi, ShowSnackbar } from './types'

/** useCanvasAssetDrop 参数 */
export interface UseCanvasAssetDropOptions {
  /** 画布数据 store（创建加载节点） */
  store: CanvasStoreApi
  /** 项目名（资产列举与预览 URL 使用） */
  project: string
  /** 操作反馈提示（加载失败等） */
  showSnackbar: ShowSnackbar
}

/**
 * 资产拖放菜单组合式。
 *
 * @param options 依赖注入参数
 * @returns 菜单状态与操作 API
 */
export function useCanvasAssetDrop(options: UseCanvasAssetDropOptions) {
  const { store, project, showSnackbar } = options

  /** 菜单状态：show/x/y 为 VMenu 锚点（相对画布容器）；flowX/flowY 为新建节点放置的流坐标中心点 */
  const menu = reactive({
    show: false,
    x: 0,
    y: 0,
    flowX: 0,
    flowY: 0,
    /** 菜单标题（实体名） */
    title: '',
    /** 媒体分组列表（仅含可用资产的分组，单层布局按行展示） */
    groups: [] as CanvasDropMenuGroup[],
    /** 分组加载中 */
    loading: false,
    /** 每次打开递增：预览 URL 缓存破坏参数（与资产选择器 thumbUrl 惯例一致） */
    bust: 0,
  })

  /**
   * 打开资产拖放菜单：锚点定位到释放位置，异步构建媒体分组。
   * 菜单打开后清空旧分组；加载失败时降级为空分组（菜单显示空态）。
   *
   * @param event 触发打开的鼠标事件（提供菜单弹出位置，屏幕坐标）
   * @param payload 拖拽载荷
   * @param flowX 释放点在画布流坐标系中的 x（新建节点中心）
   * @param flowY 释放点在画布流坐标系中的 y（新建节点中心）
   * @param flowEl 画布容器 DOM（定位基准）
   */
  async function openAt(
    event: MouseEvent,
    payload: CanvasAssetDragPayload,
    flowX: number,
    flowY: number,
    flowEl: HTMLElement | null,
  ): Promise<void> {
    const rect = flowEl?.getBoundingClientRect()
    menu.x = Math.round(event.clientX - (rect?.left ?? 0))
    menu.y = Math.round(event.clientY - (rect?.top ?? 0))
    menu.flowX = Math.round(flowX)
    menu.flowY = Math.round(flowY)
    menu.title = payload.entityName
    menu.bust++
    menu.show = true
    menu.loading = true
    menu.groups = []
    try {
      menu.groups = await loadCanvasDropMenuGroups(project, payload)
    } catch (err) {
      // 已向用户提示并降级为空态；控制台输出日志便于排查
      console.error('[asset-drop] 加载资产列表失败：', err)
      showSnackbar('加载资产列表失败，请重试', 'error')
      menu.groups = []
    } finally {
      menu.loading = false
    }
  }

  /** 菜单显隐变化（模型值回写） */
  function setShow(show: boolean): void {
    menu.show = show
  }

  /**
   * 点击资产：在释放位置创建对应加载节点（以释放点为中心，单次撤销）。
   * 节点 config.assetPath 绑定资产路径，名称按资产规则设置。
   *
   * @param item 被点击的资产条目
   */
  function selectItem(item: CanvasDropMenuItem): void {
    const proto = getPrototype(item.prototypeId)
    const width = proto?.defaultSize?.width ?? DEFAULT_NODE_SIZE.width
    const height = proto?.defaultSize?.height ?? DEFAULT_NODE_SIZE.height
    store.addNode(
      item.prototypeId,
      Math.round(menu.flowX - width / 2),
      Math.round(menu.flowY - height / 2),
      { assetPath: item.path },
      { name: item.nodeName },
    )
    close()
  }

  /** 关闭菜单（分组保留供再次打开复用，重开时重新加载） */
  function close(): void {
    menu.show = false
  }

  /** 重置状态（切换画布目标时调用） */
  function reset(): void {
    close()
    menu.groups = []
    clearCanvasDragPayload()
  }

  return { menu, openAt, setShow, selectItem, close, reset }
}
