# AGENTS.md — ai-video-workstation

> 本文件只放**硬约束**与**文档导航**。具体业务逻辑、数据模型与实现细节都在 `docs/` 下——**动手前先按下方导航表读对应文档**，改完代码同步更新该文档。
> 完整文档清单见 [docs/README.md](./docs/README.md)。

## 快速启动
- `npm run dev` — 同时启动服务端 (3001) 和前端 (5233)
- `npm run build` — 仅构建前端
- `npm run start` — 生产模式：Express 托管 `frontend/dist/`，端口 3001
- `npm run typecheck` — 全局 TS 类型检查（服务端 + 前端）
- `npm run lint` — ESLint 检查
- `npm run lint:fix` — ESLint 自动修复
- 前端开发服务器代理 `/api` → `localhost:3001`

## 技术栈
- **服务端：** Express + TypeScript，`tsx` 开发运行（`tsx watch` 自动重启），`tsc` 类型检查
- **前端：** Vue 3 + Vuetify 3 + vue-router + axios + TypeScript，Vite 构建，`vue-tsc` 类型检查
- **ESLint** flat config，TypeScript + Vue 规则
- 图片/音频/视频以二进制流传输；文本/markdown/JSON 以 UTF-8 传输

## 编码规范
- 编写代码时，类或方法需要有详细 JsDoc 文档注释，并标注每个字段、参数和返回值的含义和用法。
- 前端使用 Vuetify 表单输入组件时，`variant` 优先默认使用 `outlined`。
- 所有 UI 文字、文档、资产和提交信息使用**中文**。

## 约束

1. **修改代码后必须执行 `npm run typecheck`，确保无类型错误**；**必须执行 `npm run lint`，确保无 ESLint 错误**（仅允许 `server/src/assets/refs.ts` 的既有 warning）。
2. **所有删除类操作必须弹窗确认**：使用 `confirm` 工具函数（`frontend/src/utils/confirm.ts`），提供标题、内容、确认按钮文案和颜色（删除建议 `error`），用户确认后方可执行。中断类操作不是删除，不弹确认。
3. **所有捕获的异常必须向上抛出或向控制台输出日志**：`catch` 块不得静默吞掉异常；如确实无需处理（例如兜底回退、清理收尾、已知可忽略的竞态），必须在 `catch` 块内添加行内注释说明原因，并向用户告知该处属于有意忽略。
4. **浏览器模拟操作时，除非用户指定在哪个项目的哪个画布中操作，不得直接修改用户原有的画布来进行测试。** 用户未明确授意在哪个画布模拟操作测试时，只允许通过临时创建新项目或在已有项目中在末尾创建新的集数，并在新的集数下创建新分镜进行画布的测试，任务完成后删除临时的画布并向用户报告。
5. **新增工作流类型必须同步六处**：`workflows/types.ts` 的 `WorkflowTypeId`、`workflows/vars.ts` 的 vars interface、`providers/custom/types.ts` 的 `CUSTOM_WORKFLOW_TYPES`、前端 `utils/workflow-types.ts`（标签/颜色/兜底清单）、`utils/custom-provider.ts`（`PARAM_INTERFACES` + `PARAM_INTERFACE_NAMES` + 模板）、`workflows/bridge-derive.ts`（如需）。清单与产物形态见 [docs/workflows.md](./docs/workflows.md)。
6. **新增本地 ffmpeg 操作必须导出 `buildXxxCommand()`**，交给 `server/src/tasks/ffmpeg-executor.ts` 执行（否则无进度、无法中断）；任务中断统一走 `POST /api/tasks/:taskId/cancel`；**不要再引入 localStorage 任务记录**。
7. **画布节点展示已连接的媒体输入时，必须复用统一输入预览组件** `frontend/src/components/canvas/editors/CanvasInputPreview.vue`，禁止为单个节点另写一套预览/徽标 UI（约定见 [docs/canvas/editor-panel.md](./docs/canvas/editor-panel.md)）。
8. **日志读取必须带 `limit`**：`GET /api/workflow/tasks/:taskId/log` 不传 `limit` 会返回全量（单任务可达上千行）；画布轮询用 `limit=1`，查看器用尾部 200 条 + 按需「查看全部」。
9. **日志/回收站清理类改动必须在数据库副本上演练**（`node scripts/verify-log-cleanup.mjs 14`），不得直接对真实库执行清理。

## 文档导航

| 主题 | 文档 | 什么时候读 |
|------|------|-----------|
| 项目资产目录、prompt↔assert 对照、历史版本、自定义资产、**回收站与存储清理**、目录/文件 API、**前端 URL 状态与页签** | [docs/asset-layout.md](./docs/asset-layout.md) | 新增/改动资产类型、产物路径、上传、历史、清理逻辑 |
| **工作流类型与产物形态**（`WorkflowTypeId`、媒体/文本两类产物、新增类型同步清单） | [docs/workflows.md](./docs/workflows.md) | 改工作流类型、产物形态、自定义服务商类型白名单 |
| 适配某个工作流的 AI 接口（`submit` / 分辨率 / 输出路径 / 多实现） | [docs/workflow-adaptation-guide.md](./docs/workflow-adaptation-guide.md) | 接入新 AI 服务 |
| **任务管理**（异步任务类型/执行器、进度、日志、任务接口与 UI、画布 Loading 恢复） | [docs/task-manager.md](./docs/task-manager.md) | 涉及任务机制的**任何**改动；排查「任务卡住 / Loading 不消失 / 日志看不到 / 数据库变大」 |
| **资产画布**总览（定位、数据模型、节点类型、交互、配置面板、生成流程、切换分镜跟随加载） | [docs/canvas/README.md](./docs/canvas/README.md) | 改画布相关功能 |
| **自动搭画布**（分镜 / 场景按子场景幂等搭建） | [docs/canvas/autobuild.md](./docs/canvas/autobuild.md) | 改自动搭画布 |
| **画布蓝图**（多选创建 → 全局/项目级保存 → 系统配置管理 → 画布内插入） | [docs/canvas/blueprint.md](./docs/canvas/blueprint.md) | 改蓝图功能 |
| **统一异步任务架构**（工作流 / LLM 会话 / ffmpeg 三类任务，画布视角） | [docs/canvas/task-architecture.md](./docs/canvas/task-architecture.md) | 新增任务类型、改任务广播或 Loading 恢复 |
| **工作流完成通知气泡与任务管理器抽屉** | [docs/canvas/notification.md](./docs/canvas/notification.md)、[docs/task-manager/ui.md](./docs/task-manager/ui.md) | 改任务提醒、抽屉、日志查看器 |
| **自定义工作流服务商**（脚本化接入任意 HTTP 接口） | [docs/plans/custom-provider.md](./docs/plans/custom-provider.md) | 改自定义服务商与脚本运行时 |
| ComfyUI Bridge 对接 | [docs/bridge-config-doc.md](./docs/bridge-config-doc.md)、[docs/bridge-workflow-fields.md](./docs/bridge-workflow-fields.md) | 配置/对接 Bridge |
| 全部文档清单与「按任务快速定位」 | [docs/README.md](./docs/README.md) | 不确定该读哪篇时 |

其他约定：
- 资产管理 Python 脚本位于 `.agents/skills/create-video-script/scripts/`；剧本资产的读写约定见 `script-manager` 技能（`.agents/skills/script-manager/SKILL.md`）。
