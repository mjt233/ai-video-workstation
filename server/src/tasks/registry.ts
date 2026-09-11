/**
 * 统一异步任务注册表（仅内存，不持久化）。
 *
 * 系统内**所有**异步任务（AI 生成工作流 / LLM 会话 / 本地 ffmpeg 处理）统一经本模块登记，
 * 是任务运行态的**唯一事实源**：任务管理器面板、画布 Loading 恢复、中断操作全部读这里。
 *
 * 生命周期：`register()` 登记 → `update()` 推进（进度/阶段/警告）→ `finish()` 终态收敛并移出活跃区。
 * 服务重启后注册表为空（内存 only 的既定取舍：工作流任务的持久化权威是 SQLite，LLM 终态已落盘，
 * ffmpeg 产物已写文件系统）。
 *
 * 本模块**不依赖任何具体执行器**（只依赖 `executor.ts` 的 `TaskHandle` 接口），也不依赖 WS 传输
 * （`task-ws.ts` 通过 `on()` 订阅 begin/update/finish 事件做广播），便于独立单测与替换传输层。
 */

import { randomUUID } from 'crypto';
import type { CanvasDefTarget } from '../assets/canvas-def.js';
import type { TaskHandle } from './executor.js';

/** 任务类型：工作流（AI 生成）/ LLM 会话 / 本地 ffmpeg 处理 */
export type TaskType = 'workflow' | 'llm' | 'ffmpeg';

/**
 * 任务状态：
 * - pending：已登记待执行（工作流本地排队）；
 * - running：执行中；
 * - completed / failed / cancelled：终态（终态即移出活跃区，不保留完成区）。
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** 全局活跃任务上限（超过时 register() 拒绝，防止误操作打满子进程与内存） */
export const MAX_ACTIVE_TASKS = 32;

/** 统一任务记录（跨类型公共字段一致；各类型自有字段放 payload） */
export interface TaskRecord {
  /** 任务唯一 id（register 时生成，作为客户端订阅/取消凭据） */
  id: string;
  /** 任务类型 */
  type: TaskType;
  /** 任务状态 */
  status: TaskStatus;
  /** 展示名（如「拼接视频」「AI文本生成」） */
  label: string;
  /** 项目名（前端按项目过滤） */
  project?: string;
  /** 发起节点 id（画布恢复时按节点定位） */
  nodeId?: string;
  /** 画布定位（前端按 scope 过滤恢复） */
  canvas?: CanvasDefTarget;
  /** 进度百分比（0~100）；缺省表示不确定进度（如 LLM 会话） */
  progress?: number;
  /** 登记时间（毫秒时间戳；列表排序用） */
  startedAt: number;
  /** 最近一次更新时间（毫秒时间戳） */
  updatedAt: number;
  /** 终态时间（毫秒时间戳；仅终态任务有值） */
  finishedAt?: number;
  /** 错误信息（仅 failed） */
  error?: string;
  /** 是否可中断（false 时 UI 置灰并展示 cancelBlockReason） */
  cancelable: boolean;
  /** 不可中断的原因（cancelable=false 时必填，供 UI 提示） */
  cancelBlockReason?: string;
  /** 类型自有字段（如 ffmpeg 的模式/输出尺寸、llm 的模型名与阶段） */
  payload?: Record<string, unknown>;
  /** 运行态中断凭据（仅内存持有，**不进入广播载荷**） */
  handle?: TaskHandle;
  /** 登记序号（同一毫秒内登记的任务排序用；仅内部使用，不广播） */
  seq?: number;
}

/** register() 入参（除 id/状态/时间戳外与 TaskRecord 一致） */
export interface TaskRegisterInput {
  /** 任务类型 */
  type: TaskType;
  /** 展示名 */
  label: string;
  /** 项目名 */
  project?: string;
  /** 发起节点 id */
  nodeId?: string;
  /** 画布定位 */
  canvas?: CanvasDefTarget;
  /** 初始状态（缺省 running；工作流本地排队用 pending） */
  status?: TaskStatus;
  /** 初始进度（0~100） */
  progress?: number;
  /** 是否可中断（缺省 true） */
  cancelable?: boolean;
  /** 不可中断原因 */
  cancelBlockReason?: string;
  /** 类型自有字段 */
  payload?: Record<string, unknown>;
  /** 中断凭据 */
  handle?: TaskHandle;
  /**
   * 指定任务 id（缺省自动生成 UUID）。
   *
   * LLM 会话以会话 id 作为任务 id，使前端只需一个凭据（订阅流式事件与中断统一走 taskId）。
   */
  idOverride?: string;
}

