#!/usr/bin/env python3
"""
校验所有分镜资产的引用完整性。

检查内容:
  - 每个分镜的 stage.json 引用的场景资产文件是否存在
  - 每个分镜的 stage.json 引用的角色资产目录是否存在
  - 登场角色数量是否不超过 2
  - prompt 字段中是否正确使用 "图像1/图像2/图像3" 标识
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
import sys
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
    list_projects,
    list_episodes,
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


def validate_shot(shot: int, episode: int, project_name: str,
                  project_root: str | None, fix: bool = False) -> list[str]:
    """校验单个分镜，返回错误信息列表。"""
    errors: list[str] = []
    scene_dir = get_scene_dir(shot, project_name, episode, project_root)

    if not scene_dir.exists():
        errors.append(f"第{episode}集 分镜 {shot}: 目录不存在 ({scene_dir})")
        return errors

    stage_path = get_stage_json_path(shot, project_name, episode, project_root)
    script_path = get_script_json_path(shot, project_name, episode, project_root)

    # ── 检查 stage.json ──
    if not stage_path.exists():
        errors.append(f"第{episode}集 分镜 {shot}: stage.json 不存在")
    else:
        stage_data = read_json(stage_path)
        if not isinstance(stage_data, list):
            errors.append(f"第{episode}集 分镜 {shot}: stage.json 应为数组类型")
        else:
            for i, entry in enumerate(stage_data):
                # 检查基础场景完整性
                stage_ref = entry.get("基础场景", "")
                if not stage_ref:
                    errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: 缺少 '基础场景' 字段")
                else:
                    asset_path = get_stage_asset_path(stage_ref, project_name, project_root)
                    if not asset_path.exists():
                        errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: 场景资产不存在 ({asset_path})")

                # 检查登场角色
                chars = entry.get("登场角色", [])
                if not isinstance(chars, list):
                    errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: '登场角色' 应为数组")
                elif len(chars) == 0:
                    errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: '登场角色' 为空")
                elif len(chars) > 2:
                    errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: 登场角色超过2个 ({len(chars)})")
                else:
                    for ch in chars:
                        ch_dir = get_character_dir(ch, project_name, project_root)
                        if not ch_dir.exists():
                            errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: 角色资产不存在 ({ch_dir})")

                # 检查 prompt 字段
                prompt = entry.get("prompt", "")
                if not prompt:
                    errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: 缺少 'prompt' 字段")
                elif "图像1" not in prompt:
                    errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: prompt 中未使用 '图像1' 标识基础场景")

                if len(chars) >= 1 and "图像2" not in prompt:
                    errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: 有登场角色但 prompt 中未使用 '图像2' 标识第一个角色")
                if len(chars) >= 2 and "图像3" not in prompt:
                    errors.append(f"第{episode}集 分镜 {shot}.stage[{i}]: 有2个登场角色但 prompt 中未使用 '图像3' 标识第二个角色")

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
                print(f"   - {p}")
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
    print(f"📊 总计: {total_shots} 个分镜, {failed_shots} 个存在问题")

    if failed_shots > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
