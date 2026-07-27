# Project Config Resolution 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过引入 `project.json`、配套脚本和工作流引擎自动注入，使分辨率/画面比例可被工作流读取。

**Architecture:** 在 `design/{project}/` 下新增 `project.json` 存储结构化配置；Python 脚本 `set_project_property.py` 供 AI agent 在 skill 流程中写入；工作流引擎在运行时自动读取并注入到 `WorkflowParams.vars` 中；`overview.md` 去掉 YAML frontmatter。

**Tech Stack:** Python 3.8+, TypeScript (Node.js/Express), SQLite (workflow engine)

---

### Task 1: `_common.py` 新增 project.json 工具函数

**Files:**
- Modify: `.claude/skills/create-video-script/scripts/_common.py`

- [ ] **Step 1: 在 `_common.py` 末尾新增两个函数**

在 `get_character_dir` 函数之后添加：

```python
def get_project_config_path(project_name: str, project_root: Optional[str] = None) -> Path:
    """获取 project.json 路径：design/{project_name}/project.json"""
    return get_project_dir(project_name, project_root) / "project.json"


def read_project_config(project_name: str, project_root: Optional[str] = None) -> dict:
    """读取 project.json，文件不存在或解析失败时返回空 dict。"""
    path = get_project_config_path(project_name, project_root)
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def write_project_config(project_name: str, config: dict, project_root: Optional[str] = None) -> None:
    """写入 project.json（自动创建目录）。"""
    path = get_project_config_path(project_name, project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    print(f"✅ 已写入: {path}")
```

- [ ] **Step 2: 验证无语法错误**

Run: `python -c "from _common import get_project_config_path, read_project_config, write_project_config; print('OK')"`
Expected: 输出 `OK`，无报错

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/create-video-script/scripts/_common.py
git commit -m "feat(skill): add project.json utility functions to _common.py"
```

---

### Task 2: 创建 `set_project_property.py`

**Files:**
- Create: `.claude/skills/create-video-script/scripts/set_project_property.py`

- [ ] **Step 1: 创建脚本文件**

```python
#!/usr/bin/env python3
"""
按 key-value 更新 project.json 中的项目配置。

用法:
    python scripts/set_project_property.py --project <项目名称> <key> <value>

参数:
    --project, -p     - 必选，剧本项目名称
    key               - 要设置的顶层键名（如 resolution、aspectRatio）
    value             - 要设置的值（始终存为字符串）
    --project-root    - 可选，项目根目录（默认当前目录）

示例:
    python scripts/set_project_property.py --project "AI的第一天" resolution "1080x1920"
    python scripts/set_project_property.py --project "AI的第一天" aspectRatio "9:16"
"""

