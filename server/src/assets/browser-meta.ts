/**
 * 资产浏览器元数据（metadata.json）读写。
 *
 * 设计原则：**不改变物理目录结构**，仅在对应位置新增 metadata.json 记录额外定义：
 * - `prompt/scene/{集数}/metadata.json`            → `{ "alias": "觉醒", "showPrefix": false }`
 *   （集数别名；`showPrefix` 仅 false 时落盘，缺省 = 显示「第3集」前缀）
 * - `prompt/scene/{集数}/{分镜}/metadata.json`     → `{ "alias": "初遇" }`（分镜别名，同上）
 * - `prompt/character/metadata.json`               → `{ categories, assignments }`（角色分类）
 *
 * 角色分类与道具分类不同：分类是**虚拟树**（多层、允许空分类），角色的物理目录仍为
 * `prompt/character/{角色名}/`，分类归属（`assignments`）只记录在 metadata.json 中。
 *
 * 集数/分镜删除或重排（如分镜插入、删除后编号前移）时，目录被整体 rename，
 * metadata.json 随实体目录一起移动，别名与实体绑定关系不变，无需额外同步。
 *
 * 校验规则：
 * - 别名：仅显示用途（不强制唯一）；trim 后非空、长度 ≤ 50；传 `null`/空 = 清除别名，
 *   清除后若 metadata.json 无其它字段则删除该文件（不留空文件）。
 * - 分类名：trim 后非空、长度 ≤ 50、同层兄弟唯一、层级不限。
 * - assignments：值为分类路径（逐级匹配 categories 树），空数组/缺失 = 未分类；
 *   键必须是已存在的角色目录（防止脏数据）。
 */

import fs from 'fs/promises';
import path from 'path';
import {
  assertPositiveIntId,
  assertSafeName,
  listNumericDirNames,
  pathExists,
  resolveProjectPath,
} from './paths.js';

/** 别名与分类名的最大长度 */
export const MAX_META_NAME_LENGTH = 50;

/** 角色分类树节点（多层，children 递归） */
export interface CharacterCategoryNode {
  /** 分类名（同层唯一） */
  name: string;
  /** 子分类列表 */
  children: CharacterCategoryNode[];
}

/** 角色分类元数据（prompt/character/metadata.json 结构） */
export interface CharacterCategoriesMeta {
  /** 分类树（顶层数组，顺序即展示顺序） */
  categories: CharacterCategoryNode[];
  /** 角色名 → 分类路径（空数组/缺失 = 未分类） */
  assignments: Record<string, string[]>;
}

/** 集数/分镜别名元数据（metadata.json 中 alias 部分） */
export interface AliasMeta {
  /** 别名内容 */
  alias: string;
  /** 是否显示编号前缀（如「第3集」「分镜2」；默认 true，不落盘） */
  showPrefix: boolean;
}

/** 资产浏览器元数据聚合（GET /api/assets/:project/browser-meta 响应） */
export interface BrowserMeta {
  /** 集数号 → 别名元数据 */
  episodes: Record<string, AliasMeta>;
  /** 集数号 → { 分镜号 → 别名元数据 } */
  shots: Record<string, Record<string, AliasMeta>>;
  /** 角色分类定义 */
  characters: CharacterCategoriesMeta;
}

function invalid(message: string): Error {
  return Object.assign(new Error(message), { code: 'INVALID' });
}

/**
 * 校验分类名并规范化为 trim 后的字符串。
 *
 * @param value 待校验的分类名
 * @param label 用于报错提示的名称（如「分类名」）
 * @returns 规范化后的分类名
 * @throws code=INVALID 名称非字符串/为空/超长
 */
function normalizeName(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw invalid(`${label}必须是字符串`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw invalid(`${label}不能为空`);
  }
  if (trimmed.length > MAX_META_NAME_LENGTH) {
    throw invalid(`${label}长度不能超过 ${MAX_META_NAME_LENGTH}`);
  }
  return trimmed;
}

/**
 * 校验别名并规范化为 trim 后的字符串。
 *
 * @param value 待校验的别名（null/undefined = 清除）
 * @returns 规范化后的别名；null 表示清除
 * @throws code=INVALID 别名非字符串/为空（仅空白或空串应传 null 清除）/超长
 */
