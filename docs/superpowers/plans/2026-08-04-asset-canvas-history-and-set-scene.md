# 资产画布 · 历史增强与「设为分镜场景图」按钮收敛 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「设为分镜场景图」按钮只在分镜画布出现，并把版本历史对话框升级为「大图预览 + 侧边列表 + 激活为当前图片」。

**Architecture:** 前端纯逻辑（`activateHistory` 纯函数）与 UI 分离：`canvas/generate.ts` 提供可单测的激活逻辑；新组件 `AssetHistoryDialog.vue` 承载对话框 UI；`AssetCanvas.vue` 负责接线（传 `kind`、持有对话框状态、写回 config）。「设为分镜场景图」按钮通过给 `ImageGenerateEditor` 传入画布类型 `kind` 并按 `kind === 'scene'` 条件渲染。

**Tech Stack:** Vue 3 + Vuetify 3 + TypeScript + Vitest；改动仅限 `frontend/`，无服务端改动。

**Spec:** `docs/superpowers/specs/2026-08-04-asset-canvas-history-and-set-scene-design.md`

---

### Task 1: `activateHistory` 纯函数与单测

**Files:**
- Modify: `frontend/src/canvas/generate.ts`（在 `getHistory` 之后新增）
- Test: `frontend/src/canvas/generate.test.ts`

- [ ] **Step 1: 写失败的单测**

在 `frontend/src/canvas/generate.test.ts` 中，把导入语句改为（加入 `activateHistory` 与 `HistoryEntry` 类型）：

```ts
import { activateHistory, collectInputs, collectInputPaths, getHistory, getNodeCurrentAssetPath, type HistoryEntry } from './generate'
```

并在文件末尾追加：

```ts
describe('activateHistory', () => {
  it('把历史条目激活为 current，history 引用与内容不变，原 config 不被修改', () => {
    const cfg = gen.config
    const next = activateHistory(cfg, {
      version: 1,
      path: 'assert/scene/1/1/canvas/g1/v1.jpg',
      date: '2026-01-01T00:00:00.000Z',
    })
    expect(next.current).toEqual({
      version: 1,
      path: 'assert/scene/1/1/canvas/g1/v1.jpg',
      date: '2026-01-01T00:00:00.000Z',
    })
    // history 引用不变（原当前图保留在历史中）
    expect(next.history).toBe(cfg.history)
    // 原 config 不被修改
    expect(cfg.current).toEqual({
      version: 2,
      path: 'assert/scene/1/1/canvas/g1/v2.jpg',
      date: '2026-01-01T00:00:00.000Z',
    })
  })

  it('激活后原当前图仍在历史中', () => {
    const cfg = gen.config
    const next = activateHistory(cfg, {
      version: 1,
      path: 'assert/scene/1/1/canvas/g1/v1.jpg',
      date: '2026-01-01T00:00:00.000Z',
    })
    expect((next.history as HistoryEntry[]).map((h) => h.version)).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend; npx vitest run src/canvas/generate.test.ts`
Expected: FAIL —— `activateHistory is not a function`（尚未实现）。

- [ ] **Step 3: 实现纯函数**

在 `frontend/src/canvas/generate.ts` 的 `getHistory` 函数之后追加：

```ts
/**
 * 把某历史版本激活为节点当前图片（返回新 config）。
 * 仅改写 current 指针，history 列表不变——原当前图本就保留在历史中，
 * 因此激活后原图自然成为历史版本。
 *
 * @param config 节点原配置
 * @param entry 要激活的历史条目
 * @returns 新配置（current 指向该条目，history 引用不变）
 */
export function activateHistory(config: NodeConfig, entry: HistoryEntry): NodeConfig {
  return { ...config, current: { version: entry.version, path: entry.path, date: entry.date } }
}
```

