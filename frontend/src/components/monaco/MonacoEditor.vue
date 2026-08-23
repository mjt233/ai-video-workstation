<template>
  <div
    ref="container"
    class="monaco-editor-host"
    :style="{ height: typeof height === 'number' ? height + 'px' : height }"
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

/**
 * 全局 Monaco worker 配置（模块级单例，进程内只设置一次）：
 * typescript/javascript 语言加载 ts.worker，其余加载 editor.worker。
 */
;(globalThis as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

const props = withDefaults(
  defineProps<{
    /** 编辑器内容（v-model） */
    modelValue: string
    /** 额外 TS 类型库（每次变更整体替换；filePath 唯一标识一条库） */
    extraLibs?: Array<{ content: string; filePath: string }>
    /** 语言，默认 typescript */
    language?: string
    /** 是否只读 */
    readOnly?: boolean
    /** 编辑器高度（css 值或像素数字，默认 420px） */
    height?: string | number
  }>(),
  {
    extraLibs: () => [],
    language: 'typescript',
    readOnly: false,
    height: 420,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const container = ref<HTMLElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null

/** 额外 TS 类型库的文件路径前缀（虚拟文件，仅用于类型提示） */
const LIB_PREFIX = 'file:///custom-provider-types/'

/**
 * 把 props.extraLibs 整体替换进 Monaco TypeScript 默认配置。
 *
 * setExtraLibs 会整体替换用户额外库（不影响内置 lib.d.ts / dom.d.ts），
 * 因此动态 params 类型与通用代码导出提示随 props 变化即时刷新。
 */
function applyExtraLibs() {
  const defaults = monaco.languages.typescript.typescriptDefaults
  defaults.setExtraLibs(
    (props.extraLibs ?? []).map((lib) => ({
      content: lib.content,
      filePath: lib.filePath.startsWith('file://') ? lib.filePath : LIB_PREFIX + lib.filePath,
    })),
  )
}

onMounted(() => {
  if (!container.value) return
  const defaults = monaco.languages.typescript.typescriptDefaults
  defaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    allowNonTsExtensions: true,
    strict: false,
    skipLibCheck: true,
  })
  defaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  })
  applyExtraLibs()
  editor = monaco.editor.create(container.value, {
    value: props.modelValue,
    language: props.language,
    theme: 'vs',
    readOnly: props.readOnly,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    scrollBeyondLastLine: false,
    tabSize: 2,
  })
  editor.onDidChangeModelContent(() => {
    emit('update:modelValue', editor?.getValue() ?? '')
  })
})

/** 外部值变化时同步编辑器（编辑器自身输入不回写） */
watch(
  () => props.modelValue,
  (value) => {
    if (editor && editor.getValue() !== value) editor.setValue(value)
  },
)

/** 类型库变化时刷新提示 */
watch(
  () => props.extraLibs,
  () => applyExtraLibs(),
  { deep: true },
)

onBeforeUnmount(() => {
  editor?.dispose()
  editor = null
})
</script>

<style scoped>
.monaco-editor-host {
  width: 100%;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  overflow: hidden;
}
</style>
