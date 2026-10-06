# -*- coding: utf-8 -*-
"""对**已部署**的 Cloudflare Worker 做真机验收：任何调用都只该回同一张奶龙。

用法：
    set NAILONG_API_KEY=sk-astra-...        （或作为第 3 个位置参数）
    python verify_deployed.py https://astra-fake-api.<子域>.workers.dev
    python verify_deployed.py https://gpt.caar.fun  C:\\path\\to\\art_hd.txt  sk-astra-...

为什么另开一个脚本：本地 `smoke_test.py` 打的是 127.0.0.1，证明不了**线上那份部署产物**
和本地图一致。这个脚本拿线上地址把同一批判据再跑一遍（含流式拼接、响应头、围栏、鉴权、未知路径）。

注意一：Cloudflare 会按 UA 挡人，但**只挡特定签名**。实测（同一出口 IP，两个入口各测一遍）：
python-urllib 的默认 UA 一律 403 / `error code: 1010`，而 curl、openai-python、Anthropic SDK、
node-fetch、axios、真 Edge 的默认 UA 全部 200。起因是 zone 的 `browser_check`（换自有域名也躲不掉），
在请求进到 Worker 之前生效，本 Worker 内部无法自救。下面所有请求仍固定带 BROWSER_HEADERS。

注意二：v1.1.0 起服务有鉴权（key + 模型白名单），故除了「不带 key 应 401」这类反查项，
其余请求都要带 `Authorization: Bearer <key>`，key 从命令行第三个参数或环境变量 NAILONG_API_KEY 取。
"""
import json
import os
import pathlib
import re
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

# 独立硬编码的约定清单（不从 Worker 源码 import，否则源码写错也会跟着判绿）
EXPECTED_MODEL_IDS = ["gpt-6-astra", "gpt-6-astra-pro", "gpt-6-astra-20260903",
                      "gpt-6-astra-high", "gpt-6-luna"]
DEFAULT_MODEL = "gpt-6-astra"
# anthropic 那一档用白名单里的老名字（证明兼容别名仍放行）
ANTHROPIC_MODEL = "claude-3-5-sonnet"

HERE = pathlib.Path(__file__).resolve().parent
BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else ""
ART_FILE = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "art_hd.txt"
KEY = (sys.argv[3] if len(sys.argv) > 3 else os.environ.get("NAILONG_API_KEY", "")).strip()

if not BASE.startswith("http"):
    print("用法: python verify_deployed.py <worker 的 https 地址> [基准图路径] [API key]")
    raise SystemExit(2)
if not KEY:
    print("[x] 没给 key：请用第 3 个位置参数或在环境变量 NAILONG_API_KEY 里给（v1.1.0 起服务要鉴权）")
    raise SystemExit(2)

ART = ART_FILE.read_text(encoding="utf-8").rstrip("\n")
PASS, FAIL = [], []


def fence_for(art):
    """复刻服务端的围栏长度规则（最长连续反引号 +1，最少 3）。"""
    longest = max((len(run) for run in re.findall(r"`+", art)), default=0)
    return "`" * max(3, longest + 1)


def wrap(art):
    fence = fence_for(art)
    return fence + "\n" + art + "\n" + fence


def unwrap(text):
    """剥掉最外层代码围栏；没围栏就原样返回（用于抓「忘了包围栏」）。"""
    lines = str(text).split("\n")
    if len(lines) >= 3 and lines[0] == lines[-1] and set(lines[0]) == {"`"} and len(lines[0]) >= 3:
        return "\n".join(lines[1:-1])
    return str(text)


FENCED = wrap(ART)


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(("PASS  " if ok else "FAIL  ") + name + ("   [" + detail + "]" if detail else ""))


def call(path, method="GET", body=None, stream=False, timeout=45.0, key=None):
    """key 缺省 = 用全局 key；key="" 显式表示「不带 Authorization」。"""
    url = BASE + path + ("?stream=1" if stream and "?" not in path else "")
    data = None
    headers = dict(BROWSER_HEADERS)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    use = KEY if key is None else key
    if use:
        headers["Authorization"] = "Bearer " + use
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
print("密钥: " + KEY[:11] + "..." + KEY[-4:] + "（" + str(len(KEY)) + " 字符）")
print("-" * 60)

