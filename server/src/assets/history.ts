import fs from 'fs/promises';
import path from 'path';
import { pathExists, resolveProjectPath } from './paths.js';

/** 时间戳文件名：YYYYMMDD-HHmmss，同秒冲突时追加 -N */
export function formatHistoryStamp(date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * 当前资产路径 → 历史目录
 * assert/character/陈书文/appearance.jpg → assert/character/陈书文/history/appearance/
 * assert/scene/1/1/stage/0.jpg → assert/scene/1/1/stage/history/0/
 */
export function historyDirForAsset(assetRelPath: string): string {
  const normalized = assetRelPath.replace(/\\/g, '/');
  const dir = path.posix.dirname(normalized);
  const base = path.posix.basename(normalized);
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  return `${dir}/history/${stem}`;
}

export function assertIsAssertPath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw Object.assign(new Error('路径非法'), { code: 'INVALID' });
  }
  if (!normalized.startsWith('assert/')) {
    throw Object.assign(new Error('仅支持 assert/ 下的资产'), { code: 'INVALID' });
  }
  return normalized;
}

/** 允许用户上传覆盖的图片资产路径（与生成产物路径一致） */
const UPLOADABLE_IMAGE_PATHS = [
  /^assert\/character\/[^/]+\/appearance\.jpg$/u,
  /^assert\/stage\/[^/]+\/[^/]+\.jpg$/u,
  /^assert\/scene\/[1-9]\d*\/[1-9]\d*\/stage\/\d+\.jpg$/u,
];

/**
 * 校验是否为可上传的图片资产路径。
 * @returns 规范化后的 assert 相对路径
 */
export function assertUploadableImagePath(relPath: string): string {
  const normalized = assertIsAssertPath(relPath);
  if (!UPLOADABLE_IMAGE_PATHS.some((re) => re.test(normalized))) {
    throw Object.assign(
      new Error('仅支持上传角色外观、场景设定图或分镜场景图'),
      { code: 'INVALID' },
    );
  }
  return normalized;
}

/**
 * 将上传内容写入资产路径：若已有当前资产则先归档历史，再写入新文件。
 */
export async function saveUploadedAsset(
  project: string,
  assetRelPath: string,
  data: Buffer,
): Promise<{ path: string; archived: string | null }> {
  const rel = assertUploadableImagePath(assetRelPath);
  const archived = await archiveExistingAsset(project, rel);
  const full = resolveProjectPath(project, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return { path: rel, archived };
}

/**
 * 若当前资产已存在，则移入 history/{stem}/{timestamp}{ext}，再返回归档相对路径；
 * 不存在则返回 null。
 */
export async function archiveExistingAsset(
  project: string,
  assetRelPath: string,
  date = new Date(),
): Promise<string | null> {
  const rel = assertIsAssertPath(assetRelPath);
  const full = resolveProjectPath(project, rel);
  if (!(await pathExists(full))) return null;

  const ext = path.extname(full);
  const histDirRel = historyDirForAsset(rel);
  const histDirFull = resolveProjectPath(project, histDirRel);
  await fs.mkdir(histDirFull, { recursive: true });

  const stamp = formatHistoryStamp(date);
  let destRel = `${histDirRel}/${stamp}${ext}`;
  let destFull = resolveProjectPath(project, destRel);
  let n = 1;
  while (await pathExists(destFull)) {
    destRel = `${histDirRel}/${stamp}-${n}${ext}`;
    destFull = resolveProjectPath(project, destRel);
    n += 1;
  }

  await fs.rename(full, destFull);
  return destRel;
}

export interface HistoryVersion {
  name: string;
  path: string;
  mtime: string;
  size: number;
}

export async function listAssetHistory(
  project: string,
  assetRelPath: string,
): Promise<HistoryVersion[]> {
  const rel = assertIsAssertPath(assetRelPath);
  const histDirRel = historyDirForAsset(rel);
  const histDirFull = resolveProjectPath(project, histDirRel);
  if (!(await pathExists(histDirFull))) return [];

  const ext = path.extname(rel).toLowerCase();
  const entries = await fs.readdir(histDirFull, { withFileTypes: true });
  const versions: HistoryVersion[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (ext && path.extname(entry.name).toLowerCase() !== ext) continue;
    const fileRel = `${histDirRel}/${entry.name}`;
    const full = resolveProjectPath(project, fileRel);
    const stat = await fs.stat(full);
    versions.push({
      name: entry.name,
      path: fileRel,
      mtime: stat.mtime.toISOString(),
      size: stat.size,
    });
  }

  // 按文件名时间戳降序（新→旧）；同前缀时 -N 自然排在后面
  versions.sort((a, b) => b.name.localeCompare(a.name, 'en'));
  return versions;
}

/**
 * 将历史版本激活为当前：当前文件归档，历史文件移到当前路径。
 */
export async function activateHistoryVersion(
  project: string,
  assetRelPath: string,
  versionRelPath: string,
): Promise<{ archived: string | null; current: string }> {
  const currentRel = assertIsAssertPath(assetRelPath);
  const versionRel = assertIsAssertPath(versionRelPath);

  const expectedDir = historyDirForAsset(currentRel);
  const versionDir = path.posix.dirname(versionRel);
  if (versionDir !== expectedDir) {
    throw Object.assign(new Error('历史版本与当前资产不匹配'), { code: 'INVALID' });
  }

  const versionFull = resolveProjectPath(project, versionRel);
  if (!(await pathExists(versionFull))) {
    throw Object.assign(new Error('历史版本不存在'), { code: 'NOT_FOUND' });
  }

  const currentExt = path.extname(currentRel).toLowerCase();
  const versionExt = path.extname(versionRel).toLowerCase();
  if (currentExt !== versionExt) {
    throw Object.assign(new Error('历史版本扩展名与当前资产不一致'), { code: 'INVALID' });
  }

  const archived = await archiveExistingAsset(project, currentRel);
  const currentFull = resolveProjectPath(project, currentRel);
  await fs.mkdir(path.dirname(currentFull), { recursive: true });
  await fs.rename(versionFull, currentFull);

  return { archived, current: currentRel };
}

/**
 * 删除指定历史版本文件。
 * 仅允许删除当前资产对应 history 目录下的文件，不会影响当前使用版本。
 */
export async function deleteHistoryVersion(
  project: string,
  assetRelPath: string,
  versionRelPath: string,
): Promise<{ deleted: string }> {
  const currentRel = assertIsAssertPath(assetRelPath);
  const versionRel = assertIsAssertPath(versionRelPath);

  const expectedDir = historyDirForAsset(currentRel);
  const versionDir = path.posix.dirname(versionRel);
  if (versionDir !== expectedDir) {
    throw Object.assign(new Error('历史版本与当前资产不匹配'), { code: 'INVALID' });
  }

  const versionFull = resolveProjectPath(project, versionRel);
  if (!(await pathExists(versionFull))) {
    throw Object.assign(new Error('历史版本不存在'), { code: 'NOT_FOUND' });
  }

  const currentExt = path.extname(currentRel).toLowerCase();
  const versionExt = path.extname(versionRel).toLowerCase();
  if (currentExt !== versionExt) {
    throw Object.assign(new Error('历史版本扩展名与当前资产不一致'), { code: 'INVALID' });
  }

  await fs.unlink(versionFull);
  return { deleted: versionRel };
}
