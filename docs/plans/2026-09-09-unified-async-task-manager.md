# 统一异步任务架构 + 任务管理器 + 拼接视频节点增强（copy / 重编码）

> 文档类型：需求与实现方案 · 状态：**已实施并验证**
> 关联文档：[`../canvas/task-architecture.md`](../canvas/task-architecture.md)（实施后的开发文档）、[`../canvas/llm-session.md`](../canvas/llm-session.md)、[`../canvas/node-types.md`](../canvas/node-types.md)、[`../canvas/generation.md`](../canvas/generation.md)

---

## 1. 主题与概要

### 1.1 一句话

把「资产画布拼接视频节点只支持规格一致的 `-c copy`」这一功能诉求，升级为**一次架构改造**：建立**统一异步任务架构**（工作流 / LLM 会话 / ffmpeg 三类任务同一注册表），新增**全局任务管理器**（查看系统当前所有进行中任务并中断），并在其上实现**拼接视频节点支持异构编码 / 分辨率合并**（用户可选 `copy` 或 `重编码`，重编码可选输出尺寸 `自定义 / 取最大的一段 / 取最小的一段`）。

### 1.2 交付物

| # | 交付物 | 说明 |
|---|--------|------|
| D1 | 统一任务注册表 + 执行器门面（服务端） | `server/src/tasks/`：单一任务源、统一模型、统一中断 |
| D2 | ffmpeg 接口异步化 | 拼接 / 裁剪视频 / 获取视频帧由同步阻塞改为「登记任务 → 立即返回 taskId → 后台执行」 |
| D3 | 任务管理器 UI | 顶栏图标 + 弹窗（由现有 `LlmSessionsDialog.vue` 升级），展示全部任务 + 真实进度 + 中断 |
| D4 | 拼接视频节点增强 | 编码方式 `copy/重编码` + 输出尺寸三策略 + 输入规格预检 |
| D5 | 文档与测试 | 新增 `docs/canvas/task-architecture.md`，更新既有画布文档，补单测 |

### 1.3 现状问题（为什么必须做架构）

| 任务类型 | 现状 | 问题 |
|----------|------|------|
| 工作流任务（AI 生成） | SQLite `tasks` 表 + 引擎轮询 + 前端 2s 轮询 | 与其余任务**各自一套**，无统一列表 |
| LLM 会话（AI 文本节点） | 内存 `session-manager` + `/llm-ws` 广播 + 独立面板 | 面板只覆盖 LLM，其他任务不可见 |
| ffmpeg（拼接/裁剪/取帧） | **同步阻塞 HTTP 路由** | 无 taskId、无进度、**无法中断**；大文件请求长期挂起 |

---

## 2. 沟通过程总结

### 2.1 需求演化

| 轮次 | 用户诉求 | 结果 |
|------|----------|------|
| 第 1 轮 | 拼接视频节点支持不同编码/分辨率合并，用户可选编码方式与输出尺寸 | 澄清 4 个语义歧义（见 §4），形成初版方案 |
| 第 2 轮 | **方案调整**：① 拼接接口异步化，创建可统一管理所有节点任务生命周期的架构；② 新增任务管理器（可见全部异步任务 + 中断），并把已有 LLM 活跃会话纳入 | 澄清 5 个架构问题（范围/持久化/中断程度/UI 位置/模型统一）+ 3 个补充问题（工作流接入方式/中断能力差异/进度展示） |
| 第 3 轮 | 追问「代码层面是否有必要设计统一异步执行器 interface 门面」 | 定论：**分层**——注册表（模型）+ 执行器门面（写侧）+ 任务句柄（中断），ffmpeg 完整实现门面，workflow/llm 为薄适配 |
| 第 4 轮 | 确认 `FfmpegExecutor.run()` 采用 **方案 A**（路由立即返回 taskId，画布走 WS 进度/终态驱动） | 方案冻结，产出本文档 |

### 2.2 讨论中的关键结论

