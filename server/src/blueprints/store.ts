/**
 * 画布蓝图存储（文件系统即数据库）。
 *
 * 存储布局（一蓝图一文件，文件名为蓝图 id）：
 * - 全局蓝图：`server/config/blueprints/{id}.json`（所有项目共享）
 * - 项目级蓝图：`design/{project}/prompt/blueprint/{id}.json`（随项目复制/删除）
 *
 * 文件结构见 `CanvasBlueprint`；`rev` 由服务端维护（每次保存 +1），
 * 更新走 CAS（`expectedRev` 不一致抛 VERSION_CONFLICT），与画布定义同一套约定。
 *
 * 约定：
 * - 项目级蓝图的 `assetProject` **强制等于所属项目**（客户端传值被忽略）；
 * - 全局蓝图的 `assetProject` 可为 null；非空时必须是项目根目录下真实存在的项目
 *   （用于资产预览/上传/选择，见 docs/canvas/blueprint.md）；
 * - 同作用域内名称唯一：重名时抛 code=EXISTS（前端提示覆盖，覆盖走更新）；
 * - 目录可注入（`BlueprintDirs`），单测用临时目录，不触碰真实 design/ 与 config/。
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import {
  DESIGN_DIR,
  assertSafeName,
  isReservedProjectName,
  pathExists,
} from '../assets/paths.js';
import { withPathLock } from '../assets/canvas-def.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 全局蓝图目录：server/config/blueprints/ */
export const GLOBAL_BLUEPRINT_DIR = path.resolve(__dirname, '../../config/blueprints');

/** 项目级蓝图目录（项目内相对路径）：prompt/blueprint/ */
export const PROJECT_BLUEPRINT_REL_DIR = 'prompt/blueprint';

/** 蓝图 schema 版本 */
export const BLUEPRINT_SCHEMA_VERSION = 1;

/** 蓝图名称最大长度 */
export const BLUEPRINT_NAME_MAX = 60;
/** 蓝图描述最大长度 */
export const BLUEPRINT_DESC_MAX = 200;
/** 单蓝图节点数上限 */
export const BLUEPRINT_NODE_LIMIT = 2000;

/** 蓝图作用域 */
export type BlueprintScope = 'global' | 'project';

/** 蓝图存储目录（可注入，便于单测） */
export interface BlueprintDirs {
  /** 全局蓝图目录 */
  globalDir: string;
  /** 项目根目录（默认 design/） */
  projectBaseDir: string;
}

/** 默认存储目录 */
export const DEFAULT_BLUEPRINT_DIRS: BlueprintDirs = {
  globalDir: GLOBAL_BLUEPRINT_DIR,
  projectBaseDir: DESIGN_DIR,
};

/** 蓝图节点（与画布节点同构） */
export interface BlueprintNode {
  id: string;
  prototypeId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  config: Record<string, unknown>;
}

/** 蓝图连线 */
export interface BlueprintConnection {
  id: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
}

