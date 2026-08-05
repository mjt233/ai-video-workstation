import { describe, expect, it } from 'vitest';
import { parseTaskParams } from './workflow.js';

describe('parseTaskParams', () => {
  it('包含 video 自包含提交参数（wire 形态）', () => {
    const parsed = parseTaskParams(JSON.stringify({
      vars: { episode: '1', shot: '1' },
      outputPath: 'assert/scene/1/1/video.mp4',
      video: {
        mode: 'reference',
        resolution: { width: 1080, height: 1920 },
        duration: 5,
        prompt: '测试',
        references: [
          { type: 'image', path: 'assert/scene/1/1/stage/0.jpg' },
          { type: 'audio', path: 'assert/scene/1/1/audio/merged.flac' },
        ],
        extraParams: {},
      },
    }));
    expect(parsed.video?.mode).toBe('reference');
    expect(parsed.video?.references).toHaveLength(2);
    expect(parsed.video?.references?.[0].path).toBe('assert/scene/1/1/stage/0.jpg');
  });

  it('远程任务 ID 透传', () => {
    const parsed = parseTaskParams(JSON.stringify({
      vars: {},
      outputPath: 'assert/x.mp4',
      remoteTaskId: 'bridge-task-1',
    }));
    expect(parsed.remoteTaskId).toBe('bridge-task-1');
  });

  it('无 video 时返回 undefined', () => {
    const parsed = parseTaskParams(JSON.stringify({ vars: {}, outputPath: 'assert/x.mp4' }));
    expect(parsed.video).toBeUndefined();
  });
});
