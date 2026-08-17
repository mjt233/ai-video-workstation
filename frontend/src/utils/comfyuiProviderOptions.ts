import type { ComfyuiBridgeProviderInfo } from '../api/providers'

/** 「ComfyUI 提供商」下拉选项（value 为实例 ID，disabled 项不可选） */
export interface ComfyuiProviderOption {
  /** 选项值：实例 ID；空串表示「不指定」（Bridge 按 工作流配置 → 全局默认 解析） */
  value: string
  /** 展示文案 */
  label: string
  /** 是否禁用（禁用实例不能作为执行目标） */
  disabled: boolean
}

/** 默认选项：不显式指定提供商，交由 Easy Bridge 三级解析 */
export const DEFAULT_COMFYUI_PROVIDER_OPTION: ComfyuiProviderOption = {
  value: '',
  label: '默认（按 Easy Bridge 配置）',
  disabled: false,
}

/**
 * 构建「ComfyUI 提供商」下拉选项。
 *
 * 规则：
 * - 恒含默认项（空串 = 不指定，Bridge 自行解析「工作流配置 → 全局默认」），置于首位；
 * - 仅纳入启用的实例（enabled !== false），RunningHub 类型追加「RunningHub」后缀；
 * - currentId 非空且不在启用列表中（已禁用/已删除）时，追加为禁用项保证已保存值回显。
 *
 * @param providers Easy Bridge 提供商实例摘要（GET /api/comfyui-bridge/providers）
 * @param currentId 当前已保存/选中的实例 ID（可选，空串或缺失表示未选择）
 * @returns 下拉选项列表（默认项恒在首位）
 */
export function buildComfyuiProviderOptions(
  providers: ReadonlyArray<ComfyuiBridgeProviderInfo>,
  currentId?: string,
): ComfyuiProviderOption[] {
  const out: ComfyuiProviderOption[] = [{ ...DEFAULT_COMFYUI_PROVIDER_OPTION }]
  const enabledIds = new Set<string>()
  for (const p of providers) {
    if (p.enabled === false) continue
    enabledIds.add(p.id)
    out.push({
      value: p.id,
      label: p.type === 'runninghub' ? `${p.name}（RunningHub）` : p.name,
      disabled: false,
    })
  }
  const cur = (currentId ?? '').trim()
  if (cur !== '' && !enabledIds.has(cur)) {
    out.push({ value: cur, label: `${cur}（已禁用/不存在）`, disabled: true })
  }
  return out
}
