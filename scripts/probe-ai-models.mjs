// 실제 API 키로 ‘질문 검색’의 AI 호출을 점검한다.   npm run probe:ai [-- --save] [모델 ...]
//   화면(브라우저) 없이, 화면이 쓰는 것과 같은 코드(src/ai)로 data/site.json 의 ai.gemini.models 에 있는 모델을 차례로 불러 보고
//   ① 호출이 되는지(키·모델·한도) ② 응답이 형식에 맞아 읽히는지(후보 밖 번호 제거 후 추천 건수) 를 모델별로 알려 준다.
// 키는 환경변수 GEMINI_API_KEY 로만 받는다. 화면·로그에 찍지 않고, 요청 횟수와 상태(오류 종류·한도 이름)만 출력한다.
//   $k = Read-Host "Gemini API 키" -AsSecureString
//   $env:GEMINI_API_KEY = [Net.NetworkCredential]::new('', $k).Password
//   npm run probe:ai                       (모든 모델)       npm run probe:ai gemma-4-31b-it   (한 모델만)
//   npm run probe:ai -- --save             (모든 모델이 되면 출력을 docs/evidence/YYYY-MM-DD-ai-probe.txt 로도 저장)
//   Remove-Item Env:GEMINI_API_KEY
// Google 쪽 일시 오류(5xx)·시간 초과·연결 실패, 분당 무료 한도(429)는 화면의 자동 재시도(5xx 1회)와 별도로 기다렸다가 다시 시도한다(scripts/lib/ai-call-log.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AiError } from "../src/ai/errors.js";
import { buildSystemPrompt, buildUserMessage, parseAiResponse, summarizeCandidate } from "../src/ai/prompt.js";
import { configFor } from "../src/ai/recommend.js";
import { askGemini } from "../src/ai/providers/gemini.js";
import { failureAdvice, installCallLog, retryCause, retryWaitSec, statusText } from "./lib/ai-call-log.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = JSON.parse(fs.readFileSync(path.join(root, "data", "site.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "explorer-data.json"), "utf8")).payloads[0];
const aiConfig = site.ai?.gemini;
const apiKey = (process.env.GEMINI_API_KEY ?? "").trim();
const argv = process.argv.slice(2);
const save = argv.includes("--save");
const wanted = argv.filter((arg) => arg !== "--save");

if (!aiConfig) {
  console.error("data/site.json 에 ai.gemini 설정이 없습니다.");
  process.exit(2);
}
if (!apiKey) {
  console.error("환경변수 GEMINI_API_KEY 에 Gemini API 키를 넣고 다시 실행하세요. (이 파일 맨 위의 사용법 참고)");
  process.exit(2);
}

// 화면과 같은 질문·지시문. 후보는 ‘체육시설’이 이름·분야에 들어간 데이터 앞쪽 30건(화면의 후보 선정을 단순하게 흉내 낸 것).
const question = "체육시설 안전과 연계할 수 있는 데이터가 뭐 있어?";
const candidates = catalog
  .filter((dataset) => `${dataset.name} ${dataset.field}`.includes("체육시설"))
  .slice(0, 30)
  .map((dataset) => summarizeCandidate(dataset, { portalName: dataset.ch, summary: "", compact: false }));
const system = buildSystemPrompt({ orgName: site.organization.name, serviceName: site.service.fullName });
const userMessage = buildUserMessage(question, candidates);

const callLog = installCallLog();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const out = [];
const say = (line = "") => {
  out.push(line);
  console.log(line);
};

const entries = (aiConfig.models?.length ? aiConfig.models : [{ model: aiConfig.model, label: aiConfig.model }]).filter((entry) => !wanted.length || wanted.includes(entry.model));
if (!entries.length) {
  console.error(`점검할 모델이 없습니다. 설정에 있는 모델: ${(aiConfig.models ?? []).map((entry) => entry.model).join(", ")}`);
  process.exit(2);
}

say(`질문: ${question}\n후보 ${candidates.length}건 · 모델 ${entries.length}개 점검 (키는 출력하지 않음)\n`);
let failed = 0;
const failedCalls = [];
for (const entry of entries) {
  for (let attempt = 1; ; attempt += 1) {
    callLog.calls = [];
    const started = Date.now();
    const tag = attempt > 1 ? `  [${attempt}번째 시도]` : "";
    const requests = () => `(요청 ${callLog.calls.length}회: ${statusText(callLog.calls)})`;
    try {
      // 화면의 자동 재시도(1회)까지 끝날 수 있게 요청 한 번의 시간 제한(90초)보다 넉넉히 둔다
      const text = await askGemini({ apiKey, config: configFor(aiConfig, entry.model), system, userMessage, signal: AbortSignal.timeout(150_000) });
      const parsed = parseAiResponse(text, candidates.map((candidate) => candidate.no));
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (!parsed) {
        failed += 1;
        say(`✘ ${entry.model}  ${seconds}s  호출은 됐지만 응답이 형식에 맞지 않아 읽지 못했습니다. ${requests()}${tag}`);
        say(`    응답 앞부분: ${text.replace(/\s+/g, " ").slice(0, 160)}`);
      } else {
        say(`✔ ${entry.model}  ${seconds}s  추천 ${parsed.recommendations.length}건 · 조합 ${parsed.combinations.length}건  ${requests()}${tag}`);
        say(`    요약: ${parsed.summary.slice(0, 120)}`);
        if (!parsed.recommendations.length) say("    (추천이 비어 있습니다. 모델이 후보 중 맞는 것이 없다고 답한 경우일 수 있습니다.)");
      }
      break;
    } catch (error) {
      const detail = error instanceof AiError ? `${error.message} [${error.code}]` : String(error?.message ?? error);
      const last = callLog.calls.at(-1);
      const wait = retryWaitSec(last, attempt);
      say(`${wait ? "…" : "✘"} ${entry.model}  ${((Date.now() - started) / 1000).toFixed(1)}s  ${detail}  ${requests()}${tag}${wait ? `  → ${retryCause(last)}라 ${wait}초 뒤 다시 시도합니다` : ""}`);
      if (wait) {
        await sleep(wait * 1000);
        continue;
      }
      failed += 1;
      failedCalls.push(last);
      break;
    }
  }
}
say(failed ? `\n${failed}개 모델이 되지 않았습니다.` : "\n모든 모델이 정상입니다.");
for (const line of failureAdvice(failedCalls)) say(line);

if (save) {
  if (failed) {
    console.log("(실패한 모델이 있어 기록 파일은 저장하지 않았습니다.)");
  } else {
    const now = new Date(Date.now() + 9 * 3600_000).toISOString(); // 한국 시간
    const file = path.join(root, "docs", "evidence", `${now.slice(0, 10)}-ai-probe.txt`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `npm run probe:ai 실행 기록 (${now.slice(0, 10)} ${now.slice(11, 16)}, 실행자 본인 키 - 키는 기록하지 않음)\n\n${out.join("\n")}\n`);
    console.log(`\n저장: ${path.relative(root, file)}`);
  }
}
process.exit(failed ? 1 : 0);
