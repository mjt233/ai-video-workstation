/**
 * 自定义服务商用户代码运行时。
 *
 * 用户以 TypeScript 编写「调用发起 / 结果提取 / 取消调用 / 测试」代码，
 * 本模块负责：
 * 1. 用 typescript.transpileModule 将 ES 模块语法转译为 CommonJS（带行列号报错）；
 * 2. 在 node:vm 沙箱上下文中执行模块（白名单全局变量，无 require/process）；
 * 3. 先执行「通用代码」模块，把其命名导出注入沙箱全局，使工作流代码可直接全局调用
 *    （如 getBaseCallConfig）；
 * 4. 提供 ctx.request —— 基于 fetch 的 axios 风格 http 调用（JSON / FormData）。
 *
 * 注意：node:vm 不是安全边界，仅用于隔离全局环境、防止误操作；
 * 用户代码仍运行在本机 Node 进程内（本工具为本地工作站场景）。
 */
import vm from 'node:vm';
import ts from 'typescript';

/**
 * http 请求配置（【调用发起】代码的返回值，也用于 ctx.request）。
 */
export interface WorkflowCallRequestConfig {
  /** 请求地址（必填） */
  url: string;
  /** 请求方法，默认 post */
  method?: string;
  /** 请求头（键值对） */
  header?: Record<string, string>;
  /** 请求体：普通对象按 JSON 序列化；FormData（含 File）按 multipart 上传 */
  data?: unknown;
  /** URL 查询参数（自动拼接到 url） */
  params?: Record<string, unknown>;
  /** 单次请求超时（毫秒），默认 120000 */
  timeout?: number;
}

/**
 * http 响应对象（axios 风格：data 为解析后的响应体，JSON 自动反序列化）。
 */
export interface WorkflowCallResult {
  /** 响应体：content-type 为 JSON 时是解析后的对象/数组，否则是原文 */
  data: unknown;
  /** HTTP 状态码 */
  status: number;
  /** 响应头（键值对） */
  headers: Record<string, string>;
}

/**
 * 【结果提取】代码的返回值。
 */
export interface WorkflowResult {
  /** 工作流是否已执行完成 */
  isFinish: boolean;
  /** 任务进度百分比（0~100）；小于 0 / undefined / null 表示未知 */
  progress?: number | null;
  /** 工作流执行结果产物（http url 数组） */
  outputs?: string[];
}

/**
 * 注入给用户代码的工作流调用上下文。
 *
 * ctx 在任务执行时创建一次，贯穿【调用发起】【结果提取】【取消调用】；
 * ctx.session 为任务级共享存储（Record<string, any>，实例化时默认赋值）。
 */
export interface WorkflowCallContext {
  /** 服务商已解析配置（含 baseUrl / apiKey / timeout 及其他字段） */
  providerConfig: Record<string, unknown>;
  /** 发起 http 调用（axios 风格返回） */
  request(conf: WorkflowCallRequestConfig): Promise<WorkflowCallResult>;
  /** 本次工作流调用的输入参数（按工作流支持的类型动态组合） */
  params: Record<string, unknown>;
  /** 任务级共享存储（Record<string, any>，实例化时默认赋值 {}） */
  session: Record<string, unknown>;
  /** 项目配置（画面宽高/帧率，可选） */
  projectConfig?: { width?: number; height?: number; fps?: number };
  /** 读取项目内文本文件（UTF-8），路径相对 design/{project}/；未注入时为 undefined */
  readFile?(relPath: string): Promise<string>;
  /** 读取项目 assert/ 下二进制文件为 File 对象；未注入时为 undefined */
  readAssertFile?(relPath: string): Promise<File>;
}

/**
 * 一段用户代码的编译产物：default 导出函数 + 沙箱全局对象。
 */
export interface CustomCodeModule {
  /** 模块 default 导出的函数（已校验为函数） */
  defaultFn: (...args: unknown[]) => unknown;
  /** 沙箱全局对象（含注入的通用代码命名导出） */
  sandbox: Record<string, unknown>;
}

