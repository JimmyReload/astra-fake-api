#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
独立验收：把 astra-fake-api 起起来，用真实的 HTTP 调用逐条验证
「任何调用都只会返回一张奶龙捧腹大笑的 ASCII 画」。

判据刻意自己算，不 import server.py 的任何常量（否则两边同错还判绿）：
  * HD 版内容 = 独立直读 art_hd.txt 的字节（验证的是「传输是否原样」）
  * 围栏长度按图里最长反引号串独立重算（验证的是「包装是否等价」）
  * blocks 版的标记字符串在两个文件里各自硬编码
  * 模型 id 清单、鉴权状态码都在这里独立重算
  * 流式拼接结果必须与同一包装盒里的非流式内容逐字符相同（证明没漏帧、没截断）
  * 端口先探测，拒绝用残留旧进程冒充新服务（Windows 上 SO_REUSEADDR 会双绑）

v1.1.0 起服务有鉴权（key + 模型白名单），故这里启动时显式给 --api-key，
并单独验「不带 key / 错 key / 未知模型 / 预检」四种闸门行为。
"""

from __future__ import annotations

import json
import re
import socket
import subprocess
import sys
import time
import urllib.error
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

# 1.1.0 起模型名换成上游真实存在的 id（此处硬编码即"独立判据"，不从 server.py import）
EXPECTED_MODEL_IDS = ["gpt-6-astra", "gpt-6-astra-pro", "gpt-6-astra-20260903",
                      "gpt-6-astra-high", "gpt-6-luna"]
EXPECTED_DEFAULT_MODEL = "gpt-6-astra"

# 验收自己的密钥（独立于被验收方；server.py 侧只从命令行/env 拿）
KEY = "sk-astra-smoke-4f9c1e2b7a0d"


def fence_for(art: str) -> str:
    """复刻服务端的围栏长度规则（最长连续反引号 +1，最少 3）—— 自己算，不 import server.py。"""
    longest = max((len(run) for run in re.findall(r"`+", art)), default=0)
    return "`" * max(3, longest + 1)


def wrap(art: str) -> str:
    fence = fence_for(art)
    return f"{fence}\n{art}\n{fence}"


def unwrap(block: str) -> str:
    """把代码围栏剥掉；不像围栏就原样返回（用于"传输是否原样"这条判据）。"""
    lines = block.split("\n")
    if len(lines) >= 3 and lines[0] == lines[-1] and set(lines[0]) == {"`"} and len(lines[0]) >= 3:
        return "\n".join(lines[1:-1])
    return block


results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"   [{detail}]" if detail else ""), flush=True)


def _headers(content_type: str = "", key: str | None = KEY) -> dict[str, str]:
    headers: dict[str, str] = {}
    if content_type:
        headers["Content-Type"] = content_type
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _fetch(req: urllib.request.Request, timeout: float) -> tuple[int, str]:
    """HTTPError 也是「服务端给的合法响应」，要拿到状态码与正文，不能让它抛出去。"""
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def post_json(path: str, payload, timeout: float = 25.0,
              key: str | None = KEY) -> tuple[int, dict]:
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers=_headers("application/json", key),
        method="POST",
    )
    code, text = _fetch(req, timeout)
    try:
        parsed = json.loads(text)
    except Exception:
        parsed = {}
    return code, parsed


def get_text(path: str, timeout: float = 25.0, key: str | None = KEY,
             extra: dict[str, str] | None = None) -> tuple[int, str]:
    return _fetch(urllib.request.Request(BASE + path, headers={**_headers("", key), **(extra or {})}),
                  timeout)


def delete_text(path: str, timeout: float = 25.0, key: str | None = KEY) -> tuple[int, str]:
    req = urllib.request.Request(BASE + path, data=b"x=1", headers=_headers("", key), method="DELETE")
    return _fetch(req, timeout)


def options_text(path: str, timeout: float = 25.0, key: str | None = KEY) -> tuple[int, str]:
    req = urllib.request.Request(BASE + path, headers=_headers("", key), method="OPTIONS")
    return _fetch(req, timeout)


def collect_sse(path: str, payload: dict, timeout: float = 40.0,
                key: str | None = KEY) -> tuple[list[str], list[str]]:
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode("utf-8"),
        headers=_headers("application/json", key),
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
    fenced = wrap(hd)
    check("art_hd.txt 自检（够大、行数够多）", hd_lines >= HD_MIN_LINES and len(hd) > 3000,
          f"{hd_lines} 行 / {len(hd):,} 字符")
    check("图里没有反引号（围栏不会跟图打架）", "`" not in hd, f"围栏 = {'`' * len(fence_for(hd))}")

    with socket.socket() as s:
        s.settimeout(0.5)
        if s.connect_ex(("127.0.0.1", PORT)) == 0:
            print(f"[x] 端口 {PORT} 已被占用，拒绝用可能残留的旧服务冒充新服务。", flush=True)
            return 2

    log_path = HERE / "_smoke_server.log"
    log = open(log_path, "w", encoding="utf-8", errors="replace")
    proc = subprocess.Popen(
        [sys.executable, str(HERE / "server.py"), "--host", "127.0.0.1", "--port", str(PORT),
         "--api-key", KEY],
        stdout=log, stderr=subprocess.STDOUT, cwd=str(HERE),
    )

    try:
        if not wait_port(PORT, 25.0):
            print("[x] 服务没起来，见 _smoke_server.log", flush=True)
            return 2

        # 1. 常规 chat.completions（默认 = HD 照片版）
        status, body = post_json("/v1/chat/completions", {
            "model": EXPECTED_DEFAULT_MODEL, "messages": [{"role": "user", "content": "你好"}],
        })
        content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
        check("chat.completions 非流式原样回图（围栏 + 图）",
              status == 200 and content == fenced,
              f"外层 {len(content):,}B vs 期望 {len(fenced):,}B")
        check("正文被 Markdown 代码围栏包住、剥掉后与文件逐字节相同",
              content.startswith("```\n") and content.endswith("\n```") and unwrap(content) == hd,
              f"首行 {content.splitlines()[0]!r}" if content else "空正文")

        # 2. 流式 chat.completions：拼接结果必须与非流式逐字符相同
        _, datas = collect_sse("/v1/chat/completions", {
            "model": EXPECTED_DEFAULT_MODEL, "stream": True,
            "messages": [{"role": "user", "content": "讲个笑话"}],
        })
        chunked = sse_text(datas, "chat")
        check("chat.completions 流式帧格式正确（含唯一 [DONE]）", datas.count("[DONE]") == 1,
              f"{len(datas)} 个 data 帧")
        check("chat.completions 流式拼接 == 非流式内容", chunked == content,
              f"stream {len(chunked):,}B")

        # 3. Responses API
        status, body = post_json("/v1/responses", {"model": EXPECTED_DEFAULT_MODEL, "input": "hi"})
        check("responses 非流式原样回图", status == 200 and body.get("output_text") == fenced)

        events, datas = collect_sse("/v1/responses",
                                   {"model": EXPECTED_DEFAULT_MODEL, "input": "hi", "stream": True})
        rchunk = sse_text(datas, "responses")
        check("responses 流式事件齐全且拼接一致",
              "response.created" in events and "response.completed" in events and rchunk == fenced,
              f"{len(events)} 个事件")

        # 4. Anthropic Messages
        status, body = post_json("/v1/messages", {
            "model": "claude-3-5-sonnet", "max_tokens": 1024,
            "messages": [{"role": "user", "content": "hi"}],
        })
        check("anthropic messages 非流式原样回图",
              status == 200 and body.get("content", [{}])[0].get("text") == fenced)

        events, datas = collect_sse("/v1/messages", {
            "model": EXPECTED_DEFAULT_MODEL, "max_tokens": 1024, "stream": True,
            "messages": [{"role": "user", "content": "hi"}],
        })
        achunk = sse_text(datas, "anthropic")
        check("anthropic 流式事件齐全且拼接一致",
              "message_start" in events and "message_stop" in events and achunk == fenced,
              f"{len(events)} 个事件")

        # 5. models / 回显
        _, body = post_json("/v1/chat/completions", {"model": EXPECTED_MODEL_IDS[1], "messages": []})
        check("回显请求里的模型名", body.get("model") == EXPECTED_MODEL_IDS[1], str(body.get("model")))
        code, text = get_text("/v1/models")
        ids = [m["id"] for m in json.loads(text)["data"]]
        check("models 列表与约定清单逐项相同",
              code == 200 and ids == EXPECTED_MODEL_IDS, ",".join(ids))

        # 6. 任何别的调用也只会拿到图
        code, text = get_text("/whatever/you/want?q=1")
        check("未知 GET 路径照回裸图（text/plain，无围栏）", code == 200 and text == hd)
        code, text = delete_text("/admin/delete-everything")
        check("DELETE 任何路径照回裸图", code == 200 and text == hd)

        # OPTIONS 也走同一张路由表，所以拿到的是「包着奶龙的 JSON 外壳」而非裸图
        code, text = options_text("/v1/chat/completions")
        check("OPTIONS 预检照旧给奶龙（在 JSON 外壳里）",
              code == 200 and json.loads(text)["choices"][0]["message"]["content"] == fenced)

        # 7. 畸形请求体不许 500
        status, body = post_json("/v1/chat/completions", {"messages": "not-a-list"})
        check("畸形请求体仍稳稳回图",
              status == 200 and body["choices"][0]["message"]["content"] == fenced)

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
        _, datas = collect_sse("/v1/chat/completions",
                               {"model": EXPECTED_DEFAULT_MODEL, "stream": True, "messages": []})
        check("流式是逐行吐、不是整坨吐", len(datas) >= hd_lines, f"{len(datas) - 1} 个内容帧 / 图 {hd_lines} 行")

        # 10. 鉴权：key 闸门
        code, body = post_json("/v1/chat/completions", {"model": EXPECTED_DEFAULT_MODEL}, key=None)
        err = body.get("error") or {}
        check("不带 key -> 401 invalid_api_key",
              code == 401 and err.get("code") == "invalid_api_key",
              f"{code} code={err.get('code')}")
        code, _ = post_json("/v1/chat/completions", {"model": EXPECTED_DEFAULT_MODEL}, key="sk-wrong")
        check("key 不对 -> 401", code == 401, str(code))
        code, body = post_json("/v1/chat/completions", {"model": EXPECTED_DEFAULT_MODEL})
        check("key 正确 -> 200", code == 200, str(code))
        code, text = get_text("/v1/chat/completions", key=None, extra={"x-api-key": KEY})
        check("x-api-key 头也认", code == 200 and "choices" in text, str(code))

        # 11. 鉴权：模型闸门
        code, body = post_json("/v1/chat/completions", {"model": "gpt-9-nonexistent"})
        err = body.get("error") or {}
        check("未知模型 -> 404 model_not_found",
              code == 404 and err.get("code") == "model_not_found",
              f"{code} code={err.get('code')}")
        code, _ = post_json("/v1/chat/completions", {"model": "gpt-4o"})
        check("白名单里的老名字仍放行（gpt-4o）", code == 200, str(code))

        # 12. 预检不带 key 也必须放行（否则浏览器端调用全死在预检上）
        code, _ = options_text("/v1/chat/completions", key=None)
        check("OPTIONS 预检不校验 key", code == 200, str(code))

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
