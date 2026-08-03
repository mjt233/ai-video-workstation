# 工作流尺寸参数暴露与通用尺寸选择组件 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `qwen-edit-2509` 图片编辑工作流的 `enable_specified_size`/`width`/`height` 三个参数暴露给用户，并新增通用尺寸选择组件 `WorkflowSizePicker`，在 `WorkflowParamsForm` 检测到 width+height 声明时替代两个数字输入框。

**Architecture:** 服务端在 `ImageEditVars` 增加 3 个可选字段、在 image-edit 工作流声明 3 个用户参数，提交时仅当 `enable_specified_size === 'true'` 才把尺寸透传给 Bridge（纯函数 `resolveImageEditSizeParams` 负责解析，便于单测）。前端把尺寸换算/回显逻辑抽成纯函数模块 `workflowSize.ts`（可单测），`WorkflowSizePicker.vue` 负责 UI 与四种模式，`WorkflowParamsForm.vue` 按约定检测 width+height 声明并渲染组件。

**Tech Stack:** Express + TypeScript（服务端）、Vue 3 + Vuetify 3 + Vite + vitest（前端）、ESLint。

**Spec:** `docs/superpowers/specs/2026-08-03-workflow-size-picker-design.md`

---

### Task 1: 服务端 — vars 类型扩展 + image-edit 参数声明

**Files:**
- Modify: `server/src/workflows/vars.ts`（`ImageEditVars` interface）
- Modify: `server/src/workflows/image-edit/default.ts`（`params` 声明）

- [ ] **Step 1: 扩展 `ImageEditVars`**

在 `server/src/workflows/vars.ts` 的 `ImageEditVars` interface 末尾（`baseLabel?: string;` 之后、`}` 之前）追加：

```typescript
  /** 可选：基础场景标签（stage 衍生时） */
  baseLabel?: string;
  /**
   * 可选：是否启用指定输出尺寸（"true"/"false"）。
   * 由用户通过工作流参数声明传入；仅当为 "true" 时 width/height 生效。
   */
  enable_specified_size?: string;
  /**
   * 可选：输出宽度（像素，字符串形式）。
   * enable_specified_size 为 "true" 时提交给 Bridge。
   */
  width?: string;
  /**
   * 可选：输出高度（像素，字符串形式）。
   * enable_specified_size 为 "true" 时提交给 Bridge。
   */
  height?: string;
```

注意 `baseLabel?: string;` 已存在，替换为上述完整块（含原字段）。

- [ ] **Step 2: image-edit 工作流追加 3 个参数声明**

在 `server/src/workflows/image-edit/default.ts` 的 `params` 数组中，在 `enable_multiple_angles_lora` 声明之后追加：

```typescript
    {
      key: 'enable_specified_size',
      name: '指定输出尺寸',
      defaultValue: false,
      type: 'boolean',
      description: '启用后按下方选定的宽高输出图片'
    },
    {
      key: 'width',
      name: '输出宽度',
      defaultValue: '',
      type: 'integer',
      description: '输出图片宽度（像素）'
    },
    {
      key: 'height',
      name: '输出高度',
      defaultValue: '',
      type: 'integer',
      description: '输出图片高度（像素）'
    }
```

即 `params` 数组现有内容为：

```typescript
  params: [
    {
      key: 'enable_multiple_angles_lora',
      name: '启用多机位旋转LoRA模型',
      defaultValue: true,
      type: 'boolean',
      description: '启用后可在提示词中使用“摄像机向左/右移动90度，摄像机向上/下移动，拉近/推远”等方式精准控制视角变换'
    },
    { /* 上面追加的 3 个新声明 */ }
  ],
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck:server`
Expected: 无类型错误（退出码 0）

- [ ] **Step 4: Commit**

```bash
git add server/src/workflows/vars.ts server/src/workflows/image-edit/default.ts
git commit -m "feat: image-edit 工作流声明输出尺寸用户参数"
```

---

### Task 2: 服务端 — 尺寸解析纯函数 + Bridge 透传

**Files:**
- Create: `server/src/workflows/bridge-client.test.ts`
- Modify: `server/src/workflows/bridge-client.ts`

- [ ] **Step 1: 编写失败测试**

