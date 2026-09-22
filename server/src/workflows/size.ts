/**
 * 输出尺寸统一解析（服务端唯一权威实现）。
 *
 * 所有「按用户选择的尺寸生成图片/视频」的工作流实现（火山方舟 Seedream、OpenAI 兼容、
 * ComfyUI Easy Bridge、自定义服务商等）都经本模块解析生效宽高，避免各实现各写一套
 * 优先级判断而出现「某个入口的尺寸配置静默失效」。
 *
 * 本模块两部分：
 * 1. **档位表**（`SIZE_RATIOS` / `SIZE_RESOLUTIONS` / `resolvePresetSize`）——前端
 *    `frontend/src/utils/workflowSize.ts` 档位表的服务端镜像，用于把「比例 × 分辨率档」
 *    换算为具体宽高。**基准值恒为输出短边**（横屏落在高、竖屏落在宽），P 档与 K 档同一
 *    规则；两侧档位值必须保持一致（新增/调整档位需同步修改两处）。
 * 2. **解析器**（`resolveOutputSize` / `resolveSpecifiedGate`）——按统一优先级给出
 *    生效宽高，并提供旧版 `enable_specified_size` 门控的兼容判定。
 * 3. **对齐器**（`alignSizeToMultiple`）——把生效宽高匹配到服务商要求的整除网格
 *    （OpenAI 兼容的 GPT Image 系列要求宽高均为 16 的倍数）。**可选步骤**：只有确实
 *    声明该约束的服务商才调用，其余实现不得无条件套用，否则会改变既有取值。
 *
 * ## 尺寸优先级（全系统统一）
 * 1. `sizeConfig.width` + `sizeConfig.height`（统一尺寸组件选择的原始宽高，新交互）；
 * 2. `sizeConfig.ratio` × `sizeConfig.size`（档位表换算；仅当工作流不支持自定义宽高、
 *    `sizeConfig` 未携带宽高时才走这一步）；
 * 3. 旧交互的 `vars.width/height`（或 `userParams.width/height`）——仅在 `enableSpecified`
 *    为 true 时生效；
 * 4. 回退项目尺寸（`projectConfig.width/height`）。
 */

import type { WorkflowSizeConfig, WorkflowUserParamDeclaration } from './types.js';

/** 比例档 key（与前端 `SizeRatioKey` 对齐，含 3:2 / 2:3 / 21:9 等横向扩展档） */
export type SizeRatioKey = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3' | '21:9';

/** 分辨率档 key（与前端 `SizeResolutionKey` 对齐） */
export type SizeResolutionKey =
  | '360P' | '480P' | '720P' | '768P' | '1080P' | '1K' | '1.5K' | '2K' | '3K' | '4K' | '8K';

/** 比例档（宽高比 = width / height） */
export const SIZE_RATIOS: ReadonlyArray<{ key: SizeRatioKey; ratio: number }> = [
  { key: '1:1', ratio: 1 },
  { key: '4:3', ratio: 4 / 3 },
  { key: '3:4', ratio: 3 / 4 },
  { key: '16:9', ratio: 16 / 9 },
  { key: '9:16', ratio: 9 / 16 },
  { key: '3:2', ratio: 3 / 2 },
  { key: '2:3', ratio: 2 / 3 },
  { key: '21:9', ratio: 21 / 9 },
];

/**
 * 分辨率档基准：**恒为输出短边**（横屏落在高度、竖屏落在宽度），P 档与 K 档同一规则。
 * 各档 base 为「该档的标准短边」，**并非统一倍数公式**（由业务方逐档确认）：
 * `1K` 1024、`1.5K` 1536、`2K` 1440、`3K` 1620、`4K` 2160、`8K` 4320。
 * 各档 base 值唯一，便于把「任意宽高」反查为档位。
 */
export const SIZE_RESOLUTIONS: ReadonlyArray<{
  key: SizeResolutionKey;
  base: number;
}> = [
  { key: '360P', base: 360 },
  { key: '480P', base: 480 },
  { key: '720P', base: 720 },
  { key: '768P', base: 768 },
  { key: '1080P', base: 1080 },
  { key: '1K', base: 1024 },
  { key: '1.5K', base: 1536 },
  { key: '2K', base: 1440 },
  { key: '3K', base: 1620 },
  { key: '4K', base: 2160 },
  { key: '8K', base: 4320 },
];

