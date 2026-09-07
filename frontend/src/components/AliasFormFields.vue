<template>
  <div class="alias-form-fields">
    <v-text-field
      :model-value="alias"
      label="别名"
      variant="outlined"
      :maxlength="50"
      hint="留空保存 = 不使用别名；仅用于显示，不改变编号"
      persistent-hint
      @update:model-value="$emit('update:alias', $event)"
    />
    <v-checkbox
      :model-value="showPrefix"
      label="显示编号前缀（如 第3集 / 分镜2）"
      hide-details
      dense
      @update:model-value="$emit('update:showPrefix', !!$event)"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 集数/分镜别名表单字段（别名输入 + 显示编号前缀开关）。
 *
 * 复用场景：
 * - AssetCreateDialog（新增集数/分镜、移动分镜）
 * - AssetTree 的「编辑别名」对话框
 */
defineProps<{
  /** 别名内容（空串 = 不使用别名） */
  alias: string
  /** 是否显示编号前缀（如「第3集」「分镜2」；默认 true） */
  showPrefix: boolean
}>()

defineEmits<{
  /** 别名内容变化 */
  'update:alias': [string]
  /** 是否显示编号前缀变化 */
  'update:showPrefix': [boolean]
}>()
</script>

<style scoped>
.alias-form-fields {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
