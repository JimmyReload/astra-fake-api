# ChatGPT-Astra 伪装 API（只会回奶龙）

一个零依赖的 HTTP 服务，**任何调用都只会返回一张「奶龙捧腹大笑」的 ASCII 图**。
伪装了 OpenAI Chat Completions / Responses、Anthropic Messages 三套接口外形，连流式 SSE 都做了，
但不管你怎么问、问什么、带不带模型名，正文永远只有那张图 —— 而且**不存在的路径也不会 404**，照样给你奶龙。

仓库里是**两套行为等价的实现**：`server.py`（Python 标准库，本机跑）和 `worker/`（Cloudflare Workers，云端跑）。
两套各自带独立验收脚本，判据逐条对齐（17 项 / 24 项）。

## 快速开始

```powershell
cd astra-fake-api
python server.py                 # 默认 http://127.0.0.1:8787
```

或者双击 `start.cmd`（等价）。换端口/换监听地址：

```powershell
python server.py --port 9000 --host 0.0.0.0     # 0.0.0.0 = 局域网都能来逗奶龙
```

想直接看效果：

```powershell
python demo_request.py           # 打一发 chat.completions
python demo_request.py --stream  # 看它一帧一帧地笑
python demo_request.py --path /whatever --head   # 连响应头一起看
```

## 端点

| 方法 | 路径 | 返回 |
| --- | --- | --- |
| POST | `/v1/chat/completions` | Chat Completions 外壳（`stream: true` 走 SSE，逐行吐图） |
| POST | `/v1/responses` | Responses API 外壳（`response.output_text.delta` 等全套事件） |
| POST | `/v1/messages` | Anthropic Messages 外壳（`content_block_delta` 等） |
| POST | `/v1/messages/count_tokens` | 假装数 token |
| GET | `/v1/models` | 5 个并不存在的 Astra 模型 |
| 任意 | 其余任何路径/方法 | 裸文本版的同一张图（**永不 404**） |

参数：`?art=hd`（默认，照片版）/ `blocks`（手绘方块版）/ `ascii`（纯 ASCII 版）；`?stream=1` 可在 GET 上强制流式。
模型名会被原样回显，所以填什么模型都能“通过”。

## 接到客户端上

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8787/v1", api_key="sk-随便填")
r = client.chat.completions.create(model="astra-1", messages=[{"role": "user", "content": "你是谁"}])
print(r.choices[0].message.content)   # 一张奶龙
```

```python
# 流式也支持
for chunk in client.chat.completions.create(model="astra-1", messages=[], stream=True):
    print(chunk.choices[0].delta.content or "", end="")
```

Anthropic SDK 同理，`base_url` 指到 `http://127.0.0.1:8787` 即可。

### 接进 DSH 当可选模型（2026-10-07 已在本机接上）

`~/.dsh/settings.yaml` 的 `llm-pi-ai.providers` 里加一块（模型清单得从 `GET /v1/models` 抄下来，pi-ai 不动态发现）：

```yaml
    nailong:
      displayName: 奶龙(整活·只回 ASCII 图)
      api: openai-completions
      baseURL: https://gpt.caar.fun/v1
      apiKeyEnv: NAILONG_API_KEY      # 值随便填，服务端零鉴权
      defaultInput: [text]
      models:
        - id: astra-1
          name: astra-1
        # astra-1-mini / astra-1-pro / chatgpt-astra-latest / gpt-5-astra 同理
```

再往 `~/.dsh/.credentials.yaml` 的 `refs` 里加一行 `NAILONG_API_KEY: sk-nailong-laughing-placeholder`。
settings.yaml 是**热重载**的，改完不用重启 DSH，GUI 的模型选择器里立刻多出「奶龙(整活·只回 ASCII 图)」。

**端到端实测（2026-10-07，全程未重启）**：拿 DSH 自己的 workflow 子代理走 `provider=nailong / model=astra-1`，
返回 **9,169 字符 / 70 个非空行**，与 `art_hd.txt` 逐字节一致 —— 说明 DSH 的 LLM 栈
（Node 内置 fetch / undici，UA 就是 `node`）能直接打这个接口，**不需要任何 UA 伪装**（见文末实测表）。
撤掉 = 删掉上面那块 + `refs` 里的那一行，备份在 `settings.yaml.bak-20261007-061756`。

## 文件

