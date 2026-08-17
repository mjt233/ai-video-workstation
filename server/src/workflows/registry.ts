import type { WorkflowCapabilities, WorkflowDefinition, WorkflowUserParamDeclaration, WorkflowVarsBase } from './types.js';

/** 注册表：工作流类型 → 该类型下的实现列表（擦除具体 TVars，统一按基类存储异构实现） */
const registry = new Map<string, WorkflowDefinition[]>();

/**
 * 判断是否为可执行定义（已绑定服务商实例）。
 *
 * 候选定义（仅声明 provider 类型、未绑定实例）不可执行，仅供 listWorkflows 枚举；
 * 实例同步器注册可执行副本时会填充 providerInstanceId。
 *
 * @param w 工作流定义
 * @returns 是否可执行（providerInstanceId 非空）
 */
function isRunnable(w: WorkflowDefinition): boolean {
  return !!w.providerInstanceId;
}

/**
 * 注册一个工作流实现，按工作流类型（w.type）归组。
 *
 * 无 providerInstanceId 的定义为候选定义（不可执行，供 listWorkflows 枚举）；
 * 带 providerInstanceId 的定义为可执行定义（进入 getImplementations / getImpl / getAllWorkflows）。
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
 * 替换语义注册：同 (type, impl) 先注销再注册，保证不重复。
 *
 * 用于实例同步器刷新可执行副本（重同步时更新 name/params/capabilities 等元数据）。
 *
 * @typeParam TVars - 业务变量类型
 * @param w 工作流实现定义
 */
export function registerOrReplace<TVars extends WorkflowVarsBase>(w: WorkflowDefinition<TVars>): void {
  unregister(w.type, w.impl);
  register(w);
}

/**
 * 获取某工作流类型下的可执行实现（仅含已绑定服务商实例的）。
 *
 * @param type 工作流类型，如 image-to-video
 * @returns 可执行实现列表（未注册类型或仅含候选定义时返回空数组）
 */
export function getImplementations(type: string): WorkflowDefinition[] {
  return (registry.get(type) ?? []).filter(isRunnable);
}

/**
 * 获取某 provider 类型下的候选定义（未绑定实例，供 listWorkflows 枚举）。
 *
 * 静态工作流（seedream / minimax-h3）以候选形式注册，实例同步器按实例注册可执行副本。
 *
 * @param providerType provider 插件 ID，如 volcengine-ark / minimax-h3
 * @returns 该 provider 类型下未绑定实例的工作流定义列表
 */
export function getCandidatesByProvider(providerType: string): WorkflowDefinition[] {
  const out: WorkflowDefinition[] = [];
  for (const list of registry.values()) {
    for (const w of list) {
      if (!isRunnable(w) && w.provider === providerType) out.push(w);
    }
  }
  return out;
}

/**
 * 按类型 + 实现标识获取可执行实现。
 *
 * @param type 工作流类型，如 image-to-video
 * @param impl 实现标识，如 ltx
 * @returns 可执行实现定义或 undefined（候选定义不可通过本函数获取）
 */
export function getImpl(type: string, impl: string): WorkflowDefinition | undefined {
  return (registry.get(type) ?? []).find((w) => w.impl === impl && isRunnable(w));
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
 * 注销某服务商实例的全部可执行工作流。
 *
 * 实例删除或工作流被禁用时调用；keepKeys 为需保留的工作流键集合（如实例仍启用的
 * 工作流键），用于交集清理——命中 keepKeys 的定义保留，其余该实例的定义被注销。
 *
 * @param instanceId 服务商实例 ID
 * @param keepKeys 需保留的工作流键集合（workflowKey 命中则保留）
 */
export function unregisterByInstance(instanceId: string, keepKeys: Set<string>): void {
  for (const [type, list] of [...registry.entries()]) {
    const next = list.filter((w) => {
      if (w.providerInstanceId !== instanceId) return true;
      return keepKeys.has(w.workflowKey ?? '');
    });
    if (next.length === 0) {
      registry.delete(type);
    } else {
      registry.set(type, next);
    }
  }
}

/**
 * 获取全部工作流类型及其可执行实现（/api/workflows 透传结构）。
 *
 * 顶层为工作流类型（type）；具体工作流的唯一 ID 是 implementations[].impl，
 * 阅读友好名称是 implementations[].name；每条携带 providerInstanceId / providerName
 * 供前端下拉展示「工作流名 [服务商名]」。候选定义（未绑定实例）不在此返回。
 */
export function getAllWorkflows(): {
  type: string;
  implementations: {
    impl: string;
    name: string;
    description?: string;
    /** 该实现使用的 Provider 插件 ID（引擎据此解析配置并创建传输客户端） */
    provider?: string;
    /** 服务商实例 ID（执行时引擎按实例解析配置） */
    providerInstanceId?: string;
    /** 服务商实例显示名（前端下拉展示） */
    providerName?: string;
    params?: WorkflowUserParamDeclaration[];
    /** 工作流能力声明（前端据此展示导演台等能力入口） */
    capabilities?: WorkflowCapabilities;
  }[];
}[] {
  return [...registry.entries()].map(([type, impls]) => ({
    type,
    implementations: impls.filter(isRunnable).map((w) => ({
      impl: w.impl,
      name: w.name,
      description: w.description,
      provider: w.provider,
      providerInstanceId: w.providerInstanceId,
      providerName: w.providerName,
      params: w.params,
      capabilities: w.capabilities,
    })),
  }));
}
