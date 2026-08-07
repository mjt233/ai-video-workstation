import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { createVolcengineArkClient } from './client.js';

/**
 * 火山方舟 Provider 插件。
 *
 * 配置字段：
 * - baseUrl：API 基础地址（ARK_BASE_URL 环境变量兜底，默认 https://ark.cn-beijing.volces.com/api/v3）
 * - apiKey：方舟 API Key（ARK_API_KEY 环境变量兜底；secret 脱敏，回显为空）
 * - timeout：单次生成请求超时（秒，默认 900）
 */
const definition: ProviderDefinition = {
  id: 'volcengine-ark',
  name: '火山方舟',
  description: '火山方舟图片生成 API，支持 Seedream 5.0 pro/lite 文生图与图片编辑',
  configSchema: [
    {
      key: 'baseUrl',
      label: 'API 地址',
      type: 'string',
      required: false,
      defaultValue: 'https://ark.cn-beijing.volces.com/api/v3',
      placeholder: 'https://ark.cn-beijing.volces.com/api/v3',
      description: '方舟 API 基础地址',
      envVar: 'ARK_BASE_URL',
    },
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'ARK_API_KEY',
      secret: true,
      description: '火山方舟 API Key（控制台创建）',
      envVar: 'ARK_API_KEY',
    },
    {
      key: 'timeout',
      label: '请求超时（秒）',
      type: 'number',
      required: false,
      defaultValue: 900,
      description: '单次生成请求超时时间（秒）',
    },
  ],
  createClient: (config) => createVolcengineArkClient(config),
};

registerProvider(definition);
