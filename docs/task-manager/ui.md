# 任务管理界面

> 返回 [任务管理总览](../task-manager.md)

本文件说明任务管理相关的**前端界面**：每个入口在哪个组件、每段文案/状态是什么意思、空态与兜底在哪里，以及三条主要用户流程。接口与字段来源见 [api.md](./api.md)，日志分级与保留期语义见 [log.md](./log.md)，数据模型见 [data-model.md](./data-model.md)。

## 界面地图

| 入口 | 组件 | 数据来源 |
|------|------|----------|
| 顶部栏右上角「任务管理器」图标（`mdi-progress-clock`，红色徽标 = 活跃任务数） | `frontend/src/App.vue` → `components/TaskManagerDialog.vue` | `taskSocket.tasks`（WS 广播） |
| 任务管理器 →「进行中」页签 | `TaskManagerDialog.vue` | `taskSocket.tasks`（内存注册表快照） |
| 任务管理器 →「历史」页签 | `components/task/TaskHistoryPanel.vue` | `GET /api/workflow/tasks` + `GET /api/system/settings`（读保留期） |
| 日志查看器（复用组件） | `components/task/TaskLogViewer.vue` | 纯展示：数据由父级经 `useTaskLogs` 传入 |
| 日志状态与级别过滤 | `composables/useTaskLogs.ts` | `GET /api/workflow/tasks/:taskId/log` |
| 画布节点错误遮罩「详情」按钮 | `components/canvas/CanvasNodeCard.vue` | 节点生成状态 `status.taskId` |
| 节点「任务详情」对话框 | `components/canvas/CanvasNodeLogDialog.vue` | `GET /api/workflow/tasks/:taskId` + 日志接口 |
| 画布对话框状态与事件接线 | `components/canvas/composables/useCanvasDialogs.ts`、`components/canvas/AssetCanvas.vue` | — |
| 系统设置 →「日志」子类 | `components/system-settings/TaskLogSettingsSection.vue` | `GET/PUT /api/system/settings`、`/api/system/task-log/*` |
| 系统设置子类注册表 | `components/system-settings/SystemSettingsPanel.vue`、`composables/useSystemSettings.ts` | key：`trash` \| `taskLog` |

## 三条主流程

### (a) 节点出错 → 点「详情」→ 看日志

1. 生成任务失败 → 画布节点卡片渲染**错误遮罩**（`CanvasNodeCard.vue`，`status.status === 'error'`）：红色警示图标 + 一行 `status.errorMsg`（为空时回退文案「任务失败」）。
2. 遮罩操作区并排渲染两个按钮：**「详情」**（`v-if="status.taskId"`，`variant="text"`）与**「重试」**（`variant="tonal"` `color="error"`）。
3. 点「详情」→ `@click.stop` 上抛 `emit('detail', node.id)`（阻止冒泡，避免触发节点选中/拖拽）。
4. `AssetCanvas.vue` 接线：`@detail="(nodeId) => openNodeLog(nodeId, statusByNode[nodeId]?.taskId)"`。
5. `useCanvasDialogs.openNodeLog(nodeId, taskId)`：**taskId 为空** → 只弹错误 snackbar「该任务没有可查询的日志（本地校验失败或日志已超期清理）」，**不打开**对话框；有 taskId → 写入 `logDialog = { show: true, nodeId, taskId, nodeName: 节点名 }`。
6. `CanvasNodeLogDialog` 打开（`v-model="logDialog.show"`，`:task-id="logDialog.taskId || null"`，`:node-name`）：并行执行 `taskLogs.load()`（尾部 200 条）与 `getTaskStatus(taskId)`（摘要）。
7. 看日志：默认「全部」级别；排障时切「警告」（含错误）或「错误」；摘要显示「仅显示最后 200 条（共 N 条）」时点**「查看全部」**拉全量；点刷新按钮重取；日志变化后自动滚到底部。
8. 关闭对话框 → `summary = null`、`levelFilter = 'all'`、`taskLogs.reset()`，下次打开不会串上一个任务的内容。