import argparse
import sys
from _common import (
    get_project_dir,
    read_project_config,
    write_project_config,
    list_projects,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="按 key-value 更新 project.json 中的项目配置",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("key", type=str, help="要设置的顶层键名")
    parser.add_argument("value", type=str, help="要设置的值（字符串）")
    parser.add_argument("--project", "-p", type=str, required=True, help="剧本项目名称（必选）")
    parser.add_argument("--project-root", type=str, default=None, help="项目根目录（默认当前目录）")
    return parser.parse_args()


def main():
    args = parse_args()
    project_name = args.project
    project_root = args.project_root

    # 校验项目目录存在
    project_dir = get_project_dir(project_name, project_root)
    if not project_dir.exists():
        print(f"❌ 项目目录不存在: {project_dir}", file=sys.stderr)
        sys.exit(1)

    # 校验 overview.md 存在（确认是有效项目）
    overview_path = project_dir / "overview.md"
    if not overview_path.exists():
        print(f"❌ 项目 '{project_name}' 不是有效的剧本项目（缺少 overview.md）", file=sys.stderr)
        sys.exit(1)

    # 读取现有配置，设置新值
    config = read_project_config(project_name, project_root)
    config[args.key] = args.value
    write_project_config(project_name, config, project_root)

    print(f"📝 project.json 已更新: {args.key} = {args.value}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 验证脚本可运行**

Run: `python .claude/skills/create-video-script/scripts/set_project_property.py --help`
Expected: 显示帮助信息

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/create-video-script/scripts/set_project_property.py
git commit -m "feat(skill): add set_project_property.py script"
```

---

### Task 3: `validate.py` 新增 project.json 校验

**Files:**
- Modify: `.claude/skills/create-video-script/scripts/validate.py`

- [ ] **Step 1: 在 `validate.py` 的导入中添加新增函数**

找到 `from _common import ...` 那行，添加 `get_project_config_path`、`read_project_config`：

```python
from _common import (
    DEFAULT_PROJECT,
    DEFAULT_EPISODE,
    read_json,
    get_project_dir,
    get_scene_dir,
    get_stage_json_path,
    get_script_json_path,
    get_stage_asset_path,
    get_character_dir,
    get_project_config_path,    # 新增
    read_project_config,        # 新增
    list_projects,
    list_episodes,
)
```

- [ ] **Step 2: 在 `validate_shot` 函数之前新增 `validate_project_config` 函数**

```python
import re


def validate_project_config(project_name: str, project_root: str | None) -> list[str]:
    """校验 project.json 的存在性和格式，返回错误信息列表。"""
    errors: list[str] = []
    config_path = get_project_config_path(project_name, project_root)
    
    if not config_path.exists():
        errors.append(f"⚠️ 项目 '{project_name}' 缺少 project.json")
        return errors
    
    config = read_project_config(project_name, project_root)
    
    for field in ("width", "height"):
        if field not in config:
            errors.append(f"project.json: 缺少 '{field}' 字段")
        elif not isinstance(config[field], int) or config[field] <= 0:
            errors.append(f"project.json: '{field}' 应为正整数，当前值: {config[field]}")
    
    if "aspectRatio" not in config:
        errors.append(f"project.json: 缺少 'aspectRatio' 字段")
    else:
        ratio = config["aspectRatio"]
        if not re.match(r'^\d+:\d+$', ratio):
            errors.append(f"project.json: aspectRatio 格式无效 '{ratio}'，应为 宽:高 格式（如 9:16）")
    
    return errors
```

- [ ] **Step 3: 在 `main()` 的校验流程中调用 `validate_project_config`**

找到 `main()` 函数中调用 `validate_shot` 的位置，在开始校验分镜之前新增项目级配置校验：

```python
def main():
    args = parse_args()

    # ... existing project/episode resolution code ...

    # 新增：项目配置校验
    config_errors = validate_project_config(project_name, project_root)
    for err in config_errors:
        print(f"  {err}")
    if config_errors:
        all_passed = False

    # 获取分镜列表...
    # ... rest of existing code ...
```

需要找到 `main()` 函数的确切位置来精确修改。

- [ ] **Step 4: 运行 validate.py 确认新校验生效**

Run: `python .claude/skills/create-video-script/scripts/validate.py --list-projects`
Expected: 列出项目，且对尚无 project.json 的项目显示警告

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/create-video-script/scripts/validate.py
git commit -m "feat(skill): add project.json validation to validate.py"
```

---

### Task 4: 更新 SKILL.md

**Files:**
- Modify: `.claude/skills/create-video-script/SKILL.md`

- [ ] **Step 1: 更新输出目录结构**

在 "输出目录结构" 章节，`design/{项目名称}/` 下新增 `project.json` 条目：

```diff
 design
   └── {项目名称}
+      ├── project.json              # 项目结构化配置（分辨率、画面比例等）
       ├── overview.md
       └── prompt/...
```

- [ ] **Step 2: 移除 overview.md 模板中的 YAML frontmatter**

将以下内容：
```
---
type: project-overview
project_name: {项目名称}
aspect_ratio: {...}
resolution: {...}
characters:
  - [...]
stages:
  - [...]
---
```

替换为直接以 `# {项目名称} - 视频总览` 开头（删除 `---` 之间的元数据块）。

- [ ] **Step 3: 在前置设定流程中新增写入步骤**

在 "画面比例与分辨率" 决策确认后，添加：

> 用户选定画面比例与分辨率后，依次运行：
> ```bash
> python .claude/skills/create-video-script/scripts/set_project_property.py --project "{项目名称}" aspectRatio "{用户选择的比例}"
> python .claude/skills/create-video-script/scripts/set_project_property.py --project "{项目名称}" width {画面宽度}
> python .claude/skills/create-video-script/scripts/set_project_property.py --project "{项目名称}" height {画面高度}
> ```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/create-video-script/SKILL.md
git commit -m "feat(skill): update SKILL.md for project.json support"
```

---

### Task 5: 工作流引擎自动注入 project.json

**Files:**
- Modify: `server/src/workflow-engine.ts`

- [ ] **Step 1: 在 `workflow-engine.ts` 中新增 `loadProjectConfig` 函数**

在 `const DESIGN_DIR = path.resolve(__dirname, '../../design');` 之后添加：

```typescript
/**
 * 读取项目级配置（project.json）并返回可注入 vars 的键值对。
 * 文件不存在或解析失败时返回空对象。
 */
async function loadProjectConfig(project: string): Promise<Record<string, string>> {
  const configPath = path.resolve(DESIGN_DIR, project, 'project.json');
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);
    const result: Record<string, string> = {};
    if (config.width != null) result.width = String(config.width);
    if (config.height != null) result.height = String(config.height);
    if (config.aspectRatio != null) result.aspectRatio = String(config.aspectRatio);
    return result;
  } catch {
    // 文件不存在或解析失败，静默忽略以保持向后兼容
    return {};
  }
}
```

- [ ] **Step 2: 修改 `runTask` 函数，将 project config 注入到 vars**

找到 `runTask` 函数中创建 `workflowParams` 的位置（约第 60 行）：

```typescript
const workflowParams: WorkflowParams = {
  project: task.project,
  vars: paramsObj.vars ?? {},
  async readFile(relPath: string): Promise<string> {
```

改为：

```typescript
const projectConfig = await loadProjectConfig(task.project);

const workflowParams: WorkflowParams = {
  project: task.project,
  vars: {
    ...projectConfig,
    ...(paramsObj.vars ?? {}),   // 前端传入的 vars 优先级更高，允许临时覆盖
  },
  async readFile(relPath: string): Promise<string> {
```

- [ ] **Step 3: 运行类型检查**

Run: `npm run typecheck`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add server/src/workflow-engine.ts
git commit -m "feat(server): auto-inject project config into workflow params"
```

---

### Task 6: 迁移现有项目

**Files:**
- Create: `design/AI的第一天/project.json`
- Create: `design/古人在现代/project.json`
- Modify: `design/AI的第一天/overview.md`
- Modify: `design/古人在现代/overview.md`

- [ ] **Step 1: 为 "AI的第一天" 创建 project.json**

```bash
python .claude/skills/create-video-script/scripts/set_project_property.py --project "AI的第一天" width 1080
python .claude/skills/create-video-script/scripts/set_project_property.py --project "AI的第一天" height 1920
python .claude/skills/create-video-script/scripts/set_project_property.py --project "AI的第一天" aspectRatio "9:16"
```

Expected: 三条命令均输出 `✅ 已写入: ...project.json`

- [ ] **Step 2: 为 "古人在现代" 创建 project.json**

```bash
python .claude/skills/create-video-script/scripts/set_project_property.py --project "古人在现代" width 1080
python .claude/skills/create-video-script/scripts/set_project_property.py --project "古人在现代" height 1920
python .claude/skills/create-video-script/scripts/set_project_property.py --project "古人在现代" aspectRatio "9:16"
```

- [ ] **Step 3: 删除 "AI的第一天/overview.md" 的 YAML frontmatter**

当前文件开头有：
```
---
type: project-overview
project_name: AI的第一天
aspect_ratio: 9:16
resolution: 1080x1920
characters:
  - 小霓
  - 程序员主人
  - 便利店店员
  - 便利店橘猫
stages:
  - 程序员公寓
  - 城市街道
  - 便利店内部
---
```

删除 `---` 之间的所有行（包括分隔线），使文件直接从 `# AI的第一天 - 视频总览` 开始。

- [ ] **Step 4: 删除 "古人在现代/overview.md" 的 YAML frontmatter**

当前文件开头有：
```
---
type: project-overview
aspect_ratio: 9:16
resolution: 1080x1920
characters:
  - 陈书文
  - 现代女孩
stages:
  - 现代商场
---
```

删除 `---` 之间的所有行。

- [ ] **Step 5: 运行 validate.py 确认无错误**

Run: `python .claude/skills/create-video-script/scripts/validate.py`
Expected: 之前记录的 config 警告消失

- [ ] **Step 6: Commit**

```bash
git add design/
git commit -m "feat: migrate existing projects to project.json"
```
