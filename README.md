# AI 视频工作站 — 视频项目管理器

一站式 AI 视频创作管理平台，用于 AI 视频制作前期的剧本全局大纲与原型设计、资产管理、图像/音频/视频生成。

## 功能

- **项目管理** — 多项目并行管理，文件系统即数据库
- **角色设计** — 角色总览、外观描述（适配文生图）、声线描述（适配 TTS）
- **场景设计** — 场景 prompt + 子场景标签系统，支持多角度/多时段/多天气
- **分镜管理** — 叙事拆分为 shot，管理 stage/script/prompt 资产
- **资产预览** — 图片（外观图、场景渲染图）、音频（语音样本）内嵌展示
- **内联编辑** — 所有 Markdown / JSON 资产支持可视化编辑与保存
- **无限资产画布** — 一站式多轮迭代生图、改图、视频生成，快速AI抽卡
- **多AIGC服务提供商接入** — 可同时接入 ComfyUI 工作流 与 火山引擎

ComfyUI工作流接入需要基于 [ComfyUI Easy Bridge](https://github.com/mjt233/comfyui-easy-bridge) 项目，请参考[ComfyUI Easy Bridge 对接配置说明](./docs/bridge-config-doc.md)

## 技术栈

| 层 | 技术 |
|------|------|
| 后端 | Express + TypeScript |
| 前端 | Vue 3 + Vuetify 3 + vue-router + axios + TypeScript |
| 构建 | Vite (前端), tsc (后端类型检查), vue-tsc (Vue 类型检查) |
| 代码质量 | ESLint flat config |

## 快速开始

### 1. 安装依赖、构建并启动项目

```bash
# 安装依赖
cd server && npm install
cd ../frontend && npm install

# 开发模式（同时启动后端 3001 和前端 5233）
npm run dev

# 生产构建
npm run build
npm start          # Express serve frontend/dist/ + API，端口 3001
```

### 2. 初始化第一个 AI 视频项目

需要依赖外部支持skill的AI Agent软件，如：`opencode`、`codex`、`cursor`、`claude code`等

调用skill

```
/create-video-scrip 生成一段时长约五分钟的短剧
```

根据agent的指引即可完成项目配置、剧本设计、分镜设计、角色设计，生成的配置会保存到`design/{项目名}`下

### 3. 开始创作

打开 AI 视频工作站 Web 界面（默认是`http://localhost:5233`），选择刚刚创建的项目，开始创作，生成角色设计图、音色、场景、分镜头场景、台词，并使用资产画布功能无限迭代你的作品。

## 项目结构

```
├── server/                # Express 后端
│   └── src/
│       ├── index.ts       # 入口 + 静态文件 serve
│       └── routes/fs.ts   # /api/projects + /api/fs/ 文件系统 API
├── frontend/              # Vue 3 前端
│   └── src/
│       ├── api/client.ts     # axios 封装
│       ├── router/           # Vue Router
│       ├── views/            # ProjectSelectPage + ProjectView
│       └── components/       # AssetTree / CharacterPanel / StagePanel / ScenePanel
├── design/                # 项目资产（文件系统即数据库）
│   ├── 古人在现代/          # 示例项目 1
│   └── AI的第一天/          # 示例项目 2
├── .claude/skills/        # Claude Code 技能
│   └── create-video-script/ # 剧本创作技能 + 分镜管理 Python 脚本
└── docs/
    ├── plans/             # 开发计划
    └── superpowers/       # 架构设计文档
```

## 数据模型

所有项目资产存放在 `design/{project}/` 下，文件系统即数据库：

```
design/{project}/
├── overview.md                     # 项目总览（前置设定、角色/场景总览）
└── prompt/
    ├── character/{name}/           # 角色设计
    │   ├── overview.md             #   角色总览
    │   ├── appearance.md           #   外貌描述（适配文生图）
    │   └── voice.md                #   声线描述（适配 TTS）
    ├── stage/{stage}/              # 场景设计
    │   └── {stage}-{subscene}.md   #   子场景 prompt
    └── scene/{episode}/{shot}/     # 分镜设计
        ├── overview.json           #   分镜总览（title/beat/visual/camera/duration/mood）
        ├── stage.json              #   场景组合 + 角色合成 prompt（角色/prompt 皆空=直接引用基础场景）
        ├── script.json             #   台词序列
        └── prompt.md               #   图生视频模型提示词
```

二进制资产（图片、音频）存放在同路径的 `assert/` 下。

## API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects` | 列出所有项目 |
| GET | `/api/fs/:project/*` | 读取文件或目录列表 |
| POST | `/api/fs/:project/*` | 写入文件（`prompt/`、`assert/`，以及根级 `overview.md` / `project.json`） |

## 剧本创作

使用 Claude Code 的 `create-video-script` 技能进行 AI 辅助剧本创作，包括：

1. **前置设定** — 目标受众、情感/色彩基调、美术风格、画面比例
2. **内容设计** — 剧情概要、世界观、角色设计（适配 qwen-image + qwen-3-tts）、场景设计、分镜设计
3. **资产输出** — 自动生成 `design/` 下的结构化资产文件

分镜管理 Python 脚本位于 `.claude/skills/create-video-script/scripts/`。

## 相关文档

- [ComfyUI Easy Bridge 对接配置说明](./docs/bridge-config-doc.md) — 在 ComfyUI Easy Bridge 中配置自动注册标签、标记工作流类型与对接字段
- [工作流字段配置约定](./docs/bridge-workflow-fields.md) — 各类型工作流提交给 Bridge 的字段与文件 key 约定
