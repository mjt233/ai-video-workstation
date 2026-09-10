/**
 * 自定义服务商传输客户端。
 *
 * 实现 ProviderClient 四方法，内部由**一个后台协程**（`runCustomTask`）统一驱动
 * 「调用发起 → 在途请求 → 结果提取」，同步 / 异步工作流不再分叉：
 * - execute：编译校验「调用发起」代码后**立即返回**本地任务 ID，并把协程挂到后台运行；
 * - poll：读取协程快照（进度 / 终态）；取消后立即抛「用户中断」；
 * - getOutput：读取协程落下的终态提取结果（同步 / 异步一致，不再"同步现跑一次"）；
 * - cancel：置取消标记 + **abort 在途请求**（调用发起 / 结果提取 / 轮询等待全部立即收敛），
 *   并按配置决定是否执行「取消调用」代码。
 *
 * 之所以让 execute 立即返回：引擎只有在 submit 返回后才把远端任务 ID 落库，
 * 阻塞式提交会让「生成期间」完全没有中断凭据（旧实现同步工作流因此无法中断）。
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

/** 服务商级「异步轮询间隔（秒）」默认值（与工作流引擎的轮询节奏一致） */
export const DEFAULT_CUSTOM_POLL_INTERVAL_SECONDS = 2;

/** 结果提取连续报错日志节流间隔（毫秒）：避免每轮轮询都刷屏 */
const EXTRACT_ERROR_LOG_INTERVAL_MS = 60000;

/** 协程终态（null = 仍在运行） */
interface CustomTaskTerminal {
  /** 终态类型：completed 成功 / failed 失败 / cancelled 用户中断 */
  status: 'completed' | 'failed' | 'cancelled';
  /** 失败原因（status 为 failed 时存在） */
  errorMessage?: string;
}

/** 单个任务的状态（模块级共享 Map 的 value） */
interface CustomTaskState {
  /** 该任务对应的工作流条目 */
  entry: CustomWorkflowEntry;
  /** 工作流调用上下文（同一实例贯穿调用发起/轮询/提取/取消） */
  ctx: WorkflowCallContext;
  /** 任务级中止控制器：取消时 abort，在途请求与轮询等待立即收敛 */
  abort: AbortController;
  /** 后台协程（调用发起 → 在途请求 → 结果提取）；**永不 reject**，终态写入 terminal */
  runner: Promise<void>;
  /** 协程阶段（calling 调用发起与在途请求 / extracting 异步结果提取 / settled 已收敛） */
  phase: 'calling' | 'extracting' | 'settled';
  /** 任务开始时间（毫秒时间戳，用于总耗时超时） */
  startedAt: number;
  /** 结果提取连续报错开始时间（null = 当前无连续报错） */
  errorSince: number | null;
  /** 最近一次结果提取报错文案 */
  lastError: string | null;
  /** 连续报错期间上一次向控制台输出错误日志的时间（用于节流，避免刷屏） */
  lastErrorLogAt: number | null;
  /** 是否已请求取消（poll/getOutput 据此立即抛「用户中断」，不等协程收敛） */
  cancelled: boolean;
  /** 【调用发起】http 请求的响应对象（响应返回后写入；响应前被中断时保持 null） */
  callResult: WorkflowCallResult | null;
  /** 最新进度（结果提取返回值，0~100；undefined = 未知） */
  progress: number | undefined;
  /** 终态提取结果（isFinish / failed 时写入；getOutput 据此取产物） */
  extract: WorkflowResult | null;
  /** 协程终态（null = 仍在运行） */
  terminal: CustomTaskTerminal | null;
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
 * ctx.readFile / ctx.readAssertFile / ctx.readFileToBase64 /
 * ctx.readFileAsBase64Object / ctx.userConfig。
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
  /** 读取项目内文件为 `{ mimeType, data }`（注入 ctx.readFileAsBase64Object） */
  readFileAsBase64Object?: (relPath: string) => Promise<{ mimeType: string; data: string }>;
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
 * 解析服务商级异步轮询间隔（秒），非法/缺失回退默认值。
 *
 * @param config 已解析实例配置
 * @returns 轮询间隔秒数（正数）
 */
function resolvePollIntervalSeconds(config: ResolvedProviderConfig): number {
  const raw = config.pollInterval;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CUSTOM_POLL_INTERVAL_SECONDS;
}

/**
 * 收敛协程终态（幂等：已收敛时忽略后到的收敛请求）。
 *
 * @param state 任务状态
 * @param status 终态类型
 * @param errorMessage 失败原因（仅 failed 使用）
 */
function finishTask(
  state: CustomTaskState,
  status: CustomTaskTerminal['status'],
  errorMessage?: string,
): void {
  if (state.terminal) return;
  state.phase = 'settled';
  state.terminal = { status, ...(errorMessage ? { errorMessage } : {}) };
}

/**
 * 记录一次结果提取失败：写连续报错起点与最近原因，并按 60 秒节流输出控制台日志。
 *
 * @param state 任务状态
 * @param e 提取过程中的异常
 * @param now 本轮提取开始时间（毫秒时间戳，超时判定基准）
 */
function recordExtractError(state: CustomTaskState, e: unknown, now: number): void {
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
  } else if (state.lastErrorLogAt === null || now - state.lastErrorLogAt >= EXTRACT_ERROR_LOG_INTERVAL_MS) {
    // 持续报错节流输出：每 60 秒补一条，避免每轮轮询刷屏
    state.lastErrorLogAt = now;
    console.error('[custom-provider] 工作流「' + state.entry.name + '」结果提取仍持续报错: ' + msg);
  }
}

