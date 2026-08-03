# 工作流尺寸参数暴露与通用尺寸选择组件设计

**日期：** 2026-08-03
**状态：** 设计稿

## 概述

ComfyUI Easy Bridge 图片编辑工作流 `qwen-edit-2509` 新增了 3 个自定义参数（`enable_specified_size`、`width`、`height`），需要暴露到用户层面，让用户能够手动配置输出图片的宽高。

当前 `submitImageEdit` 未透传这 3 个参数；且 `WorkflowParamsForm` 对整数/小数参数一律渲染数字输入框。本次改动：

1. **服务端**：image-edit 工作流声明这 3 个用户参数，并在提交时真正透传给 Bridge。
2. **前端**：新增**通用尺寸选择组件** `WorkflowSizePicker`；当工作流声明了 `width` + `height` 用户参数时，`WorkflowParamsForm` 不再渲染 2 个数字输入框，改为渲染该组件。组件提供四种模式：**比例×分辨率组合 / 手动填写 / 使用项目尺寸 / 不指定**。

已确认的产品细节：

- 分辨率换算：P 档（360P/720P/1080P）基准落在**短边**（横屏为高度、竖屏为宽度）；K 档（2K/4K/8K）按**宽度**为基准；另一维按所选比例换算（已确认：9:16 + 1080P → 1080×1920）。
- 「使用项目尺寸」：读取 `design/{project}/project.json` 的 `width`/`height` 作为输出尺寸（`enable_specified_size=true`）。
- 组件默认模式：**不指定**。
- 「手动填写」：宽高两个输入框独立填写，互不联动。
- `enable_specified_size` 由组件内部托管，不再单独显示布尔开关。
- 选择比例+分辨率后**不**展示换算结果。

## 实现方案

采用**约定式检测**：`WorkflowParamsForm` 检测声明列表中存在 key 为 `width` 且 `height` 的声明时，渲染 `WorkflowSizePicker`，并从通用渲染循环中剔除 `width`/`height`/`enable_specified_size` 三个 key。

## 服务端改动

### `server/src/workflows/vars.ts`

扩展 `ImageEditVars`，新增 3 个可选字段（字符串形式，与其他 vars 一致）：

```typescript
/** 可选：是否启用指定输出尺寸（"true"/"false"） */
enable_specified_size?: string;
/** 可选：输出宽度（像素，字符串形式，enable_specified_size=true 时生效） */
width?: string;
/** 可选：输出高度（像素，字符串形式，enable_specified_size=true 时生效） */
height?: string;
```

### `server/src/workflows/image-edit/default.ts`

在 `params` 声明中追加 3 个用户参数（布尔/整数类型，默认值为空串表示不传）：

```typescript
params: [
  { key: 'enable_multiple_angles_lora', /* 已有，不变 */ },
  { key: 'enable_specified_size', name: '指定输出尺寸', defaultValue: false, type: 'boolean' },
  { key: 'width', name: '输出宽度', defaultValue: '', type: 'integer' },
  { key: 'height', name: '输出高度', defaultValue: '', type: 'integer' },
]
```

### `server/src/workflows/bridge-client.ts`

**`submitImageEdit`**：传入的 `enable_specified_size`/`width`/`height` 非空时追加进 `textParams` 提交给 Bridge：

```typescript
if (params.enable_specified_size != null) textParams.enable_specified_size = params.enable_specified_size;
if (params.width != null) textParams.width = params.width;
if (params.height != null) textParams.height = params.height;
```

**`createImageEditWorkflow.submit`**：从 `params.vars` 读取这 3 个值——仅当 `vars.enable_specified_size === 'true'` 时才带上尺寸（对应「不指定」模式时完全不带），`width`/`height` 转数字后透传：

```typescript
const vars = params.vars as ImageEditVars & Record<string, string>;
let enableSpecifiedSize: boolean | undefined;
let width: number | undefined;
let height: number | undefined;
if (vars.enable_specified_size === 'true') {
  enableSpecifiedSize = true;
  if (vars.width) width = Number(vars.width);
  if (vars.height) height = Number(vars.height);
}
const result = await submitImageEdit({ imgs, desc, seed, enable_specified_size: enableSpecifiedSize, width, height });
```

> 说明：`normalizeUserParams` 已保证 `enable_specified_size=false` 会写入 vars（字符串 `"false"`），因此「不指定」时 `=== 'true'` 为假，任何尺寸参数都不会发送。

## 前端改动

### 新组件 `frontend/src/components/WorkflowSizePicker.vue`

**Props**：

```typescript
{
  /** 项目名（用于「使用项目尺寸」读取 project.json） */
  project: string
  /** 外部初始值/回显（key → 值），含 enable_specified_size / width / height */
  modelValue: Record<string, WorkflowUserParamValue>
}
```

**内部状态**：

