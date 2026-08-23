import { listInstances } from './config-store.js';
import { getProvider } from './registry.js';
import { getCandidatesByProvider, registerOrReplace, unregisterByInstance } from '../workflows/registry.js';
import type { ProviderInstance } from './types.js';

/** 并发同步串行化：重叠调用共享同一 promise */
let inflight: Promise<void> | null = null;

/**
 * 同步单个静态实例的工作流（Bridge 实例由 bridge-sync 处理）。
 *
 * 默认全量可用：该实例类型下的全部候选工作流均注册为可执行副本
 * （impl = {候选impl}-{实例id}，填充 providerInstanceId/providerName/workflowKey），
 * 再以 keepKeys（= 本次全部候选键）清理该实例下已消失的工作流注册。
 *
 * @param instance 服务商实例
 */
export async function syncStaticInstance(instance: ProviderInstance): Promise<void> {
  const providerDef = getProvider(instance.type);
  if (!providerDef) return;
  const candidates = getCandidatesByProvider(instance.type);
  const keepKeys = new Set<string>();
  for (const cand of candidates) {
    const key = `${cand.type}:${cand.impl}`;
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
 * 同步单个实例（按类型分发：Bridge / OpenAI 兼容 / 自定义走动态同步，其余走静态同步）。
 *
 * @param instance 服务商实例
 */
export async function syncInstance(instance: ProviderInstance): Promise<void> {
  if (instance.type === 'comfyui-bridge') {
    const { syncBridgeInstance } = await import('../workflows/bridge-sync.js');
    await syncBridgeInstance(instance);
  } else if (instance.type === 'openai-compatible') {
    const { syncOpenAICompatibleInstance } = await import('../workflows/openai-compatible-sync.js');
    await syncOpenAICompatibleInstance(instance);
  } else if (instance.type === 'custom') {
    const { syncCustomInstance } = await import('./custom/sync.js');
    await syncCustomInstance(instance);
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