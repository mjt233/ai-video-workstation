# Bug 排查：连线右键菜单「断开连接」点空白处关不掉

> 日期：2026-09-19
> 状态：**已修复**；验证见「四、验证」
> 现象报告：资产画布中右键点击连接线弹出「断开连接」菜单后，**点击画布空白处菜单不关闭**（只能点菜单项或切换画布）。

## 一、结论（单一根因）

画布上的菜单分属 4 个组合式，而「关闭全部菜单」的 `useCanvasMenus.closeAll()` 只关**自己持有**的三个菜单（节点右键 / 分组实体 / 添加节点）：

```ts
// 修复前 useCanvasMenus.ts
function closeAll(): void {
  contextMenu.show = false
  addMenu.show = false
  groupEntityMenu.show = false   // ← 连线右键菜单在 useCanvasFlow.edgeMenu，不在这里
}
```

而连线右键菜单的状态 `edgeMenu` 定义在 `useCanvasFlow`，**从未进入任何统一关闭路径**：

| 触发 | 修复前行为 | 说明 |
|------|-----------|------|
| 点击空白（`pane-click` → `menus.closeAll()`） | ❌ 连线菜单留着 | 本 bug 的现象 |
| 按 `Esc`（`useCanvasKeyboard` → `closeAllMenus()` → `menus.closeAll()`） | ❌ 连线菜单留着 | 与文档「Esc 关闭右键菜单」不符 |
| 点击节点（`onNodeClick` → `menus.closeAll()`） | ❌ 连线菜单留着 | |
| 空白右键 / 工具栏「＋」 | ❌ 连线菜单与添加节点菜单**同屏并存** | 只有 `openGroupEntityContextMenu` 显式调了一次 `flow.closeEdgeMenu()` |

对照实验（同一画布）：节点右键菜单点空白正常关闭，连线右键菜单点空白不关闭 —— 差异只来自「是否在 `closeAll` 覆盖范围内」。

## 二、证据链（浏览器实测，临时项目 `_tmp-canvas-menu-check`）

复现步骤：临时项目 → 分镜 1（`canvas.json` 预置「加载图片 → 生成图片」一条连线）。

```
右键连线  → .canvas-context-menu = ["断开连接"]      ✅ 菜单打开
点击空白  → .canvas-context-menu = ["断开连接"]      ❌ 菜单仍在（pane-click 确实派发：target = .vue-flow__pane，见 Vue Flow Pane 的 wrapHandler 判定 event.target === container）
── 对照 ──
右键节点  → .canvas-context-menu = ["断开连接 重命名 复制 删除"]  ✅
点击空白  → .canvas-context-menu = []                            ✅ 关闭
```

## 三、修复（建立「单一入口」不变式）

1. **`useCanvasMenus` 增加注入项 `closeSiblingMenus?: () => void`**：`closeAll()` = `closeOwnMenus()`（自己的三个菜单）+ `closeSiblingMenus?.()`；`reset()` 复用 `closeAll()`。
2. **`AssetCanvas` 注入 `closeSiblingMenus`**：关闭连线右键菜单（`flow.closeEdgeMenu`）、群组连接目标菜单、分组色板菜单、资产拖放菜单——画布上的**全部**菜单因此只有一个关闭入口。
3. **打开任一菜单前先 `closeAll()`**：`openContextMenu` / `openGroupEntityMenu` / `openAddMenu` 内部第一步统一关闭其它菜单 ⇒ 同屏只可能有一个画布菜单（顺带修掉「节点菜单与连线菜单同屏并存」）。
4. **顺序约束**：`AssetCanvas.onEdgeContextMenu` 改为**先** `menus.closeAll()` **再** `flow.onEdgeContextMenu()`——`closeAll` 经 `closeSiblingMenus` 也会关连线菜单本身，反过来会把刚打开的菜单立刻关掉（代码内已注明）。
5. **删除 `closeNodeMenu()`**（只关节点菜单的半套 API，正是它诱使各调用点各关一半），各调用点的「只关一部分」写法（`group.closeConnectMenu()` / `canvasGroups.closeColorMenu()` / `flow.closeEdgeMenu()`）一并收敛到 `closeAll`。

## 四、验证（浏览器实测，临时画布）

| 检查项 | 结果 |
|--------|------|
| 右键连线 → 点击空白 | 菜单关闭 ✅（本 bug） |
| 右键连线 → `Esc` | 菜单关闭 ✅ |
| 右键连线 → 点击节点 | 菜单关闭 ✅ |
| 右键连线 → 空白右键 / 工具栏「＋」 | 连线菜单先关闭，只剩添加节点菜单 ✅ |
| 节点菜单 → 再右键连线 / 连线菜单 → 再右键节点 | 任一时刻只有一个菜单 ✅ |
| 右键分组框菜单 → 点击空白 | 关闭 ✅（无回归） |
| 双击空白 / 空白右键 / 工具栏「＋」 | 添加节点菜单正常弹出 ✅（`openAddMenu` 新增的 `closeAll()` 无副作用） |
| 「断开连接」菜单项 | 连线被删除、菜单关闭、自动保存落盘（`rev` 2）✅ |
| `npm run typecheck` / `npm run lint` | 无错误（lint 仅剩仓库既有无关警告）✅ |

## 五、涉及文件

| 文件 | 角色 |
|------|------|
| `frontend/src/components/canvas/composables/useCanvasMenus.ts` | 新增 `closeSiblingMenus` 注入项；`closeAll` 成为唯一关闭入口；三个 `open*` 先关后开；删除 `closeNodeMenu` |
| `frontend/src/components/canvas/AssetCanvas.vue` | 注入 `closeSiblingMenus`；`closeAllMenus` 包装函数移除（键盘 `Esc` 直接用 `menus.closeAll`）；`onEdgeContextMenu` 调整为先关后开 |
| `frontend/src/components/canvas/composables/useCanvasFlow.ts` | `edgeMenu` / `onEdgeContextMenu` 注释补充关闭入口与顺序约束（行为不变） |
| `docs/canvas/interactions.md` | 新增「画布菜单的开关（单一入口，改动前必读）」小节 + 交互表行更新 |
| `docs/canvas/module-structure.md`、`docs/canvas/development.md` | 组合式职责与常见坑同步 |
