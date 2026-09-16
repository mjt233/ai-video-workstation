/**
 * 任务管理器「历史」页签的行展示工具。
 *
 * 这里只放**纯函数**（不依赖任何响应式状态与 DOM），目的是让历史行的文案/截短/预览 URL
 * 规则可以在 vitest 中直接覆盖——组件（`TaskHistoryPanel.vue`）只负责状态与模板。
 * 产物路径约定见 `docs/asset-layout.md`，预览 URL 约定见 `canvas/preview.ts`。
 */

import type { TaskResponse } from '../../api/workflow'
import { buildPreviewUrl, mediaKindOfPath, type MediaKind } from '../../canvas/preview'

/**
 * 工作流实现 id 里的实例 UUID 段。
 *
 * 注册的实现 id 有两种形态，都内嵌服务商**实例 id**（UUID）：
 * - ComfyUI Bridge 动态注册：`ceb-{实例id}-{bridge工作流id}`（见 `server/src/workflows/bridge-sync.ts`）；
 * - 静态实例副本：`{候选impl}-{实例id}`（见 `server/src/providers/instance-sync.ts`）。
 *
 * 实例 id 是自动生成的标识、对用户无意义，展示时去掉只留可读的实现名。
 */
const IMPL_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Bridge 动态注册实现的前缀（`ceb-`，剥掉 UUID 后仍需去掉） */
const IMPL_BRIDGE_PREFIX = /^ceb-/i

/**
 * 工作流实现 id 的简短展示名（去掉内嵌的实例 UUID 与 Bridge 前缀）。
 *
 * 例：`ceb-412a1e15-…-minimax-h3-r2v` → `minimax-h3-r2v`；`minimax-h3-r2v-412a1e15-…` → `minimax-h3-r2v`。
 * 若整个 id 都由 UUID/前缀构成（剥完为空），则保留原值——原样展示比空串更有信息量。
 *
 * @param impl 实现 id（任务响应的 `impl` 字段）
 * @returns 可读实现名；空值时返回空串
 */
export function shortImpl(impl?: string | null): string {
  const raw = (impl ?? '').trim()
  if (!raw) return ''
  const cleaned = raw
    .replace(IMPL_UUID, '')
    .replace(IMPL_BRIDGE_PREFIX, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || raw
}

/**
 * 任务画布定位文案（`params.canvas` + `params.nodeId`）。
 *
 * @param t 任务响应
 * @returns 定位文本（如「分镜 3-19 · 节点 016c743d」）；无定位信息时返回空串
 */
export function locationText(t: TaskResponse): string {
  const parts: string[] = []
  const c = t.params?.canvas
  if (c) {
    if (c.kind === 'scene') parts.push(`分镜 ${c.episode ?? ''}-${c.shot ?? ''}`)
    else parts.push(`场景 ${c.stage ?? ''}/${c.label ?? ''}`)
  }
  if (t.params?.nodeId) parts.push(`节点 ${t.params.nodeId.slice(0, 8)}`)
  return parts.join(' · ')
}

/**
 * 产物文件名（预览对话框标题与下载文件名）。
 *
 * @param t 任务响应
 * @returns 路径最后一段；无产物时返回「产物」
 */
export function artifactName(t: TaskResponse): string {
  const path = t.result?.path ?? ''
  return path.split('/').pop() || '产物'
}

/**
 * 任务产物缩略图路径（仅**已完成**且产物为图片/视频时返回，其余返回空串）。
 *
 * 音频产物不渲染缩略图（可在完成气泡中试听），失败任务无产物。
 *
 * @param t 任务响应
 * @returns 产物相对路径；不适用时为空串
 */
export function thumbPathOf(t: TaskResponse): string {
  if (t.status !== 'completed' || !t.result?.path) return ''
  const kind = mediaKindOfPath(t.result.path)
  return kind === 'image' || kind === 'video' ? t.result.path : ''
}

/**
 * 产物缩略图的媒体类型（打开放大预览时决定用图片还是视频播放器）。
 *
 * @param t 任务响应
 * @returns `image` 或 `video`；非图片/视频产物一律回退 `image`
 */
export function thumbKindOf(t: TaskResponse): Extract<MediaKind, 'image' | 'video'> {
  return mediaKindOfPath(thumbPathOf(t)) === 'video' ? 'video' : 'image'
}

/**
 * 任务产物预览 URL（以任务 `updatedAt` 作缓存键：同一任务多次渲染 URL 稳定，避免反复重新加载）。
 *
 * @param t 任务响应
 * @returns 预览 URL；无产物或无项目名时返回空串
 */
export function previewUrlOf(t: TaskResponse): string {
  const path = t.result?.path ?? ''
  if (!path || !t.project) return ''
  return buildPreviewUrl(t.project, path, parseServerTime(t.updatedAt) ?? 0)
}

/**
 * 历史行第二行文案：画布定位 · 实现简称 · 错误原因（优先）或产物文件名。
 *
 * 该行在模板中强制单行省略，完整文本请用 {@link rowSecondaryTooltip} 作 `title`。
 *
 * @param t 任务响应
 * @returns 单行副信息文本（定位缺失时为「无画布定位」）
 */
export function rowSecondaryText(t: TaskResponse): string {
  const parts: string[] = [locationText(t) || '无画布定位']
  const impl = shortImpl(t.impl)
  if (impl) parts.push(impl)
  if (t.errorMsg) parts.push(t.errorMsg)
  else if (t.result?.path) parts.push(artifactName(t))
  return parts.join(' · ')
}

/**
 * 历史行第二行的悬浮提示文本（与 {@link rowSecondaryText} 同序，但用**未截短**的实现 id 与**完整**产物路径）。
 *
 * @param t 任务响应
 * @returns 完整副信息文本
 */
export function rowSecondaryTooltip(t: TaskResponse): string {
  const parts: string[] = [locationText(t) || '无画布定位']
  if (t.impl) parts.push(t.impl)
  if (t.errorMsg) parts.push(t.errorMsg)
  else if (t.result?.path) parts.push(t.result.path)
  return parts.join(' · ')
}

/**
 * 时间格式化（SQLite UTC 串 → 本地 `MM-DD HH:MM`）。
 *
 * @param raw 服务端时间字符串（带 `T` 的 ISO 串或 `YYYY-MM-DD HH:MM:SS` 的 SQLite 串）
 * @returns 展示文本；无法解析时原样返回
 */
export function formatDateTime(raw: string): string {
  const parsed = parseServerTime(raw)
  if (parsed == null) return raw
  const d = new Date(parsed)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 服务端时间字符串 → 毫秒时间戳。
 *
 * SQLite 的 `datetime('now')` 串没有 `T` 与 `Z`，直接 `Date.parse` 会被当成本地时间，
 * 因此无 `T` 时统一补成 UTC；两者解析失败时都返回 `null`。
 *
 * @param raw 服务端时间字符串
 * @returns 毫秒时间戳；无法解析时为 `null`
 */
function parseServerTime(raw?: string): number | null {
  if (!raw) return null
  const parsed = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`)
  return Number.isNaN(parsed) ? null : parsed
}
