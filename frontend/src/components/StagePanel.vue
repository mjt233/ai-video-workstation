<template>
  <div ref="panelRef">
    <div
      v-if="!props.subscene"
      class="d-flex align-center justify-center text-grey"
      style="min-height: 200px;"
    >
      请从左侧资产浏览器选择子场景
    </div>

    <template v-else>
      <div class="text-subtitle-1 font-weight-medium mb-2">
        {{ props.subscene }}
      </div>

      <div
        ref="contentRef"
        :style="{ maxHeight: targetHeight + 'px' }"
        style="overflow: auto;"
      >
        <v-row
          v-show="selected"
          class="ma-0"
          no-gutters
        >
          <v-col
            cols="6"
            class="d-flex flex-column"
            style="overflow-y: auto;"
          >
            <div class="d-flex mt-2 mb-2">
              <v-btn
                size="small"
                @click="editPrompt"
              >
                编辑
              </v-btn>
            </div>
            <MarkdownView :content="selected?.promptMd || ''" />
          </v-col>

          <v-col
            cols="6"
            class="d-flex flex-column align-center"
            style="overflow-y: auto;"
          >
            <div class="d-flex justify-center mb-4 mt-2">
              <v-btn
                size="small"
                color="primary"
                variant="tonal"
                prepend-icon="mdi-auto-fix"
                :disabled="!selected"
                @click="genDialog = true"
              >
                生成图片
              </v-btn>
            </div>
            <v-img
              v-if="selected?.imageUrl"
              :src="selected.imageUrl"
              contain
              width="100%"
              max-height="65vh"
            />
            <div
              v-else
              class="text-grey"
            >
              暂无图片
            </div>
          </v-col>
        </v-row>

        <div
          v-if="!selected && loadError"
          class="text-grey mt-4"
        >
          {{ loadError }}
        </div>
      </div>
    </template>

    <v-dialog
      v-model="dialog.show"
      max-width="800"
    >
      <v-card>
        <v-card-title>编辑 Prompt</v-card-title>
        <v-card-text>
          <v-textarea
            v-model="dialog.content"
            rows="15"
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="dialog.show = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            @click="savePrompt"
          >
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <GenerateDialog
      v-model="genDialog"
      :project="props.project"
      workflow-id="stage-image"
      workflow-name="场景图片生成"
      :vars="{ name: props.name, label: selected?.label ?? props.subscene ?? '' }"
      :output-path="`assert/stage/${props.name}/${selected?.label ?? props.subscene}.jpg`"
      :prompt-paths="[`prompt/stage/${props.name}/${selected?.label ?? props.subscene}.md`]"
      :existing-asset="selected?.imageUrl ? '已有图片' : undefined"
      @refresh="load"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { readFs, writeFs, existsFs } from '../api/client'
import MarkdownView from './MarkdownView.vue'
import { useAutoComputeHeight } from '../composables/useAutoComputeHeight'
import GenerateDialog from './GenerateDialog.vue'

interface SubScene {
  label: string
  promptMd: string
  imageUrl: string
}

interface DialogState {
  show: boolean
  content: string
}

const props = defineProps<{
  project: string
  name: string
  subscene?: string
}>()

const selected = ref<SubScene | null>(null)
const loadError = ref('')
const dialog = ref<DialogState>({ show: false, content: '' })
const genDialog = ref(false)

const panelRef = ref<HTMLElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)

const { targetHeight } = useAutoComputeHeight({
  autoComputeHeight: true,
  computeTarget: () => contentRef.value,
  observeTarget: () => panelRef.value!,
  offset: 0,
})

async function load() {
  selected.value = null
  loadError.value = ''
  if (!props.subscene) return

  try {
    const fileName = `${props.subscene}.md`
    const promptPath = `prompt/stage/${props.name}/${fileName}`
    const assertPath = `assert/stage/${props.name}/${props.subscene}.jpg`
    const [promptMd, hasImage] = await Promise.all([
      readFs(props.project, promptPath) as Promise<string>,
      existsFs(props.project, assertPath),
    ])
    const imageUrl = hasImage
      ? `/api/fs/${props.project}/${assertPath}?t=${Date.now()}`
      : ''
    selected.value = {
      label: props.subscene,
      promptMd,
      imageUrl,
    }
  } catch {
    loadError.value = '子场景不存在或读取失败'
    selected.value = null
  }
}

function editPrompt() {
  if (!selected.value) return
  dialog.value = { show: true, content: selected.value.promptMd }
}

async function savePrompt() {
  if (!selected.value) return
  const fileName = `${selected.value.label}.md`
  await writeFs(props.project, `prompt/stage/${props.name}/${fileName}`, dialog.value.content)
  selected.value.promptMd = dialog.value.content
  dialog.value.show = false
}

watch(() => [props.project, props.name, props.subscene], load, { immediate: true })
</script>
