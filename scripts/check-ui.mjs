// 화면 동작 점검(스모크 테스트).   npm run build && npm run check:ui
// 로컬 웹서버를 띄워 PC Chrome/Edge 로 데스크톱·모바일 화면을 열고, 감사에서 지적된 항목이 다시 깨지지 않았는지 확인한다.
// 실패 항목이 있으면 종료 코드 1.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createStaticServer } from "./lib/static-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

const server = createStaticServer(root);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const problems = [];
const watch = (page, label) => {
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`${label} console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`${label} pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`${label} HTTP ${response.status()}: ${response.url().replace(base, "")}`);
  });
};
const navButton = (page, label) => page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("button", { name: label });

try {
  // ---------------- 데스크톱 ----------------
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
  watch(desktop, "desktop");
  const requestedUrls = [];
  desktop.on("request", (request) => requestedUrls.push(request.url()));
  await desktop.goto(`${base}/`, { waitUntil: "networkidle" });
  await desktop.waitForSelector(".dataset-list button");

  const total = await desktop.locator(".dataset-list button").count();
  check("데이터셋 목록이 표시된다", total > 100, `${total}건`);

  const searchButton = await desktop.locator(".global-search button").boundingBox();
  check("검색 버튼 글자가 한 줄로 보인다(데스크톱)", searchButton.height <= 56 && searchButton.width >= 44, `${Math.round(searchButton.width)}x${Math.round(searchButton.height)}`);

  const cycleOptions = await desktop.locator(".filter-fields label").nth(3).locator("option").allInnerTexts();
  check("업데이트 주기 필터에 영문/한글 중복 표기가 없다", !cycleOptions.some((text) => /Yearly|Monthly|연간/.test(text)) && new Set(cycleOptions.map((text) => text.replace(/\s*\(\d+\)/, ""))).size === cycleOptions.length, cycleOptions.join(" / "));

  await desktop.fill(".global-search input", "체력");
  await desktop.press(".global-search input", "Enter");
  await desktop.waitForTimeout(300);
  const fitnessCount = await desktop.locator(".dataset-list button").count();
  check("검색어 ‘체력’ 결과가 나온다", fitnessCount > 0, `${fitnessCount}건`);
  await desktop.fill(".global-search input", "zzzz없는단어");
  await desktop.waitForTimeout(200);
  check("검색 결과가 없으면 안내 문구가 나온다", (await desktop.locator(".empty-list").count()) === 1);
  check("검색 결과가 없으면 검색어를 보여 주고 질문 검색·지우기 버튼을 준다", (await desktop.locator(".empty-list").innerText()).includes("zzzz없는단어") && (await desktop.locator(".empty-list button").count()) === 2 && (await desktop.locator(".query-chip").count()) === 1);
  await desktop.locator(".empty-list button", { hasText: "지우기" }).click();
  check("‘조건·검색어 지우기’를 누르면 검색어까지 지워진다", (await desktop.inputValue(".global-search input")) === "" && (await desktop.locator(".dataset-list button").count()) > 100);

  // 첫 화면 소개: 질문을 입력하면 질문 검색으로 넘어가 바로 찾는다
  check("첫 화면에 서비스 소개와 질문 입력이 있다", (await desktop.locator(".home-intro h2").count()) === 1 && (await desktop.locator("#home-question").count()) === 1);
  await desktop.fill("#home-question", "체육시설 안전 데이터");
  await desktop.locator(".home-ask button").click();
  await desktop.waitForSelector(".ask-list .ask-item");
  check("첫 화면에서 질문하면 질문 검색 결과가 나오고 어떤 질문의 결과인지 보인다", (await desktop.inputValue("#ask-question")) === "체육시설 안전 데이터" && (await desktop.locator(".ask-asked").innerText()).includes("체육시설 안전 데이터"));
  await desktop.locator("button.brand").click();
  await desktop.waitForSelector(".dataset-list");
  check("파일 데이터 상세에는 빈 ‘API 기능’ 탭이 없다", (await desktop.locator(".profile-tabs button", { hasText: "API 기능" }).count()) === 0);

  // 데이터 정보 + 원문 버튼
  await desktop.locator(".dataset-list button").first().click();
  check("데이터 원문 버튼이 대상 포털을 함께 표시한다", /문화빅데이터포털|공공데이터포털/.test((await desktop.locator(".request-button, .request-button.secondary").first().innerText()) ?? ""));
  const withMeta = await desktop.locator(".dataset-list button", { hasText: "한국스포츠과학원 연구자료 정기간행물" }).first();
  await withMeta.click();
  const metaText = await desktop.locator(".meta-strip").innerText();
  check("‘데이터 정보’에 포털 수정일·이용허락범위가 표시된다", /포털 최종 수정일/.test(metaText) && /이용허락범위/.test(metaText), metaText.replace(/\s+/g, " ").slice(0, 80));

  // 원문 주소가 없는 데이터: 지금은 모든 데이터에 주소가 있으므로, 시험용으로 #6 의 주소(payloads[1])를 지운 데이터 파일을 내려주고 대체 안내를 확인한다.
  const noUrl = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
  watch(noUrl, "no-url");
  await noUrl.route(/\/data\/explorer-data\.json/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    delete body.payloads[1]["6"];
    await route.fulfill({ response, json: body });
  });
  await noUrl.goto(`${base}/`, { waitUntil: "networkidle" });
  await noUrl.waitForSelector(".dataset-list button");
  await noUrl.fill(".global-search input", "경륜 뉴스 데이터");
  await noUrl.waitForTimeout(200);
  await noUrl.locator(".dataset-list button").first().click();
  check("원문 주소가 없는 데이터는 대체 안내와 포털 찾기 링크가 나온다", (await noUrl.locator(".source-missing").count()) === 1 && (await noUrl.locator(".request-button.secondary").count()) === 1);
  await noUrl.close();
  // 실제 데이터에서는 #6 에 원문 주소(상세 페이지)가 연결되어 있어야 한다.
  await desktop.fill(".global-search input", "경륜 뉴스 데이터");
  await desktop.waitForTimeout(200);
  await desktop.locator(".dataset-list button").first().click();
  const newsHref = (await desktop.locator(".request-button").first().getAttribute("href")) ?? "";
  check("원문 주소가 연결된 데이터는 포털 상세 페이지로 이동하는 버튼이 나온다", /data_market\/detail\.do\?id=/.test(newsHref) && (await desktop.locator(".source-missing").count()) === 0, newsHref.slice(0, 80));
  await desktop.fill(".global-search input", "");

  // 사용방법: 같은 사이트 안에서 열린다(외부 이동 없음)
  await navButton(desktop, "사용방법").click();
  await desktop.waitForSelector(".guide-view");
  check("‘사용방법’이 사이트 안에서 열린다", new URL(desktop.url()).origin === base && (await desktop.locator(".guide-thumbnail").count()) === 1);
  await desktop.locator(".guide-thumbnail").click();
  await desktop.waitForSelector("video.guide-player");
  const videoReady = await desktop.evaluate(() => new Promise((resolve) => {
    const video = document.querySelector("video.guide-player");
    if (video.readyState >= 1) return resolve(video.duration > 0);
    video.addEventListener("loadedmetadata", () => resolve(video.duration > 0));
    video.addEventListener("error", () => resolve(false));
    setTimeout(() => resolve(false), 8000);
  }));
  check("사용방법 영상 메타데이터가 로드된다", videoReady);

  // 연계 아이디어 -> 데이터 탐색 연결
  await navButton(desktop, "연계 아이디어").click();
  await desktop.waitForSelector(".idea-grid article");
  const ideaCards = await desktop.locator(".idea-grid article").count();
  const linkedCards = await desktop.locator(".idea-grid article .idea-show-all").count();
  check("연계 아이디어 카드마다 관련 데이터 링크가 있다", ideaCards > 0 && ideaCards === linkedCards, `${linkedCards}/${ideaCards}`);
  await desktop.locator(".idea-show-all").first().click();
  await desktop.waitForSelector(".idea-filter-notice");
  const filtered = await desktop.locator(".dataset-list button").count();
  check("‘관련 데이터 모두 보기’가 해당 데이터만 보여준다", filtered > 0 && filtered < total, `${filtered}건`);
  await desktop.getByRole("button", { name: "전체 데이터 보기" }).click();
  check("‘전체 데이터 보기’로 필터가 해제된다", (await desktop.locator(".dataset-list button").count()) === total);

  // 다른 화면에서 데이터를 열면 목록·상세가 어긋나지 않는다 (예전 검색어 때문에 목록에 없는 데이터가 열리던 문제)
  await desktop.fill(".global-search input", "경륜");
  await navButton(desktop, "연계 아이디어").click();
  await desktop.waitForSelector(".idea-grid article");
  await desktop.locator(".idea-links li button").first().click(); // 아이디어 1(국민체력) 의 첫 데이터
  await desktop.waitForSelector(".profile");
  check("아이디어에서 데이터를 열면 목록에서도 그 데이터가 선택되어 보인다", (await desktop.locator(".dataset-list button.active").count()) === 1 && (await desktop.inputValue(".global-search input")) === "");
  await navButton(desktop, "연계 아이디어").click();
  await desktop.locator(".idea-show-all").first().click();
  await desktop.waitForSelector(".idea-filter-notice");
  await desktop.locator("button.brand").click();
  check("로고(데이터 탐색 홈)를 누르면 아이디어 필터가 풀린다", (await desktop.locator(".idea-filter-notice").count()) === 0);

  // 질문 검색(기본 검색: AI 호출 없음)
  await navButton(desktop, "질문 검색").click();
  await desktop.waitForSelector(".ask-form");
  await desktop.locator(".ask-examples button").first().click();
  await desktop.waitForSelector(".ask-list .ask-item");
  const askCount = await desktop.locator(".ask-list .ask-item").count();
  check("질문 검색: 예시 질문을 누르면 추천 데이터와 일치 이유가 나온다", askCount > 0 && (await desktop.locator(".ask-reason").first().innerText()).includes("낱말이 들어 있습니다"), `${askCount}건`);
  await desktop.fill("#ask-question", "오늘 날씨 어때");
  await desktop.getByRole("button", { name: "질문하기" }).click();
  await desktop.waitForSelector(".ask-result .metadata-empty");
  check("질문 검색: 데이터와 관계없는 질문에는 찾지 못했다고 알린다", (await desktop.locator(".ask-result .ask-item").count()) === 0);
  await desktop.fill("#ask-question", "연구 보고서");
  await desktop.press("#ask-question", "Control+Enter");
  await desktop.waitForSelector(".ask-list .ask-item");
  check("질문 검색: Ctrl+Enter 로도 질문할 수 있다", (await desktop.locator(".ask-list .ask-item").count()) > 0);
  check("질문 검색: AI 방식을 고르기 전에는 별도 AI 파일을 내려받지 않고 외부로 요청하지 않는다", !requestedUrls.some((url) => /\/chunks\//.test(url)) && requestedUrls.every((url) => url.startsWith(base)));

  // 관계도
  await navButton(desktop, "관계도").click();
  await desktop.waitForSelector(".graph-stage canvas");
  await desktop.waitForTimeout(1200);
  const stat = await desktop.locator(".graph-runtime-stat").innerText();
  check("관계도가 그려진다", /노드 \d+/.test(stat), stat.replace(/\s+/g, " "));
  const lit = await desktop.evaluate(() => {
    const canvas = document.querySelector(".graph-stage canvas");
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let i = 0; i < data.length; i += 4 * 97) if (data[i + 3] > 0 && !(data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240)) colored += 1;
    return colored;
  });
  check("관계도 캔버스에 노드가 보인다", lit > 20, `${lit}`);

  // 푸터
  const footer = await desktop.locator(".site-footer").innerText();
  check("푸터에 기준일·데이터 현황·오픈소스 고지가 있다", /기준일/.test(footer) && /수록 데이터/.test(footer) && /오픈소스 라이선스 고지/.test(footer));
  const notices = await desktop.request.get(`${base}/assets/THIRD_PARTY_NOTICES.txt`);
  check("오픈소스 고지 파일이 열린다", notices.ok());
  const fontOk = await desktop.evaluate(() => document.fonts.check('16px "Pretendard"'));
  check("웹폰트(Pretendard)가 선언되어 있다", fontOk);
  check("콘솔 오류·404 없음(데스크톱)", problems.filter((line) => line.startsWith("desktop")).length === 0, problems.filter((line) => line.startsWith("desktop")).join("; "));
  await desktop.close();

  // ---------------- 모바일 ----------------
  for (const width of [390, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ko-KR" });
    const mobile = await context.newPage();
    watch(mobile, `mobile${width}`);
    await mobile.goto(`${base}/`, { waitUntil: "networkidle" });
    await mobile.waitForSelector(".dataset-list button");
    const metrics = await mobile.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const nav = [...document.querySelectorAll(".main-nav button")].map((button) => {
        const rect = button.getBoundingClientRect();
        // 글자가 실제로 몇 줄로 배치됐는지: 글자 영역의 줄 위치(top) 종류를 센다
        const range = document.createRange();
        range.selectNodeContents(button);
        const lines = new Set([...range.getClientRects()].map((box) => Math.round(box.top))).size;
        return { text: button.innerText.trim(), right: rect.right, lines, clipped: button.scrollWidth > button.clientWidth + 1 };
      });
      const search = document.querySelector(".global-search button").getBoundingClientRect();
      const firstItem = document.querySelector(".dataset-list button").getBoundingClientRect();
      return { viewport, scrollWidth: document.documentElement.scrollWidth, nav, search: { width: search.width, height: search.height }, firstItemTop: firstItem.top };
    });
    check(`모바일 ${width}px: 가로 스크롤이 없다`, metrics.scrollWidth <= metrics.viewport + 1);
    check(`모바일 ${width}px: 주요 메뉴가 잘리거나 줄바꿈되지 않는다`, metrics.nav.every((item) => item.right <= metrics.viewport + 1 && !item.clipped && item.lines === 1), metrics.nav.map((item) => `${item.text}:${Math.round(item.right)}`).join(" "));
    check(`모바일 ${width}px: 검색 버튼 글자가 한 줄이다`, metrics.search.height < 60 && metrics.search.width >= 44, `${Math.round(metrics.search.width)}x${Math.round(metrics.search.height)}`);
    check(`모바일 ${width}px: 데이터 목록이 첫 화면(844px) 안에서 시작한다`, metrics.firstItemTop < 800, `top=${Math.round(metrics.firstItemTop)}px`);

    // 목록에서 데이터를 고르면 상세로 이동
    await mobile.locator(".dataset-list button").nth(3).click();
    await mobile.waitForTimeout(900);
    const profileTop = await mobile.evaluate(() => document.querySelector(".profile").getBoundingClientRect().top);
    check(`모바일 ${width}px: 데이터를 고르면 상세 영역으로 이동한다`, profileTop < 300, `profile top=${Math.round(profileTop)}px`);
    await navButton(mobile, "관계도").click();
    await mobile.waitForSelector(".zoom-controls");
    check(`모바일 ${width}px: 관계도에 확대·축소 버튼이 있다`, (await mobile.locator(".zoom-controls button").count()) === 2);
    check(`콘솔 오류·404 없음(모바일 ${width}px)`, problems.filter((line) => line.startsWith(`mobile${width}`)).length === 0, problems.filter((line) => line.startsWith(`mobile${width}`)).join("; "));
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
if (problems.length) console.log("참고(콘솔/네트워크):", problems);
process.exit(failed.length ? 1 : 0);
