// 질문 검색의 AI 경로 점검(모의 서버 사용).   npm run build && npm run check:ai
// 실제 Claude 를 호출하지 않는다. Anthropic API 와 기관 AI 서버를 모의 응답으로 대신해, 아래를 확인한다.
//   1) 중계 서버(scripts/ai-gateway.mjs): 요청 형식, 허용 주소, 입력 검사, 호출·하루·동시 처리 한도, 폴백, 거절, 연결 끊김
//   2) 브라우저의 Claude 직접 호출: 헤더·본문 형식(설정된 모델 기준), 결과 표시, 오류별 안내, 키 비저장, 취소·최신 질문 우선
//   3) 브라우저의 기관 AI 서버 호출: 요청 본문, 결과 표시, 거절 처리
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createStaticServer } from "./lib/static-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shippedClaude = JSON.parse(fs.readFileSync(path.join(root, "data", "site.json"), "utf8")).ai.claude; // 지금 배포 설정(모델·effort·폴백)
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () =>
  new Promise((resolve) => {
    const probe = http.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

// ---------------------------------------------------------------- 모의 Anthropic API
// 큐에 넣어 둔 응답을 차례로 돌려주고, 받은 요청(주소·헤더·본문)을 calls 에 기록한다.
//   plan: { status, answer(body), stopReason, content(직접 지정한 content 배열), delayMs, errorType, message }
function createMockAnthropic() {
  const calls = [];
  const queue = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {}
      calls.push({ url: req.url, headers: req.headers, body });
      const plan = queue.shift() ?? { status: 200 };
      if (plan.delayMs) await sleep(plan.delayMs);
      if (res.destroyed) return;
      res.writeHead(plan.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(plan.status === 200 ? messageResponse(plan, body) : { type: "error", error: { type: plan.errorType ?? "invalid_request_error", message: plan.message ?? "mock error" } }));
    });
  });
  return { server, calls, queue };
}
function messageResponse(plan, body) {
  const stopReason = plan.stopReason ?? "end_turn";
  const answer = (plan.answer ?? goodAnswer)(body);
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: body?.model ?? "mock",
    content: plan.content ? plan.content(body) : stopReason === "refusal" ? [] : [{ type: "text", text: typeof answer === "string" ? answer : JSON.stringify(answer) }],
    stop_reason: stopReason,
    stop_details: stopReason === "refusal" ? { type: "refusal", category: "general_harms", explanation: "mock" } : null,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}
// 요청에 들어 있는 후보 번호 중 앞의 n개 (모의 응답이 실제 후보를 가리키게)
const candidateNosOf = (body, n = 3) => [...String(body?.messages?.[0]?.content ?? "").matchAll(/"no":(\d+)/g)].slice(0, n).map((match) => Number(match[1]));
function goodAnswer(body) {
  const [a, b, c] = candidateNosOf(body);
  return {
    summary: "체육시설 안전과 연계하려면 안전점검 정보와 시설 현황을 함께 보면 좋습니다.",
    recommendations: [
      { no: a, relevance: "high", reason: "시설 안전점검 결과를 담고 있습니다." },
      { no: 999999, relevance: "high", reason: "후보에 없는 번호(걸러져야 함)" },
      { no: b, relevance: "medium", reason: "시설 현황과 함께 보면 좋습니다." },
    ],
    combinations: [{ title: "안전점검 x 시설 현황", nos: [a, b, c], idea: "시설별 안전 등급을 지도에 표시합니다." }],
  };
}

