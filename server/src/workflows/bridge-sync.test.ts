import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCandidatesByProvider, getImpl, getImplementations, unregister, register } from './registry.js';
import { syncBridgeInstance, buildSubmit } from './bridge-sync.js';
import type { BridgeWorkflowDetail, BridgeWorkflowSummary } from '../providers/comfyui-bridge/client.js';
import type { ProviderInstance } from '../providers/types.js';
import type { WorkflowCapabilities, WorkflowDefinition } from './types.js';

// ── mock resolveInstanceConfig / getProvider（避免真实配置与网络） ──
// 注意：vi.mock 工厂被 hoist 到顶部，mock 客户端与可变配置必须用 vi.hoisted 定义；
// resolveInstanceConfig 每次调用都读取 mockConfig 的当前值（测试可直接改 autoRegisterTag 等）
const { mockClient, mockConfig } = vi.hoisted(() => ({
  mockClient: {
    listWorkflows: vi.fn(),
    getWorkflowDetail: vi.fn(),
  },
  mockConfig: { baseUrl: 'http://b', password: 'pw', autoRegisterTag: 'auto' },
}));

vi.mock('../providers/config-store.js', () => ({
  resolveInstanceConfig: vi.fn(() => ({ ...mockConfig })),
}));
vi.mock('../providers/registry.js', () => ({
  getProvider: vi.fn(() => ({ id: 'comfyui-bridge', createClient: () => mockClient })),
}));

const detail = (over: Partial<BridgeWorkflowDetail> = {}): BridgeWorkflowDetail => ({
  id: 'text_to_image', name: '文生图', description: '', declaredParams: [], params: [], tags: [{ id: 'text-to-image', metadata: {}, tags: [] }], ...over,
});

/** 按 id/类型构造详情（多工作流场景用） */
const detailFor = (id: string, type: string): BridgeWorkflowDetail => ({
  id, name: id, description: '', declaredParams: [], params: [], tags: [{ id: type, metadata: {}, tags: [] }],
});

/** 构造列表摘要 */
const summary = (id: string, type: string): BridgeWorkflowSummary => ({
  id, name: id, declaredParams: '[]', tags: [{ id: type, metadata: {}, tags: [] }],
});

/** 构造 comfyui-bridge 测试实例 */
const mkInstance = (over: Partial<ProviderInstance> = {}): ProviderInstance => ({
  id: 'inst-1',
  type: 'comfyui-bridge',
  name: '本地Bridge',
  config: { ...mockConfig },
  enabledWorkflows: ['ceb-text_to_image'],
  ...over,
});

beforeEach(() => {
  // vi.clearAllMocks 不清除 mockConfig 的字段变更，显式复位 autoRegisterTag
  mockConfig.autoRegisterTag = 'auto';
  vi.clearAllMocks();
  // 清空动态注册（测试隔离）：可执行 + 候选
  for (const t of ['text-to-image', 'image-edit', 'tts-voice-design', 'image-to-video']) {
    for (const w of getImplementations(t)) unregister(t, w.impl);
  }
  for (const w of getCandidatesByProvider('comfyui-bridge')) unregister(w.type, w.impl);
});

