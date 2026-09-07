<template>
  <!-- 资产拖放菜单：0×0 隐藏锚点在释放位置弹出（同 CanvasAddNodeMenu 定位手法） -->
  <div
    ref="anchorEl"
    class="asset-drop-menu-anchor"
    :style="{ left: `${x}px`, top: `${y}px` }"
  />
  <v-menu
    :model-value="modelValue"
    :activator="activator"
    location="bottom start"
    :open-on-click="false"
    :close-on-content-click="false"
    min-width="280"
    max-width="640"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="asset-drop-menu">
      <!-- 分组加载中 -->
      <div
        v-if="loading"
        class="d-flex align-center justify-center pa-4"
      >
        <v-progress-circular
          indeterminate
          size="24"
        />
      </div>
      <!-- 空态：实体暂无可选资产 -->
      <div
        v-else-if="groups.length === 0"
        class="text-body-small text-medium-emphasis pa-4 text-center"
      >
        暂无可用资产
      </div>
      <!-- 媒体分组（单层布局）：
           每行 = 左侧媒体标签（图片/音频/视频） + 右侧横向滚动的资产条目；
           条目 = 缩略图（图片，点击即添加）/ 试听组件（音频/视频）+ 名称行（点击即添加），
           条目溢出时行内横向滚动 -->
      <template v-else>
        <div class="asset-drop-menu__header">
          {{ title }}
        </div>
        <div
          v-for="g in groups"
          :key="g.media"
          class="asset-drop-menu__row"
        >
          <div class="asset-drop-menu__row-label text-medium-emphasis text-body-small font-weight-medium">
            {{ g.title }}
          </div>
          <div class="asset-drop-menu__row-items">
            <div
              v-for="item in g.items"
              :key="item.path"
              class="asset-drop-menu__card"
              :class="`asset-drop-menu__card--${g.media}`"
            >
              <!-- 图片：点击缩略图即添加节点 -->
              <div
                v-if="g.media === 'image'"
                class="asset-drop-menu__thumb"
                :title="`点击添加节点（${item.nodeName}）`"
                @click="emit('select-item', item)"
              >
                <AssetThumb
                  :src="previewUrl(item.path)"
                  :width="88"
                  :height="88"
                  rounded
                />
              </div>
              <!-- 音频/视频：试听组件独占点击（播放控制不触发创建），点击名称行添加节点 -->
              <audio
                v-else-if="g.media === 'audio'"
                :src="previewUrl(item.path)"
                controls
                preload="metadata"
                class="asset-drop-menu__player"
              />
              <video
                v-else
                :src="previewUrl(item.path)"
                controls
                preload="metadata"
                class="asset-drop-menu__player asset-drop-menu__player--video"
              />
              <!-- 名称行：基础资产 = 实体名，变体 = 变体名；点击创建节点 -->
              <div
                class="asset-drop-menu__card-name"
                :title="`点击添加节点（${item.nodeName}）`"
                @click="emit('select-item', item)"
              >
                <span class="text-truncate asset-drop-menu__card-label">{{ item.label }}</span>
                <v-icon
                  size="14"
                  class="asset-drop-menu__card-add"
                >
                  mdi-plus-circle-outline
                </v-icon>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  CanvasDropMenuGroup,
  CanvasDropMenuItem,
} from '../../canvas/assetDrop'
import AssetThumb from '../asset-picker/AssetThumb.vue'

/**
 * 资产拖放菜单（纯展示组件）：
 * 状态（显隐/锚点坐标/分组/加载）由 useCanvasAssetDrop 持有，本组件只渲染与上抛事件。
 * 单层布局：图片/音频/视频各占一行（实体无对应资产的行隐藏），每行 = 媒体标签 + 横向滚动条目
 * （图片缩略图、音频/视频试听组件 + 条目名），点击条目名（图片亦可点击缩略图）创建节点。
 */
const props = withDefaults(defineProps<{
  /** 菜单显隐（v-model，父级 drop.menu.show） */
  modelValue: boolean
  /** 菜单锚点 x（相对画布容器） */
  x: number
  /** 菜单锚点 y（相对画布容器） */
  y: number
  /** 菜单标题（实体名） */
  title?: string
  /** 媒体分组列表（仅含可用资产的分组；空 = 实体无可选资产） */
  groups?: CanvasDropMenuGroup[]
  /** 分组加载中 */
  loading: boolean
  /** 打开次数递增：预览 URL 缓存破坏参数（避免复用旧图/旧音频） */
  bust: number
  /** 项目名（预览 URL 使用） */
  project: string
}>(), {
  title: '',
  groups: () => [],
})

