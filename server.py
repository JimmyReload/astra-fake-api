#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ChatGPT-Astra 伪装 API —— 任何调用都只会返回一张「奶龙捧腹大笑」ASCII 画。

零第三方依赖，只用 Python 标准库。支持：
  POST /v1/chat/completions   (OpenAI Chat Completions，含 stream:true 的 SSE)
  POST /v1/responses          (OpenAI Responses API，含 SSE 事件流)
  POST /v1/messages           (Anthropic Messages，含 SSE 事件流)
  GET  /v1/models             (返回一堆不存在但很像样的 Astra 模型)
  ANY  其它任何路径/方法       (照回奶龙，绝不 404)

用法：
  python server.py                          # 默认 127.0.0.1:8787
  python server.py --host 0.0.0.0 --port 9000
  python server.py --art ascii              # 纯 ASCII 版（老终端用）
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# Windows 上 stdout 被重定向时会用 GBK 编码，打印方块字符直接 UnicodeEncodeError
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

APP_NAME = "chatgpt-astra-fake"
VERSION = "1.0.0"
STARTED_AT = time.time()

DEFAULT_MODEL = "astra-1"
MODELS = [
    {"id": "astra-1", "object": "model", "owned_by": "openai-deep-research", "created": 1750000000},
    {"id": "astra-1-mini", "object": "model", "owned_by": "openai-deep-research", "created": 1750000000},
    {"id": "astra-1-pro", "object": "model", "owned_by": "openai-deep-research", "created": 1750000000},
    {"id": "chatgpt-astra-latest", "object": "model", "owned_by": "openai-deep-research", "created": 1750000000},
    {"id": "gpt-5-astra", "object": "model", "owned_by": "openai", "created": 1750000000},
]

# ---------------------------------------------------------------------------
# 唯一的"回答"：奶龙捧腹大笑
# ---------------------------------------------------------------------------

ART_BLOCKS = r"""
         ╭──────────────╮
         │  HA  HA  HA  │
         ╰───────┬──────╯
                 ▼
                    ▄▄▄▄▄▄▄▄▄▄▄▄
                ▄▄██████████████████▄▄
             ▄█████▀▀            ▀▀█████▄
           ▄████▀                    ▀████▄
          ████▀    ▄▄▄▄▄      ▄▄▄▄▄    ▀████
         ████     ███████    ███████     ████
        ████      ▀██████    ██████▀      ████
        ███                                ███
        ███      ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄      ███
        ███    ▄█████████████████████████▄   ███
        ███   ████▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀████   ███
        ███   ███       ▄▄▄▄▄▄▄▄▄       ███   ███
        ███   ███      ███████████      ███   ███
        ███   ███      ▀▀███████▀▀      ███   ███
         ███   ▀███▄▄             ▄▄███▀    ███
          ████▄    ▀▀▀█████████▀▀▀     ▄████
            ▀████▄▄                ▄▄████▀
               ▀▀██████▄▄▄▄▄▄▄▄██████▀▀
                  ▄███▄          ▄███▄
                 ██▀ ▀██        ██▀ ▀██
                  ( 捧着肚子，笑不活了 )
""".strip("\n")

ART_ASCII = r"""
         +--------------+
         |  HA  HA  HA  |
         +-------.------+
                 v
                    ############
                ####################
             #####                  #####
           ####                        ####
          ###      #####      #####      ###
         ###      #######    #######      ###
        ###       #######    #######       ###
        ##                                  ##
        ##       ####################       ##
        ##     ##########################    ##
        ##   #####                      #####  ##
        ##   ###       ##########       ###   ##
        ##   ###      ############      ###   ##
        ##   ###      ############      ###   ##
         ##    ####                     ####   ##
          ###     ##################      ###
            ####                    ####
               ######################
                  ###          ###
                 ##  ##      ##  ##
               (  peng zhe du zi, xiao bu huo le  )
""".strip("\n")

# 供冒烟测试独立复核用的标记（测试脚本里也硬编码了同样的字样）
ART_MARKERS = ("HA  HA  HA", "捧着肚子")

MODEL_ALIASES = {m["id"] for m in MODELS} | {"gpt-4o", "gpt-4o-mini", "o1", "o3", "claude-3-5-sonnet"}


HD_ART_PATH = Path(__file__).resolve().parent / "art_hd.txt"
_hd_cache: tuple[float, str] | None = None