describe('syncBridgeInstance', () => {
  it('按实例注册 ceb-{instanceId}-{bridgeId}，providerInstanceId/providerName/workflowKey 正确填充', async () => {
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([summary('text_to_image', 'text-to-image')]);
    (mockClient.getWorkflowDetail as ReturnType<typeof vi.fn>).mockResolvedValue(detail());
    await syncBridgeInstance(mkInstance());
    expect(mockClient.listWorkflows).toHaveBeenCalledWith('auto');
    const w = getImpl('text-to-image', 'ceb-inst-1-text_to_image');
    expect(w).toBeDefined();
    expect(w!.name).toBe('文生图');
    expect(w!.provider).toBe('comfyui-bridge');
    expect(w!.providerInstanceId).toBe('inst-1');
    expect(w!.providerName).toBe('本地Bridge');
    expect(w!.workflowKey).toBe('ceb-text_to_image');
  });

  it('按 enabledWorkflows 过滤：未启用的 ceb- 工作流不注册', async () => {
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([
      summary('text_to_image', 'text-to-image'),
      summary('qwen-edit', 'image-edit'),
    ]);
    (mockClient.getWorkflowDetail as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => detailFor(id, id === 'qwen-edit' ? 'image-edit' : 'text-to-image'));
    await syncBridgeInstance(mkInstance({ enabledWorkflows: ['ceb-text_to_image'] }));
    expect(getImpl('text-to-image', 'ceb-inst-1-text_to_image')).toBeDefined();
    expect(getImpl('image-edit', 'ceb-inst-1-qwen-edit')).toBeUndefined();
  });

  it('空启用集合 = 默认全选：注册列表全部工作流（含后续新增）', async () => {
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([
      summary('text_to_image', 'text-to-image'),
      summary('qwen-edit', 'image-edit'),
    ]);
    (mockClient.getWorkflowDetail as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => detailFor(id, id === 'qwen-edit' ? 'image-edit' : 'text-to-image'));
    await syncBridgeInstance(mkInstance({ enabledWorkflows: [] }));
    expect(getImpl('text-to-image', 'ceb-inst-1-text_to_image')).toBeDefined();
    expect(getImpl('image-edit', 'ceb-inst-1-qwen-edit')).toBeDefined();
    // 列表新增工作流：空集合 = 全选语义下自动注册
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([
      summary('text_to_image', 'text-to-image'),
      summary('qwen-edit', 'image-edit'),
      summary('tts_voice_design', 'tts-voice-design'),
    ]);
    (mockClient.getWorkflowDetail as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => detailFor(id, id === 'qwen-edit' ? 'image-edit' : id === 'tts_voice_design' ? 'tts-voice-design' : 'text-to-image'));
    await syncBridgeInstance(mkInstance({ enabledWorkflows: [] }));
    expect(getImpl('tts-voice-design', 'ceb-inst-1-tts_voice_design')).toBeDefined();
  });

  it('清理陈旧：该实例下已禁用/消失的工作流被注销', async () => {
    // 第一次：启用两个工作流并注册
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([
      summary('text_to_image', 'text-to-image'),
      summary('qwen-edit', 'image-edit'),
    ]);
    (mockClient.getWorkflowDetail as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => detailFor(id, id === 'qwen-edit' ? 'image-edit' : 'text-to-image'));
    await syncBridgeInstance(mkInstance({ enabledWorkflows: ['ceb-text_to_image', 'ceb-qwen-edit'] }));
    expect(getImpl('text-to-image', 'ceb-inst-1-text_to_image')).toBeDefined();
    expect(getImpl('image-edit', 'ceb-inst-1-qwen-edit')).toBeDefined();
    // 第二次：qwen-edit 被禁用 → 注销
    await syncBridgeInstance(mkInstance({ enabledWorkflows: ['ceb-text_to_image'] }));
    expect(getImpl('text-to-image', 'ceb-inst-1-text_to_image')).toBeDefined();
    expect(getImpl('image-edit', 'ceb-inst-1-qwen-edit')).toBeUndefined();
    // 第三次：列表不再包含 qwen-edit（消失）→ 注销
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([summary('text_to_image', 'text-to-image')]);
    await syncBridgeInstance(mkInstance({ enabledWorkflows: ['ceb-text_to_image', 'ceb-qwen-edit'] }));
    expect(getImpl('text-to-image', 'ceb-inst-1-text_to_image')).toBeDefined();
    expect(getImpl('image-edit', 'ceb-inst-1-qwen-edit')).toBeUndefined();
  });

  it('列表拉取失败保留既有注册（容错）', async () => {
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unreachable'));
    register({ type: 'text-to-image', impl: 'ceb-inst-1-keep', name: 'keep', provider: 'comfyui-bridge', providerInstanceId: 'inst-1', providerName: '本地Bridge', workflowKey: 'ceb-keep', submit: async () => ({ taskId: 't' }) } as WorkflowDefinition);
    await expect(syncBridgeInstance(mkInstance())).resolves.toBeUndefined();
    expect(getImpl('text-to-image', 'ceb-inst-1-keep')).toBeDefined();
  });

  it('未知类型工作流跳过且不注册', async () => {
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([summary('tv', 'text-to-video')]);
    await syncBridgeInstance(mkInstance({ enabledWorkflows: ['ceb-tv'] }));
    expect(getImpl('text-to-video', 'ceb-inst-1-tv')).toBeUndefined();
  });

  it('重同步幂等：同一工作流不会重复注册', async () => {
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([summary('text_to_image', 'text-to-image')]);
    (mockClient.getWorkflowDetail as ReturnType<typeof vi.fn>).mockResolvedValue(detail());
    await syncBridgeInstance(mkInstance());
    await syncBridgeInstance(mkInstance());
    expect(getImplementations('text-to-image').filter((w) => w.impl === 'ceb-inst-1-text_to_image')).toHaveLength(1);
  });

  it('重同步刷新工作流元数据（name/params 更新）', async () => {
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([summary('text_to_image', 'text-to-image')]);
    (mockClient.getWorkflowDetail as ReturnType<typeof vi.fn>).mockResolvedValue(detail());
    await syncBridgeInstance(mkInstance());
    expect(getImpl('text-to-image', 'ceb-inst-1-text_to_image')!.name).toBe('文生图');
    (mockClient.getWorkflowDetail as ReturnType<typeof vi.fn>).mockResolvedValue(detail({ name: '文生图V2' }));
    await syncBridgeInstance(mkInstance());
    expect(getImpl('text-to-image', 'ceb-inst-1-text_to_image')!.name).toBe('文生图V2');
    expect(getImplementations('text-to-image').filter((w) => w.impl === 'ceb-inst-1-text_to_image')).toHaveLength(1);
  });

  it('单详情拉取失败：跳过该工作流且保留其旧注册', async () => {
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([summary('text_to_image', 'text-to-image')]);
    (mockClient.getWorkflowDetail as ReturnType<typeof vi.fn>).mockResolvedValue(detail());
    await syncBridgeInstance(mkInstance()); // 第一次成功注册
    (mockClient.getWorkflowDetail as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    await syncBridgeInstance(mkInstance()); // 第二次详情失败
    expect(getImpl('text-to-image', 'ceb-inst-1-text_to_image')).toBeDefined(); // 旧注册保留
  });

  it('autoRegisterTag 为空时拉取全部（listWorkflows 无参）', async () => {
    mockConfig.autoRegisterTag = '';
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await syncBridgeInstance(mkInstance());
    expect(mockClient.listWorkflows).toHaveBeenCalledWith();
    mockConfig.autoRegisterTag = 'auto';
  });

  it('expose_field → params 接线进注册定义（params 优先，declaredParams 兜底）', async () => {
    const d = detail({
      params: [
        { alias: 'steps', label: '步数V2', paramType: 'number' },
      ],
      declaredParams: [
        { alias: 'steps', label: '步数', paramType: 'number' },
        { alias: 'input_image', label: '输入图', paramType: 'image' },
      ],
      tags: [{ id: 'auto', metadata: { expose_field: 'steps' }, tags: [] }, { id: 'text-to-image', metadata: {}, tags: [] }],
    });
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([summary('text_to_image', 'text-to-image')]);
    (mockClient.getWorkflowDetail as ReturnType<typeof vi.fn>).mockResolvedValue(d);
    await syncBridgeInstance(mkInstance());
    const w = getImpl('text-to-image', 'ceb-inst-1-text_to_image');
    // 同一别名 steps 在 params（步数V2）与 declaredParams（步数）中都存在 → 以 params 为准
    expect(w!.params).toEqual([{ key: 'steps', name: '步数V2', type: 'integer', defaultValue: '' }]);
  });

  it('expose_field 含 providerId 时被过滤（Bridge 执行保留键不作为用户参数）', async () => {
    const d = detail({
      params: [
        { alias: 'providerId', label: '提供商', paramType: 'text' },
        { alias: 'steps', label: '步数', paramType: 'number' },
      ],
      tags: [
        { id: 'auto', metadata: { expose_field: 'providerId,steps' }, tags: [] },
        { id: 'text-to-image', metadata: {}, tags: [] },
      ],
    });
    (mockClient.listWorkflows as ReturnType<typeof vi.fn>).mockResolvedValue([summary('text_to_image', 'text-to-image')]);
    (mockClient.getWorkflowDetail as ReturnType<typeof vi.fn>).mockResolvedValue(d);
    await syncBridgeInstance(mkInstance());
    const w = getImpl('text-to-image', 'ceb-inst-1-text_to_image');
    expect(w!.params).toEqual([{ key: 'steps', name: '步数', type: 'integer', defaultValue: '' }]);
  });
});

describe('buildSubmit（text-to-image）', () => {
  it('读取 promptPath 并执行 execute（workflowId 透传原始 Bridge id）', async () => {
    const execute = vi.fn(async () => ({ taskId: 't1' }));
    const submit = buildSubmit('text_to_image', 'text-to-image', { cancelable: true });
    const ctx = {
      vars: { promptPath: 'p.md' },
      projectConfig: { width: 1080, height: 1920 },
      readFile: async () => '一只猫',
      provider: { execute },
    } as never;
    await submit(ctx as never);
    expect(execute).toHaveBeenCalledWith({
      workflowId: 'text_to_image',
      params: expect.objectContaining({ prompt: '一只猫', width: 1080, height: 1920 }),
    });
  });

  it('无 enable_specified_size 声明时，vars.width/height 直接生效（不依赖门控）', async () => {
    const execute = vi.fn(async () => ({ taskId: 't1' }));
    const submit = buildSubmit('text_to_image', 'text-to-image', { cancelable: true });
    const ctx = {
      vars: { promptPath: 'p.md', width: '720', height: '1280' },
      projectConfig: { width: 1080, height: 1920 },
      readFile: async () => '一只猫',
      provider: { execute },
    } as never;
    await submit(ctx as never);
    expect(execute).toHaveBeenCalledWith({
      workflowId: 'text_to_image',
      params: expect.objectContaining({ width: 720, height: 1280 }),
    });
  });

  it('显式 enable_specified_size=false 时回退 projectConfig（忽略 vars.width/height）', async () => {
    const execute = vi.fn(async () => ({ taskId: 't1' }));
    const submit = buildSubmit('text_to_image', 'text-to-image', { cancelable: true });
    const ctx = {
      vars: { promptPath: 'p.md', enable_specified_size: 'false', width: '720', height: '1280' },
      projectConfig: { width: 1080, height: 1920 },
      readFile: async () => '一只猫',
      provider: { execute },
    } as never;
    await submit(ctx as never);
    expect(execute).toHaveBeenCalledWith({
      workflowId: 'text_to_image',
      params: expect.objectContaining({ width: 1080, height: 1920 }),
    });
  });

  it('ctx.comfyuiProviderId 非空时透传 providerId，缺省时不携带', async () => {
    const execute = vi.fn(async () => ({ taskId: 't1' }));
    const submit = buildSubmit('text_to_image', 'text-to-image', { cancelable: true });
    const base = {
      vars: { promptPath: 'p.md' },
      projectConfig: { width: 1080, height: 1920 },
      readFile: async () => '一只猫',
      provider: { execute },
    };
    await submit({ ...base, comfyuiProviderId: 'inst-7' } as never);
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ providerId: 'inst-7' }));
    await submit(base as never);
    const last = (execute as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as { providerId?: string };
    expect('providerId' in last).toBe(false);
  });
});