1. **不能只做一个「统一执行器」**：三类任务的执行载体（DB 行 / 上游流 / 子进程）、进度来源、中断手段、状态权威源各不相同；单一 `run()` 门面必然内部分支，成为泄漏抽象。**统一边界应落在「登记 / 进度 / 中断」三个同构切面**。
2. **注册表是运行态唯一源**：工作流任务的**持久化**权威仍是 SQLite，但其**运行态展示**统一由注册表输出（真正单源，而非前端合并两个接口）。
3. **ffmpeg 是门面的最大受益者**：拼接 / 裁剪视频 / 获取视频帧三个操作共享完全相同的生命周期（spawn → 进度 → 终态 → kill），一次抽象三处复用。
4. **LLM 流式增量不进任务模型**：thinking/text delta 走独立的按 taskId 订阅通道，否则每个增量都会广播一次全量任务列表。
5. **ffmpeg 任务的中断必须是真中断**：kill 子进程 + 删除半截产物，否则会白耗 CPU 且可能用破损 mp4 覆盖上一次成功结果。

---

## 3. 需求任务清单

> 优先级 P0 = 本次必须完成；P1 = 本次完成但可稍后细化。

### 3.1 服务端

| ID | 任务 | 优先级 | 关键文件 |
|----|------|--------|----------|
| S1 | 定义统一任务模型 `TaskRecord` / `TaskType` / `TaskStatus` 与注册表单例 | P0 | `server/src/tasks/registry.ts` |
| S2 | 定义执行器门面 `TaskExecutor<TParams>` / `TaskHandle` 接口（仅类型，避免循环依赖） | P0 | `server/src/tasks/executor.ts` |
| S3 | `FfmpegExecutor`：spawn + `-progress` 解析 + 进度上报 + kill/清理 | P0 | `server/src/tasks/ffmpeg-executor.ts` |
| S4 | 拼接 ffmpeg 能力：`copy` / `reencode` 双模式、尺寸策略、filter graph、音轨补齐 | P0 | `server/src/assets/concat-video.ts` |
| S5 | 拼接 / 裁剪视频 / 获取视频帧路由异步化（登记任务 → 立即返回 taskId） | P0 | `server/src/routes/canvas.ts` |
| S6 | 统一任务路由：`GET /api/tasks`、`POST /api/tasks/:taskId/cancel` | P0 | `server/src/tasks/routes.ts` |
| S7 | 广播枢纽改造：`tasks` 全量 + `task-update` 增量 + 统一 `cancel` 命令 | P0 | `server/src/tasks/task-ws.ts` |
| S8 | LLM 会话纳入注册表（`LlmExecutor` 薄适配，中断经注册表） | P0 | `server/src/tasks/llm-executor.ts`、`server/src/llm/session-manager.ts` |
| S9 | 工作流任务登记进注册表（引擎创建/开始/终态集中登记；取消委托现有逻辑） | P0 | `server/src/tasks/workflow-executor.ts`、`server/src/workflow-engine.ts`、`server/src/routes/workflow.ts` |
| S10 | `GET /api/canvas/video-info` 返回值补 `codec` / `hasAudio`（供前端预检） | P0 | `server/src/routes/canvas.ts`、`server/src/assets/extract-frame.ts` |

### 3.2 前端

| ID | 任务 | 优先级 | 关键文件 |
|----|------|--------|----------|
| F1 | `llmSocket.ts` → `taskSocket.ts`：统一任务列表 + `cancel(taskId)`，保留 LLM 流式订阅 API | P0 | `frontend/src/canvas/taskSocket.ts` |
| F2 | `LlmSessionsDialog.vue` → `TaskManagerDialog.vue`：全任务列表 + 进度条 + 中断置灰原因 | P0 | `frontend/src/components/TaskManagerDialog.vue` |
| F3 | `App.vue`：图标换 `mdi-progress-clock`，徽标改为全部活跃任务数 | P0 | `frontend/src/App.vue` |
| F4 | 画布 ffmpeg 任务接入：提交拿 taskId → WS 驱动进度/终态；**移除 localStorage 恢复记录**，`restore()` 改由注册表按 scope 恢复 | P0 | `frontend/src/canvas/useCanvasGeneration.ts`、`frontend/src/components/canvas/AssetCanvas.vue` |
| F5 | 拼接编辑器：编码方式 / 输出尺寸 / 自定义宽高 + 输入规格探测与 copy 预检 | P0 | `frontend/src/components/canvas/editors/ConcatVideoEditor.vue` |
| F6 | `concatVideo()` API 与调用链参数透传 | P0 | `frontend/src/canvas/api.ts`、`frontend/src/components/canvas/composables/useCanvasNodeOps.ts` |
| F7 | `video-concat` 原型 `defaultConfig` 扩展 | P0 | `frontend/src/canvas/registry.ts` |