创建 `server/src/workflows/bridge-client.test.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import { resolveImageEditSizeParams } from './bridge-client.js';

describe('resolveImageEditSizeParams', () => {
  it('enable_specified_size=true 时解析出启用的宽高（数字）', () => {
    expect(
      resolveImageEditSizeParams({
        enable_specified_size: 'true',
        width: '1920',
        height: '1080',
      }),
    ).toEqual({ enable_specified_size: true, width: 1920, height: 1080 });
  });

  it('enable_specified_size=false 时不返回任何尺寸参数', () => {
    expect(
      resolveImageEditSizeParams({ enable_specified_size: 'false', width: '1920', height: '1080' }),
    ).toEqual({});
  });

  it('未声明 enable_specified_size 时不返回任何尺寸参数', () => {
    expect(resolveImageEditSizeParams({ width: '1920', height: '1080' })).toEqual({});
  });

  it('启用但未提供宽高时只返回启用标记', () => {
    expect(resolveImageEditSizeParams({ enable_specified_size: 'true' })).toEqual({
      enable_specified_size: true,
    });
  });

  it('非法宽高值被忽略', () => {
    expect(
      resolveImageEditSizeParams({ enable_specified_size: 'true', width: 'abc', height: '' }),
    ).toEqual({ enable_specified_size: true });
  });

  it('小数宽高取整', () => {
    expect(
      resolveImageEditSizeParams({ enable_specified_size: 'true', width: '1920.5', height: '1080.5' }),
    ).toEqual({ enable_specified_size: true, width: 1921, height: 1081 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/workflows/bridge-client.test.ts`
Expected: FAIL —— `resolveImageEditSizeParams is not a function`

- [ ] **Step 3: 实现 `resolveImageEditSizeParams` 并在 `submitImageEdit` 透传**

在 `server/src/workflows/bridge-client.ts` 中：

**3a.** 在 `submitImageEdit` 函数（`export async function submitImageEdit`）之前新增：

```typescript
export interface ImageEditSizeParams {
  /** 是否启用指定输出尺寸 */
  enable_specified_size?: boolean;
  /** 输出宽度（像素） */
  width?: number;
  /** 输出高度（像素） */
  height?: number;
}

/**
 * 从工作流 vars 解析图片编辑尺寸参数。
 *
 * 仅当 vars.enable_specified_size === 'true' 时返回启用标记与宽高（数字，取整），
 * 否则返回空对象（对应「不指定」模式，不向 Bridge 传任何尺寸参数）。
 *
 * @param vars 工作流 vars（key → 字符串值）
 * @returns 可透传给 Bridge 的尺寸参数
 */
export function resolveImageEditSizeParams(
  vars: Record<string, string | undefined>,
): ImageEditSizeParams {
  if (vars.enable_specified_size !== 'true') return {};
  const out: ImageEditSizeParams = { enable_specified_size: true };
  const width = vars.width ? Number(vars.width) : NaN;
  const height = vars.height ? Number(vars.height) : NaN;
  if (Number.isFinite(width)) out.width = Math.round(width);
  if (Number.isFinite(height)) out.height = Math.round(height);
  return out;
}
```

**3b.** 修改 `submitImageEdit`，将尺寸参数追加进 `textParams`：

```typescript
export async function submitImageEdit(params: SubmitImageEditParams): Promise<BridgeSubmitResult> {
  const files: Record<string, File> = {};

  // 多个图片时，直接以 img${图片序号} 命名，触发动态构建工作流实现多图参考编辑
  params.imgs.forEach((f, idx) => {
    files[`img${idx + 1}`] = f;
  });
  const textParams: Record<string, unknown> = { desc: params.desc, enable_multiple_angles_lora: params.enable_multiple_angles_lora ?? true };
  if (params.seed != null) {
    textParams.seed = params.seed;
  }
  if (params.enable_specified_size != null) {
    textParams.enable_specified_size = params.enable_specified_size;
  }
  if (params.width != null) {
    textParams.width = params.width;
  }
  if (params.height != null) {
    textParams.height = params.height;
  }
  return submitComfyuiBridge({
    workflowId: 'qwen-edit-2509',
    params: textParams,
    files,
  });
}
```

（`SubmitImageEditParams` 已含 `enable_specified_size?: boolean`、`width?: number`、`height?: number` 三个可选字段，无需再改。）

**3c.** 修改 `createImageEditWorkflow` 的 `submit`，从 vars 解析尺寸并透传：

```typescript
    async submit(params) {
      const { desc, imgs, seed } = await config.getParams(params)
      if (!imgs.length) {
        throw new Error('Image edit workflow requires at least one input image');
      }
      const size = resolveImageEditSizeParams(params.vars as Record<string, string | undefined>);
      const result = await submitImageEdit({ imgs, desc, seed, ...size });
      return { taskId: result.taskId };
    },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/workflows/bridge-client.test.ts`
Expected: PASS（6 个用例全部通过）

- [ ] **Step 5: 类型检查 + 全量服务端测试**