export function normalizeAlias(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw invalid('别名必须是字符串');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw invalid('别名不能为空；如需清除别名请传 null');
  }
  if (trimmed.length > MAX_META_NAME_LENGTH) {
    throw invalid(`别名长度不能超过 ${MAX_META_NAME_LENGTH}`);
  }
  return trimmed;
}

/**
 * 读取指定目录的 metadata.json 中的别名元数据；文件缺失或内容非法时返回 null。
 *
 * @param filePath metadata.json 的绝对路径
 * @returns 别名元数据；无别名返回 null
 */
async function readAliasFromFile(filePath: string): Promise<AliasMeta | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data: unknown = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const alias = (data as Record<string, unknown>).alias;
      if (typeof alias === 'string' && alias.trim()) {
        const showPrefix = (data as Record<string, unknown>).showPrefix;
        return {
          alias,
          showPrefix: typeof showPrefix === 'boolean' ? showPrefix : true,
        };
      }
    }
    return null;
  } catch {
    // 文件不存在或内容非法：按无别名处理（兜底回退；下次写入时会覆盖修复）
    return null;
  }
}

/**
 * 读取分镜目录下的 metadata.json（不存在 = unset）。
 *
 * @param dir 分镜目录绝对路径
 * @returns 别名元数据或 null
 */
async function readShotAlias(dir: string): Promise<AliasMeta | null> {
  return readAliasFromFile(path.join(dir, 'metadata.json'));
}

/**
 * 读取集数目录下的 metadata.json（不存在 = unset）。
 *
 * @param dir 集数目录绝对路径
 * @returns 别名元数据或 null
 */
async function readEpisodeAlias(dir: string): Promise<AliasMeta | null> {
  return readAliasFromFile(path.join(dir, 'metadata.json'));
}

/**
 * 读取角色分类元数据（prompt/character/metadata.json）。
 * 文件缺失或结构非法时回退为空态 `{ categories: [], assignments: {} }`，
 * 保证资产浏览器在任何旧项目/异常文件下都能正常加载。
 *
 * @param project 项目名
 * @returns 角色分类元数据
 */
export async function readCharacterCategories(project: string): Promise<CharacterCategoriesMeta> {
  const filePath = resolveProjectPath(project, 'prompt/character/metadata.json');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { categories: [], assignments: {} };
    }
    const obj = parsed as Record<string, unknown>;
    const categories = Array.isArray(obj.categories)
      ? obj.categories
        .map(normalizeCategoryNode)
        .filter((n): n is CharacterCategoryNode => n !== null)
      : [];
    const assignments: Record<string, string[]> = {};
    if (obj.assignments && typeof obj.assignments === 'object' && !Array.isArray(obj.assignments)) {
      for (const [key, value] of Object.entries(obj.assignments as Record<string, unknown>)) {
        if (!Array.isArray(value)) continue;
        assignments[key] = value.filter((s): s is string => typeof s === 'string');
      }
    }
    return { categories, assignments };
  } catch {
    // 文件不存在或非法 JSON：回退为空态（兜底回退，不影响浏览器加载）
    return { categories: [], assignments: {} };
  }
}

/**
 * 规范化单个分类节点；结构非法时返回 null（读取时为容错丢弃该节点）。
 *
 * @param value 待规范化的节点
 * @returns 规范化节点；非法返回 null
 */
function normalizeCategoryNode(value: unknown): CharacterCategoryNode | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name || name.length > MAX_META_NAME_LENGTH) return null;
  const children: CharacterCategoryNode[] = [];
  if (Array.isArray(obj.children)) {
    for (const child of obj.children) {
      const node = normalizeCategoryNode(child);
      if (node) children.push(node);
    }
  }
  return { name, children };
}

/**
 * 校验分类树结构：数组、节点字段合法、同层兄弟不重名。
 *
 * @param value 待校验的分类树（任意结构，来自请求体）
 * @returns 规范化后的分类树
 * @throws code=INVALID 结构非法
 */
function validateCategoryTree(value: unknown): CharacterCategoryNode[] {
  if (!Array.isArray(value)) {
    throw invalid('categories 必须是数组');
  }
  const result: CharacterCategoryNode[] = [];
  for (const raw of value) {
    const node = validateCategoryNode(raw, '');
    if (node.name === '' || node.name.length > MAX_META_NAME_LENGTH) {
      throw invalid(`分类名不能为空且长度不能超过 ${MAX_META_NAME_LENGTH}`);
    }
    result.push(node);
  }
  return result;
}