### 3.3 文档与测试

| ID | 任务 | 优先级 |
|----|------|--------|
| T1 | 新增 `docs/canvas/task-architecture.md`（统一任务架构 + 任务管理器） | P0 |
| T2 | 更新 `docs/canvas/llm-session.md` / `node-types.md` / `generation.md` / `editor-panel.md` / `development.md` / `README.md` / `AGENTS.md` | P0 |
| T3 | 服务端单测：`registry` / `ffmpeg-executor` / `concat-video` / `task-ws` | P0 |
| T4 | 前端单测：`taskSocket` / `useCanvasGeneration`（拼接参数与异步任务） | P0 |

---

## 4. 已澄清的问题（决策记录）

### 4.1 拼接语义（第 1 轮）

| 问题 | 决策 | 理由 |
|------|------|------|
| `copy` 模式遇到规格不一致 | **报错并提示改用「重编码」**（前端预检禁用按钮 + 服务端兜底报错） | 保持 copy 语义纯粹（无损、可预测），不做静默降级 |
| 「取最大/最小的一段」的含义 | **按像素面积**取那一段的完整宽高（1920×1080 与 1280×720 → 最大 1920×1080） | 与用户「哪一段最大」的认知一致；避免宽高分别取极值产生 1920×1920 这类怪尺寸 |
| 目标比例与原片不一致 | **等比缩放 + 居中留黑边（letterbox）** + `setsar=1` | 不裁切不拉伸，内容零损失 |
| 音轨与帧率归一化 | 音轨：**任一段有音频则全部补齐静音轨**（`anullsrc`）+ 统一采样率/声道；帧率：**统一到最高帧率** | 不丢声音、不降帧 |

### 4.2 架构决策（第 2 轮）

| 问题 | 决策 |
|------|------|
| 任务管理器收录范围 | **工作流 + LLM 会话 + ffmpeg 全部收录**（真正的「系统当前所有异步任务」） |
| 持久化 | **内存注册表**，重启即清空（与 LLM 会话现有取舍一致；不做幽灵任务恢复） |
| 中断语义 | **真中断**：ffmpeg kill 子进程 + 删除半截产物，产物目录保持上一次成功结果 |
| UI 入口 | **顶栏图标 + 弹窗**（复用并升级现有 LLM 会话面板），不做独立页面 |
| 数据模型 | **统一模型**（`type` 字段区分，公共字段一致），前端一套 UI |
| 工作流任务接入方式 | **登记进统一注册表**（真正单源）；SQLite 仍是其持久化权威 |
| 中断能力差异呈现 | **`cancelable` 标记 + 置灰提示原因**（如「该工作流不支持中断」） |
| ffmpeg 进度 | **真实进度百分比**（解析 `-progress` 的 `out_time_ms` / 总时长） |

### 4.3 代码结构决策（第 3 轮）

| 问题 | 决策 |
|------|------|
| 是否需要统一执行器门面 | **需要，但分三层**：注册表（模型+事件）/ 执行器门面（写侧统一）/ 任务句柄（中断） |
| 门面覆盖范围 | ffmpeg **完整实现**；llm、workflow 为**薄适配**（只用 `create/finish/cancel`，不强行套 `run()`） |
| 不放进任务模型的东西 | LLM 流式增量、产物落盘逻辑、参数校验、任务历史/持久化 |
| 目录 | `server/src/tasks/`（`registry.ts` / `executor.ts` / `ffmpeg-executor.ts` / `llm-executor.ts` / `workflow-executor.ts` / `task-ws.ts` / `routes.ts`） |
| `FfmpegExecutor.run()` 调用方式 | **方案 A**：路由立即返回 taskId，画布走「登记 → WS 进度/终态 → 产物刷新」 |

### 4.4 兼容性决策（自行补充）

