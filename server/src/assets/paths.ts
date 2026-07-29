import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DESIGN_DIR = path.resolve(__dirname, '../../../design');

const FORBIDDEN_NAME = /[\\/:*?"<>|]/;
export const POSITIVE_INT = /^[1-9]\d*$/;

export function projectRoot(project: string): string {
  return path.resolve(DESIGN_DIR, project);
}

/** 将 project 相对路径解析为绝对路径；越界抛错 */
export function resolveProjectPath(project: string, relPath: string): string {
  const root = projectRoot(project);
  const full = path.resolve(root, relPath);
  const rootWithSep = root + path.sep;
  if (full !== root && !full.startsWith(rootWithSep)) {
    throw Object.assign(new Error('Path traversal denied'), { code: 'INVALID' });
  }
  return full;
}

export function assertSafeName(name: string, label = '名称'): void {
  const trimmed = name.trim();
  if (!trimmed) {
    throw Object.assign(new Error(`${label}不能为空`), { code: 'INVALID' });
  }
  if (trimmed !== name) {
    throw Object.assign(new Error(`${label}不能有首尾空白`), { code: 'INVALID' });
  }
  if (FORBIDDEN_NAME.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw Object.assign(new Error(`${label}包含非法字符`), { code: 'INVALID' });
  }
}

export function assertPositiveIntId(id: string, label: string): void {
  if (!POSITIVE_INT.test(id)) {
    throw Object.assign(new Error(`${label}必须是正整数`), { code: 'INVALID' });
  }
}

export async function pathExists(fullPath: string): Promise<boolean> {
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(fullPath: string): Promise<void> {
  await fs.mkdir(fullPath, { recursive: true });
}

export async function listNumericDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && POSITIVE_INT.test(e.name))
      .map(e => e.name)
      .sort((a, b) => Number(a) - Number(b));
  } catch {
    return [];
  }
}

export async function nextNumericId(dir: string): Promise<string> {
  const ids = await listNumericDirNames(dir);
  if (!ids.length) return '1';
  return String(Math.max(...ids.map(Number)) + 1);
}

export function httpError(res: import('express').Response, err: unknown, fallback = 'Internal server error'): void {
  const e = err as { code?: string; message?: string; refs?: unknown };
  if (e?.code === 'INVALID') {
    res.status(400).json({ error: e.message, code: 'INVALID' });
    return;
  }
  if (e?.code === 'EXISTS') {
    res.status(409).json({ error: e.message, code: 'EXISTS' });
    return;
  }
  if (e?.code === 'IN_USE') {
    res.status(409).json({ error: e.message, code: 'IN_USE', refs: e.refs ?? [] });
    return;
  }
  if (e?.code === 'NOT_FOUND') {
    res.status(404).json({ error: e.message, code: 'NOT_FOUND' });
    return;
  }
  if (e?.code === 'CONFLICT') {
    res.status(409).json({ error: e.message, code: 'CONFLICT' });
    return;
  }
  if (e?.code === 'LAST_ONE') {
    res.status(409).json({ error: e.message, code: 'LAST_ONE' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: fallback });
}
