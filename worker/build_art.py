#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把三版 ASCII 图从「唯一真相来源」生成到 worker/src/art.js。

来源：
  art_hd.txt      -> ART_HD      （用户贴的照片版，server.py 的默认）
  server.py 里的  -> ART_BLOCKS  （手绘方块版）
  ART_BLOCKS/ASCII -> ART_ASCII  （纯 ASCII 版）

为什么生成而不是手抄：这张图 9,000+ 字符，手抄进 JS 必然出错；
生成后由 worker/test_worker.mjs 逐字节比对 art_hd.txt，漂移会被抓住。
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import pathlib
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = HERE / "src" / "art.js"


def load_server_module():
    spec = importlib.util.spec_from_file_location("astra_server", ROOT / "server.py")
    if spec is None or spec.loader is None:
        raise SystemExit("[x] 无法加载 server.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def normalize(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").strip("\n")


def main() -> int:
    server = load_server_module()
    hd = normalize((ROOT / "art_hd.txt").read_text(encoding="utf-8")) if (ROOT / "art_hd.txt").exists() else ""
    blocks = normalize(server.ART_BLOCKS)
    ascii_art = normalize(server.ART_ASCII)

    arts = {"ART_HD": hd, "ART_BLOCKS": blocks, "ART_ASCII": ascii_art}
    lines = [
        "// 本文件由 worker/build_art.py 自动生成 —— 不要手改。",
        "// 改图请改 art_hd.txt（照片版）或 server.py（blocks/ascii），然后重跑：",
        "//   python worker/build_art.py",
        "",
    ]
    for name, value in arts.items():
        lines.append(f"export const {name} = {json.dumps(value, ensure_ascii=False)};")
        lines.append("")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8", newline="\n")

    print(f"[√] 已写入 {OUT}  ({OUT.stat().st_size:,} B)", flush=True)
    for name, value in arts.items():
        digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
        rows = value.count("\n") + 1 if value else 0
        print(f"    {name:<11} {len(value):>6,} 字符 / {rows:>3} 行 / sha256 {digest[:16]}…", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
