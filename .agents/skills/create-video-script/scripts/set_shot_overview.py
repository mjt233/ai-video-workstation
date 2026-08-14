#!/usr/bin/env python3
"""
创建或更新指定分镜的 overview.json。

用法:
    python scripts/set_shot_overview.py <分镜序号> [--title ...] [--beat ...] ...

参数:
    分镜序号          - 整数，从 1 开始
    --title           - 分镜标题
    --beat            - 叙事节拍
    --visual          - 画面描述
    --camera          - 镜头运动
    --duration        - 时长（秒，正整数，须 > 0）
    --mood            - 情绪基调
    -p, --project     - 剧本项目名称
    -e, --episode     - 集数（默认: 1）

示例:
    python scripts/set_shot_overview.py -p 古人在现代 -e 1 1 --title "书生初临" --duration 4
    python scripts/set_shot_overview.py -p 古人在现代 -e 1 1 --duration 5
    python scripts/set_shot_overview.py -p 古人在现代 -e 1 2 --beat "对话推进" --mood "紧张"
"""

import argparse
import sys
from _common import (
    DEFAULT_PROJECT,
    DEFAULT_EPISODE,
    DEFAULT_SHOT_DURATION,
    get_overview_json_path,
    get_scene_dir,
    normalize_shot_overview,
    read_json,
    write_json,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="创建或更新分镜 overview.json",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  %(prog)s -p 古人在现代 -e 1 1 --title "书生初临" --duration 4
  %(prog)s -p 古人在现代 -e 1 1 --duration 5
  %(prog)s -p 古人在现代 -e 1 2 --beat "对话推进" --mood "紧张"
        """,
    )
    parser.add_argument("shot", type=int, help="分镜序号（从 1 开始）")
    parser.add_argument("--title", type=str, default=None, help="分镜标题")
    parser.add_argument("--beat", type=str, default=None, help="叙事节拍")
    parser.add_argument("--visual", type=str, default=None, help="画面描述")
    parser.add_argument("--camera", type=str, default=None, help="镜头运动")
    parser.add_argument("--duration", type=int, default=None, help=f"时长（秒，正整数，默认 {DEFAULT_SHOT_DURATION}）")
    parser.add_argument("--mood", type=str, default=None, help="情绪基调")
    parser.add_argument("--project", "-p", type=str, default=DEFAULT_PROJECT, help=f"剧本项目名称（默认: {DEFAULT_PROJECT}）")
    parser.add_argument("--episode", "-e", type=int, default=DEFAULT_EPISODE, help=f"集数（默认: {DEFAULT_EPISODE}）")
    parser.add_argument("--project-root", type=str, default=None, help="项目根目录（默认当前目录）")
    return parser.parse_args()


def main():
    args = parse_args()
    project_name = args.project
    episode = args.episode
    project_root = args.project_root
    shot = args.shot

    if shot < 1:
        print("❌ 分镜序号须从 1 开始。", file=sys.stderr)
        sys.exit(1)

    updates = {
        "title": args.title,
        "beat": args.beat,
        "visual": args.visual,
        "camera": args.camera,
        "duration": args.duration,
        "mood": args.mood,
    }
    if all(v is None for v in updates.values()):
        print("❌ 请至少指定一个字段（--title / --beat / --visual / --camera / --duration / --mood）。", file=sys.stderr)
        sys.exit(1)

    if args.duration is not None and args.duration <= 0:
        print("❌ duration 必须是大于 0 的整数。", file=sys.stderr)
        sys.exit(1)

    overview_path = get_overview_json_path(shot, project_name, episode, project_root)
    scene_dir = get_scene_dir(shot, project_name, episode, project_root)
    scene_dir.mkdir(parents=True, exist_ok=True)

    if overview_path.exists():
        current = read_json(overview_path)
        if not isinstance(current, dict):
            print(f"⚠️  overview.json 不是对象，将重建: {overview_path}", file=sys.stderr)
            current = {}
    else:
        current = {}

    merged = dict(current)
    for key, value in updates.items():
        if value is not None:
            merged[key] = value

    data = normalize_shot_overview(merged)
    write_json(overview_path, data)

    print(f"📋 第{episode}集 分镜 {shot} overview.json 已更新")
    print(f"   标题: {data['title'] or '（空）'}")
    print(f"   时长: {data['duration']} 秒")


if __name__ == "__main__":
    main()
