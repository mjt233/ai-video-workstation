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
- 剧本分集文件名必须是正整数 `.md`，同一项目内编号连续为 `1..N`

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
│   └── {子场景标签}.md  # 子场景画面描述
├── scene/{集数}/{分镜}/
│   ├── overview.json    # 分镜叙事总览（title/beat/visual/camera/duration/mood）
│   ├── stage.json       # 关键帧定义（引用场景/角色）
│   ├── script.json      # 台词列表
│   └── prompt.md        # 图生视频提示词
└── script/
    ├── outline.md       # 剧本大纲
    └── episodes/{集数}.md  # 分集剧本
```

### 2.1 角色 `prompt/character/{角色名}/`

| 文件 | 用途 |
|------|------|
| `overview.md` | 姓名、性别、年龄、性格、背景、关系 |
| `appearance.md` | 三视角全身图要求 + 结构化外貌描述，供 `text-to-image`（角色外观） |
| `voice.md` | 1–3 句自然语言声线描述，供 `tts-voice-design`（角色声音 / 分镜台词） |

创建角色时会按模板生成上述三个文件；目录名即角色唯一 ID。

#### 衍生变体（角色）

```
prompt/character/{角色名}/variants/{变体id}.json
assert/character/{角色名}/variants/{变体id}.jpg
```

- 不出现在资产浏览器树中，仅在角色详情「衍生变体」页管理
- 生成使用 **图片编辑** 工作流（`image-edit`，purpose=`variant-edit`）
- 分镜引用：`{角色名}@{变体id}`

#### 声音变体（角色，单层）

```
prompt/character/{角色名}/voice-variants/{变体id}.json
assert/character/{角色名}/voice-variants/{变体id}.flac
```

- 声音变体是角色音色设计（`voice.md`）的衍生变体，仅支持单层结构（无父/子层级）
- meta JSON：`{ id, prompt, promptMode, 台词, createdAt, updatedAt }`
  - `prompt`：变体提示词（音色风格/语气描述），必填
  - `promptMode`：`append`（在原描述后追加提示词，默认）/ `overwrite`（完全覆盖原描述）
  - `台词`：变体朗读的文本，必填
- 在角色详情「声音」页管理（新增/编辑/删除）；生成使用 **音色设计** 工作流（`tts-voice-design`，`prompt` 按 `promptMode` 拼接、`text` 为台词），产物为 `{变体id}.flac`
- 已生成音频的声音变体在资产选择器「角色」页签的「音色」分区下可选（`{角色名}/音色/{变体id}`），可被资产画布「加载音频」节点读取（`config.assetPath`）


### 2.2 场景 `prompt/stage/{场景名}/`

- 场景目录：`prompt/stage/{场景名}/`（可先建空目录）
- 子场景文件：`prompt/stage/{场景名}/{子场景标签}.md`

**子场景标签**建议格式：

```text
{子区域}
```

示例：`正门入口`、`走廊通道`。分镜引用为 `{场景名}/{子场景标签}`，如 `现代商场/正门入口`。标签不编码视角、天气、时间。

子场景 Markdown 通常包含：画面描述、主色调。  
该文件供 `text-to-image`（场景图）使用。

#### 衍生变体（场景）

```
prompt/stage/{场景名}/variants/{子场景标签}/{变体id}.json
assert/stage/{场景名}/variants/{子场景标签}/{变体id}.jpg
```

- 不出现在资产浏览器树中，仅在子场景详情中管理
- 创建时填写衍生描述（图片编辑提示词）；图片需手动/批量生成
- 分镜引用：`{场景名}/{子场景标签}@{变体id}`


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
    "基础场景": "{场景名}/{子场景标签}",
    "登场角色": ["{角色名}"],
    "prompt": "图像1为背景：...；图像2在场景中..."
  }
]
```

也可引用**同集上一分镜的最后一个场景图**（仅直接引用）：

```json
[
  {
    "基础场景": "prev",
    "登场角色": [],
    "prompt": ""
  }
]
```

约束：

| 规则 | 说明 |
|------|------|
| `基础场景` 必填 | 格式 `场景名/标签`、`场景名/标签@变体id`，或关键字 `prev` |
| `prev` | 表示同集上一分镜 `stage.json` **最后一项**对应的 `assert/scene/{ep}/{shot-1}/stage/{n-1}.jpg`；**仅直接引用**（角色与 prompt 必须为空）；第 1 个分镜禁止 |
| 直接引用 | `登场角色` 与 `prompt` **同时为空**：引擎复制基础场景图或上一分镜最后场景图，不调用图像编辑 |
| 合成/修改 | `prompt` 必填；有角色时角色须存在，且 `登场角色` 长度建议 ≤ 2；**不可**对 `prev` 做合成 |
| 禁止 | 仅有角色、`prompt` 为空；`prev` 叠加角色/prompt |
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