/**
 * 按「比例 × 分辨率档」换算宽高（与前端 `computePresetSize` 语义一致，基准值恒为短边）。
 *
 * - 横屏/正方形（比例 ≥ 1）：`height = 基准`、`width = round(基准 × 比例)`；
 * - 竖屏（比例 < 1）：`width = 基准`、`height = round(基准 ÷ 比例)`。
 *
 * 例：2K（基准 1440）→ 16:9 得 2560×1440、9:16 得 1440×2560；
 * 4K（基准 2160）→ 16:9 得 3840×2160、9:16 得 2160×3840。
 *
 * @param ratio 比例档 key
 * @param size 分辨率档 key
 * @returns 换算出的宽高（像素）；档位不存在或非预设档时返回 null
 */
export function resolvePresetSize(ratio: string, size: string): { width: number; height: number } | null {
  const r = SIZE_RATIOS.find((x) => x.key === ratio);
  const res = SIZE_RESOLUTIONS.find((x) => x.key === size);
  if (!r || !res) return null;
  if (r.ratio < 1) return { width: res.base, height: Math.round(res.base / r.ratio) };
  return { width: Math.round(res.base * r.ratio), height: res.base };
}

/**
 * 宽高比误差在综合评分中的权重（相对面积误差为 1）。
 * 面积是业务确认的首要目标（「按目标总像素匹配」），比例作为次要约束防止输出被压扁拉长。
 */
const ALIGN_RATIO_WEIGHT = 0.5;

/**
 * 候选宽度的搜索半径（相对对齐倍数的系数）：`±系数 × multiple`。
 * 1.5 倍步长足以覆盖「两维各自就近取整」的全部有解情形（每维误差恒 ≤ `multiple/2`，
 * 面积相对误差 ≤1%），同时把候选集限制在 3~4 组、结果可预期。
 */
const ALIGN_WIDTH_SEARCH_FACTOR = 1.5;

/**
 * 把目标宽高自动匹配到「宽高均为 `multiple` 整数倍」的最近尺寸。
 *
 * 服务商约束示例：OpenAI 兼容（GPT Image 系列）要求 `width`/`height` 均为 16 的倍数，
 * 而档位表按「比例 × 分辨率档」换算的结果不保证整除（如 16:9 + 1K = 1820×1024、
 * 4:3 + 1K = 1365×1024、9:16 + 1K = 1024×1820），因此提交前必须兜底对齐。
 *
 * 算法：在宽度目标的 ±{@link ALIGN_WIDTH_SEARCH_FACTOR}×`multiple` 范围内枚举网格点，
 * 每取一个候选宽度就按**原始宽高比**反推高度目标、再取其上下两个网格点，得到 3~4 组
 * 「宽高均整除」候选，逐个打分后取最优（确定性，无随机、无迭代）：
 *
 * `评分 = |面积 − 目标面积| / 目标面积 + 0.5 × |宽高比 − 目标宽高比| / 目标宽高比`
 *
 * 即**面积误差优先、宽高比误差次之**（权重见 {@link ALIGN_RATIO_WEIGHT}）；完全同分时取
 * 偏移距离更小者，仍相同则取面积较大者。相对误差归一化后，横竖屏、大小尺寸共用同一套
 * 判据（不需要按分辨率分档设阈值）。
 *
 * **对齐恒有解**（正常尺寸）：两维各自就近取整的候选必定被枚举到且评分最优，
 * 因此 1K / 2K 档位下面积误差 ≤0.4%、宽高比误差 ≤0.4%（实测，且档位基准的短边恒保持
 * 不动——1K→1024、2K→1440 本身即 16 的倍数，只有不整除的一侧会被调整）。
 * 仅在目标尺寸远小于对齐粒度（如 56×56 以下的极小图）时才可能偏离较大，属业务上不存在的输入。
 *
 * 实测关键取值：16:9+1K → 1824×1024；9:16+1K → 1024×1824；4:3+1K → 1360×1024；
 * 3:4+1K → 1024×1360；21:9+1K → 2384×1024；1080×1920 → 1088×1920（两侧等分时取较大面积）；
 * 4:3+2K、9:16+2K、16:9+2K、1:1+1K/2K、3:2+1K 等本就整除者原样保留。
 *
 * 前端 `frontend/src/utils/workflowSize.ts` 有同规则镜像，两侧必须同步修改。
 *
 * @param size 目标宽高（像素）
 * @param multiple 对齐倍数（默认 16）
 * @returns 宽高均为 `multiple` 整数倍的尺寸；目标非有限数/非正数时原样返回
 */