（`NodeConfig`、`HistoryEntry` 均已在该文件顶部从 `./types` 导入，无需新增。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend; npx vitest run src/canvas/generate.test.ts`
Expected: PASS（全部用例，含既有用例）。

- [ ] **Step 5: 提交**

```powershell
$f = "$env:TEMP\cm1.txt"; [System.IO.File]::WriteAllText($f, "feat: 画布历史激活纯函数 activateHistory", [System.Text.UTF8Encoding]::new($false)); git add frontend/src/canvas/generate.ts frontend/src/canvas/generate.test.ts; git commit -F $f; Remove-Item $f
```

---

### Task 2: `ImageGenerateEditor` 按画布类型隐藏「设为分镜场景图」

**Files:**
- Modify: `frontend/src/components/canvas/editors/ImageGenerateEditor.vue`
- Modify: `frontend/src/components/canvas/AssetCanvas.vue`

- [ ] **Step 1: 新增 `kind` prop 并加条件渲染**

在 `frontend/src/components/canvas/editors/ImageGenerateEditor.vue`：

1) 导入类型（script 顶部）：

```ts
import type { CanvasNodeData, CanvasKind } from '../../../canvas/types'
```

2) `defineProps` 增加 `kind` 字段：

```ts
const props = defineProps<{
  project: string
  node: CanvasNodeData
  inputs: CanvasInputInfo[]
  isRunning: boolean
  /** 画布类型：仅分镜画布（scene）显示「设为分镜场景图」 */
  kind: CanvasKind
}>()
```

3) 「设为分镜场景图」按钮加 `kind === 'scene'` 条件（模板中 prop 名可直接使用）：

```html
      <v-btn
        v-if="kind === 'scene' && node.config.current && !isRunning"
        size="small"
        variant="tonal"
        color="primary"
        @click="emit('set-as-scene', node.id)"
      >
        设为分镜场景图
      </v-btn>
```

- [ ] **Step 2: `AssetCanvas` 传入 `kind`**

在 `frontend/src/components/canvas/AssetCanvas.vue` 的编辑器插槽 `<component :is="editorPanel?.editorComponent" ...>` 中，在 `:is-running="..."` 之后增加：

```html
              :kind="target.kind"
```

即该 `<component>` 变为：

```html
            <component
              :is="editorPanel?.editorComponent"
              :project="props.project"
              :node="editorPanel?.node"
              :inputs="editorPanel ? inputsOf(editorPanel.node.id) : []"
              :is-running="editorPanel ? isNodeRunning(editorPanel.node.id) : false"
              :kind="target.kind"
              @update:config="(patch: Record<string, unknown>) => editorPanel && onUpdateConfig(editorPanel.node.id, patch)"
              @generate="generateNode"
              @interrupt="onInterrupt"
              @open-history="openHistory"
              @set-as-scene="openSetAsScene"
              @open-picker="openAssetPicker"
            />
