#!/usr/bin/env python3
"""
更新指定分镜 stage.json 中某条场景定义的字段。
支持更新部分字段，未提供的字段保持原值。

用法:
    python scripts/update_stage.py <分镜序号> <索引> [--stage-ref <新场景标签>] [--characters <新角色>] [--prompt <新提示词>]

参数:
    分镜序号        - 整数，从 1 开始
    索引            - 要更新的条目索引（从 0 开始）
    --stage-ref     - 可选，新的基础场景完整标签
    --characters    - 可选，新的登场角色名（逗号分隔，最多2个；传空字符串表示无角色）
    --prompt        - 可选，新的组合提示词（与角色同时为空表示直接引用基础场景）
    -e, --episode   - 集数（默认: 1）

示例:
    python scripts/update_stage.py -e 1 1 0 --prompt "图像1为背景：中央扶梯；图像2站在扶梯右侧，身体朝向扶梯，面部微侧向镜头。"
    python scripts/update_stage.py -e 1 1 0 --characters "陈书文" --stage-ref "现代商场/现代商场-白天-平视-晴-中央扶梯"
    python scripts/update_stage.py -e 1 1 0 --characters "" --prompt ""
"""

import argparse
import sys
from _common import (
    DEFAULT_PROJECT,
    DEFAULT_EPISODE,
    read_json,
    write_json,
    get_stage_json_path,
    validate_stage_ref,
    validate_character_ref,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="更新分镜 stage.json 中的场景定义",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("shot", type=int, help="分镜序号（从 1 开始）")
    parser.add_argument("index", type=int, help="要更新的条目索引（从 0 开始）")
    parser.add_argument("--stage-ref", type=str, default=None, help="新的基础场景完整标签")
    parser.add_argument("--characters", type=str, default=None, help="新的登场角色名（逗号分隔，最多2个）")
    parser.add_argument("--prompt", type=str, default=None, help="新的组合提示词")
    parser.add_argument("--project", "-p", type=str, default=DEFAULT_PROJECT, help=f"剧本项目名称（默认: {DEFAULT_PROJECT}）")
    parser.add_argument("--episode", "-e", type=int, default=DEFAULT_EPISODE, help=f"集数（默认: {DEFAULT_EPISODE}）")
    parser.add_argument("--project-root", type=str, default=None, help="项目根目录（默认当前目录）")
    return parser.parse_args()


def main():
    args = parse_args()
    project_name = args.project
    episode = args.episode
    project_root = args.project_root
    stage_path = get_stage_json_path(args.shot, project_name, episode, project_root)
    data = read_json(stage_path)

    if not data:
        print(f"⚠️  第{episode}集 分镜 {args.shot} 的 stage.json 为空，无法更新。", file=sys.stderr)
        sys.exit(1)

    if args.index < 0 or args.index >= len(data):
        print(f"❌ 索引越界: {args.index}，有效范围 0-{len(data) - 1}", file=sys.stderr)
        sys.exit(1)

    entry = data[args.index]
    changed = []

    if args.stage_ref is not None:
        if not validate_stage_ref(args.stage_ref, project_name, project_root):
            print(f"❌ 场景资产不存在: {args.stage_ref}", file=sys.stderr)
            sys.exit(1)
        entry["基础场景"] = args.stage_ref
        changed.append("基础场景")

    if args.characters is not None:
        characters = [c.strip() for c in args.characters.split(",") if c.strip()]
        if len(characters) > 2:
            print(f"❌ 角色数量不得超过 2 个（当前: {len(characters)}）。", file=sys.stderr)
            sys.exit(1)
        for ch in characters:
            if not validate_character_ref(ch, project_name, project_root):
                print(f"❌ 角色资产不存在: {ch}", file=sys.stderr)
                sys.exit(1)
        entry["登场角色"] = characters
        changed.append("登场角色")

    if args.prompt is not None:
        entry["prompt"] = args.prompt
        changed.append("prompt")

    if not changed:
        print("⚠️  未指定任何更新字段（使用 --help 查看可用选项）。", file=sys.stderr)
        sys.exit(1)

    # 更新后一致性校验：基础场景必填；角色与 prompt 同时为空=直接引用
    final_stage = (entry.get("基础场景") or "").strip()
    if not final_stage:
        print("❌ 基础场景不能为空。", file=sys.stderr)
        sys.exit(1)
    final_chars = entry.get("登场角色") or []
    if not isinstance(final_chars, list):
        print("❌ 登场角色应为数组。", file=sys.stderr)
        sys.exit(1)
    final_prompt = (entry.get("prompt") or "").strip()
    if len(final_chars) > 0 and not final_prompt:
        print("❌ 有登场角色时 prompt 不能为空。", file=sys.stderr)
        sys.exit(1)
    if len(final_chars) == 0 and not final_prompt:
        entry["prompt"] = ""
        entry["登场角色"] = []

    data[args.index] = entry
    write_json(stage_path, data)

    print(f"✅ 已更新第{episode}集 分镜 {args.shot} 的第 {args.index} 条场景定义:")
    print(f"   更新的字段: {', '.join(changed)}")


if __name__ == "__main__":
    main()