/** 蓝图持久分组 */
export interface BlueprintGroup {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 蓝图内容载荷 */
export interface BlueprintPayload {
  nodes: BlueprintNode[];
  connections: BlueprintConnection[];
  groups: BlueprintGroup[];
}

/** 蓝图文件内容 */
export interface CanvasBlueprint extends BlueprintPayload {
  version: number;
  id: string;
  name: string;
  description: string;
  assetProject: string | null;
  createdAt: string;
  updatedAt: string;
  rev: number;
}

/** 蓝图摘要（列表接口返回，避免整包传输） */
export interface BlueprintSummary {
  id: string;
  name: string;
  description: string;
  assetProject: string | null;
  createdAt: string;
  updatedAt: string;
  rev: number;
  nodeCount: number;
  connectionCount: number;
  groupCount: number;
  prototypeCounts: Record<string, number>;
}

/** 定位蓝图的作用域参数 */
export interface BlueprintScopeRef {
  /** 作用域：全局 / 项目 */
  scope: BlueprintScope;
  /** 项目名（scope='project' 时必填） */
  project?: string;
}

/**
 * 校验作用域参数并返回项目名（全局作用域返回 null）。
 *
 * @param ref 作用域参数
 * @returns 项目名（全局为 null）
 * @throws code=INVALID 作用域非法或项目名缺失/非法
 */
export function resolveScope(ref: BlueprintScopeRef): string | null {
  if (ref.scope !== 'global' && ref.scope !== 'project') {
    throw Object.assign(new Error('scope 必须是 global 或 project'), { code: 'INVALID' });
  }
  if (ref.scope === 'global') return null;
  const project = (ref.project ?? '').trim();
  if (!project) throw Object.assign(new Error('scope=project 时 project 必填'), { code: 'INVALID' });
  assertSafeName(project, '项目名');
  if (isReservedProjectName(project)) {
    throw Object.assign(new Error('项目名为系统保留目录'), { code: 'INVALID' });
  }
  return project;
}

/**
 * 解析项目级蓝图目录绝对路径（含越界校验）。
 *
 * @param project 项目名
 * @param baseDir 项目根目录
 * @returns 绝对目录路径
 * @throws code=INVALID 路径越界
 */
function projectBlueprintDir(project: string, baseDir: string): string {
  const base = path.resolve(baseDir);
  const full = path.resolve(base, project, PROJECT_BLUEPRINT_REL_DIR);
  if (full !== base && !full.startsWith(`${base}${path.sep}`)) {
    throw Object.assign(new Error('Path traversal denied'), { code: 'INVALID' });
  }
  return full;
}

/**
 * 计算蓝图目录的绝对路径。
 *
 * @param ref 作用域参数
 * @param dirs 存储目录（默认真实目录）
 * @returns 绝对目录路径
 */
export function blueprintDir(ref: BlueprintScopeRef, dirs: BlueprintDirs = DEFAULT_BLUEPRINT_DIRS): string {
  const project = resolveScope(ref);
  return project === null ? path.resolve(dirs.globalDir) : projectBlueprintDir(project, dirs.projectBaseDir);
}

/** 蓝图 id 合法格式（字母数字起头，允许 `._-`；防路径穿越） */
const BLUEPRINT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * 校验蓝图 id 并返回文件绝对路径。
 *
 * @param ref 作用域参数
 * @param id 蓝图 id
 * @param dirs 存储目录（默认真实目录）
 * @returns 蓝图文件绝对路径
 * @throws code=INVALID id 非法
 */
export function blueprintFile(
  ref: BlueprintScopeRef,
  id: string,
  dirs: BlueprintDirs = DEFAULT_BLUEPRINT_DIRS,
): string {
  const trimmed = (id ?? '').trim();
  if (!BLUEPRINT_ID_RE.test(trimmed)) {
    throw Object.assign(new Error('蓝图 id 非法'), { code: 'INVALID' });
  }
  return path.join(blueprintDir(ref, dirs), `${trimmed}.json`);
}

/**
 * 校验资产项目：null/空 → null；否则必须是项目根目录下真实存在的项目。
 *
 * @param assetProject 资产项目名（可空）
 * @param dirs 存储目录（默认真实目录）
 * @returns 规范化后的项目名或 null
 * @throws code=INVALID 项目名非法或不存在
 */
async function normalizeAssetProject(
  assetProject: unknown,
  dirs: BlueprintDirs = DEFAULT_BLUEPRINT_DIRS,
): Promise<string | null> {
  if (assetProject === null || assetProject === undefined) return null;
  if (typeof assetProject !== 'string') {
    throw Object.assign(new Error('assetProject 必须是字符串或 null'), { code: 'INVALID' });
  }
  const name = assetProject.trim();
  if (!name) return null;
  assertSafeName(name, '资产项目');
  if (isReservedProjectName(name)) {
    throw Object.assign(new Error('资产项目为系统保留目录'), { code: 'INVALID' });
  }
  if (!(await pathExists(path.resolve(dirs.projectBaseDir, name)))) {
    throw Object.assign(new Error(`资产项目不存在: ${name}`), { code: 'INVALID' });
  }
  return name;
}

/**
 * 校验蓝图名称（非空、去首尾空白、长度上限）。
 *
 * @param name 原始名称
 * @returns 规范化后的名称
 * @throws code=INVALID 名称为空或超长
 */
function normalizeName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) {
    throw Object.assign(new Error('蓝图名称不能为空'), { code: 'INVALID' });
  }
  const trimmed = name.trim();
  if (trimmed.length > BLUEPRINT_NAME_MAX) {
    throw Object.assign(new Error(`蓝图名称不能超过 ${BLUEPRINT_NAME_MAX} 个字符`), { code: 'INVALID' });
  }
  return trimmed;
}

/**
 * 校验蓝图描述（可空、长度上限）。
 *
 * @param description 原始描述
 * @returns 规范化后的描述（缺省空串）
 * @throws code=INVALID 描述超长或类型非法
 */
