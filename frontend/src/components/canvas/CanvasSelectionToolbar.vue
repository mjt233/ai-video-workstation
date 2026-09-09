<template>
  <!-- 多选悬浮工具栏：多选（节点数 + 分组数 ≥ 2）时在多选框顶部居中悬浮。
       定位：流坐标包围盒 → 屏幕坐标（viewport 换算）→ 顶部居中，距包围盒上边缘 8px；
       顶部空间不足时翻转到包围盒下方。容器加 nodrag + mousedown.stop，
       避免点击工具栏触发画布 pan / 框选 / pane-click（清空选中）。 -->
  <div
    v-if="rect"
    class="canvas-selection-toolbar nodrag"
    :style="style"
    @mousedown.stop
    @click.stop
    @contextmenu.prevent
  >
    <v-tooltip
      text="选中集已包含分组"
      :disabled="!hasGroupSelected"
      location="top"
    >
      <template #activator="{ props: activatorProps }">
        <span
          v-bind="activatorProps"
          class="canvas-selection-toolbar__wrap"
        >
          <v-btn
            size="small"
            variant="flat"
            color="primary"
            prepend-icon="mdi-folder-plus-outline"
            :disabled="hasGroupSelected"
            @click="emit('create-group')"
          >
            创建分组
          </v-btn>
        </span>
      </template>
    </v-tooltip>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { GroupRect } from '../../canvas/groupSelection'

/** 工具栏高度估算（像素，用于判断顶部空间是否足够、是否翻转到下方） */
const TOOLBAR_HEIGHT = 40
/** 工具栏与多选框边缘的间距（像素） */
const TOOLBAR_GAP = 8
/** 工具栏半宽估算（像素，用于横向钳制在容器内） */
const TOOLBAR_HALF_WIDTH = 70

/**
 * 多选悬浮工具栏（纯展示组件）。
 * 状态（包围盒、是否含分组选中）由 AssetCanvas 从各组合式读取后传入，动作经事件上抛。
 */
const props = defineProps<{
  /** 多选包围盒（流坐标；选中节点包围盒 ∪ 选中分组矩形 + 留白）；无多选时为 null */
  rect: GroupRect | null
  /** Vue Flow 视口（pan/zoom，用于流坐标 → 屏幕坐标换算） */
  viewport: { x: number; y: number; zoom: number }
  /** 画布容器可视宽度（像素，用于横向钳制，避免工具栏跑出画布） */
  flowWidth: number
  /** 选中集是否包含分组（包含时禁用创建分组：避免框套框） */
  hasGroupSelected: boolean
}>()

const emit = defineEmits<{
  /** 点击「创建分组」（父级按选中节点包围盒创建分组） */
  (e: 'create-group'): void
}>()

/**
 * 工具栏绝对定位样式（相对画布容器）：
 * 默认位于包围盒上方居中；顶部空间不足时翻转到包围盒下方。
 */
const style = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  const rect = props.rect
  if (!rect) {
    out.display = 'none'
    return out
  }
  const zoom = props.viewport?.zoom ?? 1
  const screenX = (props.viewport?.x ?? 0) + rect.x * zoom
  const screenY = (props.viewport?.y ?? 0) + rect.y * zoom
  const screenWidth = rect.width * zoom
  const screenHeight = rect.height * zoom
  // 横向：包围盒中心；钳制在容器内（容器宽度未知时不做钳制）
  const centerX = screenX + screenWidth / 2
  const left = props.flowWidth > 0
    ? Math.min(Math.max(centerX, TOOLBAR_HALF_WIDTH), Math.max(props.flowWidth - TOOLBAR_HALF_WIDTH, TOOLBAR_HALF_WIDTH))
    : centerX
  // 纵向：上方空间不足（含工具栏高度与间距）时翻转到下方
  const fitsAbove = screenY - TOOLBAR_HEIGHT - TOOLBAR_GAP >= 0
  out.left = `${Math.round(left)}px`
  out.top = fitsAbove
    ? `${Math.round(screenY - TOOLBAR_GAP)}px`
    : `${Math.round(screenY + screenHeight + TOOLBAR_GAP)}px`
  out.transform = fitsAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)'
  return out
})
</script>

<style scoped>
.canvas-selection-toolbar {
  position: absolute;
  z-index: 25;
  display: flex;
  align-items: center;
  padding: 4px 6px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  white-space: nowrap;
  user-select: none;
}

.canvas-selection-toolbar__wrap {
  display: inline-flex;
}
</style>
