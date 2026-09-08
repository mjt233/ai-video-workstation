/**
 * 存储清理扫描：识别「无引用自定义资产」与「久远历史记录」。
 *
 * 两类口径：
 * 1. **无引用自定义资产**：`assert/custom/**` 下未被项目任何文本文件引用的文件。
 *    引用来源为 `prompt/**` 全部文本文件（stage.json 的 `custom/...` 引用、
 *    canvas.json 的加载节点 `config.assetPath` / 导演台素材路径 / 变体元数据
 *    `refs`、`baseImage`、props 的 refs.json 等），采用**保守策略**：
 *    只要文本中出现该路径（或其目录前缀），即视为被引用（宁可漏删，不可误删）。
 * 2. **久远历史记录**：覆盖「资产画布节点产物历史」与「角色/场景/道具及其衍生
 *    变体历史」，且归档时间早于阈值（默认 7 天）的条目。
 *    **不含**分镜产物历史（`assert/scene/*​/*​/{stage,voice,video}/history/**`）。
 *
 * 本模块只读不写；清理动作由 `assets/trash.ts` 负责。
 */
import fs from 'fs/promises';
import path from 'path';
import { resolveProjectPath } from './paths.js';

/** 扫描分组（同时作为前端分节 key） */
export type CleanupCategory =
  | 'custom-orphan'
  | 'canvas-history'
  | 'character-history'
  | 'stage-history'
  | 'prop-history';

/** 分组显示名 */
export const CLEANUP_GROUP_LABELS: Record<CleanupCategory, string> = {
  'custom-orphan': '无引用自定义资产',
  'canvas-history': '画布节点历史',
  'character-history': '角色历史',
  'stage-history': '场景历史',
  'prop-history': '道具历史',
};

/** 预览类型（决定前端用图片/音视频/文本方式预览） */
export type CleanupPreviewKind = 'image' | 'audio' | 'video' | 'text' | 'none';

/** 单条扫描结果 */
export interface CleanupItem {
  /** 稳定标识（= path） */
  id: string;
  category: CleanupCategory;
  /** 分组显示名 */
  groupLabel: string;
  /** 项目内相对路径（如 assert/custom/canvas/123-a.png） */
  path: string;
  /** 文件大小（字节） */
  size: number;
  /** 时间（ISO）：历史项 = 归档时间戳（失败回退 mtime）；自定义资产 = mtime */
  time: string;
  /** 距今毫秒数（负数表示时间在未来，理论不发生） */
  ageMs: number;
  /** 历史项的所属当前资产路径（如 assert/character/陈书文/appearance.jpg） */
  ownerPath?: string;
  previewKind: CleanupPreviewKind;
}

/** 分组统计 */
export interface CleanupGroupTotal {
  count: number;
  size: number;
}

/** 扫描结果 */
export interface CleanupScanResult {
  scannedAt: string;
  olderThanDays: number;
  items: CleanupItem[];
  /** 全部结果总大小（字节） */
  totalSize: number;
  /** 各分组数量与大小（无结果的分组也返回 0） */
  groupTotals: Record<CleanupCategory, CleanupGroupTotal>;
  /** 扫描统计（供界面提示口径） */
  stats: {
    /** assert/custom 下扫描到的文件数 */
    customFiles: number;
    /** 其中被引用（不列入结果）的文件数 */
    customReferenced: number;
    /** 覆盖范围内扫描到的历史文件数 */
    historyFiles: number;
    /** 其中达到阈值（列入结果）的条数 */
    historyStale: number;
  };
}

/** 扩展名 → 预览类型 */
const PREVIEW_EXT: Record<string, CleanupPreviewKind> = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image',
  '.webp': 'image', '.svg': 'image', '.bmp': 'image',
  '.mp3': 'audio', '.wav': 'audio', '.flac': 'audio', '.ogg': 'audio',
  '.m4a': 'audio', '.aac': 'audio',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.avi': 'video',
  '.mkv': 'video', '.m4v': 'video',
  '.md': 'text', '.txt': 'text', '.json': 'text', '.csv': 'text',
  '.log': 'text', '.yml': 'text', '.yaml': 'text', '.xml': 'text',
};

