# -*- coding: utf-8 -*-
"""对**已部署**的 Cloudflare Worker 做真机验收：任何调用都只该回同一张奶龙。

用法：
    python verify_deployed.py https://astra-fake-api.<子域>.workers.dev
    python verify_deployed.py https://... C:\\path\\to\\art_hd.txt   # 指定基准图

为什么另开一个脚本：本地 `smoke_test.py` 打的是 127.0.0.1，证明不了**线上那份部署产物**
和本地图一致。这个脚本拿线上地址把同一批判据再跑一遍（含流式拼接、响应头、未知路径）。

注意：Cloudflare 会按 UA 挡人，但**只挡特定签名**。实测（同一出口 IP，两个入口各测一遍）：
python-urllib 的默认 UA 一律 403 / `error code: 1010`，而 curl、openai-python、Anthropic SDK、
node-fetch、axios、真 Edge 的默认 UA 全部 200。起因是 zone 的 `browser_check`（换自有域名也躲不掉），
在请求进到 Worker 之前生效，本 Worker 内部无法自救。

下面所有请求仍固定带 BROWSER_HEADERS —— 不是必需，而是不想让「服务坏了」与「被边缘挡了」混在一起。
"""
import json
import pathlib
import sys
import urllib.error
import urllib.request

BROWSER_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0"),
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "sec-ch-ua": '"Microsoft Edge";v="154", "Chromium";v="154", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
}

HERE = pathlib.Path(__file__).resolve().parent
BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else ""
ART_FILE = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "art_hd.txt"

if not BASE.startswith("http"):
    print("用法: python verify_deployed.py <worker 的 https 地址> [基准图路径]")
    raise SystemExit(2)

ART = ART_FILE.read_text(encoding="utf-8").rstrip("\n")
PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(("PASS  " if ok else "FAIL  ") + name + ("   [" + detail + "]" if detail else ""))


def call(path, method="GET", body=None, stream=False, timeout=45.0):
    url = BASE + path + ("?stream=1" if stream and "?" not in path else "")
    data = None
    headers = dict(BROWSER_HEADERS)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace"), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), dict(e.headers)


def extract(text):
    """从各种外壳里把正文抠出来；不是 JSON 就当作裸文本。"""
    try:
        obj = json.loads(text)
    except Exception:
        return text
    if isinstance(obj, dict):
        ch = obj.get("choices")
        if isinstance(ch, list) and ch and isinstance(ch[0], dict):
            msg = ch[0].get("message") or {}
            if isinstance(msg.get("content"), str):
                return msg["content"]
        c = obj.get("content")
        if isinstance(c, list) and c and isinstance(c[0], dict) and isinstance(c[0].get("text"), str):
            return c[0]["text"]
        if isinstance(obj.get("output_text"), str):
            return obj["output_text"]
    return None


def sse_text(raw, pick):
    """按帧拼接 SSE 内容，返回 (拼接结果, 帧数, [DONE] 个数)。"""
    parts, frames, done = [], 0, 0
    for line in raw.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            done += 1
            continue
        frames += 1
        try:
            obj = json.loads(payload)
        except Exception:
            continue
        piece = pick(obj)
        if piece:
            parts.append(piece)
    return "".join(parts), frames, done


print("目标: " + BASE)
print("基准: " + ART_FILE.name + " 去尾换行 = " + str(len(ART)) + " 字符 / " + str(len(ART.splitlines())) + " 行")
print("-" * 60)

# 1. chat.completions 非流式
code, text, _ = call("/v1/chat/completions", "POST",
                     {"model": "astra-1", "messages": [{"role": "user", "content": "你是谁"}]})
content = extract(text)
check("chat.completions 非流式 == 本地图", code == 200 and content == ART,
      "HTTP " + str(code) + ", " + str(len(content or "")) + " 字符")

# 2. chat.completions 流式
code, text, _ = call("/v1/chat/completions", "POST",
                     {"model": "astra-1", "messages": [], "stream": True})
joined, frames, done = sse_text(text, lambda o: (o.get("choices") or [{}])[0].get("delta", {}).get("content"))
check("chat.completions 流式拼接 == 本地图", code == 200 and joined == ART,
      "HTTP " + str(code) + ", " + str(frames) + " 帧")
check("流式 [DONE] 唯一", done == 1, str(done) + " 个")

# 3. anthropic messages 非流式（顺带回显模型名）
code, text, _ = call("/v1/messages", "POST",
                     {"model": "claude-3-5-astra", "max_tokens": 16,
                      "messages": [{"role": "user", "content": "hi"}]})
check("anthropic messages 非流式 == 本地图", code == 200 and extract(text) == ART, "HTTP " + str(code))

# 4. 未知路径（裸文本，永不 404）
code, text, _ = call("/definitely/not/a/real/path")
check("未知路径 GET 照回裸图", code == 200 and text.rstrip("\n") == ART,
      "HTTP " + str(code) + ", " + str(len(text)) + " 字符")

# 5. 响应头与模型清单
code, text, hdrs = call("/v1/models")
low = {k.lower(): v for k, v in hdrs.items()}
check("带 CORS 头", low.get("access-control-allow-origin") == "*", str(low.get("access-control-allow-origin")))
check("带奶龙标记头", low.get("x-powered-by") == "nailong-laughing-engine", str(low.get("x-powered-by")))
check("/v1/models 里都是 Astra", "astra-1" in text)

print("-" * 60)
print("合计 " + str(len(PASS)) + "/" + str(len(PASS) + len(FAIL)) + " 通过")
if FAIL:
    print("失败项: " + "; ".join(FAIL))
raise SystemExit(1 if FAIL else 0)
