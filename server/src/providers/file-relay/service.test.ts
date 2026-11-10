import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';

const { listInstancesMock } = vi.hoisted(() => ({ listInstancesMock: vi.fn() }));

// 隔离文件系统：service 的项目路径解析（assets/paths）保持真实逻辑，只替换 fs.stat / fs.readFile
vi.mock('fs/promises', () => ({
  default: { stat: vi.fn(), readFile: vi.fn() },
}));

// 只替换实例列表读取；resolveInstanceConfig 等仍用真实实现（provider 已由 index.ts 注册）
vi.mock('../config-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config-store.js')>();
  return { ...actual, listInstances: listInstancesMock };
});

import './index.js';
import { FILE_RELAY_NOT_CONFIGURED_MESSAGE, findEnabledFileRelayConfig, relayProjectFile } from './service.js';
import type { ProviderConfigValue, ProviderInstance } from '../types.js';

const fsMock = fs as unknown as {
  stat: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
};

/** 标准上传脚本：multipart 上传后返回服务端给的 url */
const UPLOAD_SCRIPT = `
  export default async function (ctx: any) {
    const fd = new FormData();
    fd.append('file', await ctx.file.toFile(), ctx.file.name);
    const res = await ctx.request({
      url: ctx.providerConfig.baseUrl + '/upload',
      method: 'post',
      header: { Authorization: 'Bearer ' + ctx.providerConfig.apiKey },
      data: fd,
    });
    return { url: (res.data as any).url };
  }
`;

/**
 * 构造服务商实例。
 *
 * @param config 实例配置
 * @param id 实例 id
 * @returns 服务商实例
 */
function mkInstance(config: Record<string, ProviderConfigValue>, id = 'inst-1'): ProviderInstance {
  return { id, type: 'file-relay-script', name: '中转-' + id, config };
}

/**
 * 构造一个启用的文件 relay 实例（默认使用标准上传脚本）。
 *
 * @param extra 额外/覆盖的配置字段
 * @param id 实例 id
 * @returns 服务商实例
 */
function mkEnabledInstance(extra: Record<string, ProviderConfigValue> = {}, id = 'inst-1'): ProviderInstance {
  return mkInstance({
    enabled: true,
    script: UPLOAD_SCRIPT,
    baseUrl: 'https://upload.example.com',
    apiKey: 'sk-secret-key',
    timeout: 5,
    ...extra,
  }, id);
}

