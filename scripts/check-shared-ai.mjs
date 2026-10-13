// 공용 무료 중계의 보안 경계·한도 분류·취소를 실제 키나 외부 호출 없이 검증한다.
import assert from "node:assert/strict";
import { createSharedAiHandler, quotaFacts, SHARED_MODEL } from "../server/shared-ai-worker.js";

let passed = 0;
async function check(name, run) {
  await run();
  passed += 1;
  console.log(`PASS  ${name}`);
}
const origin = "https://site.example";
const privateValue = "test-only-" + "q".repeat(24);
const env = {
  GEMINI_API_KEY: privateValue,
  TURNSTILE_SECRET_KEY: "test-only-turnstile",
  GEMINI_FREE_TIER_CONFIRMED: "true",
  AI_ALLOWED_ORIGINS: origin,
  REQUEST_LIMITER: { limit: async () => ({ success: true }) },
};
const input = { question: "체육시설 안전 데이터", verificationToken: "test-visitor-proof", candidates: [{ no: 82, name: "체육시설 안전 정보", field: "체육시설", type: "파일", summary: "안전 정보" }] };
const answer = { summary: "체육시설 안전 정보를 확인하세요.", recommendations: [{ no: 82, relevance: "high", reason: "안전 관련 자료입니다." }, { no: 9999, relevance: "high", reason: "후보 밖 정보" }], combinations: [] };
const responseData = () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(answer) }] } }] });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
function request(body = input, options = {}) {
  return new Request(`https://api.example${options.path ?? "/recommend"}`, {
    method: options.method ?? "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1", ...options.headers },
    ...(options.method === "GET" || options.method === "OPTIONS" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}
function harness(reply = () => json(responseData()), options = {}) {
  const calls = [];
  const verifications = [];
  const verify = options.verify ?? (() => json({ success: true, hostname: "site.example", action: "shared-ai" }));
  const handle = createSharedAiHandler({ ...options, fetchImpl: async (...args) => {
    if (args[0] === "https://challenges.cloudflare.com/turnstile/v0/siteverify") { verifications.push(args); return verify(...args); }
    calls.push(args); return reply(...args);
  } });
  return { handle, calls, verifications };
}
const quota = (id, delay = "53.2s", value = "500") => ({ error: { status: "RESOURCE_EXHAUSTED", message: privateValue, details: [
  { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: id, quotaValue: value, quotaDimensions: { project: "private-project" } }] },
  { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: delay },
] } });