Run: `npm run typecheck:server`
Expected: 无类型错误

Run: `cd server && npm test`
Expected: 所有既有测试 + 新测试通过

- [ ] **Step 6: Commit**

```bash
git add server/src/workflows/bridge-client.ts server/src/workflows/bridge-client.test.ts
git commit -m "feat: 图片编辑输出尺寸参数解析并透传 Bridge"
```

---

### Task 3: 前端 — 尺寸换算/回显纯函数模块

**Files:**
- Create: `frontend/src/utils/workflowSize.test.ts`
- Create: `frontend/src/utils/workflowSize.ts`

- [ ] **Step 1: 编写失败测试**

创建 `frontend/src/utils/workflowSize.test.ts`：

```typescript
import { describe, expect, it } from 'vitest'
import {
  computePresetSize,
  findSizeParamKeys,
  resolveSizeMode,
  SIZE_RATIOS,
  SIZE_RESOLUTIONS,
} from './workflowSize'
import type { WorkflowUserParamDeclaration } from '../api/workflow'

describe('computePresetSize', () => {
  it('P 档按高度为基准：16:9 + 1080P → 1920×1080', () => {
    expect(computePresetSize('16:9', '1080P')).toEqual({ width: 1920, height: 1080 })
  })

  it('1:1 + 1080P → 1080×1080', () => {
    expect(computePresetSize('1:1', '1080P')).toEqual({ width: 1080, height: 1080 })
  })

  it('9:16 + 1080P → 1080×1920', () => {
    expect(computePresetSize('9:16', '1080P')).toEqual({ width: 1080, height: 1920 })
  })

  it('4:3 + 720P → 960×720', () => {
    expect(computePresetSize('4:3', '720P')).toEqual({ width: 960, height: 720 })
  })

  it('K 档按宽度为基准：16:9 + 4K → 3840×2160', () => {
    expect(computePresetSize('16:9', '4K')).toEqual({ width: 3840, height: 2160 })
  })

  it('9:16 + 4K → 宽度 3840，高度按比例取整', () => {
    expect(computePresetSize('9:16', '4K')).toEqual({ width: 3840, height: Math.round(3840 / (9 / 16)) })
  })

  it('1:1 + 8K → 7680×7680', () => {
    expect(computePresetSize('1:1', '8K')).toEqual({ width: 7680, height: 7680 })
  })
})

describe('SIZE_RATIOS / SIZE_RESOLUTIONS', () => {
  it('比例档包含 5 个预设', () => {
    expect(SIZE_RATIOS.map((r) => r.key)).toEqual(['1:1', '16:9', '9:16', '4:3', '3:4'])
  })

  it('分辨率档包含 6 个预设，P 档基准为高度、K 档基准为宽度', () => {
    expect(SIZE_RESOLUTIONS.map((r) => r.key)).toEqual(['360P', '720P', '1080P', '2K', '4K', '8K'])
    expect(SIZE_RESOLUTIONS.find((r) => r.key === '1080P')?.baseOn).toBe('height')
    expect(SIZE_RESOLUTIONS.find((r) => r.key === '4K')?.baseOn).toBe('width')
  })
})

describe('resolveSizeMode', () => {
  it('未启用或无有效宽高 → none', () => {
    expect(resolveSizeMode({ enableSpecifiedSize: false, width: '', height: '' })).toBe('none')
    expect(resolveSizeMode({ enableSpecifiedSize: undefined })).toBe('none')
  })

  it('启用且宽高等于项目尺寸 → project', () => {
    expect(
      resolveSizeMode({ enableSpecifiedSize: true, width: 1080, height: 1920, projectSize: { width: 1080, height: 1920 } }),
    ).toBe('project')
  })

  it('启用且宽高匹配某预设 → preset', () => {
    expect(resolveSizeMode({ enableSpecifiedSize: true, width: 1920, height: 1080 })).toBe('preset')
  })

  it('启用但不匹配任何预设 → manual', () => {
    expect(resolveSizeMode({ enableSpecifiedSize: true, width: 1234, height: 567 })).toBe('manual')
  })
})

describe('findSizeParamKeys', () => {
  const decls = (keys: string[]): WorkflowUserParamDeclaration[] =>
    keys.map((key) => ({ key, name: key, defaultValue: '', type: 'integer' }))

  it('同时存在 width 与 height → 返回三个 key', () => {
    expect(findSizeParamKeys(decls(['enable_specified_size', 'width', 'height']))).toEqual({
      widthKey: 'width',
      heightKey: 'height',
      enableKey: 'enable_specified_size',
    })
  })

  it('缺少 width 或 height → null', () => {
    expect(findSizeParamKeys(decls(['width']))).toBeNull()
    expect(findSizeParamKeys(decls(['height', 'enable_specified_size']))).toBeNull()
  })

  it('无 enable_specified_size 时 enableKey 为 undefined', () => {
    expect(findSizeParamKeys(decls(['width', 'height']))).toEqual({
      widthKey: 'width',
      heightKey: 'height',
      enableKey: undefined,
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/utils/workflowSize.test.ts`
Expected: FAIL —— `Cannot find module './workflowSize'`

