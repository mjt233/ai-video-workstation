# 切换分镜跟随加载

> 返回 [总览与定位](./README.md)

- 左侧资产浏览器切换分镜只改 URL query，`ScenePanel` 保持挂载仅更新 props。
- `useCanvasStore` / `useCanvasGeneration` 内部持 `targetRef`，暴露 `switchTarget(newTarget)`：
  - store：先清防抖 timer + 落盘未保存修改（仍用旧目标）→ 重置 data / 撤销重做 / 剪贴板 → 重新 `load()`；
  - gen：更新目标 + `reset()`（清轮询与全部展示态；**服务端任务不受影响**——结果由服务端落盘，切回时按固定路径直接可见，运行中任务由 `restore(knownNodeIds)` 按 项目 + 画布 scope 从统一任务注册表（ffmpeg + 已登记工作流任务）与 SQLite 工作流任务（pending/running）恢复 loading 展示与跟踪，任务未到终态前一直保持加载中，见 [task-architecture.md](./task-architecture.md)）。
- `AssetCanvas` 用 `watch(target, ...)` 在切目标时清空选中/菜单/内联重命名状态并调用两个 `switchTarget`，随后刷新全部节点产物信息（`refreshNodeOutputs`，node-info 批量查询）——异步任务已完成的结果立即显示。
- **世代号必须分离（`canvas/switchGuard.ts`）**：`applySwitch` 的「丢弃过期切换」与 `scheduleFitCanvas` 的「丢弃过期 fit」是两件事，各用独立计数器（`beginSwitch/isCurrentSwitch` 与 `beginFit/isCurrentFit`）。**共用计数器会自伤**：切换流程中途调用 `scheduleFitCanvas()`（推进视口号）会让切换自己的守卫失效，收尾步骤（如 AI 文本节点 Loading 恢复）被静默跳过——缺陷记录见 [`../plans/bug/2026-09-12-ai-text-node-loading-lost-on-canvas-switch.md`](../plans/bug/2026-09-12-ai-text-node-loading-lost-on-canvas-switch.md)。
- **跨画布状态必须成对清理**：本组件跨分镜/场景切换**不卸载**，`gen.switchTarget()` 会重置 `statusByNode`（展示态），因此按画布隔离的**恢复订阅表 `llmRestore` 必须在切换时一并清空**（`resetLlmRestore()`）——只清展示态不清订阅表，切回原画布时「已订阅 → 跳过恢复」会成立，节点 Loading 无法重建（同一缺陷的第二个根因）。
- **加载后视口对准节点**：首次 `load()` 与 `switchTarget` 完成后调用 `scheduleFitCanvas`，把视口居中到全部资产节点并缩放使包围盒落入可视区（与工具栏「适应视图」同一套参数）。Vue Flow 的 `fitViewOnInit` 只在组件首次初始化时生效、切换分镜不会自动 fit，因此必须显式调用。`fitView` 要求节点已测出宽高且容器尺寸 > 0：测量未完成或画布 Tab 隐藏时保持 pending，由 `onNodesInitialized` / 容器 `ResizeObserver` 再试；快速切换分镜以视口世代号丢弃过期请求。空画布则重置为默认视口 `{ x: 0, y: 0, zoom: 1 }`。
