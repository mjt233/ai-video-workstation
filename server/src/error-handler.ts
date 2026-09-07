/**
 * 全局统一兜底的异常处理模块（挂在应用中间件链的最末端）。
 *
 * 背景：各业务路由目前均自行 try/catch 并映射 HTTP 状态码，但缺少「最后一道防线」，
 * 未捕获的同步抛错、next(err)（如 express.json 的请求体超限/解析失败、multer 上传异常、
 * express.static 读取失败等）会落入 Express 默认错误处理：返回 HTML 而非项目约定的
 * `{ error }` JSON，且 /api 未匹配请求会挂起无响应。本模块补齐：
 *
 * 1. apiNotFoundHandler：/api 下未匹配任何路由的请求统一返回 JSON 404（不打印日志，
 *    404 属于正常业务反馈，不是服务端异常）；
 * 2. errorHandler：Express 全局错误中间件，必须注册在所有路由/静态资源之后——
 *    - 5xx 及无法归类的服务端异常：完整打印错误（方法、路径、堆栈）到控制台，
 *      对客户端只返回不泄露细节的统一 JSON；
 *    - 4xx（含 404）客户端错误：按既有 code/status 约定映射 JSON 响应，不打日志；
 *    - 非 /api 请求（静态资源/前端页面）出错时退回纯文本响应；
 *    - 响应已开始（如流式传输中途出错）时无法改写响应，打印后交给 Express 默认处理；
 * 3. installProcessErrorHandlers：进程级监听 unhandledRejection / uncaughtException。
 *    Express 4 不会自动捕获 async 处理器中漏网的 Promise 拒绝（表现为请求悬挂 +
 *    unhandledRejection），此监听保证这类错误至少完整打印到控制台，不会静默丢失。
 */

import type { NextFunction, Request, Response } from 'express';
import { STATUS_CODES } from 'http';

/** 兜底错误响应：HTTP 状态码 + 返回给客户端的 JSON 内容 */
interface ErrorResponse {
  status: number;
  /** 响应体；code 仅在有业务语义时携带（与路由层 `{ error, code }` 约定一致） */
  body: { error: string; code?: string };
}

/**
 * 业务语义 code → HTTP 状态码映射。
 * 与路由层既有约定保持一致：assets/paths.ts 的 httpError、画布保存的
 * VERSION_CONFLICT/CORRUPT 等；漏网到此处的同类错误统一按此映射。
 */
const CODE_STATUS: Record<string, number> = {
  INVALID: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EXISTS: 409,
  CONFLICT: 409,
  IN_USE: 409,
  LAST_ONE: 409,
  CORRUPT: 409,
  VERSION_CONFLICT: 409,
};

/**
 * 从未知错误对象中提取人类可读的 message 文本。
 *
 * @param err 原始错误（Error 实例 / 字符串 / 其它）
 * @param fallback 提取失败时使用的兜底文案
 * @returns 错误描述字符串
 */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

/**
 * 将数字状态码字符串/数字归一化为 number。
 *
 * @param value 待归一化的状态码（可能来自 err.status / err.statusCode）
 * @returns 合法状态码（400~599）返回数字，否则返回 undefined
 */
function toHttpStatus(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 400 && n <= 599 ? n : undefined;
}

/**
 * 归一化未知错误为 HTTP 响应（状态码 + JSON body）。
 * 规则：4xx 客户端错误尽量透传业务 message；5xx/未知异常一律回统一文案
 * （内部细节只进控制台日志，不向客户端泄露）。
 *
 * @param err 原始错误
 * @returns 归一化后的错误响应
 */
