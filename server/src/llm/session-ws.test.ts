import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'http';
import { WebSocket } from 'ws';
import { wsHub, type LlmWsServerMessage } from './session-ws.js';
import { sessionManager } from './session-manager.js';
import type { LlmPersistResult } from './result-persist.js';

/** 测试用 HTTP 服务器（真实 ws 握手；端口 0 随机分配） */
let server: Server;
let port: number;

/** 已打开的客户端集合（afterEach 统一清理） */
const clients = new Set<WebSocket>();

/** 构造一个 WS 客户端并等待连接建立（首条 sessions 全量列表到达） */
async function openClient(): Promise<{ socket: WebSocket; messages: LlmWsServerMessage[] }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/llm-ws`);
  const messages: LlmWsServerMessage[] = [];
  socket.on('message', (raw) => {
    messages.push(JSON.parse(String(raw)) as LlmWsServerMessage);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  clients.add(socket);
  // 等待连接即推的 sessions
  await waitFor(messages, (m) => m.type === 'sessions');
  return { socket, messages };
}

/** 等待客户端收到指定类型的消息 */
async function waitFor(
  messages: LlmWsServerMessage[],
  pred: (m: LlmWsServerMessage) => boolean,
  timeoutMs = 3000,
): Promise<LlmWsServerMessage> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = messages.find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('等待 WS 消息超时');
}

/** 向会话管理器注入终态落盘替身（finish 不触碰真实文件系统） */
function stubPersister(result: Partial<LlmPersistResult> = {}) {
  sessionManager.setPersister(async (): Promise<LlmPersistResult> => ({
    wrote: true,
    rev: 11,
    prevRev: 10,
    patch: { output: '最终答案', outputHistory: [{ id: 'h1', createdAt: '2024-01-01T00:00:00.000Z', input: '你好', output: '最终答案' }] },
    ...result,
  }));
}

function registerSession() {
  return sessionManager.begin({
    nodeId: 'node-1',
    providerInstanceId: 'inst',
    modelId: 'model',
    label: 'AI文本生成',
    project: 'proj',
    canvas: { kind: 'scene', episode: '1', shot: '1' },
    input: '你好',
    snapshot: { modelName: '模型A' },
  });
}

beforeAll(async () => {
  stubPersister();
  server = createServer();
  wsHub.attach(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('测试服务器未监听');
  port = (addr as { port: number }).port;
});

afterAll(async () => {
  for (const c of clients) c.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  stubPersister();
});

afterEach(async () => {
  // 清理全部活跃会话（终态收敛后从注册表移除）
  for (const s of sessionManager.listActive()) {
    sessionManager.cancel(s.taskId);
    await sessionManager.finish(s.taskId, { status: 'cancelled' });
  }
  for (const c of clients) c.close();
  clients.clear();
  vi.restoreAllMocks();
});

describe('LlmWsHub', () => {
  it('连接建立即推送 sessions 全量活跃列表（含 nodeId/phase/project/canvas）', async () => {
    const s = registerSession();
    const { messages } = await openClient();
    const sessions = messages.find((m) => m.type === 'sessions');
    expect(sessions).toBeDefined();
    const list = (sessions as { sessions: unknown[] }).sessions;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      taskId: s.taskId,
      nodeId: 'node-1',
      label: 'AI文本生成',
      phase: 'thinking',
      status: 'running',
      project: 'proj',
      canvas: { kind: 'scene', episode: '1', shot: '1' },
    });
  });

  it('subscribe 未知/已终态任务 → not-found', async () => {
    const { socket, messages } = await openClient();
    socket.send(JSON.stringify({ type: 'subscribe', taskId: 'no-such-task' }));
    const msg = await waitFor(messages, (m) => m.type === 'not-found');
    expect(msg).toMatchObject({ taskId: 'no-such-task' });
  });

  it('subscribe 运行中任务 → snapshot 补齐（累计进度）→ 实时增量广播', async () => {
    const s = registerSession();
    const { socket, messages } = await openClient();
    // 先推两条进度再订阅（模拟恢复态补进度）
    sessionManager.pushEvent(s.taskId, { type: 'thinking', delta: '思路' });
    sessionManager.pushEvent(s.taskId, { type: 'text', delta: '答' });
    socket.send(JSON.stringify({ type: 'subscribe', taskId: s.taskId }));
    const snapshot = await waitFor(messages, (m) => m.type === 'snapshot');
    expect(snapshot).toMatchObject({
      taskId: s.taskId,
      session: { text: '答', thinking: '思路', phase: 'responding', status: 'running' },
    });
    // 增量广播到达订阅者（模拟后台执行器：pushEvent + hub.taskEvent 双通道）
    sessionManager.pushEvent(s.taskId, { type: 'text', delta: '案' });
    wsHub.taskEvent(s.taskId, { type: 'text', delta: '案' });
    const delta = await waitFor(messages, (m) => m.type === 'text');
    expect(delta).toMatchObject({ taskId: s.taskId, delta: '案' });
  });

  it('begin/update 广播 sessions 列表（阶段切换反映 phase）', async () => {
    const { messages } = await openClient();
    const s = registerSession();
    await waitFor(
      messages,
      (m) =>
        m.type === 'sessions'
        && (m as { sessions: { taskId: string; phase: string }[] }).sessions.some(
          (x) => x.taskId === s.taskId && x.phase === 'thinking',
        ),
    );
    sessionManager.pushEvent(s.taskId, { type: 'text', delta: '正文' });
    const updated = await waitFor(
      messages,
      (m) =>
        m.type === 'sessions'
        && (m as { sessions: { phase: string }[] }).sessions.some((x) => x.phase === 'responding'),
    );
    expect(updated).toBeDefined();
  });

  it('finish → finished 载荷（含 nodeId/project/canvas/prevRev/rev 与落盘补丁）+ sessions 移除，且终态先于列表广播', async () => {
    const { socket, messages } = await openClient();
    const s = registerSession();
    socket.send(JSON.stringify({ type: 'subscribe', taskId: s.taskId }));
    await waitFor(messages, (m) => m.type === 'snapshot');
    sessionManager.pushEvent(s.taskId, { type: 'text', delta: '最终答案' });
    await sessionManager.finish(s.taskId, { status: 'completed' });
    const finished = await waitFor(messages, (m) => m.type === 'finished');
    expect(finished).toMatchObject({
      taskId: s.taskId,
      info: {
        taskId: s.taskId,
        nodeId: 'node-1',
        status: 'completed',
        output: '最终答案',
        rev: 11,
        prevRev: 10,
        project: 'proj',
        canvas: { kind: 'scene', episode: '1', shot: '1' },
      },
    });
    const sessionsAfter = await waitFor(messages, (m) => m.type === 'sessions' && (m as { sessions: unknown[] }).sessions.length === 0);
    expect((sessionsAfter as { sessions: unknown[] }).sessions).toHaveLength(0);
    // 顺序保证：finished 必须先于「移除该任务的 sessions 列表」到达（终态采纳不因对账退订而丢失）
    const finishedIdx = messages.findIndex((m) => m.type === 'finished');
    const emptiedIdx = messages.findIndex(
      (m, i) => i > finishedIdx && m.type === 'sessions' && (m as { sessions: unknown[] }).sessions.length === 0,
    );
    expect(finishedIdx).toBeGreaterThanOrEqual(0);
    expect(emptiedIdx).toBeGreaterThan(finishedIdx);
  });

  it('finished 全局广播：未订阅该任务的客户端同样收到终态载荷（savedRev 对齐不依赖订阅）', async () => {
    const bystander = await openClient(); // 未订阅任何任务
    const { socket, messages } = await openClient();
    const s = registerSession();
    socket.send(JSON.stringify({ type: 'subscribe', taskId: s.taskId }));
    await waitFor(messages, (m) => m.type === 'snapshot');
    await sessionManager.finish(s.taskId, { status: 'completed' });
    const finished = await waitFor(bystander.messages, (m) => m.type === 'finished');
    expect(finished).toMatchObject({
      taskId: s.taskId,
      info: { nodeId: 'node-1', status: 'completed', rev: 11, prevRev: 10, project: 'proj' },
    });
  });

  it('cancel 命令：服务端标记取消（幂等收敛为 cancelled）', async () => {
    const { socket } = await openClient();
    const s = registerSession();
    socket.send(JSON.stringify({ type: 'cancel', taskId: s.taskId }));
    await vi.waitFor(() => {
      expect(sessionManager.get(s.taskId)?.cancelled).toBe(true);
    });
    const done = await sessionManager.finish(s.taskId, { status: 'cancelled' });
    expect(done?.status).toBe('cancelled');
  });

  it('unsubscribe → 不再收到增量（任务继续）', async () => {
    const { socket, messages } = await openClient();
    const s = registerSession();
    socket.send(JSON.stringify({ type: 'subscribe', taskId: s.taskId }));
    await waitFor(messages, (m) => m.type === 'snapshot');
    socket.send(JSON.stringify({ type: 'unsubscribe', taskId: s.taskId }));
    // 等待退订生效（网络级时序：小延迟后推送增量）
    await new Promise((r) => setTimeout(r, 50));
    // 模拟后台执行器推送（增量事件只应送达订阅者；全局 sessions 广播仍会发生）
    sessionManager.pushEvent(s.taskId, { type: 'text', delta: '不应收到' });
    wsHub.taskEvent(s.taskId, { type: 'text', delta: '不应收到' });
    await new Promise((r) => setTimeout(r, 100));
    expect(messages.filter((m) => m.type === 'text')).toHaveLength(0);
    // 会话仍在服务端继续（未取消）
    expect(sessionManager.get(s.taskId)?.text).toBe('不应收到');
  });
});
