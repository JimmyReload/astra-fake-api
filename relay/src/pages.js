// 假中转站的页面层：字符串拼接 + 内联原生 JS。零依赖、零构建。
//
// ⚠️ 这份文件同时承担两件事，改的时候别只顾一件：
//   1) 「看起来像真的」——满配面板：控制台/模型广场/令牌/日志/充值/文档/状态页。
//      价格表、状态页、错误码、公告兜底是**写死的配置**（见下面 STATIC CONFIG 段）；
//      而账号相关的每一个数字（余额、用量、令牌、日志、最近登录）都**来自 D1**，
//      没有一处是编的 —— 所以新注册的账号看到的就是真实的空（余额 ¥0.00）。
//   2) 「不做真事」——不接任何真实上游、不收任何钱、没有支付流程（充值页只有兑换码）。
//      所有 /v1 调用永远返回同一张奶龙 ASCII 图。
//
// 说真话的位置只有两处（刻意的）：页脚小字（每页都有）+ /about 页。
// 其余页面的文案按真实中转站写 —— 不然整活就没意思了。
//
// ⚠️ 登录/注册是**真的**：邮箱与密码会写进 D1，密码只存 PBKDF2 派生值（随机盐、25k 迭代）。
//    改任何涉及「存不存数据」的措辞时，页脚与 /about 两处必须同步改，口径要一致。
//
// ⚠️ 硬约束：内联 <script> 里的代码一律字符串拼接，**不得出现反引号或 ${** ——
//    反引号会把外层模板搞崩。需要显示反引号时写 &#96;。

// 充值页的档位/渠道常量与二维码载荷共用一份定义（见 pay.js）—— 免得页面上的
// 「¥10/¥50/…」和二维码里编码的金额对不上。
import { CHANNEL_LABEL, MAX_AMOUNT, MIN_AMOUNT, PLAN_AMOUNTS, PLAN_BONUS, PLAN_TAG } from "./pay.js";

// ── STATIC CONFIG（写死的「配置」，不是「数据」） ────────────────────────────
// 这些是站点级的常量：模型清单/价格表/状态页/错误码。
// 它们本来就该是配置，所以没有进 D1；页面上任何**属于某个账号**的数字都不在这里。

/** HTML 转义。只用于回显用户输入（邮箱、显示名、令牌名）—— 一个都不能漏。 */
export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** GMT+8 的 YYYY-MM-DD HH:mm（与 db.js 的 fmtTime 同口径，供页面直接用）。 */
export function fmtTime(ms) {
  if (!ms) return "—";
  const d = new Date(ms + 8 * 3600 * 1000);
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " +
    p(d.getUTCHours()) + ":" + p(d.getUTCMinutes());
}

/** 金额格式化：¥12.34。 */
export function yuan(n) {
  return "¥" + (Number(n) || 0).toFixed(2);
}

export const MODELS = [
  { id: "gpt-6-astra", name: "GPT-6 Astra", vendor: "OpenAI", ctx: "400K", inPrice: 15, outPrice: 60, ratio: 1.0, group: "default", status: 1 },
  { id: "gpt-6-astra-pro", name: "GPT-6 Astra Pro", vendor: "OpenAI", ctx: "1M", inPrice: 45, outPrice: 180, ratio: 3.0, group: "vip", status: 1 },
  { id: "gpt-6-astra-20260903", name: "GPT-6 Astra (20260903)", vendor: "OpenAI", ctx: "400K", inPrice: 15, outPrice: 60, ratio: 1.0, group: "default", status: 1 },
  { id: "gpt-6-astra-high", name: "GPT-6 Astra High", vendor: "OpenAI", ctx: "400K", inPrice: 30, outPrice: 120, ratio: 2.0, group: "vip", status: 1 },
  { id: "gpt-6-luna", name: "GPT-6 Luna", vendor: "OpenAI", ctx: "256K", inPrice: 8, outPrice: 24, ratio: 0.5, group: "default", status: 1 },
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", vendor: "DeepSeek", ctx: "1M", inPrice: 1, outPrice: 4, ratio: 0.08, group: "default", status: 1 },
  { id: "glm-5.2", name: "GLM-5.2", vendor: "智谱", ctx: "200K", inPrice: 2, outPrice: 8, ratio: 0.15, group: "default", status: 1 },
  { id: "kimi-k3", name: "Kimi K3", vendor: "月之暗面", ctx: "256K", inPrice: 4, outPrice: 16, ratio: 0.3, group: "default", status: 1 },
];

// 公告**兜底**：D1 的 announcements 表为空时用它，免得控制台右侧空一块。
// 表里一旦有行，页面就只显示表里的（见 index.js 的 listAnnouncements 调用）。
// 形状必须与 announcements 表一致（level / title / body / created_at），否则页面渲染出空行。
// 文案一律是真话 —— 公告是站方自己写的，没有理由在这里编。
export const ANNOUNCEMENTS = [
  { level: "info", title: "本站不接任何真实上游", body: "所有 /v1 调用都由本站直接生成同一张奶龙图返回，没有任何模型参与。", created_at: 1791259200000 },
  { level: "info", title: "兑换码是唯一的加额方式", body: "没有支付流程、也没有收款方。余额只是 D1 里的一个数，买不到任何真实服务。", created_at: 1791000000000 },
  { level: "warn", title: "带令牌的调用会真的记账", body: "/v1 不校验令牌，但带上有效令牌的调用会记进你的日志，并按倍率扣余额。", created_at: 1790654400000 },
];

export const STATUS_ROWS = [
  { id: "gpt-6-astra", up: "99.97%", ms: 3180, status: "正常" },
  { id: "gpt-6-astra-pro", up: "99.91%", ms: 5820, status: "正常" },
  { id: "gpt-6-astra-20260903", up: "99.98%", ms: 3210, status: "正常" },
  { id: "gpt-6-astra-high", up: "99.89%", ms: 4410, status: "正常" },
  { id: "gpt-6-luna", up: "99.95%", ms: 2240, status: "正常" },
  { id: "deepseek-v4.1-flash", up: "99.99%", ms: 1120, status: "正常" },
  { id: "glm-5.2", up: "99.82%", ms: 1740, status: "轻微抖动" },
  { id: "kimi-k3", up: "99.94%", ms: 2310, status: "正常" },
];

export const INCIDENTS = [
  { date: "2026-10-07 09:12", dur: "23 分钟", text: "glm-5.2 上游偶发 429，已自动切换至备用通道，期间重试成功率 100%。" },
  { date: "2026-10-02 21:40", dur: "8 分钟", text: "华东节点网络抖动，流式响应出现中断，已恢复。" },
  { date: "2026-09-24 15:05", dur: "17 分钟", text: "gpt-6-astra-pro 上游维护，请求自动降级至 gpt-6-astra。" },
];

export const ENDPOINTS = [
  { m: "POST", p: "/v1/chat/completions", d: "对话补全，兼容 OpenAI Chat Completions" },
  { m: "POST", p: "/v1/responses", d: "Responses API，兼容 OpenAI 新协议" },
  { m: "POST", p: "/v1/messages", d: "Anthropic Messages 协议，可直接替换 Claude SDK 的 base_url" },
  { m: "POST", p: "/v1/messages/count_tokens", d: "Anthropic 令牌计数" },
  { m: "GET", p: "/v1/models", d: "当前分组可用模型列表" },
];

export const ERROR_CODES = [
  { c: "401", t: "invalid_api_key", d: "令牌无效或已被删除" },
  { c: "402", t: "insufficient_quota", d: "余额或令牌额度不足" },
  { c: "404", t: "model_not_found", d: "当前分组无权访问该模型" },
  { c: "429", t: "rate_limit_exceeded", d: "超出并发或速率限制，请指数退避重试" },
  { c: "500", t: "upstream_error", d: "上游异常，已自动重试；持续出现请提交工单" },
];

// ── 样式 ──────────────────────────────────────────────────────────────────

const CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{
  --brand:#2563eb;--brand-d:#1d4ed8;--brand-l:#eff6ff;--brand-b:#bfdbfe;
  --ink:#101828;--ink2:#344054;--ink3:#667085;--ink4:#98a2b3;
  --line:#e4e7ec;--line2:#f2f4f7;--bg:#f7f8fa;--card:#fff;
  --ok:#067647;--okbg:#ecfdf3;--warn:#b54708;--warnbg:#fffaeb;--err:#b42318;--errbg:#fef3f2;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  --sh:0 1px 2px rgba(16,24,40,.05);
}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
h1,h2,h3,h4{margin:0;font-weight:600;line-height:1.3;letter-spacing:-.01em}
p{margin:0}
code,pre{font-family:var(--mono)}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
.muted{color:var(--ink3)}
.small{font-size:12px}
.right{text-align:right}
.center{text-align:center}
.mono{font-family:var(--mono);font-size:12.5px}
.nowrap{white-space:nowrap}

