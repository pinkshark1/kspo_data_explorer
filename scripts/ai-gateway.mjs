// 질문 검색용 AI 중계 서버(참조 구현). 브라우저에는 API 키를 두지 않고, 이 서버가 키를 보관해 Claude 를 호출한다.
//
//   ANTHROPIC_API_KEY=... AI_GATEWAY_ORIGINS=https://내-서비스-주소 node scripts/ai-gateway.mjs
//
// 화면은 data/site.json 의 ai.gateway.url 로 POST 한다.
//   요청  POST /recommend  { question, candidates:[{no,name,field,...}] }
//   응답  200 { summary, recommendations:[{no,relevance,reason}], combinations:[{title,nos,idea}] }
//         422 { error:"refusal" } AI 가 답하지 못함 / 400 요청 오류 / 413 요청이 큼 / 429 호출 제한 / 502 AI 쪽 오류 / 503 혼잡
//
// 모델을 바꾸거나 다른 AI 서비스를 쓰려면 이 파일 대신 같은 요청·응답 규격의 서버를 두면 된다. (화면 코드는 그대로)
//
// ※ 허용 주소(Origin) 검사는 '다른 사이트의 브라우저 화면'을 막을 뿐 인증이 아니다. curl 등은 Origin 을 흉내 낼 수 있으므로,
//    공개 운영 시에는 앞단(리버스 프록시·API 게이트웨이·WAF)의 접근 제어와 아래 하루 한도·동시 처리 한도를 함께 쓴다.
//
// 환경변수 (ANTHROPIC_API_KEY 외에는 선택)
//   ANTHROPIC_API_KEY          Claude API 키 (필수, SDK 가 읽음. 소스·저장소에 넣지 않는다)
//   AI_GATEWAY_PORT / _HOST    기본 8787 / 127.0.0.1 (외부에 열려면 HTTPS 리버스 프록시 뒤에 두고 0.0.0.0)
//   AI_GATEWAY_ORIGINS         호출을 허용할 화면 주소(쉼표 구분). 기본 http://localhost:4173
//   AI_GATEWAY_ALLOW_NO_ORIGIN true 면 Origin 헤더 없는 요청(서버 간 호출 등)도 허용. 기본 false
//   AI_GATEWAY_TRUST_PROXY     true 면 X-Forwarded-For 의 첫 주소를 이용자 IP 로 본다(프록시 뒤에서만). 기본 false
//   AI_GATEWAY_MODEL / _EFFORT / _MAX_TOKENS / _REFUSAL_FALLBACK   기본은 claude-haiku-4-5 (data/site.json 에 ai.claude 가 있으면 그 값) (_EFFORT=none 이면 effort 미전송)
//   AI_GATEWAY_RATE_PER_MIN    IP 당 분당 요청 수. 기본 20
//   AI_GATEWAY_DAILY_LIMIT     하루 전체 요청 수 상한(0 이면 제한 없음). 기본 2000
//   AI_GATEWAY_MAX_CONCURRENT  동시에 처리하는 요청 수 상한. 기본 4
//   AI_GATEWAY_MAX_PROMPT_CHARS 후보 정보 전체 글자 수 상한. 기본 40000
//   AI_GATEWAY_ORG_NAME / _SERVICE_NAME   프롬프트에 쓰는 이름
//   ANTHROPIC_BASE_URL         (시험용) Anthropic API 주소 바꾸기
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { AiError } from "../src/ai/errors.js";
import { LIMITS, buildSystemPrompt, buildUserMessage, cleanCandidate, parseAiResponse } from "../src/ai/prompt.js";
import { runClaudeRequest } from "../src/ai/providers/claude.js";

const env = process.env;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteClaude = JSON.parse(fs.readFileSync(path.join(root, "data", "site.json"), "utf8")).ai?.claude ?? {};

