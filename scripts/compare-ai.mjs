// 같은 질문을 ① 기본 검색 ② AI 추천(모델별) ③ AI 실패(모의) 로 돌려 비교하고, AI가 쓴 추천 이유가 실제 데이터 설명·컬럼과 맞는지 점검한다.
//   npm run compare:ai                      (data/site.json 의 예시 질문 전부)
//   npm run compare:ai -- "질문 1" "질문 2"   (질문 지정)
// 결과는 docs/evidence/YYYY-MM-DD-ai-compare.md(읽는 용)와 같은 이름의 .json(다른 문서에 옮겨 적을 때 쓰는 구조화 기록)으로 저장한다.
// 화면과 같은 코드(src/ai/recommend.js)를 그대로 쓴다.
//
// - 키는 환경변수 GEMINI_API_KEY 로만 받는다(사용법은 scripts/probe-ai-models.mjs 맨 위). 키·요청 주소·헤더는 출력·저장하지 않는다.
//   키가 없으면 AI 실호출은 건너뛰고 기본 검색과 모의 실패만 기록한다.
// - ③ 모의 실패는 네트워크를 쓰지 않는다. fetch 를 가로채 Gemini 의 오류 응답(한도 초과 429, 잘못된 키 400)을 흉내 낸다.
// - 이유 점검: 이유 문장의 핵심 낱말(검색과 같은 방식으로 조사·불용어를 뗀 말)을 그 데이터의 이름·분야·키워드·출처 시스템·설명 전문·컬럼 전체에서 찾는다.
//   데이터에 있으면 ‘근거’, 질문에만 있으면 ‘질문 연결’, 어디에도 없으면 ‘확인 필요’로 나눈다. ‘확인 필요’는 바꿔 말한 표현일 수도 있으니 사람이 표를 보고 판단한다.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recommend } from "../src/ai/recommend.js";
import { buildIndex, extractTerms, normalize } from "../src/ai/retrieval.js";
import { PAYLOAD } from "../src/lib/data.js";
import { failureAdvice, installCallLog, isDailyQuota, retryCause, retryWaitSec, statusOf, statusText } from "./lib/ai-call-log.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, "data", file), "utf8"));
const explorer = readJson("explorer-data.json");
const site = readJson("site.json");
const store = {
  site,
  datasets: explorer.payloads[PAYLOAD.catalog],
  cultureColumns: explorer.payloads[PAYLOAD.cultureColumns],
  cultureSamples: explorer.payloads[PAYLOAD.cultureSamples],
  publicMeta: explorer.payloads[PAYLOAD.publicMeta],
  publicSamples: explorer.payloads[PAYLOAD.publicSamples],
  apiSamples: explorer.payloads[PAYLOAD.apiSamples],
};
const index = buildIndex(store);
const apiKey = (process.env.GEMINI_API_KEY ?? "").trim();
const models = site.ai?.gemini?.models ?? [];
const questions = process.argv.slice(2).length ? process.argv.slice(2) : site.ai?.exampleQuestions ?? [];
if (!questions.length) {
  console.error("질문이 없습니다. site.json 의 ai.exampleQuestions 를 채우거나 질문을 인자로 주세요.");
  process.exit(2);
}
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const shortName = (dataset) => dataset.name.replace(/^서울올림픽기념국민체육진흥공단[_\s]*/, "");
const cell = (text) => String(text ?? "").replace(/\|/g, "·").replace(/\s+/g, " ").trim();

// 데이터 한 건에서 이유를 대조할 글: 이름·분야·키워드·출처 시스템·설명 전문·컬럼 전체·API 기능
function groundText(dataset) {
  const key = String(dataset.no);
  const meta = store.cultureColumns[key] ?? store.publicMeta[key];
  const columns = (meta?.columns ?? []).flatMap((column) => [column.name, column.label]);
  const operations = [...(store.publicMeta[key]?.operations ?? []).map((operation) => operation.name), ...(store.apiSamples[key] ?? []).map((operation) => operation.operationName)];
  return normalize([dataset.name, dataset.field, dataset.kw, dataset.sys, String(dataset.desc ?? "").replaceAll("_x000D_", " "), ...columns, ...operations].join(" "));
}
// 추천 이유에 흔히 붙는 평가·연결 표현. 데이터 내용에 대한 주장이 아니어서 점검 대상에서 뺀다. (검색용 불용어 밖의 것만)
const REASON_FILLER = new Set(["적합", "적합한", "유용", "유용한", "유용합니다", "좋습니다", "도움", "도움이", "기초", "기반", "분석", "분석에", "분석할", "판단", "검토", "비교", "직접", "주요", "다양한", "포함", "포함되어", "포함하고", "담고", "담겨", "제공하여", "제공하므로", "있어", "있으며", "있으므로", "있어서", "때문에", "가장", "특히", "또한", "해당", "이용", "활용할", "활용하면", "파악할", "확인할", "살펴볼", "알아볼", "질문", "질문의", "요청", "목적", "내용", "항목", "현황"]);
function checkReason(reason, dataset, question) {
  const data = groundText(dataset);
  const asked = normalize(question);
  const grounded = [];
  const linked = [];
  const unknown = [];
  for (const term of extractTerms(reason).filter((word) => !REASON_FILLER.has(word) && !/(니다|하여|하므로|되어|하며)$/.test(word))) {
    if (data.includes(term)) grounded.push(term);
    else if (asked.includes(term)) linked.push(term);
    else unknown.push(term);
  }
  return { grounded, linked, unknown };
}