function normalizeDescription(description: unknown): string {
  if (description === undefined || description === null) return '';
  if (typeof description !== 'string') {
    throw Object.assign(new Error('蓝图描述必须是字符串'), { code: 'INVALID' });
  }
  if (description.length > BLUEPRINT_DESC_MAX) {
    throw Object.assign(new Error(`蓝图描述不能超过 ${BLUEPRINT_DESC_MAX} 个字符`), { code: 'INVALID' });
  }
  return description;
}

/** 有限数字校验 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 校验蓝图内容载荷（严格校验，任一非法项即拒绝并指明位置）。
 *
 * @param raw 原始载荷（{ nodes, connections, groups }）
 * @returns 规范化后的载荷
 * @throws code=INVALID 结构非法/超限
 */
export function validatePayload(raw: unknown): BlueprintPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw Object.assign(new Error('蓝图内容必须是对象'), { code: 'INVALID' });
  }
  const obj = raw as { nodes?: unknown; connections?: unknown; groups?: unknown };
  const rawNodes = obj.nodes ?? [];
  const rawConnections = obj.connections ?? [];
  const rawGroups = obj.groups ?? [];
  if (!Array.isArray(rawNodes)) throw Object.assign(new Error('nodes 必须是数组'), { code: 'INVALID' });
  if (!Array.isArray(rawConnections)) throw Object.assign(new Error('connections 必须是数组'), { code: 'INVALID' });
  if (!Array.isArray(rawGroups)) throw Object.assign(new Error('groups 必须是数组'), { code: 'INVALID' });
  if (rawNodes.length > BLUEPRINT_NODE_LIMIT) {
    throw Object.assign(new Error(`单个蓝图节点数不能超过 ${BLUEPRINT_NODE_LIMIT}`), { code: 'INVALID' });
  }

  const nodes: BlueprintNode[] = rawNodes.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw Object.assign(new Error(`nodes[${index}] 必须是对象`), { code: 'INVALID' });
    }
    const n = item as Partial<BlueprintNode>;
    if (typeof n.id !== 'string' || !n.id) throw Object.assign(new Error(`nodes[${index}].id 非法`), { code: 'INVALID' });
    if (typeof n.prototypeId !== 'string' || !n.prototypeId) {
      throw Object.assign(new Error(`nodes[${index}].prototypeId 非法`), { code: 'INVALID' });
    }
    if (typeof n.name !== 'string') throw Object.assign(new Error(`nodes[${index}].name 非法`), { code: 'INVALID' });
    if (!isFiniteNumber(n.x) || !isFiniteNumber(n.y)) {
      throw Object.assign(new Error(`nodes[${index}] 坐标非法`), { code: 'INVALID' });
    }
    if (!isFiniteNumber(n.width) || !isFiniteNumber(n.height)) {
      throw Object.assign(new Error(`nodes[${index}] 尺寸非法`), { code: 'INVALID' });
    }
    if (!n.config || typeof n.config !== 'object' || Array.isArray(n.config)) {
      throw Object.assign(new Error(`nodes[${index}].config 非法`), { code: 'INVALID' });
    }
    return {
      id: n.id,
      prototypeId: n.prototypeId,
      name: n.name,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      config: n.config as Record<string, unknown>,
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const connections: BlueprintConnection[] = rawConnections.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw Object.assign(new Error(`connections[${index}] 必须是对象`), { code: 'INVALID' });
    }
    const c = item as Partial<BlueprintConnection>;
    if (typeof c.id !== 'string' || !c.id) {
      throw Object.assign(new Error(`connections[${index}].id 非法`), { code: 'INVALID' });
    }
    if (typeof c.fromNodeId !== 'string' || typeof c.fromPortId !== 'string') {
      throw Object.assign(new Error(`connections[${index}] 来源端非法`), { code: 'INVALID' });
    }
    if (typeof c.toNodeId !== 'string' || typeof c.toPortId !== 'string') {
      throw Object.assign(new Error(`connections[${index}] 目标端非法`), { code: 'INVALID' });
    }
    if (!nodeIds.has(c.fromNodeId) || !nodeIds.has(c.toNodeId)) {
      throw Object.assign(new Error(`connections[${index}] 端点节点不存在`), { code: 'INVALID' });
    }
    return {
      id: c.id,
      fromNodeId: c.fromNodeId,
      fromPortId: c.fromPortId,
      toNodeId: c.toNodeId,
      toPortId: c.toPortId,
    };
  });

  const groups: BlueprintGroup[] = rawGroups.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw Object.assign(new Error(`groups[${index}] 必须是对象`), { code: 'INVALID' });
    }
    const g = item as Partial<BlueprintGroup>;
    if (typeof g.id !== 'string' || !g.id) throw Object.assign(new Error(`groups[${index}].id 非法`), { code: 'INVALID' });
    if (typeof g.name !== 'string') throw Object.assign(new Error(`groups[${index}].name 非法`), { code: 'INVALID' });
    if (typeof g.color !== 'string') throw Object.assign(new Error(`groups[${index}].color 非法`), { code: 'INVALID' });
    if (!isFiniteNumber(g.x) || !isFiniteNumber(g.y) || !isFiniteNumber(g.width) || !isFiniteNumber(g.height)) {
      throw Object.assign(new Error(`groups[${index}] 几何非法`), { code: 'INVALID' });
    }
    return { id: g.id, name: g.name, color: g.color, x: g.x, y: g.y, width: g.width, height: g.height };
  });

  return { nodes, connections, groups };
}

