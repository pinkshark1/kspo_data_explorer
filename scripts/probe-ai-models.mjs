// 실제 API 키로 ‘질문 검색’의 AI 호출을 점검한다.   npm run probe:ai [모델 ...]
//   화면(브라우저) 없이, 화면이 쓰는 것과 같은 코드(src/ai)로 data/site.json 의 ai.gemini.models 에 있는 모델을 차례로 불러 보고
//   ① 호출이 되는지(키·모델·한도) ② 응답이 형식에 맞아 읽히는지(후보 밖 번호 제거 후 추천 건수) 를 모델별로 알려 준다.
// 키는 환경변수 GEMINI_API_KEY 로만 받는다. 화면·로그에 찍지 않고, 요청 횟수와 상태 코드만 출력한다.
//   $k = Read-Host "Gemini API 키" -AsSecureString
//   $env:GEMINI_API_KEY = [Net.NetworkCredential]::new('', $k).Password
//   npm run probe:ai                       (모든 모델)       npm run probe:ai gemma-4-31b-it   (한 모델만)
//   Remove-Item Env:GEMINI_API_KEY
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AiError } from "../src/ai/errors.js";
import { buildSystemPrompt, buildUserMessage, parseAiResponse, summarizeCandidate } from "../src/ai/prompt.js";
import { configFor } from "../src/ai/recommend.js";
import { askGemini } from "../src/ai/providers/gemini.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = JSON.parse(fs.readFileSync(path.join(root, "data", "site.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "explorer-data.json"), "utf8")).payloads[0];
const aiConfig = site.ai?.gemini;
const apiKey = (process.env.GEMINI_API_KEY ?? "").trim();

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

// 요청이 몇 번, 어떤 상태로 갔는지만 센다. (단계별 재시도 확인용. 주소·헤더·키는 기록하지 않는다)
const statuses = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const response = await realFetch(...args);
  statuses.push(response.status);
  return response;
};

const wanted = process.argv.slice(2);
const entries = (aiConfig.models?.length ? aiConfig.models : [{ model: aiConfig.model, label: aiConfig.model }]).filter((entry) => !wanted.length || wanted.includes(entry.model));
if (!entries.length) {
  console.error(`점검할 모델이 없습니다. 설정에 있는 모델: ${(aiConfig.models ?? []).map((entry) => entry.model).join(", ")}`);
  process.exit(2);
}

console.log(`질문: ${question}\n후보 ${candidates.length}건 · 모델 ${entries.length}개 점검 (키는 출력하지 않음)\n`);
let failed = 0;
for (const entry of entries) {
  statuses.length = 0;
  const started = Date.now();
  try {
    const text = await askGemini({ apiKey, config: configFor(aiConfig, entry.model), system, userMessage, signal: AbortSignal.timeout(90_000) });
    const parsed = parseAiResponse(text, candidates.map((candidate) => candidate.no));
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (!parsed) {
      failed += 1;
      console.log(`✘ ${entry.model}  ${seconds}s  호출은 됐지만 응답이 형식에 맞지 않아 읽지 못했습니다. (요청 ${statuses.length}회: ${statuses.join("→")})`);
      console.log(`    응답 앞부분: ${text.replace(/\s+/g, " ").slice(0, 160)}`);
    } else {
      console.log(`✔ ${entry.model}  ${seconds}s  추천 ${parsed.recommendations.length}건 · 조합 ${parsed.combinations.length}건  (요청 ${statuses.length}회: ${statuses.join("→")})`);
      console.log(`    요약: ${parsed.summary.slice(0, 120)}`);
      if (!parsed.recommendations.length) console.log("    (추천이 비어 있습니다. 모델이 후보 중 맞는 것이 없다고 답한 경우일 수 있습니다.)");
    }
  } catch (error) {
    failed += 1;
    const detail = error instanceof AiError ? `${error.message} [${error.code}]` : String(error?.message ?? error);
    console.log(`✘ ${entry.model}  ${((Date.now() - started) / 1000).toFixed(1)}s  ${detail}  (요청 ${statuses.length}회: ${statuses.join("→") || "-"})`);
  }
}
console.log(failed ? `\n${failed}개 모델이 되지 않았습니다.` : "\n모든 모델이 정상입니다.");
process.exit(failed ? 1 : 0);
