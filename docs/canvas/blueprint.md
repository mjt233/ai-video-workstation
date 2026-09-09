# 画布蓝图（Canvas Blueprint）

> 返回 [总览与定位](./README.md)

「画布蓝图」= 可复用的画布片段：**节点配置 + 连接 + 持久分组 + 相对位置关系**。用于把「一套搭好的子图」保存下来，在任意画布（含其他项目）里一键插入，并可在系统配置中集中管理。

蓝图与画布定义的区别：

| | 画布定义（canvas.json） | 画布蓝图 |
|---|---|---|
| 定位 | 某张分镜/场景画布 | 可复用模板片段 |
| 绑定 scope | 是（分镜/子场景） | 否 |
| 产物 | `assert/{scope}/canvas/{nodeId}/output.{ext}` | **不携带任何产物文件**（插入后重新生成） |
| 存储 | `prompt/.../canvas.json` | 全局 `server/config/blueprints/{id}.json`；项目级 `design/{project}/prompt/blueprint/{id}.json` |
| 版本 | `rev` + CAS（`/api/canvas/def`） | `rev` + CAS（`/api/blueprints`） |

## 1. 数据模型

```jsonc
// server/config/blueprints/{id}.json  或  design/{project}/prompt/blueprint/{id}.json
{
  "version": 1,                 // BLUEPRINT_SCHEMA_VERSION
  "id": "uuid",                 // 服务端以文件名承载；读取时以文件名为准
  "name": "三视图角色设定",       // 非空，同作用域内唯一（重名 → 409 EXISTS）
  "description": "",
  "assetProject": "我的项目",     // 资产上下文（项目级强制 = 所属项目；全局可空）
  "nodes":       [ /* CanvasNodeData：id/prototypeId/name/x/y/width/height/config */ ],
  "connections": [ /* CanvasConnection */ ],
  "groups":      [ /* CanvasGroupData：id/name/color/x/y/width/height */ ],
  "createdAt": "ISO",
  "updatedAt": "ISO",           // 每次保存刷新
  "rev": 3                      // 服务端维护（每次保存 +1），前端 CAS 基准
}
```

节点/连线/分组与 `canvas/types.ts` **同构** → 与「复制粘贴」（`nodeClipboard.ts`）共用语义；读取经 `canvas/blueprint.ts: migrateBlueprint` 容错规范化（非法项丢弃 + `console.warn`，端点缺失的连线丢弃）。

## 2. 从多选创建蓝图

- 入口：画布多选悬浮工具栏（节点数 + 分组数 ≥ 2 时出现）**「创建蓝图」**按钮（选中集无节点时置灰 + tooltip）。
- 捕获规则（`captureBlueprintFromCanvas(canvas, nodeIds, groupIds)`）：
  - 节点：选中集内的全部节点；
  - 连线：**两端都在选中集内**的连线（跨边界连线不入蓝图）；
  - 持久分组：**必须被显式选中**（`selectedGroupIds`，即点分组标题条或框选完全包含），
    且「**成员节点全部在选中集内**」。因此：
    - 只选中分组内的全部节点、但没选中分组本身 → **不带分组**（"我只想要这些节点"的语义不被扩成"连框一起要"）；
    - 分组已选中但存在成员节点未选中 → 不收纳（避免半截分组与插入后的空框区域）；
    - 空分组显式选中则收纳（无成员节点，不受完整性约束）。
  - 坐标：保持原样（实例化时再归一化）。
- 保存对话框（`BlueprintSaveDialog.vue`）：名称（默认「蓝图 N」，取最小未占用编号）、描述、保存位置（**全局 / 项目** + 项目下拉，默认当前画布项目）、内容摘要；同名 → 弹窗确认后覆盖（服务端 `overwrite: true`，保留原 id）。

## 3. 画布内插入蓝图

- 入口：工具栏**「插入蓝图」**按钮（插入到视口中心）与**添加节点菜单底部「插入蓝图…」**（插入到菜单锚点处，即双击/右键空白处的位置）。
- 插入对话框（`BlueprintInsertDialog.vue`）：作用域页签（全局 / 项目）+ 项目选择器 + 搜索 + 蓝图列表（名称/描述/节点数/更新时间/资产项目）+ **「以独立分组插入」复选框（默认勾选）**。
  - 若蓝图 `assetProject` 非空且 ≠ 当前画布项目 → 显示**非阻塞**提示「资产引用可能失效」（不做存在性检查，插入后可在画布中重新选择资产）。
