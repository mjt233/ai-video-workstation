<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    persistent
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          icon="mdi-text-box-multiple-outline"
          class="mr-2"
        />
        {{ isEdit ? '编辑预设提示词' : '新增预设提示词' }}
        <v-spacer />
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-card-text>
        <v-alert
          v-if="error"
          type="error"
          class="mb-3"
          :text="error"
          closable
          @click:close="error = ''"
        />

        <!-- 名称 -->
        <v-text-field
          v-model="form.name"
          label="名称"
          placeholder="如：中文润色 / 英文翻译"
          hint="用于在 AI 文本生成节点中区分预设提示词"
          persistent-hint
          density="comfortable"
          variant="outlined"
          class="mb-2"
        />

        <!-- 提示词内容 -->
        <v-textarea
          v-model="form.content"
          label="提示词内容"
          :rows="10"
          :hint="contentHint"
          persistent-hint
          density="comfortable"
          variant="outlined"
          class="mb-2"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="emit('update:modelValue', false)"
        >
          取消
        </v-btn>
        <v-btn
          color="primary"
          :loading="saving"
          :disabled="!form.name.trim() || !form.content.trim()"
          @click="onSave"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  createPresetPrompt,
  updatePresetPrompt,
  type PresetPrompt,
} from '../../api/presets'
import { USER_PROMPT_PLACEHOLDER } from '../../utils/presetPrompt'

const props = defineProps<{
  modelValue: boolean
  /** 编辑目标预设；null = 新增模式 */
  preset: PresetPrompt | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved'): void
}>()

/** 是否为编辑模式 */
const isEdit = computed(() => !!props.preset)

/** 表单状态 */
const form = ref({ name: '', content: '' })

const error = ref('')
const saving = ref(false)

/** 内容输入框提示文案（说明占位符用法） */
const contentHint = computed(() =>
  `内容中可编写占位符 ${USER_PROMPT_PLACEHOLDER}，生成时将以用户输入替换；无占位符时，用户输入将追加到内容末尾。`,
)

/** 打开时初始化表单（编辑回填；新增清空） */
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    error.value = ''
    form.value = props.preset ? { name: props.preset.name, content: props.preset.content } : { name: '', content: '' }
  },
)

/** 保存：新增或更新预设提示词 */
async function onSave() {
  saving.value = true
  error.value = ''
  try {
    if (props.preset) {
      await updatePresetPrompt(props.preset.id, { name: form.value.name, content: form.value.content })
    } else {
      await createPresetPrompt({ name: form.value.name, content: form.value.content })
    }
    emit('saved')
    emit('update:modelValue', false)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}
</script>
