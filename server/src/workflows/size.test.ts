import { describe, expect, it } from 'vitest';
import {
  enableSpecifiedSize,
  hasExplicitSize,
  resolveOutputSize,
  resolvePresetSize,
  resolveSpecifiedGate,
  SIZE_PARAMS,
  SIZE_RATIOS,
  SIZE_RESOLUTIONS,
} from './size.js';

describe('档位表（前端 workflowSize.ts 的服务端镜像）', () => {
  it('比例档与前端一致（8 档）', () => {
    expect(SIZE_RATIOS.map((r) => r.key)).toEqual(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9']);
  });

  it('分辨率档与前端一致（11 档，基准值唯一）', () => {
    expect(SIZE_RESOLUTIONS.map((r) => r.key)).toEqual([
      '360P', '480P', '720P', '768P', '1080P', '1K', '1.5K', '2K', '3K', '4K', '8K',
    ]);
    const bases = SIZE_RESOLUTIONS.map((r) => r.base);
    expect(new Set(bases).size).toBe(bases.length);
  });

  it('基准值恒为输出短边，且为业务确认的标准短边（2K=1440、4K=2160、8K=4320）', () => {
    expect(SIZE_RESOLUTIONS.map((r) => `${r.key}:${r.base}`)).toEqual([
      '360P:360', '480P:480', '720P:720', '768P:768', '1080P:1080',
      '1K:1024', '1.5K:1536', '2K:1440', '3K:1620', '4K:2160', '8K:4320',
    ]);
  });
});

describe('resolvePresetSize', () => {
  it('横屏基准落在高度（16:9 + 2K → 2560x1440；16:9 + 4K → 3840x2160）', () => {
    expect(resolvePresetSize('16:9', '2K')).toEqual({ width: 2560, height: 1440 });
    expect(resolvePresetSize('16:9', '4K')).toEqual({ width: 3840, height: 2160 });
  });

  it('竖屏基准落在宽度（9:16 + 2K → 1440x2560；9:16 + 4K → 2160x3840，回归竖屏超大图）', () => {
    expect(resolvePresetSize('9:16', '2K')).toEqual({ width: 1440, height: 2560 });
    expect(resolvePresetSize('9:16', '4K')).toEqual({ width: 2160, height: 3840 });
  });

  it('P 档与 K 档同一规则（16:9 + 1080P → 1920x1080；9:16 + 1080P → 1080x1920）', () => {
    expect(resolvePresetSize('16:9', '1080P')).toEqual({ width: 1920, height: 1080 });
    expect(resolvePresetSize('9:16', '1080P')).toEqual({ width: 1080, height: 1920 });
  });

  it('同一档位横竖屏面积一致（短边相同）', () => {
    for (const key of ['1080P', '1K', '2K', '4K']) {
      const land = resolvePresetSize('16:9', key)!;
      const port = resolvePresetSize('9:16', key)!;
      const base = SIZE_RESOLUTIONS.find((r) => r.key === key)!.base;
      expect(Math.min(land.width, land.height)).toBe(base);
      expect(Math.min(port.width, port.height)).toBe(base);
      expect(land.width * land.height).toBe(port.width * port.height);
    }
  });

  it('正方形两维同为基准（1:1 + 2K → 1440x1440）', () => {
    expect(resolvePresetSize('1:1', '2K')).toEqual({ width: 1440, height: 1440 });
  });

  it('超宽比例基准仍落在高度（21:9 + 2K → 3360x1440）', () => {
    expect(resolvePresetSize('21:9', '2K')).toEqual({ width: 3360, height: 1440 });
  });

  it('自适应/未知档位返回 null（调用方回退下一优先级）', () => {
    expect(resolvePresetSize('auto', '2K')).toBeNull();
    expect(resolvePresetSize('16:9', 'auto')).toBeNull();
    expect(resolvePresetSize('16:9', '9K')).toBeNull();
    expect(resolvePresetSize('adaptive', '768P')).toBeNull();
  });
});

describe('resolveOutputSize', () => {
  const base = { fallbackWidth: 1920, fallbackHeight: 1080 };

  it('sizeConfig 显式宽高最高优先（画布节点提交的 16:9 / 2K）', () => {
    expect(resolveOutputSize({
      ...base,
      sizeConfig: { ratio: '16:9', size: '2K', width: 2560, height: 1440 },
      enableSpecified: 'on',
      vars: { width: '720', height: '1280' },
    })).toEqual({ width: 2560, height: 1440 });
  });

  it('sizeConfig 显式宽高在门控 off 时依然生效（用户选择优先于「不指定」残留）', () => {
    expect(resolveOutputSize({
      ...base,
      sizeConfig: { ratio: '16:9', size: '2K', width: 2560, height: 1440 },
      enableSpecified: 'off',
    })).toEqual({ width: 2560, height: 1440 });
  });

  it('sizeConfig 仅带比例/尺寸档时按档位表换算（16:9 + 1K → 1820x1024）', () => {
    expect(resolveOutputSize({
      ...base,
      sizeConfig: { ratio: '16:9', size: '1K' },
      enableSpecified: 'on',
    })).toEqual({ width: 1820, height: 1024 });
  });

  it('sizeConfig 为自动/自动时不换算，落回旧来源', () => {
    expect(resolveOutputSize({
      ...base,
      sizeConfig: { ratio: 'auto', size: 'auto' },
      enableSpecified: 'on',
      vars: { width: '720', height: '1280' },
    })).toEqual({ width: 720, height: 1280 });
  });

  it('无 sizeConfig 时按门控取旧 vars 宽高（on 与 default-permissive 均参与）', () => {
    expect(resolveOutputSize({ ...base, enableSpecified: 'on', vars: { width: '720', height: '1280' } }))
      .toEqual({ width: 720, height: 1280 });
    expect(resolveOutputSize({ ...base, enableSpecified: 'default-permissive', vars: { width: '720', height: '1280' } }))
      .toEqual({ width: 720, height: 1280 });
  });

  it('default-strict（方舟/OpenAI 兼容缺省语义）时旧 vars 宽高不参与，回退项目尺寸', () => {
    expect(resolveOutputSize({ ...base, enableSpecified: 'default-strict', vars: { width: '720', height: '1280' } }))
      .toEqual({ width: 1920, height: 1080 });
  });

  it('旧 vars 优先于 userParams（表单回写与手工参数的既有语义）', () => {
    expect(resolveOutputSize({
      ...base,
      enableSpecified: 'on',
      vars: { width: '720', height: '1280' },
      userParams: { width: 999, height: 999 },
    })).toEqual({ width: 720, height: 1280 });
  });

  it('vars 缺宽高时回退 userParams（图片编辑类工作流）', () => {
    expect(resolveOutputSize({ ...base, enableSpecified: 'on', userParams: { width: 640, height: 960 } }))
      .toEqual({ width: 640, height: 960 });
  });

  it('门控 off（前端「不指定」）时忽略旧宽高，回退项目尺寸', () => {
    expect(resolveOutputSize({
      ...base,
      enableSpecified: 'off',
      vars: { width: '720', height: '1280' },
      userParams: { width: 640, height: 960 },
    })).toEqual({ width: 1920, height: 1080 });
  });

  it('仅单维有效时不生效（需宽高齐备），回退项目尺寸', () => {
    expect(resolveOutputSize({
      ...base,
      sizeConfig: { width: 2560 },
      enableSpecified: 'on',
      vars: { width: '720' },
    })).toEqual({ width: 1920, height: 1080 });
  });

  it('项目尺寸缺失/非法时按 1080x1920 兜底', () => {
    expect(resolveOutputSize({ fallbackWidth: 0, fallbackHeight: Number.NaN }))
      .toEqual({ width: 1080, height: 1920 });
  });
});

describe('resolveSpecifiedGate', () => {
  it('门控显式 false 优先于一切（前端「不指定」模式）', () => {
    expect(resolveSpecifiedGate({ ratio: '16:9', size: '2K', width: 2560, height: 1440 }, 'false', true))
      .toBe('off');
    expect(resolveSpecifiedGate(undefined, false, true)).toBe('off');
  });

  it('sizeConfig 携带明确尺寸时为 on（不受门控缺省影响）', () => {
    expect(resolveSpecifiedGate({ ratio: '16:9', size: '2K' }, undefined, false)).toBe('on');
    expect(resolveSpecifiedGate({ width: 2560, height: 1440 }, undefined, false)).toBe('on');
  });

  it('门控显式 true 时为 on', () => {
    expect(resolveSpecifiedGate(undefined, 'true', false)).toBe('on');
  });

  it('门控缺失时为 default-strict（严格实现）或 default-permissive（宽松实现）', () => {
    expect(resolveSpecifiedGate(undefined, undefined, true)).toBe('default-permissive');
    expect(resolveSpecifiedGate(undefined, undefined, false)).toBe('default-strict');
  });

  it('门控缺失且 sizeConfig 自适应时为 default-*（严格实现不采用旧宽高）', () => {
    expect(resolveSpecifiedGate({ ratio: 'auto', size: 'auto' }, undefined, false)).toBe('default-strict');
    expect(resolveSpecifiedGate({ ratio: 'auto', size: 'auto' }, undefined, true)).toBe('default-permissive');
  });
});

describe('enableSpecifiedSize（门控布尔视图）', () => {
  it('on / default-permissive → true；off / default-strict → false', () => {
    expect(enableSpecifiedSize({ ratio: '16:9', size: '2K' }, undefined, false)).toBe(true);
    expect(enableSpecifiedSize(undefined, undefined, true)).toBe(true);
    expect(enableSpecifiedSize(undefined, 'false', true)).toBe(false);
    expect(enableSpecifiedSize(undefined, undefined, false)).toBe(false);
  });
});

describe('hasExplicitSize', () => {
  it('比例/尺寸档非自适应或有宽高即视为显式指定', () => {
    expect(hasExplicitSize({ ratio: '16:9' })).toBe(true);
    expect(hasExplicitSize({ size: '2K' })).toBe(true);
    expect(hasExplicitSize({ width: 2560 })).toBe(true);
  });

  it('自适应或空配置视为未指定', () => {
    expect(hasExplicitSize(undefined)).toBe(false);
    expect(hasExplicitSize({})).toBe(false);
    expect(hasExplicitSize({ ratio: 'auto', size: 'auto' })).toBe(false);
    expect(hasExplicitSize({ ratio: 'adaptive' })).toBe(false);
    expect(hasExplicitSize({ width: 0, height: -1 })).toBe(false);
  });
});

describe('SIZE_PARAMS', () => {
  it('为三个旧版尺寸 key 提供声明（前端据此回写标量，缺失会断旧链路）', () => {
    expect(SIZE_PARAMS.map((p) => p.key)).toEqual(['enable_specified_size', 'width', 'height']);
    expect(SIZE_PARAMS[0]!.type).toBe('boolean');
    expect(SIZE_PARAMS[1]!.type).toBe('integer');
  });
});
