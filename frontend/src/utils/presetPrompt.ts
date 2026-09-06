/**
 * 预设提示词组装：将用户输入合并进预设提示词内容（AI 文本生成节点生成前调用）。
 */

/** 预设提示词占位符标记：生成时以用户输入替换 */
export const USER_PROMPT_PLACEHOLDER = '{user_prompt}'

/**
 * 组装最终发送给 LLM 的提示词文本。
 *
 * - 预设内容包含 `{user_prompt}` 占位符时：全部替换为用户输入；
 * - 不含占位符时：用户输入追加到预设内容末尾（内容尾部空白去除后换行拼接）。
 *
 * 用户输入本身不做 trim（原样写入），避免破坏用户有意保留的前后空白。
 * 预设内容为空字符串时直接返回用户输入。
 *
 * @param presetContent 预设提示词内容
 * @param userInput 用户输入（手动输入或「文本」节点连线内容）
 * @returns 组装后的提示词文本
 */
export function composePresetPrompt(presetContent: string, userInput: string): string {
  if (presetContent.includes(USER_PROMPT_PLACEHOLDER)) {
    return presetContent.split(USER_PROMPT_PLACEHOLDER).join(userInput)
  }
  if (!presetContent) return userInput
  return `${presetContent.replace(/\s+$/, '')}\n${userInput}`
}
