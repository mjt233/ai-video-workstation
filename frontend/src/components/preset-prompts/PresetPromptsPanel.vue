<template>
  <div class="preset-panel">
    <!-- 顶部：标题 + 新增按钮 -->
    <div class="preset-panel__header">
      <span class="text-body-2 text-medium-emphasis">
        预设提示词为全局共享，所有项目的 AI 文本生成节点均可选择。
      </span>
      <v-spacer />
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        @click="openCreate"
      >
        新增预设提示词
      </v-btn>
    </div>

    <!-- 列表 -->
    <div class="preset-panel__content">
      <v-alert
        v-if="error"
        type="error"
        class="mb-3"
        :text="error"
        closable
        @click:close="error = ''"
      />
      <div
        v-if="loading"
        class="d-flex justify-center pa-6"
      >
        <v-progress-circular indeterminate />
      </div>
      <div
        v-else-if="presets.length === 0"
        class="text-body-2 text-medium-emphasis text-center pa-6"
      >
        尚未添加预设提示词，点击右上角「新增预设提示词」开始配置。
      </div>
      <v-list
        v-else
        lines="two"
        class="preset-panel__list"
      >
        <v-list-item
          v-for="p in presets"
          :key="p.id"
          @click="openEdit(p)"
        >
          <template #prepend>
            <v-icon icon="mdi-text-box-outline" />
          </template>
          <v-list-item-title>{{ p.name }}</v-list-item-title>
          <v-list-item-subtitle class="preset-panel__preview">
            {{ p.content }}
          </v-list-item-subtitle>
          <template #append>
            <v-btn
              icon="mdi-pencil"
              size="small"
              variant="text"
              :title="`编辑预设提示词「${p.name}」`"
              @click.stop="openEdit(p)"
            />
            <v-btn
              icon="mdi-delete"
              size="small"
              variant="text"
              color="error"
              :title="`删除预设提示词「${p.name}」`"
              @click.stop="onDelete(p)"
            />
          </template>
        </v-list-item>
      </v-list>
    </div>

    <PresetPromptEditDialog
      v-model="dialogOpen"
      :preset="editing"
      @saved="onSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { deletePresetPrompt, type PresetPrompt } from '../../api/presets'
import { refreshPresetPrompts, usePresetPrompts } from '../../composables/usePresetPrompts'
import { confirm } from '../../utils/confirm'
import PresetPromptEditDialog from './PresetPromptEditDialog.vue'

/** 预设提示词列表（共享缓存） */
const presets = usePresetPrompts()

const loading = ref(false)
const error = ref('')

/** 新增/编辑对话框状态 */
const dialogOpen = ref(false)
const editing = ref<PresetPrompt | null>(null)

/** 首次挂载时确定加载状态（缓存可能已在加载中） */
onMounted(() => {
  void load()
})

/** 刷新列表（refreshPresetPrompts 内部已记录失败日志，不抛出） */
async function load() {
  loading.value = true
  try {
    await refreshPresetPrompts()
  } finally {
    loading.value = false
  }
}

/** 打开新增对话框 */
function openCreate() {
  editing.value = null
  dialogOpen.value = true
}

/** 打开编辑对话框 */
function openEdit(p: PresetPrompt) {
  editing.value = p
  dialogOpen.value = true
}

/** 保存成功：刷新列表（节点下拉缓存同步更新） */
function onSaved() {
  void load()
}

/** 删除预设提示词（弹窗确认后执行） */
async function onDelete(p: PresetPrompt) {
  const ok = await confirm({
    title: '删除预设提示词',
    content: `确定删除预设提示词「${p.name}」？使用该预设的 AI 文本生成节点将回退为不使用预设。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  error.value = ''
  try {
    await deletePresetPrompt(p.id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<style scoped>
.preset-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.preset-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.preset-panel__content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-top: 8px;
}

.preset-panel__list {
  padding-top: 0;
}

/* 内容预览：单行截断 */
.preset-panel__preview {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
