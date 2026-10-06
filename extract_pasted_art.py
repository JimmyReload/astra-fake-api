#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从本机 DSH 会话日志里，把用户粘贴的那张 ASCII 图原文抠出来存成 art_hd.txt。

为什么要这么绕：手抄 85 行、130 列的符号图必然出错，直接从日志里提取才字节精确。
日志：~/.dsh/sessions/<workspace-slug>/<session-id>/session.v3.jsonl.zstd（zstd 多帧）
"""

from __future__ import annotations

import glob
import json
import os
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

SESSION_ID = "session-88d4ca5c-3875-4fc4-a300-e64a25a865d3"
MARKER = "@" * 40          # 那张图里成片的长 @ 串，足够独特
OUT = Path(__file__).resolve().parent / "art_hd.txt"
PREVIEW = Path(__file__).resolve().parent / "art_hd_preview.png"


def read_log(path: Path) -> str:
    try:
        import zstandard  # type: ignore
    except ImportError:
        print("[x] 需要 zstandard：python -m pip install zstandard", flush=True)
        raise SystemExit(2)
    with open(path, "rb") as fh:
        reader = zstandard.ZstdDecompressor().stream_reader(fh, read_across_frames=True)
        return reader.read().decode("utf-8", "replace")


def walk_strings(node, trail=""):
    if isinstance(node, str):
        yield trail, node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from walk_strings(v, f"{trail}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_strings(v, f"{trail}[{i}]")


def main() -> int:
    pattern = os.path.expanduser(f"~/.dsh/sessions/*/{SESSION_ID}/session.v3.jsonl.zstd")
    logs = sorted(glob.glob(pattern))
    print(f"候选日志 {len(logs)} 个：", flush=True)
    for p in logs:
        print(f"  {p}  ({os.path.getsize(p):,} B)", flush=True)
    if not logs:
        print("[x] 没找到本会话日志", flush=True)
        return 2

    best: tuple[str, str] | None = None
    for log_path in logs:
        text = read_log(Path(log_path))
        hits = 0
        for trail, value in walk_strings(json.loads("[" + ",".join(
                line for line in text.splitlines() if line.strip()) + "]")):
            if MARKER in value and len(value) > 2000:
                hits += 1
                if best is None or len(value) > len(best[1]):
                    best = (f"{Path(log_path).name}:{trail}", value)
        print(f"  {Path(log_path).parent.parent.name}/{log_path.split(os.sep)[-2]}: "
              f"解压 {len(text):,} 字符, 命中候选 {hits} 条", flush=True)

    if best is None:
        print("[x] 日志里没找到那张图", flush=True)
        return 2

    where, art = best
    art = art.replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    lines = art.split("\n")
    print(f"\n命中位置：{where}", flush=True)
    print(f"原始末尾 3 行：{lines[-3:]!r}", flush=True)

    # 用户消息末尾还跟了个孤立的 "1"，那不属于图
    if lines and lines[-1].strip() == "1":
        lines.pop()
        print("[i] 已剥掉图后面那个孤立的 '1'", flush=True)

    widths = [len(x) for x in lines]
    print(f"图：{len(lines)} 行, 最宽 {max(widths)} 列, "
          f"总 {sum(widths):,} 字符, 非空行 {sum(1 for x in lines if x.strip())}", flush=True)
    print(f"首行：{lines[0][:60]}...", flush=True)
    print(f"末行：{lines[-1][:60]}...", flush=True)

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"[√] 已写入 {OUT}  ({OUT.stat().st_size:,} B)", flush=True)

    # 顺手渲染一张 PNG 预览，方便肉眼看清楚这图画的是什么
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print("[i] 没有 PIL，跳过预览图", flush=True)
        return 0

    font = None
    for cand in (r"C:\Windows\Fonts\consola.ttf", r"C:\Windows\Fonts\cour.ttf",
                 r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if os.path.exists(cand):
            try:
                font = ImageFont.truetype(cand, 14)
                print(f"[i] 预览字体：{cand}", flush=True)
                break
            except OSError:
                continue
    if font is None:
        print("[i] 找不到可用字体，跳过预览图", flush=True)
        return 0

    cw, ch = font.getbbox("M")[2], 16
    img = Image.new("L", (max(widths) * cw + 20, len(lines) * ch + 20), 255)
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        # 越密的字符画得越黑（ASCII 图本来就是靠密度成像）
        draw.text((10, 10 + i * ch), line, font=font, fill=0)
    img.save(PREVIEW)
    print(f"[√] 预览图 {PREVIEW}  ({PREVIEW.stat().st_size:,} B, {img.size[0]}x{img.size[1]})", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
