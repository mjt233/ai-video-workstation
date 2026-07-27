#!/usr/bin/env python3
"""
在指定分镜的 stage.json 中添加一条场景定义。

用法:
    python scripts/add_stage.py <分镜序号> <基础场景标签> <角色名1[,角色名2]> <prompt>

参数:
    分镜序号        - 整数，从 1 开始
    基础场景标签    - 场景完整标签，如 "现代商场/现代商场-白天-平视-晴-中央扶梯"
    角色名          - 逗号分隔的角色名，最多2个，如 "陈书文" 或 "陈书文,现代女孩"
    prompt          - 组合提示词，使用 "图像1" 代表场景、"图像2/3" 代表角色

示例:
    python scripts/add_stage.py 1 "现代商场/现代商场-白天-平视-晴-中央扶梯" "陈书文" "图像1为背景：现代商场中央扶梯；图像2为陈书文：年轻女性...；陈书文在扶梯前驻足张望。镜头固定"
    python scripts/add_stage.py 2 "现代商场/现代商场-白天-平视-晴-奶茶店前" "陈书文,现代女孩" "图像1...；图像2为陈书文...；图像3为现代女孩..."
"""

import argparse
import sys
from _common import read_json, write_json, get_stage_json_path, validate_stage_ref, validate_character_ref


def parse_args():
    parser = argparse.ArgumentParser(
        description="在分镜的 stage.json 中添加场景定义",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  %(prog)s 1 "现代商场/现代商场-白天-平视-晴-中央扶梯" "陈书文" "图像1为背景..."
  %(prog)s 2 "现代商场/现代商场-白天-平视-晴-奶茶店前" "陈书文,现代女孩" "图像1..."
        """,
    )
    parser.add_argument("shot", type=int, help="分镜序号（从 1 开始）")
    parser.add_argument("stage_ref", type=str, help="基础场景完整标签，如 现代商场/现代商场-白天-平视-晴-中央扶梯")
    parser.add_argument("characters", type=str, help="登场角色名，多个用逗号分隔（最多2个）")
    parser.add_argument("prompt", type=str, help="组合提示词（使用 图像1/图像2/图像3 标识场景与角色）")
    parser.add_argument("--project-dir", type=str, default=None, help="项目根目录（默认当前目录）")
    return parser.parse_args()


def main():
    args = parse_args()
    project_dir = args.project_dir

    # 校验角色数量
    characters = [c.strip() for c in args.characters.split(",") if c.strip()]
    if len(characters) == 0:
        print("❌ 必须指定至少一个角色。", file=sys.stderr)
        sys.exit(1)
    if len(characters) > 2:
        print("❌ 角色数量不得超过 2 个（当前: {}）。".format(len(characters)), file=sys.stderr)
        sys.exit(1)

    # 校验场景资产是否存在
    if not validate_stage_ref(args.stage_ref, project_dir):
        print("❌ 场景资产不存在，请先创建场景资产文件。", file=sys.stderr)
        sys.exit(1)

    # 校验角色资产是否存在
    for ch in characters:
        if not validate_character_ref(ch, project_dir):
            print("❌ 角色资产不存在，请先创建角色资产: {}".format(ch), file=sys.stderr)
            sys.exit(1)

    # 构建场景条目
    entry = {
        "基础场景": args.stage_ref,
        "登场角色": characters,
        "prompt": args.prompt,
    }

    # 读取现有 stage.json，追加新条目
    stage_path = get_stage_json_path(args.shot, project_dir)
    data = read_json(stage_path)
    data.append(entry)
    write_json(stage_path, data)

    print(f"📋 分镜 {args.shot} 已添加场景定义（共 {len(data)} 条）")
    print(f"   🎬 基础场景: {args.stage_ref}")
    print(f"   👤 登场角色: {', '.join(characters)}")


if __name__ == "__main__":
    main()
