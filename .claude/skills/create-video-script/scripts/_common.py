"""
视频分镜脚本工具 - 公共模块
提供路径解析、JSON 读写等共享功能。
"""

import json
import sys
from pathlib import Path
from typing import Any, Optional


DEFAULT_PROJECT = "古人在现代"
DEFAULT_EPISODE = 1


def resolve_project_root(project_root: Optional[str] = None) -> Path:
    """解析项目根目录路径。默认使用当前工作目录。"""
    if project_root:
        return Path(project_root).resolve()
    return Path.cwd().resolve()


def get_project_dir(project_name: str, project_root: Optional[str] = None) -> Path:
    """获取指定剧本项目的目录路径：design/{project_name}"""
    return resolve_project_root(project_root) / "design" / project_name


def get_scene_dir(shot_number: int, project_name: str,
                  episode: int = DEFAULT_EPISODE,
                  project_root: Optional[str] = None) -> Path:
    """获取指定分镜的目录路径。
    路径规则：design/{project_name}/prompt/scene/{episode}/{shot_number}
    """
    return (get_project_dir(project_name, project_root)
            / "prompt" / "scene" / str(episode) / str(shot_number))


def get_stage_json_path(shot_number: int, project_name: str,
                        episode: int = DEFAULT_EPISODE,
                        project_root: Optional[str] = None) -> Path:
    """获取指定分镜的 stage.json 路径。"""
    return get_scene_dir(shot_number, project_name, episode, project_root) / "stage.json"


def get_script_json_path(shot_number: int, project_name: str,
                         episode: int = DEFAULT_EPISODE,
                         project_root: Optional[str] = None) -> Path:
    """获取指定分镜的 script.json 路径。"""
    return get_scene_dir(shot_number, project_name, episode, project_root) / "script.json"


def get_overview_json_path(shot_number: int, project_name: str,
                           episode: int = DEFAULT_EPISODE,
                           project_root: Optional[str] = None) -> Path:
    """获取指定分镜的 overview.json 路径。"""
    return get_scene_dir(shot_number, project_name, episode, project_root) / "overview.json"


# 分镜 overview.json 字段与默认值
OVERVIEW_STRING_FIELDS = ("title", "beat", "visual", "camera", "mood")
OVERVIEW_REQUIRED_FIELDS = (*OVERVIEW_STRING_FIELDS, "duration")
DEFAULT_SHOT_DURATION = 5


def default_shot_overview(title: str = "待定标题") -> dict:
    """新建分镜 overview.json 的默认内容。"""
    return {
        "title": title,
        "beat": "",
        "visual": "",
        "camera": "",
        "duration": DEFAULT_SHOT_DURATION,
        "mood": "",
    }


def normalize_shot_overview(data: Any) -> dict:
    """
    将任意输入规范为完整 overview 对象。
    缺失字段补默认值；duration 非法时回退默认 5。
    duration 必须是正整数。
    """
    base = default_shot_overview()
    if not isinstance(data, dict):
        return base
    result = dict(base)
    for key in OVERVIEW_STRING_FIELDS:
        if key in data and data[key] is not None:
            result[key] = str(data[key])
    if "duration" in data and data["duration"] is not None:
        try:
            raw = data["duration"]
            # 仅接受整数或可无损转为整数的数值（如 4.0）
            if isinstance(raw, bool):
                raise TypeError("bool is not a valid duration")
            if isinstance(raw, int):
                duration = raw
            else:
                as_float = float(raw)
                if as_float != int(as_float):
                    raise ValueError("duration must be an integer")
                duration = int(as_float)
            if duration > 0:
                result["duration"] = duration
        except (TypeError, ValueError):
            pass
    return result


def read_json(path: Path) -> Any:
    """读取 JSON 文件，文件不存在时返回空数组。"""
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"❌ JSON 解析错误: {path}\n   {e}", file=sys.stderr)
        sys.exit(1)


def write_json(path: Path, data: Any) -> None:
    """写入 JSON 文件（自动创建目录）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"✅ 已写入: {path}")


def get_stage_asset_path(stage_ref: str, project_name: str, project_root: Optional[str] = None) -> Path:
    """
    根据 stage_ref（如 "现代商场/现代商场-白天-平视-晴-中央扶梯"）
    解析对应的场景资产 .md 文件路径。
    路径规则：design/{project_name}/prompt/stage/{stage_ref}.md
    """
    return get_project_dir(project_name, project_root) / "prompt" / "stage" / f"{stage_ref}.md"


def get_character_dir(character_name: str, project_name: str, project_root: Optional[str] = None) -> Path:
    """获取指定角色资产目录路径。"""
    return get_project_dir(project_name, project_root) / "prompt" / "character" / character_name


def list_projects(project_root: Optional[str] = None) -> list[str]:
    """列出 design 下所有项目（有 overview.md 的目录即为一个项目）。"""
    design = resolve_project_root(project_root) / "design"
    if not design.exists():
        return []
    projects = []
    for d in design.iterdir():
        if d.is_dir() and (d / "overview.md").exists():
            projects.append(d.name)
    return sorted(projects)


def list_episodes(project_name: str, project_root: Optional[str] = None) -> list[int]:
    """列出指定项目下所有集数。
    扫描 prompt/scene/ 下的数字目录，即为集数。
    """
    scene_root = get_project_dir(project_name, project_root) / "prompt" / "scene"
    if not scene_root.exists():
        return []
    episodes = []
    for d in scene_root.iterdir():
        if d.is_dir() and d.name.isdigit():
            episodes.append(int(d.name))
    return sorted(episodes)


def validate_stage_ref(stage_ref: str, project_name: str, project_root: Optional[str] = None) -> bool:
    """检查场景引用是否存在对应的资产文件。"""
    path = get_stage_asset_path(stage_ref, project_name, project_root)
    exists = path.exists()
    if not exists:
        print(f"⚠️  场景资产不存在: {path}", file=sys.stderr)
    return exists


def validate_character_ref(character_name: str, project_name: str, project_root: Optional[str] = None) -> bool:
    """检查角色引用是否存在对应的资产目录。"""
    path = get_character_dir(character_name, project_name, project_root)
    exists = path.exists()
    if not exists:
        print(f"⚠️  角色资产不存在: {path}", file=sys.stderr)
    return exists


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
    except json.JSONDecodeError as e:
        print(f"⚠️  project.json 解析错误: {path}\n   {e}", file=sys.stderr)
        return {}
    except OSError as e:
        print(f"⚠️  读取 project.json 失败: {path}\n   {e}", file=sys.stderr)
        return {}


def write_project_config(project_name: str, config: dict, project_root: Optional[str] = None) -> None:
    """写入 project.json（自动创建目录）。"""
    path = get_project_config_path(project_name, project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    print(f"✅ 已写入: {path}")
