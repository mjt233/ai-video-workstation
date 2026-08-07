import { fileToDataUrl } from '../providers/volcengine-ark/client.js';
import type { ProviderClient } from '../providers/types.js';

export { fileToDataUrl };

/** Seedream 模型定义（impl → 阅读名 → 方舟模型 ID → 尺寸约束 kind），文生图/图片编辑实现共用 */
export const SEEDREAM_MODELS = [
  { impl: 'seedream-5-pro', name: 'Seedream 5.0 Pro（火山方舟）', model: 'doubao-seedream-5-0-pro-260628', kind: 'pro' },
  { impl: 'seedream-5-lite', name: 'Seedream 5.0 Lite（火山方舟）', model: 'doubao-seedream-5-0-260128', kind: 'lite' },
] as const;

/** Seedream 显式尺寸（方式 2：宽x高像素值）的允许约束 */
export interface SeedreamSizeLimits {
  /** 总像素下限（含），如 pro 921600（1280x720） */
  minPixels: number;
  /** 总像素上限（含），如 pro 4624220（2048x2048x1.1025） */
  maxPixels: number;
  /** 宽高比下限（宽/高，含），两模型均为 1/16 */
  minRatio: number;
  /** 宽高比上限（宽/高，含），两模型均为 16 */
  maxRatio: number;
  /** 无有效配置时的回退档位（方式 1 默认值，两模型均为 2K） */
  fallback: string;
}

/**
 * Seedream pro / lite 的显式尺寸约束（来自火山方舟图片生成 API 文档）。
 * - pro：方式 1 档位 1K/1.5K/2K；方式 2 总像素 [921600, 4624220]、宽高比 [1/16, 16]
 * - lite：方式 1 档位 2K/3K/4K；方式 2 总像素 [3686400, 16777216]、宽高比 [1/16, 16]
 */
export const SEEDREAM_SIZE_LIMITS: Record<'pro' | 'lite', SeedreamSizeLimits> = {
  pro: { minPixels: 921600, maxPixels: 4624220, minRatio: 1 / 16, maxRatio: 16, fallback: '2K' },
  lite: { minPixels: 3686400, maxPixels: 16777216, minRatio: 1 / 16, maxRatio: 16, fallback: '2K' },
};

/**
 * 把用户配置的宽高映射为方舟 size。
 * - 宽高先四舍五入取整；总像素与宽高比均在允许范围 → 直接 "{width}x{height}"
 * - 超出范围 → 自动匹配最接近的允许尺寸：先钳制宽高比到允许范围，再钳制总像素到允许范围
 *   （最接近用户目标），由 W*H=target、W/H=ratio 反解宽高并取整；取整越界时按比例微调到边界内。
 * - 无有效配置（缺省/非法）→ 回退模型默认档位（fallback）
 * @param limits 模型尺寸约束（SEEDREAM_SIZE_LIMITS[pro|lite]）
 * @param width 可选宽度（像素，number 或数字字符串）
 * @param height 可选高度（像素，number 或数字字符串）
 * @returns 方舟 size 值（"WxH" 或档位）
 */
export function resolveSeedreamSize(
  limits: SeedreamSizeLimits,
  width?: string | number,
  height?: string | number,
): string {
  const w = Math.round(typeof width === 'number' ? width : Number(width));
  const h = Math.round(typeof height === 'number' ? height : Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return limits.fallback;
  }

  const total = w * h;
  const ratio = w / h;
  if (total >= limits.minPixels && total <= limits.maxPixels && ratio >= limits.minRatio && ratio <= limits.maxRatio) {
    return `${w}x${h}`;
  }

  // 自动匹配最接近的允许尺寸（保持宽高比）：
  // 1. 宽高比钳制到允许范围
  const r = Math.min(limits.maxRatio, Math.max(limits.minRatio, ratio));
  // 2. 总像素钳制到允许范围（最接近用户目标）
  const target = Math.min(limits.maxPixels, Math.max(limits.minPixels, total));
  // 3. 由 W*H=target、W/H=r 反解宽高
  let W = Math.round(Math.sqrt(target * r));
  let H = Math.round(Math.sqrt(target / r));
  // 4. 取整后若总像素越界，按比例微调到边界内（保持宽高比）
  if (W * H > limits.maxPixels) {
    const k = Math.sqrt(limits.maxPixels / (W * H));
    W = Math.floor(W * k);
    H = Math.floor(H * k);
  } else if (W * H < limits.minPixels) {
    const k = Math.sqrt(limits.minPixels / (W * H));
    W = Math.ceil(W * k);
    H = Math.ceil(H * k);
  }
  // 5. 最终校验：仍不合规则回退档位（保证永不上送非法尺寸）
  if (
    W <= 0 || H <= 0
    || W * H < limits.minPixels || W * H > limits.maxPixels
    || W / H < limits.minRatio || W / H > limits.maxRatio
  ) {
    return limits.fallback;
  }
  return `${W}x${H}`;
}

/** 文生图提交参数 */
export interface SeedreamTextToImageSubmitParams {
  /** 方舟模型 ID（如 doubao-seedream-5-0-pro-260628） */
  model: string;
  /** 图片描述提示词 */
  prompt: string;
  /** 方舟 size（档位或 WxH） */
  size: string;
  /** 提示词优化模式（可选：standard 质量更优耗时更长） */
  optimizeMode?: 'standard';
}

/**
 * 提交文生图任务（火山方舟 images/generations）。
 * @param client Provider 客户端
 * @param params 文生图参数
 * @returns 远端任务 ID
 */
export async function submitSeedreamTextToImage(
  client: ProviderClient,
  params: SeedreamTextToImageSubmitParams,
): Promise<{ taskId: string }> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    size: params.size,
    output_format: 'jpeg',
    watermark: false,
    response_format: 'url',
  };
  if (params.optimizeMode) {
    body.optimize_prompt_options = { mode: params.optimizeMode };
  }
  return client.execute({ workflowId: params.model, params: body });
}

/** 图片编辑提交参数 */
export interface SeedreamImageEditSubmitParams {
  /** 方舟模型 ID */
  model: string;
  /** 编辑描述（作为 prompt） */
  prompt: string;
  /** 参考图 data URL（1 张为字符串，2~10 张为数组） */
  images: string[];
  /** 方舟 size（档位或 WxH） */
  size: string;
  /** 提示词优化模式（可选） */
  optimizeMode?: 'standard';
}

/**
 * 提交图片编辑任务（火山方舟 images/generations，多图参考生单图）。
 * @param client Provider 客户端
 * @param params 图片编辑参数
 * @returns 远端任务 ID
 */
export async function submitSeedreamImageEdit(
  client: ProviderClient,
  params: SeedreamImageEditSubmitParams,
): Promise<{ taskId: string }> {
  if (params.images.length === 0 || params.images.length > 10) {
    throw new Error(`火山方舟图片编辑需要 1~10 张参考图，当前 ${params.images.length} 张`);
  }
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    image: params.images.length === 1 ? params.images[0] : params.images,
    size: params.size,
    output_format: 'jpeg',
    watermark: false,
    response_format: 'url',
  };
  if (params.optimizeMode) {
    body.optimize_prompt_options = { mode: params.optimizeMode };
  }
  return client.execute({ workflowId: params.model, params: body });
}
