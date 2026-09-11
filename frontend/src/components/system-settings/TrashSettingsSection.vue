<template>
  <div>
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-2"
      closable
      @click:close="error = ''"
    >
      {{ error }}
    </v-alert>

    <!-- 自动清理配置 -->
    <v-card
      variant="outlined"
      class="mb-3"
    >
      <v-card-title class="text-body-large">
        自动清理
      </v-card-title>
      <v-card-text class="pt-2">
        <div class="text-body-small text-medium-emphasis mb-3">
          回收站位于 <code>design/.trash/</code>（系统全局，所有项目共用）。开启后服务端按「执行间隔」
          定时清理回收站中超过保留期的文件，并在控制台打印 <code>[trash-auto-clean]</code> 日志。
        </div>

        <v-switch
          v-model="form.enabled"
          label="启用定时自动清理"
          color="primary"
          density="compact"
          hide-details
          class="mb-2"
        />

        <v-row density="compact">
          <v-col
            cols="12"
            sm="6"
          >
            <v-text-field
              v-model.number="form.intervalDays"
              label="执行间隔"
              type="number"
              suffix="天"
              variant="outlined"
              density="compact"
              :min="1"
              :max="3650"
              :error-messages="intervalError"
              hint="默认 7 天执行一次"
              persistent-hint
            />
          </v-col>
          <v-col
            cols="12"
            sm="6"
          >
            <v-text-field
              v-model.number="form.retentionDays"
              label="回收站保留期"
              type="number"
              suffix="天"
              variant="outlined"
              density="compact"
              :min="1"
              :max="3650"
              :error-messages="retentionError"
              hint="移入超过该天数的文件会被彻底删除"
              persistent-hint
            />
          </v-col>
        </v-row>

        <div class="d-flex align-center flex-wrap ga-2 mt-4">
          <v-btn
            color="primary"
            :loading="saving"
            :disabled="!dirty || !formValid"
            @click="save"
          >
            保存配置
          </v-btn>
          <v-btn
            variant="text"
            :disabled="!dirty"
            @click="resetForm"
          >
            撤销修改
          </v-btn>
          <v-spacer />
          <v-btn
            variant="tonal"
            prepend-icon="mdi-broom"
            :loading="cleaning"
            @click="runNow"
          >
            立即清理一次
          </v-btn>
        </div>

        <v-divider class="my-3" />

        <div class="text-body-small text-medium-emphasis">
          <div>上次执行：{{ settings?.settings.trash.lastRunAt ? formatDateTime(settings.settings.trash.lastRunAt) : '从未执行' }}</div>
          <div>下次执行：{{ settings?.nextRunAt ? formatDateTime(settings.nextRunAt) : '待执行（服务端启动后将尽快执行一次）' }}</div>
          <div>回收站占用：{{ settings?.trashStats.count ?? 0 }} 项 · {{ formatBytes(settings?.trashStats.totalSize ?? 0) }}</div>
        </div>
      </v-card-text>
    </v-card>

    <!-- 回收站内容 -->
    <v-card variant="outlined">
      <v-card-title class="d-flex align-center text-body-large">
        回收站内容
        <v-chip
          v-if="trash"
          size="x-small"
          variant="tonal"
          class="ml-2"
        >
          {{ trash.count }} 项 · {{ formatBytes(trash.totalSize) }}
        </v-chip>
        <v-spacer />
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-refresh"
          :loading="loading"
          @click="load"
        >
          刷新
        </v-btn>
        <v-btn
          size="small"
          color="error"
          variant="tonal"
          prepend-icon="mdi-delete-forever"
          :disabled="!trash?.count"
          :loading="purging"
          @click="purgeAll"
        >
          清空回收站
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text class="pt-2">
        <div
          v-if="loading"
          class="d-flex justify-center py-8"
        >
          <v-progress-circular
            indeterminate
            color="primary"
          />
        </div>
        <div
          v-else-if="!trash?.batches.length"
          class="text-center text-grey py-8"
        >
          <v-icon
            icon="mdi-delete-empty-outline"
            size="40"
            color="grey-lighten-1"
          />
          <div class="mt-2">
            回收站为空
          </div>
        </div>
        <v-expansion-panels
          v-else
          multiple
        >
          <v-expansion-panel
            v-for="batch in trash.batches"
            :key="batch.batchId"
          >
            <v-expansion-panel-title>
              <v-icon
                icon="mdi-archive-outline"
                size="small"
                class="mr-2"
                color="primary"
              />
              <span>{{ formatDateTime(batch.createdAt) }}</span>
              <v-chip
                size="x-small"
                variant="tonal"
                class="ml-2"
              >
                {{ batch.count }} 项
              </v-chip>
              <v-chip
                size="x-small"
                variant="tonal"
                color="grey-darken-1"
                class="ml-1"
              >
                {{ formatBytes(batch.size) }}
              </v-chip>
              <v-spacer />
              <v-btn
                size="x-small"
                variant="text"
                color="error"
                class="mr-2"
                :loading="purgingBatchId === batch.batchId"
                @click.stop="purgeBatch(batch)"
              >
                删除该批次
              </v-btn>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-list
                density="compact"
                class="py-0"
              >
                <v-list-item
                  v-for="item in batch.items"
                  :key="item.id"
                  :title="item.relPath.split('/').pop() ?? item.relPath"
                >
                  <v-list-item-subtitle class="d-flex align-center flex-wrap ga-2">
                    <v-chip
                      size="x-small"
                      variant="tonal"
                      color="primary"
                    >
                      {{ item.project }}
                    </v-chip>
                    <span
                      class="text-truncate trash-path"
                      :title="`${item.project}/${item.relPath}`"
                    >
                      {{ item.relPath }}
                    </span>
                    <span class="text-grey">·</span>
                    <span>{{ formatBytes(item.size) }}</span>
                    <span class="text-grey">·</span>
                    <v-tooltip
                      :text="formatDateTime(item.trashedAt)"
                      location="top"
                    >
                      <template #activator="{ props: tip }">
                        <span v-bind="tip">{{ formatRelativeTime(item.trashedAt) }}</span>
                      </template>
                    </v-tooltip>
                    <span class="text-grey">·</span>
                    <span :class="item.expiresInDays <= 0 ? 'text-error' : 'text-medium-emphasis'">
                      {{ item.expiresInDays <= 0 ? '已超期，待自动清理' : `保留 ${item.expiresInDays} 天` }}
                    </span>
                  </v-list-item-subtitle>
                  <template #append>
                    <v-btn
                      size="x-small"
                      variant="text"
                      prepend-icon="mdi-restore"
                      :loading="restoringId === item.id"
                      @click.stop="restoreItem(item)"
                    >
                      恢复
                    </v-btn>
                    <v-btn
                      size="x-small"
                      variant="text"
                      color="error"
                      icon="mdi-delete-forever"
                      title="彻底删除"
                      @click.stop="purgeItem(item)"
                    />
                  </template>
                </v-list-item>
              </v-list>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>
    </v-card>

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
  getSystemSettings,
  getTrash,
  purgeTrash,
  restoreTrash,
  runTrashAutoClean,
  updateSystemSettings,
  type SystemSettingsPayload,
  type TrashBatch,
  type TrashItem,
  type TrashListResult,
} from '../../api/system'
import { confirm } from '../../utils/confirm'
import { formatBytes } from '../../utils/formatBytes'
import { formatDateTime, formatRelativeTime } from '../../utils/relativeTime'

