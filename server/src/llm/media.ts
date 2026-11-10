/**
 * LLM 媒体能力矩阵与两阶段媒体解析。
 *
 * 能力判定规则：**协议规则 ∩ 模型元信息**
 * - `getProtocolMediaRule()` 给出协议对某类媒体（图片/音频/视频）的传输方式
 *   （内联 base64 或公网 URL）、允许的 MIME、单文件大小上限与数量上限；
 * - 模型元信息 `inputModalities` 是主闸门：声明了该模态才发送；未配置元信息时
 *   不按模型过滤（向后兼容既有服务商实例）。
 *
 * 两阶段（供 `routes/llm.ts` 使用）：
 * 1. `planMediaInputs()`（响应前）：解析能力/格式/大小，产出发送计划与 warnings；
 * 2. `materializeMediaInputs()`（后台执行前）：内联项读取 base64、公网 URL 项经
 *    「文件中转」服务商上传获得 URL（同一文件在一次请求内去重）。
 *
 * 本模块不直接依赖 providers / express，IO 通过依赖注入（便于单测）。
 */
import path from 'path';
import { detectMimeType } from './runtime.js';
import type { LlmMediaInput } from './runtime.js';
import { createAbortError, type LlmMediaType, type LlmProtocol } from './protocol.js';
import { fileRelayUrlPortWarning } from '../providers/file-relay/runtime.js';

/** 1MB 字节数（大小上限与展示格式化共用） */
const MB = 1024 * 1024;

/** 内联媒体单文件安全阀（20MB；防止 base64 撑爆内存/请求体，视频走公网 URL 不读入内存） */
export const MAX_INLINE_MEDIA_BYTES = 20 * MB;

/**
 * 媒体传输方式：
 * - inline：base64 内联进请求体（图片/音频；AI SDK file part 或原生内容块）；
 * - public-url：先上传获得公网 URL，再以 URL 形式发送（当前仅 openai-chat 视频）。
 */
export type LlmMediaTransport = 'inline' | 'public-url';

/** 协议对某类媒体输入的传输规则 */
export interface LlmMediaRule {
  /** 是否支持（由 `getProtocolMediaRule` 返回时恒为 true；不支持时该函数返回 undefined） */
  supported: boolean;
  /** 传输方式 */
  transport: LlmMediaTransport;
  /**
   * 允许的 MIME 列表（小写，支持 `image/*` 这类通配）；
   * 文件 MIME 由 `detectMimeType()` 按扩展名推断后匹配。
   */
  mimeTypes: string[];
  /** 单文件大小上限（字节；内联场景还会与 20MB 安全阀取较小值） */
  maxBytes: number;
  /** 单次请求最多数量（缺省不限制） */
  maxCount?: number;
}

/**
 * 查询协议对某类媒体的传输规则。
 *
 * 能力矩阵（见 docs/plans/2026-11-10-ai-text-media-input.md 第 4.2 节）：
 * - openai-chat：图片内联（jpg/jpeg/png/webp，≤5MB）、音频内联（wav/mp3，≤20MB）、
 *   视频公网 URL（mp4/mkv/mov，≤200MB，最多 1 个）；
 * - gemini：图片/音频/视频全部内联（≤20MB，现有行为）；
 * - openai-responses / anthropic / grok：仅图片内联（现有行为，20MB 安全阀）。
 *
 * @param protocol 协议 id
 * @param type 媒体类型（image / audio / video）
 * @returns 传输规则；该协议不支持该类型时返回 undefined
 */
export function getProtocolMediaRule(protocol: LlmProtocol, type: LlmMediaType): LlmMediaRule | undefined {
  switch (protocol) {
    case 'openai-chat': {
      switch (type) {
        case 'image':
          return {
            supported: true,
            transport: 'inline',
            mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
            maxBytes: 5 * MB,
          };
        case 'audio':
          return {
            supported: true,
            transport: 'inline',
            mimeTypes: ['audio/wav', 'audio/mpeg', 'audio/mp3'],
            maxBytes: 20 * MB,
          };
        case 'video':
          return {
            supported: true,
            transport: 'public-url',
            mimeTypes: ['video/mp4', 'video/x-matroska', 'video/quicktime'],
            maxBytes: 200 * MB,
            maxCount: 1,
          };
      }
      break;
    }
    case 'gemini': {
      switch (type) {
        case 'image':
          return { supported: true, transport: 'inline', mimeTypes: ['image/*'], maxBytes: 20 * MB };
        case 'audio':
          return { supported: true, transport: 'inline', mimeTypes: ['audio/*'], maxBytes: 20 * MB };
        case 'video':
          return { supported: true, transport: 'inline', mimeTypes: ['video/*'], maxBytes: 20 * MB };
      }
      break;
    }
    case 'openai-responses':
    case 'anthropic':
    case 'grok':
      // 仅图片内联（与改造前 supportsInput 白名单一致）
      if (type === 'image') {
        return { supported: true, transport: 'inline', mimeTypes: ['image/*'], maxBytes: 20 * MB };
      }
      return undefined;
  }
  return undefined;
}

