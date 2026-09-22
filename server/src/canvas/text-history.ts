/**
 * 画布文本节点「文本历史版本」的服务端共享规则。
 *
 * AI 文本生成节点（`text-ai`，LLM 直连）与文本生成节点（`text-generate`，工作流）
 * 都把历史存进节点 `config.outputHistory`（纯文本快照，无产物文件），
 * 两端必须遵守**同一组**规则，否则同一画布上两类节点的历史会出现上限/字段漂移：
 * - 条目字段：id / createdAt / input / output（+ 可选 modelName / presetName / mediaLabels）；
 * - 数组**末尾为最新**，超出 {@link MAX_TEXT_HISTORY_VERSIONS} 时丢弃最旧；
 * - 读取时逐条过滤脏数据（手改 canvas.json / 旧版本数据）。
 *
 * 规则与前端 `frontend/src/canvas/aiTextHistory.ts` 一致（同组单测覆盖防漂移）。
 */

/** 单个文本节点最多保留的历史版本数（超出丢弃最旧） */
export const MAX_TEXT_HISTORY_VERSIONS = 50;

/** 文本历史版本条目（字段与前端 AiTextHistoryEntry 完全一致） */
export interface TextHistoryEntry {
  /** 版本 id（追加时生成） */
  id: string;
  /** 生成完成时间（ISO 字符串） */
  createdAt: string;
  /** 该次生成的输入文本快照 */
  input: string;
  /** 该次生成的响应文本 */
  output: string;
  /** 生成时使用的模型/工作流展示名 */
  modelName?: string;
  /** 生成时使用的预设提示词名称 */
  presetName?: string;
  /** 生成时连接的媒体输入名称列表 */
  mediaLabels?: string[];
}

/** 原始历史条目（config 数据可能被手工改动，读取时逐条过滤防脏数据） */
interface RawHistoryEntry {
  id?: unknown;
  createdAt?: unknown;
  input?: unknown;
  output?: unknown;
  modelName?: unknown;
  presetName?: unknown;
  mediaLabels?: unknown;
}

/**
 * 生成一个新的历史版本 id。
 *
 * 规则与前端 `createTextHistoryEntry` 一致（时间戳 36 进制 + 随机后缀），
 * 仅需在画布内唯一，不追求全局唯一。
 *
 * @param now 生成时间（缺省为当前时间；测试可注入）
 * @returns 版本 id
 */
export function createTextHistoryId(now: Date = new Date()): string {
  return `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 校验单条原始历史条目是否合法（与前端 `aiTextHistory.sanitizeEntry` 同规则）。
 *
 * @param value 反序列化得到的原始条目
 * @returns 过滤后的合法条目；非法返回 null
 */
export function sanitizeTextHistoryEntry(value: unknown): TextHistoryEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as RawHistoryEntry;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.createdAt !== 'string' || raw.createdAt === '') return null;
  if (typeof raw.input !== 'string' || typeof raw.output !== 'string') return null;
  const entry: TextHistoryEntry = {
    id: raw.id,
    createdAt: raw.createdAt,
    input: raw.input,
    output: raw.output,
  };
  if (typeof raw.modelName === 'string' && raw.modelName !== '') entry.modelName = raw.modelName;
  if (typeof raw.presetName === 'string' && raw.presetName !== '') entry.presetName = raw.presetName;
  if (Array.isArray(raw.mediaLabels) && raw.mediaLabels.every((x) => typeof x === 'string')) {
    entry.mediaLabels = raw.mediaLabels as string[];
  }
  return entry;
}

/**
 * 从节点 config 读取历史版本列表（未知/缺失/非法字段一律回退为空数组）。
 *
 * @param config 节点 config
 * @returns 历史版本数组（末尾为最新）
 */
export function readTextHistory(
  config: Record<string, unknown> | null | undefined,
): TextHistoryEntry[] {
  const raw = config?.outputHistory;
  if (!Array.isArray(raw)) return [];
  const entries: TextHistoryEntry[] = [];
  for (const item of raw) {
    const entry = sanitizeTextHistoryEntry(item);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * 追加一条历史版本到数组末尾（最新在后）并裁剪到上限（丢弃最旧）。
 *
 * @param entries 现有历史版本
 * @param entry 新版本（放末尾）
 * @returns 追加并裁剪后的数组
 */
export function appendTextHistory(
  entries: TextHistoryEntry[],
  entry: TextHistoryEntry,
): TextHistoryEntry[] {
  const next = [...entries, entry];
  if (next.length > MAX_TEXT_HISTORY_VERSIONS) {
    return next.slice(next.length - MAX_TEXT_HISTORY_VERSIONS);
  }
  return next;
}