function numberEnv(name, fallback, { min = 0 } = {}) {
  if (env[name] === undefined || env[name] === "") return fallback;
  const value = Number(env[name]);
  if (!Number.isFinite(value) || value < min) {
    console.error(`환경변수 ${name} 값이 올바르지 않습니다: ${env[name]}`);
    process.exit(2);
  }
  return value;
}
const flag = (name, fallback = false) => (env[name] === undefined ? fallback : env[name] === "true");

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
if (env.AI_GATEWAY_EFFORT && env.AI_GATEWAY_EFFORT !== "none" && !EFFORTS.includes(env.AI_GATEWAY_EFFORT)) {
  console.error(`환경변수 AI_GATEWAY_EFFORT 는 ${EFFORTS.join("|")}|none 중 하나여야 합니다.`);
  process.exit(2);
}

const config = {
  port: numberEnv("AI_GATEWAY_PORT", 8787, { min: 1 }),
  host: env.AI_GATEWAY_HOST || "127.0.0.1",
  origins: (env.AI_GATEWAY_ORIGINS || "http://localhost:4173").split(",").map((origin) => origin.trim()).filter(Boolean),
  allowNoOrigin: flag("AI_GATEWAY_ALLOW_NO_ORIGIN"),
  trustProxy: flag("AI_GATEWAY_TRUST_PROXY"),
  ratePerMinute: numberEnv("AI_GATEWAY_RATE_PER_MIN", 20, { min: 1 }),
  dailyLimit: numberEnv("AI_GATEWAY_DAILY_LIMIT", 2000),
  maxConcurrent: numberEnv("AI_GATEWAY_MAX_CONCURRENT", 4, { min: 1 }),
  maxPromptChars: numberEnv("AI_GATEWAY_MAX_PROMPT_CHARS", 40_000, { min: 1000 }),
  orgName: env.AI_GATEWAY_ORG_NAME || "국민체육진흥공단",
  serviceName: env.AI_GATEWAY_SERVICE_NAME || "KSPO 데이터 지도",
  claude: {
    model: env.AI_GATEWAY_MODEL || siteClaude.model || "claude-haiku-4-5",
    effort: env.AI_GATEWAY_EFFORT === undefined ? (siteClaude.effort ?? null) : env.AI_GATEWAY_EFFORT === "none" ? null : env.AI_GATEWAY_EFFORT,
    maxTokens: numberEnv("AI_GATEWAY_MAX_TOKENS", Math.min(siteClaude.maxTokens ?? 8000, 8000), { min: 256 }),
    refusalFallback: flag("AI_GATEWAY_REFUSAL_FALLBACK", siteClaude.refusalFallback ?? false),
  },
};
const MAX_BODY_BYTES = 256 * 1024;

const client = new Anthropic({ timeout: 60_000, maxRetries: 1, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) });

// ---- 호출 제한 (메모리) ----
const hits = new Map(); // ip -> 최근 1분간 '처리한' 요청 시각들
let activeRequests = 0;
let dayKey = "";
let dayCount = 0;

setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of hits) {
    const recent = times.filter((time) => now - time < 60_000);
    if (recent.length) hits.set(ip, recent);
    else hits.delete(ip);
  }
}, 60_000).unref();

function checkAdmission(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= config.ratePerMinute) return "rate_limited";
  const today = new Date(now + 9 * 3600_000).toISOString().slice(0, 10); // 한국 시간 기준 하루
  if (today !== dayKey) {
    dayKey = today;
    dayCount = 0;
  }
  if (config.dailyLimit && dayCount >= config.dailyLimit) return "daily_limit";
  if (activeRequests >= config.maxConcurrent) return "busy";
  recent.push(now); // 거절된 요청은 기록하지 않는다 (재시도하는 이용자가 계속 막히지 않게)
  hits.set(ip, recent);
  dayCount += 1;
  return null;
}

