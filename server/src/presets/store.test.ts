import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPreset, deletePreset, getPreset, listPresets, updatePreset,
} from './store.js';

let tmpDir: string;
let configPath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'presets-'));
  configPath = path.join(tmpDir, 'presets.json');
});

describe('presets store 预设提示词 CRUD', () => {
  it('创建预设并读取（列表含全部字段）', async () => {
    const preset = await createPreset({ name: '翻译助手', content: '请将以下内容翻译成英文：\n{user_prompt}' }, configPath);
    expect(preset.id).toBeTruthy();
    expect(preset.name).toBe('翻译助手');
    expect(preset.content).toContain('{user_prompt}');
    const list = await listPresets(configPath);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(preset.id);
  });

  it('名称去首尾空白后保存', async () => {
    const preset = await createPreset({ name: '  润色  ', content: 'c' }, configPath);
    expect(preset.name).toBe('润色');
  });

  it('内容保留原始字符（含占位符与换行）', async () => {
    const content = '第一行\n第二行\n{user_prompt}';
    const preset = await createPreset({ name: 'n', content }, configPath);
    expect(preset.content).toBe(content);
  });

  it('按 id 获取预设', async () => {
    const preset = await createPreset({ name: 'n', content: 'c' }, configPath);
    const found = await getPreset(preset.id, configPath);
    expect(found?.name).toBe('n');
    expect(await getPreset('missing', configPath)).toBeUndefined();
  });

  it('部分更新名称与内容', async () => {
    const preset = await createPreset({ name: '旧名', content: '旧内容' }, configPath);
    const renamed = await updatePreset(preset.id, { name: '新名' }, configPath);
    expect(renamed.name).toBe('新名');
    expect(renamed.content).toBe('旧内容');
    const updated = await updatePreset(preset.id, { content: '新内容' }, configPath);
    expect(updated.name).toBe('新名');
    expect(updated.content).toBe('新内容');
  });

  it('删除预设后不可再读取', async () => {
    const preset = await createPreset({ name: 'n', content: 'c' }, configPath);
    await deletePreset(preset.id, configPath);
    expect(await getPreset(preset.id, configPath)).toBeUndefined();
    expect(await listPresets(configPath)).toHaveLength(0);
  });

  it('名称缺失/空白时报错', async () => {
    await expect(createPreset({ name: '', content: 'c' }, configPath)).rejects.toThrow('名称不能为空');
    await expect(createPreset({ name: '   ', content: 'c' }, configPath)).rejects.toThrow('名称不能为空');
    await expect(createPreset({ name: undefined as unknown as string, content: 'c' }, configPath)).rejects.toThrow('名称不能为空');
  });

  it('内容缺失/空白时报错', async () => {
    await expect(createPreset({ name: 'n', content: '' }, configPath)).rejects.toThrow('提示词内容不能为空');
    await expect(createPreset({ name: 'n', content: '  ' }, configPath)).rejects.toThrow('提示词内容不能为空');
  });

  it('更新不存在的预设时报错', async () => {
    await expect(updatePreset('missing', { name: 'x' }, configPath)).rejects.toThrow('预设提示词不存在');
  });

  it('删除不存在的预设时报错', async () => {
    await expect(deletePreset('missing', configPath)).rejects.toThrow('预设提示词不存在');
  });

  it('更新时字段为空串同样报错', async () => {
    const preset = await createPreset({ name: 'n', content: 'c' }, configPath);
    await expect(updatePreset(preset.id, { name: '' }, configPath)).rejects.toThrow('名称不能为空');
    await expect(updatePreset(preset.id, { content: '' }, configPath)).rejects.toThrow('提示词内容不能为空');
  });
});
