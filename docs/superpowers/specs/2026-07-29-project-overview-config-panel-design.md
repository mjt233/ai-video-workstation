# 项目总览与配置面板 — 设计文档

## 概述

进入项目管理后，需要能查看并修改项目根目录下的：

- `design/{project}/overview.md` — 项目总览（人类可读 Markdown）
- `design/{project}/project.json` — 结构化配置（分辨率、帧率等）

其中 `project.json` 通过表格/表单交互编辑核心字段，并保留原始 JSON 编辑入口；非核心字段在表单保存时原样保留。

## 背景与约束

- 资产根目录：`design/{project}/`
- 目录约定见 `docs/asset-layout.md`、`AGENTS.md`
- 现有前端状态由 URL 查询参数驱动：`project`、`type`、`name`、`episode`、`shot` 等
- 现有 `POST /api/fs/:project/*` **仅允许**写入 `prompt/` 与 `assert/` 前缀，无法直接保存根级 `overview.md` / `project.json`
- 现有面板模式：`CharacterPanel` / `ScenePanel` 使用 Tab + Markdown/表单 + 弹窗编辑
- `project.json` 字段不固定：核心字段为 `width` / `height` / `fps` / `aspectRatio`；部分项目另有 `projectName`、`targetAudience` 等扩展字段
- 工作流引擎已从 `project.json` 注入 `projectConfig`（`width`/`height`/`aspectRatio`/`fps`）
- UI 文案、文档、提交信息使用中文
- 修改后需通过 `npm run typecheck` 与 `npm run lint`

## 方案选择

采用 **方案 A：扩展现有 `/api/fs` 写入白名单 + 新 `ProjectPanel`**：

| 方案 | 说明 | 结论 |
|------|------|------|
| A. 扩展 fs 白名单 + ProjectPanel | 复用 `readFs`/`writeFs`，仅放开根级两个文件写入 | **采用** |
| B. 专用 `/api/project` API | 权限边界清晰，但多一套接口，偏离「文件系统即数据库」 | 不采用 |
| C. 迁入 `prompt/` 再编辑 | 不改写权限，但破坏现有路径约定与工作流读取 | 不采用 |

## 入口与整体布局

### 入口

- 左侧 `AssetTree` **顶部**增加固定虚拟节点「项目信息」
- 点击后路由：`/project?project={name}&type=project`
- 不对应真实目录；与角色/场景/分镜并列，作为虚拟根节点
- 无创建/删除按钮

### 右侧主区

- `ProjectView` 在 `type === 'project'` 时渲染 `ProjectPanel`
- 未选中任何资产时，仍显示现有空状态「从左侧选择一个资产查看」
- 只有点击「项目信息」才进入该面板

### 面板结构

`ProjectPanel` 使用两个 Tab：

| Tab | 内容 |
|-----|------|
| 项目总览 | 读取并展示 `overview.md` |
| 项目配置 | 表单编辑 `project.json` 核心字段 + 原始 JSON 入口 |

## 读写 API 与数据流

### 读取

沿用现有 `GET /api/fs/:project/*`：

| 路径 | 用途 |
|------|------|
| `overview.md` | 项目总览 Markdown |
| `project.json` | 项目结构化配置 |

前端：`readFs(project, 'overview.md')` / `readFs(project, 'project.json')`。

### 写入（扩展白名单）

在 `server/src/routes/fs.ts` 中扩展可写规则：

**允许写入：**

1. 前缀 `prompt/`、`assert/`（不变）
2. 项目根级精确文件：`overview.md`、`project.json`

**仍禁止：**

- 路径穿越
- 其他根级文件/目录
- 除 `prompt/`、`assert/` 外的任意嵌套路径

实现要点：

```ts
const WRITABLE_PREFIXES = ['prompt', 'assert'];
const WRITABLE_ROOT_FILES = ['overview.md', 'project.json'];

// relPath 无路径分隔符且命中 WRITABLE_ROOT_FILES → 允许
// 或 relPath 第一段命中 WRITABLE_PREFIXES → 允许
```

### 保存语义

#### overview.md

- 弹窗 `textarea` 编辑全文
- 保存时整文件覆盖写回

#### project.json（表单保存）

1. 读取当前 JSON 对象（文件不存在时按 `{}`；解析失败则阻止保存，见边界情况）
2. 仅更新核心字段：`width`、`height`、`fps`、`aspectRatio`
3. 其他字段原样保留
4. 写回：`JSON.stringify(obj, null, 2)` + 末尾换行

#### project.json（原始 JSON 保存）

