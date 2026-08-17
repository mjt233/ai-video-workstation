import type { WorkflowCapabilities, WorkflowDefinition, WorkflowUserParamDeclaration, WorkflowVarsBase } from './types.js';

/** 注册表：工作流类型 → 该类型下的实现列表（擦除具体 TVars，统一按基类存储异构实现） */
const registry = new Map<string, WorkflowDefinition[]>();

/**
 * 注册一个工作流实现，按工作流类型（w.type）归组。
 *
 * @typeParam TVars - 业务变量类型（定义处保留，注册后按基类存储）
 * @param w 工作流实现定义
 */
export function register<TVars extends WorkflowVarsBase>(w: WorkflowDefinition<TVars>): void {
  const list = registry.get(w.type) ?? [];
  // 类型擦除：具体工作流的 TVars 在定义处保留，注册后按基类存储
  list.push(w as WorkflowDefinition);
  registry.set(w.type, list);
}

/**
 * 获取某工作流类型下的全部实现。
 *
 * @param type 工作流类型，如 image-to-video
 * @returns 实现列表（未注册类型返回空数组）
 */
export function getImplementations(type: string): WorkflowDefinition[] {
  return registry.get(type) ?? [];
}

/**
 * 获取某 provider 类型下的候选工作流定义（供 listWorkflows 枚举）。
 *
 * 当前阶段所有注册定义均为候选（尚未绑定服务商实例）；Task 5 将区分候选与可执行定义。
 *
 * @param providerType provider 插件 ID，如 volcengine-ark / minimax-h3
 * @returns 该 provider 类型下已注册的工作流定义列表
 */
export function getCandidatesByProvider(providerType: string): WorkflowDefinition[] {
  const out: WorkflowDefinition[] = [];
  for (const list of registry.values()) {
    for (const w of list) {
      if (w.provider === providerType) out.push(w);
    }
  }
  return out;
}

/**
 * 按类型 + 实现标识获取实现。
 *
 * @param type 工作流类型，如 image-to-video
 * @param impl 实现标识，如 ltx
 * @returns 实现定义或 undefined
 */
export function getImpl(type: string, impl: string): WorkflowDefinition | undefined {
  return registry.get(type)?.find(w => w.impl === impl);
}

/** 获取全部已注册的工作流类型 */
export function getAllWorkflowTypes(): string[] {
  return [...registry.keys()];
}

/**
 * 注销一个工作流实现（动态重同步时清理陈旧注册）。
 *
 * @param type 工作流类型
 * @param impl 实现标识；不存在时静默忽略
 */
export function unregister(type: string, impl: string): void {
  const list = registry.get(type);
  if (!list) return;
  const next = list.filter((w) => w.impl !== impl);
  if (next.length === 0) {
    registry.delete(type);
  } else {
    registry.set(type, next);
  }
}

/**
 * 获取全部工作流类型及其实现（/api/workflows 透传结构）。
 *
 * 顶层为工作流类型（type）；具体工作流的唯一 ID 是 implementations[].impl，
 * 阅读友好名称是 implementations[].name。
 */
export function getAllWorkflows(): {
  type: string;
  implementations: {
    impl: string;
    name: string;
    description?: string;
    /** 该实现使用的 Provider 插件 ID（引擎据此解析配置并创建传输客户端） */
    provider?: string;
    params?: WorkflowUserParamDeclaration[];
    /** 工作流能力声明（前端据此展示导演台等能力入口） */
    capabilities?: WorkflowCapabilities;
  }[];
}[] {
  return [...registry.entries()].map(([type, impls]) => ({
    type,
    implementations: impls.map(w => ({
      impl: w.impl,
      name: w.name,
      description: w.description,
      provider: w.provider,
      params: w.params,
      capabilities: w.capabilities,
    }))
  }));
}
