#!/usr/bin/env python3
"""
校验所有分镜资产的引用完整性及项目配置。

检查内容:
  - project.json 的存在性、resolution 和 aspectRatio 字段格式
  - 每个分镜 overview.json 必须存在，字段齐全，duration 为 >0 的整数
  - 分镜目录不得残留 overview.md（应已迁移为 overview.json）
  - 每个分镜的 stage.json 基础场景必须非空，且引用的场景资产文件存在
  - 登场角色与 prompt 同时为空时视为直接引用基础场景（合法）
  - 有登场角色时 prompt 不得为空，角色资产目录须存在，数量不超过 2
  - 非直接引用时 prompt 字段中是否正确使用 "图像1/图像2/图像3" 标识
  - script.json 中出现的角色名是否在 stage.json 的登场角色中声明
  - 分镜编号是否连续无跳号（按集分别校验）

用法:
    python scripts/validate.py [分镜序号...]

示例:
    python scripts/validate.py                          # 校验所有集的所有分镜
    python scripts/validate.py -e 1                     # 校验第1集所有分镜
    python scripts/validate.py -e 1 1 2 3               # 校验第1集的指定分镜
    python scripts/validate.py --fix                    # 校验并尝试修复（仅限明确的可自动修复项）
"""

import argparse
import re
import sys
from _common import (
    DEFAULT_PROJECT,
    DEFAULT_EPISODE,
    OVERVIEW_REQUIRED_FIELDS,
    OVERVIEW_STRING_FIELDS,
    read_json,
    write_json,
    get_project_dir,
    get_scene_dir,
    get_stage_json_path,
    get_script_json_path,
    get_overview_json_path,
    get_stage_asset_path,
    get_character_dir,
    get_project_config_path,
    read_project_config,
    list_projects,
    list_episodes,
    normalize_shot_overview,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="校验分镜资产引用完整性",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("shots", type=int, nargs="*", default=None, help="要校验的分镜序号（默认校验该集所有分镜）")
    parser.add_argument("--project", "-p", type=str, default=None, help="剧本项目名称（默认自动检测或使用首个项目）")
    parser.add_argument("--episode", "-e", type=int, default=None, help="集数（默认自动检测或使用第1集）")
    parser.add_argument("--project-root", type=str, default=None, help="项目根目录（默认当前目录）")
    parser.add_argument("--list-projects", action="store_true", help="列出所有可用项目")
    parser.add_argument("--fix", action="store_true", help="尝试自动修复可修复的问题（实验性）")
    return parser.parse_args()


def get_all_shot_numbers(project_name: str, episode: int,
                         project_root: str | None) -> list[int]:
    """扫描指定项目指定集的所有分镜编号。"""
    scene_root = get_project_dir(project_name, project_root) / "prompt" / "scene" / str(episode)
    if not scene_root.exists():
        return []
    numbers = []
    for d in scene_root.iterdir():
        if d.is_dir() and d.name.isdigit():
            numbers.append(int(d.name))
    return sorted(numbers)


def validate_project_config(project_name: str, project_root: str | None) -> list[str]:
    """校验 project.json 的存在性和格式，返回错误信息列表。"""
    errors: list[str] = []
    config_path = get_project_config_path(project_name, project_root)

    if not config_path.exists():
        errors.append(f"⚠️ 项目 '{project_name}' 缺少 project.json")
        return errors

    config = read_project_config(project_name, project_root)

    # 文件存在但配置为空，可能是解析错误（read_project_config 已输出警告到 stderr）
    if not config:
        errors.append(f"project.json 文件存在但内容为空或解析失败，请检查文件格式")
        return errors

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


def validate_shot(shot: int, episode: int, project_name: str,
                  project_root: str | None, fix: bool = False) -> list[str]:
    """校验单个分镜，返回错误信息列表。"""
    errors: list[str] = []
    scene_dir = get_scene_dir(shot, project_name, episode, project_root)

    if not scene_dir.exists():
        errors.append(f"第{episode}集 分镜 {shot}: 目录不存在 ({scene_dir})")
        return errors

    overview_path = get_overview_json_path(shot, project_name, episode, project_root)
    overview_md_path = scene_dir / "overview.md"
    stage_path = get_stage_json_path(shot, project_name, episode, project_root)
    script_path = get_script_json_path(shot, project_name, episode, project_root)

    # ── 检查 overview.json / 残留 overview.md ──
    if overview_md_path.exists() and not overview_path.exists():
        if fix:
            try:
                from migrate_shot_overview import md_to_overview
                text = overview_md_path.read_text(encoding="utf-8")
                data = md_to_overview(text)
                write_json(overview_path, data)
                overview_md_path.unlink()
                print(f"🔧 第{episode}集 分镜 {shot}: 已从 overview.md 迁移为 overview.json")
            except Exception as e:
                errors.append(f"第{episode}集 分镜 {shot}: overview.md 自动迁移失败 ({e})")
        else:
            errors.append(
                f"第{episode}集 分镜 {shot}: 仍使用 overview.md，请迁移为 overview.json"
                "（python .../migrate_shot_overview.py 或 validate.py --fix）"
            )
    elif overview_md_path.exists() and overview_path.exists():
        if fix:
            overview_md_path.unlink()
            print(f"🔧 第{episode}集 分镜 {shot}: 已删除残留 overview.md")
        else:
            errors.append(f"第{episode}集 分镜 {shot}: 同时存在 overview.md 与 overview.json，应删除 md")

    if not overview_path.exists():
        if fix:
            data = normalize_shot_overview({})
            write_json(overview_path, data)
            print(f"🔧 第{episode}集 分镜 {shot}: 已创建默认 overview.json")
        else:
            errors.append(f"第{episode}集 分镜 {shot}: overview.json 不存在")
    else:
        overview_data = read_json(overview_path)
        if not isinstance(overview_data, dict):
            errors.append(f"第{episode}集 分镜 {shot}: overview.json 应为对象类型")
        else:
            for field in OVERVIEW_REQUIRED_FIELDS:
                if field not in overview_data:
                    errors.append(f"第{episode}集 分镜 {shot}: overview.json 缺少 '{field}' 字段")
            for field in OVERVIEW_STRING_FIELDS:
                if field in overview_data and overview_data[field] is not None and not isinstance(overview_data[field], str):
                    errors.append(
                        f"第{episode}集 分镜 {shot}: overview.json '{field}' 应为字符串，当前: {type(overview_data[field]).__name__}"
                    )
            if "duration" in overview_data:
                duration = overview_data["duration"]
                if not isinstance(duration, int) or isinstance(duration, bool):
                    errors.append(
                        f"第{episode}集 分镜 {shot}: overview.json 'duration' 应为正整数，当前: {duration!r}"
                    )
                elif duration <= 0:
                    errors.append(
                        f"第{episode}集 分镜 {shot}: overview.json 'duration' 必须 > 0，当前: {duration}"
                    )

    # ── 检查 stage.json ──
    if not stage_path.exists():
        errors.append(f"第{episode}集 分镜 {shot}: stage.json 不存在")
    else:
        stage_data = read_json(stage_path)
        if not isinstance(stage_data, list):
            errors.append(f"第{episode}集 分镜 {shot}: stage.json 应为数组类型")
        else:
            for i, entry in enumerate(stage_data):
                # 检查基础场景完整性（必须非空）
                stage_ref = entry.get("基础场景", "")
                if not stage_ref or not str(stage_ref).strip():
                    errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: '基础场景' 不能为空")
                else:
                    asset_path = get_stage_asset_path(stage_ref, project_name, project_root)
                    if not asset_path.exists():
                        errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: 场景资产不存在 ({asset_path})")

                # 检查登场角色
                chars = entry.get("登场角色", [])
                if chars is None:
                    chars = []
                if not isinstance(chars, list):
                    errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: '登场角色' 应为数组")
                    chars = []
                elif len(chars) > 2:
                    errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: 登场角色超过2个 ({len(chars)})")
                else:
                    for ch in chars:
                        ch_dir = get_character_dir(ch, project_name, project_root)
                        if not ch_dir.exists():
                            errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: 角色资产不存在 ({ch_dir})")

                # 检查 prompt 字段
                # 登场角色与 prompt 同时为空 = 直接引用基础场景（合法）
                prompt = entry.get("prompt", "")
                if prompt is None:
                    prompt = ""
                prompt_str = str(prompt)
                is_direct_ref = len(chars) == 0 and not prompt_str.strip()

                if is_direct_ref:
                    # 直接引用基础场景，无需 prompt / 图像标识校验
                    pass
                elif not prompt_str.strip():
                    # 有角色但 prompt 为空，或其它非直接引用却缺 prompt
                    errors.append(
                        f"第{episode}集 分镜 {shot}.stage[{i}]: 非直接引用时 prompt 不能为空"
                        + ("（有登场角色）" if len(chars) > 0 else "")
                    )
                else:
                    if "图像1" not in prompt_str:
                        errors.append(
                            f"第{episode}集 分镜 {shot}.stage[{i}]: prompt 中未使用 '图像1' 标识基础场景"
                        )
                    if len(chars) >= 1 and "图像2" not in prompt_str:
                        errors.append(
                            f"第{episode}集 分镜 {shot}.stage[{i}]: 有登场角色但 prompt 中未使用 '图像2' 标识第一个角色"
                        )
                    if len(chars) >= 2 and "图像3" not in prompt_str:
                        errors.append(
                            f"第{episode}集 分镜 {shot}.stage[{i}]: 有2个登场角色但 prompt 中未使用 '图像3' 标识第二个角色"
                        )

    # ── 检查 script.json ──
    if not script_path.exists():
        errors.append(f"第{episode}集 分镜 {shot}: script.json 不存在")
    else:
        script_data = read_json(script_path)
        if not isinstance(script_data, list):
            errors.append(f"第{episode}集 分镜 {shot}: script.json 应为数组类型")
        else:
            # 收集所有在 stage.json 中注册的角色
            registered_chars: set[str] = set()
            if stage_path.exists():
                stage_data = read_json(stage_path)
                for entry in stage_data:
                    registered_chars.update(entry.get("登场角色", []))

            for j, line in enumerate(script_data):
                char_name = line.get("角色名", "")
                if not char_name:
                    errors.append(f"第{episode}集 分镜 {shot}.script[{j}]: 缺少 '角色名' 字段")
                elif char_name not in registered_chars:
                    errors.append(
                        f"第{episode}集 分镜 {shot}.script[{j}]: 角色 '{char_name}' 未在 stage.json 的登场角色中声明"
                    )
                if not line.get("台词", ""):
                    errors.append(f"第{episode}集 分镜 {shot}.script[{j}]: '台词' 为空")
                if not line.get("情绪", ""):
                    errors.append(f"第{episode}集 分镜 {shot}.script[{j}]: 缺少 '情绪' 字段")

    return errors


def main():
    args = parse_args()
    project_root = args.project_root

    # 列出项目模式
    if args.list_projects:
        projects = list_projects(project_root)
        if not projects:
            print("⚠️  未找到任何项目（design/ 下没有包含 overview.md 的目录）。")
        else:
            print("📂 可用项目:")
            for p in projects:
                config_errors = validate_project_config(p, project_root)
                if config_errors:
                    print(f"   - {p}  ⚠️  project.json 配置问题")
                    for err in config_errors:
                        print(f"       {err}")
                else:
                    print(f"   - {p}  ✅")
        sys.exit(0)

    # 确定项目名称
    project_name = args.project
    if project_name is None:
        projects = list_projects(project_root)
        if not projects:
            print("⚠️  未找到任何项目。请使用 --project 指定项目名称。")
            sys.exit(1)
        project_name = projects[0]
        print(f"📌 自动检测到项目: {project_name}")

    # 确定集数
    episode = args.episode
    if episode is None:
        episodes = list_episodes(project_name, project_root)
        if episodes:
            episode = episodes[0]
            print(f"📌 自动检测到集数: {episode}")
        else:
            episode = DEFAULT_EPISODE
            print(f"📌 未检测到集数，默认使用第 {episode} 集")

    # 确定要校验的分镜列表
    if args.shots:
        shot_numbers = args.shots
    else:
        shot_numbers = get_all_shot_numbers(project_name, episode, project_root)
        if not shot_numbers:
            print(f"⚠️  项目 '{project_name}' 第 {episode} 集下未找到任何分镜资产（prompt/scene/{episode}/ 下无分镜目录）。")
            sys.exit(0)

    # 项目配置校验
    all_passed = True
    config_errors = validate_project_config(project_name, project_root)
    for err in config_errors:
        print(f"  {err}")
    if config_errors:
        all_passed = False

    # 检查编号连续性
    if shot_numbers:
        expected = list(range(shot_numbers[0], shot_numbers[-1] + 1))
        missing = sorted(set(expected) - set(shot_numbers))
        if missing:
            print(f"⚠️  第{episode}集 分镜编号不连续，缺失: {missing}")

    # 逐分镜校验
    all_errors: dict[int, list[str]] = {}
    for shot in shot_numbers:
        errors = validate_shot(shot, episode, project_name, project_root, fix=args.fix)
        if errors:
            all_errors[shot] = errors

    # 输出结果
    if not all_errors:
        print(f"✅ 项目 '{project_name}' 第 {episode} 集校验通过！共检查 {len(shot_numbers)} 个分镜，无异常。")
    else:
        print(f"\n❌ 项目 '{project_name}' 第 {episode} 集发现 {sum(len(v) for v in all_errors.values())} 个问题:\n")
        for shot, errors in sorted(all_errors.items()):
            print(f"═══ 第{episode}集 分镜 {shot} ═══")
            for err in errors:
                print(f"   • {err}")
            print()

    # 统计
    total_shots = len(shot_numbers)
    failed_shots = len(all_errors)
    if failed_shots > 0:
        all_passed = False
    print(f"📊 总计: {total_shots} 个分镜, {failed_shots} 个存在问题")

    if not all_passed:
        sys.exit(1)


if __name__ == "__main__":
    main()
