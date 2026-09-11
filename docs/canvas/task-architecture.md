# 统一异步任务架构与任务管理器

> 返回 [总览与定位](./README.md) · 设计文档：[`../plans/2026-09-09-unified-async-task-manager.md`](../plans/2026-09-09-unified-async-task-manager.md)
>
> **本文是画布视角**（分层图、三类任务接入、WS 消息、画布 Loading 恢复与中断交互）。
> 跨模块的完整任务管理机制（数据模型、生命周期、执行侧实现、接口清单、**任务日志的分级/降噪/保留期清理**、任务管理器「进行中 + 历史」界面、开发指南）见 [`../task-manager.md`](../task-manager.md) 及其分主题文档。

## 目标

系统内**所有**异步任务（AI 生成工作流 / LLM 会话 / 本地 ffmpeg 处理）统一登记进**一个注册表**，作为任务运行态的**唯一事实源**：任务管理器面板、画布 Loading 恢复、中断操作全部读这里。

解决的问题：

| 任务类型 | 改造前 | 改造后 |
|----------|--------|--------|
| 工作流（AI 生成） | SQLite + 引擎轮询 + 前端 2s 轮询，独立一套 | 登记进注册表（SQLite 仍是持久化权威），列表统一 |
| LLM 会话 | 内存会话管理器 + 独立面板 | 会话 id 即任务 id，纳入统一列表 |
| ffmpeg（拼接/裁剪/取帧） | **同步阻塞路由**：无 taskId、无进度、无法中断 | **异步任务**：立即返回 taskId，进度/终态经 WS 推送，可真中断 |

## 分层设计

```
┌─────────────────────────────────────────────────────────────┐
│ 前端 TaskManagerDialog / 画布节点 Loading / taskSocket       │
└───────────────────────────┬─────────────────────────────────┘
                            │ WS（/llm-ws）：tasks 全量 + task-update 增量
┌───────────────────────────▼─────────────────────────────────┐
│ tasks/task-ws.ts  广播枢纽（唯一任务源 → 全量 + 增量）        │
├─────────────────────────────────────────────────────────────┤
│ tasks/registry.ts  统一任务模型 + 事件（运行态唯一事实源）     │
│   register / update / finish / cancel / listActive / on      │
├─────────────────────────────────────────────────────────────┤
│ tasks/executor.ts  执行器门面（写侧统一：create/run/cancel）  │
│   ├─ tasks/ffmpeg-executor.ts   完整实现（spawn + 进度 + kill）│
│   ├─ tasks/llm-executor.ts      薄适配（会话 id 即任务 id）   │
│   └─ tasks/workflow-executor.ts 镜像适配（登记 + 取消委托）   │
└─────────────────────────────────────────────────────────────┘
```

**分层要点**：注册表**不认识任何具体执行器**——它只调 `record.handle.cancel()`（`TaskHandle` 由执行器注入），因此永远不感知 ffmpeg 子进程或 `AbortController`。门面服务于真实重复（ffmpeg 三个操作共享同一生命周期），不为对称而对称。

`executor.ts` **只放接口**，避免 `registry.ts` 与具体执行器相互 import 形成循环依赖。

## 统一任务模型（`tasks/registry.ts`）

```ts
type TaskType = 'workflow' | 'llm' | 'ffmpeg'
type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

interface TaskRecord {
  id, type, status, label          // 身份与展示
  project?, nodeId?, canvas?       // 画布定位（前端按 scope 恢复 Loading）
  progress?                        // 0~100；缺省 = 不确定进度
  startedAt, updatedAt, finishedAt?
  error?                           // 仅 failed
  cancelable, cancelBlockReason?   // 中断能力 + 置灰原因
  payload?                         // 类型自有字段（模式/输出尺寸/工作流实现…）
  handle?                          // 中断凭据：仅内存持有，不广播
}
```

| 方法 | 语义 |
|------|------|
| `register(input)` | 登记；**同 nodeId 单飞**（`TaskError('NODE_BUSY')`）+ 全局上限 32（`TASK_LIMIT`）；`idOverride` 可指定 id（LLM 会话 id 即任务 id） |
| `update(id, patch)` | 合并进度/状态/payload（payload 浅合并）；终态任务忽略 |
| `finish(id, outcome)` | 幂等终态：置状态 → 移出活跃区 → 广播；重复调用返回同一快照 |
| `cancel(id)` | 委托 `handle.cancel()`；不可中断返回 `{ok:false, reason}` |
| `listActive()` | 按登记时间倒序（同一毫秒用 `seq` 保证稳定） |
| `on(listener)` | 订阅 begin/update/finish 事件（WS 枢纽注册） |

