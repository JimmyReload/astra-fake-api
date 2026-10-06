#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
对着已经在跑的假 API 真打一发，把响应正文的头几行打出来当证据。

  python demo_request.py                      # 默认打 /v1/chat/completions（非流式）
  python demo_request.py --stream             # 流式，逐帧计数
  python demo_request.py --path /v1/messages  # 换 Anthropic 外形
  python demo_request.py --path /i/am/nothing # 不存在也得给奶龙
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass


def first_lines(text: str, n: int = 9) -> str:
    lines = text.split("\n")
    head = "\n".join(lines[:n])
    if len(lines) > n:
        head += f"\n... （还有 {len(lines) - n} 行，共 {len(lines)} 行 / {len(text):,} 字符）"
    return head


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--path", default="/v1/chat/completions")
    ap.add_argument("--model", default="astra-1")
    ap.add_argument("--stream", action="store_true")
    ap.add_argument("--head", type=int, default=9)
    args = ap.parse_args()

    url = f"http://127.0.0.1:{args.port}{args.path}"
    if args.path.startswith("/v1/messages"):
        payload = {"model": args.model, "max_tokens": 1024,
                   "messages": [{"role": "user", "content": "你是奶龙吗"}],
                   "stream": args.stream}
    else:
        payload = {"model": args.model, "messages": [{"role": "user", "content": "你是奶龙吗"}],
                   "stream": args.stream}

    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer sk-fake"},
        method="POST",
    )
    print(f"POST {url}  stream={args.stream}", flush=True)
    with urllib.request.urlopen(req, timeout=30) as resp:
        print(f"HTTP {resp.status}  Content-Type={resp.headers.get('Content-Type')}  "
              f"X-Nailong={resp.headers.get('X-Nailong')}", flush=True)

        if not args.stream:
            raw = resp.read().decode("utf-8")
            try:
                obj = json.loads(raw)
                if "choices" in obj:
                    text = obj["choices"][0]["message"]["content"]
                elif "output_text" in obj:
                    text = obj["output_text"]
                elif "content" in obj and isinstance(obj["content"], list):
                    text = obj["content"][0]["text"]
                else:
                    text = raw
            except json.JSONDecodeError:
                text = raw
            print("-" * 70, flush=True)
            print(first_lines(text, args.head), flush=True)
            return 0

        frames, chars, done = 0, 0, False
        for line in resp:
            s = line.decode("utf-8").rstrip("\r\n")
            if s.startswith("data: "):
                frames += 1
                payload_str = s[6:]
                if payload_str == "[DONE]":
                    done = True
                    continue
                try:
                    obj = json.loads(payload_str)
                except json.JSONDecodeError:
                    continue
                if "choices" in obj:
                    for ch in obj["choices"]:
                        chars += len((ch.get("delta") or {}).get("content") or "")
                elif obj.get("type") == "response.output_text.delta":
                    chars += len(obj.get("delta", ""))
                elif obj.get("type") == "content_block_delta":
                    chars += len((obj.get("delta") or {}).get("text") or "")
        print("-" * 70, flush=True)
        print(f"流式：{frames} 个 data 帧，正文累计 {chars:,} 字符，[DONE]={'有' if done else '无'}",
              flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
