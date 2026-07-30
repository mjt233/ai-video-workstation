<template>
  <div class="mt-4">
    <div class="d-flex align-center ga-2 mb-2">
      <div class="text-subtitle-2">
        衍生变体
      </div>
      <v-btn
        size="small"
        color="primary"
        variant="tonal"
        icon="mdi-plus"
        title="创建衍生变体"
        @click="openCreate"
      />
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

    <VariantTreeView
      v-else
      :roots="tree"
      :image-urls="imageUrls"
      :aspect-ratio="aspectRatioNum"
      @preview="openPreview"
      @generate="openGenerate"
      @history="openHistory"
      @edit="openEdit"
      @delete="onDelete"
      @create-child="openCreateWithParent"
    >
      <template #upload-btn="{ node }">
        <AssetImageUploadButton
          :project="project"
          :asset-path="node.imagePath"
          icon-only
          size="x-small"
          variant="flat"
          icon="mdi-upload"
          label="上传图片"
          @uploaded="refreshVariants"
        />
      </template>
    </VariantTreeView>

    <!-- Create/Edit Dialog -->
    <v-dialog
      v-model="formDialog.show"
      max-width="600"
    >
      <v-card>
        <v-card-title>{{ formDialog.mode === 'create' ? '创建衍生变体' : '编辑衍生描述' }}</v-card-title>
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
            v-if="formDialog.mode === 'create' || formDialog.mode === 'edit'"
            v-model="formDialog.id"
            label="变体名称"
            hint="如：门已打开、雨天、侧身"
            persistent-hint
            variant="outlined"
            class="mb-3"
          />

          <div v-if="formDialog.mode === 'create' || formDialog.parentIdEditable">
            <div class="d-flex align-center ga-2 mb-2">
              <span class="text-body-2">父变体（可选）</span>
              <v-btn
                size="small"
                variant="tonal"
                prepend-icon="mdi-file-tree"
                @click="openParentPicker"
              >
                {{ formDialog.parentId ? formDialog.parentId : '选择父变体' }}
              </v-btn>
              <v-btn
                v-if="formDialog.parentId"
                size="x-small"
                variant="text"
                icon="mdi-close"
                @click="formDialog.parentId = undefined"
              />
            </div>
            <div
              v-if="formDialog.parentId && parentPreviewUrl"
              class="mb-3 d-inline-flex flex-column"
              style="width: 128px;"
            >
              <v-img
                :src="parentPreviewUrl"
                aspect-ratio="1"
                cover
                class="rounded border"
              />
              <p style="text-align: center;font-size: 12px;">
                {{ formDialog.parentId }}
              </p>
            </div>
          </div>

          <VDivider class="mt-3 mb-6" />
          <v-textarea
            v-model="formDialog.desc"
            label="衍生描述（图片编辑提示词）"
            rows="5"
            auto-grow
            variant="outlined"
            hint="描述相对父图的变化"
            persistent-hint
          />

          <div class="d-flex align-center ga-2 mb-2">
            <span class="text-body-2">引用资产（可选）</span>
            <v-btn
              size="small"
              variant="tonal"
              prepend-icon="mdi-image-multiple"
              @click="openAssetPicker"
            >
              选择引用资产
            </v-btn>
          </div>

          <div
            v-if="formDialog.refs.length"
            class="d-flex flex-column ga-1 mb-2"
          >
            <div
              v-for="(refPath, idx) in formDialog.refs"
              :key="refPath"
              class="d-flex align-center ga-2 pa-1 rounded"
              style="background: rgba(var(--v-theme-on-surface), 0.04);"
            >
              <v-img
                :src="getRefThumbnail(refPath)"
                max-width="40"
                max-height="40"
                aspect-ratio="1"
                cover
                class="rounded"
              />
              <span class="text-caption flex-grow-1 text-truncate">{{ getRefLabel(refPath) }}</span>
              <div class="d-flex ga-0 flex-shrink-0">
                <v-btn
                  icon="mdi-chevron-up"
                  size="x-small"
                  variant="text"
                  density="compact"
                  :disabled="idx === 0"
                  @click="moveRef(idx, -1)"
                />
                <v-btn
                  icon="mdi-chevron-down"
                  size="x-small"
                  variant="text"
                  density="compact"
                  :disabled="idx === formDialog.refs.length - 1"
                  @click="moveRef(idx, 1)"
                />
                <v-btn
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  color="error"
                  density="compact"
                  @click="formDialog.refs.splice(idx, 1)"
                />
              </div>
            </div>
          </div>
          <div
            v-else
            class="text-caption text-grey"
          >
            未选择引用资产
          </div>
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

    <AssetPickerDialog
      v-model="assetPicker.show"
      :project="project"
      :selected="assetPicker.selected"
      @update:selected="onAssetPickerConfirm"
    />

    <AssetPickerDialog
      v-model="parentPicker.show"
      :project="project"
      mode="parent"
      :context-kind="kind"
      :context-owner="owner"
      :context-base-label="kind === 'stage' ? baseLabel : undefined"
      @update:selected="onParentPickerConfirm"
    />

    <GenerateDialog
      v-model="genDialog.show"
      :project="project"
      workflow-id="image-edit"
      workflow-name="衍生变体生成（图片编辑）"
      :vars="genDialog.vars"
      :output-path="genDialog.outputPath"
      :prompt-paths="genDialog.promptPaths"
      :existing-asset="genDialog.existingAsset"
      @refresh="refreshVariants"
    />

    <AssetHistoryDialog
      v-model="historyDialog.show"
      :project="project"
      :asset-path="historyDialog.path"
      @activated="refreshVariants"
    />

    <v-dialog
      v-model="previewDialog.show"
      max-width="960"
    >
      <v-card>
        <v-card-title class="d-flex align-center">
          <span class="text-truncate">{{ previewDialog.title }}</span>
          <v-spacer />
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            @click="previewDialog.show = false"
          />
        </v-card-title>
        <v-card-text class="pt-0">
          <div class="variant-preview-wrap d-flex justify-center align-center">
            <v-img
              v-if="previewDialog.url"
              :src="previewDialog.url"
              max-height="80vh"
              contain
            />
          </div>
          <div
            v-if="previewDialog.desc"
            class="text-body-2 text-medium-emphasis mt-3"
            style="white-space: pre-wrap;"
          >
            {{ previewDialog.desc }}
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
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
  renameCharacterVariant,
  renameStageVariant,
  updateCharacterVariant,
  updateStageVariant,
  type VariantInfo,
} from '../api/assets'
import { confirm } from '../utils/confirm'
import { readFs } from '../api/client'
import { useVariantTree, type VariantTreeNode } from '../composables/useVariantTree'
import VariantTreeView from './VariantTreeView.vue'
import AssetPickerDialog from './AssetPickerDialog.vue'
import GenerateDialog from './GenerateDialog.vue'
import AssetHistoryDialog from './AssetHistoryDialog.vue'
import AssetImageUploadButton from './AssetImageUploadButton.vue'