| 文件 | 作用 |
| --- | --- |
| `server.py` | Python 版服务本体，只用标准库（Python 3.10+） |
| `art_hd.txt` | 默认那版图（照片转 ASCII，70 行 × 130 列）—— **改这个文件即可换图，无需重启** |
| `smoke_test.py` | Python 版独立验收脚本，17 项判据 |
| `verify_deployed.py` | 对**已部署**的线上地址做验收（固定带浏览器签名 UA，避开 CF 对 python-urllib 的 1010） |
| `demo_request.py` | 手动调一发看效果（`--port / --path / --model / --stream / --head`） |
| `start.cmd` | 双击启动（纯 ASCII，避免 cmd 解析中文的坑） |
| `extract_pasted_art.py` | 从 DSH 会话日志里把粘贴的图字节精确抠出来（手抄必然出错才写的） |
| `art_hd_preview.png` | 上面那张图的 PNG 预览，方便肉眼看 |
| `worker/src/index.js` | Cloudflare Workers 版服务本体 |
| `worker/src/art.js` | **自动生成**的三版图，由 `build_art.py` 从 `server.py` + `art_hd.txt` 产出（别手改） |
| `worker/build_art.py` | 上面那个生成器 —— 图只有一份来源，防止两边跑偏 |
| `worker/test_worker.mjs` | Worker 版独立验收脚本，24 项判据（纯 Node，不连云、不用装 wrangler） |
| `worker/wrangler.toml` | 部署配置（含 `gpt.caar.fun` 自定义域名路由、`workers_dev` 开关、日期与原因注释） |

## 验收

```powershell
python smoke_test.py             # Python 版：17 项
cd worker; node test_worker.mjs  # Worker 版：24 项
```

实测 **17/17 通过**（2026-10-07，Python 3.13）：三套接口的非流式内容与 `art_hd.txt` 逐字节相同；
三套流式拼接结果与非流式逐字符相同（证明没漏帧、没截断）；`[DONE]` 唯一；
未知路径 / DELETE / OPTIONS / 畸形请求体一律 200 + 原图；`?art=` 三个版本都能切。
脚本自己先探端口占用，被占就退出，避免 Windows 上 `SO_REUSEADDR` 双绑导致「旧进程冒充新服务」。

Worker 版同一套判据跑在 Node 里，实测 **24/24 通过**：`art.js` 与 `art_hd.txt` 逐字节相同、
响应头带 CORS 与奶龙标记、三套接口非流式/流式事件全齐、`count_tokens` 与 `/v1/models` 照旧。

> 关于 `OPTIONS /v1/chat/completions`：分发是**按路径**做的，所以预检请求得到的也是 JSON 外壳
> （奶龙在 `choices[0].message.content` 里），不是裸图 —— 两套实现一致，验收脚本也照这个判据写。
> （写验收时这里差点误判成 bug，记一笔。）

## 部署到云端（Cloudflare Workers）

`worker/` 是等价实现，不用服务器、自带 HTTPS。

命令行（本机实测路径）：

```powershell
cd worker
npx wrangler login     # 浏览器里点一下授权，只需一次
npx wrangler deploy    # 输出 https://astra-fake-api.<你的子域>.workers.dev
```

本仓库的 `wrangler.toml` 里已经有一条 `routes`，把 `gpt.caar.fun` 挂成了自定义域名 —— 换成你自己的域名只改那一行；
删掉它并按需删掉 `workers_dev = true`，就只剩 `*.workers.dev` 一个入口。

不想用命令行：Cloudflare 控制台 → **Workers & Pages → Create → Import a repository** → 选这个仓库 →
**Root directory 填 `worker`**，构建命令留空，部署命令 `npx wrangler deploy`。之后每次 push 自动重部署。

图与文案只有一份来源，改了 Python 版后重跑生成器即可（别手改 `src/art.js`）：

```powershell
cd worker
python build_art.py    # 打印三版图的字符数 / 行数 / sha256
node test_worker.mjs   # 顺手验一遍
```

### 已部署实例（2026-10-07）

两个入口（Version ID `aefb5ec2`，行为完全一致）：

| 入口 | 地址 |
| --- | --- |
| 自定义域名 | **<https://gpt.caar.fun>** |
| `*.workers.dev` | **<https://astra-fake-api.3152841984.workers.dev>** |

用仓库自带的脚本验线上那份部署产物（不是验本地代码）：

```powershell
python verify_deployed.py https://gpt.caar.fun
python verify_deployed.py https://astra-fake-api.3152841984.workers.dev
```

实测两个入口各 **8/8 通过**：线上返回的图与本地 `art_hd.txt` 逐字节一致、流式拼接一致、`[DONE]` 唯一、
未知路径照回裸图、CORS 与 `X-Powered-By: nailong-laughing-engine` 都在。