/** 注入沙箱的宿主全局变量白名单（Node 24 内置 fetch/FormData/File 等） */
const HOST_GLOBALS = [
  'fetch', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'URL', 'URLSearchParams', 'AbortController', 'TextEncoder', 'TextDecoder',
  'structuredClone', 'FormData', 'File', 'Blob', 'Headers', 'Request', 'Response',
  'crypto', 'atob', 'btoa', 'performance',
  'JSON', 'Math', 'Date', 'Array', 'Object', 'String', 'Number', 'Boolean',
  'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'Intl',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'decodeURIComponent', 'encodeURIComponent',
] as const;

/** 单次 http 请求默认超时（毫秒） */
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;

/** 转译产物缓存：key = 源码文本（进程生命周期内避免重复转译） */
const transpileCache = new Map<string, string>();

/**
 * 创建沙箱全局对象：白名单宿主全局 + 拒绝 require。
 *
 * @returns 沙箱全局对象（未 contextify，由调用方 vm.createContext）
 */
function createSandbox(): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {};
  const host = globalThis as unknown as Record<string, unknown>;
  for (const key of HOST_GLOBALS) {
    if (key in host) sandbox[key] = host[key];
  }
  sandbox.globalThis = sandbox;
  sandbox.require = function requireDenied(): never {
    throw new Error('自定义代码沙箱不支持 import/require 第三方模块');
  };
  return sandbox;
}

/**
 * 把用户 TypeScript 代码转译为 CommonJS。
 *
 * 语法错误（transpileModule 仅做语法级检查）抛出带文件行列号的错误。
 *
 * @param code 用户代码文本
 * @param label 代码标签（用于错误提示）
 * @returns 转译后的 CommonJS 文本
 */
export function transpileCustomCode(code: string, label = 'custom'): string {
  const cached = transpileCache.get(code);
  if (cached !== undefined) return cached;
  const result = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: true,
    },
    fileName: label + '.ts',
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    const lines = errors.map((d) => {
      const text = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      if (d.file && d.start !== undefined) {
        const pos = d.file.getLineAndCharacterOfPosition(d.start);
        return '第 ' + (pos.line + 1) + ' 行第 ' + (pos.character + 1) + ' 列: ' + text;
      }
      return text;
    });
    throw new Error('代码编译失败（' + label + '）：\n' + lines.join('\n'));
  }
  transpileCache.set(code, result.outputText);
  return result.outputText;
}

/**
 * 在沙箱上下文中执行一个已转译的 CommonJS 模块，返回其 exports 对象。
 *
 * 模块以 (function(exports, module, require, __filename, __dirname){...}) 包装执行，
 * 因此 export default 会落到 exports.default。
 *
 * @param transpiled 转译后的 CommonJS 代码
 * @param sandbox 已 contextify 的沙箱全局对象
 * @param filename 沙箱内文件名（仅用于报错定位）
 * @returns 模块 exports 对象
 */
function evaluateModule(
  transpiled: string,
  sandbox: Record<string, unknown>,
  filename: string,
): Record<string, unknown> {
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  const wrapper = '(function (exports, module, require, __filename, __dirname) {\n'
    + transpiled + '\n})';
  const fn = vm.runInContext(wrapper, sandbox, { filename }) as (
    exports: Record<string, unknown>,
    module: { exports: Record<string, unknown> },
    require: unknown,
    __filename: string,
    __dirname: string,
  ) => void;
  fn(moduleObj.exports, moduleObj, sandbox.require, filename, '/');
  return moduleObj.exports;
}

/**
 * 编译一段用户代码（可选先加载通用代码并注入其命名导出为沙箱全局）。
 *
 * 通用代码的命名导出（如 getBaseCallConfig）被注入沙箱全局，
 * 因此工作流代码中可直接全局调用，无需 import。
 *
 * @param opts.commonCode 通用代码块文本（可为空）
 * @param opts.code 要编译的代码文本
 * @param opts.label 代码标签（错误提示）
 * @returns 编译产物（default 导出函数 + 沙箱）
 */
