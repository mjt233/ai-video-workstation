# 生成流程（`frontend/src/canvas/useCanvasGeneration.ts`）

> 返回 [总览与定位](./README.md)

1. `generateNode(nodeId)`（`composables/useCanvasNodeOps.ts`，按原型分发）：收集输入图路径（`collectInputPaths`，含顺序）→ `gen.setInputPaths` → `gen.generate`。
2. `generate`：
   - `image-edit`：`vars = { prompt, imagePaths: JSON.stringify(inputPaths), purpose: 'canvas-image' }`；
   - `text-to-image`：先把 prompt 写入节点目录的 `prompt.md`，`vars = { promptPath, purpose: 'canvas-image' }`。
   - 产物路径 `computeOutputPath`：**固定文件名** `output.{ext}`（扩展名取原型 `outputExt`，无版本号计算）。
3. 提交后轮询 `poll`（2s，首轮立即查一次）：**服务端终态为 `completed` / `failed`**（无 success/error）。轮询**只更新 `statusByNode` 展示**，成功时经 `onResult(nodeId, outputPath)` 回调通知 UI 刷新（AssetCanvas 更新节点产物信息 node-info）；**不回写 `config.current`/`config.history`**——结果落盘由服务端完成，页面离开/关闭后结果依然存在。
4. 状态机：`statusByNode[nodeId]` = `running | success | error`。
   **loading 是节点的通用能力**（不再是某类节点私有）：`CanvasNodeCard` 统一按 `status` prop 在节点内容上叠加遮罩——`running` 显示加载动画 + 「中断」按钮，`error` 显示错误信息 + 「重试」按钮；各节点 body 组件不再自行渲染遮罩，生成视频等原先无遮罩的节点也自动获得 loading 展示。配置面板编辑器的 `isRunning` 展示与中断按钮不变。
5. 运行中任务状态来源（见 [task-architecture.md](./task-architecture.md)）：
   - **工作流任务**：提交后把 `{ kind: 'workflow', taskId, outputPath, startedAt }` 写入 localStorage，本地轮询 `GET /api/workflow/tasks/:id`（引擎为权威）；`restore()`（画布加载与 `switchTarget` 时调用）恢复未终态任务的 loading 展示与跟踪，终态收敛时经 `onResult` 刷新产物并删除记录。
   - **ffmpeg 任务**（拼接 / 裁剪视频 / 裁剪音频 / 取帧）：**不再使用 localStorage**——提交即拿到 `taskId`，进度与终态由服务端统一任务注册表经 WS 广播驱动（`taskSocket.onTaskUpdate`）；画布加载/切换时 `restore(knownNodeIds)` 按「项目 + 画布 scope + 节点仍在画布上」从注册表恢复 loading。任务也同时出现在全局任务管理器中，可中断。
6. 中断 `interrupt`（**统一入口**，节点卡片「中断」/编辑器「中断」均走这里）：统一调用 `POST /api/tasks/:taskId/cancel`，服务端路由到对应执行器（ffmpeg kill 子进程并删除半截产物 / LLM abort 上游 / 工作流 Bridge 取消或延迟取消标记）；本地先置「已中断」并停轮询，终态由广播收敛。中断同时删除持久化记录。
7. 获取视频帧 / 拼接 / 裁剪（**异步 ffmpeg 任务**）：接口立即返回 `{ taskId, status }`，后台执行；成功后经 WS 终态广播触发 `onResult` 刷新产物，重复执行时服务端自动把旧产物归档进历史目录。拼接支持 `copy` / `reencode` 两种编码方式与三种输出尺寸策略（见 [node-types.md](./node-types.md)）。
8. **AI 文本节点不走上述流程**（无工作流、无产物文件）：节点内「生成」→ `POST /api/llm/chat` 创建 LLM 活跃会话（立即返回 `taskId`）→ `llmSocket.subscribe` 经 WebSocket 流式消费 → 标准 Loading 由 `stream-state` 上抛（`gen.beginClientRun` / `updateClientRun` / `endClientRun`）；终态由后端写入画布定义文件，前端 `adoptExternalChange` 视图同步；取消经 `gen.interruptLlm` / `llmSocket.cancel`。完整机制见 [llm-session.md](./llm-session.md)。
