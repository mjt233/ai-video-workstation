import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// 路径解析重定向到临时目录（避免真实 design/ 目录 IO）
const { FS_ROOT, failOnce } = vi.hoisted(() => ({
  FS_ROOT: { path: '' },
  failOnce: { value: false },
}));

// 真实临时目录（模块体初始化后再赋值；mock 工厂执行时读取）
FS_ROOT.path = path.resolve(os.tmpdir(), `dsh-llm-persist-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

vi.mock('../assets/paths.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../assets/paths.js')>();
  return { ...mod, resolveProjectPath: (_project: string, rel: string) => path.resolve(FS_ROOT.path, rel) };
});

// saveCanvasDef 包装：首次调用可注入 VERSION_CONFLICT（CAS 冲突重试路径）
vi.mock('../assets/canvas-def.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../assets/canvas-def.js')>();
  return {
    ...mod,
    saveCanvasDef: vi.fn(async (project: string, target: unknown, data: unknown, expectedRev: number | undefined, force: boolean) => {
      if (failOnce.value) {
        failOnce.value = false;
        throw Object.assign(new Error('冲突'), { code: 'VERSION_CONFLICT', currentRev: expectedRev, expectedRev });
      }
      return mod.saveCanvasDef(project, target as never, data, expectedRev, force);
    }),
  };
});

import { persistLlmResult, MAX_TEXT_HISTORY_VERSIONS, type LlmTextHistoryEntry } from './result-persist.js';
import type { LlmSession } from './session-manager.js';

/** 画布定义文件相对路径（分镜画布 1集1分镜） */
const CANVAS_REL = path.join('prompt', 'scene', '1', '1', 'canvas.json');

/** 合法历史条目（结构完整） */
function historyEntry(i: number): LlmTextHistoryEntry {
  return { id: `h${i}`, createdAt: new Date(1700000000000 + i).toISOString(), input: `in${i}`, output: `out${i}` };
}

/** 构造终态会话（字段最小集） */
function makeSession(overrides: Partial<LlmSession> = {}): LlmSession {
  return {
    taskId: 'task-1',
    nodeId: 'node-1',
    providerInstanceId: 'inst',
    modelId: 'model',
    label: 'AI文本生成',
    project: 'proj',
    canvas: { kind: 'scene', episode: '1', shot: '1' },
    inputSent: '你好',
    snapshot: { modelName: '模型A', presetName: '预设B', mediaLabels: ['图1.png'] },
    status: 'completed',
    phase: 'responding',
    thinking: '思路（不应写入 config）',
    text: '最终答案',
    warnings: [],
    createdAt: Date.now(),
    startedAt: Date.now(),
    cancelled: false,
    abortController: new AbortController(),
    ...overrides,
  };
}

/** 写入一个画布定义文件（含 rev） */
async function writeCanvas(nodes: unknown[], rev = 3): Promise<void> {
  const full = path.resolve(FS_ROOT.path, CANVAS_REL);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const payload = {
    version: 1,
    kind: 'scene',
    nodes,
    connections: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    rev,
  };
  await fs.writeFile(full, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/** 读取画布定义文件（测试断言用） */
async function readCanvas(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.resolve(FS_ROOT.path, CANVAS_REL), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

/** 读取目标节点 config */
async function readNodeConfig(nodeId = 'node-1'): Promise<Record<string, unknown>> {
  const data = await readCanvas();
  const node = (data.nodes as { id?: string; config?: unknown }[]).find((n) => n.id === nodeId);
  return (node?.config ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  failOnce.value = false;
});

afterEach(async () => {
  await fs.rm(FS_ROOT.path, { recursive: true, force: true });
});

describe('persistLlmResult（completed）', () => {
  it('写入 output 与 outputHistory（快照来自 inputSent/snapshot，id/createdAt 生成）', async () => {
    await writeCanvas([{ id: 'node-1', prototypeId: 'text-ai', name: 'AI文本生成', config: { input: '', output: '旧输出' } }]);
    const result = await persistLlmResult(makeSession());
    expect(result.wrote).toBe(true);
    expect(typeof result.rev).toBe('number');
    const cfg = await readNodeConfig();
    expect(cfg.output).toBe('最终答案');
    const history = cfg.outputHistory as unknown[];
    expect(history).toHaveLength(1);
    const entry = history[0] as LlmTextHistoryEntry;
    expect(entry.input).toBe('你好');
    expect(entry.output).toBe('最终答案');
    expect(entry.modelName).toBe('模型A');
    expect(entry.presetName).toBe('预设B');
    expect(entry.mediaLabels).toEqual(['图1.png']);
    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(typeof entry.createdAt).toBe('string');
  });

  it('快照 userInput 存在时历史 input 取用户原始输入（不含预设提示词拼入内容）', async () => {
    await writeCanvas([{ id: 'node-1', prototypeId: 'text-ai', name: 'AI文本生成', config: {} }]);
    const result = await persistLlmResult(
      makeSession({
        inputSent: '你是助手。\n写一首诗',
        snapshot: { modelName: '模型A', presetName: '预设B', userInput: '写一首诗' },
      }),
    );
    expect(result.wrote).toBe(true);
    const cfg = await readNodeConfig();
    const history = cfg.outputHistory as LlmTextHistoryEntry[];
    expect(history).toHaveLength(1);
    expect(history[0].input).toBe('写一首诗');
    expect(history[0].presetName).toBe('预设B');
  });

  it('thinking 内容不写入 config.output（仅正文落盘）', async () => {
    await writeCanvas([{ id: 'node-1', prototypeId: 'text-ai', name: 'x', config: {} }]);
    await persistLlmResult(makeSession({ text: '只存正文', thinking: '内部思路' }));
    const cfg = await readNodeConfig();
    expect(cfg.output).toBe('只存正文');
    expect(cfg.output).not.toContain('内部思路');
  });

  it('已有历史时追加并裁剪到 50 条（丢弃最旧）', async () => {
    const existing = Array.from({ length: MAX_TEXT_HISTORY_VERSIONS }, (_, i) => historyEntry(i + 1));
    await writeCanvas([
      { id: 'node-1', prototypeId: 'text-ai', name: 'x', config: { outputHistory: existing } },
    ]);
    await persistLlmResult(makeSession({ text: '第51次' }));
    const cfg = await readNodeConfig();
    const history = (cfg.outputHistory as LlmTextHistoryEntry[]);
    expect(history).toHaveLength(MAX_TEXT_HISTORY_VERSIONS);
    // 最旧一条被裁剪；最新在末尾
    expect(history[0].id).toBe('h2');
    expect(history[history.length - 1].output).toBe('第51次');
    expect(history.some((h) => h.id === 'h1')).toBe(false);
  });

  it('完成时 rev 递增（rev+1）且其余字段保留', async () => {
    await writeCanvas([{ id: 'node-1', prototypeId: 'text-ai', name: 'x', config: {} }], 3);
    await persistLlmResult(makeSession());
    const data = await readCanvas();
    expect(data.rev).toBe(4);
    expect(data.version).toBe(1);
    expect(data.kind).toBe('scene');
  });
});

describe('persistLlmResult（cancelled / failed）', () => {
  it('取消：部分输出写入 output，不追加历史', async () => {
    await writeCanvas([{ id: 'node-1', prototypeId: 'text-ai', name: 'x', config: { outputHistory: [historyEntry(1)] } }]);
    const result = await persistLlmResult(makeSession({ status: 'cancelled', text: '部分答案' }));
    expect(result.wrote).toBe(true);
    const cfg = await readNodeConfig();
    expect(cfg.output).toBe('部分答案');
    expect(cfg.outputHistory).toHaveLength(1); // 不追加
  });

  it('失败：部分输出写入 output，不追加历史', async () => {
    await writeCanvas([{ id: 'node-1', prototypeId: 'text-ai', name: 'x', config: {} }]);
    const result = await persistLlmResult(makeSession({ status: 'failed', text: '报错前的输出', error: '模型异常' }));
    expect(result.wrote).toBe(true);
    const cfg = await readNodeConfig();
    expect(cfg.output).toBe('报错前的输出');
    expect(cfg.outputHistory).toBeUndefined();
  });

  it('取消且无累计文本：跳过写入（wrote=false，文件不变）', async () => {
    await writeCanvas([{ id: 'node-1', prototypeId: 'text-ai', name: 'x', config: { output: '旧输出' } }], 2);
    const result = await persistLlmResult(makeSession({ status: 'cancelled', text: '' }));
    expect(result.wrote).toBe(false);
    expect(result.rev).toBeUndefined();
    const cfg = await readNodeConfig();
    expect(cfg.output).toBe('旧输出');
  });
});

describe('persistLlmResult（跳过 / 失败路径）', () => {
  it('节点已删除：跳过写盘', async () => {
    await writeCanvas([{ id: 'other-node', prototypeId: 'text-ai', name: 'x', config: {} }]);
    const result = await persistLlmResult(makeSession());
    expect(result.wrote).toBe(false);
  });

  it('画布定义文件不存在：跳过写盘', async () => {
    const result = await persistLlmResult(makeSession());
    expect(result.wrote).toBe(false);
  });

  it('CAS 冲突自动重试（首轮冲突 → 重读成功）', async () => {
    await writeCanvas([{ id: 'node-1', prototypeId: 'text-ai', name: 'x', config: {} }], 3);
    failOnce.value = true;
    const result = await persistLlmResult(makeSession());
    expect(result.wrote).toBe(true);
    expect(result.rev).toBe(4);
  });

  it('画布文件损坏（非法 JSON）抛错（由会话管理器收敛为 failed）', async () => {
    const full = path.resolve(FS_ROOT.path, CANVAS_REL);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, '{ 不是 JSON', 'utf8');
    await expect(persistLlmResult(makeSession())).rejects.toThrow();
  });
});
