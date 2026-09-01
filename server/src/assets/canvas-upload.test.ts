import { describe, expect, it, vi, beforeEach } from 'vitest';

// fs/promises 全量 mock：canvas-upload.ts 只做 mkdir/writeFile（落盘），不依赖真实磁盘
const { mockMkdir, mockWriteFile } = vi.hoisted(() => ({
  mockMkdir: vi.fn(async () => undefined),
  mockWriteFile: vi.fn(async () => undefined),
}));

vi.mock('fs/promises', () => ({
  default: { mkdir: mockMkdir, writeFile: mockWriteFile },
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
}));

// 显式 mock paths.js：仅提供 resolveProjectPath（路径解析到项目根下）
vi.mock('./paths.js', () => ({
  resolveProjectPath: (project: string, relPath: string) =>
    `C:\\design\\${project}\\${relPath.replace(/\//g, '\\')}`,
}));

// 显式 mock history.js：归档行为由历史模块自身测试覆盖，此处只验证调用与结果透传
const { mockCopyExistingAssetToHistory } = vi.hoisted(() => ({
  mockCopyExistingAssetToHistory: vi.fn(),
}));

vi.mock('./history.js', () => ({
  copyExistingAssetToHistory: mockCopyExistingAssetToHistory,
}));

import {
  assertCanvasNodeOutputPath,
  assertCanvasUploadFile,
  saveCanvasNodeUpload,
} from './canvas-upload.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
});

describe('assertCanvasNodeOutputPath', () => {
  it('允许分镜画布节点固定产物路径（jpg / mp4）', () => {
    expect(assertCanvasNodeOutputPath('assert/scene/1/2/canvas/n1/output.jpg'))
      .toBe('assert/scene/1/2/canvas/n1/output.jpg');
    expect(assertCanvasNodeOutputPath('assert/scene/12/3/canvas/abc-123/output.mp4'))
      .toBe('assert/scene/12/3/canvas/abc-123/output.mp4');
  });

  it('允许场景画布节点固定产物路径（多一段子场景标签）', () => {
    expect(assertCanvasNodeOutputPath('assert/stage/现代商场/canvas/正门入口/n1/output.jpg'))
      .toBe('assert/stage/现代商场/canvas/正门入口/n1/output.jpg');
    expect(assertCanvasNodeOutputPath('assert/stage/现代商场/canvas/正门入口/n1/output.mp4'))
      .toBe('assert/stage/现代商场/canvas/正门入口/n1/output.mp4');
  });

  it('统一反斜杠为斜杠后校验', () => {
    expect(assertCanvasNodeOutputPath('assert\\scene\\1\\2\\canvas\\n1\\output.jpg'))
      .toBe('assert/scene/1/2/canvas/n1/output.jpg');
  });

  it('拒绝非画布节点产物路径', () => {
    // 角色外观（走 /assets/upload 的路径白名单，不属于画布产物）
    expect(() => assertCanvasNodeOutputPath('assert/character/陈书文/appearance.jpg'))
      .toThrow('仅支持上传到画布节点的固定产物路径');
    // 分镜视频产物
    expect(() => assertCanvasNodeOutputPath('assert/scene/1/2/video/0.mp4'))
      .toThrow('仅支持上传到画布节点的固定产物路径');
    // 画布产物但不属于本功能支持的扩展名（png / flac）
    expect(() => assertCanvasNodeOutputPath('assert/scene/1/2/canvas/n1/output.png'))
      .toThrow('仅支持上传到画布节点的固定产物路径');
    expect(() => assertCanvasNodeOutputPath('assert/stage/现代商场/canvas/正门入口/n1/output.flac'))
      .toThrow('仅支持上传到画布节点的固定产物路径');
  });

  it('拒绝非法结构路径（集数/分镜非正整数、含 ..、越出 assert/）', () => {
    expect(() => assertCanvasNodeOutputPath('assert/scene/a/b/canvas/n1/output.jpg'))
      .toThrow('仅支持上传到画布节点的固定产物路径');
    expect(() => assertCanvasNodeOutputPath('assert/scene/1/2/canvas/n1/../output.jpg'))
      .toThrow('仅支持上传到画布节点的固定产物路径');
    expect(() => assertCanvasNodeOutputPath('prompt/scene/1/2/canvas.json'))
      .toThrow('仅支持上传到画布节点的固定产物路径');
    expect(() => assertCanvasNodeOutputPath(''))
      .toThrow('仅支持上传到画布节点的固定产物路径');
  });
});