```typescript
type SizeMode = 'preset' | 'manual' | 'project' | 'none'

mode: SizeMode                    // 默认 'none'
ratio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'   // 默认 '9:16'
resolution: '360P' | '720P' | '1080P' | '2K' | '4K' | '8K'  // 默认 '1080P'
manualWidth: number
manualHeight: number
projectSize: { width: number; height: number } | null
```

**输出**（emit 到父组件，key 为 `enable_specified_size`/`width`/`height`）：

| 模式 | 输出 |
|---|---|
| `none`（不指定） | `{ enable_specified_size: false }` |
| `preset`（比例+分辨率） | `{ enable_specified_size: true, width, height }`（按换算规则计算） |
| `manual`（手动填写） | `{ enable_specified_size: true, width: manualWidth, height: manualHeight }` |
| `project`（使用项目尺寸） | `{ enable_specified_size: true, width: projectSize.width, height: projectSize.height }` |

**换算规则**（P 档基准落在短边、K 档按宽度）：

| 分辨率 | 基准 | 值 |
|---|---|---|
| 360P | 高 | 360 |
| 720P | 高 | 720 |
| 1080P | 高 | 1080 |
| 2K | 宽 | 2560 |
| 4K | 宽 | 3840 |
| 8K | 宽 | 7680 |

- P 档横屏（比例 ≥ 1）：`height = 基准`，`width = round(height × ratio)`（如 16:9 + 1080P → 1920×1080）
- P 档竖屏（比例 < 1）：`width = 基准`，`height = round(width ÷ ratio)`（如 9:16 + 1080P → 1080×1920）
- K 档：`width = 基准`，`height = round(width ÷ ratio)`（如 16:9 + 4K → 3840×2160；9:16 + 4K → 3840×6827）

**「使用项目尺寸」**：组件挂载及 `project` 变化时，用 `readFs(project, 'project.json')` 读取 `width`/`height`，取整后存入 `projectSize`；读取失败时置 `null` 并回退为 `none`（或提示）。

**回显逻辑**（`modelValue` 变化时）：
- `enable_specified_size === false` 或缺失、且无有效 `width`/`height` → `none`
- 有有效 `width`/`height`：尝试匹配预设（宽高比能匹配某个比例档、且基准能匹配某个分辨率档）→ `preset`；否则 → `manual`
- 有有效 `width`/`height` 且恰好等于 `projectSize` → `project`

### `frontend/src/components/WorkflowParamsForm.vue`

- 新增可选 prop `project?: string`
- 检测规则：声明列表中存在 key 为 `width` 且 `height` 的声明 → 渲染 `WorkflowSizePicker`，并从通用渲染循环中剔除 `width`/`height`/`enable_specified_size` 三个 key
- `WorkflowSizePicker` 的值变化时合并进 `values` 并 emit，与现有 `setValue` 机制一致

### 调用方接入

以下三处调用 `WorkflowParamsForm` 时传入 `:project`：

- `frontend/src/components/GenerateDialog.vue`
- `frontend/src/components/BatchGenerateDialog.vue`
- `frontend/src/components/canvas/editors/ImageGenerateEditor.vue`

（三处均有 `project` prop / 变量。）

## 数据流

```
用户选择模式 → WorkflowSizePicker 输出 enable_specified_size/width/height
  → WorkflowParamsForm.values → userParams
  → POST /api/workflow/run → normalizeUserParams 规范化进 vars
  → createImageEditWorkflow.submit 读 vars → submitImageEdit → Bridge(qwen-edit-2509)
```

## 边界情况

- **不指定**：`enable_specified_size=false` 写入 vars；submit 时因不等于 `'true'` 而不带任何尺寸参数 → Bridge 用工作流默认。
- **手动填写为空**：`width`/`height` 为空串 → `normalizeUserParams` 跳过，只传 `enable_specified_size=true`，Bridge 按输入图尺寸推断（若工作流支持）。
- **多图编辑**：尺寸参数与图片数量无关，不受影响。
- **project.json 缺失/读取失败**：`projectSize` 为 `null`，「使用项目尺寸」模式不可用，回退 `none`。
- **项目宽高为非整数**：取整后使用。

## 测试

- 服务端：`coerceUserParamValue`/`normalizeUserParams` 对 `enable_specified_size`/`width`/`height` 的规范化（布尔/整数）——已有单测覆盖通用逻辑，补充断言可选。
- 前端：`WorkflowSizePicker` 换算函数（预设档 × 比例 → 宽高）单测；`WorkflowParamsForm` 检测到 width/height 时渲染尺寸组件而非两个输入框。
- 约束：修改后执行 `npm run typecheck` 与 `npm run lint`。

## 不在本次范围

- 不新增 `WorkflowUserParamDeclaration.widget` 字段（方案 B 被否决）。
- 不把 text-to-image 的 `getWidth`/`getHeight` 改为用户参数（本次仅 image-edit 暴露尺寸；组件保持通用，未来可复用）。
- 不展示换算结果、不做手动填写与比例联动。