### (b) 任务管理器 → 历史 → 筛选/翻页 → 展开日志

1. 点顶部栏「任务管理器」图标 → 打开对话框（默认停在「进行中」页签）。
2. 切到「历史」页签 → `TaskHistoryPanel` 首次激活（`active` 由 `tab === 'history'` 驱动，且 `tasks.length === 0`）才发请求：按默认筛选（最近 14 天、全部状态、全部项目）取第 1 页（`limit: 20, offset: 0`），同时读一次系统设置拿日志保留期用于空态提示。
3. 改筛选：时间范围 / 状态下拉**立即**重新拉取并重置到第 1 页；项目输入框按回车或点「刷新」触发（留空 = 全部项目）。
4. 翻页：底部分页条（仅 `total > 20` 时出现）「第 X / Y 页 · 共 N 个任务」；点箭头 `goPage()` → `reload(false)` 保持当前页号。若当前页因数据变化变空且 `page > 0`，自动回退到最后一页重取。
5. 点某行右侧「查看日志」→ `toggle(taskId)`：`expandedId = taskId`、`levelFilter = 'all'`、`logs.reset()`、`await logs.load()`（尾部 200 条，**按需加载**）。
6. 按钮文案变为「收起」；再点同一行则收起并 `logs.reset()`；点其他行则切换到新任务的日志（旧的被重置，不会叠加）。

### (c) 系统设置 → 日志 → 改配置 / 看占用 / 手动清理

1. 打开系统设置对话框（顶部栏齿轮，`aria-label="系统配置"`）→「日志」面板展开。也可由外部定位：`useSystemSettings().openSystemSettings('taskLog')`（`SystemSettingsPanel` 的 `SECTIONS` 注册表中 key 为 `taskLog`，label 为「日志」，hint 为「任务日志 · 保留期、清理与占用统计」；默认展开的只有 `trash`）。
2. 打开面板即 `onMounted → load()`：`GET /api/system/settings` 一次拿回配置 + `taskLogStats`，填充「当前占用」卡片与表单。
3. 看占用：卡片 8 项（日志行数 / 表 + 索引占用 / 数据库文件占用 / 最早日志 / 可清理 / 运行中任务日志（受保护）/ 上次清理 / 下次清理）。若 `freelistCount > 0`，追加提示「有 N 个空闲页（X）待回收，执行一次清理即可归还磁盘」。
4. 改配置：启用开关、执行间隔（小时）、日志保留期（天）、轮询心跳间隔（秒）；任一字段与 `saved` 快照不同即 `isDirty = true`，此时「保存配置」可用、「放弃修改」可用。保存提交 `PUT /api/system/settings`（`{ taskLog: { autoClean: {...}, heartbeatSeconds } }`），成功后用响应回填统计与 `saved`，并 snackbar「任务日志配置已保存（服务端即时生效，无需重启）」。
5. 手动清理：**「立即清理超期日志」**（`cleanTaskLogs()`）与**「清空历史日志」**（`purgeTaskLogs()`）都会先弹 `confirm`——前者内容含保留期与「当前可清理约 N 行」，确认按钮「立即清理」（`primary`）；后者含「约 (totalRows - activeRows) 行、不受保留期限制、保留运行中 activeRows 行」，确认按钮「清空日志」（`error`）。两者都在文案中明确「运行中任务的日志不会删除；任务记录与生成产物不受影响。此操作不可撤销。」
6. 操作完成后统一 `await load()` 刷新占用统计，并 snackbar 汇报结果：清理 → 「已清理 N 行日志，库占用 A → B」或「没有超期日志需要清理」；清空 → 「已清空 N 行历史日志（保留运行中 M 行）」。

## 画布节点运行遮罩的进度呈现（`CanvasNodeCard.vue`）

