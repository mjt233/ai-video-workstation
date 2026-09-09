# 资产画布「节点分组」（持久分组框）需求与实现方案

> 文档类型：需求与实现方案（含完整沟通记录） · 状态：**已实施并通过验收（2026-09-09）**
> 关联文档：[`../canvas/interactions.md`](../canvas/interactions.md)（已更新）、[`../canvas/data-model.md`](../canvas/data-model.md)（已更新）、[`../canvas/module-structure.md`](../canvas/module-structure.md)（已更新）、[`../canvas/development.md`](../canvas/development.md)（已补常见坑）

---

## 1. 主题与概要

### 1.1 一句话

在资产画布（分镜 / 场景详情页「资产画布」Tab）中，为**多选节点**增加「**创建分组**」能力：生成一个**主题色半透明圆角矩形**的持久分组框（顶部标题条可改名 / 改色、可任意缩放、可拖动），**节点的分组归属由「节点矩形与分组矩形是否存在重叠」实时派生**，拖动分组框时组内节点跟随移动，分组定义随 `canvas.json` 持久化。

### 1.2 交付物

| # | 交付物 | 说明 |
|---|--------|------|
| D1 | 多选悬浮工具栏 | 多选（≥2）时在多选框顶部居中悬浮，含「创建分组」 |
| D2 | 持久分组数据模型 | `canvas.json` 新增 `groups[]`，schema → v2，旧文件兼容 |
| D3 | 分组框渲染组件 | 标题条 + 半透明圆角矩形 + 四边拖动条 + `NodeResizer` 缩放控制点 |
| D4 | 分组交互组合式 | 创建 / 拖动（含嵌套级联）/ 缩放 / 重命名 / 改色 / 解散 / 选中 |
| D5 | 与多选体系融合 | 完全框选可选中分组；复制 / 粘贴 / 删除 / 拖动均作用于「选中节点 + 选中分组」 |
| D6 | 文档与测试 | 更新 `docs/canvas/{data-model,interactions,module-structure}.md`，新增纯逻辑单测 |

### 1.3 现状与缺口

| 现状 | 说明 | 缺口 |
|------|------|------|
| 多选群组虚线框 | Ctrl 框选 ≥2 节点时由**合成节点** `__group-frame`（z-index -1）渲染虚线框 + `__group-dot` 输出圆点，仅用于「整组拖动 / 复制 / 删除 / 成组连接」 | **临时态**，不入 `canvas.json`；节点位置变化即消失；无标题 / 颜色 / 尺寸 / 持久化 |
| 节点卡片 | 支持 `NodeResizer` 缩放（`CanvasNodeCard.vue`）、双击内联重命名 | 无「容器」概念 |
| `canvas.json` | `{ version, kind, nodes, connections, createdAt, updatedAt }` + 服务端注入 `rev` | 无分组字段 |

**核心差异**：既有虚线框是「一次多选操作的视觉反馈」，本次要做的是「**可持久化的可视化容器**」，二者并存、互不替代。

---

## 2. 沟通记录

### 2.1 需求演化（轮次）

| 轮次 | 用户诉求 | 结果 |
|------|----------|------|
| 第 1 轮 | 原始需求：Ctrl+左键框选多节点 → 多选框顶部悬浮工具栏 → 创建分组 → 主题色半透明圆角矩形 + 顶部标题（可改颜色与标题、可任意调整大小）→ 分组框可拖拽、拖动时组内节点跟随 → **节点位置与分组框重叠即视为组内** | 提出 6 项交互歧义并澄清（见 §2.2），形成初版方案 |
| 第 2 轮 | 追问：**Ctrl+拖拽同时命中分组框与节点时如何处理** | 核对 Vue Flow 源码（见 §5），给出三条候选规则；用户决策：**完全框选分组框时把分组也选中，复制 / 删除要连同分组框一起** |
| 第 3 轮 | 追问：**分组重叠 / 嵌套时，拖动分组节点怎么移动** | 推演 R1 / R2 / R3 三种规则在嵌套与部分重叠下的结果；用户选择 **R2** |

### 2.2 第 1 轮澄清（6 项交互决策）

> 提问方式：每项给出 1 个推荐 + 2 个备选。下表「决策」列为用户最终选择。

| # | 歧义点 | 备选方案 | 决策 |
|---|--------|----------|------|
| Q1 | 分组框的拖动抓取方式（影响组内空白能否继续框选） | ① 标题栏 + 边框拖动，框内空白穿透；② 整框可拖动 + Ctrl 穿透为框选；③ 整框可拖动、不支持穿透 | **① 标题栏 + 边框拖动，框内空白穿透** |
| Q2 | 调整分组框大小时组内节点如何处理 | ① 节点不跟随；② 拖左上角时整体平移；③ 按比例缩放 | **① 节点不跟随**（缩到不重叠即自动脱离） |
| Q3 | 悬浮工具栏包含哪些操作 | ① 仅「创建分组」；② + 复制 + 删除；③ + 复制 + 删除 + 成组连接 | **① 仅「创建分组」** |
| Q4 | 标题编辑与主题色选择方式 | ① 双击标题内联编辑 + 预设色板；② 双击内联编辑 + 自由取色器；③ 右键对话框重命名 + 预设色板 | **① 双击标题内联编辑 + 预设色板** |
| Q5 | 删除分组的语义 | ① 仅「解散分组」（删框、节点保留）；② 解散 + 删除节点两项；③ 仅删除分组及节点 | **① 仅「解散分组」** |
| Q6 | 与既有「多选虚线框 + 输出圆点」的关系 | ① 两者都保留，分组是独立持久实体；② 选中集全在分组内时隐藏虚线框；③ 用分组框取代虚线框 | **① 两者都保留** |

### 2.3 第 2 轮：混合框选语义

**用户补充要求（原话）**：

> 考虑 Ctrl 框选时如果完全框选了分组框，则需要把分组框也选中，复制、删除时需要连同分组框也一起复制和删除

**由此推导出的规则（已确认）**：

1. 框选矩形与分组框**仅相交**（未完全包含）→ 分组框**忽略**，只按 Vue Flow 的 `Partial` 模式选中真实节点。
2. 框选矩形**完全包含**分组矩形 → 该分组进入选中集。
3. **重要推论（无需额外代码）**：完全包含分组时，分组内的全部成员节点**必然同时被选中**——成员节点与分组矩形重叠，分组矩形 ⊆ 框选矩形 ⇒ 节点必与框选矩形相交 ⇒ `Partial` 模式选中。因此「复制 / 删除 / 拖动带上分组」时，成员天然一起走。
4. 判定时机：`@selection-end`（需要自己从 `@selection-start` / `@selection-end` 的指针事件算出选框矩形，理由见 §5）。

### 2.4 第 3 轮：重叠 / 嵌套时的拖动规则

**场景**（嵌套）：

```
┌─────────────────── 分组 A（大框）───────────────────┐
│  n2                                              │
│      ┌─── 分组 B（完全落在 A 内）───┐              │
│      │  n1                        │              │
│      └────────────────────────────┘              │
└──────────────────────────────────────────────────┘
                                          n3（A、B 之外）
```

