// 질문 검색(로컬 의미 확장 검색)의 품질 점검.   npm run check:search
// 질문마다 "이 데이터는 상위에 나와야 한다"는 기준(expect)을 두고 적중률을 계산한다. AI 모델은 쓰지 않는다.
//   - top5  : 기대한 데이터가 상위 5건 안에 하나라도 있는가
//   - 재현율 : 기대 목록 중 상위 10건에 들어온 비율
// 기준 미달이면 종료 코드 1. 새 데이터를 추가하거나 유의어 사전을 고친 뒤 실행한다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, search } from "../src/ai/retrieval.js";
import { PAYLOAD } from "../src/lib/data.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const explorer = JSON.parse(fs.readFileSync(path.join(root, "data", "explorer-data.json"), "utf8"));
const store = {
  datasets: explorer.payloads[PAYLOAD.catalog],
  cultureColumns: explorer.payloads[PAYLOAD.cultureColumns],
  publicMeta: explorer.payloads[PAYLOAD.publicMeta],
  apiSamples: explorer.payloads[PAYLOAD.apiSamples],
};
const index = buildIndex(store);

// expect: 상위에 나와야 하는 데이터 번호 (그중 하나라도 상위 5건에 있으면 적중)
const CASES = [
  { q: "체육시설 안전과 연계할 수 있는 데이터가 뭐 있어?", expect: [82, 86, 170, 116, 156] },
  { q: "체육시설 안전점검 결과를 볼 수 있어?", expect: [86, 170, 82] },
  { q: "장애인 대상 체력 측정 데이터가 있을까?", expect: [66, 67, 68] },
  { q: "국민체력100 운동처방 데이터", expect: [39, 41, 32] },
  { q: "연령별로 추천하는 운동 정보를 알고 싶어요", expect: [32, 68] },
  { q: "경륜 선수 성적을 분석하려면 어떤 데이터를 봐야 해?", expect: [3, 7, 19, 129, 138] },
  { q: "경정 배당률 데이터 API", expect: [151, 2] },
  { q: "경륜 경주 결과와 순위", expect: [3, 126, 134] },
  { q: "스포츠강좌이용권 이용 현황과 시설 위치", expect: [52, 50, 174, 53] },
  { q: "장애인 스포츠강좌이용권 시설 정보", expect: [72, 63, 165] },
  { q: "신규 스포츠 사업 기획에 참고할 기금 지원 데이터는?", expect: [97, 98, 160, 152] },
  { q: "체육진흥기금 지원 실적", expect: [98, 96, 160] },
  { q: "스포츠토토 발매 매출 데이터", expect: [155, 102, 178] },
  { q: "불법 도박 신고와 관련된 자료", expect: [100, 101, 102, 155] },
  { q: "스포츠산업 지원 기업 목록", expect: [55, 117, 163, 177] },
  { q: "체육지도자 자격 취득 현황", expect: [89, 118, 119] },
  { q: "스포츠 연구 보고서를 찾고 싶어", expect: [106, 179, 107] },
  { q: "소마미술관 전시 작품", expect: [47, 46, 48, 125] },
  { q: "올림픽파크텔 객실 이용 현황", expect: [111, 113, 175] },
  { q: "올림픽공원 대관 정보", expect: [60, 123] },
  { q: "AI 학습용 이미지 데이터", expect: [116] },
  { q: "공공체육시설 프로그램과 대중교통 접근성", expect: [78, 85, 79] },
  { q: "아이들이 이용할 수 있는 체육시설 프로그램", expect: [83, 78] },
  { q: "지역별 스포츠 동호회 현황", expect: [43, 64, 74] },
  { q: "스포츠 꿈나무 장학금 지급 현황", expect: [108, 109] },
  { q: "체육인 복지 포상금 지급", expect: [166, 167] },
  { q: "국가대표 대회 경기 영상", expect: [75, 76] },
  { q: "채용 공고 정보", expect: [162, 184] },
  { q: "경정 모터와 보트 정비 이력", expect: [22, 23, 28, 147, 148] },
  { q: "수영장 헬스장 같은 체육시설 현황", expect: [80, 79, 154] },
  // 2026-10-01 에 추가된 포털 데이터(194~202). 데이터 이름을 그대로 쓰지 않은 질문을 섞었다.
  { q: "배드민턴 치는 곳", expect: [194] },
  { q: "스포츠가치센터에서 체험할 수 있는 프로그램과 비용", expect: [195] },
  { q: "체험 시설 운영시간과 수용인원", expect: [196] },
  { q: "스포츠가치센터 숙박 객실 요금", expect: [197] },
  { q: "어린이 인센티브 사업 참여자", expect: [198] },
  { q: "복지 바우처 승인 취소 내역", expect: [199, 200] },
  { q: "혈압 키 몸무게 측정 결과", expect: [202, 172] },
  { q: "체력 검사 참여자 연령", expect: [201, 172, 36] },
  { q: "개인정보 없이 분석 실습용으로 쓸 수 있는 데이터", expect: [201, 202, 198, 199, 200] },
];

