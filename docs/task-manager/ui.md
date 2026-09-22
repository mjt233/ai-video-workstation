# 任务管理界面

> 返回 [任务管理总览](../task-manager.md)

本文件说明任务管理相关的**前端界面**：每个入口在哪个组件、每段文案/状态是什么意思、空态与兜底在哪里，以及三条主要用户流程。接口与字段来源见 [api.md](./api.md)，日志分级与保留期语义见 [log.md](./log.md)，数据模型见 [data-model.md](./data-model.md)。

三条容易踩的实现约束（改这块前先读，细节见文末「设计取舍与注意」）：

1. **历史列表的滚动加载用 Vuetify `<v-infinite-scroll>` 组件**（Vuetify 4 **已无同名指令**；intersect 模式下 `#error` 槽**不可省**，否则 `done('error')` 后永久卡死，`#loading` 槽在 `ok` 状态也会被渲染）；
2. **历史只按「时间范围 + 状态」筛选**——「项目」筛选项已移除（服务端 `project` 参数保留给其他调用方，接口契约不变）；
3. **气泡负责「不用操作就能看到」，任务管理器负责「回看与排障」**——进度/终态提示与日志查看的分工见 [../canvas/notification.md](../canvas/notification.md)。

## 界面地图

| 入口 | 组件 | 数据来源 |
|------|------|----------|
| 顶部栏右上角「任务管理器」图标（`mdi-progress-clock`，红色徽标 = 活跃任务数） | `frontend/src/App.vue` → `components/TaskManagerDrawer.vue` | `taskSocket.tasks`（WS 广播） |
| 任务管理器抽屉（**右侧 `v-navigation-drawer`，temporary 浮层**）→「进行中」页签 | `TaskManagerDrawer.vue` | `taskSocket.tasks`（内存注册表快照） |
| 任务管理器抽屉 →「历史」页签（**滚动加载** + 行内产物缩略图与放大预览；日志走「任务详情」对话框） | `components/task/TaskHistoryPanel.vue`（行展示纯函数：`components/task/historyFormat.ts`） | `GET /api/workflow/tasks`（首批 + 滚动追加） |
| 工作流完成通知气泡（右下角，固定 30s 自动关闭，最多 3 张） | `components/canvas/WorkflowNotifyStack.vue` ← `canvas/notify.ts` | `taskSocket.onTaskUpdate`（工作流任务终态广播） |
| 产物放大预览对话框（气泡与历史行共用） | `components/canvas/CanvasMediaPreviewDialog.vue` | 纯展示（URL 由父级传入） |
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

### (b) 任务管理器 → 历史 → 筛选/滚动加载 → 看日志

1. 点顶部栏「任务管理器」图标 → **右侧滑出抽屉**（`v-navigation-drawer` `location="right"` `temporary`，宽 460px、窄屏 `max-width: 92vw`；点遮罩或按 ESC 关闭；**浮层不挤压主内容**，画布不重排）。默认停在「进行中」页签；抽屉打开期间右下角的工作流完成气泡整栈隐藏。
2. 切到「历史」页签 → `TaskHistoryPanel` 首次激活（`active` 由 `tab === 'history'` 驱动，且 `tasks.length === 0`）才发请求：按默认筛选（最近 14 天、全部状态）取**首批 30 条**（`limit: 30, offset: 0`）。**外部跳转刷新**：`reloadToken` prop 自增（来自「进行中」的「查看最近完成 →」或完成气泡的「查看日志」）会重新拉取首批。
3. 改筛选：时间范围 / 状态下拉**立即**重新拉取首批并回到列表顶部（`listKey` 自增重建列表组件）。筛选只有这两项——「项目」筛选已移除（见下方设计取舍）。
4. 滚动加载：列表撑满抽屉剩余高度，滚动到距底 120px 时自动追加下一批（`offset` = 已加载条数，按 `taskId` 去重）；尾部状态区显示「正在加载…」/「已显示全部 N 个任务」/「加载失败：{原因} + 重试」。**首批不满一屏时不需要用户滚动**：组件在 `done('ok')` 后会用 3 帧 rAF 重新检查哨兵并继续加载。
5. 点某行右侧「查看日志」→ 打开**「任务详情」对话框**（`CanvasNodeLogDialog`，与画布节点错误遮罩的「详情」是同一个组件）：并行拉取任务摘要（状态 / 耗时 / 错误）与日志尾部 200 条，日志区 420px。
6. 关闭对话框（右上角 ✕ 或 ESC）→ 摘要清空、级别筛选复位 `all`、日志状态 `reset()`。ESC 的执行顺序由抽屉守卫保证：上层有打开的对话框时先关对话框，再按一次才关抽屉。

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