- 实例化（`instantiateBlueprint`）：
  1. **归一化**：内容包围盒左上角对齐插入锚点（独立分组时在分组内居中）；
  2. **id 重映射**：节点/连线/分组换新 id；节点配置中的引用（`config.inputOrder`、导演台 `imageClips/audioClips[].sourceNodeId`）经 `remapNodeConfig` 重映射；
  3. **剥离运行时字段**：`config.current` / `history` / `outputHistory`（某张画布的产物与文本历史引用）；`assetPath` 等资产路径**原样保留**；
  4. **独立分组**：`asGroup=true` 时额外创建分组（名称 = 蓝图名、尺寸 = 内容包围盒 + 2×12px 留白，不小于分组最小尺寸），内容整体内缩 → **所有节点与蓝图内原有分组嵌套在该分组内**，相对关系不变。
- 写入：`store.applyEntities`（**单次撤销快照**，连线逐条触发 connect 联动）→ 自动聚焦新节点（选中但不弹配置面板）→ snackbar 汇总；`Ctrl+Z` 一次整体回退。

## 4. 系统配置 →「画布蓝图」管理

系统配置对话框（`SystemSettingsDialog.vue`）新增顶层页签「画布蓝图」（`BlueprintSettingsPanel.vue`）：

| 操作 | 说明 |
|---|---|
| 作用域切换 | 全局 / 项目（项目级需选项目） |
| 搜索 | 按名称/描述过滤 |
| 新增蓝图 | 名称 + 描述 → 创建空蓝图并**直接进入画布式编辑器** |
| 编辑（铅笔） | 打开 `BlueprintEditDialog`（完整画布式编辑器，见下节；**手动保存**，关闭后列表自动刷新） |
| 重命名/描述 | 独立小对话框；`expectedRev` 为列表项的 rev（CAS，冲突提示刷新） |
| 导出 | 下载 `{名称}.json`（完整蓝图文件结构，可直接分享） |
| 导入 | 选择 `.json` → 客户端 `migrateBlueprint` 校验 → 确认导入到**当前作用域/项目**；同名 → 询问覆盖（服务端换新 id，覆盖则更新既有条目） |
| 删除 | `confirm` 弹窗确认（删除不可恢复；已插入画布的内容不受影响） |

## 5. 蓝图编辑器（完整画布式）

`BlueprintEditDialog.vue`（全屏对话框）内嵌 `AssetCanvas` 的**蓝图模式**（`mode="blueprint"`）——**同一套画布实现**，因此自动继承全部画布交互：连线与改接（Shift/Ctrl 批量）、多选与持久分组全套、复制粘贴、撤销重做、框选、缩放、配置面板智能贴靠、连线流向箭头动画。唯一的差异是**保存策略**：编辑器关闭自动保存，改为手动保存（见 5.4）。

### 5.1 关闭的能力（蓝图不产生产物、不绑定分镜）

| 能力 | 蓝图模式行为 |
|---|---|
| 生成 / 重新生成 / 中断 | 编辑器按钮隐藏（生成图片·生成视频·TTS·取帧·拼接·裁剪视频·裁剪音频） |
| 上传产物 | 隐藏（目标路径依赖画布 scope `assert/{scope}/canvas/{nodeId}/output.{ext}`） |
| 历史（产物 / 文本） | 右键菜单与编辑器入口均隐藏；对话框不渲染 |
| 保存为 / 设为分镜场景图 / 设为分镜视频 | 隐藏 |
| 自动搭画布、插入蓝图（嵌套） | 工具栏隐藏，添加节点菜单底部「插入蓝图…」同样隐藏（v1 不支持蓝图嵌套） |
| 资产拖入（左侧资产浏览器 → 画布） | 不适用（编辑器是对话框，无资产浏览器） |
| 任务/LLM 会话恢复、产物信息刷新、分镜切换跟随 | 不触发（注入 `createIdleGeneration()` 空实现） |

### 5.2 保留并开启的能力

- 节点增删改（添加节点菜单/双击空白）、重命名、缩放、拖动、复制粘贴（含系统剪贴板跨窗口）；
- 连线建立/断开/改接、右键菜单（断开/重命名/复制/删除）；
- 持久分组（创建/拖动 R2 跟随/缩放/改名/改色/解散/框选完全选中）；
- 配置面板：提示词、工作流选择、参数、导演台素材块、帧索引、裁剪参数等**非执行类配置**照常编辑；
- **加载图片/音频/视频的「上传 / 选择资产」**（见 5.3）。

### 5.3 资产上下文（`assetProject`）

蓝图内的资产路径是**项目内相对路径**（如 `assert/custom/canvas/123-a.png`），因此编辑器的预览/上传/选择资产需要一个**项目上下文**：

