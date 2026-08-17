import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { createComfyuiBridgeClient } from './client.js';

/**
 * ComfyUI Easy Bridge Provider 插件。
 *
 * 配置字段：
 * - baseUrl：服务地址（COMFYUI_BRIDGE_URL 环境变量兜底，默认 http://localhost:10721）
 * - password：访问密码（COMFYUI_BRIDGE_PASSWORD 环境变量兜底，默认 0d000721；secret 脱敏）
 * - autoRegisterTag：工作流自动注册标签 id（Bridge 工作流带该标签时自动注册为系统可调用工作流）
 */
const definition: ProviderDefinition = {
  id: 'comfyui-bridge',
  name: 'ComfyUI Easy Bridge',
  description: '本地 ComfyUI Easy Bridge 服务，支持文生图 / 图片编辑 / 图生视频 / TTS 等 ComfyUI 工作流',
  configSchema: [
    {
      key: 'baseUrl',
      label: '服务地址',
      type: 'string',
      required: false,
      defaultValue: 'http://localhost:10721',
      placeholder: 'http://localhost:10721',
      description: 'ComfyUI Easy Bridge 服务地址',
      envVar: 'COMFYUI_BRIDGE_URL',
    },
    {
      key: 'password',
      label: '访问密码',
      type: 'password',
      required: false,
      defaultValue: '0d000721',
      placeholder: '••••••••',
      secret: true,
      description: 'Bridge 登录密码（用于自动获取 token）',
      envVar: 'COMFYUI_BRIDGE_PASSWORD',
    },
    {
      key: 'autoRegisterTag',
      label: '工作流自动注册标签id',
      type: 'string',
      required: false,
      defaultValue: '',
      placeholder: '如 auto',
      description: 'Bridge 工作流带该标签时自动注册为系统可调用工作流；留空则尝试注册所有获取到的工作流',
    },
  ],
  createClient: (config) => createComfyuiBridgeClient(config),
  listWorkflows: async (config) => {
    const client = createComfyuiBridgeClient(config);
    const summaries = await client.listWorkflows();
    return summaries.map((s) => ({
      key: `ceb-${s.id}`,
      name: s.name || s.id,
      description: s.description,
    }));
  },
  testConnection: async (config) => {
    const client = createComfyuiBridgeClient(config);
    return client.testConnection();
  },
};

registerProvider(definition);
