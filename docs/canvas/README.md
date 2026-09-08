# 资产画布（Asset Canvas）业务逻辑与开发指南

「资产画布」功能的定位、数据模型、交互行为与开发约定文档，供后续维护与扩展参考。按主题拆分为以下文档：

| 文档 | 主题 |
|------|------|
| [data-model.md](./data-model.md) | 数据模型与文件布局：canvas.json 结构、节点产物与历史、预览 URL、手动上传、异步任务可靠性 |
| [node-types.md](./node-types.md) | 节点类型：原型注册表与全部节点明细 |
| [interactions.md](./interactions.md) | 连线规则与画布交互：类型兼容/成环检测、选中与多选、群组、右键菜单、快捷键、资产拖拽入画布 |
| [editor-panel.md](./editor-panel.md) | 配置面板与输入预览：悬浮面板布局、编辑器组件约定、生成节点统一布局 |
| [generation.md](./generation.md) | 生成流程：工作流/ffmpeg 任务、轮询与状态机、中断、运行中任务持久化 |
| [autobuild.md](./autobuild.md) | 自动搭画布：分镜/场景（按子场景）幂等搭建 |
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