| 规则 | 拖动 A 时 | 拖动 B 时 | 部分重叠时 | 决策 |
|------|-----------|-----------|------------|------|
| R1 只带「与 A 重叠的节点」 | B 的框不动 → **B 被掏空**（空框留在原地） | 正常 | 重叠区节点被 A 带走 | ✗ 否决 |
| **R2 带「与 A 重叠的节点 + 被 A 完全包含的分组」（递归收敛）** | A、B 框与 n1、n2 一起平移 → **无损**，B 完整跟随 | 只移动 B + n1，A 不动 | 重叠区节点跟随被拖分组离开另一分组（几何必然） | **✓ 采用** |
| R3 重叠分组连通分量整体平移 | 无损 | **拖小框 B 会把大框 A 一起拖走** | A、B 整体平移，节点全跟 | ✗ 否决 |

**R2 的可证明性质**：若 B ⊆ A，则 B 的任意成员节点必与 A 重叠（因为与 B 重叠且 B ⊆ A）⇒ B 的节点必在 A 的跟随集内 ⇒ 去重后每个节点只平移一次 ⇒ **嵌套结构在拖动中保持完整**。

### 2.5 最终决策汇总

| 类别 | 决策 |
|------|------|
| 创建入口 | Ctrl 框选 ≥2 节点 → 多选框顶部居中工具栏 →「创建分组」 |
| 分组外观 | 主题色半透明圆角矩形 + 顶部标题条（标题 / 颜色可改） |
| 拖动抓取 | 标题条 + 四边 8px 拖动条；框内空白穿透；按住 Ctrl 时标题条与边框也穿透 |
| 拖动带动 | **R2**：重叠节点 + 被完全包含的子分组（递归、节点去重） |
| 缩放 | `NodeResizer` 八向控制点；组内节点**不跟随** |
| 标题 / 颜色 | 双击内联编辑（回车 / 失焦提交，Esc 取消，空名放弃）+ 8 色预设色板 |
| 删除 | 右键 / Delete →「解散分组」仅删框、节点保留（`confirm` 确认） |
| 成员判定 | 矩形**重叠（面积 > 0，相切不算）**即成员，实时派生、**不落盘成员列表** |
| 与虚线框关系 | 共存，虚线框 + 输出圆点（成组连接）行为不变 |
| 混合框选 | 完全包含才选中分组（容差 2px） |
| 复制 / 删除 / 拖动 | 作用于「选中节点 ∪ 选中分组」 |

---

## 3. 功能需求（FR）

### FR-1 创建分组

| ID | 需求 | 验收点 |
|----|------|--------|
| FR-1.1 | 应用级多选（选中节点数 + 选中分组数 ≥ 2）时，在多选框顶部**居中悬浮**工具栏 | 框选 2 个以上节点后工具栏出现；顶部空间不足时翻转到多选框下方 |
| FR-1.2 | 工具栏含「创建分组」按钮 | 按钮可见、可点击；`nodrag`，点击不触发画布 pan / 框选 / pane-click |
| FR-1.3 | 点击后创建分组：初始矩形 = 选中节点包围盒 + `GROUP_FRAME_PADDING`（12px） | 矩形恰好包裹选中节点并留 12px 空白 |
| FR-1.4 | 默认标题 `分组 N`（N = 最小未占用编号）、默认颜色 = 色板首色（蓝 `#1976D2`） | 连续创建得到 `分组 1`、`分组 2` |
| FR-1.5 | 创建后**保持多选**，snackbar 提示「已创建分组「分组 1」（含 N 个节点）」 | 提示文案与数量正确 |
| FR-1.6 | 创建是**单次撤销**操作 | Ctrl+Z 一次即完全移除该分组 |

### FR-2 分组外观

| ID | 需求 |
|----|------|
| FR-2.1 | 圆角矩形（`border-radius: 8px`），主体填充 = 主题色 8% alpha，边框 = 2px 主题色 70% alpha |
| FR-2.2 | 顶部标题条（高 28px）：背景 = 主题色 90% alpha，文字白色，左对齐标题，右侧色点按钮 |
| FR-2.3 | 分组框绘制在**节点与连线之下**（z-index 低于真实节点与既有虚线框） |
| FR-2.4 | 分组内无任何节点时，标题条显示「空」标记且整体降低不透明度（提示已被拖空，**不自动删除**） |
| FR-2.5 | 分组被选中时显示主色描边高亮（与节点选中态视觉区分） |

### FR-3 拖动分组框

| ID | 需求 | 验收点 |
|----|------|--------|
| FR-3.1 | 拖动标题条可移动分组 | 光标 `move`，拖动跟手（无延迟、无抖动） |
| FR-3.2 | 拖动四边 8px 边框条可移动分组 | 同上 |
| FR-3.3 | 框内空白区域**不拦截**指针事件 | 组内 Ctrl+拖拽仍能框选；双击空白仍弹出「添加节点」菜单 |
| FR-3.4 | 拖动时**与分组矩形重叠的节点**跟随移动，相对位置不变 | 拖动前后节点与分组框相对位置完全一致 |
| FR-3.5 | 拖动时**被该分组完全包含的其他分组框**（递归）及其节点跟随移动（R2） | 嵌套场景下子分组保持完整，不出现空框 |
| FR-3.6 | 拖动内层分组**不带动外层分组** | 外层框与外层独有节点不动 |
| FR-3.7 | 拖动是**单次撤销**（分组框 + 全部跟随节点） | Ctrl+Z 一次全部复位 |
| FR-3.8 | 拖动分组**不读取也不修改节点选中态** | 拖动前后多选状态、虚线框、配置面板可见性均不变 |
| FR-3.9 | 位移小于 4px 视为「点击」→ 选中该分组（不移动） | 单击标题条选中分组；双击进入重命名 |
| FR-3.10 | 按住 Ctrl 在标题条 / 边框上拖动 = 框选（穿透） | 「Ctrl+拖拽 = 框选」零例外 |

### FR-4 调整分组框大小

| ID | 需求 | 验收点 |
|----|------|--------|
| FR-4.1 | 分组被选中或悬浮标题条 / 边框时显示 8 个缩放控制点 | 控制点可拖拽 |
| FR-4.2 | 缩放过程中控制点保持可见（不因拖出边界消失） | 拖出分组范围继续缩放不断裂 |
| FR-4.3 | 最小尺寸 160 × 100 | 无法缩得更小 |
| FR-4.4 | 缩放**不移动、不缩放组内节点** | 节点坐标与尺寸不变 |
| FR-4.5 | 缩到与某节点不再重叠时，该节点自动脱离分组（成员派生） | 成员数量实时变化 |
| FR-4.6 | 缩放结束才回写 store，单次撤销 | 缩放中不产生多条撤销记录 |

### FR-5 标题与颜色