describe('assertCanvasUploadFile', () => {
  it('图片产物（output.jpg）接受 jpeg/png/webp，拒绝其它 MIME', () => {
    expect(() => assertCanvasUploadFile('jpg', 'image/jpeg', 'a.jpg')).not.toThrow();
    expect(() => assertCanvasUploadFile('jpg', 'image/png', 'a.png')).not.toThrow();
    expect(() => assertCanvasUploadFile('jpg', 'image/webp', 'a.webp')).not.toThrow();
    expect(() => assertCanvasUploadFile('jpg', 'video/mp4', 'a.mp4')).toThrow('仅支持上传 jpg / png / webp 格式图片');
    expect(() => assertCanvasUploadFile('jpg', 'image/gif', 'a.gif')).toThrow('仅支持上传 jpg / png / webp 格式图片');
  });

  it('视频产物（output.mp4）接受 mp4 MIME 或 .mp4 扩展名（部分浏览器报 octet-stream）', () => {
    expect(() => assertCanvasUploadFile('mp4', 'video/mp4', 'a.mp4')).not.toThrow();
    expect(() => assertCanvasUploadFile('mp4', 'application/octet-stream', 'a.mp4')).not.toThrow();
    expect(() => assertCanvasUploadFile('mp4', 'video/webm', 'a.webm')).toThrow('仅支持上传 mp4 格式视频');
    expect(() => assertCanvasUploadFile('mp4', 'application/octet-stream', 'a.mov')).toThrow('仅支持上传 mp4 格式视频');
    expect(() => assertCanvasUploadFile('mp4', 'video/quicktime', 'a.mov')).toThrow('仅支持上传 mp4 格式视频');
  });
});

describe('saveCanvasNodeUpload', () => {
  it('已有产物：先归档进历史（copy 保留原文件），再 mkdir + 覆盖写入固定路径', async () => {
    mockCopyExistingAssetToHistory.mockResolvedValue('assert/scene/1/2/canvas/n1/history/output/20260101-000000.jpg');
    const result = await saveCanvasNodeUpload(
      'p',
      'assert/scene/1/2/canvas/n1/output.jpg',
      Buffer.from('new-image'),
      { mime: 'image/png', originalName: '新图.png' },
    );

    expect(result).toEqual({
      path: 'assert/scene/1/2/canvas/n1/output.jpg',
      archived: 'assert/scene/1/2/canvas/n1/history/output/20260101-000000.jpg',
    });
    // 归档先于写入
    expect(mockCopyExistingAssetToHistory.mock.invocationCallOrder[0])
      .toBeLessThan(mockWriteFile.mock.invocationCallOrder[0]);
    expect(mockCopyExistingAssetToHistory).toHaveBeenCalledWith('p', 'assert/scene/1/2/canvas/n1/output.jpg');
    // 写入目标为项目根下的固定产物路径，目录先行创建
    expect(mockMkdir).toHaveBeenCalledWith('C:\\design\\p\\assert\\scene\\1\\2\\canvas\\n1', { recursive: true });
    const [full, data] = mockWriteFile.mock.calls[0] as unknown as [string, Buffer];
    expect(full).toBe('C:\\design\\p\\assert\\scene\\1\\2\\canvas\\n1\\output.jpg');
    expect(data).toEqual(Buffer.from('new-image'));
  });

  it('无旧产物：不归档，直接写入', async () => {
    mockCopyExistingAssetToHistory.mockResolvedValue(null);
    const result = await saveCanvasNodeUpload(
      'p',
      'assert/stage/现代商场/canvas/正门入口/n1/output.mp4',
      Buffer.from('video'),
      { mime: 'video/mp4', originalName: 'a.mp4' },
    );

    expect(result).toEqual({ path: 'assert/stage/现代商场/canvas/正门入口/n1/output.mp4', archived: null });
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('路径非法：抛 INVALID 且不触碰历史与写入', async () => {
    await expect(
      saveCanvasNodeUpload('p', 'assert/character/陈书文/appearance.jpg', Buffer.from('x'), {
        mime: 'image/jpeg',
        originalName: 'a.jpg',
      }),
    ).rejects.toMatchObject({ code: 'INVALID' });
    expect(mockCopyExistingAssetToHistory).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('文件类型与目标产物不匹配：抛 INVALID 且不触碰历史与写入', async () => {
    await expect(
      saveCanvasNodeUpload('p', 'assert/scene/1/2/canvas/n1/output.mp4', Buffer.from('x'), {
        mime: 'video/webm',
        originalName: 'a.webm',
      }),
    ).rejects.toMatchObject({ code: 'INVALID', message: expect.stringContaining('mp4') });
    expect(mockCopyExistingAssetToHistory).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('归档失败：抛错中断上传（不允许静默丢历史），不写入新文件', async () => {
    mockCopyExistingAssetToHistory.mockRejectedValue(new Error('disk error'));
    await expect(
      saveCanvasNodeUpload('p', 'assert/scene/1/2/canvas/n1/output.jpg', Buffer.from('x'), {
        mime: 'image/jpeg',
        originalName: 'a.jpg',
      }),
    ).rejects.toThrow('disk error');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
