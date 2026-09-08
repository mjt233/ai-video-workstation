/**
 * 系统全局回收站：被清理的资产先移入回收站，由用户手动恢复/彻底删除，
 * 或由定时自动清理按保留期清除。
 *
 * 目录约定（**不限定项目**，所有项目共用同一个回收站）：
 * ```
 * design/.trash/{批次号}/{项目名}/{原 assert 内相对路径}
 * ```
 * 示例：`design/.trash/20260820-153000/AI的第一天/custom/canvas/123-a.png`
 * 原位置 = `design/AI的第一天/assert/custom/canvas/123-a.png`。
 *
 * 说明：
 * - 批次号 = `YYYYMMDD-HHmmss`（复用历史版本时间戳格式），一次「移入回收站」操作一个批次；
 * - 回收站与 `design/` 同卷 → 移入/恢复为原子 rename；跨卷（EXDEV）时退化为复制 + 删除；
 * - 条目时间取文件 mtime（rename 保留 mtime），缺失时回退批次号时间；
 * - `design/.trash` 为保留目录：不参与项目列表，也不允许创建同名项目。
 */
import fs from 'fs/promises';
import path from 'path';
import { formatHistoryStamp } from '../assets/history.js';
import {
  DESIGN_DIR,
  isReservedProjectName,
  resolveProjectPath,
} from '../assets/paths.js';

/** 回收站目录名（位于 design/ 下，与项目同级） */
export const TRASH_DIR_NAME = '.trash';

/** 批次号格式：YYYYMMDD-HHmmss（允许同秒冲突的 -N 后缀） */
const BATCH_ID_RE = /^\d{8}-\d{6}(?:-\d+)?$/;

/** 默认保留期（天）：用于未显式传入保留期时的「剩余天数」展示 */
export const DEFAULT_RETENTION_DAYS = 7;

/** 回收站条目（一个被移入回收站的文件） */
export interface TrashItem {
  /** 稳定标识：`{batchId}/{project}/{relPath}` */
  id: string;
  /** 批次号（一次移入操作一个批次） */
  batchId: string;
  /** 原所属项目名 */
  project: string;
  /** 原 `assert/` 内相对路径（如 custom/canvas/123-a.png） */
  relPath: string;
  /** 原项目内相对路径（如 assert/custom/canvas/123-a.png） */
  originalPath: string;
  /** 文件大小（字节） */
  size: number;
  /** 移入回收站时间（ISO；取批次号时间，批次号无法解析时回退文件 mtime） */
  trashedAt: string;
  /** 距保留期到期的剩余天数（负数 = 已超期，会被自动清理） */
  expiresInDays: number;
}

/** 回收站批次（一次「移入回收站」操作产生的全部条目） */
export interface TrashBatch {
  batchId: string;
  /** 批次创建时间（由批次号解析，ISO） */
  createdAt: string;
  items: TrashItem[];
  count: number;
  /** 批次总大小（字节） */
  size: number;
}

/** 跳过条目（附带原因，供前端提示） */
export interface TrashSkipped {
  /** 请求中的原始标识（relPath 或 trash id） */
  path: string;
  reason: string;
}

/** 回收站绝对根目录 */
export function trashRootDir(): string {
  return path.join(DESIGN_DIR, TRASH_DIR_NAME);
}

/**
 * 生成批次号（默认当前时间）。
 *
 * @param date 批次时间
 * @returns `YYYYMMDD-HHmmss`
 */
export function trashBatchId(date = new Date()): string {
  return formatHistoryStamp(date);
}

/**
 * 解析批次号中的时间。
 *
 * @param batchId 批次号（YYYYMMDD-HHmmss，可带 -N 后缀）
 * @returns 解析后的时间；格式非法时返回 null
 */
export function parseBatchTime(batchId: string): Date | null {
  const m = batchId.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
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
 * 校验项目名可用于回收站路径（防止 `../` 逃逸与保留目录）。
 *
 * @param project 项目名
 * @returns 规范化后的项目名
 * @throws code=INVALID 名称为空、含路径分隔符、`.`/`..` 或以 `.` 开头（保留目录）
 */
export function assertTrashProjectName(project: unknown): string {
  const name = typeof project === 'string' ? project.trim() : '';
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name) || isReservedProjectName(name)) {
    throw Object.assign(new Error(`项目名不合法: ${String(project ?? '')}`), { code: 'INVALID' });
  }
  return name;
}

