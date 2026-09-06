import client from './client'

/** 预设提示词条目（系统级全局共享，所有项目的 AI 文本生成节点可选择使用） */
export interface PresetPrompt {
  /** 唯一 id（uuid） */
  id: string
  /** 预设名称 */
  name: string
  /** 提示词内容（可包含 {user_prompt} 占位符） */
  content: string
}

/** GET /api/presets — 全部预设提示词列表 */
export async function getPresetPrompts(): Promise<PresetPrompt[]> {
  const { data } = await client.get<{ presets: PresetPrompt[] }>('/presets')
  return data.presets
}

/**
 * POST /api/presets — 新增预设提示词。
 *
 * @param input 预设输入（name/content 必填非空）
 * @returns 创建的预设条目
 */
export async function createPresetPrompt(input: { name: string; content: string }): Promise<PresetPrompt> {
  const { data } = await client.post<{ preset: PresetPrompt }>('/presets', input)
  return data.preset
}

/**
 * PUT /api/presets/:id — 更新预设提示词（name/content 可部分更新）。
 *
 * @param id 预设 id
 * @param input 可部分更新的字段
 * @returns 更新后的预设条目
 */
export async function updatePresetPrompt(
  id: string,
  input: { name?: string; content?: string },
): Promise<PresetPrompt> {
  const { data } = await client.put<{ preset: PresetPrompt }>(`/presets/${id}`, input)
  return data.preset
}

/** DELETE /api/presets/:id — 删除预设提示词 */
export async function deletePresetPrompt(id: string): Promise<{ success: boolean }> {
  const { data } = await client.delete<{ success: boolean }>(`/presets/${id}`)
  return data
}