/** 可解析引用的文本文件扩展名 */
const TEXT_EXTS = new Set(['.json', '.md', '.markdown', '.txt', '.yml', '.yaml', '.jsonc']);

/** 单个文本文件读取上限（超过则跳过，避免读取巨型产物） */
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

/**
 * 根据文件扩展名推断预览类型。
 *
 * @param ext 扩展名（含点号，大小写不敏感）
 * @returns 预览类型；未知类型返回 'none'
 */
export function previewKindOf(ext: string): CleanupPreviewKind {
  return PREVIEW_EXT[ext.toLowerCase()] ?? 'none';
}

/**
 * 解析历史归档文件名前缀时间戳（YYYYMMDD-HHmmss，允许 -N 同秒后缀）。
 *
 * @param fileName 历史文件名（如 20260101-120000-1.jpg）
 * @returns 解析出的时间；不匹配时返回 null
 */
export function parseHistoryStamp(fileName: string): Date | null {
  const m = fileName.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 判断历史文件所属的分组；不在覆盖范围内返回 null。
 *
 * @param relPath 项目内相对路径（含 `/history/` 段）
 * @returns 分组 key；非历史路径 / 分镜产物历史 / 未知归属返回 null
 */
export function categorizeHistoryPath(relPath: string): CleanupCategory | null {
  const idx = relPath.indexOf('/history/');
  if (idx < 0) return null;
  // 分镜产物历史（assert/scene/{集}/{镜}/{stage,voice,video}/history/...）不在清理范围内
  if (/^assert\/scene\/[^/]+\/[^/]+\/(?:stage|voice|video)\/history\//.test(relPath)) return null;
  const head = relPath.slice(0, idx);
  if (head.includes('/canvas/')) return 'canvas-history';
  if (head.startsWith('assert/character/')) return 'character-history';
  if (head.startsWith('assert/stage/')) return 'stage-history';
  if (head.startsWith('assert/prop/')) return 'prop-history';
  return null;
}

/**
 * 由历史文件路径推导所属当前资产路径（仅用于展示）。
 *
 * `A/history/{stem}/x.ext` → `A/{stem}.ext`。
 *
 * @param relPath 历史文件的项目内相对路径
 * @returns 所属资产路径；无法推导时返回 null
 */
export function historyOwnerPath(relPath: string): string | null {
  const idx = relPath.indexOf('/history/');
  if (idx < 0) return null;
  const head = relPath.slice(0, idx);
  const segments = relPath.slice(idx + '/history/'.length).split('/').filter(Boolean);
  if (segments.length < 2) return null;
  const stem = segments[0];
  const ext = path.posix.extname(segments[segments.length - 1]);
  return `${head}/${stem}${ext}`;
}

/**
 * 递归遍历目录下的全部文件（目录不存在/不可读时视为空并打印日志）。
 *
 * @param dir 目录绝对路径
 * @param onFile 文件回调（绝对路径 + 相对 dir 的正斜杠路径）
 */
async function walkFiles(
  dir: string,
  onFile: (full: string, rel: string) => Promise<void> | void,
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    // 目录不存在（如项目未创建 assert/custom）：视为空，不视为异常
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[cleanup] 读取目录失败:', dir, e);
    }
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(full, onFile);
    } else if (entry.isFile()) {
      await onFile(full, entry.name);
    }
  }
}

/** 目录遍历过程中收集到的路径集合（相对项目根，正斜杠） */
interface PathIndex {
  files: Set<string>;
  dirs: Set<string>;
}

/**
 * 收集目录下全部文件与子目录路径。
 *
 * @param rootAbs 根目录绝对路径
 * @param prefix 结果路径前缀（如 `assert/custom`）
 * @returns 文件/目录集合
 */
