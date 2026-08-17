import { listInstances, updateInstance } from './config-store.js';
import { getProvider } from './registry.js';
import { getCandidatesByProvider, registerOrReplace, unregisterByInstance } from '../workflows/registry.js';
import type { ProviderInstance } from './types.js';

/** 并发同步串行化：重叠调用共享同一 promise */
let inflight: Promise<void> | null = null;

/**
 * 同步单个静态实例的工作流（Bridge 实例由 bridge-sync 处理）。
 *
 * 对实例类型下的候选定义，按 enabledWorkflows 求交集注册为可执行副本
 * （impl = {候选impl}-{实例id}，填充 providerInstanceId/providerName/workflowKey），
 * 再以 keepKeys 清理该实例下已禁用/消失的工作流注册。
 *
 * 空启用集合 = 默认全选：迁移/新建未显式指定时启用该类型全部候选工作流，
 * 并把展开后的列表持久化回实例（enabledWorkflows 变为显式，后续编辑可精确禁用）。
 *
 * @param instance 服务商实例
 */
export async function syncStaticInstance(instance: ProviderInstance): Promise<void> {
  const providerDef = getProvider(instance.type);
  if (!providerDef) return;
  const candidates = getCandidatesByProvider(instance.type);
  const enabled = new Set(instance.enabledWorkflows);
  // 空启用集合 = 默认全选：先展开为全部候选键并持久化，避免每次同步都视为「全选」
  if (enabled.size === 0 && candidates.length > 0) {
    for (const cand of candidates) enabled.add(`${cand.type}:${cand.impl}`);
    await updateInstance(instance.id, { enabledWorkflows: [...enabled] });
  }
  const keepKeys = new Set<string>();
  for (const cand of candidates) {
    const key = `${cand.type}:${cand.impl}`;
    if (!enabled.has(key)) continue;
    const impl = `${cand.impl}-${instance.id}`;
    registerOrReplace({
      ...cand,
      impl,
      providerInstanceId: instance.id,
      providerName: instance.name,
      workflowKey: key,
    });
    keepKeys.add(key);
  }
  unregisterByInstance(instance.id, keepKeys);
}

/**
 * 同步单个实例（按类型分发：Bridge 走 bridge-sync，其余走静态同步）。
 *
 * @param instance 服务商实例
 */
export async function syncInstance(instance: ProviderInstance): Promise<void> {
  if (instance.type === 'comfyui-bridge') {
    const { syncBridgeInstance } = await import('../workflows/bridge-sync.js');
    await syncBridgeInstance(instance);
  } else {
    await syncStaticInstance(instance);
  }
}

/**
 * 同步全部实例（启动时 + 实例增删改后调用；并发安全）。
 *
 * 重叠调用共享同一 in-flight promise，避免交错清理与重复注册；
 * 单个实例同步失败仅记录日志，不阻断其余实例。
 *
 * @returns 同步完成（无返回值；失败不抛出，仅记录日志）
 */
export function syncAllInstances(): Promise<void> {
  if (!inflight) {
    inflight = (async () => {
      const instances = await listInstances();
      for (const inst of instances) {
        try {
          await syncInstance(inst);
        } catch (e) {
          console.error(`[instance-sync] 实例 ${inst.name} 同步失败: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    })().finally(() => { inflight = null; });
  }
  return inflight;
}