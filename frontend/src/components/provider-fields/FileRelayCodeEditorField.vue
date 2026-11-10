<template>
  <div class="mt-2">
    <div class="d-flex align-center mb-1">
      <div class="text-body-medium font-weight-medium">
        {{ label || '中转脚本' }}
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
      尚未编写中转脚本，点击「编辑代码」开始编写（对话框内可点「插入模板」快速生成示例）。
    </div>

    <!-- 代码编辑对话框（Monaco + 文件中转上下文类型提示） -->
    <v-dialog
      v-model="dialogOpen"
      max-width="1000"
      scrollable
      persistent
    >
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon
            icon="mdi-cloud-upload-outline"
            class="mr-2"
          />
          编辑{{ label || '中转脚本' }}
          <v-spacer />
          <v-btn
            icon="mdi-close"
            size="small"
            variant="text"
            @click="dialogOpen = false"
          />
        </v-card-title>
        <v-card-text>
          <div class="text-body-2 text-medium-emphasis mb-2">
            脚本在服务端沙箱中执行：export default 一个 async 函数，通过 ctx.file 读取待上传文件、
            ctx.request 发起请求，返回 { url: '公网可访问的 http(s) 地址' }。
          </div>
          <MonacoEditor
            v-model="buffer"
            :extra-libs="LIBS"
            :refresh-key="dialogOpen ? 1 : 0"
            :height="480"
          />
        </v-card-text>
        <v-card-actions>
          <v-btn
            color="secondary"
            variant="tonal"
            prepend-icon="mdi-file-code-outline"
            title="插入中转脚本模板（空编辑器直接填充；已有代码则在末尾追加）"
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
import { insertCodeTemplate } from '../../utils/custom-provider'
import { buildFileRelayContextLib, FILE_RELAY_CODE_TEMPLATE } from '../../utils/file-relay-provider'
import type { ProviderConfigField } from '../../api/providers'

const props = defineProps<{
  /** 当前脚本（v-model，父级 config 字段绑定；非字符串回退为空串） */
  modelValue?: unknown
  /** 字段中文标签 */
  label?: string
  /** 字段说明 */
  description?: string
  /** schema 字段（保持与 component 字段渲染约定一致；本组件固定使用中转脚本模板） */
  field?: ProviderConfigField
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

/** 编辑器类型库（文件中转脚本上下文契约，注册为虚拟 d.ts 供类型提示） */
const LIBS = [{ content: buildFileRelayContextLib(), filePath: 'file-relay-context.d.ts' }]

/** 当前脚本文本（非字符串回退为空串，兼容旧值/空数组兜底） */
const code = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : ''))
/** 是否已编写脚本（空内容时展示引导文案） */
const hasContent = computed(() => code.value.trim() !== '')

/** 是否打开编辑对话框 */
const dialogOpen = ref(false)
/** 对话框内编辑缓冲（打开时初始化，确定时回写） */
const buffer = ref('')

/** 打开对话框：编辑当前脚本（不默认注入模板，由用户点击「插入模板」） */
function openDialog() {
  buffer.value = code.value
  dialogOpen.value = true
}

/** 插入模板：空编辑器直接填充；已有代码则在末尾追加（不覆盖用户内容） */
function insertTemplate() {
  buffer.value = insertCodeTemplate(buffer.value, FILE_RELAY_CODE_TEMPLATE)
}

/** 确定：回写脚本并关闭 */
function save() {
  emit('update:modelValue', buffer.value)
  dialogOpen.value = false
}
</script>
