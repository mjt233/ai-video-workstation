/**
 * LLM 会话 WebSocket 枢纽（/llm-ws，全局单例连接）。
 *
 * 职责：
 * - 挂载于 http.createServer(app) 的 /llm-ws 路径（ws 库自行处理 upgrade，
 *   不经过 Express 中间件与 SPA 兜底路由）；
 * - **连接建立即推送 `sessions` 全量活跃列表**（含 taskId/nodeId/label/modelName/
 *   phase/status/startedAt/project/canvas，供画布按 scope 过滤恢复与全局面板展示）；
 *   begin/update(阶段切换/警告/错误)/finish 时全量增量广播；
 * - 客户端 subscribe / unsubscribe 订阅关系管理（socket close 时清理该连接
 *   的全部订阅，防僵尸订阅造成广播浪费）；subscribe 时会话存在 → 推 snapshot
 *   （运行中 = 累计进度，部分文本补齐显示），不存在 → 推 not-found（仅结束
 *   Loading，结果已在文件）；
 * - cancel 命令转发到会话管理器（HTTP 兜底见 /api/llm/chat/tasks/:taskId/cancel）；
 * - 终态 finished（含 project/canvas/prevRev/rev/error/output/outputHistory）在会话
 *   管理器 finish 时**全局广播给全部已连接客户端**（不依赖按任务订阅：恢复路径
 *   对账退订后仍能收到，前端按 项目+画布 过滤并按 savedRev === prevRev 采纳对齐），
 *   随后再广播移除该任务的 sessions 列表。
 */