/**
 * 校验单个分类节点及其子树（写入时严格校验，非法即抛错）。
 *
 * @param value 待校验的节点
 * @param parentLabel 父分类路径（用于报错提示）
 * @returns 规范化节点
 * @throws code=INVALID 结构非法
 */
function validateCategoryNode(value: unknown, parentLabel: string): CharacterCategoryNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('分类节点必须是对象');
  }
  const obj = value as Record<string, unknown>;
  const name = normalizeName(obj.name, `${parentLabel ? `${parentLabel}/` : ''}分类名`);
  const children: CharacterCategoryNode[] = [];
  if (obj.children !== undefined) {
    if (!Array.isArray(obj.children)) {
      throw invalid(`分类「${name}」的 children 必须是数组`);
    }
    const seen = new Set<string>();
    for (const child of obj.children) {
      const childNode = validateCategoryNode(child, `${parentLabel ? `${parentLabel}/` : ''}${name}`);
      if (seen.has(childNode.name)) {
        throw invalid(`同层分类名重复：「${childNode.name}」`);
      }
      seen.add(childNode.name);
      children.push(childNode);
    }
  }
  return { name, children };
}

/**
 * 校验角色归属映射：路径逐级匹配分类树、角色目录必须存在。
 *
 * @param project 项目名
 * @param categories 已校验的分类树
 * @param value 待校验的归属映射
 * @returns 规范化后的归属映射
 * @throws code=INVALID 结构非法
 */
async function validateAssignments(
  project: string,
  categories: CharacterCategoryNode[],
  value: unknown,
): Promise<Record<string, string[]>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('assignments 必须是对象');
  }
  const result: Record<string, string[]> = {};
  for (const [key, rawPath] of Object.entries(value as Record<string, unknown>)) {
    assertSafeName(key, '角色名');
    if (!Array.isArray(rawPath)) {
      throw invalid(`角色「${key}」的分类路径必须是数组`);
    }
    // 逐级在分类树中查找路径
    let level = categories;
    const pathSegments: string[] = [];
    for (const segRaw of rawPath) {
      const seg = normalizeName(segRaw, '分类路径');
      const found = level.find((n) => n.name === seg);
      if (!found) {
        throw invalid(`角色「${key}」的分类路径不存在：「${[...pathSegments, seg].join(' / ')}」`);
      }
      pathSegments.push(seg);
      level = found.children;
    }
    const charDir = resolveProjectPath(project, `prompt/character/${key}`);
    if (!(await pathExists(charDir))) {
      throw invalid(`角色「${key}」不存在，无法设置分类`);
    }
    result[key] = pathSegments;
  }
  return result;
}

/**
 * 读取全项目资产浏览器元数据（聚合接口，供树一次请求）。
 *
 * @param project 项目名
 * @returns 集合数/分镜别名与角色分类的元数据
 */
export async function readBrowserMeta(project: string): Promise<BrowserMeta> {
  const episodes: Record<string, AliasMeta> = {};
  const shots: Record<string, Record<string, AliasMeta>> = {};

  const sceneRoot = resolveProjectPath(project, 'prompt/scene');
  const episodeIds = await listNumericDirNames(sceneRoot);
  for (const ep of episodeIds) {
    const epDir = path.join(sceneRoot, ep);
    const alias = await readEpisodeAlias(epDir);
    if (alias) episodes[ep] = alias;

    const shotIds = await listNumericDirNames(epDir);
    const shotMap: Record<string, AliasMeta> = {};
    for (const shot of shotIds) {
      const shotAlias = await readShotAlias(path.join(epDir, shot));
      if (shotAlias) shotMap[shot] = shotAlias;
    }
    if (Object.keys(shotMap).length) shots[ep] = shotMap;
  }

  const characters = await readCharacterCategories(project);
  return { episodes, shots, characters };
}

/**
 * 保存集数/分镜别名（写入或清除对应目录的 metadata.json）。
 *
 * 清除（alias 为 null）后若 metadata.json 无其它字段则删除该文件。
 *
 * @param project 项目名
 * @param kind 'episode' | 'shot'（别名归属类型）
 * @param episode 集数
 * @param shot 分镜（kind=shot 时必填）
 * @param alias 别名；null = 清除
 * @param showPrefix 是否显示编号前缀（如「第3集」「分镜2」；默认 true）
 *   —— true 为默认值不落盘，false 时写入 `showPrefix: false`
 * @throws code=NOT_FOUND 实体不存在；code=INVALID 参数非法
 */