export function alignSizeToMultiple(
  size: { width: number; height: number },
  multiple = 16,
): { width: number; height: number } {
  const { width, height } = size;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { ...size };
  const k = Math.round(multiple);
  if (!Number.isFinite(k) || k <= 0 || k === 1) return { ...size };

  const targetArea = width * height;
  const targetRatio = width / height;
  const searchRadius = ALIGN_WIDTH_SEARCH_FACTOR * k;

  let best: { score: number; area: number; width: number; height: number; offset: number } | null = null;
  for (let dw = -searchRadius; dw <= searchRadius; dw += 1) {
    const w = Math.round((width + dw) / k) * k;
    if (w <= 0) continue;
    // 按原始宽高比反推高度目标（竖屏同样成立：w=1024、1920/1080 比例 → 1820.4）
    const idealHeight = (w * height) / width;
    for (const rawHeight of [idealHeight, Math.floor(idealHeight / k) * k, Math.ceil(idealHeight / k) * k]) {
      const h = Math.round(rawHeight);
      if (h <= 0 || h % k !== 0) continue;
      const area = w * h;
      const score =
        Math.abs(area - targetArea) / targetArea
        + ALIGN_RATIO_WEIGHT * (Math.abs(w / h - targetRatio) / targetRatio);
      const offset = Math.abs(w - width) + Math.abs(h - height);
      if (
        !best
        || score < best.score
        || (score === best.score && offset < best.offset)
        || (score === best.score && offset === best.offset && area > best.area)
      ) {
        best = { score, area, width: w, height: h, offset };
      }
    }
  }
  return best ? { width: best.width, height: best.height } : { ...size };
}

/**
 * 解析单个尺寸来源中的有效正数像素值。
 *
 * @param raw 原始值（number / 数字字符串 / boolean（视为无效）/ 空值）
 * @returns 取整后的正整数；无效时返回 undefined
 */
