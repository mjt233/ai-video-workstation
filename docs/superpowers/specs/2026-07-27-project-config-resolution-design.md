# 项目结构化配置（project.json）— 设计文档

## 概述

`create-video-script` 技能在生成剧本时会让用户选择画面比例和分辨率，但此前这些信息仅以纯文本形式存在于 `overview.md` 的人类可读章节和 YAML frontmatter 中，工作流引擎无法通过结构化方式读取。本方案通过引入 `project.json` 文件、配套脚本及工作流引擎侧的自动注入，解决此问题。

## 相关系统

- `create-video-script` skill（SKILL.md + Python 脚本）
- `server/src/workflow-engine.ts`（工作流执行引擎）
- `server/src/workflows/types.ts`（WorkflowParams 定义）
- `frontend/src/components/GenerateDialog.vue`（前端发起工作流）
- `design/{project}/`（项目资产目录）

## project.json Schema

**位置：** `design/{项目名称}/project.json`

```json
{
  "width": 1080,
  "height": 1920,
  "aspectRatio": "9:16"
}
```

- `width`：整数，画面宽度（像素），如 `1080`、`1920`
- `height`：整数，画面高度（像素），如 `1920`、`1080`
- `aspectRatio`：字符串，格式 `{宽}:{高}`，如 `9:16`、`16:9`
- 仅顶层 key，不支持嵌套
- 今后可扩展其他字段（如 `fps`、`duration`），保持向后兼容

### 数据一致性

`project.json` 是机器读写的权威结构化配置源。`create-video-script` 技能在运行过程中同步写入 `project.json`，确保与人工选择的画面比例和分辨率一致。

`overview.md` 不再包含 YAML frontmatter，回归纯人类阅读的 Markdown。其中 `## 前置设定` 章节保留可读的文字描述（如 `- 画面比例：竖屏 9:16`），但不再以机器可解析的 frontmatter 形式存在。

## set_project_property.py 脚本

**位置：** `.claude/skills/create-video-script/scripts/set_project_property.py`

### 用法

```bash
python .claude/skills/create-video-script/scripts/set_project_property.py --project <项目名称> <key> <value>
```

`--project` 为必选参数，无默认值。

### 示例

```bash
python .claude/skills/create-video-script/scripts/set_project_property.py --project "AI的第一天" resolution "1080x1920"
python .claude/skills/create-video-script/scripts/set_project_property.py --project "AI的第一天" aspectRatio "9:16"
```

### 行为

1. 读取 `design/{project}/project.json`（文件不存在则使用 `{}`）
2. 设置指定顶层 key 的 value（始终存为字符串类型，保持 `project.json` 字段类型一致性）
3. 保留未涉及的现有字段不修改
4. 写回 `project.json`

### 前置条件检查

- `design/{project}/` 目录必须存在
- `design/{project}/overview.md` 必须存在（确认是有效项目目录）

## 工作流引擎变更

### 文件：`server/src/workflow-engine.ts`

在创建 `WorkflowParams` 时新增 `loadProjectConfig()` 步骤：

```typescript
async function loadProjectConfig(project: string): Promise<Record<string, string>> {
  const configPath = path.resolve(DESIGN_DIR, project, 'project.json');
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);
    const result: Record<string, string> = {};
    if (config.width != null) result.width = String(config.width);
    if (config.height != null) result.height = String(config.height);
    if (config.aspectRatio) result.aspectRatio = String(config.aspectRatio);
    return result;
  } catch {
    // 文件不存在或解析失败，静默忽略
    return {};
  }
}
```

将返回的配置合并到 `vars` 中：

```typescript
const workflowParams: WorkflowParams = {
  project: task.project,
  vars: {
    ...(await loadProjectConfig(task.project)),
    ...paramsObj.vars,  // 前端传入的 vars 优先级更高，允许覆盖
  },
  ...
};
```

### 效果

