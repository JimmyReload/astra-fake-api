// 假中转站 · Cloudflare Worker 入口。零依赖、零构建、无 secret。
//
// 路由分三层：
//   1. 面板页（/、/panel、/models、/tokens、/usage、/recharge、/settings、/login、/docs、/about）
//   2. 假的 JSON 接口（/api/*）—— 全是写死的假数据，不读请求体、不记日志
//   3. /v1/* —— OpenAI / Anthropic 两套外形，任何调用都返回同一张奶龙
//   4. 其它任何路径 —— 200 + 裸图（刻意不 404，这是整活的内核）
import { MODELS, LOGS, PLANS, STATS, landing, loginPage, panelPage, modelsPage, tokensPage, usagePage, rechargePage, settingsPage, docsPage, aboutPage } from "./pages.js";
import {
  pickArt, chatCompletion, responsesApi, anthropicMessage, countTokens, modelList,
  headers, json, htmlResponse, textResponse,
} from "./nailong.js";

const VERSION = "0.1.0";
const DEFAULT_MODEL = "gpt-6-astra";

// 带 HTML 页面的路径 -> 渲染函数
const PAGES = {
  "/": landing,
  "/index.html": landing,
  "/login": loginPage,
  "/panel": panelPage,
  "/dashboard": panelPage,
  "/models": modelsPage,
  "/tokens": tokensPage,
  "/usage": usagePage,
  "/recharge": rechargePage,
  "/settings": settingsPage,
  "/docs": docsPage,
  "/about": aboutPage,
};

// 假面板接口。值全部写死；**任何一条都不读请求体**。
function fakeApi(path) {
  const p = path.replace(/\/+$/, "") || "/api";
  const ok = (data) => json({ success: true, message: "", data });

  if (p === "/api" || p === "/api/status") {
    return ok({
      version: `v${VERSION}-fake`,
      site_name: "Astra Relay（假的）",
      server_address: "api.caar.fun",
      start_time: 1759800000,
      uptime_seconds: 86400 * 37,
      // 明写在接口里，免得有人真拿它做监控
      note: "整活站：/api 下的一切都是写死的假数据，不读请求体、不写日志。",
      disclaimer: "本站不收钱、不收密钥、不接任何真实上游。任何 /v1 调用只会返回一张奶龙。",
    });
  }
  if (p === "/api/models") return ok(MODELS);
  if (p === "/api/pricing") {
    return ok(
      MODELS.map((m) => ({
        model_name: m.id,
        quota_type: 0,
        model_ratio: m.price,
        completion_ratio: 1,
        enable_groups: ["default"],
        note: "倍率是编的",
      })),
    );
  }
  if (p === "/api/user/self" || p === "/api/user") {
    return ok({
      id: 1,
      username: "nailong",
      display_name: "奶龙（捧腹大笑版）",
      role: 1,
      status: 1,
      email: "nailong@example.com",
      quota: 9999999999,
      used_quota: 0,
      request_count: 1284,
      group: "default",
      note: "余额是写死的 ¥9,999.99 换算过来的。本站不做账。",
    });
  }
  if (p === "/api/token" || p === "/api/token/") {
    return ok([
      { id: 1, name: "默认令牌", key: "sk-astra-····9f2c", status: 1, remain_quota: 9999999999, used_quota: 38200000, expired_time: -1 },
      { id: 2, name: "给朋友的", key: "sk-friend-····41ab", status: 1, remain_quota: 1200000, used_quota: 88400000, expired_time: 1798675200 },
      { id: 3, name: "测试用", key: "sk-test-····7d10", status: 1, remain_quota: 9999999999, used_quota: 0, expired_time: -1 },
    ]);
  }
  if (p === "/api/log/self" || p === "/api/log") return ok(LOGS);
  if (p === "/api/group" || p === "/api/groups") return ok(["default", "vip"]);
  if (p === "/api/plans" || p === "/api/recharge") return ok(PLANS);
  if (p === "/api/stats") return ok(STATS);

  return json({
    success: false,
    message: "整活站：/api 下没有这个接口，而且这里所有数据都是写死的假数据。",
    hint: "真正会回你东西的只有 /v1/models 和 /v1/chat/completions —— 它们回一张奶龙。",
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const art = pickArt(url.searchParams.get("art"));

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headers() });
    }

    // ── /v1：两套协议外形，正文永远是同一张图 ───────────────────────────────
    if (path === "/v1/models") return modelList(MODELS);

    if (path === "/v1/chat/completions" || path === "/v1/completions") {
      const { model, stream } = await readRequest(request, url);
      return chatCompletion({ model, art, stream });
    }
    if (path === "/v1/responses") {
      const { model } = await readRequest(request, url);
      return responsesApi({ model, art });
    }
    if (path === "/v1/messages") {
      const { model } = await readRequest(request, url);
      return anthropicMessage({ model, art });
    }
    if (path === "/v1/messages/count_tokens") {
      const { model } = await readRequest(request, url);
      return countTokens({ model, art });
    }

    // ── /api：假面板接口 ────────────────────────────────────────────────────
    if (path === "/api" || path.startsWith("/api/")) return fakeApi(path);

    // ── 爬虫礼貌：本站是整活站，不希望被索引 ────────────────────────────────
    if (path === "/robots.txt") {
      return textResponse("User-agent: *\nDisallow: /\n");
    }

    // ── 面板页 ──────────────────────────────────────────────────────────────
    const render = PAGES[path] ?? PAGES[path.replace(/\/+$/, "") || "/"];
    if (render) return htmlResponse(render());

    // ── 其它一切：200 + 裸图。刻意不 404 —— 这是整活的内核 ──────────────────
    return textResponse(art);
  },
};

/**
 * 只为把 model 名字原样回显在响应里而读一下请求体。
 * 读到的内容**不存、不记、不转发**；解析失败一律回落默认模型，不报错。
 * （这里没有任何 console.log —— 请求体不该出现在任何日志里。）
 */
async function readRequest(request, url) {
  let model = url.searchParams.get("model") || DEFAULT_MODEL;
  let stream = url.searchParams.get("stream") === "true";
  if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
    try {
      const raw = await request.text();
      if (raw && raw.length < 2_000_000) {
        const data = JSON.parse(raw);
        if (data && typeof data === "object") {
          if (typeof data.model === "string" && data.model.trim()) model = data.model.trim();
          if (data.stream === true) stream = true;
        }
      }
    } catch {
      // 不是 JSON 也无所谓 —— 反正答案一样
    }
  }
  return { model, stream };
}
