// 실제 키로 받은 AI 추천 응답(docs/evidence/*-ai-compare.json)을 화면용 예시 파일(data/ai-examples.json)로 옮긴다.   npm run export:ai-examples [-- 모델]
// 화면은 이 파일이 있으면 예시 질문에 대해 키 없이도 ‘저장된 AI 추천 예시’를 보여 준다. (새로 AI 를 부르지 않는다)
// - 가장 최근 비교 기록에서, 지정한 모델(기본: site.json 의 ai.gemini.model)이 실제로 응답한 질문만 옮긴다. 응답 문장은 고치지 않는다.
// - 데이터 번호가 현재 목록에 없으면 그 추천은 뺀다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(root, "docs", "evidence");
const site = JSON.parse(fs.readFileSync(path.join(root, "data", "site.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "explorer-data.json"), "utf8")).payloads[0];
const known = new Set(catalog.map((dataset) => dataset.no));

const file = fs
  .readdirSync(evidenceDir)
  .filter((name) => name.endsWith("-ai-compare.json"))
  .sort()
  .reverse()
  .find((name) => JSON.parse(fs.readFileSync(path.join(evidenceDir, name), "utf8")).models?.length);
if (!file) {
  console.error("실제 키로 실행한 비교 기록(docs/evidence/*-ai-compare.json)이 없습니다. npm run compare:ai 를 먼저 실행하세요.");
  process.exit(2);
}
const record = JSON.parse(fs.readFileSync(path.join(evidenceDir, file), "utf8"));
const model = process.argv[2] ?? site.ai?.gemini?.model;
const label = record.models.find((entry) => entry.model === model)?.label ?? model;

const examples = [];
for (const question of record.questions) {
  const answer = question.ai.find((entry) => entry.model === model && entry.ok);
  if (!answer) continue;
  examples.push({
    question: question.question,
    summary: answer.summary,
    recommendations: answer.recommendations.filter((item) => known.has(item.no)).map(({ no, relevance, reason }) => ({ no, relevance, reason })),
    combinations: answer.combinations.map(({ title, nos, idea }) => ({ title, nos: nos.filter((no) => known.has(no)), idea })),
  });
}
if (!examples.length) {
  console.error(`${file} 에 ${model} 의 응답이 없습니다.`);
  process.exit(2);
}

const out = { source: `docs/evidence/${file.replace(".json", ".md")}`, date: record.date, model, label, examples };
fs.writeFileSync(path.join(root, "data", "ai-examples.json"), `${JSON.stringify(out, null, 1)}\n`);
console.log(`저장: data/ai-examples.json (${label}, ${record.date}, 질문 ${examples.length}개)`);
