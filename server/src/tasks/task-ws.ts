/**
 * 统一任务 WebSocket 枢纽（/llm-ws，全局单例连接）。
 *
 * 由原 `llm/session-ws.ts` 改造而来：**路径保持 `/llm-ws`**（生产同源、vite 代理已配），
 * 但载荷从「仅 LLM 活跃会话」升级为「系统全部异步任务」（workflow / llm / ffmpeg）。
 *
 * 职责：
 * - 挂载于 `http.createServer(app)` 的 `/llm-ws` 路径（ws 库自行处理 upgrade，
 *   不经过 Express 中间件与 SPA 兜底路由）；
 * - **连接建立即推送 `tasks` 全量活跃列表**（统一任务摘要：id/type/label/status/progress/
 *   startedAt/nodeId/project/canvas/cancelable），供任务管理器与画布按 scope 过滤恢复；
 * - 注册表 begin/update/finish 事件 → `task-update` 增量广播（含 ffmpeg 进度）；
 * - 客户端 subscribe / unsubscribe 订阅关系管理（socket close 时清理该连接的全部订阅，
 *   防僵尸订阅造成广播浪费）；subscribe 时 LLM 会话存在 → 推 snapshot，不存在 → not-found；
 * - cancel 命令转发到注册表（统一中断；HTTP 兜底见 `POST /api/tasks/:taskId/cancel`）；
 * - LLM 终态 `finished`（含 project/canvas/prevRev/rev/error/output/outputHistory）在会话
 *   管理器 finish 时**全局广播给全部已连接客户端**（不依赖按任务订阅：恢复路径对账退订后
 *   仍能收到，前端按 项目+画布 过滤并按 savedRev === prevRev 采纳对齐）。
 *
 * **LLM 流式增量（thinking/text/warning）不进统一任务模型**：仍按 taskId 订阅单独推送，
 * 否则每个增量都会触发一次全量任务列表广播。
 */

import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { taskRegistry, type TaskRecord } from './registry.js';
import { llmSessionLookup } from './llm-bridge.js';
import type { CanvasDefTarget } from '../assets/canvas-def.js';
import type { LlmSession } from '../llm/session-manager.js';
import type { LlmTextHistoryEntry } from '../llm/result-persist.js';

/** 统一任务摘要（tasks 广播与任务管理器展示用；不含 handle 等不可序列化字段） */
export interface TaskInfo {
  /** 任务 id */
  id: string;
  /** 任务类型 */
  type: 'workflow' | 'llm' | 'ffmpeg';
  /** 展示名 */
  label: string;
  /** 状态 */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** 进度百分比（0~100）；缺省表示不确定进度 */
  progress?: number;
  /** 登记时间（毫秒时间戳） */
  startedAt: number;
  /** 项目名 */
  project?: string;
  /** 发起节点 id */
  nodeId?: string;
  /** 画布定位 */
  canvas?: CanvasDefTarget;
  /** 是否可中断 */
  cancelable: boolean;
  /** 不可中断原因 */
  cancelBlockReason?: string;
  /** 类型自有字段 */
  payload?: Record<string, unknown>;
  /** 错误信息（仅 failed） */
  error?: string;
  /** LLM 会话阶段（仅 type=llm；任务管理器展示 Thinking / 正在响应） */
  phase?: 'thinking' | 'responding';
  /** LLM 模型名（仅 type=llm） */
  modelName?: string;
}

/** LLM 会话快照（subscribe 即发：运行中 = 累计进度，供恢复态补齐显示） */
export interface LlmSnapshotInfo extends TaskInfo {
  /** 累计思考内容（仅内部展示，不写入画布） */
  thinking: string;
  /** 累计正文内容 */
  text: string;
  /** 警告列表 */
  warnings: string[];
  /** 错误信息（仅 failed） */
  error?: string;
}

/** LLM 终态载荷（finished 全局广播；后端已完成落盘，patch/rev 供前端视图同步） */
export interface LlmFinishedInfo {
  /** 会话 id */
  taskId: string;
  /** 发起会话的节点 id（前端按节点采纳补丁） */
  nodeId: string;
  /** 终态 */
  status: 'completed' | 'failed' | 'cancelled';
  /** 项目名（前端全局通知按项目过滤） */
  project: string;
  /** 画布定位（前端全局通知按画布 scope 过滤） */
  canvas: CanvasDefTarget;
  /** 错误信息 */
  error?: string;
  /** 实际写入画布的 config.output（wrote=false 时缺省） */
  output?: string;
  /** 实际写入画布的 config.outputHistory（completed 且正文非空时携带） */
  outputHistory?: LlmTextHistoryEntry[];
  /** 写入后的画布版本号（savedRev 对齐基准） */
  rev?: number;
  /** 写入前的画布版本号（前端 savedRev === prevRev 时才采纳补丁） */
  prevRev?: number;
}

