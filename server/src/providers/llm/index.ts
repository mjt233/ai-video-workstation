/**
 * 大语言模型 Provider 插件。
 *
 * 分类为 llm（媒体生成服务商使用默认的 media 分类），配置表单驱动：
 * - protocol：协议类型（OpenAI Chat Completions / OpenAI Responses API / Anthropic / Grok / Gemini）
 * - baseUrl：BaseURL（可空，按协议回退官方默认地址）
 * - apiKey：API Key（secret 脱敏）
 * - models：模型列表（component 字段，含元信息：上下文窗口/输入模态/思考强度/tool call）
 *
 * 本服务商不注册工作流（listWorkflows 恒为空）；对话调用走 /api/llm/chat（SSE）。
 * testConnection 优先使用免费模型列表接口，不可用时回退最小对话请求（可能产生少量费用）。
 */
import { registerProvider } from '../registry.js';
import type { ProviderClient, ProviderDefinition, ResolvedProviderConfig } from '../types.js';
import { LLM_PROTOCOLS, isLlmProtocol, resolveBaseUrl } from '../../llm/protocol.js';
import { testLlmConnection } from '../../llm/model-catalog.js';

/** LLM 服务商 id */
export const LLM_PROVIDER_ID = 'llm';

/** 从模型列表中取第一个已配置模型 id（连接测试回退用） */
function firstConfiguredModel(config: ResolvedProviderConfig): string | undefined {
  const models = config.models;
  if (!Array.isArray(models)) return undefined;
  const first = models.find(
    (m): m is { modelId?: unknown } => !!m && typeof m === 'object' && typeof (m as { modelId?: unknown }).modelId === 'string',
  );
  const id = first?.modelId;
  return typeof id === 'string' && id ? id : undefined;
}

/** LLM 服务商不参与工作流执行：客户端方法全部抛错（不会被调用，防御性实现） */
function createUnsupportedClient(): ProviderClient {
  const unsupported = (): never => {
    throw new Error('大语言模型服务商不提供工作流执行能力');
  };
  return { execute: unsupported, poll: unsupported, getOutput: unsupported, cancel: unsupported };
}

const definition: ProviderDefinition = {
  id: LLM_PROVIDER_ID,
  name: '大语言模型',
  category: 'llm',
  description: '配置大语言模型服务商（协议/BaseURL/API Key/模型列表），供「AI文本生成」节点调用',
  configSchema: [
    {
      key: 'protocol',
      label: '协议类型',
      type: 'select',
      required: true,
      options: LLM_PROTOCOLS.map((p) => ({ label: p.label, value: p.id })),
      description: '决定模型列表接口与对话请求的协议格式',
    },
    {
      key: 'baseUrl',
      label: 'BaseURL',
      type: 'string',
      required: false,
      placeholder: 'https://api.openai.com/v1',
      description: 'API 基础地址；留空使用所选协议的官方默认地址',
    },
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      secret: true,
      placeholder: 'sk-...',
      description: '接口调用密钥（敏感字段，保存后不回显）',
    },
    {
      key: 'models',
      label: '模型列表',
      type: 'component',
      component: 'LlmModelsEditor',
      required: false,
      defaultValue: [],
      description: '配置可用模型：模型 id、显示名称与元信息（上下文/模态/思考强度/tool call）',
    },
  ],
  createClient: () => createUnsupportedClient(),
  listWorkflows: async () => [],
  testConnection: async (config) => {
    const protocol = typeof config.protocol === 'string' ? config.protocol : '';
    if (!isLlmProtocol(protocol)) return { ok: false, message: `未知协议类型: ${protocol || '(未配置)'}` };
    const baseUrl = resolveBaseUrl(protocol, config.baseUrl);
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey : '';
    if (!apiKey) return { ok: false, message: '请先填写 API Key' };
    return testLlmConnection({ protocol, baseUrl, apiKey }, firstConfiguredModel(config));
  },
};

registerProvider(definition);
