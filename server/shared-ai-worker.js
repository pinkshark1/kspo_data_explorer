// 공용 무료 Gemini 중계. 키는 런타임 Secret에서만 읽고 방문자에게 반환하지 않는다.
import { AI_SCHEMA, LIMITS, buildSystemPrompt, buildUserMessage, cleanCandidate, parseAiResponse } from "../src/ai/prompt.js";
import { readGeminiText } from "../src/ai/providers/gemini.js";

export const SHARED_MODEL = "gemini-3.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${SHARED_MODEL}:generateContent`;
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_BODY_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_PROMPT_CHARS = 40_000;
const SYSTEM = buildSystemPrompt({ orgName: "국민체육진흥공단", serviceName: "KSPO 데이터 지도" });

function allowedOrigins(value) {
  return String(value ?? "").split(",").map((part) => part.trim()).filter((part) => {
    try {
      const url = new URL(part);
      return url.origin === part && !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
    } catch { return false; }
  });
}

function ready(env) {
  // 이 확인값은 운영자의 Free 등급 확인 기록이며, Google의 결제 상태를 조회하는 장치는 아니다.
  // 결제가 연결되지 않은 전용 Free 프로젝트를 사용해야 실제 유료 호출을 방지할 수 있다.
  return env.GEMINI_FREE_TIER_CONFIRMED === "true" && Boolean(env.GEMINI_API_KEY?.trim()) && Boolean(env.TURNSTILE_SECRET_KEY?.trim()) && allowedOrigins(env.AI_ALLOWED_ORIGINS).length > 0 && typeof env.REQUEST_LIMITER?.limit === "function";
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
  if (!body || Array.isArray(body) || Object.keys(body).some((key) => !["question", "candidates", "verificationToken"].includes(key))) throw new Error("bad_request");
  if (typeof body.verificationToken !== "string" || !body.verificationToken.trim() || body.verificationToken.length > 2048) throw new Error("bad_request");
  if (typeof body.question !== "string" || body.question.trim().length < 2 || body.question.length > LIMITS.questionChars) throw new Error("bad_request");
  if (!Array.isArray(body.candidates) || !body.candidates.length || body.candidates.length > LIMITS.candidates) throw new Error("bad_request");
  const candidates = body.candidates.map(cleanCandidate);
  if (candidates.some((item) => !item || !Number.isSafeInteger(item.no) || item.no < 1 || !item.name)) throw new Error("bad_request");
  if (new Set(candidates.map((item) => item.no)).size !== candidates.length || JSON.stringify(candidates).length > MAX_PROMPT_CHARS) throw new Error("bad_request");
  return { question: body.question.trim(), candidates, verificationToken: body.verificationToken };
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

export function createSharedAiHandler({ fetchImpl = (...args) => fetch(...args), timeoutMs = 55_000, maxConcurrent = 4 } = {}) {
  // 동시 처리 수는 Worker 인스턴스별 보호 장치다. 전체 Google 한도는 Free 프로젝트가 적용한다.
  let active = 0;
  return async function handle(request, env) {
    const origin = request.headers.get("origin") ?? "";
    const allowed = allowedOrigins(env.AI_ALLOWED_ORIGINS).includes(origin);
    const cors = allowed ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", "Access-Control-Expose-Headers": "Retry-After" } : {};
    const send = (status, value, extra = {}) => new Response(value === null ? null : JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Vary: "Origin", ...cors, ...extra } });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") return send(ready(env) ? 200 : 503, { ok: ready(env) });
    if (url.pathname !== "/recommend" || url.search) return send(404, { error: "not_found" });
    if (!allowed) return send(403, { error: "origin_not_allowed" });
    if (request.method === "OPTIONS") return send(204, null);
    if (request.method !== "POST") return send(405, { error: "method_not_allowed" }, { Allow: "POST, OPTIONS" });
    if (!ready(env)) return send(503, { error: "unavailable" });
    if (request.signal.aborted) return send(499, { error: "cancelled" });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return send(415, { error: "bad_request" });
    if (request.headers.has("authorization") || request.headers.has("x-goog-api-key")) return send(400, { error: "bad_request" });
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
      if (controller.signal.aborted) return send(499, { error: "cancelled" });
      const response = await fetchImpl(GEMINI_URL, {
        method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY.trim() },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: buildUserMessage(input.question, input.candidates) }] }],
          generationConfig: { maxOutputTokens: 8192, responseMimeType: "application/json", responseJsonSchema: AI_SCHEMA },
        }),
        signal: controller.signal,
      });
      let data;
      try { data = JSON.parse(await boundedText(response, MAX_RESPONSE_BYTES)); }
      catch { return send(502, { error: "upstream" }); }
      if (response.status === 429) {
        const facts = quotaFacts(data);
        return send(facts.error === "unavailable" ? 503 : 429, facts, facts.retryAfterSeconds ? { "Retry-After": String(facts.retryAfterSeconds) } : {});
      }
      if (!response.ok) return send(502, { error: "upstream" });
      const answer = parseAiResponse(readGeminiText(data), input.candidates.map((candidate) => candidate.no));
      if (!answer) return send(502, { error: "upstream" });
      return send(200, answer);
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