/** update() 可变更字段（id/type/startedAt 不可变） */
export interface TaskUpdatePatch {
  /** 新状态（一般不用于终态，终态走 finish） */
  status?: TaskStatus;
  /** 进度百分比（0~100） */
  progress?: number;
  /** 展示名 */
  label?: string;
  /** 错误信息 */
  error?: string;
  /** 是否可中断 */
  cancelable?: boolean;
  /** 不可中断原因（置空时用空串表示无原因） */
  cancelBlockReason?: string;
  /** 类型自有字段（与既有 payload 浅合并） */
  payload?: Record<string, unknown>;
  /** 替换中断凭据 */
  handle?: TaskHandle;
}

/** 任务事件（task-ws 订阅用）：begin = 新任务登记；update = 字段变化；finish = 终态移除 */
export interface TaskEvent {
  /** 事件类型 */
  type: 'begin' | 'update' | 'finish';
  /** 事件对应的任务记录（finish 时为终态快照） */
  task: TaskRecord;
}

/** 任务登记错误（同节点单飞冲突 / 全局上限） */
export class TaskError extends Error {
  /** 错误码：NODE_BUSY = 同节点已有活跃任务；TASK_LIMIT = 全局活跃任务已达上限 */
  readonly code: 'NODE_BUSY' | 'TASK_LIMIT';

  /**
   * @param code 错误码
   * @param message 中文错误说明（直接返回给前端）
   */
  constructor(code: 'NODE_BUSY' | 'TASK_LIMIT', message: string) {
    super(message);
    this.name = 'TaskError';
    this.code = code;
  }
}

class TaskRegistry {
  /** 活跃区：id → 任务（终态即移除，无完成区） */
  private readonly tasks = new Map<string, TaskRecord>();
  /** 已收敛任务快照：id → 终态记录（保证 finish 幂等返回同一对象） */
  private readonly finished = new Map<string, TaskRecord>();
  /** 登记序号（同一毫秒内登记的任务排序用，保证列表稳定） */
  private seq = 0;
  /** 事件监听器（task-ws 注册） */
  private readonly listeners = new Set<(e: TaskEvent) => void>();

