# 项目总览与配置面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在项目管理中通过资产树「项目信息」入口查看/编辑 `overview.md` 与 `project.json`（表单 + 原始 JSON）。

**Architecture:** 扩展 `POST /api/fs` 根级写入白名单；前端新增 `ProjectPanel`（双 Tab），`AssetTree` 顶部虚拟节点 `type=project`，`ProjectView` 按 query 渲染。表单保存时读原 JSON 仅合并核心字段；原始 JSON 整对象覆盖。

**Tech Stack:** Express + TypeScript、Vue 3 + Vuetify 3、axios、`readFs`/`writeFs`

**Spec:** `docs/superpowers/specs/2026-07-29-project-overview-config-panel-design.md`

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `server/src/routes/fs.ts` | 允许根级 `overview.md` / `project.json` 写入 |
| `frontend/src/components/ProjectPanel.vue` | 项目总览 + 项目配置双 Tab |
| `frontend/src/components/AssetTree.vue` | 顶部「项目信息」节点与选中路由 |
| `frontend/src/views/ProjectView.vue` | `type=project` 时挂载 `ProjectPanel` |
| `docs/asset-layout.md` | 同步 API 写入范围 |
| `AGENTS.md` | 同步写入范围 |
| `README.md` | 同步 API 表说明 |

本仓库暂无服务端单测框架；每任务用 `npm run typecheck` / `npm run lint` 与 curl/手工 UI 验收。

---

### Task 1: 扩展 fs 写入白名单

**Files:**
- Modify: `server/src/routes/fs.ts`

- [ ] **Step 1: 修改 `server/src/routes/fs.ts` 写入校验**

将文件顶部常量与 POST 校验改为：

```typescript
const WRITABLE_PREFIXES = ['prompt', 'assert'];
const WRITABLE_ROOT_FILES = ['overview.md', 'project.json'];

function isWritableRelPath(relPath: string): boolean {
  if (!relPath || relPath.includes('..')) return false;
  // 统一为正斜杠比较（Express 参数通常已是 /）
  const normalized = relPath.replace(/\\/g, '/');
  if (WRITABLE_ROOT_FILES.includes(normalized)) return true;
  const prefix = normalized.split('/')[0];
  return WRITABLE_PREFIXES.includes(prefix ?? '');
}
```

在 `fsRouter.post` 中，将：

```typescript
const prefix = relPath.split('/')[0];
if (!WRITABLE_PREFIXES.includes(prefix)) {
  res.status(403).json({ error: 'Only prompt/ and assert/ paths are writable' });
  return;
}
```

替换为：

```typescript
if (!isWritableRelPath(relPath)) {
  res.status(403).json({
    error: 'Only prompt/, assert/, overview.md and project.json are writable',
  });
  return;
}
```

保留既有路径穿越校验与 `content` 字符串校验不变。

- [ ] **Step 2: 手工验收写入权限**

确保 dev server 在跑（或临时 `npx tsx server/src/index.ts`）。用任意已有项目名（如 `古人在现代`）：

```bash
# 应 200：写 project.json（先读再写回相同内容更安全；此处仅测权限）
curl -s -o - -w "\nHTTP:%{http_code}\n" -X POST "http://localhost:3001/api/fs/古人在现代/project.json" -H "Content-Type: application/json" -d "{\"content\":\"{\\\"width\\\":1080,\\\"height\\\":1920,\\\"aspectRatio\\\":\\\"9:16\\\",\\\"fps\\\":24}\\n\"}"

# 应 200：写 overview.md 前先备份；若担心覆盖，可跳过本条，仅测 403
# 应 403：根级其他文件
curl -s -o - -w "\nHTTP:%{http_code}\n" -X POST "http://localhost:3001/api/fs/古人在现代/secret.txt" -H "Content-Type: application/json" -d "{\"content\":\"x\"}"

# 应 403：非白名单前缀
curl -s -o - -w "\nHTTP:%{http_code}\n" -X POST "http://localhost:3001/api/fs/古人在现代/foo/bar.md" -H "Content-Type: application/json" -d "{\"content\":\"x\"}"
```

Expected:
- `project.json` → `{"success":true}` HTTP 200
- `secret.txt` / `foo/bar.md` → 403，error 文案含 writable 说明

