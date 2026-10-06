#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
独立验收：把 astra-fake-api 起起来，用真实的 HTTP 调用逐条验证
「任何调用都只会返回一张奶龙捧腹大笑的 ASCII 画」。

判据刻意自己算，不 import server.py 的任何常量（否则两边同错还判绿）：
  * HD 版内容 = 独立直读 art_hd.txt 的字节（验证的是「传输是否原样」）
  * blocks 版的标记字符串在两个文件里各自硬编码
  * 流式拼接结果必须与同一包装盒里的非流式内容逐字符相同（证明没漏帧、没截断）
  * 端口先探测，拒绝用残留旧进程冒充新服务（Windows 上 SO_REUSEADDR 会双绑）
"""

from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

HERE = Path(__file__).resolve().parent
PORT = 8791
BASE = f"http://127.0.0.1:{PORT}"

BLOCK_MARK_A = "HA  HA  HA"
BLOCK_MARK_B = "捧着肚子"
HD_MIN_LINES = 60

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"   [{detail}]" if detail else ""), flush=True)


def post_json(path: str, payload, timeout: float = 25.0) -> tuple[int, dict]:
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": "Bearer sk-fake"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def get_text(path: str, timeout: float = 25.0) -> tuple[int, str]:
    with urllib.request.urlopen(BASE + path, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8")


def delete_text(path: str, timeout: float = 25.0) -> tuple[int, str]:
    req = urllib.request.Request(BASE + path, data=b"x=1", method="DELETE")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8")


def options_text(path: str, timeout: float = 25.0) -> tuple[int, str]:
    req = urllib.request.Request(BASE + path, method="OPTIONS")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8")


def collect_sse(path: str, payload: dict, timeout: float = 40.0) -> tuple[list[str], list[str]]:
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        method="POST",
    )
    events: list[str] = []
    datas: list[str] = []
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        for raw in resp:
            line = raw.decode("utf-8").rstrip("\r\n")
            if line.startswith("event: "):
                events.append(line[7:])
            elif line.startswith("data: "):
                datas.append(line[6:])
    return events, datas


def sse_text(datas: list[str], kind: str) -> str:
    out = []
    for d in datas:
        if d == "[DONE]":
            continue
        try:
            obj = json.loads(d)
        except Exception:
            continue
        if kind == "chat":
            for ch in obj.get("choices") or []:
                piece = (ch.get("delta") or {}).get("content")
                if piece:
                    out.append(piece)
        elif kind == "responses":
            if obj.get("type") == "response.output_text.delta":
                out.append(obj.get("delta", ""))
        elif kind == "anthropic":
            if obj.get("type") == "content_block_delta":
                out.append((obj.get("delta") or {}).get("text") or "")
    return "".join(out)


def wait_port(port: int, seconds: float = 25.0) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        with socket.socket() as s:
            s.settimeout(0.4)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.2)
    return False


def main() -> int:
    hd_file = HERE / "art_hd.txt"
    if not hd_file.exists():
        print("[x] 缺 art_hd.txt（先跑 extract_pasted_art.py）", flush=True)
        return 2
    hd = hd_file.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    hd_lines = hd.count("\n") + 1
    check("art_hd.txt 自检（够大、行数够多）", hd_lines >= HD_MIN_LINES and len(hd) > 3000,
          f"{hd_lines} 行 / {len(hd):,} 字符")

    with socket.socket() as s:
        s.settimeout(0.5)
        if s.connect_ex(("127.0.0.1", PORT)) == 0:
            print(f"[x] 端口 {PORT} 已被占用，拒绝用可能残留的旧服务冒充新服务。", flush=True)
            return 2

    log_path = HERE / "_smoke_server.log"
    log = open(log_path, "w", encoding="utf-8", errors="replace")
    proc = subprocess.Popen(
        [sys.executable, str(HERE / "server.py"), "--host", "127.0.0.1", "--port", str(PORT)],
        stdout=log, stderr=subprocess.STDOUT, cwd=str(HERE),
    )

    try:
        if not wait_port(PORT, 25.0):
            print("[x] 服务没起来，见 _smoke_server.log", flush=True)
            return 2

        # 1. 常规 chat.completions（默认 = HD 照片版）
        status, body = post_json("/v1/chat/completions", {
            "model": "astra-1", "messages": [{"role": "user", "content": "你好"}],
        })
        content = body["choices"][0]["message"]["content"]
        check("chat.completions 非流式原样回图", status == 200 and content == hd,
              f"{len(content):,}B vs 文件 {len(hd):,}B")

        # 2. 流式 chat.completions：拼接结果必须与非流式逐字符相同
        _, datas = collect_sse("/v1/chat/completions", {
            "model": "astra-1", "stream": True, "messages": [{"role": "user", "content": "讲个笑话"}],
        })
        chunked = sse_text(datas, "chat")
        check("chat.completions 流式帧格式正确（含唯一 [DONE]）", datas.count("[DONE]") == 1,
              f"{len(datas)} 个 data 帧")
        check("chat.completions 流式拼接 == 非流式内容", chunked == content,
              f"stream {len(chunked):,}B")

        # 3. Responses API
        status, body = post_json("/v1/responses", {"model": "astra-1", "input": "hi"})
        check("responses 非流式原样回图", status == 200 and body.get("output_text") == hd)

        events, datas = collect_sse("/v1/responses", {"model": "astra-1", "input": "hi", "stream": True})
        rchunk = sse_text(datas, "responses")
        check("responses 流式事件齐全且拼接一致",
              "response.created" in events and "response.completed" in events and rchunk == hd,
              f"{len(events)} 个事件")

        # 4. Anthropic Messages
        status, body = post_json("/v1/messages", {
            "model": "astra-1", "max_tokens": 1024, "messages": [{"role": "user", "content": "hi"}],
        })
        check("anthropic messages 非流式原样回图", status == 200 and body["content"][0]["text"] == hd)

        events, datas = collect_sse("/v1/messages", {
            "model": "astra-1", "max_tokens": 1024, "stream": True,
            "messages": [{"role": "user", "content": "hi"}],
        })
        achunk = sse_text(datas, "anthropic")
        check("anthropic 流式事件齐全且拼接一致",
              "message_start" in events and "message_stop" in events and achunk == hd,
              f"{len(events)} 个事件")

        # 5. models / 回显
        _, body = post_json("/v1/chat/completions", {"model": "astra-1-mini", "messages": []})
        check("回显请求里的模型名", body.get("model") == "astra-1-mini", str(body.get("model")))
        code, text = get_text("/v1/models")
        ids = [m["id"] for m in json.loads(text)["data"]]
        check("models 列表里都是 Astra", code == 200 and any(i.startswith("astra") for i in ids), ",".join(ids))

        # 6. 任何别的调用也只会拿到图
        code, text = get_text("/whatever/you/want?q=1")
        check("未知 GET 路径照回图", code == 200 and text == hd)
        code, text = delete_text("/admin/delete-everything")
        check("DELETE 任何路径照回图", code == 200 and text == hd)

        # OPTIONS 也走同一张路由表，所以拿到的是「包着奶龙的 JSON 外壳」而非裸图
        code, text = options_text("/v1/chat/completions")
        check("OPTIONS 预检照旧给奶龙（在 JSON 外壳里）",
              code == 200 and json.loads(text)["choices"][0]["message"]["content"] == hd)

        # 7. 畸形请求体不许 500
        status, body = post_json("/v1/chat/completions", {"messages": "not-a-list"})
        check("畸形请求体仍稳稳回图", status == 200 and body["choices"][0]["message"]["content"] == hd)

        # 8. 另两版可以切换
        code, text = get_text("/v1/whatever?art=blocks")
        check("art=blocks 切到手绘方块版",
              code == 200 and BLOCK_MARK_A in text and BLOCK_MARK_B in text and text != hd,
              f"{text.count(chr(10)) + 1} 行")
        code, text = get_text("/v1/whatever?art=ascii")
        check("art=ascii 切到纯 ASCII 版",
              code == 200 and BLOCK_MARK_A in text and "\u2584" not in text,
              f"{text.count(chr(10)) + 1} 行")

        # 9. 流式下的块大小要像样（别一帧塞 9000 字符）
        _, datas = collect_sse("/v1/chat/completions", {"model": "astra-1", "stream": True, "messages": []})
        check("流式是逐行吐、不是整坨吐", len(datas) >= hd_lines, f"{len(datas) - 1} 个内容帧 / 图 {hd_lines} 行")

    except Exception as exc:  # noqa: BLE001
        check("验收过程未抛异常", False, f"{type(exc).__name__}: {exc}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print("-" * 60, flush=True)
    print(f"合计 {passed}/{total} 通过", flush=True)
    if passed != total:
        for name, ok, detail in results:
            if not ok:
                print(f"  x {name}  {detail}", flush=True)
        print(f"服务端日志：{log_path}", flush=True)
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
