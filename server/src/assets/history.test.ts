import { describe, expect, it, vi, beforeEach } from 'vitest';

// fs/promises 与 paths.js 全量 mock：history.ts 只做文件移动/复制，不依赖真实磁盘
const { mockPathExists, mockMkdir, mockRename, mockCopyFile } = vi.hoisted(() => ({
  mockPathExists: vi.fn(),
  mockMkdir: vi.fn(async () => undefined),
  mockRename: vi.fn(async () => undefined),
  mockCopyFile: vi.fn(async () => undefined),
}));

vi.mock('fs/promises', () => ({
  default: { mkdir: mockMkdir, rename: mockRename, copyFile: mockCopyFile },
  mkdir: mockMkdir,
  rename: mockRename,
  copyFile: mockCopyFile,
}));

// 显式 mock paths.js（不使用 importOriginal）：提供 pathExists 与 resolveProjectPath 两个被 history.ts 依赖的导出。
// 注意：pathExists 同时被「当前资产存在性」与「历史目标冲突探测」两处调用，
// 测试必须用 mockResolvedValueOnce 精确编排序列，避免默认 true 造成冲突探测死循环。
vi.mock('./paths.js', () => ({
  pathExists: mockPathExists,
  resolveProjectPath: (project: string, relPath: string) =>
    `C:\\design\\${project}\\${relPath.replace(/\//g, '\\')}`,
}));

import {
  archiveExistingAsset,
  assertUploadableImagePath,
  copyExistingAssetToHistory,
  formatHistoryStamp,
} from './history.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
});

describe('assertUploadableImagePath', () => {
  it('允许上传角色外观衍生变体的自定义图像', () => {
    expect(assertUploadableImagePath('assert/character/威廉伯爵/variants/原图.jpg'))
      .toBe('assert/character/威廉伯爵/variants/原图.jpg');
  });

  it('允许常见图片扩展名且拒绝不支持的扩展名', () => {
    expect(assertUploadableImagePath('assert/character/威廉伯爵/variants/v1.png'))
      .toBe('assert/character/威廉伯爵/variants/v1.png');
    expect(() => assertUploadableImagePath('assert/character/威廉伯爵/variants/v1.gif'))
      .toThrow('仅支持上传角色外观、场景设定图或分镜场景图');
  });

  it('允许上传场景衍生变体的自定义图像', () => {
    const imagePath = 'assert/stage/现代商场/variants/白天-入口/门已打开.webp';
    expect(assertUploadableImagePath(imagePath)).toBe(imagePath);
  });
});

describe('copyExistingAssetToHistory', () => {
  it('已存在当前资产：复制到 history/{stem}/{时间戳}{ext}，原文件保留（copyFile 而非 rename）', async () => {
    // 首次 pathExists：当前资产存在；后续探测（历史目标是否存在）：均不存在
    mockPathExists.mockResolvedValueOnce(true);
    mockPathExists.mockResolvedValue(false);
    const stamp = formatHistoryStamp(new Date('2026-01-02T03:04:05Z'));
    const dest = await copyExistingAssetToHistory(
      'p',
      'assert/scene/1/1/canvas/n1/output.jpg',
      new Date('2026-01-02T03:04:05Z'),
    );

    expect(dest).toBe(`assert/scene/1/1/canvas/n1/history/output/${stamp}.jpg`);
    // 绝对路径解析到项目根下（按 mock 的 resolveProjectPath）
    const [src, destFull] = mockCopyFile.mock.calls[0] as unknown as [string, string];
    expect(src).toBe('C:\\design\\p\\assert\\scene\\1\\1\\canvas\\n1\\output.jpg');
    expect(destFull).toContain(`history\\output\\${stamp}.jpg`);
    // 不调用 rename：原文件必须保留
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('同秒冲突时追加 -N 后缀', async () => {
    mockPathExists
      .mockResolvedValueOnce(true)   // 当前资产存在
      .mockResolvedValueOnce(true)   // 时间戳目标已存在
      .mockResolvedValue(false);     // -1 后缀目标可用
    const stamp = formatHistoryStamp(new Date('2026-01-02T03:04:05Z'));
    const dest = await copyExistingAssetToHistory('p', 'assert/a.jpg', new Date('2026-01-02T03:04:05Z'));

    expect(dest).toBe(`assert/history/a/${stamp}-1.jpg`);
  });

  it('当前资产不存在：返回 null 且不做任何操作', async () => {
    mockPathExists.mockResolvedValue(false);
    const dest = await copyExistingAssetToHistory('p', 'assert/missing.jpg');

    expect(dest).toBeNull();
    expect(mockCopyFile).not.toHaveBeenCalled();
    expect(mockMkdir).not.toHaveBeenCalled();
  });
});

describe('archiveExistingAsset', () => {
  it('已存在当前资产：rename 移入历史目录', async () => {
    mockPathExists.mockResolvedValueOnce(true); // 当前资产存在
    mockPathExists.mockResolvedValue(false);    // 目标探测均可用
    const stamp = formatHistoryStamp(new Date('2026-01-02T03:04:05Z'));
    const dest = await archiveExistingAsset(
      'p',
      'assert/stage/街角/白天.jpg',
      new Date('2026-01-02T03:04:05Z'),
    );

    expect(dest).toBe(`assert/stage/街角/history/白天/${stamp}.jpg`);
    const [src, destFull] = mockRename.mock.calls[0] as unknown as [string, string];
    expect(src).toBe('C:\\design\\p\\assert\\stage\\街角\\白天.jpg');
    expect(destFull).toContain(`history\\白天\\${stamp}.jpg`);
    expect(mockCopyFile).not.toHaveBeenCalled();
  });

  it('当前资产不存在：返回 null', async () => {
    mockPathExists.mockResolvedValue(false);
    expect(await archiveExistingAsset('p', 'assert/missing.jpg')).toBeNull();
  });
});