### 2.4 剧本 `prompt/script/`

剧本（大纲 + 分集）与「集数分镜」**相互独立**，编号互不影响、各自增删：

```
prompt/script/
├── outline.md             # 剧本大纲（Markdown）
└── episodes/
    ├── 1.md               # 第 1 集剧本（Markdown）
    ├── 2.md               # 第 2 集剧本
    └── ...                # 编号连续 1..N
```

| 路径 | 用途 |
|------|------|
| `outline.md` | 剧本大纲：主题立意、人物弧线、分集梗概等；首次保存时创建 |
| `episodes/{n}.md` | 第 n 集完整剧本正文；创建分集时按模板生成（默认标题 `# 第n集`） |

- 资产管理器「剧本」节点（与「集数分镜」同级）下提供「大纲」「分集」两栏，均支持在线编辑（Markdown 预览 + 编辑弹窗），单集视图附带上一集/下一集快捷切换
- 分集创建：`POST /api/assets/:project/script/episode`（body `{ episode? }`，编号为空 = 自动追加末尾；指定编号仅允许 `max+1`，保证不跳号）
- 分集删除：`DELETE /api/assets/:project/script/episode/{n}`，删除后后续编号整体前移保持连续；被前移文件首行若精确匹配默认标题 `# 第{旧号}集`，会同步改写为新编号（用户自定义标题不受影响）
- 无对应 `assert/` 产物（纯文本原型，不参与生成流水线）
- Agent 侧的读取与写入约定由独立技能 `script-manager` 管理（`.agents/skills/script-manager/SKILL.md`）：默认只读、写入前先读最新内容、发现问题先与用户确认、新建分集取当前最大编号 + 1

---

## 3. `assert/` — 生成产物

```
assert/
├── character/{角色名}/
│   ├── appearance.jpg   # 角色外观图
│   └── voice.flac       # 角色声线样本
├── stage/{场景名}/
│   └── {子场景标签}.jpg
└── scene/{集数}/{分镜}/
    ├── stage/{index}.jpg
    ├── voice/{index}-{角色名}.flac
    └── video/{index}.mp4
```

创建角色/场景/分镜时**不会**预创建 `assert` 文件；由工作流或批量发现任务写入。

### 3.0 历史版本

重复生成同一资产时，引擎会先将**当前文件**移入历史目录，再写入新文件：

```
assert/.../{file}.ext
assert/.../history/{stem}/{YYYYMMDD-HHmmss}.ext
```

示例：

| 当前资产 | 历史目录 |
|----------|----------|
| `assert/character/陈书文/appearance.jpg` | `assert/character/陈书文/history/appearance/` |
| `assert/stage/现代商场/xxx.jpg` | `assert/stage/现代商场/history/xxx/` |
| `assert/scene/1/1/stage/0.jpg` | `assert/scene/1/1/stage/history/0/` |
| `assert/scene/1/1/voice/0-陈书文.flac` | `assert/scene/1/1/voice/history/0-陈书文/` |

- 历史文件名按时间戳排序；同秒冲突时追加 `-1`、`-2`…
- API：`GET /api/assets/:project/history?path=assert/...` 列出版本
- API：`POST /api/assets/:project/history/activate` 将某历史版本激活为当前（原当前再归档）
- API：`DELETE /api/assets/:project/history` 删除指定历史版本（body: `path` + `versionPath`）

### 3.0.1 用户上传图片

支持用户自行上传覆盖以下图片资产（与生成产物路径一致）：

| 类型 | 路径 |
|------|------|
| 角色外观 | `assert/character/{name}/appearance.jpg` |
| 场景设定图 | `assert/stage/{场景名}/{标签}.jpg` |
| 分镜场景图 | `assert/scene/{集}/{镜}/stage/{index}.jpg` |

- API：`POST /api/assets/:project/upload`（`multipart/form-data`：`file` + `path`）
- 允许 MIME：`image/jpeg`、`image/png`、`image/webp`；落盘路径扩展名固定为 `.jpg`
- 若目标路径已有当前资产，**先归档历史**再写入上传内容