所有画布节点共用同一套运行遮罩（`status.status === 'running'`）；原型声明 `statusOverlay` 的（目前仅 AI 文本节点）走自定义遮罩，不适用本节的圆环。

| 条件 | 渲染 |
|------|------|
| `nodeProgressPercent(status)` 返回数字 | **确定态圆环** `v-progress-circular`（`size="48"` `width="4"`）+ **圈内百分比数字**（`.canvas-node__status-percent`，11px / tabular-nums，避免逐位跳动）；下方仍是阶段日志 + 「中断」按钮 |
| 返回 `null`（无真实进度） | 原样保留的不确定转圈（`indeterminate` `size="28"`） |

判定完全由 `useCanvasGeneration.ts` 导出的 `nodeProgressPercent()` 完成（取整 + 钳制 0~100；`undefined`/`NaN` → `null`）。**缺省进度绝不当 0**：否则不上报中间进度的服务商（MiniMax H3 / 火山方舟 / OpenAI 兼容）、无 `duration` 的取帧任务、LLM 会话都会长期显示一个假的「0%」。

数据来源两条路都汇到 `GenerateStatus.progress`：工作流读轮询响应里的 `progress` 标准字段，ffmpeg 读 `task-update` 广播（见 [events.md](./events.md) 第六节）。

## 任务管理器对话框（`TaskManagerDialog.vue`）

标题「任务管理器」，右侧显示「（N 个进行中）」（`activeTasks.length > 0` 时才渲染）；右上角关闭按钮。`props.modelValue` 控制显隐，`props.tasks` 由 `App.vue` 注入 `taskSocket.tasks.value`。

### 「进行中」页签

`activeTasks` = `props.tasks` 过滤 `status` 为 `running` / `pending`，按 `startedAt` 倒序。

| 元素 | 文案 / 状态含义 |
|------|-----------------|
| 行首图标 | `running` → 转圈 `v-progress-circular`；否则（`pending`）→ `mdi-clock-outline` 黄色时钟 |
| 类型 chip | `workflow` → 「AI 生成」（primary）；`llm` → 「LLM 会话」（purple）；`ffmpeg` → 「视频处理」（teal） |
| 名称 | `t.label`（任务展示名） |
| 状态文本 | `pending` → 「排队中」；`llm` running → `phase === 'responding'` ? 「正在响应…」: 「Thinking…」；其余 running **有真实 `progress` 时一律「处理中 N%」**（ffmpeg 与上报中间进度的工作流）；无进度时 `ffmpeg` → 「处理中…」、`workflow` → 「运行中…」；终态回退为「已完成 / 失败 / 已中断」 |
| 已运行时长 | `formatElapsed(startedAt)`：`mm:ss`，超过 1 小时为 `h:mm:ss`；由面板打开期间的 1 秒定时器刷新 |
| 画布位置 | `locationText(t)`：`project` + 画布中文标签（`kind === 'scene'` → 「分镜第{episode}集 {shot}#」；`stage` → 「场景 {stage} / {label}」）；无定位信息时整段（含分隔符）不渲染 |
| 进度条 | `v-if="t.status === 'running'"`；`progress` 为数字时显示真实百分比，否则 `indeterminate` |
| 「中断」按钮 | `variant="tonal"` `color="error"`；`:disabled="!t.cancelable"`；tooltip 文案 = `cancelable` ? 「中断该任务」: (`cancelBlockReason` \|\| 「该任务不支持中断」)。tooltip 用 `<span>` 包住按钮，保证 disabled 状态下仍能悬浮读原因 |
| 空态 | 图标 + 「暂无进行中的任务」 |
| 完成提示 | 底部「本次面板打开期间已有 N 个任务完成」 |

「中断」点击 → `taskSocket.cancel(t.id)`（WS 优先 + HTTP 兜底，见 [api.md](./api.md) 第五节）+ 上抛 `notify('已请求中断「label」', 'primary')`。**不弹确认**：中断不是删除，任务记录与产物保留。