function clientIp(req) {
  if (config.trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function corsHeaders(origin) {
  return config.origins.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", Vary: "Origin" }
    : { Vary: "Origin" };
}

function send(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new AiError("too_large", "요청이 너무 큽니다."));
        req.removeAllListeners("data");
        req.resume(); // 응답을 보낸 뒤 연결을 닫을 때까지 남은 데이터를 흘려보낸다
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const text = (value, max) => String(value ?? "").slice(0, max);

// 화면에서 온 요청을 검사하고, 후보는 길이를 제한한 형태로 바꾼다.
function validateRequest(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AiError("bad_request", "JSON 형식이 올바르지 않습니다.");
  }
  const question = text(data?.question, LIMITS.questionChars).trim();
  if (question.length < 2) throw new AiError("bad_request", "질문이 비어 있습니다.");
  if (!Array.isArray(data.candidates) || data.candidates.length < 1 || data.candidates.length > LIMITS.candidates) {
    throw new AiError("bad_request", `candidates 는 1~${LIMITS.candidates}개여야 합니다.`);
  }
  const candidates = data.candidates.map(cleanCandidate);
  if (candidates.some((candidate) => candidate === null)) throw new AiError("bad_request", "후보의 no 가 올바르지 않습니다.");
  if (JSON.stringify(candidates).length > config.maxPromptChars) throw new AiError("bad_request", "후보 정보가 너무 큽니다.");
  return { question, candidates };
}

async function recommend(raw, signal) {
  const { question, candidates } = validateRequest(raw);
  const system = buildSystemPrompt({ orgName: config.orgName, serviceName: config.serviceName });
  const answer = await runClaudeRequest({ Anthropic, client, config: config.claude, system, userMessage: buildUserMessage(question, candidates), signal });
  const parsed = parseAiResponse(answer, candidates.map((candidate) => candidate.no));
  if (!parsed) throw new AiError("format", "AI 응답 형식이 올바르지 않습니다.");
  return parsed;
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const origin = req.headers.origin ?? "";
  const cors = corsHeaders(origin);
  let logged = false;
  const done = (status) => {
    if (logged) return;
    logged = true;
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${status} ${Date.now() - started}ms`); // 질문 내용은 기록하지 않는다
  };

  if (req.method === "GET" && req.url === "/healthz") {
    send(res, 200, { ok: true });
    return done(200);
  }
  if (req.method === "OPTIONS") {
    const allowed = config.origins.includes(origin);
    res.writeHead(allowed ? 204 : 403, cors);
    res.end();
    return done(allowed ? 204 : 403);
  }
  if (req.method !== "POST" || req.url !== "/recommend") {
    send(res, 404, { error: "not_found" }, cors);
    return done(404);
  }
  if (origin ? !config.origins.includes(origin) : !config.allowNoOrigin) {
    send(res, 403, { error: "origin_not_allowed" }, cors);
    return done(403);
  }
  const denied = checkAdmission(clientIp(req));
  if (denied) {
    const status = denied === "rate_limited" ? 429 : 503;
    send(res, status, { error: denied }, { ...cors, "Retry-After": "60" });
    return done(status);
  }

  // 이용자가 연결을 끊으면 Claude 호출도 멈춘다.
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  activeRequests += 1;
  try {
    const result = await recommend(await readBody(req), controller.signal);
    if (!controller.signal.aborted) send(res, 200, result, cors);
    return done(200);
  } catch (error) {
    if (controller.signal.aborted) return done(499);
    const code = error instanceof AiError ? error.code : "internal";
    const status = { bad_request: 400, too_large: 413, refusal: 422, rate: 429 }[code] ?? (code === "internal" ? 500 : 502);
    // 외부 서비스(Claude)의 오류 내용과 종류는 응답에 담지 않고, 서버 로그에만 남긴다.
    if (status >= 500) console.error(`${new Date().toISOString()} upstream/internal error: ${code}`);
    send(res, status, { error: status === 502 ? "upstream" : code }, cors);
    if (status === 413) res.on("finish", () => req.destroy());
    return done(status);
  } finally {
    activeRequests -= 1;
  }
});

// 요청을 천천히 보내며 처리 자리를 차지하는 연결을 막는다.
server.requestTimeout = 20_000;
server.headersTimeout = 10_000;

server.listen(config.port, config.host, () => {
  console.log(`AI 중계 서버: http://${config.host}:${config.port}/recommend  (모델 ${config.claude.model}, 허용 화면 ${config.origins.join(", ")})`);
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) console.warn("경고: ANTHROPIC_API_KEY 가 설정되어 있지 않습니다. 요청은 인증 오류로 실패합니다.");
  if (config.allowNoOrigin) console.warn("경고: Origin 이 없는 요청을 허용하는 설정입니다. 앞단의 접근 제어를 확인하세요.");
});
