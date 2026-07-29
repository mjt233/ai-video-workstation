# 分镜脚本工具参考

项目 `.claude/skills/create-video-script/scripts/` 目录下提供了一套 Python 脚本，用于以命令行方式管理分镜 JSON 资产，避免直接编辑 JSON 字符串。所有脚本均支持 `--help` 查看详细用法。

## 环境要求

- Python 3.8+
- 在项目根目录下运行脚本（或通过 `--project-root` 指定项目路径）
- 脚本会自动将 `design/{项目名称}` 作为资产根目录
- 使用 `--project`（或 `-p`）参数指定剧本项目名称，默认自动检测第一个可用项目

## 列出项目

```bash
python .claude/skills/create-video-script/scripts/validate.py --list-projects
```

## 分镜总览（overview.json）

| 命令 | 功能 | 示例 |
|------|------|------|
| `python .claude/skills/create-video-script/scripts/set_shot_overview.py` | 创建/更新分镜总览字段 | `python .claude/skills/create-video-script/scripts/set_shot_overview.py -p 古人在现代 -e 1 1 --title "书生初临" --duration 4` |
| `python .claude/skills/create-video-script/scripts/migrate_shot_overview.py` | 将旧 `overview.md` 迁移为 `overview.json` | `python .claude/skills/create-video-script/scripts/migrate_shot_overview.py -p 古人在现代` |

### `set_shot_overview.py` 参数说明

1. `分镜序号` — 整数，从 1 开始
2. `--title` — 分镜标题
3. `--beat` — 叙事节拍
4. `--visual` — 画面描述
5. `--camera` — 镜头运动
6. `--duration` — 时长（秒，**正整数**，须 `> 0`；默认 `5`）
7. `--mood` — 情绪基调
8. `-p` 或 `--project` — 剧本项目名称
9. `-e` 或 `--episode` — 集数（默认: 1）

至少指定一个字段。文件不存在时会按默认值创建完整 `overview.json`，再应用本次更新。

```bash
python .claude/skills/create-video-script/scripts/set_shot_overview.py -p 古人在现代 -e 1 1 --title "书生初临" --beat "建立镜头" --visual "..." --camera "slow zoom in" --duration 4 --mood "困惑"
python .claude/skills/create-video-script/scripts/set_shot_overview.py -p 古人在现代 -e 1 1 --duration 5
```

## 场景管理（stage.json）

| 命令 | 功能 | 示例 |
|------|------|------|
| `python .claude/skills/create-video-script/scripts/add_stage.py` | 添加一条场景定义 | `python .claude/skills/create-video-script/scripts/add_stage.py -p 古人在现代 -e 1 1 "现代商场/现代商场-白天-平视-晴-中央扶梯" "陈书文" "图像1为背景：..."` |
| `python .claude/skills/create-video-script/scripts/add_stage.py` | 直接引用基础场景（无角色/无修改） | `python .claude/skills/create-video-script/scripts/add_stage.py -p 古人在现代 -e 1 1 "现代商场/现代商场-白天-平视-晴-中央扶梯" "" ""` |
| `python .claude/skills/create-video-script/scripts/add_stage.py` | 直接引用上一分镜最后场景（`prev`） | `python .claude/skills/create-video-script/scripts/add_stage.py -p 古人在现代 -e 1 2 prev "" ""` |
| `python .claude/skills/create-video-script/scripts/remove_stage.py` | 移除一条场景定义（按索引） | `python .claude/skills/create-video-script/scripts/remove_stage.py -p 古人在现代 -e 1 1 0` |
| `python .claude/skills/create-video-script/scripts/update_stage.py` | 更新场景定义的字段 | `python .claude/skills/create-video-script/scripts/update_stage.py -p 古人在现代 -e 1 1 0 --prompt "新提示词"` |

### `add_stage.py` 参数说明

