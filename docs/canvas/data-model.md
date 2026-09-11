# 数据模型与文件布局

> 返回 [总览与定位](./README.md)

## 画布定义文件

| 画布类型 | 定义文件 | 生成产物根目录 |
|----------|----------|----------------|
| 分镜画布 | `prompt/scene/{集数}/{分镜}/canvas.json` | `assert/scene/{集数}/{分镜}/canvas/` |
| 场景画布 | `prompt/stage/{场景名}/canvas/{子场景标签}.json` | `assert/stage/{场景名}/canvas/{子场景标签}/` |

## `canvas.json` 结构（`frontend/src/canvas/types.ts`）

```jsonc
{
  "version": 2,                    // CANVAS_SCHEMA_VERSION，读取时用 migrateCanvasData 迁移/校验
  "kind": "scene",                 // 'stage' | 'scene'
  "nodes": [
    {
      "id": "uuid",                // newId() 生成
      "prototypeId": "image-generate", // 节点原型，见 node-types.md
      "name": "生成图片",            // 节点名称（双击可内联重命名）
      "x": 0, "y": 0,               // 画布坐标
      "width": 240, "height": 160,  // 节点尺寸
      "config": { /* 各原型自定义，见 node-types.md */ }
    }
  ],
  "connections": [
    { "id": "uuid", "fromNodeId": "a", "fromPortId": "out", "toNodeId": "b", "toPortId": "in" }
  ],
  "groups": [
    {
      "id": "uuid",                // newId() 生成
      "name": "分组 1",             // 标题（双击标题条内联重命名；默认「分组 N」）
      "color": "#1976D2",          // 主题色（8 色预设色板，见 groups.ts: GROUP_PALETTE）
      "x": 0, "y": 0,              // 分组矩形左上角（流坐标）
      "width": 624, "height": 524  // 分组矩形尺寸（最小 160×100）
    }
  ],
  "createdAt": "ISO", "updatedAt": "ISO"
}
```

### 持久分组（`groups[]`）

- **成员关系不落盘**：分组**没有 `nodeIds` 字段**——节点是否属于某分组，由「节点矩形与分组矩形是否**重叠（面积 > 0，相切不算）**」在运行时实时派生（`groups.ts: rectsOverlap / nodesInGroup / groupsOfNode`）。因此拖动节点进出分组即自动加入/脱离，无需任何显式操作；一个节点可同时属于多个重叠分组。
- **版本迁移**：`version` 由 `1` 升为 `2`。`migrateCanvasData` 对旧文件补 `groups: []`；`groups` 非法（非数组）或含结构非法项时**丢弃并 `console.warn`**（不抛错，保证旧/损坏文件仍可加载）。
- **服务端零改动**：`PUT /api/canvas/def`（`server/src/assets/canvas-def.ts`）只校验 `data` 为对象且 `kind` 匹配，随后 `{ ...dataObj, rev, updatedAt }` 落盘，`groups` 作为未知字段原样透传；分镜重编号/移动、存储清理、自动搭画布均只处理 `nodes`/`connections`，不受影响。
- **撤销/重做**：分组快照与节点同一份 `CanvasData` 深拷贝（`pushHistory`），因此分组增删改与拖动天然可撤销；拖动/缩放**结束时一次性回写**（`store.moveEntities` / `store.updateGroup`），单次撤销即可整体回退。
- **几何派生的直接后果（复制粘贴必须避让）**：既然成员关系只由重叠决定，**复制出的副本绝不能与原件矩形重叠**（且需留净距，见 T9）——否则两个分组会同时“认领”对方的节点，拖动任一方都会把对方节点带走。落点由 `pastePlacement.ts: clipboardPlacementOffset` 统一计算（首选原内容右下方向外一个身位、被占用则逐级探测），实现与约束见 [interactions.md](./interactions.md) 约束 T9。

## 生成产物与历史

- 节点产物：`assert/{scope}/canvas/{nodeId}/output.{ext}` —— **固定文件名**（扩展名按原型：图片 jpg / 视频 mp4 / 帧 png / TTS flac，见 `registry.ts` 的 `outputExt`；**裁剪音频节点例外**——扩展名随输出格式 `config.format` 变化，「原格式」跟随输入扩展名，见 [node-types.md](./node-types.md)）。"当前结果"即文件系统事实：前端按 `scope + nodeId + 扩展名` 恒等推导（`paths.ts: canvasNodeOutputPath` / `generate.ts: getNodeCurrentAssetPath`），**不再读写 `config.current`/`config.history`**（旧数据字段保留兼容读取、不再写入）。
- 历史版本：`assert/{scope}/canvas/{nodeId}/history/output/{时间戳}.{ext}`，由服务端 `assets/history.ts` 统一管理（与分镜场景图/自定义资产同一套机制）：
  - 重复生成时旧产物先**复制**归档进 history 目录（`copyExistingAssetToHistory`，copy 而非 rename → 生成运行期间旧图持续可见），再覆盖固定路径（引擎与 `routes/canvas.ts` 三个同步分支均已接入）；
  - 历史列表/激活/删除走通用 API `GET/POST/DELETE /api/assets/:project/history*`（`listAssetHistory` / `activateHistoryVersion` / `deleteHistoryVersion`，path 参数为固定产物路径）。