| 项 | 决策 | 理由 |
|----|------|------|
| WS 路径 | **保持 `/llm-ws` 不变** | 生产同源、vite 代理已配；改名牵动代理与全部引用，收益为零 |
| `LlmSessionInfo` 等既有类型 | **保留**（任务模型中作为 `payload` 的一部分或独立通道） | 减少 `AiTextGenerateNode` / `AssetCanvas` 的改动面 |
| 工作流任务的 DB 权威 | **不变**；注册表只做运行态镜像与展示 | 避免重构引擎持久化，风险可控 |
| 旧拼接配置 | `config` 无 `mode` / `sizeMode` 时按 `reencode` / `max` 兜底 | 未知字段不影响读取（既有约定） |

---

## 5. 整体业务流程

### 5.1 统一任务生命周期

```
① 登记          ② 执行                ③ 进度                ④ 终态              ⑤ 中断（任意时刻）
POST 接口 ──▶ registry.register() ──▶ executor.run()
                │ 返回 taskId              │
                │                          ├─ ffmpeg: 解析 -progress → registry.update(progress)
                │                          ├─ llm:    阶段切换（thinking/responding）
                │                          └─ workflow: 远端 poll → progress
                │                          │
                │                          └─ 成功/失败 → registry.finish(status, {error?})
                │
                └─ 广播: tasks(全量) + task-update(增量) ──▶ 前端 TaskManagerDialog / 画布节点

POST /api/tasks/:id/cancel ──▶ registry.cancel(id) ──▶ record.handle.cancel()
                                    │                        ├─ ffmpeg:  kill 子进程 + 删半截产物
                                    │                        ├─ llm:     abortController.abort()
                                    └─ 不可中断: 返回 400 + cancelBlockReason
```

### 5.2 拼接视频（异步）

```
前端 ConcatVideoEditor
  │ ① 探测各输入规格（GET /api/canvas/video-info → codec/宽高/fps/hasAudio）
  │ ② 校验：copy 且规格不一致 → 提示「请改用重编码」并禁用「拼接」
  │ ③ 点击「拼接」→ POST /api/canvas/concat-video { mode, sizeMode, width?, height? }
  ▼
服务端
  │ ④ 参数校验（白名单枚举 + custom 宽高正整数）→ 登记 ffmpeg 任务（nodeId/project/canvas）
  │ ⑤ 立即返回 { taskId, status: 'running' }
  │ ⑥ 后台执行 FfmpegExecutor.run()
  │      copy    → concat demuxer + -c copy（规格不一致 → ConcatError → finish(failed)）
  │      reencode→ filter_complex（scale+pad+setsar+fps / 静音补齐）→ libx264 + aac + faststart
  │      → 解析 -progress → registry.update(progress) → finish(completed)
  ▼
前端
  │ ⑦ taskSocket 收 task-update(progress) → 任务管理器进度条；画布节点维持 loading
  │ ⑧ 收 finished(completed) → 刷新 node-info → 节点/编辑器预览新产物（token = mtime）
  │ ⑨ 中断：registry.cancel → kill + 删半截产物 → finished(cancelled) → 画布结束 loading
```

### 5.3 画布刷新 / 切换画布后的任务恢复

```
页面加载 / 切换画布 / WS 重连
  ▼
taskSocket.tasks（服务端全量广播，按 project + canvas scope 过滤）
  ▼
匹配 ffmpeg 任务且 nodeId 在 nodeMap → 恢复节点 loading 展示
（终态到达 → 刷新产物；任务已消失 → 结束 loading，无幽灵状态）
```

> **变更点**：现有 ffmpeg 任务用 `localStorage`（`dsh.asset-canvas.tasks.*`）做刷新恢复，本次改为**服务端注册表单源**，删除前端持久化记录逻辑。

### 5.4 任务管理器（UI）

```
顶栏图标（mdi-progress-clock + 活跃任务数徽标）
  ▼
TaskManagerDialog：按 startedAt 倒序列出全部活跃任务
  ├─ 类型标记：AI 生成 / LLM 会话 / 视频处理
  ├─ 状态：进行中（进度条 / 不确定动画）· 已运行时长（客户端每秒刷新）
  ├─ 位置：项目 + 画布（分镜第N集 M# / 场景 X / Y）
  └─ 中断按钮：cancelable=true 可点；false 置灰 + title 显示 cancelBlockReason
```

---

## 6. 实现思路

### 6.1 服务端目录与职责