# 1. chat.completions 非流式
code, text, _ = call("/v1/chat/completions", "POST",
                     {"model": DEFAULT_MODEL, "messages": [{"role": "user", "content": "你是谁"}]})
content = extract(text)
check("chat.completions 非流式 == 本地图（围栏 + 图）", code == 200 and content == FENCED,
      "HTTP " + str(code) + ", " + str(len(content or "")) + " 字符")
check("正文包着 Markdown 代码围栏，剥掉后逐字节等于本地图",
      bool(content) and content.startswith("```\n") and content.endswith("\n```") and unwrap(content) == ART,
      "首行 " + repr((content or "").split("\n")[0]))

# 2. chat.completions 流式
code, text, _ = call("/v1/chat/completions", "POST",
                     {"model": DEFAULT_MODEL, "messages": [], "stream": True})
joined, frames, done = sse_text(text, lambda o: (o.get("choices") or [{}])[0].get("delta", {}).get("content"))
check("chat.completions 流式拼接 == 非流式内容", code == 200 and joined == FENCED,
      "HTTP " + str(code) + ", " + str(frames) + " 帧")
check("流式 [DONE] 唯一", done == 1, str(done) + " 个")

# 3. anthropic messages 非流式（顺带回显模型名）
code, text, _ = call("/v1/messages", "POST",
                     {"model": ANTHROPIC_MODEL, "max_tokens": 16,
                      "messages": [{"role": "user", "content": "hi"}]})
check("anthropic messages 非流式 == 本地图", code == 200 and extract(text) == FENCED, "HTTP " + str(code))

# 4. responses 非流式
code, text, _ = call("/v1/responses", "POST", {"model": DEFAULT_MODEL, "input": "hi"})
check("responses 非流式 == 本地图", code == 200 and extract(text) == FENCED, "HTTP " + str(code))

# 5. 未知路径（裸文本，无围栏）
code, text, _ = call("/definitely/not/a/real/path")
check("未知路径 GET 照回裸图（text/plain，无围栏）", code == 200 and text.rstrip("\n") == ART,
      "HTTP " + str(code) + ", " + str(len(text)) + " 字符")

# 6. 响应头与模型清单
code, text, hdrs = call("/v1/models")
low = {k.lower(): v for k, v in hdrs.items()}
check("带 CORS 头", low.get("access-control-allow-origin") == "*", str(low.get("access-control-allow-origin")))
check("带奶龙标记头", low.get("x-powered-by") == "nailong-laughing-engine", str(low.get("x-powered-by")))
try:
    ids = [m["id"] for m in json.loads(text)["data"]]
except Exception:
    ids = []
check("/v1/models 的 id 与约定清单逐项相同",
      code == 200 and ids == EXPECTED_MODEL_IDS, ",".join(ids))

# 7. 鉴权反查：不带 key 必须 401，未知模型必须 404，预检不带 key 也必须放行
code, text, hdrs = call("/v1/chat/completions", "POST", {"model": DEFAULT_MODEL}, key="")
low = {k.lower(): v for k, v in hdrs.items()}
try:
    err = (json.loads(text) or {}).get("error") or {}
except Exception:
    err = {}
check("不带 key -> 401 invalid_api_key", code == 401 and err.get("code") == "invalid_api_key",
      "HTTP " + str(code) + " code=" + str(err.get("code")))
check("401 带 WWW-Authenticate", low.get("www-authenticate") == 'Bearer realm="chatgpt-astra"',
      str(low.get("www-authenticate")))
check("401 也带 CORS 头（浏览器端才读得到错误）", low.get("access-control-allow-origin") == "*",
      str(low.get("access-control-allow-origin")))

code, text, _ = call("/v1/chat/completions", "POST", {"model": "gpt-9-nonexistent"})
try:
    err = (json.loads(text) or {}).get("error") or {}
except Exception:
    err = {}
check("未知模型 -> 404 model_not_found", code == 404 and err.get("code") == "model_not_found",
      "HTTP " + str(code) + " code=" + str(err.get("code")))

code, text, _ = call("/v1/chat/completions", "OPTIONS", key="")
check("OPTIONS 预检不校验 key", code == 200, "HTTP " + str(code))

print("-" * 60)
print("合计 " + str(len(PASS)) + "/" + str(len(PASS) + len(FAIL)) + " 通过")
if FAIL:
    print("失败项: " + "; ".join(FAIL))
raise SystemExit(1 if FAIL else 0)
