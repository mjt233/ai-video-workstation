/**
 * 文件中转服务商 Provider 插件（分类 `file-relay`）。
 *
 * 「文件中转」把项目内本地文件上传到公网可访问的存储并换取 URL，供需要公网地址的
 * 媒体输入使用（目前唯一使用方是 AI 文本生成节点的视频输入：`video_url` 只接受公网 URL）。
 *
 * 本服务商分类包含两个提供商类型：
 * - 「自定义脚本」（id `file-relay-script`）：用户编写脚本，脚本契约见 runtime.ts；
 * - 「咸鱼云网盘」（id `xianyu-disk`，见 xianyu-disk.ts）：内置咸鱼云快速分享上传脚本，只需填网盘地址。
 *
 * 两者共同约定：
 * - 不注册任何工作流：`listWorkflows` 恒为空，`createClient` 返回防御性 unsupported 客户端；
 * - 保存前做配置校验（自定义脚本编译脚本；咸鱼云校验网盘地址）；
 * - 连接测试用内置小测试文件**真实执行**一次上传并校验返回 http(s) URL。
 *
 * 多实例：运行时取第一个 `enabled !== false` 的实例（见 service.ts）。
 */
import { registerProvider } from '../registry.js';
import type { ProviderClient, ProviderDefinition, ResolvedProviderConfig } from '../types.js';
import { compileCustomCodeModule } from '../custom/runtime.js';
import './xianyu-disk.js';
import {
  DEFAULT_FILE_RELAY_TIMEOUT_SECONDS,
  createInMemoryFileRelayFile,
  fileRelayUrlHost,
  fileRelayUrlPortWarning,
  runFileRelayScript,
} from './runtime.js';

/** 文件中转「自定义脚本」提供商类型 id */
export const FILE_RELAY_SCRIPT_PROVIDER_ID = 'file-relay-script';

/** 内置测试文件大小（字节；约 1KB，真实上传验证脚本） */
const TEST_FILE_SIZE_BYTES = 1024;

/** 内置测试文件名（文本文件，MIME text/plain） */
const TEST_FILE_NAME = 'file-relay-test.txt';

/** 内置测试文件 MIME */
const TEST_FILE_MIME = 'text/plain';

/**
 * 构建内置测试文件字节（约 1KB，循环填充固定中文说明文字）。
 *
 * @returns 恰好 TEST_FILE_SIZE_BYTES 字节的测试内容
 */
function buildTestFileBytes(): Uint8Array {
  const seed = new TextEncoder().encode(
    'ai-video-workstation 文件中转连接测试文件：用于验证上传脚本真实可用，可安全删除。\n',
  );
  const bytes = new Uint8Array(TEST_FILE_SIZE_BYTES);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = seed[i % seed.length];
  return bytes;
}

/**
 * 校验文件中转配置（保存前调用，返回错误文案列表）。
 *
 * 校验内容：上传脚本非空且可编译（语法正确 + `export default` 一个函数）。
 * 这是「保存即失败」的关键闸门：避免保存后运行时才暴露脚本语法错误。
 *
 * @param raw 待保存的配置原始值
 * @returns 错误文案列表（空数组 = 校验通过）
 */
export function validateFileRelayConfig(raw: unknown): string[] {
  const errors: string[] = [];
  const rec = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const script = typeof rec.script === 'string' ? rec.script.trim() : '';
  if (!script) {
    errors.push('上传脚本不能为空');
    return errors;
  }
  try {
    compileCustomCodeModule({ code: script, label: '文件中转' });
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  return errors;
}

/**
 * 连接测试：用内置约 1KB 测试文件真实执行一次上传脚本。
 *
 * 注意：测试会产生一次真实上传；返回的 URL 只校验格式（http(s)），
 * 不代表目标 LLM 服务能访问该地址（如内网地址模型侧不可达）。
 *
 * @param config 已解析实例配置
 * @returns 测试结果（ok + 中文提示信息；失败不抛错）
 */
async function testConnection(config: ResolvedProviderConfig): Promise<{ ok: boolean; message: string }> {
  const errors = validateFileRelayConfig(config);
  if (errors.length > 0) {
    return { ok: false, message: '配置校验失败：\n' + errors.join('\n') };
  }
  const testFile = createInMemoryFileRelayFile({
    path: TEST_FILE_NAME,
    name: TEST_FILE_NAME,
    mimeType: TEST_FILE_MIME,
    bytes: buildTestFileBytes(),
  });
  try {
    const result = await runFileRelayScript(config, testFile);
    // 非标准端口提示：部分模型（如智谱视频输入）会拒绝抓取非 80/443 端口的 URL
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
 * 创建「不支持工作流执行」的客户端。
 *
 * 文件中转不参与工作流执行（不会被引擎调用），方法全部抛错仅作防御性实现。
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
 * 文件中转「自定义脚本」服务商定义。
 */
const definition: ProviderDefinition = {
  id: FILE_RELAY_SCRIPT_PROVIDER_ID,
  name: '自定义脚本',
  category: 'file-relay',
  description: '用 TypeScript 脚本把本地文件上传到公网存储并返回 URL（供 AI 文本节点的视频输入使用）',
  configSchema: [
    {
      key: 'enabled',
      label: '启用',
      type: 'boolean',
      required: false,
      defaultValue: true,
      description: '多个实例时取第一个启用的实例；关闭后不再作为中转实例被选用',
    },
    {
      key: 'baseUrl',
      label: 'API 地址',
      type: 'string',
      required: false,
      placeholder: 'https://upload.example.com',
      description: '中转服务基础地址（脚本中通过 ctx.providerConfig.baseUrl 读取）',
    },
    {
      key: 'publicBaseUrl',
      label: '公网访问地址',
      type: 'string',
      required: false,
      placeholder: 'https://cdn.example.com',
      description: '可选：用于拼接返回给模型的公网 URL；留空时使用 API 地址。适用于「上传走内网/非标准端口、公网走 443 反向代理」的场景',
    },
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: false,
      secret: true,
      placeholder: 'sk-...',
      description: '中转服务密钥（脚本中通过 ctx.providerConfig.apiKey 读取；敏感字段，保存后不回显）',
    },
    {
      key: 'timeout',
      label: '超时（秒）',
      type: 'number',
      required: false,
      defaultValue: DEFAULT_FILE_RELAY_TIMEOUT_SECONDS,
      description: '单次中转（脚本执行 + 上传）总超时，超时按失败处理',
    },
    {
      key: 'script',
      label: '上传脚本',
      type: 'component',
      component: 'FileRelayCodeEditorField',
      required: false,
      defaultValue: '',
      description: 'export default async function(ctx: FileRelayContext): Promise<FileRelayResult>，必须返回 http(s) 公网 URL',
    },
  ],
  createClient: () => createUnsupportedClient(),
  listWorkflows: async () => [],
  testConnection: (config) => testConnection(config),
};

registerProvider(definition);