const props = defineProps<{
  project: string
  kind: 'character' | 'stage'
  owner: string
  baseLabel?: string
}>()

const emit = defineEmits<{ refresh: [] }>()

const loading = ref(false)
const variants = ref<VariantInfo[]>([])
const imageUrls = ref<Record<string, string>>({})
const aspectRatioNum = ref(1)
const { tree, variantMap } = useVariantTree(variants)

const kindLabel = computed(() => (props.kind === 'character' ? '角色' : '场景'))

const parentOptions = computed(() => {
  return variants.value
    .filter(v => v.id !== formDialog.id)
    .map(v => ({ title: v.id, value: v.id }))
})

const formDialog = reactive({
  show: false,
  mode: 'create' as 'create' | 'edit',
  id: '',
  originalId: '',
  desc: '',
  parentId: '' as string | undefined,
  parentIdEditable: false,
  refs: [] as string[],
  error: '',
  saving: false,
})

const assetPicker = reactive({
  show: false,
  selected: [] as string[],
})

const parentPicker = reactive({
  show: false,
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

const previewDialog = reactive({
  show: false,
  title: '',
  url: '',
  desc: '',
})

/** 静默刷新变体列表（不触发 loading spinner，保持滚动位置） */
async function refreshVariants() {
  try {
    if (props.kind === 'character') {
      const res = await listCharacterVariants(props.project, props.owner)
      variants.value = res.variants
    } else {
      if (!props.baseLabel) { variants.value = []; return }
      const res = await listStageVariants(props.project, props.owner, props.baseLabel)
      variants.value = res.variants
    }
    const ts = Date.now()
    const urls: Record<string, string> = {}
    for (const v of variants.value) {
      if (v.hasImage) urls[v.id] = `/api/fs/${props.project}/${v.imagePath}?t=${ts}`
    }
    imageUrls.value = urls
  } catch {
    // 静默失败
  }
}

/** 完整重新加载（含宽高比），首次挂载时使用 */
async function reload() {
  loading.value = true
  try {
    // 加载项目宽高比
    try {
      const config = (await readFs(props.project, 'project.json')) as unknown as Record<string, unknown>
      if (config && typeof config === 'object') {
        const w = Number(config.width ?? 0)
        const h = Number(config.height ?? 0)
        if (w > 0 && h > 0) aspectRatioNum.value = w / h
      }
    } catch { /* 使用默认 1 */ }

    await refreshVariants()
  } finally {
    loading.value = false
  }
}

function openCreate() {
  formDialog.mode = 'create'
  formDialog.id = ''
  formDialog.desc = ''
  formDialog.parentId = undefined
  formDialog.parentIdEditable = true
  formDialog.refs = []
  formDialog.error = ''
  formDialog.show = true
}

function openCreateWithParent(v: VariantInfo) {
  formDialog.mode = 'create'
  formDialog.id = ''
  formDialog.desc = ''
  formDialog.parentId = v.id
  formDialog.parentIdEditable = true
  formDialog.refs = []
  formDialog.error = ''
  formDialog.show = true
}

function openEdit(v: VariantInfo) {
  formDialog.mode = 'edit'
  formDialog.id = v.id
  formDialog.originalId = v.id
  formDialog.desc = v.desc
  formDialog.parentId = v.parentId
  formDialog.parentIdEditable = true
  formDialog.refs = [...(v.refs || [])]
  formDialog.error = ''
  formDialog.show = true
}

function openAssetPicker() {
  assetPicker.selected = [...formDialog.refs]
  assetPicker.show = true
}

function onAssetPickerConfirm(paths: string[]) {
  formDialog.refs = paths
}

function openParentPicker() {
  parentPicker.show = true
}

function onParentPickerConfirm(ids: string[]) {
  if (ids.length > 0) {
    formDialog.parentId = ids[0]
  }
}

/** 根据路径生成显示标签，格式：{资产类别}/{文件名} */
function getRefLabel(path: string): string {
  // assert/character/{name}/appearance.jpg → 小明/外观
  // assert/character/{name}/variants/{id}.jpg → 小明/门已打开
  // assert/stage/{name}/{label}.jpg → 商场/白天
  // assert/stage/{name}/variants/{label}/{id}.jpg → 商场/白天/雨天
  // assert/custom/xxx/yyy.jpg → 自定义/xxx/yyy
  if (path.startsWith('assert/custom/')) {
    return '自定义/' + path.slice('assert/custom/'.length)
  }
  if (path.startsWith('assert/character/')) {
    const rest = path.slice('assert/character/'.length)
    return rest.replace('/appearance.jpg', '/外观')
      .replace('/variants/', '/')
      .replace(/\.jpg$/, '')
  }
  if (path.startsWith('assert/stage/')) {
    const rest = path.slice('assert/stage/'.length)
    return rest.replace('/variants/', '/')
      .replace(/\.jpg$/, '')
  }
  return path.split('/').pop() ?? path
}

/** 获取引用资产的缩略图 URL */
function getRefThumbnail(path: string): string {
  return `/api/fs/${props.project}/${path}?t=${Date.now()}`
}

/** 在表单内移动引用资产的顺序 */
function moveRef(idx: number, direction: -1 | 1) {
  const target = idx + direction
  if (target < 0 || target >= formDialog.refs.length) return
  const arr = [...formDialog.refs]
  const [item] = arr.splice(idx, 1)
  arr.splice(target, 0, item)
  formDialog.refs = arr
}

/** 用户选择的父变体图像预览 URL */
const parentPreviewUrl = computed(() => {
  if (!formDialog.parentId) return undefined
  const parent = variantMap.value.get(formDialog.parentId)
  if (!parent?.hasImage) return undefined
  return `/api/fs/${props.project}/${parent.imagePath}?t=${Date.now()}`
})

async function submitForm() {
  formDialog.error = ''
  formDialog.saving = true
  try {
    if (formDialog.mode === 'create') {
      const id = formDialog.id.trim()
      const desc = formDialog.desc.trim()
      if (!id) { formDialog.error = '请填写变体名称'; return }
      if (!desc) { formDialog.error = '请填写衍生描述'; return }
      if (props.kind === 'character') {
        await createCharacterVariant(props.project, props.owner, { id, desc, parentId: formDialog.parentId || undefined, refs: formDialog.refs })
      } else {
        if (!props.baseLabel) throw new Error('缺少 baseLabel')
        await createStageVariant(props.project, props.owner, props.baseLabel, { id, desc, parentId: formDialog.parentId || undefined, refs: formDialog.refs })
      }
    } else {
      const desc = formDialog.desc.trim()
      if (!desc) { formDialog.error = '衍生描述不能为空'; return }
      if (props.kind === 'character') {
        await updateCharacterVariant(props.project, props.owner, formDialog.id, { desc, parentId: formDialog.parentId || undefined, refs: formDialog.refs })
        if (formDialog.id !== formDialog.originalId) {
          await renameCharacterVariant(props.project, props.owner, formDialog.originalId, formDialog.id)
        }
      } else {
        if (!props.baseLabel) throw new Error('缺少 baseLabel')
        await updateStageVariant(props.project, props.owner, props.baseLabel, formDialog.id, { desc, parentId: formDialog.parentId || undefined, refs: formDialog.refs })
        if (formDialog.id !== formDialog.originalId) {
          await renameStageVariant(props.project, props.owner, props.baseLabel, formDialog.originalId, formDialog.id)
        }
      }
    }
    formDialog.show = false
    await refreshVariants()
  } catch (e) {
    formDialog.error = e instanceof AssetApiError ? e.message : (e instanceof Error ? e.message : String(e))
  } finally {
    formDialog.saving = false
  }
}

async function onDelete(v: VariantInfo) {
  const vNode = findTreeNode(tree.value, v.id)
  const hasChildren = vNode ? vNode.children.length > 0 : variants.value.some(x => x.parentId === v.id)

  if (hasChildren) {
    const cascade = await confirm({
      title: '删除衍生变体',
      content: `衍生变体「${v.id}」存在子变体。是否级联删除所有子变体？`,
      confirmText: '级联删除', cancelText: '取消', confirmColor: 'error',
    })
    if (cascade) {
      try {
        if (props.kind === 'character') await deleteCharacterVariant(props.project, props.owner, v.id, true)
        else {
          if (!props.baseLabel) return
          await deleteStageVariant(props.project, props.owner, props.baseLabel, v.id, true)
        }
        await refreshVariants()
      } catch (e) { window.alert(e instanceof AssetApiError ? e.message : String(e)) }
      return
    }
    const promote = await confirm({
      title: '删除衍生变体',
      content: `是否将子变体提升为顶级变体？选择「取消」则不删除。`,
      confirmText: '提升子变体', cancelText: '取消', confirmColor: 'primary',
    })
    if (!promote) return
    try {
      if (props.kind === 'character') await deleteCharacterVariant(props.project, props.owner, v.id, false)
      else {
        if (!props.baseLabel) return
        await deleteStageVariant(props.project, props.owner, props.baseLabel, v.id, false)
      }
      await refreshVariants()
    } catch (e) { window.alert(e instanceof AssetApiError ? e.message : String(e)) }
  } else {
    const ok = await confirm({
      title: '删除衍生变体',
      content: `确定删除衍生变体「${v.id}」？将同时删除其图片资产。`,
      confirmText: '删除', confirmColor: 'error',
    })
    if (!ok) return
    try {
      if (props.kind === 'character') await deleteCharacterVariant(props.project, props.owner, v.id)
      else {
        if (!props.baseLabel) return
        await deleteStageVariant(props.project, props.owner, props.baseLabel, v.id)
      }
      await refreshVariants()
    } catch (e) { window.alert(e instanceof AssetApiError ? e.message : String(e)) }
  }
}

function findTreeNode(nodes: VariantTreeNode[], id: string): VariantTreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    const found = findTreeNode(n.children, id)
    if (found) return found
  }
  return undefined
}