```
server/src/tasks/
  registry.ts          # TaskRegistry 单例 + 统一模型 + 事件（纯逻辑，可单测）
  executor.ts          # TaskExecutor / TaskHandle 接口定义（仅类型 + 公共小工具）
  ffmpeg-executor.ts   # FfmpegExecutor：spawn + -progress 解析 + kill/清理
  llm-executor.ts      # LlmExecutor：包装 session-manager（abort）
  workflow-executor.ts # 工作流任务登记适配（引擎侧调用）
  task-ws.ts           # 广播枢纽（原 llm/session-ws.ts 改造）
  routes.ts            # GET /api/tasks、POST /api/tasks/:taskId/cancel
```

> `executor.ts` 只放接口，**防止 `registry.ts` 与具体执行器相互 import 形成循环依赖**。

### 6.2 统一任务模型（S1）

```ts
type TaskType = 'workflow' | 'llm' | 'ffmpeg'
type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

interface TaskRecord {
  id: string
  type: TaskType
  status: TaskStatus
  label: string                       // 展示名（节点名 / 「拼接视频」等）
  project?: string
  nodeId?: string
  canvas?: CanvasDefTarget            // 画布定位（前端按 scope 恢复）
  progress?: number                   // 0~100；缺省 = 不确定进度
  startedAt: number
  updatedAt: number
  finishedAt?: number
  error?: string
  cancelable: boolean
  cancelBlockReason?: string          // cancelable=false 时展示
  payload?: Record<string, unknown>   // 各类型自有字段（模型名 / 段数 / 输出尺寸等）
  handle?: TaskHandle                 // 运行态中断凭据，仅内存持有，不广播
}
```

`TaskRegistry` API：

| 方法 | 语义 |
|------|------|
| `register(meta, handle?)` | 登记任务；**同 nodeId 单飞**（已有活跃任务则抛 `TaskError('NODE_BUSY')`） |
| `update(id, patch)` | 合并 patch（status/progress/error/payload），触发 `update` 事件 |
| `finish(id, outcome)` | 幂等终态：置 status/finishedAt → 移出活跃区 → `finish` 事件 |
| `cancel(id)` | 委托 `record.handle?.cancel()`；不可中断返回 false |
| `listActive()` | 按 startedAt 倒序 |
| `get(id)` / `on(listener)` | 查询 / 事件订阅（begin/update/finish） |

### 6.3 执行器门面（S2）

```ts
/** 任务运行态中断凭据（仅内存；不进入广播载荷） */
interface TaskHandle {
  cancel(): Promise<void> | void
}

/** 任务执行器门面：把「启动一个异步任务」统一成同一形状 */
interface TaskExecutor<TParams> {
  readonly type: TaskType
  /** 登记任务（返回可广播的 TaskRecord；handle 由实现注入） */
  create(meta: TaskMeta, params: TParams): TaskRecord
  /** 启动执行；**终态必须由执行器负责 finish**（成功/失败/中断都要收敛） */
  run(taskId: string, params: TParams): Promise<void>
  /** 请求中断；不可中断返回 false（原因放 meta.cancelBlockReason） */
  cancel(taskId: string): boolean
  /** 可选：进度上报 */
  onProgress?(taskId: string, progress: number): void
}
```

**分层要点**：注册表的 `cancel()` 只做 `record.handle?.cancel()`，因此注册表**永远不认识** ffmpeg 子进程或 `AbortController`；门面服务于真实重复（ffmpeg 三操作），不为对称而对称。

### 6.4 FfmpegExecutor（S3）

- `spawn` ffmpeg，参数带 `-progress pipe:1 -nostats`。
- 解析 `out_time_ms=<微秒>` → `progress = out_time_ms/1e6 / totalDuration * 100`（总时长由 `getVideoInfo` 探测；多段拼接取各段时长之和；无法探测 → 不上报百分比）。
- 终态收敛：`close` 事件 → `code === 0` → `finish(completed)`；`code !== 0` 且已请求取消 → `finish(cancelled)`；否则 `finish(failed, stderr 摘要)`。
- `cancel(id)`：kill 子进程 → 等待退出 → **删除半截产物**（保留上一次成功产物）→ 清理临时 concat 列表文件。
- 进度解析函数做成**纯函数**（`parseProgressLine` / `computePercent`）便于单测。

