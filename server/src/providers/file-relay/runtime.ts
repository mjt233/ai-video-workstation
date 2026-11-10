/**
 * 文件中转脚本运行时。
 *
 * 复用「自定义服务商」的运行时能力（`../custom/runtime.js`）：
 * - `compileCustomCodeModule`：TypeScript 转译 + node:vm 沙箱编译执行（白名单全局、无 require）；
 * - `performCustomRequest`：axios 风格 http 调用（JSON / FormData / 原始二进制、请求级超时、任务中止）。
 *
 * 本模块只负责文件中转专属部分：
 * 1. 定义脚本契约（`FileRelayContext` / `FileRelayFile` / `FileRelayResult`）；
 * 2. 组装 relay 专用 ctx（注入待上传文件与中止信号）；
 * 3. 执行脚本并校验返回值必须是 http(s) 公网地址；
 * 4. 把「实例总超时」与「任务中止」统一收敛为中文错误。
 *
 * 注意：node:vm 不是安全边界，脚本仍运行在本机 Node 进程内（本工具为本地工作站场景），
 * 白名单与 require 拦截仅用于隔离全局环境、防止误操作。
 */
import {
  compileCustomCodeModule,
  performCustomRequest,
  type WorkflowCallRequestConfig,
  type WorkflowCallResult,
} from '../custom/runtime.js';
import type { ResolvedProviderConfig } from '../types.js';

/** 文件中转默认超时（秒；与配置项 timeout 的默认值一致） */
export const DEFAULT_FILE_RELAY_TIMEOUT_SECONDS = 120;

/** 脚本内 `ctx.request` 的请求配置（axios 风格；timeout 单位为毫秒） */
export type FileRelayRequestConfig = WorkflowCallRequestConfig;

/** 脚本内 `ctx.request` 的响应（axios 风格；JSON 响应自动反序列化到 data） */
export type FileRelayRequestResult = WorkflowCallResult;

/**
 * 待中转的项目内文件。
 *
 * 由调用方（服务层 `relayProjectFile` / 连接测试的内存测试文件）构造后注入脚本，
 * 脚本不直接接触文件系统，只能通过本接口读取文件内容。
 */
export interface FileRelayFile {
  /** 项目内相对路径（相对 design/{project}/，如 assert/video/a.mp4；连接测试为占位文件名） */
  path: string;
  /** 文件名（含扩展名，上传时作为 multipart 文件名） */
  name: string;
  /** MIME 类型（按扩展名推断；无法识别时为 application/octet-stream） */
  mimeType: string;
  /** 文件字节数（来自 fs.stat，未读入内存前即可用） */
  size: number;
  /**
   * 读取完整文件内容。
   * @returns 文件字节（Uint8Array）
   */
  read(): Promise<Uint8Array>;
  /**
   * 读取完整文件并转为 Base64 字符串（不含 `data:` 前缀）。
   * @returns 纯 Base64 文本
   */
  base64(): Promise<string>;
  /**
   * 读取完整文件并转为宿主 File 对象（便于放进 FormData 以 multipart 上传）。
   * @returns Web File 对象（name / type 已按文件信息填充）
   */
  toFile(): Promise<File>;
}

/**
 * 注入文件中转脚本的上下文。
 *
 * 每次中转创建一个独立 ctx，只包含单文件上传所需的最小能力。
 */
export interface FileRelayContext {
  /** 服务商已解析配置（含 baseUrl / apiKey / timeout 等；脚本通过它读取自定义字段） */
  providerConfig: Record<string, unknown>;
  /** 待上传的项目内文件 */
  file: FileRelayFile;
  /**
   * 发起 http 请求（axios 风格）。
   *
   * 支持 JSON（普通对象自动序列化 + application/json）、FormData（multipart 上传）、
   * 字符串 / ArrayBuffer / TypedArray（原始二进制）；带请求级超时与任务中止。
   */
  request(conf: FileRelayRequestConfig): Promise<FileRelayRequestResult>;
  /** 任务级中止信号：用户中断 LLM 任务时触发，脚本可透传给 fetch 实现立即中止 */
  signal?: AbortSignal;
}

/**
 * 文件中转脚本的返回值。
 *
 * 失败语义：脚本直接 throw 即为中转失败（错误消息透传上层），无需特殊的 failed 字段。
 */
export interface FileRelayResult {
  /** 必须是 http(s) 公网地址（脚本上传后拿到的可访问 URL） */
  url: string;
}