/**
 * 回收站子类：自动清理配置 + 全局回收站内容管理。
 *
 * 回收站为系统级资源（`design/.trash/`，跨项目共享），因此恢复/彻底删除都在此处完成。
 */
const loading = ref(false)
const saving = ref(false)
const cleaning = ref(false)
const purging = ref(false)
const restoringId = ref('')
const purgingBatchId = ref('')
const error = ref('')

/** 系统设置响应（含回收站统计与下次执行时间） */
const settings = ref<SystemSettingsPayload | null>(null)
/** 回收站内容 */
const trash = ref<TrashListResult | null>(null)

/** 可编辑表单（与已保存配置比对判断 dirty） */
const form = reactive({ enabled: true, intervalDays: 7, retentionDays: 7 })

/** 操作反馈 */
const snackbar = reactive({ show: false, text: '', color: 'primary' })

/** 执行间隔校验错误 */
const intervalError = computed(() => (isValidDays(form.intervalDays) ? '' : '须为 1~3650 的整数'))
/** 保留期校验错误 */
const retentionError = computed(() => (isValidDays(form.retentionDays) ? '' : '须为 1~3650 的整数'))
/** 表单是否合法 */
const formValid = computed(() => !intervalError.value && !retentionError.value)

/** 表单是否与已保存配置不同 */
const dirty = computed(() => {
  const saved = settings.value?.settings.trash.autoClean
  if (!saved) return false
  return saved.enabled !== form.enabled
    || saved.intervalDays !== Number(form.intervalDays)
    || saved.retentionDays !== Number(form.retentionDays)
})