1. `JSON.parse` 必须成功且结果为普通对象（非数组/null）
2. 整对象覆盖写回（允许修改非核心字段）
3. 解析失败则拒绝并提示

### 校验

| 字段 | 规则 |
|------|------|
| `width` | 正整数 |
| `height` | 正整数 |
| `fps` | 正整数（缺省展示可用 24，保存时以表单值为准） |
| `aspectRatio` | 由 `width`/`height` 约分自动生成，格式 `{w}:{h}`，如 `9:16` |

约分算法：对 `width`、`height` 求最大公约数 `g`，输出 `${width/g}:${height/g}`。

前端表单保存前做校验；服务端对根级写入可保持通用字符串写入（与现有 fs 一致），核心字段合法性以前端表单为主。原始 JSON 模式由前端保证 parse 成功。

## 项目配置 UI 交互

### 上半：快捷预设 + 核心字段表单

1. **分辨率快捷下拉**（`v-select`）

| 选项 | width | height |
|------|-------|--------|
| 1080P 竖屏 (1080×1920) | 1080 | 1920 |
| 1080P 横屏 (1920×1080) | 1920 | 1080 |
| 720P 竖屏 (720×1280) | 720 | 1280 |
| 720P 横屏 (1280×720) | 1280 | 720 |
| 自定义 | — | — |

- 选预设时自动填入 `width` / `height`，并重算 `aspectRatio`
- 手动改宽高后，若与任一预设不一致则切到「自定义」

2. **核心字段**

| 字段 | 控件 | 规则 |
|------|------|------|
| width | number input | 正整数 |
| height | number input | 正整数 |
| aspectRatio | 只读展示 | 由 width/height 约分自动生成 |
| fps | number input | 正整数 |

3. **保存按钮**

- 校验通过后：读原 JSON → 合并核心字段 → 写回
- 成功/失败给予明确反馈

### 下半：原始 JSON 编辑

- 「编辑原始 JSON」按钮 → 弹窗 `v-textarea` 展示完整文本
- 保存规则见上文「原始 JSON 保存」
- 保存成功后刷新表单核心字段显示

### 项目总览 Tab

| 展示 | 编辑 |
|------|------|
| `MarkdownView` 渲染 `overview.md` | 「编辑」→ 弹窗 textarea → 整文件保存（对齐 `CharacterPanel`） |

## 边界情况

| 情况 | 行为 |
|------|------|
| `overview.md` 不存在 | 展示空状态；仍可编辑并保存（创建文件） |
| `project.json` 不存在 | 表单用空/默认值；保存时创建文件 |
| `project.json` 非法 JSON | 配置 Tab 提示错误；可通过「原始 JSON」修复后保存 |
| 非核心字段（如 `targetAudience`） | 表单不展示、不删除；仅原始 JSON 可改 |
| 表单保存时原文件非法 JSON | 阻止保存并提示错误，引导使用「编辑原始 JSON」修复；避免用 `{}` 覆盖导致扩展字段丢失 |

## 前端改动清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/components/AssetTree.vue` | 修改 | 顶部增加「项目信息」虚拟节点；选中时 `type=project` |
| `frontend/src/views/ProjectView.vue` | 修改 | `type === 'project'` 时渲染 `ProjectPanel` |
| `frontend/src/components/ProjectPanel.vue` | 新建 | 双 Tab：总览 + 配置表单/原始 JSON |
| `frontend/src/api/client.ts` | 视需要 | 一般无需改；继续用 `readFs`/`writeFs` |

## 服务端改动清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `server/src/routes/fs.ts` | 修改 | 允许根级 `overview.md`、`project.json` 写入 |

## 文档改动清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `docs/asset-layout.md` | 修改 | API 写入范围补充根级 `overview.md` / `project.json` |
| `AGENTS.md` | 修改 | 同步写入范围说明 |

## 非目标

- 不在本需求中做项目新建/删除
- 不把 `overview.md` 结构化为表单字段
- 不强制所有项目 `project.json` 字段集合一致
- 不改工作流引擎读取逻辑（已支持 `project.json`）

## 验收标准

1. 资产树顶部可见「项目信息」，点击后 URL 含 `type=project`，右侧出现 `ProjectPanel`
2. 「项目总览」可预览并弹窗编辑保存 `overview.md`
3. 「项目配置」可通过快捷下拉与表单修改 `width`/`height`/`fps`，`aspectRatio` 自动约分展示并写入
4. 表单保存后，原 `project.json` 中非核心字段仍存在
5. 「编辑原始 JSON」可修改并保存完整对象；非法 JSON 被拒绝
6. 未选中资产时右侧仍为空状态提示
7. `npm run typecheck` 与 `npm run lint` 通过