// 실제 호출의 상태(오류 종류·한도 이름·시간 초과 구분)와, 걸러지기 전 모델 응답(후보 밖 번호를 몇 건 냈는지 세기 위해)만 기록한다.
// Google 쪽 일시 오류(5xx)·시간 초과·연결 실패, 분당 무료 한도(429)는 화면의 자동 재시도(5xx 1회)와 별도로 기다렸다가 다시 시도한다.
// 기록·재시도 규칙은 probe:ai 와 같다(scripts/lib/ai-call-log.mjs).
const callLog = installCallLog();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rawNos = (text) => {
  try {
    const data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return (data.recommendations ?? []).map((item) => Number(item?.no));
  } catch {
    return [];
  }
};

// 모의 실패: 네트워크 없이 Gemini 오류 응답을 돌려준다.
const FAILURES = [
  { label: "한도 초과 (HTTP 429)", status: 429, body: { error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" } } },
  { label: "잘못된 키 (HTTP 400 API_KEY_INVALID)", status: 400, body: { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } } },
];
async function simulate(failure, question) {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(failure.body), { status: failure.status, headers: { "Content-Type": "application/json" } });
  try {
    return await recommend({ question, mode: "gemini", store, index, apiKey: "simulated", model: models[0]?.model });
  } finally {
    globalThis.fetch = saved;
  }
}

const out = [];
const log = (line = "") => {
  out.push(line);
};
let commit = "";
try {
  commit = execSync("git log -1 --format=%h", { cwd: root }).toString().trim();
  if (execSync("git status --porcelain -- src data", { cwd: root }).toString().trim()) commit += " (src·data 작업 중 변경 있음)";
} catch {
  commit = "확인 불가";
}

log(`# 질문 검색 비교: 기본 검색 · AI 추천 · AI 실패 (${todayKst()})`);
log();
log("`npm run compare:ai` 가 만든 기록입니다. 화면과 같은 코드(`src/ai/recommend.js`)로 같은 질문을 세 방식으로 돌렸습니다.");
log();
log("| 항목 | 값 |");
log("|---|---|");
log(`| 실행일 | ${todayKst()} |`);
log(`| 소스 커밋 | ${commit} |`);
log(`| 데이터 | ${store.datasets.length}건 (목록 기준일 ${explorer.generatedAt}) |`);
log(`| AI 모델 | ${apiKey ? models.map((entry) => `${entry.label} (\`${entry.model}\`)`).join(", ") : "키가 없어 실호출하지 않음"} |`);
log(`| 호출 방식 | Google Gemini API \`generateContent\`, 이용자 키(실행자 본인 키, 기록하지 않음) |`);
log("| 일시 오류 처리 | 화면과 같이 5xx 가 바로 오면 2초 뒤 한 번 더 보냄(화면의 응답 시간 제한은 90초). 그래도 5xx·시간 초과·연결 실패면 이 기록용으로 20·60·60초 뒤, 분당 무료 한도(429)면 Google 이 알려 준 시간 뒤 최대 3번 더 시도하고, 모든 요청의 상태를 그대로 적음(하루 한도는 다시 시도하지 않음) |");
log(`| 모의 실패 | 네트워크 없이 Gemini 오류 응답을 흉내 냄: ${FAILURES.map((failure) => failure.label).join(", ")} |`);
log();
log("**이유 점검 기준:** AI 추천 이유의 핵심 낱말을 그 데이터의 이름·분야·키워드·출처 시스템·설명 전문·컬럼 전체에서 찾았습니다. 데이터에 있으면 ‘근거’, 질문에만 있으면 ‘질문 연결’, 어디에도 없으면 ‘확인 필요’입니다. ‘확인 필요’는 바꿔 말한 표현일 수 있어 아래 표의 데이터 설명과 함께 사람이 판단합니다.");

