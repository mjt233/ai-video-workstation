/**
 * LLM 会话终态结果落盘（后端独占写）。
 *
 * 会话到达终态时由 session-manager.finish() 调用本模块，直接把
 * config.output（completed 时连同 outputHistory 历史条目）写入画布定义文件：
 * - 读画布定义文件（不存在 → 跳过）；
 * - 校验 nodeId 仍存在于 nodes（节点已删除 → 跳过写盘，仅移除会话）；
 * - completed：config.output = 会话正文；正文非空时追加一条历史版本
 *   （规则镜像前端 canvas/aiTextHistory.ts：id / createdAt 生成、input = 快照 userInput
 *   （未拼入预设提示词的用户原始输入；未提供回退发送文本）、output = 正文、
 *   modelName/presetName/mediaLabels 取快照、上限 50 裁剪最旧）；
 * - cancelled / failed：config.output = 已累计正文（保持「停止保留部分输出、不存档」
 *   语义；无任何累计正文时跳过写入）；
 * - 写入经 saveCanvasDef CAS（expectedRev = 当前 rev）+ withPathLock 进程内串行，
 *   VERSION_CONFLICT 时重读重试（≤3 次），最终失败抛出由调用方收敛为 failed
 *   并广播「结果写入画布失败」+ 控制台日志（不静默）。
 *
 * 历史由后端单写者追加：多页签同时打开同一画布也不会产生重复历史条目。
 * 双端历史规则（前端 aiTextHistory.ts / 后端本模块）由同组单测覆盖防漂移。
 */

import fs from 'fs/promises';
import { pathExists, resolveProjectPath } from '../assets/paths.js';
import { canvasDefRelPath, saveCanvasDef } from '../assets/canvas-def.js';
import type { LlmSession } from './session-manager.js';

/** AI 文本生成节点最多保留的历史版本数（与前端 canvas/aiTextHistory.ts 保持一致，超出丢弃最旧） */
export const MAX_TEXT_HISTORY_VERSIONS = 50;

/** 历史版本条目（字段与前端 AiTextHistoryEntry 完全一致） */
export interface LlmTextHistoryEntry {
  /** 版本 id（追加时生成） */
  id: string;
  /** 生成完成时间（ISO 字符串） */
  createdAt: string;
  /** 该次生成的输入文本快照 */
  input: string;
  /** 该次生成的 AI 响应文本 */
  output: string;
  /** 生成时使用的模型展示名 */
  modelName?: string;
  /** 生成时使用的预设提示词名称 */
  presetName?: string;
  /** 生成时连接的媒体输入名称列表 */
  mediaLabels?: string[];
}

/** 终态落盘结果（供会话管理器追加到 finished 广播载荷） */
export interface LlmPersistResult {
  /** 是否写入画布定义文件（false = 跳过：画布文件不存在 / 节点已删除 / 无累计文本可写） */
  wrote: boolean;
  /** 写入成功后的新版本号（rev；前端 adoptExternalChange 的 savedRev 对齐基准） */
  rev?: number;
  /** 实际写入的 config 补丁（output / outputHistory） */
  patch?: { output?: string; outputHistory?: LlmTextHistoryEntry[] };
}

/** CAS 冲突重试上限（每次冲突重读最新 rev 再写） */
const RETRY_LIMIT = 3;

