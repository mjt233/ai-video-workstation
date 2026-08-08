import type { WorkflowUserParamDeclaration, WorkflowUserParamType } from './types.js';

/**
 * 将用户原始输入按声明规范化。
 *
 * - 仅保留声明过的 key（未声明的输入忽略）
 * - 按类型强制转换并序列化为字符串（vars 均为 string）
 * - 空值（undefined / null / ''）跳过：不覆盖任务已有 vars，交由工作流/项目配置决定
 *
 * @param declarations 工作流参数声明（可为空，表示不支持用户传参）
 * @param raw 用户提交的原始参数值（key → 任意值）
 * @returns 规范化后的 vars 片段（key → string），可直接合并进任务 vars
 */
export function normalizeUserParams(
  declarations: WorkflowUserParamDeclaration[] | undefined,
  raw: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!declarations || !raw) return out;
  for (const decl of declarations) {
    const val = raw[decl.key];
    // 未填写 → 不覆盖（使用工作流/项目默认值，如 projectConfig 分辨率或随机种子）
    if (val === undefined || val === null || val === '') continue;
    out[decl.key] = coerceUserParamValue(decl.type, val);
  }
  return out;
}

/**
 * 按参数类型将原始值强制转换为字符串形式。
 *
 * @param type 参数类型
 * @param val 原始值（前端表单提交的原生类型）
 * @returns 字符串形式的值
 */
export function coerceUserParamValue(
  type: WorkflowUserParamType,
  val: unknown,
): string {
  switch (type) {
    case 'boolean': {
      if (typeof val === 'boolean') return String(val);
      const s = String(val).trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'yes' ? 'true' : 'false';
    }
    case 'integer': {
      const n = Number(val);
      return Number.isFinite(n) ? String(Math.round(n)) : String(val);
    }
    case 'float': {
      const n = Number(val);
      return Number.isFinite(n) ? String(n) : String(val);
    }
    default:
      return String(val);
  }
}

/**
 * 将 vars 中的用户参数字符串值按声明类型还原为原生值（boolean / number / string）。
 *
 * 与 {@link normalizeUserParams}（原生 → 字符串）互为反向：vars 均为字符串，
 * 透传给工作流 submit（进而进入 Bridge payload）时需要还原为声明类型，
 * 保证布尔 / 数字语义正确（如 enable_multiple_angles_lora 应为 boolean 而非 "true"）。
 *
 * @param declarations 工作流参数声明（可为空）
 * @param raw 用户参数字符串值（key → 字符串，通常来自 vars）
 * @returns 原生类型值映射（未声明键按字符串保留）
 */
export function toNativeUserParams(
  declarations: WorkflowUserParamDeclaration[] | undefined,
  raw: Record<string, string> | undefined,
): Record<string, boolean | number | string> {
  const typeByKey = new Map((declarations ?? []).map((d) => [d.key, d.type]));
  const out: Record<string, boolean | number | string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    const t = typeByKey.get(k);
    if (t === 'boolean') out[k] = v === 'true';
    else if (t === 'integer' || t === 'float') out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}
