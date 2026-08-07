import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderClient } from '../providers/types.js';
import {
  fileToDataUrl,
  resolveSeedreamSize,
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

describe('resolveSeedreamSize', () => {
  it('合法宽高返回 WxH', () => {
    expect(resolveSeedreamSize(1080, 1920)).toBe('1080x1920');
    expect(resolveSeedreamSize('1080', '1920')).toBe('1080x1920');
  });

  it('总像素低于下限回退 2K', () => {
    expect(resolveSeedreamSize(512, 512)).toBe('2K');
  });

  it('总像素高于上限回退 2K', () => {
    expect(resolveSeedreamSize(3000, 2000)).toBe('2K'); // 6,000,000 > 4,624,220
  });

  it('宽高比越界回退 2K', () => {
    expect(resolveSeedreamSize(2000, 100)).toBe('2K'); // 2000/100 = 20 > 16
  });

  it('缺省回退 2K', () => {
    expect(resolveSeedreamSize()).toBe('2K');
    expect(resolveSeedreamSize(1080)).toBe('2K');
    expect(resolveSeedreamSize(0, 1920)).toBe('2K');
  });

  it('边界值包含两端', () => {
    expect(resolveSeedreamSize(960, 960)).toBe('960x960');     // 总像素正好 921600
    expect(resolveSeedreamSize(860, 5377)).toBe('860x5377');   // 总像素正好 4624220
    expect(resolveSeedreamSize(3840, 240)).toBe('3840x240');   // 宽高比正好 16
    expect(resolveSeedreamSize(240, 3840)).toBe('240x3840');   // 宽高比正好 1/16
  });

  it('边界外一像素回退 2K', () => {
    expect(resolveSeedreamSize(959, 961)).toBe('2K');          // 921,599 低于下限
    expect(resolveSeedreamSize(860, 5378)).toBe('2K');         // 4,625,080 高于上限
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
