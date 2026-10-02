// 자동 점검 4종을 실행하고 결과를 증빙 파일(docs/evidence/YYYY-MM-DD-checks.md)로 남긴다.   npm run evidence
//   check:data(데이터·개인정보) · check:search(기본 검색 품질) · check:ui(화면) · check:ai(AI 경로, 모의 서버)
// 실행 환경(OS·Node·브라우저)과 저장소 커밋을 함께 적고, 각 점검의 전체 출력을 그대로 붙인다. 실패가 있으면 종료 코드 1.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // 한국 시간
const outDir = path.join(root, "docs", "evidence");
fs.mkdirSync(outDir, { recursive: true });

const git = (...args) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
const commit = git("rev-parse", "--short", "HEAD");
const dirty = git("status", "--porcelain", "--", "src", "data", "scripts", "assets", "index.html") ? " (작업 중 변경 있음)" : "";

const CHECKS = [
  { id: "check:data", title: "데이터 구조·개인정보", summary: (out) => out.match(/오류 \d+건, 경고 \d+건/)?.[0] },
  { id: "check:search", title: "기본 검색 품질", summary: (out) => out.match(/질문 \d+개 \| [^\n]+/)?.[0]?.trim() },
  { id: "check:ui", title: "화면(데스크톱·모바일)", summary: (out) => out.match(/\d+\/\d+ 통과/)?.[0] },
  { id: "check:ai", title: "AI 경로(모의 서버)", summary: (out) => out.match(/\d+\/\d+ 통과/)?.[0] },
];

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const results = [];
for (const check of CHECKS) {
  process.stdout.write(`${check.id} 실행 중... `);
  const started = Date.now();
  const run = spawnSync(npm, ["run", "--silent", check.id], { cwd: root, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 1 << 26 });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
  const ok = run.status === 0;
  results.push({ ...check, ok, seconds: ((Date.now() - started) / 1000).toFixed(0), output, line: check.summary(output) ?? (ok ? "통과" : "실패") });
  console.log(ok ? "통과" : "실패");
}

const chrome = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => fs.existsSync(p));
const lines = [
  `# 자동 점검 결과 (${today})`,
  "",
  `- 저장소 커밋: \`${commit}\`${dirty}`,
  `- 실행 환경: ${os.type()} ${os.release()} · Node.js ${process.version} · 브라우저 ${chrome ? path.basename(chrome) : "(찾지 못함)"} (헤드리스)`,
  "- 만든 방법: `npm run evidence` (scripts/save-evidence.mjs) - 아래 점검을 차례로 실행하고 출력 전체를 붙였습니다.",
  "",
  "| 점검 | 명령 | 결과 | 요약 |",
  "|---|---|---|---|",
  ...results.map((r) => `| ${r.title} | \`npm run ${r.id}\` | ${r.ok ? "통과" : "**실패**"} | ${r.line.replace(/\s*\|\s*/g, " · ")} |`),
  "",
  "> 기본 검색 품질의 질문 세트는 개발자가 직접 만든 것이며, 개발 중 회귀를 확인하는 용도입니다. AI 경로 점검은 실제 AI 대신 모의 서버를 씁니다. 실제 키로 확인한 AI 응답은 같은 폴더의 `*-ai-probe.txt`(`npm run probe:ai`)와 `*-ai-compare.md`(`npm run compare:ai`)를 보세요.",
  "",
  ...results.flatMap((r) => [`## ${r.title} — \`npm run ${r.id}\` (${r.seconds}초)`, "", "```text", r.output, "```", ""]),
];
const file = path.join(outDir, `${today}-checks.md`);
fs.writeFileSync(file, lines.join("\n"));
console.log(`\n저장: ${path.relative(root, file)}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
