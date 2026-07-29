<template>
  <div class="mt-4">
    <div class="d-flex align-center mb-2">
      <div class="text-subtitle-2">
        衍生变体
      </div>
      <v-spacer />
      <v-btn
        size="small"
        color="primary"
        variant="tonal"
        prepend-icon="mdi-plus"
        @click="openCreate"
      >
        创建衍生变体
      </v-btn>
    </div>

    <div
      v-if="loading"
      class="text-center py-4"
    >
      <v-progress-circular
        indeterminate
        size="24"
      />
    </div>
    <div
      v-else-if="!variants.length"
      class="text-grey text-body-2 mb-2"
    >
      暂无衍生变体。可为当前{{ kindLabel }}创建变体（如图片编辑描述「门已打开」），生成时使用图片编辑工作流。
    </div>
    <v-row v-else>
      <v-col
        v-for="v in variants"
        :key="v.id"
        cols="12"
        md="6"
      >
        <v-card
          variant="outlined"
          class="pa-3"
        >
          <div class="d-flex align-center mb-2">
            <div class="text-body-1 font-weight-medium">
              {{ v.id }}
            </div>
            <v-chip
              size="x-small"
              class="ml-2"
              :color="v.hasImage ? 'success' : 'grey'"
              variant="tonal"
            >
              {{ v.hasImage ? '已有图' : '未生成' }}
            </v-chip>
            <v-spacer />
            <v-btn
              size="x-small"
              variant="text"
              icon="mdi-pencil"
              @click="openEdit(v)"
            />
            <v-btn
              size="x-small"
              variant="text"
              color="error"
              icon="mdi-delete"
              @click="onDelete(v)"
            />
          </div>
          <div
            class="text-body-2 text-medium-emphasis mb-2"
            style="white-space: pre-wrap;"
          >
            {{ v.desc }}
          </div>
          <div class="d-flex justify-center mb-2">
            <v-img
              v-if="imageUrls[v.id]"
              :src="imageUrls[v.id]"
              max-height="180"
              contain
            />
            <div
              v-else
              class="text-grey text-caption"
            >
              暂无图片
            </div>
          </div>
          <div class="d-flex flex-wrap ga-2 justify-center">
            <v-btn
              size="small"
              color="primary"
              variant="tonal"
              prepend-icon="mdi-auto-fix"
              @click="openGenerate(v)"
            >
              生成图片
            </v-btn>
            <AssetImageUploadButton
              :project="project"
              :asset-path="v.imagePath"
              @uploaded="reload"
            />
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-history"
              :disabled="!v.hasImage"
              @click="openHistory(v)"
            >
              历史
            </v-btn>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <v-dialog
      v-model="formDialog.show"
      max-width="560"
    >
      <v-card>
        <v-card-title>
          {{ formDialog.mode === 'create' ? '创建衍生变体' : '编辑衍生描述' }}
        </v-card-title>
        <v-card-text>
          <v-alert
            v-if="formDialog.error"
            type="error"
            density="compact"
            class="mb-3"
          >
            {{ formDialog.error }}
          </v-alert>
          <v-text-field
            v-if="formDialog.mode === 'create'"
            v-model="formDialog.id"
            label="变体名称"
            hint="如：门已打开、雨天、侧身"
            persistent-hint
            variant="outlined"
            class="mb-3"
          />
          <v-textarea
            v-model="formDialog.desc"
            label="衍生描述（图片编辑提示词）"
            rows="5"
            auto-grow
            variant="outlined"
            hint="描述相对基础图的变化，图像1为基础图"
            persistent-hint
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="formDialog.saving"
            @click="formDialog.show = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            :loading="formDialog.saving"
            @click="submitForm"
          >
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <GenerateDialog
      v-model="genDialog.show"
      :project="project"
      workflow-id="image-edit"
      workflow-name="衍生变体生成（图片编辑）"
      :vars="genDialog.vars"
      :output-path="genDialog.outputPath"
      :prompt-paths="genDialog.promptPaths"
      :existing-asset="genDialog.existingAsset"
      @refresh="reload"
    />

    <AssetHistoryDialog
      v-model="historyDialog.show"
      :project="project"
      :asset-path="historyDialog.path"
      @activated="reload"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  AssetApiError,
  createCharacterVariant,
  createStageVariant,
  deleteCharacterVariant,
  deleteStageVariant,
  listCharacterVariants,
  listStageVariants,
  updateCharacterVariant,
  updateStageVariant,
  type VariantInfo,
} from '../api/assets'
import { confirm } from '../utils/confirm'
import GenerateDialog from './GenerateDialog.vue'
import AssetHistoryDialog from './AssetHistoryDialog.vue'
import AssetImageUploadButton from './AssetImageUploadButton.vue'

const props = defineProps<{
  project: string
  kind: 'character' | 'stage'
  /** 角色名 或 场景名 */
  owner: string
  /** 场景基础标签（kind=stage 时必填） */
  baseLabel?: string
}>()

