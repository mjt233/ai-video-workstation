# 项目资源放置规则

本文说明 `design/{project}/prompt` 与 `design/{project}/assert` 的目录约定、文件职责与生成映射。

系统以**文件系统即数据库**：文本原型写在 `prompt/`，生成产物写在 `assert/`。两者路径尽量镜像，但扩展名与子目录语义不同。

---

## 1. 项目根目录

```
design/{project}/
├── overview.md          # 项目总览（剧情、角色/场景表、前置设定）
├── project.json         # 结构化配置（width / height / aspectRatio）
├── prompt/              # 文本原型、引用关系、生成提示词
└── assert/              # 图片 / 音频 / 视频等二进制产物
```

| 路径 | 职责 |
|------|------|
| `overview.md` | 项目级总览，供人工阅读与脚本识别项目 |
| `project.json` | 分辨率、画面比例、帧率（`fps`）等；工作流引擎会注入 `projectConfig` |
| `prompt/` | 可编辑的 Markdown / JSON 原型 |
| `assert/` | 工作流输出；创建资产时**不**预生成 |

**命名约定：**

- 角色名、场景名目录优先使用中文（外国人名/外国地名除外）
- 名称不能为空、不能有首尾空白，不能包含 `\ / : * ? " < > |`
- 集数、分镜目录名必须是正整数，且同一集内分镜编号连续为 `1..N`

**API 写入范围：** 允许写入 `prompt/`、`assert/` 前缀，以及项目根级 `overview.md`、`project.json`；路径不得越出 `design/{project}/`。

---

## 2. `prompt/` — 文本原型

```
prompt/
├── character/{角色名}/
│   ├── overview.md      # 角色总览
│   ├── appearance.md    # 外观文生图提示词
│   └── voice.md         # 声线描述
├── stage/{场景名}/
│   └── {完整场景标签}.md # 子场景画面描述
└── scene/{集数}/{分镜}/
    ├── overview.json    # 分镜叙事总览（title/beat/visual/camera/duration/mood）
    ├── stage.json       # 关键帧定义（引用场景/角色）
    ├── script.json      # 台词列表
    └── prompt.md        # 图生视频提示词
```

### 2.1 角色 `prompt/character/{角色名}/`

| 文件 | 用途 |
|------|------|
| `overview.md` | 姓名、性别、年龄、性格、背景、关系 |
| `appearance.md` | 三视角全身图要求 + 结构化外貌描述，供 `character-appearance` |
| `voice.md` | 1–3 句自然语言声线描述，供 `character-voice` / `scene-tts` |

创建角色时会按模板生成上述三个文件；目录名即角色唯一 ID。

### 2.2 场景 `prompt/stage/{场景名}/`

- 场景目录：`prompt/stage/{场景名}/`（可先建空目录）
- 子场景文件：`prompt/stage/{场景名}/{完整场景标签}.md`

**完整场景标签**建议格式：

```text
{场景名}-{时间}-{角度}-{天气/光线}-{子区域}
```

示例：`便利店内部-夜晚-平视-冷白霓虹-收银台`

子场景 Markdown 通常包含：时间、角度、天气/光线、画面描述、主色调。  
该文件供 `stage-image` 文生图使用。

### 2.3 分镜 `prompt/scene/{集数}/{分镜}/`

- 集数从 `1` 起；每集分镜独立从 `1` 起，且保持连续无跳号
- 新建分镜时固定生成四个文件：

| 文件 | 格式 | 用途 |
|------|------|------|
| `overview.json` | JSON 对象 | 标题、叙事节拍、画面、运镜、时长（秒）、情绪 |
| `stage.json` | JSON 数组 | 静态关键帧（首/中/尾帧） |
| `script.json` | JSON 数组 | 台词顺序表 |
| `prompt.md` | 纯文本 | 图生视频正向提示词（建议英文） |

#### `overview.json`