## 任务管理器抽屉（`TaskManagerDrawer.vue`）

**右侧抽屉**（`v-navigation-drawer` `location="right"` `temporary`，宽 `460px`，CSS `max-width: 92vw`），头部为图标 + 「任务管理器」+「（N 个进行中）」（`activeTasks.length > 0` 时才渲染）+ 关闭按钮；下方为页签（**进行中 / 历史**）与满高内容区（各页签内部滚动）。`props.modelValue` 控制显隐，`props.tasks` 由 `App.vue` 注入 `taskSocket.tasks.value`；`props.openTab` + `props.openToken` 支持外部请求定位页签（令牌自增即切页签并刷新历史）。

选择 `temporary` 浮层而非挤压主内容，是为了避免画布（Vue Flow）在抽屉开合时发生尺寸重排。抽屉打开期间右下角的工作流完成气泡整栈隐藏（见 [../canvas/notification.md](../canvas/notification.md)）。

### 「进行中」页签

`activeTasks` = `props.tasks` 过滤 `status` 为 `running` / `pending`，按 `startedAt` 倒序。

| 元素 | 文案 / 状态含义 |
|------|-----------------|
| 行首图标 | `running` → 转圈 `v-progress-circular`；否则（`pending`）→ `mdi-clock-outline` 黄色时钟 |
| 类型 chip | `workflow` → 「AI 生成」（primary）；`llm` → 「LLM 会话」（purple）；`ffmpeg` → 「视频处理」（teal） |
| 名称 | `t.label`（任务展示名） |
| 状态文本 | `pending` → 「排队中」；`llm` running → `phase === 'responding'` ? 「正在响应…」: 「Thinking…」；其余 running **有真实 `progress` 时一律「处理中 N%」**（ffmpeg 与上报中间进度的工作流）；无进度时 `ffmpeg` → 「处理中…」、`workflow` → 「运行中…」；终态回退为「已完成 / 失败 / 已中断」 |
| 已运行时长 | `formatElapsed(startedAt)`：`mm:ss`，超过 1 小时为 `h:mm:ss`；由抽屉打开期间的 1 秒定时器刷新 |
| 画布位置 | `locationText(t)`：`project` + 画布中文标签（`kind === 'scene'` → 「分镜第{episode}集 {shot}#」；`stage` → 「场景 {stage} / {label}」）；无定位信息时整段（含分隔符）不渲染 |
| 进度条 | `v-if="t.status === 'running'"`；`progress` 为数字时显示真实百分比，否则 `indeterminate` |
| 「中断」按钮 | `variant="tonal"` `color="error"`；`:disabled="!t.cancelable"`；tooltip 文案 = `cancelable` ? 「中断该任务」: (`cancelBlockReason` \|\| 「该任务不支持中断」)。tooltip 用 `<span>` 包住按钮，保证 disabled 状态下仍能悬浮读原因 |
| 空态 | 图标 + 「暂无进行中的任务」 |
| 完成提示 | 底部「本次打开期间已有 N 个任务完成」+ **「查看最近完成 →」**按钮（切到「历史」页签并把 `historyReloadToken` 自增，触发历史列表重新拉取第一页——历史按 `created_at DESC`，第一条即最近完成的任务） |

「中断」点击 → `taskSocket.cancel(t.id)`（WS 优先 + HTTP 兜底，见 [api.md](./api.md) 第五节）+ 上抛 `notify('已请求中断「label」', 'primary')`。**不弹确认**：中断不是删除，任务记录与产物保留。

`finishedNoticeCount` 由「活跃列表条数下降」推断：抽屉打开时清零并把当前条数记为基线，之后每次 `activeTasks.length` 变小就累加差值；关闭抽屉时复位为「进行中」页签并停止计时器。

### 「历史」页签（`TaskHistoryPanel.vue`）

