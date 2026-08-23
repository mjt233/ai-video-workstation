/**
 * 工作流类型的中文标签与展示颜色（全局共享）。
 *
 * 数据源为 GET /api/workflow-types（服务端注册表键集合）；本模块提供
 * 键 → 中文标签/颜色的映射，供服务商对话框、自定义工作流表单、批次对话框、
 * 画布编辑器等处复用。未知类型回退显示原始类型 id。
 */

/** 工作流类型展示元信息 */
export interface WorkflowTypeMeta {
  /** 中文标签，如「文生图」 */
  label: string
  /** v-chip 颜色名 */
  color: string
}

/** 工作流类型 → 中文标签与类型 v-chip 颜色（text-to-image / image-edit / tts-* / image-to-video） */
export const WORKFLOW_TYPE_META: Record<string, WorkflowTypeMeta> = {
  'text-to-image': { label: '文生图', color: 'primary' },
  'image-edit': { label: '图片编辑', color: 'secondary' },
  'image-to-video': { label: '图生视频', color: 'info' },
  'tts-voice-design': { label: 'TTS音色设计', color: 'success' },
  'tts-voice-clone': { label: 'TTS音色克隆', color: 'warning' },
}

/**
 * 工作流类型 → 中文标签（未知类型回退为原始类型 id）。
 *
 * @param type 工作流类型 id
 * @returns 中文标签
 */
export function workflowTypeLabel(type: string): string {
  return WORKFLOW_TYPE_META[type]?.label ?? type
}

/**
 * 工作流类型 → 类型 v-chip 颜色（未知类型用默认色）。
 *
 * @param type 工作流类型 id
 * @returns v-chip 颜色名
 */
export function workflowTypeColor(type: string): string {
  return WORKFLOW_TYPE_META[type]?.color ?? 'default'
}

/** 系统内置工作流类型（下拉选项拉取失败时的兜底数据，与服务端 WorkflowTypeId 一致） */
export const FALLBACK_WORKFLOW_TYPES: string[] = [
  'text-to-image',
  'image-edit',
  'tts-voice-design',
  'tts-voice-clone',
  'image-to-video',
]

/**
 * 把工作流类型值规范为类型 id。
 *
 * 兼容旧数据：Vuetify 纯字符串 items + 函数 item-title 曾把中文标签写回
 * v-model（如「文生图」），本函数把中文标签映射回类型 id；已是 id 或未知值原样返回。
 *
 * @param value 工作流类型值（id 或中文标签）
 * @returns 类型 id（未知值原样返回）
 */
export function normalizeWorkflowType(value: string): string {
  if (WORKFLOW_TYPE_META[value]) return value
  const matched = Object.entries(WORKFLOW_TYPE_META).find(([, meta]) => meta.label === value)
  return matched ? matched[0] : value
}