/**
 * 计算蓝图摘要。
 *
 * @param blueprint 蓝图文件内容
 * @returns 摘要（数量与原型分布）
 */
export function summarize(blueprint: CanvasBlueprint): BlueprintSummary {
  const prototypeCounts: Record<string, number> = {};
  for (const n of blueprint.nodes) {
    prototypeCounts[n.prototypeId] = (prototypeCounts[n.prototypeId] ?? 0) + 1;
  }
  return {
    id: blueprint.id,
    name: blueprint.name,
    description: blueprint.description,
    assetProject: blueprint.assetProject,
    createdAt: blueprint.createdAt,
    updatedAt: blueprint.updatedAt,
    rev: blueprint.rev,
    nodeCount: blueprint.nodes.length,
    connectionCount: blueprint.connections.length,
    groupCount: blueprint.groups.length,
    prototypeCounts,
  };
}

/**
 * 读取单个蓝图文件（文件缺失/损坏时返回 null）。
 *
 * @param file 蓝图文件绝对路径
 * @param id 蓝图 id（以文件名为准写回）
 * @returns 蓝图内容或 null
 */
async function readBlueprintFile(file: string, id: string): Promise<CanvasBlueprint | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn(`[blueprints] 蓝图文件不是合法 JSON，已跳过: ${file}`, e);
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.warn(`[blueprints] 蓝图文件结构非法，已跳过: ${file}`);
    return null;
  }
  const obj = parsed as Partial<CanvasBlueprint>;
  let payload: BlueprintPayload;
  try {
    payload = validatePayload(obj);
  } catch (e) {
    // 文件内容结构非法（如连线端点缺失）：跳过该文件，不影响其余蓝图列表
    console.warn(`[blueprints] 蓝图文件内容非法，已跳过: ${file}（${e instanceof Error ? e.message : String(e)}）`);
    return null;
  }
  const revRaw = Number(obj.rev);
  const now = new Date().toISOString();
  return {
    version: BLUEPRINT_SCHEMA_VERSION,
    id,
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : '未命名蓝图',
    description: typeof obj.description === 'string' ? obj.description : '',
    assetProject: typeof obj.assetProject === 'string' && obj.assetProject.trim() ? obj.assetProject.trim() : null,
    nodes: payload.nodes,
    connections: payload.connections,
    groups: payload.groups,
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : now,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : now,
    rev: Number.isInteger(revRaw) && revRaw >= 0 ? revRaw : 0,
  };
}

/**
 * 原子写入蓝图文件（临时文件 + rename；目录自动创建）。
 *
 * @param file 蓝图文件绝对路径
 * @param blueprint 蓝图内容
 */
