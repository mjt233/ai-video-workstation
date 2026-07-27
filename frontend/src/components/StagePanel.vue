<template>
  <div
    ref="panelRef"
  >
    <v-select
      v-model="selected"
      :items="subScenes"
      item-title="label"
      item-value="label"
      placeholder="选择子场景"
      variant="outlined"
      hide-details
      class="flex-shrink-0"
      return-object
    />

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
          <MarkdownView :content="selected && selected.promptMd || ''" />
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
              @click="genDialog = true"
            >
              生成图片
            </v-btn>
          </div>
          <v-img
            v-if="selected && selected.imageUrl"
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
    </div>

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
      :vars="{ name: props.name, label: selected?.label ?? '' }"
      :output-path="`assert/stage/${props.name}/${selected?.label}.jpg`"
      :prompt-paths="[`prompt/stage/${props.name}/${selected?.label}.md`]"
      :existing-asset="selected?.imageUrl ? '已有图片' : undefined"
      @refresh="load"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { readFs, writeFs, existsFs, type DirResponse } from '../api/client'
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

const props = defineProps<{ project: string; name: string }>()
const subScenes = ref<SubScene[]>([])
const selected = ref<SubScene | null>(null)
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
  try {
    const result = await readFs(props.project, `prompt/stage/${props.name}/`) as DirResponse
    const items: SubScene[] = []
    for (const entry of result.entries) {
      if (entry.type === 'file' && entry.name.endsWith('.md')) {
        const label = entry.name.replace(/\.md$/, '')
        const [promptMd, hasImage] = await Promise.all([
          readFs(props.project, `prompt/stage/${props.name}/${entry.name}`) as Promise<string>,
          existsFs(props.project, `assert/stage/${props.name}/${label}.jpg`),
        ])
        const imageUrl = hasImage ? `/api/fs/${props.project}/assert/stage/${props.name}/${label}.jpg?t=${Date.now()}` : ''
        items.push({ label, promptMd, imageUrl })
      }
    }
    subScenes.value = items
    if (items.length) selected.value = items[0]
  } catch {}
}

function editPrompt() {
  dialog.value = { show: true, content: selected.value!.promptMd }
}

async function savePrompt() {
  const fileName = selected.value!.label + '.md'
  await writeFs(props.project, `prompt/stage/${props.name}/${fileName}`, dialog.value.content)
  selected.value!.promptMd = dialog.value.content
  dialog.value.show = false
}

watch(() => [props.project, props.name], load, { immediate: true })
</script>
