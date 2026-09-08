<template>
  <div>
    <!-- 工具条：阈值 + 扫描 + 回收站入口 -->
    <div class="d-flex align-center flex-wrap ga-2 pa-2">
      <v-text-field
        v-model.number="olderThanDays"
        label="历史记录久远阈值"
        type="number"
        suffix="天"
        variant="outlined"
        density="compact"
        hide-details
        :min="1"
        :max="3650"
        style="max-width: 200px"
      />
      <v-btn
        color="primary"
        prepend-icon="mdi-magnify"
        :loading="scanning"
        :disabled="!thresholdValid"
        @click="doScan"
      >
        扫描
      </v-btn>
      <v-spacer />
      <v-chip
        v-if="trashStats"
        size="small"
        variant="tonal"
        prepend-icon="mdi-delete-outline"
      >
        回收站 {{ trashStats.count }} 项 · {{ formatBytes(trashStats.totalSize) }}
      </v-chip>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-cog-outline"
        @click="openSystemSettings('trash')"
      >
        回收站设置
      </v-btn>
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      class="mx-2 mb-2"
      closable
      @click:close="error = ''"
    >
      {{ error }}
    </v-alert>

    <div class="px-2">
      <CleanupSummaryBar
        v-if="result"
        :total-count="items.length"
        :total-size="totalSize"
        :selected-count="selectedItems.length"
        :selected-size="selectedSize"
        :moving="moving"
        @select-all="selectAll"
        @select-none="selectNone"
        @invert="invert"
        @move="moveSelected"
      />
    </div>

    <!-- 扫描进度 -->
    <div
      v-if="scanning"
      class="d-flex align-center justify-center py-12"
    >
      <v-progress-circular
        indeterminate
        color="primary"
        class="mr-3"
      />
      <span class="text-medium-emphasis">正在扫描…</span>
    </div>

    <!-- 空态 -->
    <div
      v-else-if="!result"
      class="d-flex align-center justify-center py-12"
    >
      <div class="text-center text-grey">
        <v-icon
          icon="mdi-broom"
          size="48"
          color="grey-lighten-1"
        />
        <div class="mt-2">
          点击「扫描」识别可清理的数据
        </div>
        <div class="text-body-small mt-1">
          扫描范围：无引用自定义资产（assert/custom/）+ 超过阈值的画布节点/角色/场景/道具历史版本
        </div>
      </div>
    </div>

    <div
      v-else-if="!items.length"
      class="d-flex align-center justify-center py-12"
    >
      <div class="text-center text-grey">
        <v-icon
          icon="mdi-check-circle-outline"
          size="48"
          color="success"
        />
        <div class="mt-2">
          没有可清理的数据
        </div>
        <div class="text-body-small mt-1">
          自定义资产 {{ result.stats.customFiles }} 个（{{ result.stats.customReferenced }} 个被引用）、
          历史记录 {{ result.stats.historyFiles }} 条（{{ result.stats.historyStale }} 条超过阈值）
        </div>
      </div>
    </div>

    <!-- 结果分组 -->
    <div
      v-else
      class="px-2 pb-4"
    >
      <div class="text-body-small text-medium-emphasis mb-2">
        扫描于 {{ formatDateTime(result.scannedAt) }} · 阈值 {{ result.olderThanDays }} 天 ·
        自定义资产 {{ result.stats.customFiles }} 个（{{ result.stats.customReferenced }} 个被引用）、
        历史记录 {{ result.stats.historyFiles }} 条
      </div>
      <CleanupResultSection
        v-for="group in groups"
        :key="group.category"
        :category="group.category"
        :label="group.label"
        :items="group.items"
        :selected-ids="selected"
        @toggle="toggleItem"
        @toggle-group="toggleGroup"
        @preview="previewItem"
        @download="downloadItem"
      />
    </div>

    <CustomAssetPreviewDialog
      v-model="preview.show"
      :file-name="preview.fileName"
      :kind="preview.kind"
      :url="preview.url"
      :text-content="preview.textContent"
      :loading="preview.loading"
    />

    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color"
      :timeout="5000"
      location="bottom"
    >
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  DEFAULT_OLDER_THAN_DAYS,
  moveCleanupToTrash,
  scanCleanup,
  type CleanupCategory,
  type CleanupItem,
  type CleanupScanResult,
} from '../../api/cleanup'
import { getSystemSettings } from '../../api/system'
import { useSystemSettings } from '../../composables/useSystemSettings'
import { formatBytes } from '../../utils/formatBytes'
import { formatDateTime } from '../../utils/relativeTime'
import type { PreviewKind } from '../../utils/customAssetFile'
import { confirm } from '../../utils/confirm'
import CleanupSummaryBar from './CleanupSummaryBar.vue'
import CleanupResultSection from './CleanupResultSection.vue'
import CustomAssetPreviewDialog from '../custom-asset/CustomAssetPreviewDialog.vue'

