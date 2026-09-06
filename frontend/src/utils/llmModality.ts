/**
 * LLM 模型输入模态（文本/图片/音频/视频）的图标与文字映射。
 *
 * 供服务商配置的模型列表编辑器（LlmModelsEditor）与 AI 文本生成节点的模型下拉
 * 等 UI 复用，保证同一模态在各处显示一致的图标与文字。
 */

/** 模态 key → 图标名（Vuetify mdi 图标） */
export const MODALITY_ICONS: Record<string, string> = {
  text: 'mdi-format-text',
  image: 'mdi-image-outline',
  audio: 'mdi-music-note',
  video: 'mdi-video-outline',
}

/** 模态 key → 中文文字 */
export const MODALITY_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  audio: '音频',
  video: '视频',
}
