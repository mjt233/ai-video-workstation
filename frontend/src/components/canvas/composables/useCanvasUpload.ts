/**
 * 加载节点文件上传组合式：管理节点级上传进度状态（上传中/失败），
 * 进度遮罩由 CanvasNodeCard 按 stateOf(nodeId) 渲染，是加载节点上传的唯一入口。
 *
 * 上传请求统一经 client.uploadFs（axios onUploadProgress 提供浏览器上传进度）；
 * 切换画布/卸载时 reset() 统一中止进行中请求（AbortController）。
 * 上传进度经 reactive 代理写回（states[nodeId]），保证节点遮罩实时刷新；
 * 同一节点上传进行中时忽略新的上传请求（不中途 abort，避免 keep-alive 复用导致
 * multipart 流错位）；上传异常统一打印 console.error 日志。
 * 上传成功后经注入的 onSuccess 回调写回节点 assetPath（AssetCanvas 接线 update:config）。
 */

import { reactive } from 'vue'
import { uploadFs, uploadCanvasOutput } from '../../../api/client'
import { isCanvasNodeOutputPath } from '../../../canvas/paths'
import type { ShowSnackbar } from './types'

/** 节点上传状态（CanvasNodeCard 遮罩数据源；对象即存在，undefined = 无上传） */
export interface CanvasUploadState {
  /** 上传阶段：上传中 / 失败 */
  status: 'uploading' | 'error'
  /** 上传文件名（遮罩文案） */
  fileName: string
  /** 上传进度百分比（0-100；总大小未知为 null → 显示不确定进度条） */
  percent: number | null
  /** 已上传字节数 */
  loadedBytes: number
  /** 总字节数（未知为 null） */
  totalBytes: number | null
  /** 失败原因文案 */
  errorMsg?: string
  /** 重试所需的原文件 */
  file: File
  /** 重试所需的目标路径 */
  dest: string
}

/** 单个上传任务结果（粘贴汇总用） */
export type CanvasUploadResult = { ok: true; path: string } | { ok: false; error: string }

/**
 * 画布文件上传载荷（`upload-file` 事件与上传任务共用）。
 *
 * 加载节点/编辑器通过 `upload-file` 事件上抛此对象；
 * 粘贴批量上传（`uploadMany`）亦复用同一结构，避免多位置参数错位。
 */
export interface CanvasUploadFilePayload {
  /** 目标节点 id */
  nodeId: string
  /** 上传文件 */
  file: File
  /** 目标相对路径（须在 assert/ 下） */
  dest: string
}

/** 单个上传任务（粘贴场景：节点已先创建，上传进度显示在节点上） */
export type CanvasUploadTask = CanvasUploadFilePayload

/** useCanvasUpload 公开 API（注入 useCanvasPaste 等） */
export interface CanvasUploadApi {
  /**
   * 上传一个文件到指定节点：开始即置节点 uploading 状态（进度条遮罩），
   * 成功回调 onSuccess 写回 assetPath 并清除状态；失败置 error 状态（含重试数据）并提示。
   *
   * @param nodeId 目标节点 id
   * @param file 上传文件
   * @param dest 目标相对路径
   * @param opts 可选项（silent=true 时不弹 snackbar，供粘贴批量场景由调用方汇总提示）
   * @returns 上传结果
   */
  uploadForNode: (nodeId: string, file: File, dest: string, opts?: { silent?: boolean }) => Promise<CanvasUploadResult>
  /** 并行上传多个文件（粘贴场景），返回逐项结果（与入参顺序一致） */
  uploadMany: (tasks: CanvasUploadTask[], opts?: { silent?: boolean }) => Promise<CanvasUploadResult[]>
  /** 重试某节点上次失败的上传（沿用状态中保存的文件与路径） */
  retry: (nodeId: string) => void
  /** 查询节点上传状态（无上传返回 undefined → 不渲染遮罩） */
  stateOf: (nodeId: string) => CanvasUploadState | undefined
  /** 清除单节点上传状态并中止其进行中请求 */
  clearNode: (nodeId: string) => void
  /** 重置全部上传状态并中止进行中请求（切换画布/卸载时调用） */
  reset: () => void
}

