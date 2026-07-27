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
│           └── fs.js           # /api/projects + /api/fs 路由
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

简化为 3 个通用端点，前后端通过路径约定交互。

### GET /api/projects

列出 `design/` 下的项目。

**Response:** `[{ name: string }]`

### GET /api/fs/:project/:path*

读取 `design/{project}/` 下的文件或目录。返回 md/json 内容或目录列表。二进制文件直接返回流。

**路径约定（前端按 init.md 规则拼接）：**

| 用途 | 路径 |
|------|------|
| 列出角色 | `prompt/character/` |
| 角色 md | `prompt/character/小美/overview.md` |
| 角色图片 | `assert/character/小美/appearance.jpg` |
| 列出场景 | `prompt/stage/` |
| 场景子场景 | `prompt/stage/现代商场/` |
| 场景子场景 md | `prompt/stage/现代商场/现代商场-白天-平视-晴-正门入口.md` |
| 列出集数 | `prompt/scene/` |
| 列出分镜 | `prompt/scene/1/` |
| 分镜文件 | `prompt/scene/1/1/overview.md` |
| 分镜脚本 | `prompt/scene/1/1/script.json` |

**Response（文件）:** 文件原始内容（text 或 binary stream）
**Response（目录）:** `{ entries: [{ name: string, type: "file" | "dir" }] }`

### POST /api/fs/:project/:path*

写入文件到 `design/{project}/` 下。

**Body:** `{ content: string }` — 写入的文本内容
**Response:** `{ success: true }` 或 `{ error: string }`

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
- 数据来源：通过 `/api/fs/:project/` 递归读取目录构造树
  - `GET /api/fs/:project/prompt/character/` → 角色列表
  - `GET /api/fs/:project/prompt/stage/` → 场景列表
  - `GET /api/fs/:project/prompt/scene/` → 集数列表
  - `GET /api/fs/:project/prompt/scene/1/` → 分镜列表

### CharacterPanel.vue
- 三个 `v-expansion-panel`：总览 / 外观设计 / 声音
- 面板内容通过 `/api/fs/` 按路径读取
  - `prompt/character/小美/overview.md`
  - `prompt/character/小美/appearance.md`
  - `prompt/character/小美/voice.md`
  - `assert/character/小美/appearance.jpg`（若存在）
  - `assert/character/小美/voice.flac`（若存在）
- 每个面板头部有编辑按钮，点击弹出编辑对话框，保存时 POST 到对应路径

### StagePanel.vue
- 左侧 `v-list` 展示子场景列表（`GET /api/fs/:project/prompt/stage/现代商场/`）
- 右侧两个 `v-expansion-panel`：prompt / 图片
  - prompt：读取对应子场景 `.md` 文件
  - 图片：`assert/stage/现代商场/{子场景}.jpg`（若存在）
- 点击左侧列表项切换右侧内容

### ScenePanel.vue
- 顶部 `v-tabs`：总览 / 台词 / 场景图片
- 总览：`GET /api/fs/:project/prompt/scene/1/1/overview.md`
- 台词：`GET /api/fs/:project/prompt/scene/1/1/script.json`
- 场景图片：读取 `stage.json` 确定场景数量，然后按序加载 `assert/scene/1/1/stage/0.jpg`
- 编辑后 POST 到对应路径保存

## 编辑机制

- 每个可编辑区域（md/json）旁有编辑图标按钮
- 点击后弹出 `v-dialog`，内嵌 `v-textarea` 编辑原始文本
- 支持 Markdown 预览（简单渲染）
- 保存时 `POST /api/fs/:project/{path}`，body: `{ content: string }`
- 保存成功后自动关闭对话框并刷新对应内容区域

## 错误处理

- API 错误统一返回 `{ error: string }` 格式
- 前端 axios 拦截器统一处理，展示 `v-alert`
- 图片/音频加载失败显示灰色占位符 + "暂无图片/音频" 文字
- 写入前服务端验证文件路径合法性（仅允许 prompt/ 和 assert/ 下的文件），防止路径穿越

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
