// 이식 시험 데이터 갱신을 한 번에: 목록 수집 → 포털 정보 수집 → 데이터 점검 → 화면 점검.
//   node examples/korea-sports-council/update.mjs        (먼저 npm run build)
// 단계마다 걸린 시간을 출력하고, 실패한 단계가 있으면 거기서 멈춘다(종료 코드 1).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = "examples/korea-sports-council/data";
const steps = [
  ["목록 수집 (공공데이터포털 목록·상세)", ["examples/korea-sports-council/collect.mjs"]],
  ["포털 정보 수집 (이용허락범위·관리부서·수정일)", ["scripts/fetch-portal-metadata.mjs", "--data", DATA]],
  ["데이터 점검", ["scripts/validate-data.mjs", "--data", DATA]],
  ["화면 점검 (검색·상세·관계도·질문 검색·모바일)", ["examples/korea-sports-council/check.mjs"]],
];

const timings = [];
for (const [label, args] of steps) {
  console.log(`\n▶ ${label}`);
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  const seconds = (Date.now() - started) / 1000;
  timings.push([label, seconds, result.status === 0]);
  if (result.status !== 0) break;
}
console.log("\n단계별 소요 시간");
for (const [label, seconds, ok] of timings) console.log(`  ${ok ? "OK  " : "FAIL"} ${seconds.toFixed(1).padStart(6)}초  ${label}`);
console.log(`  합계 ${timings.reduce((sum, [, seconds]) => sum + seconds, 0).toFixed(1)}초`);
process.exit(timings.every(([, , ok]) => ok) && timings.length === steps.length ? 0 : 1);
