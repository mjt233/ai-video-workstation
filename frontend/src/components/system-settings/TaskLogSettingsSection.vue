<template>
  <!--
    系统设置「日志」子类：任务日志（data/workflow.db 的 task_logs）保留期与手动清理。
    自动清理的定时触发由服务端 `system/log-scheduler.ts` 负责（默认每 24 小时一次）。
  -->
  <div class="task-log-settings">
    <p class="text-body-small text-medium-emphasis mb-4">
      任务日志记录每次 AI 生成 / 视频处理任务的执行过程（提交、进度、产物落盘、失败原因），
      保存在 <code>data/workflow.db</code> 的 <code>task_logs</code> 表中，可在「任务管理器 → 历史」中查看。
      开启自动清理后，服务端按「执行间隔」删除**已结束任务**超过保留期的日志并回收磁盘占用；
      <strong>运行中任务的日志永不删除</strong>，任务记录与生成产物也不受影响。
    </p>

    <!-- 占用统计 -->
    <v-card
      v-if="stats"
      variant="outlined"
      class="mb-4 pa-3"
    >
      <div class="text-subtitle-2 mb-2">
        当前占用
      </div>
      <div class="task-log-settings__stats">
        <div>日志行数：{{ stats.totalRows.toLocaleString() }} 行</div>
        <div>表 + 索引占用：{{ formatBytes(stats.tableBytes + stats.indexBytes) }}</div>
        <div>数据库文件占用：{{ formatBytes(stats.fileBytes) }}</div>
        <div>最早日志：{{ stats.oldestAt ? formatDateTime(stats.oldestAt) : '—' }}</div>
        <div>可清理（超期终态日志）：{{ stats.cleanableRows.toLocaleString() }} 行</div>
        <div>运行中任务日志（受保护）：{{ stats.activeRows.toLocaleString() }} 行</div>
        <div>上次清理：{{ stats.lastRunAt ? formatDateTime(stats.lastRunAt) : '从未执行' }}</div>
        <div>下次清理：{{ stats.nextRunAt ? formatDateTime(stats.nextRunAt) : '未启用' }}</div>
      </div>
      <div
        v-if="stats.freelistCount > 0"
        class="text-body-small text-medium-emphasis mt-2"
      >
        提示：有 {{ stats.freelistCount }} 个空闲页（{{ formatBytes(stats.freelistBytes) }}）待回收，
        执行一次清理即可归还磁盘。
      </div>
    </v-card>

    <!-- 配置表单 -->
    <v-form
      ref="formRef"
      @submit.prevent="() => void save()"
    >
      <v-switch
        v-model="form.enabled"
        label="启用定时自动清理"
        color="primary"
        density="comfortable"
        hide-details
        class="mb-2"
      />
      <v-text-field
        v-model.number="form.intervalHours"
        type="number"
        label="执行间隔"
        suffix="小时"
        variant="outlined"
        density="comfortable"
        :rules="[intervalRule]"
        :disabled="!form.enabled"
        hint="距上次执行达到该间隔即触发一轮清理"
        persistent-hint
        class="mb-2"
      />
      <v-text-field
        v-model.number="form.retentionDays"
        type="number"
        label="日志保留期"
        suffix="天"
        variant="outlined"
        density="comfortable"
        :rules="[retentionRule]"
        hint="已结束任务的日志超过该天数会被清理（任务管理器「历史」仍可列出任务本身）"
        persistent-hint
        class="mb-2"
      />
      <v-text-field
        v-model.number="form.heartbeatSeconds"
        type="number"
        label="轮询心跳间隔"
        suffix="秒"
        variant="outlined"
        density="comfortable"
        :rules="[heartbeatRule]"
        hint="生成任务轮询期间状态不变时，每隔该秒数记录一条心跳日志；0 = 不记录（日志量最小）"
        persistent-hint
        class="mb-2"
      />

      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-2"
      >
        {{ error }}
      </v-alert>

      <div class="d-flex align-center flex-wrap ga-2">
        <v-btn
          type="submit"
          color="primary"
          variant="flat"
          :loading="saving"
          :disabled="!isDirty"
        >
          保存配置
        </v-btn>
        <v-btn
          variant="text"
          :disabled="!isDirty || saving"
          @click="resetForm"
        >
          放弃修改
        </v-btn>
        <v-spacer />
        <v-btn
          variant="tonal"
          color="primary"
          :loading="cleaning"
          @click="() => void onClean()"
        >
          立即清理超期日志
        </v-btn>
        <v-btn
          variant="tonal"
          color="error"
          :loading="purging"
          @click="() => void onPurge()"
        >
          清空历史日志
        </v-btn>
      </div>
    </v-form>

    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color"
      timeout="4000"
      location="bottom"
    >
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  cleanTaskLogs,
  getSystemSettings,
  purgeTaskLogs,
  updateSystemSettings,
  type TaskLogStats,
} from '../../api/system'
import { confirm } from '../../utils/confirm'

