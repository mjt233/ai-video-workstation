# ComfyUI Easy Bridge 工作流字段配置约定

> 各类型工作流提交给 Bridge 的字段约定。提交结构统一为：`params`（JSON 字符串）+ 可选文件（multipart/form-data）。本地工作流类型见 [workflow-adaptation-guide.md](./workflow-adaptation-guide.md)。

## 通用约定

- **提示词字段**统一为 `prompt`（`desc`/`imd_desc` 已废弃）。
- **文件 key** 序号统一 **0-based**；图片统一 `image_{n}`；多视频 `video_{n}`、多音频 `audio_{n}`；单音频用 `audio`。
- **可选参数**（`seed` 等）：工作流定义含 `seed` 时前端可配置，默认空；空值由引擎注入时间戳（`Date.now()`）再上送。工作流无 `seed` 字段时不显示、不上送。

---

## 一、文生图 text-to-image（`text_to_image`）

| 项 | 字段 |
|---|---|
| params | `prompt`（提示词）、`width`、`height`、`seed?` |
| 文件 | 无 |

- `prompt` 由引擎读取 `vars.promptPath` 指向的 md 文件内容。
- `width`/`height` 由用户尺寸配置决定（未指定时回退项目配置分辨率，兜底 1080×1920）。

---

## 二、图片编辑 image-edit（`qwen-edit-2509`）

| 项 | 字段 |
|---|---|
| params | `prompt`（编辑描述）、`seed?`、`width?`、`height?` |
| 文件 | `image_0`、`image_1`、…（多图参考，按数组顺序 0-based） |

- 多图动态 key 触发 Bridge 动态构建工作流实现多图参考编辑。
- `width`/`height` 为可选：用户指定输出尺寸时透传，不指定则完全不带。

---

## 三、TTS 音色设计 tts-voice-design（`tts_voice_design`）

| 项 | 字段 |
|---|---|
| params | `prompt`（声线描述）、`text`（朗读文本）、`seed?` |
| 文件 | 无 |

- 角色声音：`prompt` 来自 voice.md，`text` 为固定试听句。
- 分镜台词：`prompt` = 声线 + 情绪，`text` = 台词，固定 seed（稳定音色）。

---

## 三·B、TTS 音色克隆 tts-voice-clone

| 项 | 字段 |
|---|---|
| params | `text`（朗读文本）、`ref_text`（参考音频文字内容）、`seed?` |
| 文件 | `audio_0`（参考音频） |

- 画布「TTS声音生成」节点音色克隆模式使用；参考音频以文件 key `audio_0` 上传。

---

## 四、图生视频 image-to-video

按模式分三类（时长上限 15s）：

### 1. 参考模式（`minimax-h3-r2v`，MiniMax H3）

| 项 | 字段 |
|---|---|
| params | `prompt`、`width`、`height`、`duration`、`seed?` |
| 文件 | `image_{n}`（≤9）、`video_{n}`（≤3）、`audio_{n}`（≤3），各类型独立 0-based，总数 ≤12 |

- 音频参考不能作为唯一输入（须与图片/视频参考同传）。

### 2. 首尾帧模式

按实现分为两种：

**a. LTX-2.3（`I2V` / `FL2V` / `FML2V`，按帧数自动选择）**

| 帧数 | 工作流 | params | 文件 |
|---|---|---|---|
| 1 | `I2V` | `prompt`、`width`、`height`、`duration`、`fps`、`auto_generate_audio=true`、`seed?` | `image_0` |
| 2 | `FL2V` | 同上 | `image_0`、`image_1` |
| 3 | `FML2V` | 同上 + `mid_frame_cursor=0.5` | `image_0`、`image_1`、`image_2` |

- 提供背景音频时以 `audio` 键上传，并将 `auto_generate_audio` 置 false。

**b. MiniMax H3（`minimax-h3-fl2v`，1~2 帧）**

| 项 | 字段 |
|---|---|
| params | `prompt`、`width`、`height`、`duration`、`seed?` |
| 文件 | `image_0`（首帧必填）、`image_1`（尾帧可选） |

### 3. 导演台模式（`ltx-2.3-director`，LTX-2.3）

| 项 | 字段 |
|---|---|
| params | `prompt`、`width`、`height`、`duration`、`fps`、`auto_generate_audio=true`、`frame_define`（JSON 字符串）、`seed?` |
| 文件 | `image_{frameSeq}`（与 `frame_define` 中 `frameSeq` 一一对应）+ `audio?` |

- `frame_define`：`[{ frameSeq, cursor }]`，`frameSeq` 0-based（对应文件 `image_{frameSeq}`），`cursor` 为该帧在视频长度中的位置比值（0~1）。
- 提供背景音频时以 `audio` 键上传，并将 `auto_generate_audio` 置 false。
