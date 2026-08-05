import { describe, expect, it } from 'vitest';
import { register, getAllWorkflows } from './registry.js';
import type { WorkflowDefinition } from './types.js';

describe('工作流能力声明透传', () => {
  it('video 能力与 cancelable 经 getAllWorkflows 透传前端', () => {
    const fake: WorkflowDefinition = {
      type: 'test-video-cap',
      name: '测试视频',
      impl: 'default',
      capabilities: {
        video: {
          modes: ['director', 'reference'],
          audio: true,
          maxDuration: 15,
          reference: {
            types: { image: { max: 9 }, video: { max: 3 }, audio: { max: 3 } },
            maxTotal: 12,
            audioRequiresVisual: true,
          },
        },
        cancelable: true,
      },
      submit: async () => ({ taskId: 't' }),
      parseOutput: async () => ({ type: 'body', contentType: 'video/mp4', data: '', filename: 'x.mp4' }),
    };
    register(fake);
    const found = getAllWorkflows().find((w) => w.type === 'test-video-cap');
    expect(found).toBeDefined();
    expect(found!.implementations[0].capabilities?.video?.modes).toEqual(['director', 'reference']);
    expect(found!.implementations[0].capabilities?.video?.maxDuration).toBe(15);
    expect(found!.implementations[0].capabilities?.video?.reference?.maxTotal).toBe(12);
    expect(found!.implementations[0].capabilities?.cancelable).toBe(true);
  });
});
