/**
 * 自定义服务商 Provider 插件。
 *
 * 用户自写 TypeScript 代码对接任意工作流接口：
 * - 通用代码块（commonCode）：导出的函数可在工作流代码中直接全局调用；
 * - 测试代码（testCode）：export default(ctx) 执行连接测试，留空默认测试通过；
 * - 工作流配置（workflows）：名称 / 类型（多选）/ 是否异步 / 是否可取消 / 三段代码
 *   （调用发起、结果提取、取消调用）。
 *
 * 配置支持导入/导出（由前端实现 JSON 文件导出与回填）。
 */
import { registerProvider } from '../registry.js';
import type { ProviderDefinition, ProviderWorkflowEntry, ResolvedProviderConfig } from '../types.js';
import { createCustomProviderClient, DEFAULT_CUSTOM_TIMEOUT_SECONDS } from './client.js';
import { buildWorkflowCallContext, compileCustomCodeModule } from './runtime.js';
import { parseCustomWorkflows, type CustomWorkflowEntry } from './types.js';

/** 自定义服务商 Provider 插件 id */
export const CUSTOM_PROVIDER_ID = 'custom';

/**
 * 校验自定义服务商配置（保存前调用，返回错误文案列表）。
 *
 * 校验内容：工作流配置结构（parseCustomWorkflows）与各段代码可编译
 * （语法 + export default 函数）。空代码段跳过编译校验（执行时才报错）。
 *
 * @param raw 待保存的配置原始值
 * @returns 错误文案列表（空数组 = 校验通过）
 */
export function validateCustomProviderConfig(raw: unknown): string[] {
  const errors: string[] = [];
  const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  try {
    parseCustomWorkflows(rec.workflows);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  const commonCode = typeof rec.commonCode === 'string' ? rec.commonCode : '';
  let entries: CustomWorkflowEntry[] = [];
  try {
    entries = parseCustomWorkflows(rec.workflows);
  } catch {
    // 结构错误已在上方收集进 errors，这里回退空数组以便继续校验各段代码
    entries = [];
  }
  const codeKinds = [
    { key: 'callCode', label: '调用发起' },
    { key: 'extractCode', label: '结果提取' },
    { key: 'cancelCode', label: '取消调用' },
  ] as const;
  for (const entry of entries) {
    for (const kind of codeKinds) {
      const code = entry[kind.key];
      if (!code.trim()) continue;
      try {
        compileCustomCodeModule({ commonCode, code, label: entry.name + '-' + kind.label });
      } catch (e) {
        errors.push('工作流「' + entry.name + '」' + kind.label + ': ' + (e instanceof Error ? e.message : String(e)));
      }
    }
  }
  return errors;
}

/**
 * 连接测试：无测试代码时默认通过；否则编译并执行 testCode 的 default(ctx)。
 *
 * 返回值约定：boolean，或 { ok: boolean; message?: string }；其余按真值判定。
 *
 * @param config 已解析实例配置
 * @returns 测试结果（ok + 提示信息）
 */
async function testConnection(config: ResolvedProviderConfig): Promise<{ ok: boolean; message: string }> {
  const raw = config as unknown as Record<string, unknown>;
  const errors = validateCustomProviderConfig(raw);
  if (errors.length > 0) {
    return { ok: false, message: '配置校验失败：\n' + errors.join('\n') };
  }
  const testCode = typeof raw.testCode === 'string' ? raw.testCode.trim() : '';
  if (!testCode) {
    return { ok: true, message: '未配置测试代码，默认测试通过' };
  }
  try {
    const module = compileCustomCodeModule({
      commonCode: typeof raw.commonCode === 'string' ? raw.commonCode : '',
      code: testCode,
      label: '测试',
    });
    const ctx = buildWorkflowCallContext({ providerConfig: raw, params: {} });
    const result = await module.defaultFn(ctx);
    if (result && typeof result === 'object' && 'ok' in (result as object)) {
      const rec = result as { ok?: unknown; message?: unknown };
      const ok = rec.ok === true;
      const message = typeof rec.message === 'string' && rec.message !== ''
        ? rec.message
        : (ok ? '测试通过' : '测试未通过');
      return { ok, message };
    }
    return { ok: !!result, message: result ? '测试通过' : '测试未通过' };
  } catch (e) {
    return { ok: false, message: '测试代码执行失败: ' + (e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * 列出配置中的自定义工作流（按「条目 × 类型」展开，供实例对话框预览）。
 *
 * @param config 已解析实例配置
 * @returns 工作流条目列表
 */
async function listCustomWorkflows(config: ResolvedProviderConfig): Promise<ProviderWorkflowEntry[]> {
  const entries = parseCustomWorkflows(config.workflows);
  const out: ProviderWorkflowEntry[] = [];
  for (const e of entries) {
    for (const type of e.types) {
      out.push({
        key: CUSTOM_PROVIDER_ID + ':' + e.name + ':' + type,
        name: e.name,
        type,
        description: '自定义工作流（' + (e.async ? '异步' : '同步') + (e.cancelable ? '，可取消' : '') + '）',
      });
    }
  }
  return out;
}

/**
 * 自定义服务商插件定义。
 */
const definition: ProviderDefinition = {
  id: CUSTOM_PROVIDER_ID,
  name: '自定义服务商',
  description: '用户自写 TypeScript 代码对接任意工作流接口（调用发起 / 结果提取 / 取消）',
  configSchema: [
    {
      key: 'baseUrl',
      label: 'API 地址',
      type: 'string',
      required: false,
      placeholder: 'https://api.example.com',
      description: '自定义接口基础地址（代码中通过 ctx.providerConfig.baseUrl 读取）',
    },
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: false,
      secret: true,
      placeholder: 'sk-...',
      description: '接口密钥（代码中通过 ctx.providerConfig.apiKey 读取）',
    },
    {
      key: 'timeout',
      label: '异步轮询超时（秒）',
      type: 'number',
      required: false,
      defaultValue: DEFAULT_CUSTOM_TIMEOUT_SECONDS,
      description: '异步工作流：结果提取连续报错或总耗时超过该时长即判定失败',
    },
    {
      key: 'commonCode',
      label: '通用代码块',
      type: 'component',
      component: 'CustomCodeEditorField',
      required: false,
      defaultValue: '',
      description: '导出的函数（如 getBaseCallConfig）可在各工作流代码中直接全局调用',
    },
    {
      key: 'testCode',
      label: '测试代码',
      type: 'component',
      component: 'CustomCodeEditorField',
      required: false,
      defaultValue: '',
      description: 'export default(ctx) 执行连接测试；留空默认测试通过',
    },
    {
      key: 'workflows',
      label: '工作流配置',
      type: 'component',
      component: 'CustomWorkflowsEditorField',
      required: false,
      defaultValue: [],
      description: '配置可执行的自定义工作流（名称 / 类型 / 异步 / 取消 / 代码）',
    },
  ],
  createClient: (config) => createCustomProviderClient(config),
  listWorkflows: (config) => listCustomWorkflows(config),
  testConnection: (config) => testConnection(config),
};

registerProvider(definition);
