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
    --characters    - 可选，新的登场角色名（逗号分隔，最多2个）
    --prompt        - 可选，新的组合提示词

示例:
    python scripts/update_stage.py 1 0 --prompt "图像1为背景：...；图像2为陈书文：..."
    python scripts/update_stage.py 1 0 --characters "陈书文" --stage-ref "现代商场/现代商场-白天-平视-晴-中央扶梯"
"""

import argparse
import sys
from _common import read_json, write_json, get_stage_json_path, validate_stage_ref, validate_character_ref


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
    parser.add_argument("--project-dir", type=str, default=None, help="项目根目录（默认当前目录）")
    return parser.parse_args()


def main():
    args = parse_args()
    project_dir = args.project_dir
    stage_path = get_stage_json_path(args.shot, project_dir)
    data = read_json(stage_path)

    if not data:
        print(f"⚠️  分镜 {args.shot} 的 stage.json 为空，无法更新。", file=sys.stderr)
        sys.exit(1)

    if args.index < 0 or args.index >= len(data):
        print(f"❌ 索引越界: {args.index}，有效范围 0-{len(data) - 1}", file=sys.stderr)
        sys.exit(1)

    entry = data[args.index]
    changed = []

    if args.stage_ref is not None:
        if not validate_stage_ref(args.stage_ref, project_dir):
            print(f"❌ 场景资产不存在: {args.stage_ref}", file=sys.stderr)
            sys.exit(1)
        entry["基础场景"] = args.stage_ref
        changed.append("基础场景")

    if args.characters is not None:
        characters = [c.strip() for c in args.characters.split(",") if c.strip()]
        if len(characters) == 0:
            print("❌ 必须指定至少一个角色。", file=sys.stderr)
            sys.exit(1)
        if len(characters) > 2:
            print(f"❌ 角色数量不得超过 2 个（当前: {len(characters)}）。", file=sys.stderr)
            sys.exit(1)
        for ch in characters:
            if not validate_character_ref(ch, project_dir):
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

    data[args.index] = entry
    write_json(stage_path, data)

    print(f"✅ 已更新分镜 {args.shot} 的第 {args.index} 条场景定义:")
    print(f"   更新的字段: {', '.join(changed)}")


if __name__ == "__main__":
    main()