const emit = defineEmits<{ refresh: [] }>()

const loading = ref(false)
const variants = ref<VariantInfo[]>([])
const imageUrls = ref<Record<string, string>>({})

const kindLabel = computed(() => (props.kind === 'character' ? '角色' : '场景'))

const formDialog = reactive({
  show: false,
  mode: 'create' as 'create' | 'edit',
  id: '',
  desc: '',
  error: '',
  saving: false,
})

const genDialog = reactive({
  show: false,
  vars: {} as Record<string, string>,
  outputPath: '',
  promptPaths: [] as string[],
  existingAsset: undefined as string | undefined,
})

const historyDialog = reactive({
  show: false,
  path: '',
})

async function reload() {
  loading.value = true
  try {
    if (props.kind === 'character') {
      const res = await listCharacterVariants(props.project, props.owner)
      variants.value = res.variants
    } else {
      if (!props.baseLabel) {
        variants.value = []
        return
      }
      const res = await listStageVariants(props.project, props.owner, props.baseLabel)
      variants.value = res.variants
    }
    const ts = Date.now()
    const urls: Record<string, string> = {}
    for (const v of variants.value) {
      if (v.hasImage) {
        urls[v.id] = `/api/fs/${props.project}/${v.imagePath}?t=${ts}`
      }
    }
    imageUrls.value = urls
  } catch {
    variants.value = []
    imageUrls.value = {}
  } finally {
    loading.value = false
  }
}

function openCreate() {
  formDialog.mode = 'create'
  formDialog.id = ''
  formDialog.desc = ''
  formDialog.error = ''
  formDialog.show = true
}

function openEdit(v: VariantInfo) {
  formDialog.mode = 'edit'
  formDialog.id = v.id
  formDialog.desc = v.desc
  formDialog.error = ''
  formDialog.show = true
}

async function submitForm() {
  formDialog.error = ''
  formDialog.saving = true
  try {
    if (formDialog.mode === 'create') {
      const id = formDialog.id.trim()
      const desc = formDialog.desc.trim()
      if (!id) {
        formDialog.error = '请填写变体名称'
        return
      }
      if (!desc) {
        formDialog.error = '请填写衍生描述'
        return
      }
      if (props.kind === 'character') {
        await createCharacterVariant(props.project, props.owner, { id, desc })
      } else {
        if (!props.baseLabel) throw new Error('缺少 baseLabel')
        await createStageVariant(props.project, props.owner, props.baseLabel, { id, desc })
      }
    } else {
      const desc = formDialog.desc.trim()
      if (!desc) {
        formDialog.error = '衍生描述不能为空'
        return
      }
      if (props.kind === 'character') {
        await updateCharacterVariant(props.project, props.owner, formDialog.id, { desc })
      } else {
        if (!props.baseLabel) throw new Error('缺少 baseLabel')
        await updateStageVariant(props.project, props.owner, props.baseLabel, formDialog.id, { desc })
      }
    }
    formDialog.show = false
    await reload()
    emit('refresh')
  } catch (e) {
    formDialog.error = e instanceof AssetApiError ? e.message : (e instanceof Error ? e.message : String(e))
  } finally {
    formDialog.saving = false
  }
}

async function onDelete(v: VariantInfo) {
  const ok = await confirm({
    title: '删除衍生变体',
    message: `确定删除衍生变体「${v.id}」？将同时删除其图片资产。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  try {
    if (props.kind === 'character') {
      await deleteCharacterVariant(props.project, props.owner, v.id)
    } else {
      if (!props.baseLabel) return
      await deleteStageVariant(props.project, props.owner, props.baseLabel, v.id)
    }
    await reload()
    emit('refresh')
  } catch (e) {
    // 简单 alert
    window.alert(e instanceof AssetApiError ? e.message : String(e))
  }
}

function openGenerate(v: VariantInfo) {
  const baseImage = v.baseImage
    || (props.kind === 'character'
      ? `assert/character/${props.owner}/appearance.jpg`
      : `assert/stage/${props.owner}/${props.baseLabel}.jpg`)
  genDialog.vars = {
    desc: v.desc,
    imagePaths: JSON.stringify([baseImage]),
    purpose: 'variant-edit',
    variantKind: props.kind,
    variantOwner: props.owner,
    variantId: v.id,
    ...(props.kind === 'stage' && props.baseLabel ? { baseLabel: props.baseLabel } : {}),
  }
  genDialog.outputPath = v.imagePath
  genDialog.promptPaths = [v.metaPath]
  genDialog.existingAsset = v.hasImage ? '已有图片' : undefined
  genDialog.show = true
}

function openHistory(v: VariantInfo) {
  historyDialog.path = v.imagePath
  historyDialog.show = true
}

watch(
  () => [props.project, props.kind, props.owner, props.baseLabel] as const,
  () => { void reload() },
  { immediate: true },
)

defineExpose({ reload })
</script>
