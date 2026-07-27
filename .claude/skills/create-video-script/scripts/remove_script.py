#!/usr/bin/env python3
"""
从指定分镜的 script.json 中移除一条台词（按索引）。

用法:
    python scripts/remove_script.py <分镜序号> [索引]

参数:
    分镜序号    - 整数，从 1 开始
    索引        - 可选，要移除的台词索引（从 0 开始，默认移除最后一条）

示例:
    python scripts/remove_script.py 1          # 移除分镜1的最后一条台词
    python scripts/remove_script.py 1 0        # 移除分镜1的第一条台词
    python scripts/remove_script.py 2 1        # 移除分镜2的第二条台词
"""

import argparse
import sys
from _common import DEFAULT_PROJECT, read_json, write_json, get_script_json_path


def parse_args():
    parser = argparse.ArgumentParser(
        description="从分镜的 script.json 中移除台词",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("shot", type=int, help="分镜序号（从 1 开始）")
    parser.add_argument("index", type=int, nargs="?", default=None, help="要移除的台词索引（从 0 开始，默认移除最后一条）")
    parser.add_argument("--project", "-p", type=str, default=DEFAULT_PROJECT, help=f"剧本项目名称（默认: {DEFAULT_PROJECT}）")
    parser.add_argument("--project-root", type=str, default=None, help="项目根目录（默认当前目录）")
    return parser.parse_args()


def main():
    args = parse_args()
    project_name = args.project
    project_root = args.project_root
    script_path = get_script_json_path(args.shot, project_name, project_root)
    data = read_json(script_path)

    if not data:
        print(f"⚠️  分镜 {args.shot} 的 script.json 为空，无需移除。", file=sys.stderr)
        sys.exit(1)

    idx = args.index if args.index is not None else len(data) - 1
    if idx < 0 or idx >= len(data):
        print(f"❌ 索引越界: {idx}，有效范围 0-{len(data) - 1}", file=sys.stderr)
        sys.exit(1)

    removed = data.pop(idx)
    write_json(script_path, data)

    print(f"✅ 已移除分镜 {args.shot} 的第 {idx} 条台词:")
    print(f"   👤 {removed.get('角色名', 'N/A')}（{removed.get('情绪', 'N/A')}）: {removed.get('台词', 'N/A')}")
    print(f"   📄 剩余 {len(data)} 条")


if __name__ == "__main__":
    main()