/**
 * 判断天数是否合法（1~3650 整数）。
 *
 * @param value 待校验值
 * @returns 合法返回 true
 */
function isValidDays(value: unknown): boolean {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 3650
}

/**
 * 把已保存配置同步到表单。
 */
function resetForm(): void {
  const saved = settings.value?.settings.trash.autoClean
  if (!saved) return
  form.enabled = saved.enabled
  form.intervalDays = saved.intervalDays
  form.retentionDays = saved.retentionDays
}

/**
 * 加载系统设置与回收站内容。
 */
async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [payload, list] = await Promise.all([getSystemSettings(), getTrash()])
    settings.value = payload
    trash.value = list
    resetForm()
  } catch (e) {
    console.error('[trash-settings] 加载回收站失败:', e)
    error.value = '加载回收站数据失败，请查看浏览器控制台日志'
  } finally {
    loading.value = false
  }
}

/**
 * 保存自动清理配置。
 */
async function save(): Promise<void> {
  if (!formValid.value) return
  saving.value = true
  error.value = ''
  try {
    settings.value = await updateSystemSettings({
      trash: {
        enabled: form.enabled,
        intervalDays: Number(form.intervalDays),
        retentionDays: Number(form.retentionDays),
      },
    })
    resetForm()
    snackbar.text = '自动清理配置已保存'
    snackbar.color = 'success'
    snackbar.show = true
  } catch (e) {
    console.error('[trash-settings] 保存配置失败:', e)
    error.value = '保存配置失败，请查看浏览器控制台日志'
  } finally {
    saving.value = false
  }
}

/**
 * 立即执行一次自动清理（按当前保留期删除超期条目，需二次确认）。
 */
async function runNow(): Promise<void> {
  const ok = await confirm({
    title: '确认立即清理',
    content: `将按当前保留期（${Number(form.retentionDays)} 天）彻底删除回收站中已超期的文件，此操作不可撤销。`,
    confirmText: '立即清理',
    confirmColor: 'error',
  })
  if (!ok) return
  cleaning.value = true
  error.value = ''
  try {
    const res = await runTrashAutoClean()
    snackbar.text = `清理完成：删除 ${res.deleted} 个文件，释放 ${formatBytes(res.freed)}`
    snackbar.color = res.deleted ? 'success' : 'primary'
    snackbar.show = true
    await load()
  } catch (e) {
    console.error('[trash-settings] 执行自动清理失败:', e)
    error.value = '执行自动清理失败，请查看浏览器控制台日志'
  } finally {
    cleaning.value = false
  }
}

/**
 * 恢复单个条目到原项目位置。
 *
 * @param item 回收站条目
 */
