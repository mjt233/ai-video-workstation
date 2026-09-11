# 任务管理（Task Manager）业务与实现总览

系统内所有**异步长任务**（AI 生成 / 视频处理 / LLM 会话）的统一登记、执行、中断、日志与历史查阅机制的总体说明与文档索引。

## 这套机制解决什么问题

| 问题 | 做法 |
|------|------|
| 生成任务动辄数分钟，页面不能阻塞等待 | 任务提交即返回 `taskId`，服务端队列独立执行，产物落盘与页面无关 |
| 刷新 / 切项目 / 关浏览器后不知道任务还在不在跑 | **运行态**登记进内存注册表 + WS 广播；**持久态**落 SQLite，画布按「项目 + 画布 scope + 节点」恢复 Loading |
| 三类任务（工作流 / ffmpeg / LLM）各一套状态机 | 统一 `TaskRecord` 模型 + 统一中断入口 `POST /api/tasks/:taskId/cancel` |
| 出错了看不到原因 | 每次任务的关键步骤写入 `task_logs`；节点错误遮罩「详情」按钮与任务管理器「历史」页签都能看完整日志 |
| 日志无限膨胀（实测占库 87%） | 轮询日志「变化才记 + 心跳」降噪；超期日志按保留期自动清理并 `VACUUM` 回收 |

## 核心心智模型：三份事实源，各管一段

理解任务管理的关键是分清**三份数据各自是什么事实源**，不要互相期待对方的能力：

| 事实源 | 位置 | 覆盖 | 生命周期 | 谁读它 |
|--------|------|------|----------|--------|
| **统一任务注册表** | `server/src/tasks/registry.ts`（**仅内存**） | 工作流 / ffmpeg / LLM 三类的**运行态** | 任务终态即移出活跃区；**服务重启即清空** | 任务管理器「进行中」、画布 Loading 恢复、中断能力判定 |
| **SQLite 任务与日志** | `data/workflow.db` 的 `tasks` / `task_logs` 表（**持久化权威**） | 工作流任务（图片/视频/TTS 生成）的创建、状态、参数、日志 | 任务行永久保留；**日志按保留期清理**（默认 14 天） | 任务管理器「历史」、生成对话框日志、节点「详情」按钮、画布恢复补查 |
| **LLM 会话注册表** | `server/src/llm/session-manager.ts`（**仅内存**） | AI 文本节点的会话与流式输出 | 终态由后端独占写入画布定义文件；重启后未终态部分丢失 | 画布 AI 文本节点、任务管理器（会话 id 即任务 id） |

> **要点**：注册表是「现在在跑什么」的唯一事实源，但不持久化；SQLite 是「跑过什么、当时发生了什么」的唯一事实源，但不包含 ffmpeg / LLM 任务（那两类不落盘）。

## 文档索引

| 文档 | 主题 |
|------|------|
| [data-model.md](./task-manager/data-model.md) | **数据模型**：`tasks` / `task_logs` 表结构、内存注册表 `TaskRecord`、LLM 会话、前端 `GenerateStatus`/`TaskInfo`、「谁持久化谁不持久化」对照表、画布定位字段 |
| [lifecycle.md](./task-manager/lifecycle.md) | **任务生命周期**：创建（含批量）→ 引擎领取 → 执行 → 终态收敛；中断全链路（工作流 / ffmpeg / LLM 三种语义）；服务重启恢复策略 |
| [execution.md](./task-manager/execution.md) | **执行侧实现**：工作流引擎（provider 解析、Bridge 提交与轮询、产物归档落盘）、ffmpeg 执行器（命令构建分离、进度解析、取消清产物）、LLM 执行器适配 |
| [events.md](./task-manager/events.md) | **传输层与前端接入**：`/llm-ws` 消息协议、`taskSocket` 单例与重连、HTTP 兜底、画布 Loading 恢复对账 |
| [api.md](./task-manager/api.md) | **服务端接口清单**：任务查询 / 日志查询 / 中断 / 系统日志统计与清理，逐个标注方法与语义 |
| [log.md](./task-manager/log.md) | **任务日志专项**：日志分级语义、轮询降噪规则、保留期与清理实现、占用统计口径、读取接口的 `limit/truncated` |
| [ui.md](./task-manager/ui.md) | **前端界面**：任务管理器（进行中 / 历史）、日志查看器、画布节点错误「详情」按钮、系统设置「日志」子类 |
| [development.md](./task-manager/development.md) | **开发指南**：新增任务类型的接入清单、常见坑、测试与验证方式 |

## 相关既有文档

| 文档 | 关系 |
|------|------|
| [`docs/canvas/task-architecture.md`](./canvas/task-architecture.md) | **画布视角**的统一异步任务架构（分层图、三类任务接入表、WS 消息表）。本目录是跨模块的完整视角，两者互为补充：画布侧细节看它，服务端实现与日志/历史细节看本目录 |
| [`docs/canvas/generation.md`](./canvas/generation.md) | 画布生成流程（提交参数、轮询与状态机、中断交互） |
| [`docs/canvas/llm-session.md`](./canvas/llm-session.md) | AI 文本节点（LLM 会话）的 Loading 恢复与流式显示细节 |
| [`docs/asset-layout.md`](./asset-layout.md) | 产物与历史版本的文件布局（任务产物落在 `assert/` 下） |

## 术语表

| 术语 | 含义 |
|------|------|
| **任务（task）** | 一次异步执行单元，有唯一 `taskId`（UUID；LLM 会话 id 即任务 id） |
| **工作流任务** | 走 AI 服务商生成的任务（`workflow` 类型），持久化在 SQLite `tasks` 表 |
| **ffmpeg 任务** | 本地视频处理（拼接 / 裁剪 / 取帧 / 裁剪音频），仅内存注册表，不落盘 |
| **LLM 会话** | AI 文本节点的模型会话（`llm` 类型），仅内存，终态写画布文件 |
| **活跃任务** | `pending` 或 `running` 的任务，存在于注册表活跃区 |
| **终态** | `completed` / `failed` / `cancelled`，终态即移出活跃区并广播 |
| **画布定位** | 任务携带的 `nodeId` + `canvas`（`{kind, episode, shot}` 或 `{kind, stage, label}`），用于刷新后按 scope 恢复 Loading 与在 UI 上展示来源 |
| **降噪** | 轮询日志「状态/进度变化才记 + 心跳兜底」的写入策略，见 [log.md](./task-manager/log.md) |
| **保留期** | 已终态任务日志的保留天数（默认 14），超期由清理器删除并 `VACUUM` 回收 |