function resolveError(err: unknown): ErrorResponse {
  const e = err as { code?: unknown; status?: unknown; statusCode?: unknown; type?: unknown; name?: unknown };

  // 1) body-parser（express.json）专有错误：请求体超限 / JSON 解析失败
  if (e?.type === 'entity.too.large') {
    return { status: 413, body: { error: '请求体过大，超过服务端限制' } };
  }
  if (e?.type === 'entity.parse.failed') {
    return { status: 400, body: { error: '请求体不是合法的 JSON' } };
  }
  // 2) multer 文件上传错误（路由内已拦截的不会走到这里，此为兜底）
  if (e?.name === 'MulterError') {
    if (e.code === 'LIMIT_FILE_SIZE') {
      return { status: 413, body: { error: '上传文件大小超过限制' } };
    }
    if (e.code === 'LIMIT_UNEXPECTED_FILE') {
      return { status: 400, body: { error: '上传字段不符合预期' } };
    }
    return { status: 400, body: { error: errorMessage(err, '上传失败') } };
  }
  // 3) 显式携带 HTTP 状态码的错误（如 FsRouteError、http-errors）
  const status = toHttpStatus(e?.status) ?? toHttpStatus(e?.statusCode);
  if (status !== undefined) {
    if (status < 500) {
      return { status, body: { error: errorMessage(err, STATUS_CODES[status] ?? '请求无效') } };
    }
    // 服务端异常不向客户端透传内部 message
    return { status: 500, body: { error: 'Internal server error' } };
  }
  // 4) 语义 code（业务层抛出的 `Object.assign(new Error(msg), { code })` 风格）
  if (typeof e?.code === 'string' && CODE_STATUS[e.code]) {
    return {
      status: CODE_STATUS[e.code],
      body: { error: errorMessage(err, '请求处理失败'), code: e.code },
    };
  }
  // 5) 未知异常：统一 500，细节只进日志
  return { status: 500, body: { error: 'Internal server error' } };
}

/**
 * /api 未匹配路由的统一 JSON 404 中间件。
 * 注册在全部 API 路由之后、静态资源与 SPA 回退之前：
 * 任何进入 /api 但未被既有路由消费的请求在此收口，避免被前端单页回退吞掉后挂起。
 * 404 属于正常业务反馈（请求了不存在的接口），刻意不打日志。
 *
 * @param req Express 请求（未匹配的 /api 请求）
 * @param res Express 响应
 */
export function apiNotFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `接口不存在: ${req.method} ${req.path}`, code: 'NOT_FOUND' });
}

/**
 * Express 全局兜底错误中间件（四参数签名是 Express 识别错误中间件的标志）。
 * 必须注册在中间件链的最末端（静态资源与 SPA 回退之后），负责收口所有
 * 未被路由自行捕获的错误：同步抛错、next(err)、body-parser/multer/静态文件错误等。
 *
 * 日志规则：
 * - 5xx 及无法归类的服务端异常 → console.error 完整打印（含方法、路径、堆栈）；
 * - 4xx（含 404）客户端错误 → 视为正常业务反馈，不打印。
 *
 * @param err 上游抛出的原始错误
 * @param req Express 请求
 * @param res Express 响应
 * @param next Express next 函数（响应已开始无法改写时移交默认处理）
 */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  const mapped = resolveError(err);
  // 服务端异常（5xx）：完整打印，便于排查；4xx 不打印（404 等属正常业务反馈）
  if (mapped.status >= 500) {
    console.error(`[error-handler] ${req.method} ${req.originalUrl} 处理失败:`, err);
  }
  // 响应已经开始（如流式输出途中出错）：无法再改写状态码，交给 Express 默认处理关闭连接
  if (res.headersSent) {
    next(err);
    return;
  }
  if (req.path.startsWith('/api')) {
    res.status(mapped.status).json(mapped.body);
    return;
  }
  // 非 API（静态资源/前端页面）：退回纯文本，避免把 HTML 单页响应错发给出错请求
  res
    .status(mapped.status)
    .type('text/plain')
    .send(mapped.status < 500 ? (STATUS_CODES[mapped.status] ?? 'Request failed') : 'Internal Server Error');
}

/**
 * 安装进程级异常兜底监听（幂等可重复调用）。
 *
 * 必要性：Express 4 不会捕获 async 路由处理器中漏网的 Promise 拒绝
 * （会表现为 unhandledRejection + 请求悬挂），此处兜底保证任何漏网错误
 * 都完整打印到控制台。uncaughtException 同样只打印不退出——本服务是
 * 单机资产工作站（数据在文件系统、无跨请求共享内存事务），单个请求的
 * 同步异常不应拖垮整个服务；若部署环境要求崩溃即重启，可自行调整。
 */
export function installProcessErrorHandlers(): void {
  process.on('unhandledRejection', (reason: unknown) => {
    console.error('[error-handler] 未处理的 Promise 拒绝（unhandledRejection）:', reason);
  });
  process.on('uncaughtException', (err: Error) => {
    console.error('[error-handler] 未捕获的同步异常（uncaughtException）:', err);
  });
}