// ---------------------------------------------------------------- 1) 중계 서버
async function startGateway({ upstreamPort, env = {} }) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(root, "scripts", "ai-gateway.mjs")], {
    env: { ...process.env, ANTHROPIC_API_KEY: "sk-ant-mock-key", ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstreamPort}`, AI_GATEWAY_PORT: String(port), AI_GATEWAY_ORIGINS: "http://allowed.example", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = { stdout: "", stderr: "" };
  child.stderr.on("data", (data) => (output.stderr += data));
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (data) => {
      output.stdout += data;
      if (String(data).includes("AI 중계 서버")) resolve();
    });
    child.on("exit", (code) => reject(new Error(`중계 서버가 종료되었습니다(code ${code}): ${output.stderr}`)));
    setTimeout(() => reject(new Error("중계 서버가 시작되지 않았습니다.")), 8000);
  });
  return { child, url: `http://127.0.0.1:${port}`, output };
}

const ALLOWED = { Origin: "http://allowed.example" };
const post = (url, body, headers = ALLOWED) => fetch(`${url}/recommend`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const sampleCandidates = (n = 5, extra = {}) => Array.from({ length: n }, (_, i) => ({ no: 80 + i, name: `후보 ${i}`, field: "체육시설", portal: "공공데이터포털", type: "파일", cycle: "Yearly", system: "SFMS", summary: "요약", columns: ["컬럼1"], ...extra }));
const ask = (question = "체육시설 안전 데이터", candidates = sampleCandidates()) => ({ question, candidates });

async function checkGateway() {
  const upstream = createMockAnthropic();
  const upstreamPort = await listen(upstream.server);
  const children = [];
  const start = async (env) => {
    const gateway = await startGateway({ upstreamPort, env });
    children.push(gateway.child);
    return gateway;
  };
  try {
    // ---- 기본 설정(data/site.json 의 ai.claude) ----
    const gateway = await start({});
    const health = await (await fetch(`${gateway.url}/healthz`)).json();
    check("[중계] /healthz 가 응답하고 모델 정보를 노출하지 않는다", health.ok === true && !("model" in health));

    upstream.queue.push({ status: 200 });
    const ok = await post(gateway.url, ask("체육시설 안전과 연계할 데이터"));
    const data = await ok.json();
    const call = upstream.calls.at(-1);
    check("[중계] 정상 요청에 추천 결과를 돌려준다(후보 밖 번호는 걸러짐)", ok.status === 200 && data.recommendations.length === 2 && !data.recommendations.some((r) => r.no === 999999) && data.combinations.length === 1);
    check("[중계] 허용된 화면 주소에 CORS 헤더를 준다", ok.headers.get("access-control-allow-origin") === "http://allowed.example");
    check("[중계] Anthropic 요청이 site.json 설정(모델·effort·폴백)을 따른다", call.headers["x-api-key"] === "sk-ant-mock-key" && call.body.model === shippedClaude.model && call.body.output_config?.effort === (shippedClaude.effort ?? undefined) && call.body.output_config?.format?.type === "json_schema" && (call.body.fallbacks === "default") === !!shippedClaude.refusalFallback && String(call.url).includes("beta=true") === !!shippedClaude.refusalFallback, `${shippedClaude.model} ${call.url}`);
    check("[중계] 질문은 <question> 안에, 강제 tool_choice·temperature·thinking 은 없다", String(call.body.messages[0].content).includes("<question>체육시설 안전과 연계할 데이터</question>") && call.body.tool_choice === undefined && call.body.temperature === undefined && call.body.thinking === undefined);
    check("[중계] max_tokens 가 상한(8000) 이하다", call.body.max_tokens <= 8000, `${call.body.max_tokens}`);

    // 구조화 출력을 받지 않는 경우: 형식 지시문으로 대신해 재시도
    upstream.queue.push({ status: 400, message: "output_config.format is not supported" }, { status: 200, answer: (body) => `다음과 같습니다.\n${JSON.stringify(goodAnswer(body))}\n끝` });
    const before = upstream.calls.length;
    const downgraded = await post(gateway.url, ask());
    const [first, second] = upstream.calls.slice(before);
    check("[중계] 구조화 출력이 거절되면 형식 지시문을 붙여 재시도해 성공한다", downgraded.status === 200 && first.body.output_config?.format && !second.body.output_config?.format && second.body.system.includes("JSON"), `요청 ${upstream.calls.length - before}회`);

    // 모델 답에 thinking 블록이 앞서거나 폴백 이전의 글이 남아 있어도 마지막 완성본을 쓴다
    upstream.queue.push({ status: 200, content: (body) => [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: '{"summary": "잘린 글' }, { type: "fallback", from: { model: "a" }, to: { model: "b" } }, { type: "text", text: JSON.stringify(goodAnswer(body)) }] });
    const blocks = await post(gateway.url, ask());
    check("[중계] thinking·폴백 블록이 섞여도 마지막 완성본 글을 쓴다", blocks.status === 200 && (await blocks.json()).recommendations.length === 2);

    const callsBefore = upstream.calls.length;
    check("[중계] 허용되지 않은 주소(Origin)는 403 이고 Anthropic 을 호출하지 않는다", (await post(gateway.url, ask(), { Origin: "http://evil.example" })).status === 403 && upstream.calls.length === callsBefore);
    check("[중계] Origin 헤더가 없으면 기본으로 403 이다", (await post(gateway.url, ask(), {})).status === 403 && upstream.calls.length === callsBefore);
    check("[중계] 허용되지 않은 주소의 사전 요청(OPTIONS)도 거절한다", (await fetch(`${gateway.url}/recommend`, { method: "OPTIONS", headers: { Origin: "http://evil.example", "Access-Control-Request-Method": "POST" } })).status === 403);
    check("[중계] JSON 이 아니면 400", (await post(gateway.url, "not json")).status === 400);
    check("[중계] 질문이 비면 400", (await post(gateway.url, ask(" "))).status === 400);
    check("[중계] 후보가 너무 많으면 400", (await post(gateway.url, ask("체육", sampleCandidates(201)))).status === 400);
    check("[중계] 후보 정보 전체가 너무 크면 400 (비용 남용 방지)", (await post(gateway.url, ask("체육", sampleCandidates(200, { name: "a".repeat(200), summary: "b".repeat(140), system: "c".repeat(80) })))).status === 400 && upstream.calls.length === callsBefore);
    const tooLarge = await post(gateway.url, { ...ask(), pad: "x".repeat(300_000) }).catch(() => ({ status: 0 }));
    check("[중계] 요청 본문이 너무 크면 413", tooLarge.status === 413, `${tooLarge.status}`);

    // 거절·형식 오류·인증 오류
    upstream.queue.push({ status: 200, stopReason: "refusal" });
    const refusal = await post(gateway.url, ask());
    check("[중계] AI 가 거절하면 422(refusal)", refusal.status === 422 && (await refusal.json()).error === "refusal");
    upstream.queue.push({ status: 200, answer: () => "죄송하지만 JSON 이 아닙니다" });
    const garbage = await post(gateway.url, ask());
    check("[중계] 모델 답이 형식에 맞지 않으면 502", garbage.status === 502);
    upstream.queue.push({ status: 401, errorType: "authentication_error", message: "invalid x-api-key sk-ant-SECRET-DETAIL" });
    const unauth = await post(gateway.url, ask());
    const unauthText = await unauth.text();
    check("[중계] 인증 오류는 502 로만 알리고 내부 종류·내용을 응답에 담지 않는다", unauth.status === 502 && !unauthText.includes("SECRET") && !unauthText.includes("key"), unauthText);
    check("[중계] 질문 내용과 키가 서버 로그에 남지 않는다", !gateway.output.stdout.includes("체육시설 안전") && !gateway.output.stdout.includes("sk-ant") && !gateway.output.stderr.includes("sk-ant"));

    // ---- 모델/폴백을 환경변수로 바꾼 경우(claude-opus-5-5 권장 설정) ----
    const opus = await start({ AI_GATEWAY_MODEL: "claude-opus-5-5", AI_GATEWAY_EFFORT: "low", AI_GATEWAY_REFUSAL_FALLBACK: "true" });
    upstream.queue.push({ status: 200 });
    const opusOk = await post(opus.url, ask());
    const opusCall = upstream.calls.at(-1);
    check("[중계] 환경변수로 모델·effort·폴백을 바꿀 수 있다", opusOk.status === 200 && opusCall.body.model === "claude-opus-5-5" && opusCall.body.output_config.effort === "low" && opusCall.body.fallbacks === "default" && String(opusCall.url).includes("beta=true") && String(opusCall.headers["anthropic-beta"]).includes("server-side-fallback-2026-07-01"));
    upstream.queue.push({ status: 400, message: "fallbacks unsupported" }, { status: 200 });
    const beforeFallback = upstream.calls.length;
    const retried = await post(opus.url, ask());
    const [betaCall, plainCall] = upstream.calls.slice(beforeFallback);
    check("[중계] 폴백 옵션이 거절되면 옵션 없이 재시도해 성공한다", retried.status === 200 && String(betaCall.url).includes("beta=true") && !String(plainCall.url).includes("beta=true") && plainCall.body.fallbacks === undefined);

    // ---- 호출 한도 ----
    const limited = await start({ AI_GATEWAY_RATE_PER_MIN: "3" });
    for (let i = 0; i < 3; i += 1) upstream.queue.push({ status: 200 });
    const statuses = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await post(limited.url, ask())).status);
    check("[중계] 분당 호출 한도를 넘으면 429 (거절된 요청은 한도에 쌓이지 않음)", statuses.slice(0, 3).every((s) => s === 200) && statuses.slice(3).every((s) => s === 429), statuses.join(","));

    const daily = await start({ AI_GATEWAY_DAILY_LIMIT: "2" });
    for (let i = 0; i < 2; i += 1) upstream.queue.push({ status: 200 });
    const dailyStatuses = [];
    for (let i = 0; i < 3; i += 1) dailyStatuses.push((await post(daily.url, ask())).status);
    check("[중계] 하루 전체 한도를 넘으면 503", dailyStatuses.join(",") === "200,200,503", dailyStatuses.join(","));

    const busy = await start({ AI_GATEWAY_MAX_CONCURRENT: "1" });
    upstream.queue.push({ status: 200, delayMs: 800 }, { status: 200 });
    const slow = post(busy.url, ask());
    await sleep(200);
    const rejectedWhileBusy = await post(busy.url, ask());
    check("[중계] 동시 처리 한도를 넘으면 503", rejectedWhileBusy.status === 503 && (await slow).status === 200);

    // 이용자가 연결을 끊어도 자리가 반환되고 서버가 계속 동작한다
    upstream.queue.push({ status: 200, delayMs: 1200 }, { status: 200 });
    const controller = new AbortController();
    const aborted = fetch(`${busy.url}/recommend`, { method: "POST", headers: { "Content-Type": "application/json", ...ALLOWED }, body: JSON.stringify(ask()), signal: controller.signal }).catch(() => null);
    await sleep(200);
    controller.abort();
    await aborted;
    await sleep(300);
    const afterAbort = await post(busy.url, ask());
    check("[중계] 이용자가 연결을 끊어도 처리 자리가 반환되고 서버가 살아 있다", afterAbort.status === 200, `${afterAbort.status}`);

    const noOrigin = await start({ AI_GATEWAY_ALLOW_NO_ORIGIN: "true" });
    upstream.queue.push({ status: 200 });
    check("[중계] AI_GATEWAY_ALLOW_NO_ORIGIN=true 이면 Origin 없는 요청을 허용한다", (await post(noOrigin.url, ask(), {})).status === 200);

    // 잘못된 환경변수는 시작하지 않는다
    const bad = spawn(process.execPath, [path.join(root, "scripts", "ai-gateway.mjs")], { env: { ...process.env, AI_GATEWAY_RATE_PER_MIN: "abc", ANTHROPIC_API_KEY: "k" }, stdio: "ignore" });
    const exitCode = await new Promise((resolve) => bad.on("exit", resolve));
    check("[중계] 숫자 환경변수가 잘못되면 시작하지 않는다", exitCode === 2, `exit ${exitCode}`);
  } finally {
    children.forEach((child) => child.kill());
    upstream.server.close();
  }
}

