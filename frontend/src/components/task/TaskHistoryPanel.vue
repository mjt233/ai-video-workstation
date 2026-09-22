<template>
  <!--
    任务管理器「历史」页签：展示 SQLite 中持久化的任务（默认最近 14 天，与日志保留期一致）。

    列表由 Vuetify 的 <v-infinite-scroll> **组件**承载（注意：Vuetify 4 已无同名指令）：
    组件根元素自带滚动容器，滚到底自动加载下一批；内容不足一屏时也会自动续拉
    （组件在 done('ok') 后用 3 帧 rAF 重新检查哨兵）。任务行的日志在「任务详情」对话框里看，
    因此每行高度恒定，不存在展开态与滚动加载互相干扰的问题。
  -->
  <div class="task-history">
    <!-- 筛选条：固定一行（时间范围 / 状态 / 刷新；「项目」筛选已移除） -->
    <div class="task-history__filters">
      <v-select
        v-model="filters.days"
        :items="dayOptions"
        item-title="label"
        item-value="value"
        label="时间范围"
        variant="outlined"
        density="compact"
        hide-details
        class="task-history__filter"
        @update:model-value="() => void reload()"
      />
      <v-select
        v-model="filters.status"
        :items="statusOptions"
        item-title="label"
        item-value="value"
        label="状态"
        variant="outlined"
        density="compact"
        hide-details
        class="task-history__filter"
        @update:model-value="() => void reload()"
      />
      <v-btn
        icon="mdi-refresh"
        size="small"
        variant="tonal"
        color="primary"
        aria-label="刷新"
        title="刷新"
        :loading="loading"
        @click="() => void reload()"
      />
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-2"
    >
      {{ error }}
    </v-alert>

    <!-- 首屏加载 / 空态：不挂载无限滚动组件，避免与「已加载完」的空态混淆 -->
    <div
      v-if="loading && tasks.length === 0"
      class="task-history__center"
    >
      <v-progress-circular
        indeterminate
        color="primary"
        size="24"
      />
    </div>
    <div
      v-else-if="tasks.length === 0"
      class="task-history__center"
    >
      <v-icon
        icon="mdi-history"
        size="36"
        class="mb-2"
        color="grey"
      />
      <div class="text-body-medium text-medium-emphasis">
        该时间范围内暂无历史任务
      </div>
    </div>

    <!--
      任务列表：组件根元素即滚动容器（自带 overflow-y: auto）。
      :key 自增即重建——比调用组件的 reset() 更不易漏（empty/error 状态与滚动位置一起复位）。
    -->
    <v-infinite-scroll
      v-else
      :key="listKey"
      class="task-history__list"
      :margin="120"
      @load="onLoadMore"
      @scroll.passive="onScroll"
    >
      <div
        v-for="t in tasks"
        :key="t.taskId"
        class="task-history__row"
      >
        <!-- 产物缩略图（仅已完成且有图片/视频产物）：点击放大预览 -->
        <button
          v-if="thumbPathOf(t) && !brokenThumbs.has(t.taskId)"
          type="button"
          class="task-history__thumb"
          :title="`预览产物：${resultPathOf(t)}`"
          @click="openPreview(t)"
        >
          <img
            v-if="mediaKindOfPath(resultPathOf(t)) === 'image'"
            :src="previewUrlOf(t)"
            :alt="artifactName(t)"
            @error="markThumbBroken(t.taskId)"
          >
          <video
            v-else
            :src="`${previewUrlOf(t)}#t=0.1`"
            muted
            preload="metadata"
            @error="markThumbBroken(t.taskId)"
          />
        </button>

        <!-- 文本生成产物（无文件）：文本图标占位，点击打开任务详情查看全文 -->
        <button
          v-else-if="resultTextOf(t)"
          type="button"
          class="task-history__thumb task-history__thumb--text"
          :title="`文本产物：${textSummary(resultTextOf(t))}`"
          @click="openLogs(t)"
        >
          <v-icon
            icon="mdi-text-box-outline"
            size="18"
          />
        </button>

        <!-- 无产物（失败任务 / 音频 / 非媒体）：占位同宽，保证各行文字左边界对齐 -->
        <div
          v-else
          class="task-history__thumb task-history__thumb--empty"
          aria-hidden="true"
        >
          <v-icon
            icon="mdi-image-off-outline"
            size="18"
          />
        </div>

        <div class="task-history__detail">
          <!-- 第一行：状态 + 工作流 + 时间 + 日志入口（全部定宽/省略，不换行） -->
          <div class="task-history__head">
            <v-chip
              :color="statusColor(t.status)"
              size="x-small"
              variant="tonal"
              class="task-history__chip"
            >
              {{ statusLabel(t.status) }}
            </v-chip>
            <span
              class="task-history__name"
              :title="t.workflowId"
            >{{ t.workflowId }}</span>
            <v-spacer />
            <span class="task-history__time">{{ formatDateTime(t.createdAt) }}</span>
            <v-btn
              icon="mdi-text-box-search-outline"
              size="x-small"
              variant="text"
              color="primary"
              aria-label="查看日志"
              title="查看日志"
              class="task-history__logs-btn"
              @click="openLogs(t)"
            />
          </div>
          <!-- 第二行：定位 · 实现简称 · 产物文件名或错误原因（单行省略，完整文本进 title） -->
          <div
            class="task-history__line"
            :title="rowSecondaryTooltip(t)"
          >
            {{ rowSecondaryText(t) }}
          </div>
        </div>
      </div>

      <!--
        尾部状态区（组件 end side）。intersect 模式下 #error 槽**不可省**：
        缺少它时组件在 error 状态下什么都不渲染，且不再自动加载（永久卡死）。
      -->
      <template #loading>
        <!--
          注意：intersect 模式下组件对 `ok`（空闲）状态**同样**渲染 #loading 槽，
          因此必须用 loadingMore 自行判断，否则列表底部会永久挂着一个转圈。
        -->
        <div
          v-if="loadingMore"
          class="task-history__tail"
        >
          <v-progress-circular
            indeterminate
            color="primary"
            size="16"
            class="mr-2"
          />
          <span class="text-body-small text-medium-emphasis">正在加载…</span>
        </div>
      </template>
      <template #empty>
        <div class="task-history__tail text-body-small text-medium-emphasis">
          已显示全部 {{ total }} 个任务
        </div>
      </template>
      <template #error="{ props: slotProps }">
        <div class="task-history__tail">
          <span class="text-body-small text-error mr-2">加载失败：{{ moreError }}</span>
          <v-btn
            size="x-small"
            variant="text"
            color="primary"
            @click="slotProps.onClick"
          >
            重试
          </v-btn>
        </div>
      </template>
    </v-infinite-scroll>

    <!-- 产物放大预览（图片/视频；与完成通知气泡共用同一组件） -->
    <CanvasMediaPreviewDialog
      v-model="preview.show"
      :url="preview.url"
      :kind="preview.kind"
      :title="preview.title"
      :file-name="preview.fileName"
    />

    <!-- 任务详情：状态 / 耗时 / 错误摘要 + 日志（与画布节点「详情」共用同一对话框） -->
    <CanvasNodeLogDialog
      v-model="logDialog.show"
      :task-id="logDialog.taskId"
      :node-name="logDialog.name"
    />
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import CanvasMediaPreviewDialog from '../canvas/CanvasMediaPreviewDialog.vue'
import CanvasNodeLogDialog from '../canvas/CanvasNodeLogDialog.vue'
import { listTasks, type TaskResponse } from '../../api/workflow'
import { mediaKindOfPath, type MediaKind } from '../../canvas/preview'
import { workflowFinishedTick } from '../../canvas/notify'
import {
  artifactName,
  formatDateTime,
  previewUrlOf,
  resultPathOf,
  resultTextOf,
  rowSecondaryText,
  rowSecondaryTooltip,
  textSummary,
  thumbKindOf,
  thumbPathOf,
} from './historyFormat'

