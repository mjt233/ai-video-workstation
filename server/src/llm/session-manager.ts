/**
 * LLM 活跃会话管理器（仅内存，不持久化）。
 *
 * 所有正在调用 LLM 的异步任务统一经本模块登记（当前唯一调用点为 AI 文本生成节点，
 * 未来新增 LLM 调用点同样走本门槛）。会话只存在「活跃区」：begin() 登记 →
 * pushEvent() 累加流式状态 → finish() 先执行**终态落盘**（result-persist，
 * 后端独占写画布定义文件）再从活跃区移除。服务重启后注册表为空（内存 only 的
 * 既定取舍：未终态会话的部分输出丢失，已终态结果已在文件系统）。
 *
 * 本模块不依赖 WS 传输（wsHub 通过 on() 订阅 begin/update/finish 事件做广播），
 * 便于独立单测与替换传输层。
 */

import { randomUUID } from 'crypto';
import type { CanvasDefTarget } from '../assets/canvas-def.js';
import type { LlmStreamEvent } from './runtime.js';
import { persistLlmResult, type LlmPersistResult, type LlmTextHistoryEntry } from './result-persist.js';

/** 全局活跃会话上限（超过时 begin() 拒绝，防止误操作打满上游连接与内存） */
export const LLM_MAX_ACTIVE_SESSIONS = 8;

/** 会话状态：running 为活跃；completed/failed/cancelled 仅在 finish() 时置入（终态即移除） */
export type LlmSessionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** 会话阶段：thinking（思考，thinking 增量）→ responding（响应，首个 text 增量到达时切换） */
export type LlmSessionPhase = 'thinking' | 'responding';

/** 会话快照元信息（终态历史归档凭据：模型名 / 预设名 / 媒体输入名称 / 用户原始输入） */
export interface LlmSessionSnapshot {
  /** 生成时使用的模型展示名（名称或 id 字符串快照） */
  modelName?: string;
  /** 生成时使用的预设提示词名称（未使用预设时省略） */
  presetName?: string;
  /** 生成时连接的媒体输入名称列表（无媒体时省略） */
  mediaLabels?: string[];
  /** 生成时的用户原始输入（未拼入预设提示词；历史「当时的输入」归档用，未提供时历史回退 inputSent） */
  userInput?: string;
}

/** 一次 LLM 会话（活跃区登记项） */
export interface LlmSession {
  /** 会话唯一 id（begin 时生成，返回给客户端作为订阅/取消凭据） */
  taskId: string;
  /** 发起节点 id（画布恢复过滤与终态落盘定位用） */
  nodeId: string;
  /** 服务商实例 id */
  providerInstanceId: string;
  /** 模型 id */
  modelId: string;
  /** 节点名（会话列表展示） */
  label: string;
  /** 项目名 */
  project: string;
  /** 画布定位（CanvasDefTarget：画布定义文件定位 + 展示用） */
  canvas: CanvasDefTarget;
  /** 本次实际发送的用户侧文本（终态历史归档凭据） */
  inputSent: string;
  /** 终态历史归档凭据（模型名 / 预设名 / 媒体名称快照） */
  snapshot: LlmSessionSnapshot;
  /** 会话状态 */
  status: LlmSessionStatus;
  /** 当前阶段 */
  phase: LlmSessionPhase;
  /** 思考内容（仅内部展示用，**绝不写入 config.output**） */
  thinking: string;
  /** 正文内容（终态写入 config.output） */
  text: string;
  /** 警告（媒体输入被忽略等） */
  warnings: string[];
  /** 错误信息（仅 failed） */
  error?: string;
  /** 创建时间（毫秒时间戳，会话列表排序用） */
  createdAt: number;
  /** 实际启动时间（毫秒时间戳；会话列表耗时展示用） */
  startedAt: number;
  /** 终态时间（毫秒时间戳；仅终态会话有值） */
  completedAt?: number;
  /** 用户已请求取消（等待后台执行器收敛为 cancelled） */
  cancelled: boolean;
  /** 终态落盘后的新版本号（rev，finished 载荷携带，前端 savedRev 对齐用） */
  persistRev?: number;
  /** 终态落盘前的画布版本号（rev，finished 载荷携带；前端 savedRev === prevRev 时才采纳补丁） */
  persistPrevRev?: number;
  /** 终态落盘实际写入的 config 补丁（output / outputHistory，finished 载荷携带） */
  persistPatch?: { output?: string; outputHistory?: LlmTextHistoryEntry[] };
  /** 服务端持有的上游中止控制器（cancel 即 abort 上游流） */
  abortController: AbortController;
  /** 统一任务注册表生命周期回调（可选；由 routes/llm.ts 注入） */
  lifecycle?: LlmSessionLifecycle;
}