/**
 * 可中断等待：signal 中止（任务取消）时立即返回，不抛错——
 * 协程在下一轮循环开头判定取消并收敛为「用户中断」。
 *
 * @param ms 等待毫秒数
 * @param signal 任务级中止信号
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (): void => {
      if (timer !== null) clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * 创建自定义服务商客户端。
 *
 * @param config 已解析实例配置（含 baseUrl/apiKey/timeout/pollInterval/commonCode/testCode/workflows）
 * @returns 客户端实例
 */
export function createCustomProviderClient(config: ResolvedProviderConfig): CustomProviderClient {
  const timeoutMs = resolveTimeoutSeconds(config) * 1000;
  const pollIntervalMs = resolvePollIntervalSeconds(config) * 1000;
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

  /**
   * 执行一轮【结果提取】（编译产物缓存复用，返回值规范化）。
   *
   * @param state 任务状态
   * @returns 规范化后的提取结果
   */
  const runExtract = async (state: CustomTaskState): Promise<WorkflowResult> => {
    const module = state.modules.extract ?? compileEntry(state.entry, 'extract');
    state.modules.extract = module;
    const raw = await module.defaultFn(state.ctx, state.callResult);
    return normalizeWorkflowResult(raw, '结果提取');
  };

  /**
   * 后台协程：调用发起 → 在途请求 → 结果提取（同步一次 / 异步反复到 isFinish）。
   *
   * **永不 reject**：任何异常都收敛进 `state.terminal`，避免未处理拒绝；
   * 取消（abort）在任意阶段都会让在途等待立即失败并在判定点收敛为 `cancelled`，
   * 因此"中断后忽略接口响应、不落产物"是结构性保证（提取不会再被执行）。
   *
   * @param state 任务状态
   * @param callModule 已编译的【调用发起】模块
   */
  const runCustomTask = async (state: CustomTaskState, callModule: CustomCodeModule): Promise<void> => {
    try {
      const conf = await callModule.defaultFn(state.ctx);
      if (!conf || typeof conf !== 'object' || typeof (conf as { url?: unknown }).url !== 'string') {
        throw new Error('工作流「' + state.entry.name + '」的「调用发起」必须返回包含 url 字段的 http 请求配置');
      }
      // 发起前已取消：不再发出这次请求（避免"点了中断还打一次接口"）
      if (state.cancelled) {
        finishTask(state, 'cancelled');
        return;
      }
      state.callResult = await state.ctx.request(conf as WorkflowCallRequestConfig);
      if (state.cancelled) {
        finishTask(state, 'cancelled');
        return;
      }
      // 同步工作流：结果提取只跑一次，其结果即终态
      if (!state.entry.async) {
        const result = await runExtract(state);
        state.extract = result;
        state.progress = normalizeProgress(result.progress);
        if (result.failed) {
          finishTask(state, 'failed', result.errorMessage ?? '自定义工作流生成失败（未提供失败原因）');
          return;
        }
        finishTask(state, 'completed');
        return;
      }
      // 异步工作流：反复执行结果提取直到 isFinish / failed / 超时
      state.phase = 'extracting';
      while (true) {
        if (state.cancelled) {
          finishTask(state, 'cancelled');
          return;
        }
        const now = Date.now();
        // 结果提取连续报错超过超时时间 → 失败（远端可能一直不可达）
        if (state.errorSince !== null && now - state.errorSince >= state.timeoutMs) {
          throw new Error(
            '异步工作流「' + state.entry.name + '」结果提取持续报错超过超时时间: '
            + (state.lastError ?? ''),
          );
        }
        // 总耗时超时（防止一直返回 isFinish=false 永不结束）→ 失败
        if (now - state.startedAt >= state.timeoutMs) {
          throw new Error(
            '异步工作流「' + state.entry.name + '」执行超过超时时间 '
            + Math.round(state.timeoutMs / 1000) + ' 秒',
          );
        }
        try {
          const result = await runExtract(state);
          state.errorSince = null;
          state.lastError = null;
          state.progress = normalizeProgress(result.progress);
          // 生成失败：failed 隐含已完成 → 立即收敛并透出失败原因
          if (result.failed) {
            state.extract = result;
            finishTask(state, 'failed', result.errorMessage ?? '自定义工作流生成失败（未提供失败原因）');
            return;
          }
          if (result.isFinish) {
            state.extract = result;
            finishTask(state, 'completed');
            return;
          }
        } catch (e) {
          // 取消导致的中止不算提取报错，直接收敛为「用户中断」
          if (state.cancelled || state.abort.signal.aborted) {
            finishTask(state, 'cancelled');
            return;
          }
          // 记录连续报错（成功时已重置），超时判定在下一轮开头进行
          recordExtractError(state, e, now);
        }
        // 可中断等待：取消时立即醒来并收敛
        await sleep(pollIntervalMs, state.abort.signal);
      }
    } catch (e) {
      if (state.cancelled || state.abort.signal.aborted) {
        finishTask(state, 'cancelled');
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? (e.stack ?? '') : '';
      // 控制台输出完整失败信息（含堆栈与阶段），便于排查脚本/请求类错误
      console.error(
        '[custom-provider] 工作流「' + state.entry.name + '」执行失败（阶段: ' + state.phase + '）: ' + msg,
        stack,
      );
      finishTask(state, 'failed', msg);
    }
  };

  return {
    async execute(p: CustomExecuteParams): Promise<{ taskId: string }> {
      const entries = parseCustomWorkflows(config.workflows);
      const entry = entries.find((e) => e.name === p.workflowId);
      if (!entry) {
        throw new Error('工作流未配置或已删除: ' + p.workflowId);
      }
      // 【调用发起】代码即时编译：配置类错误在提交阶段直接抛出，不必等轮询才发现
      const callModule = compileEntry(entry, 'call');
      const taskId = randomUUID();
      const abort = new AbortController();
      const ctx = buildWorkflowCallContext({
        providerConfig,
        params: p.params ?? {},
        projectConfig: p.projectConfig,
        readFile: p.readFile,
        readAssertFile: p.readAssertFile,
        readFileToBase64: p.readFileToBase64,
        readFileAsBase64Object: p.readFileAsBase64Object,
        workflowType: p.workflowType,
        userConfig: p.userConfig ?? {},
        // 现取中止信号：任务取消后放行【取消调用】代码自身发起的取消请求
        getAbortSignal: () => (state.cancelled ? undefined : abort.signal),
      });
      const state: CustomTaskState = {
        entry,
        ctx,
        abort,
        runner: Promise.resolve(),
        phase: 'calling',
        startedAt: Date.now(),
        errorSince: null,
        lastError: null,
        lastErrorLogAt: null,
        cancelled: false,
        callResult: null,
        progress: undefined,
        extract: null,
        terminal: null,
        timeoutMs,
        modules: { call: callModule },
      };
      // 后台协程驱动全流程，execute 立即返回：引擎随即持久化远端任务 ID，
      // 任务在整个生成期间都可中断（cancel → abort 在途请求）
      taskStates.set(taskId, state);
      state.runner = runCustomTask(state, callModule);
      return { taskId };
    },

    async poll(taskId: string) {
      const state = getState(taskId);
      // 取消即收敛（不等协程跑完）：中断后轮询立即抛「用户中断」
      if (state.cancelled) throw new Error('用户中断');
      const terminal = state.terminal;
      if (terminal?.status === 'cancelled') throw new Error('用户中断');
      if (terminal?.status === 'failed') {
        return {
          status: 'failed',
          progress: normalizeProgress(state.progress),
          done: true,
          errorMessage: terminal.errorMessage ?? '自定义工作流执行失败（未提供失败原因）',
        };
      }
      if (terminal?.status === 'completed') {
        return { status: 'completed', progress: normalizeProgress(state.progress), done: true };
      }
      // 协程仍在运行：返回当前进度快照（未知进度 = undefined，前端展示不确定动画）
      return { status: 'running', progress: normalizeProgress(state.progress), done: false };
    },

    async getOutput(taskId: string): Promise<WorkflowOutput | null> {
      const state = getState(taskId);
      if (state.cancelled) throw new Error('用户中断');
      // 协程未收敛时等待其结束（引擎正常只在 done 后调用；直接调用时避免读到半截结果）
      if (!state.terminal) await state.runner;
      if (state.terminal?.status === 'cancelled') throw new Error('用户中断');
      // 生成失败（同步单次提取或异步反复提取的终态）：抛错透出真实原因，引擎任务标记 failed
      if (state.terminal?.status === 'failed') {
        throw new Error(state.terminal.errorMessage ?? '自定义工作流生成失败（未提供失败原因）');
      }
      const outputs = state.extract?.outputs ?? [];
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
      // 中止在途请求（调用发起 / 结果提取的 http 请求与轮询等待）：协程据此立即收敛为 cancelled
      if (!state.terminal) state.abort.abort();
      // 远端取消接口是否调用：配置了【取消调用】代码即调用（同步/异步一致，均由用户显式编写）；
      // 未配置时中断仅本地生效——异步工作流的远端任务会继续执行（系统无从取消）
      if (!state.entry.cancelCode.trim()) return;
      try {
        const module = state.modules.cancel ?? compileEntry(state.entry, 'cancel');
        state.modules.cancel = module;
        if (state.callResult === null) {
          console.warn(
            '[custom-provider] 工作流「' + state.entry.name
            + '」在接口响应返回前被中断，「取消调用」代码的 callResult 为 undefined（脚本需自行判空）',
          );
        }
        await module.defaultFn(state.ctx, state.callResult ?? undefined);
      } catch (e) {
        console.warn(
          '[custom-provider] 工作流「' + state.entry.name + '」取消调用失败（本地任务仍会终止）: '
          + (e instanceof Error ? e.message : String(e)),
        );
      }
    },
  };
}