| ID | 需求 | 验收点 |
|----|------|--------|
| FR-5.1 | 双击标题进入内联编辑（输入框带 `nodrag nowheel`） | 回车 / 失焦提交，Esc 取消，空名放弃修改 |
| FR-5.2 | 标题条右侧色点按钮打开 8 色预设色板 | 色板含蓝 / 青 / 绿 / 橙 / 紫 / 红 / 灰 / 棕 |
| FR-5.3 | 选色后标题条、填充、边框同步变色 | 三处颜色一致（同一 CSS 变量驱动） |
| FR-5.4 | 重命名、改色各为单次撤销 | Ctrl+Z 分别回退 |

### FR-6 成员判定

| ID | 需求 |
|----|------|
| FR-6.1 | 节点矩形与分组矩形**重叠面积 > 0** 即视为组内成员（相切不算） |
| FR-6.2 | 拖动节点进入分组矩形 → 自动加入；拖出 → 自动脱离（无需任何显式操作） |
| FR-6.3 | 一个节点可**同时属于多个重叠分组** |
| FR-6.4 | 成员关系**不落盘**（`canvas.json` 中分组无 `nodeIds` 字段），每次由几何派生 |

### FR-7 框选与选中

| ID | 需求 | 验收点 |
|----|------|--------|
| FR-7.1 | 框选矩形与分组**仅相交** → 分组不选中 | 分组无高亮 |
| FR-7.2 | 框选矩形**完全包含**分组矩形（容差 2px）→ 分组选中 | 分组显示选中描边 |
| FR-7.3 | 完全框选时其成员节点必然同时被选中 | 成员节点显示选中边框 |
| FR-7.4 | 多选虚线框包围盒 = 选中节点包围盒 ∪ 选中分组矩形（+12px 留白） | 分组框不跑出虚线框 |
| FR-7.5 | 单击分组标题条 = 单选该分组（清空节点选中）；Ctrl+单击 = 增 / 减选 | 与节点选中语义一致 |
| FR-7.6 | 单击节点 / 空白清除分组选中 | — |
| FR-7.7 | 选中集含分组时，「创建分组」按钮置灰并提示「选中集已包含分组」 | 无法创建嵌套新分组（避免框套框） |

### FR-8 复制 / 粘贴

| ID | 需求 | 验收点 |
|----|------|--------|
| FR-8.1 | Ctrl+C 复制「选中节点 + 选中分组框」（含组内连线） | 内部剪贴板 + 系统剪贴板标记均含 `groups` |
| FR-8.2 | Ctrl+V 粘贴：分组换新 id、整体偏移 30px；成员关系按重叠自动成立 | 粘贴出的分组恰好"装住"粘贴出的节点 |
| FR-8.3 | 支持跨画布 / 刷新后粘贴（系统剪贴板标记） | 切换到另一张画布可粘贴出分组 |
| FR-8.4 | Ctrl+D 复制粘贴整组（含分组） | 同上 |
| FR-8.5 | 粘贴为单次撤销；新粘贴的节点自动聚焦（分组不聚焦） | Ctrl+Z 一次整体回退 |

### FR-9 删除

| ID | 需求 | 验收点 |
|----|------|--------|
| FR-9.1 | Delete / Backspace 删除「选中节点 + 选中分组框」，**一次** `confirm` 确认 | 文案：`确定删除选中的 N 个节点和 M 个分组？` |
| FR-9.2 | 仅分组被选中时 Delete = 解散分组（**只删框，节点保留**） | 文案：`确定解散分组「分组 1」？` |
| FR-9.3 | 右键分组 → 菜单含「重命名 / 更改颜色 / 解散分组」，解散需确认 | 菜单可操作 |
| FR-9.4 | 删除为单次撤销 | Ctrl+Z 一次恢复 |

### FR-10 持久化

| ID | 需求 | 验收点 |
|----|------|--------|
| FR-10.1 | 分组定义写入 `canvas.json` 的 `groups[]` | 文件内容包含 `groups` |
| FR-10.2 | 刷新页面 / 切换分镜再切回，分组位置、尺寸、标题、颜色完整恢复 | 视觉与数据一致 |
| FR-10.3 | 旧 `canvas.json`（无 `groups`）可正常加载 | 不报错，`groups` 为空数组 |
| FR-10.4 | `version` 升为 2，`migrateCanvasData` 负责补默认值 | 单测覆盖 |

---

## 4. 数据模型与兼容性

### 4.1 新增类型（`frontend/src/canvas/types.ts`）

```ts
/** 持久分组（可视化容器，成员由几何重叠实时派生，不落盘成员列表） */
export interface CanvasGroupData {
  /** 分组 id（newId() 生成） */
  id: string
  /** 标题（双击标题条可改） */
  name: string
  /** 主题色 hex（预设色板取值，如 #1976D2） */
  color: string
  /** 分组矩形左上角 x（流坐标） */
  x: number
  /** 分组矩形左上角 y（流坐标） */
  y: number
  /** 分组矩形宽度（流坐标像素） */
  width: number
  /** 分组矩形高度（流坐标像素） */
  height: number
}
```

`CanvasData` 新增字段：

```ts
export interface CanvasData {
  version: number
  kind: CanvasKind
  nodes: CanvasNodeData[]
  connections: CanvasConnection[]
  /** 持久分组列表（可选：旧文件无此字段，迁移时补空数组） */
  groups: CanvasGroupData[]
  createdAt: string
  updatedAt: string
}
```

### 4.2 迁移与版本

- `CANVAS_SCHEMA_VERSION`：`1` → **`2`**。
- `migrateCanvasData`：`groups: Array.isArray(obj.groups) ? obj.groups : []`（对每个元素做最小结构校验，非法项丢弃并 `console.warn`，不抛错）。
- `createCanvasData` 返回 `groups: []`。

### 4.3 服务端：**零改动**（已核实）

| 关注点 | 事实 | 结论 |
|--------|------|------|
| CAS 保存 `PUT /api/canvas/def` | `server/src/assets/canvas-def.ts: saveCanvasDef` 仅校验 `data` 是对象、`data.kind` 与目标一致，随后 `{ ...dataObj, rev, updatedAt }` 落盘 | `groups` 作为未知字段原样透传，**无需改服务端** |
| 分镜重编号 / 移动 | `shot-renumber.ts` / `shot-move.ts` 只改写路径引用并 `bumpCanvasRevInJsonText` | 分组不含路径，不受影响 |
| 存储清理 | `assets/cleanup.ts` 扫描 `config.assetPath` 等字段 | 分组无资产引用，不受影响 |
| 自动搭画布 | `autobuild.ts` 只处理 `nodes` / `connections` | 不涉及分组 |

---

## 5. 技术前提（Vue Flow 约束 —— 必须遵守，否则功能不成立）

> 以下均已在 `frontend/node_modules/@vue-flow/core@1.48.2/dist/vue-flow-core.mjs` 与 `dist/style.css` 中核实。

