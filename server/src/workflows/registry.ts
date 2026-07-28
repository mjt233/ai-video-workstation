import type { WorkflowDefinition, WorkflowVarsBase } from './types.js';

/** 注册表擦除具体 TVars，统一按基类存储异构实现 */
const registry = new Map<string, WorkflowDefinition[]>();

export function register<TVars extends WorkflowVarsBase>(w: WorkflowDefinition<TVars>): void {
  const list = registry.get(w.id) ?? [];
  // 类型擦除：具体工作流的 TVars 在定义处保留，注册后按基类存储
  list.push(w as WorkflowDefinition);
  registry.set(w.id, list);
}

export function getImplementations(id: string): WorkflowDefinition[] {
  return registry.get(id) ?? [];
}

export function getImpl(id: string, impl: string): WorkflowDefinition | undefined {
  return registry.get(id)?.find(w => w.impl === impl);
}

export function getAllWorkflowIds(): string[] {
  return [...registry.keys()];
}

export function getAllWorkflows(): { id: string; name: string; implementations: { impl: string; name: string; description?: string }[] }[] {
  return [...registry.entries()].map(([id, impls]) => ({
    id,
    name: impls[0]?.name ?? id,
    implementations: impls.map(w => ({ impl: w.impl, name: w.name, description: w.description }))
  }));
}