`finishedNoticeCount` 由「活跃列表条数下降」推断：面板打开时清零并把当前条数记为基线，之后每次 `activeTasks.length` 变小就累加差值；关闭面板时复位为「进行中」页签并停止计时器。

### 「历史」页签（`TaskHistoryPanel.vue`）

| 元素 | 文案 / 状态含义 |
|------|-----------------|
| 时间范围 | 最近 1 / 3 / 7 / 14 / 30 天、「不限时间」（默认 14 天）；除「不限」外转成 `since = now - N 天` 的 ISO 串传给接口 |
| 状态 | 全部状态（`''`）/ 已完成 / 失败 / 运行中 / 排队中 |
| 项目 | 文本框，占位「项目（留空 = 全部）」；回车触发；与下拉不同，**不自动**重查 |
| 刷新 | 手动重新拉取当前筛选的第一页 |
| 行 - 状态 chip | `completed` → 「已完成」（success）；`failed` → 「失败」（error）；其余 → 「运行中」/「排队中」（primary） |
| 行 - 主信息 | `workflowId`（工作流类型）+ `impl`（实现标识）+ `createdAt`（本地 `MM-DD HH:MM`） |
| 行 - 次信息 | `locationText(t)`：「分镜 {episode}-{shot}」或「场景 {stage}/{label}」，附「节点 {nodeId 前 8 位}」；无定位时显示「无画布定位」。其后若有 `errorMsg` 显示红色错误文案，否则若有 `result.path` 显示产物路径 |
| 行 - 日志按钮 | 「查看日志」/「收起」（依据 `expandedId`） |
| 分页 | 每页 20 条；仅 `total > 20` 时显示「第 X / Y 页 · 共 N 个任务」与左右箭头；第 1 页禁用左箭头，最后一页禁用右箭头 |
| 空态 | 图标 + 「该时间范围内暂无历史任务」+ 「历史任务列表保留在数据库中；任务日志默认保留 {retentionDays} 天」 |
| 加载态 | 无数据且 `loading` → 转圈 |
| 错误态 | `v-alert`「{error}」（读取历史任务失败；错误同时 `console.error`，日志不被清空） |

保留期文案中的 `retentionDays` 来自 `GET /api/system/settings` 的 `settings.taskLog.autoClean.retentionDays`；读取失败时保留默认值 14 并打控制台日志（**有意不阻断**历史列表，因为它只用于空态提示）。

## 日志查看器（`TaskLogViewer.vue`）与状态钩子（`useTaskLogs.ts`）

### `useTaskLogs(taskId)`

| 成员 | 语义 |
|------|------|
| `LOG_TAIL_LIMIT = 200` | 首次打开的尾部条数上限 |
| `load(limit = LOG_TAIL_LIMIT)` | 拉取日志；`taskId` 为空时**不发请求**，直接清空状态 |
| `loadAll()` | `load(0)` —— 全量（服务端 `limit=0` 与不传等价） |
| `reload()` | 保持当前视图的「是否全量」状态：`truncated` 为真时 `load(200)`，否则 `load(0)` |
| `reset()` | 清空 logs / total / truncated / loading / error（关闭对话框、切换任务时调用） |
| `filterLogsByLevel(logs, filter)` | `all` → 原样；`error` → 仅 `error`；`warn` → `warn` + `error`；`info` → 去掉 `debug` |
| 失败处理 | 写入 `error` 字段并 `console.error`，**保留已有日志**（可重试刷新） |

`info` 过滤隐藏 `debug` 是有意的：`debug` 主要是轮询心跳（默认每 60 秒一条「任务仍在推进」），只在「全部」中展示；`warn` 包含 `error` 是因为排障时警告与错误通常一起看。

### `TaskLogViewer` 渲染