| # | 事实（源码依据） | 对本功能的影响 |
|---|------------------|----------------|
| T1 | 框选实现调用 `getNodesInside(nodes, rect, viewport, mode === Partial, /* excludeNonSelectableNodes */ true)`，内部 `if (excludeNonSelectableNodes && !selectable) continue` | `selectable: false` 的分组节点**永远进不了 Vue Flow 内部选中集** → 「完全框选选中分组」必须由我们**在 `selection-end` 自行判定**，不能依赖库 |
| T2 | 框选启动条件：`Pane.onPointerDown` 首行 `if (... \|\| event.target !== container.value \|\| ...) return`（`container` = `.vue-flow__pane`） | 指针按下必须**命中 pane 本身**；任何子元素（含分组节点）拦截都会让框选失效 |
| T3 | `.vue-flow__nodes { pointer-events: none }`、`.vue-flow__node { pointer-events: all }` | **分组节点的 wrapper（`.vue-flow__node`）必须显式 `pointer-events: none`**，仅标题条 / 边框条子元素 `auto`；否则框内空白处命中落在 wrapper 上（`target !== pane`），**组内框选完全失效** |
| T4 | `node.class` 支持 `string \| ((node) => string)`，wrapper 附加 `vue-flow__node-${type}` 类 | 用函数式 `class` 按「Ctrl 是否按下」挂 `canvas-group-node--passthrough` 类，实现 Ctrl 穿透 |
| T5 | `selectionStart(event)` / `selectionEnd(event)` 均抛**原生指针事件**；且 `userSelectionRect.value = null` 在 `emits.selectionEnd(event)` **之前**执行 | 必须在 `@selection-start` 记录屏幕起点、`@selection-end` 记录终点，再用 `screenToFlowCoordinate` 换算成流坐标矩形；**不能**在 `selection-end` 里读 `userSelectionRect`（已为 null） |
| T6 | 原生节点拖动会**同时移动全部选中节点**（基于 `selectedNodeIds`） | 若分组节点用原生拖动，而此刻有节点被选中 → 「节点被移动两次」。**结论：分组节点 `draggable: false`，用自定义拖动**（同时天然满足 FR-3.8） |
| T7 | 轮询期间画布整体重渲染会重建插槽函数引用，导致连线 / 节点动画重置（见 `docs/canvas/development.md` 常见坑） | 分组节点列表必须**只依赖 store 数据**（不得依赖 `statusByNode` 等高频状态），保持 `computed` 缓存命中 |

---

## 6. 实现方案

### 6.1 模块总览

```
新增
├── frontend/src/canvas/groups.ts                      # 纯逻辑（无 Vue 依赖，可单测）
├── frontend/src/canvas/groups.test.ts                 # 单测
├── frontend/src/components/canvas/CanvasGroupNode.vue # 分组框渲染（标题条/填充/拖动条/缩放点）
├── frontend/src/components/canvas/CanvasSelectionToolbar.vue  # 多选悬浮工具栏
└── frontend/src/components/canvas/composables/useCanvasGroups.ts  # 分组交互组合式

修改
├── frontend/src/canvas/types.ts                 # CanvasGroupData + CanvasData.groups + schema v2
├── frontend/src/canvas/useCanvasStore.ts        # 分组 CRUD / 复制粘贴 / 删除
├── frontend/src/canvas/useCanvasStore.test.ts   # 补用例
├── frontend/src/canvas/nodeClipboard.ts         # 剪贴板载荷增 groups
├── frontend/src/canvas/nodeClipboard.test.ts    # 补用例
├── frontend/src/components/canvas/composables/useCanvasFlow.ts    # 分组节点渲染 + 拖动视图偏移
├── frontend/src/components/canvas/composables/useCanvasSelection.ts # selectedGroupIds + 删除
├── frontend/src/components/canvas/composables/useCanvasMenus.ts   # 分组实体右键菜单
├── frontend/src/components/canvas/composables/useCanvasKeyboard.ts# Delete 覆盖分组
├── frontend/src/components/canvas/composables/useCanvasPaste.ts   # 粘贴返回值适配
├── frontend/src/components/canvas/CanvasContextMenu.vue          # 分组实体菜单块
└── frontend/src/components/canvas/AssetCanvas.vue                # 接线 + 关键 :deep 样式
```

### 6.2 纯逻辑：`frontend/src/canvas/groups.ts`

| 导出 | 签名 / 说明 |
|------|-------------|
| `GROUP_PALETTE` | 8 色预设：蓝 `#1976D2` / 青 `#0097A7` / 绿 `#2E7D32` / 橙 `#EF6C00` / 紫 `#7B1FA2` / 红 `#C62828` / 灰 `#546E7A` / 棕 `#6D4C41` |
| `GROUP_MIN_SIZE` | `{ width: 160, height: 100 }` |
| `GROUP_CONTAIN_TOLERANCE` | `2`（完全包含判定容差，流坐标） |
| `GROUP_DRAG_MIN_PX` | `4`（区分「点击标题条」与「拖动」） |
| `hexToRgba(hex, alpha)` | 返回 `rgba(r, g, b, a)`；非法 hex 回退黑色 |
| `rectsOverlap(a, b)` | 矩形重叠（面积 > 0；相切返回 false） |
| `rectContains(outer, inner, tolerance?)` | `outer` 是否完全包含 `inner` |
| `nodesInGroup(group, nodes)` | 与分组重叠的节点列表 |
| `groupsOfNode(groups, node)` | 该节点所属的全部分组 |
| `collectDragFollowSet(groups, nodes, rootGroupId)` | **R2 跟随集**：`{ groupIds: string[]; nodeIds: string[] }`——递归收集被完全包含的子分组，再收集与任一框重叠的节点（去重） |
| `groupRectFromNodes(nodes, padding)` | 创建分组时的初始矩形 |
| `defaultGroupName(groups)` | `分组 N`（最小未占用编号） |

**`collectDragFollowSet` 算法**：

```
S = { rootGroupId }
loop:
  for each g in groups:
    if g.id ∉ S and ∃ s ∈ S 使 rectContains(s, g):
      S ← S ∪ { g.id }
until S 不再增长
N = { node.id | node ∈ nodes 且 ∃ s ∈ S 使 rectsOverlap(s, node) }
return { groupIds: [...S], nodeIds: [...N] }
```

### 6.3 store 扩展（`useCanvasStore.ts`）

| API | 说明 |
|-----|------|
| `groups` | `computed(() => data.value.groups)` |
| `addGroup(rect, opts?: { name?, color? })` | `pushHistory()` + push + `markDirty()`，返回新分组 |
| `updateGroup(id, patch)` | 单次撤销（标题 / 颜色 / 几何） |
| `updateGroups(patches: { id, x, y }[])` | 批量平移（分组拖动 / 多选拖动），**单次撤销** |
| `removeGroups(ids)` | 解散分组（仅删框），单次撤销 |
| `removeNodes(nodeIds, groupIds = [])` | 扩展：一次快照删除节点与分组（Delete 混合选中） |
| `copyNodes(nodeIds, groupIds = [])` | 扩展：内部剪贴板 + 系统剪贴板都含 `groups`；两者皆空时忽略 |
| `pasteNodes(source?)` | **返回值改为 `{ nodes, groups }`**；分组换新 id + 偏移 `PASTE_OFFSET`，单次撤销 |
| `canPaste` | `nodes.length > 0 \|\| groups.length > 0` |

