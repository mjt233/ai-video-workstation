import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));

// 将文件系统操作重定向到每个用例的临时目录。
vi.mock('./paths.js', () => ({
  assertSafeName: (name: string, label = '名称') => {
    const trimmed = name.trim();
    if (!trimmed) throw Object.assign(new Error(`${label}不能为空`), { code: 'INVALID' });
    if (/[\\/:*?"<>|]/.test(name) || name !== trimmed) {
      throw Object.assign(new Error(`${label}包含非法字符`), { code: 'INVALID' });
    }
  },
  pathExists: async (p: string): Promise<boolean> => {
    try { await fs.access(p); return true; } catch { return false; }
  },
  resolveProjectPath: (_project: string, rel: string): string => path.resolve(state.root, rel),
}));

import { saveUploadedAudio, assertUploadableAudioPath, listAssetHistory } from './history.js';
import { resolveCharacterVoiceAudio } from './voice-variants.js';

async function write(rel: string, content: string): Promise<void> {
  const full = path.join(state.root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(state.root, rel), 'utf8');
}

beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-upload-'));
});

afterEach(async () => {
  await fs.rm(state.root, { recursive: true, force: true });
});

describe('assertUploadableAudioPath', () => {
  it('只允许角色声音与声音变体路径', () => {
    expect(assertUploadableAudioPath('assert/character/小明/voice.mp3')).toBe('assert/character/小明/voice.mp3');
    expect(assertUploadableAudioPath('assert/character/小明/voice-variants/哭腔.wav')).toBe('assert/character/小明/voice-variants/哭腔.wav');
    expect(() => assertUploadableAudioPath('assert/character/小明/appearance.jpg')).toThrow();
    expect(() => assertUploadableAudioPath('assert/scene/1/1/voice/0.flac')).toThrow();
  });
});

describe('saveUploadedAudio（保留原格式 + 归档旧文件）', () => {
  it('上传 mp3：无旧文件时直接写入', async () => {
    const r = await saveUploadedAudio('p', 'assert/character/小明/voice.mp3', Buffer.from('mp3'));
    expect(r.path).toBe('assert/character/小明/voice.mp3');
    expect(r.archived).toEqual([]);
    expect(await read('assert/character/小明/voice.mp3')).toBe('mp3');
  });

  it('已有 voice.flac 时上传 mp3：flac 归档进历史，当前文件唯一', async () => {
    await write('assert/character/小明/voice.flac', 'old-flac');
    const r = await saveUploadedAudio('p', 'assert/character/小明/voice.mp3', Buffer.from('new-mp3'));
    expect(r.archived).toHaveLength(1);
    expect(r.archived[0]).toContain('assert/character/小明/history/voice/');
    expect(r.archived[0]).toMatch(/\.flac$/);
    // 旧文件已归档（rename 移走），新文件就位
    await expect(fs.access(path.join(state.root, 'assert/character/小明/voice.flac'))).rejects.toThrow();
    expect(await read(r.archived[0])).toBe('old-flac');
    expect(await read('assert/character/小明/voice.mp3')).toBe('new-mp3');
    // 历史列表按新路径（voice.mp3）查到归档版本
    const versions = await listAssetHistory('p', 'assert/character/小明/voice.mp3');
    expect(versions).toHaveLength(1);
    expect(versions[0].path).toBe(r.archived[0]);
  });

  it('声音变体同名不同扩展名一并归档（生成 flac + 上传 mp3 并存时）', async () => {
    await write('assert/character/小明/voice-variants/哭腔.flac', 'gen-flac');
    const r = await saveUploadedAudio('p', 'assert/character/小明/voice-variants/哭腔.m4a', Buffer.from('m4a'));
    expect(r.archived.map((a) => path.extname(a)).sort()).toEqual(['.flac']);
    await expect(fs.access(path.join(state.root, 'assert/character/小明/voice-variants/哭腔.flac'))).rejects.toThrow();
    expect(await read('assert/character/小明/voice-variants/哭腔.m4a')).toBe('m4a');
  });
});

describe('resolveCharacterVoiceAudio', () => {
  it('按候选顺序解析实际文件（flac 优先）', async () => {
    await write('assert/character/小明/voice.mp3', 'mp3');
    expect(await resolveCharacterVoiceAudio('p', '小明')).toBe('assert/character/小明/voice.mp3');
    await write('assert/character/小明/voice.flac', 'flac');
    expect(await resolveCharacterVoiceAudio('p', '小明')).toBe('assert/character/小明/voice.flac');
    // 归档删除后回退到 mp3
    await fs.rm(path.join(state.root, 'assert/character/小明/voice.flac'));
    expect(await resolveCharacterVoiceAudio('p', '小明')).toBe('assert/character/小明/voice.mp3');
  });

  it('无音频时返回 null', async () => {
    expect(await resolveCharacterVoiceAudio('p', '小明')).toBeNull();
  });
});
