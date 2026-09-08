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
5. 运行中任务持久化（见 [data-model.md](./data-model.md)）：`generate` 提交成功后、ffmpeg 同步任务请求发出前，把 `{ kind: 'workflow', taskId, outputPath, startedAt } | { kind: 'ffmpeg', outputPath, startedAt, baselineExists, baselineMtime }` 写入 localStorage；`restore()`（画布加载与 `switchTarget` 时调用）恢复未终态任务的 loading 展示与跟踪，终态收敛时经 `onResult` 刷新产物并删除记录。
6. 中断 `interrupt`（**统一入口**，节点卡片「中断」/编辑器「中断」均走这里）：workflow 任务清轮询、置已中断并调用服务端 cancel 端点（仅 cancelable 工作流可真正取消）；ffmpeg 同步任务无服务端取消接口，停止本端探测并置已中断（若同会话请求随后成功返回，以真实成功态收敛）。中断同时删除持久化记录。
7. 获取视频帧 / 拼接 / 裁剪（同步 ffmpeg 路由）：成功后同样只更新状态并回调 `onResult`；重复执行时服务端自动把旧产物归档进历史目录。
8. **AI 文本节点不走上述流程**（无工作流、无产物文件）：节点内「生成」→ `POST /api/llm/chat` 创建 LLM 活跃会话（立即返回 `taskId`）→ `llmSocket.subscribe` 经 WebSocket 流式消费 → 标准 Loading 由 `stream-state` 上抛（`gen.beginClientRun` / `updateClientRun` / `endClientRun`）；终态由后端写入画布定义文件，前端 `adoptExternalChange` 视图同步；取消经 `gen.interruptLlm` / `llmSocket.cancel`。完整机制见 [llm-session.md](./llm-session.md)。
