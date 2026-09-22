# 产物历史与资产落位（历史对话框 / 设为分镜场景图 / 保存为）

> 返回 [总览与定位](./README.md)

## 产物历史对话框

生成节点「历史」打开的是独立组件 `CanvasAssertHistoryDialog.vue`（`components/canvas/` 下）：左侧大图预览 + 右侧历史列表（当前产物虚拟项 + 服务端历史目录条目，按时间戳文件名/生成时间展示）。**两种列表标记互相独立**：「当前版本」虚拟首条用浅色底 + `当前` chip 表示「节点当前产物是哪一条」；点选任意行进入**查看中状态**（`v-list-item :active` 选中态 + 左侧 primary 强调条 + `查看中` chip），左侧大图与底部标签随之切换，历史较长时选中行会自动 `scrollIntoView({ block: 'nearest' })` 滚入可视区——同一行既是当前版本又被查看时两枚 chip 并列。点「设为当前」→ 服务端 `POST /api/assets/:project/history/activate`（history 文件换回当前产物固定路径），成功后通知父级刷新产物展示，并让**选中停留在被激活的那一条**（激活后其内容即当前产物固定路径，对应刷新后的首条「当前版本」）；点「删除」→ `confirm` 弹窗确认 → `DELETE /api/assets/:project/history` 删除历史文件，对话框保持打开并刷新列表，选中落到被删条目的原位置（邻近条目），避免高亮突然消失。列表刷新一律走 `loadHistory(keep)` + `pickEntry`：路径优先、其次原下标就近（越界回落末条）、兜底首条。**历史数据完全由服务端管理，前端不再维护 `config.history`**。例外：**无产物文件的文本节点**（`text-ai` AI 文本生成、`text-generate` 文本生成）的历史见下节「文本节点的文本历史版本」，由 `AssetCanvas` 的 `isTextHistoryNode`（原型为这两者之一）把同一 `historyDialog` 状态分支到不同对话框。

## 文本节点的文本历史版本（AI 文本生成 / 文本生成）

两类**文本节点**都不产生资产文件，其历史是**纯文本快照**，存放在节点 `config.outputHistory`（随 `canvas.json` 持久化；类型与纯函数见 `canvas/aiTextHistory.ts`：`AiTextHistoryEntry` 含 id/createdAt/input/output 与可选的 modelName/presetName/mediaLabels 展示快照；数组**末尾为最新**，最多保留 `MAX_TEXT_HISTORY_VERSIONS = 50` 条、超出丢弃最旧；读取时逐条过滤脏数据；**服务端实现见 `server/src/canvas/text-history.ts`（LLM 会话落盘与工作流文本产物落盘共用），双端同一组单测覆盖防漂移**）。

- **存档时机与写入者**：由**后端独占**（AI 文本生成走 `llm/result-persist.persistLlmResult`；文本生成走 `canvas/text-result.persistTextResult`）在各自任务**正常完成（completed）**时写入——`config.output = 产物文本` + 追加一条 `config.outputHistory`（AI 文本：记录**当时的输入**（会话快照 `snapshot.userInput`：**未拼入预设提示词的用户原始输入**；快照未提供时回退 `inputSent`）与**当时的输出**，并附模型名/预设名/媒体输入名称快照；文本生成：记录该次提交的提示词与工作流名）；手动停止（cancelled）/出错（failed）**只写部分输出、不存档**；空响应不写历史。前端在终态经 `adoptExternalChange` 采用后端已落盘的 `outputHistory` 原值（历史单写者：多页签同时打开同一画布也不会产生重复条目）。
- **写入语义**：后端写盘走 `saveCanvasDef`（CAS + 路径锁 + 冲突重试 ≤3 次，详见 [data-model.md](./data-model.md) 与 [llm-session.md](./llm-session.md)；两条链路共用 `canvas/canvas-patch.ts` 的 `applyCanvasNodeConfigPatch`）；前端对话框中删除版本仍为**静默更新**（`update:config-quiet`，不入撤销栈）；终态采纳经 `adoptExternalChange`（入撤销栈——单次撤销可回退到生成前状态 + `savedRev` 对齐服务端新 rev，**不触发写盘**，内容已在文件）。**文本生成任务多一道版本比对**：终态任务 `result` 里带 `{ rev, prevRev }`，前端仅在 `prevRev === savedRev`（本画布未被其他写者推进）时才采纳，否则以服务端文件为准（`AssetCanvas.adoptTextRunResult`，按 rev 幂等去重）。
- **当前值即 `config.output`**：AI 文本响应结束后输出框转为可手动编辑，编辑内容即当前值；文本生成节点的结果区**只读**（节点主体与配置面板均不可编辑，改动请走「重新生成」或历史对话框的「设为当前」）；「设为当前」仅把所选版本的输出写回 `config.output`（不恢复输入/模型参数）。
- **入口**（三个）：① 节点右键菜单「历史」——两类原型都声明 `hasHistory: true`；② AI 文本节点内 AI 响应标题栏右侧历史小按钮（`AiTextGenerateNode` → `CanvasNodeCard` → `AssetCanvas.openHistory`）；③ 文本生成节点配置面板的「历史」按钮（有产物时显示）。
- **对话框交互**（`AiTextHistoryDialog.vue`）：左侧展示所选版本的时间/模型/预设/媒体元信息与「当时的输入」「当时的输出」（只读滚动区）；右侧版本列表最新在前，行操作「设为当前」（仅恢复输出，snackbar 反馈）与「删除」（`confirm` 确认 → 静默移除，删除不可撤销）。数据全部来自 config，打开对话框无任何服务端请求；刷新/切换画布后版本仍随 canvas.json 保留。
- **复制/粘贴节点**：`remapNodeConfig`（`groupSelection.ts`）剥离 `config.outputHistory`，粘贴出的副本从零开始记录自己的版本（两类文本节点一致）。