const props = defineProps<{
  /** 面板是否可见（不可见时不因自动刷新打断；首次可见才做首批加载） */
  active: boolean
  /**
   * 外部刷新令牌（自增即重新拉取第一页）：
   * 完成气泡的「查看日志」与「进行中」页签的「查看最近完成 →」都需要拿到最新列表，
   * 而本面板只在首次激活时自动加载。
   */
  reloadToken?: number
}>()

/** 每批条数（首批与后续追加同批大小） */
const PAGE_SIZE = 30

/** 无限滚动 done() 的状态（与 Vuetify 内部 InfiniteScrollStatus 一致；该类型未从 vuetify/components 导出） */
type LoadStatus = 'ok' | 'empty' | 'loading' | 'error'

/** 时间范围选项（value = 最近天数；0 = 不限） */
const dayOptions = [
  { label: '最近 1 天', value: 1 },
  { label: '最近 3 天', value: 3 },
  { label: '最近 7 天', value: 7 },
  { label: '最近 14 天', value: 14 },
  { label: '最近 30 天', value: 30 },
  { label: '不限时间', value: 0 },
]

/** 状态选项（value = 服务端状态；'' = 全部） */
const statusOptions = [
  { label: '全部状态', value: '' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' },
  { label: '运行中', value: 'running' },
  { label: '排队中', value: 'pending' },
]

/**
 * 筛选条件。
 *
 * 仅有时间范围与状态两项：「项目」筛选已移除（见 `docs/task-manager/ui.md` 的设计取舍），
 * 服务端 `GET /api/workflow/tasks` 的 `project` 参数本身保留给其他调用方。
 */
const filters = reactive({ days: 14, status: '' })

/** 已加载的任务（滚动加载累积，按 taskId 去重） */
const tasks = ref<TaskResponse[]>([])
/** 满足当前筛选条件的任务总数（服务端返回；用于判断是否还有更多） */
const total = ref(0)
/** 首批/刷新是否在请求中 */
const loading = ref(false)
/** 首批加载失败信息（列表保留原有数据） */
const error = ref<string | null>(null)
/** 追加批次失败信息（由无限滚动的 error 槽展示） */
const moreError = ref('')
/** 追加批次是否在请求中（并发保护） */
const loadingMore = ref(false)
/** 首批查询使用的时间下界（追加批次复用，保证 offset 与首批同一边界） */
const sinceIso = ref<string | undefined>(undefined)
/** 列表滚动位置（自动刷新时判断用户是否正在翻看旧任务） */
const lastScrollTop = ref(0)
/** 列表重建键：自增即重建 <v-infinite-scroll>（复位其 empty/error 状态与滚动位置） */
const listKey = ref(0)
/**
 * 缩略图加载失败的任务 id 集合。
 *
 * 任务行永不删除，而其产物所在项目可能已被删除/回收（`assert/...` 404），
 * 这类行回退为「无产物」占位样式，避免显示成一块黑方块。
 */
const brokenThumbs = ref<Set<string>>(new Set())

/** 产物放大预览对话框状态（图片/视频；点缩略图打开） */
const preview = reactive({
  show: false,
  url: '',
  kind: 'image' as Extract<MediaKind, 'image' | 'video'>,
  title: '',
  fileName: '',
})

/** 任务详情对话框状态（状态/耗时/错误摘要 + 日志） */
const logDialog = reactive({
  show: false,
  taskId: null as string | null,
  name: '',
})

/**
 * 组装查询参数（筛选 + 时间下界 + 分页）。
 *
 * @param offset 起始偏移（首批 0，追加批次为已加载条数）
 * @returns `listTasks` 的查询参数
 */
function queryParams(offset: number): { status?: string, since?: string, limit: number, offset: number } {
  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(sinceIso.value ? { since: sinceIso.value } : {}),
    limit: PAGE_SIZE,
    offset,
  }
}