> 部署时踩到的三个坑（都实测过）：
> 1. `compatibility_date` 不能写「当天」。本机在 UTC+8，而 Cloudflare 按自己的时钟判定，
>    本地已跨日而 UTC 还没跨日时会报 `Can't set compatibility date in the future`（code 10021）部署失败。
>    所以这里固定写了一个明确已过去的日期。
> 2. **配了 `routes` 之后 wrangler 会默认关掉 `workers.dev`**：加自定义域名的第一次部署，旧 URL 当场变 404
>    （API 读数是 `{"enabled": false}`），必须在 `wrangler.toml` 里显式写 `workers_dev = true` 才能两个入口并存。
> 3. **挂自定义域名并不能绕开 1010**：`caar.fun` 这个 zone 的 `browser_check = on`，所以换成自己的域名后，
>    python-urllib 这类签名依旧被挡（同一个 `error code: 1010`）。那是 zone 级设置，与 `*.workers.dev` 无关。
>    不过实测 curl 与各家 SDK 的默认 UA 在两个入口都是 200 —— 详见文末「已知限制」里的实测表。

## 设计上的几个刻意选择

- **非标路径也回图**：这笑话的重点就是「任何调用」，所以未知路由不 404，而是 200 + 奶龙。
- **按路径分发、不按方法**：七种 HTTP 方法全进同一个处理函数，所以 `OPTIONS /v1/chat/completions` 拿到的是
  JSON 外壳（与 GET/POST 相同），未识别路径拿到的才是裸图。两套实现共用这套规则。
- **图单一来源**：Worker 的图由 `build_art.py` 从 `server.py` 的字符串常量与 `art_hd.txt` 生成，
  避免两边各改一份后内容跑偏（验收里有一条就是逐字节比对这两处）。
- **HTTP/1.1 + `Connection: close`**：流式不出 `Content-Length`，靠关连接界定正文，省掉 chunked 的麻烦。
- **`allow_reuse_address = False` + 启动前探端口**：Windows 上 `SO_REUSEADDR` 会让两个进程绑同一端口、
  请求全给先绑的那个，会掩盖「服务没起起来」。
- **stdout 强制 UTF-8**：Windows 上输出被重定向时默认 GBK，打印方块字符会直接 UnicodeEncodeError。

## 已知限制（如实标注）

- **没有任何鉴权**：谁都能调。Python 版默认只绑 `127.0.0.1`；要用 `--host 0.0.0.0` 就自己承担后果。
- **公网部署 = 全网都能来逗奶龙**：Worker 版一旦公开，`*.workers.dev` 很快会被扫到。
  这本来就是玩笑接口，别把它挂在任何跟真实业务有关的域名或路径下（尤其别配成某个客户端的默认 `base_url`）。
- HD 版 130 列宽，手机/窄终端里会折行（这是图本身的分辨率，不是 bug）。
- 没有实现 tool_calls / function calling / 图片输入等真实能力——反正回答了也还是奶龙。
- 未做 TLS、未做并发压测；Python 版用 `ThreadingHTTPServer`，只适合自娱自乐和本机演示。
- **按 UA 挡机器人（`403 / error code: 1010`）—— 但只挡特定签名**：实测（同一出口 IP，两个入口各测一遍）：

  | User-Agent | `gpt.caar.fun` | `*.workers.dev` |
  | --- | --- | --- |
  | `Python-urllib/3.13` | **403 `error code: 1010`** | **403 `error code: 1010`** |
  | `curl/8.9.1` | 200 | 200 |
  | `OpenAI/Python 2.6.1` | 200 | 200 |
  | `Anthropic/Python 0.40.0` | 200 | 200 |
  | `node-fetch/1.0` | 200 | 200 |
  | `axios/1.7.2` | 200 | 200 |
  | `node`（Node 内置 fetch / undici —— **DSH 自己的 LLM 栈发的就是它**） | 200 | 200 |
  | `undici` | 200 | 200 |
  | Edge 浏览器签名 | 200 | 200 |

  也就是说 **OpenAI / Anthropic SDK 直接指过来就能用**，不必伪造 UA；会踩坑的主要是 python-urllib 这一类默认客户端
  （`verify_deployed.py` 因此仍固定带浏览器签名，让「服务坏了」和「被边缘挡了」不混在一起）。
  起因是该 zone 的 `browser_check = on`，在请求进到 Worker 之前就生效，**换成自有域名也躲不掉**；
  想彻底放开得改那个 zone 的安全设置，而那会同时影响该 zone 下的其它站点，不建议为这个玩笑接口去动。
