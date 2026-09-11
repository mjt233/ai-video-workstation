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
- **档位注册表扩展**：新增 480P/768P/1K/1.5K/3K（**基准值恒为输出短边**，横屏落在高度、竖屏落在宽度，P 档与 K 档同一规则——见下方「修复记录（2026-09）：K 档基准改为短边」）
- **服务商消费**：火山方舟保留 `resolveSeedreamSize` 大小约束（sizeConfig 宽高优先、超出自动匹配最接近允许尺寸）；MiniMax r2v 优先消费 `sizeConfig.ratio`（i2v 恒 adaptive）；OpenAI 兼容宽高直传 `"WxH"`；Bridge 保留 width/height 直传
- **调用方**：GenerateDialog / BatchGenerateDialog（按资产类型）/ 画布图片节点（`config.sizeConfig`）/ 画布视频节点（`config.sizeConfig` → `video.sizeConfig`）全部接通

## 修复记录（2026-09）：Bridge 文生图/图片编辑尺寸配置不生效

**问题**：画布生成图片节点选择「文生图-Krea2」+ 16:9 / 2K，Bridge 仍收到 1920×1080（项目尺寸）。

**根因**：`bridge-sync.ts` 的 `textToImageSubmit` / `imageEditSubmit` 自写了一套尺寸解析，只读
`ctx.vars.width/height`，**从不读 `ctx.sizeConfig`**；画布节点只提交 `params.sizeConfig`
（vars 里没有宽高）→ 一律回退 `projectConfig`。同一次重构中 Seedream / OpenAI 兼容 /
MiniMax / 自定义服务商都已接入 `sizeConfig`，唯独漏了 Bridge 这一路，且
`bridge-sync.test.ts` 的尺寸用例上下文里没有 `sizeConfig` 字段，因此测试未拦住。

**根治（消除「每个服务商一套优先级」的结构性问题）**：新增
`server/src/workflows/size.ts` 作为**服务端唯一的尺寸解析权威**：

1. **档位表**（`SIZE_RATIOS` / `SIZE_RESOLUTIONS` / `resolvePresetSize`）——前端
   `frontend/src/utils/workflowSize.ts` 档位表的服务端镜像，使「比例 × 分辨率档」在
   服务端也能换算为具体宽高（此前服务端完全没有换算能力，只存 `{ratio,size}` 的
   `sizeConfig` 无法产出尺寸）；
2. **统一解析器** `resolveOutputSize({ sizeConfig, enableSpecified, vars, userParams, fallbackWidth, fallbackHeight })`
   ——优先级：`sizeConfig` 显式宽高 → `sizeConfig` 档位换算 → 旧版 vars/userParams 宽高
   → 项目尺寸；
3. **旧版门控四态** `resolveSpecifiedGate`（`off` / `on` / `default-strict` /
   `default-permissive`）——把「各实现历史缺省语义不同」这一事实显式化：Bridge 缺省宽松
   （`enable_specified_size` 通常不在 Bridge 工作流参数里，vars 宽高有效即采用），
   Seedream / OpenAI 兼容缺省严格（必须显式开启）；显式 `'false'`（前端「不指定」）恒为 `off`；
4. **旧版参数声明常量** `SIZE_PARAMS`——火山方舟文生图/图片编辑、OpenAI 兼容三处重复的
   `enable_specified_size/width/height` 声明合并为一处。

**接入范围**：`bridge-sync.ts`（文生图 + 图片编辑）、`text-to-image/seedream.ts`、
`image-edit/seedream.ts`、`openai-compatible-sync.ts` 全部改为调用统一解析器；
`seedream.ts` 中的 `resolveSeedreamOutputSize`（旧版三优先级实现）已删除，调用方直接用
`resolveOutputSize`；`bridge-client.ts` 的 `resolveImageEditSizeParams` 签名由「读 vars」
改为「消费已解析宽高 + specified」，职责收敛为「宽高 → 载荷字段」。

**顺带修正的行为**：`sizeConfig` 仅含比例/尺寸档（工作流不支持自定义宽高，如
`supportCustomSize: false` 的自定义服务商工作流）时，此前一律回退项目尺寸、用户选的比例
被静默丢弃；现在按档位表换算（并仍经各服务商自身的尺寸约束校验，如 Seedream 的总像素
上下限）。火山方舟图片编辑在「用户从未配置过尺寸」时仍**省略 size**、交由模型默认档位
（未被本次改造波及）。