```json
{
  "title": "书生初临",
  "beat": "建立镜头……",
  "visual": "商场正门入口……",
  "camera": "slow zoom in",
  "duration": 5,
  "mood": "困惑、陌生、好奇"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | string | 分镜标题 |
| `beat` | string | 叙事节拍 |
| `visual` | string | 画面描述 |
| `camera` | string | 镜头运动 |
| `duration` | number | 时长（秒，**正整数**，须 `> 0`；默认 `5`） |
| `mood` | string | 情绪基调 |

#### `stage.json`

每个元素描述一帧：

```json
[
  {
    "基础场景": "{场景名}/{完整场景标签}",
    "登场角色": ["{角色名}"],
    "prompt": "图像1为背景：...；图像2在场景中..."
  }
]
```

约束：

| 规则 | 说明 |
|------|------|
| `基础场景` 必填 | 格式 `场景名/标签`，对应 `prompt/stage/{场景名}/{标签}.md` 与 `assert/stage/{场景名}/{标签}.jpg` |
| 直接引用 | `登场角色` 与 `prompt` **同时为空**：引擎复制基础场景图，不调用图像编辑 |
| 合成/修改 | `prompt` 必填；有角色时角色须存在，且 `登场角色` 长度建议 ≤ 2 |
| 禁止 | 仅有角色、`prompt` 为空 |
| 运镜 | 不写在 `stage.json` 的 `prompt` 中，写在 `prompt.md` |
| 图像编号 | 图像1=基础场景图，图像2/3=登场角色外观图 |

数组长度含义：

- 1 项：仅首帧
- 2 项：首帧 + 尾帧
- 3 项：首帧 + 中帧 + 尾帧

#### `script.json`

```json
[
  {
    "角色名": "{角色名}",
    "台词": "...",
    "情绪": "平静"
  }
]
```

- 按对白出现顺序排列；无对白则为 `[]`
- 角色名应在对应分镜 `stage.json` 的 `登场角色` 中声明（业务约定）

#### `prompt.md`

- 纯文本，无 Markdown 标题
- 仅正向提示词；运镜写在此处
- 有台词时，应把台词原文嵌入动作描述以引导嘴型

---

## 3. `assert/` — 生成产物

```
assert/
├── character/{角色名}/
│   ├── appearance.jpg   # 角色外观图
│   └── voice.flac       # 角色声线样本
├── stage/{场景名}/
│   └── {完整场景标签}.jpg
└── scene/{集数}/{分镜}/
    ├── stage/{index}.jpg
    ├── voice/{index}-{角色名}.flac
    └── video/{index}.mp4
