<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    @update:model-value="onDialogUpdate"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          class="mr-2"
          size="small"
        >
          mdi-content-save-outline
        </v-icon>
        <span>{{ titleText }}</span>
      </v-card-title>
      <v-card-text>
        <!-- 加载中 -->
        <div
          v-if="loading"
          class="d-flex align-center justify-center pa-6"
        >
          <v-progress-circular
            indeterminate
            size="24"
            color="primary"
          />
        </div>
        <template v-else>
          <!-- 角色设计：combobox 可选已有角色，或输入新角色名（保存时自动创建角色） -->
          <v-combobox
            v-if="props.type === 'character'"
            v-model="selectedCharacter"
            :items="characters"
            label="角色"
            variant="outlined"
            density="comfortable"
            class="mb-2"
            menu-icon="mdi-chevron-down"
            :error="characterError !== ''"
            :error-messages="characterError"
            :hint="characterError === '' ? '点击下拉箭头选择已有角色，或输入新角色名（保存时自动创建）' : ''"
            persistent-hint
            placeholder="选择已有角色或输入新角色名"
            @keyup.enter="save"
          />
          <!-- 角色设计-衍生变体：仅可选已有角色（变体须挂在已存在角色下） -->
          <v-select
            v-else-if="isCharacterType"
            v-model="selectedCharacter"
            :items="characters"
            label="角色"
            variant="outlined"
            density="comfortable"
            class="mb-2"
          />
          <!-- 道具图片/视频/音频：分类 + 道具两个 combobox（可选已有，或输入新名称保存时自动创建） -->
          <template v-else-if="isPropType">
            <v-combobox
              v-model="selectedCategory"
              :items="categories"
              label="道具分类"
              variant="outlined"
              density="comfortable"
              class="mb-2"
              menu-icon="mdi-chevron-down"
              :error="categoryError !== ''"
              :error-messages="categoryError"
              :hint="categoryError === '' ? '点击下拉箭头选择已有分类，或输入新分类名（保存时自动创建）' : ''"
              persistent-hint
              placeholder="选择已有分类或输入新分类名"
              @update:model-value="onCategoryChange"
              @keyup.enter="save"
            />
            <v-combobox
              v-model="selectedProp"
              :items="propNames"
              label="道具"
              variant="outlined"
              density="comfortable"
              class="mb-2"
              menu-icon="mdi-chevron-down"
              :error="propError !== ''"
              :error-messages="propError"
              :hint="propError === '' ? '点击下拉箭头选择已有道具，或输入新道具名（保存时自动创建）' : ''"
              persistent-hint
              placeholder="选择已有道具或输入新道具名"
              @keyup.enter="save"
            />
          </template>
          <!-- 场景图 / 场景图-衍生变体 -->
          <template v-else>
            <v-select
              v-model="selectedStage"
              :items="stages"
              label="场景"
              variant="outlined"
              density="comfortable"
              class="mb-2"
              @update:model-value="onStageChange"
            />
            <v-combobox
              v-if="props.type === 'stage'"
              v-model="selectedSubscene"
              :items="subscenes"
              label="子场景"
              variant="outlined"
              density="comfortable"
              class="mb-2"
              menu-icon="mdi-chevron-down"
              :error="subsceneError !== ''"
              :error-messages="subsceneError"
              :hint="subsceneError === '' ? '点击下拉箭头选择已有子场景，或输入新场景图名称（保存时自动创建）' : ''"
              persistent-hint
              placeholder="选择已有子场景或输入新场景图名称"
              @keyup.enter="save"
            />
            <!-- 场景图-衍生变体：仅可选已有子场景（变体须挂在已存在子场景下） -->
            <v-select
              v-else
              v-model="selectedSubscene"
              :items="subscenes"
              label="子场景"
              variant="outlined"
              density="comfortable"
              class="mb-2"
            />
          </template>
          <!-- 衍生变体：输入变体 id -->
          <v-text-field
            v-if="isVariant"
            v-model="variantId"
            label="变体 id"
            variant="outlined"
            density="comfortable"
            placeholder="如：变体1"
            class="mb-2"
            :error-messages="variantIdError"
            @keyup.enter="save"
          />
          <!-- 衍生变体：衍生描述（可选，默认预填节点提示词；为空时使用默认文案，可在角色/场景详情页修改） -->
          <v-textarea
            v-if="isVariant"
            v-model="descInput"
            label="衍生描述"
            variant="outlined"
            density="comfortable"
            rows="2"
            auto-grow
            class="mb-2"
            placeholder="可选；为空时将使用「由画布保存的衍生变体」"
          />

          <!-- 保存目标路径提示 -->
          <div class="d-flex align-center ga-2 mt-2">
            <div class="text-body-small text-medium-emphasis">
              将保存为：
            </div>
            <div
              class="text-body-small save-dialog-target"
              :title="targetPath"
            >
              {{ targetPath || '—' }}
            </div>
          </div>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="saving"
          @click="closeDialog"
        >
          取消
        </v-btn>
        <v-btn
          color="primary"
          :loading="saving"
          :disabled="!canSave"
          @click="save"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { copyFs, existsFs, readFs, type DirResponse } from '../../api/client'
