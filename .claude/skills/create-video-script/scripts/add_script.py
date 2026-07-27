#!/usr/bin/env python3
"""
在指定分镜的 script.json 中添加一条台词。

用法:
    python scripts/add_script.py <分镜序号> <角色名> <台词> [情绪]

参数:
    分镜序号    - 整数，从 1 开始
    角色名      - 台词所属角色名（必须在同一分镜 stage.json 的登场角色中声明）
    台词        - 台词文本内容
    情绪        - 可选，情绪状态（默认: "平静"）
    -e, --episode - 集数（默认: 1）

示例:
    python scripts/add_script.py -e 1 1 "陈书文" "你好，请问这里有人吗？" "期待"
    python scripts/add_script.py -e 1 1 "现代女孩" "没人，你坐吧。" "随意"
    python scripts/add_script.py -e 1 2 "陈书文" "谢谢。" "感激"
"""

import argparse
import sys
from _common import DEFAULT_PROJECT, DEFAULT_EPISODE, read_json, write_json, get_stage_json_path, get_script_json_path


def parse_args():
    parser = argparse.ArgumentParser(
        description="在分镜的 script.json 中添加台词",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("shot", type=int, help="分镜序号（从 1 开始）")
    parser.add_argument("character", type=str, help="台词所属角色名")
    parser.add_argument("line", type=str, help="台词内容")
    parser.add_argument("emotion", type=str, nargs="?", default="平静", help="情绪状态（默认: 平静）")
    parser.add_argument("--project", "-p", type=str, default=DEFAULT_PROJECT, help=f"剧本项目名称（默认: {DEFAULT_PROJECT}）")
    parser.add_argument("--episode", "-e", type=int, default=DEFAULT_EPISODE, help=f"集数（默认: {DEFAULT_EPISODE}）")
    parser.add_argument("--project-root", type=str, default=None, help="项目根目录（默认当前目录）")
    parser.add_argument("--skip-verify", action="store_true", help="跳过角色存在性校验")
    return parser.parse_args()


def main():
    args = parse_args()
    project_name = args.project
    episode = args.episode
    project_root = args.project_root

    # 校验角色是否在 stage.json 的登场角色中声明
    if not args.skip_verify:
        stage_path = get_stage_json_path(args.shot, project_name, episode, project_root)
        stage_data = read_json(stage_path)
        registered_chars = set()
        for entry in stage_data:
            registered_chars.update(entry.get("登场角色", []))
        if args.character not in registered_chars:
            print(
                f"❌ 角色 '{args.character}' 未在第{episode}集分镜 {args.shot} 的 stage.json 登场角色中声明。\n"
                f"   已注册角色: {', '.join(registered_chars) if registered_chars else '（无）'}\n"
                f"   如需跳过校验请使用 --skip-verify",
                file=sys.stderr,
            )
            sys.exit(1)

    # 构建台词条目
    entry = {
        "角色名": args.character,
        "台词": args.line,
        "情绪": args.emotion,
    }

    # 读取现有 script.json，追加新条目
    script_path = get_script_json_path(args.shot, project_name, episode, project_root)
    data = read_json(script_path)
    data.append(entry)
    write_json(script_path, data)

    print(f"✅ 第{episode}集 分镜 {args.shot} 已添加台词（共 {len(data)} 条）")
    print(f"   👤 {args.character}（{args.emotion}）: {args.line}")


if __name__ == "__main__":
    main()
