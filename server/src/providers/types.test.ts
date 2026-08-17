import { describe, expect, it } from 'vitest';
import type { ProviderInstance, ProviderWorkflowEntry } from './types.js';

/**
 * Provider 类型定义（多实例扩展）编译期测试。
 *
 * 本测试通过类型标注引用新增的 `ProviderInstance` / `ProviderWorkflowEntry`，
 * 若类型未定义则 `npm run typecheck` 报错（编译期失败），
 * 定义后类型检查通过，同时运行时断言结构字段符合预期。
 */
describe('Provider 类型定义（多实例扩展）', () => {
  it('ProviderInstance 可被引用并符合结构', () => {
    const instance: ProviderInstance = {
      id: 'inst-abc123',
      type: 'volcengine-ark',
      name: '火山方舟-主账号',
      config: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: 'secret' },
      enabledWorkflows: ['text-to-image:seedream', 'image-edit:seedream'],
    };
    expect(instance.id).toBe('inst-abc123');
    expect(instance.type).toBe('volcengine-ark');
    expect(instance.name).toBe('火山方舟-主账号');
    expect(instance.config.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/v3');
    expect(instance.enabledWorkflows).toHaveLength(2);
  });

  it('ProviderWorkflowEntry 可被引用并符合结构', () => {
    const entry: ProviderWorkflowEntry = {
      key: 'text-to-image:seedream',
      name: 'Seedream 文生图',
      type: 'text-to-image',
      description: '火山方舟 Seedream 5.0 文生图',
    };
    expect(entry.key).toBe('text-to-image:seedream');
    expect(entry.name).toBe('Seedream 文生图');
    expect(entry.type).toBe('text-to-image');
    expect(entry.description).toBe('火山方舟 Seedream 5.0 文生图');
  });

  it('ProviderWorkflowEntry 的 type / description 为可选字段', () => {
    const entry: ProviderWorkflowEntry = {
      key: 'ceb-文生图工作流',
      name: '文生图工作流',
    };
    expect(entry.type).toBeUndefined();
    expect(entry.description).toBeUndefined();
  });
});