**注意：** 若对真实 `project.json` 做了测试写入，确认内容仍正确（或从 git 恢复）。

- [ ] **Step 3: typecheck + lint**

```bash
npm run typecheck
npm run lint
```

Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/fs.ts
git commit -m "feat: 允许写入项目根 overview.md 与 project.json"
```

---

### Task 2: 新建 ProjectPanel 组件

**Files:**
- Create: `frontend/src/components/ProjectPanel.vue`

- [ ] **Step 1: 创建 `frontend/src/components/ProjectPanel.vue`**

完整实现如下（对齐 `CharacterPanel` 的加载/弹窗模式 + 配置表单）：

```vue
<template>
  <div style="flex: 1; min-height: 0; overflow-y: auto;">
    <v-tabs v-model="tab">
      <v-tab value="overview">
        项目总览
      </v-tab>
      <v-tab value="config">
        项目配置
      </v-tab>
    </v-tabs>

    <v-tabs-window v-model="tab">
      <!-- 项目总览 -->
      <v-tabs-window-item value="overview">
        <div class="d-flex mt-2 mb-2 ml-2">
          <v-btn @click="editOverview">
            编辑
          </v-btn>
        </div>
        <MarkdownView
          v-if="overviewContent"
          :content="overviewContent"
        />
        <div
          v-else
          class="text-grey ml-2"
        >
          暂无 overview.md，可点击编辑创建
        </div>
      </v-tabs-window-item>

      <!-- 项目配置 -->
      <v-tabs-window-item value="config">
        <v-alert
          v-if="configError"
          type="error"
          variant="tonal"
          class="ma-2"
          density="compact"
        >
          {{ configError }}
        </v-alert>
        <v-alert
          v-if="configSuccess"
          type="success"
          variant="tonal"
          class="ma-2"
          density="compact"
        >
          {{ configSuccess }}
        </v-alert>

        <v-card
          class="ma-2"
          variant="outlined"
        >
          <v-card-title class="text-subtitle-1">
            核心配置
          </v-card-title>
          <v-card-text>
            <v-select
              v-model="preset"
              :items="presetItems"
              item-title="title"
              item-value="value"
              label="分辨率快捷选择"
              variant="outlined"
              density="comfortable"
              class="mb-3"
              @update:model-value="onPresetChange"
            />

            <v-row dense>
              <v-col
                cols="12"
                sm="4"
              >
                <v-text-field
                  v-model.number="form.width"
                  label="width"
                  type="number"
                  variant="outlined"
                  density="comfortable"
                  :error-messages="fieldErrors.width"
                  @update:model-value="onDimensionChange"
                />
              </v-col>
              <v-col
                cols="12"
                sm="4"
              >
                <v-text-field
                  v-model.number="form.height"
                  label="height"
                  type="number"
                  variant="outlined"
                  density="comfortable"
                  :error-messages="fieldErrors.height"
                  @update:model-value="onDimensionChange"
                />
              </v-col>
              <v-col
                cols="12"
                sm="4"
              >
                <v-text-field
                  v-model.number="form.fps"
                  label="fps"
                  type="number"
                  variant="outlined"
                  density="comfortable"
                  :error-messages="fieldErrors.fps"
                />
              </v-col>
            </v-row>

            <div class="text-body-2 mb-4">
              <span class="text-medium-emphasis">aspectRatio（自动）：</span>
              <strong>{{ computedAspectRatio || '—' }}</strong>
            </div>

            <div class="d-flex ga-2">
              <v-btn
                color="primary"
                :loading="savingForm"
                :disabled="!!configError && configError.includes('无法解析')"
                @click="saveForm"
              >
                保存配置
              </v-btn>
              <v-btn
                variant="tonal"
                @click="openRawJson"
              >
                编辑原始 JSON
              </v-btn>
            </div>
          </v-card-text>
        </v-card>
      </v-tabs-window-item>
    </v-tabs-window>

    <!-- overview 编辑弹窗 -->
    <v-dialog
      v-model="overviewDialog.show"
      max-width="800"
    >
      <v-card>
        <v-card-title>编辑 overview.md</v-card-title>
        <v-card-text>
          <v-textarea
            v-model="overviewDialog.content"
            rows="18"
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="savingOverview"
            @click="overviewDialog.show = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            :loading="savingOverview"
            @click="saveOverview"
          >
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 原始 JSON 编辑弹窗 -->
    <v-dialog
      v-model="rawDialog.show"
      max-width="800"
    >
      <v-card>
        <v-card-title>编辑 project.json</v-card-title>
        <v-card-text>
          <v-alert
            v-if="rawDialog.error"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-2"
          >
            {{ rawDialog.error }}
          </v-alert>
          <v-textarea
            v-model="rawDialog.content"
            rows="18"
            variant="outlined"
            class="font-mono"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="savingRaw"
            @click="rawDialog.show = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            :loading="savingRaw"
            @click="saveRawJson"
          >
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { readFs, writeFs } from '../api/client'
import MarkdownView from './MarkdownView.vue'

