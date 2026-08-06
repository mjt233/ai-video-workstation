import type { ProviderDefinition } from './types.js';

/** 注册表：provider id → 插件定义 */
const registry = new Map<string, ProviderDefinition>();

/**
 * 注册一个 Provider 插件。
 * @param p Provider 插件定义
 */
export function registerProvider(p: ProviderDefinition): void {
  registry.set(p.id, p);
}

/**
 * 按 ID 获取 Provider 插件。
 * @param id provider id，如 comfyui-bridge
 * @returns 插件定义或 undefined
 */
export function getProvider(id: string): ProviderDefinition | undefined {
  return registry.get(id);
}

/** 获取全部已注册的 Provider 插件 */
export function getAllProviders(): ProviderDefinition[] {
  return [...registry.values()];
}