## 三类任务接入

| 类型 | 登记点 | 中断实现 | 进度 |
|------|--------|----------|------|
| `workflow` | `workflow-engine.ts: runTask` 开始时登记（label = 实现名 + 画布定位 `nodeId`/`canvas`），完成/失败处 `finish` | `cancelWorkflowTask()`（复用 `canCancelTask` + Bridge cancel / deferredCancel 标记 + provider cancel） | 引擎每轮 `poll` 远端后 `workflowExecutor.update(taskId, {progress})` 写注册表 → 接口 `progress` 字段 + WS 广播；**仅服务商上报中间进度时才有值**（Bridge / 自定义 provider），否则缺省 → 不确定动画 |
| `llm` | `routes/llm.ts` 会话创建后 `llmExecutor.create`，`lifecycle` 回调同步阶段/终态 | `sessionManager.cancel`（abort 上游） | 无百分比 → 展示阶段（Thinking…/正在响应…） |
| `ffmpeg` | 四个路由（拼接/裁剪视频/裁剪音频/取帧）经 `startFfmpegTask` | `kill('SIGKILL')` + **删除半截产物** | `-progress` 解析 `timemark` → 真实百分比（登记时**不预置 0**；无 `duration` 的取帧不上报 → 不确定动画） |

**中断能力差异**：`cancelable` + `cancelBlockReason` 如实展示——工作流不支持中断时按钮置灰并显示原因（如「该工作流不支持中断」）。

**`deferredCancel`（同步执行类 provider 的取消语义）**：取消请求先写 `cancelRequested` 标记（引擎在写产物前检查 → 中断后绝不落产物），再尽力通知 provider `cancel` 中止在途请求；标记保证「无远端任务 id 的窗口」也能受理取消。自定义服务商的**所有工作流**（同步/异步）都恒声明 `cancelable: true` + `deferredCancel: true`：其 `execute` 立即返回任务 id 并由后台协程驱动「调用发起 → 在途请求 → 结果提取」，`cancel` 直接 `abort` 在途请求；未配置【取消调用】代码时中断仅本地生效（远端任务继续跑，但结果被丢弃、绝不落产物）——详见 [`../plans/custom-provider.md`](../plans/custom-provider.md) 的「任务中断」。

## ffmpeg 异步任务（`tasks/ffmpeg-executor.ts`）

- 命令构建与执行分离：`assets/*.ts` 导出 `buildXxxCommand()`（探测 + 校验 + 装配，返回 `FfmpegCommandSpec`），执行器负责 `save()` 与事件接管——**这样才能拿到进度与中断**。
- 进度：`cmd.on('progress', p => parseTimemarkSeconds(p.timemark) / duration)` → `registry.update(id, {progress})`（钳制 0~99）。
- 终态：`end` → completed；`error` 且 `cancelRequested` → cancelled；否则 failed（错误信息含 stderr 尾部）。
- 中断：标记取消 → `kill` → 删除产物（`removeOnCancel` 默认 true）→ 由 error 事件收敛为 cancelled。
- **不落中间文件**：重编码用单次 `filter_complex` 拼接。

## 传输层（`tasks/task-ws.ts`，路径仍为 `/llm-ws`）

| 方向 | 消息 |
|------|------|
| 服务端 → 客户端 | `{type:'tasks', tasks}` 全量（连接建立即推 + begin/update/finish 广播）、`{type:'task-update', task}` 增量（含 ffmpeg 进度）、LLM 专属 `snapshot`/`thinking`/`text`/`warning`/`finished`/`not-found` |
| 客户端 → 服务端 | `subscribe` / `unsubscribe` / `cancel`（统一中断） |

- **LLM 流式增量不进任务模型**：thinking/text 仍按 taskId 订阅单独推送，否则每个增量都会触发全量任务列表广播。
- WS 路径保持 `/llm-ws`（生产同源、vite 代理已配，改名无收益）。

## 服务端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tasks` | 活跃任务列表（可选 `?project=` 过滤；WS 不可用时的降级/调试路径） |
| POST | `/api/tasks/:taskId/cancel` | **统一中断入口**（路由到任务句柄；不可中断返回 404 + 原因） |
| POST | `/api/canvas/concat-video` | 拼接：**异步**，返回 `{taskId, status}` |
| POST | `/api/canvas/trim-video` | 裁剪视频：**异步** |
| POST | `/api/canvas/trim-audio` | 裁剪音频：**异步** |
| POST | `/api/canvas/extract-frame` | 取帧：**异步** |