- [ ] **Step 3: 实现纯函数模块**

创建 `frontend/src/utils/workflowSize.ts`：

```typescript
import type { WorkflowUserParamDeclaration } from '../api/workflow'

/** 尺寸选择模式 */
export type SizeMode = 'preset' | 'manual' | 'project' | 'none'

/** 比例档 key */
export type SizeRatioKey = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'

/** 分辨率档 key */
export type SizeResolutionKey = '360P' | '720P' | '1080P' | '2K' | '4K' | '8K'

export interface SizeRatio {
  key: SizeRatioKey
  /** 宽高比（width / height） */
  ratio: number
}

/** 比例档（宽高比） */
export const SIZE_RATIOS: SizeRatio[] = [
  { key: '1:1', ratio: 1 },
  { key: '16:9', ratio: 16 / 9 },
  { key: '9:16', ratio: 9 / 16 },
  { key: '4:3', ratio: 4 / 3 },
  { key: '3:4', ratio: 3 / 4 },
]

export interface SizeResolution {
  key: SizeResolutionKey
  /** 基准像素值：P 档为高度基准、K 档为宽度基准 */
  base: number
  /** 'height' = 以高度为基准；'width' = 以宽度为基准 */
  baseOn: 'height' | 'width'
}

/** 分辨率档（P 档按高度、K 档按宽度为基准） */
export const SIZE_RESOLUTIONS: SizeResolution[] = [
  { key: '360P', base: 360, baseOn: 'height' },
  { key: '720P', base: 720, baseOn: 'height' },
  { key: '1080P', base: 1080, baseOn: 'height' },
  { key: '2K', base: 2560, baseOn: 'width' },
  { key: '4K', base: 3840, baseOn: 'width' },
  { key: '8K', base: 7680, baseOn: 'width' },
]

export interface SizeValue {
  width: number
  height: number
}

/**
 * 按比例×分辨率档换算宽高。
 * - P 档：以高度为基准，宽度 = round(高 × 比例)
 * - K 档：以宽度为基准，高度 = round(宽 ÷ 比例)
 *
 * @param ratioKey 比例档 key
 * @param resolutionKey 分辨率档 key
 * @returns 换算出的宽高（像素）
 */
export function computePresetSize(ratioKey: SizeRatioKey, resolutionKey: SizeResolutionKey): SizeValue {
  const r = SIZE_RATIOS.find((x) => x.key === ratioKey)!
  const res = SIZE_RESOLUTIONS.find((x) => x.key === resolutionKey)!
  if (res.baseOn === 'height') {
    return { height: res.base, width: Math.round(res.base * r.ratio) }
  }
  return { width: res.base, height: Math.round(res.base / r.ratio) }
}

export interface SizeEchoInput {
  /** enable_specified_size 的值（前端表单原生类型） */
  enableSpecifiedSize?: boolean | number | string
  /** 宽度值（可为空串） */
  width?: number | string
  /** 高度值（可为空串） */
  height?: number | string
  /** 项目尺寸（project.json），读取失败为 null */
  projectSize?: { width: number; height: number } | null
}

/**
 * 根据外部值推断尺寸组件的初始模式。
 *
 * - 未启用或宽高无效 → 'none'
 * - 宽高恰好等于项目尺寸 → 'project'
 * - 宽高能匹配某个比例+分辨率档 → 'preset'
 * - 其余 → 'manual'
 *
 * @param input 外部传入的值
 * @returns 推断出的模式
 */
export function resolveSizeMode(input: SizeEchoInput): SizeMode {
  const enabled =
    input.enableSpecifiedSize === true ||
    input.enableSpecifiedSize === 'true' ||
    input.enableSpecifiedSize === 1
  const w = Number(input.width)
  const h = Number(input.height)
  const hasSize =
    input.width !== undefined && input.width !== '' &&
    input.height !== undefined && input.height !== '' &&
    Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
  if (!enabled || !hasSize) return 'none'
  if (input.projectSize && w === input.projectSize.width && h === input.projectSize.height) {
    return 'project'
  }
  const ratio = w / h
  const matchedRatio = SIZE_RATIOS.find((r) => Math.abs(r.ratio - ratio) < 0.01)
  const matchedRes = SIZE_RESOLUTIONS.find(
    (res) =>
      (res.baseOn === 'height' && res.base === h) ||
      (res.baseOn === 'width' && res.base === w),
  )
  if (matchedRatio && matchedRes) return 'preset'
  return 'manual'
}

export interface SizeParamKeys {
  widthKey: string
  heightKey: string
  enableKey?: string
}

/**
 * 约定式检测：声明列表中是否同时存在 width 与 height 用户参数。
 * 存在时返回三个相关 key（enable_specified_size 可选），供表单渲染尺寸组件。
 *
 * @param declarations 工作流参数声明列表
 * @returns 尺寸相关 key；不满足约定时返回 null
 */
export function findSizeParamKeys(
  declarations: WorkflowUserParamDeclaration[],
): SizeParamKeys | null {
  const width = declarations.find((d) => d.key === 'width')
  const height = declarations.find((d) => d.key === 'height')
  if (!width || !height) return null
  const enable = declarations.find((d) => d.key === 'enable_specified_size')
  return {
    widthKey: width.key,
    heightKey: height.key,
    enableKey: enable?.key,
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/utils/workflowSize.test.ts`
Expected: PASS（全部用例通过）

