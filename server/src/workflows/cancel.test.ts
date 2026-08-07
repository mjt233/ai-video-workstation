import { describe, expect, it } from 'vitest';
import { isCancelRequested, markCancelRequested, stripCancelRequested } from './cancel.js';

describe('任务取消标记纯函数', () => {
  it('markCancelRequested 写入取消标记且保留原字段', () => {
    expect(markCancelRequested({ vars: {}, outputPath: 'assert/x.jpg' })).toEqual({
      vars: {},
      outputPath: 'assert/x.jpg',
      cancelRequested: true,
    });
  });

  it('stripCancelRequested 剥离取消标记，无标记时原样返回', () => {
    expect(stripCancelRequested({ vars: {}, cancelRequested: true })).toEqual({ vars: {} });
    expect(stripCancelRequested({ vars: {} })).toEqual({ vars: {} });
  });

  it('isCancelRequested 检测取消标记', () => {
    expect(isCancelRequested({ cancelRequested: true })).toBe(true);
    expect(isCancelRequested({ cancelRequested: false })).toBe(false);
    expect(isCancelRequested({})).toBe(false);
    expect(isCancelRequested({ cancelRequested: 'true' })).toBe(false);
  });
});
