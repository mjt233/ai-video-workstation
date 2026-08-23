<template>
  <div class="mt-2">
    <div class="d-flex align-center mb-2">
      <div class="text-body-medium font-weight-medium">
        {{ label || '模型' }}
      </div>
      <v-spacer />
      <v-btn
        color="secondary"
        variant="tonal"
        size="small"
        prepend-icon="mdi-plus"
        @click="addModel"
      >
        添加模型
      </v-btn>
    </div>
    <div
      v-if="description"
      class="text-caption text-medium-emphasis mb-2"
    >
      {{ description }}
    </div>
    <div
      v-if="models.length === 0"
      class="text-body-2 text-medium-emphasis mb-2"
    >
      尚未添加模型。添加后勾选「文生图」或「图片编辑」，保存即可注册对应工作流。
    </div>
    <div
      v-for="(row, index) in models"
      :key="index"
      class="d-flex align-center ga-2 mb-2"
    >
      <v-text-field
        :model-value="row.id"
        label="模型 ID"
        placeholder="如 gpt-image-1"
        density="comfortable"
        variant="outlined"
        hide-details
        class="flex-grow-1"
        @update:model-value="updateId(index, $event)"
      />
      <v-checkbox
        :model-value="row.capabilities.includes('text-to-image')"
        label="文生图"
        hide-details
        density="compact"
        @update:model-value="toggleCapability(index, 'text-to-image', $event)"
      />
      <v-checkbox
        :model-value="row.capabilities.includes('image-edit')"
        label="图片编辑"
        hide-details
        density="compact"
        @update:model-value="toggleCapability(index, 'image-edit', $event)"
      />
      <v-btn
        icon="mdi-delete"
        size="small"
        variant="text"
        color="error"
        :title="`删除模型「${row.id || '未命名'}」`"
        @click="removeModel(index)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { confirm } from '../../utils/confirm'

/** 模型可声明的能力 */
export type OpenAICompatibleCapability = 'text-to-image' | 'image-edit'

/** 一条模型配置（v-model 元素） */
export interface OpenAICompatibleModel {
  /** 对端模型 ID */
  id: string
  /** 勾选的能力；可同时包含文生图与图片编辑 */
  capabilities: OpenAICompatibleCapability[]
}

const props = defineProps<{
  /** 当前模型列表（结构化数组，由父级 v-model 绑定） */
  modelValue?: OpenAICompatibleModel[] | unknown
  /** 字段中文标签 */
  label?: string
  /** 字段说明 */
  description?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: OpenAICompatibleModel[]): void
}>()

/**
 * 把外部 v-model 规范为模型数组（非法值回退为空数组，避免渲染崩溃）。
 */
const models = computed<OpenAICompatibleModel[]>(() => {
  if (!Array.isArray(props.modelValue)) return []
  return props.modelValue.map((item) => normalizeRow(item))
})

/**
 * 规范单行模型：缺字段补默认值，能力只保留合法枚举。
 * @param item 外部传入的一行
 * @returns 可用于编辑的模型行
 */
function normalizeRow(item: unknown): OpenAICompatibleModel {
  if (!item || typeof item !== 'object') return { id: '', capabilities: [] }
  const rec = item as { id?: unknown; capabilities?: unknown }
  const id = typeof rec.id === 'string' ? rec.id : ''
  const capabilities: OpenAICompatibleCapability[] = []
  if (Array.isArray(rec.capabilities)) {
    for (const c of rec.capabilities) {
      if (c === 'text-to-image' || c === 'image-edit') capabilities.push(c)
    }
  }
  return { id, capabilities }
}

/**
 * 向父级回写一份新的模型列表（保持不可变更新）。
 * @param next 新列表
 */
function commit(next: OpenAICompatibleModel[]) {
  emit('update:modelValue', next)
}

/** 追加一行空模型 */
function addModel() {
  commit([...models.value, { id: '', capabilities: [] }])
}

/**
 * 更新指定行的模型 ID。
 * @param index 行下标
 * @param value 新 ID
 */
function updateId(index: number, value: string) {
  const next = models.value.map((row, i) => (i === index ? { ...row, id: value } : row))
  commit(next)
}

/**
 * 切换指定行的能力勾选。
 * @param index 行下标
 * @param cap 能力
 * @param enabled 是否勾选
 */
function toggleCapability(index: number, cap: OpenAICompatibleCapability, enabled: unknown) {
  const on = enabled === true
  const next = models.value.map((row, i) => {
    if (i !== index) return row
    const set = new Set(row.capabilities)
    if (on) set.add(cap)
    else set.delete(cap)
    return { ...row, capabilities: [...set] }
  })
  commit(next)
}

/**
 * 删除指定行（弹窗确认后执行）。
 * @param index 行下标
 */
async function removeModel(index: number) {
  const row = models.value[index]
  const ok = await confirm({
    title: '删除模型',
    content: `确定删除模型「${row?.id || '未命名'}」？保存后对应工作流将注销。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  commit(models.value.filter((_, i) => i !== index))
}
</script>