/** 画布定义文件读取结果的最小结构（完整数据 + 当前 rev） */
interface CanvasFileData {
  rev: number;
  data: Record<string, unknown>;
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
 * 校验单条原始历史条目是否合法（与前端 aiTextHistory.sanitizeEntry 同规则）。
 *
 * @param value 反序列化得到的原始条目
 * @returns 过滤后的合法条目；非法返回 null
 */
function sanitizeEntry(value: unknown): LlmTextHistoryEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as RawHistoryEntry;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.createdAt !== 'string' || raw.createdAt === '') return null;
  if (typeof raw.input !== 'string' || typeof raw.output !== 'string') return null;
  const entry: LlmTextHistoryEntry = { id: raw.id, createdAt: raw.createdAt, input: raw.input, output: raw.output };
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
function readTextHistory(config: Record<string, unknown> | null | undefined): LlmTextHistoryEntry[] {
  const raw = config?.outputHistory;
  if (!Array.isArray(raw)) return [];
  const entries: LlmTextHistoryEntry[] = [];
  for (const item of raw) {
    const entry = sanitizeEntry(item);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * 由会话构造一条新的历史版本（id / createdAt 生成规则与前端 createTextHistoryEntry 一致）。
 * 「当时的输入」取会话快照 `userInput`（未拼入预设提示词的用户原始输入）；
 * 快照未提供时回退 `inputSent`（实际发送文本，兜底兼容旧客户端）。
 *
 * @param session 终态会话（inputSent 与 snapshot 供快照）
 * @returns 新历史版本条目
 */
function buildHistoryEntry(session: LlmSession): LlmTextHistoryEntry {
  const now = new Date();
  const entry: LlmTextHistoryEntry = {
    id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now.toISOString(),
    input: session.snapshot.userInput ?? session.inputSent,
    output: session.text,
  };
  if (session.snapshot.modelName) entry.modelName = session.snapshot.modelName;
  if (session.snapshot.presetName) entry.presetName = session.snapshot.presetName;
  if (session.snapshot.mediaLabels && session.snapshot.mediaLabels.length > 0) {
    entry.mediaLabels = [...session.snapshot.mediaLabels];
  }
  return entry;
}

/**
 * 追加一条历史版本到数组末尾（最新在后）并裁剪到上限（丢弃最旧）。
 *
 * @param entries 现有历史版本
 * @param entry 新版本（放末尾）
 * @returns 追加并裁剪后的数组
 */
function appendTextHistory(entries: LlmTextHistoryEntry[], entry: LlmTextHistoryEntry): LlmTextHistoryEntry[] {
  const next = [...entries, entry];
  if (next.length > MAX_TEXT_HISTORY_VERSIONS) {
    return next.slice(next.length - MAX_TEXT_HISTORY_VERSIONS);
  }
  return next;
}

/**
 * 从画布定义文件读取最小结构（rev + nodes）。
 *
 * @param full 文件绝对路径
 * @returns 解析后的最小结构
 * @throws Error 文件非法 JSON/非对象（code=CORRUPT）
 */
async function readCanvasFile(full: string): Promise<CanvasFileData> {
  let raw: string;
  try {
    raw = await fs.readFile(full, 'utf8');
  } catch (e) {
    throw Object.assign(new Error(`读取画布定义文件失败: ${e instanceof Error ? e.message : String(e)}`), {
      code: 'CORRUPT',
    });
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw Object.assign(new Error(`画布定义文件已损坏，无法写入: ${e instanceof Error ? e.message : String(e)}`), {
      code: 'CORRUPT',
    });
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw Object.assign(new Error('画布定义文件已损坏，无法写入'), { code: 'CORRUPT' });
  }
  const data = obj as Record<string, unknown>;
  const revRaw = Number(data.rev);
  const rev = Number.isInteger(revRaw) && revRaw >= 0 ? revRaw : 0;
  return { rev, data };
}

/**
 * 计算终态补丁并按节点 id 应用到画布数据（返回补丁与新数据）。
 *
 * @param data 读到的画布数据
 * @param session 终态会话
 * @returns 补丁与补丁应用后的画布数据；无法补丁（无节点/无累计文本）返回 null
 */
function buildPatch(
  data: Record<string, unknown>,
  session: LlmSession,
): { patch: NonNullable<LlmPersistResult['patch']>; next: Record<string, unknown> } | null {
  const node = (Array.isArray(data.nodes) ? data.nodes : []).find(
    (n): n is Record<string, unknown> => !!n && typeof n === 'object' && (n as { id?: unknown }).id === session.nodeId,
  );
  if (!node) return null; // 节点已删除：跳过写盘（仅移除会话）
  const cfg =
    typeof node.config === 'object' && node.config !== null && !Array.isArray(node.config)
      ? (node.config as Record<string, unknown>)
      : {};
  const text = typeof session.text === 'string' ? session.text : '';
  const patch: NonNullable<LlmPersistResult['patch']> = {};
  if (session.status === 'completed') {
    patch.output = text;
    if (text.trim().length > 0) {
      patch.outputHistory = appendTextHistory(readTextHistory(cfg), buildHistoryEntry(session));
    }
  } else if (text.trim().length > 0) {
    // cancelled / failed：保留部分输出，**不追加历史**（与前端旧行为「停止不存档」语义一致）
    patch.output = text;
  } else {
    return null; // 无累计文本可写
  }
  const next = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const nextNodes = Array.isArray(next.nodes) ? (next.nodes as Record<string, unknown>[]) : [];
  const nextNode = nextNodes.find((n) => n.id === session.nodeId);
  if (!nextNode) return null; // 并发删除兜底：跳过写盘
  nextNode.config = { ...cfg, ...patch };
  return { patch, next };
}

/**
 * 终态结果落盘（后端独占写画布定义文件；CAS + 路径锁 + 冲突重试）。
 *
 * @param session 终态会话（status 已由会话管理器置为终态）
 * @returns 落盘结果（wrote / rev / patch）；跳过写盘时 wrote=false
 * @throws Error 画布文件损坏或重试 3 次仍冲突（由调用方收敛为 failed 并广播）
 */
export async function persistLlmResult(session: LlmSession): Promise<LlmPersistResult> {
  const rel = canvasDefRelPath(session.canvas);
  const full = resolveProjectPath(session.project, rel);
  if (!(await pathExists(full))) return { wrote: false }; // 画布不存在：跳过（仅移除会话）
  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt += 1) {
    if (!(await pathExists(full))) return { wrote: false };
    const data = await readCanvasFile(full);
    const built = buildPatch(data.data, session);
    if (!built) return { wrote: false };
    try {
      const saved = await saveCanvasDef(session.project, session.canvas, built.next, data.rev, false);
      return { wrote: true, rev: saved.rev, patch: built.patch };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'VERSION_CONFLICT') continue; // 页面/其它写者已推进 rev：重读最新版本重试
      if (code === 'CORRUPT') {
        throw Object.assign(new Error(`画布定义文件已损坏，无法写入: ${(e as Error).message}`), { code: 'CORRUPT' });
      }
      throw e;
    }
  }
  throw new Error(`画布保存冲突重试 ${RETRY_LIMIT} 次后仍失败（${rel}）`);
}
