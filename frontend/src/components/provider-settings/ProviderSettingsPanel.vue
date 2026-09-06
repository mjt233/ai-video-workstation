<template>
  <div class="provider-panel">
    <!-- 分类页签行：媒体生成 / 大语言模型 + 当前分类的「新增服务商」按钮 -->
    <div class="provider-panel__header">
      <v-tabs
        v-model="activeTab"
        density="comfortable"
        class="provider-panel__tabs"
      >
        <v-tab
          v-for="tab in TABS"
          :key="tab.key"
          :value="tab.key"
        >
          <v-icon
            :icon="tab.icon"
            size="small"
            class="mr-1"
          />
          {{ tab.label }}
        </v-tab>
      </v-tabs>
      <v-spacer />
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        class="mr-1"
        @click="openCreate"
      >
        新增服务商
      </v-btn>
    </div>

    <!-- 当前分类的服务商实例卡片 -->
    <div class="provider-panel__content">
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
      <template v-else>
        <div
          v-if="filteredInstances.length === 0"
          class="text-body-2 text-medium-emphasis text-center pa-6"
        >
          {{ activeTab === 'media'
            ? '尚未添加媒体生成服务商，点击右上角「新增服务商」开始配置。'
            : '尚未添加大语言模型服务商，点击右上角「新增服务商」开始配置。' }}
        </div>
        <div class="d-flex flex-wrap">
          <v-card
            v-for="inst in filteredInstances"
            :key="inst.id"
            class="d-inline-block ma-1"
            style="max-width: 260px;min-width: 260px;"
            variant="outlined"
            @click="openEdit(inst)"
          >
            <v-card-text class="text-caption">
              <div class="d-flex justify-space-between mb-1">
                <span>{{ inst.name }}</span>
                <v-chip
                  size="x-small"
                  variant="tonal"
                  color="secondary"
                  class="mr-1"
                >
                  {{ typeName(inst.type) }}
                </v-chip>
              </div>
            </v-card-text>
            <v-card-actions>
              <v-spacer />
              <v-btn
                icon="mdi-delete"
                size="small"
                variant="text"
                color="error"
                :title="`删除服务商「${inst.name}」`"
                @click.stop="onDelete(inst)"
              />
            </v-card-actions>
          </v-card>
        </div>
      </template>
    </div>

    <ProviderInstanceDialog
      v-model="dialogOpen"
      :types="types"
      :instance="editing"
      :category="activeTab"
      @saved="onSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  deleteProviderInstance,
  getProviders,
  type ProviderInstanceInfo,
  type ProviderTypeInfo,
} from '../../api/providers'
import { confirm } from '../../utils/confirm'
import { refreshLlmProviders } from '../../composables/useLlmProviders'
import ProviderInstanceDialog from '../ProviderInstanceDialog.vue'

/** 分类页签定义（分类 + 显示名 + 图标） */
const TABS: { key: 'media' | 'llm'; label: string; icon: string }[] = [
  { key: 'media', label: '媒体生成', icon: 'mdi-movie-open-outline' },
  { key: 'llm', label: '大语言模型', icon: 'mdi-robot-outline' },
]

/** 当前激活分类 */
const activeTab = ref<'media' | 'llm'>('media')

const types = ref<ProviderTypeInfo[]>([])
const instances = ref<ProviderInstanceInfo[]>([])
const loading = ref(false)
const error = ref('')

/** 新增/编辑对话框状态 */
const dialogOpen = ref(false)
const editing = ref<ProviderInstanceInfo | null>(null)

/** 实例归属分类（类型未加载时按 media 兜底） */
function categoryOf(inst: ProviderInstanceInfo): 'media' | 'llm' {
  return types.value.find((t) => t.id === inst.type)?.category ?? 'media'
}

/** 当前分类的实例列表 */
const filteredInstances = computed(() => instances.value.filter((i) => categoryOf(i) === activeTab.value))

/** 加载服务商类型与实例列表 */
async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await getProviders()
    types.value = data.types
    instances.value = data.instances
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})

/** 打开新增对话框（类型下拉只显示当前分类） */
function openCreate() {
  editing.value = null
  dialogOpen.value = true
}

/** 打开编辑对话框 */
function openEdit(inst: ProviderInstanceInfo) {
  editing.value = inst
  dialogOpen.value = true
}

/** 保存成功：刷新列表；LLM 服务商变化时刷新节点下拉缓存 */
function onSaved() {
  void load()
  void refreshLlmProviders()
}

/** 删除实例（弹窗确认后执行） */
async function onDelete(inst: ProviderInstanceInfo) {
  const ok = await confirm({
    title: '删除服务商',
    content: `确定删除服务商「${inst.name}」？其提供的工作流将不可用。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  error.value = ''
  try {
    await deleteProviderInstance(inst.id)
    await load()
    await refreshLlmProviders()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

/** 类型 id → 类型显示名 */
function typeName(typeId: string): string {
  return types.value.find((t) => t.id === typeId)?.name ?? typeId
}
</script>

<style scoped>
.provider-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.provider-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.provider-panel__tabs {
  flex: 1 1 auto;
  min-width: 0;
}

.provider-panel__content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-top: 8px;
}
</style>