/**
 * 拉取第一页并重建列表（筛选变化 / 手动刷新 / 外部令牌 / 自动刷新都走这里）。
 */
async function reload(): Promise<void> {
  loading.value = true
  error.value = null
  moreError.value = ''
  try {
    // 时间下界在首批固定：追加批次若重算，边界漂移会让 offset 与已加载数据错位
    sinceIso.value = filters.days > 0
      ? new Date(Date.now() - filters.days * 86400000).toISOString()
      : undefined
    const result = await listTasks(queryParams(0))
    tasks.value = result.tasks
    total.value = result.total
    lastScrollTop.value = 0
    listKey.value += 1
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    console.error('[task-history] 读取历史任务失败:', e)
  } finally {
    loading.value = false
  }
}

/**
 * 无限滚动回调：滚动到底（提前 120px）追加下一批。
 *
 * `done(status)` 的语义：`ok` = 还有更多（组件会在 3 帧后重新检查哨兵，首屏不满自动续拉）、
 * `empty` = 已全部加载（收敛，不再自动触发）、`error` = 失败（渲染 error 槽等待用户重试）。
 *
 * @param options 组件回调参数（只需 `done`）
 */
async function onLoadMore({ done }: { done: (status: LoadStatus) => void }): Promise<void> {
  if (tasks.value.length >= total.value) {
    done('empty')
    return
  }
  if (loadingMore.value) {
    // 上一批仍在请求中：交给组件下一轮再查
    done('ok')
    return
  }
  loadingMore.value = true
  try {
    const batch = await listTasks(queryParams(tasks.value.length))
    const seen = new Set(tasks.value.map((t) => t.taskId))
    const added = batch.tasks.filter((t) => !seen.has(t.taskId))
    tasks.value = [...tasks.value, ...added]
    total.value = batch.total
    moreError.value = ''
    // 没有新增（整页都是重复项）也收敛，避免哨兵始终可见时的无限续查
    done(added.length > 0 && tasks.value.length < total.value ? 'ok' : 'empty')
  } catch (e) {
    moreError.value = e instanceof Error ? e.message : String(e)
    console.error('[task-history] 加载更多失败:', e)
    done('error')
  } finally {
    loadingMore.value = false
  }
}

/**
 * 记录列表滚动位置（自动刷新时据此判断用户是否正在翻看旧任务）。
 *
 * @param e 滚动事件
 */
function onScroll(e: Event): void {
  lastScrollTop.value = (e.target as HTMLElement | null)?.scrollTop ?? 0
}

