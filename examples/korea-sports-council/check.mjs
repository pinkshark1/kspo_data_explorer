// 이식 시험 화면 점검: 대한체육회 데이터 폴더로 같은 화면(index.html + assets/)을 띄워 검색·상세·컬럼·관계도·질문 검색이 동작하는지 확인하고
// 화면을 screenshots/ 에 저장한다.   node examples/korea-sports-council/check.mjs   (먼저 npm run build)
// 실패 항목이 있으면 종료 코드 1.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createStaticServer } from "../../scripts/lib/static-server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const dataDir = path.join(here, "data");
const shotDir = path.join(here, "screenshots");
fs.mkdirSync(shotDir, { recursive: true });

const browserPath = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean).find((candidate) => fs.existsSync(candidate));
if (!browserPath) {
  console.error("Chrome 또는 Edge 를 찾지 못했습니다. CHROME_PATH 환경변수에 실행 파일 경로를 지정하세요.");
  process.exit(2);
}

const explorer = JSON.parse(fs.readFileSync(path.join(dataDir, "explorer-data.json"), "utf8"));
const expected = explorer.payloads[0].length;

const server = createStaticServer(root, { dataDir });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const problems = [];
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const navButton = (page, label) => page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("button", { name: label });
const shot = (page, name) => page.screenshot({ path: path.join(shotDir, `${name}.png`) });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
  page.on("console", (message) => message.type() === "error" && problems.push(`console: ${message.text()}`));
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("response", (response) => response.status() >= 400 && problems.push(`HTTP ${response.status()}: ${response.url().replace(base, "")}`));
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".dataset-list button");

  // 기관 정보가 site.json 값으로 바뀌는지 (화면 코드에 KSPO 고정 문구가 남아 있지 않은지)
  check("데이터 목록이 모두 표시된다", (await page.locator(".dataset-list button").count()) === expected, `${expected}건`);
  check("로고 옆 기관명·로고 글자가 바뀐다", (await page.locator(".brand-copy small").innerText()) === "대한체육회" && (await page.locator(".brand-mark").innerText()) === "대");
  const menus = await page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("button").allInnerTexts();
  check("사용방법·연계 아이디어가 없는 기관은 그 메뉴가 빠진다", !menus.includes("사용방법") && !menus.includes("연계 아이디어"), menus.join(" · "));
  // 맨 위 안내띠는 이 시험본의 site.json 문구(‘KSPO 데이터 지도를 … 옮겨 본 이식 시험본’)라 제외한다.
  const bodyText = (await page.locator("body").innerText()).replace(await page.locator(".service-banner").innerText(), "");
  check("화면 코드에 KSPO·공단 고정 문구가 남아 있지 않다", !/KSPO|공단/.test(bodyText));
  const footer = await page.locator(".site-footer").innerText();
  check("푸터에 수록 데이터가 있는 포털만 나온다", /공공데이터포털 \d+건/.test(footer) && !/문화빅데이터포털/.test(footer));
  await shot(page, "1-list");

  // 검색 → 상세 → 컬럼
  await page.fill(".global-search input", "전국체전");
  await page.press(".global-search input", "Enter");
  await page.waitForTimeout(300);
  const hits = await page.locator(".dataset-list button").count();
  check("검색어로 목록을 좁힌다", hits > 0 && hits < expected, `‘전국체전’ ${hits}건`);
  await page.locator(".dataset-list button", { hasText: "메달명세" }).first().click();
  await page.waitForSelector(".profile");
  const href = (await page.locator(".request-button").first().getAttribute("href")) ?? "";
  check("상세: 데이터 원문 버튼이 공공데이터포털 상세 페이지로 연결된다", /^https:\/\/www\.data\.go\.kr\/data\/\d+\/fileData\.do$/.test(href), href);
  await shot(page, "2-detail");
  await page.locator(".profile").locator("button", { hasText: /^항목\(컬럼\)\d*$/ }).click();
  const columnRows = await page.locator(".dictionary tbody tr").count();
  check("상세: 컬럼 사전에 포털의 컬럼 정보가 나온다", columnRows > 0, `${columnRows}개`);
  await shot(page, "3-columns");

  // 관계도
  await navButton(page, "관계도").click();
  await page.waitForSelector(".graph-stage canvas");
  await page.waitForTimeout(1500);
  const stat = (await page.locator(".graph-runtime-stat").innerText()).replace(/\s+/g, " ");
  check("관계도가 그려진다", /노드 \d+/.test(stat), stat);
  await page.getByRole("button", { name: "전체 데이터 펼치기" }).click();
  await page.waitForTimeout(2500);
  const expanded = (await page.locator(".graph-runtime-stat").innerText()).replace(/\s+/g, " ");
  check("관계도: 전체 데이터를 펼치면 데이터 노드가 모두 붙는다", Number(/노드 (\d+)/.exec(expanded)?.[1]) >= expected, expanded);
  await shot(page, "4-graph");

  // 질문 검색 (기본 검색 - AI 호출 없음)
  await navButton(page, "질문 검색").click();
  await page.waitForSelector(".ask-form");
  await page.locator(".ask-examples button").first().click();
  await page.waitForSelector(".ask-list .ask-item");
  const asked = await page.locator(".ask-list .ask-item").count();
  check("질문 검색(기본 검색): 예시 질문에 추천 데이터와 일치 이유가 나온다", asked > 0 && (await page.locator(".ask-reason").first().innerText()).includes("낱말이 들어 있습니다"), `${asked}건`);
  await shot(page, "5-ask");
  // 나머지 예시 질문: 이전 결과가 남아 있는 것을 세지 않도록 결과 안내 문장이 바뀔 때까지 기다린다.
  const exampleCount = await page.locator(".ask-examples button").count();
  const topOf = async () => (await page.locator(".ask-list .ask-item").first().innerText()).split("\n").find((line) => line.includes("_")) ?? "";
  const answered = [`${asked}건(1위 ${await topOf()})`];
  for (let index = 1; index < exampleCount; index += 1) {
    const before = await page.locator(".ask-result").innerText();
    await page.locator(".ask-examples button").nth(index).click();
    await page.waitForFunction((previous) => document.querySelector(".ask-result")?.innerText !== previous, before);
    const count = await page.locator(".ask-list .ask-item").count();
    answered.push(count ? `${count}건(1위 ${await topOf()})` : "0건");
  }
  check("질문 검색(기본 검색): 예시 질문마다 결과가 나온다", !answered.includes("0건"), answered.join(" / "));
  check("콘솔 오류·404 없음", problems.length === 0, problems.join("; "));
  await page.close();

  // 모바일
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ko-KR" });
  const mobile = await context.newPage();
  await mobile.goto(`${base}/`, { waitUntil: "networkidle" });
  await mobile.waitForSelector(".dataset-list button");
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("모바일 390px: 가로 스크롤이 생기지 않는다", overflow <= 0, `${overflow}px`);
  await mobile.screenshot({ path: path.join(shotDir, "6-mobile.png") });
  await context.close();
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} 통과 · 화면: ${path.relative(root, shotDir)}`);
process.exit(failed ? 1 : 0);
