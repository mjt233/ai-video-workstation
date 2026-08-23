/**
 * 自定义服务商传输客户端。
 *
 * 实现 ProviderClient 四方法：
 * - execute：按 workflowId（= 工作流名称）编译并运行【调用发起】代码，执行其返回的
 *   http 请求配置，保存调用上下文与响应到任务状态；
 * - poll：同步工作流立即返回完成；异步工作流反复运行【结果提取】直到 isFinish，
 *   连续报错或总耗时超过服务商级 timeout（秒）即抛错（引擎标记 failed）；
 * - getOutput：异步用缓存结果，同步此时运行一次【结果提取】（非异步只调用一次）；
 *   仅取 outputs[0] 下载；
 * - cancel：运行该工作流的【取消调用】代码（若有），并置本地 cancelled 标记，
 *   使 poll 抛「用户中断」。
 *
 * 任务状态存于模块级 Map（key = 本地 uuid 任务 ID）：
 * 引擎 runTask 与取消路由各自 createClient，但共享该 Map，保证取消能命中运行中的任务。
 */
import { randomUUID } from 'crypto';
import type { ProviderClient, ResolvedProviderConfig, WorkflowOutput } from '../types.js';
import type { WorkflowTypeId } from '../../workflows/types.js';
import { parseCustomWorkflows, type CustomWorkflowEntry } from './types.js';
import {
  buildWorkflowCallContext,
  compileCustomCodeModule,
  normalizeProgress,
  normalizeWorkflowResult,
  type CustomCodeModule,
  type WorkflowCallContext,
  type WorkflowCallRequestConfig,
  type WorkflowCallResult,
  type WorkflowResult,
} from './runtime.js';

/** 服务商级「异步轮询超时（秒）」默认值 */
export const DEFAULT_CUSTOM_TIMEOUT_SECONDS = 1800;

/** 单个任务的状态（模块级共享 Map 的 value） */
interface CustomTaskState {
  /** 该任务对应的工作流条目 */
  entry: CustomWorkflowEntry;
  /** 工作流调用上下文（同一实例贯穿调用发起/轮询/提取/取消） */
  ctx: WorkflowCallContext;
  /** 【调用发起】http 请求的响应对象 */
  callResult: WorkflowCallResult;
  /** 任务开始时间（毫秒时间戳，用于总耗时超时） */
  startedAt: number;
  /** 结果提取连续报错开始时间（null = 当前无连续报错） */
  errorSince: number | null;
  /** 最近一次结果提取报错文案 */
  lastError: string | null;
  /** 连续报错期间上一次向控制台输出错误日志的时间（用于节流，避免刷屏） */
  lastErrorLogAt: number | null;
  /** 是否已请求取消 */
  cancelled: boolean;
  /** 异步任务最终提取结果缓存（isFinish 时写入） */
  extract: WorkflowResult | null;
  /** 异步轮询超时（毫秒，服务商级 timeout 字段换算） */
  timeoutMs: number;
  /** 已编译代码模块缓存（按 call/extract/cancel 种类） */
  modules: Partial<Record<'call' | 'extract' | 'cancel', CustomCodeModule>>;
}

/** 任务状态表：模块级共享（跨 client 实例） */
const taskStates = new Map<string, CustomTaskState>();

/**
 * 自定义工作流 execute 的扩展参数。
 *
 * 相比 ProviderClient.execute 额外携带项目配置、读文件回调、
 * 用户配置字段值与 Base64 读取回调，分别注入 ctx.projectConfig /
 * ctx.readFile / ctx.readAssertFile / ctx.readFileToBase64 / ctx.userConfig。
 */
export interface CustomExecuteParams {
  /** 工作流名称（与工作流配置条目 name 一致，作为 workflowId） */
  workflowId: string;
  /** 工作流输入参数（注入 ctx.params） */
  params?: Record<string, unknown>;
  /** 需要上传的文件（预留，自定义工作流通过 ctx.readAssertFile 自行读取） */
  files?: Record<string, File>;
  /** 预留字段（自定义服务商不使用） */
  providerId?: string;
  /** 项目配置（注入 ctx.projectConfig） */
  projectConfig?: { width?: number; height?: number; fps?: number };
  /** 读取项目内文本文件（注入 ctx.readFile） */
  readFile?: (relPath: string) => Promise<string>;
  /** 读取 assert/ 文件（注入 ctx.readAssertFile） */
  readAssertFile?: (relPath: string) => Promise<File>;
  /** 读取项目内文件为 Base64（注入 ctx.readFileToBase64；withDataPrefix 控制是否加 data: 前缀） */
  readFileToBase64?: (relPath: string, withDataPrefix?: boolean) => Promise<string>;
  /** 本次调用的工作流类型（注入 ctx.workflowType，系统支持的类型之一） */
  workflowType?: WorkflowTypeId;
  /** 用户配置字段值（注入 ctx.userConfig；由同步器按声明类型转换） */
  userConfig?: Record<string, boolean | number | string>;
}