async function restoreItem(item: TrashItem): Promise<void> {
  restoringId.value = item.id
  error.value = ''
  try {
    const res = await restoreTrash([{ batchId: item.batchId, project: item.project, relPath: item.relPath }])
    if (res.restored.length) {
      snackbar.text = `已恢复到 ${res.restored[0].project}/assert/${res.restored[0].path.replace(/^assert\//, '')}`
      snackbar.color = 'success'
    } else {
      snackbar.text = `恢复失败：${res.skipped[0]?.reason ?? '未知原因'}`
      snackbar.color = 'warning'
    }
    snackbar.show = true
    await load()
  } catch (e) {
    console.error('[trash-settings] 恢复失败:', e)
    error.value = '恢复失败，请查看浏览器控制台日志'
  } finally {
    restoringId.value = ''
  }
}

/**
 * 彻底删除单个条目（不可撤销，需二次确认）。
 *
 * @param item 回收站条目
 */
async function purgeItem(item: TrashItem): Promise<void> {
  const ok = await confirm({
    title: '确认彻底删除',
    content: `将永久删除「${item.relPath.split('/').pop() ?? item.relPath}」（${formatBytes(item.size)}），此操作不可撤销。`,
    confirmText: '彻底删除',
    confirmColor: 'error',
  })
  if (!ok) return
  purging.value = true
  error.value = ''
  try {
    const res = await purgeTrash({
      items: [{ batchId: item.batchId, project: item.project, relPath: item.relPath }],
    })
    snackbar.text = `已彻底删除 ${res.deleted} 个文件，释放 ${formatBytes(res.freed)}`
    snackbar.color = 'success'
    snackbar.show = true
    await load()
  } catch (e) {
    console.error('[trash-settings] 彻底删除失败:', e)
    error.value = '彻底删除失败，请查看浏览器控制台日志'
  } finally {
    purging.value = false
  }
}

/**
 * 彻底删除整个批次（不可撤销，需二次确认）。
 *
 * @param batch 批次
 */
async function purgeBatch(batch: TrashBatch): Promise<void> {
  const ok = await confirm({
    title: '确认删除批次',
    content: `将永久删除批次「${formatDateTime(batch.createdAt)}」下的 ${batch.count} 个文件`
      + `（共 ${formatBytes(batch.size)}），此操作不可撤销。`,
    confirmText: '彻底删除',
    confirmColor: 'error',
  })
  if (!ok) return
  purgingBatchId.value = batch.batchId
  error.value = ''
  try {
    const res = await purgeTrash({ batchId: batch.batchId })
    snackbar.text = `已彻底删除 ${res.deleted} 个文件，释放 ${formatBytes(res.freed)}`
    snackbar.color = 'success'
    snackbar.show = true
    await load()
  } catch (e) {
    console.error('[trash-settings] 删除批次失败:', e)
    error.value = '删除批次失败，请查看浏览器控制台日志'
  } finally {
    purgingBatchId.value = ''
  }
}

/**
 * 清空整个回收站（不可撤销，需二次确认）。
 */
async function purgeAll(): Promise<void> {
  const total = trash.value?.count ?? 0
  const size = trash.value?.totalSize ?? 0
  const ok = await confirm({
    title: '确认清空回收站',
    content: `将永久删除回收站中全部 ${total} 个文件（共 ${formatBytes(size)}），此操作不可撤销。`,
    confirmText: '清空回收站',
    confirmColor: 'error',
  })
  if (!ok) return
  purging.value = true
  error.value = ''
  try {
    const res = await purgeTrash({ all: true })
    snackbar.text = `回收站已清空：删除 ${res.deleted} 个文件，释放 ${formatBytes(res.freed)}`
    snackbar.color = 'success'
    snackbar.show = true
    await load()
  } catch (e) {
    console.error('[trash-settings] 清空回收站失败:', e)
    error.value = '清空回收站失败，请查看浏览器控制台日志'
  } finally {
    purging.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<style scoped>
.trash-path {
  max-width: 420px;
}
</style>