### 6.5 三类任务接入

| 类型 | 接入方式 |
|------|----------|
| **ffmpeg** | 完整实现 `TaskExecutor`；路由 `create()` + `void run()`，立即返回 taskId |
| **llm** | `LlmExecutor` 薄适配：`session-manager.begin()` 时向注册表登记，`pushEvent` 时 `update`（阶段/警告），`finish` 时同步收敛；`cancel` → `abortController.abort()`。**流式增量仍走原 `thinking/text/snapshot/finished` 通道** |
| **workflow** | 引擎侧在**创建 / 开始 / 终态**三处集中登记与收敛；`cancel` 委托现有 `canCancelTask` + Bridge 取消逻辑（不重复实现）。`cancelable` 由 `capabilities.cancelable` / `deferredCancel` / 任务状态推导 |

### 6.6 广播枢纽（S7）

- WS 路径**保持 `/llm-ws`**。
- 服务端 → 客户端新增：`{ type: 'tasks', tasks: TaskInfo[] }`（连接建立即推 + begin/update/finish 广播）、`{ type: 'task-update', task: TaskInfo }`（增量，含 ffmpeg 进度）。
- 客户端 → 服务端：`subscribe / unsubscribe / cancel`（统一）；LLM 专属命令与事件保持不变。
- `TaskInfo` = `TaskRecord` 去掉 `handle`（不可序列化）。

### 6.7 拼接能力（S4）

**参数**

| 参数 | config 字段 | 取值 | 默认 |
|------|-------------|------|------|
| 编码方式 | `mode` | `copy` / `reencode` | `reencode` |
| 输出尺寸（仅重编码可用） | `sizeMode` | `custom` / `max` / `min` | `max` |
| 自定义宽高 | `width` / `height` | 正整数，自动取偶（`+1`） | — |

**copy 分支**：沿用 concat demuxer + `-c copy`；`assertConcatCompatible` 校验编码/分辨率/帧率/音轨结构，不一致抛 `ConcatError(INVALID)`，文案含具体不一致项并提示改用重编码。

**reencode 分支**（filter_complex 单次编码，不落中间文件）：

```
每段 i：
  [i:v] scale=W:H:force_original_aspect_ratio=decrease,
        pad=W:H:(ow-iw)/2:(oh-ih)/2:color=black, setsar=1, fps=FPS [v_i]
  （有音轨）[i:a] aresample=48000, aformat=channel_layouts=stereo [a_i]
  （无音轨且全局含音频）anullsrc=r=48000:cl=stereo（lavfi 输入，-t 该段时长）[a_i]
拼接： [v_0][a_0][v_1][a_1]... concat=n=N:v=1:a=1 [vout][aout]
输出： -map [vout] -map [aout] -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p
       -c:a aac -movflags +faststart
（全部无音轨 → 只拼视频流 + `-an`）
```

- 尺寸策略纯函数：`resolveOutputSize(specs, params)`（面积取 max/min、custom 校验与取偶）。
- 帧率 `FPS = max(各段 fps)`；音轨存在性 = 各段 `hasAudio` 任一为真。

### 6.8 API 变更（S5 / S6 / S10）

| 方法 | 路径 | 变更 |
|------|------|------|
| POST | `/api/canvas/concat-video` | 新增 `mode/sizeMode/width/height`；**改为异步**：返回 `{ taskId, status }` |
| POST | `/api/canvas/trim-video` | **改为异步**：返回 `{ taskId, status }` |
| POST | `/api/canvas/extract-frame` | **改为异步**：返回 `{ taskId, status }` |
| GET | `/api/canvas/video-info` | 返回值补 `codec` / `hasAudio` |
| GET | `/api/tasks` | 新增：活跃任务列表（WS 不可用时的降级/调试） |
| POST | `/api/tasks/:taskId/cancel` | 新增：统一中断入口（幂等；不存在/已终态 404） |

### 6.9 前端

