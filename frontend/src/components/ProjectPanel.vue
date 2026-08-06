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
        <v-alert
          v-if="overviewSuccess"
          type="success"
          variant="tonal"
          class="ma-2"
          density="compact"
        >
          {{ overviewSuccess }}
        </v-alert>
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
          <v-card-title class="text-body-large">
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

            <v-row density="compact">
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

            <div class="text-body-medium mb-4">
              <span class="text-medium-emphasis">aspectRatio（自动）：</span>
              <strong>{{ computedAspectRatio || '—' }}</strong>
            </div>

            <div class="d-flex ga-2">
              <v-btn
                color="primary"
                :loading="savingForm"
                :disabled="!configParseOk"
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
          <v-alert
            v-if="overviewError"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-2"
          >
            {{ overviewError }}
          </v-alert>
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
const overviewError = ref('')
const overviewSuccess = ref('')
const configError = ref('')
const configSuccess = ref('')
const configParseOk = ref(true)
const rawJsonText = ref('{}')

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
  return !fieldErrors.width && !fieldErrors.height && !fieldErrors.fps
}

function resetFormDefaults() {
  form.width = 1080
  form.height = 1920
  form.fps = 24
  preset.value = 'custom'
  fieldErrors.width = ''
  fieldErrors.height = ''
  fieldErrors.fps = ''
}

function applyConfigObject(obj: Record<string, unknown>) {
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
  configParseOk.value = true
}

async function load() {
  overviewError.value = ''
  overviewSuccess.value = ''
  configError.value = ''
  configSuccess.value = ''
  configParseOk.value = true
  overviewContent.value = ''
  rawJsonText.value = '{}'
  resetFormDefaults()

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
    configParseOk.value = false
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
        configParseOk.value = false
        return
      }
      applyConfigObject(parsed as Record<string, unknown>)
    } catch {
      configError.value = '无法解析 project.json，请使用「编辑原始 JSON」修复'
      configParseOk.value = false
    }
  }
}

function editOverview() {
  overviewError.value = ''
  overviewDialog.content = overviewContent.value
  overviewDialog.show = true
}

async function saveOverview() {
  savingOverview.value = true
  overviewSuccess.value = ''
  overviewError.value = ''
  try {
    await writeFs(props.project, 'overview.md', overviewDialog.content)
    overviewContent.value = overviewDialog.content
    overviewDialog.show = false
    overviewSuccess.value = 'overview.md 已保存'
  } catch (e) {
    console.error(e)
    overviewError.value = '保存 overview.md 失败'
  } finally {
    savingOverview.value = false
  }
}

async function saveForm() {
  configSuccess.value = ''
  if (!configParseOk.value) return
  if (!validateForm()) return

  savingForm.value = true
  try {
    // 重新读取，避免覆盖他人/他处修改的非核心字段
    let base: Record<string, unknown> = {}
    let latest: unknown
    try {
      latest = await readFs(props.project, 'project.json')
    } catch {
      // 文件不存在 / 读取失败 → 按空对象创建
      latest = null
      base = {}
    }

    if (latest !== null) {
      if (typeof latest === 'object' && latest !== null && !Array.isArray(latest) && !('entries' in latest)) {
        base = { ...(latest as Record<string, unknown>) }
      } else if (typeof latest === 'string') {
        try {
          const parsed: unknown = JSON.parse(latest)
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            configError.value = '无法解析 project.json，请使用「编辑原始 JSON」修复'
            configParseOk.value = false
            return
          }
          base = { ...(parsed as Record<string, unknown>) }
        } catch {
          configError.value = '无法解析 project.json，请使用「编辑原始 JSON」修复'
          configParseOk.value = false
          return
        }
      } else {
        configError.value = 'project.json 读取结果异常'
        configParseOk.value = false
        return
      }
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
    configError.value = ''
    configParseOk.value = true
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
