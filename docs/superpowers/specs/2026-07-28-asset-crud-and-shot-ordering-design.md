# 资产增删与分镜排序 - 设计文档

## 概述

在项目管理详情界面中，支持按 `create-video-script` 约定手动管理资产树，并修复分镜展示/场景帧顺序问题：

1. **手动新增/删除**：角色、场景、子场景、集数、分镜
2. **分镜列表排序**：按分镜序号数字升序展示
3. **分镜场景图片调序**：上移/下移，同步 `stage.json` 与 assert 图片序号
4. **分镜编号连续**：删除或中间插入分镜后，对后续分镜做大范围 rename，保持 `1..N` 无跳号

## 背景与约束

- 资产根目录：`design/{project}/`
- 约定结构见 `.claude/skills/create-video-script/03-asset-output.md`
- 现有 API 仅有 `GET/POST /api/fs`（读目录/文件、写文本），无 mkdir/delete/rename 专用语义
- 删除策略：**有引用时禁止删除**（角色/场景/子场景）
- 新增策略：**弹窗填写关键字段**后按模板生成
- 场景图调序交互：**上移/下移按钮**
- UI 文案、文档、提交信息使用中文
- 修改后需通过 `npm run typecheck` 与 `npm run lint`

## 方案选择

采用 **服务端资产 CRUD API + 前端树/面板操作**（方案 A）：

- 引用检查、模板落盘、图片/目录 rename 集中在服务端
- 避免前端多次 rename 竞态与引用扫描遗漏
- 不包装 Python 脚本（脚本只管分镜 JSON，不覆盖角色/场景/集数目录生命周期）

## API 设计

新增路由模块 `server/src/routes/assets.ts`，挂载前缀 `/api/assets`。  
所有路径限制在 `design/{project}/` 下的 `prompt/` 与 `assert/`，并做路径穿越校验。

### 创建

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/assets/:project/character` | 新建角色 |
| `POST` | `/api/assets/:project/stage` | 新建场景目录 |
| `POST` | `/api/assets/:project/subscene` | 新建子场景 md |
| `POST` | `/api/assets/:project/episode` | 新建集数目录 |
| `POST` | `/api/assets/:project/shot` | 新建分镜（支持末尾或中间插入） |

#### 请求体

```json
// character
{ "name": "小霓", "gender": "女", "age": "16岁", "personality": "活泼好奇" }

// stage
{ "name": "现代商场" }

// subscene
{
  "stage": "现代商场",
  "label": "现代商场-白天-平视-晴-正门入口",
  "time": "白天",
  "angle": "平视",
  "weather": "晴",
  "description": "商场正门入口大厅"
}

// episode
{ "episode": "2" }   // 可选；省略则 max(现有)+1