- [ ] **Step 5: 类型检查 + Commit**

Run: `npm run typecheck:frontend`
Expected: 无类型错误

```bash
git add frontend/src/utils/workflowSize.ts frontend/src/utils/workflowSize.test.ts
git commit -m "feat: 新增尺寸换算与回显纯函数模块"
```

---

### Task 4: 前端 — 通用尺寸选择组件 WorkflowSizePicker

**Files:**
- Create: `frontend/src/components/WorkflowSizePicker.vue`

- [ ] **Step 1: 创建组件**

创建 `frontend/src/components/WorkflowSizePicker.vue`：

```vue
<template>
  <div class="workflow-size-picker">
    <!-- 模式选择 -->
    <v-select
      :model-value="mode"
      :items="modeOptions"
      item-title="label"
      item-value="value"
      label="输出尺寸"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="setMode"
    />

    <!-- 比例 × 分辨率 -->
    <div
      v-if="mode === 'preset'"
      class="d-flex ga-2"
    >
      <v-select
        :model-value="ratio"
        :items="SIZE_RATIOS"
        item-title="key"
        item-value="key"
        label="比例"
        density="compact"
        variant="outlined"
        hide-details
        class="flex-grow-1"
        @update:model-value="(v) => setRatio(v as SizeRatioKey)"
      />
      <v-select
        :model-value="resolution"
        :items="SIZE_RESOLUTIONS"
        item-title="key"
        item-value="key"
        label="分辨率"
        density="compact"
        variant="outlined"
        hide-details
        class="flex-grow-1"
        @update:model-value="(v) => setResolution(v as SizeResolutionKey)"
      />
    </div>

    <!-- 手动填写 -->
    <div
      v-else-if="mode === 'manual'"
      class="d-flex ga-2"
    >
      <v-text-field
        :model-value="manualWidth"
        label="宽度 (px)"
        type="number"
        density="compact"
        variant="outlined"
        hide-details
        class="flex-grow-1"
        @update:model-value="setManualWidth"
      />
      <v-text-field
        :model-value="manualHeight"
        label="高度 (px)"
        type="number"
        density="compact"
        variant="outlined"
        hide-details
        class="flex-grow-1"
        @update:model-value="setManualHeight"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { readFs } from '../api/client'
import type { WorkflowUserParamValue } from '../api/workflow'
import {
  SIZE_RATIOS,
  SIZE_RESOLUTIONS,
  computePresetSize,
  resolveSizeMode,
  type SizeMode,
  type SizeRatioKey,
  type SizeResolutionKey,
} from '../utils/workflowSize'

const props = defineProps<{
  /** 项目名（用于「使用项目尺寸」读取 project.json；为空时隐藏该模式） */
  project?: string
  /** 外部初始值/回显（key → 值），含 enable_specified_size / width / height */
  modelValue: Record<string, WorkflowUserParamValue>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: Record<string, WorkflowUserParamValue>): void
}>()

/** 当前选中模式 */
const mode = ref<SizeMode>('none')
/** 比例档 */
const ratio = ref<SizeRatioKey>('9:16')
/** 分辨率档 */
const resolution = ref<SizeResolutionKey>('1080P')
/** 手动填写宽度（像素） */
const manualWidth = ref<number | null>(null)
/** 手动填写高度（像素） */
const manualHeight = ref<number | null>(null)
/** 项目尺寸（project.json），读取失败为 null */
const projectSize = ref<{ width: number; height: number } | null>(null)
/** 自触发标记：组件 emit 后跳过下一次回显，避免反馈循环 */
const skipNextEcho = ref(false)

/** 模式选项（无 project 时隐藏「使用项目尺寸」） */
const modeOptions = computed(() => {
  const options: Array<{ label: string; value: SizeMode }> = [
    { label: '不指定', value: 'none' },
    { label: '比例 + 分辨率', value: 'preset' },
    { label: '手动填写', value: 'manual' },
  ]
  if (props.project) {
    options.push({ label: '使用项目尺寸', value: 'project' })
  }
  return options
})

/**
 * 按当前内部状态输出尺寸值并通知父组件。
 * - none → { enable_specified_size: false }
 * - 其他模式 → { enable_specified_size: true, width, height }
 */
function emitSize() {
  const out: Record<string, WorkflowUserParamValue> = {}
  if (mode.value === 'none') {
    out.enable_specified_size = false
  } else {
    out.enable_specified_size = true
    if (mode.value === 'preset') {
      const s = computePresetSize(ratio.value, resolution.value)
      out.width = s.width
      out.height = s.height
    } else if (mode.value === 'manual') {
      if (manualWidth.value != null) out.width = manualWidth.value
      if (manualHeight.value != null) out.height = manualHeight.value
    } else if (mode.value === 'project') {
      if (projectSize.value) {
        out.width = projectSize.value.width
        out.height = projectSize.value.height
      }
    }
  }
  skipNextEcho.value = true
  emit('update:modelValue', out)
}

/** 切换模式 */
function setMode(v: unknown) {
  mode.value = v as SizeMode
  emitSize()
}

/** 切换比例档 */
function setRatio(v: SizeRatioKey) {
  ratio.value = v
  emitSize()
}

/** 切换分辨率档 */
function setResolution(v: SizeResolutionKey) {
  resolution.value = v
  emitSize()
}

/** 更新手动宽度 */
function setManualWidth(v: unknown) {
  manualWidth.value = v === '' || v === null || v === undefined ? null : Number(v)
  emitSize()
}

/** 更新手动高度 */
function setManualHeight(v: unknown) {
  manualHeight.value = v === '' || v === null || v === undefined ? null : Number(v)
  emitSize()
}

/**
 * 读取项目尺寸（project.json 的 width/height，取整）。
 * 读取失败或无效时置 null（「使用项目尺寸」模式将无法输出尺寸）。
 */
async function loadProjectSize() {
  if (!props.project) {
    projectSize.value = null
    return
  }
  try {
    const data = await readFs(props.project, 'project.json')
    if (data && typeof data === 'object' && 'width' in data && 'height' in data) {
      const w = Math.round(Number((data as { width: unknown }).width))
      const h = Math.round(Number((data as { height: unknown }).height))
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        projectSize.value = { width: w, height: h }
        return
      }
    }
  } catch {
    // project.json 缺失或无效
  }
  projectSize.value = null
}

// 项目变化时重新读取项目尺寸
watch(() => props.project, loadProjectSize, { immediate: true })

// 外部值变化（如表单重置/回显）时推断模式
watch(
  () => props.modelValue,
  (v) => {
    if (skipNextEcho.value) {
      skipNextEcho.value = false
      return
    }
    const inferred = resolveSizeMode({
      enableSpecifiedSize: v.enable_specified_size,
      width: v.width as number | string | undefined,
      height: v.height as number | string | undefined,
      projectSize: projectSize.value,
    })
    mode.value = inferred
    if (inferred === 'preset') {
      const w = Number(v.width)
      const h = Number(v.height)
      const r = SIZE_RATIOS.find((x) => Math.abs(x.ratio - w / h) < 0.01)
      const res = SIZE_RESOLUTIONS.find(
        (x) =>
          (x.baseOn === 'height' && x.base === h) ||
          (x.baseOn === 'width' && x.base === w),
      )
      if (r) ratio.value = r.key
      if (res) resolution.value = res.key
    } else if (inferred === 'manual') {
      manualWidth.value = v.width !== undefined && v.width !== '' ? Number(v.width) : null
      manualHeight.value = v.height !== undefined && v.height !== '' ? Number(v.height) : null
    }
  },
  { immediate: true, deep: true },
)
</script>
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck:frontend`
Expected: 无类型错误