### 3.0.2 自定义资产（实体映射）

角色、场景、分镜详情页均提供「自定义资产」上传与管理入口，资产**直接映射到 `assert/custom/` 下的实体目录**存储读写：

```
assert/custom/
├── character/{角色名}/      # 角色自定义资产
├── stage/{场景名}/          # 场景自定义资产
└── scene/{集数}/{分镜}/     # 分镜自定义资产
```

- 支持任意类型多文件上传、子目录导航、预览、下载与删除（删除需二次确认）
- API：`GET /api/fs/:project/assert/custom/...` 列目录/读文件；`POST /api/fs/:project/upload` 上传；`POST /api/fs/:project/mkdir` 建目录；`DELETE /api/fs/:project/assert/custom/...` 删除
- 上传/建目录/删除仅限 `assert/custom/` 前缀下
- 分镜 `stage.json` 可引用自定义资产：`基础场景` / `登场角色` 填 `custom/{相对 assert/custom 的完整路径}`（**含扩展名**，如 `custom/stage/商场门外/门已打开.png`），引擎按 `assert/custom/{路径}` 精确定位
- 资产选择器（角色 / 场景页签）中，选中实体后会在其普通资产与衍生变体**之下单独分区**展示该实体的自定义资产图片，支持直接选择

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
   - 普通引用：复制 `assert/stage/{场景}/{标签}.jpg`（或变体图）→ `assert/scene/{ep}/{shot}/stage/{index}.jpg`  
   - `prev`：复制 `assert/scene/{ep}/{shot-1}/stage/{last}.jpg` → 当前分镜目标帧（`last` 为上一分镜 `stage.json` 数组末下标）
3. **合成**（`基础场景` 不得为 `prev`）：  
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

#### 分镜语音历史结构

```text
assert/scene/{ep}/{shot}/voice/
├── {index}-{角色名}.flac              # 当前语音文件
└── history/
    └── {index}-{角色名}/
        ├── {YYYYMMDD-HHmmss}.flac    # 历史版本
        ├── {YYYYMMDD-HHmmss}-1.flac  # 同秒冲突
        └── ...
```

语音文件在以下操作中会自动同步历史目录：

| 操作 | 历史处理 |
|------|----------|
| 编辑台词 → 修改角色名 | 删除原角色 `{oldIndex}-{oldChar}/` 整个历史目录 |
| 删除台词 | 删除对应 `{index}-{char}/` 整个历史目录；后续条目语音文件前移 |
| 调序台词 | 历史目录与当前语音文件同步重命名（`{oldIndex}-{oldChar}` → `{newIndex}-{newChar}`） |

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
| 剧本大纲 | `prompt/script/outline.md` | （无对应产物） |
| 分集剧本 | `prompt/script/episodes/{n}.md` | （无对应产物） |

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
| 剧本大纲 | 首次在线保存时创建 `prompt/script/outline.md` |
| 剧本分集 | 仅 `prompt/script/episodes/{n}.md`（按模板生成） |

### 5.2 删除（成对清理）

| 对象 | 删除 prompt | 删除 assert |
|------|-------------|-------------|
| 角色 | `prompt/character/{name}/` | `assert/character/{name}/` |
| 场景 | `prompt/stage/{name}/` | `assert/stage/{name}/` |
| 子场景 | `{label}.md` | `{label}.jpg`（若存在） |
| 分镜 | `prompt/scene/{ep}/{shot}/` | `assert/scene/{ep}/{shot}/` |
| 集数 | `prompt/scene/{ep}/` | `assert/scene/{ep}/` |
| 剧本分集 | `prompt/script/episodes/{n}.md`（后续编号前移 1，无跳号） | （无） |

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

### 5.5 分镜台词调序 / 删除 / 编辑

对 `script.json` 的操作会自动同步语音文件及其历史目录：

| 操作 | 同步内容 |
|------|----------|
| 调序（数组元素移动） | 当前语音 `{i}.flac` + 历史目录 `{i}-{char}/` 同步 rename |
| 删除 | 删除语音文件 + 历史目录；后续条目前移 |
| 编辑（修改角色名） | 删除原角色语音文件 + 历史目录 |

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

- 原型内容模板与写作规范：`.agents/skills/create-video-script/03-asset-output.md`
- 工作流适配与输出约定：`docs/workflow-adaptation-guide.md`
- 资产 CRUD / 分镜排序设计：`docs/superpowers/specs/2026-07-28-asset-crud-and-shot-ordering-design.md`