/**
 * 校验 `assert/` 内相对路径可用于回收站操作。
 *
 * @param relPath 原始相对路径
 * @returns 规范化后的路径（正斜杠、无首尾斜杠）
 * @throws code=INVALID 非 assert/ 前缀或含 `..`
 */
export function assertTrashRelPath(relPath: unknown): string {
  const normalized = (typeof relPath === 'string' ? relPath : '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.startsWith('assert/') || normalized.includes('..')) {
    throw Object.assign(new Error(`路径非法（须为 assert/ 下）: ${String(relPath ?? '')}`), { code: 'INVALID' });
  }
  return normalized;
}

/**
 * 计算某个文件在回收站中的绝对路径。
 *
 * @param batchId 批次号
 * @param project 项目名
 * @param relPath `assert/` 内相对路径
 * @returns 回收站内的绝对路径
 */
export function trashItemFullPath(batchId: string, project: string, relPath: string): string {
  const inner = relPath.replace(/^assert\//, '');
  return path.join(trashRootDir(), batchId, project, inner);
}

/**
 * 移动文件（跨卷 EXDEV 时退化为复制 + 删除）。
 *
 * @param src 源绝对路径
 * @param dest 目标绝对路径
 */
async function moveFile(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(src, dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    await fs.copyFile(src, dest);
    await fs.unlink(src);
  }
}

/**
 * 目标已存在时追加 `-1`、`-2`… 后缀，返回可用路径。
 *
 * @param destFull 期望的目标绝对路径
 * @returns 可用的目标绝对路径
 */
async function uniqueDest(destFull: string): Promise<string> {
  const dir = path.dirname(destFull);
  const ext = path.extname(destFull);
  const stem = path.basename(destFull, ext);
  let candidate = destFull;
  let n = 1;
  for (;;) {
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
    candidate = path.join(dir, `${stem}-${n}${ext}`);
    n += 1;
  }
}

/**
 * 从底向上清理空目录（回收站批次目录 / 项目目录）。
 *
 * @param startDir 起始目录绝对路径
 * @param stopDir 停止目录（不含；通常是回收站根目录）
 */
async function pruneEmptyDirs(startDir: string, stopDir: string): Promise<void> {
  let current = startDir;
  while (current.startsWith(stopDir) && current !== stopDir) {
    let entries: string[];
    try {
      entries = await fs.readdir(current);
    } catch {
      return;
    }
    if (entries.length > 0) return;
    try {
      await fs.rmdir(current);
    } catch (e) {
      // 目录已被并发删除/非空：无需处理（清理收尾操作，失败不影响主流程）
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && (e as NodeJS.ErrnoException).code !== 'ENOTEMPTY') {
        console.error('[trash] 清理空目录失败:', e);
      }
      return;
    }
    current = path.dirname(current);
  }
}

/**
 * 把项目内文件移入全局回收站。
 *
 * 校验与保护：
 * - 路径须为 `assert/` 下且不含 `..`；
 * - 仅接受**文件**（不接受目录，避免误清理整棵目录）；
 * - `refChecker` 返回 true（仍被引用）时跳过（供调用方在扫描后二次校验引用）；
 * - 同名冲突自动追加 `-1`、`-2` 后缀。
 *
 * @param project 项目名
 * @param relPaths `assert/` 内相对路径数组
 * @param options.batchId 指定批次号（默认按当前时间生成）
 * @param options.refChecker 引用检查回调（返回 true 表示仍被引用 → 跳过）
 * @returns 批次号、成功移入的路径、跳过项及原因
 */
export async function moveToTrash(
  project: string,
  relPaths: string[],
  options: { batchId?: string; refChecker?: (relPath: string) => boolean } = {},
): Promise<{ batchId: string; moved: string[]; skipped: TrashSkipped[] }> {
  const batchId = options.batchId ?? trashBatchId();
  const moved: string[] = [];
  const skipped: TrashSkipped[] = [];
  const seen = new Set<string>();

  for (const raw of relPaths) {
    let rel: string;
    try {
      rel = assertTrashRelPath(raw);
    } catch (e) {
      skipped.push({ path: String(raw ?? ''), reason: (e as Error).message });
      continue;
    }
    if (seen.has(rel)) continue;
    seen.add(rel);

    const srcFull = resolveProjectPath(project, rel);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(srcFull);
    } catch {
      skipped.push({ path: rel, reason: '文件不存在' });
      continue;
    }
    if (!stat.isFile()) {
      skipped.push({ path: rel, reason: '仅支持清理文件（不接受目录）' });
      continue;
    }
    if (options.refChecker?.(rel)) {
      skipped.push({ path: rel, reason: '仍被项目引用，已跳过' });
      continue;
    }

    const destFull = await uniqueDest(trashItemFullPath(batchId, project, rel));
    try {
      await moveFile(srcFull, destFull);
      moved.push(rel);
    } catch (e) {
      console.error(`[trash] 移入回收站失败: ${rel}`, e);
      skipped.push({ path: rel, reason: '移入回收站失败（详见服务端日志）' });
    }
  }

  return { batchId, moved, skipped };
}