export function compileCustomCodeModule(opts: {
  commonCode?: string;
  code: string;
  label?: string;
}): CustomCodeModule {
  const label = opts.label ?? 'custom';
  const sandbox = createSandbox();
  vm.createContext(sandbox);
  if (opts.commonCode && opts.commonCode.trim()) {
    const commonExports = evaluateModule(
      transpileCustomCode(opts.commonCode, 'common'),
      sandbox,
      'common-code.js',
    );
    for (const [name, value] of Object.entries(commonExports)) {
      if (name === 'default' || name === '__esModule') continue;
      sandbox[name] = value;
    }
  }
  const exports = evaluateModule(transpileCustomCode(opts.code, label), sandbox, label + '-code.js');
  const defaultFn = exports.default;
  if (typeof defaultFn !== 'function') {
    throw new Error(label + '代码必须 export default 一个函数');
  }
  return { defaultFn: defaultFn as (...args: unknown[]) => unknown, sandbox };
}

/** 判断值是否为 FormData（跨 realm 安全：用 toStringTag 而非 instanceof） */
function isFormDataLike(value: unknown): boolean {
  return !!value && typeof value === 'object'
    && Object.prototype.toString.call(value) === '[object FormData]';
}

/**
 * 把（可能来自 vm 领域的）FormData 重建为宿主 FormData。
 *
 * File/Blob 条目按内容重建宿主 File，避免跨 realm 对象传给 fetch 时失败。
 *
 * @param value FormData 类对象
 * @returns 宿主 FormData
 */
async function coerceFormData(value: object): Promise<FormData> {
  const fd = new FormData();
  const anyValue = value as { entries?: () => IterableIterator<[string, unknown]> };
  if (typeof anyValue.entries !== 'function') return fd;
  for (const entry of anyValue.entries()) {
    const [key, v] = entry;
    const tag = v && typeof v === 'object' ? Object.prototype.toString.call(v) : '';
    if (tag === '[object File]' || tag === '[object Blob]') {
      const fileLike = v as unknown as {
        name?: unknown; type?: unknown; arrayBuffer?: () => Promise<ArrayBuffer>;
      };
      const name = typeof fileLike.name === 'string' ? fileLike.name : 'file';
      const type = typeof fileLike.type === 'string' ? fileLike.type : '';
      const buf = typeof fileLike.arrayBuffer === 'function'
        ? await fileLike.arrayBuffer()
        : new ArrayBuffer(0);
      fd.append(key, new File([buf], name, { type }));
    } else {
      fd.append(key, String(v));
    }
  }
  return fd;
}

/**
 * 执行一次 http 调用（ctx.request 的实现）。
 *
 * - 普通对象 data → JSON 序列化（自动补 Content-Type: application/json）；
 * - FormData（含 File）→ multipart 上传；
 * - 字符串 / ArrayBuffer / TypedArray → 原样作为请求体；
 * - JSON 响应自动反序列化到 data。
 *
 * @param conf 请求配置
 * @param defaultTimeoutMs 请求默认超时（毫秒）
 * @returns axios 风格响应对象
 */
export async function performCustomRequest(
  conf: WorkflowCallRequestConfig,
  defaultTimeoutMs?: number,
): Promise<WorkflowCallResult> {
  if (!conf || typeof conf !== 'object' || typeof conf.url !== 'string' || !conf.url.trim()) {
    throw new Error('http 请求配置缺少 url 字段');
  }
  let url = conf.url.trim();
  if (conf.params && typeof conf.params === 'object') {
    const qs = new URLSearchParams();
    for (const [key, v] of Object.entries(conf.params)) {
      if (v === undefined || v === null) continue;
      qs.append(key, String(v));
    }
    const q = qs.toString();
    if (q) url += (url.includes('?') ? '&' : '?') + q;
  }
  const method = (conf.method ?? 'post').trim().toUpperCase() || 'POST';
  const headers: Record<string, string> = { ...(conf.header ?? {}) };
  let body: BodyInit | undefined;
  if (conf.data !== undefined && conf.data !== null) {
    if (isFormDataLike(conf.data)) {
      body = await coerceFormData(conf.data);
    } else if (
      typeof conf.data === 'string'
      || conf.data instanceof ArrayBuffer
      || (typeof conf.data === 'object' && ArrayBuffer.isView(conf.data))
    ) {
      body = conf.data as BodyInit;
    } else {
      const lowerKeys = Object.keys(headers).map((k) => k.toLowerCase());
      if (!lowerKeys.includes('content-type')) headers['Content-Type'] = 'application/json';
      body = JSON.stringify(conf.data);
    }
  }
  const timeoutMs = typeof conf.timeout === 'number' && conf.timeout > 0
    ? conf.timeout
    : (defaultTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    let data: unknown = text;
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('json')) {
      try {
        data = JSON.parse(text);
      } catch {
        // 非法 JSON 保持原文
      }
    }
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });
    return { data, status: res.status, headers: responseHeaders };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error('http 请求失败 (' + method + ' ' + url + ', 超时 ' + timeoutMs + 'ms): ' + msg);
  } finally {
    clearTimeout(timer);
  }
}