```

创建角色/场景/分镜时**不会**预创建 `assert` 文件；由工作流或批量发现任务写入。

### 3.1 角色产物

| 路径 | 来源工作流 | 输入 prompt |
|------|------------|-------------|
| `assert/character/{name}/appearance.jpg` | `character-appearance` | `prompt/character/{name}/appearance.md` |
| `assert/character/{name}/voice.flac` | `character-voice` | `prompt/character/{name}/voice.md` |

### 3.2 场景产物

| 路径 | 来源工作流 | 输入 prompt |
|------|------------|-------------|
| `assert/stage/{场景名}/{标签}.jpg` | `stage-image` | `prompt/stage/{场景名}/{标签}.md` |

**镜像规则：** 子场景 `.md` 与 `.jpg` 同名（仅扩展名不同）。

### 3.3 分镜产物

| 路径 | 来源工作流 | 说明 |
|------|------------|------|
| `assert/scene/{ep}/{shot}/stage/{index}.jpg` | `scene-stage-image` | `index` 为 `stage.json` 数组下标（从 0） |
| `assert/scene/{ep}/{shot}/voice/{index}-{角色名}.flac` | `scene-tts` | `index` 为 `script.json` 下标；引擎强制该输出路径 |
| `assert/scene/{ep}/{shot}/video/{index}.mp4` | `video-generate` | 当前 UI 默认 `video/0.mp4` |

#### 分镜场景图生成逻辑

1. 读取 `prompt/scene/{ep}/{shot}/stage.json[index]`
2. **直接引用**（无角色且 `prompt` 为空）：  
   复制 `assert/stage/{场景}/{标签}.jpg` → `assert/scene/{ep}/{shot}/stage/{index}.jpg`
3. **合成**：  
   - 图像1：`assert/stage/{场景}/{标签}.jpg`  
   - 图像2+：`assert/character/{角色}/appearance.jpg`  
   - 文本：条目内 `prompt`  
   输出到 `assert/scene/{ep}/{shot}/stage/{index}.jpg`

#### 分镜台词 TTS

引擎根据 `script.json[index]` 注入：

- `character` / `text` / `emotion`
- `voiceDesc` ← `prompt/character/{角色名}/voice.md`

输出固定为：

```text
assert/scene/{ep}/{shot}/voice/{index}-{角色名}.flac
```

---

## 4. prompt ↔ assert 对照总表

| 类型 | prompt 路径 | assert 路径 |
|------|-------------|-------------|
| 角色外观 | `prompt/character/{name}/appearance.md` | `assert/character/{name}/appearance.jpg` |
| 角色声音 | `prompt/character/{name}/voice.md` | `assert/character/{name}/voice.flac` |
| 角色总览 | `prompt/character/{name}/overview.md` | （无对应产物） |
| 子场景 | `prompt/stage/{stage}/{label}.md` | `assert/stage/{stage}/{label}.jpg` |
| 分镜总览 | `prompt/scene/{ep}/{shot}/overview.json` | （无对应产物） |
| 分镜关键帧定义 | `prompt/scene/{ep}/{shot}/stage.json` | `assert/scene/{ep}/{shot}/stage/{i}.jpg` |
| 分镜台词 | `prompt/scene/{ep}/{shot}/script.json` | `assert/scene/{ep}/{shot}/voice/{i}-{角色}.flac` |
| 分镜视频提示词 | `prompt/scene/{ep}/{shot}/prompt.md` | `assert/scene/{ep}/{shot}/video/{i}.mp4` |

原则：

1. **prompt 描述“要生成什么 / 如何引用”**
2. **assert 存放“已经生成的媒体文件”**
3. 角色与场景尽量 **同路径镜像**（`character/...`、`stage/...`）
4. 分镜媒体在 `assert/scene/...` 下按用途分子目录：`stage/`、`voice/`、`video/`

---

## 5. 生命周期与同步规则

### 5.1 创建

| 对象 | 落盘 |
|------|------|
| 角色 | 仅 `prompt/character/{name}/` 三文件 |
| 场景 | 仅 `prompt/stage/{name}/` 目录 |
| 子场景 | 仅 `prompt/stage/{stage}/{label}.md` |
| 集数 | 仅 `prompt/scene/{ep}/` |
| 分镜 | `prompt/scene/{ep}/{shot}/` 四文件；assert 不预建 |

### 5.2 删除（成对清理）

| 对象 | 删除 prompt | 删除 assert |
|------|-------------|-------------|
| 角色 | `prompt/character/{name}/` | `assert/character/{name}/` |
| 场景 | `prompt/stage/{name}/` | `assert/stage/{name}/` |
| 子场景 | `{label}.md` | `{label}.jpg`（若存在） |
| 分镜 | `prompt/scene/{ep}/{shot}/` | `assert/scene/{ep}/{shot}/` |
| 集数 | `prompt/scene/{ep}/` | `assert/scene/{ep}/` |

引用保护：

- 删除角色：扫描全项目 `stage.json` / `script.json` 是否引用
- 删除场景/子场景：扫描 `stage.json` 的 `基础场景`
- 有引用则拒绝删除（`IN_USE`）

### 5.3 分镜编号 rename

同一集内分镜目录名始终为连续 `1..N`。  
`prompt/scene/{ep}/{id}` 与 `assert/scene/{ep}/{id}` **成对** rename：

- 删除：后续编号整体 -1（从小到大）
- 中间插入：原 `n..N` 整体 +1（从大到小），再写入新 `n`

### 5.4 分镜场景图调序

对 `stage.json` 做数组元素移动时，同步 rename：

```text
assert/scene/{ep}/{shot}/stage/{i}.jpg
```

不改动 `script.json` 与语音文件。

---

## 6. 工作流输出路径（实现约定）

| 工作流 ID | 输出路径 |
|-----------|----------|
| `character-appearance` | `assert/character/{name}/appearance.jpg` |
| `character-voice` | `assert/character/{name}/voice.flac` |
| `stage-image` | `assert/stage/{name}/{label}.jpg` |
| `scene-stage-image` | `assert/scene/{ep}/{shot}/stage/{index}.jpg` |
| `scene-tts` | `assert/scene/{ep}/{shot}/voice/{index}-{character}.flac` |
| `video-generate` | `assert/scene/{ep}/{shot}/video/{index}.mp4` |

说明：

- 任务提交时 `outputPath` 必须落在 `assert/` 下
- 工作流脚本负责读 `prompt/`、调用 AI；引擎负责把结果写入 `outputPath`
- 批量发现任务按上表扫描缺失产物并排队生成

---

## 7. 示例（摘自项目结构）

```
design/AI的第一天/
├── overview.md
├── project.json
├── prompt/
│   ├── character/小霓/{overview,appearance,voice}.md
│   ├── stage/便利店内部/便利店内部-夜晚-平视-冷白霓虹-收银台.md
│   └── scene/1/1/{overview.json,stage.json,script.json,prompt.md}
└── assert/
    ├── character/小霓/appearance.jpg
    ├── stage/便利店内部/便利店内部-夜晚-平视-冷白霓虹-收银台.jpg
    └── scene/1/1/
        ├── stage/0.jpg
        ├── voice/0-小霓.flac
        └── video/0.mp4
```

---

## 8. 相关文档

- 原型内容模板与写作规范：`.claude/skills/create-video-script/03-asset-output.md`
- 工作流适配与输出约定：`docs/workflow-adaptation-guide.md`
- 资产 CRUD / 分镜排序设计：`docs/superpowers/specs/2026-07-28-asset-crud-and-shot-ordering-design.md`
