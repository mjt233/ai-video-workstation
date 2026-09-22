# 工作流完成通知气泡

> 返回 [总览与定位](./README.md)

资产画布（以及任何页面）在**工作流任务**执行完成时，于页面右下角弹出**独立的气泡卡片**：
可直接预览产物、点开放大、`×` 手动关闭，**30 秒后自动消失**。要看历史记录（含更早的任务、
失败原因、日志）去**任务管理器抽屉 →「历史」页签**。

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ ✓ 生成图片 · …            ×  │   │ ✗ 生成视频 · …            ×  │
│ p · 分镜第1集 3# · 节点 ab12 │   │ 失败原因：远端任务超时        │
│ ┌──────────────────────────┐ │   │ [查看日志]                    │
│ │ 产物缩略图（点击放大预览）│ │   └──────────────────────────────┘
│ └──────────────────────────┘ │
└──────────────────────────────┘
     （最多 3 张，各自 30s 自动关闭）
```

## 一、触发来源（单一路径：统一任务广播）

气泡只由**统一任务注册表经 WS 广播**的终态驱动：`App.vue` 挂载时
`installWorkflowNotifyListener()` → `taskSocket.onTaskUpdate` → `canvas/notify.ts: pushWorkflowFinished()`。

| 判据 | 规则 |
|------|------|
| 任务类型 | **仅 `type === 'workflow'`**（生成图片 / 生成视频 / TTS 声音生成 / 文本生成）；ffmpeg / LLM 任务不弹 |
| 终态 | 仅 `completed`（成功卡）与 `failed`（失败卡） |
| 用户主动中断 | 不弹（引擎把中断收敛为 `failed` + 原因「用户中断」，画布节点已有「已中断」反馈） |
| 去重 | 同 `taskId` 已存在卡片则忽略（注册表 `finish()` 每个任务只 emit 一次终态，守卫只覆盖异常重复推送） |

**为什么不加画布轮询兜底**：气泡是"便利层"而非事实源。画布节点的 Loading / 产物刷新由既有
机制保证（工作流轮询 + `onResult`），任务管理器「历史」读 SQLite 跨刷新持久；因此 WS 断线
窗口内完成的任务不弹气泡是可接受的降级（不引入双路径去重与任务快照表）。

## 二、卡片规则（`canvas/notify.ts`）

| 项 | 值 |
|----|----|
| 自动关闭 | `WORKFLOW_NOTIFY_AUTO_CLOSE_MS = 30_000`（**固定 30 秒，无设置项、无悬浮暂停**） |
| 同时上限 | `WORKFLOW_NOTIFY_MAX = 3`，超出先移除最旧的一张（并清掉它的定时器） |
| 计时方式 | **每张卡片各自计时**（新卡片不延长旧卡片的剩余时间） |
| 手动关闭 | 卡片右上角 `×` → `dismissWorkflowNotify(taskId)`（同时清理定时器） |
| 过渡动画 | `TransitionGroup` 统一驱动：**入场**淡入 + 轻微上移（220ms）；**离场**淡出 + 右移并收起自身占位高度（约 240ms，剩余卡片平滑上移）。`×`、30s 超时、抽屉打开时的整栈隐藏三条移除路径共用同一套离场动画 |
| 持久化 | **无**（纯内存）：刷新页面后气泡消失，历史记录仍在任务管理器 |
| 抽屉打开时 | 整栈隐藏（`WorkflowNotifyStack` 的 `hidden` prop，由 `App.vue` 传 `sessionsOpen`）——右下角正是抽屉本体所在区域，且「历史」页签提供同样的预览能力；**计时不暂停**，关闭抽屉后未超时的卡片继续显示 |

卡片字段全部来自广播载荷，**不额外请求接口**：

| 字段 | 来源 | 说明 |
|------|------|------|
| `title` | `task.label` | 工作流实现名（如「Bridge 文生图」） |
| `subtitle` | `task.project` + `task.canvas` + `task.nodeId` | 项目 · 画布定位 · `节点 {nodeId 前 8 位}`；无定位信息时整行不渲染 |
| `outputPath` | `task.payload.outputPath` | 引擎登记注册表时写入；失败任务为空 |
| `mediaKind` | `mediaKindOfPath(outputPath)`（`canvas/preview.ts`） | `image` / `video` / `audio` / `none`，**只按扩展名判定** |
| `mediaUrl` | `buildPreviewUrl(project, outputPath, Date.now())` | 产物是固定文件名 `output.{ext}`，必须以入栈时刻作缓存键，否则浏览器复用上一次的缓存图 |
| `errorMsg` | `task.error`（失败任务） | 服务端 `workflowExecutor.finish(taskId, status, error)` 随终态广播下发；缺失时回退「执行失败（详见任务管理器 → 历史）」 |
| `textTask` | `task.payload.workflowId === 'text-generation'` | 文本生成任务（产物是文本、无文件）：卡片不拼媒体 URL、不显示「产物路径未知」，改为一句话指引（文本在画布节点与任务详情可见）。**有意不为此额外请求接口**：终态广播载荷不含产物内容（注册表 payload 只有 workflowId/impl/outputPath） |

## 三、卡片交互（`WorkflowNotifyStack.vue`）

| 产物类型 | 卡片内 | 点击行为 |
|----------|--------|----------|
| 图片 | 缩略图（`object-fit: contain`，固定 132px 高） | 打开 `CanvasMediaPreviewDialog` 放大预览（含文件名/下载/关闭） |
| 视频 | `<video preload="metadata" muted>` 取首帧（URL 附 `#t=0.1`） | 同上，对话框内 `<video controls autoplay>` |
| 音频 | `<audio controls>` 内联试听 | 不放大（TTS 结果直接听） |
| 文本产物（无文件） | 浅底说明条：「文本产物已完成，可在画布节点或「任务管理器 → 历史 → 任务详情」查看」 | — || `none` / 加载失败 | 占位文案：`产物：{文件名}` / `产物加载失败` / `已完成（产物路径未知）` | — |
| 失败任务 | 红字原因 + **「查看日志」** | 打开任务管理器抽屉并切到「历史」页签（**不做任务级定位/自动展开**，实施成本与竞态更高） |