/** begin() 登记参数（路由层校验后传入） */
export interface LlmSessionBeginInput {
  nodeId: string;
  providerInstanceId: string;
  modelId: string;
  label: string;
  project: string;
  canvas: CanvasDefTarget;
  input: string;
  snapshot: LlmSessionSnapshot;
  /**
   * 统一任务注册表生命周期回调（可选）。
   *
   * 会话管理器**不直接依赖** tasks 模块（避免模块环），由调用方（`routes/llm.ts`）
   * 注入 `llmExecutor.lifecycleOf(taskId)`：阶段切换与终态时同步到统一任务注册表，
   * 使 LLM 会话出现在全局任务管理器中。
   */
  lifecycle?: LlmSessionLifecycle;
}

/**
 * LLM 会话生命周期回调（统一任务注册表同步用）。
 *
 * 由 `tasks/llm-executor.ts` 构造并注入，会话管理器只在关键节点调用，不感知注册表实现。
 */
export interface LlmSessionLifecycle {
  /**
   * 会话阶段变化（thinking → responding）。
   *
   * @param phase 新阶段
   */
  onPhase?: (phase: LlmSessionPhase) => void;
  /**
   * 会话终态（已移除出活跃区）。
   *
   * @param status 终态
   */
  onFinish?: (status: 'completed' | 'failed' | 'cancelled') => void;
}

/** 会话事件（wsHub 订阅用）：begin = 新会话登记；update = 阶段/警告/错误变化；finish = 终态移除 */
export interface LlmSessionEvent {
  type: 'begin' | 'update' | 'finish';
  session: LlmSession;
}

/** 会话登记错误（同节点单飞冲突 / 全局上限） */
export class LlmSessionError extends Error {
  /** 错误码：NODE_BUSY = 同节点已有活跃会话；SESSION_LIMIT = 全局活跃会话已达上限 */
  readonly code: 'NODE_BUSY' | 'SESSION_LIMIT';

  constructor(code: 'NODE_BUSY' | 'SESSION_LIMIT', message: string) {
    super(message);
    this.name = 'LlmSessionError';
    this.code = code;
  }
}

/** 终态落盘实现签名（默认真实写盘；测试可注入替身） */
export type LlmSessionPersister = (session: LlmSession) => Promise<LlmPersistResult>;

class LlmSessionManager {
  /** 活跃区：taskId → 会话（终态即移除，无完成区） */
  private readonly sessions = new Map<string, LlmSession>();
  /** 会话事件监听器（wsHub 注册） */
  private readonly listeners = new Set<(e: LlmSessionEvent) => void>();
  /** 终态落盘实现（默认真实实现；测试注入） */
  private persister: LlmSessionPersister = persistLlmResult;

  /**
   * 注入终态落盘实现（仅测试使用）。
   *
   * @param persister 落盘函数（返回写入结果）
   */
  setPersister(persister: LlmSessionPersister): void {
    this.persister = persister;
  }