| 模块 | 要点 |
|------|------|
| `taskSocket.ts` | 由 `llmSocket.ts` 迁移：新增 `tasks` 响应式列表与 `cancel(taskId)`；保留 `subscribe/onFinished/sessions` 等既有 API，改动面仅导入路径 |
| `TaskManagerDialog.vue` | 由 `LlmSessionsDialog.vue` 升级：类型标记、进度条（ffmpeg 真实百分比，其余不确定）、已运行时长、画布位置、中断按钮（不可中断置灰 + 原因） |
| `App.vue` | 图标 `mdi-broadcast` → `mdi-progress-clock`；徽标 = 全部活跃任务数 |
| `useCanvasGeneration.ts` | `concatVideo/trimVideo/extractFrame` 改为「提交 → taskId → WS 驱动」；删除 ffmpeg 的 localStorage 记录；`restore()` 改读 `taskSocket.tasks` 按 scope 恢复 |
| `ConcatVideoEditor.vue` | 编码方式下拉 + 输出尺寸下拉（copy 时禁用并提示）+ custom 宽高输入 + 输入规格探测标签 + copy 不一致预检 |
| `registry.ts` | `video-concat.defaultConfig` 增加 `mode/sizeMode/width/height` |

---

## 7. 验收标准

### 7.1 架构与任务管理器

- [ ] 一次 AI 生成（工作流）、一次 AI 文本生成（LLM）、一次拼接（ffmpeg）同时进行时，任务管理器列表**同时出现三条**，类型标记正确。
- [ ] 任务行显示：名称、类型、状态、已运行时长、项目/画布位置；ffmpeg 任务显示**真实进度百分比**（随执行增长），LLM 任务显示阶段（Thinking/响应中），工作流任务显示其进度或不确定动画。
- [ ] 三类任务的中断均可用（除不支持中断的工作流：按钮**置灰**并显示原因）。
- [ ] 中断 ffmpeg 任务后：子进程终止、**半截产物被删除**、产物目录保留上一次成功结果、画布节点 loading 结束且不报错（提示「已中断」）。
- [ ] 刷新页面 / 切换画布再切回：进行中的任务仍在列表；画布上对应的节点**仍在 loading**；终态到达后自动刷新产物，无幽灵 loading。
- [ ] 服务端重启后任务列表为空（内存注册表），且无残留半截产物。

### 7.2 拼接视频功能

- [ ] 两段**同规格**视频 + `copy` → 拼接成功，输出时长 = 两段之和，画质无损（码流直通）。
- [ ] 混入**不同分辨率/编码**视频 + `copy` → 前端「拼接」按钮禁用并提示改用重编码；直接调接口返回 400 中文错误（含不一致项）。
- [ ] 不同分辨率 + `重编码` + `取最大的一段` → 输出尺寸 = 面积最大段的宽高，小段**等比缩放 + 上下（或左右）黑边**，画面不拉伸不裁切。
- [ ] `取最小的一段` → 输出尺寸 = 面积最小段的宽高，大段缩放到该尺寸。
- [ ] `自定义` 1920×1080（含输入奇数宽高）→ 输出 1920×1080，奇数输入被规整，画面居中。
- [ ] 混入 24fps 与 30fps → 输出 30fps；混入无音轨段 → 输出音轨完整（该段为静音）；全部无音轨 → 输出无音轨。
- [ ] 重复拼接 → 旧产物归档进 history 目录，预览刷新（token = mtime，不命中旧缓存）。
- [ ] 输出产物固定 `output.mp4`，可被「加载视频」节点及其他消费节点正常读取。

### 7.3 工程约束

- [ ] `npm run typecheck` 无错误。
- [ ] `npm run lint` 无错误（仅允许 `server/src/assets/refs.ts` 既有 warning）。
- [ ] `cd server && npm test`、`cd frontend && npm test` 全部通过。
- [ ] 新增/修改的类与方法均有 JsDoc（AGENTS.md 约束）；新增 Vuetify 表单组件 `variant="outlined"`。
- [ ] 所有 `catch` 块向上抛出或打印日志（不得静默吞异常）；确需忽略处加行内注释说明原因。
- [ ] 文档已更新（T1/T2），`docs/canvas/task-architecture.md` 覆盖架构图、模型、接入方式与常见坑。

---

## 8. 风险与对策（自行补充）

