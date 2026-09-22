# 文档索引（docs/）

本目录是本仓库的**唯一文档事实源**：`AGENTS.md` 只保留硬约束与导航入口，**具体业务逻辑、数据模型与实现细节都在这里**。
改动代码前，按下面的主题表定位对应文档；改完之后，**同步更新对应文档**（文档与代码不一致时以代码为准，并回来修文档）。

图例：⭐ = 与代码强耦合、改动前**必读**的核心文档。

---

## 1. 核心机制（跨模块）

| 文档 | 主题 | 什么时候读 |
|------|------|-----------|
| ⭐ [asset-layout.md](./asset-layout.md) | **文件系统即数据库**：`design/{project}/` 目录约定、`prompt/` ↔ `assert/` 对照、历史版本、自定义资产、系统全局回收站与存储清理、分镜编号 rename、目录/文件 API 与前端 URL 状态 | 新增/改动任何资产类型、产物路径、上传、历史、清理逻辑时 |
| ⭐ [workflows.md](./workflows.md) | **工作流类型与产物形态**：`WorkflowTypeId` 六种类型、媒体产物（`WorkflowOutput`）与文本产物（`text-generation`）两条链路差异、**新增类型必须同步的清单** | 改动工作流类型、产物形态、自定义服务商类型白名单时 |
| [workflow-adaptation-guide.md](./workflow-adaptation-guide.md) | **适配某个工作流的 AI 接口**：`WorkflowDefinition`、`submit`、`projectConfig`、环境变量、输出路径约定、注册与多实现切换 | 接入新的 AI 服务（改 `server/src/workflows/**`）时 |
| ⭐ [task-manager.md](./task-manager.md) | **任务管理总览**（异步长任务的登记/执行/中断/日志/历史）+ 分主题索引 | 涉及任务类型/执行器、进度、日志、任务接口、任务管理器 UI、画布 Loading 恢复时 |
| [bridge-config-doc.md](./bridge-config-doc.md) | **ComfyUI Easy Bridge 对接配置**：标签注册、工作流类型标记 | 配置 Bridge 侧时 |
| [bridge-workflow-fields.md](./bridge-workflow-fields.md) | **Bridge 工作流字段约定**：各类型提交给 Bridge 的字段与文件 key | 对接 Bridge 工作流字段时 |

### 任务管理子文档（[task-manager.md](./task-manager.md) 的拆分）

| 文档 | 主题 |
|------|------|
| [task-manager/data-model.md](./task-manager/data-model.md) | `tasks` / `task_logs` 表结构、内存注册表 `TaskRecord`、LLM 会话、前端状态模型 |
| [task-manager/lifecycle.md](./task-manager/lifecycle.md) | 任务生命周期：创建 → 领取 → 执行 → 终态收敛；中断全链路；重启恢复策略 |
| [task-manager/execution.md](./task-manager/execution.md) | 执行侧实现：工作流引擎、ffmpeg 执行器（`buildXxxCommand()` 约定）、LLM 执行器适配 |
| [task-manager/events.md](./task-manager/events.md) | `/llm-ws` 消息协议、`taskSocket` 单例与重连、HTTP 兜底、Loading 恢复对账 |
| [task-manager/api.md](./task-manager/api.md) | 任务查询 / 日志查询 / 中断 / 系统日志统计与清理的接口清单 |
| [task-manager/log.md](./task-manager/log.md) | 任务日志专项：分级语义、轮询降噪、保留期与清理、占用统计口径、`limit/truncated` |
| [task-manager/ui.md](./task-manager/ui.md) | 前端界面：任务管理器抽屉、完成通知气泡、日志查看器、系统设置「日志」子类 |
| [task-manager/development.md](./task-manager/development.md) | 开发指南：新增任务类型的接入清单、常见坑、测试与验证 |

---

## 2. 资产画布（canvas/）

入口：分镜（ScenePanel）与场景（StagePanel）详情页的「资产画布」Tab。

| 文档 | 主题 |
|------|------|
| ⭐ [canvas/README.md](./canvas/README.md) | **总览与定位**：画布是什么、状态如何由 URL 驱动、输入转发节点、蓝图的定位 |
| [canvas/data-model.md](./canvas/data-model.md) | 数据模型与文件布局：`canvas.json` 结构、持久分组、节点产物与历史、预览 URL、手动上传 |
| [canvas/node-types.md](./canvas/node-types.md) | 节点类型：原型注册表与全部节点明细（含文本生成 / AI文本生成 / 输入转发 / 拼接视频） |
| [canvas/interactions.md](./canvas/interactions.md) | 连线规则与画布交互：类型兼容/成环检测、多选、群组、持久分组、右键菜单、快捷键、资产拖拽入画布 |
| [canvas/editor-panel.md](./canvas/editor-panel.md) | 配置面板与**统一输入预览组件 `CanvasInputPreview` 的复用硬约束**、生成节点统一布局 |
| [canvas/generation.md](./canvas/generation.md) | 生成流程：工作流 / ffmpeg 任务提交、轮询与状态机、中断、任务状态来源 |
| [canvas/notification.md](./canvas/notification.md) | **工作流完成通知气泡**：触发来源、30s 自动关闭、产物预览、与任务管理器的分工 |
| [canvas/task-architecture.md](./canvas/task-architecture.md) | **统一异步任务架构（画布视角）**：三层结构、三类任务接入、WS 广播、ffmpeg 异步化 |
| [canvas/llm-session.md](./canvas/llm-session.md) | LLM 活跃会话机制：AI 文本节点 Loading 恢复、WebSocket、全局抽屉 |
| [canvas/autobuild.md](./canvas/autobuild.md) | 自动搭画布：分镜 / 场景（按子场景）幂等搭建 |
| [canvas/blueprint.md](./canvas/blueprint.md) | **画布蓝图**：多选创建、全局/项目级保存、系统配置管理、画布内插入、蓝图模式编辑器 |
| [canvas/asset-outputs.md](./canvas/asset-outputs.md) | 产物历史、设为分镜场景图、保存为、AI 文本节点的文本历史版本 |
| [canvas/target-switching.md](./canvas/target-switching.md) | 切换分镜跟随加载：`switchTarget` 与视口对准 |
| [canvas/module-structure.md](./canvas/module-structure.md) | 前端模块结构、服务端画布/资产/蓝图路由清单 |
| [canvas/development.md](./canvas/development.md) | 开发指南：新增节点类型、测试与验证、常见坑 |