// ---------------------------------------------------------------- 2·3) 브라우저
const browserPath = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]
  .filter(Boolean)
  .find((candidate) => fs.existsSync(candidate));

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-expose-headers": "*" };

async function openAsk(browser, base, { siteMutator } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ko-KR" });
  const page = await context.newPage();
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  if (siteMutator) {
    await page.route("**/data/site.json", async (route) => {
      const response = await route.fetch();
      const site = await response.json();
      siteMutator(site);
      await route.fulfill({ response, json: site });
    });
  }
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("button", { name: "질문 검색" }).click();
  await page.waitForSelector(".ask-form");
  return { context, page, requests };
}

// api.anthropic.com 으로 가는 요청을 모의 응답으로 바꾼다. handler(request, body, 호출순번) -> plan
async function mockAnthropic(page, calls, handler) {
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const body = request.postDataJSON();
    calls.push({ url: request.url(), headers: request.headers(), body });
    const plan = handler(request, body, calls.length);
    if (plan.delayMs) await sleep(plan.delayMs);
    if (plan.abort) return route.abort("failed");
    if (plan.status !== 200) return route.fulfill({ status: plan.status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ type: "error", error: { type: plan.errorType ?? "invalid_request_error", message: plan.message ?? "mock" } }) });
    return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(messageResponse(plan, body)) });
  });
}