> 撤销 / 重做天然覆盖分组：快照是整份 `CanvasData` 的深拷贝（`pushHistory`）。

### 6.4 剪贴板扩展（`nodeClipboard.ts`）

- `NodeClipboardPayload` 增 `groups: CanvasGroupData[]`。
- `serializeNodeClipboard(nodes, connections, groups = [])` → `__AVW_NODE_COPY_MULTI_V1__{nodes,connections,groups}`。
- `parseNodeClipboardText`：`groups` 为**可选**字段（旧标记无该字段 → `[]`），逐项 `asGroup` 最小结构校验（`id/name/color/x/y/width/height` 类型检查），非法项丢弃。
- 前缀**不升级**（向后兼容：旧版本解析器忽略 `groups` 字段仍能粘贴节点）。

### 6.5 渲染层（`useCanvasFlow.ts`）

1. 新增 `flowGroupNodeList` computed（只依赖 `store.groups` 与 `ctrlHeld`）：

```ts
{
  id: group.id,
  type: 'canvas-group',
  position: { x, y },
  width, height,
  draggable: false,        // 自定义拖动（见 T6）
  selectable: false,       // 不进入 Vue Flow 选中集（见 T1）
  connectable: false,
  focusable: false,
  zIndex: -2,              // 低于既有虚线框 -1，低于真实节点
  class: () => (ctrlHeld.value ? 'canvas-group-node--passthrough' : ''),
}
```

2. 合并顺序：`flowNodes = [...flowGroupNodeList, ...flowNodeList, ...syntheticNodeList]`。
3. **拖动视图偏移**：`dragOffset`（`{ kind: 'group' | 'multi', groupIds: Set<string>, nodeIds: Set<string>, dx, dy } | null`）叠加到分组框与跟随节点的渲染坐标；`mouseup` / `node-drag-stop` 一次性回写 store。拖动中**不写 store**（避免逐帧 `markDirty` 与撤销快照污染）。
4. 多选拖动跟随：新增 `@node-drag` 处理，按被拖节点位置差算出 `dx/dy`，把**选中分组框**（`selectedGroupIds`）加入偏移集；`onNodeDragStop` 里 `updateNodes(...)` + `updateGroups(...)`。
5. 多选虚线框包围盒：`useCanvasGroup.groupRect` 的输入改为「选中节点 ∪ 选中分组矩形」（FR-7.4）。
6. **不要修改** `watch(flowNodeList, ...)` 的既有静默回写逻辑，也不要让分组节点进入 `flowNodeList`。

### 6.6 `CanvasGroupNode.vue`（关键 CSS）

```html
<div class="canvas-group" :class="{ 'canvas-group--selected': selected, 'canvas-group--empty': isEmpty }">
  <div class="canvas-group__body" />                     <!-- pointer-events: none -->
  <div class="canvas-group__edge canvas-group__edge--t" /> <!-- 四条 8px 拖动条，pointer-events: auto -->
  <div class="canvas-group__edge canvas-group__edge--b" />
  <div class="canvas-group__edge canvas-group__edge--l" />
  <div class="canvas-group__edge canvas-group__edge--r" />
  <div class="canvas-group__title">                        <!-- pointer-events: auto -->
    <span class="canvas-group__name" @dblclick.stop="emit('start-rename', group.id)">{{ group.name }}</span>
    <span v-if="isEmpty" class="canvas-group__empty-badge">空</span>
    <button class="canvas-group__color nodrag" @click.stop="emit('open-color')" />
  </div>
  <!-- 与 CanvasNodeCard 既有用法一致（:node-id / :is-visible / min 尺寸 / color / resize-end 回写） -->
  <NodeResizer
    :node-id="group.id"
    :is-visible="selected || hovering || resizing"
    :min-width="GROUP_MIN_SIZE.width"
    :min-height="GROUP_MIN_SIZE.height"
    color="#1976d2"
    @resize-start="resizing = true"
    @resize-end="onResizeEnd"
  />
</div>
```

**`AssetCanvas.vue` 中的必需样式**（否则功能不成立，见 T2 / T3）：

```css
:deep(.vue-flow__node-canvas-group) { pointer-events: none; }          /* 关键：让框内空白穿透到 pane */
:deep(.canvas-group__title),
:deep(.canvas-group__edge) { pointer-events: auto; }
:deep(.vue-flow__resize-control) { pointer-events: auto; }              /* NodeResizer 在 none 容器内仍需可拖 */
:deep(.canvas-group-node--passthrough) { pointer-events: none !important; }
:deep(.canvas-group-node--passthrough *) { pointer-events: none !important; }
```

主题色经 CSS 变量单一来源：`--canvas-group-color`（`hexToRgba` 计算三档透明度）。

### 6.7 `CanvasSelectionToolbar.vue`

- 定位：`groupRect`（流坐标）→ 屏幕坐标（`viewport` 换算）→ 顶部居中，距上边缘 8px；若顶部空间不足则翻转到多选框下方。
- 内容：`创建分组` 按钮（`mdi-folder-plus-outline`）；`hasGroupSelected` 时 `disabled` + tooltip「选中集已包含分组」。
- 容器加 `nodrag`，`@mousedown.stop` 防止拖动穿透到 pane。

### 6.8 `useCanvasGroups.ts`（分组交互组合式）

| 职责 | 实现要点 |
|------|----------|
| 选框矩形捕获 | `@selection-start` 记 `screenStart`；`@selection-end` 用两端点 `screenToFlowCoordinate` 算流坐标矩形 |
| 完全包含判定 | `rectContains(marquee, group, GROUP_CONTAIN_TOLERANCE)` → 写入 `selection.setSelectedGroups(...)` |
| 分组自定义拖动 | 标题条 / 边框 `mousedown` → 记录起点与 `collectDragFollowSet` 快照 → window `mousemove`（更新 `dragOffset`）/ `mouseup`（`updateGroups` + `updateNodes` 单次撤销）；`Ctrl` 按下时直接返回不启动 |
| 点击 / 双击区分 | `mouseup` 位移 < `GROUP_DRAG_MIN_PX` → 视为点击（选中该分组）；双击由标题条 `dblclick` 单独处理 |
| 合成 click 抑制 | 拖动结束后的合成 click 会命中 pane 触发 `pane-click` 清空选中 → 复用 `useCanvasGroup` 的「捕获阶段一次性 click 拦截器」手法 |
| 缩放 | `NodeResizer` 的 `resize-end` → `updateGroup(id, { x, y, width, height })` |
| 重命名 | `renamingGroupId` + `groupRenameInput`；回车 / 失焦提交，Esc 取消，空名放弃 |
| 改色 | `colorMenu`（`v-menu` 锚点 + 8 色板）→ `updateGroup(id, { color })` |
| 解散 | `confirm({ title: '解散分组', content: '确定解散分组「X」？组内节点将保留。', confirmText: '解散', confirmColor: 'error' })` → `removeGroups([id])` |
| Ctrl 键状态 | window `keydown` / `keyup` / `blur` 维护 `ctrlHeld` ref（供 T4 的穿透类） |
| 重置 | 切换画布目标 / 组件卸载时清理监听、菜单、重命名状态、`dragOffset` |

