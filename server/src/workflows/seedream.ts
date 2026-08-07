import { fileToDataUrl } from '../providers/volcengine-ark/client.js';
import type { ProviderClient } from '../providers/types.js';

export { fileToDataUrl };

/** 方舟显式尺寸的总像素范围（pro 的约束，作为两个模型共享安全边界） */
const ARK_MIN_TOTAL_PIXELS = 921600;
const ARK_MAX_TOTAL_PIXELS = 4624220;

/**
 * 把应用宽高映射为方舟 size。
 * - 宽高均有效且总像素在 [921600, 4624220]、宽高比在 [1/16, 16] → "{width}x{height}"
 * - 否则回退 "2K"（两个模型均接受）
 * @param width 可选宽度（像素，number 或数字字符串）
 * @param height 可选高度（像素，number 或数字字符串）
 * @returns 方舟 size 值
 */
export function resolveSeedreamSize(width?: string | number, height?: string | number): string {
  const w = typeof width === 'number' ? width : Number(width);
  const h = typeof height === 'number' ? height : Number(height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    const total = w * h;
    const ratio = w / h;
    if (total >= ARK_MIN_TOTAL_PIXELS && total <= ARK_MAX_TOTAL_PIXELS && ratio >= 1 / 16 && ratio <= 16) {
      return `${Math.round(w)}x${Math.round(h)}`;
    }
  }
  return '2K';
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
