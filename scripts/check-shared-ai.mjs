// 공용 무료 중계의 보안 경계·한도 분류·취소를 실제 키나 외부 호출 없이 검증한다.
import assert from "node:assert/strict";
import { createSharedAiHandler, issuePass, PASS_TTL_SECONDS, quotaFacts, SHARED_CLAUDE_MODEL, SHARED_MODEL, UNVERIFIED_PER_IP_PER_MINUTE, UNVERIFIED_TOTAL_PER_MINUTE, UsageGate } from "../server/shared-ai-worker.js";

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
  for (const headers of [{ Authorization: "Bearer test" }, { "x-goog-api-key": "visitor-key" }, { "x-api-key": "visitor-key" }]) {
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
  for (const status of [400, 401, 403, 404]) {
    const { handle, calls } = harness(() => json({ error: { message: privateValue } }, status));
    const response = await handle(request(), env);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "upstream" });
    assert.equal(calls.length, 1, "일시 오류가 아니면 다시 묻지 않는다");
  }
});
await check("Google 일시 과부하(500·503)는 짧게 다시 묻고, 계속되면 혼잡으로 안내", async () => {
  const overloaded = (status) => json({ error: { code: status, status: "UNAVAILABLE", message: privateValue } }, status);
  for (const status of [500, 503]) {
    let count = 0;
    const recovered = harness(() => (count++ === 0 ? overloaded(status) : json(responseData())), { retryDelaysMs: [0, 0] });
    const ok = await recovered.handle(request(), env);
    assert.equal(ok.status, 200);
    assert.equal(recovered.calls.length, 2);
    assert.equal(recovered.verifications.length, 1, "방문자 토큰은 한 번만 확인한다");
    const stuck = harness(() => overloaded(status), { retryDelaysMs: [0, 0] });
    const response = await stuck.handle(request(), env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "busy" });
    assert.equal(response.headers.get("retry-after"), "30");
    assert.equal(stuck.calls.length, 3);
  }
  const html = harness(() => new Response("<html>unavailable</html>", { status: 503 }), { retryDelaysMs: [0] });
  assert.equal((await html.handle(request(), env)).status, 503);
  assert.equal(html.calls.length, 2);
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
  // 토큰이 없으면 이용 확인 없는 요청이다. 확인 없는 요청의 제한 장치가 없으면 이용 확인을 요구한다.
  for (const [verificationToken, status] of [[undefined, 403], ["", 400], ["x".repeat(2049), 400], [123, 400]]) {
    const { handle, calls, verifications } = harness();
    assert.equal((await handle(request({ ...input, verificationToken }), env)).status, status);
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

// ---- Claude 우선 호출 (Anthropic 조직의 포함 크레딧) ----
// 이용 확인은 이상 징후 때만: 평소에는 확인 없이 받고, 통과한 방문자에게는 30분 통행증을 준다.
// Durable Object 바인딩 흉내: 실제 UsageGate 클래스 하나를 모든 요청이 함께 쓴다.
const gateBinding = (gate = new UsageGate()) => ({ names: [], idFromName(name) { this.names.push(name); return name; }, get: () => ({ fetch: (url, init) => gate.fetch(new Request(url, init)) }) });
const freeEnv = (binding = gateBinding()) => ({ ...env, USAGE_GATE: binding });
const fromIp = (body, ip) => request(body, { headers: { "CF-Connecting-IP": ip } });
const { verificationToken: _unused, ...plainInput } = input;
await check("[이용 확인] 이상 징후가 없으면 Turnstile 없이 답하고 통행증은 주지 않는다", async () => {
  const { handle, calls, verifications } = harness();
  const testEnv = freeEnv();
  const response = await handle(request(plainInput), testEnv);
  assert.equal(response.status, 200);
  assert.equal(verifications.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(response.headers.get("x-ai-pass"), null);
  assert.deepEqual(testEnv.USAGE_GATE.names, ["unverified"], "모든 요청이 한 계수 장치를 함께 쓴다");
});
await check("[이용 확인] 같은 IP에서 분당 3회를 넘으면 정확히 그다음 요청부터 이용 확인을 요구하고, 다른 IP는 영향 없음", async () => {
  const { handle, calls } = harness();
  const testEnv = freeEnv();
  const statuses = [];
  for (let i = 0; i < UNVERIFIED_PER_IP_PER_MINUTE + 1; i += 1) statuses.push((await handle(request(plainInput), testEnv)).status);
  assert.deepEqual(statuses, [200, 200, 200, 403]);
  assert.equal((await handle(fromIp(plainInput, "198.51.100.7"), testEnv)).status, 200);
  assert.equal(calls.length, UNVERIFIED_PER_IP_PER_MINUTE + 1);
});
await check("[이용 확인] 전체가 분당 30회를 넘으면(여러 IP로 나눠도) 이용 확인을 요구한다", async () => {
  const { handle } = harness();
  const testEnv = freeEnv();
  for (let i = 0; i < UNVERIFIED_TOTAL_PER_MINUTE; i += 1) assert.equal((await handle(fromIp(plainInput, `203.0.113.${i}`), testEnv)).status, 200);
  const blocked = await handle(fromIp(plainInput, "203.0.113.200"), testEnv);
  assert.equal(blocked.status, 403);
  assert.deepEqual(await blocked.json(), { error: "verification_required" });
});
await check("[이용 확인] 계수 장치가 없거나 오류이면 AI를 부르지 않고 이용 확인을 요구한다", async () => {
  const broken = { idFromName: () => "x", get: () => ({ fetch: async () => { throw new Error("down"); } }) };
  const failing = { idFromName: () => "x", get: () => ({ fetch: async () => new Response("err", { status: 500 }) }) };
  for (const testEnv of [env, freeEnv(broken), freeEnv(failing)]) {
    const { handle, calls, verifications } = harness();
    const response = await handle(request(plainInput), testEnv);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "verification_required" });
    assert.equal(calls.length + verifications.length, 0);
  }
});
await check("[이용 확인] Turnstile을 통과하면 30분 통행증을 주고, 통행증 요청은 Turnstile·확인 없는 상한 없이 답한다", async () => {
  const { handle, calls, verifications } = harness();
  const gate = new UsageGate();
  gate.perIp.set("192.0.2.1", UNVERIFIED_PER_IP_PER_MINUTE);
  gate.minute = Math.floor(Date.now() / 60_000);
  const testEnv = freeEnv(gateBinding(gate));
  assert.equal((await handle(request(plainInput), testEnv)).status, 403, "이미 상한에 걸린 IP");
  const first = await handle(request(), testEnv);
  assert.equal(first.status, 200);
  const pass = first.headers.get("x-ai-pass");
  assert.match(pass, /^\d+\.[A-Za-z0-9_-]{43}$/);
  assert.ok(first.headers.get("access-control-expose-headers").includes("X-AI-Pass"));
  const expires = Number(pass.split(".")[0]);
  assert.ok(Math.abs(expires - (Math.floor(Date.now() / 1000) + PASS_TTL_SECONDS)) <= 2);
  const second = await handle(request({ ...plainInput, pass }), testEnv);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-ai-pass"), null, "통행증 요청에는 새 통행증을 주지 않는다");
  assert.equal(verifications.length, 1);
  assert.equal(calls.length, 2, "상한에 걸린 IP도 이용 확인·통행증으로는 답을 받는다");
});
await check("[이용 확인] 다른 IP·위조·만료·다른 비밀값 통행증은 거절하고, 토큰과 통행증을 함께 보내면 잘못된 요청", async () => {
  const secret = env.TURNSTILE_SECRET_KEY;
  const good = await issuePass(secret, "192.0.2.1", origin);
  const [expires, signature] = good.split(".");
  const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
  const cases = [
    await issuePass(secret, "198.51.100.7", origin),
    `${Number(expires) + 60}.${signature}`,
    `${expires}.${flipped}`,
    await issuePass(secret, "192.0.2.1", origin, Date.now() - (PASS_TTL_SECONDS + 5) * 1000),
    await issuePass("other-secret", "192.0.2.1", origin),
    "not-a-pass",
  ];
  for (const pass of cases) {
    const { handle, calls } = harness();
    const response = await handle(request({ ...plainInput, pass }), freeEnv());
    assert.equal(response.status, 403, pass);
    assert.deepEqual(await response.json(), { error: "verification_failed" });
    assert.equal(calls.length, 0);
  }
  const { handle, calls } = harness();
  const both = await handle(request({ ...input, pass: good }), freeEnv());
  assert.equal(both.status, 400);
  assert.equal(calls.length, 0);
});
const claudeKey = "test-only-anthropic-" + "z".repeat(24);
const claudeEnv = { ...env, ANTHROPIC_API_KEY: claudeKey, ANTHROPIC_CREDITS_ONLY_CONFIRMED: "true" };
const claudeOnlyEnv = { ...claudeEnv, GEMINI_API_KEY: "", GEMINI_FREE_TIER_CONFIRMED: "false" };
const ANTHROPIC_MESSAGES = "https://api.anthropic.com/v1/messages";
const isClaude = (call) => String(call[0]).startsWith("https://api.anthropic.com/");
const claudeMessage = (content = [{ type: "text", text: JSON.stringify(answer) }], stopReason = "end_turn") => ({ id: "msg_test", type: "message", role: "assistant", model: SHARED_CLAUDE_MODEL, content, stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
const claudeError = (status, type) => json({ type: "error", error: { type, message: privateValue } }, status);
// 주소로 Claude·Gemini 요청을 나눠 각각의 모의 응답을 돌려준다.
const routed = ({ claude = () => json(claudeMessage()), gemini = () => json(responseData()) } = {}) => (url, options) => (String(url).startsWith("https://api.anthropic.com/") ? claude(url, options) : gemini(url, options));

await check("[Claude] 먼저 호출·고정 모델과 설정·키는 Anthropic 헤더에만·후보 밖 번호 제거·Gemini 미호출", async () => {
  const { handle, calls } = harness(routed());
  const response = await handle(request(), claudeEnv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-ai-provider"), "claude");
  const payload = await response.json();
  assert.deepEqual(payload.recommendations.map((item) => item.no), [82]);
  assert.ok(!JSON.stringify(payload).includes(claudeKey));
  assert.equal(calls.length, 1);
  assert.equal(String(calls[0][0]), ANTHROPIC_MESSAGES);
  const headers = new Headers(calls[0][1].headers);
  assert.equal(headers.get("x-api-key"), claudeKey);
  assert.equal(headers.get("authorization"), null);
  assert.equal(calls[0][1].redirect, "manual");
  const body = JSON.parse(calls[0][1].body);
  assert.equal(body.model, SHARED_CLAUDE_MODEL);
  assert.equal(body.max_tokens, 8192);
  assert.equal(body.output_config.effort, "low");
  assert.deepEqual(body.thinking, { type: "disabled" }, "응답을 빠르게 하려고 생각을 끈다");
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(body.fallbacks, undefined);
  assert.ok(!calls[0][1].body.includes(input.verificationToken), "방문자 토큰은 Anthropic에 보내지 않는다");
  assert.ok(!calls[0][1].body.includes(privateValue), "Gemini 키는 Anthropic에 보내지 않는다");
});
await check("[Claude] 크레딧 확인값·키가 없으면 Claude를 부르지 않고 Gemini만 사용", async () => {
  for (const override of [{ ANTHROPIC_CREDITS_ONLY_CONFIRMED: "false" }, { ANTHROPIC_CREDITS_ONLY_CONFIRMED: undefined }, { ANTHROPIC_API_KEY: "" }]) {
    const { handle, calls } = harness(routed());
    const response = await handle(request(), { ...claudeEnv, ...override });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-ai-provider"), "gemini");
    assert.equal(calls.length, 1);
    assert.ok(!calls.some(isClaude));
  }
});
await check("[Claude] Gemini 설정 없이 Claude만 있어도 준비 상태이며 Claude로 답함", async () => {
  const { handle, calls } = harness(routed());
  assert.equal((await handle(request(undefined, { method: "GET", path: "/healthz" }), claudeOnlyEnv)).status, 200);
  const response = await handle(request(), claudeOnlyEnv);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.ok(isClaude(calls[0]));
});
await check("[Claude] 크레딧 소진(billing_error)은 Gemini로 넘기고 같은 인스턴스는 한동안 Claude를 건너뜀", async () => {
  for (const status of [402, 400]) {
    const { handle, calls } = harness(routed({ claude: () => claudeError(status, "billing_error") }));
    const first = await handle(request(), claudeEnv);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("x-ai-provider"), "gemini");
    assert.equal(calls.filter(isClaude).length, 1, "크레딧 소진은 다른 요청 형식으로 다시 묻지 않는다");
    const second = await handle(request(), claudeEnv);
    assert.equal(second.status, 200);
    assert.equal(calls.filter(isClaude).length, 1, "잠시 Claude를 건너뛴다");
    assert.equal(calls.length, 3);
    assert.ok(!JSON.stringify(await second.json()).includes(privateValue));
  }
});
await check("[Claude] 일시 오류·인증·형식·리디렉션·잘린 응답은 Gemini로 넘김", async () => {
  const redirected = () => new Response(null, { status: 302, headers: { Location: "https://evil.example" } });
  for (const [label, claude, claudeCalls] of [
    ["과부하 529", () => claudeError(529, "overloaded_error"), 1],
    ["서버 오류 500", () => claudeError(500, "api_error"), 1],
    ["한도 429", () => claudeError(429, "rate_limit_error"), 1],
    ["인증 401", () => claudeError(401, "authentication_error"), 1],
    ["요청 거절 400(생각 설정·형식 옵션을 하나씩 빼고 다시)", () => claudeError(400, "invalid_request_error"), 3],
    ["리디렉션", redirected, 1],
    ["JSON 아닌 답", () => json(claudeMessage([{ type: "text", text: "not json" }])), 1],
    ["도중에 끊김", () => json(claudeMessage([{ type: "text", text: '{"summary":"잘' }], "max_tokens")), 1],
  ]) {
    const { handle, calls } = harness(routed({ claude }));
    const response = await handle(request(), claudeEnv);
    assert.equal(response.status, 200, label);
    assert.equal(response.headers.get("x-ai-provider"), "gemini", label);
    assert.equal(calls.filter(isClaude).length, claudeCalls, label);
    assert.ok(calls.filter(isClaude).every((call) => call[1].redirect === "manual"), label);
    assert.ok(!calls.some((call) => !isClaude(call) && call[1].body.includes(claudeKey)), `${label}: Claude 키는 Google에 보내지 않는다`);
  }
});
await check("[Claude] 생각 끄기를 받지 않으면(400) 생각 설정만 빼고 다시 물어 Claude로 답함", async () => {
  const claude = (_url, options) => (JSON.parse(options.body).thinking ? claudeError(400, "invalid_request_error") : json(claudeMessage()));
  const { handle, calls } = harness(routed({ claude }));
  const response = await handle(request(), claudeEnv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-ai-provider"), "claude");
  assert.equal(calls.length, 2);
  const retried = JSON.parse(calls[1][1].body);
  assert.equal(retried.thinking, undefined);
  assert.equal(retried.output_config.format.type, "json_schema", "구조화 출력은 유지한다");
});
await check("[Claude] 정해진 시간 안에 답하지 않으면 Claude만 끊고 Gemini로 답하며, 잠시 Claude를 건너뜀", async () => {
  const hang = (_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }); });
  const { handle, calls } = harness(routed({ claude: hang }), { claudeTimeoutMs: 30 });
  const response = await handle(request(), claudeEnv);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-ai-provider"), "gemini");
  assert.equal(calls.length, 2);
  const second = await handle(request(), claudeEnv);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-ai-provider"), "gemini");
  assert.equal(calls.filter(isClaude).length, 1, "다음 요청은 Claude를 기다리지 않고 바로 Gemini에 묻는다");
});
await check("[Claude] 서비스 오류(5xx) 뒤에는 잠시 Claude를 건너뜀", async () => {
  const { handle, calls } = harness(routed({ claude: () => claudeError(529, "overloaded_error") }));
  assert.equal((await handle(request(), claudeEnv)).headers.get("x-ai-provider"), "gemini");
  assert.equal((await handle(request(), claudeEnv)).headers.get("x-ai-provider"), "gemini");
  assert.equal(calls.filter(isClaude).length, 1);
});
await check("[Claude] Gemini가 없을 때 크레딧 소진은 공용 한도, 한도는 혼잡, 그 밖은 서비스 오류로 안내", async () => {
  for (const [claude, status, payload] of [
    [() => claudeError(402, "billing_error"), 429, { error: "shared_quota", quota: "unknown" }],
    [() => claudeError(429, "rate_limit_error"), 429, { error: "busy" }],
    [() => claudeError(529, "overloaded_error"), 502, { error: "upstream" }],
    [() => claudeError(401, "authentication_error"), 502, { error: "upstream" }],
  ]) {
    const { handle, calls } = harness(routed({ claude }));
    for (let round = 0; round < 2; round += 1) {
      const response = await handle(request(), claudeOnlyEnv);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), payload);
    }
    assert.ok(calls.every(isClaude));
  }
});
await check("[Claude] 거절(refusal)은 Gemini로 우회하지 않음", async () => {
  const { handle, calls } = harness(routed({ claude: () => json(claudeMessage([], "refusal")) }));
  const response = await handle(request(), claudeEnv);
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: "refusal" });
  assert.equal(calls.length, 1);
});
await check("[Claude] 이용자가 취소하면 Gemini를 부르지 않고 499", async () => {
  const active = new AbortController();
  const hang = (_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }); });
  const { handle, calls } = harness(routed({ claude: hang }));
  const pending = handle(request(input, { signal: active.signal }), claudeEnv);
  while (!calls.length) await new Promise((resolve) => setImmediate(resolve));
  active.abort();
  assert.equal((await pending).status, 499);
  assert.equal(calls.length, 1);
});
console.log(`\n${passed}/${passed} 공용 AI 중계 검사 통과`);