async function indexPaths(rootAbs: string, prefix: string): Promise<PathIndex> {
  const files = new Set<string>();
  const dirs = new Set<string>();

  async function walk(dirAbs: string, relPrefix: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[cleanup] 读取目录失败:', dirAbs, e);
      }
      return;
    }
    for (const entry of entries) {
      const full = path.join(dirAbs, entry.name);
      const rel = `${relPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        dirs.add(rel);
        await walk(full, rel);
      } else if (entry.isFile()) {
        files.add(rel);
      }
    }
  }

  await walk(rootAbs, prefix);
  return { files, dirs };
}

/**
 * 构建项目内被引用的自定义资产路径集合。
 *
 * 遍历 `prompt/**` 下全部文本文件，匹配 `custom/...` 形态的路径串：
 * 命中候选文件本身、或命中其目录前缀（目录引用）即视为被引用。
 *
 * @param project 项目名
 * @param candidates 候选自定义资产索引（`assert/custom/**`）
 * @returns 被引用的候选文件路径集合
 */
export async function collectCustomRefs(project: string, candidates: PathIndex): Promise<Set<string>> {
  const referenced = new Set<string>();
  const promptRoot = resolveProjectPath(project, 'prompt');

  /** 规范化匹配串为 `assert/custom/...`，并去掉尾随标点 */
  function normalizeMatch(raw: string): string | null {
    let s = raw.trim();
    // 去掉尾随标点（JSON/中文标点/闭合括号等，路径本身极少以这些字符结尾）
    s = s.replace(/[，。、；：,;:.!?）)】\]}>'"`\s]+$/u, '');
    if (s.startsWith('assert/')) s = s.slice('assert/'.length);
    if (!s.startsWith('custom/')) return null;
    return `assert/${s}`;
  }

  /** 命中文件或目录前缀 → 标记引用 */
  function mark(p: string): void {
    if (candidates.files.has(p)) {
      referenced.add(p);
      return;
    }
    if (candidates.dirs.has(p)) {
      const prefix = `${p}/`;
      for (const f of candidates.files) {
        if (f.startsWith(prefix)) referenced.add(f);
      }
    }
  }

  await walkFiles(promptRoot, async (full, name) => {
    const ext = path.extname(name).toLowerCase();
    if (!TEXT_EXTS.has(ext)) return;
    let text: string;
    try {
      const stat = await fs.stat(full);
      if (stat.size > MAX_TEXT_BYTES) {
        console.warn(`[cleanup] 跳过超大文本文件（> ${MAX_TEXT_BYTES} 字节）: ${full}`);
        return;
      }
      text = await fs.readFile(full, 'utf-8');
    } catch (e) {
      console.error('[cleanup] 读取引用来源文件失败:', full, e);
      return;
    }
    const re = /(?:assert\/)?custom\/[^"'`<>\n\r\t]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const p = normalizeMatch(m[0]);
      if (p) mark(p);
    }
  });

  return referenced;
}

/**
 * 扫描无引用的自定义资产。
 *
 * @param project 项目名
 * @param index 预构建的候选索引（可选；不传时内部构建，供复用）
 * @returns 结果条目与被引用文件数
 */
export async function scanUnreferencedCustomAssets(
  project: string,
  index?: PathIndex,
): Promise<{ items: CleanupItem[]; customFiles: number; customReferenced: number }> {
  const candidates = index ?? (await indexPaths(resolveProjectPath(project, 'assert/custom'), 'assert/custom'));
  const referenced = await collectCustomRefs(project, candidates);
  const items: CleanupItem[] = [];
  const now = Date.now();

  for (const rel of [...candidates.files].sort((a, b) => a.localeCompare(b, 'zh'))) {
    if (referenced.has(rel)) continue;
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(resolveProjectPath(project, rel));
    } catch {
      continue;
    }
    items.push({
      id: rel,
      category: 'custom-orphan',
      groupLabel: CLEANUP_GROUP_LABELS['custom-orphan'],
      path: rel,
      size: stat.size,
      time: stat.mtime.toISOString(),
      ageMs: now - stat.mtime.getTime(),
      previewKind: previewKindOf(path.extname(rel)),
    });
  }

  return { items, customFiles: candidates.files.size, customReferenced: referenced.size };
}

/**
 * 扫描久远的历史记录。
 *
 * @param project 项目名
 * @param olderThanDays 阈值（天）：归档时间早于该天数才纳入
 * @param now 当前时间（测试可注入）
 * @returns 结果条目、扫描到的历史文件数与达标条数
 */
