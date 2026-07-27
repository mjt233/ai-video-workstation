import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_DIR = path.resolve(__dirname, '../../../design');
const ALLOWED_PREFIXES = ['prompt', 'assert'];

export const fsRouter = Router();

// GET /api/projects — list projects
fsRouter.get('/projects', async (req, res) => {
  try {
    const entries = await fs.readdir(DESIGN_DIR, { withFileTypes: true });
    const projects = entries
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name }));
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fs/:project/:path(*) — read file or directory listing
fsRouter.get('/fs/:project/*', async (req, res) => {
  try {
    const project = req.params.project;
    const relPath = req.params[0] || '';
    const fullPath = path.resolve(DESIGN_DIR, project, relPath);
    const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;

    if (fullPath !== path.resolve(DESIGN_DIR, project) && !fullPath.startsWith(projectRoot)) {
      return res.status(403).json({ error: 'Path traversal denied' });
    }

    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      res.json({
        entries: entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file'
        }))
      });
    } else {
      const ext = path.extname(fullPath).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.flac', '.mp3', '.wav'].includes(ext)) {
        res.sendFile(fullPath);
      } else {
        const content = await fs.readFile(fullPath, 'utf-8');
        res.send(content);
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.status(404).json({ error: 'Not found' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// POST /api/fs/:project/:path(*) — write file
fsRouter.post('/fs/:project/*', async (req, res) => {
  try {
    const project = req.params.project;
    const relPath = req.params[0] || '';
    const fullPath = path.resolve(DESIGN_DIR, project, relPath);
    const projectRoot = path.resolve(DESIGN_DIR, project) + path.sep;

    if (fullPath !== path.resolve(DESIGN_DIR, project) && !fullPath.startsWith(projectRoot)) {
      return res.status(403).json({ error: 'Path traversal denied' });
    }

    const prefix = relPath.split('/')[0];
    if (!ALLOWED_PREFIXES.includes(prefix)) {
      return res.status(403).json({ error: 'Only prompt/ and assert/ paths are writable' });
    }

    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content must be a string' });
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