/** 服务端 → 客户端消息 */
export type TaskWsServerMessage =
  | { type: 'tasks'; tasks: TaskInfo[] }
  | { type: 'task-update'; task: TaskInfo }
  | { type: 'snapshot'; taskId: string; session: LlmSnapshotInfo }
  | { type: 'thinking' | 'text'; taskId: string; delta: string }
  | { type: 'warning'; taskId: string; message: string }
  | { type: 'finished'; info: LlmFinishedInfo }
  | { type: 'not-found'; taskId: string };

/** 客户端 → 服务端消息 */
interface TaskWsClientMessage {
  /** 命令类型：subscribe / unsubscribe / cancel */
  type?: unknown;
  /** 任务 id */
  taskId?: unknown;
}

class TaskWsHub {
  /** ws 服务实例（attach 后非空） */
  private wss: WebSocketServer | null = null;
  /** 订阅注册表：socket → 已订阅的 taskId 集合 */
  private readonly subscriptions = new Map<WebSocket, Set<string>>();
  /** 注册表事件退订句柄 */
  private offTaskEvents: (() => void) | null = null;

  /**
   * 挂载 WS 服务到 HTTP 服务器（幂等：重复调用忽略）。
   *
   * @param server HTTP 服务器（http.createServer(app) 的结果）
   */
  attach(server: Server): void {
    if (this.wss) return;
    this.wss = new WebSocketServer({ server, path: '/llm-ws' });
    this.wss.on('connection', (socket) => this.onConnection(socket));
    this.offTaskEvents = taskRegistry.on((e) => this.onTaskEvent(e));
  }

