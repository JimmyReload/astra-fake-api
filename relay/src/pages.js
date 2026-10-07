// 假中转站的页面。全部是**纯静态字符串** + 一点前端 JS，没有构建步骤、没有模板引擎。
//
// 三条自我约束（写死在代码里，不靠自觉）：
//   1. 登录/注册表单一律 **不发任何网络请求** —— 提交只写 localStorage，页面顶部就写明这一点；
//   2. 充值页的「二维码」是前端用假随机数画的方块阵，**盖着「本站不收钱」水印**，点「我已支付」只弹整活提示；
//   3. 面板里所有数字（余额/用量/日志/令牌）都是写死的假数据，**不从任何请求里读**。
import { ARTS } from "./nailong.js";

// ── 假数据 ────────────────────────────────────────────────────────────────────

// 模型 id 一律用**真实存在**的上游名字（不许自编）：
//   前 5 个 = astra-fake-api 那套（OpenAI 文档页 200 的真名）；
//   后 3 个 = 本机号池 /v1/models 里实测列出的真名。
export const MODELS = [
  { id: "gpt-6-astra", name: "GPT-6 Astra", vendor: "OpenAI", ctx: "400K", price: 1.0, tag: "旗舰", hot: true, desc: "本店招牌。你问什么它都笑。" },
  { id: "gpt-6-astra-pro", name: "GPT-6 Astra Pro", vendor: "OpenAI", ctx: "400K", price: 2.0, tag: "旗舰", desc: "更贵的同款笑容。" },
  { id: "gpt-6-astra-20260903", name: "GPT-6 Astra (20260903)", vendor: "OpenAI", ctx: "400K", price: 1.0, tag: "快照", desc: "钉住某个日期的笑容。" },
  { id: "gpt-6-astra-high", name: "GPT-6 Astra High", vendor: "OpenAI", ctx: "400K", price: 3.0, tag: "高推理", desc: "想得更久，笑得一样。" },
  { id: "gpt-6-luna", name: "GPT-6 Luna", vendor: "OpenAI", ctx: "256K", price: 0.6, tag: "轻量", desc: "便宜、快，还是那张图。" },
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", vendor: "DeepSeek", ctx: "1M", price: 0.08, tag: "性价比", hot: true, desc: "1M 上下文，塞得下一整本书，然后回你奶龙。" },
  { id: "glm-5.2", name: "GLM-5.2", vendor: "智谱", ctx: "200K", price: 0.1, tag: "国产", desc: "国产之光，笑容一致。" },
  { id: "kimi-k3", name: "Kimi K3", vendor: "月之暗面", ctx: "256K", price: 0.12, tag: "长文本", desc: "长文本理解，短文本回图。" },
];

export const LOGS = [
  { t: "2026-10-07 11:42:07", m: "gpt-6-astra", tok: 8421, ms: 912, ok: true },
  { t: "2026-10-07 11:41:33", m: "deepseek-v4.1-flash", tok: 4245, ms: 208, ok: true },
  { t: "2026-10-07 11:39:58", m: "gpt-6-astra-pro", tok: 4245, ms: 341, ok: true },
  { t: "2026-10-07 11:37:12", m: "kimi-k3", tok: 4245, ms: 187, ok: true },
  { t: "2026-10-07 11:35:44", m: "glm-5.2", tok: 4245, ms: 224, ok: true },
  { t: "2026-10-07 11:31:09", m: "gpt-6-luna", tok: 4245, ms: 96, ok: true },
  { t: "2026-10-07 11:28:51", m: "gpt-6-astra", tok: 12688, ms: 1204, ok: true },
  { t: "2026-10-07 11:22:30", m: "gpt-6-astra-high", tok: 4245, ms: 2880, ok: true },
];

export const PLANS = [
  { amount: 10, bonus: 0, label: "尝鲜", note: "够笑一会儿" },
  { amount: 50, bonus: 5, label: "常用", note: "多送 ¥5", best: true },
  { amount: 200, bonus: 40, label: "重度", note: "多送 ¥40" },
  { amount: 1000, bonus: 300, label: "团队", note: "多送 ¥300" },
];

export const STATS = [
  { k: "账户余额", v: "¥ 9,999.99", sub: "本站不收钱，数字随便写" },
  { k: "今日调用", v: "1,284", sub: "全部返回了同一张图" },
  { k: "今日 tokens", v: "5.45M", sub: "其中 100% 是奶龙" },
  { k: "可用模型", v: String(MODELS.length), sub: "行为完全一致" },
];

// ── 样式 ──────────────────────────────────────────────────────────────────────

const CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{
  --bg:#080b10; --bg2:#0d1219; --panel:#111823; --panel2:#151e2b;
  --line:#1e2937; --line2:#2a3746; --fg:#e6edf5; --mut:#8b9bb0; --mut2:#6b7b90;
  --acc:#22d3a6; --acc2:#3b82f6; --warn:#f5b544; --err:#ef5f6b;
  --mono:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",Menlo,monospace;
  --sans:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font-family:var(--sans);font-size:15px;line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:var(--acc);text-decoration:none}
a:hover{text-decoration:underline}
code,kbd,pre{font-family:var(--mono)}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.narrow{max-width:900px}
hr{border:0;border-top:1px solid var(--line);margin:32px 0}

