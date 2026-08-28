#!/usr/bin/env python3
"""
在指定分镜的 stage.json 中添加一条场景定义。

用法:
    python scripts/add_stage.py <分镜序号> <基础场景标签> <角色名1[,角色名2]|""> <prompt|"">

参数:
    分镜序号        - 整数，从 1 开始
    基础场景标签    - 必填，场景引用如 "现代商场/中央扶梯"，或关键字 "prev"（同集上一分镜最后场景，仅直接引用）
    角色名          - 逗号分隔的角色名，最多2个；传空字符串 "" 表示无登场角色
    prompt          - 组合提示词；与角色同时为空时表示直接引用基础场景；prev 时必须为空
    -e, --episode   - 集数（默认: 1）

示例:
    python scripts/add_stage.py -e 1 1 "现代商场/中央扶梯" "陈书文" "图像1为背景：现代商场中央扶梯；图像2站在中央扶梯右侧，身体朝向扶梯，面部微侧向镜头，驻足张望。"
    python scripts/add_stage.py -e 1 2 "现代商场/奶茶店前" "陈书文,现代女孩" "图像1为背景：奶茶店前；图像2站在柜台前偏左，身体朝向图像3，面部朝向图像3；图像3站在图像2右侧约一步、靠近柜台，身体朝向图像2，面部朝向图像2。"
    python scripts/add_stage.py -e 1 3 "现代商场/中央扶梯" "" ""
    python scripts/add_stage.py -e 1 2 prev "" ""
"""

import argparse
import sys
from _common import (
    DEFAULT_PROJECT,
    DEFAULT_EPISODE,
    PREV_STAGE_REF,
    is_prev_stage_ref,
    read_json,
    write_json,
    get_stage_json_path,
    validate_stage_ref,
    validate_character_ref,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="在分镜的 stage.json 中添加场景定义",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  %(prog)s -e 1 1 "现代商场/中央扶梯" "陈书文" "图像1为背景..."
  %(prog)s -e 1 2 "现代商场/奶茶店前" "陈书文,现代女孩" "图像1..."
  %(prog)s -e 1 3 "现代商场/中央扶梯" "" ""
        """,
    )
    parser.add_argument("shot", type=int, help="分镜序号（从 1 开始）")
    parser.add_argument(
        "stage_ref",
        type=str,
        help="基础场景完整标签（必填），如 现代商场/...；或关键字 prev（上一分镜最后场景，仅直接引用）",
    )
    parser.add_argument("characters", type=str, help="登场角色名，多个用逗号分隔（最多2个）；空字符串表示无角色")
    parser.add_argument("prompt", type=str, help="组合提示词；与角色同时为空时表示直接引用基础场景；prev 时必须为空")
    parser.add_argument("--project", "-p", type=str, default=DEFAULT_PROJECT, help=f"剧本项目名称（默认: {DEFAULT_PROJECT}）")
    parser.add_argument("--episode", "-e", type=int, default=DEFAULT_EPISODE, help=f"集数（默认: {DEFAULT_EPISODE}）")
    parser.add_argument("--project-root", type=str, default=None, help="项目根目录（默认当前目录）")
    return parser.parse_args()


def main():
    args = parse_args()
    project_name = args.project
    episode = args.episode
    project_root = args.project_root

    stage_ref = (args.stage_ref or "").strip()
    if not stage_ref:
        print("❌ 基础场景不能为空。", file=sys.stderr)
        sys.exit(1)

    # 校验角色数量
    characters = [c.strip() for c in args.characters.split(",") if c.strip()]
    if len(characters) > 2:
        print("❌ 角色数量不得超过 2 个（当前: {}）。".format(len(characters)), file=sys.stderr)
        sys.exit(1)

    prompt = args.prompt or ""
    # 直接引用模式：角色与 prompt 同时为空
    is_direct_ref = len(characters) == 0 and not prompt.strip()
    if is_prev_stage_ref(stage_ref):
        stage_ref = PREV_STAGE_REF
        if not is_direct_ref:
            print("❌ 基础场景为 prev 时仅支持直接引用（登场角色与 prompt 必须为空）。", file=sys.stderr)
            sys.exit(1)
    elif len(characters) > 0 and not prompt.strip():
        print("❌ 有登场角色时 prompt 不能为空。", file=sys.stderr)
        sys.exit(1)

    # 校验场景资产 / prev 上下文
    if not validate_stage_ref(
        stage_ref,
        project_name,
        project_root,
        shot_number=args.shot,
        episode=episode,
    ):
        if is_prev_stage_ref(stage_ref):
            print("❌ prev 引用无效：请确认当前分镜 > 1 且上一分镜 stage.json 非空。", file=sys.stderr)
        else:
            print("❌ 场景资产不存在，请先创建场景资产文件。", file=sys.stderr)
        sys.exit(1)

    # 校验角色资产是否存在
    for ch in characters:
        if not validate_character_ref(ch, project_name, project_root):
            print("❌ 角色资产不存在，请先创建角色资产: {}".format(ch), file=sys.stderr)
            sys.exit(1)

    # 构建场景条目
    entry = {
        "基础场景": stage_ref,
        "登场角色": characters,
        "prompt": "" if is_direct_ref else prompt,
    }

    # 读取现有 stage.json，追加新条目
    stage_path = get_stage_json_path(args.shot, project_name, episode, project_root)
    data = read_json(stage_path)
    data.append(entry)
    write_json(stage_path, data)

    print(f"📋 第{episode}集 分镜 {args.shot} 已添加场景定义（共 {len(data)} 条）")
    print(f"   🎬 基础场景: {stage_ref}")
    if is_prev_stage_ref(stage_ref):
        print("   📎 模式: 直接引用上一分镜最后场景（prev）")
    elif is_direct_ref:
        print("   📎 模式: 直接引用基础场景（无角色合成）")
    else:
        print(f"   👤 登场角色: {', '.join(characters)}")


if __name__ == "__main__":
    main()