  /** 连接建立：初始化订阅集合 + 推送全量活跃任务列表 + 注册消息/关闭/错误监听 */
  private onConnection(socket: WebSocket): void {
    const subs = new Set<string>();
    this.subscriptions.set(socket, subs);
    this.send(socket, { type: 'tasks', tasks: this.listActive() });
    socket.on('message', (raw) => this.onMessage(socket, subs, raw));
    socket.on('close', () => {
      this.subscriptions.delete(socket); // 关闭即清理该连接全部订阅（防僵尸订阅广播浪费）
    });
    socket.on('error', (e) => {
      console.error(`[task-ws] 连接异常: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  /**
   * 注册表事件 → 广播：
   * - finish 且 type=llm 时先全局广播 LLM 终态载荷（不依赖订阅，保证 savedRev 对齐）；
   * - 随后广播 `task-update`（增量）+ `tasks`（全量列表，终态时任务已移除）。
   *
   * @param e 注册表事件
   */
  private onTaskEvent(e: { type: 'begin' | 'update' | 'finish'; task: TaskRecord }): void {
    if (e.type === 'finish' && e.task.type === 'llm') {
      const info = this.finishedInfoOf(e.task);
      if (info) this.broadcastFinished(info);
    }
    this.broadcast({ type: 'task-update', task: this.infoOf(e.task) });
    this.broadcastSessions();
  }

  /** 客户端消息处理：subscribe / unsubscribe / cancel */
  private onMessage(socket: WebSocket, subs: Set<string>, raw: Buffer | ArrayBuffer | Buffer[]): void {
    let msg: TaskWsClientMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as TaskWsClientMessage;
    } catch (e) {
      console.error(`[task-ws] 消息解析失败（已忽略）: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (typeof msg.taskId !== 'string' || !msg.taskId) return;
    const taskId = msg.taskId;
    if (msg.type === 'subscribe') {
      const session = llmSessionLookup(taskId);
      if (!session) {
        // 订阅时会话已结束/不存在：仅结束 Loading（结果已在文件），无需提示中断
        this.send(socket, { type: 'not-found', taskId });
        return;
      }
      subs.add(taskId);
      this.send(socket, { type: 'snapshot', taskId, session: this.snapshotOf(session) });
      return;
    }
    if (msg.type === 'unsubscribe') {
      subs.delete(taskId);
      return;
    }
    if (msg.type === 'cancel') {
      const result = taskRegistry.cancel(taskId);
      if (!result.ok) {
        // 任务不存在/已终态/不可中断：向客户端确认（客户端视为已结束，无需报错）
        this.taskEvent(taskId, { type: 'not-found', taskId });
      }
      return;
    }
  }

  /**
   * 向某任务的订阅者推送一条消息（自动补 taskId）。
   *
   * @param taskId 任务 id
   * @param payload 消息载荷（type/信息字段；taskId 由本方法注入）
   */
  taskEvent(taskId: string, payload: Record<string, unknown>): void {
    const data = JSON.stringify({ ...payload, taskId });
    if (this.wss) {
      for (const [socket, subs] of this.subscriptions) {
        if (subs.has(taskId) && socket.readyState === WebSocket.OPEN) socket.send(data);
      }
    }
  }

  /** 向全部已连接客户端广播一条消息 */
  private broadcast(payload: Record<string, unknown>): void {
    if (!this.wss) return;
    const data = JSON.stringify(payload);
    for (const socket of this.subscriptions.keys()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  }

  /** 向全部已连接客户端广播活跃任务全量列表（begin/update/finish 时调用） */
  private broadcastSessions(): void {
    this.broadcast({ type: 'tasks', tasks: this.listActive() });
  }

  /**
   * 向全部已连接客户端广播 LLM 终态（不依赖按任务订阅）。
   *
   * @param info 终态载荷
   */
  private broadcastFinished(info: LlmFinishedInfo): void {
    this.broadcast({ type: 'finished', taskId: info.taskId, info });
  }

  /** 当前活跃任务摘要列表（按登记时间倒序） */
  private listActive(): TaskInfo[] {
    return taskRegistry.listActive().map((t) => this.infoOf(t));
  }

  /**
   * 任务记录 → 可序列化摘要（内部转发到共享函数）。
   *
   * @param t 任务记录
   * @returns 任务摘要
   */
  private infoOf(t: TaskRecord): TaskInfo {
    return toTaskInfo(t);
  }

  /**
   * LLM 会话 → 终态载荷（finished 全局广播）。
   *
   * @param t 任务记录（type=llm）
   * @returns 终态载荷；对应会话已不在注册表时返回 null
   */
  private finishedInfoOf(t: TaskRecord): LlmFinishedInfo | null {
    const s = llmSessionLookup(t.id);
    if (!s) return null;
    return {
      taskId: s.taskId,
      nodeId: s.nodeId,
      status: s.status === 'running' ? 'completed' : s.status,
      project: s.project,
      canvas: s.canvas,
      ...(s.error ? { error: s.error } : {}),
      ...(s.persistPatch?.output !== undefined ? { output: s.persistPatch.output } : {}),
      ...(s.persistPatch?.outputHistory ? { outputHistory: s.persistPatch.outputHistory } : {}),
      ...(typeof s.persistRev === 'number' ? { rev: s.persistRev } : {}),
      ...(typeof s.persistPrevRev === 'number' ? { prevRev: s.persistPrevRev } : {}),
    };
  }

  /** LLM 会话快照（订阅即发：运行中 = 累计进度，供恢复态补齐显示） */
  private snapshotOf(s: LlmSession): LlmSnapshotInfo {
    const base = this.infoOf({
      id: s.taskId,
      type: 'llm',
      status: s.status,
      label: s.label,
      project: s.project,
      nodeId: s.nodeId,
      canvas: s.canvas,
      startedAt: s.startedAt,
      updatedAt: Date.now(),
      cancelable: true,
    });
    return {
      ...base,
      thinking: s.thinking,
      text: s.text,
      warnings: [...s.warnings],
      ...(s.error ? { error: s.error } : {}),
    };
  }

  /** 发送消息到单个 socket（未打开时忽略） */
  private send(socket: WebSocket, msg: TaskWsServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }
}

/** 全局统一任务 WS 枢纽单例 */
export const wsHub = new TaskWsHub();

/**
 * 任务记录 → 可序列化摘要（WS 广播与 REST 兜底共用）。
 *
 * 去掉 `handle` 等不可序列化字段；LLM 任务补充阶段与模型名（经 `llm-bridge` 查询会话）。
 *
 * @param t 任务记录
 * @returns 任务摘要
 */
export function toTaskInfo(t: TaskRecord): TaskInfo {
  const session = t.type === 'llm' ? llmSessionLookup(t.id) : undefined;
  return {
    id: t.id,
    type: t.type,
    label: t.label,
    status: t.status,
    ...(typeof t.progress === 'number' ? { progress: t.progress } : {}),
    startedAt: t.startedAt,
    ...(t.project ? { project: t.project } : {}),
    ...(t.nodeId ? { nodeId: t.nodeId } : {}),
    ...(t.canvas ? { canvas: t.canvas } : {}),
    cancelable: t.cancelable,
    ...(t.cancelBlockReason ? { cancelBlockReason: t.cancelBlockReason } : {}),
    ...(t.payload ? { payload: t.payload } : {}),
    ...(t.error ? { error: t.error } : {}),
    ...(session ? { phase: session.phase } : {}),
    ...(session?.snapshot.modelName ? { modelName: session.snapshot.modelName } : {}),
  };
}
