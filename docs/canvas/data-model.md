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
  "version": 1,                    // CANVAS_SCHEMA_VERSION，读取时用 migrateCanvasData 迁移/校验
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
  "createdAt": "ISO", "updatedAt": "ISO"
}
```

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
> **loading 展示跨页面存活**：节点进入 loading 后，运行中任务会持久化到 localStorage（键 `dsh.asset-canvas.tasks.{project}:{画布定义文件路径}`，记录 nodeId → `{ kind, outputPath, startedAt, taskId? }`）；离开资产画布 / 刷新页面 / 切换画布再回来时 `useCanvasGeneration.restore()` 恢复 loading 展示并继续跟踪：workflow 任务按 taskId 恢复轮询（终态直接收敛），本地 ffmpeg 同步任务按产物 mtime 相对提交前基线的变化探测完成（超时 10 分钟判定中断）。任务到达终态（成功/失败/中断）时删除记录。
>
> **AI 文本节点（LLM 会话）loading 跨页面存活（与上述 localStorage 机制不同）**：AI 文本节点不产生文件产物，其运行态恢复由**服务端活跃会话注册表**驱动（`server/src/llm/session-manager.ts`，**仅内存不持久化**；会话携带 nodeId + 画布 scope）。画布加载/切换/WS 重连时 `AssetCanvas` 按「项目 + 画布 scope」过滤 `llmSocket.sessions` 恢复 loading（subscribe → 快照补齐 → 增量实时显示 → 终态收敛）；**流式期间前端纯内存显示（不写盘、不入撤销栈）**，终态由后端独占写入画布定义文件（`config.output` + `outputHistory` 追加，CAS + 路径锁，历史单写者无重复），前端 finished 时经 `adoptExternalChange` 仅做视图同步（入撤销栈 + savedRev 对齐）。传输通道为 **WebSocket（/llm-ws）替换原 SSE**（客户端断开不再中止上游）；服务重启后注册表清空 → 无幽灵 loading（未终态部分输出丢失为内存方案预期取舍）。详见 [llm-session.md](./llm-session.md)。