### 6.9 选中 / 键盘 / 菜单 / 粘贴

- `useCanvasSelection.ts`
  - 新增 `selectedGroupIds: ref<string[]>`、`setSelectedGroups`、`toggleSelectGroup`、`clearGroupSelection`。
  - `onNodeClick` 清空分组选中；`onPaneClick` 清空两者；`reset` 清空两者。
  - `deleteSelected()` 统计两类并合并一次 `confirm`（文案见 FR-9.1 / FR-9.2），调用 `store.removeNodes(nodeIds, groupIds)`。
  - `hasMultiSelection` = `selectedNodeIds.length + selectedGroupIds.length >= 2`（驱动虚线框与工具栏）。
- `useCanvasKeyboard.ts`：Delete 分支沿用 `deleteSelected()`（已含分组）；Esc 追加关闭分组色板 / 取消分组重命名。
- `useCanvasMenus.ts`：新增 `groupEntityMenu`（与既有 `groupMenu`（多选虚线框菜单）**命名区分**），动作：重命名 / 更改颜色 / 解散分组。
- `useCanvasPaste.ts`：适配 `pasteNodes()` 新返回值；`pasteNodeAndFocus` 在「nodes 与 groups 均为空」时才 return；`duplicateSelected` 同样传递分组。

### 6.10 `AssetCanvas.vue` 接线

- `<VueFlow>` 新增 `@selection-start`、`@node-drag` 绑定。
- 新增 `#node-canvas-group` 插槽 → `CanvasGroupNode`。
- 新增 `<CanvasSelectionToolbar>`、分组色板菜单。
- `CanvasContextMenu` 传入 `group-entity-menu`。
- 新增 6.6 节的 `:deep` 样式。
- `onSelectionEnd`：先 `selection.syncFromVueFlow(...)`，再 `groups.applyFullyContainedGroups(marqueeRect)`。

---

## 7. 交互规则总表（含边界）

| 场景 | 行为 |
|------|------|
| Ctrl+拖拽框选，矩形与分组**仅相交** | 分组被忽略；只选中相交的真实节点 |
| Ctrl+拖拽框选，矩形**完全包含**分组 | 分组进入选中集；其成员节点必然同时被选中 |
| 矩形只压住分组框、未压到节点 | 什么都不选中 |
| 从分组内部空白处 Ctrl+拖拽 | 正常框选（body 穿透到 pane） |
| 按住 Ctrl 在标题条 / 边框上拖拽 | 也穿透为框选 |
| 拖动多选（节点已选中） | 节点原生移动 + 选中分组框同 delta 跟随，单次撤销 |
| 拖动分组标题条 / 边框 | R2 跟随集移动；不影响节点选中态；单次撤销 |
| 拖动内层分组 | 只动内层 + 其节点，外层不动 |
| 部分重叠分组 | 重叠区节点跟随被拖分组离开另一分组（几何必然） |
| 拖动节点进出分组 | 自动加入 / 脱离（成员派生） |
| 单击标题条 / Ctrl+单击 | 单选 / 增选分组 |
| 单击节点、空白 | 清空分组选中 |
| 双击标题条 | 内联重命名 |
| 右键分组框 | 重命名 / 更改颜色 / 解散分组 |
| Delete（仅分组选中） | 解散分组（只删框） |
| Delete（节点 + 分组混合选中） | 删除选中节点 + 分组框，一次确认 |
| Ctrl+C / Ctrl+V | 复制 / 粘贴选中节点 + 选中分组框 |
| 空分组 | 标题条显示「空」、整体降透明度，**不自动删除** |
| 横跨两个互不相交分组的大节点 | 拖动其中一个分组会使其离开另一个（极端情形，文档写明） |
| `fitView` / 适应视图 | 包含分组框（分组是 Vue Flow 节点，自动纳入包围盒） |

---

## 8. 验收标准（AC）

### 8.1 功能验收（逐条可复现）

| AC | 对应 FR | 验收内容 |
|----|---------|----------|
| AC-1 | FR-1 | Ctrl 框选 3 个节点 → 顶部出现悬浮工具栏 → 点「创建分组」→ 出现圆角矩形，名为「分组 1」、蓝色、恰好包裹 3 个节点并留 12px；snackbar 提示含 3 个节点；Ctrl+Z 一次完全移除 |
| AC-2 | FR-2 | 标题条在矩形顶部、白字；主体半透明；分组框绘制在节点与连线**下方**（连线可见地压在其上）；清空成员后标题条出现「空」 |
| AC-3 | FR-3 | 拖标题条与拖四边均能移动；组内空白处 Ctrl+拖拽能框选、双击能弹「添加节点」；拖动时组内节点与分组框相对位置不变；Ctrl+Z 一次复位；拖动前后多选状态不变 |
| AC-4 | FR-3.5 / 3.6 | 嵌套：拖动外层 → 内层框与其节点完整跟随、无空框；拖动内层 → 外层框与外层独有节点不动 |
| AC-5 | FR-4 | 选中/悬浮显示 8 个控制点；缩放中不消失；最小 160×100；缩放不移动节点；缩到不重叠的节点自动脱离；单次撤销 |
| AC-6 | FR-5 | 双击标题可改；回车/失焦提交、Esc 取消、空名放弃；色点打开 8 色板；选色后三处颜色同步；各自单次撤销 |
| AC-7 | FR-6 | 拖动节点进入 / 拖出分组自动加入 / 脱离；相切（边贴边）不算成员；一个节点可属两个重叠分组；`canvas.json` 中无 `nodeIds` 字段 |
| AC-8 | FR-7 | 仅相交不选中分组；完全包含则选中且成员节点同选；虚线框包围盒包含选中分组矩形；选中集含分组时「创建分组」置灰 |
| AC-9 | FR-8 | Ctrl+C/V 复制粘贴出偏移 30px 的新分组（新 id），成员关系自动成立；跨画布可粘贴；Ctrl+D 同上；单次撤销 |
| AC-10 | FR-9 | 混合选中 Delete 一次确认、文案含两类数量；仅分组选中 Delete = 解散且节点保留；单次撤销 |
| AC-11 | FR-10 | `canvas.json` 含 `groups`；刷新 / 切分镜回来完整恢复；旧文件可加载；`version === 2` |

### 8.2 工程约束验收

| AC | 内容 |
|----|------|
| AC-12 | `npm run typecheck` 无错误 |
| AC-13 | `npm run lint` 无错误（仅允许 `server/src/assets/refs.ts` 既有 warning） |
| AC-14 | `cd frontend && npm test` 全绿（含新增 `groups.test.ts` 与 store / 剪贴板补测） |
| AC-15 | 新增类 / 方法均有 JSDoc（含每个字段、参数、返回值含义）；UI 文案全中文；删除类操作一律 `confirm`；`catch` 块不静默吞异常 |