/** 任务日志占用统计（未加载时为 null） */
const stats = ref<TaskLogStats | null>(null)

/** 表单可编辑字段（字符串/数字混用：v-text-field number 修饰符保留数字） */
const form = reactive({
  enabled: true,
  intervalHours: 24,
  retentionDays: 14,
  heartbeatSeconds: 60,
})

/** 已保存的值（用于「是否有修改」判定与放弃修改） */
const saved = reactive({ ...form })

/** 是否正在保存 */
const saving = ref(false)
/** 是否正在执行「立即清理」 */
const cleaning = ref(false)
/** 是否正在执行「清空历史日志」 */
const purging = ref(false)
/** 操作失败信息 */
const error = ref('')
/** 操作反馈 */
const snackbar = reactive({ show: false, text: '', color: 'success' })

/** 表单是否有未保存修改 */
const isDirty = computed(() =>
  form.enabled !== saved.enabled
  || Number(form.intervalHours) !== saved.intervalHours
  || Number(form.retentionDays) !== saved.retentionDays
  || Number(form.heartbeatSeconds) !== saved.heartbeatSeconds,
)

/** 执行间隔校验规则（1~720 小时） */
const intervalRule = (v: unknown): string | boolean =>
  Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 720 ? true : '必须是 1~720 之间的整数（小时）'

/** 保留期校验规则（1~3650 天） */
const retentionRule = (v: unknown): string | boolean =>
  Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 3650 ? true : '必须是 1~3650 之间的整数（天）'

/** 心跳间隔校验规则（0~3600 秒；0 = 不写心跳） */
const heartbeatRule = (v: unknown): string | boolean =>
  Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 3600 ? true : '必须是 0~3600 之间的整数（秒）'

/**
 * 加载系统设置与统计。
 */
async function load(): Promise<void> {
  try {
    const payload = await getSystemSettings()
    stats.value = payload.taskLogStats
    const auto = payload.settings.taskLog.autoClean
    form.enabled = auto.enabled
    form.intervalHours = auto.intervalHours
    form.retentionDays = auto.retentionDays
    form.heartbeatSeconds = payload.settings.taskLog.heartbeatSeconds
    Object.assign(saved, { ...form })
  } catch (e) {
    console.error('[task-log-settings] 加载配置失败:', e)
    error.value = '加载任务日志配置失败，请查看浏览器控制台日志'
  }
}

/** 放弃未保存的修改 */
function resetForm(): void {
  Object.assign(form, { ...saved })
  error.value = ''
}

/**
 * 保存配置。
 */