  /**
   * 订阅会话事件（begin / update / finish），返回取消订阅函数。
   *
   * @param listener 事件监听器
   * @returns 取消订阅函数
   */
  on(listener: (e: LlmSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 触发会话事件（监听器异常只打日志，不阻断会话推进） */
  private emit(e: LlmSessionEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(e);
      } catch (err) {
        console.error(`[llm-session] 会话事件监听器异常（${e.type}）: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * 登记一个活跃 LLM 会话（同节点单飞 + 全局上限校验）。
   *
   * @param input 登记参数
   * @returns 新会话（taskId 作为客户端订阅/取消凭据）
   * @throws LlmSessionError 同节点已有活跃会话（NODE_BUSY）或全局上限（SESSION_LIMIT）
   */
  begin(input: LlmSessionBeginInput): LlmSession {
    if (this.sessions.size >= LLM_MAX_ACTIVE_SESSIONS) {
      throw new LlmSessionError(
        'SESSION_LIMIT',
        `活跃 LLM 会话已达上限（${LLM_MAX_ACTIVE_SESSIONS}），请等待现有会话完成或中断后再试`,
      );
    }
    for (const s of this.sessions.values()) {
      if (s.nodeId === input.nodeId) {
        throw new LlmSessionError('NODE_BUSY', '该节点已有进行中的 LLM 会话，请先等待完成或中断');
      }
    }
    const now = Date.now();
    const session: LlmSession = {
      taskId: randomUUID(),
      nodeId: input.nodeId,
      providerInstanceId: input.providerInstanceId,
      modelId: input.modelId,
      label: input.label,
      project: input.project,
      canvas: { ...input.canvas },
      inputSent: input.input,
      snapshot: {
        ...(input.snapshot.modelName ? { modelName: input.snapshot.modelName } : {}),
        ...(input.snapshot.presetName ? { presetName: input.snapshot.presetName } : {}),
        ...(input.snapshot.mediaLabels && input.snapshot.mediaLabels.length > 0
          ? { mediaLabels: [...input.snapshot.mediaLabels] }
          : {}),
        ...(input.snapshot.userInput ? { userInput: input.snapshot.userInput } : {}),
      },
      status: 'running',
      phase: 'thinking',
      thinking: '',
      text: '',
      warnings: [],
      createdAt: now,
      startedAt: now,
      cancelled: false,
      abortController: new AbortController(),
      ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
    };
    this.sessions.set(session.taskId, session);
    this.emit({ type: 'begin', session });
    return session;
  }

  /**
   * 按 taskId 获取会话。
   *
   * @param taskId 会话 id
   * @returns 会话或 undefined（不存在/已终态移除）
   */
  get(taskId: string): LlmSession | undefined {
    return this.sessions.get(taskId);
  }

  /**
   * 累加一条流式事件到会话（think 内容仅内存展示；正文用于终态落盘）。
   * 已终态/未知会话忽略（幂等）。
   *
   * @param taskId 会话 id
   * @param event 流式事件（thinking/text/warning/error）
   */
  pushEvent(taskId: string, event: LlmStreamEvent): void {
    const s = this.sessions.get(taskId);
    if (!s || s.status !== 'running') return;
    switch (event.type) {
      case 'thinking':
        s.thinking += event.delta;
        break;
      case 'text':
        if (s.phase !== 'responding') {
          s.phase = 'responding';
          this.emit({ type: 'update', session: s });
          // 同步统一任务注册表（阶段切换；任务管理器展示「正在响应…」）
          try {
            s.lifecycle?.onPhase?.(s.phase);
          } catch (err) {
            console.error(
              `[llm-session] 阶段同步任务注册表失败: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        s.text += event.delta;
        break;
      case 'warning':
        s.warnings.push(event.message);
        this.emit({ type: 'update', session: s });
        break;
      case 'error':
        s.error = event.message;
        this.emit({ type: 'update', session: s });
        break;
      case 'done':
        break;
    }
  }

  /**
   * 取消会话（幂等）：标记取消 + 中止上游流。
   * 收敛由后台执行器完成（abort 抛出后 finish(cancelled) 写部分输出并移除）。
   *
   * @param taskId 会话 id
   * @returns 是否成功取消（false = 会话不存在或已终态）
   */
  cancel(taskId: string): boolean {
    const s = this.sessions.get(taskId);
    if (!s || s.status !== 'running') return false;
    s.cancelled = true;
    s.abortController.abort();
    return true;
  }

  /**
   * 终态收敛：先执行终态落盘（后端独占写 config.output / outputHistory），
   * 再移除出活跃区。幂等：已终态会话直接返回。
   *
   * 取消优先级高于调用方意图（cancel 标记后即使流正常结束也按 cancelled 收敛）。
   * 落盘失败时 completed 降级为 failed（提示用户）；cancelled/failed 保持原状态
   * （部分输出丢失为已知降级，错误信息附加在 error 上）。
   *
   * @param taskId 会话 id
   * @param outcome 后台执行器判定的终态（缺省 completed）
   * @returns 终态会话（已移除出活跃区）；未知会话返回 null
   */
  async finish(
    taskId: string,
    outcome?: { status?: 'completed' | 'failed' | 'cancelled'; error?: string },
  ): Promise<LlmSession | null> {
    const s = this.sessions.get(taskId);
    if (!s) return null;
    if (s.status !== 'running') return s;
    const effective = s.cancelled ? 'cancelled' : (outcome?.status ?? 'completed');
    s.status = effective;
    s.completedAt = Date.now();
    if (outcome?.error && effective !== 'completed') s.error = outcome.error;
    try {
      const result = await this.persister(s);
      s.persistRev = result.rev;
      s.persistPrevRev = result.prevRev;
      s.persistPatch = result.patch;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[llm-session] 终态结果写入画布失败（${s.project}/${s.canvas}）: ${msg}`);
      if (s.status === 'completed') {
        s.status = 'failed';
        s.error = `结果写入画布失败：${msg}`;
      } else {
        s.error = `${s.error ? `${s.error}；` : ''}结果写入画布失败：${msg}`;
      }
    }
    // 同步统一任务注册表（终态移除 + 触发 task-ws 终态广播）：**必须在移出活跃区之前**调用——
    // task-ws 广播 finished 时经 llmSessionLookup 反查会话（读活跃区）提取终态载荷
    // （persistPatch/persistRev/persistPrevRev），若先删除会话，广播将因查不到会话而静默丢失
    // （前端在线路径永远等不到 finished，节点 Loading 无法收敛）；该调用链为同步执行
    // （无 await），广播期间会话仍在活跃区，无并发窗口。回调异常只打日志，不影响会话收敛。
    try {
      s.lifecycle?.onFinish?.(effective);
    } catch (err) {
      console.error(
        `[llm-session] 终态同步任务注册表失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.sessions.delete(taskId);
    this.emit({ type: 'finish', session: s });
    return s;
  }

  /**
   * 当前活跃会话列表（按创建时间倒序，最新的在前）。
   *
   * @returns 活跃会话数组
   */
  listActive(): LlmSession[] {
    return [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
}

/** 全局 LLM 活跃会话管理器单例（所有 LLM 异步调用统一经此登记） */
export const sessionManager = new LlmSessionManager();
