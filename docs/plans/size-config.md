# 统一尺寸参数控制

所有工作流的尺寸参数交互方式进行重构。

## 工作流兼容性声明

`capabilities`新增兼容性属性声明字段：`size`

```ts
interface WorkflowImplementation {
  capabilities?: {
    size?: {
      // 支持的比例，默认取 16:9,4:3,1:1,3:4,9:16,auto
      ratio?: string[]
      // 支持的尺寸，默认取 360P,720P,1080P,2K,4K,auto
      size?: string[]
      // 默认取true
      supportCustomSize?: boolean
    }
  }
}
```

| key | 示例值 | 含义 | 默认值 |
| --- | --- | --- | ---- |
| ratio | 16:9,4:3,auto | 支持的比例 | 16:9.4:3,1:1,3:4,9:16,auto |
| size | 1K,2K,4K,auto | 支持的尺寸 | 360P,720P,1080P,2K,4K,auto |
| supportCustomSize | false | 是否支持自定义指定任意高宽 | false |

## 工作流尺寸配置交互组件

不再通过选择“输出尺寸”的类型，再选择“比例”和“分辨率”的多个v-select表单控件联动了，改为以下方式：

正常状态下仅显示一行文字，如：`16:9 / 1K`，`自动 / 自动`, `自动 / 2K`，`1:1 / 2K / 1024x1024`。即显示为`{比例} / {尺寸} / {自定义宽x自定义高}`。

> 当工作流不支持自定义尺寸时，不显示自定义宽高

点击这行文字时，通过v-menu打开尺寸配置组件，组件布局为：

```
比例
【如果有auto，则“自适应”放在第一个】【1:1】【4:3】【16:9】
【9:16】【动态按钮组】

分辨率
【2K】【4K】

宽度
【输入框】

高度
【输入框】
```

- 当工作流不支持自定义尺寸时，不显示宽度和高度
- 当工作流支持自定义尺寸时，显示宽度和高度，修改比例或分辨率后，自动设置对应的高宽。手动修改高宽后，比例或分辨率按钮组不用动。

## 工作流参数传递

1. 工作流支持指定任意高宽时，兼容原逻辑，直接传height和width字段。
2. 只要工作流存在`capabilities.size`，工作流调用时都要传递`sizeConfig`对象，包含用户选择的原始完整尺寸配置，如：`{ ratio: "1:1", size: "1K", width: 1024, height: 1024 }`。如果不支持指定任意高宽，`sizeConfig`里的`width`和`height`可以不加。

## 已有的服务商工作流尺寸配置

### 火山方舟

比例：1:1,4:3,3:4,16:9,9:16,3:2,2:3,21:9
尺寸：1K,2K
支持指定尺寸

指定尺寸的大小约束规则需要保留

### MiniMax

比例：21:9、16:9、4:3、1:1、3:4、9:16、adaptive
尺寸：768P, 2K
不支持指定尺寸

### OpenAI兼容

已规划（2026-08 实施）：

比例：16:9,4:3,1:1,3:4,9:16,auto
尺寸：auto
支持指定尺寸（宽高直传 `"WxH"`，缺失回退 projectConfig）

### ComfyUI Easy Bridge

仅针对文生图、图片编辑、图生视频、文生视频：


比例：16:9,9:16,3:2,2:3,21:9,1:1,4:3,3:4
尺寸：360P,480P,720P,768P,1080P,2K,4K
支持指定尺寸

### 自定义服务商

已规划（2026-08 实施）：

- 工作流条目新增「输出尺寸配置」（`sizeConfig`）：允许比例 / 允许尺寸（候选全集，空 = 默认全量）/ 是否允许指定分辨率（`supportCustomSize`），仅生图（text-to-image、image-edit）与生视频（image-to-video）类型显示；TTS 类型不声明
- 注册时映射为 `capabilities.size`（未配置条目 = 默认全量），统一尺寸组件自动按声明渲染选项
- 自定义脚本通过 `ctx.params.sizeConfig` 获取：`{ ratio, size, width?, height? }`（与现有扁平 `width/height` 并存兼容）
- Monaco 代码提示：按条目配置生成 `CustomSizeConfig` 字面量联合类型（如 `ratio?: '16:9' | '4:3' | 'auto'`），随配置实时刷新

---

## 实施记录（2026-08 落地）

- **wire**：新增顶层 `params.sizeConfig`（与 userParams/video 同级），路由持久化到任务 params，`parseTaskParams` 返回，引擎注入 `ctx.sizeConfig`（视频类工作流回退 `video.sizeConfig`）；`VideoWorkflowSubmitParams/Data` 增加可选 `sizeConfig`
- **前端**：`WorkflowSizePicker` 重写为「单行文字（`{比例} / {尺寸} [/ 宽x高]`）+ v-menu 配置面板」，比例/尺寸按钮组 + 自定义宽高输入；`WorkflowParamsForm` 在 `capabilities.size` 或 width/height 声明存在时渲染，并继续兼容回写 `enable_specified_size/width/height` 标量；旧数据（仅宽高）经 `inferSizeConfigFromWidthHeight` 反推回显
- **档位注册表扩展**：新增 480P/768P/1K/1.5K/3K（P 档按高度基准、K 档按宽度基准）
- **服务商消费**：火山方舟保留 `resolveSeedreamSize` 大小约束（sizeConfig 宽高优先、超出自动匹配最接近允许尺寸）；MiniMax r2v 优先消费 `sizeConfig.ratio`（i2v 恒 adaptive）；OpenAI 兼容宽高直传 `"WxH"`；Bridge 保留 width/height 直传
- **调用方**：GenerateDialog / BatchGenerateDialog（按资产类型）/ 画布图片节点（`config.sizeConfig`）/ 画布视频节点（`config.sizeConfig` → `video.sizeConfig`）全部接通