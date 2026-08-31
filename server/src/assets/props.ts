/**
 * 道具（prop）资产读写。
 *
 * 道具是与「角色」「场景」同级的资产类型，两级结构：一级为分类（目录），
 * 二级为道具本身。道具拥有图片 / 视频 / 音频三类产物：
 *
 * 目录约定：
 * ```
 * prompt/prop/{分类}/{道具名}/
 * ├── image.md      # 图片描述文案（文生图/图片编辑 prompt）
 * ├── video.md      # 视频描述文案（图生视频 prompt）
 * └── refs.json     # 关联资产 { image: string[], video: string[] }
 * assert/prop/{分类}/{道具名}/
 * ├── image.jpg     # 图片产物（text-to-image / image-edit 固定产物）
 * ├── video.mp4     # 视频产物（image-to-video 固定产物）
 * ├── audio.flac    # 音频产物（资产画布「保存为道具音频」固定目标）
 * ├── {音频文件}     # 道具详情「音频」页签上传的音频（保留原文件名，可多个）
 * └── history/      # 历史版本（image/、video/、音频同名 stem/）
 * ```
 *
 * 图片/视频产物的重新生成覆盖由工作流引擎统一归档历史；上传覆盖时由
 * 调用方先调 history/archive 归档（见 routes/assets.ts），本模块不处理历史。
 */

import fs from 'fs/promises';
import path from 'path';
import {
  assertSafeName,
  ensureDir,
  pathExists,
  resolveProjectPath,
} from './paths.js';

/** 道具关联资产的媒体类型（与页签一一对应；音频页签仅上传无关联资产） */
export type PropMediaKind = 'image' | 'video';

/** 道具关联资产配置（refs.json 结构） */
export interface PropRefs {
  /** 图片页签关联资产：assert/ 下图片路径数组（空=文生图；非空=图片编辑输入图，按序） */
  image: string[];
  /** 视频页签关联资产：assert/ 下图片路径数组（1 张=首帧、2 张=首尾帧；空=文生视频提示先选图） */
  video: string[];
}

/** 道具引用信息（资产画布加载节点 config.assetPath 命中 assert/prop/...） */
export interface PropCanvasRef {
  /** 画布类型 */
  kind: 'scene' | 'stage';
  /** 画布定义文件相对路径（如 prompt/scene/1/1/canvas.json） */
  canvasPath: string;
  /** 引用节点的名称（如 加载图片） */
  nodeName: string;
  /** 节点 config.assetPath 的实际值 */
  assetPath: string;
}

/** 默认关联资产配置（创建道具时写入 refs.json） */
export function emptyPropRefs(): PropRefs {
  return { image: [], video: [] };
}

function propDirRel(category: string, name: string): string {
  return `prompt/prop/${category}/${name}`;
}

function propAssertDirRel(category: string, name: string): string {
  return `assert/prop/${category}/${name}`;
}

function propRefsRel(category: string, name: string): string {
  return `${propDirRel(category, name)}/refs.json`;
}

/**
 * 读取道具关联资产配置（refs.json）；文件缺失或非法时回退为空配置。
 *
 * @param project 项目名
 * @param category 分类名
 * @param name 道具名
 * @returns 关联资产配置（image/video 恒为数组）
 */
export async function readPropRefs(project: string, category: string, name: string): Promise<PropRefs> {
  const full = resolveProjectPath(project, propRefsRel(category, name));
  try {
    const raw = await fs.readFile(full, 'utf-8');
    const data = JSON.parse(raw) as Partial<PropRefs>;
    if (!data || typeof data !== 'object') return emptyPropRefs();
    const norm = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.startsWith('assert/')) : [];
    return { image: norm(data.image), video: norm(data.video) };
  } catch {
    // 文件缺失或 JSON 非法时视为无关联资产（读失败不阻断详情页展示）
    return emptyPropRefs();
  }
}

/**
 * 校验关联资产路径：须为 assert/ 前缀下的项目内相对路径，且不得包含 .. 逃逸。
 *
 * @param relPath 候选路径
 * @returns 规范化后的路径
 * @throws 非法时抛 INVALID
 */
function assertPropRefPath(relPath: string): string {
  const normalized = (relPath ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.startsWith('assert/') || normalized.includes('..')) {
    throw Object.assign(new Error('关联资产路径非法，须为 assert/ 下的项目内路径'), { code: 'INVALID' });
  }
  return normalized;
}

