import { listInstances } from './config-store.js';
import { getProvider } from './registry.js';
import { getCandidatesByProvider, registerOrReplace, unregisterByInstance } from '../workflows/registry.js';
import type { ProviderInstance } from './types.js';

/** 并发同步串行化：重叠调用共享同一 promise */
let inflight: Promise<void> | null = null;

/** 同步单个静态实例的工作流（Bridge 实例由 bridge-sync 处理） */
export async function syncStaticInstance(instance: ProviderInstance): Promise<void> {
  const providerDef = getProvider(instance.type);
  if (!providerDef) return;
  const candidates = getCandidatesByProvider(instance.type);
  const enabled = new Set(instance.enabledWorkflows);
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

/** 同步单个实例（按类型分发：Bridge 走 bridge-sync，其余走静态同步） */
export async function syncInstance(instance: ProviderInstance): Promise<void> {
  if (instance.type === 'comfyui-bridge') {
    const { syncBridgeInstance } = await import('../workflows/bridge-sync.js');
    await syncBridgeInstance(instance);
  } else {
    await syncStaticInstance(instance);
  }
}

/** 同步全部实例（启动时 + 实例增删改后调用；并发安全） */
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