const emit = defineEmits<{
  /** 菜单显隐变化 */
  (e: 'update:modelValue', value: boolean): void
  /** 点击资产条目（创建对应加载节点） */
  (e: 'select-item', item: CanvasDropMenuItem): void
}>()

/** 菜单锚点元素（0×0 隐藏定位点，VMenu 依此在释放位置弹出） */
const anchorEl = ref<HTMLElement | null>(null)

/** VMenu 的定位锚点：去掉 null（activator 类型不接受 null，undefined 可接受），元素挂载后即可用 */
const activator = computed(() => anchorEl.value ?? undefined)

/** 生成预览 URL（带缓存破坏参数，与资产选择器 thumbUrl 惯例一致） */
function previewUrl(path: string): string {
  return `/api/fs/${props.project}/${path}?t=${props.bust}`
}
</script>

<style scoped>
/* 菜单锚点：0×0 隐藏定位点，供 VMenu 在释放位置弹出（不拦截画布交互） */
.asset-drop-menu-anchor {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
  visibility: hidden;
}

/* 菜单内容：宽度随内容自适应（不超过上限），高度超限纵向滚动；
   浮层内容默认透明背景，需显式绘制表面底色 + 阴影，避免与画布叠加时穿帮 */
.asset-drop-menu {
  max-height: 400px;
  overflow-y: auto;
  width: max-content;
  min-width: 280px;
  max-width: 640px;
  background: rgb(var(--v-theme-surface));
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
}

/* 菜单标题：加粗 + 底部细分隔线 */
.asset-drop-menu__header {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding: 4px 12px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

/* 媒体分组行：左侧标签列 + 右侧横向滚动条目区 */
.asset-drop-menu__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
}

.asset-drop-menu__row + .asset-drop-menu__row {
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}

/* 媒体标签列（图片/音频/视频）：固定宽度 + 右侧分隔线 */
.asset-drop-menu__row-label {
  flex: none;
  width: 40px;
  text-align: center;
  line-height: 1;
  padding-right: 8px;
  border-right: 1px solid rgba(0, 0, 0, 0.08);
  user-select: none;
}

/* 条目区：横向排列，溢出时出现横向滚动条 */
.asset-drop-menu__row-items {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  overflow-x: auto;
  padding: 2px;
}

.asset-drop-menu__row-items::-webkit-scrollbar {
  height: 6px;
}

.asset-drop-menu__row-items::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
}

.asset-drop-menu__row-items::-webkit-scrollbar-track {
  background: transparent;
}

/* 条目卡片：缩略图/试听组件 + 名称行（纵向排列，宽度固定保证横向滚动对齐） */
.asset-drop-menu__card {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 96px;
}

.asset-drop-menu__card--audio,
.asset-drop-menu__card--video {
  width: 200px;
}

/* 图片缩略图：点击即添加节点 */
.asset-drop-menu__thumb {
  width: 88px;
  height: 88px;
  padding: 2px;
  border-radius: 8px;
  cursor: pointer;
}

.asset-drop-menu__thumb:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}

/* 音频/视频试听组件：占满卡片宽度；视频限高避免撑大菜单 */
.asset-drop-menu__player {
  width: 100%;
  border-radius: 4px;
}

.asset-drop-menu__player--video {
  height: 96px;
  object-fit: contain;
  background: #000;
}

/* 名称行：实体名/变体名，点击即添加节点（+ 号 hover 时显示） */
.asset-drop-menu__card-name {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  max-width: 100%;
  min-width: 0;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.2;
  cursor: pointer;
}

.asset-drop-menu__card-name:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}

.asset-drop-menu__card-label {
  min-width: 0;
}

.asset-drop-menu__card-add {
  flex: none;
  opacity: 0;
  transition: opacity 0.15s;
  color: rgb(var(--v-theme-primary));
}

.asset-drop-menu__card-name:hover .asset-drop-menu__card-add {
  opacity: 1;
}
</style>