/**
 * 保存道具关联资产配置（refs.json），规范化并去重。
 *
 * @param project 项目名
 * @param category 分类名
 * @param name 道具名
 * @param refs 新配置（image/video 数组）
 * @returns 规范化后的配置
 */
export async function savePropRefs(project: string, category: string, name: string, refs: Partial<PropRefs>): Promise<PropRefs> {
  const image = Array.isArray(refs.image) ? [...new Set(refs.image.map(assertPropRefPath))] : [];
  const video = Array.isArray(refs.video) ? [...new Set(refs.video.map(assertPropRefPath))] : [];
  const next: PropRefs = { image, video };
  const full = resolveProjectPath(project, propRefsRel(category, name));
  await ensureDir(path.dirname(full));
  await fs.writeFile(full, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

/**
 * 创建道具分类：仅建 prompt/prop/{分类}/ 目录。
 *
 * @param project 项目名
 * @param category 分类名（须通过 assertSafeName 校验）
 * @returns prompt 相对目录路径
 * @throws EXISTS 分类已存在
 */
export async function createPropCategory(project: string, category: string): Promise<string> {
  assertSafeName(category, '分类名');
  const dir = resolveProjectPath(project, `prompt/prop/${category}`);
  if (await pathExists(dir)) throw Object.assign(new Error('分类已存在'), { code: 'EXISTS' });
  await ensureDir(dir);
  return `prompt/prop/${category}`;
}

/**
 * 创建道具：建 prompt/prop/{分类}/{道具名}/ 目录并写入三个模板文件
 * （image.md / video.md / refs.json）。分类不存在时自动创建。
 *
 * @param project 项目名
 * @param category 分类名
 * @param name 道具名（须通过 assertSafeName 校验）
 * @returns prompt 相对目录路径
 * @throws EXISTS 道具已存在
 */
export async function createProp(project: string, category: string, name: string): Promise<string> {
  assertSafeName(category, '分类名');
  assertSafeName(name, '道具名');
  const dir = resolveProjectPath(project, propDirRel(category, name));
  if (await pathExists(dir)) throw Object.assign(new Error('道具已存在'), { code: 'EXISTS' });
  await ensureDir(resolveProjectPath(project, `prompt/prop/${category}`));
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, 'image.md'), propImageMd(), 'utf-8');
  await fs.writeFile(path.join(dir, 'video.md'), propVideoMd(), 'utf-8');
  await fs.writeFile(path.join(dir, 'refs.json'), `${JSON.stringify(emptyPropRefs(), null, 2)}\n`, 'utf-8');
  return propDirRel(category, name);
}

function propImageMd(): string {
  return '待补充道具图片描述文案（用于文生图；有关联图片时作为图片编辑提示词）。\n';
}

function propVideoMd(): string {
  return '待补充道具视频描述文案（用于图生视频提示词）。\n';
}

/**
 * 删除道具：成对清理 prompt/prop/{分类}/{道具名}/ 与 assert/prop/{分类}/{道具名}/。
 *
 * @param project 项目名
 * @param category 分类名
 * @param name 道具名
 * @throws NOT_FOUND 道具不存在；IN_USE 被资产画布引用
 */
export async function deleteProp(project: string, category: string, name: string): Promise<void> {
  assertSafeName(category, '分类名');
  assertSafeName(name, '道具名');
  const dir = resolveProjectPath(project, propDirRel(category, name));
  if (!(await pathExists(dir))) throw Object.assign(new Error('道具不存在'), { code: 'NOT_FOUND' });
  const refs = await findPropRefs(project, category, name);
  if (refs.length) {
    throw Object.assign(new Error('资源正在被引用，无法删除'), { code: 'IN_USE', refs });
  }
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(resolveProjectPath(project, propAssertDirRel(category, name)), { recursive: true, force: true });
}

/**
 * 删除道具分类：成对清理 prompt/prop/{分类}/ 与 assert/prop/{分类}/（含其下全部道具）。
 *
 * @param project 项目名
 * @param category 分类名
 * @throws NOT_FOUND 分类不存在；IN_USE 分类下任一道具被引用
 */
