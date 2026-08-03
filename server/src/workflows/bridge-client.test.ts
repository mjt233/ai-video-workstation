import { describe, expect, it } from 'vitest';
import { resolveImageEditSizeParams } from './bridge-client.js';

describe('resolveImageEditSizeParams', () => {
  it('enable_specified_size=true 时解析出启用的宽高（数字）', () => {
    expect(
      resolveImageEditSizeParams({
        enable_specified_size: 'true',
        width: '1920',
        height: '1080',
      }),
    ).toEqual({ enable_specified_size: true, width: 1920, height: 1080 });
  });

  it('enable_specified_size=false 时不返回任何尺寸参数', () => {
    expect(
      resolveImageEditSizeParams({ enable_specified_size: 'false', width: '1920', height: '1080' }),
    ).toEqual({});
  });

  it('未声明 enable_specified_size 时不返回任何尺寸参数', () => {
    expect(resolveImageEditSizeParams({ width: '1920', height: '1080' })).toEqual({});
  });

  it('启用但未提供宽高时只返回启用标记', () => {
    expect(resolveImageEditSizeParams({ enable_specified_size: 'true' })).toEqual({
      enable_specified_size: true,
    });
  });

  it('非法宽高值被忽略', () => {
    expect(
      resolveImageEditSizeParams({ enable_specified_size: 'true', width: 'abc', height: '' }),
    ).toEqual({ enable_specified_size: true });
  });

  it('小数宽高取整', () => {
    expect(
      resolveImageEditSizeParams({ enable_specified_size: 'true', width: '1920.5', height: '1080.5' }),
    ).toEqual({ enable_specified_size: true, width: 1921, height: 1081 });
  });
});