/**
 * 判断 MIME 是否命中允许列表（大小写不敏感；支持 `image/*` 通配）。
 *
 * @param mimeTypes 允许的 MIME 列表
 * @param mimeType 待判断 MIME
 * @returns 命中返回 true
 */
export function isMimeTypeAllowed(mimeTypes: readonly string[], mimeType: string): boolean {
  const target = mimeType.trim().toLowerCase();
  return mimeTypes.some((allowed) => {
    const a = allowed.trim().toLowerCase();
    if (a.endsWith('/*')) return target.startsWith(a.slice(0, -1));
    return a === target;
  });
}

/** 能力判定结果（协议规则 ∩ 模型元信息） */
export interface LlmMediaCapability {
  /** 协议传输规则（协议不支持该类型时为 undefined） */
  rule?: LlmMediaRule;
  /** 综合能力：协议支持且模型元信息声明了该模态（元信息为空表示不按模型过滤） */
  supported: boolean;
  /** 不支持的原因：protocol = 协议白名单不支持；model = 模型元信息未声明该模态 */
  reason?: 'protocol' | 'model';
}

/**
 * 综合判定一次媒体发送能力：协议规则 ∩ 模型元信息 inputModalities。
 *
 * @param protocol 协议 id
 * @param type 媒体类型
 * @param modalities 模型元信息声明的输入模态集合（空集合 = 未配置元信息，不按模型过滤）
 * @returns 能力判定结果
 */
export function resolveMediaCapability(
  protocol: LlmProtocol,
  type: LlmMediaType,
  modalities: ReadonlySet<string> = new Set(),
): LlmMediaCapability {
  const rule = getProtocolMediaRule(protocol, type);
  if (!rule) return { supported: false, reason: 'protocol' };
  if (modalities.size > 0 && !modalities.has(type)) return { rule, supported: false, reason: 'model' };
  return { rule, supported: true };
}

/**
 * 媒体类型中文标签（告警文案用）。
 *
 * @param type 媒体类型
 * @returns 中文标签（图片/音频/视频）
 */
export function mediaTypeLabel(type: LlmMediaType): string {
  switch (type) {
    case 'image':
      return '图片';
    case 'audio':
      return '音频';
    case 'video':
      return '视频';
  }
}

/**
 * 字节数格式化（告警文案用）：整 MB 输出 `5MB`，否则保留 1 位小数。
 *
 * @param bytes 字节数
 * @returns 展示字符串
 */
export function formatMediaBytes(bytes: number): string {
  const mb = bytes / MB;
  return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
}

/** 阶段 1 探测依赖（IO 注入，便于单测） */
export interface MediaProbeDeps {
  /**
   * 解析项目内相对路径为绝对路径（越界/非法抛错）。
   * @param relPath 项目内相对路径
   * @returns 绝对路径
   */
  resolvePath: (relPath: string) => string;
  /**
   * 读取文件大小（字节）。
   * @param absPath 绝对路径
   * @returns 文件大小（字节）
   */
  statSize: (absPath: string) => Promise<number>;
  /**
   * 异常日志输出（读取失败等；可选，缺省输出到控制台）。
   * @param message 日志内容
   */
  logError?: (message: string) => void;
}

/** 阶段 1 产出的发送计划项（已通过能力/格式/大小校验） */
export interface PlannedMediaInput {
  /** 媒体类型 */
  type: LlmMediaType;
  /** 项目内相对路径（阶段 2 读取/中转定位用） */
  relPath: string;
  /** 文件名（展示、告警与 AI SDK file part 用） */
  filename: string;
  /** 推断出的 IANA MIME */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** 传输方式 */
  transport: LlmMediaTransport;
}

/** 阶段 1 结果：发送计划 + 被忽略项的告警 */
export interface MediaPlan {
  /** 计划发送的媒体（保持前端提交顺序） */
  items: PlannedMediaInput[];
  /** 告警文案（能力/格式/大小/数量不符被忽略，不阻断生成） */
  warnings: string[];
}

