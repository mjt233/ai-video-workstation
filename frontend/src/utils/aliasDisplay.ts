/**
 * 集数/分镜别名的显示规则工具（资产浏览器树与新建/移动分镜对话框共用）。
 *
 * 显示规则（与 metadata.json 的 showPrefix 一致）：
 * - 有别名且 showPrefix=true：「第3集 · 觉醒」/「分镜2 · 初遇」
 * - 有别名且 showPrefix=false：仅显示「觉醒」/「初遇」
 * - 无别名：「第3集」/「分镜2」（恒带编号，避免别名重复造成歧义）
 */
import type { AliasMeta, BrowserMeta } from '../api/assets'

/**
 * 集数显示名（带别名）。
 * @param meta 浏览器元数据（null = 无别名信息）
 * @param episode 集数号
 * @returns 显示名
 */
export function epDisplay(meta: BrowserMeta | null, episode: string): string {
  const info = meta?.episodes[episode]
  if (!info) return `第${episode}集`
  return info.showPrefix ? `第${episode}集 · ${info.alias}` : info.alias
}

/**
 * 分镜显示名（带别名）。
 * @param meta 浏览器元数据（null = 无别名信息）
 * @param episode 集数号
 * @param shot 分镜号
 * @returns 显示名
 */
export function shotDisplay(meta: BrowserMeta | null, episode: string, shot: string): string {
  const info = meta?.shots[episode]?.[shot]
  if (!info) return `分镜${shot}`
  return info.showPrefix ? `分镜${shot} · ${info.alias}` : info.alias
}

/**
 * 集数完整名（删除确认等提示文案）：恒带编号，避免别名重复造成歧义。
 * @param meta 浏览器元数据（null = 无别名信息）
 * @param episode 集数号
 * @returns 完整名
 */
export function epFull(meta: BrowserMeta | null, episode: string): string {
  const alias = meta?.episodes[episode]?.alias
  return alias ? `第${episode}集 · ${alias}` : `第${episode}集`
}

/**
 * 分镜完整名（删除确认等提示文案）：恒带编号。
 * @param meta 浏览器元数据（null = 无别名信息）
 * @param episode 集数号
 * @param shot 分镜号
 * @returns 完整名
 */
export function shotFull(meta: BrowserMeta | null, episode: string, shot: string): string {
  const alias = meta?.shots[episode]?.[shot]?.alias
  return alias ? `分镜${shot} · ${alias}` : `分镜${shot}`
}

/**
 * 从别名元数据构造下拉选项文案（与树节点显示规则一致）。
 * @param meta 别名元数据（可空）
 * @param label 无别名时的默认文案（如「分镜3」）
 * @returns 下拉选项显示文案
 */
export function aliasOptionLabel(meta: AliasMeta | null | undefined, label: string): string {
  if (!meta) return label
  return meta.showPrefix ? `${label} · ${meta.alias}` : meta.alias
}
