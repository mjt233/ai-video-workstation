import { describe, expect, it, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { crc32 } from 'node:zlib';
import { extractZipTo } from './zip-extract.js';
import { FsRouteError } from './fs-path.js';

/**
 * 手写 zip 字节的最小构造器（仅支持 STORE 存储方式的条目）。
 *
 * 不用 archiver 构造测试包的原因：archiver 会用文件名规范化把 `../evil.txt`
 * 这类 zip-slip 条目名改写为合法名，无法生成恶意结构。
 *
 * 每条目结构：
 * { name: 条目路径（目录以 / 结尾）, data?: 文件内容 Buffer, mode?: 高 16 位权限（缺省 S_IFREG|0o644） }
 */
interface RawZipEntry {
  name: string;
  data?: Buffer;
  mode?: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
/** general purpose bit flag 中的 UTF-8 文件名标志位（本构造器文件名均为 UTF-8，必须置位） */
const FLAG_UTF8 = 0x800;
/** S_IFREG | 0o644 */
const DEFAULT_FILE_MODE = 0o100644;

/** 生成一个 STORE 方式的最小合法 zip（含固定头部日期时间，可复现）。 */
function buildRawZip(entries: RawZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const data = entry.data ?? Buffer.alloc(0);
    const crc = crc32(data);
    const mode = entry.mode ?? DEFAULT_FILE_MODE;

    // 本地文件头
    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(FLAG_UTF8, 6); // flags
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    chunks.push(local, nameBuf, data);
    const localSize = 30 + nameBuf.length + data.length;

    // 中央目录条目（POSIX mode 位于 externalFileAttributes 高 16 位）
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(SIG_CENTRAL, 0);
    cd.writeUInt16LE(0x031e, 4); // version made by：UNIX
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(FLAG_UTF8, 8); // flags
    cd.writeUInt16LE(0, 10); // method: store
    cd.writeUInt16LE(0, 12); // time
    cd.writeUInt16LE(0, 14); // date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra len
    cd.writeUInt16LE(0, 32); // comment len
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE((mode << 16) >>> 0, 38); // external attrs（mode 高 16 位）
    cd.writeUInt32LE(offset, 42); // local header offset
    central.push(cd, nameBuf);
    offset += localSize;
  }
  const body = Buffer.concat(chunks);
  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // cd disk
  eocd.writeUInt16LE(entries.length, 8); // entries on disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(body.length, 16); // cd offset
  eocd.writeUInt16LE(0, 20); // comment len
  return Buffer.concat([body, centralBuffer, eocd]);
}

/** 测试用临时目录（每个用例独立，测试后清理） */
const tmpRoots: string[] = [];
async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-extract-test-'));
  tmpRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {})));
});