import {
  AssetApiError,
  archiveAssetHistory,
  createCharacter,
  createCharacterVariant,
  createProp,
  createPropCategory,
  createStageVariant,
  createSubscene,
} from '../../api/assets'
import { confirm } from '../../utils/confirm'
import type { SaveAsAssetType } from './composables/types'

/**
 * 「保存为」目标选择对话框。
 *
 * 把节点的当前输出资产（图片/视频/音频）复制到指定类型的资产路径（目标实体不存在时自动创建）：
 * - 角色设计：`assert/character/{角色}/appearance.jpg`
 * - 角色设计-衍生变体：`assert/character/{角色}/variants/{变体id}.jpg`
 * - 场景图：`assert/stage/{场景}/{子场景}.jpg`
 * - 场景图-衍生变体：`assert/stage/{场景}/variants/{子场景}/{变体id}.jpg`
 * - 道具图片：`assert/prop/{分类}/{道具}/image.jpg`
 * - 道具视频：`assert/prop/{分类}/{道具}/video.mp4`
 * - 道具音频：`assert/prop/{分类}/{道具}/audio.flac`
 *
 * 目标实体用下拉选择（角色列表 = prompt/character/ 目录名；场景/子场景 = prompt/stage/ 目录与
 * 子场景 .md 文件名；道具分类/道具 = prompt/prop/ 目录与子目录名）；「角色设计」「场景图」与
 * 道具类用 v-combobox——可选择已有实体覆盖，也可手动输入新名称，保存时自动创建对应实体
 * （角色：prompt/character/{name}/ 三模板文件；子场景：prompt/stage/{场景}/{标签}.md 模板；
 * 道具分类/道具：prompt/prop/ 目录与 image.md/video.md/refs.json 模板）。衍生变体需输入变体 id
 * （校验非法字符）。默认定位当前画布所属实体：场景画布 → 当前场景+子场景；
 * 分镜画布 → 由 stage.json 首帧推导。
 * 目标文件已存在时弹 confirm 确认后覆盖，覆盖前先把原文件归档为历史版本
 * （POST /assets/:project/history/archive）。
 */
const props = defineProps<{
  /** 显隐控制 */
  modelValue: boolean
  /** 项目名 */
  project: string
  /** 画布类型（决定默认选中的实体：场景画布 → 当前场景+子场景） */
  kind: 'stage' | 'scene'
  /** 场景画布时的场景名 */
  stage?: string
  /** 场景画布时的子场景标签 */
  label?: string
  /** 分镜画布时的集数 */
  episode?: string
  /** 分镜画布时的分镜号 */
  shot?: string
  /** 保存目标类型（自定义资产走 SaveAssetDialog，不走本组件） */
  type: SaveAsAssetType
  /** 源资产相对路径（待复制文件） */
  sourcePath: string
  /** 源节点提示词（衍生变体的衍生描述默认值；可为空） */
  nodePrompt?: string
}>()