export async function deletePropCategory(project: string, category: string): Promise<void> {
  assertSafeName(category, '分类名');
  const dir = resolveProjectPath(project, `prompt/prop/${category}`);
  if (!(await pathExists(dir))) throw Object.assign(new Error('分类不存在'), { code: 'NOT_FOUND' });
  const refs = await findPropRefs(project, category);
  if (refs.length) {
    throw Object.assign(new Error('分类下存在被引用的道具，无法删除'), { code: 'IN_USE', refs });
  }
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(resolveProjectPath(project, `assert/prop/${category}`), { recursive: true, force: true });
}

/**
 * 扫描全部画布定义文件（分镜画布 + 场景画布），收集加载节点 config.assetPath
 * 命中 assert/prop/ 的引用。
 *
 * 匹配规则：
 * - 指定 category + name：精确匹配 `assert/prop/{category}/{name}/` 前缀；
 * - 仅指定 category：匹配 `assert/prop/{category}/` 前缀（分类删除用）；
 * - 均不指定：匹配任意 `assert/prop/`（预留，未使用）。
 *
 * @param project 项目名
 * @param category 分类名（可选）
 * @param name 道具名（可选，须与 category 同传）
 * @returns 引用列表
 */
export async function findPropRefs(project: string, category?: string, name?: string): Promise<PropCanvasRef[]> {
  const prefix = `assert/prop/${category ?? ''}${name ? `/${name}` : ''}/`;
  const refs: PropCanvasRef[] = [];

  // 分镜画布：prompt/scene/{ep}/{shot}/canvas.json
  const sceneRoot = resolveProjectPath(project, 'prompt/scene');
  let episodes: string[] = [];
  try {
    episodes = (await fs.readdir(sceneRoot, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    // 场景目录缺失时跳过（无画布即无引用）
  }
  for (const ep of episodes) {
    const epDir = path.join(sceneRoot, ep);
    let shots: string[] = [];
    try {
      shots = (await fs.readdir(epDir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      continue;
    }
    for (const shot of shots) {
      const canvasRel = `prompt/scene/${ep}/${shot}/canvas.json`;
      await collectCanvasRefs(project, canvasRel, 'scene', prefix, refs);
    }
  }

  // 场景画布：prompt/stage/{stage}/canvas/{label}.json
  const stageRoot = resolveProjectPath(project, 'prompt/stage');
  let stages: string[] = [];
  try {
    stages = (await fs.readdir(stageRoot, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    // 场景目录缺失时跳过
  }
  for (const stage of stages) {
    const canvasDirRel = `prompt/stage/${stage}/canvas`;
    const canvasDir = resolveProjectPath(project, canvasDirRel);
    let labels: string[] = [];
    try {
      labels = (await fs.readdir(canvasDir, { withFileTypes: true }))
        .filter(e => e.isFile() && e.name.endsWith('.json'))
        .map(e => e.name);
    } catch {
      continue;
    }
    for (const label of labels) {
      const canvasRel = `${canvasDirRel}/${label}`;
      await collectCanvasRefs(project, canvasRel, 'stage', prefix, refs);
    }
  }

  return refs;
}

/**
 * 读取单个画布定义文件，收集 assetPath 命中前缀的加载节点引用。
 *
 * @param project 项目名
 * @param canvasRel 画布定义文件相对路径
 * @param kind 画布类型
 * @param prefix assert/prop 前缀（含尾 /）
 * @param refs 输出引用数组
 */
async function collectCanvasRefs(
  project: string,
  canvasRel: string,
  kind: 'scene' | 'stage',
  prefix: string,
  refs: PropCanvasRef[],
): Promise<void> {
  const full = resolveProjectPath(project, canvasRel);
  let data: { nodes?: Array<{ name?: string; config?: { assetPath?: unknown } }> };
  try {
    data = JSON.parse(await fs.readFile(full, 'utf-8')) as typeof data;
  } catch {
    // 画布文件缺失或非法时跳过（未加载的画布不算引用）
    return;
  }
  if (!data || !Array.isArray(data.nodes)) return;
  for (const node of data.nodes) {
    const assetPath = String(node.config?.assetPath ?? '');
    if (assetPath.startsWith(prefix)) {
      refs.push({
        kind,
        canvasPath: canvasRel,
        nodeName: String(node.name ?? '未命名节点'),
        assetPath,
      });
    }
  }
}
