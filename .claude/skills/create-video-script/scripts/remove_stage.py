#!/usr/bin/env python3
"""
从指定分镜的 stage.json 中移除一条场景定义（按索引）。

用法:
    python scripts/remove_stage.py <分镜序号> [索引]

参数:
    分镜序号    - 整数，从 1 开始
    索引        - 可选，要移除的条目索引（从 0 开始，默认移除最后一条）

示例:
    python scripts/remove_stage.py 1          # 移除分镜1的最后一条场景定义
    python scripts/remove_stage.py 1 0        # 移除分镜1的第一条场景定义
    python scripts/remove_stage.py 2 1        # 移除分镜2的第二条场景定义
"""

import argparse
import sys
from _common import DEFAULT_PROJECT, read_json, write_json, get_stage_json_path


def parse_args():
    parser = argparse.ArgumentParser(
        description="从分镜的 stage.json 中移除场景定义",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("shot", type=int, help="分镜序号（从 1 开始）")
    parser.add_argument("index", type=int, nargs="?", default=None, help="要移除的条目索引（从 0 开始，默认移除最后一条）")
    parser.add_argument("--project", "-p", type=str, default=DEFAULT_PROJECT, help=f"剧本项目名称（默认: {DEFAULT_PROJECT}）")
    parser.add_argument("--project-root", type=str, default=None, help="项目根目录（默认当前目录）")
    return parser.parse_args()


def main():
    args = parse_args()
    project_name = args.project
    project_root = args.project_root
    stage_path = get_stage_json_path(args.shot, project_name, project_root)
    data = read_json(stage_path)

    if not data:
        print(f"⚠️  分镜 {args.shot} 的 stage.json 为空，无需移除。", file=sys.stderr)
        sys.exit(1)

    idx = args.index if args.index is not None else len(data) - 1
    if idx < 0 or idx >= len(data):
        print(f"❌ 索引越界: {idx}，有效范围 0-{len(data) - 1}", file=sys.stderr)
        sys.exit(1)

    removed = data.pop(idx)
    write_json(stage_path, data)

    print(f"✅ 已移除分镜 {args.shot} 的第 {idx} 条场景定义:")
    print(f"   🎬 基础场景: {removed.get('基础场景', 'N/A')}")
    print(f"   👤 登场角色: {', '.join(removed.get('登场角色', []))}")
    print(f"   📄 剩余 {len(data)} 条")


if __name__ == "__main__":
    main()
