// 用与 DSH LLM 栈完全同款的方式（Node 内置 fetch / undici，UA 就是 "node"）
// 打线上接口，量出新图的字符数 / 行数 / 围栏。
// 用法: node _e2e_node.mjs <baseUrl> <apiKey>
import { readFileSync } from "node:fs";

const base = (process.argv[2] || "https://gpt.caar.fun").replace(/\/+$/, "");
const key = process.argv[3];
if (!key) { console.error("缺少 apiKey"); process.exit(2); }

const local = readFileSync(new URL("./art_hd.txt", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "");

async function post(body, stream) {
  const r = await fetch(base + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify(body),
  });
  const ua = r.headers.get("x-powered-by") || "";
  if (!stream) return { status: r.status, ua, text: await r.text() };
  return { status: r.status, ua, text: await r.text() };
}

const fail = [];
const ck = (name, ok, ev) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ev ? "   [" + ev + "]" : ""}`); if (!ok) fail.push(name); };

// 非流式
const a = await post({ model: "gpt-6-astra", messages: [{ role: "user", content: "hi" }] }, false);
ck("非流式 HTTP 200", a.status === 200, "HTTP " + a.status);
ck("X-Powered-By 是奶龙引擎", a.ua === "nailong-laughing-engine", a.ua);
const j = JSON.parse(a.text);
const content = j.choices[0].message.content;
const cl = content.split("\n");
ck("正文首行是围栏", cl[0] === "```", JSON.stringify(cl[0]));
ck("正文末行是围栏", cl[cl.length - 1] === "```", JSON.stringify(cl[cl.length - 1]));
const inner = cl.slice(1, -1).join("\n");
ck("剥掉围栏后逐字节等于 art_hd.txt", inner === local, `${inner.length} vs ${local.length}`);
ck("object = chat.completion", j.object === "chat.completion", j.object);

// 流式
const s = await post({ model: "gpt-6-astra", messages: [], stream: true }, true);
const frames = s.text.split("\n").filter((x) => x.startsWith("data: "));
const payloads = frames.filter((x) => x !== "data: [DONE]");
let sse = "";
let contentFrames = 0;
let usageFrames = 0;
for (const p of payloads) {
  const o = JSON.parse(p.slice(6));
  const c = o.choices?.[0];
  if (!c) { usageFrames++; continue; }
  const d = c.delta?.content;
  if (typeof d === "string") { sse += d; contentFrames++; }
}
ck("流式拼接 == 非流式正文", sse === content, `${contentFrames} 个内容帧 + ${usageFrames} 个 usage 帧`);
ck("data: [DONE] 恰好一个", frames.filter((x) => x === "data: [DONE]").length === 1);

// 未知路径回裸图（无围栏）
const r2 = await fetch(base + "/whatever", { headers: { authorization: "Bearer " + key } });
const raw = await r2.text();
ck("未知路径回裸图、无围栏", r2.status === 200 && raw === local, `${raw.length} 字符`);

console.log("");
console.log(`基准 art_hd.txt 去尾换行 = ${local.length} 字符 / ${local.split("\n").length} 行`);
console.log(`围栏正文 = ${content.length} 字符 / ${cl.length} 行`);
console.log(`SSE 内容帧 = ${contentFrames} 个 / usage 帧 ${usageFrames} 个 / data 帧共 ${frames.length} 个`);
console.log(`基准 sha256 前 16 = ${(await import("node:crypto")).createHash("sha256").update(local).digest("hex").slice(0, 16)}`);
console.log("");
console.log(fail.length ? `合计 ${fail.length} 项失败: ${fail.join(", ")}` : "合计 9/9 通过");
process.exit(fail.length ? 1 : 0);