// shot
{
  "episode": "1",
  "shot": "3",           // 可选；省略或 "end" 表示末尾
  "position": "insert"   // 可选：insert | end；指定 shot 且已存在时按插入处理
}
```

分镜插入语义见下文「分镜编号大范围 rename」。

#### 响应

- 成功：`{ success: true, path: "prompt/..." }`；shot 插入时额外返回 `{ renames?: [{ from, to }] }`
- 已存在：`409 { error, code: "EXISTS" }`
- 参数非法：`400 { error, code: "INVALID" }`

创建**不**预生成 assert 图片/音频/视频。

### 删除

| 方法 | 路径 |
|------|------|
| `DELETE` | `/api/assets/:project/character/:name` |
| `DELETE` | `/api/assets/:project/stage/:name` |
| `DELETE` | `/api/assets/:project/subscene/:stage/:label` |
| `DELETE` | `/api/assets/:project/episode/:episode` |
| `DELETE` | `/api/assets/:project/shot/:episode/:shot` |

#### 引用检查（有引用则 409，不删除）

| 删除对象 | 扫描范围 | 命中条件 |
|----------|----------|----------|
| 角色 | 全项目 `prompt/scene/**/stage.json`、`script.json` | `登场角色` 含该名 / 条目 `角色名` 字段 |
| 场景 | 全项目 `stage.json` | `基础场景` 以 `{场景名}/` 开头 |
| 子场景 | 全项目 `stage.json` | `基础场景 === "{场景}/{label}"` |
| 分镜 | 无跨分镜内容引用 | 直接删除后触发后续编号前移 |
| 集数 | 无跨集内容引用 | 整集删除 prompt + assert，**不**做集间重编号 |

`IN_USE` 响应：

```json
{
  "error": "资源正在被引用，无法删除",
  "code": "IN_USE",
  "refs": [
    { "episode": "1", "shot": "3", "file": "stage.json", "detail": "登场角色" }
  ]
}
```

#### 删除落盘范围

| 对象 | prompt | assert |
|------|--------|--------|
| 角色 | `prompt/character/{name}/` | `assert/character/{name}/` |
| 场景 | `prompt/stage/{name}/` | `assert/stage/{name}/` |
| 子场景 | `prompt/stage/{stage}/{label}.md` | `assert/stage/{stage}/{label}.jpg`（若存在） |
| 分镜 | `prompt/scene/{ep}/{shot}/` | `assert/scene/{ep}/{shot}/` |
| 集数 | `prompt/scene/{ep}/` | `assert/scene/{ep}/` |

### 分镜场景图重排

`POST /api/assets/:project/scene/:episode/:shot/stage/reorder`

```json
{ "from": 0, "to": 1 }
```

服务端步骤：

1. 读取 `prompt/scene/{ep}/{shot}/stage.json`，校验 `from`/`to` 为合法下标
2. 数组移动元素并写回
3. 同步重命名 `assert/scene/{ep}/{shot}/stage/{i}.jpg`（临时名中转，避免覆盖）
4. 缺失的 jpg 跳过
5. 不修改 `script.json` / 语音文件

成功：`{ success: true }`  
索引非法：`409 { error, code: "CONFLICT" }`

### 错误码汇总

| code | HTTP | 含义 |
|------|------|------|
| `EXISTS` | 409 | 同名/同路径已存在 |
| `IN_USE` | 409 | 删除目标被引用 |
| `NOT_FOUND` | 404 | 目标不存在 |
| `INVALID` | 400 | 字段或路径非法 |
| `CONFLICT` | 409 | reorder 索引非法等状态冲突 |

## 分镜编号大范围 rename

### 不变式

同一集内分镜目录名始终为连续正整数 `1..N`（无跳号）。  
`prompt/scene/{ep}/{shot}/` 与 `assert/scene/{ep}/{shot}/` **成对**同步 rename。

### 删除分镜

1. 删除目标分镜的 prompt + assert 目录
2. 将该集所有 **编号 > 被删编号** 的分镜整体 **-1**
3. rename 顺序：**从小到大**（先 `k+1 → k`，再 `k+2 → k+1` …）
4. 响应可带 `renames: [{ from, to }, ...]`，供前端修正 URL

### 新增分镜

| 模式 | 行为 |
|------|------|
| 末尾（默认） | 创建 `N+1`，无 rename |
| 插入位置 `n`（`1..N+1`） | 先将原 `n..N` 全部 **+1**（顺序：**从大到小**），再在 `n` 写入新分镜模板文件 |

### 实现要点

- 单次 API 内完成：列目录 → 规划 rename 序列 → 执行
- Windows 友好：必要时使用临时后缀/临时目录中转，避免目标路径冲突
- assert 侧目录不存在则跳过该侧 rename
- **不**改写其他分镜 JSON 内容（分镜编号不出现在跨文件引用中）
- 集数删除不做集间重编号

### 前端 URL 同步

- 删除当前选中分镜：清空 `shot`（或跳到合法邻项）
- 当前选中分镜编号因 rename 变化：用 `renames` 映射更新 query
- 插入导致当前镜后移：同样按映射更新

## 创建模板

对齐 `create-video-script` 模板，字段用弹窗值填充，其余占位。

### 角色 `prompt/character/{name}/`

- `overview.md`：姓名/性别/年龄/性格；背景与关系占位
- `appearance.md`：三视角全身图要求 + 结构化占位（可写入年龄性别）
- `voice.md`：一句占位声线描述

### 场景 `prompt/stage/{name}/`

- 仅创建空目录

### 子场景 `prompt/stage/{stage}/{label}.md`

- 含画面描述、主色调等简短结构；写入时间/角度/天气/简述

### 集数 `prompt/scene/{n}/`

- 空目录

### 分镜 `prompt/scene/{ep}/{shot}/`

| 文件 | 初始内容 |
|------|----------|
| `overview.md` | 标题「第{ep}集 分镜 {shot}」+ 各节占位 |
| `stage.json` | `[]` |
| `script.json` | `[]` |
| `prompt.md` | LTX 提示词占位 |

## 命名校验

- 禁止字符：`/ \ : * ? " < > |` 及首尾空白
- 角色/场景名：非空；不强制中文（约定优先中文）
- 集数/分镜：正整数字符串 `^[1-9]\d*$`
- 子场景 `label`：非空；建议含场景名前缀（服务端可软提示，不强绑）