/**
 * 阶段 1：解析媒体能力/大小/格式，产出发送计划与 warnings（不发送任何媒体内容）。
 *
 * 被忽略的情况（warnings，不阻断生成）：协议不支持、模型元信息未声明该模态、
 * MIME 不在允许列表、超过协议/安全阀大小上限、超过数量上限（视频最多 1 个）、
 * 路径非法或读取失败。非法媒体条目（缺 type/path）静默跳过（与改造前一致）。
 *
 * @param rawMedia 前端提交的媒体列表（未知结构，逐项校验）
 * @param protocol 协议 id
 * @param modalities 模型元信息声明的输入模态集合（空 = 不按模型过滤）
 * @param deps 文件探测依赖（路径解析 + stat + 日志）
 * @returns 发送计划与告警
 */
export async function planMediaInputs(
  rawMedia: unknown,
  protocol: LlmProtocol,
  modalities: ReadonlySet<string>,
  deps: MediaProbeDeps,
): Promise<MediaPlan> {
  const logError = deps.logError ?? ((message: string) => console.error(`[llm] ${message}`));
  const items: PlannedMediaInput[] = [];
  const warnings: string[] = [];
  /** 已计划数量（按类型；用于数量上限校验） */
  const plannedCounts = new Map<LlmMediaType, number>();
  const raw = Array.isArray(rawMedia) ? rawMedia : [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const typeValue = (item as { type?: unknown }).type;
    const filePath = (item as { path?: unknown }).path;
    if (typeValue !== 'image' && typeValue !== 'audio' && typeValue !== 'video') continue;
    if (typeof filePath !== 'string' || !filePath) continue;
    const mediaType = typeValue as LlmMediaType;
    const filename = path.basename(filePath);
    const label = mediaTypeLabel(mediaType);
    const capability = resolveMediaCapability(protocol, mediaType, modalities);
    if (!capability.supported) {
      warnings.push(
        capability.reason === 'protocol'
          ? `当前协议不支持${label}输入，已忽略：${filename}`
          : `当前模型不支持${label}输入，已忽略：${filename}`,
      );
      continue;
    }
    const rule = capability.rule as LlmMediaRule;
    const planned = plannedCounts.get(mediaType) ?? 0;
    if (rule.maxCount !== undefined && planned >= rule.maxCount) {
      warnings.push(`${label}输入最多 ${rule.maxCount} 个，已忽略：${filename}`);
      continue;
    }
    let absPath: string;
    let size: number;
    try {
      absPath = deps.resolvePath(filePath);
      size = await deps.statSize(absPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(`读取媒体输入失败（已忽略）: ${filePath} ${msg}`);
      warnings.push(`媒体文件读取失败，已忽略：${filename}`);
      continue;
    }
    const mimeType = detectMimeType(filePath);
    if (!isMimeTypeAllowed(rule.mimeTypes, mimeType)) {
      warnings.push(
        `媒体格式不支持（${mimeType}，允许：${rule.mimeTypes.join('、')}），已忽略：${filename}`,
      );
      continue;
    }
    // 内联场景与 20MB 安全阀取较小值（视频走公网 URL、不读入内存，不受安全阀限制）
    const maxBytes = rule.transport === 'inline' ? Math.min(rule.maxBytes, MAX_INLINE_MEDIA_BYTES) : rule.maxBytes;
    if (size > maxBytes) {
      warnings.push(`媒体文件超过 ${formatMediaBytes(maxBytes)} 上限，已忽略：${filename}`);
      continue;
    }
    items.push({ type: mediaType, relPath: filePath, filename, mimeType, size, transport: rule.transport });
    plannedCounts.set(mediaType, planned + 1);
  }
  return { items, warnings };
}

/**
 * 媒体阶段 2 异常：`code = RELAY_FAILED` 表示文件中转失败（任务 failed 的
 * 错误文案已由本模块拼好中文前缀，路由直接透传给用户）。
 */
export class LlmMediaError extends Error {
  /** 错误码（当前仅 RELAY_FAILED） */
  readonly code: 'RELAY_FAILED';

  /**
   * @param code 错误码
   * @param message 中文错误文案（直接展示给用户）
   */
  constructor(code: 'RELAY_FAILED', message: string) {
    super(message);
    this.name = 'LlmMediaError';
    this.code = code;
  }
}

/**
 * 阶段 2 物化依赖（IO 注入，便于单测）。
 */
export interface MediaMaterializeDeps {
  /**
   * 读取项目内文件为 base64 字符串（失败抛错，由本模块降级为告警并跳过）。
   * @param relPath 项目内相对路径
   * @returns base64 编码内容
   */
  readBase64: (relPath: string) => Promise<string>;
  /**
   * 文件中转：上传项目内文件并返回公网 URL（失败抛错，本模块包装为「文件中转失败」）。
   * @param relPath 项目内相对路径
   * @param opts.signal 任务中止信号
   * @returns 公网 URL
   */
  relay: (relPath: string, opts: { signal?: AbortSignal }) => Promise<{ url: string }>;
  /**
   * 阶段 2 告警回调（读取失败被忽略等；路由负责广播给订阅者）。
   * @param message 告警文案
   */
  onWarning?: (message: string) => void;
  /**
   * 异常日志输出（可选，缺省输出到控制台）。
   * @param message 日志内容
   */
  logError?: (message: string) => void;
}

/** 阶段 2 物化选项 */
export interface MediaMaterializeOptions {
  /** 任务中止信号（中转请求与读取前检查） */
  signal?: AbortSignal;
}

/**
 * 阶段 2：把发送计划物化为可传给 `createLlmStream` 的媒体输入。
 *
 * - 内联项：读取文件 base64（同一路径只读一次；读取失败 → 告警并跳过，不阻断生成）；
 * - 公网 URL 项：调用文件中转获得 URL（同一路径只上传一次）；中转失败 →
 *   抛 `LlmMediaError`（文案「文件中转失败：<原因>」），由路由把会话收敛为 failed；
 * - 中止信号已触发 → 抛 AbortError（取消优先于失败）。
 *
 * @param items 阶段 1 的发送计划
 * @param deps 物化依赖（读取 base64 / 中转 / 告警 / 日志）
 * @param opts 选项（中止信号）
 * @returns 媒体输入列表（按计划顺序，已被忽略的项不在其中）
 * @throws LlmMediaError 文件中转失败
 * @throws Error 中止（name=AbortError）
 */
export async function materializeMediaInputs(
  items: PlannedMediaInput[],
  deps: MediaMaterializeDeps,
  opts: MediaMaterializeOptions = {},
): Promise<LlmMediaInput[]> {
  const logError = deps.logError ?? ((message: string) => console.error(`[llm] ${message}`));
  const signal = opts.signal;
  /** 内联读取缓存（同一路径只读一次） */
  const inlineCache = new Map<string, Promise<string>>();
  /** 中转上传缓存（同一文件在同一请求内只上传一次） */
  const relayCache = new Map<string, Promise<{ url: string }>>();
  const mediaInputs: LlmMediaInput[] = [];
  const throwIfAborted = (): void => {
    if (signal?.aborted) throw createAbortError();
  };
  for (const item of items) {
    throwIfAborted();
    if (item.transport === 'inline') {
      try {
        let reading = inlineCache.get(item.relPath);
        if (!reading) {
          reading = deps.readBase64(item.relPath);
          inlineCache.set(item.relPath, reading);
        }
        const base64 = await reading;
        mediaInputs.push({
          type: item.type,
          mimeType: item.mimeType,
          filename: item.filename,
          source: { kind: 'inline', base64 },
        });
      } catch (e) {
        if (signal?.aborted) throw createAbortError();
        const msg = e instanceof Error ? e.message : String(e);
        logError(`读取媒体输入失败（已忽略）: ${item.relPath} ${msg}`);
        deps.onWarning?.(`媒体文件读取失败，已忽略：${item.filename}`);
      }
      continue;
    }
    // 公网 URL（当前仅 openai-chat 视频）：文件中转上传
    try {
      let uploading = relayCache.get(item.relPath);
      if (!uploading) {
        uploading = deps.relay(item.relPath, { signal });
        relayCache.set(item.relPath, uploading);
      }
      const { url } = await uploading;
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        throw new Error('中转服务未返回合法的 http(s) URL');
      }
      // 非标准端口告警（不阻断）：部分模型（如智谱视频输入）会拒绝抓取非 80/443 端口的 URL
      const portWarning = fileRelayUrlPortWarning(url);
      if (portWarning) deps.onWarning?.(portWarning);
      mediaInputs.push({
        type: item.type,
        mimeType: item.mimeType,
        filename: item.filename,
        source: { kind: 'url', url },
      });
    } catch (e) {
      if (signal?.aborted) throw createAbortError();
      const msg = e instanceof Error ? e.message : String(e);
      logError(`文件中转失败: ${item.relPath} ${msg}`);
      throw new LlmMediaError('RELAY_FAILED', `文件中转失败：${msg}`);
    }
  }
  return mediaInputs;
}