1. `分镜序号` — 整数，从 1 开始
2. `基础场景标签` — **必填**，场景完整标签如 `现代商场/现代商场-白天-平视-晴-中央扶梯`（需与 `stage/` 下的资产文件路径一致），或关键字 `prev`（同集上一分镜最后场景，**仅直接引用**）
3. `角色名` — 逗号分隔，最多 2 个，如 `陈书文` 或 `陈书文,现代女孩`；传空字符串 `""` 表示无登场角色；`prev` 时必须为空
4. `prompt` — 组合提示词，使用 `图像1` 代表场景、`图像2/3` 代表角色；传空字符串 `""` 且角色也为空时，表示直接引用。**有登场角色时**须写清：人物相对场景地标/彼此的位置关系，以及面部与身体朝向（朝向须以人或场景特征为参考点，见 [`03-asset-output.md`](./03-asset-output.md#场景组合jsonstagejson)）；`prev` 时必须为空
5. `-p` 或 `--project` — 剧本项目名称（默认自动检测）
6. `-e` 或 `--episode` — 集数（默认: 1）

脚本会自动校验：
- `基础场景` 非空；普通引用时场景资产文件（`design/prompt/stage/{场景}/{完整场景标签}.md`）存在；`prev` 时当前分镜 > 1 且上一分镜 `stage.json` 非空
- 角色资产目录（`design/prompt/character/{角色名}/`）是否存在（有角色时）
- 角色数量是否 ≤ 2
- `登场角色` 与 `prompt` 同时为空 → 直接引用模式；有角色时 `prompt` 不得为空；`prev` 仅允许直接引用

## 台词管理（script.json）

| 命令 | 功能 | 示例 |
|------|------|------|
| `python .claude/skills/create-video-script/scripts/add_script.py` | 添加一条台词 | `python .claude/skills/create-video-script/scripts/add_script.py -p 古人在现代 -e 1 1 "陈书文" "你好，请问这里有人吗？" "期待"` |
| `python .claude/skills/create-video-script/scripts/remove_script.py` | 移除一条台词（按索引） | `python .claude/skills/create-video-script/scripts/remove_script.py -p 古人在现代 -e 1 1 0` |

### `add_script.py` 参数说明

1. `分镜序号` — 整数，从 1 开始
2. `角色名` — 台词所属角色（自动校验是否在 stage.json 登场角色中声明）
3. `台词内容` — 角色说的文本
4. `情绪` — 可选，默认 `平静`
5. `-p` 或 `--project` — 剧本项目名称（默认自动检测）
6. `-e` 或 `--episode` — 集数（默认: 1）

## 完整性校验

```bash
python .claude/skills/create-video-script/scripts/validate.py                                        # 自动检测项目并校验所有分镜
python .claude/skills/create-video-script/scripts/validate.py -p 古人在现代                           # 指定项目校验
python .claude/skills/create-video-script/scripts/validate.py -p 古人在现代 -e 1                     # 校验第1集所有分镜
python .claude/skills/create-video-script/scripts/validate.py -e 1 1 2 3                             # 校验第1集的指定分镜
python .claude/skills/create-video-script/scripts/validate.py --fix                                  # 尝试自动修复
python .claude/skills/create-video-script/scripts/validate.py --list-projects                        # 列出所有可用项目
```

### `validate.py` 参数说明

- `分镜序号...` — 可选，要校验的分镜序号（默认校验该集所有分镜）
- `-p` 或 `--project` — 剧本项目名称（默认自动检测）
- `-e` 或 `--episode` — 集数（默认: 1）
- `--fix` — 尝试自动修复
- `--list-projects` — 列出所有可用项目
- `--project-root` — 项目根目录（默认当前目录）

### 校验内容

- 每个分镜 `overview.json` 是否存在，字段齐全（`title/beat/visual/camera/duration/mood`），`duration` 为 `> 0` 的整数
- 分镜目录不得残留 `overview.md`
- 每个分镜 `stage.json` 的 `基础场景` 是否非空，且引用的场景资产文件是否存在
- 每个分镜 `stage.json` 引用的角色资产目录是否存在（有角色时）
- 登场角色数量是否 ≤ 2
- `登场角色` 与 `prompt` 同时为空时视为直接引用基础场景（合法）；有角色时 `prompt` 不得为空
- 非直接引用时，prompt 中是否正确使用 `图像1`（及有角色时的 `图像2/图像3`）标识
- `script.json` 中的角色是否在 `stage.json` 的登场角色中声明
- 分镜编号是否连续无跳号（按集分别校验）
