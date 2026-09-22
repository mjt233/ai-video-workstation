/**
 * 工作流文本产物落盘（`canvas/text-result.ts`）单测。
 *
 * 覆盖：写入内容（output + outputHistory 追加）、无画布定位/节点已删除的跳过语义、
 * CAS 版本冲突重试、以及重试耗尽后抛错（调用方据此把任务标记失败）。
 * 复用 `canvas-fs.fixture.ts` 的临时画布夹具（与 LLM 会话落盘测试同一套并发语义）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 夹具引用：vi.hoisted 保证它在 vi.mock 工厂（同样被提升）执行前就已存在
const holder = vi.hoisted(() => ({
  fixture: null as ReturnType<typeof import('./canvas-fs.fixture.js').createCanvasFsFixture> | null,
}));

vi.mock('../assets/paths.js', async () => {
  const { createCanvasFsFixture } = await import('./canvas-fs.fixture.js');
  holder.fixture = createCanvasFsFixture();
  return holder.fixture.pathsMock();
});

vi.mock('../assets/canvas-def.js', async () => {
  if (!holder.fixture) {
    const { createCanvasFsFixture } = await import('./canvas-fs.fixture.js');
    holder.fixture = createCanvasFsFixture();
  }
  return holder.fixture.canvasDefMock();
});

import { makeCanvasData, nodeConfigOf, SCENE_CANVAS_TARGET } from './canvas-fs.fixture.js';
import { persistTextResult } from './text-result.js';

/** 夹具（模块加载后必定已由 vi.mock 工厂赋值） */
const fixture = holder.fixture!;

/** 落盘入参（项目名固定 proj；画布定位为第 1 集第 1 分镜） */
function options(overrides: Record<string, unknown> = {}): Parameters<typeof persistTextResult>[0] {
  return {
    project: 'proj',
    canvas: SCENE_CANVAS_TARGET,
    nodeId: 'n1',
    text: '生成出来的文本',
    input: '提示词',
    modelName: '文本工作流A',
    ...overrides,
  } as Parameters<typeof persistTextResult>[0];
}

beforeEach(() => {
  fixture.failOnce.value = false;
  fixture.alwaysFail.value = false;
});

afterEach(async () => {
  await fixture.cleanup();
});

describe('persistTextResult', () => {
  it('写入 config.output 并追加一条 outputHistory（末尾为最新，保留旧条目）', async () => {
    await fixture.writeCanvas(makeCanvasData('n1', {
      output: '旧文本',
      outputHistory: [{
        id: 'old',
        createdAt: '2026-01-01T00:00:00.000Z',
        input: '旧提示词',
        output: '旧文本',
      }],
    }));

    const result = await persistTextResult(options());

    expect(result.wrote).toBe(true);
    expect(result.prevRev).toBe(3);
    expect(result.rev).toBe(4);
    const config = nodeConfigOf(await fixture.readCanvas(), 'n1')!;
    expect(config.output).toBe('生成出来的文本');
    const history = config.outputHistory as Array<Record<string, unknown>>;
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe('old');
    expect(history[1]).toMatchObject({
      input: '提示词',
      output: '生成出来的文本',
      modelName: '文本工作流A',
    });
    expect(typeof history[1].id).toBe('string');
    expect(typeof history[1].createdAt).toBe('string');
  });

  it('已有历史含脏条目时被过滤（不阻断写入）', async () => {
    await fixture.writeCanvas(makeCanvasData('n1', { outputHistory: [{ bad: true }] }));
    await persistTextResult(options());
    const history = nodeConfigOf(await fixture.readCanvas(), 'n1')!.outputHistory as unknown[];
    expect(history).toHaveLength(1);
  });

  it('画布定位/节点 id 缺失时跳过写盘（wrote=false，不报错、不改文件）', async () => {
    await fixture.writeCanvas(makeCanvasData('n1'));
    expect((await persistTextResult(options({ canvas: undefined }))).wrote).toBe(false);
    expect((await persistTextResult(options({ nodeId: undefined }))).wrote).toBe(false);
    expect((await fixture.readCanvas()).rev).toBe(3);
  });

  it('画布文件不存在时跳过写盘', async () => {
    expect((await persistTextResult(options())).wrote).toBe(false);
  });

  it('节点已从画布删除时跳过写盘（不新建节点）', async () => {
    await fixture.writeCanvas(makeCanvasData('other'));
    expect((await persistTextResult(options())).wrote).toBe(false);
    expect(nodeConfigOf(await fixture.readCanvas(), 'n1')).toBeNull();
  });

  it('版本冲突时重读最新画布重试（保留并发写入的其它改动）', async () => {
    await fixture.writeCanvas(makeCanvasData('n1', { output: '旧' }));
    // 模拟「页面刚保存过」：下一次 saveCanvasDef 抛 VERSION_CONFLICT，且文件 rev 已被推进到 9
    fixture.failOnce.value = true;
    await fixture.writeCanvas({
      ...makeCanvasData('n1', { output: '旧', prompt: '并发修改的提示词' }),
      rev: 9,
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const result = await persistTextResult(options());

    expect(result.wrote).toBe(true);
    expect(result.prevRev).toBe(9);
    expect(result.rev).toBe(10);
    const config = nodeConfigOf(await fixture.readCanvas(), 'n1')!;
    expect(config.output).toBe('生成出来的文本');
    // 重试前的并发改动未被覆盖
    expect(config.prompt).toBe('并发修改的提示词');
  });

  it('重试耗尽仍冲突时抛错（调用方据此把任务标记失败）', async () => {
    await fixture.writeCanvas(makeCanvasData('n1'));
    fixture.alwaysFail.value = true;
    await expect(persistTextResult(options())).rejects.toThrow(/画布保存冲突重试/);
  });
});
