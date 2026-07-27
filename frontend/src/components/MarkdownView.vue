<template>
  <div
    class="markdown-view"
    v-html="renderedContent"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'

const props = withDefaults(defineProps<{
  content?: string
  sanitize?: boolean
}>(), {
  content: '',
  sanitize: false,
})

const renderedContent = computed(() => {
  return marked.parse(props.content || '') as string
})
</script>

<style scoped>
/* === Material Design Markdown 样式 === */

.markdown-view {
  font-family: 'Roboto', 'Noto Sans SC', sans-serif;
  font-size: 0.95rem;
  line-height: 1.75;
  color: rgba(0, 0, 0, 0.87);
  word-break: break-word;
  overflow-wrap: break-word;
}

/* --- 标题 --- */
.markdown-view :deep(h1),
.markdown-view :deep(h2),
.markdown-view :deep(h3),
.markdown-view :deep(h4),
.markdown-view :deep(h5),
.markdown-view :deep(h6) {
  font-weight: 500;
  line-height: 1.3;
  margin-top: 1.2em;
  margin-bottom: 0.5em;
  color: rgba(0, 0, 0, 0.87);
}

.markdown-view :deep(h1) {
  font-size: 1.75rem;
  border-bottom: 2px solid rgb(var(--v-theme-primary));
  padding-bottom: 0.3em;
  margin-top: 0;
}

.markdown-view :deep(h2) {
  font-size: 1.45rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  padding-bottom: 0.25em;
}

.markdown-view :deep(h3) {
  font-size: 1.2rem;
}

.markdown-view :deep(h4) {
  font-size: 1.05rem;
}

.markdown-view :deep(h5) {
  font-size: 0.95rem;
}

.markdown-view :deep(h6) {
  font-size: 0.88rem;
  color: rgba(0, 0, 0, 0.6);
}

/* --- 段落 --- */
.markdown-view :deep(p) {
  margin: 0.6em 0;
}

/* --- 链接 --- */
.markdown-view :deep(a) {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
  transition: border-bottom 0.2s;
  border-bottom: 1px solid transparent;
}

.markdown-view :deep(a:hover) {
  border-bottom-color: rgb(var(--v-theme-primary));
}

/* --- 行内代码 --- */
.markdown-view :deep(code) {
  font-family: 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: 0.88em;
  padding: 0.15em 0.4em;
  border-radius: 4px;
  background-color: rgba(0, 0, 0, 0.06);
  color: #d63384;
}

/* --- 代码块 --- */
.markdown-view :deep(pre) {
  position: relative;
  margin: 1em 0;
  padding: 1em 1.2em;
  border-radius: 8px;
  background-color: #1e1e2e;
  overflow-x: auto;
  font-size: 0.85rem;
  line-height: 1.6;
}

.markdown-view :deep(pre code) {
  background: none;
  padding: 0;
  border-radius: 0;
  color: #cdd6f4;
  font-size: inherit;
}

/* --- 列表 --- */
.markdown-view :deep(ul),
.markdown-view :deep(ol) {
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.markdown-view :deep(li) {
  margin: 0.25em 0;
}

.markdown-view :deep(li::marker) {
  color: rgb(var(--v-theme-primary));
}

/* --- 任务列表 (GFM) --- */
.markdown-view :deep(input[type="checkbox"]) {
  margin-right: 0.4em;
  accent-color: rgb(var(--v-theme-primary));
}

/* --- 引用块 --- */
.markdown-view :deep(blockquote) {
  margin: 1em 0;
  padding: 0.6em 1em;
  border-left: 4px solid rgb(var(--v-theme-primary));
  background-color: rgba(var(--v-theme-primary), 0.06);
  border-radius: 0 8px 8px 0;
  color: rgba(0, 0, 0, 0.7);
}

.markdown-view :deep(blockquote p) {
  margin: 0.3em 0;
}

/* --- 水平线 --- */
.markdown-view :deep(hr) {
  border: none;
  height: 1px;
  background-color: rgba(0, 0, 0, 0.12);
  margin: 1.5em 0;
}

/* --- 表格 --- */
.markdown-view :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 0.9rem;
}

.markdown-view :deep(th),
.markdown-view :deep(td) {
  padding: 0.6em 0.8em;
  border: 1px solid rgba(0, 0, 0, 0.12);
  text-align: left;
}

.markdown-view :deep(th) {
  background-color: rgba(var(--v-theme-primary), 0.08);
  font-weight: 600;
  color: rgba(0, 0, 0, 0.87);
}

.markdown-view :deep(tr:nth-child(even)) {
  background-color: rgba(0, 0, 0, 0.03);
}

.markdown-view :deep(tr:hover) {
  background-color: rgba(0, 0, 0, 0.05);
}

/* --- 图片 --- */
.markdown-view :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 0.5em 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* --- 粗体 / 斜体 --- */
.markdown-view :deep(strong) {
  font-weight: 600;
  color: rgba(0, 0, 0, 0.92);
}

.markdown-view :deep(em) {
  font-style: italic;
}

/* --- 删除线 --- */
.markdown-view :deep(del) {
  color: rgba(0, 0, 0, 0.4);
}

/* --- 暗色模式适配 --- */
@media (prefers-color-scheme: dark) {
  .markdown-view {
    color: rgba(255, 255, 255, 0.87);
  }

  .markdown-view :deep(h1),
  .markdown-view :deep(h2),
  .markdown-view :deep(h3),
  .markdown-view :deep(h4),
  .markdown-view :deep(h5),
  .markdown-view :deep(h6) {
    color: rgba(255, 255, 255, 0.92);
  }

  .markdown-view :deep(h2) {
    border-bottom-color: rgba(255, 255, 255, 0.12);
  }

  .markdown-view :deep(h6) {
    color: rgba(255, 255, 255, 0.6);
  }

  .markdown-view :deep(code) {
    background-color: rgba(255, 255, 255, 0.1);
    color: #f5a0c0;
  }

  .markdown-view :deep(blockquote) {
    background-color: rgba(var(--v-theme-primary), 0.1);
    color: rgba(255, 255, 255, 0.75);
  }

  .markdown-view :deep(hr) {
    background-color: rgba(255, 255, 255, 0.12);
  }

  .markdown-view :deep(th),
  .markdown-view :deep(td) {
    border-color: rgba(255, 255, 255, 0.12);
  }

  .markdown-view :deep(th) {
    background-color: rgba(var(--v-theme-primary), 0.15);
    color: rgba(255, 255, 255, 0.92);
  }

  .markdown-view :deep(tr:nth-child(even)) {
    background-color: rgba(255, 255, 255, 0.04);
  }

  .markdown-view :deep(tr:hover) {
    background-color: rgba(255, 255, 255, 0.07);
  }

  .markdown-view :deep(strong) {
    color: rgba(255, 255, 255, 0.95);
  }

  .markdown-view :deep(del) {
    color: rgba(255, 255, 255, 0.4);
  }

  .markdown-view :deep(a) {
    color: #82b1ff;
  }

  .markdown-view :deep(a:hover) {
    border-bottom-color: #82b1ff;
  }
}
</style>
