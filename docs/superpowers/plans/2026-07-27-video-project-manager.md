# 视频项目管理器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web management UI for browsing/editing video project assets (characters, stages, storyboards) in the `design/` directory.

**Architecture:** Express backend serves a generic path-based file system API (`/api/fs/`) over the `design/` directory; Vue 3 + Vuetify SPA constructs the UI by reading files/directories at known paths. Production: Express serves the built SPA statically.

**Tech Stack:** Node.js/Express, Vue 3, Vuetify 3, Vite

---

### Task 1: Server Scaffolding

**Files:**
- Create: `server/package.json`
- Create: `server/src/index.js`

- [ ] **Step 1: Create server/package.json**

```json
{
  "name": "video-project-manager-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js"
  },
  "dependencies": {
    "express": "^4.21.0"
  }
}
```

- [ ] **Step 2: Create server/src/index.js**

```js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { fsRouter } from './routes/fs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.use('/api', fsRouter);

const distPath = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(distPath, 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

- [ ] **Step 3: Install dependencies**

Run: `cd server && npm install`
Expected: express added to node_modules

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/src/index.js
git commit -m "feat: add express server scaffold"
```

---

### Task 2: Server API — /api/projects + /api/fs/ read/write

**Files:**
- Create: `server/src/routes/fs.js`

- [ ] **Step 1: Create server/src/routes/fs.js**

```js
import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESIGN_DIR = path.resolve(__dirname, '../../../design');
const ALLOWED_PREFIXES = ['prompt', 'assert'];

export const fsRouter = Router();

// GET /api/projects — list projects
fsRouter.get('/projects', async (req, res) => {
  try {
    const entries = await fs.readdir(DESIGN_DIR, { withFileTypes: true });
    const projects = entries
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name }));
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fs/:project/:path(*) — read file or directory listing
fsRouter.get('/fs/:project/*', async (req, res) => {
  try {
    const project = req.params.project;
    const relPath = req.params[0] || '';
    const fullPath = path.resolve(DESIGN_DIR, project, relPath);

    if (!fullPath.startsWith(path.resolve(DESIGN_DIR, project))) {
      return res.status(403).json({ error: 'Path traversal denied' });
    }

    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      res.json({
        entries: entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file'
        }))
      });
    } else {
      const ext = path.extname(fullPath).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.flac', '.mp3', '.wav'].includes(ext)) {
        res.sendFile(fullPath);
      } else {
        const content = await fs.readFile(fullPath, 'utf-8');
        res.send(content);
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.status(404).json({ error: 'Not found' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// POST /api/fs/:project/:path(*) — write file
fsRouter.post('/fs/:project/*', async (req, res) => {
  try {
    const project = req.params.project;
    const relPath = req.params[0] || '';
    const fullPath = path.resolve(DESIGN_DIR, project, relPath);

    if (!fullPath.startsWith(path.resolve(DESIGN_DIR, project))) {
      return res.status(403).json({ error: 'Path traversal denied' });
    }

    const prefix = relPath.split('/')[0];
    if (!ALLOWED_PREFIXES.includes(prefix)) {
      return res.status(403).json({ error: 'Only prompt/ and assert/ paths are writable' });
    }

    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content must be a string' });
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Test manually**

Run: `cd server && node src/index.js` then in another terminal:
```bash
curl http://localhost:3001/api/projects
```
Expected: `[{"name":"古人在现代"},{"name":"AI的第一天"}]`

```bash
curl http://localhost:3001/api/fs/古人在现代/prompt/character/
```
Expected: `{"entries":[{"name":"陈书文","type":"dir"},{"name":"现代女孩","type":"dir"}]}`

```bash
curl http://localhost:3001/api/fs/古人在现代/prompt/character/陈书文/overview.md
```
Expected: raw markdown content

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/fs.js
git commit -m "feat: implement /api/projects and /api/fs/ routes"
```

---