/** 组件事件：显隐同步、保存成功（目标路径）、保存失败（错误信息） */
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved', targetPath: string): void
  (e: 'save-error', message: string): void
}>()

/** 是否为角色类（角色设计 / 角色设计-衍生变体） */
const isCharacterType = computed(() => props.type === 'character' || props.type === 'character-variant')

/** 是否为衍生变体类型（需输入变体 id） */
const isVariant = computed(() => props.type === 'character-variant' || props.type === 'stage-variant')

/** 是否为道具类（道具图片 / 道具视频 / 道具音频） */
const isPropType = computed(
  () => props.type === 'prop-image' || props.type === 'prop-video' || props.type === 'prop-audio',
)

/** 对话框标题（按保存目标类型） */
const titleText = computed(() => {
  switch (props.type) {
    case 'character':
      return '保存为角色设计'
    case 'character-variant':
      return '保存为角色设计-衍生变体'
    case 'stage':
      return '保存为场景图'
    case 'stage-variant':
      return '保存为场景图-衍生变体'
    case 'prop-image':
      return '保存为道具图片'
    case 'prop-video':
      return '保存为道具视频'
    case 'prop-audio':
      return '保存为道具音频'
    default:
      return '保存为'
  }
})

/** 项目角色列表（prompt/character/ 目录名） */
const characters = ref<string[]>([])
/** 项目场景列表（prompt/stage/ 目录名） */
const stages = ref<string[]>([])
/** 选中场景的子场景列表（prompt/stage/{场景}/*.md 文件名去扩展名） */
const subscenes = ref<string[]>([])
/** 项目道具分类列表（prompt/prop/ 目录名） */
const categories = ref<string[]>([])
/** 选中分类下的道具列表（prompt/prop/{分类}/ 子目录名） */
const propNames = ref<string[]>([])
/** 选中的角色 */
const selectedCharacter = ref('')
/** 选中的场景 */
const selectedStage = ref('')
/** 选中的子场景 */
const selectedSubscene = ref('')
/** 选中的道具分类 */
const selectedCategory = ref('')
/** 选中的道具 */
const selectedProp = ref('')
/** 变体 id 输入 */
const variantId = ref('')
/** 衍生描述输入（衍生变体；默认预填节点提示词） */
const descInput = ref('')
/** 列表加载中 */
const loading = ref(false)
/** 保存中 */
const saving = ref(false)

/** 从目录响应中提取子目录名列表（按中文排序） */
function dirNames(res: DirResponse | string): string[] {
  const entries = (res as DirResponse).entries
  if (!Array.isArray(entries)) return []
  return entries
    .filter((e) => e.type === 'dir')
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'zh'))
}

/**
 * 安全取字符串并 trim：v-combobox 清空输入时 v-model 会被置为 null（而非空字符串），
 * 直接 .trim() 会抛 TypeError；此处统一把非字符串（null/undefined/对象）归一为空串。
 *
 * @param v combobox/输入框绑定值
 * @returns trim 后的字符串
 */
function valueText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** 加载选中场景的子场景列表（.md 文件名去扩展名；variants 目录自然被 .md 过滤排除） */
async function loadSubscenes(): Promise<void> {
  subscenes.value = []
  const stage = valueText(selectedStage.value)
  if (!stage) return
  try {
    const res = await readFs(props.project, `prompt/stage/${stage}`) as DirResponse
    subscenes.value = (res.entries ?? [])
      .filter((e) => e.type === 'file' && e.name.endsWith('.md'))
      .map((e) => e.name.slice(0, -3))
      .sort((a, b) => a.localeCompare(b, 'zh'))
  } catch {
    subscenes.value = []
  }
}

/** 加载选中分类下的道具列表（prompt/prop/{分类}/ 子目录名） */
async function loadProps(): Promise<void> {
  propNames.value = []
  const category = valueText(selectedCategory.value)
  if (!category) return
  try {
    const res = await readFs(props.project, `prompt/prop/${category}`) as DirResponse
    propNames.value = dirNames(res)
  } catch {
    propNames.value = []
  }
}