- [ ] **Step 3: Lint + Commit**

Run: `npm run lint`
Expected: 无 ESLint 错误（或仅与本次改动无关的既有告警）

```bash
git add frontend/src/components/WorkflowSizePicker.vue
git commit -m "feat: 新增通用尺寸选择组件 WorkflowSizePicker"
```

---

### Task 5: 前端 — WorkflowParamsForm 集成尺寸组件

**Files:**
- Modify: `frontend/src/components/WorkflowParamsForm.vue`

- [ ] **Step 1: 模板增加尺寸组件并过滤尺寸声明**

在 `frontend/src/components/WorkflowParamsForm.vue` 的模板中：

**1a.** 在 `<template v-for="d in declarations"` 之前插入尺寸组件块，并把 `v-for` 改为遍历 `sizeFilteredDeclarations`：

```vue
<template>
  <div
    v-if="declarations.length"
    class="workflow-params-form"
  >
    <!-- 尺寸参数（width/height）→ 通用尺寸选择组件 -->
    <WorkflowSizePicker
      v-if="sizeKeys"
      :project="project"
      :model-value="sizeModelValue"
      class="mb-2"
      @update:model-value="onSizeChange"
    />

    <template
      v-for="d in sizeFilteredDeclarations"
      :key="d.key"
    >
```