| 元素 | 文案 / 状态含义 |
|------|-----------------|
| 级别切换 | `v-btn-toggle`（mandatory）：全部 / 信息 / 警告 / 错误；筛选值由**父级持有**（`v-model:level-filter`），便于切换任务时复位 |
| 条数摘要 | `total === 0` → 「共 0 条」；截断 → 「仅显示最后 {已取条数} 条（共 {total} 条）」（筛选生效时追加「，筛选后 {shown} 条」）；未截断且筛选生效 → 「共 {total} 条，筛选后 {shown} 条」；否则「共 {total} 条」 |
| 「查看全部」 | `v-if="truncated"`，点击上抛 `load-all` |
| 刷新按钮 | `icon="mdi-refresh"`、`aria-label="刷新日志"`，上抛 `refresh` |
| 错误 | `v-alert`「读取日志失败：{error}」 |
| 日志行 | `时间 级别 消息` 三段；等宽字体、12px；消息 `white-space: pre-wrap` + `word-break: break-all` |
| 时间 | SQLite UTC 串 → 本地时间 `MM-DD HH:MM:SS`（无 `T` 时按 UTC 解析） |
| 级别标签与颜色 | `error` → 「错误」#c62828 加粗；`warn` → 「警告」#ef6c00 加粗；`debug` → 「调试」灰色；其余 → 「信息」#1565c0；`error` 行的消息额外加 `text-error` |
| 空态三分支 | 加载中 → 「加载中…」；`logs.length > 0` 但过滤后为空 → 「当前筛选条件下没有日志」；否则 → 「暂无日志（可能已超出保留期被自动清理）」 |
| 自动滚底 | `watch(logs.length)` → 等一个 tick 后 `scrollTop = scrollHeight`（最新日志在末尾） |
| 最大高度 | `maxHeight` prop：历史页签 300px、节点详情对话框 420px、缺省 360px；超出内部滚动 |

## 画布节点「任务详情」（`CanvasNodeLogDialog.vue`）

标题「任务详情 · {nodeName}」（`nodeName` 为空时只显示「任务详情」），`scrollable`、`max-width="760"`。

摘要区（`v-if="summary"`，来自 `GET /api/workflow/tasks/:taskId`）：

| 元素 | 文案 / 状态含义 |
|------|-----------------|
| 状态 chip | `completed` → 「已完成」（success）；`failed` → 「已失败」（error）；`running` → 「运行中」/`pending` → 「排队中」（primary）；未知状态原样显示或「未知」 |
| 任务 id | 「任务 {taskId}」，为空显示「—」 |
| 耗时 | 「耗时 N 秒」，≥ 60 秒为「耗时 N 分 M 秒」；由 `createdAt → updatedAt` 计算（即创建到最后一次更新的间隔） |
| 错误 | `summary.errorMsg` 存在时渲染 `error` alert |
| 日志区 | 复用 `TaskLogViewer`（`max-height` 420） |

打开/关闭行为：打开时并行拉摘要与日志尾部；**摘要拉取失败只打控制台日志、不阻断日志展示**（任务记录可能不存在或日志已超期清理，而日志本身仍可能读到）。关闭时清空摘要、级别筛选复位为 `all`、日志状态 `reset()`。

`useCanvasDialogs` 中的 `logDialog` 状态为 `{ show, nodeId, taskId, nodeName }`；`resetAll()` 会关闭它并清空三个字段——切换画布目标（分镜/场景切换）时由 `AssetCanvas` 调用，避免对话框残留指向旧画布的任务。

## 系统设置「日志」（`TaskLogSettingsSection.vue`）

子类注册表在 `SystemSettingsPanel.vue` 的 `SECTIONS`：`{ key: 'taskLog', label: '日志', icon: 'mdi-text-box-outline', hint: '任务日志 · 保留期、清理与占用统计' }`，模板中按 `section.key` 挂载 `TaskLogSettingsSection`（`trash` 挂 `TrashSettingsSection`）。`useSystemSettings()` 暴露 `dialogOpen` / `targetSection` / `openSystemSettings(section)`，`SystemSettingsSection` 类型即 `'trash' | 'taskLog'`。