/** 用户切换道具分类：清空道具并重新加载列表 */
async function onCategoryChange(): Promise<void> {
  selectedProp.value = ''
  await loadProps()
}

/** 用户切换场景：清空子场景并重新加载列表 */
async function onStageChange(): Promise<void> {
  selectedSubscene.value = ''
  await loadSubscenes()
}

/**
 * 打开时初始化：加载角色/场景/道具分类列表，并按画布类型预选默认实体——
 * 场景画布默认当前场景+子场景；分镜画布从 stage.json 首帧的 基础场景 推导（{场景}/{标签}[@变体]，
 * prev / custom/ 引用不预选）。
 */
async function initDefaults(): Promise<void> {
  loading.value = true
  selectedCharacter.value = ''
  selectedStage.value = ''
  selectedSubscene.value = ''
  selectedCategory.value = ''
  selectedProp.value = ''
  variantId.value = ''
  descInput.value = props.nodePrompt ?? ''
  try {
    // 角色/场景/道具目录可能不存在（新项目尚未创建）：分别容错，404 视为空列表，
    // 避免 Promise.all 整体失败导致下拉都加载不出（combobox 仍可手动输入新名称创建）
    const [charRes, stageRes, propRes] = await Promise.all([
      readFs(props.project, 'prompt/character').catch(() => null),
      readFs(props.project, 'prompt/stage').catch(() => null),
      readFs(props.project, 'prompt/prop').catch(() => null),
    ])
    characters.value = charRes ? dirNames(charRes) : []
    stages.value = stageRes ? dirNames(stageRes) : []
    categories.value = propRes ? dirNames(propRes) : []
  } catch {
    characters.value = []
    stages.value = []
    categories.value = []
  }
  if (props.kind === 'stage') {
    selectedStage.value = props.stage ?? ''
    selectedSubscene.value = props.label ?? ''
  } else if (props.kind === 'scene') {
    try {
      const res = await readFs(props.project, `prompt/scene/${props.episode}/${props.shot}/stage.json`)
      const frames = Array.isArray(res) ? (res as { 基础场景?: string }[]) : []
      const first = frames.find((f) => f.基础场景 && f.基础场景.trim() && !f.基础场景.trim().startsWith('prev'))
      const base = first?.基础场景?.trim() ?? ''
      if (base && !base.startsWith('custom/')) {
        const [stageName, ...rest] = base.split('/')
        selectedStage.value = stageName ?? ''
        if (rest.length) selectedSubscene.value = rest.join('/').split('@')[0]
      }
    } catch {
      // stage.json 缺失/解析失败：不预选（best-effort）
    }
  }
  await loadSubscenes()
  loading.value = false
}