async function writeBlueprintFile(file: string, blueprint: CanvasBlueprint): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(blueprint, null, 2)}\n`, 'utf-8');
  await fs.rename(tmp, file);
}

/**
 * 列出指定作用域下的全部蓝图摘要（按更新时间倒序）。
 *
 * @param ref 作用域参数
 * @param dirs 存储目录（默认真实目录）
 * @returns 蓝图摘要列表（损坏文件跳过并输出日志）
 */
export async function listBlueprints(
  ref: BlueprintScopeRef,
  dirs: BlueprintDirs = DEFAULT_BLUEPRINT_DIRS,
): Promise<BlueprintSummary[]> {
  const dir = blueprintDir(ref, dirs);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const summaries: BlueprintSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const id = entry.name.slice(0, -'.json'.length);
    if (!BLUEPRINT_ID_RE.test(id)) continue;
    const blueprint = await readBlueprintFile(path.join(dir, entry.name), id);
    if (!blueprint) continue;
    summaries.push(summarize(blueprint));
  }
  summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.name.localeCompare(b.name, 'zh')));
  return summaries;
}

/**
 * 读取单个蓝图。
 *
 * @param ref 作用域参数
 * @param id 蓝图 id
 * @param dirs 存储目录（默认真实目录）
 * @returns 蓝图内容
 * @throws code=NOT_FOUND 蓝图不存在或文件损坏
 */
export async function getBlueprint(
  ref: BlueprintScopeRef,
  id: string,
  dirs: BlueprintDirs = DEFAULT_BLUEPRINT_DIRS,
): Promise<CanvasBlueprint> {
  const file = blueprintFile(ref, id, dirs);
  const blueprint = await readBlueprintFile(file, id.trim());
  if (!blueprint) throw Object.assign(new Error(`蓝图不存在: ${id}`), { code: 'NOT_FOUND' });
  return blueprint;
}

/**
 * 在指定作用域内按名称查找蓝图 id。
 *
 * @param ref 作用域参数
 * @param name 蓝图名称（已规范化）
 * @param dirs 存储目录（默认真实目录）
 * @returns 命中的蓝图 id；无同名返回 null
 */
export async function findBlueprintIdByName(
  ref: BlueprintScopeRef,
  name: string,
  dirs: BlueprintDirs = DEFAULT_BLUEPRINT_DIRS,
): Promise<string | null> {
  const list = await listBlueprints(ref, dirs);
  return list.find((b) => b.name === name)?.id ?? null;
}

/** 创建/导入蓝图的输入 */
export interface CreateBlueprintInput {
  /** 作用域 */
  scope: BlueprintScope;
  /** 项目名（scope='project' 必填） */
  project?: string;
  /** 蓝图名称 */
  name: unknown;
  /** 蓝图描述（可空） */
  description?: unknown;
  /** 资产项目（项目级强制为所属项目；全局可空） */
  assetProject?: unknown;
  /** 蓝图内容载荷 */
  payload: unknown;
  /** 同名时是否覆盖（默认 false → 抛 EXISTS） */
  overwrite?: boolean;
  /** 存储目录（默认真实目录；单测注入临时目录） */
  dirs?: BlueprintDirs;
}

/**
 * 创建蓝图（服务端生成 id）。
 *
 * @param input 创建输入
 * @returns 创建后的蓝图内容
 * @throws code=INVALID 参数/载荷非法；code=EXISTS 同作用域内名称重复且未指定覆盖
 */
export async function createBlueprint(input: CreateBlueprintInput): Promise<CanvasBlueprint> {
  const dirs = input.dirs ?? DEFAULT_BLUEPRINT_DIRS;
  const ref: BlueprintScopeRef = { scope: input.scope, project: input.project };
  const project = resolveScope(ref);
  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description);
  const payload = validatePayload(input.payload);
  // 项目级蓝图资产上下文固定为所属项目；全局蓝图允许显式指定（须真实存在）
  const assetProject = project ?? (await normalizeAssetProject(input.assetProject, dirs));

  await fs.mkdir(blueprintDir(ref, dirs), { recursive: true });

  const existingId = await findBlueprintIdByName(ref, name, dirs);
  if (existingId) {
    if (!input.overwrite) {
      throw Object.assign(new Error(`同名蓝图已存在: ${name}`), { code: 'EXISTS', existingId });
    }
    // 覆盖：更新既有蓝图（保留 id 与创建时间）
    return updateBlueprint({
      scope: input.scope,
      project: input.project,
      id: existingId,
      patch: { name, description, assetProject, ...payload },
      force: true,
      dirs,
    });
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const blueprint: CanvasBlueprint = {
    version: BLUEPRINT_SCHEMA_VERSION,
    id,
    name,
    description,
    assetProject,
    ...payload,
    createdAt: now,
    updatedAt: now,
    rev: 1,
  };
  await writeBlueprintFile(blueprintFile(ref, id, dirs), blueprint);
  return blueprint;
}

/** 更新蓝图的输入 */
export interface UpdateBlueprintInput {
  /** 作用域 */
  scope: BlueprintScope;
  /** 项目名（scope='project' 必填） */
  project?: string;
  /** 蓝图 id */
  id: string;
  /** 局部更新字段（未提供的字段保持原值） */
  patch: {
    name?: unknown;
    description?: unknown;
    assetProject?: unknown;
    nodes?: unknown;
    connections?: unknown;
    groups?: unknown;
  };
  /** 前端基于的版本号（非 force 时必填） */
  expectedRev?: number;
  /** 强制覆盖（跳过版本比对；仅覆盖/用户确认后使用） */
  force?: boolean;
  /** 存储目录（默认真实目录；单测注入临时目录） */
  dirs?: BlueprintDirs;
}

/**
 * 更新蓝图（CAS：`expectedRev` 必须等于当前 rev，或 `force=true`）。
 *
 * 局部更新语义：patch 中未出现的字段保持原值；出现 nodes/connections/groups 时
 * 三者按「提供的字段 + 原有其余字段」重新做整体校验（保证连线端点完整性）。
 *
 * @param input 更新输入
 * @returns 更新后的蓝图内容
 * @throws code=NOT_FOUND 蓝图不存在；code=INVALID 参数非法；
 *   code=VERSION_CONFLICT 版本不一致（409）；code=EXISTS 改名撞名
 */
export async function updateBlueprint(input: UpdateBlueprintInput): Promise<CanvasBlueprint> {
  const dirs = input.dirs ?? DEFAULT_BLUEPRINT_DIRS;
  const ref: BlueprintScopeRef = { scope: input.scope, project: input.project };
  const project = resolveScope(ref);
  const file = blueprintFile(ref, input.id, dirs);
  if (!input.force && (!Number.isInteger(input.expectedRev) || (input.expectedRev as number) < 0)) {
    throw Object.assign(new Error('expectedRev 必填且必须是非负整数'), { code: 'INVALID' });
  }

  return withPathLock(`blueprint:${file}`, async () => {
    const current = await readBlueprintFile(file, input.id.trim());
    if (!current) throw Object.assign(new Error(`蓝图不存在: ${input.id}`), { code: 'NOT_FOUND' });
    if (!input.force && input.expectedRev !== current.rev) {
      throw Object.assign(
        new Error(
          `蓝图保存冲突：该蓝图已被其他人修改（当前版本 ${current.rev}，您基于版本 ${input.expectedRev} 编辑）。`,
        ),
        { code: 'VERSION_CONFLICT', currentRev: current.rev, expectedRev: input.expectedRev },
      );
    }

    const patch = input.patch ?? {};
    const name = patch.name === undefined ? current.name : normalizeName(patch.name);
    const description = patch.description === undefined ? current.description : normalizeDescription(patch.description);
    // 项目级蓝图资产上下文不可改；全局蓝图可显式设置/清空
    const assetProject = project !== null
      ? project
      : patch.assetProject === undefined
        ? current.assetProject
        : await normalizeAssetProject(patch.assetProject, dirs);

    if (name !== current.name) {
      const conflictId = await findBlueprintIdByName(ref, name, dirs);
      if (conflictId && conflictId !== current.id) {
        throw Object.assign(new Error(`同名蓝图已存在: ${name}`), { code: 'EXISTS', existingId: conflictId });
      }
    }

    const payload = validatePayload({
      nodes: patch.nodes === undefined ? current.nodes : patch.nodes,
      connections: patch.connections === undefined ? current.connections : patch.connections,
      groups: patch.groups === undefined ? current.groups : patch.groups,
    });

    const next: CanvasBlueprint = {
      ...current,
      name,
      description,
      assetProject,
      ...payload,
      updatedAt: new Date().toISOString(),
      rev: current.rev + 1,
    };
    await writeBlueprintFile(file, next);
    return next;
  });
}

/**
 * 删除蓝图。
 *
 * @param ref 作用域参数
 * @param id 蓝图 id
 * @param dirs 存储目录（默认真实目录）
 * @throws code=NOT_FOUND 蓝图不存在
 */
export async function deleteBlueprint(
  ref: BlueprintScopeRef,
  id: string,
  dirs: BlueprintDirs = DEFAULT_BLUEPRINT_DIRS,
): Promise<void> {
  const file = blueprintFile(ref, id, dirs);
  try {
    await fs.unlink(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw Object.assign(new Error(`蓝图不存在: ${id}`), { code: 'NOT_FOUND' });
    }
    throw e;
  }
}