export async function scanStaleHistory(
  project: string,
  olderThanDays: number,
  now: Date = new Date(),
): Promise<{ items: CleanupItem[]; historyFiles: number; historyStale: number }> {
  const items: CleanupItem[] = [];
  const thresholdMs = olderThanDays * 86400000;
  let historyFiles = 0;

  /** 收集单个 history 目录下全部文件 */
  async function collectHistoryDir(historyDirRel: string, historyDirAbs: string): Promise<void> {
    const files: string[] = [];
    async function walk(dirAbs: string, relPrefix: string): Promise<void> {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dirAbs, { withFileTypes: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('[cleanup] 读取历史目录失败:', dirAbs, e);
        }
        return;
      }
      for (const entry of entries) {
        const full = path.join(dirAbs, entry.name);
        const rel = `${relPrefix}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(full, rel);
        } else if (entry.isFile()) {
          files.push(rel);
        }
      }
    }
    await walk(historyDirAbs, historyDirRel);

    for (const rel of files) {
      const category = categorizeHistoryPath(rel);
      if (!category) continue;
      historyFiles += 1;
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(resolveProjectPath(project, rel));
      } catch {
        continue;
      }
      const stamp = parseHistoryStamp(path.posix.basename(rel));
      const time = stamp ?? stat.mtime;
      const ageMs = now.getTime() - time.getTime();
      if (ageMs <= thresholdMs) continue;
      items.push({
        id: rel,
        category,
        groupLabel: CLEANUP_GROUP_LABELS[category],
        path: rel,
        size: stat.size,
        time: time.toISOString(),
        ageMs,
        ownerPath: historyOwnerPath(rel) ?? undefined,
        previewKind: previewKindOf(path.extname(rel)),
      });
    }
  }

  /** 递归查找 history 目录（找到后不再深入其内部） */
  async function findHistoryDirs(dirAbs: string, relPrefix: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[cleanup] 读取目录失败:', dirAbs, e);
      }
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const rel = `${relPrefix}/${entry.name}`;
      if (entry.name === 'history') {
        await collectHistoryDir(rel, path.join(dirAbs, entry.name));
        continue;
      }
      await findHistoryDirs(path.join(dirAbs, entry.name), rel);
    }
  }

  for (const root of ['assert/character', 'assert/stage', 'assert/prop', 'assert/scene']) {
    await findHistoryDirs(resolveProjectPath(project, root), root);
  }

  items.sort((a, b) => (a.time === b.time ? a.path.localeCompare(b.path, 'zh') : a.time.localeCompare(b.time)));

  return { items, historyFiles, historyStale: items.length };
}

/**
 * 执行一次完整扫描（无引用自定义资产 + 久远历史记录）。
 *
 * @param project 项目名
 * @param olderThanDays 历史记录阈值（天）
 * @param now 当前时间（测试可注入）
 * @returns 扫描结果
 */
export async function scanCleanup(
  project: string,
  olderThanDays: number,
  now: Date = new Date(),
): Promise<CleanupScanResult> {
  const custom = await scanUnreferencedCustomAssets(project);
  const history = await scanStaleHistory(project, olderThanDays, now);

  const groupTotals: Record<CleanupCategory, CleanupGroupTotal> = {
    'custom-orphan': { count: 0, size: 0 },
    'canvas-history': { count: 0, size: 0 },
    'character-history': { count: 0, size: 0 },
    'stage-history': { count: 0, size: 0 },
    'prop-history': { count: 0, size: 0 },
  };
  const items = [...custom.items, ...history.items];
  let totalSize = 0;
  for (const item of items) {
    groupTotals[item.category].count += 1;
    groupTotals[item.category].size += item.size;
    totalSize += item.size;
  }

  return {
    scannedAt: now.toISOString(),
    olderThanDays,
    items,
    totalSize,
    groupTotals,
    stats: {
      customFiles: custom.customFiles,
      customReferenced: custom.customReferenced,
      historyFiles: history.historyFiles,
      historyStale: history.historyStale,
    },
  };
}

/**
 * 构建「引用检查」回调（移入回收站前二次校验用）。
 *
 * @param project 项目名
 * @returns 回调：入参为 `assert/custom/...` 相对路径，返回 true 表示仍被引用
 */
export async function createCustomRefChecker(project: string): Promise<(relPath: string) => boolean> {
  const candidates = await indexPaths(resolveProjectPath(project, 'assert/custom'), 'assert/custom');
  const referenced = await collectCustomRefs(project, candidates);
  return (relPath: string) => referenced.has(relPath);
}
