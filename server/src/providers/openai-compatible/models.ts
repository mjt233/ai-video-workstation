/**
 * OpenAI 兼容提供商的模型配置解析。
 *
 * 用户在实例配置里维护模型列表，每项可同时勾选文生图 / 图片编辑；
 * listWorkflows 与动态同步器共用本模块，保证展开规则一致。
 */

/** 模型可声明的能力（与系统工作流类型对齐） */
export type OpenAICompatibleCapability = 'text-to-image' | 'image-edit';

/** 用户配置的一条模型 */
export interface OpenAICompatibleModel {
  /** 对端模型 ID（原样提交给 OpenAI Images API 的 model 字段） */
  id: string;
  /** 该模型启用的能力；可同时包含文生图与图片编辑 */
  capabilities: OpenAICompatibleCapability[];
}

/** 清洗后的模型（id 已 trim，能力已去重） */
export interface ParsedOpenAICompatibleModel {
  /** 对端模型 ID */
  id: string;
  /** 用作工作流 impl / key 的安全标识（非法字符替换为 _） */
  safeId: string;
  /** 去重后的能力列表 */
  capabilities: OpenAICompatibleCapability[];
}

const CAPABILITIES = new Set<OpenAICompatibleCapability>(['text-to-image', 'image-edit']);

/**
 * 把模型 ID 压成工作流 impl / key 可用的安全标识。
 * 保留 `[A-Za-z0-9._-]`，其余替换为 `_`；空结果回退为 `model`。
 *
 * @param id 原始模型 ID
 * @returns 安全标识
 */
export function toSafeModelId(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || 'model';
}

/**
 * 从已解析配置中读取并清洗模型列表。
 *
 * 规则：非数组 → 空列表；id trim 后为空 → 丢弃；能力去重且两种都不勾 → 丢弃；
 * 同一 id 多次出现 → 合并能力。
 *
 * @param models 配置中的 models 字段（应为数组；其它类型视为空）
 * @returns 清洗后的模型列表（按首次出现顺序）
 */
export function parseOpenAICompatibleModels(models: unknown): ParsedOpenAICompatibleModel[] {
  if (!Array.isArray(models)) return [];
  const byId = new Map<string, ParsedOpenAICompatibleModel>();
  const order: string[] = [];
  for (const item of models) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as { id?: unknown; capabilities?: unknown };
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    if (!id) continue;
    const caps = new Set<OpenAICompatibleCapability>();
    if (Array.isArray(rec.capabilities)) {
      for (const c of rec.capabilities) {
        if (typeof c === 'string' && CAPABILITIES.has(c as OpenAICompatibleCapability)) {
          caps.add(c as OpenAICompatibleCapability);
        }
      }
    }
    if (caps.size === 0) continue;
    const existing = byId.get(id);
    if (existing) {
      const merged = new Set(existing.capabilities);
      for (const c of caps) merged.add(c);
      existing.capabilities = [...merged];
      continue;
    }
    byId.set(id, { id, safeId: toSafeModelId(id), capabilities: [...caps] });
    order.push(id);
  }
  return order.map((id) => byId.get(id)!);
}

/**
 * 按模型能力展开为工作流条目（供 listWorkflows 使用）。
 *
 * @param models 配置中的 models 字段
 * @returns 工作流条目（key 不含实例 id）
 */
export function expandOpenAICompatibleWorkflows(models: unknown): Array<{
  key: string;
  name: string;
  type: OpenAICompatibleCapability;
  description: string;
}> {
  const out: Array<{ key: string; name: string; type: OpenAICompatibleCapability; description: string }> = [];
  for (const m of parseOpenAICompatibleModels(models)) {
    if (m.capabilities.includes('text-to-image')) {
      out.push({
        key: `text-to-image:${m.safeId}`,
        name: `${m.id} 文生图`,
        type: 'text-to-image',
        description: `OpenAI 兼容文生图（模型 ${m.id}）`,
      });
    }
    if (m.capabilities.includes('image-edit')) {
      out.push({
        key: `image-edit:${m.safeId}`,
        name: `${m.id} 图片编辑`,
        type: 'image-edit',
        description: `OpenAI 兼容图片编辑（模型 ${m.id}）`,
      });
    }
  }
  return out;
}