/** 组装文件中转上下文所需的依赖 */
export interface FileRelayContextDeps {
  /** 服务商已解析配置（注入 ctx.providerConfig） */
  providerConfig: Record<string, unknown>;
  /** 待上传文件（注入 ctx.file，读取方法由调用方注入） */
  file: FileRelayFile;
  /** 中止信号（注入 ctx.signal，并约束 ctx.request 的在途请求） */
  signal?: AbortSignal;
  /** ctx.request 的默认超时（毫秒；不传则用 performCustomRequest 默认 120000ms） */
  requestTimeoutMs?: number;
}

/**
 * 构建文件中转脚本上下文。
 *
 * 只做 ctx 组装：http 请求直接复用 `performCustomRequest`（FormData / JSON / 原始二进制、
 * 请求级超时、外部信号中止语义与自定义服务商完全一致）。
 *
 * @param deps 上下文依赖（配置 / 文件 / 中止信号 / 请求默认超时）
 * @returns 文件中转上下文
 */
export function buildFileRelayContext(deps: FileRelayContextDeps): FileRelayContext {
  const ctx: FileRelayContext = {
    providerConfig: deps.providerConfig,
    file: deps.file,
    request: (conf: FileRelayRequestConfig) =>
      performCustomRequest(conf, deps.requestTimeoutMs, deps.signal),
  };
  if (deps.signal) ctx.signal = deps.signal;
  return ctx;
}

/**
 * 用内存字节构建 `FileRelayFile`（连接测试等没有真实项目文件的场景）。
 *
 * 读取方法均基于同一份内存字节，不触碰文件系统。
 *
 * @param opts 构造参数
 * @param opts.path 项目内相对路径（测试文件可传占位名）
 * @param opts.name 文件名（含扩展名，供 multipart 上传使用）
 * @param opts.mimeType MIME 类型
 * @param opts.bytes 文件字节
 * @returns 文件对象
 */
export function createInMemoryFileRelayFile(opts: {
  path: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}): FileRelayFile {
  const bytes = opts.bytes;
  return {
    path: opts.path,
    name: opts.name,
    mimeType: opts.mimeType,
    size: bytes.byteLength,
    read: async () => bytes,
    base64: async () => Buffer.from(bytes).toString('base64'),
    toFile: async () => new File([bytes], opts.name, { type: opts.mimeType }),
  };
}

/**
 * 解析文件中转实例的总超时（秒）。
 *
 * `timeout` 为非法值 / 非正数时回落到默认 120 秒；配置保存时已由 config-store 强转为数字，
 * 这里再兜底一次（配置文件可能被手工编辑）。
 *
 * @param config 已解析实例配置
 * @returns 总超时秒数（恒为正数）
 */
export function resolveFileRelayTimeoutSeconds(config: ResolvedProviderConfig): number {
  const raw = config.timeout;
  const seconds = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_FILE_RELAY_TIMEOUT_SECONDS;
  return seconds;
}

/**
 * 提取 URL 的主机名（仅用于日志与提示，避免输出完整 URL）。
 *
 * @param url http(s) 地址
 * @returns 主机名（host[:port]）；解析失败返回「未知主机」
 */
export function fileRelayUrlHost(url: string): string {
  try {
    return new URL(url).host || '未知主机';
  } catch {
    // 理论上 runFileRelayScript 已校验过 URL 合法性；这里兜底避免日志/提示因解析失败而抛错
    return '未知主机';
  }
}

/** 模型服务抓取公网 URL 时通常只允许的标准端口（空串表示协议默认 80/443） */
const STANDARD_HTTP_PORTS = new Set(['', '80', '443']);

/**
 * 判断中转 URL 是否使用了非标准端口，并生成告警文案（不阻断，仅提示）。
 *
 * 背景（实测）：智谱 GLM-5.3-Flash 的**视频输入**抓取器会拒绝非 80/443 端口的 URL，
 * 返回业务错误 `[1210] 视频输入格式/解析错误`；同一 URL 作为图片输入则正常。
 * 因此中转地址建议使用 443/80 的反向代理域名；其他模型可能接受非标准端口，
 * 故这里只提示、不直接判失败。
 *
 * @param url 中转返回的 http(s) URL
 * @returns 告警文案；URL 非法或端口为标准端口时返回 null
 */
export function fileRelayUrlPortWarning(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // URL 合法性由 normalizeFileRelayResult 负责；这里解析失败视为无可提示
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (STANDARD_HTTP_PORTS.has(parsed.port)) return null;
  return `中转 URL 使用了非标准端口（${parsed.port}）：部分模型（如智谱视频输入）会拒绝抓取非 80/443 端口的地址，建议改用标准端口的反向代理地址`;
}

