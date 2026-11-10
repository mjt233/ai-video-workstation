/**
 * 「咸鱼云网盘」文件中转服务商（内置上传脚本，只需填写网盘地址）。
 *
 * 与通用「自定义脚本」类型（`file-relay-script`）并列，同属 `file-relay` 分类：
 * - 内置咸鱼云网盘「快速分享」上传流程：上传文件 → 按文件码查询文件 id → 拼接分享文件 URL；
 * - 配置项只有「网盘地址 baseUrl」，无需编写脚本；
 * - 使用前需在咸鱼云网盘开启「快速分享」功能（配置页有提示）。
 *
 * 注意：模型服务会由服务端抓取返回的 URL，因此网盘地址应为**公网可访问的标准端口地址**
 * （80/443；智谱视频输入会拒绝非标准端口并报 1210），且网盘上传接口需允许视频体积
 * （nginx 默认 1MB 上传上限会导致 413）。
 */
import { registerProvider } from '../registry.js';
import type { ProviderClient, ProviderDefinition, ResolvedProviderConfig } from '../types.js';
import {
  createInMemoryFileRelayFile,
  fileRelayUrlHost,
  fileRelayUrlPortWarning,
  runFileRelayScript,
} from './runtime.js';

/** 咸鱼云网盘文件中转服务商类型 id */
export const XIANYU_DISK_PROVIDER_ID = 'xianyu-disk';

/** 咸鱼云网盘连接测试文件内容（小文本文件，真实走一次上传流程） */
const TEST_FILE_CONTENT = 'ai-video-workstation 咸鱼云网盘文件中转连接测试文件，可安全删除。\n';

/** 咸鱼云网盘连接测试文件名 */
const TEST_FILE_NAME = 'file-relay-test.txt';

/**
 * 内置上传脚本：咸鱼云网盘「快速分享」流程。
 *
 * 流程（与网盘 Web 端一致）：
 * 1. `POST {baseUrl}/api/quickShare/upload?code=<随机码>&message=`（multipart，字段名 file）→ 返回文件码；
 * 2. `GET {baseUrl}/api/quickShare/getByCode?code=<文件码>` → 返回文件信息（含 id）；
 * 3. 返回 `{baseUrl}/api/quickShare/getShareFile?id=<id>` 作为公网 URL。
 *
 * 脚本在服务端 node:vm 沙箱执行，`ctx.file` / `ctx.request` 契约见 runtime.ts。
 */
export const XIANYU_DISK_SCRIPT = `
export default async function (ctx: FileRelayContext): Promise<FileRelayResult> {
  // 归一化网盘地址（去掉末尾斜杠），避免拼接出 //api 路径
  const baseUrl = String(ctx.providerConfig.baseUrl || '').replace(/\\/+$/, '')
  if (!baseUrl) throw new Error('缺少网盘地址（baseUrl）')

  // 1) 上传文件（multipart）
  const fd = new FormData()
  fd.append('file', await ctx.file.toFile(), ctx.file.name)
  const randomCode = Math.random() * 10000 + ''
  const uploadRes = await ctx.request({
    url: baseUrl + '/api/quickShare/upload?code=' + randomCode + '&message=',
    method: 'post',
    data: fd,
  })
  // HTTP 状态校验：413（上传体积超限）/401/403 等在这里给出可读原因
  if (uploadRes.status < 200 || uploadRes.status >= 300) {
    const detail = typeof uploadRes.data === 'string'
      ? uploadRes.data.slice(0, 200)
      : JSON.stringify(uploadRes.data).slice(0, 200)
    throw new Error('上传失败：HTTP ' + uploadRes.status + ' ' + detail)
  }
  const code = (uploadRes.data as { data?: unknown })?.data
  if (typeof code !== 'string' || !code) throw new Error('无法从咸鱼云网盘获取文件码')

  // 2) 按文件码查询文件信息，取出文件 id
  const infoRes = await ctx.request({
    url: baseUrl + '/api/quickShare/getByCode?code=' + encodeURIComponent(code),
    method: 'get',
  })
  if (infoRes.status < 200 || infoRes.status >= 300) {
    throw new Error('查询文件信息失败：HTTP ' + infoRes.status)
  }
  const uploadId = (infoRes.data as { data?: { id?: unknown } })?.data?.id
  if (typeof uploadId !== 'string' || !uploadId) throw new Error('无法从咸鱼云网盘获取文件 id')

  // 3) 返回公网分享文件 URL（模型服务将直接抓取该地址）
  return { url: baseUrl + '/api/quickShare/getShareFile?id=' + encodeURIComponent(uploadId) }
}
`.trim();