/**
 * 递归收集目录下所有文件的绝对路径。
 *
 * @param dir 目录绝对路径
 * @param out 输出数组（绝对路径）
 */
async function collectFiles(dir: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    // 目录不存在/不可读：视为空（回收站内容可能被并发清理）
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[trash] 读取回收站目录失败:', e);
    }
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

/**
 * 列出全局回收站内容（按批次分组，新批次在前）。
 *
 * @param options.retentionDays 保留期（天，用于计算剩余天数，默认 7）
 * @param options.now 当前时间（默认 now，测试可注入）
 * @returns 批次列表与总文件数/总大小
 */
export async function listTrash(
  options: { retentionDays?: number; now?: Date } = {},
): Promise<{ batches: TrashBatch[]; count: number; totalSize: number }> {
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const now = options.now ?? new Date();
  const root = trashRootDir();
  const batches: TrashBatch[] = [];
  let count = 0;
  let totalSize = 0;

  let batchDirs: import('node:fs').Dirent[];
  try {
    batchDirs = await fs.readdir(root, { withFileTypes: true });
  } catch {
    // 回收站目录不存在：空回收站
    return { batches, count, totalSize };
  }

  for (const batchEntry of batchDirs) {
    if (!batchEntry.isDirectory() || !BATCH_ID_RE.test(batchEntry.name)) continue;
    const batchId = batchEntry.name;
    const batchTime = parseBatchTime(batchId);
    const batchDir = path.join(root, batchId);
    const items: TrashItem[] = [];

    const projectDirs = await fs.readdir(batchDir, { withFileTypes: true }).catch((e) => {
      // 批次目录被并发删除：跳过该批次
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[trash] 读取回收站批次目录失败:', e);
      }
      return [] as import('node:fs').Dirent[];
    });

    for (const projectEntry of projectDirs) {
      if (!projectEntry.isDirectory()) continue;
      const project = projectEntry.name;
      const projectDir = path.join(batchDir, project);
      const files: string[] = [];
      await collectFiles(projectDir, files);
      for (const full of files) {
        let stat: Awaited<ReturnType<typeof fs.stat>>;
        try {
          stat = await fs.stat(full);
        } catch {
          continue;
        }
        const inner = path.relative(projectDir, full).split(path.sep).join('/');
        const relPath = `assert/${inner}`;
        // 保留期从「移入回收站的时间」起算（批次号即移入时间），而非文件自身 mtime：
        // 否则一个很久以前生成、今天才被清理的文件会立刻被自动清理删除。
        const trashedAt = (batchTime ?? stat.mtime).toISOString();
        const ageDays = (now.getTime() - Date.parse(trashedAt)) / 86400000;
        items.push({
          id: `${batchId}/${project}/${relPath}`,
          batchId,
          project,
          relPath,
          originalPath: relPath,
          size: stat.size,
          trashedAt,
          expiresInDays: Math.ceil(retentionDays - ageDays),
        });
        count += 1;
        totalSize += stat.size;
      }
    }

    if (!items.length) continue;
    const size = items.reduce((sum, item) => sum + item.size, 0);
    batches.push({
      batchId,
      createdAt: (batchTime ?? now).toISOString(),
      items,
      count: items.length,
      size,
    });
  }

  batches.sort((a, b) => b.batchId.localeCompare(a.batchId, 'en'));
  return { batches, count, totalSize };
}

/**
 * 从回收站恢复文件到原项目位置。
 *
 * 目标位置已存在同名文件时**跳过**（不覆盖现有资产）。
 *
 * @param items 待恢复条目（批次号 + 项目名 + assert 内相对路径）
 * @returns 恢复成功的条目与原路径、跳过项及原因
 */