- `stage-image`、`scene-stage-image`、`video-generate` 等需要分辨率的工作流可通过 `params.vars.width`、`params.vars.height` 和 `params.vars.aspectRatio` 直接获取
- 无需逐一修改工作流实现代码
- 前端可通过 `vars` 传入同名 key 临时覆盖（如调试不同分辨率时）

## create-video-script SKILL.md 变更

### 1. 输出目录结构

在 `design/{项目名称}/` 下新增 `project.json` 条目，并附说明：

```
design
  └── {项目名称}
      ├── project.json              # 项目结构化配置（分辨率、画面比例等）
      ├── overview.md
      └── prompt/...
```

### 2. overview.md 模板变更

- 删除文件开头的 `---` YAML frontmatter 块
- 保留 `## 前置设定` 中的人类可读文字描述（如 `- 画面比例：竖屏 9:16`）
- `validate.py` 原用于检测项目的依据改为检查 `overview.md` 存在（保持不变）

### 3. 前置设定流程新增写入步骤

在"画面比例与分辨率"决策确认后，新增步骤：要求 agent 执行 `set_project_property.py`：

> 5. **画面比例与分辨率** — 用户选定后，依次运行：
>    ```bash
>    python .claude/skills/create-video-script/scripts/set_project_property.py --project "{项目名称}" aspectRatio "{用户选择的比例}"
>    python .claude/skills/create-video-script/scripts/set_project_property.py --project "{项目名称}" width {画面宽度}
>    python .claude/skills/create-video-script/scripts/set_project_property.py --project "{项目名称}" height {画面高度}
>    ```

### 4. validate.py 新增 project.json 校验

在现有校验逻辑中增加：

- 检查 `design/{project}/project.json` 是否存在
- 检查 `width`、`height` 字段存在且为正整数
- 检查 `aspectRatio` 字段存在且格式匹配 `\d+:\d+`

## 迁移步骤

现有两个项目（"AI的第一天"、"古人在现代"）已在 `overview.md` frontmatter 中包含分辨率信息。迁移方式：

1. 对每个项目运行 `set_project_property.py` 写入当前值
2. 删除 `overview.md` 的 YAML frontmatter（`---` 块及其内容）

或通过以下一次性命令完成：

```bash
# 示例：迁移 "AI的第一天"
python .claude/skills/create-video-script/scripts/set_project_property.py --project "AI的第一天" width 1080
python .claude/skills/create-video-script/scripts/set_project_property.py --project "AI的第一天" height 1920
python .claude/skills/create-video-script/scripts/set_project_property.py --project "AI的第一天" aspectRatio "9:16"

# 示例：迁移 "古人在现代"
python .claude/skills/create-video-script/scripts/set_project_property.py --project "古人在现代" width 1080
python .claude/skills/create-video-script/scripts/set_project_property.py --project "古人在现代" height 1920
python .claude/skills/create-video-script/scripts/set_project_property.py --project "古人在现代" aspectRatio "9:16"
```

## 变更清单

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `.claude/skills/create-video-script/scripts/set_project_property.py` | **新建** | 按 key-value 更新 project.json |
| 2 | `.claude/skills/create-video-script/scripts/_common.py` | **修改** | 新增 `get_project_config_path()` 和 `read_project_config()`/`write_project_config()` 工具函数 |
| 3 | `.claude/skills/create-video-script/scripts/validate.py` | **修改** | 增加 project.json 存在性和字段校验（width/height/aspectRatio） |
| 4 | `.claude/skills/create-video-script/SKILL.md` | **修改** | 更新目录结构、overview.md 模板、前置设定流程 |
| 5 | `server/src/workflow-engine.ts` | **修改** | 新增 `loadProjectConfig()`，自动注入到 `vars` |
| 6 | `design/AI的第一天/overview.md` | **修改** | 删除 YAML frontmatter |
| 7 | `design/古人在现代/overview.md` | **修改** | 删除 YAML frontmatter |
| 8 | `design/AI的第一天/project.json` | **新建** | width: 1080, height: 1920, aspectRatio: 9:16 |
| 9 | `design/古人在现代/project.json` | **新建** | width: 1080, height: 1920, aspectRatio: 9:16 |