// 데이터와 관계없는 질문: 결과가 없거나 신뢰도가 'low' 여야 한다. (엉뚱한 데이터를 자신 있게 추천하지 않는지)
const UNRELATED = ["오늘 날씨 어때", "맛집 추천해줘", "비트코인 시세 알려줘", "주식 투자 전략", "영화 개봉 일정", "야구 경기 일정", "학교 급식 메뉴", "안녕하세요"];

// 화면의 ‘이런 질문을 해 보세요’ 예시 질문은 모두 믿을 만한 결과가 나와야 한다.
const site = JSON.parse(fs.readFileSync(path.join(root, "data", "site.json"), "utf8"));
const weakExamples = (site.ai?.exampleQuestions ?? []).filter((q) => {
  const found = search(index, q, { limit: 5 });
  return found.results.length < 3 || !["medium", "high"].includes(found.confidence);
});
console.log(`예시 질문 ${(site.ai?.exampleQuestions ?? []).length}개 중 결과가 약한 것 ${weakExamples.length}개${weakExamples.length ? `: ${weakExamples.join(" / ")}` : ""}`);

const TOP_K = 5;
const RECALL_K = 10;
let hits = 0;
let recallSum = 0;
const misses = [];
const lowConfidence = [];
for (const testCase of CASES) {
  const { results } = search(index, testCase.q, { limit: RECALL_K });
  const nos = results.map((result) => result.dataset.no);
  const hit = testCase.expect.some((no) => nos.slice(0, TOP_K).includes(no));
  const recall = testCase.expect.filter((no) => nos.includes(no)).length / testCase.expect.length;
  if (hit) hits += 1;
  else misses.push({ q: testCase.q, expect: testCase.expect, got: results.slice(0, TOP_K).map((r) => `${r.dataset.no}:${r.dataset.name.replace(/^서울올림픽기념국민체육진흥공단_/, "").slice(0, 14)}`) });
  recallSum += recall;
  if (!["medium", "high"].includes(search(index, testCase.q).confidence)) lowConfidence.push(testCase.q);
  if (process.argv.includes("--verbose")) {
    console.log(`${hit ? "PASS" : "MISS"}  ${testCase.q}\n      -> ${results.slice(0, TOP_K).map((r) => `#${r.dataset.no}`).join(" ")}   (기대 ${testCase.expect.map((n) => `#${n}`).join(" ")})`);
  }
}

const hitRate = hits / CASES.length;
const recall = recallSum / CASES.length;
console.log(`질문 ${CASES.length}개 | 상위 ${TOP_K}건 적중률 ${(hitRate * 100).toFixed(0)}% | 상위 ${RECALL_K}건 재현율 ${(recall * 100).toFixed(0)}%`);
misses.forEach((miss) => console.log(`MISS  ${miss.q}\n      기대 ${miss.expect.map((n) => `#${n}`).join(" ")} / 실제 ${miss.got.join(" | ")}`));

const overConfident = UNRELATED.filter((q) => ["medium", "high"].includes(search(index, q).confidence));
console.log(`관계없는 질문 ${UNRELATED.length}개 중 자신 있게 추천한 것 ${overConfident.length}개${overConfident.length ? `: ${overConfident.join(" / ")}` : ""}`);
if (lowConfidence.length) console.log(`관련 질문인데 신뢰도가 낮게 나온 것: ${lowConfidence.join(" / ")}`);

const MIN_HIT_RATE = 0.9;
if (overConfident.length || lowConfidence.length || weakExamples.length) {
  console.error("신뢰도 판정 기준을 확인하세요.");
  process.exit(1);
}
if (hitRate < MIN_HIT_RATE) {
  console.error(`적중률이 기준(${MIN_HIT_RATE * 100}%)보다 낮습니다.`);
  process.exit(1);
}