/**
 * 存储清理面板（项目设置 → 存储清理）。
 *
 * 流程：设定「久远阈值」→ 扫描 → 勾选（支持全选/全不选/反选）→ 预览/下载 → 移入系统全局回收站。
 * 回收站为系统级资源，其查看/恢复/彻底删除/自动清理配置位于 系统设置 → 系统设置 → 回收站。
 */
const props = defineProps<{
  /** 当前项目名称 */
  project: string
}>()

const { openSystemSettings } = useSystemSettings()

/** 历史记录「久远」阈值（天） */
const olderThanDays = ref(DEFAULT_OLDER_THAN_DAYS)
const scanning = ref(false)
const moving = ref(false)
const error = ref('')
/** 扫描结果（null = 尚未扫描） */
const result = ref<CleanupScanResult | null>(null)
/** 已勾选条目 id 集合 */
const selected = ref<Set<string>>(new Set())
/** 全局回收站统计（来自系统设置） */
const trashStats = ref<{ count: number; totalSize: number } | null>(null)

/** 操作反馈 */
const snackbar = reactive({ show: false, text: '', color: 'primary' })
/** 预览对话框状态 */
const preview = reactive({
  show: false,
  fileName: '',
  kind: 'none' as PreviewKind,
  url: '',
  textContent: null as string | null,
  loading: false,
})

/** 分组展示顺序（固定顺序，空分组不渲染） */
const GROUP_ORDER: Array<{ category: CleanupCategory; label: string }> = [
  { category: 'custom-orphan', label: '无引用自定义资产' },
  { category: 'canvas-history', label: '画布节点历史' },
  { category: 'character-history', label: '角色历史' },
  { category: 'stage-history', label: '场景历史' },
  { category: 'prop-history', label: '道具历史' },
]

/** 阈值是否合法（1~3650 整数） */
const thresholdValid = computed(() => {
  const n = Number(olderThanDays.value)
  return Number.isInteger(n) && n >= 1 && n <= 3650
})

/** 扫描结果条目 */
const items = computed<CleanupItem[]>(() => result.value?.items ?? [])

/** 扫描结果总大小 */
const totalSize = computed(() => result.value?.totalSize ?? 0)

/** 已勾选条目 */
const selectedItems = computed(() => items.value.filter((item) => selected.value.has(item.id)))

/** 已勾选总大小 */
const selectedSize = computed(() => selectedItems.value.reduce((sum, item) => sum + item.size, 0))

/** 分组结果（仅非空分组） */
const groups = computed(() => {
  const map = new Map<CleanupCategory, CleanupItem[]>()
  for (const item of items.value) {
    const list = map.get(item.category) ?? []
    list.push(item)
    map.set(item.category, list)
  }
  return GROUP_ORDER
    .filter((g) => (map.get(g.category)?.length ?? 0) > 0)
    .map((g) => ({ ...g, items: map.get(g.category) ?? [] }))
})

/**
 * 刷新全局回收站统计（用于顶部提示）。
 */
async function refreshTrashStats(): Promise<void> {
  try {
    const payload = await getSystemSettings()
    trashStats.value = payload.trashStats
  } catch (e) {
    // 回收站统计仅为辅助信息：读取失败不阻断扫描主流程，打印日志即可
    console.error('[cleanup] 读取回收站统计失败:', e)
  }
}

/**
 * 执行扫描；扫描完成后默认全部不勾选（避免误清理）。
 */
async function doScan(): Promise<void> {
  if (!thresholdValid.value) return
  scanning.value = true
  error.value = ''
  try {
    const data = await scanCleanup(props.project, Number(olderThanDays.value))
    result.value = data
    selected.value = new Set()
    await refreshTrashStats()
    snackbar.text = data.items.length
      ? `扫描完成：${data.items.length} 项可清理，共 ${formatBytes(data.totalSize)}`
      : '扫描完成：没有可清理的数据'
    snackbar.color = data.items.length ? 'primary' : 'success'
    snackbar.show = true
  } catch (e) {
    console.error('[cleanup] 扫描失败:', e)
    error.value = '扫描失败，请查看浏览器控制台日志'
  } finally {
    scanning.value = false
  }
}