export async function restoreTrash(
  items: Array<{ batchId?: unknown; project?: unknown; relPath?: unknown }>,
): Promise<{ restored: Array<{ project: string; path: string }>; skipped: TrashSkipped[] }> {
  const restored: Array<{ project: string; path: string }> = [];
  const skipped: TrashSkipped[] = [];

  for (const item of items) {
    const batchId = typeof item.batchId === 'string' ? item.batchId : '';
    let project: string;
    let relPath: string;
    try {
      if (!BATCH_ID_RE.test(batchId)) {
        throw Object.assign(new Error(`批次号非法: ${batchId}`), { code: 'INVALID' });
      }
      project = assertTrashProjectName(item.project);
      relPath = assertTrashRelPath(item.relPath);
    } catch (e) {
      skipped.push({ path: `${batchId}/${String(item.project ?? '')}/${String(item.relPath ?? '')}`, reason: (e as Error).message });
      continue;
    }

    const srcFull = trashItemFullPath(batchId, project, relPath);
    try {
      const stat = await fs.stat(srcFull);
      if (!stat.isFile()) {
        skipped.push({ path: relPath, reason: '回收站条目不是文件' });
        continue;
      }
    } catch {
      skipped.push({ path: relPath, reason: '回收站中不存在该文件' });
      continue;
    }

    const destFull = resolveProjectPath(project, relPath);
    try {
      await fs.access(destFull);
      skipped.push({ path: relPath, reason: '原位置已存在同名文件，已跳过' });
      continue;
    } catch {
      // 目标不存在：可安全恢复
    }

    try {
      await moveFile(srcFull, destFull);
      restored.push({ project, path: relPath });
      await pruneEmptyDirs(path.dirname(srcFull), trashRootDir());
    } catch (e) {
      console.error(`[trash] 恢复失败: ${batchId}/${project}/${relPath}`, e);
      skipped.push({ path: relPath, reason: '恢复失败（详见服务端日志）' });
    }
  }

  return { restored, skipped };
}

/**
 * 彻底删除回收站条目（不可恢复）。
 *
 * 三种用法（优先级：all > batchId > items）：
 * - `all: true`：清空整个回收站；
 * - `batchId`：删除指定批次；
 * - `items`：删除指定条目。
 *
 * @param options 删除范围
 * @returns 删除文件数与释放空间（字节）
 */
export async function purgeTrash(
  options: { items?: Array<{ batchId?: unknown; project?: unknown; relPath?: unknown }>; batchId?: string; all?: boolean },
): Promise<{ deleted: number; freed: number }> {
  const root = trashRootDir();
  let deleted = 0;
  let freed = 0;

  if (options.all) {
    const listed = await listTrash();
    deleted = listed.count;
    freed = listed.totalSize;
    await fs.rm(root, { recursive: true, force: true });
    return { deleted, freed };
  }

  if (options.batchId) {
    const batchId = options.batchId;
    if (!BATCH_ID_RE.test(batchId)) {
      throw Object.assign(new Error(`批次号非法: ${batchId}`), { code: 'INVALID' });
    }
    const batchDir = path.join(root, batchId);
    const files: string[] = [];
    await collectFiles(batchDir, files);
    for (const full of files) {
      const stat = await fs.stat(full).catch(() => null);
      if (stat?.isFile()) {
        freed += stat.size;
        deleted += 1;
      }
    }
    await fs.rm(batchDir, { recursive: true, force: true });
    return { deleted, freed };
  }

  for (const item of options.items ?? []) {
    const batchId = typeof item.batchId === 'string' ? item.batchId : '';
    let project: string;
    let relPath: string;
    try {
      if (!BATCH_ID_RE.test(batchId)) {
        throw Object.assign(new Error(`批次号非法: ${batchId}`), { code: 'INVALID' });
      }
      project = assertTrashProjectName(item.project);
      relPath = assertTrashRelPath(item.relPath);
    } catch (e) {
      console.error('[trash] 彻底删除跳过非法条目:', (e as Error).message);
      continue;
    }
    const full = trashItemFullPath(batchId, project, relPath);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isFile()) continue;
    try {
      await fs.unlink(full);
      deleted += 1;
      freed += stat.size;
      await pruneEmptyDirs(path.dirname(full), root);
    } catch (e) {
      console.error(`[trash] 彻底删除失败: ${batchId}/${project}/${relPath}`, e);
    }
  }

  return { deleted, freed };
}