| 元素 | 文案 / 状态含义 |
|------|-----------------|
| 说明段落 | 「任务日志记录每次 AI 生成 / 视频处理任务的执行过程（提交、进度、产物落盘、失败原因），保存在 `data/workflow.db` 的 `task_logs` 表中，可在「任务管理器 → 历史」中查看。」并强调「运行中任务的日志永不删除」 |
| 占用卡片 | 见下方字段表；`stats` 为 `null` 时整卡不渲染 |
| 启用开关 | 「启用定时自动清理」 |
| 执行间隔 | 数字输入，后缀「小时」，规则 1~720 的整数；`!enabled` 时禁用；hint「距上次执行达到该间隔即触发一轮清理」 |
| 日志保留期 | 数字输入，后缀「天」，规则 1~3650 的整数；hint「已结束任务的日志超过该天数会被清理（任务管理器「历史」仍可列出任务本身）」 |
| 轮询心跳间隔 | 数字输入，后缀「秒」，规则 0~3600 的整数；hint「生成任务轮询期间状态不变时，每隔该秒数记录一条心跳日志；0 = 不记录（日志量最小）」 |
| 保存/放弃 | 「保存配置」`:disabled="!isDirty"`；「放弃修改」`:disabled="!isDirty \|\| saving"` → `resetForm()` 从 `saved` 快照回滚 |
| 立即清理超期日志 | `variant="tonal"` `color="primary"`，经 `confirm` 后调 `cleanTaskLogs()` |
| 清空历史日志 | `variant="tonal"` `color="error"`，经 `confirm` 后调 `purgeTaskLogs()` |
| 错误提示 | `v-alert`（加载失败 / 保存失败 / 清理失败 / 清空失败各有独立文案，且都 `console.error`） |
| 反馈 | 内部 `v-snackbar`（4 秒，位置 bottom） |

占用卡片字段（对应 `GET /api/system/task-log/stats`）：

| 卡片文案 | 字段 | 说明 |
|----------|------|------|
| 日志行数 | `totalRows` | 千分位格式化 |
| 表 + 索引占用 | `tableBytes + indexBytes` | `dbstat` 实测；不可用时为 0 |
| 数据库文件占用 | `fileBytes` | 主库 + WAL + SHM |
| 最早日志 | `oldestAt` | SQLite UTC 串 → 本地 `YYYY-MM-DD HH:MM`；为空显示「—」 |
| 可清理（超期终态日志） | `cleanableRows` | 用于 confirm 文案的「当前可清理约 N 行」 |
| 运行中任务日志（受保护） | `activeRows` | 用于清空 confirm 的「保留运行中 N 行」 |
| 上次清理 | `lastRunAt` | 为空显示「从未执行」 |
| 下次清理 | `nextRunAt` | 为空显示「未启用」 |
| 空闲页提示 | `freelistCount` / `freelistBytes` | 仅 `freelistCount > 0` 时显示回收提示 |

## 空态与兜底文案汇总

| 位置 | 触发条件 | 文案 |
|------|----------|------|
| 进行中列表 | 无活跃任务 | 「暂无进行中的任务」 |
| 进行中列表底部 | 面板打开期间有任务收敛 | 「本次面板打开期间已有 N 个任务完成」 |
| 历史列表 | 当前筛选无数据且非加载中 | 「该时间范围内暂无历史任务」+「历史任务列表保留在数据库中；任务日志默认保留 N 天」 |
| 历史列表 | 加载中且无数据 | 转圈 |
| 历史列表 | 请求失败 | 「{error}」alert |
| 节点遮罩 | `status.errorMsg` 为空 | 「任务失败」 |
| 节点遮罩 | `status.taskId` 为空 | 「详情」按钮**不渲染**（只剩「重试」） |
| 节点「详情」 | `openNodeLog` 收到空 taskId | snackbar「该任务没有可查询的日志（本地校验失败或日志已超期清理）」，对话框不打开 |
| 日志区 | 请求中 | 「加载中…」 |
| 日志区 | 有日志但被级别过滤掉 | 「当前筛选条件下没有日志」 |
| 日志区 | 该任务确实没有日志行 | 「暂无日志（可能已超出保留期被自动清理）」 |
| 日志区 | 请求失败 | 「读取日志失败：{error}」（保留已加载日志） |
| 历史行 | 无画布定位 | 「无画布定位」 |
| 系统设置占用卡 | `oldestAt` 为空 | 「—」；`lastRunAt` 为空 → 「从未执行」；`nextRunAt` 为空 → 「未启用」 |