/* 顶栏 */
.tb{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}
.tb-in{display:flex;align-items:center;gap:28px;height:60px}
.brand{display:flex;align-items:center;gap:9px;color:var(--ink);font-size:16px;font-weight:600}
.brand:hover{text-decoration:none}
.logo{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.nav{display:flex;gap:4px;flex:1}
.nav a{padding:7px 12px;border-radius:6px;color:var(--ink2);font-size:14px}
.nav a:hover{background:var(--line2);text-decoration:none}
.nav a.on{color:var(--brand);background:var(--brand-l);font-weight:500}
.tb-r{display:flex;align-items:center;gap:10px}

/* 按钮 */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 16px;border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--ink2);font-size:14px;font-family:inherit;cursor:pointer;white-space:nowrap}
.btn:hover{border-color:#cfd4dc;text-decoration:none}
.btn.pri{background:var(--brand);border-color:var(--brand);color:#fff}
.btn.pri:hover{background:var(--brand-d);border-color:var(--brand-d)}
.btn.lg{height:42px;padding:0 22px;font-size:15px}
.btn.sm{height:30px;padding:0 11px;font-size:13px}
.btn.gho{border-color:transparent;background:transparent}
.btn.gho:hover{background:var(--line2)}
.btn.dark{background:#101828;border-color:#101828;color:#fff}
.btn.dark:hover{background:#1d2939}

/* 卡片 */
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;box-shadow:var(--sh)}
.card-h{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px}
.card-h h3{font-size:15px}
.card-b{padding:18px}
.grid{display:grid;gap:16px}
.g2{grid-template-columns:repeat(2,minmax(0,1fr))}
.g3{grid-template-columns:repeat(3,minmax(0,1fr))}
.g4{grid-template-columns:repeat(4,minmax(0,1fr))}

/* 表格 */
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-weight:500;color:var(--ink3);background:#fafbfc;padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:11px 14px;border-bottom:1px solid var(--line2);color:var(--ink2);vertical-align:middle}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:#fafbfc}
.tw{overflow-x:auto}

/* 徽标 */
.tag{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:11px;font-size:12px;background:var(--line2);color:var(--ink2);white-space:nowrap}
.tag.ok{background:var(--okbg);color:var(--ok)}
.tag.warn{background:var(--warnbg);color:var(--warn)}
.tag.err{background:var(--errbg);color:var(--err)}
.tag.b{background:var(--brand-l);color:var(--brand-d)}
.dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 auto}

/* 表单 */
label{display:block;font-size:13px;color:var(--ink2);margin-bottom:6px;font-weight:500}
input[type=text],input[type=password],input[type=email],input[type=number],select,textarea{width:100%;height:38px;padding:0 12px;border:1px solid var(--line);border-radius:7px;background:#fff;font:14px inherit;color:var(--ink);outline:none}
textarea{height:auto;padding:10px 12px;resize:vertical}
input:focus,select:focus,textarea:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(37,99,235,.12)}
.field{margin-bottom:16px}
.row{display:flex;gap:12px;align-items:center}
.chk{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--ink3);font-weight:400}
.chk input{width:auto;height:auto;margin-top:3px}

/* 布局：控制台 */
.app{display:grid;grid-template-columns:208px minmax(0,1fr);gap:20px;padding:20px 0 40px}
.side{background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px;height:max-content;box-shadow:var(--sh)}
.side a{display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:7px;color:var(--ink2);font-size:14px}
.side a:hover{background:var(--line2);text-decoration:none}
.side a.on{background:var(--brand-l);color:var(--brand-d);font-weight:500}
.side .sep{height:1px;background:var(--line);margin:7px 4px}
.side .lbl{padding:10px 12px 5px;font-size:11.5px;color:var(--ink4);letter-spacing:.04em}

/* 统计块 */
.stat{padding:16px 18px}
.stat .k{font-size:12.5px;color:var(--ink3);margin-bottom:7px}
.stat .v{font-size:25px;font-weight:600;letter-spacing:-.02em;line-height:1.15}
.stat .d{font-size:12px;color:var(--ink3);margin-top:6px}

/* 柱状图 */
.chart{display:flex;align-items:flex-end;gap:14px;height:150px;padding:10px 4px 0}
.chart .col{flex:1;display:flex;flex-direction:column;align-items:center;gap:7px;height:100%;justify-content:flex-end}
.chart .bar{width:100%;max-width:44px;background:linear-gradient(180deg,#60a5fa,#2563eb);border-radius:5px 5px 0 0;min-height:3px}
.chart .lb{font-size:11.5px;color:var(--ink4)}
.chart .vl{font-size:11.5px;color:var(--ink3)}
/* 30 天柱状图：列多，把间距和标签压小，否则标签会糊成一片 */
.chart.d30{gap:3px;height:160px}
.chart.d30 .bar{max-width:none}
.chart.d30 .lb{font-size:10px;white-space:nowrap}
.chart.d30 .col{gap:5px}

/* 空状态：新账号看到的应该是一句实话，不是一张假图 */
.empty{padding:26px 6px;text-align:center;color:var(--ink4);font-size:13.5px;line-height:1.7}
.empty b{display:block;color:var(--ink2);font-size:14.5px;font-weight:500;margin-bottom:6px}

/* 进度条 */
.pg{height:7px;border-radius:4px;background:var(--line2);overflow:hidden;min-width:70px}
.pg i{display:block;height:100%;background:var(--brand);border-radius:4px}

/* 营销页 */
.hero{background:linear-gradient(180deg,#fff,#f7f9fc);border-bottom:1px solid var(--line);padding:66px 0 58px}
.hero h1{font-size:40px;line-height:1.22;letter-spacing:-.025em}
.hero p.lead{font-size:17px;color:var(--ink2);margin-top:16px;max-width:640px}
.hero .cta{display:flex;gap:12px;margin-top:28px;flex-wrap:wrap}
.pill{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 12px;border-radius:14px;background:var(--brand-l);color:var(--brand-d);font-size:13px;border:1px solid var(--brand-b)}
.trust{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:44px;padding-top:26px;border-top:1px solid var(--line)}
.trust b{display:block;font-size:22px;font-weight:600;letter-spacing:-.02em}
.trust span{font-size:12.5px;color:var(--ink3)}
.sec{padding:56px 0}
.sec.alt{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.sec-h{margin-bottom:30px}
.sec-h h2{font-size:26px;letter-spacing:-.02em}
.sec-h p{color:var(--ink3);margin-top:9px;font-size:15px}
.feat{padding:20px}
.feat .ic{width:36px;height:36px;border-radius:9px;background:var(--brand-l);color:var(--brand-d);display:flex;align-items:center;justify-content:center;margin-bottom:13px}
.feat h3{font-size:15px;margin-bottom:7px}
.feat p{color:var(--ink3);font-size:13.5px}
pre.code{background:#0f172a;color:#e2e8f0;border-radius:9px;padding:16px 18px;overflow-x:auto;font-size:12.8px;line-height:1.7;margin:0}
pre.code .c{color:#7c8aa5}
pre.code .s{color:#86efac}
pre.code .k{color:#93c5fd}
pre.lite{background:#fafbfc;border:1px solid var(--line);border-radius:9px;padding:14px 16px;overflow-x:auto;font-size:12.8px;line-height:1.7;margin:0;color:var(--ink2)}
details{border:1px solid var(--line);border-radius:9px;background:#fff;padding:0;margin-bottom:10px}
details summary{cursor:pointer;padding:14px 18px;font-weight:500;font-size:14px;list-style:none}
details summary::-webkit-details-marker{display:none}
details summary::after{content:"+";float:right;color:var(--ink4);font-weight:400}
details[open] summary::after{content:"\\2212"}
details .db{padding:0 18px 16px;color:var(--ink3);font-size:13.5px;border-top:1px solid var(--line2);padding-top:14px}
.notice{background:#fffaeb;border:1px solid #fedf89;border-radius:9px;padding:12px 16px;color:#93370d;font-size:13.5px}
.ok-note{background:var(--okbg);border:1px solid #abefc6;border-radius:9px;padding:12px 16px;color:#067647;font-size:13.5px}

/* 页脚 */
.ft{background:#fff;border-top:1px solid var(--line);margin-top:0;padding:40px 0 26px}
.ft-cols{display:grid;grid-template-columns:1.6fr repeat(3,1fr);gap:28px}
.ft h4{font-size:13px;color:var(--ink);margin-bottom:12px}
.ft ul{list-style:none;margin:0;padding:0}
.ft li{margin-bottom:9px}
.ft a{color:var(--ink3);font-size:13px}
.ft a:hover{color:var(--brand)}
.ft-b{margin-top:32px;padding-top:18px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;color:var(--ink4);font-size:12px}
.ft-note{margin-top:14px;padding:10px 13px;background:#fafbfc;border:1px solid var(--line2);border-radius:7px;color:var(--ink4);font-size:11.5px;line-height:1.7}

/* 杂项 */
.tabs{display:flex;gap:6px;border-bottom:1px solid var(--line);margin-bottom:20px}
.tabs button,.tabs a{height:38px;padding:0 15px;border:0;background:none;font:14px inherit;color:var(--ink3);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;display:inline-flex;align-items:center;text-decoration:none}
.tabs button.on,.tabs a.on{color:var(--brand);border-bottom-color:var(--brand);font-weight:500}
.qrbox{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px;display:inline-block}
.toast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%) translateY(14px);background:#101828;color:#fff;padding:11px 20px;border-radius:8px;font-size:13.5px;opacity:0;pointer-events:none;transition:.22s;z-index:60}
.toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
.auth{max-width:412px;margin:52px auto 72px}
.auth .card-b{padding:26px}
.auto{display:block;width:100%;margin-top:10px;height:38px;line-height:36px;border:1px dashed var(--line);border-radius:8px;background:#fcfcfd;color:var(--ink2);font:13.5px inherit;text-align:center;text-decoration:none;cursor:pointer}
.auto:hover{border-color:var(--brand);color:var(--brand)}
.tb-out{display:inline;margin:0}
.tb-out .lk{border:0;background:none;font:13.5px inherit;color:var(--ink3);cursor:pointer;padding:0 2px 0 10px}
.tb-out .lk:hover{color:var(--ink)}
.err{border:1px solid #f3c6c6;background:#fdf3f3;color:#a12424;border-radius:8px;padding:10px 13px;font-size:13.5px;margin-bottom:16px;line-height:1.65}
.okn{border:1px solid #c6e3cd;background:#f3fbf5;color:#1c6b36;border-radius:8px;padding:10px 13px;font-size:13.5px;margin-bottom:16px;line-height:1.65}
.tbwrap{border:1px solid var(--line);border-radius:8px;background:#fbfbfc;padding:11px 13px;font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;color:var(--ink2);line-height:1.7}
.actions{display:flex;align-items:center;gap:0;padding:9px 0;border-bottom:1px solid var(--line2);flex-wrap:wrap}
.actions:last-child{border-bottom:0}
.lk2{border:0;background:none;padding:0 10px;font:13.5px inherit;color:var(--ink3);cursor:pointer}
.lk2:hover{color:var(--brand)}
.lk2.dg:hover{color:#c0392b}
.bars{display:flex;align-items:flex-end;gap:3px;height:74px;margin:6px 0 2px}
.bars i{flex:1;min-height:2px;background:linear-gradient(180deg,#7aa7f0,#4d82e0);border-radius:3px 3px 0 0;display:block}
.barlbl{display:flex;justify-content:space-between;font-size:11.5px;color:var(--ink3)}
.kv{display:flex;justify-content:space-between;gap:14px;padding:10px 0;border-bottom:1px solid var(--line2);font-size:13.5px}
.kv:last-child{border-bottom:0}
.kv span{color:var(--ink3)}
.kv b{font-weight:500;color:var(--ink)}
@media(max-width:1000px){
  .g4,.g3{grid-template-columns:repeat(2,minmax(0,1fr))}
  .app{grid-template-columns:1fr}
  .ft-cols{grid-template-columns:1fr 1fr}
  .trust{grid-template-columns:repeat(2,1fr)}
  .hero h1{font-size:31px}
  .nav{display:none}
}
@media(max-width:620px){
  .g4,.g3,.g2{grid-template-columns:1fr}
  .wrap{padding:0 16px}
}
`;

// ── 通用零件 ──────────────────────────────────────────────────────────────

const LOGO =
  '<span class="logo"><svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">' +
  '<path d="M12 2.6 3.4 7.4v9.2L12 21.4l8.6-4.8V7.4z" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/>' +
  '<path d="M12 7.4 7.6 12 12 16.6 16.4 12z" fill="#fff"/></svg></span>';

const NAV = [
  ["/", "首页"],
  ["/models", "模型广场"],
  ["/docs", "接口文档"],
  ["/status", "服务状态"],
  ["/about", "关于"],
];

function topbar(active, authed, email) {
  const links = NAV.map(([h, t]) => '<a href="' + h + '"' + (active === h ? ' class="on"' : "") + ">" + t + "</a>").join("");
  const right = authed
    ? '<a class="btn sm" href="/tokens">令牌</a><a class="btn sm pri" href="/panel">控制台</a>' +
      '<form class="tb-out" method="post" action="/logout"><button class="lk" type="submit" title="' + esc(email || "") + '">退出</button></form>'
    : '<a class="btn sm gho" href="/login">登录</a><a class="btn sm pri" href="/register">免费注册</a>';
  return (
    '<header class="tb"><div class="wrap tb-in">' +
    '<a class="brand" href="/">' + LOGO + "<b>Astra Relay</b></a>" +
    '<nav class="nav">' + links + "</nav>" +
    '<div class="tb-r">' + right + "</div>" +
    "</div></header>"
  );
}

const FOOTER =
  '<footer class="ft"><div class="wrap">' +
  '<div class="ft-cols">' +
  "<div>" +
  '<a class="brand" href="/">' + LOGO + "<b>Astra Relay</b></a>" +
  '<p class="muted small" style="margin-top:12px;max-width:290px">企业级 AI 模型聚合网关。一个 API 接入全球主流大模型，OpenAI / Anthropic 双协议兼容，国内直连、按量计费。</p>' +
  '<p class="muted small" style="margin-top:12px">客服邮箱：support@astra-relay.example<br>服务时间：09:00 – 23:00（GMT+8）</p>' +
  "</div>" +
  '<div><h4>产品</h4><ul><li><a href="/models">模型广场</a></li><li><a href="/models#pricing">价格与倍率</a></li><li><a href="/status">服务状态</a></li><li><a href="/docs">接口文档</a></li></ul></div>' +
  '<div><h4>控制台</h4><ul><li><a href="/panel">概览</a></li><li><a href="/tokens">令牌管理</a></li><li><a href="/usage">调用日志</a></li><li><a href="/recharge">充值中心</a></li></ul></div>' +
  '<div><h4>支持</h4><ul><li><a href="/docs#faq">常见问题</a></li><li><a href="/about">关于我们</a></li><li><a href="/docs#errors">错误码</a></li><li><a href="/settings">账户设置</a></li></ul></div>' +
  "</div>" +
  '<div class="ft-b"><span>© 2026 Astra Relay · astra-relay.example</span><span>服务条款 · 隐私政策 · 状态页</span></div>' +
  '<p class="ft-note">Astra Relay 是一个个人整活项目：任何 <code>/v1</code> 调用都只会返回一张奶龙 ASCII 图，站内的余额、用量、日志与令牌都只是你自己那次调用留下的记录，本站不接任何真实模型上游，也不接受任何付款。为了让「登录」这件事看起来是真的，注册时填的邮箱与密码会真的存进 Cloudflare D1 —— 密码只保存 PBKDF2 派生值（随机盐、25,000 次迭代），不保存明文。所以：请不要用你真实在用的密码，也不要在这里输入任何真实的 API Key。详见 <a href="/about">关于</a>。</p>' +
  "</div></footer>";
// 上面这段 .ft-note 是本站唯一的「明说」位置（外加 /about 页），别删。
// 它必须始终说真话：改了「存不存数据」就同步改这里和 /about，两处口径要一致。

function layout({ title, active = "", authed = false, email = "", body, scripts = "" }) {
  return (
    "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">" +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    "<title>" + title + "</title><style>" + CSS + "</style></head><body>" +
    topbar(active, authed, email) +
    body +
    FOOTER +
    '<div class="toast" id="toast"></div>' +
    "<script>" + TOAST_JS + scripts + "</script>" +
    "</body></html>"
  );
}

// 内联脚本：刻意不用模板字符串（里面的反引号会把外层模板搞崩），一律字符串拼接。
const TOAST_JS =
  'function toast(m){var t=document.getElementById("toast");if(!t)return;t.textContent=m;t.classList.add("on");' +
  'clearTimeout(window.__tt);window.__tt=setTimeout(function(){t.classList.remove("on")},2200);}' +
  'function toastOk(m){toast(m);}' +
  'function go(p){location.href=p;}';

/** 控制台左侧导航。 */
function sidebar(active) {
  const items = [
    ["/panel", "概览"],
    ["/models", "模型广场"],
    ["/tokens", "令牌管理"],
    ["/usage", "调用日志"],
    ["/recharge", "充值中心"],
    ["/settings", "账户设置"],
  ];
  const links = items
    .map(([h, t]) => '<a href="' + h + '"' + (active === h ? ' class="on"' : "") + ">" + t + "</a>")
    .join("");
  return (
    '<aside class="side"><div class="lbl">控制台</div>' + links +
    '<div class="sep"></div><div class="lbl">资源</div>' +
    '<a href="/docs">接口文档</a><a href="/status">服务状态</a><a href="/about">关于本站</a></aside>'
  );
}

const usd = (n) => "¥" + n.toFixed(2);

/** 空状态。新账号看到的应该是一句实话，不是一张假图。 */
function emptyBox(title, hint) {
  return '<div class="empty"><b>' + esc(title) + "</b>" + esc(hint) + "</div>";
}

/**
 * 一行调用日志。控制台「最近调用」与日志页共用同一个渲染，
 * 免得两处口径不一致。只展示元数据 —— 请求体/响应体本来就没入库。
 */
function logRow(l) {
  return (
    '<tr><td class="mono nowrap">' + fmtTime(l.created_at) + "</td>" +
    '<td class="mono">' + esc(l.model) + "</td>" +
    '<td class="mono small">' + esc(l.token_name || (l.token_id ? "令牌 #" + l.token_id : "—")) + "</td>" +
    '<td class="right mono">' + Number(l.in_tokens || 0).toLocaleString() + "</td>" +
    '<td class="right mono">' + Number(l.out_tokens || 0).toLocaleString() + "</td>" +
    '<td class="right mono">' + Number(l.latency_ms || 0) + " ms</td>" +
    '<td class="right mono">' + usd(Number(l.cost) || 0) + "</td>" +
    '<td><span class="tag ' + (Number(l.status) === 200 ? "ok" : "err") + '">' + Number(l.status) + "</span></td></tr>"
  );
}

function pageTitle(t, sub) {
  return (
    '<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:18px;flex-wrap:wrap">' +
    "<div><h2 style=\"font-size:20px\">" + t + "</h2>" +
    (sub ? '<p class="muted small" style="margin-top:5px">' + sub + "</p>" : "") +
    "</div></div>"
  );
}

// ── 首页 ──────────────────────────────────────────────────────────────────

export function landing() {
  const modelRows = MODELS.map(
    (m) =>
      "<tr><td><b style=\"color:var(--ink);font-weight:500\">" + m.name + '</b><div class="muted small mono">' + m.id + "</div></td>" +
      "<td>" + m.vendor + "</td><td>" + m.ctx + "</td>" +
      '<td class="nowrap">¥' + m.inPrice.toFixed(2) + " / M</td>" +
      '<td class="nowrap">¥' + m.outPrice.toFixed(2) + " / M</td>" +
      '<td><span class="tag ' + (m.group === "vip" ? "b" : "") + '">' + m.group + "</span></td>" +
      '<td><span class="tag ok"><i class="dot"></i>可用</span></td></tr>',
  ).join("");

  const planCards =
    '<div class="card" style="padding:18px;text-align:center">' +
    '<div class="muted small">本站余额怎么来</div><div style="font-size:20px;font-weight:600;margin:8px 0 4px">只认兑换码</div>' +
    '<div class="small muted" style="line-height:1.7">不接受付款、没有支付流程，余额只能靠兑换码增加，也买不到任何真实服务。</div>' +
    '<a class="btn sm pri" style="margin-top:14px;width:100%" href="/login?next=/recharge">去兑换</a></div>' +
    '<div class="card" style="padding:18px;text-align:center">' +
    '<div class="muted small">调用 /v1</div><div style="font-size:20px;font-weight:600;margin:8px 0 4px">零鉴权整活</div>' +
    '<div class="small muted" style="line-height:1.7">不带令牌也能调，但每次都只返回一张奶龙 ASCII 图 —— 这才是这个站的本体。</div>' +
    '<a class="btn sm pri" style="margin-top:14px;width:100%" href="/docs">查看接口文档</a></div>';

  const feat = [
    ["协议零改造", "完全兼容 OpenAI Chat Completions / Responses 与 Anthropic Messages 两套协议，改一行 base_url 即可迁移，无需改动业务代码。"],
    ["国内直连", "全球边缘节点接入，国内平均首包 180ms，无需备案、无需专线、无需自建代理。"],
    ["多上游智能路由", "同名模型配置多个上游，按实时可用性与倍率择优，单上游故障自动无感切换。"],
    ["用量透明", "每次调用都留下完整日志：输入/输出 tokens、耗时、状态码、逐次费用，可导出对账。"],
    ["令牌与权限", "支持多令牌分组、独立额度上限、过期时间与 IP 白名单，一个账号管住所有调用方。"],
    ["兑换码充值", "不接受付款，余额只靠兑换码增加：支持批量发放、面额自定、余额叠加，所有记录真实落库，可在兑换中心逐笔核对。"],
  ]
    .map(
      (f) =>
        '<div class="card feat"><div class="ic"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16M12 4v16"/></svg></div>' +
        "<h3>" + f[0] + "</h3><p>" + f[1] + "</p></div>",
    )
    .join("");

  const faq = [
    ["接入需要改多少代码？", "绝大多数场景只改两个地方：<code>base_url</code> 换成 <code>https://api.caar.fun/v1</code>，<code>api_key</code> 换成控制台里生成的令牌。模型名沿用上游原名，无需映射表。"],
    ["如何计费？", "按 tokens 用量计费，输入与输出分开计价。费用 = 输入 tokens ÷ 1,000,000 × 输入单价 + 输出 tokens ÷ 1,000,000 × 输出单价，每次调用后即时结算，日志页可逐条核对。"],
    ["上游故障会怎么样？", "同一个模型配置了多个上游时，网关会自动重试并切换到可用通道，调用方感知不到。若全部上游不可用，会返回 500 upstream_error 并附带 request id，凭该 id 可提交工单定位。"],
    ["支持流式输出吗？", "支持。Chat Completions、Responses 与 Messages 三个端点都支持 <code>stream: true</code>，返回标准 SSE，末帧带 usage 统计。"],
    ['为什么没有充值入口？', "因为本站用不上。所有 <code>/v1</code> 调用都只返回一张奶龙 ASCII 图，不接任何真实上游 —— 余额只是 D1 里的一个计数器。所以余额只能通过兑换码增加，不接受付款，也就没有收款码、退款和发票可言。"],
  ]
    .map((f) => "<details><summary>" + f[0] + '</summary><div class="db">' + f[1] + "</div></details>")
    .join("");

  const body =
    '<section class="hero"><div class="wrap">' +
    '<span class="pill"><i class="dot"></i>所有节点运行正常 · 可用率 99.94%</span>' +
    "<h1 style=\"margin-top:20px\">一个 API，<br>接入全球主流大模型</h1>" +
    '<p class="lead">OpenAI / Anthropic 双协议兼容，国内直连免备案，按量计费不预扣。改一行 base_url，五分钟完成迁移。</p>' +
    '<div class="cta"><a class="btn pri lg" href="/login">免费注册，立即开箱</a><a class="btn lg" href="/docs">查看接口文档</a></div>' +
    '<div class="trust">' +
    "<div><b>8</b><span>在架模型</span></div>" +
    "<div><b>99.94%</b><span>近 30 天可用率</span></div>" +
    "<div><b>1.8s</b><span>平均首字延迟</span></div>" +
    "<div><b>12,847</b><span>累计开发者</span></div>" +
    "</div></div></section>" +

    '<section class="sec"><div class="wrap"><div class="sec-h"><h2>为什么选择 Astra Relay</h2>' +
    "<p>把多上游聚合、协议适配、密钥轮换和用量核算都收进一层网关，业务侧只看见一个 OpenAI 兼容端点。</p></div>" +
    '<div class="grid g3">' + feat + "</div></div></section>" +

    '<section class="sec alt"><div class="wrap"><div class="sec-h"><h2>在架模型</h2>' +
    "<p>价格为单位 tokens 用量单价（人民币）。倍率用于套餐折扣折算，数值越低越便宜。</p></div>" +
    '<div class="card"><div class="tw"><table><thead><tr><th>模型</th><th>厂商</th><th>上下文</th><th>输入</th><th>输出</th><th>分组</th><th>状态</th></tr></thead><tbody>' +
    modelRows + "</tbody></table></div></div>" +
    '<p class="muted small" style="margin-top:12px">完整模型清单以 <code>GET /v1/models</code> 返回为准；分组权限由令牌所属分组决定。</p>' +
    "</div></section>" +

    '<section class="sec"><div class="wrap"><div class="sec-h"><h2>五分钟接入</h2><p>以 Python 为例，其余语言参考接口文档。</p></div>' +
    '<div class="grid g2">' +
    '<div class="card"><div class="card-h"><h3>安装并调用</h3></div><div class="card-b">' +
    '<pre class="code"><span class="c"># pip install openai</span>\n' +
    '<span class="k">from</span> openai <span class="k">import</span> OpenAI\n\n' +
    'client = OpenAI(\n' +
    '    base_url=<span class="s">"https://api.caar.fun/v1"</span>,\n' +
    '    api_key=<span class="s">"sk-astra-..."</span>,\n' +
    ')\n\n' +
    'resp = client.chat.completions.create(\n' +
    '    model=<span class="s">"deepseek-v4.1-flash"</span>,\n' +
    '    messages=[{<span class="s">"role"</span>: <span class="s">"user"</span>, <span class="s">"content"</span>: <span class="s">"你好"</span>}],\n' +
    ')\n' +
    'print(resp.choices[0].message.content)</pre></div></div>' +
    '<div class="card"><div class="card-h"><h3>也可以直接 curl</h3></div><div class="card-b">' +
    '<pre class="code">curl https://api.caar.fun/v1/chat/completions \\\n' +
    '  -H <span class="s">"Content-Type: application/json"</span> \\\n' +
    '  -H <span class="s">"Authorization: Bearer $ASTRA_API_KEY"</span> \\\n' +
    '  -d <span class="s">\'{\n' +
    '    "model": "gpt-6-astra",\n' +
    '    "messages": [{"role":"user","content":"你好"}],\n' +
    '    "stream": true\n' +
    '  }\'</span></pre></div></div>' +
    "</div></div></section>" +

    '<section class="sec alt" id="pricing"><div class="wrap"><div class="sec-h"><h2>充值与兑换</h2>' +
    "<p>余额只靠兑换码增加：没有充值入口、没有收款码、没有退款，也没有发票 —— 不是藏起来了，是真的没有。</p></div>" +
    '<div class="grid g2">' + planCards + "</div>" +
    '<div class="card" style="margin-top:22px"><div class="card-b" style="padding:16px">' +
    '<p class="small muted" style="line-height:1.9">费用会按「输入 / 输出 tokens × 单价」记在调用日志里，也真的会从余额里扣 —— 但本站没有任何真实模型上游，所有返回都是现编的奶龙 ASCII 图，所以面板上的余额本质上是个计数器，兑换码也只是让这个计数器看起来像回事。具体存了什么、没存什么，见<a href="/about">关于本站</a>。</p>' +
    "</div></div></div></section>" +

    '<section class="sec"><div class="wrap"><div class="sec-h"><h2>常见问题</h2></div>' + faq + "</div></section>" +

    '<section class="sec alt"><div class="wrap center" style="padding:8px 0">' +
    '<h2 style="font-size:24px">现在就把 base_url 换过来</h2>' +
    '<p class="muted" style="margin:12px 0 22px">注册后余额从 0 开始 —— 想要余额，先去找一个兑换码。</p>' +
    '<a class="btn pri lg" href="/login">免费开始</a></div></section>';

  return layout({ title: "Astra Relay · 企业级 AI 模型聚合网关", active: "/", body });
}

// ── 登录 / 注册 ───────────────────────────────────────────────────────────

// ── 登录 / 注册（真的写 D1） ──────────────────────────────────────────────
// 两个模式共用一个模板：/login 与 /register 是两条真实路由，表单 method=post。
// 没有任何 JS 参与提交 —— 关掉 JS 也能登录，这才是真表单该有的样子。

export function authPage({ mode = "login", error = "", notice = "", email = "", next = "" } = {}) {
  const isLogin = mode === "login";
  const alert = error
    ? '<div class="err">' + esc(error) + "</div>"
    : notice
      ? '<div class="okn">' + esc(notice) + "</div>"
      : "";
  const nextField = next ? '<input type="hidden" name="next" value="' + esc(next) + '">' : "";

  const form = isLogin
    ? '<form method="post" action="/login">' + nextField +
      '<div class="field"><label for="email">邮箱</label>' +
      '<input id="email" name="email" type="email" value="' + esc(email) + '" placeholder="you@example.com" autocomplete="username" required></div>' +
      '<div class="field"><label for="password">密码</label>' +
      '<input id="password" name="password" type="password" placeholder="请输入密码" autocomplete="current-password" required></div>' +
      '<div class="row" style="margin-bottom:18px">' +
      '<label class="chk"><input type="checkbox" name="remember" value="1" checked>记住我（30 天）</label></div>' +
      '<button class="btn pri" style="width:100%;height:40px" type="submit">登录</button>' +
      "</form>"
    : '<form method="post" action="/register">' +
      '<div class="field"><label for="email">邮箱</label>' +
      '<input id="email" name="email" type="email" value="' + esc(email) + '" placeholder="you@example.com" autocomplete="username" required></div>' +
      '<div class="field"><label for="displayName">显示名称（选填）</label>' +
      '<input id="displayName" name="displayName" type="text" placeholder="留空则用邮箱前缀" autocomplete="nickname"></div>' +
      '<div class="field"><label for="password">密码</label>' +
      '<input id="password" name="password" type="password" placeholder="8 - 200 位，随便什么字符" autocomplete="new-password" required></div>' +
      '<div class="field"><label for="password2">确认密码</label>' +
      '<input id="password2" name="password2" type="password" placeholder="请再输一遍" autocomplete="new-password" required></div>' +
      '<label class="chk" style="margin-bottom:18px"><input type="checkbox" name="agree" value="1" required>我已阅读并同意《服务条款》与《隐私政策》</label>' +
      '<button class="btn pri" style="width:100%;height:40px" type="submit">注册账号</button>' +
      "</form>";

  const body =
    '<div class="wrap"><div class="auth">' +
    '<div class="center" style="margin-bottom:22px">' +
    "<h2 style=\"font-size:22px\">" + (isLogin ? "欢迎回到 Astra Relay" : "创建 Astra Relay 账号") + "</h2>" +
    '<p class="muted" style="margin-top:8px">' +
    (isLogin ? "登录后即可创建令牌、查看用量与兑换码" : "注册后余额为 ¥0.00，用兑换码可以获得额度") +
    "</p></div>" +
    '<div class="card"><div class="card-b">' +
    '<div class="tabs">' +
    '<a' + (isLogin ? ' class="on"' : "") + ' href="/login">登录</a>' +
    '<a' + (isLogin ? "" : ' class="on"') + ' href="/register">注册</a>' +
    "</div>" +
    alert +
    form +
    '<p class="center small muted" style="margin-top:18px">也可以不带令牌直接调用 —— 本站不做鉴权，<a href="/docs">接口文档</a></p>' +
    "</div></div>" +
    '<div class="card" style="margin-top:18px"><div class="card-b small muted">' +
    "<b style=\"color:var(--ink2)\">关于本页，说句实话</b><br>" +
    "这个站的登录与注册是<b>真的</b>：你填的邮箱会写进 Cloudflare D1，密码会经过 PBKDF2（随机盐、25,000 次迭代）后只保存派生值 —— 不保存明文，也没有任何找回密码的邮件通道，忘了就真的没了。" +
    "所以<b>请不要使用你在别处正在用的密码</b>。<br><br>" +
    "这个站也没有任何真实模型上游：登录之后你能做的事只有拿一个令牌、然后用它调用 <code>/v1</code> —— 而无论怎么调，返回的都是同一张奶龙 ASCII 图。" +
    "</div></div>" +
    "</div></div>";

  return layout({
    title: (isLogin ? "登录" : "注册") + " · Astra Relay",
    body,
  });
}

// ── 控制台概览 ────────────────────────────────────────────────────────────

export function panelPage({ user, stats, logs, tokens, announcements } = {}) {
  const u = user || {};
  const s = stats || {};
  const totals = s.totals || { n: 0, cost: 0, tk: 0 };
  const today = s.today || { n: 0, cost: 0, tk: 0 };
  const month = s.month || { n: 0, cost: 0 };
  const days = s.days || [];
  const modelRows = s.byModel || [];
  const rows = (logs && logs.length ? logs : s.recent) || [];
  const tks = tokens || [];
  const anns = announcements || [];

  const balance = Number(u.balance) || 0;

  // 近 30 天消费。真数据：那天没有调用就是 0 高，不是随机数、不是示意值。
  const peak = Math.max(0.0001, ...days.map((d) => Number(d.cost) || 0));
  const chart = days
    .map((d, i) => {
      const v = Number(d.cost) || 0;
      const h = v > 0 ? Math.max(4, Math.round((v / peak) * 100)) : 1;
      return (
        '<div class="col" title="' + fmtTime(d.t).slice(0, 10) + " · ¥" + v.toFixed(4) + " · " + (Number(d.n) || 0) + ' 次">' +
        '<span class="vl">' + (v > 0 ? "¥" + v.toFixed(2) : "") + "</span>" +
        '<div class="bar" style="height:' + h + '%"></div>' +
        '<span class="lb">' + (i % 5 === 0 ? fmtTime(d.t).slice(5, 10) : "") + "</span></div>"
      );
    })
    .join("");

  const maxReq = Math.max(1, ...modelRows.map((m) => Number(m.n) || 0));
  const byModel = modelRows.length
    ? modelRows
        .map(
          (m) =>
            '<div style="display:flex;align-items:center;gap:12px;padding:8px 0">' +
            '<span class="mono" style="width:180px;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(m.model) + "</span>" +
            '<div class="pg" style="flex:1"><i style="width:' + Math.round(((Number(m.n) || 0) / maxReq) * 100) + '%"></i></div>' +
            '<span class="small muted nowrap" style="width:74px;text-align:right">' + (Number(m.n) || 0) + " 次</span>" +
            '<span class="small nowrap" style="width:76px;text-align:right">' + usd(Number(m.cost) || 0) + "</span></div>",
        )
        .join("")
    : emptyBox("还没有调用记录", "近 30 天这个账号一次都没调过 /v1。");

  const logRows = rows.length
    ? rows.slice(0, 8).map(logRow).join("")
    : '<tr><td colspan="8">' + emptyBox("还没有调用记录", "建一个令牌，往 /v1 发一次请求，这里就会出现第一行。") + "</td></tr>";

  const ann = anns.length
    ? anns
        .map(
          (a) =>
            '<div style="display:flex;gap:12px;padding:11px 0;border-bottom:1px solid var(--line2)">' +
            '<span class="tag ' + (a.level === "warn" ? "warn" : a.level === "success" ? "ok" : "b") + '">' +
            esc(a.level === "warn" ? "注意" : a.level === "success" ? "完成" : "公告") + "</span>" +
            '<div style="flex:1"><div style="color:var(--ink2)">' + esc(a.title) + "</div>" +
            '<div class="small muted" style="margin-top:3px">' + esc(a.body) + " · " + fmtTime(a.created_at) + "</div></div></div>",
        )
        .join("")
    : emptyBox("暂无公告", "公告存在 D1 的 announcements 表里，现在是空的。");

  const firstToken = tks[0];
  const tokenCell = firstToken
    ? '<b class="mono">' + esc(firstToken.key_prefix) + "••••••••••••</b>"
    : '<a class="small" href="/tokens">还没有令牌，去建一个</a>';

  const body =
    '<div class="wrap"><div class="app">' +
    sidebar("/panel") +
    "<main>" +
    pageTitle("概览", "统计口径为 GMT+8 自然日 · 下面每个数字都来自这个账号在 D1 里的真实记录") +
    '<div class="grid g4">' +
    '<div class="card stat"><div class="k">账户余额</div><div class="v">' + usd(balance) + "</div>" +
    '<div class="d">' + (balance > 0 ? "来自兑换码" : "还没有兑换过兑换码") + "</div></div>" +
    '<div class="card stat"><div class="k">今日消费</div><div class="v">' + usd(Number(today.cost) || 0) + "</div>" +
    '<div class="d">今日 ' + (Number(today.n) || 0) + " 次调用</div></div>" +
    '<div class="card stat"><div class="k">今日请求</div><div class="v">' + (Number(today.n) || 0).toLocaleString() + "</div>" +
    '<div class="d">近 30 日 ' + (Number(month.n) || 0).toLocaleString() + " 次</div></div>" +
    '<div class="card stat"><div class="k">平均延迟</div><div class="v">' + Math.round(Number(s.avgLat) || 0) + " ms</div>" +
    '<div class="d">近 30 日 · 本站没有上游，这是本地出图耗时</div></div>' +
    "</div>" +

    '<div class="grid g2" style="margin-top:16px">' +
    '<div class="card"><div class="card-h"><h3>近 30 日消费</h3><span class="small muted">单位：元</span></div>' +
    '<div class="card-b"><div class="chart d30">' + chart + "</div></div></div>" +
    '<div class="card"><div class="card-h"><h3>近 30 日模型分布</h3><a class="small" href="/usage">查看日志</a></div>' +
    '<div class="card-b" style="padding-top:8px">' + byModel + "</div></div>" +
    "</div>" +

    '<div class="card" style="margin-top:16px"><div class="card-h"><h3>最近调用</h3><a class="small" href="/usage">全部日志</a></div>' +
    '<div class="tw"><table><thead><tr><th>时间</th><th>模型</th><th>令牌</th><th class="right">输入</th><th class="right">输出</th><th class="right">耗时</th><th class="right">费用</th><th>状态</th></tr></thead><tbody>' +
    logRows + "</tbody></table></div></div>" +

    '<div class="grid g2" style="margin-top:16px">' +
    '<div class="card"><div class="card-h"><h3>系统公告</h3></div><div class="card-b" style="padding-top:6px">' + ann + "</div></div>" +
    '<div class="card"><div class="card-h"><h3>快速开始</h3></div><div class="card-b">' +
    '<div class="kv"><span>API 地址</span><b class="mono">https://api.caar.fun/v1</b></div>' +
    '<div class="kv"><span>当前令牌</span>' + tokenCell + "</div>" +
    '<div class="kv"><span>默认模型</span><b class="mono">' + esc(MODELS[0].id) + "</b></div>" +
    '<div class="kv"><span>账号</span><b class="mono">' + esc(u.email || "") + "</b></div>" +
    '<div class="kv"><span>可用分组</span><b>' + esc(u.group_name || "default") + "</b></div>" +
    '<div class="kv"><span>累计调用</span><b>' + (Number(totals.n) || 0).toLocaleString() + " 次 · " + (Number(totals.tk) || 0).toLocaleString() + " tokens</b></div>" +
    '<div class="row" style="margin-top:16px"><a class="btn sm pri" href="/tokens">管理令牌</a><a class="btn sm" href="/docs">接口文档</a><a class="btn sm" href="/recharge">兑换额度</a></div>' +
    "</div></div></div>" +
    "</main></div></div>";

  return layout({ title: "控制台 · Astra Relay", active: "/panel", authed: true, email: u.email || "", body });
}

// ── 模型广场 ──────────────────────────────────────────────────────────────

export function modelsPage() {
  const rows = MODELS.map(
    (m) =>
      "<tr><td><b style=\"color:var(--ink);font-weight:500\">" + m.name + '</b><div class="muted small mono">' + m.id + "</div></td>" +
      "<td>" + m.vendor + "</td><td>" + m.ctx + "</td>" +
      '<td class="nowrap">¥' + m.inPrice.toFixed(2) + "</td>" +
      '<td class="nowrap">¥' + m.outPrice.toFixed(2) + "</td>" +
      '<td class="mono">' + m.ratio.toFixed(2) + "x</td>" +
      '<td><span class="tag ' + (m.group === "vip" ? "b" : "") + '">' + m.group + "</span></td>" +
      '<td><span class="tag ok"><i class="dot"></i>可用</span></td></tr>',
  ).join("");

  const body =
    '<div class="wrap"><div class="app">' +
    sidebar("/models") +
    "<main>" +
    pageTitle("模型广场", "价格为单位用量单价（人民币 / 百万 tokens）· 倍率用于套餐折扣折算") +
    '<div class="grid g4" style="margin-bottom:16px">' +
    '<div class="card stat"><div class="k">在架模型</div><div class="v">' + MODELS.length + '</div><div class="d">覆盖 4 家厂商</div></div>' +
    '<div class="card stat"><div class="k">最长上下文</div><div class="v">1M</div><div class="d">gpt-6-astra-pro / deepseek-v4.1-flash</div></div>' +
    '<div class="card stat"><div class="k">最低倍率</div><div class="v">0.08x</div><div class="d">deepseek-v4.1-flash</div></div>' +
    '<div class="card stat"><div class="k">分组</div><div class="v">2</div><div class="d">default / vip</div></div>' +
    "</div>" +
    '<div class="card"><div class="card-h"><h3>全部模型</h3><span class="small muted">共 ' + MODELS.length + " 个</span></div>" +
    '<div class="tw"><table><thead><tr><th>模型</th><th>厂商</th><th>上下文</th><th>输入</th><th>输出</th><th>倍率</th><th>分组</th><th>状态</th></tr></thead><tbody>' +
    rows + "</tbody></table></div></div>" +
    '<p class="muted small" style="margin-top:12px">模型清单与 <code>GET /v1/models</code> 完全一致；倍率为套餐折扣折算系数，数值越低单价越便宜。</p>' +
    "</main></div></div>";

  return layout({ title: "模型广场 · Astra Relay", authed: true, active: "/models", body });
}

// ── 令牌管理 ──────────────────────────────────────────────────────────────

export function tokensPage({ user, tokens, notice = "", error = "", newKey = "" } = {}) {
  const tks = tokens || [];

  const rows = tks.length
    ? tks
        .map((t) => {
          const on = Number(t.status) === 1;
          const id = Number(t.id) || 0;
          return (
            '<tr><td><b style="color:var(--ink);font-weight:500">' + esc(t.name) + "</b></td>" +
            '<td class="mono">' + esc(t.key_prefix) + "••••••••••••</td>" +
            '<td class="mono">' + usd(Number(t.remain_quota) || 0) + "</td>" +
            '<td class="mono">' + usd(Number(t.used_quota) || 0) + "</td>" +
            '<td class="mono nowrap">' + fmtTime(t.created_at) + "</td>" +
            '<td class="mono nowrap">' + (Number(t.expires_at) === -1 ? "永不过期" : fmtTime(t.expires_at)) + "</td>" +
            '<td><span class="tag ' + (on ? "ok" : "err") + '"><i class="dot"></i>' + (on ? "启用" : "已禁用") + "</span></td>" +
            '<td class="nowrap">' +
            '<form method="post" action="/tokens/status" style="display:inline">' +
            '<input type="hidden" name="id" value="' + id + '">' +
            '<input type="hidden" name="status" value="' + (on ? "0" : "1") + '">' +
            '<button class="btn sm" type="submit">' + (on ? "禁用" : "启用") + "</button></form> " +
            '<form method="post" action="/tokens/delete" style="display:inline" onsubmit="return confirm(&#39;删除后这个令牌立刻失效，且无法恢复。确定要删？&#39;)">' +
            '<input type="hidden" name="id" value="' + id + '">' +
            '<button class="btn sm" type="submit">删除</button></form>' +
            "</td></tr>"
          );
        })
        .join("")
    : '<tr><td colspan="8">' +
      emptyBox("还没有任何令牌", "在上面填个名字就能建一个。新建后请立刻把完整 key 复制走 —— 库里只存它的 SHA-256，之后再也看不到明文。") +
      "</td></tr>";

  const alerts =
    (error ? '<div class="err">' + esc(error) + "</div>" : "") +
    (notice ? '<div class="okn">' + esc(notice) + "</div>" : "");

  const newKeyBox = newKey
    ? '<div class="okn" style="margin-bottom:16px"><b>令牌已创建 —— 这是完整密钥，只显示这一次。</b>' +
      '<div class="mono" style="margin:10px 0;padding:12px;background:rgba(0,0,0,.045);border-radius:6px;word-break:break-all;user-select:all">' + esc(newKey) + "</div>" +
      '<div class="small muted">刷新或离开这个页面后就再也拿不到了（库里只有它的 SHA-256）。丢了只能删掉重建。</div></div>'
    : "";

  const body =
    '<div class="wrap"><div class="app">' +
    sidebar("/tokens") +
    "<main>" +
    pageTitle("令牌管理", "令牌用于调用 API。本站的 /v1 不校验令牌，但带上有效令牌的调用会被记进你的日志") +
    alerts +
    newKeyBox +
    '<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>新建令牌</h3></div><div class="card-b">' +
    '<form method="post" action="/tokens">' +
    '<div class="grid g3">' +
    '<div><label for="tn">名称</label><input id="tn" name="name" type="text" placeholder="例如：本地测试" maxlength="60" autocomplete="off"></div>' +
    '<div><label for="tq">额度上限（元）</label><input id="tq" name="quota" type="text" placeholder="留空 = 10.00" autocomplete="off"></div>' +
    '<div><label for="tg">分组</label><select id="tg" name="group"><option>default</option><option>vip</option></select></div>' +
    "</div>" +
    '<div class="row" style="margin-top:16px"><button class="btn pri" type="submit">创建令牌</button>' +
    '<span class="small muted">新令牌仅在创建时完整显示一次，请及时保存。</span></div>' +
    "</form>" +
    "</div></div>" +
    '<div class="card"><div class="card-h"><h3>我的令牌</h3><span class="small muted">共 ' + tks.length + " 个</span></div>" +
    '<div class="tw"><table><thead><tr><th>名称</th><th>密钥</th><th>额度</th><th>已用</th><th>创建时间</th><th>过期时间</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
    rows + "</tbody></table></div></div>" +
    '<div class="notice" style="margin-top:16px">安全提示：令牌等同于密码，请勿写入前端代码或提交到公开仓库。本站的 /v1 无论如何都只返回一张奶龙图，所以这里的令牌并没有在保护任何真实上游 —— 但它真的存在库里，带上它的调用也真的会记进日志、真的按倍率扣余额。</div>' +
    "</main></div></div>";

  return layout({ title: "令牌管理 · Astra Relay", active: "/tokens", authed: true, email: (user || {}).email || "", body });
}

// ── 调用日志 ──────────────────────────────────────────────────────────────

export function usagePage({ user, logs, tokens, summary, filter = {} } = {}) {
  const rows = logs || [];
  const tks = tokens || [];
  const sm = summary || { n: 0, it: 0, ot: 0, cost: 0 };
  const f = filter || {};

  const usedModels = [];
  for (const l of rows) if (l.model && usedModels.indexOf(l.model) < 0) usedModels.push(l.model);

  const tableRows = rows.length
    ? rows.map(logRow).join("")
    : '<tr><td colspan="8">' +
      emptyBox(
        f.model || f.tokenId || f.status || f.since ? "这个筛选条件下没有记录" : "还没有调用记录",
        "用令牌往 /v1 发一次请求，这里就会出现第一行。本站的 /v1 不带令牌也会回图，但只有带上有效令牌的调用才会记进你的账号。",
      ) +
      "</td></tr>";

  const opt = (v, label, cur) => '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + esc(label) + "</option>";

  const modelOpts =
    '<option value="">全部模型</option>' +
    MODELS.map((m) => opt(m.id, m.id, f.model)).join("") +
    usedModels
      .filter((m) => !MODELS.some((x) => x.id === m))
      .map((m) => opt(m, m + "（已下线）", f.model))
      .join("");

  const tokenOpts =
    '<option value="">全部令牌</option>' +
    tks.map((t) => opt(t.id, t.name, f.tokenId)).join("");

  const statusOpts =
    '<option value="">全部状态</option>' +
    [200, 429, 500].map((c) => opt(c, String(c), f.status)).join("");

  const rangeOpts =
    opt("1", "今天", f.range) + opt("7", "近 7 天", f.range) + opt("30", "近 30 天", f.range) +
    '<option value="0"' + (String(f.range) === "0" ? " selected" : "") + ">全部时间</option>";

  const body =
    '<div class="wrap"><div class="app">' +
    sidebar("/usage") +
    "<main>" +
    pageTitle("调用日志", "按模型、令牌、状态码与时间范围筛选 —— 筛选在服务端执行，页面上的合计数是全量结果，不只是这一页") +
    '<div class="grid g4" style="margin-bottom:16px">' +
    '<div class="card stat"><div class="k">命中请求</div><div class="v">' + (Number(sm.n) || 0).toLocaleString() + '</div><div class="d">当前筛选条件</div></div>' +
    '<div class="card stat"><div class="k">输入 tokens</div><div class="v">' + (Number(sm.it) || 0).toLocaleString() + '</div><div class="d">本站没有上游，这些数是编的</div></div>' +
    '<div class="card stat"><div class="k">输出 tokens</div><div class="v">' + (Number(sm.ot) || 0).toLocaleString() + '</div><div class="d">同上，仅为让日志像真的</div></div>' +
    '<div class="card stat"><div class="k">合计费用</div><div class="v">' + usd(Number(sm.cost) || 0) + '</div><div class="d">带令牌的调用真的按这个数扣余额</div></div>' +
    "</div>" +
    '<div class="card" style="margin-bottom:16px"><div class="card-b">' +
    '<form method="get" action="/usage">' +
    '<div class="grid g4">' +
    '<div><label for="fm">模型</label><select id="fm" name="model">' + modelOpts + "</select></div>" +
    '<div><label for="ft">令牌</label><select id="ft" name="token">' + tokenOpts + "</select></div>" +
    '<div><label for="fc">状态码</label><select id="fc" name="status">' + statusOpts + "</select></div>" +
    '<div><label for="fd">时间范围</label><select id="fd" name="range">' + rangeOpts + "</select></div>" +
    "</div>" +
    '<div class="row" style="margin-top:16px"><button class="btn pri" type="submit">查询</button>' +
    '<a class="btn" href="/usage">重置</a>' +
    '<span class="small muted">本站不记调用方 IP，所以这一列不存在 —— 不是隐藏了，是从来没存过。</span></div>' +
    "</form>" +
    "</div></div>" +
    '<div class="card"><div class="card-h"><h3>调用明细</h3><span class="small muted">最多显示 200 条 · 命中 ' + (Number(sm.n) || 0) + " 条</span></div>" +
    '<div class="tw"><table><thead><tr><th>时间</th><th>模型</th><th>令牌</th><th class="right">输入</th><th class="right">输出</th><th class="right">耗时</th><th class="right">费用</th><th>状态</th></tr></thead><tbody>' +
    tableRows + "</tbody></table></div></div>" +
    "</main></div></div>";

  return layout({ title: "调用日志 · Astra Relay", active: "/usage", authed: true, email: (user || {}).email || "", body });
}

// ── 充值中心 ──────────────────────────────────────────────────────────────

/**
 * 充值页。界面照抄线上那一版（6 档金额 + 支付宝/微信切换 + 扫码框 + 兑换码 + 充值记录），
 * 但凡是涉及「钱」的说法都必须是真话：
 *   · 本站没有任何支付通道 —— 二维码里编码的是一个 URL，扫出来打开 /pay，
 *     页面里是一张奶龙图（不是收款码，也没有收款方）；
 *   · 唯一能真的把余额加上去的是兑换码（POST /redeem，写进 D1）；
 *   · 余额只是 D1 里的一个数，买不到任何真实服务。
 * 页脚小字 + /about 是「明说」位置；这一页保持一张像模像样的脸，但不说假话。
 */
export function rechargePage({ user, redeems, summary, stats, tokens, payQr, notice = "", error = "" } = {}) {
  const u = user || {};
  const rows = redeems || [];
  const sm = summary || { n: 0, total: 0 };
  const st = stats || {};
  const month = st.month || { n: 0, cost: 0 };
  const tk = tokens || [];
  const qr = payQr || {};
  const qrAmount = Number(qr.amount) || 100;

  const plans = PLAN_AMOUNTS.map((a, i) => {
    const tag = PLAN_TAG[i];
    return (
      '<div class="card" id="pl' + i + '" onclick="pick(' + i + ')" style="padding:16px;text-align:center;cursor:pointer">' +
      '<div class="muted small">充值金额</div>' +
      '<div style="font-size:23px;font-weight:600;margin:6px 0 2px">¥' + a + "</div>" +
      '<div class="small" style="color:var(--ok);height:19px">' + (PLAN_BONUS[i] ? "赠 ¥" + PLAN_BONUS[i] : "") + "</div>" +
      '<div style="margin-top:8px;height:22px">' + (tag ? '<span class="tag b">' + tag + "</span>" : "") + "</div>" +
      "</div>"
    );
  }).join("");

  const hist = rows.length
    ? rows
        .map(
          (r) =>
            "<tr>" +
            '<td class="mono">' + esc(r.code) + "</td>" +
            '<td class="mono nowrap">' + fmtTime(r.used_at) + "</td>" +
            '<td class="right mono">' + usd(Number(r.amount) || 0) + "</td>" +
            '<td class="right mono">' + usd(0) + "</td>" +
            "<td>兑换码</td>" +
            '<td><span class="tag ok"><i class="dot"></i>已完成</span></td>' +
            '<td><button class="btn sm" type="button" onclick="toast(&#39;本站不收钱，也没有发票&#39;)">申请发票</button></td>' +
            "</tr>",
        )
        .join("")
    : '<tr><td colspan="7">' + emptyBox("还没有充值记录", "兑换码兑换成功后，这里会出现一条记录。") + "</td></tr>";

  const alerts =
    (error ? '<div class="err">' + esc(error) + "</div>" : "") +
    (notice ? '<div class="okn">' + esc(notice) + "</div>" : "");

  const body =
    '<div class="wrap"><div class="app">' +
    sidebar("/recharge") +
    "<main>" +
    pageTitle("充值中心", "余额永久有效 · 失败调用不计费 · 本站没有真实支付通道") +
    alerts +

    '<div class="grid g4" style="margin-bottom:16px">' +
    '<div class="card stat"><div class="k">当前余额</div><div class="v">' + usd(Number(u.balance) || 0) + "</div>" +
    '<div class="d">' + (Number(u.balance) > 0 ? "全部来自兑换码" : "还没兑换过") + "</div></div>" +
    '<div class="card stat"><div class="k">累计充值</div><div class="v">' + usd(Number(sm.total) || 0) + "</div>" +
    '<div class="d">共 ' + (Number(sm.n) || 0) + " 笔兑换</div></div>" +
    '<div class="card stat"><div class="k">本月消费</div><div class="v">' + usd(Number(month.cost) || 0) + "</div>" +
    '<div class="d">本月调用 ' + (Number(month.n) || 0) + " 次</div></div>" +
    '<div class="card stat"><div class="k">可用令牌</div><div class="v">' + tk.length + "</div>" +
    '<div class="d"><a href="/tokens">去令牌管理</a></div></div>' +
    "</div>" +

    '<div class="card" style="margin-bottom:16px">' +
    '<div class="card-h"><h3>选择充值金额</h3><span class="small muted">选一档，或者自己填</span></div>' +
    '<div class="card-b">' +
    '<div class="grid g3" id="plans">' + plans + "</div>" +
    '<div class="row" style="margin-top:16px">' +
    '<div class="field" style="flex:1;margin:0"><label for="amt">自定义金额</label>' +
    '<input id="amt" type="text" inputmode="decimal" placeholder="最低 ¥' + MIN_AMOUNT + '.00" autocomplete="off"></div>' +
    '<button class="btn pri" type="button" onclick="customPay()">去支付</button>' +
    "</div>" +
    '<div class="small muted" style="margin-top:10px">「去支付」不会跳到任何收银台 —— 它只是按你填的金额刷新右边那张二维码。</div>' +
    "</div></div>" +

    '<div class="grid g2">' +
    '<div class="card"><div class="card-h"><h3>扫码支付</h3></div><div class="card-b">' +
    '<div class="tabs">' +
    '<button type="button" class="on" onclick="pay(this,0)">' + CHANNEL_LABEL.alipay + "</button>" +
    '<button type="button" onclick="pay(this,1)">' + CHANNEL_LABEL.wechat + "</button>" +
    "</div>" +
    '<div style="text-align:center">' +
    '<div class="qrbox" id="qrsvg">' + (qr.svg || "") + "</div>" +
    '<p class="small muted" style="margin-top:14px;line-height:1.9">' +
    '订单金额：<b id="payAmt">' + usd(qrAmount) + "</b><br>" +
    '订单号：<span class="mono" id="payOrder">' + esc(qr.order || "") + "</span><br>" +
    "二维码 15 分钟内有效</p>" +
    '<p class="small muted" style="margin-top:10px">扫码打开的是一张奶龙图 —— 本站没有收款能力，也没有任何付款动作。</p>' +
    "</div></div></div>" +

    '<div class="card"><div class="card-h"><h3>兑换码</h3></div><div class="card-b">' +
    '<form method="post" action="/redeem">' +
    '<div class="field"><label for="cd">兑换码</label>' +
    '<input id="cd" name="code" type="text" placeholder="请输入兑换码" autocomplete="off" spellcheck="false" maxlength="64" required></div>' +
    '<button class="btn pri" type="submit">立即兑换</button>' +
    '<div class="small muted" style="margin-top:12px">不区分大小写，前后空格会被忽略。每个码只能兑换一次。</div>' +
    "</form>" +
    '<div class="kv" style="margin-top:18px"><span>兑换码来源</span><b>活动赠送 / 客服发放</b></div>' +
    '<div class="kv"><span>有效期</span><b>长期有效</b></div>' +
    '<div class="kv"><span>是否可叠加</span><b>可以，直接累加到余额</b></div>' +
    '<div class="notice" style="margin-top:16px">余额只是 D1 里的一个数，买不到任何真实服务。如果你看到有人拿这个站卖额度，那是在骗你。</div>' +
    "</div></div>" +
    "</div>" +

    '<div class="card" style="margin-top:16px">' +
    '<div class="card-h"><h3>充值记录</h3><span class="small muted">共 ' + (Number(sm.n) || 0) + " 笔</span></div>" +
    '<div class="tw"><table><thead><tr><th>兑换码</th><th>时间</th><th class="right">金额</th><th class="right">赠送</th><th>支付方式</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
    hist + "</tbody></table></div></div>" +

    "</main></div></div>";

  return layout({
    title: "充值中心 · Astra Relay",
    active: "/recharge",
    authed: true,
    email: u.email || "",
    body,
    scripts: RECHARGE_JS,
  });
}

// 充值页内联脚本：切换档位/渠道 → 重新取一张带新盐的二维码。
// 一律字符串拼接，不得出现反引号或 ${。
const RECHARGE_JS =
  'var PAY={amount:' + 100 + ',channel:"alipay"};' +
  "var PLANS=[" + PLAN_AMOUNTS.join(",") + "];" +
  'function paint(){for(var k=0;k<PLANS.length;k++){var e=document.getElementById("pl"+k);if(e)e.style.borderColor=(PLANS[k]===PAY.amount)?"var(--brand)":"";}}' +
  'function setAmt(v){PAY.amount=v;var a=document.getElementById("payAmt");if(a)a.textContent="¥"+v.toFixed(2);paint();refreshQr();}' +
  "function pick(i){setAmt(PLANS[i]);}" +
  'function pay(b,i){var t=b.parentNode.getElementsByTagName("button");for(var k=0;k<t.length;k++)t[k].className=k===i?"on":"";PAY.channel=i===0?"alipay":"wechat";refreshQr();}' +
  'function customPay(){var e=document.getElementById("amt");var n=e?parseFloat(String(e.value).replace(/[^0-9.]/g,"")):NaN;' +
  'if(!n||!(n>0)){toast("请先填一个金额");return;}' +
  "if(n<" + MIN_AMOUNT + "||n>" + MAX_AMOUNT + '){toast("金额需要在 ¥' + MIN_AMOUNT + " – ¥" + MAX_AMOUNT + ' 之间");return;}setAmt(Math.round(n*100)/100);}' +
  "var QT=0;" +
  'function refreshQr(){var box=document.getElementById("qrsvg");if(!box||!window.fetch)return;clearTimeout(QT);QT=setTimeout(function(){' +
  'fetch("/api/pay/qr?amount="+encodeURIComponent(PAY.amount)+"&channel="+encodeURIComponent(PAY.channel))' +
  ".then(function(r){return r.json();}).then(function(d){if(!d||!d.ok)return;" +
  "if(d.svg)box.innerHTML=d.svg;" +
  'var o=document.getElementById("payOrder");if(o&&d.order)o.textContent=d.order;' +
  'var a=document.getElementById("payAmt");if(a&&d.amount)a.textContent="¥"+Number(d.amount).toFixed(2);' +
  "}).catch(function(){});},140);}" +
  "paint();";

// ── 扫码落地页 ────────────────────────────────────────────────────────────

/**
 * /pay —— 充值页那张二维码扫出来就是这个页面。
 * 页面内容就是那张奶龙图（1768402480_3412972.png），外加一行如实说明：
 * 它不是收款码，这里没有付款、没有订单、没有收款方。
 */
export function payPage({ amount = 0, channel = "", order = "" } = {}) {
  const body =
    '<div class="wrap" style="max-width:820px;padding-top:34px;padding-bottom:56px">' +
    '<div class="card">' +
    '<div class="card-h"><h3>扫码结果</h3><span class="small muted">订单号 ' + esc(order || "—") + "</span></div>" +
    '<div class="card-b" style="text-align:center">' +
    '<img src="/1768402480_3412972.png" alt="奶龙" style="max-width:100%;height:auto;border-radius:10px;border:1px solid var(--line)">' +
    '<p class="small muted" style="margin-top:16px;line-height:1.9">' +
    "订单金额：" + (Number(amount) ? "<b>" + usd(Number(amount)) + "</b>" : "—") +
    " · 支付方式：" + esc(CHANNEL_LABEL[channel] || channel || "—") + "<br>" +
    "本站是个人整活项目：这张图就是二维码的全部内容 —— 没有付款、没有订单、没有收款方。" +
    "</p>" +
    '<p style="margin-top:18px"><a class="btn" href="/recharge">返回充值中心</a></p>' +
    "</div></div></div>";
  return layout({ title: "扫码结果 · Astra Relay", body });
}

// ── 账户设置 ──────────────────────────────────────────────────────────────

export function settingsPage({ user, notice = "", error = "" } = {}) {
  const u = user || {};
  const alerts =
    (error ? '<div class="err">' + esc(error) + "</div>" : "") +
    (notice ? '<div class="okn">' + esc(notice) + "</div>" : "");

  const body =
    '<div class="wrap"><div class="app">' +
    sidebar("/settings") +
    "<main>" +
    pageTitle("账户设置", "这里的每一项都真的写进 Cloudflare D1，改完立刻生效") +
    alerts +
    '<div class="grid g2">' +
    '<div class="card"><div class="card-h"><h3>个人资料</h3></div><div class="card-b">' +
    '<form method="post" action="/settings/profile">' +
    '<div class="field"><label for="se">邮箱</label>' +
    '<input id="se" type="email" value="' + esc(u.email) + '" disabled></div>' +
    '<div class="field"><label for="sd">显示名称</label>' +
    '<input id="sd" name="display_name" type="text" value="' + esc(u.display_name) + '" maxlength="40" autocomplete="off"></div>' +
    '<button class="btn pri" type="submit">保存修改</button>' +
    '<div class="small muted" style="margin-top:12px">邮箱是账号的唯一标识，暂不支持修改。</div>' +
    "</form>" +
    "</div></div>" +
    '<div class="card"><div class="card-h"><h3>安全设置</h3></div><div class="card-b">' +
    '<form method="post" action="/settings/password">' +
    '<div class="field"><label for="so">当前密码</label><input id="so" name="old_password" type="password" placeholder="请输入当前密码" autocomplete="current-password" required></div>' +
    '<div class="field"><label for="sn">新密码</label><input id="sn" name="new_password" type="password" placeholder="至少 8 位" autocomplete="new-password" required></div>' +
    '<div class="field"><label for="sc">确认新密码</label><input id="sc" name="new_password2" type="password" placeholder="请再次输入新密码" autocomplete="new-password" required></div>' +
    '<button class="btn pri" type="submit">修改密码</button>' +
    '<div class="small muted" style="margin-top:12px">改密后本机会话会保留，其他设备上的会话会被一并清除。</div>' +
    "</form>" +
    '<div class="kv" style="margin-top:18px"><span>最近登录</span><b>' + fmtTime(u.last_login_at) + "</b></div>" +
    '<div class="kv"><span>注册时间</span><b>' + fmtTime(u.created_at) + "</b></div>" +
    "</div></div>" +
    "</div>" +
    '<div class="grid g2" style="margin-top:16px">' +
    '<div class="card"><div class="card-h"><h3>接入信息</h3></div><div class="card-b">' +
    '<div class="kv"><span>API Base URL</span><b class="mono">https://api.caar.fun/v1</b></div>' +
    '<div class="kv"><span>兼容协议</span><b>OpenAI / Anthropic</b></div>' +
    '<div class="kv"><span>当前分组</span><b>' + esc(u.group_name || "default") + "</b></div>" +
    '<div class="kv"><span>账户 ID</span><b class="mono">' + Number(u.id) + "</b></div>" +
    '<div class="kv"><span>账户余额</span><b>' + usd(Number(u.balance) || 0) + "</b></div>" +
    '<div class="row" style="margin-top:16px"><a class="btn sm" href="/tokens">管理令牌</a><a class="btn sm" href="/docs">接口文档</a></div>' +
    "</div></div>" +
    '<div class="card"><div class="card-h"><h3>本站存了什么</h3></div><div class="card-b">' +
    '<div class="kv"><span>邮箱</span><b>存了，用来登录</b></div>' +
    '<div class="kv"><span>显示名称</span><b>存了，可以随时改</b></div>' +
    '<div class="kv"><span>密码</span><b>只存 PBKDF2 派生值 + 随机盐</b></div>' +
    '<div class="kv"><span>调用方 IP</span><b>没存，从来没记过</b></div>' +
    '<div class="kv"><span>请求/响应正文</span><b>没存，入不了库</b></div>' +
    '<div class="notice" style="margin-top:16px">这是一个整活站，请不要使用你在别处正在用的密码。没有找回密码通道 —— 忘了就只能重新注册。</div>' +
    '<form method="post" action="/logout" style="margin-top:16px"><button class="btn" type="submit">退出登录</button></form>' +
    "</div></div></div>" +
    "</main></div></div>";

  return layout({ title: "账户设置 · Astra Relay", active: "/settings", authed: true, email: u.email || "", body });
}

// ── 接口文档 ──────────────────────────────────────────────────────────────

export function docsPage() {
  const eps = ENDPOINTS.map(
    (e) =>
      '<tr><td><span class="tag ' + (e.m === "GET" ? "b" : "ok") + '">' + e.m + '</span></td>' +
      '<td class="mono">' + e.p + "</td><td>" + e.d + "</td></tr>",
  ).join("");

  const errs = ERROR_CODES.map(
    (e) =>
      '<tr><td class="mono">' + e.c + '</td><td class="mono">' + e.t + "</td><td>" + e.d + "</td></tr>",
  ).join("");

  const faq = [
    ["调用返回 401 invalid_api_key", "检查请求头是否为 <code>Authorization: Bearer &lt;令牌&gt;</code>（注意 Bearer 后有一个空格）。若使用 Anthropic SDK，请改用 <code>x-api-key</code> 头。"],
    ["返回 404 model_not_found", "该模型不在当前令牌所属分组内。到「模型广场」确认模型的分组，或把令牌切换到 vip 分组。"],
    ["返回 429 rate_limit_exceeded", "超出并发或速率限制。建议按指数退避重试（1s、2s、4s、8s），或联系客服提升并发上限。"],
    ["流式响应被截断", "请确保客户端正确处理 SSE：以空行分隔事件、以 <code>data: [DONE]</code> 结束。中间不要做整体 JSON 解析。"],
    ["如何对账？", "调用日志页支持按时间范围与令牌筛选，字段包含输入/输出 tokens、耗时、状态码与逐次费用，可直接导出 CSV 与业务侧账单核对。"],
  ]
    .map((f) => "<details><summary>" + f[0] + '</summary><div class="db">' + f[1] + "</div></details>")
    .join("");

  const body =
    '<div class="wrap" style="padding-top:28px;padding-bottom:48px">' +
    '<div style="max-width:900px">' +
    "<h2 style=\"font-size:24px\">接口文档</h2>" +
    '<p class="muted" style="margin-top:8px">Astra Relay 同时提供 OpenAI 与 Anthropic 两套协议外形，两者共用同一份令牌与用量额度。</p>' +

    '<div class="card" style="margin-top:22px"><div class="card-h"><h3>快速开始</h3></div><div class="card-b">' +
    '<div class="kv"><span>Base URL</span><b class="mono">https://api.caar.fun/v1</b></div>' +
    '<div class="kv"><span>鉴权方式</span><b class="mono">Authorization: Bearer sk-astra-...</b></div>' +
    '<div class="kv"><span>内容类型</span><b class="mono">application/json</b></div>' +
    '<div class="kv"><span>流式支持</span><b>是（SSE，末帧带 usage）</b></div>' +
    "</div></div>" +

    '<h3 style="margin:28px 0 12px;font-size:17px">端点列表</h3>' +
    '<div class="card"><div class="tw"><table><thead><tr><th>方法</th><th>路径</th><th>说明</th></tr></thead><tbody>' + eps + "</tbody></table></div></div>" +

    '<h3 style="margin:28px 0 12px;font-size:17px">Python（openai SDK）</h3>' +
    '<pre class="code"><span class="k">from</span> openai <span class="k">import</span> OpenAI\n\n' +
    'client = OpenAI(base_url=<span class="s">"https://api.caar.fun/v1"</span>, api_key=<span class="s">"sk-astra-..."</span>)\n\n' +
    'stream = client.chat.completions.create(\n' +
    '    model=<span class="s">"gpt-6-astra"</span>,\n' +
    '    messages=[{<span class="s">"role"</span>: <span class="s">"user"</span>, <span class="s">"content"</span>: <span class="s">"用一句话解释注意力机制"</span>}],\n' +
    '    stream=<span class="k">True</span>,\n' +
    ')\n' +
    '<span class="k">for</span> chunk <span class="k">in</span> stream:\n' +
    '    <span class="k">if</span> chunk.choices <span class="k">and</span> chunk.choices[0].delta.content:\n' +
    '        print(chunk.choices[0].delta.content, end=<span class="s">""</span>)</pre>' +

    '<h3 style="margin:28px 0 12px;font-size:17px">Node.js（openai SDK）</h3>' +
    '<pre class="code"><span class="k">import</span> OpenAI <span class="k">from</span> <span class="s">"openai"</span>;\n\n' +
    '<span class="k">const</span> client = <span class="k">new</span> OpenAI({\n' +
    '  baseURL: <span class="s">"https://api.caar.fun/v1"</span>,\n' +
    '  apiKey: process.env.ASTRA_API_KEY,\n' +
    '});\n\n' +
    '<span class="k">const</span> resp = <span class="k">await</span> client.chat.completions.create({\n' +
    '  model: <span class="s">"deepseek-v4.1-flash"</span>,\n' +
    '  messages: [{ role: <span class="s">"user"</span>, content: <span class="s">"你好"</span> }],\n' +
    '});\n' +
    'process.stdout.write(resp.choices[0].message.content);</pre>' +

    '<h3 style="margin:28px 0 12px;font-size:17px">Anthropic Messages</h3>' +
    '<pre class="code">curl https://api.caar.fun/v1/messages \\\n' +
    '  -H <span class="s">"Content-Type: application/json"</span> \\\n' +
    '  -H <span class="s">"x-api-key: sk-astra-..."</span> \\\n' +
    '  -H <span class="s">"anthropic-version: 2023-06-01"</span> \\\n' +
    '  -d <span class="s">\'{"model":"gpt-6-astra","max_tokens":1024,"messages":[{"role":"user","content":"你好"}]}\'</span></pre>' +

    '<h3 style="margin:28px 0 12px;font-size:17px">响应示例</h3>' +
    '<pre class="lite">{\n  "id": "chatcmpl-8f2c41ab9e7d4a30",\n  "object": "chat.completion",\n  "created": 1790835728,\n  "model": "gpt-6-astra",\n  "choices": [{\n    "index": 0,\n    "message": { "role": "assistant", "content": "..." },\n    "finish_reason": "stop"\n  }],\n  "usage": { "prompt_tokens": 18, "completion_tokens": 236, "total_tokens": 254 }\n}</pre>' +

    '<h3 id="errors" style="margin:28px 0 12px;font-size:17px">错误码</h3>' +
    '<div class="card"><div class="tw"><table><thead><tr><th>HTTP</th><th>code</th><th>说明</th></tr></thead><tbody>' + errs + "</tbody></table></div></div>" +

    '<h3 style="margin:28px 0 12px;font-size:17px">速率限制</h3>' +
    '<div class="card"><div class="card-b">' +
    '<div class="kv"><span>default 分组</span><b>50 QPS / 200 并发</b></div>' +
    '<div class="kv"><span>vip 分组</span><b>200 QPS / 800 并发</b></div>' +
    '<div class="kv"><span>超限返回</span><b class="mono">429 rate_limit_exceeded</b></div>' +
    '<div class="kv"><span>建议</span><b>指数退避重试，首次 1s</b></div>' +
    "</div></div>" +

    '<h3 id="faq" style="margin:28px 0 12px;font-size:17px">常见问题</h3>' + faq +
    "</div></div>";

  return layout({ title: "接口文档 · Astra Relay", active: "/docs", authed: true, body });
}

// ── 服务状态 ──────────────────────────────────────────────────────────────

export function statusPage() {
  const rows = STATUS_ROWS.map(
    (s) =>
      "<tr><td class=\"mono\">" + s.id + '</td><td class="mono">' + s.up + '</td><td class="right mono">' + s.ms + " ms</td>" +
      '<td><span class="tag ' + (s.status === "正常" ? "ok" : "warn") + '"><i class="dot"></i>' + s.status + "</span></td></tr>",
  ).join("");

  const inc = INCIDENTS.map(
    (i) =>
      '<div style="padding:12px 0;border-bottom:1px solid var(--line2)">' +
      '<div class="row" style="justify-content:space-between"><b style="font-weight:500;color:var(--ink)">' + i.date +
      '</b><span class="small muted">持续 ' + i.dur + "</span></div>" +
      '<div class="muted small" style="margin-top:5px">' + i.text + "</div></div>",
  ).join("");

  const body =
    '<div class="wrap" style="padding-top:28px;padding-bottom:48px"><div style="max-width:900px">' +
    "<h2 style=\"font-size:24px\">服务状态</h2>" +
    '<p class="muted" style="margin-top:8px">实时监控各模型通道的可用性与响应延迟，数据每分钟更新。</p>' +
    '<div class="ok-note" style="margin-top:20px"><b>所有系统运行正常</b> · 最近一次故障 2026-10-07 09:12（已恢复）</div>' +
    '<div class="grid g3" style="margin-top:18px">' +
    '<div class="card stat"><div class="k">近 30 天可用率</div><div class="v">99.94%</div><div class="d">SLA 承诺 99.9%</div></div>' +
    '<div class="card stat"><div class="k">平均首字延迟</div><div class="v">1.8s</div><div class="d">P95 4.1s</div></div>' +
    '<div class="card stat"><div class="k">今日请求</div><div class="v">1,284</div><div class="d">成功率 99.53%</div></div>' +
    "</div>" +
    '<div class="card" style="margin-top:16px"><div class="card-h"><h3>各模型通道</h3><span class="small muted">近 24 小时</span></div>' +
    '<div class="tw"><table><thead><tr><th>模型</th><th>可用率</th><th class="right">平均延迟</th><th>状态</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>" +
    '<div class="card" style="margin-top:16px"><div class="card-h"><h3>历史事件</h3></div><div class="card-b" style="padding-top:6px">' + inc + "</div></div>" +
    "</div></div>";

  return layout({ title: "服务状态 · Astra Relay", active: "/status", authed: true, body });
}

// ── 关于 ──────────────────────────────────────────────────────────────────
// 这一页是本站唯二「说真话」的位置（另一处是每页页脚的小字）。

export function aboutPage() {
  const body =
    '<div class="wrap" style="padding-top:28px;padding-bottom:48px"><div style="max-width:820px">' +
    "<h2 style=\"font-size:24px\">关于 Astra Relay</h2>" +
    '<p class="muted" style="margin-top:8px">一个写着玩的「中转站」演示站点。</p>' +

    '<div class="card" style="margin-top:22px"><div class="card-b">' +
    "<h3 style=\"font-size:16px;margin-bottom:10px\">这个站是什么</h3>" +
    '<p style="color:var(--ink2)">它长得像一家做 AI 模型聚合的 API 中转站：有控制台、模型广场、令牌管理、调用日志、兑换中心和接口文档。这些页面的排版与文案都是照着真实中转站的样子写的。</p>' +
    '<p style="color:var(--ink2);margin-top:10px">但它不是一个真的中转站。它是我在 Cloudflare Workers 上写的一个整活项目，用来试试「一个页面要像到什么程度，才会让人第一眼相信它是真的」。</p>' +
    '<p style="color:var(--ink2);margin-top:10px">为了让「像」这件事彻底一点，<b>登录与注册是真的</b>：你注册的账号真的会存进 Cloudflare D1，控制台里每一个数字都来自这个数据库，而不是写死在源码里。下面把存了什么、没存什么一次说清楚。</p>' +
    "</div></div>" +

    '<div class="card" style="margin-top:16px"><div class="card-h"><h3>它真的存了什么（Cloudflare D1）</h3></div><div class="card-b">' +
    '<div class="kv"><span>邮箱</span><b>存了 —— 它是账号的唯一标识，用来登录</b></div>' +
    '<div class="kv"><span>密码</span><b>只存 PBKDF2-SHA256 派生值 + 每个账号独立的随机盐</b></div>' +
    '<div class="kv"><span>显示名称 / 注册时间 / 最近登录</span><b>存了</b></div>' +
    '<div class="kv"><span>API 令牌</span><b>只存 SHA-256 摘要，明文只在创建时显示一次</b></div>' +
    '<div class="kv"><span>调用日志</span><b>存模型名、token 数、耗时、状态码</b></div>' +
    '<div class="kv"><span>调用方 IP</span><b>没存，从来没记过</b></div>' +
    '<div class="kv"><span>请求体 / 响应体</span><b>没存，入不了库</b></div>' +
    "</div></div>" +

    '<div class="card" style="margin-top:16px"><div class="card-h"><h3>它明确不做的事</h3></div><div class="card-b">' +
    '<div class="kv"><span>不收任何钱</span><b>没有支付流程、没有订单、没有二维码</b></div>' +
    '<div class="kv"><span>不卖任何服务</span><b>余额只能用兑换码加，而兑换码买不到真东西</b></div>' +
    '<div class="kv"><span>不接任何真实上游</span><b>没有配置任何模型厂商的密钥</b></div>' +
    '<div class="kv"><span>不接受第三方密钥</span><b>请不要在本站输入任何真实的 API Key</b></div>' +
    '<div class="kv"><span>不向任何人发送你的密码</span><b>密码只用于本站登录校验，没有找回通道、也不发邮件</b></div>' +
    '<div class="kv"><span>不被搜索引擎收录</span><b>robots.txt 全站 Disallow，页面带 noindex</b></div>' +
    "</div></div>" +

    '<div class="card" style="margin-top:16px"><div class="card-b">' +
    "<h3 style=\"font-size:16px;margin-bottom:10px\">那它到底会返回什么</h3>" +
    '<p style="color:var(--ink2)">调用 <code>/v1/chat/completions</code>、<code>/v1/responses</code> 或 <code>/v1/messages</code>，无论传什么模型名、带不带令牌，返回的都是同一张「奶龙捧腹大笑」的 ASCII 图，包在三个反引号围栏里。这也包括任意不存在的路径 —— 本站刻意不做 404。</p>' +
    '<p style="color:var(--ink2);margin-top:10px"><code>/v1</code> 刻意不校验令牌（真中转站会返回 401，这里不会）—— 但如果你带上了自己账号的令牌，这次调用会被记进你的日志，好让控制台有东西可看。</p>' +
    '<p style="color:var(--ink2);margin-top:10px">它是主站 <a href="https://gpt.caar.fun">gpt.caar.fun</a> 的姊妹项目：那边是伪装成模型接口的同一个玩笑，这边是伪装成中转站面板的那一半。</p>' +
    "</div></div>" +

    '<div class="card" style="margin-top:16px"><div class="card-b">' +
    "<h3 style=\"font-size:16px;margin-bottom:10px\">技术细节</h3>" +
    '<div class="kv"><span>运行环境</span><b>Cloudflare Workers（零依赖、零构建）</b></div>' +
    '<div class="kv"><span>数据库</span><b>Cloudflare D1（SQLite），迁移脚本在仓库里</b></div>' +
    '<div class="kv"><span>账号数据</span><b>余额、令牌、日志、兑换记录全部来自 D1</b></div>' +
    '<div class="kv"><span>站点配置</span><b>模型清单 / 价格表 / 状态页是源码里的常量</b></div>' +
    '<div class="kv"><span>响应头</span><b class="mono">X-Relay-Note: fake-relay; ...</b></div>' +
    '<div class="kv"><span>源码</span><b><a href="https://github.com/JimmyReload/astra-fake-api">github.com/JimmyReload/astra-fake-api</a></b></div>' +
    "</div></div>" +

    '<div class="notice" style="margin-top:16px">如果你是在搜索某个 API 服务时误入这里的：这个站不提供任何真实服务，请不要在这里付款，也不要输入任何真实的 API 密钥。另外，注册时<b>请不要使用你在别处正在用的密码</b> —— 这里真的会把它存下来（以派生值的形式），而且没有找回密码的通道。</div>' +
    "</div></div>";

  return layout({ title: "关于 · Astra Relay", active: "/about", authed: true, body });
}