const record = { date: todayKst(), commit, datasets: store.datasets.length, listDate: explorer.generatedAt, models: apiKey ? models.map(({ model, label }) => ({ model, label })) : [], questions: [], failures: [] };
const totals = { reasons: 0, withGround: 0, terms: 0, grounded: 0, linked: 0, unknown: 0, dropped: 0, calls: 0, failedCalls: 0, retried: 0 };
const modelTotals = new Map(models.map((entry) => [entry.model, { reasons: 0, withGround: 0, terms: 0, grounded: 0, seconds: [], failed: 0, overlap: [] }]));
const finalFailures = []; // 끝내 실패한 호출의 마지막 요청 기록 (끝에 무엇을 하면 되는지 알려 주는 용도)
const dailyExhausted = new Set(); // 하루 한도에 걸린 모델 - 남은 질문에서는 부르지 않는다

for (const [qIndex, question] of questions.entries()) {
  console.log(`[${qIndex + 1}/${questions.length}] ${question}`);
  log();
  log(`## ${qIndex + 1}. ${question}`);

  const local = await recommend({ question, mode: "local", store, index });
  log();
  log(`### ① 기본 검색 (AI 호출 없음) - ${local.recommendations.length}건, 신뢰도 ${local.confidence}`);
  log();
  log("| 순위 | 데이터 | 일치 이유 |");
  log("|---|---|---|");
  local.recommendations.forEach((item, rank) => log(`| ${rank + 1} | #${item.dataset.no} ${cell(shortName(item.dataset))} | ${cell(item.reason)} |`));
  const localNos = new Set(local.recommendations.map((item) => item.dataset.no));
  const aiNos = new Set(); // 이 질문에서 AI가 추천한 데이터 (아래 대조표용)
  const qRecord = { question, local: local.recommendations.map((item) => ({ no: item.dataset.no, name: shortName(item.dataset), reason: item.reason })), ai: [] };
  record.questions.push(qRecord);

  for (const entry of apiKey ? models : []) {
    if (dailyExhausted.has(entry.model)) {
      const stat = modelTotals.get(entry.model);
      totals.calls += 1;
      totals.failedCalls += 1;
      stat.failed += 1;
      qRecord.ai.push({ model: entry.model, ok: false, skipped: true, error: "앞 질문에서 하루 무료 한도에 걸려 호출하지 않음", seconds: 0, attempts: 0, calls: [] });
      log();
      log(`### ② AI 추천 - ${entry.label} (\`${entry.model}\`)`);
      log();
      log("호출하지 않음: 앞 질문에서 이 모델이 하루 무료 한도에 걸렸습니다. 화면은 이때 ① 기본 검색 결과를 그대로 보여 줍니다.");
      console.log(`    ${entry.model}: 하루 한도로 건너뜀`);
      continue;
    }
    // 일시 오류·분당 한도면 기다렸다가 다시 시도한다. seconds 는 마지막 시도에 걸린 시간, allCalls 는 모든 시도의 요청 상태.
    let result;
    let seconds;
    let attempts = 0;
    const allCalls = [];
    for (;;) {
      attempts += 1;
      callLog.calls = [];
      const started = Date.now();
      try {
        // 화면의 자동 재시도(1회)까지 끝날 수 있게 요청 한 번의 시간 제한(90초)보다 넉넉히 둔다
        result = await recommend({ question, mode: "gemini", store, index, apiKey, model: entry.model, signal: AbortSignal.timeout(150_000) });
      } catch (error) {
        result = { usedAi: false, error: `시간 제한(150초)을 넘겨 멈췄습니다. (${error?.message ?? error})` };
      }
      seconds = (Date.now() - started) / 1000;
      allCalls.push(...callLog.calls);
      const last = callLog.calls.at(-1);
      const wait = result.usedAi ? null : retryWaitSec(last, attempts);
      if (!wait) break;
      console.log(`    ${entry.model}: ${retryCause(last)}(${statusText(callLog.calls)}) - ${wait}초 뒤 다시 시도`);
      await sleep(wait * 1000);
    }
    const stat = modelTotals.get(entry.model);
    totals.calls += 1;
    if (attempts > 1) totals.retried += 1;
    const attemptNote = attempts > 1 ? ` · 일시 오류·한도로 ${attempts}번 시도` : "";
    log();
    log(`### ② AI 추천 - ${entry.label} (\`${entry.model}\`)`);
    log();
    if (!result.usedAi) {
      totals.failedCalls += 1;
      stat.failed += 1;
      qRecord.ai.push({ model: entry.model, ok: false, error: result.error, seconds: Number(seconds.toFixed(1)), attempts, calls: allCalls.map(statusOf) });
      log(`호출 실패: ${cell(result.error)} (요청 ${allCalls.length}회, 상태 ${statusText(allCalls)}${attemptNote}, 마지막 시도 ${seconds.toFixed(1)}초). 화면은 이때 ① 기본 검색 결과를 그대로 보여 줍니다.`);
      console.log(`    ${entry.model}: 실패 - ${result.error} (${statusText(callLog.calls)})`);
      finalFailures.push(callLog.calls.at(-1));
      if (isDailyQuota(callLog.calls.at(-1))) dailyExhausted.add(entry.model);
      continue;
    }
    stat.seconds.push(seconds);
    const returned = callLog.calls.length ? rawNos(callLog.calls.at(-1).text) : [];
    const kept = new Set(result.recommendations.map((item) => item.dataset.no));
    const dropped = returned.filter((no) => !kept.has(no)).length;
    totals.dropped += dropped;
    const overlap = result.recommendations.filter((item) => localNos.has(item.dataset.no)).length;
    stat.overlap.push(`${overlap}/${result.recommendations.length}`);
    log(`응답 ${seconds.toFixed(1)}초 · 요청 ${allCalls.length}회(상태 ${statusText(allCalls)}${attemptNote}) · 후보 ${result.candidateCount}건(${result.strategy === "catalog" ? "검색이 약해 전체 목록" : "기본 검색 상위"}) 중 ${result.recommendations.length}건 추천 · 기본 검색 결과와 겹침 ${overlap}건${dropped ? ` · 후보 밖 번호 ${dropped}건은 화면에서 제외됨` : ""}`);
    log();
    const aiRecord = {
      model: entry.model, ok: true, seconds: Number(seconds.toFixed(1)), attempts, calls: allCalls.map(statusOf), candidates: result.candidateCount, strategy: result.strategy, overlap, dropped, summary: result.summary,
      recommendations: [],
      combinations: result.combinations.map((combo) => ({ title: combo.title, nos: combo.datasets.map((dataset) => dataset.no), idea: combo.idea })),
    };
    qRecord.ai.push(aiRecord);
    log(`> 요약: ${cell(result.summary)}`);
    log();
    log("| 순위 | 데이터 | 관련도 | AI 추천 이유 | 이유 점검 |");
    log("|---|---|---|---|---|");
    result.recommendations.forEach((item, rank) => {
      aiNos.add(item.dataset.no);
      const check = checkReason(item.reason, item.dataset, question);
      const termCount = check.grounded.length + check.linked.length + check.unknown.length;
      totals.reasons += 1;
      stat.reasons += 1;
      totals.terms += termCount;
      stat.terms += termCount;
      totals.grounded += check.grounded.length;
      stat.grounded += check.grounded.length;
      totals.linked += check.linked.length;
      totals.unknown += check.unknown.length;
      if (check.grounded.length) {
        totals.withGround += 1;
        stat.withGround += 1;
      }
      aiRecord.recommendations.push({ no: item.dataset.no, name: shortName(item.dataset), relevance: item.relevance, reason: item.reason, ...check });
      const verdict = [
        check.grounded.length ? `근거 ${check.grounded.length}: ${check.grounded.join(", ")}` : "근거 0",
        check.linked.length ? `질문 연결: ${check.linked.join(", ")}` : "",
        check.unknown.length ? `확인 필요: ${check.unknown.join(", ")}` : "",
      ].filter(Boolean).join(" / ");
      log(`| ${rank + 1} | #${item.dataset.no} ${cell(shortName(item.dataset))} | ${item.relevance} | ${cell(item.reason)} | ${cell(verdict)} |`);
    });
    if (result.combinations.length) {
      log();
      log("활용 조합:");
      result.combinations.forEach((combo) => log(`- **${cell(combo.title)}** (${combo.datasets.map((dataset) => `#${dataset.no}`).join(" + ")}): ${cell(combo.idea)}`));
    }
    console.log(`    ${entry.model}: ${result.recommendations.length}건, ${seconds.toFixed(1)}초`);
  }

  // 추천에 쓰인 데이터의 실제 설명·컬럼 (이유를 사람이 대조할 수 있게)
  if (aiNos.size) {
    log();
    log("<details><summary>추천된 데이터의 실제 설명·컬럼 (대조용)</summary>");
    log();
    log("| 데이터 | 설명(앞부분) | 컬럼(앞 12개) |");
    log("|---|---|---|");
    for (const dataset of store.datasets.filter((item) => aiNos.has(item.no))) {
      const key = String(dataset.no);
      const meta = store.cultureColumns[key] ?? store.publicMeta[key];
      const columns = (meta?.columns ?? []).slice(0, 12).map((column) => column.label || column.name).join(", ");
      log(`| #${dataset.no} ${cell(shortName(dataset))} | ${cell(String(dataset.desc ?? "").replaceAll("_x000D_", " ").slice(0, 160))} | ${cell(columns) || "(컬럼 정보 없음)"} |`);
    }
    log();
    log("</details>");
  }

  // ③ 모의 실패 (질문마다 같은 동작이므로 첫 질문에서만)
  if (qIndex === 0) {
    log();
    log("### ③ AI 실패 시 (모의, 네트워크 없음)");
    log();
    log("| 상황 | 화면에 나오는 안내 | 대신 보여 주는 결과 |");
    log("|---|---|---|");
    for (const failure of FAILURES) {
      const result = await simulate(failure, question);
      const sameAsLocal = result.recommendations.map((item) => item.dataset.no).join(",") === local.recommendations.map((item) => item.dataset.no).join(",");
      record.failures.push({ label: failure.label, message: result.error, fallbackCount: result.recommendations.length, sameAsLocal, usedAi: result.usedAi });
      log(`| ${failure.label} | ${cell(result.error)} | ${result.usedAi ? "AI 결과(예상 밖)" : `기본 검색 ${result.recommendations.length}건${sameAsLocal ? " (① 과 같음)" : " (① 과 다름 - 확인 필요)"}`} |`);
    }
  }
}

log();
log("## 요약");
log();
if (apiKey) {
  log("| 모델 | 질문 | 실패 | 평균 응답 | 이유 수 | 근거 낱말이 1개 이상인 이유 | 이유 속 핵심어 중 데이터에서 찾은 비율 | 기본 검색과 겹친 추천 |");
  log("|---|---|---|---|---|---|---|---|");
  for (const entry of models) {
    const stat = modelTotals.get(entry.model);
    const average = stat.seconds.length ? `${(stat.seconds.reduce((a, b) => a + b, 0) / stat.seconds.length).toFixed(1)}초` : "-";
    log(`| ${entry.label} | ${questions.length} | ${stat.failed} | ${average} | ${stat.reasons} | ${stat.reasons ? `${stat.withGround}/${stat.reasons} (${Math.round((stat.withGround / stat.reasons) * 100)}%)` : "-"} | ${stat.terms ? `${stat.grounded}/${stat.terms} (${Math.round((stat.grounded / stat.terms) * 100)}%)` : "-"} | ${stat.overlap.join(", ") || "-"} |`);
  }
  log();
  log(`전체: 이유 ${totals.reasons}개 · 핵심어 ${totals.terms}개 중 근거 ${totals.grounded} · 질문 연결 ${totals.linked} · 확인 필요 ${totals.unknown} · 후보 밖 번호로 제외된 추천 ${totals.dropped}건 · 일시 오류·분당 한도로 다시 시도한 호출 ${totals.retried}건`);
} else {
  log("GEMINI_API_KEY 가 없어 AI 실호출은 하지 않았습니다. ① 기본 검색과 ③ 모의 실패만 기록했습니다.");
}

const file = path.join(root, "docs", "evidence", `${todayKst()}-ai-compare.md`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${out.join("\n")}\n`);
record.totals = totals;
record.byModel = Object.fromEntries([...modelTotals].map(([model, stat]) => [model, { ...stat, seconds: stat.seconds.map((value) => Number(value.toFixed(1))) }]));
fs.writeFileSync(file.replace(/\.md$/, ".json"), `${JSON.stringify(record, null, 1)}\n`);
console.log(`\n저장: ${path.relative(root, file)}${apiKey ? "" : "  (키 없음: AI 실호출 생략)"}`);
if (totals.failedCalls) console.log([`AI 호출 ${totals.calls}건 중 ${totals.failedCalls}건이 실패했습니다.`, ...failureAdvice(finalFailures)].join("\n"));
process.exit(apiKey && totals.failedCalls ? 1 : 0);
