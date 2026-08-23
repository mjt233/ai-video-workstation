<template>
  <div class="mt-2">
    <div class="d-flex align-center mb-1">
      <div class="text-body-medium font-weight-medium">
        {{ label || '代码' }}
      </div>
      <v-spacer />
      <v-btn
        color="secondary"
        variant="tonal"
        size="small"
        prepend-icon="mdi-code-tags"
        @click="openDialog"
      >
        编辑代码
      </v-btn>
    </div>
    <div
      v-if="description"
      class="text-caption text-medium-emphasis mb-1"
    >
      {{ description }}
    </div>
    <div
      v-if="!hasContent"
      class="text-caption text-medium-emphasis"
    >
      尚未编写代码，点击「编辑代码」开始编写。
    </div>

    <!-- 代码编辑对话框（Monaco） -->
    <v-dialog
      v-model="dialogOpen"
      max-width="1000"
      scrollable
    >
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon
            icon="mdi-code-tags"
            class="mr-2"
          />
          编辑{{ label || '代码' }}
          <v-spacer />
          <v-btn
            icon="mdi-close"
            size="small"
            variant="text"
            @click="dialogOpen = false"
          />
        </v-card-title>
        <v-card-text>
          <div
            v-if="description"
            class="text-body-2 text-medium-emphasis mb-2"
          >
            {{ description }}
          </div>
          <MonacoEditor
            v-model="buffer"
            :extra-libs="libs"
            :refresh-key="dialogOpen ? 1 : 0"
            :height="480"
          />
        </v-card-text>
        <v-card-actions>
          <v-btn
            color="secondary"
            variant="tonal"
            prepend-icon="mdi-file-code-outline"
            :disabled="!templateOf(field?.key)"
            title="插入代码模板（空编辑器直接填充；已有代码则在末尾追加）"
            @click="insertTemplate"
          >
            插入模板
          </v-btn>
          <v-spacer />
          <v-btn
            variant="text"
            @click="dialogOpen = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            @click="save"
          >
            确定
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import MonacoEditor from '../monaco/MonacoEditor.vue'
import {
  buildCommonGlobalsLib,
  buildContextLib,
  COMMON_CODE_TEMPLATE,
  insertCodeTemplate,
  TEST_CODE_TEMPLATE,
} from '../../utils/custom-provider'
import { FALLBACK_WORKFLOW_TYPES } from '../../utils/workflow-types'
import type { ProviderConfigField } from '../../api/providers'

const props = defineProps<{
  /** 当前代码文本（v-model，父级 config 字段绑定） */
  modelValue?: unknown
  /** 字段中文标签 */
  label?: string
  /** 字段说明 */
  description?: string
  /** schema 字段（用于按字段 key 选择默认模板） */
  field?: ProviderConfigField
  /** 通用代码块文本（测试代码等场景注入通用代码导出提示；通用代码块自身不传） */
  commonCode?: unknown
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

/** 当前代码文本（非字符串回退为空串） */
const code = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : ''))
const hasContent = computed(() => code.value.trim() !== '')

/** 是否打开编辑对话框 */
const dialogOpen = ref(false)
/** 对话框内编辑缓冲（打开时初始化，确定时回写） */
const buffer = ref('')

/**
 * 按字段 key 取起始模板：commonCode → 通用代码模板；testCode → 测试代码模板；
 * 其余字段无模板（空内容）。
 */
function templateOf(fieldKey: string | undefined): string {
  if (fieldKey === 'commonCode') return COMMON_CODE_TEMPLATE
  if (fieldKey === 'testCode') return TEST_CODE_TEMPLATE
  return ''
}

/** 编辑器类型库：全量 params 接口 + 上下文声明 + （可选）通用代码导出全局声明 */
const libs = computed(() => {
  const out: Array<{ content: string; filePath: string }> = [
    {
      content: buildContextLib(FALLBACK_WORKFLOW_TYPES),
      filePath: 'custom-context.d.ts',
    },
  ]
  // 测试代码等场景需要提示通用代码导出的函数；通用代码块自身不需要（不传该 prop）
  const common = typeof props.commonCode === 'string' ? props.commonCode : ''
  const globals = buildCommonGlobalsLib(common)
  if (globals.trim()) {
    out.push({ content: globals, filePath: 'custom-common-globals.d.ts' })
  }
  return out
})

/** 打开对话框：编辑当前内容（不默认注入模板，由用户点击「插入模板」） */
function openDialog() {
  buffer.value = code.value
  dialogOpen.value = true
}

/** 插入模板：空编辑器直接填充；已有代码则在末尾追加（不覆盖用户内容） */
function insertTemplate() {
  const template = templateOf(props.field?.key)
  if (!template) return
  buffer.value = insertCodeTemplate(buffer.value, template)
}

/** 确定：回写代码并关闭 */
function save() {
  emit('update:modelValue', buffer.value)
  dialogOpen.value = false
}
</script>
