/**
 * 「文本生成」画布节点的纯函数工具。
 *
 * 工作流类型 `text-generation` 的产物是**文本而非文件**：节点不落 assert/ 产物，
 * 结果由服务端写进节点 config（output + outputHistory）。本模块只放与 UI 解耦的纯逻辑，
 * 便于单测覆盖（节点主体与配置面板共用同一份取值规则，避免两处漂移）。
 */
import type { CanvasInputInfo } from './generate'

/** 未选择工作流实现时的展示文案 */
export const IMPL_NOT_SELECTED_LABEL = '未选择工作流实现'

/** 带来源输出类型的媒体输入条目（LLM 文本节点与媒体收集入口使用同一形状） */
export type TextGenerationMediaInput = CanvasInputInfo & { type: 'image' | 'video' | 'audio' }

/**
 * 工作流实现的展示名（节点主体与配置面板共用）。
 *
 * 配置里缺失/非字符串/空串时返回「未选择工作流实现」，避免节点主体显示空白
 * （用户看不出是没选实现还是实现加载失败）。
 *
 * @param impl 节点 config.workflowImpl 原始值
 * @returns 展示名（未选择时返回 {@link IMPL_NOT_SELECTED_LABEL}）
 */
export function textGenerationImplLabel(impl: unknown): string {
  const v = typeof impl === 'string' ? impl.trim() : ''
  return v === '' ? IMPL_NOT_SELECTED_LABEL : v
}

/**
 * 判断工作流实现是否已选择（生成前的必填校验）。
 *
 * @param impl 节点 config.workflowImpl 原始值
 * @returns 是否已选择
 */
export function hasTextGenerationImpl(impl: unknown): boolean {
  return typeof impl === 'string' && impl.trim() !== ''
}

/** 文本生成节点的媒体输入分组（提交给工作流的 imagePaths / mediaPaths） */
export interface TextGenerationInputPaths {
  /** 图片输入路径（按 config.inputOrder 顺序；提交为 vars.imagePaths） */
  imagePaths: string[]
  /** 其他媒体（视频/音频）输入路径（提交为 vars.mediaPaths） */
  mediaPaths: string[]
}

/**
 * 按来源类型拆分媒体输入为图片与其他媒体两组路径。
 *
 * 之所以分开：文本生成脚本常需要把图片按「图片数组」组包（如视觉理解接口的 image_url），
 * 而视频/音频走另一套字段；统一塞进一个数组会让脚本无法区分。
 *
 * @param inputs 媒体输入条目（来源节点输出类型 + 资产路径；顺序已按 config.inputOrder 排好）
 * @returns 图片路径与其余媒体路径
 */
export function splitTextGenerationInputs(
  inputs: TextGenerationMediaInput[] | undefined,
): TextGenerationInputPaths {
  const imagePaths: string[] = []
  const mediaPaths: string[] = []
  for (const input of inputs ?? []) {
    if (!input?.path) continue
    if (input.type === 'image') imagePaths.push(input.path)
    else mediaPaths.push(input.path)
  }
  return { imagePaths, mediaPaths }
}
