#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
对着已经在跑的假 API 真打一发，把响应正文的头几行打出来当证据。

  python demo_request.py                      # 默认打 /v1/chat/completions（非流式）
  python demo_request.py --stream             # 流式，逐帧计数
  python demo_request.py --path /v1/messages  # 换 Anthropic 外形
  python demo_request.py --path /i/am/nothing # 不存在也得给奶龙

v1.1.0 起服务有鉴权：key 从 `--key` 或环境变量 NAILONG_API_KEY 取；本地起服务时
若没带 `--api-key`，服务端不校验，这时不传 key 也能用。401/404 会原样把错误体打出来。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
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
    ap.add_argument("--model", default="gpt-6-astra")
    ap.add_argument("--key", default=os.environ.get("NAILONG_API_KEY", ""),
                    help="API key（也可用环境变量 NAILONG_API_KEY；本地无鉴权服务可不填）")
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

    headers = {"Content-Type": "application/json"}
    if args.key:
        headers["Authorization"] = f"Bearer {args.key}"

    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers=headers, method="POST")
    print(f"POST {url}  stream={args.stream}  model={args.model}  "
          f"key={'有' if args.key else '未带'}", flush=True)
    try:
        resp = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        print(f"HTTP {exc.code}  <- 服务端把闸门关上了，错误体如下：", flush=True)
        print("-" * 70, flush=True)
        print(body[:800], flush=True)
        return 1

    with resp:
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
