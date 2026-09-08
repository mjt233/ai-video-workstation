import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import { WebSocket } from 'ws';
import { wsHub } from './task-ws.js';
import { taskRegistry } from './registry.js';

/**
 * task-ws 订阅语义测试（真实 HTTP + WS 连接）：
 * - 订阅活跃 ffmpeg 任务 → 不得回 not-found（回归：曾只用 llmSessionLookup 判定，
 *   导致订阅 ffmpeg 任务被误判为「已结束」，画布因此不刷新产物）；
 * - 订阅不存在的任务 → not-found。
 */

/** 启动测试用 HTTP + WS 服务，返回端口与关闭函数 */
async function startServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer();
  wsHub.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/**
 * 建立 WS 连接并等待首个 tasks 全量消息（连接建立即推）。
 *
 * @param port 端口
 * @returns 连接实例与收到的首条消息
 */
function connect(port: number): Promise<{ socket: WebSocket; messages: unknown[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/llm-ws`);
    const messages: unknown[] = [];
    socket.on('message', (raw) => {
      try {
        messages.push(JSON.parse(raw.toString()));
      } catch (e) {
        // 测试替身：非法 JSON 仅记录，不阻断用例
        console.error('[test] 非法消息', e);
      }
    });
    socket.on('open', () => {
      // 等待首个 tasks 消息（连接建立即推）
      const wait = (): void => {
        if (messages.length > 0) resolve({ socket, messages });
        else setTimeout(wait, 10);
      };
      wait();
    });
    socket.on('error', reject);
  });
}

/** 等待指定类型消息出现（超时返回 null） */
async function waitForMessage(
  messages: unknown[],
  type: string,
  timeoutMs = 1500,
): Promise<Record<string, unknown> | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = messages.find((m) => (m as { type?: string }).type === type);
    if (hit) return hit as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

describe('task-ws 订阅语义', () => {
  let port = 0;
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    const s = await startServer();
    port = s.port;
    closeServer = s.close;
  });

  afterAll(async () => {
    taskRegistry.clear();
    await closeServer();
  });

  it('订阅活跃 ffmpeg 任务：登记订阅且不回 not-found', async () => {
    taskRegistry.clear();
    const task = taskRegistry.register({ type: 'ffmpeg', label: '拼接视频', nodeId: 'n1' });
    const { socket, messages } = await connect(port);
    messages.length = 0;

    socket.send(JSON.stringify({ type: 'subscribe', taskId: task.id }));
    const notFound = await waitForMessage(messages, 'not-found', 800);

    expect(notFound).toBeNull();
    socket.close();
  });

  it('订阅不存在的任务：回 not-found', async () => {
    taskRegistry.clear();
    const { socket, messages } = await connect(port);
    messages.length = 0;

    socket.send(JSON.stringify({ type: 'subscribe', taskId: 'missing-task' }));
    const notFound = await waitForMessage(messages, 'not-found');

    expect(notFound).toMatchObject({ type: 'not-found', taskId: 'missing-task' });
    socket.close();
  });

  it('任务终态：先广播 task-update（completed）再更新 tasks 全量列表', async () => {
    taskRegistry.clear();
    const task = taskRegistry.register({ type: 'ffmpeg', label: '拼接视频', nodeId: 'n1' });
    const { socket, messages } = await connect(port);
    messages.length = 0;

    taskRegistry.finish(task.id, { status: 'completed' });

    const update = await waitForMessage(messages, 'task-update');
    expect(update).toMatchObject({ type: 'task-update', task: { id: task.id, status: 'completed' } });
    const list = await waitForMessage(messages, 'tasks');
    expect(list).toMatchObject({ type: 'tasks', tasks: [] });
    socket.close();
  });
});
