<template>
  <v-dialog
    :model-value="modelValue"
    max-width="600"
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>
        {{ mode === 'add' ? '新增台词' : '编辑台词' }}
      </v-card-title>
      <v-card-text>
        <v-select
          v-model="form.角色名"
          :items="characterNames"
          label="角色"
          variant="outlined"
          density="comfortable"
          class="mb-3"
          no-data-text="暂无角色，请先创建角色档案"
        />
        <div class="mb-3">
          <v-text-field
            v-model="form.情绪"
            variant="outlined"
            density="comfortable"
            label="情绪"
            placeholder="输入或点击下方预设情绪"
            hide-details
            class="mb-2"
          />
          <div class="d-flex flex-wrap ga-1">
            <v-chip
              v-for="emotion in presetEmotions"
              :key="emotion"
              size="small"
              :color="form.情绪 === emotion ? 'primary' : undefined"
              :variant="form.情绪 === emotion ? 'tonal' : 'outlined'"
              @click="form.情绪 = emotion"
            >
              {{ emotion }}
            </v-chip>
          </div>
        </div>
        <v-textarea
          v-model="form.台词"
          label="台词"
          variant="outlined"
          rows="4"
          auto-grow
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="$emit('update:modelValue', false)"
        >
          取消
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!form.角色名"
          @click="doSave"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

export interface ScriptFormData {
  角色名: string
  台词: string
  情绪: string
}

const props = defineProps<{
  modelValue: boolean
  mode: 'add' | 'edit'
  entry?: ScriptFormData | null
  characterNames: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [data: ScriptFormData]
}>()

const presetEmotions = [
  '平静', '开心', '悲伤', '愤怒', '惊讶', '害怕',
  '激动', '温柔', '严肃', '无奈', '尴尬', '疑惑',
  '嘲讽', '深情', '冷漠',
]

const form = ref<ScriptFormData>({ 角色名: '', 台词: '', 情绪: '' })

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      if (props.mode === 'edit' && props.entry) {
        form.value = { ...props.entry }
      } else {
        form.value = { 角色名: '', 台词: '', 情绪: '' }
      }
    }
  },
)

function doSave() {
  if (!form.value.角色名) return
  emit('save', {
    角色名: form.value.角色名,
    台词: form.value.台词 ?? '',
    情绪: form.value.情绪 ?? '',
  })
}
</script>