## 设为分镜场景图

- 生成节点编辑器「设为分镜场景图」→ 弹出对话框（独立组件 `SetAsSceneDialog.vue`，帧加载/新增/覆盖逻辑在组件内部；入口状态由 `useCanvasDialogs` 持有）。
- 读取 `prompt/scene/{ep}/{shot}/stage.json` 列出**全部场景帧**（label = `基础场景` || prompt || `分镜场景图 N`，预览 `stage/{i}.jpg`，404 时 `@error` 置 `broken` 显示占位）。
- 点击某帧只进入**选中状态**（高亮 + 右上角勾选图标，再点一次取消选中），底部「确认」按钮启用后点击才执行 `copyFs(当前产物路径 → assert/scene/{ep}/{shot}/stage/{i}.jpg)` 覆盖该帧（当前产物路径来自 AssetCanvas 下发的 `output` prop）。
- 「新增场景图」→ `createSceneStageFrame`（`api/assets.ts`）追加帧并复制图片到新索引；新帧定义由 `deriveStageFrameBody` 从生成节点输入推导：
  - `assert/stage/{场景}/{标签}` 输入 → `基础场景 = 场景/标签`
  - `assert/stage/{场景}/variants/{标签}/{变体}.jpg` 输入 → `基础场景 = 场景/标签@变体`
  - `assert/character/{角色}` 输入 → `登场角色 = [角色]`
  - 节点 `config.prompt` → `prompt`
  - 无基础场景时复用现有帧第一个的 `基础场景`，仍无则禁用「新增」并提示。
- 服务端 `addStageFrame` 约束：`基础场景` 必填（`场景名/标签` 或 `prev`）；有登场角色时必须填 prompt。

## 保存为（节点右键菜单）

有当前产物的节点（图片/视频/音频输出）右键菜单显示「保存为」hover 子菜单，按**节点输出类型**提供目标：

| 节点输出类型 | 保存目标 | 目标路径 |
|------|----------|----------|
| 图片 | 角色设计 | `assert/character/{角色}/appearance.jpg` |
| 图片 | 角色设计-衍生变体 | `assert/character/{角色}/variants/{变体id}.jpg` |
| 图片 | 场景图 | `assert/stage/{场景}/{子场景}.jpg` |
| 图片 | 场景图-衍生变体 | `assert/stage/{场景}/variants/{子场景}/{变体id}.jpg` |
| 图片 | **道具图片** | `assert/prop/{分类}/{道具}/image.jpg` |
| 图片 | 自定义资产 | `assert/custom/...`（SaveAssetDialog） |
| 视频 | **道具视频** | `assert/prop/{分类}/{道具}/video.mp4` |
| 音频 | **道具音频** | `assert/prop/{分类}/{道具}/audio.flac` |

- 自定义资产走 `SaveAssetDialog`，其余目标走 `SaveAsDialog` 目标选择对话框。
- SaveAsDialog 目标列表来自 `prompt/character`、`prompt/stage`、`prompt/prop` 目录（道具类为「分类 + 道具」两个 v-combobox）与子场景 `.md` 文件名；默认定位当前画布实体（场景画布 → 当前场景 + 子场景；分镜画布 → `stage.json` 首帧 `基础场景` 推导，`prev` / `custom/` 引用不预选）。变体 id 手动输入并校验非法字符。「角色设计」「场景图」与道具类用 v-combobox（下拉箭头展开已有实体列表）：可选择已有实体覆盖其外观图/场景图/道具产物，也可手动输入新名称——保存时自动创建实体（角色：`POST /assets/:project/character` 生成 `prompt/character/{name}/` 三模板文件；子场景：`POST /assets/:project/subscene` 生成 `prompt/stage/{场景}/{标签}.md`；道具分类/道具：`POST /assets/:project/prop/category` + `/assets/:project/prop` 生成目录与 image.md/video.md/refs.json 模板；重名则按已存在处理走覆盖流程）。衍生变体的角色/子场景仍为下拉选择（变体须挂在已存在实体下）。
- 仅复制文件（`POST /fs/:project/copy`）；**衍生变体（角色/场景）在元数据 `prompt/.../variants/{id}.json` 不存在时自动创建**（调 `POST /assets/:project/.../variants` 创建接口，desc 用对话框「衍生描述」输入，默认预填节点提示词，为空回退「由画布保存的衍生变体」，baseImage 由服务端默认推导；元数据已存在时仅覆盖图片）——角色/场景详情页的衍生变体列表按元数据扫描，缺元数据会看不到已保存的图。
- 目标文件已存在时 `confirm` 确认后覆盖，覆盖前先把原文件归档为历史版本（`POST /assets/:project/history/archive`，服务端 `copyExistingAssetToHistory` 复制归档，目录按 `historyDirForAsset` 推导，如 `assert/character/{角色}/history/appearance/`、`assert/character/{角色}/variants/history/{变体id}/`、`assert/prop/{分类}/{道具}/history/image/`；与生成/上传覆盖的历史机制一致，可在资产历史对话框中查看/激活）。
- SaveAssetDialog 文件名可手动编辑（默认节点名 + 源扩展名，空名回退「未命名」，非法字符校验），重名自动追加 `(1)`、`(2)`… 后缀。