async function save(): Promise<void> {
  if (!isDirty.value) return
  saving.value = true
  error.value = ''
  try {
    const payload = await updateSystemSettings({
      taskLog: {
        autoClean: {
          enabled: form.enabled,
          intervalHours: Number(form.intervalHours),
          retentionDays: Number(form.retentionDays),
        },
        heartbeatSeconds: Number(form.heartbeatSeconds),
      },
    })
    stats.value = payload.taskLogStats
    const auto = payload.settings.taskLog.autoClean
    Object.assign(saved, {
      enabled: auto.enabled,
      intervalHours: auto.intervalHours,
      retentionDays: auto.retentionDays,
      heartbeatSeconds: payload.settings.taskLog.heartbeatSeconds,
    })
    notify('任务日志配置已保存（服务端即时生效，无需重启）')
  } catch (e) {
    console.error('[task-log-settings] 保存配置失败:', e)
    error.value = '保存配置失败，请检查数值范围后重试'
  } finally {
    saving.value = false
  }
}

/**
 * 立即清理超期日志（忽略「启用」开关，沿用配置的保留期）。
 */
async function onClean(): Promise<void> {
  const cleanable = stats.value?.cleanableRows ?? 0
  const ok = await confirm({
    title: '确认清理超期任务日志',
    content: `将删除已结束任务中超过保留期（${Number(form.retentionDays)} 天）的日志，`
      + `当前可清理约 ${cleanable.toLocaleString()} 行。\n`
      + '运行中任务的日志不会删除；任务记录与生成产物不受影响。此操作不可撤销。',
    confirmText: '立即清理',
    confirmColor: 'primary',
  })
  if (!ok) return
  cleaning.value = true
  error.value = ''
  try {
    const result = await cleanTaskLogs()
    notify(
      result.deleted > 0
        ? `已清理 ${result.deleted.toLocaleString()} 行日志，库占用 ${formatBytes(result.allocatedBytesBefore)} → ${formatBytes(result.allocatedBytesAfter)}`
        : '没有超期日志需要清理',
    )
    await load()
  } catch (e) {
    console.error('[task-log-settings] 清理任务日志失败:', e)
    error.value = '清理失败，请查看浏览器控制台日志'
  } finally {
    cleaning.value = false
  }
}

/**
 * 清空全部已终态任务日志（运行中任务日志受保护）。
 */
async function onPurge(): Promise<void> {
  const totalRows = stats.value?.totalRows ?? 0
  const activeRows = stats.value?.activeRows ?? 0
  const ok = await confirm({
    title: '确认清空历史任务日志',
    content: `将删除全部**已结束任务**的日志（约 ${Math.max(0, totalRows - activeRows).toLocaleString()} 行，`
      + `不受保留期限制）。\n运行中任务的 ${activeRows.toLocaleString()} 行日志会保留；`
      + '任务记录与生成产物不受影响。此操作不可撤销。',
    confirmText: '清空日志',
    confirmColor: 'error',
  })
  if (!ok) return
  purging.value = true
  error.value = ''
  try {
    const result = await purgeTaskLogs()
    notify(`已清空 ${result.deleted.toLocaleString()} 行历史日志（保留运行中 ${(result.protectedRows ?? 0).toLocaleString()} 行）`)
    await load()
  } catch (e) {
    console.error('[task-log-settings] 清空任务日志失败:', e)
    error.value = '清空失败，请查看浏览器控制台日志'
  } finally {
    purging.value = false
  }
}

/**
 * 显示操作反馈。
 *
 * @param text 提示文案
 * @param color 颜色（默认 success）
 */
function notify(text: string, color = 'success'): void {
  snackbar.text = text
  snackbar.color = color
  snackbar.show = true
}

/**
 * 字节数格式化。
 *
 * @param bytes 字节数
 * @returns 人类可读文本
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`
}

/**
 * 时间格式化（支持 SQLite UTC 串与 ISO 串，转本地时间展示）。
 *
 * @param raw 时间字符串
 * @returns `YYYY-MM-DD HH:MM`；无法解析时原样返回
 */
function formatDateTime(raw: string): string {
  const parsed = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`)
  if (Number.isNaN(parsed)) return raw
  const d = new Date(parsed)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(() => {
  void load()
})
</script>

<style scoped>
.task-log-settings__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 4px 16px;
  font-size: 13px;
}
</style>