  /**
   * 订阅任务事件（begin / update / finish），返回取消订阅函数。
   *
   * @param listener 事件监听器
   * @returns 取消订阅函数
   */
  on(listener: (e: TaskEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 触发任务事件（监听器异常只打日志，不阻断任务推进）。
   *
   * @param e 任务事件
   */
  private emit(e: TaskEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(e);
      } catch (err) {
        console.error(
          `[task-registry] 任务事件监听器异常（${e.type}）: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * 登记一个活跃任务（同节点单飞 + 全局上限校验）。
   *
   * @param input 登记参数
   * @returns 新任务记录（id 作为客户端订阅/取消凭据）
   * @throws TaskError 同节点已有活跃任务（NODE_BUSY）或全局上限（TASK_LIMIT）
   */
  register(input: TaskRegisterInput): TaskRecord {
    if (this.tasks.size >= MAX_ACTIVE_TASKS) {
      throw new TaskError(
        'TASK_LIMIT',
        `活跃任务已达上限（${MAX_ACTIVE_TASKS}），请等待现有任务完成或中断后再试`,
      );
    }
    if (input.nodeId) {
      for (const t of this.tasks.values()) {
        if (t.nodeId === input.nodeId) {
          throw new TaskError('NODE_BUSY', '该节点已有进行中的任务，请先等待完成或中断');
        }
      }
    }
    const now = Date.now();
    const task: TaskRecord = {
      id: input.idOverride ?? randomUUID(),
      type: input.type,
      status: input.status ?? 'running',
      label: input.label,
      ...(input.project ? { project: input.project } : {}),
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      ...(input.canvas ? { canvas: { ...input.canvas } } : {}),
      ...(typeof input.progress === 'number' ? { progress: input.progress } : {}),
      startedAt: now,
      updatedAt: now,
      cancelable: input.cancelable !== false,
      ...(input.cancelBlockReason ? { cancelBlockReason: input.cancelBlockReason } : {}),
      ...(input.payload ? { payload: { ...input.payload } } : {}),
      ...(input.handle ? { handle: input.handle } : {}),
    };
    this.tasks.set(task.id, task);
    this.finished.delete(task.id);
    this.seq += 1;
    task.seq = this.seq;
    this.emit({ type: 'begin', task });
    return task;
  }

  /**
   * 按 id 获取任务。
   *
   * @param id 任务 id
   * @returns 任务记录或 undefined（不存在/已终态移除）
   */
  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  /**
   * 合并更新任务字段（未知/已终态任务忽略，幂等）。
   *
   * @param id 任务 id
   * @param patch 变更字段（payload 与既有值浅合并）
   * @returns 更新后的任务记录；任务不存在返回 undefined
   */
  update(id: string, patch: TaskUpdatePatch): TaskRecord | undefined {
    const t = this.tasks.get(id);
    if (!t || t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled') return t;
    if (patch.status) t.status = patch.status;
    if (typeof patch.progress === 'number') {
      t.progress = Math.max(0, Math.min(100, patch.progress));
    }
    if (typeof patch.label === 'string') t.label = patch.label;
    if (typeof patch.error === 'string') t.error = patch.error;
    if (typeof patch.cancelable === 'boolean') t.cancelable = patch.cancelable;
    if (typeof patch.cancelBlockReason === 'string') {
      if (patch.cancelBlockReason) t.cancelBlockReason = patch.cancelBlockReason;
      else delete t.cancelBlockReason;
    }
    if (patch.payload) t.payload = { ...(t.payload ?? {}), ...patch.payload };
    if (patch.handle) t.handle = patch.handle;
    t.updatedAt = Date.now();
    this.emit({ type: 'update', task: t });
    return t;
  }

  /**
   * 终态收敛：置状态/终态时间后移出活跃区（幂等：已终态直接返回缓存快照）。
   *
   * **本方法按调用方声明的 `outcome.status` 落状态，不做任何优先级判定**——
   * 「已请求取消的任务即使执行器报成功也按 cancelled 收敛」这条语义由**执行器**保证：
   * ffmpeg 执行器在 `error` 事件里判 `cancelRequested` 收敛为 cancelled，
   * 工作流引擎在写产物前检查 `cancelRequested` 标记并抛「用户中断」。
   * 因此新增执行器时必须在自己的终态分支里处理取消，不能依赖注册表。
   *
   * @param id 任务 id
   * @param outcome 终态（缺省 completed）
   * @returns 终态任务快照；任务不存在返回 null（已终态则返回缓存快照）
   */
  finish(id: string, outcome?: { status?: TaskStatus; error?: string }): TaskRecord | null {
    const t = this.tasks.get(id);
    if (!t) return this.finished.get(id) ?? null;
    t.status = outcome?.status ?? 'completed';
    if (outcome?.error) t.error = outcome.error;
    t.finishedAt = Date.now();
    t.updatedAt = t.finishedAt;
    if (t.progress === undefined && t.status === 'completed') t.progress = 100;
    this.tasks.delete(id);
    this.finished.set(id, t);
    this.emit({ type: 'finish', task: t });
    return t;
  }

  /**
   * 请求中断任务：委托任务句柄（不关心具体执行机制）。
   *
   * 句柄的 cancel 为异步时**不阻塞调用方**（中断结果由执行器经 finish 收敛）。
   * 不可中断的任务返回 false 并携带原因，供路由层返回 400。
   *
   * @param id 任务 id
   * @returns ok=true 已受理；否则 ok=false + reason（不存在/已终态/不可中断）
   */
  cancel(id: string): { ok: true } | { ok: false; reason: string } {
    const t = this.tasks.get(id);
    if (!t) return { ok: false, reason: '任务不存在或已结束' };
    if (t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled') {
      return { ok: false, reason: '任务已结束' };
    }
    if (!t.cancelable) return { ok: false, reason: t.cancelBlockReason ?? '该任务不支持中断' };
    if (!t.handle) return { ok: false, reason: '该任务暂不支持中断' };
    try {
      void Promise.resolve(t.handle.cancel()).catch((e: unknown) => {
        console.error(
          `[task-registry] 中断任务失败（${t.type}/${t.id}）: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    } catch (e) {
      console.error(
        `[task-registry] 中断任务异常（${t.type}/${t.id}）: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { ok: false, reason: '中断请求失败' };
    }
    return { ok: true };
  }

  /**
   * 当前活跃任务列表（按登记时间倒序，最新的在前）。
   *
   * @returns 活跃任务数组（含 handle，调用方自行裁剪后广播）
   */
  listActive(): TaskRecord[] {
    return [...this.tasks.values()].sort((a, b) => b.startedAt - a.startedAt || (b.seq ?? 0) - (a.seq ?? 0));
  }

  /** 清空全部任务（仅测试使用） */
  clear(): void {
    this.tasks.clear();
    this.finished.clear();
    this.seq = 0;
  }
}

/** 全局统一任务注册表单例（所有异步任务统一经此登记） */
export const taskRegistry = new TaskRegistry();

/** 便于单测构造独立实例 */
export type { TaskRegistry as TaskRegistryType };
