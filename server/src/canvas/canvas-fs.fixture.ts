/**
 * 「结果写入画布定义文件」类测试的共享夹具。
 *
 * 两个写者（LLM 会话落盘 `llm/result-persist.test.ts` 与工作流文本产物落盘
 * `canvas/text-result.test.ts`）走的是同一套 CAS + 路径锁 + 冲突重试链路，
 * 测试也都需要：临时 design 目录、可注入一次 VERSION_CONFLICT 的 saveCanvasDef、
 * 以及最小画布文件读写。把这段重复的 mock 与读写辅助集中在此，避免两处漂移。
 *
 * 用法（vitest 要求 vi.mock 提升到文件顶层，故调用方仍需自己写 `vi.mock` 三行）：
 * ```ts
 * const env = createCanvasFsFixture()
 * vi.mock('../assets/paths.js', env.pathsMock)
 * vi.mock('../assets/canvas-def.js', env.canvasDefMock)
 * ```
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { vi } from 'vitest';

/** 画布定义文件相对路径（分镜画布：第 1 集第 1 分镜） */
export const SCENE_CANVAS_REL = path.join('prompt', 'scene', '1', '1', 'canvas.json');

/** 画布目标（与 {@link SCENE_CANVAS_REL} 对应） */
export const SCENE_CANVAS_TARGET = { kind: 'scene' as const, episode: '1', shot: '1' };

/** 画布夹具句柄 */
export interface CanvasFsFixture {
  /** 临时 design 目录（绝对路径） */
  root: string;
  /** 是否让下一次 saveCanvasDef 抛 VERSION_CONFLICT（测试 CAS 重试） */
  failOnce: { value: boolean };
  /** 是否让**每一次** saveCanvasDef 都抛 VERSION_CONFLICT（测试重试耗尽后抛错） */
  alwaysFail: { value: boolean };
  /** `vi.mock('../assets/paths.js', env.pathsMock)` 用 */
  pathsMock: () => Promise<Record<string, unknown>>;
  /** `vi.mock('../assets/canvas-def.js', env.canvasDefMock)` 用 */
  canvasDefMock: () => Promise<Record<string, unknown>>;
  /** 写画布文件（自动建目录） */
  writeCanvas: (data: unknown) => Promise<void>;
  /** 读画布文件（JSON 解析） */
  readCanvas: () => Promise<Record<string, unknown>>;
  /** 删除整个临时目录（afterEach 调用） */
  cleanup: () => Promise<void>;
}

/**
 * 创建画布文件系统夹具（临时目录 + 可注入冲突的 mocks）。
 *
 * @returns 夹具句柄
 */
export function createCanvasFsFixture(): CanvasFsFixture {
  const root = path.resolve(
    os.tmpdir(),
    `dsh-canvas-fs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const failOnce = { value: false };
  const alwaysFail = { value: false };
  const canvasFull = (): string => path.resolve(root, SCENE_CANVAS_REL);

  return {
    root,
    failOnce,
    alwaysFail,
    pathsMock: async () => {
      const mod = await vi.importActual<Record<string, unknown>>('../assets/paths.js');
      return {
        ...mod,
        resolveProjectPath: (_project: string, rel: string) => path.resolve(root, rel),
      };
    },
    canvasDefMock: async () => {
      const mod = await vi.importActual<Record<string, unknown>>('../assets/canvas-def.js');
      const realSave = mod.saveCanvasDef as (
        project: string,
        target: unknown,
        data: unknown,
        expectedRev: number | undefined,
        force: boolean,
      ) => Promise<{ rev: number; updatedAt: string }>;
      return {
        ...mod,
        saveCanvasDef: vi.fn(
          async (project: string, target: unknown, data: unknown, expectedRev: number | undefined, force: boolean) => {
            if (alwaysFail.value || failOnce.value) {
              failOnce.value = false;
              throw Object.assign(new Error('冲突'), {
                code: 'VERSION_CONFLICT',
                currentRev: expectedRev,
                expectedRev,
              });
            }
            return realSave(project, target, data, expectedRev, force);
          },
        ),
      };
    },
    writeCanvas: async (data: unknown) => {
      await fs.mkdir(path.dirname(canvasFull()), { recursive: true });
      await fs.writeFile(canvasFull(), `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
    },
    readCanvas: async () => {
      const raw = await fs.readFile(canvasFull(), 'utf-8');
      return JSON.parse(raw) as Record<string, unknown>;
    },
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * 构造一份最小画布定义（含 rev 与一个节点）。
 *
 * @param nodeId 节点 id
 * @param config 节点 config（缺省为空对象）
 * @param rev 保存版本号（缺省 3，便于断言「写入后 +1」）
 * @returns 画布定义对象
 */
export function makeCanvasData(
  nodeId: string,
  config: Record<string, unknown> = {},
  rev = 3,
): Record<string, unknown> {
  return {
    version: 1,
    kind: 'scene',
    rev,
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: [{ id: nodeId, prototypeId: 'text-generate', name: '文本生成', x: 0, y: 0, config }],
    connections: [],
  };
}

/**
 * 取画布中某节点的 config（不存在时返回 null）。
 *
 * @param data 画布数据
 * @param nodeId 节点 id
 * @returns 节点 config；节点不存在返回 null
 */
export function nodeConfigOf(
  data: Record<string, unknown>,
  nodeId: string,
): Record<string, unknown> | null {
  const nodes = Array.isArray(data.nodes) ? (data.nodes as Array<Record<string, unknown>>) : [];
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  return (node.config ?? {}) as Record<string, unknown>;
}
