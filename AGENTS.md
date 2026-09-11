# AGENTS.md — ai-video-workstation

## 快速启动
- `npm run dev` — 同时启动服务端 (3001) 和前端 (5233)
- `npm run build` — 仅构建前端
- `npm run start` — 生产模式：Express 托管 `frontend/dist/`，端口 3001
- `npm run typecheck` — 全局 TS 类型检查（服务端 + 前端）
- `npm run lint` — ESLint 检查
- `npm run lint:fix` — ESLint 自动修复
- 前端开发服务器代理 `/api` → `localhost:3001`

## 技术栈
- **服务端：** Express + TypeScript，`tsx` 开发运行，`tsc` 类型检查
- **前端：** Vue 3 + Vuetify 3 + vue-router + axios + TypeScript，Vite 构建，`vue-tsc` 类型检查
- **ESLint** flat config，TypeScript + Vue 规则

## 编码规范

- 编写代码时，类或方法需要有详细JsDoc文档注释，并标注每个字段、参数和返回值的含义和用法。
- 前端使用Vuetify表单输入组件时，`variant`优先默认使用`outlined`

## 约束
- **修改代码后必须执行 `npm run typecheck`，确保无类型错误**
- **修改代码后必须执行 `npm run lint`，确保无 ESLint 错误**
- **所有删除类操作必须弹窗确认**：使用 `confirm` 工具函数（`../utils/confirm`），提供标题、内容、确认按钮文案和颜色（删除建议 `error`），用户确认后方可执行
- **所有捕获的异常必须向上抛出或向控制台输出日志**：`catch` 块不得静默吞掉异常；如确实无需处理（例如兜底回退、清理收尾、已知可忽略的竞态），必须在 `catch` 块内添加行内注释说明原因，并向用户告知该处属于有意忽略
- 浏览器模拟操作时，除非用户指定在哪个项目的哪个画布中操作，不得直接修改用户原有的画布来进行测试。用户未明确授意在哪个画布模拟操作测试时，只允许通过临时创建新项目或在已有项目中在末尾创建新的集数，并在新的集数下创建新分镜进行画布的测试，任务完成后删除临时的画布并向用户报告。

## 数据：文件系统即数据库
所有项目资产存放在 `design/{project}/` 下：
```
prompt/
  character/{name}/{overview,appearance,voice}.md
  stage/{stage}/{stage}-{subscene}.md
  scene/{episode}/{shot}/{overview,stage,script}.json + prompt.md
  script/outline.md + script/episodes/{episode}.md   # 剧本大纲与分集剧本（可在线编辑）
assert/  (图片, 音频)
overview.md
```
- API：`GET /api/projects`、`GET /api/fs/:project/*`（目录列表或文件读取）、`POST /api/fs/:project/*`（写入）
- 写入限于 `prompt/`、`assert/` 前缀，以及根级 `overview.md`、`project.json`
- 前端状态完全由 URL 查询参数驱动：`project`、`type`、`name`、`episode`、`shot`、`section`（剧本 `type=script` 时区分 `outline`/`episodes`）；详情面板页签同步到 `tab` 参数（分镜：overview/script/images/video/custom/canvas；场景：overview/canvas；角色：overview/appearance/voice；道具：image/video/audio），同类型资产间切换保留页签、跨类型切换清除

