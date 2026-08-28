/**
 * 工作流用户参数下拉候选项工具：候选项规范化、多选值拼接/拆分。
 *
 * 供运行表单（WorkflowParamsForm）与自定义服务商编辑器（custom-provider.ts）共用：
 * - 候选项结构与服务端 WorkflowUserParamCandidate / Bridge candidates 对齐（label 展示、value 提交）；
 * - 多选值以英文逗号 "," 拼接为一个字符串提交（与 Bridge 多选语义一致），拆分时反向还原。
 */
import type { WorkflowUserParamCandidate } from '../api/workflow'

/** 候选项原始元素的最小结构（允许部分字段缺失，由规范化兜底） */
export interface RawCandidate {
  label?: unknown
  value?: unknown
}

/**
 * 规范化候选项数组：过滤非法项（非对象 / value 为空串），label 缺省回退 value，
 * label 与 value 均去除首尾空白，保持声明顺序。
 *
 * @param raw 原始候选项（可为 undefined / 非数组，容错返回空数组）
 * @returns 规范化后的候选项数组（可能为空 = 未配置有效候选项）
 */
export function normalizeCandidates(raw: unknown): WorkflowUserParamCandidate[] {
  if (!Array.isArray(raw)) return []
  const out: WorkflowUserParamCandidate[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as RawCandidate
    const value = typeof rec.value === 'string' ? rec.value.trim() : ''
    if (!value) continue
    const label = typeof rec.label === 'string' && rec.label.trim() !== '' ? rec.label.trim() : value
    out.push({ label, value })
  }
  return out
}

/**
 * 判断参数声明是否按下拉控件渲染：仅 string 类型且存在有效候选项（value 非空）。
 *
 * @param d 参数声明（至少含 type 与 candidates）
 * @returns true = 渲染下拉；false = 按普通文本框等默认控件渲染
 */
export function hasCandidates(d: {
  type?: string
  candidates?: WorkflowUserParamCandidate[]
}): boolean {
  return d.type === 'string' && normalizeCandidates(d.candidates).length > 0
}

/**
 * 判断下拉字段是否允许自由输入候选项之外的值（allowCustom 未声明默认允许）。
 *
 * @param d 参数声明（至少含 allowCustom）
 * @returns true = 允许自由输入（combobox）；false = 严格下拉（select）
 */
export function allowCustomInput(d: { allowCustom?: boolean }): boolean {
  return d.allowCustom !== false
}

/**
 * 把多选拼接串拆分为值数组：按英文逗号 "," 分段，去首尾空白，过滤空段。
 *
 * @param raw 逗号拼接串（如 "realism,anime"；null/undefined 视为未选择）
 * @returns 值数组（未选择时为空数组）
 */
export function splitMultiValue(raw: string | null | undefined): string[] {
  if (raw == null || raw === '') return []
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

/**
 * 把选中的值数组用英文逗号 "," 拼接为一个提交字符串（去首尾空白、过滤空值并去重）。
 *
 * @param values 选中的值数组（combobox 自由输入项也原样拼接）
 * @returns 逗号拼接串（全空时为空串 = 不提交）
 */
export function joinMultiValue(values: ReadonlyArray<unknown>): string {
  const list: string[] = []
  for (const v of values ?? []) {
    const s = String(v ?? '').trim()
    if (s !== '' && !list.includes(s)) list.push(s)
  }
  return list.join(',')
}

/**
 * 从下拉控件（v-combobox）的更新值中提取提交值字符串。
 *
 * v-combobox 默认 returnObject：选中候选项时更新值为原始候选对象（{label, value}），
 * 自由输入时为字符串；对象缺少 value 时回退 label，兼容 { raw } 包装结构
 * （raw 可为候选对象或字符串），null/undefined（清空）返回空串（= 不提交）。
 *
 * @param v 下拉更新值（候选对象 / 字符串 / { raw } 包装 / null）
 * @returns 提交值字符串
 */
export function candidateSubmitValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v !== 'object') return String(v)
  const rec = v as { raw?: unknown; value?: unknown; label?: unknown }
  const obj = 'raw' in rec && rec.raw != null ? rec.raw : v
  if (typeof obj !== 'object') return String(obj)
  const val = (obj as Record<string, unknown>).value ?? (obj as Record<string, unknown>).label
  return val == null ? '' : String(val)
}

/**
 * 清洗下拉字段的历史脏值（早期版本把选中的候选对象直接写进表单值并持久化，
 * 产生对象值或 "[object Object]" 字符串——单值或逗号拼接段中出现）。
 *
 * @param v 已存的字段值（任意形态）
 * @param multiple 是否多选字段（多选按逗号分段逐段清洗后重新拼接）
 * @returns 清洗后的字符串；无法还原（全为脏段/对象）时返回 null（调用方回退声明默认值）
 */
export function cleanCandidateSavedValue(v: unknown, multiple = false): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'object') return null
  const s = String(v)
  if (!multiple) return s === '[object Object]' ? null : s
  const segments = splitMultiValue(s)
  if (segments.length === 0) return null
  const cleaned = segments.filter((seg) => seg !== '[object Object]')
  return cleaned.length > 0 ? cleaned.join(',') : null
}