describe('buildSubmit（image-edit）', () => {
  it('动态用户参数经 ctx.userParams 透传（含布尔原生类型），结构字段排除', async () => {
    const execute = vi.fn(async () => ({ taskId: 't' }));
    const submit = buildSubmit('qwen-edit-2509', 'image-edit', { cancelable: true });
    const ctx = (vars: Record<string, string | undefined>, userParams: Record<string, boolean | number | string> | undefined) => ({
      vars,
      projectConfig: { width: 1080, height: 1920 },
      readAssertFile: async () => new File([], 'a.png'),
      provider: { execute },
      userParams,
    } as never);
    const baseVars = { prompt: 'p', imagePaths: '["assert/a.png"]' };
    // 用户配置 true → 透传布尔 true（经 ctx.userParams，不再硬编码）
    await submit(ctx(baseVars, { enable_multiple_angles_lora: true }) as never);
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({
      workflowId: 'qwen-edit-2509',
      params: expect.objectContaining({ prompt: 'p', enable_multiple_angles_lora: true }),
    }));
    // 用户配置 false → 透传布尔 false
    await submit(ctx(baseVars, { enable_multiple_angles_lora: false }) as never);
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({
      params: expect.objectContaining({ enable_multiple_angles_lora: false }),
    }));
    // 未配置 → 不带上送（Bridge 默认值兜底）
    await submit(ctx(baseVars, undefined) as never);
    const last = (execute as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as { params: Record<string, unknown> };
    expect('enable_multiple_angles_lora' in last.params).toBe(false);
    // 结构字段（尺寸）从透传排除：即使 userParams 带 width，也以结构处理为准
    await submit(ctx({ ...baseVars, enable_specified_size: 'true', width: '640', height: '960' }, { width: 999 }) as never);
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({
      params: expect.objectContaining({ width: 640, height: 960 }),
    }));
  });
});