## 约定
- 所有 UI 文字、文档、资产和提交信息使用**中文**
- 服务端开发时使用 `tsx watch` 自动重启（支持 TypeScript）
- 图片/音频文件以二进制流传输；文本/markdown/JSON 以 UTF-8 传输
- 资产管理 Python 脚本位于 `.agents/skills/create-video-script/scripts/`
- `design` 目录下的整体资产约定见 [./docs/asset-layout.md](./docs/asset-layout.md)（含 **3.0.3 系统全局回收站 `design/.trash/` 与存储清理**）
- **存储清理**：项目设置面板「存储清理」页签扫描「无引用自定义资产」与「久远历史记录」（阈值默认 7 天），勾选后移入**系统全局回收站** `design/.trash/{批次}/{项目名}/...`；回收站的查看/恢复/彻底删除与定时自动清理（默认每 7 天执行一次、回收站保留期 7 天，配置落盘 `server/config/system.json`，日志前缀 `[trash-auto-clean]`）在**系统设置 → 系统设置 → 回收站**子类中管理。`.trash` 为保留目录，不出现在项目列表，也不允许创建/导入同名项目
- **资产画布**（分镜/场景详情页「资产画布」Tab）的业务逻辑、数据模型与开发指南见 [./docs/canvas/README.md](./docs/canvas/README.md)（按主题拆分为多个文档）：包括节点类型、连线规则、画布交互、配置面板、输入图拖拽排序、生成流程、自动搭画布、设为分镜场景图、切换分镜跟随加载及常见坑
- **画布蓝图**（可复用画布片段：多选创建 → 全局/项目级保存 → 系统配置「画布蓝图」页签管理 → 画布内插入，可自动包成独立分组）见 [./docs/canvas/blueprint.md](./docs/canvas/blueprint.md)：创建时**分组须显式选中**（仅选中组内全部节点不带分组）；蓝图编辑器复用 `AssetCanvas` 的 `mode='blueprint'`（执行类入口关闭，加载节点可上传/选择资产，资产上下文为蓝图 `assetProject`，**手动保存：`autoSave: false`，头部「保存」/Ctrl+S 落盘，关闭时提示不保存退出**）；蓝图文件为 `prompt/blueprint/{id}.json`（项目级）与 `server/config/blueprints/{id}.json`（全局）
- **统一异步任务架构**（工作流 / LLM 会话 / ffmpeg 三类任务同一注册表 + 全局任务管理器 + ffmpeg 接口异步化）：画布视角见 [./docs/canvas/task-architecture.md](./docs/canvas/task-architecture.md)：新增本地 ffmpeg 操作必须导出 `buildXxxCommand()` 交给 `tasks/ffmpeg-executor.ts` 执行（否则无进度、无法中断）；任务中断统一走 `POST /api/tasks/:taskId/cancel`；不要再引入 localStorage 任务记录
- **任务管理（何时读 `docs/task-manager.md`）**：任务管理器的业务与实现机制统一见 [./docs/task-manager.md](./docs/task-manager.md)（总览 + 分主题索引：`data-model` / `lifecycle` / `execution` / `events` / `api` / `log` / `ui` / `development`）。**动手前先读该文档**的情形：
  - 新增/修改任何**异步任务类型**（执行器、注册表登记、进度、中断能力）或本地 ffmpeg 操作；
  - 改动**任务日志**（写入内容与级别、轮询降噪、`task_logs` 表结构、保留期与清理、占用统计）；
  - 改动**任务查询/中断/历史接口**（`/api/workflow/tasks*`、`/api/tasks*`、`/api/system/task-log*`）；
  - 改动**任务管理器 UI**、画布 Loading 恢复、错误「详情」日志查看、系统设置「日志」子类；
  - 排查「任务卡住 / 刷新后 Loading 不消失 / 日志看不到 / 数据库变大」类问题。

  三条必须遵守的约束：
  1. **运行态与持久态是两个事实源**——内存注册表（`tasks/registry.ts`）是「现在在跑什么」的唯一事实源但**不持久化**；SQLite（`data/workflow.db`）是工作流任务与日志的持久化权威但**不含 ffmpeg / LLM 任务**；画布 Loading 恢复必须两者并用（注册表 + SQLite `pending|running` 补查）；
  2. **日志清理的安全边界**——只删 `completed`/`failed` 任务的超期日志；**`pending`/`running` 任务的日志永不删除**；`tasks` 行与产物一律保留。自动清理（默认每 24 小时、保留期 14 天）与手动清理的配置在**系统设置 → 系统设置 → 日志**（`server/config/system.json` 的 `taskLog` 子类，日志前缀 `[tasklog-auto-clean]`）；判定空间回收用 `freelist_count`，**不要用文件大小**（Windows 截断后可能不缩小）；
  3. **日志读取必须带 `limit`**——`GET /api/workflow/tasks/:taskId/log` 不传 `limit` 会返回全量（单任务可达上千行）；画布轮询用 `limit=1`，查看器用尾部 200 条 + 按需「查看全部」。

  验证此类改动需在数据库**副本**上演练（`node scripts/verify-log-cleanup.mjs 14`），不得直接对真实库执行清理。
- **画布节点媒体输入预览规则**：任何节点主体需要展示已连接的媒体输入（图片/音频/视频）时，必须复用生成图片/生成视频节点使用的统一输入预览组件 `frontend/src/components/canvas/editors/CanvasInputPreview.vue`（现有实例：AI文本生成节点），禁止为节点单独实现一套预览/徽标 UI。具体做法：
  1. 输入条目使用 `CanvasInputInfo`（`nodeId/path/label/version`），`version` = 来源节点产物 mtime（`nodeOps.withVersions` 经 `getOutputMtime` 提供），作为预览 URL 缓存键——源资产未变化时预览 URL 稳定，避免无关重渲染导致媒体反复重新加载；
  2. 按来源节点输出类型拆成 `images-inputs` / `videos-inputs` / `audios-inputs` 三组传入（某类型无输入时该组不渲染），各组标题/数量上限/占位文案按能力传参；
  3. `reorder` 事件（组内拖拽排序）用 `frontend/src/canvas/generate.ts` 的 `mergeInputOrder` 合并回 `config.inputOrder`（只影响本组相对顺序）；
  4. `remove` 事件（输入项悬浮红色 x）上抛 `disconnect-input`，父级经 `nodeOps.disconnectInput` 断线并同步清理 `config.inputOrder`（合并为单次撤销，不弹确认）；
  5. 节点主体内渲染时，预览容器须加 `nodrag nowheel` 类，避免预览内 HTML5 拖拽排序/滚动与 Vue Flow 节点拖拽/画布滚轮缩放冲突。