### 8.3 回归验收（不得破坏）

| AC | 内容 |
|----|------|
| AC-16 | 多选虚线框 + 右侧输出圆点的成组连接（拖到节点 / 拖到空白弹菜单）行为不变 |
| AC-17 | 节点点击 / 拖动 / 缩放 / 连线 / 断开 / 右键菜单 / 复制粘贴行为不变 |
| AC-18 | 自动搭画布、设为分镜场景图、历史对话框、上传产物行为不变 |
| AC-19 | 单选节点的配置面板显示 / 抑制逻辑不变；`Ctrl+Z` 撤销栈语义不变 |
| AC-20 | 轮询期间（节点 Loading）连线箭头动画与节点脉冲不被重置（T7） |

---

## 9. 验证方法

### 9.1 静态检查

```powershell
npm run typecheck
npm run lint
```

### 9.2 单元测试

```powershell
cd frontend; npm test
```

**新增 / 补充用例清单**：

| 文件 | 用例 |
|------|------|
| `canvas/groups.test.ts` | `rectsOverlap`（相交 / 相切 / 分离）、`rectContains`（含容差）、`nodesInGroup`、`groupsOfNode`、`collectDragFollowSet`（单层 / 嵌套递归 / 节点去重 / 内层不带动外层）、`groupRectFromNodes`、`defaultGroupName`、`hexToRgba` |
| `canvas/types.test.ts` | 旧数据（无 `groups`）迁移补空数组；非法 `groups` 项被丢弃；`version === 2` |
| `canvas/useCanvasStore.test.ts` | `addGroup` / `updateGroup` / `updateGroups` / `removeGroups` 的撤销重做；`removeNodes(nodeIds, groupIds)` 单次撤销；`copyNodes` + `pasteNodes` 分组重建（新 id、偏移、成员自动成立）；`canPaste` 计入分组 |
| `canvas/nodeClipboard.test.ts` | 含 `groups` 的序列化 / 解析往返；旧标记（无 `groups`）解析为 `[]`；非法分组项丢弃 |

### 9.3 浏览器手工验证脚本

```powershell
npm run dev      # 前端 5233 / 服务端 3001
```

**测试数据准备（AGENTS.md 硬约束）**：

> 除非用户指定在哪个项目的哪个画布中操作，**不得直接修改用户原有的画布**。只允许临时创建新项目，或在已有项目中**在末尾新建集数**、并在该集数下新建分镜，用新画布测试；任务完成后**删除临时画布并向用户报告**。

**步骤脚本**（`项目 → 新建集数 → 新建分镜 → 资产画布 Tab`）：

| # | 操作 | 预期 |
|---|------|------|
| 1 | 双击空白添加 3 个节点（生成图片 / 文本 / 加载图片） | 节点正常创建 |
| 2 | 按住 Ctrl 拖拽框选 3 个节点 | 虚线框 + 输出圆点出现；多选框顶部出现悬浮工具栏 |
| 3 | 点击「创建分组」 | 出现蓝色半透明圆角矩形；标题「分组 1」；snackbar 提示含 3 个节点 |
| 4 | 拖动分组标题条 | 分组框与 3 个节点整体移动，相对位置不变 |
| 5 | Ctrl+Z | 一次全部复位 |
| 6 | 选中分组，拖四角缩放 | 控制点全程可见；最小 160×100；节点不跟随 |
| 7 | 拖动一个节点出分组框 | 该节点脱离（成员数减少）；空分组时标题条显示「空」 |
| 8 | 拖动节点进分组框 | 自动加入 |
| 9 | 双击标题改名、点色点换色 | 三处颜色同步；名称生效 |
| 10 | 在分组内空白处 Ctrl+拖拽 | 正常框选（不移动分组） |
| 11 | 按住 Ctrl 在标题条上拖拽 | 框选（不移动分组） |
| 12 | 框选只与分组框相交（不含整个框） | 分组无选中描边 |
| 13 | 框选完全包含分组框 | 分组显示选中描边，成员节点同时选中 |
| 14 | 混合选中下 Ctrl+C → 移动视口 → Ctrl+V | 粘贴出偏移 30px 的新分组 + 节点，成员关系自动成立 |
| 15 | 混合选中下按 Delete | 一次确认弹窗，文案含两类数量；确认后一起删除；Ctrl+Z 一次恢复 |
| 16 | 仅选中分组（单击标题条）按 Delete | 文案为「解散分组」，确认后仅删框、节点保留 |
| 17 | 新建嵌套场景：再框选 2 个节点创建「分组 2」，拖动「分组 1」使其完全包含「分组 2」 | — |
| 18 | 拖动外层「分组 1」 | 内层「分组 2」的框与其节点完整跟随，不出现空框 |
| 19 | 拖动内层「分组 2」 | 外层框与外层独有节点不动 |
| 20 | 刷新页面 / 切换到其他分镜再切回 | 分组位置、尺寸、名称、颜色完整恢复 |
| 21 | 打开 `prompt/scene/{集}/{分镜}/canvas.json` | 含 `groups` 数组、`version: 2`；分组项**无** `nodeIds` |
| 22 | 回归：Ctrl 框选 2 个节点 → 拖输出圆点到另一节点 | 成组连接行为不变（AC-16） |
| 23 | 回归：节点缩放 / 连线 / 右键菜单 / 复制粘贴 / 自动搭画布 | 行为不变（AC-17 / AC-18） |
| 24 | 回归：触发一次生成（节点 Loading） | 连线箭头动画与节点脉冲不重置（AC-20） |
| 25 | 清理 | 删除临时新建的集数 / 分镜 / 项目，并向用户报告 |

### 9.4 验收报告要求

实施完成后需向用户报告：

1. 静态检查与单测结果（命令 + 结论）；
2. 手工验证脚本执行情况（逐条通过 / 未通过）；
3. **临时测试画布的清理情况**（AGENTS.md 约束）；
4. 与方案的任何偏差及其原因。

---

## 9.5 实施结果与偏差（2026-09-09 验收后补记）

**验收结论**：`npm run typecheck` / `npm run lint`（0 error）通过；`cd frontend && npm test` 574 用例全绿；浏览器手工脚本 1~25 步在临时项目 `zz-分组测试-临时` 上逐条通过（验证后已删除该项目并恢复项目列表）。

**与方案的三处偏差（均为实现期发现的必要修正，行为与验收标准一致）**：