- [ ] **Step 2: Script 增加 props、计算属性与处理函数**

在 `<script setup lang="ts">` 中：

**2a.** 引入依赖：

```typescript
import { computed, ref, watch } from 'vue'
import WorkflowSizePicker from './WorkflowSizePicker.vue'
import { findSizeParamKeys } from '../utils/workflowSize'
import type {
  WorkflowUserParamDeclaration,
  WorkflowUserParamValue,
} from '../api/workflow'
```

（保留原有 `ref, watch` import；新增 `computed`。）

**2b.** props 增加 `project`：

```typescript
const props = defineProps<{
  /** 工作流参数声明列表（来自所选工作流实现） */
  declarations: WorkflowUserParamDeclaration[]
  /** 当前参数值（key → 值），仅用于外部初始化/回显 */
  modelValue: Record<string, WorkflowUserParamValue>
  /** 项目名（用于尺寸组件「使用项目尺寸」读取 project.json） */
  project?: string
}>()
```

**2c.** 新增计算属性与处理函数（放在 `initFromDefaults` 之前）：

```typescript
/** 尺寸相关 key（检测到 width + height 声明时非 null） */
const sizeKeys = computed(() => findSizeParamKeys(props.declarations))

/** 剔除尺寸相关 key 后的声明列表（其余参数仍走通用渲染） */
const sizeFilteredDeclarations = computed(() => {
  if (!sizeKeys.value) return props.declarations
  const excluded = new Set([sizeKeys.value.widthKey, sizeKeys.value.heightKey])
  if (sizeKeys.value.enableKey) excluded.add(sizeKeys.value.enableKey)
  return props.declarations.filter((d) => !excluded.has(d.key))
})

/** 尺寸组件的外部值（仅含 width/height/enable_specified_size 三个 key 的现值） */
const sizeModelValue = computed(() => {
  if (!sizeKeys.value) return {}
  const out: Record<string, WorkflowUserParamValue> = {}
  for (const k of [sizeKeys.value.widthKey, sizeKeys.value.heightKey, sizeKeys.value.enableKey]) {
    if (k && values.value[k] !== undefined) out[k] = values.value[k]
  }
  return out
})

/**
 * 尺寸组件值变化时合并进表单值。
 * 先清除旧的尺寸相关值，再并入组件输出的新值。
 *
 * @param v 组件输出的尺寸值（enable_specified_size/width/height）
 */
function onSizeChange(v: Record<string, WorkflowUserParamValue>) {
  const next = { ...values.value }
  if (sizeKeys.value) {
    for (const k of [sizeKeys.value.widthKey, sizeKeys.value.heightKey, sizeKeys.value.enableKey]) {
      if (k) delete next[k]
    }
  }
  Object.assign(next, v)
  values.value = next
  emit('update:modelValue', { ...next })
}
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck:frontend`
Expected: 无类型错误

- [ ] **Step 4: Lint + Commit**

Run: `npm run lint`
Expected: 无新增 ESLint 错误

```bash
git add frontend/src/components/WorkflowParamsForm.vue
git commit -m "feat: WorkflowParamsForm 检测尺寸参数并渲染通用尺寸组件"
```

---

### Task 6: 前端 — 三个调用方传入 project

**Files:**
- Modify: `frontend/src/components/GenerateDialog.vue`
- Modify: `frontend/src/components/BatchGenerateDialog.vue`
- Modify: `frontend/src/components/canvas/editors/ImageGenerateEditor.vue`

