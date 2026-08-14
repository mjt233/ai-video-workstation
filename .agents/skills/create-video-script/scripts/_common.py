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


PREV_STAGE_REF = "prev"


def is_prev_stage_ref(stage_ref: str) -> bool:
    """是否为上一分镜最后场景引用关键字 prev。"""
    return (stage_ref or "").strip() == PREV_STAGE_REF


def get_stage_asset_path(stage_ref: str, project_name: str, project_root: Optional[str] = None) -> Path:
    """
    根据 stage_ref（如 "现代商场/现代商场-白天-平视-晴-中央扶梯"
    或衍生变体 "现代商场/现代商场-白天-平视-正门入口@门已打开"）
    解析对应的场景资产路径。

    - 基础场景：design/{project}/prompt/stage/{场景名}/{标签}.md
    - 衍生变体：design/{project}/prompt/stage/{场景名}/variants/{标签}/{变体id}.json
    - prev：不对应 prompt/stage 资产；请用 validate_stage_ref / validate_prev_stage_ref
    """
    ref = (stage_ref or "").strip()
    if is_prev_stage_ref(ref):
        # prev 不映射到 prompt/stage；返回不存在路径，避免被误判为普通场景
        return get_project_dir(project_name, project_root) / "prompt" / "stage" / "__prev__" / "__invalid__.md"
    at = ref.find("@")
    main = ref[:at] if at >= 0 else ref
    variant_id = ref[at + 1:].strip() if at >= 0 else ""
    # main 形如 场景名/标签（使用正斜杠）
    parts = [p for p in main.replace("\\", "/").split("/") if p]
    base = get_project_dir(project_name, project_root) / "prompt" / "stage"
    if variant_id:
        if len(parts) < 2:
            # 非法引用，返回一个不存在的路径供 exists 检查失败
            return base / "__invalid__" / f"{variant_id}.json"
        stage_name, label = parts[0], "/".join(parts[1:])
        return base / stage_name / "variants" / label / f"{variant_id}.json"
    return base.joinpath(*parts[:-1], f"{parts[-1]}.md") if parts else base / "__invalid__.md"


def validate_prev_stage_ref(
    shot_number: int,
    project_name: str,
    episode: int = DEFAULT_EPISODE,
    project_root: Optional[str] = None,
) -> bool:
    """
    校验 prev 引用上下文：
    - 当前分镜须 > 1
    - 同集上一分镜 stage.json 存在且为非空数组
    """
    if not isinstance(shot_number, int) or shot_number <= 1:
        print("⚠️  第 1 个分镜不能使用基础场景 prev（无上一分镜）", file=sys.stderr)
        return False
    prev_path = get_stage_json_path(shot_number - 1, project_name, episode, project_root)
    if not prev_path.exists():
        print(f"⚠️  上一分镜 stage.json 不存在: {prev_path}", file=sys.stderr)
        return False
    data = read_json(prev_path)
    if not isinstance(data, list) or len(data) == 0:
        print(f"⚠️  上一分镜 stage.json 为空: {prev_path}", file=sys.stderr)
        return False
    return True


def get_character_dir(character_name: str, project_name: str, project_root: Optional[str] = None) -> Path:
    """获取指定角色资产目录路径（忽略 @变体 后缀）。"""
    name = (character_name or "").strip()
    at = name.find("@")
    base = name[:at].strip() if at >= 0 else name
    return get_project_dir(project_name, project_root) / "prompt" / "character" / base


def get_character_variant_meta_path(
    character_ref: str, project_name: str, project_root: Optional[str] = None
) -> Optional[Path]:
    """若引用含 @变体，返回变体 meta JSON 路径，否则 None。"""
    ref = (character_ref or "").strip()
    at = ref.find("@")
    if at < 0:
        return None
    name = ref[:at].strip()
    variant_id = ref[at + 1:].strip()
    if not name or not variant_id:
        return None
    return (
        get_project_dir(project_name, project_root)
        / "prompt"
        / "character"
        / name
        / "variants"
        / f"{variant_id}.json"
    )


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


def validate_stage_ref(
    stage_ref: str,
    project_name: str,
    project_root: Optional[str] = None,
    *,
    shot_number: Optional[int] = None,
    episode: int = DEFAULT_EPISODE,
) -> bool:
    """
    检查场景引用是否合法。

    - 普通引用：对应 prompt/stage 资产文件存在（支持基础场景与衍生变体）
    - prev：须提供 shot_number，并校验同集上一分镜 stage.json 非空
    """
    ref = (stage_ref or "").strip()
    if is_prev_stage_ref(ref):
        if shot_number is None:
            print("⚠️  校验 prev 时需要提供当前分镜序号 shot_number", file=sys.stderr)
            return False
        return validate_prev_stage_ref(shot_number, project_name, episode, project_root)
    path = get_stage_asset_path(ref, project_name, project_root)
    exists = path.exists()
    if not exists:
        print(f"⚠️  场景资产不存在: {path}", file=sys.stderr)
    return exists


def validate_character_ref(character_name: str, project_name: str, project_root: Optional[str] = None) -> bool:
    """检查角色引用是否存在对应的资产目录（支持 角色名@变体）。"""
    path = get_character_dir(character_name, project_name, project_root)
    exists = path.exists()
    if not exists:
        print(f"⚠️  角色资产不存在: {path}", file=sys.stderr)
        return False
    variant_meta = get_character_variant_meta_path(character_name, project_name, project_root)
    if variant_meta is not None and not variant_meta.exists():
        print(f"⚠️  角色衍生变体不存在: {variant_meta}", file=sys.stderr)
        return False
    return True


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
