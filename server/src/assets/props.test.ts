/**
 * 道具（prop）资产 CRUD 与引用检查测试。
 *
 * 通过 vi.mock 把 paths.js 的 resolveProjectPath 重定向到临时目录，
 * 避免触碰真实 design/ 数据。覆盖：分类/道具创建（校验/去重/模板）、
 * refs 读写（规范化/去重/非法路径）、删除（成对清理/引用保护）、
 * 画布引用扫描（分镜画布 + 场景画布）。
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/** 共享临时根目录（vi.mock 工厂内引用，必须用 vi.hoisted） */
const state = vi.hoisted(() => ({
  root: '',
}));

vi.mock('./paths.js', () => ({
  resolveProjectPath: (_project: string, rel: string) => path.join(state.root, rel),
  assertSafeName: (name: string, label = '名称') => {
    const trimmed = name.trim();
    if (!trimmed) throw Object.assign(new Error(`${label}不能为空`), { code: 'INVALID' });
    if (trimmed !== name) throw Object.assign(new Error(`${label}不能有首尾空白`), { code: 'INVALID' });
    if (/[\\/:*?"<>|]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
      throw Object.assign(new Error(`${label}包含非法字符`), { code: 'INVALID' });
    }
  },
  pathExists: async (full: string) => {
    try { await fs.access(full); return true; } catch { return false; }
  },
  ensureDir: async (full: string) => { await fs.mkdir(full, { recursive: true }); },
}));

import {
  createProp,
  createPropCategory,
  deleteProp,
  deletePropCategory,
  emptyPropRefs,
  findPropRefs,
  readPropRefs,
  savePropRefs,
} from './props.js';

/** 断言错误码与信息 */
function expectCode(fn: () => Promise<unknown>, code: string, message: string) {
  return expect(fn()).rejects.toMatchObject({ code, message });
}

describe('道具分类/道具 CRUD', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-'));
    state.root = tmpRoot;
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('创建分类：仅建 prompt/prop/{分类}/ 目录', async () => {
    const rel = await createPropCategory('p', '武器');
    expect(rel).toBe('prompt/prop/武器');
    await expect(fs.access(path.join(tmpRoot, 'prompt/prop/武器'))).resolves.toBeUndefined();
  });

  it('创建分类：重名报 EXISTS，非法名报 INVALID', async () => {
    await createPropCategory('p', '武器');
    await expectCode(() => createPropCategory('p', '武器'), 'EXISTS', '分类已存在');
    await expectCode(() => createPropCategory('p', '武器/刀'), 'INVALID', '分类名包含非法字符');
  });

  it('创建道具：生成 image.md / video.md / refs.json 模板', async () => {
    const rel = await createProp('p', '武器', '武士刀');
    expect(rel).toBe('prompt/prop/武器/武士刀');
    const dir = path.join(tmpRoot, 'prompt/prop/武器/武士刀');
    const imageMd = await fs.readFile(path.join(dir, 'image.md'), 'utf-8');
    expect(imageMd).toContain('道具图片描述文案');
    const videoMd = await fs.readFile(path.join(dir, 'video.md'), 'utf-8');
    expect(videoMd).toContain('道具视频描述文案');
    const refs = JSON.parse(await fs.readFile(path.join(dir, 'refs.json'), 'utf-8'));
    expect(refs).toEqual(emptyPropRefs());
  });

  it('创建道具：分类不存在时自动创建；重名报 EXISTS', async () => {
    await createProp('p', '武器', '武士刀');
    await expect(fs.access(path.join(tmpRoot, 'prompt/prop/武器'))).resolves.toBeUndefined();
    await expectCode(() => createProp('p', '武器', '武士刀'), 'EXISTS', '道具已存在');
    await expectCode(() => createProp('p', '武器', '刀/剑'), 'INVALID', '道具名包含非法字符');
  });

  it('删除道具：成对清理 prompt 与 assert', async () => {
    await createProp('p', '武器', '武士刀');
    await fs.mkdir(path.join(tmpRoot, 'assert/prop/武器/武士刀'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'assert/prop/武器/武士刀/image.jpg'), 'x', 'utf-8');
    await deleteProp('p', '武器', '武士刀');
    await expect(fs.access(path.join(tmpRoot, 'prompt/prop/武器/武士刀'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpRoot, 'assert/prop/武器/武士刀'))).rejects.toThrow();
    // 分类目录保留
    await expect(fs.access(path.join(tmpRoot, 'prompt/prop/武器'))).resolves.toBeUndefined();
  });

  it('删除道具：不存在报 NOT_FOUND；被画布引用报 IN_USE', async () => {
    await expectCode(() => deleteProp('p', '武器', '不存在'), 'NOT_FOUND', '道具不存在');
    await createProp('p', '武器', '武士刀');
    // 分镜画布引用道具图片
    await fs.mkdir(path.join(tmpRoot, 'prompt/scene/1/1'), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, 'prompt/scene/1/1/canvas.json'),
      JSON.stringify({
        nodes: [{ name: '加载图片', config: { assetPath: 'assert/prop/武器/武士刀/image.jpg' } }],
      }),
      'utf-8',
    );
    await expect(deleteProp('p', '武器', '武士刀')).rejects.toMatchObject({ code: 'IN_USE' });
  });

  it('删除分类：清理整个分类；分类下存在被引用道具时拒绝', async () => {
    await createProp('p', '武器', '武士刀');
    await deletePropCategory('p', '武器');
    await expect(fs.access(path.join(tmpRoot, 'prompt/prop/武器'))).rejects.toThrow();
    await expectCode(() => deletePropCategory('p', '武器'), 'NOT_FOUND', '分类不存在');

    await createPropCategory('p', '防具');
    await createProp('p', '防具', '盾牌');
    // 场景画布引用道具音频
    await fs.mkdir(path.join(tmpRoot, 'prompt/stage/城堡/canvas'), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, 'prompt/stage/城堡/canvas/大厅.json'),
      JSON.stringify({
        nodes: [{ name: '加载音频', config: { assetPath: 'assert/prop/防具/盾牌/audio.flac' } }],
      }),
      'utf-8',
    );
    await expect(deletePropCategory('p', '防具')).rejects.toMatchObject({ code: 'IN_USE' });
  });
});