四个 ffmpeg 接口的请求体均支持可选 `nodeId` / `canvas`（画布定位，供任务管理器展示与刷新后恢复 Loading）；`POST /api/workflow/run` 的 `params` 同样支持 `nodeId` / `canvas`（随任务 params 持久化，引擎登记注册表时透传）。

## 前端

| 模块 | 职责 |
|------|------|
| `canvas/taskSocket.ts` | 统一任务 WS 客户端（全局单例）：`tasks` 响应式列表、`task-update` 增量合并、`snapshotReady`（首个全量快照是否到达，恢复对账用）、`subscribe/unsubscribe/cancel`、断线指数退避重连 + 重订阅、`onFinished`（LLM 终态）、`onTaskUpdate`（任务增量）；`sessions` computed 兼容既有 LLM 视图 |
| `canvas/llmSocket.ts` | **兼容再导出**（既有 `llmSocket.xxx` 调用点无需改动；新代码用 `taskSocket`） |
| `components/TaskManagerDialog.vue` | 顶栏图标（`mdi-progress-clock` + 活跃任务数徽标）展开的面板：类型标记 / 状态（有真实进度显示「处理中 N%」）/ 进度条（有进度确定态、否则不确定）/ 已运行时长 / 画布位置 / 中断（不可中断置灰 + tooltip 原因） |
| `api/tasks.ts` | `listTasks` / `cancelTask`（HTTP 兜底） |
| `canvas/useCanvasGeneration.ts` | 提交时携带 `nodeId`/`canvas`；ffmpeg 任务：提交拿 taskId → `trackFfmpegTask` 订阅，进度与终态由 `onTaskUpdate` 统一消费；工作流任务：`poll()` 读响应里的 `progress`；两者都汇到 `GenerateStatus.progress`，由导出的 `nodeProgressPercent()` 决定节点遮罩渲染确定圆环+百分比还是不确定转圈；`restore(knownNodeIds)` 合并注册表 + SQLite 工作流任务恢复 Loading |

### 画布 Loading 恢复（已移除 localStorage）

原 ffmpeg 任务用 `localStorage`（`dsh.asset-canvas.tasks.*`）做刷新恢复，**已删除**：恢复数据源改为服务端侧，画布加载 / 切换目标时按「项目 + 画布 scope + 节点仍在画布上」过滤恢复；任务终态由 WS 广播/轮询收敛，无幽灵 Loading。

| 数据源 | 覆盖 | 说明 |
|--------|------|------|
| 统一任务注册表（`taskSocket.tasks`；WS 全量快照未就绪时 HTTP 兜底 `GET /api/tasks`） | ffmpeg + 已登记的工作流任务 | WS 连接建立即推全量；快照到达前画布若已加载会漏恢复，故保留 HTTP 兜底 |
| SQLite 工作流任务（`GET /api/workflow/tasks?project=&status=pending\|running`） | 工作流任务（图片/视频/TTS 生成） | 注册表**只在引擎开始执行时登记**：本地排队窗口（引擎 2s tick）与服务重启期间注册表为空，仅凭注册表会漏恢复 |

- 画布定位来源：提交时随任务携带 `nodeId` + `canvas`（ffmpeg 走请求体，工作流走 `params`），工作流任务的定位**随 params 持久化在 SQLite**，引擎登记注册表时透传（任务管理器也据此展示画布位置）。
- 恢复后：工作流任务续跑本地轮询（SQLite 为权威，含阶段日志），ffmpeg 任务重新订阅 WS 广播；**任务未到终态前节点保持加载中**，终态收敛时刷新产物展示。
- 两路结果按 `taskId` 去重；工作流任务仍保留本地轮询（`GET /api/workflow/tasks/:id`，引擎为权威），因为其状态推进在服务端队列中。
- **轮询只取最后一条日志**：`getTaskLogs(taskId, { limit: 1 })`（服务端直取尾部并命中主键索引）。原实现每 2 秒拉取全量日志，单任务可达上千行，属于纯浪费。

### 节点任务「详情」与历史查看

