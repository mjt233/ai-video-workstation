import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { openPromise, type Entry, type ZipFile } from 'yauzl';
import { FsRouteError, isUnsafeZipEntry } from './fs-path.js';

/**
 * 项目导入/导出用的 zip 解压工具。
 *
 * 背景：extract-zip@2.0.1 内部使用 `stream.pipeline(readStream, createWriteStream(...))`
 * 写文件，在目标写流缓冲（默认 highWaterMark 16KB）被大文件条目填满后，
 * 背压沿 写流 → inflate 解压流 → 底层 fd 读流 传递时会发生流死锁：
 * 解压流停在中途、永不触发 end/close，pipeline 的 Promise 永不 settle，
 * 导入请求无限期悬挂（纯内存流控问题，无任何磁盘 I/O）。已在服务器容器内 5/5 复现。
 *
 * 本模块改用 yauzl（依赖中已有）流式逐条解压，写文件用「手动 pipe + 自建 Promise」，
 * 有意不使用 stream.pipeline，规避该死锁；手动 pipe 带背压的行为已验证正常。
 */

/** 解压单文件写流的缓冲大小（16MB）：仅影响吞吐，与正确性无关，避免大媒体文件频繁刷盘 */
const WRITE_HIGH_WATER_MARK = 16 * 1024 * 1024;

/** stat mode 高位类型掩码（来自 zip 条目 externalFileAttributes 高 16 位，与 extract-zip 判定一致） */
const MODE_IFMT = 0o170000;
/** 目录类型位 */
const MODE_IFDIR = 0o040000;
/** 符号链接类型位 */
const MODE_IFLNK = 0o120000;

/** 目录条目缺省权限（条目未声明 mode 时使用，与 extract-zip 默认行为一致） */
const DEFAULT_DIR_MODE = 0o755;
/** 文件条目缺省权限（条目未声明 mode 时使用，与 extract-zip 默认行为一致） */
const DEFAULT_FILE_MODE = 0o644;

/**
 * 将 zip 压缩包流式解压到目标目录（yauzl 逐条目实现，替代 extract-zip）。
 *
 * 逐条目处理：
 * - 跳过 `__MACOSX/` 资源分支（与 extract-zip 行为一致）；
 * - 每条目先做 zip-slip 校验（复用 isUnsafeZipEntry），并将解析后的绝对路径
 *   二次确认位于目标目录内（双保险）；
 * - 目录 → mkdir（递归，应用条目声明的权限）；文件 → 手动 pipe 方式写入目标；
 * - 符号链接条目跳过并告警（项目资产无需符号链接，可避免链接逃逸风险）。
 *
 * @param zipPath zip 文件绝对路径
 * @param destDir 解压目标目录绝对路径（须为绝对路径；父级不存在会一并创建）
 * @throws FsRouteError(400) 压缩包解析失败、包含不安全路径、或写入失败时
 */
export async function extractZipTo(zipPath: string, destDir: string): Promise<void> {
  if (!path.isAbsolute(destDir)) {
    throw new FsRouteError(400, '解压目标目录必须是绝对路径');
  }
  const destRoot = path.resolve(destDir) + path.sep;
  let zipfile: ZipFile;
  try {
    zipfile = await openPromise(zipPath, { lazyEntries: true });
  } catch (err) {
    throw new FsRouteError(400, `压缩包解析失败：${err instanceof Error ? err.message : '无法读取 zip 文件'}`);
  }

  let extractError: unknown = null;
  try {
    // yauzl v3 的 async 迭代器：逐条读取中央目录并消费，读完自动 close
    for await (const entry of zipfile.eachEntry()) {
      const normalized = entry.fileName.replace(/\\/g, '/');
      // 跳过 macOS 打包器生成的资源分支（与 extract-zip 行为一致）
      if (normalized.startsWith('__MACOSX/')) continue;

      if (isUnsafeZipEntry(normalized)) {
        throw new FsRouteError(400, `压缩包包含不安全路径：${normalized}`);
      }
      const dest = path.resolve(destDir, normalized);
      if (dest !== path.resolve(destDir) && !dest.startsWith(destRoot)) {
        // 二次防线：即便条目通过了字符串校验，也保证解析后的物理路径不逃逸目标目录
        throw new FsRouteError(400, `压缩包包含不安全路径：${normalized}`);
      }

      const mode = (entry.externalFileAttributes >> 16) & 0xffff;
      const ifmt = mode & MODE_IFMT;
      if (ifmt === MODE_IFLNK) {
        // 符号链接：本应用资产不需要；跳过并告警，避免链接目标逃逸
        console.warn(`[import] 跳过符号链接条目: ${normalized}`);
        continue;
      }

      const isDir = ifmt === MODE_IFDIR || normalized.endsWith('/');
      if (isDir) {
        const dirMode = (mode & 0o777) || DEFAULT_DIR_MODE;
        await fs.mkdir(dest, { recursive: true, mode: dirMode });
        continue;
      }

      const fileMode = (mode & 0o777) || DEFAULT_FILE_MODE;
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await pumpEntryToFile(zipfile, entry, dest, fileMode);
    }
  } catch (err) {
    extractError = err;
  } finally {
    // eachEntry 正常/异常路径都会调用 cleanup 关闭 zipfile；此处幂等兜底
    zipfile.close();
  }
  if (extractError) {
    // yauzl 自身的解析错误（如校验文件名时拒绝 ../ 条目）是普通 Error，
    // 统一包装为 FsRouteError(400)，与接口既有的错误形态保持一致
    if (extractError instanceof FsRouteError) throw extractError;
    throw new FsRouteError(400, `压缩包解析失败：${extractError instanceof Error ? extractError.message : 'zip 已损坏'}`);
  }
}

/**
 * 将 zip 中单个文件条目解压写入目标文件（手动 pipe + Promise 封装）。
 *
 * 监听 read 流与 write 流的 error、write 流的 finish 来判定完成；
 * 使用 `.pipe()` 自带背压管理，不引入 stream.pipeline，规避解压流死锁。
 *
 * @param zipfile 已打开的 zip 文件句柄
 * @param entry 待解压的文件条目
 * @param dest 目标文件绝对路径
 * @param mode 目标文件权限位
 * @returns 写入完成（数据全部落盘）时 resolve；任一流出错时 reject FsRouteError(400)
 */
function pumpEntryToFile(zipfile: ZipFile, entry: Entry, dest: string, mode: number): Promise<void> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, readStream) => {
      if (err) {
        reject(new FsRouteError(400, `压缩包解析失败：${err.message}`));
        return;
      }
      const writeStream = createWriteStream(dest, { mode, highWaterMark: WRITE_HIGH_WATER_MARK });
      let settled = false;
      const settle = (action: () => void) => {
        if (settled) return;
        settled = true;
        action();
      };
      readStream.on('error', (e: Error) => {
        settle(() => reject(new FsRouteError(400, `压缩包解析失败：${e.message}`)));
      });
      writeStream.on('error', (e: Error) => {
        settle(() => reject(new FsRouteError(400, `压缩包解析失败：${e.message}`)));
      });
      writeStream.on('finish', () => settle(resolve));
      // 手动 pipe：数据流向 readStream → writeStream，背压自动传导
      readStream.pipe(writeStream);
    });
  });
}