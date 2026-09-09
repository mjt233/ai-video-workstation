/**
 * 任务画布定位解析单测。
 *
 * 覆盖：合法分镜/场景画布透传、字段缺失或结构非法时丢弃（不抛错，不阻断生成请求）。
 */

import { describe, expect, it } from 'vitest';
import { parseTaskTarget } from './task-target.js';

describe('parseTaskTarget', () => {
  it('分镜画布：nodeId + episode/shot 透传', () => {
    expect(parseTaskTarget({ nodeId: 'vg', canvas: { kind: 'scene', episode: '1', shot: '2' } })).toEqual({
      nodeId: 'vg',
      canvas: { kind: 'scene', episode: '1', shot: '2' },
    });
  });

  it('场景画布：nodeId + stage/label 透传', () => {
    expect(parseTaskTarget({ nodeId: 'vg', canvas: { kind: 'stage', stage: '街角', label: '白天' } })).toEqual({
      nodeId: 'vg',
      canvas: { kind: 'stage', stage: '街角', label: '白天' },
    });
  });

  it('仅 nodeId 或仅 canvas 时按需返回', () => {
    expect(parseTaskTarget({ nodeId: 'vg' })).toEqual({ nodeId: 'vg' });
    expect(parseTaskTarget({ canvas: { kind: 'scene', episode: '1', shot: '2' } })).toEqual({
      canvas: { kind: 'scene', episode: '1', shot: '2' },
    });
  });

  it('空值/非法结构：丢弃字段而非抛错', () => {
    expect(parseTaskTarget(undefined)).toEqual({});
    expect(parseTaskTarget({})).toEqual({});
    expect(parseTaskTarget({ nodeId: '' })).toEqual({});
    expect(parseTaskTarget({ nodeId: 42 })).toEqual({});
    // kind 未知
    expect(parseTaskTarget({ canvas: { kind: 'other', episode: '1', shot: '2' } })).toEqual({});
    // 必填字段缺失或类型不符
    expect(parseTaskTarget({ canvas: { kind: 'scene', episode: '1' } })).toEqual({});
    expect(parseTaskTarget({ canvas: { kind: 'scene', episode: 1, shot: 2 } })).toEqual({});
    expect(parseTaskTarget({ canvas: { kind: 'stage', stage: '街角' } })).toEqual({});
    expect(parseTaskTarget({ canvas: 'scene' })).toEqual({});
  });
});