const props = defineProps<{ project: string }>()

const tab = ref<string | null>('overview')
const overviewContent = ref('')
const configError = ref('')
const configSuccess = ref('')
const rawJsonText = ref('{}')
const parsedConfig = ref<Record<string, unknown> | null>(null)

const form = reactive({
  width: 1080 as number | null,
  height: 1920 as number | null,
  fps: 24 as number | null,
})

const fieldErrors = reactive({
  width: '' as string,
  height: '' as string,
  fps: '' as string,
})

const preset = ref<string>('custom')
const savingForm = ref(false)
const savingOverview = ref(false)
const savingRaw = ref(false)

const overviewDialog = reactive({
  show: false,
  content: '',
})

const rawDialog = reactive({
  show: false,
  content: '',
  error: '',
})

interface PresetItem {
  title: string
  value: string
  width?: number
  height?: number
}

const presetItems: PresetItem[] = [
  { title: '1080P 竖屏 (1080×1920)', value: '1080p-portrait', width: 1080, height: 1920 },
  { title: '1080P 横屏 (1920×1080)', value: '1080p-landscape', width: 1920, height: 1080 },
  { title: '720P 竖屏 (720×1280)', value: '720p-portrait', width: 720, height: 1280 },
  { title: '720P 横屏 (1280×720)', value: '720p-landscape', width: 1280, height: 720 },
  { title: '自定义', value: 'custom' },
]

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

function aspectRatioFrom(width: number, height: number): string {
  const g = gcd(width, height)
  return `${width / g}:${height / g}`
}

const computedAspectRatio = computed(() => {
  const w = Number(form.width)
  const h = Number(form.height)
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return ''
  return aspectRatioFrom(w, h)
})

function matchPreset(width: number | null, height: number | null): string {
  const w = Number(width)
  const h = Number(height)
  const found = presetItems.find(p => p.width === w && p.height === h)
  return found?.value ?? 'custom'
}

function onPresetChange(value: string) {
  const item = presetItems.find(p => p.value === value)
  if (!item || item.value === 'custom' || item.width == null || item.height == null) return
  form.width = item.width
  form.height = item.height
  fieldErrors.width = ''
  fieldErrors.height = ''
}

function onDimensionChange() {
  preset.value = matchPreset(form.width, form.height)
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0
}

function validateForm(): boolean {
  fieldErrors.width = isPositiveInt(Number(form.width)) ? '' : '须为正整数'
  fieldErrors.height = isPositiveInt(Number(form.height)) ? '' : '须为正整数'
  fieldErrors.fps = isPositiveInt(Number(form.fps)) ? '' : '须为正整数'
  // v-model.number 可能得到 number；统一用 Number()
  if (!isPositiveInt(Number(form.width))) fieldErrors.width = '须为正整数'
  if (!isPositiveInt(Number(form.height))) fieldErrors.height = '须为正整数'
  if (!isPositiveInt(Number(form.fps))) fieldErrors.fps = '须为正整数'
  return !fieldErrors.width && !fieldErrors.height && !fieldErrors.fps
}

function applyConfigObject(obj: Record<string, unknown>) {
  parsedConfig.value = obj
  const w = obj.width
  const h = obj.height
  const f = obj.fps
  form.width = typeof w === 'number' ? w : (typeof w === 'string' && w !== '' ? Number(w) : null)
  form.height = typeof h === 'number' ? h : (typeof h === 'string' && h !== '' ? Number(h) : null)
  form.fps = typeof f === 'number' ? f : (typeof f === 'string' && f !== '' ? Number(f) : 24)
  if (form.width == null || Number.isNaN(form.width)) form.width = 1080
  if (form.height == null || Number.isNaN(form.height)) form.height = 1920
  if (form.fps == null || Number.isNaN(form.fps)) form.fps = 24
  preset.value = matchPreset(form.width, form.height)
}

