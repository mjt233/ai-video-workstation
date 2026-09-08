# 自动搭画布（`frontend/src/canvas/autobuild.ts`）

> 返回 [总览与定位](./README.md)

- 工具栏「自动搭画布」：
  - **分镜画布**：根据分镜 `stage.json` 收集引用（场景/角色/变体/custom，`prev` 异步解析为上一分镜最后一帧）→ 生成「加载图片锚点 + 生成图片」结构 → 幂等应用（不重复添加已有引用）。引用解析规则与 `server` 的 `resolveStageAssetPath` / `resolveCharacterAssetPath` 对齐（见 `resolveShotStageRef` / `resolveCharacterRef`）。
  - **场景画布（按子场景）**：读 `prompt/stage/{场景}/variants/{标签}/` 下全部 `{id}.json` 变体元数据 → `buildSubSceneAutoCanvas` 搭建「基础加载图片（所有根变体共用）+ 每个变体一个生成图片（prompt = desc，`config.autoRef` 幂等）+ 变体 refs 加载图片（同资产共享）」→ 幂等应用（已存在节点只补缺连线）。
- 生成节点 prompt：分镜画布取 `overview.json.visual`；场景画布各变体取各自 `desc`。
