<template>
  <div
    v-if="tabLoading"
    class="d-flex align-center justify-center py-8"
  >
    <v-progress-circular
      indeterminate
      size="28"
    />
  </div>
  <div
    v-else-if="!parentVariants.length"
    class="text-grey text-body-medium text-center py-8"
  >
    暂无可用变体
  </div>
  <v-row
    v-else
    dense
  >
    <v-col
      v-for="v in parentVariants"
      :key="v.id"
      cols="4"
      sm="3"
      md="2"
    >
      <v-card
        variant="outlined"
        class="asset-card"
        @click="selectParent(v)"
      >
        <v-img
          :src="parentVariantThumb(v)"
          height="140"
          cover
          class="bg-grey-lighten-3"
        >
          <template #placeholder>
            <div class="d-flex align-center justify-center fill-height text-body-small text-grey">
              加载中
            </div>
          </template>
        </v-img>
        <div class="pa-1">
          <div class="text-body-small text-truncate font-weight-medium">
            {{ v.id }}
          </div>
          <div class="text-body-small text-truncate text-grey">
            {{ v.desc }}
          </div>
          <v-chip
            size="x-small"
            :color="v.hasImage ? 'success' : 'grey'"
            variant="tonal"
          >
            {{ v.hasImage ? '有图' : '未生成' }}
          </v-chip>
        </div>
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { listCharacterVariants, listStageVariants, type VariantInfo } from '../../api/assets'

/**
 * 父变体选择网格（parent 模式）。
 *
 * 展示角色的全部变体或场景指定子场景的变体卡片，点击即确认选择
 * （emit select 携带变体 id，由父组件关闭弹窗）。
 */
const props = withDefaults(defineProps<{
  /** 项目名 */
  project: string
  /** 实体类型：角色或场景 */
  contextKind?: 'character' | 'stage'
  /** 实体名（角色名/场景名） */
  contextOwner?: string
  /** 场景子场景标签（场景类型时必需） */
  contextBaseLabel?: string
  /** 弹窗是否打开（仅在打开时加载） */
  active: boolean
  /** 弹窗打开时递增的重新加载信号 */
  reloadKey: number
}>(), {
  contextKind: undefined,
  contextOwner: undefined,
  contextBaseLabel: undefined,
})

const emit = defineEmits<{
  /** 确认选择父变体，携带变体 id */
  select: [id: string]
  /** 请求关闭弹窗 */
  close: []
}>()

/** 加载中标记 */
const tabLoading = ref(false)
/** 父变体列表 */
const parentVariants = ref<VariantInfo[]>([])

/**
 * 获取父变体缩略图 URL（无图时返回空白占位符）。
 *
 * @param v 变体信息
 * @returns 缩略图 URL 或 undefined
 */
function parentVariantThumb(v: VariantInfo): string | undefined {
  if (!v.hasImage) return undefined
  return `/api/fs/${props.project}/${v.imagePath}?t=${Date.now()}`
}

/**
 * 选择父变体（立即确认并关闭）。
 *
 * @param v 被点击的变体
 */
function selectParent(v: VariantInfo) {
  emit('select', v.id)
  emit('close')
}

/** 加载父变体列表 */
async function loadParentVariants() {
  if (!props.contextKind || !props.contextOwner) return
  tabLoading.value = true
  parentVariants.value = []
  try {
    if (props.contextKind === 'character') {
      const res = await listCharacterVariants(props.project, props.contextOwner)
      parentVariants.value = res.variants
    } else if (props.contextKind === 'stage' && props.contextBaseLabel) {
      const res = await listStageVariants(props.project, props.contextOwner, props.contextBaseLabel)
      parentVariants.value = res.variants
    }
  } catch {
    // ignore
  } finally {
    tabLoading.value = false
  }
}

/** 弹窗打开或 reloadKey 变化时重新加载 */
watch(
  () => [props.active, props.reloadKey] as const,
  () => {
    if (props.active) void loadParentVariants()
  },
  { immediate: true },
)
</script>

<style scoped>
.asset-card {
  cursor: pointer;
  transition: box-shadow 0.15s ease;
  position: relative;
}

.asset-card:hover {
  box-shadow: 0 0 0 2px rgb(var(--v-theme-primary));
}
</style>
