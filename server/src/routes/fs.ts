import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_DIR = path.resolve(__dirname, '../../../design');
const WRITABLE_PREFIXES = ['prompt', 'assert'];

export const fsRouter = Router();

interface ProjectEntry {
  name: string;
}

interface DirEntry {
  name: string;
  type: 'file' | 'dir';
}

interface ErrorWithCode extends Error {
  code?: string;
}

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
      const binaryExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.flac', '.mp3', '.wav'];
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

    const prefix = relPath.split('/')[0];
    if (!WRITABLE_PREFIXES.includes(prefix)) {
      res.status(403).json({ error: 'Only prompt/ and assert/ paths are writable' });
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