## 修复记录（2026-09）：K 档基准改为「输出短边」

**问题**：9:16 / 2K 提交给 Bridge 的是 `2560×4551`（旧 K 档「基准落在宽度」的产物），
期望 `1440×2560`。前端 `computePresetSize` 与服务端镜像当时**都**算出 2560×4551
（两侧一致，不是同步 bug），分歧在基准取哪一边。

**规则变更**：分辨率档的 `base` **恒为输出短边**，P 档与 K 档统一：

- 横屏/正方形（比例 ≥ 1）：`height = base`、`width = round(base × 比例)`；
- 竖屏（比例 < 1）：`width = base`、`height = round(base ÷ 比例)`。

`base` 取值随之修正为「该档标准短边」，**各档由业务方逐档确认，非统一倍数公式**：

| 档位 | base（短边） | 16:9 产出 | 9:16 产出 |
| --- | --- | --- | --- |
| 360P / 480P / 720P / 768P / 1080P | 360 / 480 / 720 / 768 / 1080 | 640×360 … 1920×1080 | 360×640 … 1080×1920 |
| 1K | 1024 | 1820×1024 | 1024×1820 |
| 1.5K | 1536 | 2731×1536 | 1536×2731 |
| **2K** | **1440** | **2560×1440** | **1440×2560** |
| 3K | 1620 | 2880×1620 | 1620×2880 |
| **4K** | **2160** | **3840×2160** | **2160×3840** |
| 8K | 4320 | 7680×4320 | 4320×7680 |

注意 K 档数字只是档位称呼，**不等于 base**（`2K` base 为 1440，`4K` base 为 2160）；
原实现把 K 档 base 当作宽度（`2K`=2560、`4K`=3840、`8K`=7680），竖屏因此产出
`2560×4551` 这类超大图。

**变更后取值**（2K）：

| 比例 | 变更前 | 变更后 |
| --- | --- | --- |
| 16:9 | 2560×1440 | 2560×1440（不变） |
| 9:16 | **2560×4551** | **1440×2560** |
| 1:1 | 2560×2560 | 1440×1440 |
| 4:3 | 2560×1920 | 1920×1440 |
| 3:4 | 2560×3413 | 1440×1920 |
| 21:9 | 2560×1097 | 3360×1440 |

**变更后取值**（4K）：

| 比例 | 变更前 | 变更后 |
| --- | --- | --- |
| 16:9 | 6827×3840 | **3840×2160** |
| 9:16 | 3840×6827 | **2160×3840** |
| 1:1 | 3840×3840 | 2160×2160 |

**有利副作用**：16:9 全部档位均为常见规格（1920×1080 / 2560×1440 / 3840×2160 / 7680×4320），
画布中已有的横屏 16:9 节点（项目 `p` 现存全部节点均为 16:9，档位 768P/1080P/2K）
**取值未变、无需回写**；竖屏节点的 `sizeConfig` 通常带显式宽高（旧数据由
`inferSizeConfigFromWidthHeight` 反推、新数据由组件写入），显式宽高优先级更高，也不会被
静默改写——只有「仅存档位、无宽高」的节点会按新规则换算。

**同步修改**：`frontend/src/utils/workflowSize.ts`（`SIZE_RESOLUTIONS` 去掉 `baseOn`、
`computePresetSize` 统一短边规则、`resolveSizeMode` 的档位反查改用 `min(w,h)`）与
`server/src/workflows/size.ts`（镜像同上），两侧必须同步改。

**端到端验证**（项目尺寸故意设为 1920×1080 以区分「项目尺寸」与「档位尺寸」，Krea2 实跑）：

| 用例 | Bridge 实收 params | 产物实际尺寸 |
| --- | --- | --- |
| 16:9 / 2K（显式宽高 2560×1440） | `width:2560, height:1440` | 2560×1440 ✓ |
| 9:16 / 2K（仅档位） | `width:1440, height:2560` | 1440×2560 ✓ |

**已知边界（非本模块问题）**：档位换算结果不保证是 8 的倍数
（如 16:9 + 1K = 1820×1024，1820 不是 8 的倍数）。潜空间类工作流（Krea2 的
`EmptyLatentImage`）会把它对齐到 8 的倍数产出（实测 1816×1024）——Bridge 与 ComfyUI
收到的参数值均为 1820，对齐发生在 ComfyUI 内部，属预期行为。