/**
 * 校验并规范化文件中转脚本的返回值。
 *
 * 规则：必须是对象，`url` 必须是非空字符串且为 http(s) 地址
 * （其他协议如 ftp/data/file 一律拒绝，避免把非公网地址传给 LLM）。
 *
 * @param raw 脚本返回值
 * @returns 规范化后的 `{ url }`（已 trim）
 * @throws Error 结构非法 / url 缺失 / 非 http(s) 地址（中文错误，不输出完整 URL）
 */
export function normalizeFileRelayResult(raw: unknown): FileRelayResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('文件中转脚本必须返回对象（FileRelayResult）');
  }
  const url = (raw as { url?: unknown }).url;
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('文件中转脚本返回的 url 必须是非空字符串');
  }
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // 仅用于格式校验：非法地址统一抛中文错误，不回显原始 URL（避免完整地址进入日志/报错）
    throw new Error('文件中转脚本返回的 url 不是合法的 http(s) 地址');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('文件中转脚本返回的 url 必须是 http(s) 地址（实际协议：' + parsed.protocol + '）');
  }
  return { url: trimmed };
}

/**
 * 编译并执行文件中转脚本。
 *
 * 流程：
 * 1. 校验 `script` 非空 → 用 `compileCustomCodeModule` 转译并在 node:vm 沙箱编译
 *    （语法错误 / 未 export default 函数立即抛中文错误）；
 * 2. 组装 ctx（注入配置、文件与内部中止信号），执行 `export default async function(ctx)`；
 * 3. 脚本执行、总超时（实例 `timeout` 秒）与任务中止三者竞速：超时/中止会联动中止
 *    在途 http 请求，并以中文错误结束；
 * 4. 校验返回值为 http(s) URL。
 *
 * @param config 已解析实例配置（含 script / timeout / baseUrl / apiKey 等）
 * @param file 待上传文件（读取方法由调用方注入）
 * @param signal 任务级中止信号（用户中断 LLM 任务时触发）
 * @returns 中转结果 `{ url }`
 * @throws Error 脚本未配置 / 编译失败 / 执行失败（透传脚本错误）/ 超时 / 用户中断 / 返回值非法
 */
export async function runFileRelayScript(
  config: ResolvedProviderConfig,
  file: FileRelayFile,
  signal?: AbortSignal,
): Promise<FileRelayResult> {
  const script = typeof config.script === 'string' ? config.script.trim() : '';
  if (!script) {
    throw new Error('文件中转脚本未配置：请先在 系统设置 → 服务商配置 → 文件中转 填写上传脚本');
  }
  if (signal?.aborted) throw new Error('用户中断');
  const timeoutSeconds = resolveFileRelayTimeoutSeconds(config);
  const timeoutMs = Math.round(timeoutSeconds * 1000);
  // 先编译（语法 / export default 校验）：失败立即抛出，不进入沙箱执行
  const module = compileCustomCodeModule({ code: script, label: '文件中转' });
  // 总超时与任务中止统一收敛到内部控制器：任一触发都中止在途请求
  const controller = new AbortController();
  const ctx = buildFileRelayContext({
    providerConfig: config,
    file,
    signal: controller.signal,
    requestTimeoutMs: timeoutMs,
  });
  const cleanup: (() => void)[] = [];
  let rejectInterrupted: ((error: Error) => void) | null = null;
  // 该 Promise 在「总超时」或「用户中断」时拒绝，与脚本执行竞速
  const interruptPromise = new Promise<never>((_resolve, reject) => {
    rejectInterrupted = reject;
  });
  /** 收敛为中断/超时：中止在途请求并让竞速立即结束 */
  const interrupt = (error: Error): void => {
    controller.abort();
    rejectInterrupted?.(error);
  };
  const onExternalAbort = (): void => interrupt(new Error('用户中断'));
  if (signal) {
    signal.addEventListener('abort', onExternalAbort, { once: true });
    cleanup.push(() => signal.removeEventListener('abort', onExternalAbort));
  }
  const timer = setTimeout(() => interrupt(new Error(`文件中转超时（${timeoutSeconds} 秒）`)), timeoutMs);
  cleanup.push(() => clearTimeout(timer));
  try {
    // 脚本同步抛错会在 Promise.resolve 之前抛出，同样由 finally 清理定时器与监听
    const scriptPromise = Promise.resolve(module.defaultFn(ctx));
    const raw = await Promise.race([scriptPromise, interruptPromise]);
    return normalizeFileRelayResult(raw);
  } finally {
    // 清理收尾：无论成功/失败/超时/中止都移除监听并清除定时器（避免句柄泄漏）
    for (const fn of cleanup) fn();
  }
}
