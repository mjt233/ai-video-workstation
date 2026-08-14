#!/usr/bin/env python3
"""
将分镜 overview.md 迁移为 overview.json，并删除旧 md。

用法:
    python scripts/migrate_shot_overview.py                 # 迁移所有项目
    python scripts/migrate_shot_overview.py -p 古人在现代   # 指定项目
    python scripts/migrate_shot_overview.py --dry-run       # 仅预览
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from _common import (
    DEFAULT_SHOT_DURATION,
    get_project_dir,
    list_episodes,
    list_projects,
    normalize_shot_overview,
    write_json,
)


SECTION_MAP = {
    "叙事节拍": "beat",
    "画面描述": "visual",
    "镜头运动": "camera",
    "时长参考": "_duration_text",
    "情绪基调": "mood",
}


def parse_args():
    parser = argparse.ArgumentParser(description="迁移分镜 overview.md → overview.json")
    parser.add_argument("--project", "-p", type=str, default=None, help="剧本项目名称（默认全部项目）")
    parser.add_argument("--project-root", type=str, default=None, help="项目根目录（默认当前目录）")
    parser.add_argument("--dry-run", action="store_true", help="仅预览，不写文件")
    return parser.parse_args()


def extract_title(text: str) -> str:
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("#"):
            continue
        heading = re.sub(r"^#+\s*", "", line).strip()
        # 兼容: 第1集 分镜 1 - 标题 / 分镜 1 - 标题
        m = re.search(r"分镜\s*\d+\s*[-—–:：]\s*(.+)$", heading)
        if m:
            return m.group(1).strip()
        m = re.search(r"[-—–:：]\s*(.+)$", heading)
        if m:
            return m.group(1).strip()
        return heading
    return ""


def extract_sections(text: str) -> dict[str, str]:
    # 去掉 YAML frontmatter
    body = re.sub(r"^---\s*\n.*?\n---\s*\n?", "", text, count=1, flags=re.S).strip()
    sections: dict[str, str] = {}
    current: str | None = None
    buf: list[str] = []

    def flush():
        nonlocal current, buf
        if current is not None:
            sections[current] = "\n".join(buf).strip()
        current = None
        buf = []

    for line in body.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            flush()
            current = m.group(1).strip()
            continue
        if current is not None:
            buf.append(line)
    flush()
    return sections


def parse_duration(text: str) -> int:
    """从「时长参考」文本提取秒数，结果强制为正整数。"""
    if not text:
        return DEFAULT_SHOT_DURATION
    m = re.search(r"(\d+(?:\.\d+)?)\s*秒", text)
    if not m:
        m = re.search(r"(\d+(?:\.\d+)?)", text)
    if not m:
        return DEFAULT_SHOT_DURATION
    value = float(m.group(1))
    if value <= 0:
        return DEFAULT_SHOT_DURATION
    # 迁移时四舍五入为整数秒，至少 1
    return max(1, int(round(value)))


def md_to_overview(md_text: str) -> dict:
    sections = extract_sections(md_text)
    data: dict = {
        "title": extract_title(md_text),
        "beat": "",
        "visual": "",
        "camera": "",
        "duration": DEFAULT_SHOT_DURATION,
        "mood": "",
    }
    for zh, en in SECTION_MAP.items():
        raw = sections.get(zh, "")
        if en == "_duration_text":
            data["duration"] = parse_duration(raw)
        else:
            data[en] = raw
    return normalize_shot_overview(data)


def migrate_shot_dir(shot_dir: Path, dry_run: bool) -> str:
    md_path = shot_dir / "overview.md"
    json_path = shot_dir / "overview.json"
    rel = str(shot_dir)

    if json_path.exists() and not md_path.exists():
        return f"skip-ok {rel}"
    if json_path.exists() and md_path.exists():
        if dry_run:
            return f"would-delete-md {rel}"
        md_path.unlink()
        return f"deleted-md {rel}"
    if not md_path.exists():
        # 无 md 也无 json：补默认 json
        data = normalize_shot_overview({})
        if dry_run:
            return f"would-create-default {rel}"
        write_json(json_path, data)
        return f"created-default {rel}"

    text = md_path.read_text(encoding="utf-8")
    data = md_to_overview(text)
    if dry_run:
        return f"would-migrate {rel} duration={data['duration']} title={data['title']!r}"
    write_json(json_path, data)
    md_path.unlink()
    return f"migrated {rel} duration={data['duration']} title={data['title']!r}"


def iter_shot_dirs(project_name: str, project_root: str | None):
    for episode in list_episodes(project_name, project_root):
        scene_root = get_project_dir(project_name, project_root) / "prompt" / "scene" / str(episode)
        if not scene_root.exists():
            continue
        for d in sorted(scene_root.iterdir(), key=lambda p: (not p.name.isdigit(), int(p.name) if p.name.isdigit() else p.name)):
            if d.is_dir() and d.name.isdigit():
                yield d


def main():
    args = parse_args()
    projects = [args.project] if args.project else list_projects(args.project_root)
    if not projects:
        print("⚠️  未找到任何项目。", file=sys.stderr)
        sys.exit(1)

    total = 0
    for project in projects:
        print(f"\n📂 项目: {project}")
        for shot_dir in iter_shot_dirs(project, args.project_root):
            result = migrate_shot_dir(shot_dir, args.dry_run)
            print(f"  {result}")
            total += 1

    mode = "预览" if args.dry_run else "完成"
    print(f"\n✅ 迁移{mode}：处理 {total} 个分镜目录")


if __name__ == "__main__":
    main()