export async function saveAlias(
  project: string,
  kind: 'episode' | 'shot',
  episode: string,
  shot: string | undefined,
  alias: string | null,
  showPrefix = true,
): Promise<void> {
  assertPositiveIntId(episode, '集数');
  if (typeof showPrefix !== 'boolean') {
    throw invalid('showPrefix 必须是布尔值');
  }
  let relDir: string;
  if (kind === 'episode') {
    relDir = `prompt/scene/${episode}`;
  } else {
    if (!shot) throw invalid('shot 必填');
    assertPositiveIntId(shot, '分镜');
    relDir = `prompt/scene/${episode}/${shot}`;
  }
  const dir = resolveProjectPath(project, relDir);
  if (!(await pathExists(dir))) {
    throw Object.assign(new Error(kind === 'episode' ? '集数不存在' : '分镜不存在'), { code: 'NOT_FOUND' });
  }

  const filePath = path.join(dir, 'metadata.json');
  const normalized = normalizeAlias(alias);

  // 保留文件中的其它字段（如未来新增的元数据），只更新 alias 与 showPrefix
  let data: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // 文件不存在或非法 JSON：按空对象处理（写入会覆盖修复）
  }

  if (normalized === null) {
    // 清除别名：showPrefix 一并清除（无别名时前缀无意义）
    delete data.alias;
    delete data.showPrefix;
  } else {
    data.alias = normalized;
    if (showPrefix) {
      delete data.showPrefix;
    } else {
      data.showPrefix = false;
    }
  }

  if (Object.keys(data).length === 0) {
    await fs.rm(filePath, { force: true });
  } else {
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  }
}

/**
 * 全量保存角色分类元数据（拖拽/增删分类后整体替换，保证一致性）。
 *
 * @param project 项目名
 * @param meta 待保存的分类树与归属映射
 * @returns 规范化后的元数据（已 trim、已校验）
 * @throws code=INVALID 结构非法
 */
export async function saveCharacterCategories(
  project: string,
  meta: CharacterCategoriesMeta,
): Promise<CharacterCategoriesMeta> {
  if (!meta || typeof meta !== 'object') {
    throw invalid('body 必须包含 categories 与 assignments');
  }
  const categories = validateCategoryTree(meta.categories);
  // 顶层兄弟重名校验
  const topNames = new Set<string>();
  for (const node of categories) {
    if (topNames.has(node.name)) {
      throw invalid(`同层分类名重复：「${node.name}」`);
    }
    topNames.add(node.name);
  }
  const assignments = await validateAssignments(project, categories, meta.assignments);
  const result: CharacterCategoriesMeta = { categories, assignments };

  const filePath = resolveProjectPath(project, 'prompt/character/metadata.json');
  await fs.writeFile(filePath, `${JSON.stringify(result, null, 2)}\n`, 'utf-8');
  return result;
}

/**
 * 删除角色时清理其在角色分类元数据中的归属记录。
 * metadata.json 不存在/无该角色记录时不做任何事；清理后文件为空结构则删除文件。
 *
 * @param project 项目名
 * @param name 被删除的角色名
 */
export async function removeCharacterAssignment(project: string, name: string): Promise<void> {
  const filePath = resolveProjectPath(project, 'prompt/character/metadata.json');
  let data: CharacterCategoriesMeta | null = null;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const categories = Array.isArray(obj.categories)
        ? obj.categories
          .map(normalizeCategoryNode)
          .filter((n): n is CharacterCategoryNode => n !== null)
        : [];
      const assignments: Record<string, string[]> = {};
      if (obj.assignments && typeof obj.assignments === 'object' && !Array.isArray(obj.assignments)) {
        for (const [key, value] of Object.entries(obj.assignments as Record<string, unknown>)) {
          if (Array.isArray(value)) {
            assignments[key] = value.filter((s): s is string => typeof s === 'string');
          }
        }
      }
      data = { categories, assignments };
    }
  } catch {
    // 文件不存在或非法 JSON：无需清理（兜底回退）
  }
  if (!data || !(name in data.assignments)) return;

  delete data.assignments[name];
  if (data.categories.length === 0 && Object.keys(data.assignments).length === 0) {
    await fs.rm(filePath, { force: true });
  } else {
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  }
}