def load_hd_art() -> str | None:
    """照片版奶龙放在 art_hd.txt，按 mtime 缓存 —— 改了文件下一次请求就生效。"""
    global _hd_cache
    try:
        stamp = HD_ART_PATH.stat().st_mtime
    except OSError:
        return None
    if _hd_cache is not None and _hd_cache[0] == stamp:
        return _hd_cache[1]
    try:
        text = HD_ART_PATH.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    if not text:
        return None
    _hd_cache = (stamp, text)
    return text


def pick_art(query_art: str | None) -> str:
    wanted = (query_art or os.environ.get("ASTRA_ART") or "hd").strip().lower()
    if wanted.startswith("blocks"):
        return ART_BLOCKS
    if wanted.startswith("ascii"):
        return ART_ASCII
    if wanted.startswith("hd"):
        return load_hd_art() or ART_BLOCKS
    return ART_BLOCKS


def art_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def now() -> int:
    return int(time.time())


def rid(prefix: str) -> str:
    return f"{prefix}_{os.urandom(12).hex()}"


def chunk_lines(text: str):
    """按行切块：让流式输出看起来像"一个字一个字往外蹦"。"""
    for line in text.splitlines(keepends=True):
        yield line


def approx_prompt_tokens(raw: bytes) -> int:
    return max(1, len(raw) // 4)


# ---------------------------------------------------------------------------
# 各种"包装盒"：里面的内容永远只有奶龙
# ---------------------------------------------------------------------------

def chat_completion_body(model: str, art: str, prompt_tokens: int) -> dict:
    return {
        "id": rid("chatcmpl"),
        "object": "chat.completion",
        "created": now(),
        "model": model,
        "system_fingerprint": "fp_nailong_2026",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": art, "refusal": None, "annotations": []},
                "logprobs": None,
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": art_tokens(art),
            "total_tokens": prompt_tokens + art_tokens(art),
            "completion_tokens_details": {"reasoning_tokens": 0},
        },
    }


def responses_body(model: str, art: str, prompt_tokens: int) -> dict:
    return {
        "id": rid("resp"),
        "object": "response",
        "created_at": now(),
        "status": "completed",
        "model": model,
        "output": [
            {
                "id": rid("msg"),
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [{"type": "output_text", "text": art, "annotations": []}],
            }
        ],
        "output_text": art,
        "parallel_tool_calls": True,
        "tools": [],
        "usage": {
            "input_tokens": prompt_tokens,
            "output_tokens": art_tokens(art),
            "total_tokens": prompt_tokens + art_tokens(art),
        },
    }


def anthropic_body(model: str, art: str, prompt_tokens: int) -> dict:
    return {
        "id": rid("msg"),
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [{"type": "text", "text": art}],
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {"input_tokens": prompt_tokens, "output_tokens": art_tokens(art)},
    }


def sse_chat(model: str, art: str, prompt_tokens: int):
    cid = rid("chatcmpl")
    created = now()
    base = {"id": cid, "object": "chat.completion.chunk", "created": created, "model": model}

    def frame(delta: dict, finish=None) -> str:
        payload = dict(base)
        payload["choices"] = [{"index": 0, "delta": delta, "logprobs": None, "finish_reason": finish}]
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    yield frame({"role": "assistant", "content": ""})
    for piece in chunk_lines(art):
        yield frame({"content": piece})
        time.sleep(0.004)
    yield frame({}, "stop")
    final = {
        "id": cid,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": art_tokens(art),
            "total_tokens": prompt_tokens + art_tokens(art),
        },
    }
    yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"