| # | 方案原文 | 实际实现 | 原因 |
|---|----------|----------|------|
| 1 | §6.5.3「`dragOffset` 叠加到分组框与跟随节点的渲染坐标」 | 改为**命令式视图跟随**：拖动中经 `useVueFlow().updateNode(id,{position})` 移动 Vue Flow 内部坐标，结束才回写 store | 若把偏移叠加进 `flowNodeList` computed，拖动期间每帧重建节点数组 → 触发 `watch(flowNodeList)` 的静默回写（把偏移坐标写进 store，破坏单次撤销语义）且与 T7/R6「节点列表不得依赖高频状态」冲突；命令式方案同时保证连线实时跟随 |
| 2 | §6.6 CSS「`:deep(.vue-flow__node-canvas-group) { pointer-events: none }`」 | 必须写成 `pointer-events: none !important` | Vue Flow 会给带节点点击监听的节点**内联** `style="pointer-events: all"`（`NodeWrapper` 的 `hasPointerEvents`），普通样式规则压不过内联样式；实测不加 `!important` 时组内框选完全失效（AC-3 步骤 10 复现） |
| 3 | §6.5.1 分组节点以 `width`/`height` 字段下发尺寸 | 改为与真实节点一致地下发 `style: { width, height }` | `NodeResizer` 缩放会把尺寸写进内部节点 `style`；`Object.assign` 不会清除残留 style，导致**缩放后撤销**时框体渲染尺寸与 store 不一致（实测发现并修复） |

**方案未覆盖但实现时补充的点**：

- `store.moveEntities(nodePatches, groupPatches)`：节点与分组**一次回写、单次撤销**（拖动分组 R2 跟随、多选拖动分组跟随两个场景共用）。
- `groups.ts` 新增 `boundingRect()`：多选包围盒 = 选中节点 ∪ 选中分组矩形 + 12px 留白（FR-7.4）；`useCanvasGroup.groupRect` 由「仅节点」改为「节点 ∪ 分组」，虚线框与工具栏共用。
- 拖动结束的合成 click 拦截器在 `useCanvasGroups` 内独立实现一份（与 `useCanvasGroup` 输出点拖拽同一手法），未抽取公共模块以降低对既有逻辑的改动风险。

**未在浏览器验证的项**：AC-18（自动搭画布）在临时空分镜下服务端返回 404（该分镜无任何场景/角色资产，属环境限制；自动搭画布代码路径本次未改动）；AC-20（轮询期间动画不重置）由实现约束保证（`flowGroupNodeList` 只依赖 `store.groups`，Ctrl 状态在 `class` 函数体内惰性读取），未构造真实生成任务实测。

---

## 10. 明确不做（本次范围外）

| # | 不做项 | 原因 |
|---|--------|------|
| 1 | 分组嵌套层级（真正的父子容器语义） | 成员由几何重叠派生，无层级概念；完全包含时拖动级联已覆盖主要场景 |
| 2 | 分组自动贴合组内节点（自动收缩 / 扩张） | 尺寸只由用户调整，避免拖动节点时框体乱跳 |
| 3 | 空分组自动删除 | 属删除类操作，必须用户确认；改为「空」标记提示 |
| 4 | 分组参与连线 / 成组连接的源集合 | 分组是可视化容器，不是数据节点 |
| 5 | 分组折叠 / 展开、隐藏组内节点 | 与「节点始终可见可操作」的现有交互冲突 |
| 6 | 分组颜色自由取色器 | 预设色板保证半透明填充与文字对比度可控 |
| 7 | 服务端改动 | §4.3 已核实无需改动 |
| 8 | 撤销 / 重做恢复选中态 | 与现有节点选中行为保持一致 |

---

## 11. 风险与对策

| # | 风险 | 影响 | 对策 |
|---|------|------|------|
| R1 | 忘记给分组节点 wrapper 设 `pointer-events: none` | **组内框选完全失效**（T2 / T3） | 在 §6.6 固化 CSS；AC-3 / 步骤 10 专门验证 |
| R2 | `NodeResizer` 控制点在 `pointer-events: none` 容器内不可拖 | 无法缩放 | `:deep(.vue-flow__resize-control){ pointer-events: auto }`；AC-5 验证 |
| R3 | 用原生拖动实现分组拖动 | 选中节点被移动两次（T6） | 分组节点 `draggable: false` + 自定义拖动；AC-3 验证 |
| R4 | 拖动中逐帧写 store | 撤销栈污染、保存风暴 | 拖动中只做视图偏移，结束时一次性回写；AC-3 / AC-5 验证 |
| R5 | 在 `selection-end` 读 `userSelectionRect` | 已为 null（T5），判定永远失败 | 从 `selection-start` / `selection-end` 指针事件自行计算 |
| R6 | 分组节点列表依赖高频状态（如 `statusByNode`） | 轮询期间重渲染 → 动画重置（T7） | 只依赖 `store.groups` + `ctrlHeld`；AC-20 验证 |
| R7 | 拖动结束的合成 click 命中 pane | 刚选中的分组被立即取消选中 | 复用「捕获阶段一次性 click 拦截器」手法 |
| R8 | 旧 `canvas.json` 含非法 `groups` 数据 | 加载失败 | 迁移时逐项校验、丢弃非法项并 `console.warn`（不静默） |
| R9 | 部分重叠分组拖动"抢节点" | 用户可能误解 | 在 `docs/canvas/interactions.md` 写明该几何行为 + 空分组提示 |

---

## 12. 关键文件索引

| 文件 | 角色 |
|------|------|
| `frontend/src/canvas/types.ts` | `CanvasGroupData`、`CanvasData.groups`、schema v2、迁移 |
| `frontend/src/canvas/groups.ts` | 分组纯逻辑（重叠 / 包含 / 跟随集 / 色板 / 命名） |
| `frontend/src/canvas/useCanvasStore.ts` | 分组 CRUD、复制粘贴、删除、撤销重做 |
| `frontend/src/canvas/nodeClipboard.ts` | 剪贴板载荷含 `groups` |
| `frontend/src/canvas/groupSelection.ts` | 既有多选群组纯函数（`GROUP_FRAME_PADDING` 复用；**不改语义**） |
| `frontend/src/components/canvas/CanvasGroupNode.vue` | 分组框渲染（标题条 / 填充 / 拖动条 / 缩放点） |
| `frontend/src/components/canvas/CanvasSelectionToolbar.vue` | 多选悬浮工具栏 |
| `frontend/src/components/canvas/composables/useCanvasGroups.ts` | 分组交互（创建 / 拖动 / 缩放 / 改名 / 改色 / 解散 / 框选判定） |
| `frontend/src/components/canvas/composables/useCanvasFlow.ts` | 分组节点渲染、拖动视图偏移、虚线框包围盒 |
| `frontend/src/components/canvas/composables/useCanvasSelection.ts` | `selectedGroupIds`、删除语义 |
| `frontend/src/components/canvas/composables/{useCanvasMenus,useCanvasKeyboard,useCanvasPaste}.ts` | 右键菜单 / 快捷键 / 粘贴适配 |
| `frontend/src/components/canvas/CanvasContextMenu.vue` | 分组实体右键菜单块 |
| `frontend/src/components/canvas/AssetCanvas.vue` | 接线 + 关键 `:deep` 样式（T2 / T3 的落点） |
| `frontend/src/components/canvas/CanvasNodeCard.vue` | `NodeResizer` 既有用法参照 |
| `docs/canvas/{data-model,interactions,module-structure}.md` | 实施后需同步更新 |
| `server/src/assets/canvas-def.ts` | 已核实：CAS 保存无需改动 |