/**
 * 校验咸鱼云网盘配置（保存前调用，返回错误文案列表）。
 *
 * 只有「网盘地址 baseUrl」一个配置项：必填且必须是合法的 http(s) 地址。
 *
 * @param raw 待保存的配置原始值
 * @returns 错误文案列表（空数组 = 校验通过）
 */
export function validateXianyuDiskConfig(raw: unknown): string[] {
  const rec = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const baseUrl = typeof rec.baseUrl === 'string' ? rec.baseUrl.trim() : '';
  if (!baseUrl) return ['网盘地址不能为空'];
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return ['网盘地址必须是合法的 URL（如 https://disk.example.com）'];
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return ['网盘地址必须是 http(s) 地址'];
  }
  return [];
}

/**
 * 创建「不支持工作流执行」的客户端（文件中转不参与工作流，防御性实现）。
 *
 * @returns 全部方法均抛错的 ProviderClient
 */
function createUnsupportedClient(): ProviderClient {
  const unsupported = (): never => {
    throw new Error('文件中转服务商不提供工作流执行能力');
  };
  return { execute: unsupported, poll: unsupported, getOutput: unsupported, cancel: unsupported };
}

/**
 * 连接测试：用内置小测试文件真实执行一次咸鱼云上传流程。
 *
 * 注意：会产生一次真实上传；返回 URL 只校验格式与端口提示，不代表模型侧可达。
 *
 * @param config 已解析实例配置（含 baseUrl）
 * @returns 测试结果（ok + 中文提示信息；失败不抛错）
 */
async function testConnection(config: ResolvedProviderConfig): Promise<{ ok: boolean; message: string }> {
  const errors = validateXianyuDiskConfig(config);
  if (errors.length > 0) {
    return { ok: false, message: '配置校验失败：\n' + errors.join('\n') };
  }
  const testFile = createInMemoryFileRelayFile({
    path: TEST_FILE_NAME,
    name: TEST_FILE_NAME,
    mimeType: 'text/plain',
    bytes: new TextEncoder().encode(TEST_FILE_CONTENT),
  });
  try {
    // 注入内置脚本（实例配置本身没有 script 字段）
    const result = await runFileRelayScript({ ...config, script: XIANYU_DISK_SCRIPT }, testFile);
    const portWarning = fileRelayUrlPortWarning(result.url);
    return {
      ok: true,
      message: '测试上传成功（返回地址主机：' + fileRelayUrlHost(result.url) + '）'
        + (portWarning ? '；注意：' + portWarning : ''),
    };
  } catch (e) {
    return { ok: false, message: '测试上传失败：' + (e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * 咸鱼云网盘文件中转服务商定义。
 */
const definition: ProviderDefinition = {
  id: XIANYU_DISK_PROVIDER_ID,
  name: '咸鱼云网盘',
  category: 'file-relay',
  description: '内置咸鱼云网盘快速分享上传脚本（需在网盘开启「快速分享」功能），只需填写网盘地址',
  configSchema: [
    {
      key: 'baseUrl',
      label: '网盘地址',
      type: 'string',
      required: true,
      placeholder: 'https://disk.example.com',
      description:
        '咸鱼云网盘的公网访问地址（如 https://disk.example.com）。使用前请先在网盘开启「快速分享」功能；'
        + '视频输入要求该地址使用标准端口 80/443（智谱等模型会拒绝非标准端口），且网盘上传接口需允许视频体积',
    },
  ],
  createClient: () => createUnsupportedClient(),
  listWorkflows: async () => [],
  testConnection: (config) => testConnection(config),
};

registerProvider(definition);