/** 构建 WorkflowCallContext 所需的依赖 */
export interface WorkflowCallContextDeps {
  /** 服务商已解析配置（注入 ctx.providerConfig） */
  providerConfig: Record<string, unknown>;
  /** 本次调用输入参数（注入 ctx.params） */
  params: Record<string, unknown>;
  /** 项目配置（可选，注入 ctx.projectConfig） */
  projectConfig?: { width?: number; height?: number; fps?: number };
  /** 读取项目内文本文件（可选，注入 ctx.readFile） */
  readFile?: (relPath: string) => Promise<string>;
  /** 读取 assert/ 文件（可选，注入 ctx.readAssertFile） */
  readAssertFile?: (relPath: string) => Promise<File>;
  /** 请求默认超时（毫秒，可选） */
  requestTimeoutMs?: number;
}

/**
 * 构建工作流调用上下文。
 *
 * ctx 创建一次后在同一任务内复用（session 贯穿调用发起/轮询/提取）。
 *
 * @param deps 上下文依赖
 * @returns 工作流调用上下文
 */
export function buildWorkflowCallContext(deps: WorkflowCallContextDeps): WorkflowCallContext {
  const session: Record<string, unknown> = {};
  const requestTimeoutMs = deps.requestTimeoutMs;
  const ctx: WorkflowCallContext = {
    providerConfig: deps.providerConfig,
    params: deps.params,
    session,
    projectConfig: deps.projectConfig,
    readFile: deps.readFile,
    readAssertFile: deps.readAssertFile,
    request: (conf: WorkflowCallRequestConfig) => performCustomRequest(conf, requestTimeoutMs),
  };
  return ctx;
}

/**
 * 规范化【结果提取】返回值。
 *
 * @param raw 用户代码返回值
 * @param label 标签（错误提示）
 * @returns 规范后的 WorkflowResult（isFinish 缺失/非布尔时报错）
 */
export function normalizeWorkflowResult(raw: unknown, label: string): WorkflowResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(label + '必须返回对象（WorkflowResult）');
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.isFinish !== 'boolean') {
    throw new Error(label + '返回缺少布尔字段 isFinish');
  }
  let progress: number | null | undefined;
  if (rec.progress === undefined || rec.progress === null || rec.progress === '') {
    progress = null;
  } else {
    const n = Number(rec.progress);
    progress = Number.isFinite(n) ? n : null;
  }
  let outputs: string[] | undefined;
  if (rec.outputs !== undefined) {
    if (!Array.isArray(rec.outputs) || !rec.outputs.every((u) => typeof u === 'string')) {
      throw new Error(label + '返回的 outputs 必须是字符串数组');
    }
    outputs = rec.outputs as string[];
  }
  return { isFinish: rec.isFinish, progress, outputs };
}

/**
 * 规范化进度值：0~100 内原样返回，超出钳制；非法/负数返回 undefined（未知）。
 *
 * @param raw 原始进度值
 * @returns 规范化进度（0~100）或 undefined
 */
export function normalizeProgress(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return undefined;
  return Math.min(100, Math.max(0, raw));
}