- 产物信息（存在性 / mtime / 大小）：`GET /api/canvas/node-info?project=&path=`（fs.stat），前端画布加载与生成完成时刷新，用于预览防缓存 token、按钮文案与「上游已更新」角标。
- 预览 URL：`/api/fs/{project}/{relPath}?t=...`（`preview.ts: buildPreviewUrl`；token 为产物 mtime）。
- **手动上传产物（生成图片/视频节点）**：生成图片/生成视频编辑器提供「上传产物」按钮，把本地图片/视频直接写入节点固定产物路径（`output.jpg` / `output.mp4`）。上传经 `POST /api/canvas/upload`（见 [module-structure.md](./module-structure.md)）——目标已有产物时**先归档进 history 目录再覆盖**（与重复生成同一套历史机制，可在「历史」对话框查看/激活/删除）；图片接受 jpg/png/webp（统一落盘 `output.jpg`，与 `/assets/upload` 一致），视频**仅接受 mp4**（不转码，其余格式提示先转码）。**反馈**：上传中「上传产物」按钮显示 loading 并禁用（防重复点击，`CanvasEditorPanel` 经 `upload-state` prop 下发），节点卡片叠加进度遮罩（文件名 + 进度条）；成功时 snackbar 提示「上传成功」，覆盖了旧产物时提示「上传成功，原产物已保存为历史版本」（据服务端 `archived` 返回值区分）；失败时节点卡片错误遮罩（含「重试」）+ snackbar。上传进度/失败遮罩复用加载节点同款通用能力（`useCanvasUpload` 按目标路径自动选择端点：`isCanvasNodeOutputPath` 为真走 `/api/canvas/upload`，否则走通用 `/fs/upload`）。生成运行中（loading）上传按钮禁用。

> **异步结果可靠性**：任务由服务端 SQLite 队列独立执行，产物落盘与页面无关；离开画布 / 切换项目 / 关闭浏览器后任务完成，重新进入画布时按固定路径直接可见（无任何元数据回写依赖）。前端轮询（`useCanvasGeneration.poll`）仅负责实时状态展示，纯体验层。
>
> **loading 展示跨页面存活**：节点进入 loading 后，运行态由**服务端统一任务注册表**驱动（`server/src/tasks/registry.ts`，**仅内存不持久化**；任务携带 `nodeId` + 画布 scope + 进度）。画布加载 / 切换画布时 `useCanvasGeneration.restore(knownNodeIds)` 按「项目 + 画布 scope + 节点仍在画布上」过滤恢复 loading 展示并重新订阅：数据源为注册表（WS 全量快照；快照未就绪时 HTTP 兜底 `GET /api/tasks`）**加上 SQLite 工作流任务的 pending/running 补查**（注册表只在引擎领取任务时登记，排队窗口/服务重启期间为空）。ffmpeg 任务进度与终态由 WS 广播驱动，工作流任务保留本地轮询（`GET /api/workflow/tasks/:id`）；**任务未到终态前 loading 一直保持**。**localStorage 任务记录已移除**（原 `dsh.asset-canvas.tasks.*` 机制废弃）。详见 [task-architecture.md](./task-architecture.md)。
>
> **AI 文本节点（LLM 会话）loading 跨页面存活**：AI 文本节点不产生文件产物，其运行态恢复由**服务端活跃会话注册表**驱动（`server/src/llm/session-manager.ts`，**仅内存不持久化**；会话携带 nodeId + 画布 scope，**会话 id 即统一任务 id**）。画布加载/切换/WS 重连时 `AssetCanvas` 按「项目 + 画布 scope」过滤 `taskSocket.sessions` 恢复 loading（subscribe → 快照补齐 → 增量实时显示 → 终态收敛）；**流式期间前端纯内存显示（不写盘、不入撤销栈）**，终态由后端独占写入画布定义文件（`config.output` + `outputHistory` 追加，CAS + 路径锁，历史单写者无重复），前端 finished 时经 `adoptExternalChange` 仅做视图同步（入撤销栈 + savedRev 对齐）。传输通道为 **WebSocket（/llm-ws）替换原 SSE**（客户端断开不再中止上游）；服务重启后注册表清空 → 无幽灵 loading（未终态部分输出丢失为内存方案预期取舍）。详见 [llm-session.md](./llm-session.md) / [task-architecture.md](./task-architecture.md)。