describe('buildSubmit（image-to-video 模式分发）', () => {
  /**
   * 构造视频提交上下文（provider.execute 由调用方传入以便断言；File 用占位对象）。
   *
   * @param execute provider.execute mock
   * @param video ctx.video 自包含提交数据
   * @returns 最小上下文对象（提交时强转，无需完整 WorkflowRunContext）
   */
  const mkVideoCtx = (execute: ReturnType<typeof vi.fn>, video: Record<string, unknown>) => ({
    vars: {},
    projectConfig: { width: 1080, height: 1920 },
    readFile: async () => '',
    readAssertFile: async () => new File([], 'f.png'),
    provider: { execute },
    video,
  });

  it('director 模式：buildDirectorPayload 形状载荷（workflowId 透传原始 Bridge id + frame_define）', async () => {
    const execute = vi.fn(async () => ({ taskId: 't' }));
    const submit = buildSubmit('x', 'image-to-video', { cancelable: true, video: { modes: ['director'] } });
    await submit(mkVideoCtx(execute, {
      mode: 'director',
      resolution: { width: 1080, height: 1920 },
      duration: 10,
      prompt: '一只猫跑过',
      fps: 24,
      director: { frames: [{ file: new File([], 'a.png'), cursor: 0 }, { file: new File([], 'b.png'), cursor: 0.5 }] },
      extraParams: {},
    }) as never);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'x',
      params: expect.objectContaining({ prompt: '一只猫跑过', width: 1080, height: 1920, duration: 10, fps: 24, frame_define: expect.any(String) }),
      files: expect.objectContaining({ image_0: expect.anything(), image_1: expect.anything() }),
    }));
  });

  it('first-last-frame：帧数在 1~maxFrames 内执行，超出抛错', async () => {
    const execute = vi.fn(async () => ({ taskId: 't' }));
    const submit = buildSubmit('x', 'image-to-video', { cancelable: true, video: { modes: ['first-last-frame'], firstLastFrame: { maxFrames: 2 } } });
    const frames = (n: number) => Array.from({ length: n }, (_, i) => ({ file: new File([], `${i}.png`), cursor: i / Math.max(n - 1, 1) }));
    await submit(mkVideoCtx(execute, { mode: 'first-last-frame', resolution: { width: 1080, height: 1920 }, duration: 10, prompt: 'p', fps: 24, director: { frames: frames(2) }, extraParams: {} }) as never);
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(submit(mkVideoCtx(execute, { mode: 'first-last-frame', resolution: { width: 1080, height: 1920 }, duration: 10, prompt: 'p', fps: 24, director: { frames: frames(3) }, extraParams: {} }) as never)).rejects.toThrow(/首尾帧模式需要 1~2 帧/);
  });

  it('reference 模式：buildReferencePayload 形状载荷', async () => {
    const execute = vi.fn(async () => ({ taskId: 't' }));
    const submit = buildSubmit('x', 'image-to-video', { cancelable: true, video: { modes: ['reference'] } });
    await submit(mkVideoCtx(execute, {
      mode: 'reference',
      resolution: { width: 1080, height: 1920 },
      duration: 10,
      prompt: 'p',
      references: [{ type: 'image', file: new File([], 'a.png') }, { type: 'video', file: new File([], 'v.mp4') }],
      extraParams: {},
    }) as never);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'x',
      params: expect.objectContaining({ prompt: 'p', width: 1080, height: 1920, duration: 10 }),
      files: expect.objectContaining({ image_0: expect.anything(), video_0: expect.anything() }),
    }));
  });

  /** 带 reference 能力声明的 caps（maxTotal=12，image 9/video 3/audio 3） */
  const refCaps: WorkflowCapabilities = {
    cancelable: true,
    video: {
      modes: ['reference'],
      reference: { maxTotal: 12, types: { image: { max: 9 }, video: { max: 3 }, audio: { max: 3 } } },
    },
  };

  it('reference 模式：参考素材超过 maxTotal 抛错', async () => {
    const execute = vi.fn(async () => ({ taskId: 't' }));
    const submit = buildSubmit('x', 'image-to-video', refCaps);
    const refs = Array.from({ length: 13 }, (_, i) => ({ type: 'image', file: new File([], `${i}.png`) }));
    await expect(submit(mkVideoCtx(execute, { mode: 'reference', resolution: { width: 1080, height: 1920 }, duration: 10, prompt: 'p', references: refs, extraParams: {} }) as never)).rejects.toThrow(/参考素材总数量超过上限（12）/);
  });

  it('reference 模式：音频唯一输入抛错（不能作为唯一输入）', async () => {
    const execute = vi.fn(async () => ({ taskId: 't' }));
    const submit = buildSubmit('x', 'image-to-video', refCaps);
    await expect(submit(mkVideoCtx(execute, { mode: 'reference', resolution: { width: 1080, height: 1920 }, duration: 10, prompt: 'p', references: [{ type: 'audio', file: new File([], 'a.mp3') }], extraParams: {} }) as never)).rejects.toThrow(/音频参考必须与图片或视频参考一同输入/);
  });

  it('reference 模式：合法参考（image+audio）执行 execute', async () => {
    const execute = vi.fn(async () => ({ taskId: 't' }));
    const submit = buildSubmit('x', 'image-to-video', refCaps);
    await submit(mkVideoCtx(execute, {
      mode: 'reference',
      resolution: { width: 1080, height: 1920 },
      duration: 10,
      prompt: 'p',
      references: [{ type: 'image', file: new File([], 'a.png') }, { type: 'audio', file: new File([], 'a.mp3') }],
      extraParams: {},
    }) as never);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'x',
      params: expect.objectContaining({ prompt: 'p', width: 1080, height: 1920, duration: 10 }),
      files: expect.objectContaining({ image_0: expect.anything(), audio_0: expect.anything() }),
    }));
  });

  it('不支持的模式抛错', async () => {
    const execute = vi.fn(async () => ({ taskId: 't' }));
    const submit = buildSubmit('x', 'image-to-video', { cancelable: true, video: { modes: ['director'] } });
    await expect(submit(mkVideoCtx(execute, { mode: 'upscale', resolution: { width: 1080, height: 1920 }, duration: 10, prompt: 'p', extraParams: {} }) as never)).rejects.toThrow(/不支持生成模式/);
  });
});