/**
 * 打开产物放大预览（图片/视频）。
 *
 * @param t 任务响应
 */
function openPreview(t: TaskResponse): void {
  const path = thumbPathOf(t)
  if (!path) return
  preview.url = previewUrlOf(t)
  preview.kind = thumbKindOf(t)
  preview.title = `${t.workflowId} · ${artifactName(t)}`
  preview.fileName = artifactName(t)
  preview.show = true
}

/**
 * 打开「任务详情」对话框（状态 / 耗时 / 错误摘要 + 日志）。
 *
 * @param t 任务响应
 */
function openLogs(t: TaskResponse): void {
  logDialog.taskId = t.taskId
  logDialog.name = t.workflowId
  logDialog.show = true
}

/**
 * 标记某任务的缩略图加载失败（产物文件不存在：项目已删除/被回收）。
 *
 * 浏览器对 404 的报错无法拦截，这里只负责把该行切回占位样式。
 *
 * @param taskId 任务 id
 */
function markThumbBroken(taskId: string): void {
  brokenThumbs.value = new Set(brokenThumbs.value).add(taskId)
}

/**
 * 任务状态中文标签。
 *
 * @param status 服务端状态
 * @returns 中文标签
 */
function statusLabel(status: string): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'running') return '运行中'
  if (status === 'pending') return '排队中'
  return status
}

/**
 * 任务状态对应颜色。
 *
 * @param status 服务端状态
 * @returns Vuetify 颜色名
 */
function statusColor(status: string): string {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'error'
  return 'primary'
}

/** 页签首次激活时加载首批（已有数据则保持，避免每次切页签都重查） */
watch(
  () => props.active,
  (active) => {
    if (!active || tasks.value.length > 0 || loading.value) return
    void reload()
  },
  { immediate: true },
)

/** 外部刷新令牌变化（「查看最近完成 →」/ 完成气泡「查看日志」）：重新拉取第一页 */
watch(
  () => props.reloadToken,
  (token) => {
    if (!token) return
    void reload()
  },
)

/**
 * 工作流任务收敛（成功 / 失败 / 用户中断）→ 刷新历史列表。
 *
 * 历史数据来自 SQLite，不会自动感知新任务；本监听与抽屉开关无关（抽屉关闭期间完成的任务，
 * 下次展开「历史」看到的就是最新列表）。用户正滚动翻看旧任务时不打断——顶部新任务由右下角
 * 完成气泡负责提醒；抽屉停在「进行中」页签时照常刷新，保证切回「历史」即为最新。
 */
watch(workflowFinishedTick, () => {
  if (props.active && lastScrollTop.value > 4) return
  void reload()
})
</script>

<style scoped>
/* 面板满高三段式：筛选条固定 + 列表撑满内部滚动 + 尾部状态区随列表 */
.task-history {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 4px 16px 8px;
}

.task-history__filters {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.task-history__filter {
  flex: 1 1 0;
  min-width: 96px;
}

.task-history__center {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* 滚动容器由 <v-infinite-scroll> 根元素承担（flex 撑满剩余高度 + 自带 overflow-y） */
.task-history__list {
  flex: 1 1 auto;
  min-height: 0;
  gap: 6px;
}

/* 组件的 side 区自带 8px 内边距，会与行内边距叠加：清零后用 .task-history__tail 控制 */
.task-history__list :deep(.v-infinite-scroll__side) {
  padding: 0;
}

.task-history__row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 4px;
}

.task-history__thumb {
  flex: 0 0 auto;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  overflow: hidden;
  background: #111;
  cursor: zoom-in;
}

.task-history__thumb img,
.task-history__thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* 无产物占位：虚框 + 低对比图标，只占位不抢视觉（让有/无缩略图的行文字左边界一致） */
.task-history__thumb--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: dashed;
  border-color: rgba(0, 0, 0, 0.1);
  background: transparent;
  color: rgba(0, 0, 0, 0.26);
  cursor: default;
}

/* 文本产物占位（无文件产物）：浅底 + 文本图标，点击打开任务详情查看全文 */
.task-history__thumb--text {
  display: flex;
  align-items: center;
  justify-content: center;
  border-color: rgba(var(--v-theme-primary), 0.35);
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
}

.task-history__detail {
  flex: 1 1 auto;
  min-width: 0;
}

.task-history__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* 状态 chip 不参与收缩：否则会被长工作流名挤成一字一行的竖排 */
.task-history__chip {
  flex: 0 0 auto;
  white-space: nowrap;
}

.task-history__name {
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-history__time {
  flex: 0 0 auto;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
  white-space: nowrap;
}

.task-history__logs-btn {
  flex: 0 0 auto;
}

/* 第二行强制单行省略：完整文本通过 title 悬浮查看 */
.task-history__line {
  margin-top: 2px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.6);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-history__tail {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
}
</style>