### Task 3: Frontend Scaffolding

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.js`
- Create: `frontend/index.html`

- [ ] **Step 1: Create frontend/package.json**

```json
{
  "name": "video-project-manager-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.5.0",
    "vue-router": "^4.4.0",
    "vuetify": "^3.7.0",
    "axios": "^1.7.0",
    "mdi": "^2.2.0",
    "@mdi/font": "^7.4.0",
    "marked": "^14.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create frontend/vite.config.js**

```js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5233,
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
})
```

- [ ] **Step 3: Create frontend/index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>视频项目管理器</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step 4: Install dependencies**

Run: `cd frontend && npm install`
Expected: node_modules created

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/vite.config.js frontend/index.html
git commit -m "feat: add frontend scaffold (Vite + Vue)"
```

---

### Task 4: App Shell + Router + API Client

**Files:**
- Create: `frontend/src/main.js`
- Create: `frontend/src/App.vue`
- Create: `frontend/src/api/client.js`
- Create: `frontend/src/router/index.js`

- [ ] **Step 1: Create frontend/src/main.js**

```js
import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import App from './App.vue'
import router from './router'

const vuetify = createVuetify({ components, directives })

createApp(App).use(vuetify).use(router).mount('#app')
```

- [ ] **Step 2: Create frontend/src/App.vue**

```vue
<template>
  <v-app>
    <v-app-bar flat>
      <v-toolbar-title>视频项目管理器</v-toolbar-title>
    </v-app-bar>
    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup>
</script>
```

- [ ] **Step 3: Create frontend/src/api/client.js**

```js
import axios from 'axios'

const client = axios.create({ baseURL: '/api' })

export async function getProjects() {
  const { data } = await client.get('/projects')
  return data
}

export async function readFs(project, path) {
  const { data } = await client.get(`/fs/${project}/${path}`)
  return data
}

export async function writeFs(project, path, content) {
  const { data } = await client.post(`/fs/${project}/${path}`, { content })
  return data
}

export default client
```

- [ ] **Step 4: Create frontend/src/router/index.js**

```js
import { createRouter, createWebHistory } from 'vue-router'
import ProjectSelectPage from '../views/ProjectSelectPage.vue'
import ProjectView from '../views/ProjectView.vue'

const routes = [
  { path: '/', component: ProjectSelectPage },
  { path: '/project', component: ProjectView },
]

export default createRouter({ history: createWebHistory(), routes })
```

- [ ] **Step 5: Verify frontend starts**

Run: `cd frontend && npm run dev`
Expected: Vite dev server starts without errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/main.js frontend/src/App.vue frontend/src/api/client.js frontend/src/router/index.js
git commit -m "feat: add app shell, router, and API client"
```

---

### Task 5: ProjectSelectPage

**Files:**
- Create: `frontend/src/views/ProjectSelectPage.vue`

- [ ] **Step 1: Create frontend/src/views/ProjectSelectPage.vue**

```vue
<template>
  <v-container class="d-flex align-center justify-center" style="height: 80vh">
    <v-card min-width="400">
      <v-card-title>选择项目</v-card-title>
      <v-card-text>
        <v-list v-if="projects.length">
          <v-list-item
            v-for="p in projects"
            :key="p.name"
            @click="$router.push('/project?project=' + p.name)"
          >
            <v-list-item-title>{{ p.name }}</v-list-item-title>
          </v-list-item>
        </v-list>
        <v-progress-circular v-else indeterminate />
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getProjects } from '../api/client.js'

const projects = ref([])
onMounted(async () => {
  projects.value = await getProjects()
})
</script>
```

- [ ] **Step 2: Verify in browser**

Run: `cd server && node src/index.js` and `cd frontend && npm run dev`
Open: `http://localhost:5173/`
Expected: Shows project list with "古人在现代" and "AI的第一天"

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/ProjectSelectPage.vue
git commit -m "feat: add project select page"
```

---

### Task 6: AssetTree Component

**Files:**
- Create: `frontend/src/components/AssetTree.vue`

- [ ] **Step 1: Create frontend/src/components/AssetTree.vue**

```vue
<template>
  <v-treeview
    :items="treeItems"
    item-title="name"
    item-key="path"
    @update:selected="onSelect"
    return-object
  >
    <template v-slot:prepend="{ item }">
      <v-icon>{{ item.icon }}</v-icon>
    </template>
  </v-treeview>
</template>

<script setup>
import { ref, watch } from 'vue'
import { readFs } from '../api/client.js'
import { useRouter } from 'vue-router'

const props = defineProps({ project: String })
const emit = defineEmits(['navigate'])
const router = useRouter()
const treeItems = ref([])

async function buildTree() {
  const characters = await readFs(props.project, 'prompt/character/')
  const stages = await readFs(props.project, 'prompt/stage/')
  const episodes = await readFs(props.project, 'prompt/scene/')

  const charItems = characters.entries.map(c => ({
    name: c.name,
    path: `character-${c.name}`,
    icon: 'mdi-account',
    type: 'character'
  }))

  const stageItems = stages.entries.map(s => ({
    name: s.name,
    path: `stage-${s.name}`,
    icon: 'mdi-city',
    type: 'stage'
  }))

  const episodeItems = []
  for (const ep of episodes.entries) {
    const shots = await readFs(props.project, `prompt/scene/${ep.name}/`)
    episodeItems.push({
      name: `第${ep.name}集`,
      path: `episode-${ep.name}`,
      icon: 'mdi-filmstrip',
      children: shots.entries.map(sh => ({
        name: `分镜${sh.name}`,
        path: `scene-${ep.name}-${sh.name}`,
        icon: 'mdi-image-multiple',
        type: 'scene',
        episode: ep.name,
        shot: sh.name
      }))
    })
  }

  treeItems.value = [
    { name: '角色', path: 'root-character', icon: 'mdi-account-group', children: charItems },
    { name: '场景', path: 'root-stage', icon: 'mdi-city', children: stageItems },
    { name: '集数分镜', path: 'root-scene', icon: 'mdi-filmstrip', children: episodeItems },
  ]
}

function onSelect(items) {
  if (!items.length) return
  const item = items[0]
  if (!item.type) return
  router.push({
    query: { ...router.currentRoute.value.query, type: item.type, name: item.name, episode: item.episode, shot: item.shot }
  })
}

watch(() => props.project, buildTree, { immediate: true })
</script>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/AssetTree.vue
git commit -m "feat: add asset tree component"
```

---

### Task 7: ProjectView Layout

**Files:**
- Create: `frontend/src/views/ProjectView.vue`

- [ ] **Step 1: Create frontend/src/views/ProjectView.vue**

```vue
<template>
  <v-row class="ma-0" style="height: calc(100vh - 64px)">
    <v-col cols="3" class="pa-2 border-e">
      <AssetTree :project="project" />
    </v-col>
    <v-col cols="9" class="pa-4">
      <CharacterPanel v-if="type === 'character'" :project :name />
      <StagePanel v-else-if="type === 'stage'" :project :name />
      <ScenePanel v-else-if="type === 'scene'" :project :episode :shot />
      <div v-else class="d-flex align-center justify-center text-grey" style="height: 100%">
        从左侧选择一个资产查看
      </div>
    </v-col>
  </v-row>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AssetTree from '../components/AssetTree.vue'
import CharacterPanel from '../components/CharacterPanel.vue'
import StagePanel from '../components/StagePanel.vue'
import ScenePanel from '../components/ScenePanel.vue'

const route = useRoute()
const project = computed(() => route.query.project)
const type = computed(() => route.query.type)
const name = computed(() => route.query.name)
const episode = computed(() => route.query.episode)
const shot = computed(() => route.query.shot)
</script>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/views/ProjectView.vue
git commit -m "feat: add project view with left-right layout"
```

---

### Task 8: CharacterPanel (with EditDialog)

**Files:**
- Create: `frontend/src/components/CharacterPanel.vue`

- [ ] **Step 1: Create frontend/src/components/CharacterPanel.vue**

```vue
<template>
  <div v-if="data">
    <v-expansion-panels v-model="panel">
      <v-expansion-panel value="overview">
        <v-expansion-panel-title>角色总览</v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="d-flex justify-end mb-2">
            <v-btn icon variant="text" size="small" @click="edit('overview')"><v-icon>mdi-pencil</v-icon></v-btn>
          </div>
          <div v-html="renderMd(data.overview)"></div>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel value="appearance">
        <v-expansion-panel-title>外观设计</v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="d-flex justify-end mb-2">
            <v-btn icon variant="text" size="small" @click="edit('appearance')"><v-icon>mdi-pencil</v-icon></v-btn>
          </div>
          <v-row>
            <v-col cols="6"><div v-html="renderMd(data.appearance)"></div></v-col>
            <v-col cols="6">
              <v-img v-if="appearanceImg" :src="appearanceImg" max-height="400" contain />
              <div v-else class="text-grey">暂无图片</div>
            </v-col>
          </v-row>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel value="voice">
        <v-expansion-panel-title>声音</v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="d-flex justify-end mb-2">
            <v-btn icon variant="text" size="small" @click="edit('voice')"><v-icon>mdi-pencil</v-icon></v-btn>
          </div>
          <v-row>
            <v-col cols="6"><div v-html="renderMd(data.voice)"></div></v-col>
            <v-col cols="6">
              <audio v-if="voiceAudio" :src="voiceAudio" controls style="width: 100%" />
              <div v-else class="text-grey">暂无音频</div>
            </v-col>
          </v-row>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-dialog v-model="dialog.show" max-width="800">
      <v-card>
        <v-card-title>编辑 {{ dialog.field }}</v-card-title>
        <v-card-text>
          <v-textarea v-model="dialog.content" rows="15" variant="outlined" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog.show = false">取消</v-btn>
          <v-btn color="primary" @click="save">保存</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { readFs, writeFs } from '../api/client.js'
import { marked } from 'marked'

const props = defineProps({ project: String, name: String })

const panel = ref(0)
const data = ref(null)
const appearanceImg = computed(() => `/api/fs/${props.project}/assert/character/${props.name}/appearance.jpg`)
const voiceAudio = computed(() => `/api/fs/${props.project}/assert/character/${props.name}/voice.flac`)

const dialog = ref({ show: false, field: '', content: '' })

async function load() {
  const [overview, appearance, voice] = await Promise.all([
    readFs(props.project, `prompt/character/${props.name}/overview.md`).catch(() => ''),
    readFs(props.project, `prompt/character/${props.name}/appearance.md`).catch(() => ''),
    readFs(props.project, `prompt/character/${props.name}/voice.md`).catch(() => ''),
  ])
  data.value = { overview, appearance, voice }
}

function edit(field) {
  dialog.value = { show: true, field, content: data.value[field] }
}

async function save() {
  const field = dialog.value.field
  const file = `${field}.md`
  await writeFs(props.project, `prompt/character/${props.name}/${file}`, dialog.value.content)
  data.value[field] = dialog.value.content
  dialog.value.show = false
}

function renderMd(text) {
  return marked.parse(text || '')
}

watch(() => [props.project, props.name], load, { immediate: true })
</script>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/CharacterPanel.vue
git commit -m "feat: add character panel with edit support"
```

---

### Task 9: ScenePanel (with EditDialog)

- [ ] **Step 1: Create frontend/src/components/ScenePanel.vue**

```vue
<template>
  <div v-if="data">
    <v-tabs v-model="tab">
      <v-tab value="overview">总览</v-tab>
      <v-tab value="script">台词</v-tab>
      <v-tab value="images">场景图片</v-tab>
    </v-tabs>

    <v-tabs-window v-model="tab">
      <v-tabs-window-item value="overview">
        <div class="d-flex justify-end mt-2 mb-2">
          <v-btn icon variant="text" size="small" @click="edit('overview')"><v-icon>mdi-pencil</v-icon></v-btn>
        </div>
        <div v-html="renderMd(data.overview)"></div>
      </v-tabs-window-item>

      <v-tabs-window-item value="script">
        <div class="d-flex justify-end mt-2 mb-2">
          <v-btn icon variant="text" size="small" @click="editJson('script')"><v-icon>mdi-pencil</v-icon></v-btn>
        </div>
        <pre>{{ JSON.stringify(data.script, null, 2) }}</pre>
      </v-tabs-window-item>

      <v-tabs-window-item value="images">
        <v-row>
          <v-col v-for="(img, i) in stageImages" :key="i" cols="6">
            <v-card>
              <v-card-text class="text-center">场景{{ i }}</v-card-text>
              <v-img :src="img" max-height="400" contain />
            </v-card>
          </v-col>
          <v-col v-if="!stageImages.length" cols="12">
            <div class="text-grey">暂无场景图片</div>
          </v-col>
        </v-row>
      </v-tabs-window-item>
    </v-tabs-window>

    <v-dialog v-model="dialog.show" max-width="800">
      <v-card>
        <v-card-title>编辑 {{ dialog.field }}</v-card-title>
        <v-card-text>
          <v-textarea v-model="dialog.content" rows="15" variant="outlined" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog.show = false">取消</v-btn>
          <v-btn color="primary" @click="save">保存</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { readFs, writeFs } from '../api/client.js'
import { marked } from 'marked'

const props = defineProps({ project: String, episode: String, shot: String })
const tab = ref(null)
const data = ref(null)
const stageImages = ref([])
const dialog = ref({ show: false, field: '', content: '' })

const basePath = computed(() => `prompt/scene/${props.episode}/${props.shot}`)
const assertBase = computed(() => `/api/fs/${props.project}/assert/scene/${props.episode}/${props.shot}/stage`)

async function load() {
  const bp = basePath.value
  try {
    const [overview, scriptRaw] = await Promise.all([
      readFs(props.project, `${bp}/overview.md`).catch(() => ''),
      readFs(props.project, `${bp}/script.json`).catch(() => '[]'),
    ])
    let script = []
    try { script = JSON.parse(scriptRaw) } catch {}
    data.value = { overview, script }
  } catch {}

  // try to read stage.json to know how many stage images
  try {
    const stageRaw = await readFs(props.project, `${bp}/stage.json`)
    const stage = JSON.parse(stageRaw)
    if (Array.isArray(stage)) {
      stageImages.value = stage.map((_, i) => `${assertBase.value}/${i}.jpg`)
    } else {
      stageImages.value = []
    }
  } catch {
    stageImages.value = []
  }
}

function edit(field) {
  dialog.value = { show: true, field, content: data.value[field] }
}

function editJson(field) {
  dialog.value = { show: true, field, content: JSON.stringify(data.value[field], null, 2) }
}

async function save() {
  const field = dialog.value.field
  const file = field === 'script' ? 'script.json' : `${field}.md`
  let content = dialog.value.content
  if (field === 'script') {
    try { JSON.parse(content) } catch (e) { alert('JSON 格式错误: ' + e.message); return }
  }
  await writeFs(props.project, `${basePath.value}/${file}`, content)
  if (field === 'script') data.value[field] = JSON.parse(content)
  else data.value[field] = content
  dialog.value.show = false
}

function renderMd(text) {
  return marked.parse(text || '')
}

watch(() => [props.project, props.episode, props.shot], load, { immediate: true })
</script>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ScenePanel.vue
git commit -m "feat: add scene panel with tabs and edit support"
```

---

### Task 10: StagePanel (with EditDialog)

- [ ] **Step 1: Create frontend/src/components/StagePanel.vue**

```vue
<template>
  <v-row v-if="subScenes.length">
    <v-col cols="4">
      <v-list>
        <v-list-item
          v-for="s in subScenes"
          :key="s.label"
          @click="selected = s"
          :active="selected?.label === s.label"
        >
          <v-list-item-title>{{ s.label }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-col>
    <v-col cols="8">
      <template v-if="selected">
        <v-expansion-panels>
          <v-expansion-panel value="prompt">
            <v-expansion-panel-title>Prompt</v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="d-flex justify-end mb-2">
                <v-btn icon variant="text" size="small" @click="editPrompt"><v-icon>mdi-pencil</v-icon></v-btn>
              </div>
              <div v-html="renderMd(selected.promptMd)"></div>
            </v-expansion-panel-text>
          </v-expansion-panel>

          <v-expansion-panel value="image">
            <v-expansion-panel-title>图片</v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-img v-if="selected.imageUrl" :src="selected.imageUrl" max-height="500" contain />
              <div v-else class="text-grey">暂无图片</div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </template>
    </v-col>

    <v-dialog v-model="dialog.show" max-width="800">
      <v-card>
        <v-card-title>编辑 Prompt</v-card-title>
        <v-card-text>
          <v-textarea v-model="dialog.content" rows="15" variant="outlined" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog.show = false">取消</v-btn>
          <v-btn color="primary" @click="savePrompt">保存</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-row>
</template>

<script setup>
import { ref, watch } from 'vue'
import { readFs, writeFs } from '../api/client.js'
import { marked } from 'marked'

const props = defineProps({ project: String, name: String })
const subScenes = ref([])
const selected = ref(null)
const dialog = ref({ show: false, content: '' })

async function load() {
  try {
    const result = await readFs(props.project, `prompt/stage/${props.name}/`)
    const items = []
    for (const entry of result.entries) {
      if (entry.type === 'file' && entry.name.endsWith('.md')) {
        const label = entry.name.replace(/\.md$/, '')
        const promptMd = await readFs(props.project, `prompt/stage/${props.name}/${entry.name}`)
        const imageUrl = `/api/fs/${props.project}/assert/stage/${props.name}/${label}.jpg`
        items.push({ label, promptMd, imageUrl })
      }
    }
    subScenes.value = items
    if (items.length) selected.value = items[0]
  } catch {}
}

function editPrompt() {
  dialog.value = { show: true, content: selected.value.promptMd }
}

async function savePrompt() {
  const fileName = selected.value.label + '.md'
  await writeFs(props.project, `prompt/stage/${props.name}/${fileName}`, dialog.value.content)
  selected.value.promptMd = dialog.value.content
  dialog.value.show = false
}

function renderMd(text) {
  return marked.parse(text || '')
}

watch(() => [props.project, props.name], load, { immediate: true })
</script>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/StagePanel.vue
git commit -m "feat: add stage panel with sub-scene list and edit support"
```

---

### Task 11: Production Build Integration

**Files:**
- Modify: `server/package.json` — add build/start script

- [ ] **Step 1: Update server/package.json**

```json
{
  "name": "video-project-manager-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "build": "cd ../frontend && npm run build"
  },
  "dependencies": {
    "express": "^4.21.0"
  }
}
```

- [ ] **Step 2: Create a root package.json for convenience**

Create `package.json` in repo root (overwrite existing if needed — check first):

Check if a root package.json exists: `cat package.json`
If it doesn't exist or is minimal, create:

```json
{
  "name": "video-project-manager",
  "private": true,
  "scripts": {
    "dev": "concurrently \"cd server && npm run dev\" \"cd frontend && npm run dev\"",
    "build": "cd frontend && npm run build",
    "start": "cd server && npm start"
  },
  "devDependencies": {
    "concurrently": "^9.0.0"
  }
}
```

Run: `npm install`

- [ ] **Step 3: Verify production build**

```bash
cd frontend && npm run build
```
Expected: `frontend/dist/` created with index.html + assets

```bash
cd server && node src/index.js
```
Open: `http://localhost:3001/`
Expected: Full app served from a single port

- [ ] **Step 4: Add .gitignore entries if needed**

```bash
echo -e '\nnode_modules/\nfrontend/dist/\n' >> .gitignore
```

- [ ] **Step 5: Commit**

```bash
git add server/package.json package.json .gitignore
git commit -m "chore: add production build and root scripts"
```

---

### Self-Review

1. **Spec coverage:** All spec sections covered — server API (Task 1-2), frontend scaffold (Task 3-4), ProjectSelectPage (Task 5), AssetTree (Task 6), ProjectView (Task 7), CharacterPanel (Task 8), ScenePanel (Task 9), StagePanel (Task 10), production deployment (Task 11).
2. **No placeholders:** Every step has actual code.
3. **Type consistency:** `readFs` and `writeFs` signatures match across all files. Query param names (`type`, `name`, `episode`, `shot`) consistent between AssetTree and ProjectView.
