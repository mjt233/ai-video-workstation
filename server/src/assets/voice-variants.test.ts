/**
 * 角色声音变体 CRUD 测试。
 *
 * 通过 vi.mock 把 paths.js 的 resolveProjectPath 重定向到临时目录，
 * 避免触碰真实 design/ 数据。覆盖：列表（空/有数据）、创建（校验/去重）、
 * 更新、重命名（同步音频）、删除（meta+音频+history）。
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
  createCharacterVoiceVariant,
  deleteCharacterVoiceVariant,
  listCharacterVoiceVariants,
  renameCharacterVoiceVariant,
  updateCharacterVoiceVariant,
} from './voice-variants.js';

/** 断言错误码与信息 */
function expectCode(fn: () => Promise<unknown>, code: string, message: string) {
  return expect(fn()).rejects.toMatchObject({ code, message });
}

describe('角色声音变体 CRUD', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vv-'));
    state.root = tmpRoot;
    // 创建角色目录（prompt/character/小明/）
    await fs.mkdir(path.join(tmpRoot, 'prompt', 'character', '小明'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('无变体目录时列表为空', async () => {
    const list = await listCharacterVoiceVariants('p', '小明');
    expect(list).toEqual([]);
  });

  it('创建变体：默认提示词模式为 append', async () => {
    const v = await createCharacterVoiceVariant('p', '小明', {
      id: '哭腔',
      prompt: '带哭腔、语速稍慢',
      台词: '我好难过……',
    });
    expect(v.promptMode).toBe('append');
    expect(v.hasAudio).toBe(false);
    expect(v.audioPath).toBe('assert/character/小明/voice-variants/哭腔.flac');
    expect(v.metaPath).toBe('prompt/character/小明/voice-variants/哭腔.json');
    // meta 落盘
    const raw = await fs.readFile(path.join(tmpRoot, 'prompt/character/小明/voice-variants/哭腔.json'), 'utf-8');
    expect(JSON.parse(raw)).toMatchObject({ id: '哭腔', prompt: '带哭腔、语速稍慢', promptMode: 'append', 台词: '我好难过……' });
  });

  it('创建变体：支持 overwrite 模式', async () => {
    const v = await createCharacterVoiceVariant('p', '小明', {
      id: '旁白',
      prompt: '低沉旁白音',
      promptMode: 'overwrite',
      台词: '多年以后……',
    });
    expect(v.promptMode).toBe('overwrite');
  });

  it('创建变体：提示词与台词必填', async () => {
    await expectCode(
      () => createCharacterVoiceVariant('p', '小明', { id: 'x', prompt: '', 台词: '台词' }),
      'INVALID', '提示词必填',
    );
    await expectCode(
      () => createCharacterVoiceVariant('p', '小明', { id: 'x', prompt: '提示', 台词: '' }),
      'INVALID', '台词必填',
    );
  });

  it('创建变体：同名重复报 EXISTS', async () => {
    await createCharacterVoiceVariant('p', '小明', { id: '哭腔', prompt: 'a', 台词: 'b' });
    await expectCode(
      () => createCharacterVoiceVariant('p', '小明', { id: '哭腔', prompt: 'c', 台词: 'd' }),
      'EXISTS', '声音变体已存在',
    );
  });

  it('创建变体：角色不存在报 NOT_FOUND', async () => {
    await expectCode(
      () => createCharacterVoiceVariant('p', '不存在', { id: 'x', prompt: 'a', 台词: 'b' }),
      'NOT_FOUND', '角色不存在',
    );
  });

  it('列表返回已生成音频标记（hasAudio）', async () => {
    const v = await createCharacterVoiceVariant('p', '小明', { id: '哭腔', prompt: 'a', 台词: 'b' });
    // 模拟已生成音频
    await fs.mkdir(path.dirname(path.join(tmpRoot, v.audioPath)), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, v.audioPath), 'fake-flac', 'utf-8');
    const list = await listCharacterVoiceVariants('p', '小明');
    expect(list).toHaveLength(1);
    expect(list[0].hasAudio).toBe(true);
  });

  it('更新变体：修改提示词/模式/台词', async () => {
    await createCharacterVoiceVariant('p', '小明', { id: '哭腔', prompt: 'a', 台词: 'b' });
    const updated = await updateCharacterVoiceVariant('p', '小明', '哭腔', {
      prompt: '更激动', promptMode: 'overwrite', 台词: '啊！',
    });
    expect(updated).toMatchObject({ prompt: '更激动', promptMode: 'overwrite', 台词: '啊！' });
    // 未传字段保留原值
    const partial = await updateCharacterVoiceVariant('p', '小明', '哭腔', { prompt: '只改提示词' });
    expect(partial).toMatchObject({ prompt: '只改提示词', promptMode: 'overwrite', 台词: '啊！' });
  });

  it('更新不存在的变体报 NOT_FOUND', async () => {
    await expectCode(
      () => updateCharacterVoiceVariant('p', '小明', '无', { prompt: 'a' }),
      'NOT_FOUND', '声音变体不存在',
    );
  });

  it('重命名变体：同步重命名音频文件', async () => {
    const v = await createCharacterVoiceVariant('p', '小明', { id: '哭腔', prompt: 'a', 台词: 'b' });
    await fs.mkdir(path.dirname(path.join(tmpRoot, v.audioPath)), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, v.audioPath), 'fake', 'utf-8');

    const renamed = await renameCharacterVoiceVariant('p', '小明', '哭腔', '大哭');
    expect(renamed.id).toBe('大哭');
    expect(renamed.audioPath).toBe('assert/character/小明/voice-variants/大哭.flac');
    // 旧 meta 已删除、旧音频已移动
    await expect(fs.access(path.join(tmpRoot, 'prompt/character/小明/voice-variants/哭腔.json'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpRoot, 'assert/character/小明/voice-variants/哭腔.flac'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpRoot, 'assert/character/小明/voice-variants/大哭.flac'))).resolves.toBeUndefined();
    // 列表只有新名称
    const list = await listCharacterVoiceVariants('p', '小明');
    expect(list.map((x) => x.id)).toEqual(['大哭']);
    expect(list[0].hasAudio).toBe(true);
  });

  it('重命名到已存在名称报 EXISTS', async () => {
    await createCharacterVoiceVariant('p', '小明', { id: 'a', prompt: '1', 台词: '2' });
    await createCharacterVoiceVariant('p', '小明', { id: 'b', prompt: '3', 台词: '4' });
    await expectCode(
      () => renameCharacterVoiceVariant('p', '小明', 'a', 'b'),
      'EXISTS', '目标名称已存在',
    );
  });

  it('删除变体：移除 meta、音频与 history 目录', async () => {
    const v = await createCharacterVoiceVariant('p', '小明', { id: '哭腔', prompt: 'a', 台词: 'b' });
    await fs.mkdir(path.dirname(path.join(tmpRoot, v.audioPath)), { recursive: true });
    await fs.writeFile(path.join(tmpRoot, v.audioPath), 'fake', 'utf-8');
    const histDir = path.join(tmpRoot, 'assert/character/小明/voice-variants/history/哭腔');
    await fs.mkdir(histDir, { recursive: true });
    await fs.writeFile(path.join(histDir, 'old.flac'), 'old', 'utf-8');

    await deleteCharacterVoiceVariant('p', '小明', '哭腔');
    const list = await listCharacterVoiceVariants('p', '小明');
    expect(list).toEqual([]);
    await expect(fs.access(path.join(tmpRoot, 'prompt/character/小明/voice-variants/哭腔.json'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpRoot, 'assert/character/小明/voice-variants/哭腔.flac'))).rejects.toThrow();
    await expect(fs.access(histDir)).rejects.toThrow();
  });

  it('删除不存在的变体报 NOT_FOUND', async () => {
    await expectCode(
      () => deleteCharacterVoiceVariant('p', '小明', '无'),
      'NOT_FOUND', '声音变体不存在',
    );
  });
});