- 画布信息条（仅蓝图模式）提供**「资产项目」**下拉（项目级蓝图只读为所属项目；全局蓝图可设置/清除）；
- 选择资产时项目 = 资产项目；上传目标 = `assert/custom/canvas/{时间戳}-{文件名}`（`buildLoaderUploadDest`，与主画布一致）；`Ctrl+V` 粘贴媒体同样上传到该项目；
- **未设置资产项目**时：信息条显示警告图标，加载节点的「上传/选择资产」按钮置灰（tooltip 提示），媒体粘贴被阻止并提示；
- 资产项目变更的写入：**不立即落盘**——选择后只更新编辑器内的待保存值（同时即时切换资产上下文）；
  点「保存」/`Ctrl+S` 时由 `blueprintCanvasPersistence(ref, id, { assetProject })` 把
  `assetProject` 与 nodes/connections/groups **放在同一次 CAS 请求**中写入（服务端项目级蓝图强制覆盖为所属项目），
  「不保存退出」时该选择一并丢弃。

### 5.4 手动保存（不自动保存）

蓝图编辑器以 `useCanvasStore(project, target, persistence, { autoSave: false })` 关闭防抖自动保存：
**任何改动（节点/连线/分组/资产项目）只置脏、不落盘**，由用户显式保存：

| 入口 | 行为 |
|---|---|
| 头部「保存」按钮（`dirty` 时可用，保存中 loading） | `store.save()`：单次 CAS 请求写入内容 + 资产项目；成功 snackbar「蓝图已保存」，并同步「已落盘资产项目」基准 |
| `Ctrl+S` | 同上（`useCanvasKeyboard` 的 `save` 句柄；主画布不提供该句柄，保留浏览器原生行为） |
| 头部「关闭」按钮 | 有未保存改动 → `confirm` 弹窗「不保存退出 / 继续编辑」；确认后丢弃内存改动并关闭 |
| 冲突横幅（保存时 409 `VERSION_CONFLICT`） | 保留本地改动并显示横幅：备份当前蓝图（下载 `blueprint-{名称}.json`）/ 强制覆盖保存 / 重新加载服务端版本（后两者会同步「已落盘资产项目」基准） |

- 头部「未保存」chip 与工具栏「未保存」文案同源（`blueprintState.dirty` = 内容脏 ∨ 资产项目待保存）；
- 工具栏「版本 N」显示的是**最近一次成功保存**的 rev，保存后刷新；
- 关闭编辑器时未保存的改动随组件卸载丢弃（无任何后台落盘）。

> **存储清理引用保护**：全局蓝图存放在 `server/config/blueprints/`（项目目录之外），其引用的自定义资产若不额外计入引用，会被「存储清理 → 无引用自定义资产」误删。`assets/cleanup.ts: collectGlobalBlueprintRefs()` 扫描全局蓝图目录，按每条蓝图的 `assetProject` 把命中的 `custom/...` 路径归入对应项目的引用集合（项目级蓝图位于 `prompt/blueprint/*.json`，已被 `prompt/**` 扫描天然覆盖）。

## 6. 服务端接口（`server/src/routes/blueprints.ts`）

| 端点 | 说明 |
|---|---|
| `GET /api/blueprints?scope=global\|project&project=` | 蓝图摘要列表（按更新时间倒序） |
| `GET /api/blueprints/:id?scope=&project=` | 蓝图详情（含 `rev`） |
| `POST /api/blueprints` | 创建（`scope`/`project`/`name`/`description`/`assetProject`/`payload`/`overwrite`） |
| `PUT /api/blueprints/:id?scope=&project=` | 局部更新（`name`/`description`/`assetProject`/`nodes`/`connections`/`groups`）+ CAS `expectedRev`（`force: true` 跳过比对） |
| `DELETE /api/blueprints/:id?scope=&project=` | 删除 |
| `POST /api/blueprints/import` | 导入（`data` 为蓝图文件内容；服务端生成新 id，`overwrite` 覆盖同名） |

错误语义：`INVALID` 400 / `NOT_FOUND` 404 / `EXISTS` 409（携带 `existingId`）/ `VERSION_CONFLICT` 409（携带 `currentRev`、`expectedRev`）。
存储实现见 `server/src/blueprints/store.ts`：一蓝图一文件（文件名为 uuid，名称存文件内）、原子写（tmp + rename）、路径越界与 id 格式校验、同作用域名称唯一、节点数上限 2000。

## 7. 已知边界

- 蓝图**不复制产物文件**：插入后生成类节点需要重新生成；加载节点的资产引用指向原项目路径（跨项目可能失效，按「原样保留、不检查」策略，插入对话框给出非阻塞提示）；
- v1 **不支持蓝图嵌套**（蓝图编辑器内无「插入蓝图」入口）；
- 分组「成员关系」仍由几何重叠实时派生：插入的独立分组与蓝图内原有分组可能同时覆盖同一节点（多重归属是既有模型语义）；
- 全局蓝图的资产引用仅在其 `assetProject` 内可预览/解析；项目被删除后该字段需重新选择。