async function load() {
  configError.value = ''
  configSuccess.value = ''
  overviewContent.value = ''
  parsedConfig.value = null
  rawJsonText.value = '{}'

  const [overviewRes, configRes] = await Promise.allSettled([
    readFs(props.project, 'overview.md'),
    readFs(props.project, 'project.json'),
  ])

  if (overviewRes.status === 'fulfilled' && typeof overviewRes.value === 'string') {
    overviewContent.value = overviewRes.value
  }

  if (configRes.status === 'rejected') {
    // 文件不存在：允许表单创建
    applyConfigObject({})
    rawJsonText.value = '{}\n'
    return
  }

  const raw = configRes.value
  if (typeof raw !== 'string' && typeof raw !== 'object') {
    configError.value = 'project.json 读取结果异常'
    return
  }

  // axios 可能已把 JSON 反序列化为对象（见 client.ts 注释）
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && !('entries' in raw)) {
    const obj = raw as Record<string, unknown>
    applyConfigObject(obj)
    rawJsonText.value = `${JSON.stringify(obj, null, 2)}\n`
    return
  }

  if (typeof raw === 'string') {
    rawJsonText.value = raw.endsWith('\n') ? raw : `${raw}\n`
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        configError.value = 'project.json 必须是 JSON 对象，请使用「编辑原始 JSON」修复'
        return
      }
      applyConfigObject(parsed as Record<string, unknown>)
    } catch {
      configError.value = '无法解析 project.json，请使用「编辑原始 JSON」修复'
    }
  }
}

function editOverview() {
  overviewDialog.content = overviewContent.value
  overviewDialog.show = true
}

async function saveOverview() {
  savingOverview.value = true
  configSuccess.value = ''
  try {
    await writeFs(props.project, 'overview.md', overviewDialog.content)
    overviewContent.value = overviewDialog.content
    overviewDialog.show = false
  } catch (e) {
    console.error(e)
    alert('保存 overview.md 失败')
  } finally {
    savingOverview.value = false
  }
}

async function saveForm() {
  configSuccess.value = ''
  if (configError.value.includes('无法解析') || configError.value.includes('必须是 JSON 对象')) {
    return
  }
  if (!validateForm()) return

  savingForm.value = true
  try {
    // 重新读取，避免覆盖他人/他处修改的非核心字段
    let base: Record<string, unknown> = {}
    try {
      const latest = await readFs(props.project, 'project.json')
      if (typeof latest === 'object' && latest !== null && !Array.isArray(latest) && !('entries' in latest)) {
        base = { ...(latest as Record<string, unknown>) }
      } else if (typeof latest === 'string') {
        const parsed: unknown = JSON.parse(latest)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          configError.value = '无法解析 project.json，请使用「编辑原始 JSON」修复'
          return
        }
        base = { ...(parsed as Record<string, unknown>) }
      }
    } catch {
      // 不存在 → 空对象
      base = {}
    }

    const width = Number(form.width)
    const height = Number(form.height)
    const fps = Number(form.fps)
    base.width = width
    base.height = height
    base.fps = fps
    base.aspectRatio = aspectRatioFrom(width, height)

    const text = `${JSON.stringify(base, null, 2)}\n`
    await writeFs(props.project, 'project.json', text)
    rawJsonText.value = text
    parsedConfig.value = base
    configError.value = ''
    configSuccess.value = '配置已保存'
    preset.value = matchPreset(width, height)
  } catch (e) {
    console.error(e)
    configError.value = '保存 project.json 失败'
  } finally {
    savingForm.value = false
  }
}

function openRawJson() {
  rawDialog.content = rawJsonText.value
  rawDialog.error = ''
  rawDialog.show = true
}