describe('道具 refs 读写', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-refs-'));
    state.root = tmpRoot;
    await createProp('p', '武器', '武士刀');
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('默认 refs 为空配置', async () => {
    expect(await readPropRefs('p', '武器', '武士刀')).toEqual(emptyPropRefs());
  });

  it('保存 refs：规范化路径并去重', async () => {
    const saved = await savePropRefs('p', '武器', '武士刀', {
      image: ['assert/stage/铁匠铺/工作台.jpg', 'assert/stage/铁匠铺/工作台.jpg', 'assert/character/张三/appearance.jpg'],
      video: ['assert/prop/武器/武士刀/image.jpg'],
    });
    expect(saved.image).toEqual(['assert/stage/铁匠铺/工作台.jpg', 'assert/character/张三/appearance.jpg']);
    expect(saved.video).toEqual(['assert/prop/武器/武士刀/image.jpg']);
    // 落盘回读一致
    expect(await readPropRefs('p', '武器', '武士刀')).toEqual(saved);
  });

  it('保存 refs：非 assert/ 路径报 INVALID', async () => {
    await expectCode(
      () => savePropRefs('p', '武器', '武士刀', { image: ['prompt/stage/x.md'] }),
      'INVALID',
      '关联资产路径非法，须为 assert/ 下的项目内路径',
    );
    await expectCode(
      () => savePropRefs('p', '武器', '武士刀', { video: ['assert/../prompt/x'] }),
      'INVALID',
      '关联资产路径非法，须为 assert/ 下的项目内路径',
    );
  });

  it('refs 文件损坏时回退空配置', async () => {
    await fs.writeFile(path.join(tmpRoot, 'prompt/prop/武器/武士刀/refs.json'), '{bad json', 'utf-8');
    expect(await readPropRefs('p', '武器', '武士刀')).toEqual(emptyPropRefs());
  });
});

describe('画布引用扫描 findPropRefs', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prop-ref-'));
    state.root = tmpRoot;
    await createProp('p', '武器', '武士刀');
    await createProp('p', '武器', '盾牌');
    await createProp('p', '日常', '茶杯');
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  async function writeCanvas(rel: string, nodes: Array<{ name?: string; config?: { assetPath?: string } }>) {
    const full = path.join(tmpRoot, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, JSON.stringify({ nodes }), 'utf-8');
  }

  it('扫描分镜画布与场景画布的加载节点引用', async () => {
    await writeCanvas('prompt/scene/1/2/canvas.json', [
      { name: '加载图片', config: { assetPath: 'assert/prop/武器/武士刀/image.jpg' } },
      { name: '加载视频', config: { assetPath: 'assert/prop/武器/盾牌/video.mp4' } },
      { name: '加载音频', config: { assetPath: 'assert/stage/城堡/大厅.jpg' } }, // 非道具不命中
    ]);
    await writeCanvas('prompt/stage/城堡/canvas/大厅.json', [
      { name: '加载音频', config: { assetPath: 'assert/prop/日常/茶杯/audio.flac' } },
    ]);

    const refs = await findPropRefs('p', '武器', '武士刀');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: 'scene',
      canvasPath: 'prompt/scene/1/2/canvas.json',
      nodeName: '加载图片',
      assetPath: 'assert/prop/武器/武士刀/image.jpg',
    });

    // 分类级：命中同分类下全部道具
    const categoryRefs = await findPropRefs('p', '武器');
    expect(categoryRefs.map(r => r.assetPath).sort()).toEqual([
      'assert/prop/武器/武士刀/image.jpg',
      'assert/prop/武器/盾牌/video.mp4',
    ]);

    // 前缀边界：武士刀 不命中 盾牌 的引用
    const shieldRefs = await findPropRefs('p', '武器', '盾牌');
    expect(shieldRefs.map(r => r.assetPath)).toEqual(['assert/prop/武器/盾牌/video.mp4']);

    const dailyRefs = await findPropRefs('p', '日常', '茶杯');
    expect(dailyRefs).toHaveLength(1);
    expect(dailyRefs[0]).toMatchObject({ kind: 'stage', canvasPath: 'prompt/stage/城堡/canvas/大厅.json' });
  });

  it('画布文件缺失/非法时跳过', async () => {
    await fs.mkdir(path.join(tmpRoot, 'prompt/scene/1/1'), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, 'prompt/scene/1/1/canvas.json'), '{bad', 'utf-8');
    expect(await findPropRefs('p', '武器')).toEqual([]);
  });

  it('无任何画布时返回空', async () => {
    expect(await findPropRefs('p', '武器', '武士刀')).toEqual([]);
  });
});