describe('buildSubmit（tts-voice-clone）', () => {
  it('读取 text/refText/refAudioPath 并执行 execute（文件 audio_0）', async () => {
    const execute = vi.fn(async () => ({ taskId: 't' }));
    const submit = buildSubmit('tts_voice_clone', 'tts-voice-clone', { cancelable: true });
    const refAudio = new File([], 'ref.flac');
    const ctx = {
      vars: { text: '你好', refText: '参考文本', refAudioPath: '["assert/custom/ref.flac"]' },
      projectConfig: { width: 1080, height: 1920 },
      readAssertFile: async () => refAudio,
      provider: { execute },
    } as never;
    await submit(ctx as never);
    expect(execute).toHaveBeenCalledWith({
      workflowId: 'tts_voice_clone',
      params: expect.objectContaining({ text: '你好', ref_text: '参考文本' }),
      files: { audio_0: refAudio },
    });
  });

  it('缺少 text/refText/refAudioPath 报错', async () => {
    const execute = vi.fn(async () => ({ taskId: 't' }));
    const submit = buildSubmit('tts_voice_clone', 'tts-voice-clone', { cancelable: true });
    const mk = (vars: Record<string, string | undefined>) => ({
      vars, projectConfig: { width: 1080, height: 1920 }, readAssertFile: async () => new File([], 'a.flac'), provider: { execute },
    } as never);
    await expect(submit(mk({ text: '', refText: 'r', refAudioPath: '["a.flac"]' }) as never)).rejects.toThrow(/需要 vars.text/);
    await expect(submit(mk({ text: 't', refText: '', refAudioPath: '["a.flac"]' }) as never)).rejects.toThrow(/需要 vars.refText/);
    await expect(submit(mk({ text: 't', refText: 'r', refAudioPath: '["a.flac","b.flac"]' }) as never)).rejects.toThrow(/恰好 1 个参考音频/);
    await expect(submit(mk({ text: 't', refText: 'r', refAudioPath: '[]' }) as never)).rejects.toThrow(/恰好 1 个参考音频/);
  });
});
