import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  XIANYU_DISK_PROVIDER_ID,
  XIANYU_DISK_SCRIPT,
  validateXianyuDiskConfig,
} from './xianyu-disk.js';
import { getProvider } from '../registry.js';
import type { ResolvedProviderConfig } from '../types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * 构造咸鱼云网盘已解析配置。
 *
 * @param baseUrl 网盘地址
 * @returns 已解析配置
 */
function mkConfig(baseUrl: string): ResolvedProviderConfig {
  return { baseUrl } as ResolvedProviderConfig;
}

/**
 * 构造 JSON 响应桩。
 *
 * @param body 响应体对象
 * @param status HTTP 状态码
 * @returns Response
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('咸鱼云网盘 provider 定义', () => {
  it('注册为 file-relay 分类的「咸鱼云网盘」提供商，配置项只有 baseUrl', () => {
    const def = getProvider(XIANYU_DISK_PROVIDER_ID);
    if (!def) throw new Error('咸鱼云网盘 provider 未注册');
    expect(def.name).toBe('咸鱼云网盘');
    expect(def.category).toBe('file-relay');
    expect(def.description).toContain('快速分享');
    const fields = def.configSchema;
    expect(fields.map((f) => f.key)).toEqual(['baseUrl']);
    expect(fields[0].type).toBe('string');
    expect(fields[0].required).toBe(true);
    expect(fields[0].description).toContain('快速分享');
  });

  it('内置脚本是咸鱼云快速分享流程（upload → getByCode → getShareFile）', () => {
    expect(XIANYU_DISK_SCRIPT).toContain('export default async function (ctx: FileRelayContext)');
    expect(XIANYU_DISK_SCRIPT).toContain('/api/quickShare/upload');
    expect(XIANYU_DISK_SCRIPT).toContain('/api/quickShare/getByCode');
    expect(XIANYU_DISK_SCRIPT).toContain('/api/quickShare/getShareFile');
  });
});

describe('validateXianyuDiskConfig', () => {
  it('baseUrl 必填', () => {
    expect(validateXianyuDiskConfig({})).toEqual(['网盘地址不能为空']);
    expect(validateXianyuDiskConfig({ baseUrl: '   ' })).toEqual(['网盘地址不能为空']);
    expect(validateXianyuDiskConfig(null)).toEqual(['网盘地址不能为空']);
  });

  it('baseUrl 必须是合法 http(s) 地址', () => {
    expect(validateXianyuDiskConfig({ baseUrl: 'not-a-url' })[0]).toContain('合法的 URL');
    expect(validateXianyuDiskConfig({ baseUrl: 'ftp://disk.example.com' })[0]).toContain('http(s)');
  });

  it('合法地址通过（首尾空白忽略）', () => {
    expect(validateXianyuDiskConfig({ baseUrl: 'https://disk.example.com' })).toEqual([]);
    expect(validateXianyuDiskConfig({ baseUrl: '  https://disk.example.com  ' })).toEqual([]);
    expect(validateXianyuDiskConfig({ baseUrl: 'http://127.0.0.1:8080' })).toEqual([]);
  });
});

describe('咸鱼云网盘 testConnection', () => {
  it('上传成功：依次调用 upload / getByCode，返回成功提示', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ businessCode: 200, code: 200, data: '1234.5', msg: 'OK' }))
      .mockResolvedValueOnce(jsonResponse({ businessCode: 200, code: 200, data: { id: '42', fileName: 'file-relay-test.txt' }, msg: 'OK' }));
    vi.stubGlobal('fetch', fetchMock);

    const def = getProvider(XIANYU_DISK_PROVIDER_ID);
    if (!def) throw new Error('咸鱼云网盘 provider 未注册');
    const result = await def.testConnection(mkConfig('https://disk.example.com'));

    expect(result.ok).toBe(true);
    expect(result.message).toContain('测试上传成功');
    expect(result.message).toContain('disk.example.com');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const uploadUrl = String(fetchMock.mock.calls[0][0]);
    expect(uploadUrl.startsWith('https://disk.example.com/api/quickShare/upload?code=')).toBe(true);
    expect(uploadUrl.endsWith('&message=')).toBe(true);
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://disk.example.com/api/quickShare/getByCode?code=1234.5');
  });

  it('网盘地址使用非标准端口：成功提示附带端口告警', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: '1.1' }))
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: { id: '7' } }));
    vi.stubGlobal('fetch', fetchMock);

    const def = getProvider(XIANYU_DISK_PROVIDER_ID);
    if (!def) throw new Error('咸鱼云网盘 provider 未注册');
    const result = await def.testConnection(mkConfig('https://disk.example.com:344'));

    expect(result.ok).toBe(true);
    expect(result.message).toContain('非标准端口（344）');
  });

  it('上传接口返回 413：失败提示包含 HTTP 状态与原因', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      new Response('<html>413 Request Entity Too Large</html>', {
        status: 413,
        headers: { 'content-type': 'text/html' },
      }),
    ));

    const def = getProvider(XIANYU_DISK_PROVIDER_ID);
    if (!def) throw new Error('咸鱼云网盘 provider 未注册');
    const result = await def.testConnection(mkConfig('https://disk.example.com'));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('测试上传失败');
    expect(result.message).toContain('HTTP 413');
  });

  it('baseUrl 非法：不发起请求，直接返回配置校验失败', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const def = getProvider(XIANYU_DISK_PROVIDER_ID);
    if (!def) throw new Error('咸鱼云网盘 provider 未注册');
    const result = await def.testConnection(mkConfig(''));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('配置校验失败');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