/** 变体 id 校验错误信息（空/非法字符） */
const variantIdError = computed(() => {
  if (!isVariant.value) return ''
  const v = variantId.value.trim()
  if (!v) return '请输入变体 id'
  if (/[\\/:*?"<>|]/.test(v)) return '名称包含非法字符：\\ / : * ? " < > |'
  return ''
})

/** 角色设计角色名校验错误（仅非法字符红显；空值由目标路径为空阻止保存） */
const characterError = computed(() => {
  if (props.type !== 'character') return ''
  const name = valueText(selectedCharacter.value)
  if (!name) return ''
  if (/[\\/:*?"<>|]/.test(name)) return '名称包含非法字符：\\ / : * ? " < > |'
  return ''
})

/** 场景图子场景名校验错误（仅非法字符红显；空值由目标路径为空阻止保存） */
const subsceneError = computed(() => {
  if (props.type !== 'stage') return ''
  const label = valueText(selectedSubscene.value)
  if (!label) return ''
  if (/[\\/:*?"<>|]/.test(label)) return '名称包含非法字符：\\ / : * ? " < > |'
  return ''
})

/** 道具分类名校验错误（仅非法字符红显；空值由目标路径为空阻止保存） */
const categoryError = computed(() => {
  if (!isPropType.value) return ''
  const name = valueText(selectedCategory.value)
  if (!name) return ''
  if (/[\\/:*?"<>|]/.test(name)) return '名称包含非法字符：\\ / : * ? " < > |'
  return ''
})

/** 道具名校验错误（仅非法字符红显；空值由目标路径为空阻止保存） */
const propError = computed(() => {
  if (!isPropType.value) return ''
  const name = valueText(selectedProp.value)
  if (!name) return ''
  if (/[\\/:*?"<>|]/.test(name)) return '名称包含非法字符：\\ / : * ? " < > |'
  return ''
})

/** 保存目标路径（相对项目，如 assert/character/小霓/appearance.jpg；未选齐时为空串） */
const targetPath = computed(() => {
  switch (props.type) {
    case 'character': {
      const c = valueText(selectedCharacter.value)
      return c ? `assert/character/${c}/appearance.jpg` : ''
    }
    case 'character-variant': {
      const c = valueText(selectedCharacter.value)
      const v = variantId.value.trim()
      return c && v ? `assert/character/${c}/variants/${v}.jpg` : ''
    }
    case 'stage': {
      const s = valueText(selectedStage.value)
      const l = valueText(selectedSubscene.value)
      return s && l ? `assert/stage/${s}/${l}.jpg` : ''
    }
    case 'stage-variant': {
      const s = valueText(selectedStage.value)
      const l = valueText(selectedSubscene.value)
      const v = variantId.value.trim()
      return s && l && v ? `assert/stage/${s}/variants/${l}/${v}.jpg` : ''
    }
    case 'prop-image': {
      const c = valueText(selectedCategory.value)
      const p = valueText(selectedProp.value)
      return c && p ? `assert/prop/${c}/${p}/image.jpg` : ''
    }
    case 'prop-video': {
      const c = valueText(selectedCategory.value)
      const p = valueText(selectedProp.value)
      return c && p ? `assert/prop/${c}/${p}/video.mp4` : ''
    }
    case 'prop-audio': {
      const c = valueText(selectedCategory.value)
      const p = valueText(selectedProp.value)
      return c && p ? `assert/prop/${c}/${p}/audio.flac` : ''
    }
    default:
      return ''
  }
})

/** 衍生变体元数据路径（prompt/.../variants/{id}.json，详情页变体列表按它扫描；仅变体类型非空） */
const metaPath = computed(() => {
  switch (props.type) {
    case 'character-variant': {
      const c = valueText(selectedCharacter.value)
      const v = variantId.value.trim()
      return c && v ? `prompt/character/${c}/variants/${v}.json` : ''
    }
    case 'stage-variant': {
      const s = valueText(selectedStage.value)
      const l = valueText(selectedSubscene.value)
      const v = variantId.value.trim()
      return s && l && v ? `prompt/stage/${s}/variants/${l}/${v}.json` : ''
    }
    default:
      return ''
  }
})

/** 是否可保存：有源资产、目标路径完整、变体 id 合法、角色设计角色名合法、场景图子场景名合法、道具分类/道具名合法 */
const canSave = computed(
  () => !!props.sourcePath
    && !!targetPath.value
    && (!isVariant.value || variantIdError.value === '')
    && (props.type !== 'character' || characterError.value === '')
    && (props.type !== 'stage' || subsceneError.value === '')
    && (!isPropType.value || (categoryError.value === '' && propError.value === '')),
)

/**
 * 保存：目标已存在时弹 confirm 确认覆盖，并先把原文件归档为历史版本
 * （POST /assets/:project/history/archive，copy 保留原文件），随后复制源资产覆盖目标路径。
 * 角色设计：输入的角色名（v-combobox 支持手动输入）不存在时先创建角色
 * （POST /assets/:project/character，生成 prompt/character/{name}/ 模板三文件），再复制外观图。
 * 场景图：输入的子场景名（v-combobox 支持手动输入）不存在时先创建子场景
 * （POST /assets/:project/subscene，生成 prompt/stage/{场景}/{标签}.md 模板），再复制场景图。
 * 道具类：输入的分类/道具（v-combobox 支持手动输入）不存在时先创建
 * （POST /assets/:project/prop/category + /assets/:project/prop，生成目录与模板文件），再复制产物。
 * 衍生变体在元数据（prompt/.../variants/{id}.json）不存在时自动创建（desc 用衍生描述输入，
 * 为空回退默认文案），保证角色/场景详情页的衍生变体列表能显示该变体；元数据已存在则仅覆盖图片。
 */
async function save(): Promise<void> {
  if (!props.sourcePath || !targetPath.value || !canSave.value) return
  saving.value = true
  try {
    // 角色设计：输入的角色不存在时先创建角色（并发/其他途径已创建则视为已存在继续）
    if (props.type === 'character') {
      const name = valueText(selectedCharacter.value)
      if (!characters.value.includes(name)) {
        try {
          await createCharacter(props.project, { name })
        } catch (e) {
          if (!(e instanceof AssetApiError && e.code === 'EXISTS')) throw e
        }
      }
    }
    // 场景图：输入的子场景（新场景图名称）不存在时先创建子场景（并发/其他途径已创建则视为已存在继续）
    if (props.type === 'stage') {
      const label = valueText(selectedSubscene.value)
      const stage = valueText(selectedStage.value)
      if (stage && !subscenes.value.includes(label)) {
        try {
          await createSubscene(props.project, { stage, label })
        } catch (e) {
          if (!(e instanceof AssetApiError && e.code === 'EXISTS')) throw e
        }
      }
    }
    // 道具类：分类/道具不存在时先创建（并发/其他途径已创建则视为已存在继续）
    if (isPropType.value) {
      const category = valueText(selectedCategory.value)
      const prop = valueText(selectedProp.value)
      if (category && !categories.value.includes(category)) {
        try {
          await createPropCategory(props.project, category)
        } catch (e) {
          if (!(e instanceof AssetApiError && e.code === 'EXISTS')) throw e
        }
      }
      if (category && prop && !propNames.value.includes(prop)) {
        try {
          await createProp(props.project, category, prop)
        } catch (e) {
          if (!(e instanceof AssetApiError && e.code === 'EXISTS')) throw e
        }
      }
    }
    if (await existsFs(props.project, targetPath.value)) {
      const ok = await confirm({
        title: '覆盖确认',
        content: `目标文件已存在，确认覆盖？\n${targetPath.value}`,
        confirmText: '覆盖',
        confirmColor: 'primary',
      })
      if (!ok) return
      await archiveAssetHistory(props.project, targetPath.value)
    }
    // 衍生变体：详情页列表按 prompt/.../variants/{id}.json 扫描，缺元数据时先创建
    if (isVariant.value && !(await existsFs(props.project, metaPath.value))) {
      const desc = descInput.value.trim() || '由画布保存的衍生变体'
      const id = variantId.value.trim()
      if (props.type === 'character-variant') {
        await createCharacterVariant(props.project, valueText(selectedCharacter.value), { id, desc })
      } else {
        await createStageVariant(
          props.project,
          valueText(selectedStage.value),
          valueText(selectedSubscene.value),
          { id, desc },
        )
      }
    }
    await copyFs(props.project, props.sourcePath, targetPath.value)
    emit('saved', targetPath.value)
    closeDialog()
  } catch (e) {
    emit('save-error', e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

/** 对话框打开时初始化默认选中 */
watch(
  () => props.modelValue,
  (open) => {
    if (open) void initDefaults()
  },
)

/** 内部 v-dialog 显隐变化 → 透传父组件 */
function onDialogUpdate(v: unknown) {
  emit('update:modelValue', Boolean(v))
}

/** 关闭对话框 */
function closeDialog() {
  emit('update:modelValue', false)
}
</script>

<style scoped>
.save-dialog-target {
  color: rgba(0, 0, 0, 0.6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