/* 顶部公告条 */
.topbar{background:linear-gradient(90deg,rgba(34,211,166,.14),rgba(59,130,246,.14));border-bottom:1px solid var(--line);font-size:13px;color:#cfe9e2;text-align:center;padding:7px 16px}
.topbar b{color:#fff}

/* 导航 */
nav.site{position:sticky;top:0;z-index:20;background:rgba(8,11,16,.86);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
nav.site .inner{max-width:1120px;margin:0 auto;padding:0 20px;height:60px;display:flex;align-items:center;gap:26px}
.brand{display:flex;align-items:center;gap:9px;font-weight:700;color:var(--fg);font-size:16px;letter-spacing:.2px}
.brand .dot{width:10px;height:10px;border-radius:3px;background:var(--acc);box-shadow:0 0 12px var(--acc)}
nav.site a.lnk{color:var(--mut);font-size:14px}
nav.site a.lnk.on,nav.site a.lnk:hover{color:var(--fg);text-decoration:none}
nav.site .spacer{flex:1}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:9px 16px;border-radius:9px;border:1px solid var(--line2);background:var(--panel);color:var(--fg);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
.btn:hover{border-color:var(--acc);text-decoration:none}
.btn.pri{background:linear-gradient(135deg,var(--acc),#12b48c);color:#04120d;border-color:transparent}
.btn.pri:hover{filter:brightness(1.08)}
.btn.ghost{background:transparent}
.btn.sm{padding:5px 11px;font-size:13px;border-radius:7px}
.btn.danger:hover{border-color:var(--err);color:var(--err)}

/* 通用块 */
.hero{padding:78px 0 60px;position:relative;overflow:hidden}
.hero::before{content:"";position:absolute;inset:0;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:52px 52px;opacity:.3;mask-image:radial-gradient(ellipse 80% 60% at 50% 0%,#000 30%,transparent 75%)}
.hero .wrap{position:relative}
.pill{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--acc);border:1px solid rgba(34,211,166,.35);background:rgba(34,211,166,.08);padding:4px 11px;border-radius:99px;margin-bottom:20px}
h1{font-size:44px;line-height:1.18;margin:0 0 16px;letter-spacing:-.5px}
h1 .grad{background:linear-gradient(120deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent}
h2{font-size:25px;margin:44px 0 14px;letter-spacing:-.2px}
h3{font-size:17px;margin:26px 0 10px}
p.lead{font-size:17px;color:var(--mut);max-width:660px;margin:0 0 26px}
.muted{color:var(--mut)}
.small{font-size:13px}
.tiny{font-size:12px}
.mono{font-family:var(--mono)}
.center{text-align:center}

.grid{display:grid;gap:16px}
.g2{grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.g3{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.g4{grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px}
.card.pad0{padding:0;overflow:hidden}
.card h3{margin:0 0 8px;font-size:16px}
.kpi .k{font-size:13px;color:var(--mut)}
.kpi .v{font-size:26px;font-weight:700;margin:6px 0 2px;letter-spacing:-.5px}
.badge{display:inline-block;font-size:11.5px;padding:2px 8px;border-radius:99px;border:1px solid var(--line2);color:var(--mut)}
.badge.ok{color:var(--acc);border-color:rgba(34,211,166,.4);background:rgba(34,211,166,.08)}
.badge.hot{color:var(--warn);border-color:rgba(245,181,68,.4);background:rgba(245,181,68,.08)}
.badge.off{color:var(--mut2)}
.tag{font-size:11.5px;color:var(--acc2);border:1px solid rgba(59,130,246,.35);background:rgba(59,130,246,.08);padding:2px 8px;border-radius:6px}

table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;color:var(--mut);font-weight:600;font-size:12.5px;text-transform:uppercase;letter-spacing:.4px;padding:11px 14px;border-bottom:1px solid var(--line);background:var(--bg2)}
td{padding:11px 14px;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
tbody tr:hover{background:rgba(255,255,255,.015)}

pre.code{background:#05080c;border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow:auto;font-size:13px;color:#c8d6e5;margin:12px 0}
pre.code .c{color:var(--mut2)}
.note{border-left:3px solid var(--acc);background:rgba(34,211,166,.06);padding:12px 16px;border-radius:0 10px 10px 0;margin:16px 0;font-size:14px}
.note.warn{border-left-color:var(--warn);background:rgba(245,181,68,.07)}
.note.err{border-left-color:var(--err);background:rgba(239,95,107,.07)}

input,select,textarea{width:100%;background:var(--bg2);border:1px solid var(--line2);color:var(--fg);border-radius:9px;padding:10px 13px;font-size:14px;font-family:inherit}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--acc)}
label.fld{display:block;margin:16px 0}
label.fld span{display:block;font-size:13px;color:var(--mut);margin-bottom:6px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}

/* 面板 */
.shell{display:grid;grid-template-columns:216px 1fr;min-height:calc(100vh - 60px)}
aside.side{border-right:1px solid var(--line);background:var(--bg2);padding:20px 12px}
aside.side .grp{font-size:11px;color:var(--mut2);text-transform:uppercase;letter-spacing:.6px;padding:12px 12px 6px}
aside.side a{display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:8px;color:var(--mut);font-size:14px;margin-bottom:2px}
aside.side a:hover{background:var(--panel);color:var(--fg);text-decoration:none}
aside.side a.on{background:rgba(34,211,166,.1);color:var(--acc);font-weight:600}
main.pane{padding:28px 32px 60px;min-width:0}
.panehead{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:22px;flex-wrap:wrap}
.panehead h1{font-size:24px;margin:0}
.panehead p{margin:4px 0 0;color:var(--mut);font-size:13.5px}
.progress{height:6px;border-radius:99px;background:var(--line);overflow:hidden}
.progress i{display:block;height:100%;background:linear-gradient(90deg,var(--acc),var(--acc2))}

/* 假二维码 */
.qr{position:relative;width:180px;height:180px;background:#fff;border-radius:10px;padding:10px;display:grid;grid-template-columns:repeat(25,1fr);grid-template-rows:repeat(25,1fr);gap:0}
.qr i{background:#fff}
.qr i.b{background:#0b0f14}
.qrwrap{position:relative;display:inline-block}
.qrwrap .stamp{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.qrwrap .stamp b{transform:rotate(-18deg);background:rgba(239,95,107,.94);color:#fff;font-size:15px;padding:5px 12px;border-radius:8px;letter-spacing:1px;box-shadow:0 6px 20px rgba(0,0,0,.4)}

/* 页脚 */
footer.site{border-top:1px solid var(--line);margin-top:60px;padding:30px 0 46px;color:var(--mut);font-size:13px}
footer.site .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:22px;margin-bottom:24px}
footer.site b{color:var(--fg);display:block;margin-bottom:8px;font-size:13px}
footer.site .disclaimer{border:1px solid rgba(245,181,68,.3);background:rgba(245,181,68,.06);border-radius:10px;padding:13px 16px;color:#e8d6ae;font-size:12.5px;line-height:1.7}
@media(max-width:820px){
  .shell{grid-template-columns:1fr}
  aside.side{border-right:0;border-bottom:1px solid var(--line);display:flex;gap:6px;overflow-x:auto;padding:10px}
  aside.side .grp{display:none}
  aside.side a{white-space:nowrap;margin:0}
  main.pane{padding:20px 18px 50px}
  h1{font-size:32px}
}
`;

// ── 骨架 ──────────────────────────────────────────────────────────────────────

const TOPBAR = `<div class="topbar"><b>整活站</b>：这是一个假的 AI 中转站，任何调用都只会返回一张奶龙捧腹大笑的 ASCII 图 · 不收钱、不收密钥、不接任何真实上游 · <a href="/about">看这里</a></div>`;

const FOOTER = `<footer class="site"><div class="wrap">
  <div class="cols">
    <div><b>Astra Relay</b><span class="small">一个 OpenAI 兼容的「中转站」。</span></div>
    <div><b>产品</b><a class="small" href="/models">模型广场</a><br><a class="small" href="/docs">接口文档</a><br><a class="small" href="/panel">控制台</a></div>
    <div><b>关于</b><a class="small" href="/about">这是什么</a><br><a class="small" href="/v1/models">/v1/models</a><br><a class="small" href="/about">源码</a></div>
    <div><b>状态</b><span class="small">全部模型：<span class="badge ok">运营中</span></span><br><span class="small">上游：<span class="badge off">无</span></span></div>
  </div>
  <div class="disclaimer">
    <b style="display:inline;margin:0;color:#f5b544">本站是整活站，不是真中转站。</b>
    它<b>不收集</b>你的 API key、账号、密码或任何输入（登录表单只在你的浏览器本地写一个假 token，一个字节都不发出去）；
    它<b>不接</b>任何真实上游模型，<b>不收</b>任何钱（充值页的二维码是画出来的，盖着水印，点了只会告诉你别付）；
    它对<b>任何</b>请求都返回同一张奶龙图。请不要在这里输入任何真实密码或密钥 —— 虽然它根本不会发出去，
    但习惯要养好。想拿真的模型用，请去找真的服务商。
  </div>
  <div class="tiny" style="margin-top:18px">© 2026 Astra Relay（假的）· 图里那只叫奶龙 · 与 OpenAI / Anthropic / 任何真实服务商无任何关系</div>
</div></footer>`;

const NAV = (active) => {
  const on = (k) => (active === k ? "lnk on" : "lnk");
  return `<nav class="site"><div class="inner">
    <a class="brand" href="/"><span class="dot"></span>Astra Relay</a>
    <a class="${on("home")}" href="/">首页</a>
    <a class="${on("models")}" href="/models">模型广场</a>
    <a class="${on("docs")}" href="/docs">接口文档</a>
    <a class="${on("about")}" href="/about">关于</a>
    <span class="spacer"></span>
    <a class="btn sm ghost" href="/login">登录</a>
    <a class="btn sm pri" href="/panel">控制台</a>
  </div></nav>`;
};

export function layout({ title, active = "", body, bare = false }) {
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="一个假的 AI 中转站：任何调用都只会返回一张奶龙捧腹大笑的 ASCII 图。">
<meta name="robots" content="noindex">
<style>${CSS}</style>
</head><body>
${TOPBAR}
${bare ? "" : NAV(active)}
${body}
${FOOTER}
</body></html>`;
}

const PANE = (active, title, sub, body) => {
  const link = (k, href, text) => `<a class="${active === k ? "on" : ""}" href="${href}">${text}</a>`;
  return layout({
    title: title + " · Astra Relay（假的）",
    active: "",
    body: `<div class="shell">
      <aside class="side">
        <div class="grp">控制台</div>
        ${link("panel", "/panel", "概览")}
        ${link("models", "/models", "模型广场")}
        ${link("tokens", "/tokens", "令牌管理")}
        ${link("usage", "/usage", "调用日志")}
        <div class="grp">账户</div>
        ${link("recharge", "/recharge", "充值")}
        ${link("settings", "/settings", "设置")}
        <div class="grp">其它</div>
        <a href="/docs">接口文档</a>
        <a href="/about">关于本站</a>
      </aside>
      <main class="pane">
        <div class="panehead"><div><h1>${title}</h1><p>${sub}</p></div>
          <div class="row"><span class="badge ok">已登录（假的）</span><button class="btn sm" onclick="fakeLogout()">退出</button></div>
        </div>
        ${body}
      </main>
    </div>`,
  });
};

// ── 首页 ──────────────────────────────────────────────────────────────────────

export function landing() {
  const rows = MODELS.slice(0, 6)
    .map(
      (m) => `<tr><td><b>${m.name}</b><div class="tiny muted mono">${m.id}</div></td>
      <td><span class="badge">${m.vendor}</span></td><td class="mono">${m.ctx}</td>
      <td class="mono">×${m.price.toFixed(2)}</td>
      <td><span class="badge ${m.hot ? "hot" : "ok"}">${m.hot ? "热门" : "可用"}</span></td></tr>`,
    )
    .join("");

  return layout({
    title: "Astra Relay · 一个 OpenAI 兼容的中转站（假的）",
    active: "home",
    body: `
<div class="hero"><div class="wrap">
  <span class="pill">● 全部模型运营中 · 平均延迟 0.2s · 可用性 99.99%（编的）</span>
  <h1>一个 API，接入 <span class="grad">${MODELS.length} 个模型</span>。<br>它们全都只会回你一张奶龙。</h1>
  <p class="lead">OpenAI / Anthropic 双协议兼容，改一行 <span class="mono">base_url</span> 就能用。流式、非流式、<span class="mono">count_tokens</span> 全都做了 —— 不管你问什么，正文永远是一张捧腹大笑的奶龙 ASCII 图。</p>
  <div class="row">
    <a class="btn pri" href="/panel">进入控制台</a>
    <a class="btn" href="/models">看看有哪些模型</a>
    <a class="btn ghost" href="/docs">接口文档</a>
  </div>
  <div class="tiny muted" style="margin-top:16px">不需要注册（注册也是假的）、不需要充值（充值也是假的）、token 随便填 —— 反正结果一样。</div>
</div></div>

<div class="wrap">
  <div class="grid g3">
    <div class="card"><h3>🔌 双协议兼容</h3><div class="small muted">OpenAI <span class="mono">/v1/chat/completions</span>、<span class="mono">/v1/responses</span> 与 Anthropic <span class="mono">/v1/messages</span> 都有，流式 SSE 也做了。</div></div>
    <div class="card"><h3>🎭 行为一致</h3><div class="small muted">${MODELS.length} 个模型的输出<b>逐字节相同</b>。选哪个都一样，这是本站唯一的稳定性保证。</div></div>
    <div class="card"><h3>🔓 零门槛</h3><div class="small muted">不需要 key。带了也认，随便填也认，不填也认。反正它只回那张图。</div></div>
    <div class="card"><h3>🖼 图是包在代码块里的</h3><div class="small muted">正文形态是「一行三反引号 + 图 + 一行三反引号」，这样客户端按 Markdown 渲染时才不会把空格吃掉。</div></div>
    <div class="card"><h3>🚫 什么都做不到</h3><div class="small muted">没有 tool_calls、没有图片输入、没有联网、没有记忆。反正回答了也还是奶龙。</div></div>
    <div class="card"><h3>💰 不要钱</h3><div class="small muted">因为没有任何真实上游。充值页是装饰品，别真去扫码。</div></div>
  </div>

  <h2>模型与倍率</h2>
  <div class="card pad0"><table>
    <thead><tr><th>模型</th><th>厂商</th><th>上下文</th><th>倍率</th><th>状态</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <div class="small muted" style="margin-top:10px">倍率是编的。上下文窗口抄的是各家的公开值，但因为输出永远是同一张图，窗口大小其实没有意义。
    <a href="/models">看完整模型广场 →</a></div>

  <h2>三步接入</h2>
  <div class="grid g3">
    <div class="card"><div class="badge">1</div><h3>改 base_url</h3><pre class="code">base_url = "https://api.caar.fun/v1"</pre></div>
    <div class="card"><div class="badge">2</div><h3>key 随便填</h3><pre class="code">api_key = "sk-随便"</pre></div>
    <div class="card"><div class="badge">3</div><h3>然后接受现实</h3><pre class="code">print(r.choices[0].message.content)</pre></div>
  </div>
  <pre class="code"><span class="c"># 完整例子</span>
from openai import OpenAI
client = OpenAI(base_url="https://api.caar.fun/v1", api_key="sk-whatever")
r = client.chat.completions.create(model="gpt-6-astra", messages=[{"role":"user","content":"你好"}])
print(r.choices[0].message.content)
<span class="c"># &#96;&#96;&#96;</span>
<span class="c"># ░░░░░░░░░░░░░░░░░</span>
<span class="c"># ░ 一只捧腹大笑的奶龙 ░</span>
<span class="c"># ...（共 53 行，4,245 字符）</span>
<span class="c"># &#96;&#96;&#96;</span></pre>

  <div class="note warn"><b>先说清楚：</b>这不是一个真的中转站，它没有任何上游模型。所以别把它配成你任何真实项目的
    <span class="mono">base_url</span>，也别在这里填真实密钥 —— 虽然它根本不会把请求发出去，但习惯要养好。
    想知道它到底是什么，看 <a href="/about">关于本站</a>。</div>
</div>`,
  });
}

// ── 登录 ──────────────────────────────────────────────────────────────────────

export function loginPage() {
  return layout({
    title: "登录 · Astra Relay（假的）",
    active: "",
    bare: true,
    body: `<div class="wrap narrow" style="padding:56px 20px 20px;max-width:460px">
  <div class="card">
    <div class="center" style="margin-bottom:22px">
      <div class="brand" style="justify-content:center;font-size:19px"><span class="dot"></span>Astra Relay</div>
      <div class="small muted" style="margin-top:6px">登录 / 注册（都不需要，也都不发出去）</div>
    </div>

    <div class="note err" style="margin-top:0"><b>请不要输入任何真实密码。</b>
      这个表单<b>不会发送任何网络请求</b>：点「登录」只会在你浏览器本地写一个假 token，然后跳到控制台。
      想看证据？按 F12 打开 Network 面板，再点一次登录 —— 一条请求都不会有。</div>

    <form id="f" onsubmit="return fakeLogin(event)">
      <label class="fld"><span>用户名 / 邮箱</span>
        <input id="u" placeholder="随便填，比如 nailong@example.com" autocomplete="off"></label>
      <label class="fld"><span>密码</span>
        <input id="p" type="password" placeholder="随便填（真的，别填你常用的）" autocomplete="off"></label>
      <label class="fld"><span>邀请码（可选）</span>
        <input id="i" placeholder="NailongLaughs" autocomplete="off"></label>
      <button class="btn pri" style="width:100%;margin-top:6px" type="submit">登录（假的）</button>
    </form>
    <div class="tiny muted center" style="margin-top:14px">没有真实账号系统。任何输入都会被接受，因为没有任何东西被校验或保存。</div>
  </div>

  <div class="card" style="margin-top:16px">
    <div class="small muted">控制台里的一切（余额 ¥9,999.99、令牌、用量曲线、调用日志）都是<b>写死的假数据</b>。
      它们不在服务端存在，也不来自你的输入。</div>
  </div>
  <div class="center small" style="margin-top:18px"><a href="/">← 回首页</a></div>
</div>

<script>
function fakeLogin(e){
  e.preventDefault();
  try{
    var u = (document.getElementById('u').value || 'nailong@example.com');
    localStorage.setItem('astra_relay_user', u);
    localStorage.setItem('astra_relay_token', 'sk-fake-' + Math.random().toString(36).slice(2, 14));
  }catch(err){}
  location.href = '/panel';
  return false;
}
function fakeLogout(){
  try{ localStorage.removeItem('astra_relay_user'); localStorage.removeItem('astra_relay_token'); }catch(err){}
  location.href = '/login';
}
function whoami(){
  try{ return localStorage.getItem('astra_relay_user') || 'nailong@example.com'; }catch(err){ return 'nailong@example.com'; }
}
</script>`,
  });
}

// ── 控制台 ────────────────────────────────────────────────────────────────────

export function panelPage() {
  const kpis = STATS.map(
    (s) => `<div class="card kpi"><div class="k">${s.k}</div><div class="v">${s.v}</div><div class="tiny muted">${s.sub}</div></div>`,
  ).join("");

  const logRows = LOGS.slice(0, 6)
    .map(
      (l) => `<tr><td class="mono tiny">${l.t}</td><td class="mono">${l.m}</td><td class="mono">${l.tok.toLocaleString()}</td>
      <td class="mono">${l.ms} ms</td><td><span class="badge ok">200</span></td></tr>`,
    )
    .join("");

  // 假用量曲线（写死的点，纯 SVG）
  const pts = [8, 14, 11, 22, 19, 31, 27, 38, 34, 46, 41, 52, 47, 58, 55, 67, 61, 72, 68, 79, 74, 86, 82, 91];
  const poly = pts.map((v, i) => `${(i / (pts.length - 1)) * 640},${140 - v * 1.35}`).join(" ");

  return PANE("panel", "概览", "下面每一个数字都是写死的假数据 —— 本站不收钱、不记账、也不认识你。", `
  <div class="grid g4">${kpis}</div>

  <div class="card" style="margin-top:18px">
    <div class="row" style="justify-content:space-between"><h3 style="margin:0">近 24 小时用量</h3><span class="badge">单位：tokens（编的）</span></div>
    <svg viewBox="0 0 640 150" style="width:100%;height:150px;margin-top:14px" preserveAspectRatio="none">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#22d3a6" stop-opacity=".35"/><stop offset="100%" stop-color="#22d3a6" stop-opacity="0"/>
      </linearGradient></defs>
      <polyline points="${poly}" fill="none" stroke="#22d3a6" stroke-width="2"/>
      <polygon points="0,150 ${poly} 640,150" fill="url(#g)"/>
    </svg>
  </div>

  <h2 style="font-size:19px">最近调用</h2>
  <div class="card pad0"><table>
    <thead><tr><th>时间</th><th>模型</th><th>tokens</th><th>耗时</th><th>状态</th></tr></thead>
    <tbody>${logRows}</tbody>
  </table></div>
  <div class="small muted" style="margin-top:10px">每一次「调用」返回的都是同一张 4,245 字符的图。<a href="/usage">看全部日志 →</a></div>

  <div class="note"><b>欢迎来到控制台。</b>你看到的余额、令牌、用量曲线、调用日志全都是为了「像那么回事」而写死的。
    真正能用的只有 <span class="mono">/v1</span> 那几个接口 —— 它们会给你一张奶龙。</div>

<script>
document.addEventListener('DOMContentLoaded', function(){
  var els = document.querySelectorAll('[data-user]');
  for (var i=0;i<els.length;i++) els[i].textContent = whoami();
});
</script>`);
}

// ── 模型广场 ──────────────────────────────────────────────────────────────────

export function modelsPage() {
  const cards = MODELS.map(
    (m) => `<div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><h3 style="margin:0 0 4px">${m.name}</h3><div class="tiny mono muted">${m.id}</div></div>
        <span class="badge ${m.hot ? "hot" : ""}">${m.tag}</span>
      </div>
      <div class="small muted" style="margin:12px 0 14px;min-height:42px">${m.desc}</div>
      <div class="row tiny muted" style="gap:14px">
        <span>厂商 <b class="mono" style="color:var(--fg)">${m.vendor}</b></span>
        <span>上下文 <b class="mono" style="color:var(--fg)">${m.ctx}</b></span>
        <span>倍率 <b class="mono" style="color:var(--fg)">×${m.price.toFixed(2)}</b></span>
      </div>
      <div class="row" style="margin-top:14px">
        <span class="badge ok">运营中</span>
        <span class="badge">输出 = 奶龙</span>
      </div>
    </div>`,
  ).join("");

  return PANE("models", "模型广场", `共 ${MODELS.length} 个模型。它们的输出<b>逐字节相同</b> —— 选哪个都一样。`, `
  <div class="note warn" style="margin-top:0">这里列的是<b>真实存在</b>的模型 id（不是编的），但本站<b>没有任何上游</b>：
    请求不会转发给任何厂商，模型名只是被原样回显在响应里。倍率、上下文、标签都是为了好看编的。</div>
  <div class="grid g2" style="margin-top:18px">${cards}</div>

  <h2 style="font-size:19px">按 id 调用的样子</h2>
  <pre class="code">curl https://api.caar.fun/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-随便填" \\
  -d '{"model":"gpt-6-astra","messages":[{"role":"user","content":"1+1=?"}]}'</pre>
  <div class="small muted">响应是标准的 <span class="mono">chat.completion</span>，正文是一张奶龙。</div>`);
}

// ── 令牌 ──────────────────────────────────────────────────────────────────────

export function tokensPage() {
  const rows = [
    { n: "默认令牌", k: "sk-astra-····9f2c", q: 62, used: "38.2M", exp: "永不过期" },
    { n: "给朋友的", k: "sk-friend-····41ab", q: 12, used: "88.4M", exp: "2026-12-31" },
    { n: "测试用", k: "sk-test-····7d10", q: 100, used: "0", exp: "永不过期" },
  ]
    .map(
      (t) => `<tr><td><b>${t.n}</b><div class="tiny mono muted">${t.k}</div></td>
    <td><div class="progress" style="width:130px"><i style="width:${t.q}%"></i></div><div class="tiny muted" style="margin-top:5px">剩余 ${t.q}% · 已用 ${t.used}</div></td>
    <td class="tiny">${t.exp}</td>
    <td><button class="btn sm ghost" onclick="fakeCopy('${t.k}')">复制</button>
        <button class="btn sm danger" onclick="fakeJoke('删除')">删除</button></td></tr>`,
    )
    .join("");

  return PANE("tokens", "令牌管理", "这些令牌是画上去的。服务端不认任何令牌 —— 不填也能用。", `
  <div class="note warn" style="margin-top:0"><b>本站不校验令牌。</b>上面这些 <span class="mono">sk-</span> 开头的串只是字符串，
    服务端不存、不读、也不比对。你带真的 key、假的 key、或者什么都不带，得到的都是同一张奶龙。</div>

  <div class="row" style="margin:18px 0"><button class="btn pri" onclick="fakeCreate()">+ 创建令牌（假的）</button>
    <span class="small muted">点了会在你浏览器本地生成一个随机串，不发请求。</span></div>

  <div class="card pad0"><table>
    <thead><tr><th>名称 / 令牌</th><th>额度</th><th>过期</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>

  <h2 style="font-size:19px">怎么用它</h2>
  <pre class="code"><span class="c"># 带上它（或者不带，无所谓）</span>
curl https://api.caar.fun/v1/models -H "Authorization: Bearer sk-随便"
<span class="c"># 也认 x-api-key / api-key 头，跟主流 SDK 的习惯一致</span></pre>

<script>
function fakeCopy(s){ try{ navigator.clipboard.writeText(s); }catch(e){} alert('复制了一个假的令牌：' + s + '\\n\\n（本站不校验它，随便填也一样）'); }
function fakeCreate(){
  var k = 'sk-fake-' + Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,6);
  alert('生成了（在浏览器本地）：' + k + '\\n\\n本站不收、不存、不校验令牌 —— 这个串只是给你看着舒服。');
}
function fakeJoke(what){ alert(what + '功能是装饰品。本站不存任何东西，所以也没什么可' + what + '的。'); }
</script>`);
}

// ── 调用日志 ──────────────────────────────────────────────────────────────────

export function usagePage() {
  const rows = LOGS.concat(LOGS.map((l) => ({ ...l, t: l.t.replace("11:", "10:") })))
    .map(
      (l) => `<tr><td class="mono tiny">${l.t}</td><td class="mono">${l.m}</td><td class="mono">${l.tok.toLocaleString()}</td>
      <td class="mono">${l.ms} ms</td><td class="mono tiny muted">4,245 字符</td><td><span class="badge ok">200</span></td></tr>`,
    )
    .join("");

  return PANE("usage", "调用日志", "全是写死的假日志。真实请求不会在这里留下任何痕迹（服务端不记日志）。", `
  <div class="note" style="margin-top:0">本站<b>不写访问日志、不记请求体</b>。这张表是硬编码的，
    用来让控制台看起来像那么回事。</div>
  <div class="card pad0" style="margin-top:18px"><table>
    <thead><tr><th>时间</th><th>模型</th><th>tokens</th><th>耗时</th><th>输出大小</th><th>状态</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`);
}

// ── 充值 ──────────────────────────────────────────────────────────────────────

export function rechargePage() {
  const cards = PLANS.map(
    (p) => `<div class="card ${p.best ? "" : ""}" style="${p.best ? "border-color:rgba(34,211,166,.45)" : ""}">
      <div class="row" style="justify-content:space-between"><h3 style="margin:0">${p.label}</h3>${p.best ? '<span class="badge ok">最受欢迎（编的）</span>' : ""}</div>
      <div style="font-size:30px;font-weight:700;margin:12px 0 2px">¥${p.amount}</div>
      <div class="small muted">${p.note}</div>
      <button class="btn ${p.best ? "pri" : ""}" style="width:100%;margin-top:16px" onclick="fakePay(${p.amount})">选择这个（别真付）</button>
    </div>`,
  ).join("");

  return PANE("recharge", "充值", "本站不收钱。下面这个二维码是前端画出来的方块阵，扫不出任何东西。", `
  <div class="note err" style="margin-top:0"><b>请不要付款。</b>本站没有收款能力、没有商户号、也没有任何真实上游要花钱。
    这个页面纯粹是「中转站长什么样」的一部分装饰。点了支付按钮只会弹一句话告诉你别付。</div>

  <div class="grid g4" style="margin-top:18px">${cards}</div>

  <div class="card" style="margin-top:18px">
    <h3>扫码支付（扫不出来）</h3>
    <div class="row" style="gap:26px;align-items:flex-start;margin-top:14px">
      <div class="qrwrap">
        <div class="qr" id="qr"></div>
        <div class="stamp"><b>本站不收钱</b></div>
      </div>
      <div style="flex:1;min-width:220px">
        <div class="small muted">这个方块阵是用浏览器的随机数现画的，没有编码任何内容，也没有对应的收款账户。
          它长得像二维码，仅此而已。</div>
        <div class="row" style="margin-top:14px">
          <button class="btn" onclick="fakePay(0)">我已支付（并没有）</button>
          <button class="btn ghost" onclick="fakeJoke('开发票')">开发票</button>
        </div>
        <div class="tiny muted" style="margin-top:14px">支持的支付方式：<span class="badge off">无</span>
          <span class="badge off">也不支持</span></div>
      </div>
    </div>
  </div>

  <h3>余额说明</h3>
  <div class="small muted">控制台里显示的 ¥9,999.99 是写死的。本站不做账、不扣费、也没有「额度用尽」这回事 ——
    因为没有任何东西被消耗。</div>

<script>
function fakePay(n){
  alert(n ? ('别付。本站不收钱 —— ¥' + n + ' 这个价格是编的，没有对应的收款账户。') : '你并没有支付任何东西，本站也没有收到任何东西。这是整活站。');
}
function fakeJoke(w){ alert(w + '功能不存在。本站没有经营主体，也没有钱可收。'); }
document.addEventListener('DOMContentLoaded', function(){
  var qr = document.getElementById('qr');
  if(!qr) return;
  var s = 20261007;
  function rnd(){ s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
  for (var i=0;i<625;i++){
    var d = document.createElement('i');
    if (rnd() > 0.52) d.className = 'b';
    qr.appendChild(d);
  }
});
</script>`);
}

// ── 设置 ──────────────────────────────────────────────────────────────────────

export function settingsPage() {
  return PANE("settings", "设置", "这些开关不会保存到任何地方 —— 刷新就没了。", `
  <div class="grid g2">
    <div class="card">
      <h3>账户</h3>
      <label class="fld"><span>显示名</span><input data-user placeholder="nailong@example.com"></label>
      <label class="fld"><span>邮箱</span><input placeholder="nailong@example.com"></label>
      <div class="small muted">这两个值只存在于你浏览器的 localStorage 里（而且只是给你看着玩的）。</div>
    </div>
    <div class="card">
      <h3>偏好</h3>
      <label class="fld"><span>默认模型</span>
        <select><option>gpt-6-astra</option><option>gpt-6-astra-pro</option><option>deepseek-v4.1-flash</option></select></label>
      <label class="fld"><span>默认输出格式</span>
        <select><option>Markdown 代码块（推荐）</option><option>纯文本</option></select></label>
      <div class="small muted">不管选什么，回来的都是同一张图。第二个选项只是让你感觉有得选。</div>
    </div>
  </div>

  <div class="card" style="margin-top:18px">
    <h3>危险操作</h3>
    <div class="row"><button class="btn danger" onclick="fakeJoke('注销账号')">注销账号</button>
      <button class="btn danger" onclick="fakeJoke('清空数据')">清空所有数据</button>
      <span class="small muted">本站没有你的账号，也没有你的数据。</span></div>
  </div>

<script>
function fakeJoke(w){ alert(w + '：本站没有账号系统，也没有存过你的任何数据，所以没什么可' + w + '的。'); }
document.addEventListener('DOMContentLoaded', function(){
  var els = document.querySelectorAll('[data-user]');
  for (var i=0;i<els.length;i++){ els[i].value = whoami(); }
});
</script>`);
}

// ── 文档 ──────────────────────────────────────────────────────────────────────

export function docsPage() {
  const rows = [
    ["POST", "/v1/chat/completions", "OpenAI 对话补全（含流式 SSE）"],
    ["POST", "/v1/responses", "OpenAI Responses 形状"],
    ["POST", "/v1/messages", "Anthropic Messages 形状"],
    ["POST", "/v1/messages/count_tokens", "Anthropic token 计数"],
    ["GET", "/v1/models", "模型清单（与模型广场同一份）"],
    ["GET", "/api/status", "假的面板状态接口"],
    ["GET", "/api/models", "假的模型接口"],
    ["GET", "/api/pricing", "假的价目接口"],
    ["GET", "/api/user/self", "假的用户信息"],
    ["GET", "/api/token/", "假的令牌列表"],
    ["GET", "/api/log/self", "假的调用日志"],
    ["*", "其它任何路径", "200 + 裸图（不 404）"],
  ]
    .map(([m, p, d]) => `<tr><td><span class="badge">${m}</span></td><td class="mono small">${p}</td><td class="small muted">${d}</td></tr>`)
    .join("");

  return layout({
    title: "接口文档 · Astra Relay（假的）",
    active: "docs",
    body: `<div class="wrap narrow" style="padding-top:44px">
  <h1 style="font-size:32px">接口文档</h1>
  <p class="lead">跟真的中转站文档长得一样。区别是：这里的每个接口都只会回一张奶龙。</p>

  <h2 style="font-size:20px">鉴权</h2>
  <div class="note"><b>不需要鉴权。</b>下面几个头都认，但认不认结果一样：<span class="mono">Authorization: Bearer &lt;任意&gt;</span>、
    <span class="mono">x-api-key</span>、<span class="mono">api-key</span>、<span class="mono">x-auth-token</span>。
    不填也 200。本站不校验、不存储、不转发任何令牌。</div>

  <h2 style="font-size:20px">端点</h2>
  <div class="card pad0"><table><thead><tr><th>方法</th><th>路径</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table></div>

  <h2 style="font-size:20px">响应长什么样</h2>
  <pre class="code">{
  "id": "chatcmpl-xxxxxxxxxx",
  "object": "chat.completion",
  "created": 1759800000,
  "model": "gpt-6-astra",
  "system_fingerprint": "fp_nailong_laughing",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "\\u0060\\u0060\\u0060\\n░░░░░...（53 行）...▓▓▓\\n\\u0060\\u0060\\u0060"
    },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 9, "completion_tokens": 1063, "total_tokens": 1072 }
}</pre>
  <div class="small muted">正文是「一行三反引号 + 53 行图 + 一行三反引号」。围栏长度不是写死的，是按图里最长连续反引号串算的。</div>

  <h2 style="font-size:20px">流式</h2>
  <div class="small muted">加 <span class="mono">"stream": true</span> 就逐行吐图，最后恰好一个 <span class="mono">data: [DONE]</span>，
    还有一个带 <span class="mono">usage</span> 的收尾帧。</div>

  <h2 style="font-size:20px">面板接口</h2>
  <div class="small muted"><span class="mono">/api/*</span> 下的接口返回的是<b>写死的假数据</b>，形状模仿常见中转站面板。
    它们不读请求体、不校验登录态、也不写任何日志。看到 <span class="mono">success: true</span> 不代表任何事情发生过。</div>

  <div class="note warn" style="margin-top:26px">这份文档描述的是一个<b>假服务</b>。别把它接进真实业务。</div>
</div>`,
  });
}

// ── 关于 ──────────────────────────────────────────────────────────────────────

export function aboutPage() {
  return layout({
    title: "关于本站 · Astra Relay（假的）",
    active: "about",
    body: `<div class="wrap narrow" style="padding-top:44px">
  <h1 style="font-size:32px">关于本站</h1>
  <p class="lead">一句话：这是一个<b>整活站</b>。它长得像一个 AI 中转站，但任何调用都只会返回一张奶龙捧腹大笑的 ASCII 图。</p>

  <h2 style="font-size:20px">它不做什么</h2>
  <div class="grid g2">
    <div class="card"><h3>不收集任何东西</h3><div class="small muted">登录/注册表单是纯前端的：点提交只在你浏览器本地写一个假 token，
      一个字节都不发出去。服务端不写访问日志、不记请求体、不存令牌。</div></div>
    <div class="card"><h3>不收任何钱</h3><div class="small muted">充值页的「二维码」是前端用随机数画的方块阵，盖着「本站不收钱」水印，
      扫不出任何东西；点支付按钮只会弹一句提示。没有商户号，也没有收款账户。</div></div>
    <div class="card"><h3>不接任何真实上游</h3><div class="small muted">模型清单里的 id 都是真实存在的名字，但请求<b>不会转发</b>给任何厂商 ——
      名字只是被原样回显在响应里。</div></div>
    <div class="card"><h3>不假装能干活</h3><div class="small muted">没有 tool_calls、没有图片输入、没有联网、没有记忆、没有多轮上下文。
      它只会笑。</div></div>
  </div>

  <h2 style="font-size:20px">它做什么</h2>
  <div class="small muted">对任何请求返回同一张 4,245 字符 / 53 行的奶龙图，并把它包进 Markdown 代码围栏里
    （这样客户端按 Markdown 渲染时才不会把空格吃掉、把长行折了）。OpenAI 与 Anthropic 两套接口外形都伪装了，
    连流式 SSE 都做了。<b>不存在的路径也不 404</b> —— 照样给你奶龙。</div>

  <h2 style="font-size:20px">为什么做这个</h2>
  <div class="small muted">因为好玩。这是一个「如果所有模型都只会回奶龙会怎样」的玩笑，顺便演示一下
    OpenAI / Anthropic 两套协议的最小可用外形长什么样。</div>

  <h2 style="font-size:20px">源码</h2>
  <div class="small muted">纯 Cloudflare Workers，零依赖、零构建步骤。主服务（伪装成 <span class="mono">gpt.caar.fun</span> 的那个）
    与本站是两个独立的 Worker，共用同一份图。源码在
    <a href="https://github.com/JimmyReload/astra-fake-api">github.com/JimmyReload/astra-fake-api</a>。</div>

  <div class="note err" style="margin-top:26px"><b>请勿把它当作真实服务使用。</b>不要把它配成任何真实项目的
    <span class="mono">base_url</span>，不要在这里输入真实密码或密钥（虽然它根本不会发出去，但习惯要养好）。
    要真的模型，请去找真的服务商。</div>

  <div class="center" style="margin-top:26px"><a class="btn" href="/">← 回首页</a></div>
</div>`,
  });
}

export { CSS, FOOTER, TOPBAR, NAV, PANE };
