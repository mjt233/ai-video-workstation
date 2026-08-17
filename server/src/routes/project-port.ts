import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import multer from 'multer';
import { openPromise, type Entry } from 'yauzl';
import { ZipArchive } from 'archiver';
import { DESIGN_DIR } from './fs.js';
import { FsRouteError, isUnsafeZipEntry } from './fs-path.js';
import { extractZipTo } from './zip-extract.js';

export { isUnsafeZipEntry };

/** 导入上传的 multer 实例：diskStorage 落盘系统临时目录，上限 8GB（与自定义资产上传一致） */
const importUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => {
      cb(null, `dsh-import-${Date.now()}-${Math.round(Math.random() * 1e9)}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 * 1024 }, // 8GB
});

export const projectPortRouter = Router();

/**
 * 校验导入/导出的项目名合法性（与新建项目规则保持一致）：
 * 必填、不得为 . 或 ..、不得包含 / 或 \、长度不超过 64。
 *
 * @param name 待校验的项目名
 * @throws FsRouteError(400) 当名称非法时
 */
export function validateImportName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new FsRouteError(400, '项目名必填');
  }
  if (trimmed === '.' || trimmed === '..' || /[\\/]/.test(trimmed) || trimmed.length > 64) {
    throw new FsRouteError(400, '项目名不合法：不能包含 / 或 \\，长度不超过 64 个字符');
  }
}

/** 解压后临时目录的顶层条目（用于识别项目名） */
export interface ExtractedEntry {
  name: string;
  isDirectory: boolean;
}

/**
 * 从解压结果推导项目名：
 * 1. 压缩包内仅含单个顶层目录 → 取该目录名（项目以顶层目录形式打包）；
 * 2. 否则视为扁平结构（无外层目录），取上传文件名去掉 .zip 后缀后的 basename。
 *
 * @param entries 解压目录的顶层条目列表
 * @param originalFilename 上传的原始文件名（用于扁平结构兜底命名）
 * @returns 合法的项目名
 * @throws FsRouteError(400) 无法推导出合法项目名时
 */
export function deriveProjectName(entries: ExtractedEntry[], originalFilename: string): string {
  const topDirs = entries.filter((e) => e.isDirectory);
  if (entries.length === 1 && topDirs.length === 1) {
    validateImportName(topDirs[0].name);
    return topDirs[0].name;
  }
  const baseName = path.basename(originalFilename.replace(/\\/g, '/')).replace(/\.zip$/i, '');
  validateImportName(baseName);
  return baseName;
}

/**
 * 解压前预扫描 zip 全部条目（仅读中央目录元数据，不解压数据），
 * 发现危险条目立即中止并报错，确保任何写入发生前已完成校验。
 *
 * @param zipPath zip 文件绝对路径
 * @throws FsRouteError(400) 解析失败或包含不安全路径时
 */
export async function validateZipEntries(zipPath: string): Promise<void> {
  let zipfile;
  try {
    zipfile = await openPromise(zipPath, { lazyEntries: true });
  } catch (err) {
    throw new FsRouteError(400, `压缩包解析失败：${err instanceof Error ? err.message : '无法读取 zip 文件'}`);
  }
  return new Promise<void>((resolve, reject) => {
    zipfile.on('error', (err: Error) => {
      reject(new FsRouteError(400, `压缩包解析失败：${err.message}`));
    });
    zipfile.on('entry', (entry: Entry) => {
      if (isUnsafeZipEntry(entry.fileName)) {
        const badName = entry.fileName;
        zipfile.close();
        reject(new FsRouteError(400, `压缩包包含不安全路径：${badName}`));
        return;
      }
      zipfile.readEntry();
    });
    zipfile.on('end', () => resolve());
    zipfile.readEntry();
  });
}

/**
 * 导出整个项目：将 design/{project}/ 目录打包为 zip 流式返回。
 *
 * zip 内以项目名为顶层目录（导入时据此自动识别项目名）。
 * 压缩级别使用 level 1（媒体文件已高度压缩，追求打包速度）；
 * 客户端断开时中止打包，避免无效 IO。
 *
 * @param req 请求（路径参数 project 为项目名）
 * @param res 响应（application/zip 流）
 */
projectPortRouter.get('/projects/:project/export', async (req: Request, res: Response) => {
  try {
    const projectName = req.params.project as string;
    validateImportName(projectName);
    const projectDir = path.resolve(DESIGN_DIR, projectName);
    const designRoot = path.resolve(DESIGN_DIR) + path.sep;
    if (!projectDir.startsWith(designRoot)) {
      res.status(403).json({ error: 'Path traversal denied' });
      return;
    }
    try {
      const stat = await fs.stat(projectDir);
      if (!stat.isDirectory()) {
        res.status(404).json({ error: `项目「${projectName}」不存在` });
        return;
      }
    } catch {
      res.status(404).json({ error: `项目「${projectName}」不存在` });
      return;
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="project.zip"; filename*=UTF-8''${encodeURIComponent(projectName)}.zip`,
    );

    const archive = new ZipArchive({ zlib: { level: 1 } });
    let completed = false;
    let clientGone = false;

    // 打包过程非致命警告（如个别文件被并发删除）仅记录，不中断导出
    archive.on('warning', (err) => {
      console.warn(`[export] 项目「${projectName}」打包警告: ${err.message}`);
    });
    archive.on('error', (err) => {
      if (clientGone) return;
      console.error(`[export] 项目「${projectName}」打包失败:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: '导出失败，请稍后重试' });
      } else {
        res.destroy();
      }
    });
    res.on('finish', () => {
      completed = true;
    });
    res.on('close', () => {
      // 正常完成时 close 晚于 finish；仅当客户端中途断开才中止打包
      if (!completed) {
        clientGone = true;
        archive.abort();
      }
    });

    archive.pipe(res);
    archive.directory(projectDir, projectName);
    await archive.finalize();
  } catch (err) {
    if (err instanceof FsRouteError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Failed to export project:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

/**
 * 判断导入请求是否携带覆盖标记。
 *
 * @param value multer 解析后的表单字段值（字符串）
 * @returns 值为 'true' 或 '1' 时返回 true
 */
function isOverwriteFlag(value: unknown): boolean {
  return value === 'true' || value === '1';
}

/**
 * 导入项目：上传 zip 压缩包，解压到系统临时目录后整体移入 design/ 下。
 *
 * 流程：校验扩展名与条目安全 → 预扫描全部条目 → 解压到临时目录 →
 * 识别项目名（显式 name > 单顶层目录名 > 文件名去 .zip）→
 * 解包外壳目录（导出格式含项目名顶层目录，导入时展开为项目内容）→
 * 处理同名冲突（无覆盖标记返回 409）→ 原子移入 design/{name}。
 * 任何步骤失败都会清理临时目录，不会在 design/ 留下半成品。
 *
 * 表单字段：
 * - file：zip 文件（必填）
 * - name：可选，导入后的项目名（覆盖自动识别）
 * - overwrite：可选，'true'/'1' 表示允许覆盖同名项目
 *
 * @param req 请求
 * @param res 响应（成功 201 返回 { name }）
 */
projectPortRouter.post(
  '/projects/import',
  (req: Request, res: Response, next) => {
    importUpload.single('file')(req, res, (err: unknown) => {
      if (err) {
        const e = err as { message?: string; code?: string };
        const msg = e.code === 'LIMIT_FILE_SIZE' ? '文件大小超过 8GB 限制' : (e.message || '上传失败');
        res.status(400).json({ error: msg });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    const file = req.file;
    const tmpDir = path.join(os.tmpdir(), `dsh-import-${Date.now()}-${Math.round(Math.random() * 1e9)}`);
    try {
      if (!file?.size) {
        res.status(400).json({ error: '请选择要上传的 zip 文件' });
        return;
      }
      if (path.extname(file.originalname).toLowerCase() !== '.zip') {
        res.status(400).json({ error: '仅支持 .zip 压缩包' });
        return;
      }

      // 先全量校验条目安全，再解压，避免任何写入发生在校验之前
      await validateZipEntries(file.path);
      await fs.mkdir(tmpDir, { recursive: true });
      // 流式解压（自研 yauzl 实现）：extract-zip 在写流背压下会流死锁导致请求悬挂，故不再使用
      await extractZipTo(file.path, tmpDir);

      // 解压后读取临时目录顶层条目（项目名识别与外壳目录判定共用）
      const entries = (await fs.readdir(tmpDir, { withFileTypes: true })).map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
      }));
      // 压缩包内唯一的顶层目录即项目的「外壳」目录（本项目导出格式）；扁平压缩包无外壳
      const wrapperDir = entries.length === 1 && entries[0].isDirectory ? entries[0].name : null;
      // 识别项目名：显式 name 优先，其次单顶层目录名，最后文件名去 .zip
      let projectName: string;
      const overrideName = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (overrideName) {
        validateImportName(overrideName);
        projectName = overrideName;
      } else {
        projectName = deriveProjectName(entries, file.originalname);
      }
      // 实际内容根目录：有外壳目录时指向外壳内部，避免把外壳目录嵌套进新项目
      const contentRoot = wrapperDir ? path.join(tmpDir, wrapperDir) : tmpDir;

      const designRoot = path.resolve(DESIGN_DIR) + path.sep;
      const destDir = path.resolve(DESIGN_DIR, projectName);
      if (!destDir.startsWith(designRoot)) {
        res.status(403).json({ error: 'Path traversal denied' });
        return;
      }

      const exists = await fs.access(destDir).then(() => true).catch(() => false);
      if (exists) {
        if (!isOverwriteFlag(req.body.overwrite)) {
          res.status(409).json({ error: `项目「${projectName}」已存在`, name: projectName });
          return;
        }
        await fs.rm(destDir, { recursive: true, force: true });
      }

      await fs.mkdir(DESIGN_DIR, { recursive: true });
      // 内容根目录原子移入；跨盘（EXDEV）时退化为复制后清理
      try {
        await fs.rename(contentRoot, destDir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
        await fs.cp(contentRoot, destDir, { recursive: true });
      }
      res.status(201).json({ name: projectName });
    } catch (err) {
      if (err instanceof FsRouteError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error('Failed to import project:', err);
      res.status(500).json({ error: '导入失败，请确认压缩包格式正确' });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      if (file?.path) await fs.unlink(file.path).catch(() => {});
    }
  },
);
