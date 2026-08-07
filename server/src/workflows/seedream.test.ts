import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderClient } from '../providers/types.js';
import {
  fileToDataUrl,
  resolveSeedreamSize,
  SEEDREAM_SIZE_LIMITS,
  submitSeedreamImageEdit,
  submitSeedreamTextToImage,
} from './seedream.js';

const executeMock = vi.fn();
const stubProvider = {
  execute: executeMock,
  poll: vi.fn(),
  getOutput: vi.fn(),
  cancel: vi.fn(),
} as unknown as ProviderClient;

/** pro / lite 尺寸约束速记 */
const PRO = SEEDREAM_SIZE_LIMITS.pro;
const LITE = SEEDREAM_SIZE_LIMITS.lite;

describe('resolveSeedreamSize', () => {
  it('合法宽高返回 WxH（pro）', () => {
    expect(resolveSeedreamSize(PRO, 1080, 1920)).toBe('1080x1920');
    expect(resolveSeedreamSize(PRO, '1080', '1920')).toBe('1080x1920');
  });

  it('lite 总像素低于下限自动匹配最接近允许尺寸（保持宽高比）', () => {
    // 1080x1920 总像素 2,073,600 < 3,686,400 → 放大到 1440x2560（总像素恰为下限）
    expect(resolveSeedreamSize(LITE, 1080, 1920)).toBe('1440x2560');
    // 1500x1500 总像素 2,250,000 < 3,686,400 → 放大到 1920x1920
    expect(resolveSeedreamSize(LITE, 1500, 1500)).toBe('1920x1920');
  });

  it('pro 总像素低于下限自动匹配（保持宽高比）', () => {
    expect(resolveSeedreamSize(PRO, 512, 512)).toBe('960x960'); // 恰为下限 921600
  });

  it('pro 总像素高于上限自动匹配最接近允许尺寸', () => {
    // 3000x2000 总像素 6,000,000 > 4,624,220 → 缩小到 2633x1755（接近上限）
    expect(resolveSeedreamSize(PRO, 3000, 2000)).toBe('2633x1755');
  });

  it('宽高比越界时钳制到允许比例', () => {
    // 2000x100 宽高比 20 > 16 → 钳到 16:1 且总像素到下限 → 3840x240
    expect(resolveSeedreamSize(PRO, 2000, 100)).toBe('3840x240');
  });

  it('缺省/非法宽高回退档位', () => {
    expect(resolveSeedreamSize(PRO)).toBe('2K');
    expect(resolveSeedreamSize(PRO, 1080)).toBe('2K');
    expect(resolveSeedreamSize(PRO, 0, 1920)).toBe('2K');
    expect(resolveSeedreamSize(LITE)).toBe('2K');
  });

  it('边界值包含两端（pro）', () => {
    expect(resolveSeedreamSize(PRO, 960, 960)).toBe('960x960');     // 总像素正好 921600
    expect(resolveSeedreamSize(PRO, 860, 5377)).toBe('860x5377');   // 总像素正好 4624220
    expect(resolveSeedreamSize(PRO, 3840, 240)).toBe('3840x240');   // 宽高比正好 16
    expect(resolveSeedreamSize(PRO, 240, 3840)).toBe('240x3840');   // 宽高比正好 1/16
  });

  it('lite 边界与合法尺寸直接使用', () => {
    expect(resolveSeedreamSize(LITE, 2560, 1440)).toBe('2560x1440'); // 总像素恰为下限 3686400
    expect(resolveSeedreamSize(LITE, 2048, 2048)).toBe('2048x2048'); // 合法
    expect(resolveSeedreamSize(LITE, 3000, 2000)).toBe('3000x2000'); // 合法（lite 范围更大）
  });
});

describe('submitSeedreamTextToImage', () => {
  beforeEach(() => executeMock.mockReset());

  it('提交 model/prompt/size/output_format/watermark/response_format', async () => {
    executeMock.mockResolvedValue({ taskId: 't' });
    await submitSeedreamTextToImage(stubProvider, { model: 'm1', prompt: '猫', size: '2K' });
    expect(executeMock).toHaveBeenCalledWith({
      workflowId: 'm1',
      params: { model: 'm1', prompt: '猫', size: '2K', output_format: 'jpeg', watermark: false, response_format: 'url' },
    });
  });

  it('optimizeMode=standard 时带 optimize_prompt_options', async () => {
    executeMock.mockResolvedValue({ taskId: 't' });
    await submitSeedreamTextToImage(stubProvider, { model: 'm', prompt: 'x', size: '2K', optimizeMode: 'standard' });
    const call = executeMock.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(call.params.optimize_prompt_options).toEqual({ mode: 'standard' });
  });
});

describe('submitSeedreamImageEdit', () => {
  beforeEach(() => executeMock.mockReset());

  it('单图 image 为字符串（完整 body 断言）', async () => {
    executeMock.mockResolvedValue({ taskId: 't' });
    await submitSeedreamImageEdit(stubProvider, {
      model: 'm', prompt: 'x', images: ['data:image/jpeg;base64,QQ=='], size: '2K',
    });
    expect(executeMock).toHaveBeenCalledWith({
      workflowId: 'm',
      params: {
        model: 'm', prompt: 'x', image: 'data:image/jpeg;base64,QQ==', size: '2K',
        output_format: 'jpeg', watermark: false, response_format: 'url',
      },
    });
  });

  it('多图 image 为数组（完整 body 断言）', async () => {
    executeMock.mockResolvedValue({ taskId: 't' });
    await submitSeedreamImageEdit(stubProvider, { model: 'm', prompt: 'x', images: ['a', 'b'], size: '2K' });
    expect(executeMock).toHaveBeenCalledWith({
      workflowId: 'm',
      params: {
        model: 'm', prompt: 'x', image: ['a', 'b'], size: '2K',
        output_format: 'jpeg', watermark: false, response_format: 'url',
      },
    });
  });

  it('10 张图合法（数组形式）', async () => {
    executeMock.mockResolvedValue({ taskId: 't' });
    const ten = Array.from({ length: 10 }, (_, i) => `data:${i}`);
    await submitSeedreamImageEdit(stubProvider, { model: 'm', prompt: 'x', images: ten, size: '2K' });
    expect(executeMock).toHaveBeenCalledWith({
      workflowId: 'm',
      params: {
        model: 'm', prompt: 'x', image: ten, size: '2K',
        output_format: 'jpeg', watermark: false, response_format: 'url',
      },
    });
  });

  it('0 张或超过 10 张抛错', async () => {
    await expect(
      submitSeedreamImageEdit(stubProvider, { model: 'm', prompt: 'x', images: [], size: '2K' }),
    ).rejects.toThrow('1~10 张参考图');
    const many = Array.from({ length: 11 }, (_, i) => `data:${i}`);
    await expect(
      submitSeedreamImageEdit(stubProvider, { model: 'm', prompt: 'x', images: many, size: '2K' }),
    ).rejects.toThrow('1~10 张参考图');
  });
});

describe('fileToDataUrl', () => {
  it('生成 data URL', async () => {
    const file = new File(['hello'], 'a.png', { type: 'image/png' });
    expect(await fileToDataUrl(file)).toBe('data:image/png;base64,aGVsbG8=');
  });
});