import type { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { sessionManager, type LlmSession } from './session-manager.js';
import type { CanvasDefTarget } from '../assets/canvas-def.js';
import type { LlmTextHistoryEntry } from './result-persist.js';

/** 活跃会话摘要（sessions 广播与全局面板展示用） */
export interface LlmSessionInfo {
  taskId: string;
  nodeId: string;
  label: string;
  modelName?: string;
  phase: 'thinking' | 'responding';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  /** 会话启动时间（毫秒时间戳；耗时由客户端按 startedAt 自行刷新） */
  startedAt: number;
  project: string;
  canvas: CanvasDefTarget;
}

/** 会话快照（subscribe 即发：运行中 = 累计进度，供恢复态补齐显示） */
export interface LlmSnapshotInfo extends LlmSessionInfo {
  thinking: string;
  text: string;
  warnings: string[];
  error?: string;
}

/** 终态载荷（finished 全局广播；后端已完成落盘，patch/rev 供前端视图同步） */
export interface LlmFinishedInfo {
  taskId: string;
  /** 发起会话的节点 id（前端按节点采纳补丁） */
  nodeId: string;
  status: 'completed' | 'failed' | 'cancelled';
  /** 项目名（前端全局通知按项目过滤） */
  project: string;
  /** 画布定位（前端全局通知按画布 scope 过滤） */
  canvas: CanvasDefTarget;
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
export type LlmWsServerMessage =
  | { type: 'sessions'; sessions: LlmSessionInfo[] }
  | { type: 'snapshot'; taskId: string; session: LlmSnapshotInfo }
  | { type: 'thinking' | 'text'; taskId: string; delta: string }
  | { type: 'warning'; taskId: string; message: string }
  | { type: 'finished'; info: LlmFinishedInfo }
  | { type: 'not-found'; taskId: string };

/** 客户端 → 服务端消息 */
interface LlmWsClientMessage {
  type?: unknown;
  taskId?: unknown;
}

class LlmWsHub {
  /** ws 服务实例（attach 后非空） */
  private wss: WebSocketServer | null = null;
  /** 订阅注册表：socket → 已订阅的 taskId 集合 */
  private readonly subscriptions = new Map<WebSocket, Set<string>>();
  /** 会话事件退订（onUnmounted 等价物） */
  private offSessionEvents: (() => void) | null = null;

  /**
   * 挂载 WS 服务到 HTTP 服务器（幂等：重复调用忽略）。
   *
   * @param server HTTP 服务器（http.createServer(app) 的结果）
   */
  attach(server: Server): void {
    if (this.wss) return;
    this.wss = new WebSocketServer({ server, path: '/llm-ws' });
    this.wss.on('connection', (socket) => this.onConnection(socket));
    this.offSessionEvents = sessionManager.on((e) => this.onSessionEvent(e));
  }

  /** 连接建立：初始化订阅集合 + 推送全量活跃列表 + 注册消息/关闭/错误监听 */
  private onConnection(socket: WebSocket): void {
    const subs = new Set<string>();
    this.subscriptions.set(socket, subs);
    this.send(socket, { type: 'sessions', sessions: this.listActive() });
    socket.on('message', (raw) => this.onMessage(socket, subs, raw));
    socket.on('close', () => {
      this.subscriptions.delete(socket); // 关闭即清理该连接全部订阅（防僵尸订阅广播浪费）
    });
    socket.on('error', (e) => {
      console.error(`[llm-ws] 连接异常: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  /** 会话事件 → 全局广播：begin/update 推全量列表；finish 先全局广播终态载荷、再推列表 */
  private onSessionEvent(e: { type: 'begin' | 'update' | 'finish'; session: LlmSession }): void {
    if (e.type === 'finish') {
      const s = e.session;
      const info: LlmFinishedInfo = {
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
      // 先全局广播终态（不依赖订阅：恢复路径对账退订后仍能收到，savedRev 对齐不丢失），
      // 再广播 sessions 列表（任务移除触发前端结束 Loading）
      this.broadcastFinished(info);
      this.broadcastSessions();
    } else {
      // begin / update（阶段切换/警告/错误）：全量活跃列表广播
      this.broadcastSessions();
    }
  }

  /** 客户端消息处理：subscribe / unsubscribe / cancel */
  private onMessage(socket: WebSocket, subs: Set<string>, raw: Buffer | ArrayBuffer | Buffer[]): void {
    let msg: LlmWsClientMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) as LlmWsClientMessage;
    } catch (e) {
      console.error(`[llm-ws] 消息解析失败（已忽略）: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (typeof msg.taskId !== 'string' || !msg.taskId) return;
    const taskId = msg.taskId;
    if (msg.type === 'subscribe') {
      const session = sessionManager.get(taskId);
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
      const ok = sessionManager.cancel(taskId);
      if (!ok) {
        // 会话不存在/已终态：向客户端确认（客户端视为已结束，无需报错）
        this.taskEvent(taskId, { type: 'not-found', taskId });
      }
      return;
    }
  }

  /**
   * 向某会话的全部订阅者广播一条消息（自动补 taskId）。
   * 客户端未连接时无订阅者，为无副作用操作（HTTP 兜底取消不依赖本通道）。
   *
   * @param taskId 会话 id
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

  /** 向全部已连接客户端广播活跃会话全量列表（begin/update/finish 时调用） */
  private broadcastSessions(): void {
    if (!this.wss) return;
    const data = JSON.stringify({ type: 'sessions', sessions: this.listActive() });
    for (const socket of this.subscriptions.keys()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  }

  /**
   * 向全部已连接客户端广播会话终态（不依赖按任务订阅）。
   * 恢复路径可能在终态前已因 sessions 列表对账退订，全局广播保证
   * savedRev 对齐载荷（prevRev/rev/patch）不因退订而丢失。
   *
   * @param info 终态载荷（taskId 注入消息顶层，与任务事件形状一致）
   */
  private broadcastFinished(info: LlmFinishedInfo): void {
    if (!this.wss) return;
    const data = JSON.stringify({ type: 'finished', taskId: info.taskId, info });
    for (const socket of this.subscriptions.keys()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  }

  /** 当前活跃会话摘要列表（按创建时间倒序） */
  private listActive(): LlmSessionInfo[] {
    return sessionManager.listActive().map((s) => this.infoOf(s));
  }

  /** 会话摘要（sessions 列表项） */
  private infoOf(s: LlmSession): LlmSessionInfo {
    return {
      taskId: s.taskId,
      nodeId: s.nodeId,
      label: s.label,
      ...(s.snapshot.modelName ? { modelName: s.snapshot.modelName } : {}),
      phase: s.phase,
      status: s.status,
      startedAt: s.startedAt,
      project: s.project,
      canvas: s.canvas,
    };
  }

  /** 会话快照（订阅即发：运行中 = 累计进度，供恢复态补齐显示） */
  private snapshotOf(s: LlmSession): LlmSnapshotInfo {
    return {
      ...this.infoOf(s),
      thinking: s.thinking,
      text: s.text,
      warnings: [...s.warnings],
      ...(s.error ? { error: s.error } : {}),
    };
  }

  /** 发送消息到单个 socket（未打开时忽略） */
  private send(socket: WebSocket, msg: LlmWsServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }
}

/** 全局 LLM 会话 WS 枢纽单例 */
export const wsHub = new LlmWsHub();