await check("정상 응답·후보 밖 번호 제거·고정 모델·키는 Google 헤더에만 전달", async () => {
  const { handle, calls } = harness();
  const response = await handle(request(), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json();
  assert.deepEqual(payload.recommendations.map((item) => item.no), [82]);
  assert.ok(!JSON.stringify(payload).includes(privateValue));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], `https://generativelanguage.googleapis.com/v1beta/models/${SHARED_MODEL}:generateContent`);
  assert.equal(calls[0][1].headers["x-goog-api-key"], privateValue);
  assert.equal(calls[0][1].redirect, "manual");
  assert.ok(!calls[0][1].body.includes(privateValue));
  assert.equal(JSON.parse(calls[0][1].body).generationConfig.maxOutputTokens, 8192);
});
await check("Free 등급 미확인·키/Origin/제한 장치 미설정 시 외부 호출 차단", async () => {
  for (const override of [{ GEMINI_FREE_TIER_CONFIRMED: "false" }, { GEMINI_API_KEY: "" }, { TURNSTILE_SECRET_KEY: "" }, { AI_ALLOWED_ORIGINS: "" }, { REQUEST_LIMITER: undefined }]) {
    const { handle, calls } = harness();
    const result = await handle(request(), { ...env, ...override });
    assert.ok([403, 503].includes(result.status));
    assert.equal(calls.length, 0);
  }
});
await check("허용되지 않은 Origin·Origin 없음·위장 하위 도메인 차단", async () => {
  for (const badOrigin of ["", "null", "https://evil.example", `${origin}.evil.example`]) {
    const { handle, calls } = harness();
    const response = await handle(request(input, { headers: { Origin: badOrigin } }), env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(calls.length, 0);
  }
});
await check("CORS 사전 요청만 처리하고 API 키·인증 헤더는 허용하지 않음", async () => {
  const { handle, calls } = harness();
  const response = await handle(request(input, { method: "OPTIONS" }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-headers"), "Content-Type");
  for (const headers of [{ Authorization: "Bearer test" }, { "x-goog-api-key": "visitor-key" }]) {
    assert.equal((await handle(request(input, { headers }), env)).status, 400);
  }
  assert.equal(calls.length, 0);
});
await check("잘못된 요청·임의 모델/키/URL·중복 후보·큰 본문은 Google 호출 전 거절", async () => {
  const { handle, calls } = harness();
  for (const body of ["{", null, [], {}, { ...input, question: "" }, { ...input, question: "가".repeat(301) }, { ...input, candidates: [] }, { ...input, candidates: [input.candidates[0], input.candidates[0]] }, { ...input, candidates: [{ no: -1, name: "test" }] }, { ...input, candidates: [{ no: 82 }] }, { ...input, model: "other-model" }, { ...input, apiKey: "visitor-key" }, { ...input, url: "https://evil.example" }]) {
    assert.equal((await handle(request(body), env)).status, 400);
  }
  assert.equal((await handle(request("x".repeat(128 * 1024 + 1)), env)).status, 413);
  assert.equal((await handle(request(input, { headers: { "Content-Type": "text/plain" } }), env)).status, 415);
  assert.equal((await handle(request(input, { path: "/recommend?key=private" }), env)).status, 404);
  assert.equal(calls.length, 0);
});
await check("분당·일일 무료 한도와 대기 시간만 전달하고 민감 오류 원문은 제거", async () => {
  for (const [id, expected] of [["GenerateRequestsPerDayPerProjectPerModel-FreeTier", "daily"], ["GenerateContentInputTokensPerModelPerMinute-FreeTier", "minute"]]) {
    const { handle, calls } = harness(() => json(quota(id), 429));
    const response = await handle(request(), env);
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: "shared_quota", quota: expected, retryAfterSeconds: 54 });
    assert.equal(response.headers.get("retry-after"), "54");
    assert.equal(calls.length, 1, "한도 소진 시 자동 재시도하지 않는다");
  }
});
await check("정확한 한도 종류가 없는 RESOURCE_EXHAUSTED는 unknown으로 전달", async () => {
  assert.deepEqual(quotaFacts({ error: { status: "RESOURCE_EXHAUSTED", message: privateValue } }), { error: "shared_quota", quota: "unknown" });
  assert.deepEqual(quotaFacts(quota("custom_limit", "999999s")), { error: "shared_quota", quota: "unknown" });
});
await check("사용 권한이 없는 0 한도와 일반 429를 일일 한도 소진으로 잘못 알리지 않음", async () => {
  const unavailable = harness(() => json(quota("RequestsPerDay", "20s", "0"), 429));
  const response = await unavailable.handle(request(), env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "unavailable" });
  const busy = harness(() => json({ error: { status: "UNAVAILABLE", message: privateValue } }, 429));
  assert.deepEqual(await (await busy.handle(request(), env)).json(), { error: "busy" });
});
await check("서버 인증·설정·일시 오류는 안전한 오류로만 전달", async () => {
  for (const status of [400, 401, 403, 404, 500, 503]) {
    const { handle } = harness(() => json({ error: { message: privateValue } }, status));
    const response = await handle(request(), env);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "upstream" });
  }
});
await check("외부 서비스 리디렉션을 따라가지 않아 키와 방문자 토큰을 다른 주소로 보내지 않음", async () => {
  const redirected = () => new Response(null, { status: 302, headers: { Location: "https://evil.example" } });
  const verification = harness(undefined, { verify: redirected });
  assert.equal((await verification.handle(request(), env)).status, 503);
  assert.equal(verification.verifications[0][1].redirect, "manual");
  assert.equal(verification.calls.length, 0);
  const gemini = harness(redirected);
  assert.equal((await gemini.handle(request(), env)).status, 502);
  assert.equal(gemini.calls.length, 1);
  assert.equal(gemini.calls[0][1].redirect, "manual");
});
await check("거절·응답 형식 오류·과대한 응답은 기본 검색으로 전환할 안전한 코드", async () => {
  for (const [data, status] of [[{ promptFeedback: { blockReason: "SAFETY" } }, 422], [{ candidates: [{ finishReason: "MAX_TOKENS" }] }, 502], [{ candidates: [{ content: { parts: [{ text: "not json" }] } }] }, 502]]) {
    const { handle } = harness(() => json(data));
    assert.equal((await handle(request(), env)).status, status);
  }
  const { handle } = harness(() => new Response("x".repeat(256 * 1024 + 1)));
  assert.equal((await handle(request(), env)).status, 502);
});
await check("방문자별 요청 제한은 혼잡으로 안내하고 공용 한도로 오인하지 않음", async () => {
  const { handle, calls } = harness();
  const response = await handle(request(), { ...env, REQUEST_LIMITER: { limit: async () => ({ success: false }) } });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "busy" });
  assert.equal(calls.length, 0);
});
await check("유효하지 않은 큰 본문도 요청 제한을 먼저 적용하고 차단 시 읽지 않음", async () => {
  let admitted = 0;
  const { handle, calls, verifications } = harness();
  for (const body of ["{", "x".repeat(128 * 1024 + 1)]) {
    const incoming = request(body);
    const response = await handle(incoming, { ...env, REQUEST_LIMITER: { limit: async () => { admitted += 1; return { success: false }; } } });
    assert.equal(response.status, 429);
    assert.equal(incoming.bodyUsed, false);
  }
  assert.equal(admitted, 2);
  assert.equal(calls.length, 0);
  assert.equal(verifications.length, 0);
});
await check("방문자 토큰·호스트·용도 검증 실패 시 Gemini 호출 없이 차단", async () => {
  for (const verified of [{ success: false, "error-codes": ["timeout-or-duplicate"] }, { success: true, hostname: "evil.example", action: "shared-ai" }, { success: true, hostname: "site.example", action: "other-action" }]) {
    const { handle, calls } = harness(undefined, { verify: () => json(verified) });
    assert.equal((await handle(request(), env)).status, 403);
    assert.equal(calls.length, 0);
  }
  for (const verificationToken of [undefined, "", "x".repeat(2049)]) {
    const { handle, calls, verifications } = harness();
    assert.equal((await handle(request({ ...input, verificationToken }), env)).status, 400);
    assert.equal(calls.length + verifications.length, 0);
  }
});
await check("방문자 검증 토큰은 재사용할 수 없고 검증 서비스에 Gemini 키를 보내지 않음", async () => {
  const used = new Set();
  const { handle, calls, verifications } = harness(undefined, { verify: (_url, options) => {
    const token = options.body.get("response");
    const success = !used.has(token); used.add(token);
    return json({ success, hostname: "site.example", action: "shared-ai" });
  } });
  assert.equal((await handle(request(), env)).status, 200);
  assert.equal((await handle(request(), env)).status, 403);
  assert.equal(calls.length, 1);
  assert.equal(verifications.length, 2);
  assert.ok(!verifications[0][1].body.toString().includes(privateValue));
  assert.ok(!calls[0][1].body.includes(input.verificationToken));
});
await check("서버 처리 슬롯이 가득 차도 한도 소진으로 오인하지 않고 끝나면 복구", async () => {
  let release;
  const { handle, calls } = harness(() => new Promise((resolve) => { release = () => resolve(json(responseData())); }), { maxConcurrent: 1 });
  const pending = handle(request(), env);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  const blocked = await handle(request(), env);
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { error: "busy" });
  assert.equal(calls.length, 1);
  release();
  assert.equal((await pending).status, 200);
  release = null;
  const next = handle(request(), env);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  release();
  assert.equal((await next).status, 200);
});
await check("미리 취소한 요청은 전송하지 않고 진행 중 취소·시간 초과는 슬롯 반환", async () => {
  const pre = new AbortController(); pre.abort();
  const { handle, calls } = harness();
  assert.equal((await handle(request(input, { signal: pre.signal }), env)).status, 499);
  assert.equal(calls.length, 0);
  const active = new AbortController();
  const waitForAbort = harness((_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); }), { timeoutMs: 30 });
  const pending = waitForAbort.handle(request(input, { signal: active.signal }), env);
  while (!waitForAbort.calls.length) await new Promise((resolve) => setImmediate(resolve));
  active.abort();
  assert.equal((await pending).status, 499);
  assert.equal((await waitForAbort.handle(request(), env)).status, 504);
});
console.log(`\n${passed}/${passed} 공용 AI 중계 검사 통과`);
