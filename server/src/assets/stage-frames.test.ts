import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));

vi.mock('./paths.js', () => ({
  get DESIGN_DIR() {
    return state.root;
  },
  isReservedProjectName: (name: string): boolean => name.startsWith('.'),
  resolveProjectPath: (project: string, rel: string): string => path.resolve(state.root, project, rel),
  pathExists: async (p: string): Promise<boolean> => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  },
}));

import { addStageFrame, updateStageFrame } from './stage-frames.js';

/** 向临时项目写入文件（自动建目录） */
async function write(rel: string, content: string): Promise<void> {
  const full = path.join(state.root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
}

/** 读取临时项目 stage.json 内容 */
async function readStageJson(): Promise<Array<Record<string, unknown>>> {
  const full = path.join(state.root, 'p1/prompt/scene/1/1/stage.json');
  return JSON.parse(await fs.readFile(full, 'utf-8')) as Array<Record<string, unknown>>;
}

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-frames-'));
});

afterEach(async () => {
  await fs.rm(state.root, { recursive: true, force: true });
});

describe('空基础场景（独立场景图帧）', () => {
  it('新增空基础场景帧成功，归一化为纯图片帧（角色与 prompt 为空）', async () => {
    await write('p1/prompt/scene/1/1/stage.json', '[]\n');
    const res = await addStageFrame('p1', '1', '1', { 基础场景: '' });
    expect(res.index).toBe(0);
    expect(await readStageJson()).toEqual([{ 基础场景: '', 登场角色: [], prompt: '' }]);
  });

  it('空基础场景时传入角色与 prompt 被强制清空（防御前端绕过禁用）', async () => {
    await write('p1/prompt/scene/1/1/stage.json', '[]\n');
    await addStageFrame('p1', '1', '1', { 基础场景: '', 登场角色: ['小明'], prompt: '合成' });
    expect(await readStageJson()).toEqual([{ 基础场景: '', 登场角色: [], prompt: '' }]);
  });

  it('更新空基础场景帧时保留 disabled 标记', async () => {
    await write('p1/prompt/scene/1/1/stage.json', '[{ "基础场景": "", "登场角色": [], "prompt": "" }]\n');
    await updateStageFrame('p1', '1', '1', 0, { 基础场景: '', disabled: true });
    expect(await readStageJson()).toEqual([{ 基础场景: '', 登场角色: [], prompt: '', disabled: true }]);
  });
});

describe('非空基础场景原有校验保持不变', () => {
  it('非法格式（无斜杠）仍报错', async () => {
    await write('p1/prompt/scene/1/1/stage.json', '[]\n');
    await expect(addStageFrame('p1', '1', '1', { 基础场景: 'plain' })).rejects.toThrow('基础场景格式须为');
  });

  it('有登场角色但无 prompt 仍报错', async () => {
    await write('p1/prompt/scene/1/1/stage.json', '[]\n');
    await expect(addStageFrame('p1', '1', '1', { 基础场景: '公园/白天', 登场角色: ['小明'] })).rejects.toThrow(
      '有登场角色时必须填写合成 Prompt',
    );
  });

  it('普通引用正常写入（角色与 prompt 保留）', async () => {
    await write('p1/prompt/scene/1/1/stage.json', '[]\n');
    await addStageFrame('p1', '1', '1', { 基础场景: '公园/白天', 登场角色: ['小明'], prompt: '小明在公园' });
    expect(await readStageJson()).toEqual([
      { 基础场景: '公园/白天', 登场角色: ['小明'], prompt: '小明在公园' },
    ]);
  });
});