| 风险 | 影响 | 对策 |
|------|------|------|
| 工作流引擎登记点遗漏 | 任务管理器缺项 | 登记集中在「创建 / 开始 / 终态」三处；补单测覆盖；列表空态文案区分「无任务」与「未接入」 |
| 异步化后前端产物刷新链路断裂 | 拼接成功但节点不刷新 | 保留现有 `onResult(nodeId, outputPath)` 回调链路；`finished` 事件与回调双保险 |
| ffmpeg 无 `-progress` 输出（老旧版本） | 无进度 | 回退不确定进度动画，任务仍可中断 |
| 中断时删除半截产物失败 | 残留破损文件 | 删除失败仅 `console.warn`（不阻断中断收敛），并记录任务 `payload.warn` |
| 同节点并发任务 | 产物互相覆盖 | 注册表**同 nodeId 单飞**；前端提交前按节点状态二次拦截 |
| 工作流取消语义复杂 | 误报「已中断」 | `cancelable` + `cancelBlockReason` 如实展示；deferredCancel 场景提示「已请求取消，将在执行完成后生效」 |
| WS 断连 | 进度不更新 | 重连后全量 `tasks` 广播对账；保留 `GET /api/tasks` 兜底 |

### 8.1 实施中发现并修复的缺陷（已回归）

| 缺陷 | 现象 | 根因 | 修复 |
|------|------|------|------|
| 拼接完成后节点预览不刷新 | 任务已完成、产物已落盘，但节点仍显示「未拼接」，刷新页面才可见 | `task-ws` 的 `subscribe` 分支只用 `llmSessionLookup` 判定任务是否存在——订阅 ffmpeg 任务（无 LLM 会话）时立即回 `not-found`；前端把 `not-found` 当作「任务已结束」，清空 `taskIdByNode` 映射并置成功态，导致后续 `task-update`（进度/终态）因映射缺失被忽略 | `subscribe` 改为「先查统一任务注册表、再查 LLM 会话」，两者都不存在才回 `not-found`；前端 `not-found` 分支增加产物存在性核验（node-info），产物缺失时提示「任务已结束但未生成产物，请重新执行」而非误报成功 |

**教训**：传输层的「订阅确认」语义必须按**任务类型**分流——统一注册表是任务的权威源，LLM 会话只是其中一种类型的附加视图，不能用类型专属查询代替任务存在性判断。

---

## 9. 明确不做（本次范围外）

- 任务注册表**持久化**（重启清空为已确认取舍；工作流任务的 DB 记录不受影响）。
- 任务**历史列表 / 日志查看**（仅活跃任务；ffmpeg 不提供日志面板，用进度替代）。
- 工作流引擎内部轮询机制重构（仅增加登记点）。
- 任务管理器独立页面（仅顶栏弹窗）。
- 拼接输出格式选项（固定 mp4 / H.264 + AAC）、帧率自定义选项、裁切填满（letterbox 已定）。
- WS 路径改名（保持 `/llm-ws`）。

---

## 10. 关键文件索引

**服务端新增**：`server/src/tasks/{registry,executor,ffmpeg-executor,llm-executor,workflow-executor,task-ws,routes}.ts`

**服务端改造**：`server/src/routes/canvas.ts`（异步化 + 拼接参数 + video-info 扩展）、`server/src/assets/concat-video.ts`（双模式 + filter graph）、`server/src/assets/extract-frame.ts`（音轨探测）、`server/src/llm/session-manager.ts`（登记注册表）、`server/src/llm/session-ws.ts`（迁往 tasks）、`server/src/workflow-engine.ts` + `server/src/routes/workflow.ts`（登记与取消委托）、`server/src/index.ts`（路由与 WS 挂载）

**前端新增**：`frontend/src/canvas/taskSocket.ts`、`frontend/src/components/TaskManagerDialog.vue`

**前端改造**：`frontend/src/App.vue`、`frontend/src/canvas/api.ts`、`frontend/src/canvas/useCanvasGeneration.ts`、`frontend/src/canvas/registry.ts`、`frontend/src/components/canvas/AssetCanvas.vue`、`frontend/src/components/canvas/editors/ConcatVideoEditor.vue`、`frontend/src/components/canvas/composables/useCanvasNodeOps.ts`

**文档**：新增 `docs/canvas/task-architecture.md`；更新 `docs/canvas/{llm-session,node-types,generation,editor-panel,development,README}.md`、`AGENTS.md`