beforeEach(() => {
  listInstancesMock.mockReset();
  fsMock.stat.mockReset();
  fsMock.readFile.mockReset();
  fsMock.stat.mockResolvedValue({ size: 2048, isFile: () => true });
  fsMock.readFile.mockResolvedValue(Buffer.alloc(2048));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('findEnabledFileRelayConfig', () => {
  it('取第一个 enabled !== false 的实例；全部停用时返回 null', async () => {
    listInstancesMock.mockResolvedValueOnce([
      mkInstance({ enabled: false, script: UPLOAD_SCRIPT, baseUrl: 'https://disabled.example.com' }, 'relay-1'),
      mkEnabledInstance({ baseUrl: 'https://first-enabled.example.com' }, 'relay-2'),
      mkEnabledInstance({ baseUrl: 'https://second.example.com' }, 'relay-3'),
    ]);
    const config = await findEnabledFileRelayConfig();
    expect(config?.baseUrl).toBe('https://first-enabled.example.com');

    listInstancesMock.mockResolvedValueOnce([
      mkInstance({ enabled: false, script: UPLOAD_SCRIPT }, 'relay-1'),
    ]);
    expect(await findEnabledFileRelayConfig()).toBeNull();
  });

  it('忽略非 file-relay 分类的实例', async () => {
    listInstancesMock.mockResolvedValueOnce([
      { id: 'llm-1', type: 'llm', name: 'LLM', config: { enabled: true } },
      mkEnabledInstance(),
    ]);
    const config = await findEnabledFileRelayConfig();
    expect(config?.baseUrl).toBe('https://upload.example.com');
  });
});

describe('relayProjectFile', () => {
  it('未配置文件中转实例时抛明确中文错误（不发请求）', async () => {
    listInstancesMock.mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(relayProjectFile('测试项目', 'assert/video/a.mp4'))
      .rejects.toThrow(FILE_RELAY_NOT_CONFIGURED_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('选中第一个启用实例并真实执行脚本，返回校验后的 URL', async () => {
    listInstancesMock.mockResolvedValue([
      mkInstance({ enabled: false, script: UPLOAD_SCRIPT, baseUrl: 'https://disabled.example.com' }, 'relay-1'),
      mkEnabledInstance(),
    ]);
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://upload.example.com/upload');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-secret-key' });
      const body = init.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      const uploaded = body.get('file') as File;
      expect(uploaded).toBeInstanceOf(File);
      expect(uploaded.name).toBe('video.mp4');
      expect(uploaded.size).toBe(2048);
      return new Response(JSON.stringify({ url: 'https://cdn.example.com/video.mp4' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await relayProjectFile('测试项目', 'assert/video/video.mp4');
    expect(result).toEqual({ url: 'https://cdn.example.com/video.mp4' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('每次调用都重新上传（不做 URL 缓存）', async () => {
    listInstancesMock.mockResolvedValue([mkEnabledInstance()]);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ url: 'https://cdn.example.com/video.mp4' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    await relayProjectFile('测试项目', 'assert/video/video.mp4');
    await relayProjectFile('测试项目', 'assert/video/video.mp4');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('日志只输出文件名/大小/host，不输出 apiKey 与完整 URL', async () => {
    listInstancesMock.mockResolvedValue([mkEnabledInstance()]);
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ url: 'https://cdn.example.com/video.mp4' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await relayProjectFile('测试项目', 'assert/video/video.mp4');
    const text = logSpy.mock.calls.map((args) => args.map((a) => String(a)).join(' ')).join('\n');
    expect(text).toContain('video.mp4');
    expect(text).toContain('host=cdn.example.com');
    expect(text).not.toContain('sk-secret-key');
    expect(text).not.toContain('https://cdn.example.com/video.mp4');
    expect(text).not.toContain('upload.example.com');
  });

  it('脚本抛错原样透传（由调用方包装为「文件中转失败」）', async () => {
    listInstancesMock.mockResolvedValue([
      mkEnabledInstance({ script: `export default async function () { throw new Error('上传服务拒绝'); }` }),
    ]);
    await expect(relayProjectFile('测试项目', 'assert/video/a.mp4')).rejects.toThrow(/上传服务拒绝/);
  });

  it('脚本返回非 http(s) URL 时报错', async () => {
    listInstancesMock.mockResolvedValue([
      mkEnabledInstance({ script: `export default async function () { return { url: 'ftp://cdn.example.com/a' }; }` }),
    ]);
    await expect(relayProjectFile('测试项目', 'assert/video/a.mp4')).rejects.toThrow(/必须是 http\(s\) 地址/);
  });

  it('总超时到点后抛中文超时错误', async () => {
    listInstancesMock.mockResolvedValue([
      mkEnabledInstance({
        timeout: 0.02,
        script: `
          export default async function () {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return { url: 'https://cdn.example.com/a.mp4' };
          }
        `,
      }),
    ]);
    await expect(relayProjectFile('测试项目', 'assert/video/a.mp4')).rejects.toThrow(/文件中转超时/);
  });

  it('已中止的信号直接抛「用户中断」，不读取配置也不发请求', async () => {
    const listSpy = listInstancesMock;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(relayProjectFile('测试项目', 'assert/video/a.mp4', { signal: controller.signal }))
      .rejects.toThrow(/用户中断/);
    expect(listSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('执行中中止信号会中止在途上传请求并抛「用户中断」', async () => {
    listInstancesMock.mockResolvedValue([mkEnabledInstance()]);
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal ?? undefined;
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const pending = relayProjectFile('测试项目', 'assert/video/a.mp4', { signal: controller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestSignal?.aborted).toBe(false);
    controller.abort();
    await expect(pending).rejects.toThrow(/用户中断/);
    expect(requestSignal?.aborted).toBe(true);
  });

  it('拒绝越出项目目录的路径（防穿越）', async () => {
    listInstancesMock.mockResolvedValue([mkEnabledInstance()]);
    const statMock = fsMock.stat;
    await expect(relayProjectFile('测试项目', '../../package.json')).rejects.toThrow(/路径非法/);
    expect(statMock).not.toHaveBeenCalled();
  });

  it('拒绝非法项目名（防止把项目根解析到 design/ 之外）', async () => {
    listInstancesMock.mockResolvedValue([mkEnabledInstance()]);
    await expect(relayProjectFile('../evil', 'assert/a.mp4')).rejects.toThrow(/项目名/);
  });

  it('文件不存在 / 不是文件时报中文错误', async () => {
    listInstancesMock.mockResolvedValue([mkEnabledInstance()]);
    fsMock.stat.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await expect(relayProjectFile('测试项目', 'assert/video/missing.mp4')).rejects.toThrow(/中转文件不存在/);

    fsMock.stat.mockResolvedValueOnce({ size: 0, isFile: () => false });
    await expect(relayProjectFile('测试项目', 'assert/video')).rejects.toThrow(/中转路径不是文件/);
  });
});
