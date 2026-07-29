import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_DIR = path.resolve(__dirname, '../../../design');
const WRITABLE_PREFIXES = ['prompt', 'assert'];
const WRITABLE_ROOT_FILES = ['overview.md', 'project.json'];

function isWritableRelPath(relPath: string): boolean {
  if (!relPath || relPath.includes('..')) return false;
  // 统一为正斜杠比较（Express 参数通常已是 /）
  const normalized = relPath.replace(/\\/g, '/');
  if (WRITABLE_ROOT_FILES.includes(normalized)) return true;
  const prefix = normalized.split('/')[0];
  return WRITABLE_PREFIXES.includes(prefix ?? '');
}

export const fsRouter = Router();

interface ProjectEntry {
  name: string;
}

export interface DirEntry {
  name: string;
  type: 'file' | 'dir';
}

interface ErrorWithCode extends Error {
  code?: string;
}

/** 不限文件类型的 multer upload（用于自定义资产上传） */
const customUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

fsRouter.get('/projects', async (_req: Request, res: Response) => {
  try {
    const entries = await fs.readdir(DESIGN_DIR, { withFileTypes: true });
    const projects: ProjectEntry[] = entries
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name }));
    res.json(projects);
  } catch (err) {
    console.error('Failed to list projects:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

fsRouter.get('/fs/:project/*', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const relPath = req.params[0] || '';
    const fullPath = path.resolve(DESIGN_DIR, project, relPath);
    const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;

    if (fullPath !== path.resolve(DESIGN_DIR, project) && !fullPath.startsWith(projectRoot)) {
      res.status(403).json({ error: 'Path traversal denied' });
      return;
    }

    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const result: DirEntry[] = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file'
      }));
      res.json({ entries: result });
    } else {
      const ext = path.extname(fullPath).toLowerCase();
      // 二进制媒体/文档：直接按文件流返回，供前端预览或下载
      const binaryExts = [
        '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp',
        '.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v',
        '.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac',
        '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
        '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      ];
      if (binaryExts.includes(ext)) {
        res.sendFile(fullPath);
      } else {
        const content = await fs.readFile(fullPath, 'utf-8');
        res.type('text/plain').send(content);
      }
    }
  } catch (err) {
    const e = err as ErrorWithCode;
    if (e.code === 'ENOENT') {
      res.status(404).json({ error: 'Not found' });
    } else {
      console.error('Failed to read fs:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── 自定义资产：创建目录（须在 /* 路由前注册） ────────────────────

fsRouter.post('/fs/:project/mkdir', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const { path: dirRelPath } = req.body as { path?: string };
    if (!dirRelPath) {
      res.status(400).json({ error: 'path 必填' });
      return;
    }
    const normalized = dirRelPath.replace(/\\/g, '/');
    if (!normalized.startsWith('assert/custom/')) {
      res.status(403).json({ error: '仅支持 assert/custom/ 下创建目录' });
      return;
    }
    const fullPath = path.resolve(DESIGN_DIR, project, normalized);
    const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;
    if (!fullPath.startsWith(projectRoot)) {
      res.status(403).json({ error: 'Path traversal denied' });
      return;
    }
    await fs.mkdir(fullPath, { recursive: true });
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to mkdir:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 自定义资产：重命名 / 移动（须在 /* 路由前注册） ──────────────

fsRouter.post('/fs/:project/rename', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const { from, to } = req.body as { from?: string; to?: string };
    if (!from || !to) {
      res.status(400).json({ error: 'from 与 to 必填' });
      return;
    }
    const fromNorm = from.replace(/\\/g, '/');
    const toNorm = to.replace(/\\/g, '/');
    if (!fromNorm.startsWith('assert/custom/') || !toNorm.startsWith('assert/custom/')) {
      res.status(403).json({ error: '仅支持 assert/custom/ 下的重命名' });
      return;
    }
    const fromFull = path.resolve(DESIGN_DIR, project, fromNorm);
    const toFull = path.resolve(DESIGN_DIR, project, toNorm);
    const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;
    if (!fromFull.startsWith(projectRoot) || !toFull.startsWith(projectRoot)) {
      res.status(403).json({ error: 'Path traversal denied' });
      return;
    }
    await fs.mkdir(path.dirname(toFull), { recursive: true });
    await fs.rename(fromFull, toFull);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to rename:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 自定义资产：上传文件（须在 /* 路由前注册） ───────────────────

fsRouter.post(
  '/fs/:project/upload',
  (req: Request, res: Response, next) => {
    customUpload.single('file')(req, res, (err: unknown) => {
      if (err) {
        const e = err as { message?: string; code?: string };
        res.status(400).json({ error: e.message || '上传失败' });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      const project = req.params.project as string;
      const destRelPath = String((req.body as { path?: string }).path ?? '');
      if (!destRelPath) {
        res.status(400).json({ error: 'path 必填' });
        return;
      }
      const normalized = destRelPath.replace(/\\/g, '/');
      if (!normalized.startsWith('assert/custom/')) {
        res.status(403).json({ error: '仅支持上传到 assert/custom/ 下' });
        return;
      }
      const file = req.file;
      if (!file?.buffer?.length) {
        res.status(400).json({ error: '请选择要上传的文件' });
        return;
      }
      const fullPath = path.resolve(DESIGN_DIR, project, normalized);
      const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;
      if (!fullPath.startsWith(projectRoot)) {
        res.status(403).json({ error: 'Path traversal denied' });
        return;
      }
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, file.buffer);
      res.json({ success: true, path: normalized });
    } catch (err) {
      console.error('Failed to upload:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── 文件系统：写入文本内容（通配路由，放在具体路由之后） ─────────

fsRouter.post('/fs/:project/*', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const relPath = req.params[0] || '';
    const fullPath = path.resolve(DESIGN_DIR, project, relPath);
    const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;

    if (fullPath !== path.resolve(DESIGN_DIR, project) && !fullPath.startsWith(projectRoot)) {
      res.status(403).json({ error: 'Path traversal denied' });
      return;
    }

    if (!isWritableRelPath(relPath)) {
      res.status(403).json({
        error: 'Only prompt/, assert/, overview.md and project.json are writable',
      });
      return;
    }

    const { content } = req.body as { content: string };
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content must be a string' });
      return;
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to write fs:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── 自定义资产：删除（文件或目录递归） ──────────────────────────────

fsRouter.delete('/fs/:project/*', async (req: Request, res: Response) => {
  try {
    const project = req.params.project as string;
    const relPath = req.params[0] || '';
    const normalized = relPath.replace(/\\/g, '/');
    if (!normalized.startsWith('assert/custom/')) {
      res.status(403).json({ error: '仅支持删除 assert/custom/ 下的内容' });
      return;
    }
    const fullPath = path.resolve(DESIGN_DIR, project, normalized);
    const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;
    if (!fullPath.startsWith(projectRoot)) {
      res.status(403).json({ error: 'Path traversal denied' });
      return;
    }
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      await fs.rm(fullPath, { recursive: true, force: true });
    } else {
      await fs.unlink(fullPath);
    }
    res.json({ success: true });
  } catch (err) {
    const e = err as ErrorWithCode;
    if (e.code === 'ENOENT') {
      res.status(404).json({ error: 'Not found' });
    } else {
      console.error('Failed to delete fs:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});
