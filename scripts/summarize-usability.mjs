// 소규모 사전 사용성 점검 기록(docs/usability/records.csv)을 요약한다.   node scripts/summarize-usability.mjs [기록.csv]
// 진행 방법·과제·정답표는 docs/usability/README.md. 결과는 docs/evidence/YYYY-MM-DD-usability.md 로 저장한다.
// 기록이 없거나 형식이 틀리면 아무것도 저장하지 않고 종료 코드 1. (측정하지 않은 값을 만들지 않는다)
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.resolve(root, process.argv[2] ?? "docs/usability/records.csv");
const COLUMNS = ["participant", "order", "method", "task", "seconds", "correct", "note", "date"];
const METHOD = { portal: "기존 방식(포털 직접 검색)", map: "KSPO 데이터 지도" };
const TYPE = { 1: "① 위치 찾기", 2: "② 후보 찾기", 3: "③ 컬럼 확인" };
const LIMIT = 300;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};
if (!fs.existsSync(input)) fail(`기록 파일이 없습니다: ${path.relative(root, input)}\ndocs/usability/records-template.csv 를 records.csv 로 복사해 점검 결과를 적은 뒤 다시 실행하세요.`);

const lines = fs.readFileSync(input, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
const header = lines.shift()?.split(",").map((cell) => cell.trim());
if (header?.join(",") !== COLUMNS.join(",")) fail(`첫 줄(머리글)이 ${COLUMNS.join(",")} 이어야 합니다.`);

const problems = [];
const rows = lines.map((line, index) => {
  const cells = line.split(",").map((cell) => cell.trim());
  const row = Object.fromEntries(COLUMNS.map((column, position) => [column, cells[position] ?? ""]));
  const where = `${index + 2}번째 줄`;
  if (cells.length !== COLUMNS.length) problems.push(`${where}: 칸 수가 ${cells.length}개입니다 (메모에 쉼표가 있으면 · 로 바꾸세요).`);
  if (!/^P\d+$/.test(row.participant)) problems.push(`${where}: participant 는 P1 형태로 적습니다.`);
  if (!METHOD[row.method]) problems.push(`${where}: method 는 portal 또는 map 입니다.`);
  if (!/^[AB][123]$/.test(row.task)) problems.push(`${where}: task 는 A1~A3, B1~B3 입니다.`);
  const seconds = Number(row.seconds);
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > LIMIT) problems.push(`${where}: seconds 는 1~${LIMIT} 사이 정수입니다.`);
  if (!["Y", "N"].includes(row.correct)) problems.push(`${where}: correct 는 Y 또는 N 입니다.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) problems.push(`${where}: date 는 YYYY-MM-DD 입니다.`);
  return { ...row, seconds, type: row.task.slice(1) };
});
if (!rows.length) fail("기록이 비어 있습니다. 점검 결과를 적은 뒤 다시 실행하세요.");

// 한 참여자 안에서: 같은 과제를 두 번 하지 않았는지, 한 묶음은 한 방식으로만, 두 묶음은 서로 다른 방식으로 했는지
// (Map.groupBy 는 Node.js 21 부터라 Node.js 20 에서도 되도록 직접 묶는다)
const byParticipant = new Map();
for (const row of rows) {
  if (!byParticipant.has(row.participant)) byParticipant.set(row.participant, []);
  byParticipant.get(row.participant).push(row);
}
for (const [participant, list] of byParticipant) {
  const tasks = list.map((row) => row.task);
  if (new Set(tasks).size !== tasks.length) problems.push(`${participant}: 같은 과제가 두 번 기록되었습니다.`);
  const methodOf = {};
  for (const set of ["A", "B"]) {
    const methods = new Set(list.filter((row) => row.task.startsWith(set)).map((row) => row.method));
    if (methods.size > 1) problems.push(`${participant}: 과제 ${set} 묶음을 두 방식으로 나눠 했습니다 (묶음 하나는 한 방식으로만).`);
    methodOf[set] = [...methods][0];
  }
  if (methodOf.A && methodOf.A === methodOf.B) problems.push(`${participant}: 과제 A·B 묶음을 같은 방식(${methodOf.A})으로 했습니다 (두 묶음은 서로 다른 방식이어야 함).`);
  if (list.length !== 6) problems.push(`${participant}: 과제가 ${list.length}건입니다 (두 방식 × 3과제 = 6건이어야 함).`);
}
if (problems.length) fail(`기록을 확인해 주세요.\n- ${problems.join("\n- ")}`);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const stats = (list) => {
  const seconds = list.map((row) => row.seconds);
  const correct = list.filter((row) => row.correct === "Y").length;
  return {
    count: list.length,
    correct,
    rate: Math.round((correct / list.length) * 100),
    median: median(seconds),
    min: Math.min(...seconds),
    max: Math.max(...seconds),
    timeouts: list.filter((row) => row.seconds >= LIMIT).length,
  };
};

const participants = [...byParticipant.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
const dates = [...new Set(rows.map((row) => row.date))].sort();
let commit = "확인 불가";
try {
  commit = execSync("git log -1 --format=%h", { cwd: root }).toString().trim();
} catch {
  // git 이 없으면 그대로 둔다
}
const generatedAt = JSON.parse(fs.readFileSync(path.join(root, "data", "explorer-data.json"), "utf8")).generatedAt;

const out = [];
out.push(`# 소규모 사전 사용성 점검 결과 (참여자 ${participants.length}명)`);
out.push("");
out.push(`진행 방법·과제·정답표: [docs/usability/README.md](../usability/README.md). \`node scripts/summarize-usability.mjs\` 로 만든 요약이며, 표본이 작아 경향을 보는 사전 점검입니다.`);
out.push("");
out.push("| 항목 | 값 |");
out.push("|---|---|");
out.push(`| 점검일 | ${dates.join(", ")} |`);
out.push(`| 참여자 | ${participants.length}명 (${participants.join(", ")}) |`);
out.push(`| 과제 | 3유형(위치 찾기·후보 찾기·컬럼 확인) × 2방식, 묶음 A·B 교차 배정, 과제당 최대 ${LIMIT}초 |`);
out.push(`| 화면 버전 | 요약 작성 시 커밋 ${commit} · 데이터 목록 기준일 ${generatedAt} |`);
out.push(`| 원자료 | \`${path.relative(root, input).replaceAll("\\", "/")}\` |`);
out.push("");
out.push("## 방식별");
out.push("");
out.push("| 방식 | 과제 수 | 정답 | 정답률 | 소요 시간 중앙값 | 최소~최대 | 시간 초과 |");
out.push("|---|---|---|---|---|---|---|");
const overall = {};
for (const method of ["portal", "map"]) {
  const list = rows.filter((row) => row.method === method);
  if (!list.length) continue;
  const s = (overall[method] = stats(list));
  out.push(`| ${METHOD[method]} | ${s.count} | ${s.correct} | ${s.rate}% | ${s.median}초 | ${s.min}~${s.max}초 | ${s.timeouts} |`);
}
out.push("");
out.push("## 과제 유형별 소요 시간 중앙값");
out.push("");
out.push("| 유형 | 기존 방식 | 데이터 지도 | 기존 방식 정답률 | 데이터 지도 정답률 |");
out.push("|---|---|---|---|---|");
for (const type of ["1", "2", "3"]) {
  const pick = (method) => rows.filter((row) => row.type === type && row.method === method);
  const portal = pick("portal");
  const map = pick("map");
  const cell = (list, key) => (list.length ? (key === "median" ? `${stats(list).median}초 (${list.length}건)` : `${stats(list).rate}%`) : "-");
  out.push(`| ${TYPE[type]} | ${cell(portal, "median")} | ${cell(map, "median")} | ${cell(portal, "rate")} | ${cell(map, "rate")} |`);
}
const notes = rows.filter((row) => row.note);
if (notes.length) {
  out.push("");
  out.push("## 진행 메모");
  out.push("");
  notes.forEach((row) => out.push(`- ${row.participant} ${row.task} (${row.method === "map" ? "데이터 지도" : "기존 방식"}): ${row.note}`));
}
out.push("");
out.push("## 읽을 때 주의");
out.push("");
out.push(`- 참여자 ${participants.length}명의 사전 점검이라 통계적 유의성을 말할 수 없습니다. 중앙값과 범위를 함께 봅니다.`);
out.push("- 과제 묶음 A·B는 유형을 맞췄지만 주제가 달라 난이도 차이가 남을 수 있습니다(순서·묶음 교차 배정으로 일부 상쇄).");
out.push("- 참여자·진행자 조건(공단 직원 여부, 진행자가 개발자인지)은 결과에 영향을 줄 수 있어 보고서에 함께 적습니다.");

const file = path.join(root, "docs", "evidence", `${dates.at(-1)}-usability.md`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${out.join("\n")}\n`);
if (overall.portal && overall.map) console.log(`기존 방식 중앙값 ${overall.portal.median}초 · 정답률 ${overall.portal.rate}% / 데이터 지도 중앙값 ${overall.map.median}초 · 정답률 ${overall.map.rate}%`);
console.log(`저장: ${path.relative(root, file)}`);