async function askWithClaude(page, question = "체육시설 안전과 연계할 수 있는 데이터가 뭐 있어?", key = "sk-ant-test-key-1234") {
  await page.getByLabel("AI 추천 (Claude)", { exact: false }).check();
  await page.fill("#ask-api-key", key);
  await page.fill("#ask-question", question);
  await page.getByRole("button", { name: /질문하기/ }).click();
}

async function checkBrowser() {
  const server = createStaticServer(root);
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    // --- 정상 경로 (지금 배포 설정 기준)
    {
      const { context, page, requests } = await openAsk(browser, base);
      const calls = [];
      await mockAnthropic(page, calls, () => ({ status: 200 }));

      await page.getByLabel("AI 추천 (Claude)", { exact: false }).check();
      await page.fill("#ask-question", "체육시설 안전");
      await page.getByRole("button", { name: "질문하기" }).click();
      check("[브라우저] 키 없이 AI 방식으로 질문하면 안내가 나오고 호출하지 않는다", (await page.locator("#ask-form-error").innerText()).includes("API 키") && calls.length === 0 && (await page.locator("#ask-api-key").evaluate((el) => el === document.activeElement)));
      check("[브라우저] SDK 는 질문하기 전에는 내려받지 않는다", !requests.some((url) => /\/assets\/chunks\/sdk-/.test(url)));

      await askWithClaude(page);
      await page.waitForSelector(".ask-badge");
      const call = calls[0];
      check("[브라우저] 호출 헤더: 키·브라우저 직접 접근 허용·API 버전", call.headers["x-api-key"] === "sk-ant-test-key-1234" && call.headers["anthropic-dangerous-direct-browser-access"] === "true" && !!call.headers["anthropic-version"]);
      check("[브라우저] 요청 본문이 site.json 설정(모델·effort·폴백)을 따른다", call.body.model === shippedClaude.model && call.body.output_config?.effort === (shippedClaude.effort ?? undefined) && call.body.output_config?.format?.type === "json_schema" && (call.body.fallbacks === "default") === !!shippedClaude.refusalFallback, `${call.body.model} ${call.url.replace("https://api.anthropic.com", "")}`);
      check("[브라우저] 요청에 강제 도구 사용·샘플링 값·thinking 설정이 없다", call.body.tool_choice === undefined && call.body.temperature === undefined && call.body.thinking === undefined);
      check("[브라우저] SDK 가 질문한 뒤에 내려받는다", requests.some((url) => /\/assets\/chunks\/sdk-/.test(url)));
      const itemCount = await page.locator(".ask-list").first().locator(".ask-item").count();
      check("[브라우저] AI 결과: 요약·추천(후보 밖 번호 제외)·관련도·조합 표시", itemCount === 2 && (await page.locator(".ask-summary").innerText()).includes("안전점검") && (await page.locator(".ask-relevance.high").count()) === 1 && (await page.locator(".ask-combo-grid article").count()) === 1, `추천 ${itemCount}건`);
      check("[브라우저] AI 방식에서도 기본 검색 결과를 함께 볼 수 있다", (await page.locator(".ask-local").count()) === 1);
      check("[브라우저] 결과가 나오면 초점이 결과 제목으로 옮겨진다(키보드·화면낭독)", await page.evaluate(() => document.activeElement?.classList.contains("ask-heading")));
      check("[브라우저] 진행 상태는 별도의 알림 영역(role=status)으로 알린다", (await page.locator("p[role=status]").innerText()).includes("추천 데이터"));
      const stored = await page.evaluate(() => ({ local: Object.keys(localStorage).length, session: Object.keys(sessionStorage).length, cookie: document.cookie.length }));
      check("[브라우저] API 키를 어디에도 저장하지 않는다", stored.local === 0 && stored.session === 0 && stored.cookie === 0);
      const external = requests.filter((url) => !url.startsWith(base)).map((url) => new URL(url).origin);
      check("[브라우저] 외부로 나간 요청은 api.anthropic.com 뿐이고 키가 주소에 없다", external.length > 0 && external.every((origin) => origin === "https://api.anthropic.com") && !requests.some((url) => url.includes("sk-ant")), [...new Set(external)].join(","));

      // 다른 화면에 다녀와도 질문·결과는 남고 키는 남지 않는다
      await page.locator(".ask-open").first().click();
      await page.waitForSelector(".profile");
      check("[브라우저] 추천 결과의 ‘상세 보기’가 데이터 상세로 이동한다", (await page.locator(".dataset-list button.active").count()) === 1);
      await page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("button", { name: "질문 검색" }).click();
      await page.waitForSelector(".ask-form");
      check("[브라우저] 다녀온 뒤에도 질문과 결과는 남고 API 키는 비어 있다", (await page.inputValue("#ask-question")).includes("체육시설") && (await page.locator(".ask-list .ask-item").count()) > 0 && (await page.inputValue("#ask-api-key")) === "" && !(await page.evaluate(() => document.activeElement?.classList.contains("ask-heading"))));
      await context.close();
    }

    // --- 구조화 출력이 거절되면 형식 지시문으로 재시도
    {
      const { context, page } = await openAsk(browser, base);
      const calls = [];
      await mockAnthropic(page, calls, (request, body, n) => (body.output_config?.format ? { status: 400, message: "output_config.format unsupported" } : { status: 200, answer: (b) => `결과입니다: ${JSON.stringify(goodAnswer(b))}` }));
      await askWithClaude(page);
      await page.waitForSelector(".ask-badge");
      const last = calls.at(-1);
      check("[브라우저] 구조화 출력이 거절되면 형식 지시문을 붙여 재시도해 성공한다", !last.body.output_config?.format && last.body.system.includes("JSON") && calls.length >= 2, `요청 ${calls.length}회`);
      await context.close();
    }

    // --- claude-opus-5-5 권장 설정(effort + 폴백)으로 바꾼 경우
    {
      const mutator = (site) => {
        site.ai.claude = { model: "claude-opus-5-5", effort: "low", maxTokens: 16000, refusalFallback: true, keyGuideUrl: site.ai.claude.keyGuideUrl };
      };
      const { context, page } = await openAsk(browser, base, { siteMutator: mutator });
      const calls = [];
      await mockAnthropic(page, calls, (request, body, n) => (n === 1 ? { status: 400, message: "fallbacks unsupported" } : { status: 200 }));
      await askWithClaude(page);
      await page.waitForSelector(".ask-badge");
      check("[브라우저] Opus 설정: effort 와 폴백(beta)을 보내고, 폴백이 거절되면 옵션 없이 재시도한다", calls.length === 2 && calls[0].url.includes("beta=true") && calls[0].body.fallbacks === "default" && calls[0].body.output_config.effort === "low" && !calls[1].url.includes("beta=true") && calls[1].body.model === "claude-opus-5-5");
      await context.close();
    }
    {
      const { context, page } = await openAsk(browser, base);
      const calls = [];
      await mockAnthropic(page, calls, () => ({ status: 200, content: (body) => [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: '{"summary": "도중에 끊긴 글' }, { type: "fallback", from: { model: "a" }, to: { model: "b" } }, { type: "text", text: JSON.stringify(goodAnswer(body)) }] }));
      await askWithClaude(page);
      await page.waitForSelector(".ask-badge");
      check("[브라우저] thinking·폴백 블록이 섞여도 마지막 완성본 글을 쓴다", (await page.locator(".ask-list").first().locator(".ask-item").count()) === 2);
      await context.close();
    }

    // --- 오류별 안내 + 기본 검색 결과로 대체
    const errorCases = [
      ["인증 오류(401)", () => ({ status: 401, errorType: "authentication_error", message: "invalid x-api-key" }), "API 키가 올바르지 않"],
      ["한도 초과(429)", () => ({ status: 429, errorType: "rate_limit_error", message: "slow down" }), "사용 한도"],
      ["연결 실패", () => ({ abort: true }), "연결하지 못했습니다"],
      ["AI 거절(refusal)", () => ({ status: 200, stopReason: "refusal" }), "답하지 못했습니다"],
      ["응답이 도중에 끊김(max_tokens)", () => ({ status: 200, stopReason: "max_tokens", answer: () => '{"summary":"잘' }), "도중에 끊겼습니다"],
      ["형식 오류", () => ({ status: 200, answer: () => "JSON 이 아닌 답변" }), "형식이 올바르지 않"],
    ];
    for (const [label, plan, expected] of errorCases) {
      const { context, page } = await openAsk(browser, base);
      await mockAnthropic(page, [], plan);
      await askWithClaude(page);
      await page.waitForSelector(".ask-result .ask-error[role=alert]", { timeout: 20000 });
      const message = await page.locator(".ask-result .ask-error").innerText();
      const fallbackItems = await page.locator(".ask-list .ask-item").count();
      check(`[브라우저] ${label}: 안내 문구 + 기본 검색 결과로 대체`, message.includes(expected) && fallbackItems > 0 && (message.match(/기본 검색 결과/g) ?? []).length === 1, message.slice(0, 60));
      await context.close();
    }

    // --- 최신 질문 우선 / 취소
    {
      const { context, page } = await openAsk(browser, base);
      const calls = [];
      await mockAnthropic(page, calls, (request, body, n) => (n === 1 ? { status: 200, delayMs: 1500, answer: () => ({ summary: "첫 번째(느린) 답", recommendations: [], combinations: [] }) } : { status: 200, answer: (b) => ({ ...goodAnswer(b), summary: "두 번째(빠른) 답" }) }));
      await askWithClaude(page, "첫 번째 질문");
      await page.waitForTimeout(200);
      check("[브라우저] 처리 중에도 취소 버튼이 있고 질문 버튼은 눌린 상태로 막히지 않는다", (await page.locator(".ask-cancel").count()) === 1 && (await page.getByRole("button", { name: "다시 질문하기" }).isEnabled()));
      await page.fill("#ask-question", "두 번째 질문");
      await page.getByRole("button", { name: "다시 질문하기" }).click();
      await page.waitForSelector(".ask-summary");
      await page.waitForTimeout(1800);
      check("[브라우저] 질문을 연달아 보내면 마지막 질문의 결과만 보인다(느린 이전 응답이 덮어쓰지 않음)", (await page.locator(".ask-summary").innerText()).includes("두 번째"));
      await context.close();
    }
    {
      const { context, page } = await openAsk(browser, base);
      await mockAnthropic(page, [], () => ({ status: 200, delayMs: 3000 }));
      await askWithClaude(page);
      await page.waitForSelector(".ask-cancel");
      await page.locator(".ask-cancel").click();
      await page.waitForTimeout(300);
      check("[브라우저] 취소하면 처리 중 표시가 사라지고 오류 없이 처음 상태로 돌아간다", (await page.locator(".ask-cancel").count()) === 0 && (await page.locator(".ask-result .ask-error").count()) === 0 && (await page.locator(".ask-list").count()) === 0);
      await context.close();
    }

    // --- 기관 AI 서버(게이트웨이) 방식
    {
      const mutator = (site) => {
        site.ai.modes = ["local", "gateway"];
        site.ai.gateway = { url: "https://ai-gateway.test/recommend", label: "KSPO AI 서버" };
      };
      const { context, page } = await openAsk(browser, base, { siteMutator: mutator });
      let gatewayRequest = null;
      let respondWith = "ok";
      await page.route("https://ai-gateway.test/**", async (route) => {
        const request = route.request();
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
        gatewayRequest = { body: request.postDataJSON(), headers: request.headers() };
        if (respondWith === "refusal") return route.fulfill({ status: 422, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ error: "refusal" }) });
        const [a, b] = gatewayRequest.body.candidates.slice(0, 2).map((candidate) => candidate.no);
        await route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify({ summary: "기관 서버가 고른 결과입니다.", recommendations: [{ no: a, relevance: "high", reason: "서버 추천 이유" }, { no: b, relevance: "medium", reason: "두 번째" }], combinations: [] }) });
      });
      await page.getByLabel("AI 추천 (KSPO AI 서버)", { exact: false }).check();
      check("[브라우저] 기관 서버 방식을 고르면 API 키 입력란이 나타나지 않는다", (await page.locator("#ask-api-key").count()) === 0);
      await page.fill("#ask-question", "체육시설 안전과 연계할 수 있는 데이터");
      await page.getByRole("button", { name: "질문하기" }).click();
      await page.waitForSelector(".ask-badge");
      check("[브라우저] 기관 서버로 질문과 후보를 보낸다(키·쿠키 없음)", !!gatewayRequest && gatewayRequest.body.question.includes("체육시설") && gatewayRequest.body.candidates.length > 0 && gatewayRequest.body.candidates.length <= 200 && !("apiKey" in gatewayRequest.body) && !gatewayRequest.headers.cookie && !gatewayRequest.headers["x-api-key"], `후보 ${gatewayRequest?.body.candidates.length}건`);
      check("[브라우저] 기관 서버 결과를 AI 안내로 표시한다", (await page.locator(".ask-summary").innerText()).includes("기관 서버") && (await page.locator(".ask-list").first().locator(".ask-item").count()) === 2);
      respondWith = "refusal";
      await page.getByRole("button", { name: "질문하기" }).click();
      await page.waitForSelector(".ask-result .ask-error[role=alert]");
      check("[브라우저] 기관 서버가 거절(422)하면 안내 문구와 기본 검색 결과로 대체한다", (await page.locator(".ask-result .ask-error").innerText()).includes("답하지 못했습니다") && (await page.locator(".ask-list .ask-item").count()) > 0);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

if (!browserPath) {
  console.error("Chrome 또는 Edge 를 찾지 못했습니다. CHROME_PATH 환경변수에 실행 파일 경로를 지정하세요.");
  process.exit(2);
}
await checkGateway();
await checkBrowser();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