function pickPositive(raw: string | number | boolean | undefined | null): number | undefined {
  if (raw === undefined || raw === null || raw === '' || typeof raw === 'boolean') return undefined;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/**
 * 判断 `sizeConfig` 是否携带用户明确选择的尺寸（宽高任一有效，或比例/尺寸档非自适应）。
 *
 * 用途：旧版 `enable_specified_size` 门控的兼容判定——用户在统一尺寸组件里操作过
 * （比例非 auto/adaptive 或尺寸档非 auto）即视为「显式指定尺寸」。
 *
 * @param sizeConfig 引擎注入的统一尺寸配置（可为空）
 * @returns 是否显式指定尺寸
 */
export function hasExplicitSize(sizeConfig: WorkflowSizeConfig | undefined): boolean {
  if (!sizeConfig) return false;
  return (
    pickPositive(sizeConfig.width) !== undefined ||
    pickPositive(sizeConfig.height) !== undefined ||
    (sizeConfig.ratio !== undefined && sizeConfig.ratio !== 'auto' && sizeConfig.ratio !== 'adaptive') ||
    (sizeConfig.size !== undefined && sizeConfig.size !== 'auto')
  );
}

/** 旧版尺寸门控的判定结果（四态，见 `resolveSpecifiedGate`） */
export type SpecifiedGate =
  /** 「不指定」模式（前端显式关闭）——旧宽高一律不参与 */
  | 'off'
  /** 「指定尺寸」——旧宽高参与 */
  | 'on'
  /**
   * 门控未声明、sizeConfig 也无明确尺寸，且该实现的缺省语义为**严格**
   * （Seedream / OpenAI 兼容：必须显式开启 `enable_specified_size` 才采用旧宽高）
   * ——旧宽高**不参与**，直接回退项目尺寸或省略 size
   */
  | 'default-strict'
  /**
   * 门控未声明、sizeConfig 也无明确尺寸，且该实现的缺省语义为**宽松**
   * （ComfyUI Bridge：`enable_specified_size` 通常不在 Bridge 工作流参数里，
   * 旧调用方直接在 vars 里给宽高即应生效）——旧宽高参与
   */
  | 'default-permissive';

/**
 * 判定旧版 `enable_specified_size` 门控状态（四态，供 `resolveOutputSize` 消费）。
 *
 * - `legacyGate` 显式为 `'false'`（前端「不指定」模式）→ `'off'`，优先于一切；
 * - `sizeConfig` 携带明确尺寸（`hasExplicitSize`）→ `'on'`：统一尺寸组件是新交互，
 *   用户的选择必须生效，不受旧门控缺省影响；
 * - `legacyGate` 显式为 `'true'` → `'on'`；
 * - 门控缺失、且 sizeConfig 无明确尺寸（未配置 / 自动·自动）→ 按 `legacyDefault`
 *   给出 `'default-permissive'`（true）或 `'default-strict'`（false）。
 *
 * @param sizeConfig 引擎注入的统一尺寸配置（可为空）
 * @param legacyGate 旧版 `enable_specified_size` 原始值（vars 或 userParams）
 * @param legacyDefault 门控缺失时的缺省语义（true = 宽松：旧宽高有效即采用）
 * @returns 门控四态
 */
export function resolveSpecifiedGate(
  sizeConfig: WorkflowSizeConfig | undefined,
  legacyGate: string | number | boolean | undefined,
  legacyDefault: boolean,
): SpecifiedGate {
  const gate = legacyGate === undefined || legacyGate === null ? undefined : String(legacyGate);
  if (gate === 'false') return 'off';
  if (hasExplicitSize(sizeConfig)) return 'on';
  if (gate === 'true') return 'on';
  return legacyDefault ? 'default-permissive' : 'default-strict';
}

/**
 * 判定「旧版门控是否指示启用指定尺寸」（`resolveSpecifiedGate` 的布尔视图）。
 *
 * @param sizeConfig 引擎注入的统一尺寸配置（可为空）
 * @param legacyGate 旧版 `enable_specified_size` 原始值（vars 或 userParams）
 * @param legacyDefault 门控缺失时的缺省语义
 * @returns 是否按「指定尺寸」处理（`'off'` / `'default-strict'` 为 false）
 */
export function enableSpecifiedSize(
  sizeConfig: WorkflowSizeConfig | undefined,
  legacyGate: string | number | boolean | undefined,
  legacyDefault: boolean,
): boolean {
  const gate = resolveSpecifiedGate(sizeConfig, legacyGate, legacyDefault);
  return gate === 'on' || gate === 'default-permissive';
}

/** `resolveOutputSize` 的入参 */
export interface ResolveOutputSizeOptions {
  /** 引擎注入的统一尺寸配置（新交互；可为空） */
  sizeConfig?: WorkflowSizeConfig;
  /**
   * 旧版门控判定结果（`resolveSpecifiedGate` 的四态）：`'off'` / `'default-strict'`
   * 时旧宽高不参与；`'on'` / `'default-permissive'` 时参与。缺省为 `'default-strict'`。
   */
  enableSpecified?: SpecifiedGate;
  /** 旧交互的 vars（`WorkflowVarsBase` 子集；仅取 width/height） */
  vars?: { width?: string | number; height?: string | number };
  /** 旧交互的 userParams（`ctx.userParams`；图片编辑类工作流从表单写入此处） */
  userParams?: Record<string, boolean | number | string>;
  /** 回退项目宽度（`projectConfig.width`） */
  fallbackWidth: number;
  /** 回退项目高度（`projectConfig.height`） */
  fallbackHeight: number;
}

/**
 * 按统一优先级解析生效输出宽高（所有工作流实现共用的唯一入口）。
 *
 * 优先级：`sizeConfig` 显式宽高 → `sizeConfig` 档位换算 → 旧版 vars/userParams 宽高
 * → 项目尺寸回退。详见模块头注释。
 *
 * 旧版宽高是否参与由 `enableSpecified`（`SpecifiedGate` 四态）决定：
 * `'on'` / `'default-permissive'` 参与；`'off'` / `'default-strict'` 不参与。
 *
 * @param options 解析入参（见 `ResolveOutputSizeOptions`）
 * @returns 生效宽高（像素，均为正整数）
 */
export function resolveOutputSize(options: ResolveOutputSizeOptions): { width: number; height: number } {
  const sc = options.sizeConfig;
  // 1. 统一尺寸配置显式宽高（新交互，最高优先）
  const scWidth = pickPositive(sc?.width);
  const scHeight = pickPositive(sc?.height);
  if (scWidth !== undefined && scHeight !== undefined) return { width: scWidth, height: scHeight };
  // 2. 仅比例/尺寸档（工作流不支持自定义宽高时）→ 档位表换算
  if (sc?.ratio !== undefined && sc.size !== undefined) {
    const preset = resolvePresetSize(sc.ratio, sc.size);
    if (preset) return preset;
  }
  // 3. 旧交互宽高（vars 优先，其次 userParams；off / default-strict 时不参与）
  if (options.enableSpecified !== 'off' && options.enableSpecified !== 'default-strict') {
    const legacyWidth = pickPositive(options.vars?.width) ?? pickPositive(options.userParams?.['width']);
    const legacyHeight = pickPositive(options.vars?.height) ?? pickPositive(options.userParams?.['height']);
    if (legacyWidth !== undefined && legacyHeight !== undefined) {
      return { width: legacyWidth, height: legacyHeight };
    }
  }
  // 4. 项目尺寸回退（0/负值视为未配置，按 1080×1920 兜底）
  return {
    width: pickPositive(options.fallbackWidth) ?? 1080,
    height: pickPositive(options.fallbackHeight) ?? 1920,
  };
}

/**
 * 判断「用户是否真的做过尺寸选择」——`sizeConfig` 携带显式宽高，或档位表能换算的
 * 比例×尺寸档（即非 自动/自动）。
 *
 * 用途：区分「用户选了具体尺寸」与「用户没配置过尺寸」。未配置时部分服务商（如火山
 * 方舟 Seedream 图片编辑）不应回退项目尺寸，而应**省略 size 字段**、交由模型默认档位，
 * 因此需要与 `hasExplicitSize`（粒度更粗：比例/尺寸档非自适应即算指定用于门控判定）
 * 区分开。
 *
 * @param sizeConfig 引擎注入的统一尺寸配置（可为空）
 * @returns 是否选择了可换算的具体尺寸
 */
export function hasSizeSelection(sizeConfig: WorkflowSizeConfig | undefined): boolean {
  if (!sizeConfig) return false;
  if (pickPositive(sizeConfig.width) !== undefined && pickPositive(sizeConfig.height) !== undefined) return true;
  if (sizeConfig.ratio === undefined || sizeConfig.size === undefined) return false;
  return resolvePresetSize(sizeConfig.ratio, sizeConfig.size) !== null;
}

/**
 * 已解析出的尺寸参数（提交给服务商的最终宽高 + 启用标记）。
 *
 * 由 `resolveImageEditSizeParams` / `resolveOutputSize` 的调用方产出，载荷构建器
 * 据此把 `width`/`height` 写入请求参数；未启用或宽高无效时对应字段缺席。
 */
export interface SizeParams {
  /** 是否启用指定输出尺寸（服务商约定字段，随宽高一同上送；缺席表示不携带该字段） */
  enable_specified_size?: boolean;
  /** 输出宽度（像素） */
  width?: number;
  /** 输出高度（像素） */
  height?: number;
}

/**
 * 图片/视频类工作流的旧版尺寸参数声明（`enable_specified_size` + 宽高）。
 *
 * 新交互下这些参数不再由用户直接填写（尺寸改由统一尺寸组件设置并写入任务
 * `params.sizeConfig`），声明保留仅用于兼容旧交互与任务回显——前端表单据此保留
 * 这三个 key 的回写（见 `WorkflowParamsForm`），缺失时旧版 vars 读取链路会断。
 * 各实现应直接复用本常量，避免逐份重复声明。
 */
export const SIZE_PARAMS: WorkflowUserParamDeclaration[] = [
  {
    name: '指定输出尺寸',
    key: 'enable_specified_size',
    type: 'boolean',
    defaultValue: false,
    description: '启用后按下方选定的宽高输出图片',
  },
  {
    name: '输出宽度',
    key: 'width',
    type: 'integer',
    defaultValue: '',
    description: '输出图片宽度（像素）',
  },
  {
    name: '输出高度',
    key: 'height',
    type: 'integer',
    defaultValue: '',
    description: '输出图片高度（像素）',
  },
];
