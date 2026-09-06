/**
 * AI 文本生成节点「文本历史版本」数据模型与纯函数。
 *
 * AI 文本生成节点不产生资产文件，其当前值与历史均为文本快照，
 * 全部存放在节点 config 中随画布定义文件（canvas.json）持久化：
 * - 当前值：config.output（AI 响应，可手动编辑）；
 * - 历史版本：config.outputHistory（AiTextHistoryEntry[]，见本模块；
 *   每次 AI 响应**正常结束**（未被停止、无错误）且输出非空时由节点自动追加一条）。
 *
 * 设计约定：
 * - 数组末尾为最新版本，对话框展示时逆序（最新在前）；
 * - 追加时按 MAX_TEXT_HISTORY_VERSIONS 上限裁剪，丢弃最旧；
 * - 删除/追加走「静默更新」（update:config-quiet，不入撤销栈），
 *   历史版本不随生成结果的可撤销提交被连带回退；
 * - 节点被复制/粘贴时剥离 outputHistory（见 groupSelection.remapNodeConfig），
 *   新节点从零开始记录自己的历史。
 */

/** 单个 AI 文本生成节点最多保留的历史版本数（超出丢弃最旧） */
export const MAX_TEXT_HISTORY_VERSIONS = 50

/** AI 文本生成节点的一条历史版本（某次 AI 响应结束时的输入/输出快照） */
export interface AiTextHistoryEntry {
  /** 版本 id（追加时生成，删除操作定位键） */
  id: string
  /** 生成完成时间（ISO 字符串，列表展示用） */
  createdAt: string
  /**
   * 该次生成的输入文本快照（用户侧文本：外部文本连线取连线内容，
   * 否则取输入框文本；不含预设提示词替换后的完整发送内容）。
   */
  input: string
  /** 该次生成的 AI 响应文本 */
  output: string
  /** 生成时使用的模型展示名（名称或 id 字符串快照；模型列表变化不影响历史展示） */
  modelName?: string
  /** 生成时使用的预设提示词名称（未使用预设时省略） */
  presetName?: string
  /** 生成时连接的媒体输入名称列表（展示「当时的输入」用；无媒体时省略） */
  mediaLabels?: string[]
}

/** 合法条目最小结构（config 数据可能被手工改动，读取时逐条过滤防脏数据） */
interface RawEntry {
  id?: unknown
  createdAt?: unknown
  input?: unknown
  output?: unknown
  modelName?: unknown
  presetName?: unknown
  mediaLabels?: unknown
}

/**
 * 校验单条原始数据是否可作为历史版本条目。
 *
 * @param value 反序列化得到的原始条目
 * @returns 过滤为合法条目（modelName/presetName/mediaLabels 可选字段仅在类型正确时保留）
 */
function sanitizeEntry(value: unknown): AiTextHistoryEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as RawEntry
  if (typeof raw.id !== 'string' || raw.id === '') return null
  if (typeof raw.createdAt !== 'string' || raw.createdAt === '') return null
  if (typeof raw.input !== 'string' || typeof raw.output !== 'string') return null
  const entry: AiTextHistoryEntry = { id: raw.id, createdAt: raw.createdAt, input: raw.input, output: raw.output }
  if (typeof raw.modelName === 'string' && raw.modelName !== '') entry.modelName = raw.modelName
  if (typeof raw.presetName === 'string' && raw.presetName !== '') entry.presetName = raw.presetName
  if (Array.isArray(raw.mediaLabels) && raw.mediaLabels.every((x) => typeof x === 'string')) {
    entry.mediaLabels = raw.mediaLabels as string[]
  }
  return entry
}

/**
 * 从节点 config 读取历史版本列表。
 * 未知/缺失/非法字段一律回退为空数组（旧画布节点没有该字段属正常情况）。
 *
 * @param config 节点 config
 * @returns 历史版本数组（末尾为最新；按存储顺序，可能为空）
 */
export function readTextHistory(config: Record<string, unknown> | null | undefined): AiTextHistoryEntry[] {
  const raw = config?.outputHistory
  if (!Array.isArray(raw)) return []
  const entries: AiTextHistoryEntry[] = []
  for (const item of raw) {
    const entry = sanitizeEntry(item)
    if (entry) entries.push(entry)
  }
  return entries
}

/**
 * 构造一条新的历史版本（id 与 createdAt 在追加时生成）。
 *
 * @param input 该次生成的输入文本快照
 * @param output 该次生成的 AI 响应文本
 * @param meta 可选元信息快照（模型名 / 预设名 / 媒体输入名称列表）
 * @returns 新历史版本条目
 */
export function createTextHistoryEntry(
  input: string,
  output: string,
  meta?: { modelName?: string; presetName?: string; mediaLabels?: string[] },
): AiTextHistoryEntry {
  const now = new Date()
  const entry: AiTextHistoryEntry = {
    id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now.toISOString(),
    input,
    output,
  }
  if (meta?.modelName) entry.modelName = meta.modelName
  if (meta?.presetName) entry.presetName = meta.presetName
  if (meta?.mediaLabels && meta.mediaLabels.length > 0) entry.mediaLabels = [...meta.mediaLabels]
  return entry
}

/**
 * 追加一条历史版本到数组末尾（最新在后），并裁剪到上限（丢弃最旧）。
 * 返回新数组（不改动入参数组，供静默更新整体写回 config）。
 *
 * @param entries 现有历史版本
 * @param entry 新版本（放末尾）
 * @returns 追加并裁剪后的数组
 */
export function appendTextHistory(entries: AiTextHistoryEntry[], entry: AiTextHistoryEntry): AiTextHistoryEntry[] {
  const next = [...entries, entry]
  if (next.length > MAX_TEXT_HISTORY_VERSIONS) {
    return next.slice(next.length - MAX_TEXT_HISTORY_VERSIONS)
  }
  return next
}

/**
 * 删除指定 id 的历史版本。
 *
 * @param entries 现有历史版本
 * @param id 待删除版本 id
 * @returns 删除后的新数组；id 不存在时返回原数组引用（无变化）
 */
export function removeTextHistory(entries: AiTextHistoryEntry[], id: string): AiTextHistoryEntry[] {
  if (!entries.some((e) => e.id === id)) return entries
  return entries.filter((e) => e.id !== id)
}
