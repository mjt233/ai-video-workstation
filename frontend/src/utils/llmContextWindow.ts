/**
 * LLM 上下文窗口解析/格式化工具（与服务端 server/src/llm/protocol.ts 同规则）。
 *
 * 配置接受三种形式：纯数字（128000）、K（128K）、M（1M，支持小数如 1.5M）；
 * 展示优先使用 K / M。
 */

/**
 * 解析上下文窗口输入为 token 数。
 * @param raw 用户输入字符串
 * @returns token 数；非法输入返回 null
 */
export function parseContextWindow(raw: string): number | null {
  const m = /^\s*(\d+)(?:\.(\d+))?\s*([kKmM])?\s*$/.exec(raw)
  if (!m) return null
  const base = Number(m[1] + (m[2] ? `.${m[2]}` : ''))
  if (!Number.isFinite(base)) return null
  const unit = (m[3] ?? '') as '' | 'k' | 'K' | 'm' | 'M'
  const n = unit === '' ? base : unit === 'k' || unit === 'K' ? base * 1e3 : base * 1e6
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

/**
 * 上下文窗口展示格式化：优先 K / M（≥1M 用 M、≥1000 用 K，整数倍不带小数，
 * 其余保留 1 位小数；小于 1000 原样数字）。
 *
 * @param value 原始值（数字或 '128000' / '128K' / '1M' 等）
 * @returns 展示字符串；非法输入原样返回
 */
export function formatContextWindow(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const n = typeof value === 'number' ? value : parseContextWindow(String(value))
  if (n === null) return String(value)
  if (n >= 1e6) {
    if (n % 1e6 === 0) return `${n / 1e6}M`
    return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  }
  if (n >= 1e3) {
    if (n % 1e3 === 0) return `${n / 1e3}K`
    return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  }
  return String(n)
}

/**
 * 校验上下文窗口输入是否合法（合法格式：空串或数字/K/M）。
 * @param raw 输入字符串
 * @returns 合法返回 true
 */
export function isValidContextWindow(raw: string): boolean {
  if (!raw.trim()) return true
  return parseContextWindow(raw) !== null
}