| 入口 | 说明 |
|------|------|
| 节点错误遮罩「详情」 | 生成失败时节点卡片在「重试」旁渲染「详情」（仅 `status.taskId` 存在时渲染——本地校验类错误没有可查询的日志），点击打开 `CanvasNodeLogDialog`：任务摘要（状态/耗时/错误信息）+ 完整日志（级别过滤、默认尾部 200 条、可「查看全部」） |
| 任务管理器「历史」页签 | 按时间范围/状态/项目筛选 SQLite 中的历史任务（默认最近 14 天，与日志保留期一致），逐条展开日志 |
| 节点运行遮罩进度 | 任务**有真实进度**时遮罩渲染确定态圆环 + 圈内百分比（`nodeProgressPercent()` 判定），无进度保持不确定转圈。工作流进度来自 `GET /api/workflow/tasks/:id` 的 `progress` 标准字段（引擎轮询远端写入注册表，**不落 SQLite**），ffmpeg 来自 `task-update` 广播 |

对话框状态由 `useCanvasDialogs` 的 `logDialog` 持有（`openNodeLog(nodeId, taskId)`，并纳入 `resetAll()`）；日志数据经 `composables/useTaskLogs.ts` 拉取。日志的保留期与清理见 [`../task-manager/log.md`](../task-manager/log.md)。

## 常见坑

- **filter_complex 的 concat 必须串联输入标签**：`[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]`。漏写输入标签会报 `No output pad can be associated to link label 'v0'`，只写 `concat=...` 则报 `Cannot find a matching stream for unlabeled input pad`。
- **fluent-ffmpeg 的 `inputOptions` 附着于「最近一次 input」**：追加 lavfi 静音源时须 `cmd.inputOptions([...]); cmd.input('anullsrc=...')` 成对出现，且静音源输入下标 = 段数 + 已追加的静音源数。
- **ffmpeg 命令构建必须与执行分离**：模块内直接 `save()` 会绕过执行器，导致无进度、无法中断。
- **中断要删除半截产物**：否则产物目录残留无法播放的 mp4，用户会误以为成功（旧产物已在 history 中，安全）。
- **注册表 finish 幂等**：终态快照保留在 `finished` Map 中（重复 `finish` 返回同一对象），避免调用方拿到 `null` 误判。
- **同一毫秒登记的任务排序**：`listActive` 用 `startedAt` + 内部 `seq` 排序，保证列表稳定。
- **同节点单飞**：注册表按 `nodeId` 拒绝并发（`NODE_BUSY`），前端提交前也会按节点状态拦截。
- **工作流任务不能只靠注册表恢复 Loading**：注册表只在引擎领取任务时登记，本地排队窗口（2s tick）与服务重启期间为空；画布恢复必须补查 SQLite `pending|running`，且画布定位要随 `params` 持久化（否则重启后无处可查）。
- **阻塞式 `submit` 等于不可中断**：引擎只有在 `submit` 返回后才持久化远端任务 id，此时取消才被受理。自定义服务商因此把「调用发起 + 在途请求」放进后台协程、`execute` 立即返回；同步 provider 若确实无法中止在途请求（火山方舟 / OpenAI 兼容），必须声明 `deferredCancel`，否则「生成期间」的中断请求会被 `canCancelTask` 拒绝。
- **日志读取不传 `limit` 会拖全量**（单任务上千行）：画布轮询用 `limit: 1`，查看器用尾部 200 条再按需全量；`GET /api/workflow/tasks/:taskId/log` 的缺省行为仍是全量（向后兼容）。
- **轮询日志必须降噪**：2 秒一次无条件写日志曾让 `task_logs` 表 + 索引占到数据库的 87%（其中 92.6% 是连续重复行）。现为「状态/进度变化才记（`info`）+ 心跳兜底（`debug`，默认 60 秒，可配 0 关闭）」，见 [`../task-manager/log.md`](../task-manager/log.md)。
- **判定磁盘回收看 `freelist_count`，不看文件大小**：`VACUUM` 会把文件截断到实际数据量，但 Windows 等平台的 `stat` 大小可能不缩小（甚至因重新分配而变大），只按文件大小校验会得出「清理无效」的错误结论。
- **进度不可伪造**：`progress` 的语义是「真实上报过」，「有值」直接决定节点遮罩与任务管理器渲染确定百分比还是不确定动画。禁止在登记时预置 `0`（无 `duration` 的取帧任务会永久显示「0%」）、禁止按耗时估算、禁止按轮询次数假推进；**provider 侧同样不得把「未上报」兜底成 0**（ComfyUI Bridge 排队期间不报 `progress`，曾经的 `progress ?? 0` 会让视频任务在队列里挂几十分钟的「0%」，现已改为缺省）。判定统一走 `nodeProgressPercent()`，不要在组件里各写一套 `?? 0`。
