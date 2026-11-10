import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FILE_RELAY_SCRIPT_PROVIDER_ID,
  validateFileRelayConfig,
} from './index.js';
import { getProvider } from '../registry.js';
import { DEFAULT_FILE_RELAY_TIMEOUT_SECONDS } from './runtime.js';
import { syncInstance } from '../instance-sync.js';
import { getImplementations, register } from '../../workflows/registry.js';
import type { WorkflowDefinition } from '../../workflows/types.js';
import type { ResolvedProviderConfig } from '../types.js';

/** 标准上传脚本（multipart 上传后返回 url） */
const UPLOAD_SCRIPT = `
  export default async function (ctx: any) {
    const fd = new FormData();
    fd.append('file', await ctx.file.toFile(), ctx.file.name);
    const res = await ctx.request({
      url: ctx.providerConfig.baseUrl + '/upload',
      method: 'post',
      data: fd,
    });
    return { url: (res.data as any).url };
  }
`;

/**
 * 构造已解析配置。
 *
 * @param script 上传脚本
 * @param extra 额外配置字段
 * @returns 已解析配置
 */
function mkConfig(script: string, extra: Partial<ResolvedProviderConfig> = {}): ResolvedProviderConfig {
  return { enabled: true, timeout: 5, script, ...extra } as ResolvedProviderConfig;
}

/**
 * 解析出 provider 定义（不存在则抛错，便于断言）。
 *
 * @returns 文件中转 provider 定义
 */
function providerDef() {
  const def = getProvider(FILE_RELAY_SCRIPT_PROVIDER_ID);
  if (!def) throw new Error('文件中转 provider 未注册');
  return def;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('file-relay-script provider 定义', () => {
  it('注册为 file-relay 分类的自定义脚本提供商', () => {
    const def = providerDef();
    expect(def.name).toBe('自定义脚本');
    expect(def.category).toBe('file-relay');
    expect(def.description).toBeTruthy();
  });

  it('configSchema 字段与默认值符合设计', () => {
    const schema = providerDef().configSchema;
    const fields = new Map(schema.map((f) => [f.key, f]));
    expect([...fields.keys()]).toEqual(['enabled', 'baseUrl', 'publicBaseUrl', 'apiKey', 'timeout', 'script']);
    expect(fields.get('enabled')?.type).toBe('boolean');
    expect(fields.get('enabled')?.defaultValue).toBe(true);
    expect(fields.get('baseUrl')?.type).toBe('string');
    expect(fields.get('publicBaseUrl')?.type).toBe('string');
    expect(fields.get('apiKey')?.type).toBe('password');
    expect(fields.get('apiKey')?.secret).toBe(true);
    expect(fields.get('timeout')?.type).toBe('number');
    expect(fields.get('timeout')?.defaultValue).toBe(DEFAULT_FILE_RELAY_TIMEOUT_SECONDS);
    expect(fields.get('script')?.type).toBe('component');
    expect(fields.get('script')?.component).toBe('FileRelayCodeEditorField');
  });

  it('listWorkflows 恒为空，createClient 为防御性 unsupported', async () => {
    const def = providerDef();
    await expect(def.listWorkflows({})).resolves.toEqual([]);
    const client = def.createClient({});
    expect(() => client.execute({ workflowId: 'x' })).toThrow(/不提供工作流执行能力/);
    expect(() => client.poll('x')).toThrow(/不提供工作流执行能力/);
    expect(() => client.getOutput('x')).toThrow(/不提供工作流执行能力/);
    expect(() => client.cancel('x')).toThrow(/不提供工作流执行能力/);
  });
});

describe('validateFileRelayConfig', () => {
  it('合法脚本校验通过', () => {
    expect(validateFileRelayConfig({ script: UPLOAD_SCRIPT })).toEqual([]);
  });

  it('空脚本 / 非对象入参报中文错误', () => {
    expect(validateFileRelayConfig({})).toEqual(['上传脚本不能为空']);
    expect(validateFileRelayConfig({ script: '   ' })).toEqual(['上传脚本不能为空']);
    expect(validateFileRelayConfig(null)).toEqual(['上传脚本不能为空']);
  });

  it('语法错误报带行列号的中文错误', () => {
    const errors = validateFileRelayConfig({ script: 'export default async function( {' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/代码编译失败/);
  });

  it('未 export default 函数时报中文错误', () => {
    const errors = validateFileRelayConfig({ script: 'export function foo() { return 1; }' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/必须 export default 一个函数/);
  });
});

describe('file-relay testConnection', () => {
  it('用内置约 1KB 测试文件真实执行脚本并校验返回 URL', async () => {
    let uploadedSize = 0;
    let uploadedType = '';
    let uploadedName = '';
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as FormData;
      const uploaded = body.get('file') as File;
      uploadedSize = uploaded.size;
      uploadedType = uploaded.type;
      uploadedName = uploaded.name;
      return new Response(JSON.stringify({ url: 'https://cdn.example.com/file-relay-test.txt' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await providerDef().testConnection(mkConfig(UPLOAD_SCRIPT, {
      baseUrl: 'https://upload.example.com',
    }));
    expect(result.ok).toBe(true);
    expect(result.message).toContain('测试上传成功');
    expect(result.message).toContain('cdn.example.com');
    // 内置测试文件：文件名固定、约 1KB 文本
    expect(uploadedName).toBe('file-relay-test.txt');
    expect(uploadedType).toBe('text/plain');
    expect(uploadedSize).toBe(1024);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('脚本返回非法 URL 时 ok=false 并返回中文原因', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ url: 'ftp://cdn.example.com/x' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })));
    const result = await providerDef().testConnection(mkConfig(UPLOAD_SCRIPT, {
      baseUrl: 'https://upload.example.com',
    }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('测试上传失败');
    expect(result.message).toMatch(/http\(s\)/);
  });

  it('脚本为空时 ok=false 并提示配置校验失败', async () => {
    const result = await providerDef().testConnection({} as ResolvedProviderConfig);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('配置校验失败');
    expect(result.message).toContain('上传脚本不能为空');
  });

  it('脚本抛错时 ok=false 并透传脚本错误原因', async () => {
    const result = await providerDef().testConnection(mkConfig(
      `export default async function () { throw new Error('上传服务拒绝'); }`,
    ));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('上传服务拒绝');
  });
});

describe('file-relay 实例同步', () => {
  it('跳过工作流同步：不注册该实例的可执行工作流', async () => {
    // 注册一个 provider=file-relay-script 的候选工作流；若未跳过同步会被静态同步注册为可执行副本
    register({
      type: 'text-to-image',
      impl: 'relay-candidate',
      name: '中转候选工作流',
      provider: FILE_RELAY_SCRIPT_PROVIDER_ID,
      submit: async () => ({ taskId: 't' }),
    } as unknown as WorkflowDefinition);
    await syncInstance({ id: 'inst-relay', type: FILE_RELAY_SCRIPT_PROVIDER_ID, name: '中转', config: {} });
    const impls = getImplementations('text-to-image');
    expect(impls.some((impl) => impl.providerInstanceId === 'inst-relay')).toBe(false);
  });
});
