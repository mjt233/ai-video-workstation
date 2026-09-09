# 资产画布（Asset Canvas）业务逻辑与开发指南

「资产画布」功能的定位、数据模型、交互行为与开发约定文档，供后续维护与扩展参考。按主题拆分为以下文档：

| 文档 | 主题 |
|------|------|
| [data-model.md](./data-model.md) | 数据模型与文件布局：canvas.json 结构、持久分组 groups[]、节点产物与历史、预览 URL、手动上传、异步任务可靠性 |
| [node-types.md](./node-types.md) | 节点类型：原型注册表与全部节点明细 |
| [interactions.md](./interactions.md) | 连线规则与画布交互：类型兼容/成环检测、选中与多选、群组、**持久分组（节点分组框）**、右键菜单、快捷键、资产拖拽入画布 |
| [editor-panel.md](./editor-panel.md) | 配置面板与输入预览：悬浮面板布局、编辑器组件约定、生成节点统一布局 |
| [generation.md](./generation.md) | 生成流程：工作流/ffmpeg 任务、轮询与状态机、中断、任务状态来源 |
| [task-architecture.md](./task-architecture.md) | **统一异步任务架构与任务管理器**：任务注册表/执行器门面、三类任务接入、WS 广播、ffmpeg 异步化与中断 |
| [autobuild.md](./autobuild.md) | 自动搭画布：分镜/场景（按子场景）幂等搭建 |
| [blueprint.md](./blueprint.md) | **画布蓝图**：多选创建蓝图（全局/项目）、系统配置蓝图管理（增删改/导入导出）、画布内插入（可独立分组）、蓝图模式画布编辑器与资产上下文（assetProject） |
| [asset-outputs.md](./asset-outputs.md) | 产物历史、设为分镜场景图、保存为（含 AI 文本节点文本历史版本） |
| [target-switching.md](./target-switching.md) | 切换分镜跟随加载：switchTarget 与视口对准 |
| [module-structure.md](./module-structure.md) | 前端模块结构与服务端画布路由 |
| [development.md](./development.md) | 开发指南：新增节点类型、测试与验证、常见坑 |
| [llm-session.md](./llm-session.md) | LLM 活跃会话机制：AI 文本节点 Loading / WebSocket / 全局面板 |

## 概述与定位

系统以**文件系统即数据库**：画布定义（节点、连线、坐标、配置）持久化为 `prompt/` 下的 `canvas.json`；生成产物为 `assert/` 下的图片文件。

- 入口：分镜（ScenePanel）与场景（StagePanel）详情页的「资产画布」Tab。
- 目的：把「图生图 / 文生图」制作流程可视化 —— 用节点连线表达输入图片与生成节点的数据流，生成产物自动落入分镜/场景资产目录，可一键设为分镜场景图。
- 状态完全由 URL 查询参数驱动（`project` / `type` / `name` / `episode` / `shot`）；切换分镜时画布自动跟随加载（见 [target-switching.md](./target-switching.md)）。
- 画布定义 `canvas.json` 为纯前端数据，服务端只把它当作普通 `prompt/` 下文件读写，不参与工作流；生成时才通过既有工作流 API 提交任务。
- **画布蓝图**：把「一套搭好的子图」保存为可复用模板（节点配置 + 连接 + 持久分组 + 相对位置），支持全局/项目级存储、系统配置集中管理与画布内一键插入（可自动包成独立分组）；蓝图不携带产物文件，插入后生成类节点需重新生成。详见 [blueprint.md](./blueprint.md)。
