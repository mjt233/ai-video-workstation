/**
 * 文件中转服务：把项目内本地文件上传为公网可访问 URL。
 *
 * 对外主入口 `relayProjectFile(project, relPath, { signal })`（LLM 路由在发送视频输入前调用）：
 * 1. 取第一个 `enabled !== false` 的 file-relay 实例（无则抛明确中文错误）；
 * 2. 把 `relPath` 限定在项目目录内（防路径穿越），并读取文件元信息；
 * 3. 执行该实例的上传脚本（node:vm 沙箱，带总超时与任务中止）；
 * 4. 校验脚本返回值为 http(s) URL 并返回。
 *
 * 约定：
 * - **不做 URL 缓存**（中转 URL 可能带有效期，每次生成前重新上传）；同一任务内同一文件的
 *   去重由调用方负责；
 * - 日志只输出文件名、大小、MIME 与结果 URL 的 host，**不输出** apiKey / Base64 / 完整 URL。
 */
import fs from 'fs/promises';
import path from 'path';
import type { Stats } from 'node:fs';
import { assertSafeName, isReservedProjectName, projectRoot, resolveProjectPath } from '../../assets/paths.js';
import { listInstances, resolveInstanceConfig } from '../config-store.js';
import { getProvider } from '../registry.js';
import { detectMimeType } from '../../llm/runtime.js';
import type { ResolvedProviderConfig } from '../types.js';
import { fileRelayUrlHost, runFileRelayScript, type FileRelayFile } from './runtime.js';

/**
 * 未配置任何启用的文件中转实例时的错误文案。
 *
 * LLM 路由阶段 1 预检（存在视频输入但未配置中转）可直接复用本常量作为 400 错误信息。
 */
export const FILE_RELAY_NOT_CONFIGURED_MESSAGE =
  '未配置文件中转服务商：请先在 系统设置 → 服务商配置 → 文件中转 配置上传脚本';

/** relayProjectFile 的可选参数 */
export interface RelayProjectFileOptions {
  /** 任务级中止信号：用户中断 LLM 任务时立即中止在途上传请求 */
  signal?: AbortSignal;
}

/**
 * 查找第一个启用的文件中转实例配置（多个实例时取第一个 `enabled !== false`）。
 *
 * 供 `relayProjectFile` 内部使用；LLM 路由阶段 1 也可用它做「是否已配置中转」的预检，
 * 避免为必然失败的请求创建会话。
 *
 * @returns 已解析实例配置；没有启用的 file-relay 实例时返回 null
 */
export async function findEnabledFileRelayConfig(): Promise<ResolvedProviderConfig | null> {
  const instances = await listInstances();
  for (const instance of instances) {
    const provider = getProvider(instance.type);
    // 按 provider 分类判断（而不是硬编码类型 id），未来同分类新增提供商类型也能命中
    if (!provider || provider.category !== 'file-relay') continue;
    const config = resolveInstanceConfig(instance);
    if (config.enabled !== false) return config;
  }
  return null;
}

/**
 * 格式化文件大小（仅用于日志）。
 *
 * @param bytes 字节数
 * @returns 人类可读大小（B / KB / MB）
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * 构建项目内文件的 `FileRelayFile`。
 *
 * 读取动作全部惰性执行：脚本不调用 `read()/base64()/toFile()` 就不会把文件读入内存
 * （大视频只在真正上传时占用内存）。
 *
 * @param project 项目名
 * @param fullPath 已校验的绝对路径（位于项目目录内）
 * @param size 文件字节数（来自 fs.stat）
 * @returns 注入脚本的文件对象
 */
function createProjectFileRelayFile(project: string, fullPath: string, size: number): FileRelayFile {
  const name = path.basename(fullPath);
  const mimeType = detectMimeType(name);
  // 项目内相对路径统一用正斜杠（Windows 下 path.relative 使用反斜杠）
  const relPath = path.relative(projectRoot(project), fullPath).split(path.sep).join('/');
  return {
    path: relPath,
    name,
    mimeType,
    size,
    read: async () => fs.readFile(fullPath),
    base64: async () => (await fs.readFile(fullPath)).toString('base64'),
    toFile: async () => new File([await fs.readFile(fullPath)], name, { type: mimeType }),
  };
}

/**
 * 把项目内的一个本地文件通过「文件中转」服务商上传，返回公网可访问 URL。
 *
 * 每个调用都重新选择实例并真实执行上传脚本（不做 URL 缓存，中转 URL 可能过期）。
 *
 * @param project 项目名（design/ 下单层目录名）
 * @param relPath 项目内相对路径，如 `assert/video/xxx.mp4`（越出项目目录会被拒绝）
 * @param opts 可选参数（`signal`：任务级中止信号）
 * @returns 上传结果 `{ url }`（已校验为 http(s) 地址）
 * @throws Error 未配置文件中转服务商 / 路径非法 / 文件不存在 / 脚本执行失败 / 超时 / 用户中断
 */
export async function relayProjectFile(
  project: string,
  relPath: string,
  opts?: RelayProjectFileOptions,
): Promise<{ url: string }> {
  // 已中断时直接失败，避免取消后仍发起上传
  if (opts?.signal?.aborted) throw new Error('用户中断');
  const config = await findEnabledFileRelayConfig();
  if (!config) throw new Error(FILE_RELAY_NOT_CONFIGURED_MESSAGE);
  // 项目名必须是 design/ 下的单层目录名：resolveProjectPath 只保证 relPath 不越出
  // 「由 project 推出的根目录」，若 project 自带 .. 会把根目录挪到 design/ 之外
  assertSafeName(project, '项目名');
  if (isReservedProjectName(project)) {
    throw Object.assign(new Error(`项目名不合法：「${project}」为系统保留目录`), { code: 'INVALID' });
  }
  let fullPath: string;
  try {
    fullPath = resolveProjectPath(project, relPath);
  } catch {
    // 越界由 resolveProjectPath 检出（英文报错）；这里转成中文并保持 INVALID 语义向上抛出
    throw Object.assign(new Error(`中转文件路径非法（不得越出项目目录）：${relPath}`), { code: 'INVALID' });
  }
  let stat: Stats;
  try {
    stat = await fs.stat(fullPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`中转文件不存在：${relPath}`);
    }
    throw new Error(`读取中转文件失败：${relPath}（${e instanceof Error ? e.message : String(e)}）`);
  }
  if (!stat.isFile()) throw new Error(`中转路径不是文件：${relPath}`);
  const relayFile = createProjectFileRelayFile(project, fullPath, stat.size);
  // 日志只记文件名/大小/MIME 与结果 host，禁止输出 apiKey / Base64 / 完整 URL
  console.log(`[file-relay] 开始中转：${relayFile.name}（${formatSize(relayFile.size)}，${relayFile.mimeType}）`);
  const result = await runFileRelayScript(config, relayFile, opts?.signal);
  console.log(
    `[file-relay] 中转完成：${relayFile.name}（${formatSize(relayFile.size)}）→ host=${fileRelayUrlHost(result.url)}`,
  );
  return { url: result.url };
}