```

> 说明：`ImageLoaderEditor` 未声明 `kind` prop，多余属性会作为 fallthrough attribute 落到其根元素，无害。

- [ ] **Step 3: 类型检查与 lint**

Run: `npm run typecheck`
Expected: 无错误。

Run: `npm run lint`
Expected: 无新增错误（仅允许既有 `server/src/assets/refs.ts` warning）。

- [ ] **Step 4: 提交**

```powershell
$f = "$env:TEMP\cm2.txt"; [System.IO.File]::WriteAllText($f, "feat: 设为分镜场景图按钮仅分镜画布显示", [System.Text.UTF8Encoding]::new($false)); git add frontend/src/components/canvas/editors/ImageGenerateEditor.vue frontend/src/components/canvas/AssetCanvas.vue; git commit -F $f; Remove-Item $f
```

---

### Task 3: 新建 `AssetHistoryDialog.vue` 组件

**Files:**
- Create: `frontend/src/components/canvas/AssetHistoryDialog.vue`

- [ ] **Step 1: 创建组件**

创建 `frontend/src/components/canvas/AssetHistoryDialog.vue`，内容如下（左侧大图预览 + 右侧列表；点行仅更新预览，点「设为当前」emit `activate`；激活后由父组件刷新 node，当前标记自动更新，对话框保持打开）：

```vue
<template>
  <v-dialog
    :model-value="modelValue"
    max-width="780"
    @update:model-value="onDialogUpdate"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          class="mr-2"
          size="small"
        >
          mdi-history
        </v-icon>
        <span>版本历史</span>
      </v-card-title>
      <v-card-text>
        <div
          v-if="!props.node || entries.length === 0"
          class="text-grey text-body-2"
        >
          暂无历史版本
        </div>
        <div
          v-else
          class="history-body"
        >
          <!-- 左侧大图预览 -->
          <div class="history-preview">
            <img
              v-if="!previewBroken"
              :src="previewUrl"
              class="history-preview__img"
              @error="previewBroken = true"
            >
            <div
              v-else
              class="history-preview__img history-preview__img--empty"
            >
              <v-icon icon="mdi-image-off-outline" />
            </div>
            <div class="history-preview__label">
              {{ selectedLabel }}
            </div>
          </div>
          <!-- 右侧历史列表 -->
          <v-list
            class="history-list"
            density="compact"
          >
            <v-list-item
              v-for="h in entries"
              :key="h.version"
              :class="{ 'history-item--current': isCurrent(h) }"
              @click="selectEntry(h)"
            >
              <template #prepend>
                <img
                  v-if="!isBroken(h)"
                  :src="thumbUrl(h)"
                  class="history-item__thumb"
                  @error="markBroken(h)"
                >
                <div
                  v-else
                  class="history-item__thumb history-item__thumb--empty"
                >
                  <v-icon
                    icon="mdi-image-off-outline"
                    size="small"
                  />
                </div>
              </template>
              <v-list-item-title class="text-body-2">
                v{{ h.version }}
                <v-chip
                  v-if="isCurrent(h)"
                  size="x-small"
                  color="primary"
                  class="ml-1"
                >
                  当前
                </v-chip>
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                {{ formatDate(h.date) }}
              </v-list-item-subtitle>
              <template #append>
                <v-btn
                  size="x-small"
                  variant="tonal"
                  color="primary"
                  :disabled="isCurrent(h)"
                  @click.stop="activateEntry(h)"
                >
                  设为当前
                </v-btn>
              </template>
            </v-list-item>
          </v-list>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="closeDialog"
        >
          关闭
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../canvas/types'
import { getHistory, type HistoryEntry } from '../../canvas/generate'
import { buildPreviewUrl } from '../../canvas/preview'

/** 组件 props：显隐、项目名、生成节点数据（null 时空态） */
const props = defineProps<{
  modelValue: boolean
  project: string
  node: CanvasNodeData | null
}>()

/** 组件 emits：显隐同步、请求激活某历史版本 */
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'activate', entry: HistoryEntry): void
}>()

/** 历史条目列表（取节点 config.history） */
const entries = computed<HistoryEntry[]>(() => (props.node ? getHistory(props.node.config) : []))

/** 当前激活条目（config.current，用于标记与初始化选中） */
const currentEntry = computed<HistoryEntry | null>(() => {
  const cur = props.node?.config.current as { version?: number; path?: string; date?: string } | undefined
  if (!cur?.path) return null
  return { version: cur.version ?? 0, path: cur.path, date: cur.date ?? '' }
})

/** 当前选中的条目（驱动左侧大图预览；初始/激活后跟随当前项） */
const selected = ref<HistoryEntry | null>(null)

/** 大图预览加载失败标记 */
const previewBroken = ref(false)

/** 缩略图加载失败的版本集合（按 version 记忆） */
const brokenVersions = ref<Set<number>>(new Set())

/** 某版本是否已标记加载失败 */
function isBroken(h: HistoryEntry): boolean {
  return brokenVersions.value.has(h.version)
}

/** 标记某版本缩略图加载失败 */
function markBroken(h: HistoryEntry) {
  brokenVersions.value = new Set(brokenVersions.value).add(h.version)
}

/** 是否某条目为当前项（版本号 + 路径都一致） */
function isCurrent(h: HistoryEntry): boolean {
  const cur = currentEntry.value
  return cur !== null && cur.version === h.version && cur.path === h.path
}

/** 大图预览 URL（无选中或加载失败时为空） */
const previewUrl = computed(() => {
  const s = selected.value
  return s ? buildPreviewUrl(props.project, s.path, s.version) : ''
})

/** 大图预览标签（版本 + 生成时间） */
const selectedLabel = computed(() => {
  const s = selected.value
  return s ? `v${s.version} · ${formatDate(s.date)}` : ''
})