/** 勾选/取消单条 */
function toggleItem(item: CleanupItem): void {
  const next = new Set(selected.value)
  if (next.has(item.id)) next.delete(item.id)
  else next.add(item.id)
  selected.value = next
}

/**
 * 组内全选 / 全不选。
 *
 * @param category 分组 key
 * @param checked 是否全选
 */
function toggleGroup(category: CleanupCategory, checked: boolean): void {
  const next = new Set(selected.value)
  for (const item of items.value) {
    if (item.category !== category) continue
    if (checked) next.add(item.id)
    else next.delete(item.id)
  }
  selected.value = next
}

/** 全选 */
function selectAll(): void {
  selected.value = new Set(items.value.map((item) => item.id))
}

/** 全不选 */
function selectNone(): void {
  selected.value = new Set()
}

/** 反选 */
function invert(): void {
  const next = new Set<string>()
  for (const item of items.value) {
    if (!selected.value.has(item.id)) next.add(item.id)
  }
  selected.value = next
}

/**
 * 构造文件访问 URL。
 *
 * @param item 扫描结果条目
 * @returns `/api/fs/...` URL
 */
function itemUrl(item: CleanupItem): string {
  return `/api/fs/${props.project}/${item.path}`
}

/**
 * 下载该条目对应的原始文件。
 *
 * @param item 扫描结果条目
 */
function downloadItem(item: CleanupItem): void {
  const a = document.createElement('a')
  a.href = itemUrl(item)
  a.download = item.path.split('/').pop() ?? item.path
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/**
 * 预览该条目对应的原始文件（图片/音视频/文本）。
 *
 * @param item 扫描结果条目
 */
async function previewItem(item: CleanupItem): Promise<void> {
  if (item.previewKind === 'none') {
    downloadItem(item)
    return
  }
  const url = itemUrl(item)
  preview.fileName = item.path.split('/').pop() ?? item.path
  preview.kind = item.previewKind
  preview.url = url
  preview.textContent = null
  preview.loading = item.previewKind === 'text'
  preview.show = true

  if (item.previewKind === 'text') {
    try {
      const res = await fetch(url)
      if (res.ok) {
        const text = await res.text()
        preview.textContent = text.length > 50000
          ? `${text.slice(0, 50000)}\n\n...（文件过长，已截断）`
          : text
      } else {
        preview.textContent = '加载文本失败'
      }
    } catch (e) {
      console.error('[cleanup] 读取文本预览失败:', e)
      preview.textContent = '加载文本失败'
    } finally {
      preview.loading = false
    }
  }
}

/**
 * 把勾选项移入系统全局回收站（执行前二次确认）。
 */
async function moveSelected(): Promise<void> {
  const picked = selectedItems.value
  if (!picked.length) return
  const ok = await confirm({
    title: '确认清理',
    content: `将把选中的 ${picked.length} 个文件（共 ${formatBytes(selectedSize.value)}）移入系统回收站。\n`
      + '回收站为系统全局，可在「系统设置 → 系统设置 → 回收站」中恢复或彻底删除。',
    confirmText: '移入回收站',
    confirmColor: 'error',
  })
  if (!ok) return

  moving.value = true
  error.value = ''
  try {
    const res = await moveCleanupToTrash(props.project, picked.map((item) => item.path))
    const skippedText = res.skipped.length
      ? `，跳过 ${res.skipped.length} 项（${res.skipped.map((s) => s.reason).join('；')}）`
      : ''
    if (res.skipped.length) {
      console.warn('[cleanup] 部分条目被跳过:', res.skipped)
    }
    snackbar.text = `已移入回收站 ${res.moved.length} 个文件${skippedText}（批次 ${res.batchId}）`
    snackbar.color = res.moved.length ? 'success' : 'warning'
    snackbar.show = true
    await doScan()
  } catch (e) {
    console.error('[cleanup] 移入回收站失败:', e)
    error.value = '移入回收站失败，请查看浏览器控制台日志'
  } finally {
    moving.value = false
  }
}

onMounted(() => {
  void refreshTrashStats()
})
</script>
