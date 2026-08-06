import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DIR = __dirname;

/**
 * 自动发现并注册所有 Provider 插件。
 *
 * 扫描 providers/ 下各子目录，import 其 index.ts（模块顶层调用 registerProvider）。
 * 新增 provider = 新建子目录 + index.ts，无需改动本文件。
 */
export async function discoverProviders(): Promise<void> {
  const entries = await fs.readdir(PROVIDERS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const indexPath = path.join(PROVIDERS_DIR, entry.name, 'index.ts');
    try {
      await fs.access(indexPath);
    } catch {
      continue;
    }
    await import(pathToFileURL(indexPath).href);
  }
}
