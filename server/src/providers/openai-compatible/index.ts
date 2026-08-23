import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { createOpenAICompatibleClient } from './client.js';
import { expandOpenAICompatibleWorkflows } from './models.js';

/**
 * OpenAI 兼容 Provider 插件。
 *
 * 对接官方 OpenAI Images 及兼容中转：文生图走 /images/generations，
 * 图片编辑走 /images/edits。工作流列表由用户配置的模型 + 能力动态展开。
 *
 * 配置字段：
 * - baseUrl：API 基础地址（OPENAI_BASE_URL 环境变量兜底）
 * - apiKey：接口密钥（OPENAI_API_KEY 环境变量兜底；secret 脱敏，回显为空）
 * - timeout：单次生成请求超时（秒，默认 120）
 * - models：模型列表（component 字段，结构化数组，不进标量 schema）
 */
const definition: ProviderDefinition = {
  id: 'openai-compatible',
  name: 'OpenAI兼容',
  description: '对接 OpenAI Images 兼容接口，按配置的模型注册文生图 / 图片编辑工作流',
  configSchema: [
    {
      key: 'baseUrl',
      label: 'API 地址',
      type: 'string',
      required: true,
      placeholder: 'https://api.openai.com/v1',
      description: 'OpenAI 兼容 API 基础地址（含 /v1）',
      envVar: 'OPENAI_BASE_URL',
    },
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'sk-...',
      secret: true,
      description: 'OpenAI 兼容接口密钥',
      envVar: 'OPENAI_API_KEY',
    },
    {
      key: 'timeout',
      label: '请求超时（秒）',
      type: 'number',
      required: false,
      defaultValue: 120,
      description: '单次生成请求超时时间（秒）',
    },
    {
      key: 'models',
      label: '模型',
      type: 'component',
      component: 'OpenAICompatibleModelsEditor',
      required: false,
      defaultValue: [],
      description: '配置可用模型，并勾选每个模型支持文生图和/或图片编辑',
    },
  ],
  createClient: (config) => createOpenAICompatibleClient(config),
  listWorkflows: async (config) => expandOpenAICompatibleWorkflows(config.models),
  testConnection: async (config) => {
    const client = createOpenAICompatibleClient(config);
    return client.testConnection();
  },
};

registerProvider(definition);