/** 缩略图 URL */
function thumbUrl(h: HistoryEntry): string {
  return buildPreviewUrl(props.project, h.path, h.version)
}

/** 点击列表行：仅更新大图预览（不激活） */
function selectEntry(h: HistoryEntry) {
  selected.value = h
  previewBroken.value = false
}

/** 点击「设为当前」：请求父组件激活（父组件写回 current 后本组件随 node 更新） */
function activateEntry(h: HistoryEntry) {
  emit('activate', h)
}

/** 内部 v-dialog 显隐变化 → 透传父组件 */
function onDialogUpdate(v: unknown) {
  emit('update:modelValue', Boolean(v))
}

/** 关闭对话框 */
function closeDialog() {
  emit('update:modelValue', false)
}

/** 格式化 ISO 时间为本地可读文本 */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN')
  } catch {
    return iso
  }
}

// 打开时（或节点变化）：重置选中为当前项，清空大图加载失败标记
watch(
  [() => props.modelValue, () => props.node],
  () => {
    if (props.modelValue && props.node) {
      selected.value = currentEntry.value
      previewBroken.value = false
    }
  },
  { immediate: true },
)

// 激活后（node 变化导致 currentEntry 更新）：选中项跟随新的当前项，便于继续对比
watch(currentEntry, (cur) => {
  if (cur) {
    selected.value = cur
    previewBroken.value = false
  }
})
</script>

<style scoped>
.history-body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.history-preview {
  flex: none;
  width: 300px;
}

.history-preview__img {
  width: 300px;
  height: 300px;
  object-fit: contain;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(0, 0, 0, 0.04);
}

.history-preview__img--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.38);
}

.history-preview__label {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.6);
}

.history-list {
  flex: 1;
  min-width: 0;
  max-height: 340px;
  overflow-y: auto;
}

.history-item--current {
  background: rgba(25, 118, 210, 0.08);
}

.history-item__thumb {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(0, 0, 0, 0.04);
}

.history-item__thumb--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.38);
}
</style>
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 无错误。

- [ ] **Step 3: 提交**

```powershell
$f = "$env:TEMP\cm3.txt"; [System.IO.File]::WriteAllText($f, "feat: 新增版本历史对话框组件（大图预览+激活为当前）", [System.Text.UTF8Encoding]::new($false)); git add frontend/src/components/canvas/AssetHistoryDialog.vue; git commit -F $f; Remove-Item $f
```

---

### Task 4: `AssetCanvas` 接入新历史对话框

**Files:**
- Modify: `frontend/src/components/canvas/AssetCanvas.vue`

- [ ] **Step 1: 替换内联历史对话框模板**

把 `AssetCanvas.vue` 中「版本历史对话框」整段内联 `v-dialog`（从 `<!-- 版本历史对话框 -->` 到其 `</v-dialog>`，含历史列表模板）替换为：

```html
      <!-- 版本历史对话框（大图预览 + 激活为当前） -->
      <AssetHistoryDialog
        v-model="historyDialog.show"
        :project="props.project"
        :node="historyNode"
        @activate="onActivateHistory"
      />
```

- [ ] **Step 2: 更新导入**

把导入语句：

```ts
import { collectInputPaths, collectInputs, getHistory, getNodeCurrentAssetPath, type CanvasInputInfo } from '../../canvas/generate'
```

改为：

```ts
import { activateHistory, collectInputPaths, collectInputs, getNodeCurrentAssetPath, type CanvasInputInfo, type HistoryEntry } from '../../canvas/generate'
```

并在组件导入区（`AssetPickerDialog` 导入附近）新增：

```ts
import AssetHistoryDialog from './AssetHistoryDialog.vue'
```

- [ ] **Step 3: 替换历史状态逻辑**

把这段（`historyDialog` 状态 + `historyEntries` computed + `openHistory` + `formatDate`）：

```ts
const historyDialog = reactive({ show: false, nodeId: '' })

/** 历史对话框的版本列表 */
const historyEntries = computed(() => {
  const node = nodeMap.value[historyDialog.nodeId]
  return node ? getHistory(node.config) : []
})

/** 打开版本历史对话框 */
function openHistory(nodeId: string) {
  historyDialog.nodeId = nodeId
  historyDialog.show = true
}

/** 格式化 ISO 时间为本地可读文本 */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN')
  } catch {
    return iso
  }
}
```