/** 自定义服务商客户端（扩展 execute 签名，其余与 ProviderClient 一致） */
export interface CustomProviderClient extends ProviderClient {
  execute(p: CustomExecuteParams): Promise<{ taskId: string }>;
}

/**
 * 解析服务商级异步轮询超时（秒），非法/缺失回退默认值。
 *
 * @param config 已解析实例配置
 * @returns 超时秒数（正整数）
 */
function resolveTimeoutSeconds(config: ResolvedProviderConfig): number {
  const raw = config.timeout;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CUSTOM_TIMEOUT_SECONDS;
}

/**
 * 创建自定义服务商客户端。
 *
 * @param config 已解析实例配置（含 baseUrl/apiKey/timeout/commonCode/testCode/workflows）
 * @returns 客户端实例
 */
export function createCustomProviderClient(config: ResolvedProviderConfig): CustomProviderClient {
  const timeoutMs = resolveTimeoutSeconds(config) * 1000;
  const providerConfig = config as unknown as Record<string, unknown>;
  const commonCode = typeof config.commonCode === 'string' ? config.commonCode : '';

  /**
   * 编译工作流条目的指定代码段（call/extract/cancel）。
   *
   * @param entry 工作流条目
   * @param kind 代码段种类
   * @returns 编译产物（default 导出函数）
   */
  const compileEntry = (entry: CustomWorkflowEntry, kind: 'call' | 'extract' | 'cancel'): CustomCodeModule => {
    const code = kind === 'call' ? entry.callCode : kind === 'extract' ? entry.extractCode : entry.cancelCode;
    const label = kind === 'call' ? '「调用发起」' : kind === 'extract' ? '「结果提取」' : '「取消调用」';
    if (!code.trim()) {
      throw new Error('工作流「' + entry.name + '」未配置' + label + '代码');
    }
    return compileCustomCodeModule({ commonCode, code, label: entry.name + '-' + kind });
  };

  /**
   * 取任务状态（缺失时抛出可读错误）。
   *
   * @param taskId 本地任务 ID
   * @returns 任务状态
   */
  const getState = (taskId: string): CustomTaskState => {
    const state = taskStates.get(taskId);
    if (!state) {
      throw new Error('自定义工作流任务状态不存在: ' + taskId + '（服务重启后请重试任务）');
    }
    return state;
  };

  return {
    async execute(p: CustomExecuteParams): Promise<{ taskId: string }> {
      const entries = parseCustomWorkflows(config.workflows);
      const entry = entries.find((e) => e.name === p.workflowId);
      if (!entry) {
        throw new Error('工作流未配置或已删除: ' + p.workflowId);
      }
      const callModule = compileEntry(entry, 'call');
      const ctx = buildWorkflowCallContext({
        providerConfig,
        params: p.params ?? {},
        projectConfig: p.projectConfig,
        readFile: p.readFile,
        readAssertFile: p.readAssertFile,
        readFileToBase64: p.readFileToBase64,
        workflowType: p.workflowType,
        userConfig: p.userConfig ?? {},
      });
      const conf = await callModule.defaultFn(ctx);
      if (!conf || typeof conf !== 'object' || typeof (conf as { url?: unknown }).url !== 'string') {
        throw new Error('工作流「' + entry.name + '」的「调用发起」必须返回包含 url 字段的 http 请求配置');
      }
      const callResult = await ctx.request(conf as WorkflowCallRequestConfig);
      const taskId = randomUUID();
      taskStates.set(taskId, {
        entry,
        ctx,
        callResult,
        startedAt: Date.now(),
        errorSince: null,
        lastError: null,
        lastErrorLogAt: null,
        cancelled: false,
        extract: null,
        timeoutMs,
        modules: { call: callModule },
      });
      return { taskId };
    },

    async poll(taskId: string) {
      const state = getState(taskId);
      if (state.cancelled) {
        throw new Error('用户中断');
      }
      // 同步工作流：一次 http 调用即完成，结果提取在 getOutput 时运行一次
      if (!state.entry.async) {
        return { status: 'completed', done: true };
      }
      const now = Date.now();
      // 结果提取连续报错超过超时时间 → 抛错（引擎标记 failed）
      if (state.errorSince !== null && now - state.errorSince >= state.timeoutMs) {
        throw new Error(
          '异步工作流「' + state.entry.name + '」结果提取持续报错超过超时时间: '
          + (state.lastError ?? ''),
        );
      }
      // 总耗时超时（异步，防止一直返回 isFinish=false 永不结束）→ 抛错
      if (now - state.startedAt >= state.timeoutMs) {
        throw new Error(
          '异步工作流「' + state.entry.name + '」执行超过超时时间 '
          + Math.round(state.timeoutMs / 1000) + ' 秒',
        );
      }
      const module = state.modules.extract ?? compileEntry(state.entry, 'extract');
      state.modules.extract = module;
      try {
        const raw = await module.defaultFn(state.ctx, state.callResult);
        const result = normalizeWorkflowResult(raw, '结果提取');
        state.errorSince = null;
        state.lastError = null;
        if (result.isFinish) {
          state.extract = result;
          return { status: 'completed', progress: normalizeProgress(result.progress), done: true };
        }
        return { status: 'running', progress: normalizeProgress(result.progress), done: false };
      } catch (e) {
        // 记录连续报错开始时间（成功时已重置），超时判定在下一轮 poll 开头进行
        const msg = e instanceof Error ? e.message : String(e);
        const stack = e instanceof Error ? (e.stack ?? '') : '';
        state.lastError = msg;
        if (state.errorSince === null) {
          // 新一轮连续报错：立即向控制台输出完整错误（含堆栈），便于排查脚本问题
          state.errorSince = now;
          state.lastErrorLogAt = now;
          console.error(
            '[custom-provider] 工作流「' + state.entry.name + '」结果提取执行失败（首次）: ' + msg,
            stack,
          );
        } else if (
          state.lastErrorLogAt === null
          || now - state.lastErrorLogAt >= 60000
        ) {
          // 持续报错节流输出：每 60 秒补一条，避免每 2 秒轮询刷屏
          state.lastErrorLogAt = now;
          console.error(
            '[custom-provider] 工作流「' + state.entry.name + '」结果提取仍持续报错: ' + msg,
          );
        }
        return { status: 'running', done: false };
      }
    },

    async getOutput(taskId: string): Promise<WorkflowOutput | null> {
      const state = getState(taskId);
      if (state.cancelled) {
        throw new Error('用户中断');
      }
      let extract: WorkflowResult | null = state.extract;
      if (state.entry.async && !extract) {
        // 兜底：异步条目应在 poll 完成时已缓存；未缓存时补跑一次
        const module = state.modules.extract ?? compileEntry(state.entry, 'extract');
        extract = normalizeWorkflowResult(await module.defaultFn(state.ctx, state.callResult), '结果提取');
      } else if (!state.entry.async) {
        // 同步工作流：【结果提取】只调用一次（在 getOutput 阶段）
        const module = compileEntry(state.entry, 'extract');
        extract = normalizeWorkflowResult(await module.defaultFn(state.ctx, state.callResult), '结果提取');
      }
      const outputs = extract?.outputs ?? [];
      if (outputs.length === 0) return null;
      const first = outputs[0];
      if (typeof first !== 'string' || !first.trim()) return null;
      if (outputs.length > 1) {
        console.warn(
          '[custom-provider] 工作流「' + state.entry.name + '」返回 '
          + outputs.length + ' 个产物，仅取第一个: ' + first,
        );
      }
      let filename = 'output';
      try {
        const u = new URL(first);
        const base = u.pathname.split('/').filter(Boolean).pop();
        if (base) filename = decodeURIComponent(base);
      } catch {
        // 非标准 URL 使用默认文件名
      }
      return { type: 'download', url: first, filename };
    },

    async cancel(taskId: string): Promise<void> {
      const state = taskStates.get(taskId);
      if (!state) return; // 幂等：状态不存在（如服务重启）时静默忽略
      state.cancelled = true;
      if (!state.entry.cancelable || !state.entry.cancelCode.trim()) return;
      try {
        const module = state.modules.cancel ?? compileEntry(state.entry, 'cancel');
        state.modules.cancel = module;
        await module.defaultFn(state.ctx, state.callResult);
      } catch (e) {
        console.warn(
          '[custom-provider] 工作流「' + state.entry.name + '」取消调用失败（本地任务仍会终止）: '
          + (e instanceof Error ? e.message : String(e)),
        );
      }
    },
  };
}
