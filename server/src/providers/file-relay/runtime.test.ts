import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FILE_RELAY_TIMEOUT_SECONDS,
  buildFileRelayContext,
  createInMemoryFileRelayFile,
  fileRelayUrlHost,
  fileRelayUrlPortWarning,
  normalizeFileRelayResult,
  resolveFileRelayTimeoutSeconds,
  runFileRelayScript,
  type FileRelayFile,
} from './runtime.js';
import type { ResolvedProviderConfig } from '../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * 构造内存文件对象（文件名/MIME 按文本文件）。
 *
 * @param bytes 文件字节
 * @param name 文件名
 * @returns 文件对象
 */
function mkFile(bytes = new Uint8Array([104, 105]), name = 'a.txt'): FileRelayFile {
  return createInMemoryFileRelayFile({ path: name, name, mimeType: 'text/plain', bytes });
}

/**
 * 构造已解析的实例配置。
 *
 * @param script 上传脚本源码
 * @param extra 额外配置字段
 * @returns 已解析配置
 */
function mkConfig(script: string, extra: Partial<ResolvedProviderConfig> = {}): ResolvedProviderConfig {
  return { script, timeout: 5, ...extra } as ResolvedProviderConfig;
}

describe('buildFileRelayContext', () => {
  it('注入配置 / 文件 / 中止信号，request 复用 performCustomRequest', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ url: 'https://cdn.example.com/a.mp4' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const file = mkFile();
    const ctx = buildFileRelayContext({
      providerConfig: { baseUrl: 'https://upload.example.com', apiKey: 'sk-x' },
      file,
      signal: controller.signal,
      requestTimeoutMs: 1000,
    });
    expect(ctx.providerConfig.baseUrl).toBe('https://upload.example.com');
    expect(ctx.file).toBe(file);
    expect(ctx.signal).toBe(controller.signal);
    const res = await ctx.request({ url: 'https://upload.example.com/upload', method: 'post' });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ url: 'https://cdn.example.com/a.mp4' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('未传中止信号时 ctx.signal 为 undefined', () => {
    const ctx = buildFileRelayContext({ providerConfig: {}, file: mkFile() });
    expect(ctx.signal).toBeUndefined();
  });
});

describe('createInMemoryFileRelayFile', () => {
  it('size / read / base64 / toFile 均基于同一份字节', async () => {
    const file = createInMemoryFileRelayFile({
      path: 'assert/a.txt',
      name: 'a.txt',
      mimeType: 'text/plain',
      bytes: new Uint8Array([104, 105]),
    });
    expect(file.path).toBe('assert/a.txt');
    expect(file.name).toBe('a.txt');
    expect(file.mimeType).toBe('text/plain');
    expect(file.size).toBe(2);
    expect(Array.from(await file.read())).toEqual([104, 105]);
    expect(await file.base64()).toBe('aGk=');
    const hostFile = await file.toFile();
    expect(hostFile.name).toBe('a.txt');
    expect(hostFile.type).toBe('text/plain');
    expect(hostFile.size).toBe(2);
  });
});

describe('resolveFileRelayTimeoutSeconds', () => {
  it('缺省 / 非法 / 非正数时回落到默认超时', () => {
    expect(resolveFileRelayTimeoutSeconds({})).toBe(DEFAULT_FILE_RELAY_TIMEOUT_SECONDS);
    expect(resolveFileRelayTimeoutSeconds({ timeout: 0 })).toBe(DEFAULT_FILE_RELAY_TIMEOUT_SECONDS);
    expect(resolveFileRelayTimeoutSeconds({ timeout: -3 })).toBe(DEFAULT_FILE_RELAY_TIMEOUT_SECONDS);
    expect(resolveFileRelayTimeoutSeconds({ timeout: 'abc' })).toBe(DEFAULT_FILE_RELAY_TIMEOUT_SECONDS);
  });

  it('合法数字原样返回', () => {
    expect(resolveFileRelayTimeoutSeconds({ timeout: 30 })).toBe(30);
    expect(resolveFileRelayTimeoutSeconds({ timeout: 0.5 })).toBe(0.5);
  });
});

describe('fileRelayUrlHost', () => {
  it('提取 host，不输出完整 URL；非法地址返回未知主机', () => {
    expect(fileRelayUrlHost('https://cdn.example.com:8443/a/b.mp4?x=1')).toBe('cdn.example.com:8443');
    expect(fileRelayUrlHost('不是地址')).toBe('未知主机');
  });
});

describe('fileRelayUrlPortWarning', () => {
  it('标准端口（缺省 / 80 / 443）不提示', () => {
    expect(fileRelayUrlPortWarning('https://cdn.example.com/a.mp4')).toBeNull();
    expect(fileRelayUrlPortWarning('http://cdn.example.com/a.mp4')).toBeNull();
    expect(fileRelayUrlPortWarning('https://cdn.example.com:443/a.mp4')).toBeNull();
    expect(fileRelayUrlPortWarning('http://cdn.example.com:80/a.mp4')).toBeNull();
  });

  it('非标准端口给出中文提示（不阻断）', () => {
    const warning = fileRelayUrlPortWarning('https://disk.example.com:344/api/get?id=1');
    expect(warning).toContain('非标准端口（344）');
    expect(warning).toContain('80/443');
  });

  it('非法地址 / 非 http(s) 协议不提示', () => {
    expect(fileRelayUrlPortWarning('不是地址')).toBeNull();
    expect(fileRelayUrlPortWarning('ftp://cdn.example.com:21/a')).toBeNull();
  });
});

describe('normalizeFileRelayResult', () => {
  it('合法 http(s) URL 原样返回（trim）', () => {
    expect(normalizeFileRelayResult({ url: '  https://cdn.example.com/a.mp4  ' }))
      .toEqual({ url: 'https://cdn.example.com/a.mp4' });
    expect(normalizeFileRelayResult({ url: 'http://example.com/a' })).toEqual({ url: 'http://example.com/a' });
  });

  it('非对象 / 缺 url / 空 url 报中文错误', () => {
    expect(() => normalizeFileRelayResult(null)).toThrow(/必须返回对象/);
    expect(() => normalizeFileRelayResult([])).toThrow(/必须返回对象/);
    expect(() => normalizeFileRelayResult({})).toThrow(/url 必须是非空字符串/);
    expect(() => normalizeFileRelayResult({ url: '   ' })).toThrow(/url 必须是非空字符串/);
  });

  it('非法地址与非 http(s) 协议被拒绝', () => {
    expect(() => normalizeFileRelayResult({ url: '不是地址' })).toThrow(/不是合法的 http\(s\) 地址/);
    expect(() => normalizeFileRelayResult({ url: 'ftp://cdn.example.com/a' }))
      .toThrow(/必须是 http\(s\) 地址/);
  });
});

describe('runFileRelayScript', () => {
  it('编译并执行脚本，校验返回 URL', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ url: 'https://cdn.example.com/obj.mp4' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const script = `
      export default async function (ctx: any) {
        const res = await ctx.request({ url: ctx.providerConfig.baseUrl + '/upload', method: 'post' });
        return { url: (res.data as any).url };
      }
    `;
    const result = await runFileRelayScript(mkConfig(script, { baseUrl: 'https://upload.example.com' }), mkFile());
    expect(result).toEqual({ url: 'https://cdn.example.com/obj.mp4' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('脚本未配置时抛中文错误', async () => {
    await expect(runFileRelayScript({} as ResolvedProviderConfig, mkFile())).rejects.toThrow(/脚本未配置/);
  });

  it('语法错误 / 非 export default 函数在编译期报错', async () => {
    await expect(runFileRelayScript(mkConfig('export default async function( {'), mkFile()))
      .rejects.toThrow(/代码编译失败/);
    await expect(runFileRelayScript(mkConfig('export function foo() { return 1; }'), mkFile()))
      .rejects.toThrow(/必须 export default 一个函数/);
  });

  it('脚本抛错原样透传', async () => {
    const script = `export default async function () { throw new Error('上传服务拒绝'); }`;
    await expect(runFileRelayScript(mkConfig(script), mkFile())).rejects.toThrow(/上传服务拒绝/);
  });

  it('脚本返回非 http(s) URL 时报错', async () => {
    const script = `export default async function () { return { url: 'ftp://cdn.example.com/a.mp4' }; }`;
    await expect(runFileRelayScript(mkConfig(script), mkFile())).rejects.toThrow(/必须是 http\(s\) 地址/);
  });

  it('总超时到点后以中文超时错误结束', async () => {
    const script = `
      export default async function () {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { url: 'https://cdn.example.com/a.mp4' };
      }
    `;
    await expect(runFileRelayScript(mkConfig(script, { timeout: 0.05 }), mkFile()))
      .rejects.toThrow(/文件中转超时（0\.05 秒）/);
  });

  it('外部信号已中止时不执行脚本', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    const script = `
      export default async function (ctx: any) {
        await ctx.request({ url: 'https://upload.example.com/upload' });
        return { url: 'https://cdn.example.com/a.mp4' };
      }
    `;
    await expect(runFileRelayScript(mkConfig(script), mkFile(), controller.signal))
      .rejects.toThrow(/用户中断/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('执行中外部信号中止会中止在途请求并抛「用户中断」', async () => {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal ?? undefined;
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
    })));
    const controller = new AbortController();
    const script = `
      export default async function (ctx: any) {
        await ctx.request({ url: 'https://upload.example.com/upload' });
        return { url: 'https://cdn.example.com/a.mp4' };
      }
    `;
    const pending = runFileRelayScript(mkConfig(script), mkFile(), controller.signal);
    // 等脚本进入 ctx.request（fetch 已发起）后再中止
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestSignal?.aborted).toBe(false);
    controller.abort();
    await expect(pending).rejects.toThrow(/用户中断/);
    expect(requestSignal?.aborted).toBe(true);
  });
});