- [ ] **Step 1: GenerateDialog 传入 project**

在 `frontend/src/components/GenerateDialog.vue` 的 `WorkflowParamsForm` 处（现有模板）：

```vue
        <WorkflowParamsForm
          v-if="selectedDeclarations.length"
          ref="paramsFormRef"
          v-model="userValues"
          :declarations="selectedDeclarations"
          class="mb-3"
        />
```

改为（追加 `:project="props.project"`）：

```vue
        <WorkflowParamsForm
          v-if="selectedDeclarations.length"
          ref="paramsFormRef"
          v-model="userValues"
          :declarations="selectedDeclarations"
          :project="props.project"
          class="mb-3"
        />
```

- [ ] **Step 2: BatchGenerateDialog 传入 project**

在 `frontend/src/components/BatchGenerateDialog.vue` 的 `WorkflowParamsForm` 处（现有模板）：

```vue
              <WorkflowParamsForm
                v-if="selectedTypes.includes(at.id)"
                :key="`params-${at.id}-${implSelections[at.id] ?? 'none'}`"
                :declarations="paramsDeclarationsMap[at.id]"
                :model-value="userParamsByAssetType[at.id] ?? {}"
                class="mt-1"
                @update:model-value="(v) => setUserParams(at.id, v)"
              />
```

改为（追加 `:project="props.project"`）：

```vue
              <WorkflowParamsForm
                v-if="selectedTypes.includes(at.id)"
                :key="`params-${at.id}-${implSelections[at.id] ?? 'none'}`"
                :declarations="paramsDeclarationsMap[at.id]"
                :model-value="userParamsByAssetType[at.id] ?? {}"
                :project="props.project"
                class="mt-1"
                @update:model-value="(v) => setUserParams(at.id, v)"
              />
```

- [ ] **Step 3: ImageGenerateEditor 传入 project**

在 `frontend/src/components/canvas/editors/ImageGenerateEditor.vue` 的 `WorkflowParamsForm` 处（现有模板）：

```vue
    <WorkflowParamsForm
      v-model="workflowParams"
      :declarations="currentDeclarations"
    />
```

改为（追加 `:project="props.project"`）：

```vue
    <WorkflowParamsForm
      v-model="workflowParams"
      :declarations="currentDeclarations"
      :project="props.project"
    />
```

- [ ] **Step 4: 类型检查 + Lint**

Run: `npm run typecheck:frontend`
Expected: 无类型错误

Run: `npm run lint`
Expected: 无新增 ESLint 错误

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/GenerateDialog.vue frontend/src/components/BatchGenerateDialog.vue frontend/src/components/canvas/editors/ImageGenerateEditor.vue
git commit -m "feat: 生成对话框传入项目名以支持项目尺寸模式"
```

---

### Task 7: 全量验证

**Files:** 无（仅验证）

- [ ] **Step 1: 类型检查**

Run: `npm run typecheck`
Expected: 服务端 + 前端均无类型错误

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 无 ESLint 错误

- [ ] **Step 3: 服务端测试**

Run: `cd server && npm test`
Expected: 全部通过（含新增 `bridge-client.test.ts`）

- [ ] **Step 4: 前端测试**

Run: `cd frontend && npm test`
Expected: 全部通过（含新增 `workflowSize.test.ts`）

- [ ] **Step 5: 手动冒烟验证**

1. `npm run dev` 启动前后端
2. 打开任意项目 → 分镜场景图生成对话框（`GenerateDialog`），选择图片编辑工作流
3. 确认出现「输出尺寸」选择组件，默认「不指定」
4. 切换「比例 + 分辨率」→ 确认 `values` 输出 `enable_specified_size: true` + 换算宽高
5. 切换「使用项目尺寸」→ 确认输出 `project.json` 的宽高
6. 切换「手动填写」→ 自由输入宽高
7. 提交生成，确认服务端日志中任务 vars 含尺寸参数、Bridge 收到 `enable_specified_size`/`width`/`height`

---

## 自审记录

- **Spec 覆盖**：服务端 3 处改动（Task 1/2）、前端纯函数（Task 3）、组件（Task 4）、表单集成（Task 5）、调用方（Task 6）、边界情况与测试（贯穿各 Task + Task 7）——设计文档各节均有对应任务。
- **占位符**：无 TBD/TODO，每个代码步骤均给出完整代码。
- **类型一致性**：`resolveImageEditSizeParams`（服务端）返回 `ImageEditSizeParams`；前端 `computePresetSize`/`resolveSizeMode`/`findSizeParamKeys` 在 Task 3 定义、Task 4/5 使用，签名一致。