describe('extractZipTo', () => {
  it('解压含大文件（>16MB，触发写流背压）与嵌套目录的 zip，字节完全一致', async () => {
    const destDir = await makeTmpDir();
    // 20MB 伪随机数据（STORED，构造大背压场景，修复前 extract-zip 在此必现卡死）
    const bigData = Buffer.alloc(20 * 1024 * 1024);
    let seed = 12345;
    for (let i = 0; i < bigData.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      bigData[i] = seed & 0xff;
    }
    const zipBuf = buildRawZip([
      { name: 'demo项目/', mode: 0o040755 },
      { name: 'demo项目/prompt/', mode: 0o040755 },
      { name: 'demo项目/prompt/角色.md', data: Buffer.from('# 角色\n正文内容', 'utf-8') },
      { name: 'demo项目/assert/', mode: 0o040755 },
      { name: 'demo项目/assert/big.bin', data: bigData },
      { name: 'demo项目/overview.md', data: Buffer.from('# demo项目\n') },
    ]);
    const zipPath = path.join(await makeTmpDir(), 'raw.zip');
    await fs.writeFile(zipPath, zipBuf);

    await extractZipTo(zipPath, destDir);

    const bigOut = await fs.readFile(path.join(destDir, 'demo项目', 'assert', 'big.bin'));
    expect(bigOut.length).toBe(bigData.length);
    expect(bigOut.equals(bigData)).toBe(true);
    expect(await fs.readFile(path.join(destDir, 'demo项目', 'prompt', '角色.md'), 'utf-8')).toBe(
      '# 角色\n正文内容',
    );
    expect(await fs.readFile(path.join(destDir, 'demo项目', 'overview.md'), 'utf-8')).toBe('# demo项目\n');
    // 目录结构完整
    const topEntries = await fs.readdir(destDir);
    expect(topEntries).toContain('demo项目');
  });

  it('跳过 __MACOSX 资源分支条目', async () => {
    const destDir = await makeTmpDir();
    const zipBuf = buildRawZip([
      { name: 'proj/', mode: 0o040755 },
      { name: '__MACOSX/', mode: 0o040755 },
      { name: '__MACOSX/._overview', data: Buffer.from('apple double', 'utf-8') },
      { name: 'proj/overview.md', data: Buffer.from('ok', 'utf-8') },
    ]);
    const zipPath = path.join(await makeTmpDir(), 'macosx.zip');
    await fs.writeFile(zipPath, zipBuf);

    await extractZipTo(zipPath, destDir);

    const all = await fs.readdir(destDir);
    expect(all).toEqual(['proj']);
    expect(await fs.readFile(path.join(destDir, 'proj', 'overview.md'), 'utf-8')).toBe('ok');
  });

  it('拒绝含 ../ 的 zip-slip 条目，且不做任何写入', async () => {
    const destDir = await makeTmpDir();
    const zipBuf = buildRawZip([
      { name: '../evil.txt', data: Buffer.from('pwned', 'utf-8') },
      { name: 'good.txt', data: Buffer.from('ok', 'utf-8') },
    ]);
    const zipPath = path.join(await makeTmpDir(), 'evil.zip');
    await fs.writeFile(zipPath, zipBuf);

    await expect(extractZipTo(zipPath, destDir)).rejects.toThrow(FsRouteError);
    // 危险条目在前：整个解压中止，目标目录保持为空
    expect(await fs.readdir(destDir)).toEqual([]);
  });

  it('跳过符号链接条目并成功完成其余文件', async () => {
    const destDir = await makeTmpDir();
    const zipBuf = buildRawZip([
      { name: 'proj/', mode: 0o040755 },
      // S_IFLNK | 0o777：符号链接条目
      { name: 'proj/link', data: Buffer.from('/etc/passwd', 'utf-8'), mode: 0o120777 },
      { name: 'proj/real.txt', data: Buffer.from('real', 'utf-8') },
    ]);
    const zipPath = path.join(await makeTmpDir(), 'symlink.zip');
    await fs.writeFile(zipPath, zipBuf);

    await extractZipTo(zipPath, destDir);

    const entries = await fs.readdir(path.join(destDir, 'proj'));
    expect(entries).toEqual(['real.txt']);
    expect(await fs.readFile(path.join(destDir, 'proj', 'real.txt'), 'utf-8')).toBe('real');
  });

  it('损坏的 zip 抛出 FsRouteError(400) 且不残留写入', async () => {
    const destDir = await makeTmpDir();
    const zipPath = path.join(await makeTmpDir(), 'broken.zip');
    await fs.writeFile(zipPath, Buffer.from('this is not a zip file at all........'));

    await expect(extractZipTo(zipPath, destDir)).rejects.toThrow(FsRouteError);
    await expect(extractZipTo(zipPath, destDir)).rejects.toMatchObject({ status: 400 });
    expect(await fs.readdir(destDir)).toEqual([]);
  });

  it('目标目录为相对路径时抛出 FsRouteError(400)', async () => {
    await expect(extractZipTo('x.zip', 'relative/dir')).rejects.toThrow(FsRouteError);
  });
});