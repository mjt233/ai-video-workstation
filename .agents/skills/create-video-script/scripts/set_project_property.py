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
    python scripts/set_project_property.py --project "AI的第一天" width 1080
    python scripts/set_project_property.py --project "AI的第一天" height 1920
    python scripts/set_project_property.py --project "AI的第一天" aspectRatio "9:16"
"""

import argparse
import sys
from _common import (
    get_project_dir,
    read_project_config,
    write_project_config,
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

    key, value = args.key, args.value

    # 校验 key/value 非空
    if not key.strip():
        print("❌ key 不能为空", file=sys.stderr)
        sys.exit(1)

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
    # 自动将纯数字字符串转为整数，其他保持字符串
    try:
        parsed = int(value)
    except ValueError:
        parsed = value
    config = read_project_config(project_name, project_root)
    config[key] = parsed
    write_project_config(project_name, config, project_root)

    print(f"📝 project.json 已更新: {key} = {value}")


if __name__ == "__main__":
    main()
