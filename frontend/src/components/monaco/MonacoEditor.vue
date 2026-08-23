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
    /** 刷新令牌：变化时重新登记类型库（用于对话框重新打开时让本编辑器的库重新生效） */
    refreshKey?: number
  }>(),
  {
    extraLibs: () => [],
    language: 'typescript',
    readOnly: false,
    height: 420,
    refreshKey: 0,
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
 * 模块级额外库注册表：每个编辑器实例登记自己的类型库。
 *
 * typescriptDefaults 是全局单例，若每个编辑器挂载/更新时各自 setExtraLibs
 * 整体替换，会互相覆盖（如打开「通用代码块」对话框后工作流编辑器里的
 * 通用代码导出提示丢失、修改通用代码后不刷新）。这里改为登记到共享注册表，
 * 统一合并为并集后写入，保证所有已挂载编辑器的提示始终是最新并集。
 */
const libRegistry = new Map<number, Array<{ content: string; filePath: string }>>()
let nextLibId = 1

/**
 * 把注册表中的全部类型库合并后写入 Monaco 全局默认。
 *
 * 同名 filePath 后登记的内容覆盖先登记的（各编辑器对同一虚拟文件的内容
 * 应保持一致或互为超集，覆盖不会破坏提示）。
 */
function flushExtraLibs() {
  const byPath = new Map<string, string>()
  for (const [, libs] of libRegistry) {
    for (const lib of libs) byPath.set(lib.filePath, lib.content)
  }
  const all: Array<{ content: string; filePath: string }> = []
  for (const [filePath, content] of byPath) {
    all.push({ content, filePath })
  }
  monaco.languages.typescript.typescriptDefaults.setExtraLibs(all)
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
  syncRegistry()
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

/**
 * 把当前编辑器的类型库登记进共享注册表并刷新全局并集。
 */
function syncRegistry() {
  libRegistry.set(libId, (props.extraLibs ?? []).map((lib) => ({
    content: lib.content,
    filePath: lib.filePath.startsWith('file://') ? lib.filePath : LIB_PREFIX + lib.filePath,
  })))
  flushExtraLibs()
}

/** 类型库变化时刷新提示（含通用代码块修改、用户配置字段增删等场景） */
watch(
  () => props.extraLibs,
  () => syncRegistry(),
  { deep: true },
)

/** 刷新令牌变化时重新登记（对话框重新打开时覆盖其他编辑器对同名虚拟文件的旧内容） */
watch(
  () => props.refreshKey,
  () => syncRegistry(),
)

/** 本实例在注册表中的唯一 id（卸载时移除自己的登记） */
const libId = nextLibId++

onBeforeUnmount(() => {
  libRegistry.delete(libId)
  flushExtraLibs()
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
