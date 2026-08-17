import { registerProvider } from '../registry.js';
import type { ProviderDefinition } from '../types.js';
import { getCandidatesByProvider } from '../../workflows/registry.js';
import { createMinimaxH3Client } from './client.js';

/**
 * MiniMax H3 Provider 插件。
 *
 * 对接 MiniMax 开放平台视频生成 V2 API（https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create），
 * 为图生视频（i2va）与多模态参考生视频（r2va）工作流提供传输能力：
 * 提交任务 / 轮询状态 / 获取输出 / 取消任务，输入素材经 /v1/files/upload 上传后以 mm_file:// 引用。
 *
 * 配置字段：
 * - apiKey：MiniMax 开放平台接口密钥（MINIMAX_API_KEY 环境变量兜底；secret 脱敏，回显为空）
 * - baseUrl：API 基础地址（MINIMAX_BASE_URL 环境变量兜底，默认 https://api.minimaxi.com）
 * - resolution：视频生成默认分辨率（768P / 2K，默认 2K）
 * - timeout：单次 HTTP 请求超时（秒，默认 300）
 */
const definition: ProviderDefinition = {
  id: 'minimax-h3',
  name: 'MiniMax H3',
  description: 'MiniMax H3 视频生成 V2 API：图生视频（I2VA）与多模态参考生视频（R2VA），2K/768P 直出',
  configSchema: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'MiniMax API Key',
      secret: true,
      description: 'MiniMax 开放平台接口密钥（控制台「账户管理 > 接口密钥」创建）',
      envVar: 'MINIMAX_API_KEY',
    },
    {
      key: 'baseUrl',
      label: 'API 地址',
      type: 'string',
      required: false,
      defaultValue: 'https://api.minimaxi.com',
      placeholder: 'https://api.minimaxi.com',
      description: 'MiniMax API 基础地址',
      envVar: 'MINIMAX_BASE_URL',
    },
    {
      key: 'resolution',
      label: '默认分辨率',
      type: 'select',
      required: false,
      defaultValue: '2K',
      options: [
        { label: '2K（更清晰）', value: '2K' },
        { label: '768P（更快更省）', value: '768P' },
      ],
      description: '视频生成默认分辨率（未显式指定时使用）',
    },
    {
      key: 'timeout',
      label: '请求超时（秒）',
      type: 'number',
      required: false,
      defaultValue: 300,
      description: '单次 HTTP 请求（创建/查询/取消/上传素材）超时时间（秒）',
    },
  ],
  createClient: (config) => createMinimaxH3Client(config),
  listWorkflows: async () => {
    // 静态服务商：查工作流注册表，返回 provider === minimax-h3 的候选定义
    const candidates = getCandidatesByProvider('minimax-h3');
    return candidates.map((c) => ({
      key: `${c.type}:${c.impl}`,
      name: c.name,
      type: c.type,
      description: c.description,
    }));
  },
  testConnection: async (config) => {
    const client = createMinimaxH3Client(config);
    return client.testConnection();
  },
};

registerProvider(definition);
