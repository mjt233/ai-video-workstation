# 切换分镜跟随加载

> 返回 [总览与定位](./README.md)

- 左侧资产浏览器切换分镜只改 URL query，`ScenePanel` 保持挂载仅更新 props。
- `useCanvasStore` / `useCanvasGeneration` 内部持 `targetRef`，暴露 `switchTarget(newTarget)`：
  - store：先清防抖 timer + 落盘未保存修改（仍用旧目标）→ 重置 data / 撤销重做 / 剪贴板 → 重新 `load()`；
  - gen：更新目标 + `reset()`（清轮询与全部展示态；**服务端任务不受影响**——结果由服务端落盘，切回时按固定路径直接可见，运行中任务由 `restore(knownNodeIds)` 按 项目 + 画布 scope 从统一任务注册表恢复 loading 展示与跟踪，见 [task-architecture.md](./task-architecture.md)）。
- `AssetCanvas` 用 `watch(target, ...)` 在切目标时清空选中/菜单/内联重命名状态并调用两个 `switchTarget`，随后刷新全部节点产物信息（`refreshNodeOutputs`，node-info 批量查询）——异步任务已完成的结果立即显示。
- **加载后视口对准节点**：首次 `load()` 与 `switchTarget` 完成后调用 `scheduleFitCanvas`，把视口居中到全部资产节点并缩放使包围盒落入可视区（与工具栏「适应视图」同一套参数）。Vue Flow 的 `fitViewOnInit` 只在组件首次初始化时生效、切换分镜不会自动 fit，因此必须显式调用。`fitView` 要求节点已测出宽高且容器尺寸 > 0：测量未完成或画布 Tab 隐藏时保持 pending，由 `onNodesInitialized` / 容器 `ResizeObserver` 再试；快速切换分镜以世代号丢弃过期请求。空画布则重置为默认视口 `{ x: 0, y: 0, zoom: 1 }`。