function buildImagePaths(v: VariantInfo): string[] {
  const paths: string[] = []
  if (v.parentId) {
    const parent = variantMap.value.get(v.parentId)
    paths.push(parent?.hasImage ? parent.imagePath : getDefaultBaseImage(v))
  } else {
    paths.push(getDefaultBaseImage(v))
  }
  paths.push(...(v.refs || []))
  return paths
}

function getDefaultBaseImage(v: VariantInfo): string {
  return v.kind === 'character'
    ? `assert/character/${v.owner}/appearance.jpg`
    : `assert/stage/${v.owner}/${v.baseLabel}.jpg`
}

function openGenerate(v: VariantInfo) {
  genDialog.vars = {
    desc: v.desc,
    imagePaths: JSON.stringify(buildImagePaths(v)),
    purpose: 'variant-edit',
    variantKind: props.kind,
    variantOwner: props.owner,
    variantId: v.id,
    parentId: v.parentId ?? '',
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

function openPreview(v: VariantInfo) {
  const url = imageUrls.value[v.id]
  if (!url) return
  previewDialog.title = v.id
  previewDialog.url = url
  previewDialog.desc = v.desc
  previewDialog.show = true
}

watch(() => [props.project, props.kind, props.owner, props.baseLabel] as const,
  () => { void reload() }, { immediate: true })

defineExpose({ reload })
</script>

<style scoped>
.variant-preview-wrap {
  min-height: 240px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 8px;
  overflow: auto;
}
</style>