## 设计取舍与注意

- **「详情」按钮只在 `status.taskId` 存在时渲染**：本地校验类错误（缺输入、连线不合法等）在提交前就被拦下，服务端从未创建任务，也就没有可查的 `task_logs`；渲染一个点了没内容的按钮不如不渲染。`openNodeLog()` 里仍有 snackbar 兜底分支——它覆盖的是「渲染后状态被收敛/重置」这类竞态，而不是正常路径。
- **历史列表保留，日志会被清理**：日志清理只删 `task_logs` 行，`tasks` 行与产物一律保留，因此一个很久之前的老任务仍然出现在「历史」里，但展开后日志为空。这正是日志空态写成「暂无日志（**可能已超出保留期被自动清理**）」而不是「该任务没有日志」的原因；同理节点「任务详情」的摘要请求可能 404，此时只打日志、不影响日志区渲染。
- **默认只取尾部 200 条**：单任务日志可达上千行，全量搬进浏览器既慢又没必要。截断时摘要文案必须显式写「仅显示最后 N 条（共 M 条）」，否则用户会误以为日志丢了一半；「查看全部」是一次显式的全量请求（`limit=0`）。
- **级别过滤藏在客户端**：过滤只作用于已加载的条目，不改变服务端请求。所以「仅显示最后 200 条……筛选后 3 条」的意思是「这 200 条里有 3 条命中筛选」，想找更早的命中项要先「查看全部」。
- **「中断」不弹确认，「清空日志」一定弹**：中断不是删除（任务记录、产物、历史版本都保留，且可重试），误点代价低；而 `task-log/purge` 不可撤销，必须走 `confirm` 工具函数并显示受影响行数——与仓库「所有删除类操作必须弹窗确认」的约束一致。
- **两个页签来自两个事实源**：「进行中」来自内存注册表（WS 广播），「历史」来自 SQLite。因此 `ffmpeg` / `llm` 任务完成后**不会**出现在「历史」里——它们不落盘。要查它们的执行过程，只能在运行期间看「进行中」的日志尾行或节点遮罩。
- **完成计数是推断值**：「本次面板打开期间已有 N 个任务完成」通过活跃条数下降推断，只能得到数量，既不知道是哪个任务，也区分不了完成 / 失败 / 中断。
- **固定高度 + 内部滚动**：面板 body、历史列表、日志区都有固定 `max-height`（460 / 460 / 300 或 420），页面本身不因日志变长而抖动；秒级计时器只在面板打开期间运行，关闭即清理。
- **系统设置子类是注册表驱动**：新增系统属性时在 `SECTIONS` 里注册 key 并挂载组件、同步扩展 `SystemSettingsSection` 类型即可，`openSystemSettings(key)` 的定位逻辑无需改动。

相关文档：[api.md](./api.md)（接口与字段）、[log.md](./log.md)（日志级别、降噪、保留期与清理）、[data-model.md](./data-model.md)（`TaskInfo` / `TaskResponse` / `LogEntry` 字段来源）、[events.md](./events.md)（WS 协议与 `taskSocket`）、[../canvas/generation.md](../canvas/generation.md)（画布节点生成与状态机）、[../canvas/task-architecture.md](../canvas/task-architecture.md)（画布视角的统一任务架构）。