---

## 3. 功能设计文档（plans/）

设计与实施计划归档，用于理解「当时为什么这么做」。改动对应功能时值得回看。

| 文档 | 主题 |
|------|------|
| [plans/custom-provider.md](./plans/custom-provider.md) | **自定义工作流服务商**：脚本化接入任意 HTTP 接口、任务中断语义、用户配置字段、文本生成类型 |
| [plans/size-config.md](./plans/size-config.md) | 统一输出尺寸组件（比例 / 尺寸档 / 自定义宽高） |
| [plans/canva.md](./plans/canva.md) | 资产画布的最初设计（节点/连线/产物模型） |
| [plans/video-director.md](./plans/video-director.md) | 视频导演台（时间轴素材、关键帧、混音） |
| [plans/feat-workflow-enhance.md](./plans/feat-workflow-enhance.md) | 工作流增强（参考模式、拼接视频、WorkflowSizePicker 等） |
| [plans/ai-text-loading-llm-session.md](./plans/ai-text-loading-llm-session.md) | AI 文本节点 Loading 与 LLM 会话方案演进 |
| [plans/init.md](./plans/init.md) | 项目初始规划 |
| [plans/2026-09-08-asset-cleanup.md](./plans/2026-09-08-asset-cleanup.md) | 存储清理与全局回收站 |
| [plans/2026-09-09-unified-async-task-manager.md](./plans/2026-09-09-unified-async-task-manager.md) | 统一异步任务管理器 |
| [plans/2026-09-09-asset-canvas-groups.md](./plans/2026-09-09-asset-canvas-groups.md) | 画布持久分组 |
| [plans/bug/](./plans/bug/) | 缺陷排查记录（Loading 丢失、思考卡住、视频生成中断失效、连线右键菜单不关闭等） |

> `docs/superpowers/` 保留的是更早期的 spec/plan 流水账（2026-07 ~ 2026-08），**不是当前事实源**，仅在追溯历史决策时查阅。

---

## 4. 按任务快速定位

| 我要做的事 | 先读 |
|-----------|------|
| 新增一个资产类型（角色/场景/道具那样的） | [asset-layout.md](./asset-layout.md) → [workflows.md](./workflows.md) 第 4 节 |
| 新增一个工作流类型 / 接一个新 AI 服务 | [workflows.md](./workflows.md) → [workflow-adaptation-guide.md](./workflow-adaptation-guide.md) |
| 新增画布节点类型 | [canvas/development.md](./canvas/development.md) → [canvas/node-types.md](./canvas/node-types.md) → [canvas/editor-panel.md](./canvas/editor-panel.md) |
| 加一个本地 ffmpeg 操作 | [task-manager/execution.md](./task-manager/execution.md)（必须 `buildXxxCommand()`）；画布视角见 [canvas/task-architecture.md](./canvas/task-architecture.md) |
| 改任务进度 / 中断 / 日志 | [task-manager.md](./task-manager.md) 三条硬约束 + [task-manager/log.md](./task-manager/log.md) |
| 排查「任务卡住 / Loading 不消失 / 日志看不到 / 数据库变大」 | [task-manager.md](./task-manager.md) → [task-manager/log.md](./task-manager/log.md) → [canvas/llm-session.md](./canvas/llm-session.md) |
| 改存储清理 / 回收站 | [asset-layout.md](./asset-layout.md) 第 3.0.3 节 |
| 改画布蓝图 | [canvas/blueprint.md](./canvas/blueprint.md) → [asset-layout.md](./asset-layout.md) 第 2.6 节 |
| 改前端 URL 状态或详情页页签 | [asset-layout.md](./asset-layout.md) 第 1.2 节 |
| 自定义服务商脚本相关 | [plans/custom-provider.md](./plans/custom-provider.md) → [workflows.md](./workflows.md) 第 3 节 |
| 对接 ComfyUI Bridge | [bridge-config-doc.md](./bridge-config-doc.md) → [bridge-workflow-fields.md](./bridge-workflow-fields.md) |

---

## 5. 维护约定

- **中文**：所有文档、UI 文字、资产与提交信息使用中文。
- **就近更新**：改动了某机制，就更新承载该机制的文档（表格里那一行的「什么时候读」即触发条件）；新增机制时在对应目录新建文档，并**同时**在本文索引与 `AGENTS.md` 的导航表中登记。
- **不写会腐烂的内容**：避免粘贴大段代码；引用时给出**文件路径 + 函数/常量名**，便于检索定位。
- **硬约束集中在 `AGENTS.md`**：跨模块、必须无条件遵守的规则（typecheck/lint、删除确认、异常不静默、测试画布隔离）写在仓库根 `AGENTS.md`；本文档只负责「去哪儿查细节」。
