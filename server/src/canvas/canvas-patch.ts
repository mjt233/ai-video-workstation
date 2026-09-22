/**
 * 画布定义文件（canvas.json）的「按节点 config 打补丁」服务端事务。
 *
 * 服务端存在多个**画布之外的写者**要在生成完成后把结果写进节点 config：
 * - AI 文本生成节点：LLM 会话终态落盘（`llm/result-persist.ts`）；
 * - 文本生成节点：工作流文本产物落盘（`canvas/text-result.ts`）。
 *
 * 两者都必须遵守同一套并发规则（否则会互相覆盖或把用户正在编辑的画布写坏）：
 * 1. **CAS**：以读到的 `rev` 作为 expectedRev 写入，`saveCanvasDef` 内部由
 *    `withPathLock` 保证「读-比-写」原子，页面停留旧版本时其自动保存会撞 409 而非静默覆盖；
 * 2. **冲突重试**：VERSION_CONFLICT（页面刚保存 / 分镜重编号改写了引用）时**重读最新画布**
 *    重新构造补丁再写，最多 {@link PATCH_RETRY_LIMIT} 次；
 * 3. **跳过语义**：画布文件不存在 / 节点已被删除 / 构建函数返回 null 时跳过写入
 *    （不是错误：用户可能已经关掉画布或删了节点），由调用方决定是否记日志。
 *
 * 本模块只做「读 → 构建 → CAS 写」的编排，补丁内容由调用方以 `buildPatch` 回调提供，
 * 从而让 LLM 与工作流两条链路复用同一份并发正确性。
 */

import fs from 'fs/promises';
import { pathExists, resolveProjectPath } from '../assets/paths.js';
import { canvasDefRelPath, saveCanvasDef, type CanvasDefTarget } from '../assets/canvas-def.js';

/** CAS 冲突重试上限（每次冲突重读最新 rev 再写） */
export const PATCH_RETRY_LIMIT = 3;

/** 画布定义文件读取结果（完整数据 + 当前 rev） */
export interface CanvasFileData {
  /** 当前保存版本号（缺失/旧文件为 0） */
  rev: number;
  /** 画布定义完整数据 */
  data: Record<string, unknown>;
}

/** 节点 config 补丁写入结果 */
export interface CanvasNodePatchResult<T> {
  /** 是否写入画布定义文件（false = 跳过：画布不存在 / 节点已删除 / 构建函数返回 null） */
  wrote: boolean;
  /** 写入成功后的新版本号（rev） */
  rev?: number;
  /** 写入成功前的画布版本号（前端 `savedRev === prevRev` 时才采纳补丁的比对基准） */
  prevRev?: number;
  /** 实际写入的 config 补丁 */
  patch?: T;
}

/**
 * 从画布定义文件读取最小结构（rev + 完整数据）。
 *
 * @param full 文件绝对路径
 * @returns 解析后的最小结构
 * @throws Error 读取失败 / 文件非法 JSON / 非对象（code=CORRUPT）
 */
export async function readCanvasFile(full: string): Promise<CanvasFileData> {
  let raw: string;
  try {
    raw = await fs.readFile(full, 'utf8');
  } catch (e) {
    throw Object.assign(
      new Error(`读取画布定义文件失败: ${e instanceof Error ? e.message : String(e)}`),
      { code: 'CORRUPT' },
    );
  }
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw Object.assign(
      new Error(`画布定义文件已损坏，无法写入: ${e instanceof Error ? e.message : String(e)}`),
      { code: 'CORRUPT' },
    );
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
 * 按节点 id 取出节点 config（非对象/缺失时返回空对象，便于直接展开成新 config）。
 *
 * @param data 画布数据
 * @param nodeId 目标节点 id
 * @returns 节点 config 对象；节点不存在返回 null
 */
export function readNodeConfig(
  data: Record<string, unknown>,
  nodeId: string,
): Record<string, unknown> | null {
  const node = (Array.isArray(data.nodes) ? data.nodes : []).find(
    (n): n is Record<string, unknown> => !!n && typeof n === 'object' && (n as { id?: unknown }).id === nodeId,
  );
  if (!node) return null;
  return typeof node.config === 'object' && node.config !== null && !Array.isArray(node.config)
    ? (node.config as Record<string, unknown>)
    : {};
}

/**
 * 深拷贝画布数据并把补丁合并进目标节点 config。
 *
 * 节点在拷贝后不存在（并发删除兜底）时返回 null。
 *
 * @param data 读到的画布数据
 * @param nodeId 目标节点 id
 * @param patch 要合并的 config 补丁
 * @returns 应用补丁后的新画布数据；节点不存在返回 null
 */
function applyPatchToCopy(
  data: Record<string, unknown>,
  nodeId: string,
  patch: Record<string, unknown>,
): Record<string, unknown> | null {
  const next = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const nodes = Array.isArray(next.nodes) ? (next.nodes as Record<string, unknown>[]) : [];
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const cfg = typeof node.config === 'object' && node.config !== null && !Array.isArray(node.config)
    ? (node.config as Record<string, unknown>)
    : {};
  node.config = { ...cfg, ...patch };
  return next;
}

/**
 * 把节点 config 补丁写入画布定义文件（CAS + 冲突重试 + 跳过语义）。
 *
 * @typeParam T 补丁类型（如 `{ output?: string; outputHistory?: TextHistoryEntry[] }`）
 * @param project 项目名
 * @param target 画布目标（分镜 / 场景）
 * @param nodeId 目标节点 id
 * @param buildPatch 补丁构建回调：入参为「当前画布数据 + 该节点 config」，
 *   返回 null 表示本次不写（如无内容可写、节点已删除）
 * @returns 写入结果；跳过写入时 `wrote=false`
 * @throws Error 画布文件损坏（code=CORRUPT）或重试 {@link PATCH_RETRY_LIMIT} 次仍冲突
 */
export async function applyCanvasNodeConfigPatch<T extends object>(
  project: string,
  target: CanvasDefTarget,
  nodeId: string,
  buildPatch: (
    data: Record<string, unknown>,
    nodeConfig: Record<string, unknown>,
  ) => T | null,
): Promise<CanvasNodePatchResult<T>> {
  const rel = canvasDefRelPath(target);
  const full = resolveProjectPath(project, rel);
  // 画布不存在：跳过（用户可能已删除该分镜/场景画布）
  if (!(await pathExists(full))) return { wrote: false };
  for (let attempt = 1; attempt <= PATCH_RETRY_LIMIT; attempt += 1) {
    if (!(await pathExists(full))) return { wrote: false };
    const file = await readCanvasFile(full);
    const nodeConfig = readNodeConfig(file.data, nodeId);
    if (nodeConfig === null) return { wrote: false }; // 节点已删除：跳过写盘
    const patch = buildPatch(file.data, nodeConfig);
    if (!patch) return { wrote: false };
    const next = applyPatchToCopy(file.data, nodeId, patch as Record<string, unknown>);
    if (!next) return { wrote: false }; // 并发删除兜底：跳过写盘
    try {
      const saved = await saveCanvasDef(project, target, next, file.rev, false);
      return { wrote: true, rev: saved.rev, prevRev: file.rev, patch };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'VERSION_CONFLICT') continue; // 页面/其它写者已推进 rev：重读最新版本重试
      if (code === 'CORRUPT') {
        throw Object.assign(
          new Error(`画布定义文件已损坏，无法写入: ${(e as Error).message}`),
          { code: 'CORRUPT' },
        );
      }
      throw e;
    }
  }
  throw new Error(`画布保存冲突重试 ${PATCH_RETRY_LIMIT} 次后仍失败（${rel}）`);
}