def sse_responses(model: str, art: str, prompt_tokens: int):
    body = responses_body(model, art, prompt_tokens)
    item = body["output"][0]

    def ev(name: str, data: dict) -> str:
        return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    created = dict(body)
    created["status"] = "in_progress"
    created["output"] = []
    yield ev("response.created", {"type": "response.created", "response": created})
    yield ev("response.in_progress", {"type": "response.in_progress", "response": created})
    yield ev("response.output_item.added", {
        "type": "response.output_item.added", "output_index": 0,
        "item": {**item, "status": "in_progress", "content": []},
    })
    yield ev("response.content_part.added", {
        "type": "response.content_part.added", "item_id": item["id"], "output_index": 0,
        "content_index": 0, "part": {"type": "output_text", "text": "", "annotations": []},
    })
    for piece in chunk_lines(art):
        yield ev("response.output_text.delta", {
            "type": "response.output_text.delta", "item_id": item["id"],
            "output_index": 0, "content_index": 0, "delta": piece,
        })
        time.sleep(0.004)
    yield ev("response.output_text.done", {
        "type": "response.output_text.done", "item_id": item["id"],
        "output_index": 0, "content_index": 0, "text": art,
    })
    yield ev("response.content_part.done", {
        "type": "response.content_part.done", "item_id": item["id"], "output_index": 0,
        "content_index": 0, "part": {"type": "output_text", "text": art, "annotations": []},
    })
    yield ev("response.output_item.done", {
        "type": "response.output_item.done", "output_index": 0, "item": item,
    })
    yield ev("response.completed", {"type": "response.completed", "response": body})


def sse_anthropic(model: str, art: str, prompt_tokens: int):
    mid = rid("msg")
    start = {
        "type": "message_start",
        "message": {
            "id": mid, "type": "message", "role": "assistant", "model": model,
            "content": [], "stop_reason": None, "stop_sequence": None,
            "usage": {"input_tokens": prompt_tokens, "output_tokens": 0},
        },
    }

    def ev(name: str, data: dict) -> str:
        return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    yield ev("message_start", start)
    yield ev("content_block_start", {
        "type": "content_block_start", "index": 0,
        "content_block": {"type": "text", "text": ""},
    })
    yield ev("ping", {"type": "ping"})
    for piece in chunk_lines(art):
        yield ev("content_block_delta", {
            "type": "content_block_delta", "index": 0,
            "delta": {"type": "text_delta", "text": piece},
        })
        time.sleep(0.004)
    yield ev("content_block_stop", {"type": "content_block_stop", "index": 0})
    yield ev("message_delta", {
        "type": "message_delta",
        "delta": {"stop_reason": "end_turn", "stop_sequence": None},
        "usage": {"output_tokens": art_tokens(art)},
    })
    yield ev("message_stop", {"type": "message_stop"})


# ---------------------------------------------------------------------------
# HTTP 服务
# ---------------------------------------------------------------------------