替换为：

```ts
const historyDialog = reactive({ show: false, nodeId: '' })

/** 历史对话框对应节点（store 更新后自动刷新，激活后「当前」标记随之更新） */
const historyNode = computed(() => nodeMap.value[historyDialog.nodeId] ?? null)

/** 打开版本历史对话框 */
function openHistory(nodeId: string) {
  historyDialog.nodeId = nodeId
  historyDialog.show = true
}

/**
 * 历史对话框「设为当前」：把选中历史版本激活为节点当前图片。
 * 仅改写 current 指针（history 不变），原当前图自动保留在历史中。
 *
 * @param entry 要激活的历史条目
 */
function onActivateHistory(entry: HistoryEntry) {
  const node = nodeMap.value[historyDialog.nodeId]
  if (!node) return
  store.updateNode(node.id, { config: activateHistory(node.config, entry) })
}
```

- [ ] **Step 4: 类型检查与 lint**

Run: `npm run typecheck`
Expected: 无错误（确认 `getHistory`、`formatDate`、`historyEntries` 无残留引用）。

Run: `npm run lint`
Expected: 无新增错误。

- [ ] **Step 5: 提交**

```powershell
$f = "$env:TEMP\cm4.txt"; [System.IO.File]::WriteAllText($f, "feat: 资产画布接入新版本历史对话框（激活为当前）", [System.Text.UTF8Encoding]::new($false)); git add frontend/src/components/canvas/AssetCanvas.vue; git commit -F $f; Remove-Item $f
```

---

### Task 5: 全量验证与浏览器实测

**Files:** 无（验证收尾）

- [ ] **Step 1: 全量单测**

Run: `cd frontend; npm test`
Expected: 全部 PASS。

- [ ] **Step 2: 全量类型检查与 lint**

Run: `npm run typecheck` 与 `npm run lint`
Expected: 均无错误（仅允许既有 `server/src/assets/refs.ts` warning）。

- [ ] **Step 3: 浏览器实测**

`npm run dev` 后访问 `localhost:5233`，用共享浏览器页验证：

1. **场景画布**（如「古人在现代」→ 某场景 → 某子场景 → 资产画布）：选中生成图片节点，配置面板**无**「设为分镜场景图」按钮。
2. **分镜画布**（任意分镜 → 资产画布）：选中生成图片节点，配置面板**有**「设为分镜场景图」按钮，点击后对话框功能正常。
3. 分镜画布某生成图片节点（有 2+ 历史版本）点「历史」：
   - 左侧大图显示当前项；右侧列表每行有缩略图、`v{n}`、生成时间；
   - 点击某历史行 → 左侧大图切换为该版本（不激活）；
   - 点击该行「设为当前」→ 节点卡片图切换为该版本；对话框**保持打开**，「当前」徽标移到该行，原「设为当前」按钮变禁用；
   - 激活旧版本后，旧版本仍留在列表中（原当前图成为历史版本）；
   - 关闭对话框后再次打开，「当前」项与节点卡片一致。
4. 回归：输入图拖拽排序、生成、设为分镜场景图覆盖/新增帧仍正常。

- [ ] **Step 4: 更新资产画布文档**

在 `docs/asset-canvas.md` 的 §6（配置面板）与 §10（设为分镜场景图）补充：
- 编辑器组件约定新增 `kind` prop（`ImageGenerateEditor` 用）；「设为分镜场景图」仅分镜画布显示。
- §10 旁注明历史对话框为独立组件 `AssetHistoryDialog.vue`，支持大图预览、生成时间、激活为当前（仅改 `current`，history 不变）。

Run: `npm run typecheck && npm run lint`（文档改动不影响，但保持习惯）。

- [ ] **Step 5: 提交**

```powershell
$f = "$env:TEMP\cm5.txt"; [System.IO.File]::WriteAllText($f, "docs: 资产画布历史对话框与设为分镜场景图按钮说明", [System.Text.UTF8Encoding]::new($false)); git add docs/asset-canvas.md; git commit -F $f; Remove-Item $f
```