async function saveRawJson() {
  rawDialog.error = ''
  let parsed: unknown
  try {
    parsed = JSON.parse(rawDialog.content)
  } catch {
    rawDialog.error = 'JSON 解析失败，请检查语法'
    return
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    rawDialog.error = '根节点必须是 JSON 对象'
    return
  }

  savingRaw.value = true
  try {
    const obj = parsed as Record<string, unknown>
    const text = `${JSON.stringify(obj, null, 2)}\n`
    await writeFs(props.project, 'project.json', text)
    rawJsonText.value = text
    applyConfigObject(obj)
    configError.value = ''
    configSuccess.value = '原始 JSON 已保存'
    rawDialog.show = false
  } catch (e) {
    console.error(e)
    rawDialog.error = '保存失败'
  } finally {
    savingRaw.value = false
  }
}

watch(() => props.project, load, { immediate: true })
</script>
```

说明：
- `readFs` 对 `.json` 可能返回已解析对象（见 `client.ts` 注释），`load` / `saveForm` 两种形态都要处理。
- 表单保存遇非法 JSON：设置 `configError` 并 `return`，不写文件。
- `aspectRatio` 只读，由宽高约分写入。

- [ ] **Step 2: typecheck + lint**

```bash
npm run typecheck
npm run lint
```

Expected: 无错误。若 ESLint 对 `alert` 或未使用变量报错，按规则微调（可用 `configError` 展示 overview 保存失败，去掉 `alert`）。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ProjectPanel.vue
git commit -m "feat: 新增 ProjectPanel 项目总览与配置面板"
```

---

### Task 3: AssetTree 增加「项目信息」入口

**Files:**
- Modify: `frontend/src/components/AssetTree.vue`

- [ ] **Step 1: 扩展 `TreeKind` 与图标色**

在 `type TreeKind` 联合类型中增加 `'project-info'`：

```typescript
type TreeKind =
  | 'project-info'
  | 'root-character'
  | 'character'
  | 'root-stage'
  | 'stage'
  | 'subscene'
  | 'root-scene'
  | 'episode'
  | 'shot'
```

在 `iconColor` 中为项目信息节点设色（可选，放在函数开头）：

```typescript
function iconColor(item: TreeItem): string {
  if (item.kind === 'project-info') return 'deep-purple'
  // ...existing branches
}
```

`canCreate` / `canDelete` 不要包含 `project-info`（已默认 false）。

- [ ] **Step 2: `buildTree` 顶部插入虚拟节点**

将 `treeItems.value = [` 数组开头插入：

```typescript
treeItems.value = [
  {
    name: '项目信息',
    path: 'project-info',
    icon: 'mdi-information-outline',
    type: 'project',
    kind: 'project-info',
  },
  {
    name: '角色',
    // ...existing
  },
  // ...
]
```

- [ ] **Step 3: `onSelect` 处理 `project-info`**

在 `onSelect` 内、处理 `character` 之前增加：

```typescript
if (item.kind === 'project-info') {
  patchQuery({
    type: 'project',
    name: undefined,
    subscene: undefined,
    episode: undefined,
    shot: undefined,
  })
  return
}
```

- [ ] **Step 4: typecheck + lint**

```bash
npm run typecheck
npm run lint
```

Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AssetTree.vue
git commit -m "feat: 资产树增加项目信息入口"
```

---

### Task 4: ProjectView 挂载 ProjectPanel

**Files:**
- Modify: `frontend/src/views/ProjectView.vue`

- [ ] **Step 1: 引入并条件渲染**

在 `<script setup>` 增加：

```typescript
import ProjectPanel from '../components/ProjectPanel.vue'
```

在模板右侧主区，于 `CharacterPanel` 之前增加分支（保持 `v-if` / `v-else-if` 链）：

```vue
<ProjectPanel
  v-if="type === 'project'"
  :project
/>
<CharacterPanel
  v-else-if="type === 'character'"
  :project
  :name
/>
<StagePanel
  v-else-if="type === 'stage'"
  :project
  :name
  :subscene
/>
<ScenePanel
  v-else-if="type === 'scene'"
  :project
  :episode
  :shot
/>
<div
  v-else
  class="d-flex align-center justify-center"
  style="height: 100%"
>
  <!-- 现有空状态不变 -->