class NailongServer(ThreadingHTTPServer):
    daemon_threads = True
    # Windows 上 SO_REUSEADDR 会允许两个进程绑同一端口，且请求全给先绑的那个（见项目记忆）。
    # 这里显式关掉，配合启动前的端口探测，避免"旧进程冒充新服务"。
    allow_reuse_address = False


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ChatGPT-Astra/" + VERSION
    sys_version = ""

    # ---- 工具 ----------------------------------------------------------
    def _read_body(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        return self.rfile.read(length) if length > 0 else b""

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
        self.send_header("X-Powered-By", "nailong-laughing-engine")
        self.send_header("X-Nailong", "laughing")
        self.send_header("Connection", "close")

    def _send(self, status: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.close_connection = True
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json(self, obj: dict, status: int = 200) -> None:
        self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _send_sse(self, frames, extra: dict | None = None) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self._cors()
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.close_connection = True
        try:
            for frame in frames:
                if self.command == "HEAD":
                    break
                self.wfile.write(frame.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, fmt, *args):  # 静音默认日志，改用下面的 _log
        pass

    def _log(self, path: str, model: str, stream: bool, note: str) -> None:
        stamp = time.strftime("%H:%M:%S")
        mode = "SSE " if stream else "JSON"
        line = f"[{stamp}] {self.command:<6} {path:<28} {mode} model={model:<22} -> {note}"
        print(line, flush=True)

    # ---- 路由 ----------------------------------------------------------
    def _handle(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path or "/"
        trimmed = path.rstrip("/") or "/"
        qs = parse_qs(parsed.query)
        raw = self._read_body()

        data: dict = {}
        if raw:
            try:
                parsed_body = json.loads(raw.decode("utf-8", "replace"))
                if isinstance(parsed_body, dict):
                    data = parsed_body
            except Exception:
                data = {}

        model = str(data.get("model") or qs.get("model", [DEFAULT_MODEL])[0])
        art = pick_art(qs.get("art", [None])[0])
        stream_qs = qs.get("stream", ["0"])[0].lower() in ("1", "true", "yes", "on")
        stream = bool(data.get("stream")) or stream_qs
        prompt_tokens = approx_prompt_tokens(raw)

        if trimmed == "/v1/models" or trimmed == "/models":
            self._log(path, model, False, f"卖出 {len(MODELS)} 个并不存在的模型")
            self._send_json({"object": "list", "data": MODELS})

        elif trimmed in ("/v1/chat/completions", "/chat/completions"):
            if stream:
                self._log(path, model, True, "奶龙开始一帧一帧地笑（chat.completion.chunk）")
                self._send_sse(sse_chat(model, art, prompt_tokens), {"X-Stream-Mode": "chat.completions"})
            else:
                self._log(path, model, False, "奶龙就位（chat.completion）")
                self._send_json(chat_completion_body(model, art, prompt_tokens))

        elif trimmed in ("/v1/responses", "/responses"):
            if stream:
                self._log(path, model, True, "奶龙开始一帧一帧地笑（response.output_text.delta）")
                self._send_sse(sse_responses(model, art, prompt_tokens), {"X-Stream-Mode": "responses"})
            else:
                self._log(path, model, False, "奶龙就位（response.output_text）")
                self._send_json(responses_body(model, art, prompt_tokens))

        elif trimmed in ("/v1/messages", "/messages"):
            if stream:
                self._log(path, model, True, "奶龙开始一帧一帧地笑（content_block_delta）")
                self._send_sse(sse_anthropic(model, art, prompt_tokens), {"X-Stream-Mode": "anthropic.messages"})
            else:
                self._log(path, model, False, "奶龙就位（anthropic message）")
                self._send_json(anthropic_body(model, art, prompt_tokens))

        elif trimmed == "/v1/messages/count_tokens":
            self._log(path, model, False, "数了数奶龙的像素当 token")
            self._send_json({"input_tokens": prompt_tokens})

        else:
            # 顽固到底：任何别的调用也只会拿到奶龙
            self._log(path, model, False, "非标路径 → 照旧奶龙")
            self._send(200, art.encode("utf-8"), "text/plain; charset=utf-8")

    def do_GET(self):
        self._handle()

    def do_POST(self):
        self._handle()

    def do_PUT(self):
        self._handle()

    def do_PATCH(self):
        self._handle()

    def do_DELETE(self):
        self._handle()

    def do_OPTIONS(self):
        self._handle()

    def do_HEAD(self):
        self._handle()


def port_is_free(host: str, port: int) -> bool:
    probe_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.6)
        return sock.connect_ex((probe_host, port)) != 0


def main() -> int:
    parser = argparse.ArgumentParser(description="ChatGPT-Astra 伪装 API（只会回奶龙）")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址，默认 127.0.0.1")
    parser.add_argument("--port", type=int, default=8787, help="监听端口，默认 8787")
    parser.add_argument("--art", default=None, choices=["hd", "blocks", "ascii"],
                        help="选哪一版奶龙：hd=照片版(art_hd.txt，默认) / blocks=手绘方块版 / ascii=纯 ASCII 版")
    args = parser.parse_args()

    if args.art:
        os.environ["ASTRA_ART"] = args.art

    if not port_is_free(args.host, args.port):
        print(f"[x] 端口 {args.port} 已被占用（本机会有旧进程仍应答，结果不可信）。"
              f"请换端口：--port {args.port + 1}", flush=True)
        return 2

    httpd = NailongServer((args.host, args.port), Handler)
    shown = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    base = f"http://{shown}:{args.port}"
    print("=" * 66, flush=True)
    print("  ChatGPT-Astra 伪装 API 已启动（真正在回话的是一位奶龙）", flush=True)
    print(f"  Base URL : {base}/v1      （OpenAI SDK 就填这个）", flush=True)
    print(f"  Chat     : POST {base}/v1/chat/completions", flush=True)
    print(f"  Responses: POST {base}/v1/responses", flush=True)
    print(f"  Anthropic: POST {base}/v1/messages", flush=True)
    print(f"  Models   : GET  {base}/v1/models", flush=True)
    if args.host in ("0.0.0.0", "::"):
        print("  [!] 已监听 0.0.0.0，局域网内任何设备都能来逗奶龙", flush=True)
    print("  Ctrl+C 停止", flush=True)
    print("=" * 66, flush=True)
    art = pick_art(args.art)
    print(art, flush=True)
    print("=" * 66, flush=True)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[√] 奶龙下班了。", flush=True)
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