/** useCanvasUpload 参数 */
export interface UseCanvasUploadOptions {
  /** 项目名（上传目标 assert 目录） */
  project: string
  /** 上传成功后回调（AssetCanvas 注入：写入节点 assetPath） */
  onSuccess: (nodeId: string, path: string) => void
  /** 操作反馈提示 */
  showSnackbar: ShowSnackbar
}

/** 失败遮罩自动消失时长（毫秒） */
const ERROR_AUTO_CLEAR_MS = 8000

/**
 * 把字节数格式化为人类可读文本（如 12.3 MB）。
 *
 * @param bytes 字节数
 * @returns 格式化文本
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1)
  const value = bytes / 2 ** (10 * i)
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

/**
 * 加载节点上传组合式。
 *
 * @param options 依赖注入参数
 * @returns 上传 API
 */
export function useCanvasUpload(options: UseCanvasUploadOptions): CanvasUploadApi {
  const { project, onSuccess, showSnackbar } = options

  /** 节点 id → 上传状态（响应式，模板直接渲染遮罩） */
  const states: Record<string, CanvasUploadState> = reactive({})

  /** 节点 id → AbortController（中止进行中请求） */
  const controllers = new Map<string, AbortController>()
  /** 节点 id → 失败遮罩自动清除定时器 */
  const errorTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /** 从 axios 异常中提取服务端错误文案 */
  function messageOf(err: unknown): string {
    const ax = err as { response?: { data?: { error?: string } } }
    return ax.response?.data?.error || (err instanceof Error ? err.message : '上传失败，请重试')
  }

  /** 节点 id → 上传状态（无上传返回 undefined） */
  function stateOf(nodeId: string): CanvasUploadState | undefined {
    return states[nodeId]
  }

  /** 清除单节点失败自动清除定时器 */
  function clearErrorTimer(nodeId: string): void {
    const timer = errorTimers.get(nodeId)
    if (timer) {
      clearTimeout(timer)
      errorTimers.delete(nodeId)
    }
  }

  /** 删除节点状态（同时清理定时器；AbortController 由上传流程自身管理，此处不动，避免误中止重试请求） */
  function deleteState(nodeId: string): void {
    clearErrorTimer(nodeId)
    delete states[nodeId]
  }

  /** 上传失败：置 error 状态（8s 后自动消失）、按需 snackbar 提示 */
  function fail(nodeId: string, file: File, dest: string, msg: string, silent: boolean): CanvasUploadResult {
    const prev = states[nodeId]
    states[nodeId] = {
      status: 'error',
      fileName: file.name,
      percent: null,
      loadedBytes: prev?.loadedBytes ?? 0,
      totalBytes: prev?.totalBytes ?? null,
      errorMsg: msg,
      file,
      dest,
    }
    clearErrorTimer(nodeId)
    errorTimers.set(
      nodeId,
      setTimeout(() => deleteState(nodeId), ERROR_AUTO_CLEAR_MS),
    )
    if (!silent) showSnackbar(msg, 'error')
    return { ok: false, error: msg }
  }

  /**
   * 按目标路径选择上传端点：
   * - 画布节点固定产物路径（output.jpg / output.mp4，生成图片/视频节点上传）→
   *   /api/canvas/upload（服务端先归档旧产物进 history 目录，再覆盖固定路径）；
   * - 其余路径（加载节点上传到 assert/custom/canvas/ 等）→ 通用 /fs/upload。
   *
   * @param project 项目名
   * @param dest 目标相对路径
   * @param file 上传文件
   * @param opts 进度回调/中止信号
   * @returns 服务端响应（archived 为归档历史相对路径，画布产物覆盖上传时有值）
   */
  async function uploadByDest(
    project: string,
    dest: string,
    file: File,
    opts: { onProgress?: (p: { percent: number | null; loaded: number; total: number | null }) => void; signal?: AbortSignal },
  ): Promise<{ success: boolean; path: string; archived?: string | null }> {
    if (isCanvasNodeOutputPath(dest)) return uploadCanvasOutput(project, dest, file, opts)
    return uploadFs(project, dest, file, opts)
  }

  /**
   * 上传一个文件到指定节点。
   *
   * 注意：同一节点上传进行中时，忽略新的上传请求（不中止进行中的请求）——
   * 大文件中途被 abort 后，keep-alive 连接复用时残留字节可能污染下一个请求的
   * multipart 流，导致服务端解析出畸形字段（如 Unexpected field）。
   *
   * @param nodeId 目标节点 id
   * @param file 上传文件
   * @param dest 目标相对路径
   * @param opts 可选项（silent=true 不弹 snackbar）
   * @returns 上传结果
   */
  async function uploadForNode(
    nodeId: string,
    file: File,
    dest: string,
    opts: { silent?: boolean } = {},
  ): Promise<CanvasUploadResult> {
    // 同一节点已有上传进行中：忽略新请求，避免并发 abort 破坏请求流
    if (states[nodeId]?.status === 'uploading') {
      console.warn(`[canvas-upload] 节点 ${nodeId} 正在上传 ${states[nodeId]?.fileName}，忽略新的上传请求`)
      return { ok: false, error: '该节点正在上传中' }
    }
    clearErrorTimer(nodeId)
    const state: CanvasUploadState = {
      status: 'uploading',
      fileName: file.name,
      percent: 0,
      loadedBytes: 0,
      totalBytes: file.size,
      file,
      dest,
    }
    states[nodeId] = state
    const controller = new AbortController()
    controllers.set(nodeId, controller)
    try {
      const res = await uploadByDest(project, dest, file, {
        onProgress: ({ percent, loaded, total }) => {
          // 经 reactive 代理写回（states[nodeId] 返回代理）：直接改原始对象不会触发响应式更新
          const s = states[nodeId]
          if (!s) return
          s.percent = percent
          s.loadedBytes = loaded
          s.totalBytes = total
        },
        signal: controller.signal,
      })
      if (res.success && res.path) {
        deleteState(nodeId)
        onSuccess(nodeId, res.path)
        // 成功提示（粘贴批量场景由调用方汇总，silent=true 跳过）：
        // 画布产物覆盖上传（服务端已归档旧产物）时提示历史已保存，便于用户知道可去「历史」恢复
        if (!opts.silent) {
          showSnackbar(res.archived ? '上传成功，原产物已保存为历史版本' : '上传成功', 'success')
        }
        return { ok: true, path: res.path }
      }
      console.error('[canvas-upload] 上传未成功', { nodeId, fileName: file.name, dest, response: res })
      return fail(nodeId, file, dest, '上传失败，请重试', opts.silent ?? false)
    } catch (err) {
      // 中止（切换画布/卸载导致 reset）：静默移除状态，不算失败
      if (controller.signal.aborted) {
        deleteState(nodeId)
        return { ok: false, error: '上传已中止' }
      }
      console.error('[canvas-upload] 上传异常', { nodeId, fileName: file.name, dest }, err)
      return fail(nodeId, file, dest, messageOf(err), opts.silent ?? false)
    } finally {
      controllers.delete(nodeId)
    }
  }

  /**
   * 并行上传多个文件（粘贴场景：节点已先创建，进度显示在各节点遮罩上）。
   *
   * @param tasks 上传任务列表
   * @param opts 可选项（silent=true 不弹 snackbar，由调用方汇总提示）
   * @returns 逐项结果（与入参顺序一致）
   */
  async function uploadMany(tasks: CanvasUploadTask[], opts: { silent?: boolean } = {}): Promise<CanvasUploadResult[]> {
    return Promise.all(tasks.map((t) => uploadForNode(t.nodeId, t.file, t.dest, opts)))
  }

  /** 重试某节点上次失败的上传（沿用状态中保存的文件与路径） */
  function retry(nodeId: string): void {
    const s = states[nodeId]
    if (s?.status === 'error') void uploadForNode(nodeId, s.file, s.dest)
  }

  /** 清除单节点上传状态并中止其进行中请求 */
  function clearNode(nodeId: string): void {
    controllers.get(nodeId)?.abort()
    controllers.delete(nodeId)
    deleteState(nodeId)
  }

  /** 重置全部上传状态并中止进行中请求（切换画布/卸载时调用） */
  function reset(): void {
    for (const controller of controllers.values()) controller.abort()
    controllers.clear()
    for (const timer of errorTimers.values()) clearTimeout(timer)
    errorTimers.clear()
    for (const key of Object.keys(states)) delete states[key]
  }

  return { uploadForNode, uploadMany, retry, stateOf, clearNode, reset }
}