行展示相关的**纯函数**（定位文案、实现 id 简称、缩略图路径与类型、预览 URL、两行文案）都在 `components/task/historyFormat.ts`，由 `historyFormat.test.ts` 覆盖；组件只负责状态与模板。

| 元素 | 文案 / 状态含义 |
|------|-----------------|
| 时间范围 | 最近 1 / 3 / 7 / 14 / 30 天、「不限时间」（默认 14 天）；除「不限」外转成 `since = now - N 天` 的 ISO 串传给接口。**该下界在首批固定**并复用于追加批次（重算会让边界漂移、`offset` 与已加载数据错位） |
| 状态 | 全部状态（`''`）/ 已完成 / 失败 / 运行中 / 排队中 |
| 刷新 | 图标按钮（`mdi-refresh`，`aria-label`/`title` = 刷新）：重新拉取首批并回到顶部。**工作流任务收敛时自动刷新**：面板监听 `canvas/notify.ts` 的 `workflowFinishedTick`（`reloadToken` 只服务"用户显式要求跳到最新"的两条路径），已滚动离开顶部时不打断（见设计取舍） |
| 筛选条布局 | 固定一行：两个下拉各 `flex: 1 1 0`（`min-width: 96px`）+ 刷新图标按钮；**已无「项目」输入框** |
| 列表容器 | `<v-infinite-scroll>` **组件**根元素即滚动容器（`flex: 1 1 auto; min-height: 0` + 自带 `overflow-y: auto`）；`:key="listKey"` 自增即重建（复位 `empty`/`error` 状态与滚动位置） |
| 行 - **产物缩略图** | 仅 `completed` 且产物为**图片/视频**时渲染（`thumbPathOf`）：48×48（图片 `<img>`、视频 `<video preload="metadata">` 取首帧），`title` 为产物路径，**点击打开 `CanvasMediaPreviewDialog` 放大预览**（与完成气泡共用组件）；音频/非媒体产物、失败任务不渲染缩略图 |
| 行 - 无产物占位 | 与缩略图**同宽同位**的虚框占位（低对比 `mdi-image-off-outline`），保证有/无缩略图的行文字左边界对齐；缩略图加载失败（产物所在项目已删除/回收，`assert/...` 404）时也回退到该占位——任务行永不删除，这类 404 是正常现象 |
| 行 - 第一行 | 状态 chip（`completed` → 「已完成」success；`failed` → 「失败」error；其余 → 「运行中」/「排队中」primary）+ `workflowId`（粗体、单行省略、`title` 全文）+ `createdAt`（本地 `MM-DD HH:MM`，`flex: 0 0 auto` 不换行）+ 日志图标按钮（`mdi-text-box-search-outline`）。chip 有 `flex: 0 0 auto` + `nowrap`——否则会被长工作流名挤成竖排 |
| 行 - 第二行 | `rowSecondaryText(t)`：`locationText(t)`（「分镜 {集}-{镜}」或「场景 {场景}/{子场景}」+「节点 {nodeId 前 8 位}」，无定位时「无画布定位」）· `shortImpl(t.impl)`（剥掉实例 UUID 与 `ceb-` 前缀）· 错误原因（优先）或产物文件名。整行强制单行省略，完整文本（未截短的实现 id + 完整产物路径）在 `title` 里（`rowSecondaryTooltip`） |
| 行 - 日志按钮 | 打开「任务详情」对话框（`CanvasNodeLogDialog`：状态 / 耗时 / 错误摘要 + 420px 日志区）。**行内不再展开日志**，因此每行高度恒定 |
| 滚动加载 | 首批 30 条（`limit: 30, offset: 0`）；距底 120px（`margin` prop）自动追加下一批；`done('ok')` 后组件重新检查哨兵 → 首批不满一屏会自动续拉；`done('empty')` 收敛；追加结果按 `taskId` 去重，整页重复也收敛（避免无限续查） |
| 尾部状态区 | 加载中 → 转圈 + 「正在加载…」；已加载完 → 「已显示全部 {total} 个任务」；追加失败 → 「加载失败：{原因}」+「重试」（`done('error')`，已加载数据保留，同时 `console.error`） |
| 空态 | 图标 + 「该时间范围内暂无历史任务」（**不再**读系统设置展示日志保留期）。列表为空时**不挂载**无限滚动组件，从根上避免与「已加载完」的空态混淆 |
| 加载态 | 无数据且 `loading` → 转圈（列表为空时才显示；筛选变化期间保留旧列表） |
| 错误态 | `v-alert`「{error}」（首批读取失败；错误同时 `console.error`，已加载列表不被清空） |

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
| 最大高度 | `maxHeight` prop：节点详情对话框 420px、缺省 360px；超出内部滚动 |

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
| 进行中列表底部 | 抽屉打开期间有任务收敛 | 「本次打开期间已有 N 个任务完成」+ 「查看最近完成 →」 |
| 历史列表 | 当前筛选无数据且非加载中 | 「该时间范围内暂无历史任务」 |
| 历史列表 | 加载中且无数据 | 转圈 |
| 历史列表 | 首批请求失败 | 「{error}」alert（已加载列表保留） |
| 历史列表尾部 | 追加批次加载中 | 转圈 + 「正在加载…」 |
| 历史列表尾部 | 已加载完（`done('empty')`） | 「已显示全部 {total} 个任务」 |
| 历史列表尾部 | 追加批次失败（`done('error')`） | 「加载失败：{原因}」+「重试」 |
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
- **历史列表保留，日志会被清理**：日志清理只删 `task_logs` 行，`tasks` 行与产物一律保留，因此一个很久之前的老任务仍然出现在「历史」里，但点「查看日志」打开任务详情后日志为空。这正是日志空态写成「暂无日志（**可能已超出保留期被自动清理**）」而不是「该任务没有日志」的原因；同理节点「任务详情」的摘要请求可能 404，此时只打日志、不影响日志区渲染。
- **默认只取尾部 200 条**：单任务日志可达上千行，全量搬进浏览器既慢又没必要。截断时摘要文案必须显式写「仅显示最后 N 条（共 M 条）」，否则用户会误以为日志丢了一半；「查看全部」是一次显式的全量请求（`limit=0`）。
- **级别过滤藏在客户端**：过滤只作用于已加载的条目，不改变服务端请求。所以「仅显示最后 200 条……筛选后 3 条」的意思是「这 200 条里有 3 条命中筛选」，想找更早的命中项要先「查看全部」。
- **「中断」不弹确认，「清空日志」一定弹**：中断不是删除（任务记录、产物、历史版本都保留，且可重试），误点代价低；而 `task-log/purge` 不可撤销，必须走 `confirm` 工具函数并显示受影响行数——与仓库「所有删除类操作必须弹窗确认」的约束一致。
- **两个页签来自两个事实源**：「进行中」来自内存注册表（WS 广播），「历史」来自 SQLite。因此 `ffmpeg` / `llm` 任务完成后**不会**出现在「历史」里——它们不落盘。要查它们的执行过程，只能在运行期间看「进行中」的日志尾行或节点遮罩。
- **完成计数是推断值，但不再是唯一出口**：「本次打开期间已有 N 个任务完成」通过活跃条数下降推断，只能得到数量，既不知道是哪个任务，也区分不了完成 / 失败 / 中断。因此该提示右侧提供「查看最近完成 →」跳到「历史」页签（真实记录，按 `created_at DESC` 第一条即最近完成）；**主动提醒**则由右下角的工作流完成气泡承担（见 [../canvas/notification.md](../canvas/notification.md)）——两者分工：气泡负责"不用操作就能看到"，历史负责"回看与排障"。
- **抽屉而非对话框（`temporary` 浮层）**：任务管理器是"边干活边看"的面板，抽屉可长时间开着且不挤压主内容；`temporary` 保证画布（Vue Flow）不因开合重排尺寸。抽屉宽度 460px，历史筛选条 `flex-wrap` 换行适配；抽屉打开时右下角气泡整栈隐藏，避免与抽屉互相遮挡。抽屉的 ESC 关闭由组件自行监听（`v-navigation-drawer` 只处理遮罩点击），且上层有打开的对话框（如产物放大预览）时让对话框先关。
- **历史列表的自动保鲜**：历史页签只在首次激活时自动加载（`active` watch 的 `tasks.length === 0` 守卫），因此**任务收敛必须另行触发刷新**——面板自己监听 `notify.ts` 的 `workflowFinishedTick`（任何工作流终态，含用户中断）→ 重新拉取首批。该监听与抽屉开关无关（抽屉停在「进行中」页签、甚至关闭时完成任务，切回「历史」看到的都是最新列表），但**用户已滚动离开顶部（`scrollTop > 4`）时不刷新**：那时用户正在翻看旧任务，清空重建会让 `scrollTop` 被浏览器钳到底部、视图跳动，而顶部新任务已由右下角完成气泡负责提醒。抽屉的 `reloadToken` 只保留给"用户显式要求跳到最新"的两条路径（「查看最近完成 →」与气泡「查看日志」），它们总是回到顶部。
- **历史列表的滚动加载用 Vuetify 组件**：Vuetify 4 **已移除 `v-infinite-scroll` 指令**，只剩 `<v-infinite-scroll>` 组件（`VInfiniteScroll`），它自带滚动容器，`done('ok')` 后会用 3 帧 rAF 重新检查哨兵——因此"首批不满一屏自动续拉"是白送的，无需自己监听 `scroll` 算阈值。三个必须知道的约束：① intersect 模式下**必须提供 `#error` 槽**，否则 `done('error')` 后组件什么都不渲染且不再自动加载（永久卡死）；② 同一模式下组件对 `ok`（空闲）状态**同样渲染 `#loading` 槽**，所以该槽内容要用 `loadingMore` 自行判断，否则列表底部会永久挂着一个转圈；③ `done('empty')` 后组件不再自动加载，需外部复位——本项目用 `:key="listKey"` 自增**重建组件**，比调用其 `reset()` 更不易漏（状态与滚动位置一起复位）。`margin=120` 是提前 120px 预取（实现为哨兵的负 margin，不改变布局）；尾部状态区的 `#empty` 文案必须自定义，否则会落到 Vuetify locale 的默认英文文案。
- **移除「项目」筛选而不是保留**：460px 窄栏里它独占一行、却是低频操作（绝大多数任务是当前项目产生的），改成前端不再传 `project` 后筛选条压成一行、列表高度多出约 56px；服务端 `GET /api/workflow/tasks` 的 `project` 参数保留给其他调用方，接口契约不变。
- **历史行的日志放进「任务详情」对话框**：行内展开日志（`TaskLogViewer` + `useTaskLogs` 接线 + `expandedId`/`levelFilter` + 展开时的 `scrollIntoView`）与"两行定高 + 滚动加载"是互相干扰的两套机制，且日志区只有 300px。改为复用画布节点已有的 `CanvasNodeLogDialog`（自带状态/耗时/错误摘要，日志区 420px）后，行高恒定、面板少约 65 行状态代码，日志能力反而更强。
- **两行定高 + 原生 `title` 看全文**：第一行 `chip + workflowId + 时间 + 日志按钮`，第二行 `定位 · 实现简称 · 错误/产物文件名`，全部 `nowrap + ellipsis`。`impl` 里内嵌的服务商实例 UUID（`ceb-{实例id}-{可读名}` 或 `{可读名}-{实例id}`）剥掉后才显示，完整值放进 `title`；这样单行高度稳定在 ~64px，也不再出现 chip 被挤成竖排的情况。
- **固定高度 + 内部滚动**：抽屉内容区满高，历史页签的滚动容器就是 `<v-infinite-scroll>` 根元素（抽屉 body 在历史页签下 `padding: 0; overflow: hidden`，否则会出现双层滚动条与底部空白）；日志区在对话框里固定 420px 内部滚动；秒级计时器只在抽屉打开期间运行，关闭即清理。
- **系统设置子类是注册表驱动**：新增系统属性时在 `SECTIONS` 里注册 key 并挂载组件、同步扩展 `SystemSettingsSection` 类型即可，`openSystemSettings(key)` 的定位逻辑无需改动。

相关文档：[api.md](./api.md)（接口与字段）、[log.md](./log.md)（日志级别、降噪、保留期与清理）、[data-model.md](./data-model.md)（`TaskInfo` / `TaskResponse` / `LogEntry` 字段来源）、[events.md](./events.md)（WS 协议与 `taskSocket`）、[../canvas/generation.md](../canvas/generation.md)（画布节点生成与状态机）、[../canvas/task-architecture.md](../canvas/task-architecture.md)（画布视角的统一任务架构）。