## 前端设计

### AssetTree.vue

- 三组：角色 / 场景 / 集数分镜
- **排序**：集数、分镜按 `Number(name)` 升序；角色、场景 `localeCompare('zh')`
- 场景节点展开子场景列表，便于子场景增删
- 节点 append 区操作（避免与选中冲突）：

| 位置 | 操作 |
|------|------|
| 角色根 | 新增角色 |
| 角色叶 | 删除 |
| 场景根 | 新增场景 |
| 场景节点 | 新增子场景；删除场景 |
| 子场景叶 | 删除子场景 |
| 集数分镜根 | 新增集数 |
| 集数节点 | 新增分镜；删除集数 |
| 分镜叶 | 删除分镜 |

- 删除二次确认；`IN_USE` 展示 refs
- 成功后刷新树；修正或清空 router query

### AssetCreateDialog.vue

统一创建弹窗，按类型展示字段：

| 类型 | 必填 | 可选 |
|------|------|------|
| 角色 | 名称 | 性别、年龄、性格 |
| 场景 | 名称 | — |
| 子场景 | 所属场景、完整标签 | 时间、角度、天气、简述 |
| 集数 | — | 指定编号（默认自动） |
| 分镜 | 所属集数 | 插入位置：末尾 / 指定序号 |

### ScenePanel.vue

- 「场景图片」tab 每张卡片：上移 / 下移
- 首条禁用上移，末条禁用下移
- 调用 reorder API 后 `load()`；请求中 loading 防连点
- 保留「编辑 stage.json」

### API 客户端

`frontend/src/api/assets.ts`（或扩展 `client.ts`）：

- create：character / stage / subscene / episode / shot
- delete：同上
- `reorderSceneStage(project, episode, shot, from, to)`

### ProjectView

- 继续用 `treeKey` / refresh 刷新树
- 创建成功可 `router.push` 到新资产

## 非目标（本次不做）

- 拖拽排序场景帧
- 集数删除后的集间重编号
- 角色/场景重命名
- 在 CharacterPanel/StagePanel 内重复放增删入口
- 包装调用 Python `add_stage.py` 等脚本做目录 CRUD

## 验收标准

1. 树可新增/删除角色、场景、子场景、集数、分镜；被引用的角色/场景/子场景删除被拦截并显示引用位置
2. 分镜列表按数字升序展示（`1…9,10,11,12`）
3. 删除中间分镜后目录为连续 `1..N-1`，assert 同步 rename
4. 插入到位置 `n` 后原 `n..N` 变为 `n+1..N+1`，新分镜在 `n`
5. 场景图片 ↑↓ 后 `stage.json` 与 `assert/.../stage/{i}.jpg` 顺序一致
6. `npm run typecheck`、`npm run lint` 通过

## 主要改动文件（预期）

**服务端**

- `server/src/routes/assets.ts`（新建）
- `server/src/index.ts`（挂载路由）
- 可选：`server/src/assets/` 下模板与引用扫描工具模块

**前端**

- `frontend/src/api/assets.ts`（新建）
- `frontend/src/components/AssetTree.vue`
- `frontend/src/components/AssetCreateDialog.vue`（新建）
- `frontend/src/components/ScenePanel.vue`
- `frontend/src/views/ProjectView.vue`（刷新/路由联动）
