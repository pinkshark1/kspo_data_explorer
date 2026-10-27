// 공용 무료 AI 중계. Claude(Anthropic 조직에 포함된 API 크레딧)를 먼저 쓰고, 설정이 없거나 실패하면 무료 Gemini로 넘긴다.
// 키는 런타임 Secret에서만 읽고 방문자에게 반환하지 않는다.
import Anthropic from "@anthropic-ai/sdk";
import { AI_SCHEMA, LIMITS, buildSystemPrompt, buildUserMessage, cleanCandidate, parseAiResponse } from "../src/ai/prompt.js";
import { runClaudeRequest } from "../src/ai/providers/claude.js";
import { readGeminiText } from "../src/ai/providers/gemini.js";

export const SHARED_MODEL = "gemini-3.5-flash-lite";
export const SHARED_CLAUDE_MODEL = "claude-haiku-5-5";
// 후보 중에서 고르고 짧게 설명하는 작업이라 effort를 낮춰 크레딧을 아낀다. 출력 상한은 Gemini와 같다.
// Haiku 5.5는 생각(thinking)이 기본으로 켜져 있어 답이 몇 초 늦어지므로 끈다(effort high 이하에서 허용). 받지 않으면 켠 채로 다시 보낸다.
// Haiku에는 거절 시 다른 모델로 넘기는 서버 폴백이 없으므로 끈다.
const CLAUDE_CONFIG = { model: SHARED_CLAUDE_MODEL, maxTokens: 8192, effort: "low", thinking: "disabled", refusalFallback: false };
const ANTHROPIC_URL = "https://api.anthropic.com";
// 같은 Worker 인스턴스에서 Claude를 잠시 건너뛰는 시간. 크레딧 소진·키 오류는 곧 풀리지 않으므로 길게 둔다.
// 시간 초과·연결 실패·서비스 오류도 잠시 건너뛰어, 그동안 다른 이용자가 Claude를 기다리지 않고 바로 Gemini 답을 받게 한다.
const CLAUDE_PAUSE_MS = { billing: 10 * 60_000, key: 10 * 60_000, rate: 60_000, timeout: 60_000, network: 60_000, server: 30_000 };
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${SHARED_MODEL}:generateContent`;
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_BODY_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_PROMPT_CHARS = 40_000;
// 이용 확인을 통과한 방문자에게 주는 통행증의 유효 시간. 그동안은 질문마다 이용 확인을 다시 받지 않는다. (2026-10-27 사용자 결정 30분)
export const PASS_TTL_SECONDS = 30 * 60;
const SYSTEM = buildSystemPrompt({ orgName: "국민체육진흥공단", serviceName: "KSPO 데이터 지도" });

function allowedOrigins(value) {
  return String(value ?? "").split(",").map((part) => part.trim()).filter((part) => {
    try {
      const url = new URL(part);
      return url.origin === part && !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
    } catch { return false; }
  });
}

function geminiReady(env) {
  // 이 확인값은 운영자의 Free 등급 확인 기록이며, Google의 결제 상태를 조회하는 장치는 아니다.
  // 결제가 연결되지 않은 전용 Free 프로젝트를 사용해야 실제 유료 호출을 방지할 수 있다.
  return env.GEMINI_FREE_TIER_CONFIRMED === "true" && Boolean(env.GEMINI_API_KEY?.trim());
}

function claudeReady(env) {
  // 이 확인값은 운영자가 Anthropic Console 조직에 구매한 크레딧이 없고 자동 충전이 꺼져 있음을 확인한 기록이며, 결제 상태를 조회하는 장치는 아니다.
  // 그 상태에서는 포함 크레딧이 바닥나면 Anthropic이 요청을 거절하므로 크레딧을 넘어 과금되지 않는다.
  return env.ANTHROPIC_CREDITS_ONLY_CONFIRMED === "true" && Boolean(env.ANTHROPIC_API_KEY?.trim());
}

// 이상 징후가 없으면 이용 확인 없이 받는다. (2026-10-27 사용자 결정: Turnstile은 이상 접근 때만)
// 이용 확인 없는 요청이 같은 IP에서 분당 3회, 전체에서 분당 30회를 넘으면 이상 징후로 보고 이용 확인을 요구한다.
// Cloudflare 요청 제한 바인딩은 근사치라 실측에서 분당 12회도 막지 않았으므로, 하나의 Durable Object가 정확히 센다.
export const UNVERIFIED_PER_IP_PER_MINUTE = 3;
export const UNVERIFIED_TOTAL_PER_MINUTE = 30;

// 분 단위 고정 창으로 센다. 개수는 메모리에만 두며(객체가 내려가면 0부터 다시 셈) IP를 저장하지 않는다.
export class UsageGate {
  constructor() {
    this.minute = 0;
    this.perIp = new Map();
    this.total = 0;
  }

  async fetch(request) {
    const { ip } = await request.json();
    const minute = Math.floor(Date.now() / 60_000);
    if (minute !== this.minute) {
      this.minute = minute;
      this.perIp.clear();
      this.total = 0;
    }
    const mine = (this.perIp.get(ip) ?? 0) + 1;
    if (typeof ip !== "string" || !ip || mine > UNVERIFIED_PER_IP_PER_MINUTE || this.total + 1 > UNVERIFIED_TOTAL_PER_MINUTE) return Response.json({ ok: false });
    this.perIp.set(ip, mine);
    this.total += 1;
    return Response.json({ ok: true });
  }
}

// 계수 장치가 설정되지 않았거나 응답하지 않으면 안전하게 항상 이용 확인을 요구한다.
async function admitWithoutVerification(env, ip) {
  if (typeof env.USAGE_GATE?.idFromName !== "function") return false;
  try {
    const gate = env.USAGE_GATE.get(env.USAGE_GATE.idFromName("unverified"));
    const response = await gate.fetch("https://usage-gate/check", { method: "POST", body: JSON.stringify({ ip }) });
    return response.ok && (await response.json()).ok === true;
  } catch { return false; }
}

function ready(env) {
  return (claudeReady(env) || geminiReady(env)) && Boolean(env.TURNSTILE_SECRET_KEY?.trim()) && allowedOrigins(env.AI_ALLOWED_ORIGINS).length > 0 && typeof env.REQUEST_LIMITER?.limit === "function";
}

async function boundedText(message, limit) {
  const declared = Number(message.headers.get("content-length"));
  if (declared > limit) throw new Error("body_too_large");
  if (!message.body) return "";
  const reader = message.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

function validateBody(raw) {
  const body = JSON.parse(raw);
  if (!body || Array.isArray(body) || Object.keys(body).some((key) => !["question", "candidates", "verificationToken", "pass"].includes(key))) throw new Error("bad_request");
  // 이용 확인 토큰과 통행증은 둘 중 하나만 받는다. 둘 다 없으면 이용 확인 없는 요청이다.
  if (body.verificationToken !== undefined && body.pass !== undefined) throw new Error("bad_request");
  if (body.verificationToken !== undefined && (typeof body.verificationToken !== "string" || !body.verificationToken.trim() || body.verificationToken.length > 2048)) throw new Error("bad_request");
  if (body.pass !== undefined && (typeof body.pass !== "string" || body.pass.length > 200)) throw new Error("bad_request");
  if (typeof body.question !== "string" || body.question.trim().length < 2 || body.question.length > LIMITS.questionChars) throw new Error("bad_request");
  if (!Array.isArray(body.candidates) || !body.candidates.length || body.candidates.length > LIMITS.candidates) throw new Error("bad_request");
  const candidates = body.candidates.map(cleanCandidate);
  if (candidates.some((item) => !item || !Number.isSafeInteger(item.no) || item.no < 1 || !item.name)) throw new Error("bad_request");
  if (new Set(candidates.map((item) => item.no)).size !== candidates.length || JSON.stringify(candidates).length > MAX_PROMPT_CHARS) throw new Error("bad_request");
  return { question: body.question.trim(), candidates, verificationToken: body.verificationToken, pass: body.pass };
}

// 통행증: "만료시각(초).서명". 서명은 Turnstile Secret에서 파생한 HMAC 키로 만료시각·접속 IP·화면 Origin을 묶는다.
// 다른 IP·다른 화면에서 쓰거나 만료되면 받지 않는다. 서버에 저장하지 않으며 새 Secret도 필요 없다.
const encoder = new TextEncoder();
const toBase64Url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fromBase64Url(text) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function passKey(secret) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", base, encoder.encode("kspo-shared-ai-pass-v1"));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
const passMessage = (expires, ip, origin) => encoder.encode(`v1|${expires}|${ip}|${origin}`);

// 같은 질문·같은 후보에는 저장해 둔 답을 돌려준다(Workers KV, 7일). 키에 지시문도 넣어 지시문·데이터가 바뀌면 새로 묻는다.
// 저장소가 없거나 읽기·쓰기에 실패하면(무료 한도 초과 등) 저장 없이 평소대로 AI에 묻는다. 질문 원문은 키에 해시로만 남는다.
export const ANSWER_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export async function answerCacheKey(input) {
  const normalized = JSON.stringify({ system: SYSTEM, question: input.question.replace(/\s+/g, " "), candidates: input.candidates });
  return `answer:v1:${toBase64Url(await crypto.subtle.digest("SHA-256", encoder.encode(normalized)))}`;
}

export async function issuePass(secret, ip, origin, now = Date.now()) {
  const expires = Math.floor(now / 1000) + PASS_TTL_SECONDS;
  const signature = await crypto.subtle.sign("HMAC", await passKey(secret), passMessage(expires, ip, origin));
  return `${expires}.${toBase64Url(signature)}`;
}

export async function passValid(secret, pass, ip, origin, now = Date.now()) {
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(pass ?? "");
  if (!match) return false;
  const expires = Number(match[1]);
  if (expires <= Math.floor(now / 1000) || expires > Math.floor(now / 1000) + PASS_TTL_SECONDS) return false;
  try {
    return await crypto.subtle.verify("HMAC", await passKey(secret), fromBase64Url(match[2]), passMessage(expires, ip, origin));
  } catch { return false; }
}

// 외부 오류 문장·프로젝트 ID·키는 반환하지 않고 허용한 한도 종류만 전달한다.
export function quotaFacts(data) {
  const details = Array.isArray(data?.error?.details) ? data.error.details : [];
  const violations = details.filter((item) => item?.["@type"] === "type.googleapis.com/google.rpc.QuotaFailure")
    .flatMap((item) => Array.isArray(item.violations) ? item.violations : []);
  if (violations.some((item) => String(item?.quotaValue) === "0")) return { error: "unavailable" };
  if (!violations.length && data?.error?.status !== "RESOURCE_EXHAUSTED") return { error: "busy" };
  const ids = violations.map((item) => `${item?.quotaId ?? ""} ${item?.quotaMetric ?? ""}`).join(" ");
  const quota = /per_?day|daily/i.test(ids) ? "daily" : /per_?minute/i.test(ids) ? "minute" : "unknown";
  const retry = details.find((item) => item?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo")?.retryDelay;
  const seconds = typeof retry === "string" && /^\d+(?:\.\d+)?s$/.test(retry) ? Math.ceil(Number.parseFloat(retry)) : 0;
  return { error: "shared_quota", quota, ...(seconds > 0 && seconds <= 86_400 ? { retryAfterSeconds: seconds } : {}) };
}

function pause(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); }
    signal.addEventListener("abort", done, { once: true });
  });
}

// Claude가 정해진 시간 안에 답하지 못하거나 실패하면(거절 제외) 같은 질문을 Gemini에 묻는다. 이용 확인은 다시 하지 않는다.
// 생각을 끈 Haiku는 보통 몇 초 안에 답하므로, 기다리는 시간을 15초로 두고 남은 시간을 Gemini에 넘긴다.
// Google이 일시 과부하(500·503 "high demand")로 즉시 거절하면 짧게 기다렸다 다시 묻는다.
// 한도 소진(429)은 다시 묻지 않는다.
export function createSharedAiHandler({ fetchImpl = (...args) => fetch(...args), timeoutMs = 55_000, claudeTimeoutMs = 15_000, maxConcurrent = 4, retryDelaysMs = [1_000, 2_500] } = {}) {
  // 동시 처리 수는 Worker 인스턴스별 보호 장치다. 전체 Google 한도는 Free 프로젝트가 적용한다.
  let active = 0;
  let claudePause = { until: 0, reason: null };

  // SDK가 환경변수의 주소·인증값을 쓰지 않도록 주소와 키를 직접 지정한다. 실패는 Gemini가 대신하므로 SDK 재시도는 끈다.
  async function askClaude(env, input, signal) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY.trim(), authToken: null, baseURL: ANTHROPIC_URL, maxRetries: 0, timeout: claudeTimeoutMs, fetch: fetchImpl, fetchOptions: { redirect: "manual" } });
    const text = await runClaudeRequest({ Anthropic, client, config: CLAUDE_CONFIG, system: SYSTEM, userMessage: buildUserMessage(input.question, input.candidates), signal });
    return parseAiResponse(text, input.candidates.map((candidate) => candidate.no));
  }

  return async function handle(request, env, ctx) {
    const origin = request.headers.get("origin") ?? "";
    const allowed = allowedOrigins(env.AI_ALLOWED_ORIGINS).includes(origin);
    const cors = allowed ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", "Access-Control-Expose-Headers": "Retry-After, X-AI-Pass" } : {};
    // 이용 확인을 막 통과한 요청이면 이후 응답에 새 통행증을 붙인다.
    let newPass = null;
    const send = (status, value, extra = {}) => new Response(value === null ? null : JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Origin", ...cors, ...(newPass ? { "X-AI-Pass": newPass } : {}), ...extra } });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") return send(ready(env) ? 200 : 503, { ok: ready(env) });
    if (url.pathname !== "/recommend" || url.search) return send(404, { error: "not_found" });
    if (!allowed) return send(403, { error: "origin_not_allowed" });
    if (request.method === "OPTIONS") return send(204, null);
    if (request.method !== "POST") return send(405, { error: "method_not_allowed" }, { Allow: "POST, OPTIONS" });
    if (!ready(env)) return send(503, { error: "unavailable" });
    if (request.signal.aborted) return send(499, { error: "cancelled" });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return send(415, { error: "bad_request" });
    if (request.headers.has("authorization") || request.headers.has("x-goog-api-key") || request.headers.has("x-api-key")) return send(400, { error: "bad_request" });
    // CF-Connecting-IP는 Cloudflare가 붙인 값만 사용한다. 일반 전달 헤더는 신뢰하지 않는다.
    const ip = request.headers.get("cf-connecting-ip");
    if (!ip) return send(503, { error: "unavailable" });
    try {
      const admission = await env.REQUEST_LIMITER.limit({ key: `recommend:${ip}` });
      if (!admission.success) return send(429, { error: "busy" }, { "Retry-After": "60" });
    } catch { return send(503, { error: "unavailable" }); }
    let input;
    try { input = validateBody(await boundedText(request, MAX_BODY_BYTES)); }
    catch (error) { return send(error.message === "body_too_large" ? 413 : 400, { error: "bad_request" }); }
    if (request.signal.aborted) return send(499, { error: "cancelled" });
    if (active >= maxConcurrent) return send(429, { error: "busy" }, { "Retry-After": "5" });
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    active += 1;
    try {
      if (controller.signal.aborted) return send(499, { error: "cancelled" });
      if (input.pass !== undefined) {
        // 30분 안에 이용 확인을 통과한 같은 IP·같은 화면의 통행증이면 Turnstile 검증을 건너뛴다.
        if (!(await passValid(env.TURNSTILE_SECRET_KEY, input.pass, ip, origin))) return send(403, { error: "verification_failed" });
      } else if (input.verificationToken === undefined) {
        if (!(await admitWithoutVerification(env, ip))) return send(403, { error: "verification_required" });
      } else {
        // Origin은 인증이 아니다. 단일사용 방문자 토큰을 발급한 서비스에 직접 검증한다.
        const verification = await fetchImpl(VERIFY_URL, {
          method: "POST", redirect: "manual",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: input.verificationToken, remoteip: ip }),
          signal: controller.signal,
        });
        if (!verification.ok) return send(503, { error: "unavailable" });
        let verified;
        try { verified = JSON.parse(await boundedText(verification, 8192)); }
        catch { return send(503, { error: "unavailable" }); }
        if (verified.success !== true || verified.action !== "shared-ai" || verified.hostname !== new URL(origin).hostname) return send(403, { error: "verification_failed" });
        newPass = await issuePass(env.TURNSTILE_SECRET_KEY, ip, origin);
      }
      if (controller.signal.aborted) return send(499, { error: "cancelled" });
      const cache = typeof env.ANSWER_CACHE?.get === "function" && typeof env.ANSWER_CACHE?.put === "function" ? env.ANSWER_CACHE : null;
      let cacheKey = null;
      if (cache) {
        try {
          cacheKey = await answerCacheKey(input);
          const saved = await cache.get(cacheKey, "json");
          if (saved?.answer && ["claude", "gemini"].includes(saved.provider)) return send(200, saved.answer, { "X-AI-Provider": saved.provider, "X-AI-Cache": "hit" });
        } catch { /* 저장소 오류는 무시하고 AI에 묻는다 */ }
      }
      // 답을 돌려준 뒤 저장한다(응답을 늦추지 않음).
      const remember = (answer, provider) => {
        if (!cache || !cacheKey) return;
        const saving = cache.put(cacheKey, JSON.stringify({ answer, provider }), { expirationTtl: ANSWER_CACHE_TTL_SECONDS }).catch(() => {});
        if (typeof ctx?.waitUntil === "function") ctx.waitUntil(saving);
      };
      let claudeFailure = null;
      if (claudeReady(env)) {
        if (Date.now() < claudePause.until) claudeFailure = claudePause.reason;
        else {
          const claudeController = new AbortController();
          const stopClaude = () => claudeController.abort();
          controller.signal.addEventListener("abort", stopClaude, { once: true });
          const claudeTimer = setTimeout(stopClaude, claudeTimeoutMs);
          try {
            const answer = await askClaude(env, input, claudeController.signal);
            if (answer) {
              remember(answer, "claude");
              return send(200, answer, { "X-AI-Provider": "claude" });
            }
            claudeFailure = "format";
          } catch (error) {
            if (error?.code === "refusal") return send(422, { error: "refusal" });
            // 정해진 시간이 지나 끊은 경우는 SDK가 취소(cancelled)로 알리므로 시간 초과로 바꿔 기록한다.
            claudeFailure = claudeController.signal.aborted && !controller.signal.aborted ? "timeout" : error?.code ?? "server";
            if (CLAUDE_PAUSE_MS[claudeFailure]) claudePause = { until: Date.now() + CLAUDE_PAUSE_MS[claudeFailure], reason: claudeFailure };
          } finally {
            clearTimeout(claudeTimer);
            controller.signal.removeEventListener("abort", stopClaude);
          }
          if (controller.signal.aborted) return send(request.signal.aborted ? 499 : 504, { error: request.signal.aborted ? "cancelled" : "upstream" });
        }
      }
      if (!geminiReady(env)) {
        // 크레딧 소진은 화면이 본인 키 안내를 보여 주도록 공용 한도 소진으로 알린다.
        if (claudeFailure === "billing") return send(429, { error: "shared_quota", quota: "unknown" });
        if (claudeFailure === "rate") return send(429, { error: "busy" }, { "Retry-After": "60" });
        return send(502, { error: "upstream" });
      }
      const geminiBody = JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: buildUserMessage(input.question, input.candidates) }] }],
        generationConfig: { maxOutputTokens: 8192, responseMimeType: "application/json", responseJsonSchema: AI_SCHEMA },
      });
      let response;
      let data;
      for (let attempt = 0; ; attempt += 1) {
        response = await fetchImpl(GEMINI_URL, {
          method: "POST", redirect: "manual",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY.trim() },
          body: geminiBody,
          signal: controller.signal,
        });
        try { data = JSON.parse(await boundedText(response, MAX_RESPONSE_BYTES)); }
        catch { data = undefined; }
        if (![500, 503].includes(response.status) || attempt >= retryDelaysMs.length) break;
        await pause(retryDelaysMs[attempt], controller.signal);
        if (controller.signal.aborted) break;
      }
      if (controller.signal.aborted) return send(request.signal.aborted ? 499 : 504, { error: request.signal.aborted ? "cancelled" : "upstream" });
      if ([500, 503].includes(response.status)) return send(503, { error: "busy" }, { "Retry-After": "30" });
      if (data === undefined) return send(502, { error: "upstream" });
      if (response.status === 429) {
        const facts = quotaFacts(data);
        return send(facts.error === "unavailable" ? 503 : 429, facts, facts.retryAfterSeconds ? { "Retry-After": String(facts.retryAfterSeconds) } : {});
      }
      if (!response.ok) return send(502, { error: "upstream" });
      const answer = parseAiResponse(readGeminiText(data), input.candidates.map((candidate) => candidate.no));
      if (!answer) return send(502, { error: "upstream" });
      remember(answer, "gemini");
      return send(200, answer, { "X-AI-Provider": "gemini" });
    } catch (error) {
      if (request.signal.aborted) return send(499, { error: "cancelled" });
      if (error?.code === "refusal") return send(422, { error: "refusal" });
      return send(controller.signal.aborted ? 504 : 502, { error: "upstream" });
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onAbort);
      active -= 1;
    }
  };
}

export default { fetch: createSharedAiHandler() };
