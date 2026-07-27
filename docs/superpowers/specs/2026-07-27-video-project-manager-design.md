# 视频项目管理器 - 设计文档

## 概述

为 `create-video-script` 技能输出的视频设计原型（位于 `design/` 目录）提供一个可视化 Web 管理界面，支持浏览、查看和编辑项目资产（角色、场景、分镜）。

## 技术栈

- **后端**：Node.js + Express
- **前端**：Vue 3 + Vuetify 3 + Vite
- **部署**：生产环境下 Express 直接 serve `frontend/dist/` 静态文件，单进程部署

## 目录结构

```
skill/
├── server/
│   ├── package.json
│   └── src/
│       ├── index.js            # 入口 + 静态文件 serve
│       └── routes/
│           ├── projects.js     # /api/projects 路由
│           ├── characters.js   # /api/characters 路由
│           ├── stages.js       # /api/stages 路由
│           └── scenes.js       # /api/scenes 路由
├── frontend/
│   ├── package.json
│   ├── vite.config.js          # dev 时 proxy /api → server
│   ├── index.html
│   └── src/
│       ├── main.js
│       ├── App.vue
│       ├── api/
│       │   └── client.js       # axios 封装
│       ├── router/
│       │   └── index.js        # Vue Router: / → ProjectSelect, /project → ProjectView
│       ├── views/
│       │   ├── ProjectSelectPage.vue  # 项目选择页
│       │   └── ProjectView.vue        # 主管理页（左右分栏布局）
│       └── components/
│           ├── AssetTree.vue          # 左侧文件树
│           ├── CharacterPanel.vue     # 角色详情 + 编辑
│           ├── StagePanel.vue         # 场景详情 + 编辑
│           └── ScenePanel.vue         # 分镜详情 + 编辑
```

## API 设计

所有接口以 `/api` 为前缀。

### GET /api/projects
返回 `design/` 下的项目列表。

**Response:** `[{ name: string, overviewMd: string (raw markdown) }]`

### GET /api/projects/:project/tree
返回指定项目的资产树结构。

**Response:**
```json
{
  "characters": ["陈书文", "现代女孩"],
  "stages": ["现代商场"],
  "episodes": [{ "episode": 1, "shots": [1, 2, 3] }]
}
```

### GET /api/projects/:project/character/:name
读取角色的 overview.md、appearance.md、voice.md，以及对应的图片/音频 URL。

**Response:**
```json
{
  "overview": "# 陈书文\n\n...",
  "appearance": "## 外观描述\n\n...",
  "voice": "## 声音描述\n\n...",
  "appearanceImageUrl": "/api/asset/古人在现代/character/陈书文/appearance.jpg",
  "voiceAudioUrl": "/api/asset/古人在现代/character/陈书文/voice.flac"
}
```

### POST /api/projects/:project/character/:name
更新角色的 md 文件。

**Body:** `{ overview?: string, appearance?: string, voice?: string }`
**Response:** `{ success: true }` 或 `{ error: string }`

### GET /api/projects/:project/stage/:name
读取场景的子场景列表及其内容。

**Response:**
```json
{
  "name": "现代商场",
  "subScenes": [
    { "label": "现代商场-白天-平视-晴-正门入口", "promptMd": "...", "imageUrl": "..." }
  ]
}
```

### POST /api/projects/:project/stage/:name
更新指定子场景的 prompt 内容。

**Body:** `{ subSceneLabel: string, promptMd: string }`
**Response:** `{ success: true }`

### GET /api/projects/:project/scene/:episode/:shot
读取分镜的 overview.md、script.json、stage.json。

**Response:**
```json
{
  "overview": "...",
  "script": { /* parsed JSON */ },
  "stageImages": [{ "name": "场景0", "imageUrl": "/api/asset/..." }]
}
```

### POST /api/projects/:project/scene/:episode/:shot
更新分镜文件。

**Body:** `{ overview?: string, script?: object }`
**Response:** `{ success: true }`

### GET /api/asset/:project/*
静态文件代理到 `design/{project}/assert/` 下的文件。文件不存在时返回 404。

## 前端路由

```
/                  → ProjectSelectPage (选择项目)
/project?project=X → ProjectView (项目管理主界面)
  ?type=character&name=Y   → 显示角色详情
  ?type=stage&name=Z       → 显示场景详情
  ?type=scene&episode=A&shot=B → 显示分镜详情
```

所有状态通过 query 参数驱动，支持 URL 直达和刷新不丢失。

## 前端组件

### AssetTree.vue
- 使用 `v-treeview` 渲染三层结构：角色 / 场景 / 集数分镜
- 点击节点更新 router query 参数
- 数据来源：`GET /api/projects/:project/tree`

### CharacterPanel.vue
- 三个 `v-expansion-panel`：总览 / 外观设计 / 声音
- 外观面板：左侧 `appearance.md` 文本，右侧图片（若有）
- 声音面板：左侧 `voice.md` 文本，右侧音频播放器（若有）
- 每个面板头部有编辑按钮，点击弹出编辑对话框

### StagePanel.vue
- 左侧 `v-list` 展示子场景列表
- 右侧两个 `v-expansion-panel`：prompt / 图片
- 点击左侧列表项切换右侧内容

### ScenePanel.vue
- 顶部 `v-tabs`：总览 / 台词 / 场景图片
- 总览页签显示 overview.md
- 台词页签显示 script.json（可编辑）
- 场景图片页签按顺序展示场景0、场景1...

## 编辑机制

- 每个可编辑区域（md/json）旁有编辑图标按钮
- 点击后弹出 `v-dialog`，内嵌 `v-textarea` 编辑原始文本
- 支持 Markdown 预览（简单渲染）
- 保存时调用对应 POST API
- 保存成功后自动关闭对话框并刷新对应内容区域

## 错误处理

- API 错误统一返回 `{ error: string }` 格式
- 前端 axios 拦截器统一处理，展示 `v-alert`
- 图片/音频加载失败显示灰色占位符 + "暂无图片/音频" 文字
- JSON 写入前服务端做语法校验，校验失败返回具体错误信息

## 开发流程

```bash
# 安装依赖
cd server && npm install
cd ../frontend && npm install

# 前端开发 (Vite dev, proxy /api → localhost:3001)
cd frontend && npm run dev

# 后端开发
cd server && npm run dev

# 生产构建
cd frontend && npm run build   # 输出到 frontend/dist/
cd ../server && npm start       # 自动 serve frontend/dist/ + API
```