</div>
```

- [ ] **Step 2: typecheck + lint**

```bash
npm run typecheck
npm run lint
```

Expected: 无错误。

- [ ] **Step 3: 手工 UI 验收**

1. 打开 `http://localhost:5233/project?project=古人在现代`（或当前 dev 端口）
2. 左侧树顶部应有「项目信息」
3. 点击后 URL 含 `type=project`，右侧出现双 Tab
4. 项目总览可预览 `overview.md`，编辑保存后刷新仍在
5. 项目配置：选「720P 横屏」→ width/height 变为 1280/720，aspectRatio 显示 `16:9`，改 fps 后保存
6. 打开 `design/别开会了/project.json`（含扩展字段）项目，表单保存后确认 `targetAudience` 等字段仍在
7. 原始 JSON：故意写非法 JSON → 保存应失败；写回合法对象成功
8. 未选中节点时右侧仍为空状态

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/ProjectView.vue
git commit -m "feat: ProjectView 接入项目信息面板"
```

---

### Task 5: 同步文档写入范围

**Files:**
- Modify: `docs/asset-layout.md`
- Modify: `AGENTS.md`
- Modify: `README.md`

- [ ] **Step 1: 更新 `docs/asset-layout.md`**

将：

```markdown
**API 写入范围：** 仅允许写入 `prompt/` 与 `assert/` 前缀；路径不得越出 `design/{project}/`。
```

改为：

```markdown
**API 写入范围：** 允许写入 `prompt/`、`assert/` 前缀，以及项目根级 `overview.md`、`project.json`；路径不得越出 `design/{project}/`。
```

- [ ] **Step 2: 更新 `AGENTS.md`**

将：

```markdown
- 写入仅限于 `prompt/` 和 `assert/` 前缀
```

改为：

```markdown
- 写入限于 `prompt/`、`assert/` 前缀，以及根级 `overview.md`、`project.json`
```

- [ ] **Step 3: 更新 `README.md` API 表**

将 POST 行：

```markdown
| POST | `/api/fs/:project/*` | 写入文件（仅限 `prompt/` 和 `assert/`） |
```

改为：

```markdown
| POST | `/api/fs/:project/*` | 写入文件（`prompt/`、`assert/`，以及根级 `overview.md` / `project.json`） |
```

- [ ] **Step 4: Commit**

```bash
git add docs/asset-layout.md AGENTS.md README.md
git commit -m "docs: 同步项目根文件可写范围说明"
```

---

### Task 6: 最终验收

- [ ] **Step 1: 全量检查**

```bash
npm run typecheck
npm run lint
```

Expected: 全部通过。

- [ ] **Step 2: 对照 spec 验收标准勾选**

| # | 标准 | 通过 |
|---|------|------|
| 1 | 树顶「项目信息」→ `type=project` → ProjectPanel | ☐ |
| 2 | overview 预览 + 弹窗编辑保存 | ☐ |
| 3 | 快捷下拉 + 表单改 width/height/fps，aspectRatio 自动 | ☐ |
| 4 | 表单保存保留非核心字段 | ☐ |
| 5 | 原始 JSON 可保存；非法拒绝 | ☐ |
| 6 | 未选中资产时空状态 | ☐ |
| 7 | typecheck + lint | ☐ |

- [ ] **Step 3: 如有修复则追加 commit**

无则结束。

---

## Spec 覆盖自检

| Spec 要求 | 任务 |
|-----------|------|
| 树顶「项目信息」虚拟节点 | Task 3 |
| `type=project` + ProjectPanel | Task 3–4 |
| 双 Tab 总览/配置 | Task 2 |
| overview Markdown + 弹窗编辑 | Task 2 |
| 分辨率快捷下拉 4 预设 + 自定义 | Task 2 |
| width/height/fps 表单，aspectRatio 约分 | Task 2 |
| 表单合并保存非核心字段 | Task 2 |
| 非法 JSON 阻止表单保存 | Task 2 |
| 原始 JSON 整对象覆盖 | Task 2 |
| fs 白名单扩展 | Task 1 |
| 文档同步 | Task 5 |
| typecheck/lint | 各 Task + Task 6 |

## Placeholder 扫描

无 TBD/TODO；步骤含完整代码与命令。

## 类型一致性

- 路由 query：`type=project`（字符串）
- 树 kind：`project-info`；展示 type：`project`
- 核心字段：`width`/`height`/`fps` number，`aspectRatio` string
- API 路径：`overview.md`、`project.json`（项目相对，无前缀）
