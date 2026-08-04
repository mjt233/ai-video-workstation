<template>
  <div ref="panelRef">
    <v-tabs v-model="tab">
      <v-tab value="overview">
        子场景
      </v-tab>
      <v-tab value="canvas">
        资产画布
      </v-tab>
    </v-tabs>

    <v-tabs-window v-model="tab">
      <v-tabs-window-item value="overview">
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
                <div class="d-flex justify-center mb-4 mt-2 ga-2 flex-wrap">
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
                  <AssetImageUploadButton
                    :project="props.project"
                    :asset-path="`assert/stage/${props.name}/${selected?.label ?? props.subscene}.jpg`"
                    :disabled="!selected"
                    @uploaded="load"
                  />
                  <v-btn
                    size="small"
                    variant="text"
                    prepend-icon="mdi-history"
                    :disabled="!selected?.imageUrl"
                    @click="openHistory"
                  >
                    历史版本
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

            <VariantPanel
              v-if="selected"
              :project="props.project"
              kind="stage"
              :owner="props.name"
              :base-label="selected.label"
              @refresh="load"
            />

            <div
              v-if="!selected && loadError"
              class="text-grey mt-4"
            >
              {{ loadError }}
            </div>

            <!-- 场景自定义资产：映射到 assert/custom/stage/{name}/（置于滚动容器内，可随内容滚动查看） -->
            <v-divider class="my-4" />
            <div class="text-subtitle-1 font-weight-medium mb-2 d-flex align-center">
              <v-icon
                icon="mdi-folder-star-outline"
                size="small"
                color="primary"
                class="mr-2"
              />
              自定义资产
            </div>
            <div class="text-body-2 text-medium-emphasis mb-2">
              该场景的自定义资产存储在 <code>assert/custom/stage/{{ props.name }}/</code> 下，支持上传、预览与删除。
            </div>
            <CustomAssetSection
              :project="props.project"
              :dir-rel-path="`stage/${props.name}`"
            />
          </div>
        </template>
      </v-tabs-window-item>

      <v-tabs-window-item value="canvas">
        <AssetCanvas
          :project="props.project"
          kind="stage"
          :stage="props.name"
          :label="props.subscene"
        />
      </v-tabs-window-item>
    </v-tabs-window>

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
      workflow-id="text-to-image"
      workflow-name="场景图片生成（文生图）"
      :vars="{
        promptPath: `prompt/stage/${props.name}/${selected?.label ?? props.subscene}.md`,
        purpose: 'stage-image',
        stageName: props.name,
        label: selected?.label ?? props.subscene ?? '',
        name: props.name,
      }"
      :output-path="`assert/stage/${props.name}/${selected?.label ?? props.subscene}.jpg`"
      :prompt-paths="[`prompt/stage/${props.name}/${selected?.label ?? props.subscene}.md`]"
      :existing-asset="selected?.imageUrl ? '已有图片' : undefined"
      @refresh="load"
    />

    <AssetHistoryDialog
      v-model="historyDialog.show"
      :project="props.project"
      :asset-path="historyDialog.path"
      @activated="load"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { readFs, writeFs, existsFs } from '../api/client'
import MarkdownView from './MarkdownView.vue'
import { useAutoComputeHeight } from '../composables/useAutoComputeHeight'
import GenerateDialog from './GenerateDialog.vue'
import AssetHistoryDialog from './AssetHistoryDialog.vue'
import AssetImageUploadButton from './AssetImageUploadButton.vue'
import VariantPanel from './VariantPanel.vue'
import CustomAssetSection from './CustomAssetSection.vue'
import AssetCanvas from './canvas/AssetCanvas.vue'

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

const tab = ref<string | null>(null)
const selected = ref<SubScene | null>(null)
const loadError = ref('')
const dialog = ref<DialogState>({ show: false, content: '' })
const genDialog = ref(false)
const historyDialog = ref<{ show: boolean; path: string }>({ show: false, path: '' })

function openHistory() {
  const label = selected.value?.label ?? props.subscene
  if (!label) return
  historyDialog.value = {
    show: true,
    path: `assert/stage/${props.name}/${label}.jpg`,
  }
}

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
