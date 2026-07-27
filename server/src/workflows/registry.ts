import type { WorkflowDefinition } from './types.js';

const registry = new Map<string, WorkflowDefinition[]>();

export function register(w: WorkflowDefinition): void {
  const list = registry.get(w.id) ?? [];
  list.push(w);
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