## 四、与任务管理器（抽屉）的分工

| 能力 | 气泡 | 任务管理器抽屉（「历史」页签） |
|------|------|------------------------------|
| 主动提醒 | ✅ 无需操作即出现 | ❌ 需手动打开（顶栏图标） |
| 自动消失 | ✅ 固定 30s | ❌ 常驻，直到用户关闭 |
| 产物预览/放大 | ✅ 图片/视频/音频（文本任务为指引文案） | ✅ 历史行内缩略图 + 同一放大对话框（文本任务为文本图标，点击打开任务详情看全文） |
| 历史回看（跨刷新） | ❌ 纯内存 | ✅ SQLite（`ORDER BY created_at DESC`，第一条即最近完成） |
| 失败原因/日志 | 仅原因 | ✅ 原因 + 日志（行右侧按钮打开「任务详情」对话框） |

抽屉的「进行中」页签底部仍保留「本次打开期间已有 N 个任务完成」的推断计数，并新增
**「查看最近完成 →」**按钮：切到「历史」页签并刷新（`TaskHistoryPanel` 的 `reloadToken` prop）。

**完成 → 历史列表自动刷新**：`notify.ts` 另外维护一个**工作流终态计数器** `workflowFinishedTick`
（`pushWorkflowFinished` 对**任何**工作流终态自增：成功、失败、用户中断都算，即使用户中断不弹气泡）。
`TaskHistoryPanel` 自己监听它并重新拉取首批 —— 历史数据来自 SQLite，不会自动感知新任务。该监听
**与抽屉开关无关**：抽屉停在「进行中」页签、甚至关闭期间完成任务时，已挂载过的历史面板会在后台
重新拉取，用户下次展开「历史」看到的就是最新列表（从未展开过则首次激活时本就会加载）。
唯一的例外是**用户已滚动离开列表顶部**（`scrollTop > 4`）：此时不刷新以避免视图跳动，顶部新任务
由气泡负责提醒。用户显式要求跳到最新（气泡「查看日志」/「查看最近完成 →」）则仍走
`TaskManagerDrawer` 的 `reloadToken`，总是回到列表顶部。

## 五、相关文件

| 文件 | 职责 |
|------|------|
| `frontend/src/canvas/notify.ts` | 气泡 store：推送 / 关闭 / 30s 计时 / 3 张上限 / 广播监听安装；**`workflowFinishedTick`**（工作流终态计数器，供任务管理器刷新「历史」） |
| `frontend/src/components/canvas/WorkflowNotifyStack.vue` | 右下角气泡栈（卡片模板内联，含音频播放、放大入口与 `TransitionGroup` 进出场过渡） |
| `frontend/src/components/canvas/CanvasMediaPreviewDialog.vue` | 图片/视频放大预览对话框（气泡与任务管理器历史行共用） |
| `frontend/src/canvas/preview.ts` | `buildPreviewUrl()` + `mediaKindOfPath()` |
| `frontend/src/App.vue` | 挂载气泡栈、安装/卸载广播监听、抽屉打开时隐藏气泡 |
| `server/src/tasks/workflow-executor.ts`、`server/src/workflow-engine.ts` | 失败终态透传 `error`（气泡显示原因的唯一来源） |

## 六、测试与验证

- 单测 `frontend/src/canvas/notify.test.ts`（fake timers）：30s 到期移除、多卡独立计时、
  `×` 立即移除、3 张上限淘汰最旧且不误伤其他卡片、同 `taskId` 去重、非工作流/非终态/已中断不弹、
  成功卡媒体类型与预览 URL、失败卡无预览且有原因、副标题拼接、监听只消费工作流任务且可退订、
  **`workflowFinishedTick` 对任何工作流终态自增（含用户中断）而非终态/非工作流不计数**。
- 单测 `frontend/src/canvas/preview.test.ts`：`mediaKindOfPath` 扩展名判定（含 Windows 反斜杠路径）。
- 单测 `server/src/tasks/workflow-executor.test.ts`：`finish` 携带/不携带 `error` 的终态广播形状。

**已知边界**：WS 断线期间完成的任务不弹气泡（历史照常可查）；气泡纯内存、刷新即消失；
自动搭画布等入口触发的「直接复制场景图」工作流任务完成时同样会弹气泡（它也是工作流任务）。
