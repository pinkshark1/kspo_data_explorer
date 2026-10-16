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

// UI 점검은 운영 AI 기본값과 분리해 기본 검색을 사용하며 실제 외부 서비스를 호출하지 않는다.
const prepareLocalUi = async (page) => {
  await page.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort("blockedbyclient"));
  await page.route("**/data/site.json", async (route) => {
    const response = await route.fetch();
    const site = await response.json();
    site.ai.defaultMode = "local";
    site.ai.gemini.shared = { url: "", turnstileSiteKey: "" };
    await route.fulfill({ response, json: site });
  });
};

try {
  // ---------------- 데스크톱 ----------------
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
  await prepareLocalUi(desktop);
  watch(desktop, "desktop");
  const requestedUrls = [];
  desktop.on("request", (request) => requestedUrls.push(request.url()));
  await desktop.goto(`${base}/`, { waitUntil: "networkidle" });
  await desktop.waitForSelector(".dataset-list button");

  const total = await desktop.locator(".dataset-list button").count();
  check("데이터셋 목록이 표시된다", total > 100, `${total}건`);

  check("키워드 검색에는 중복 실행 버튼 없이 즉시 필터 안내가 있다", await desktop.locator('.global-search button[type="submit"]').count() === 0 && (await desktop.locator("#home-search-help").innerText()).includes("아래 목록이 바로 좁혀집니다"));

  const cycleOptions = await desktop.locator(".filter-fields label").nth(3).locator("option").allInnerTexts();
  check("업데이트 주기 필터에 영문/한글 중복 표기가 없다", !cycleOptions.some((text) => /Yearly|Monthly|연간/.test(text)) && new Set(cycleOptions.map((text) => text.replace(/\s*\(\d+\)/, ""))).size === cycleOptions.length, cycleOptions.join(" / "));

  await desktop.fill(".global-search input", "체력");
  const selectedTitle = await desktop.locator(".dataset-list button.active b").innerText();
  check("검색어를 바꾸면 목록의 선택 항목과 상세 제목이 일치한다", (await desktop.locator(".profile-header h1").innerText()) === selectedTitle);
  await desktop.press(".global-search input", "Enter");
  await desktop.waitForTimeout(300);
  check("키워드 입력 후 Enter는 데이터 목록으로 초점을 옮긴다", await desktop.evaluate(() => document.activeElement?.id === "dataset-results-heading"));
  const fitnessCount = await desktop.locator(".dataset-list button").count();
  check("검색어 ‘체력’ 결과가 나온다", fitnessCount > 0, `${fitnessCount}건`);
  await desktop.fill(".global-search input", "zzzz없는단어");
  await desktop.waitForTimeout(200);
  check("검색 결과가 없으면 안내 문구가 나온다", (await desktop.locator(".empty-list").count()) === 1);
  check("검색 결과가 없으면 이전 데이터 상세와 원문 링크를 숨긴다", (await desktop.locator(".profile-header, .profile .request-button").count()) === 0);
  check("검색 결과가 없으면 검색어를 보여 주고 AI 질문 검색·지우기 버튼을 준다", (await desktop.locator(".empty-list").innerText()).includes("zzzz없는단어") && (await desktop.locator(".empty-list button").count()) === 2 && (await desktop.locator(".query-chip").count()) === 1);
  await desktop.locator(".empty-list button", { hasText: "지우기" }).click();
  check("‘조건·검색어 지우기’를 누르면 검색어까지 지워진다", (await desktop.inputValue(".global-search input")) === "" && (await desktop.locator(".dataset-list button").count()) > 100);
  await desktop.locator(".filter-fields select").nth(2).selectOption("API");
  check("데이터 유형을 바꾸면 조건에 맞는 상세가 바로 열린다", (await desktop.locator(".dataset-list button.active").count()) === 1 && (await desktop.locator(".profile-tabs button", { hasText: "API 기능" }).count()) === 1);
  await desktop.getByRole("button", { name: "조건 초기화", exact: true }).click();
  await desktop.locator(".dataset-list button").first().click();

  // 하나의 입력창으로 키워드 검색과 AI 질문 검색을 모두 시작한다.
  check("첫 화면의 검색 입력창은 하나다", (await desktop.locator('.global-search input, #home-question').count()) === 1 && (await desktop.locator('[role="search"]').count()) === 1);
  await desktop.fill(".global-search input", "체력");
  const beforeQuestionCount = await desktop.locator(".dataset-list button").count();
  await desktop.getByRole("radio", { name: "AI 질문 검색", exact: true }).check();
  await desktop.fill(".global-search input", "체육시설 안전 데이터");
  check("질문 작성 중에는 키워드 목록을 다시 필터링하지 않는다", await desktop.locator(".dataset-list button").count() === beforeQuestionCount && (await desktop.locator("#home-search-help").innerText()).includes("관련 데이터와 추천 이유"));
  await desktop.getByRole("radio", { name: "키워드로 찾기", exact: true }).check();
  check("방식을 전환해도 키워드와 질문 초안이 서로 섞이지 않는다", await desktop.inputValue(".global-search input") === "체력");
  await desktop.getByRole("radio", { name: "AI 질문 검색", exact: true }).check();
  check("질문 초안이 유지되고 추천 버튼의 용도가 명확하다", await desktop.inputValue(".global-search input") === "체육시설 안전 데이터" && await desktop.getByRole("button", { name: "추천받기", exact: true }).isVisible());
  await desktop.locator(".search-ask").click();
  await desktop.waitForSelector(".ask-list .ask-item");
  check("첫 화면에서 질문하면 AI 질문 검색 결과가 나오고 어떤 질문의 결과인지 보인다", (await desktop.inputValue("#ask-question")) === "체육시설 안전 데이터" && (await desktop.locator(".ask-asked").innerText()).includes("체육시설 안전 데이터"));
  check("AI 질문 검색 화면도 입력창 하나만 표시한다", (await desktop.locator('.global-search input, #ask-question').count()) === 1);
  await desktop.locator("button.brand").click();
  await desktop.waitForSelector(".dataset-list");
  check("질문 후 홈으로 돌아오면 기존 키워드 조건이 유지된다", await desktop.inputValue(".global-search input") === "체력" && await desktop.locator(".dataset-list button").count() === beforeQuestionCount);
  await desktop.getByRole("button", { name: "조건 초기화", exact: true }).click();
  await desktop.locator(".dataset-list button").first().click();
  check("파일 데이터 상세에는 빈 ‘API 기능’ 탭이 없다", (await desktop.locator(".profile-tabs button", { hasText: "API 기능" }).count()) === 0);

  // 데이터 정보 + 원문 버튼
  await desktop.locator(".dataset-list button").first().click();
  check("데이터 원문 버튼이 대상 포털을 함께 표시한다", /문화빅데이터포털|공공데이터포털/.test((await desktop.locator(".request-button, .request-button.secondary").first().innerText()) ?? ""));
  const withMeta = await desktop.locator(".dataset-list button", { hasText: "한국스포츠과학원 연구자료 정기간행물" }).first();
  await withMeta.click();
  const metaText = await desktop.locator(".meta-strip").innerText();
  check("‘데이터 정보’에 포털 수정일·이용허락범위가 표시된다", /포털 최종 수정일/.test(metaText) && /이용허락범위/.test(metaText), metaText.replace(/\s+/g, " ").slice(0, 80));

  await desktop.fill(".global-search input", "한국스포츠과학원 연구자료 정기간행물");
  await desktop.locator(".profile-tabs button", { hasText: "연관 데이터" }).click();
  const relatedName = await desktop.locator(".related-grid button b").first().innerText();
  await desktop.locator(".related-grid button").first().click();
  check("검색 조건 밖의 연관 데이터를 열어도 목록과 상세가 함께 바뀐다", (await desktop.inputValue(".global-search input")) === "" && (await desktop.locator(".profile-header h1").innerText()) === relatedName && (await desktop.locator(".dataset-list button.active b").innerText()) === relatedName);

  // 원문 주소가 없는 데이터: 지금은 모든 데이터에 주소가 있으므로, 시험용으로 #6 의 주소(payloads[1])를 지운 데이터 파일을 내려주고 대체 안내를 확인한다.
  const noUrl = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
  await prepareLocalUi(noUrl);
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

  // AI 질문 검색(기본 검색: AI 호출 없음)
  await navButton(desktop, "AI 질문 검색").click();
  await desktop.waitForSelector(".ask-form");
  await desktop.locator('input[value="local"]').check();
  await desktop.locator(".ask-examples button").first().click();
  await desktop.waitForSelector(".ask-list .ask-item");
  const askCount = await desktop.locator(".ask-list .ask-item").count();
  check("AI 질문 검색: 예시 질문을 누르면 추천 데이터와 일치 이유가 나온다", askCount > 0 && (await desktop.locator(".ask-reason").first().innerText()).includes("낱말이 들어 있습니다"), `${askCount}건`);
  await desktop.fill("#ask-question", "오늘 날씨 어때");
  await desktop.getByRole("button", { name: "질문하기" }).click();
  await desktop.waitForSelector(".ask-result .metadata-empty");
  check("AI 질문 검색: 데이터와 관계없는 질문에는 찾지 못했다고 알린다", (await desktop.locator(".ask-result .ask-item").count()) === 0);
  await desktop.fill("#ask-question", "연구 보고서");
  await desktop.press("#ask-question", "Control+Enter");
  await desktop.waitForSelector(".ask-list .ask-item");
  check("AI 질문 검색: Ctrl+Enter 로도 질문할 수 있다", (await desktop.locator(".ask-list .ask-item").count()) > 0);
  check("AI 질문 검색: AI 방식을 고르기 전에는 별도 AI 파일을 내려받지 않고 외부로 요청하지 않는다", !requestedUrls.some((url) => /\/chunks\//.test(url)) && requestedUrls.every((url) => url.startsWith(base)));

  // 관계도
  await navButton(desktop, "사용방법").click();
  check("다른 화면의 검색 버튼은 결과 보기로 목적을 알린다", await desktop.locator('.global-search button[type="submit"]').innerText() === "결과 보기");
  await desktop.locator(".global-search input").pressSequentially("체육시설");
  check("다른 메뉴에서도 검색어를 끝까지 입력할 수 있다", await desktop.inputValue(".global-search input") === "체육시설" && await desktop.locator(".guide-view").isVisible());
  await desktop.locator(".global-search input").press("Enter");
  check("검색을 제출하면 탐색 화면에 같은 검색어와 결과가 보인다", await desktop.inputValue(".global-search input") === "체육시설" && await desktop.locator(".dataset-list button").count() > 0);

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
    await prepareLocalUi(mobile);
    watch(mobile, `mobile${width}`);
    await mobile.goto(`${base}/`, { waitUntil: "networkidle" });
    await mobile.waitForSelector(".dataset-list button");
    check(`모바일 ${width}px: 검색 입력창은 하나다`, (await mobile.locator('.global-search input, #home-question').count()) === 1);
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
      const firstItem = document.querySelector(".dataset-list").getBoundingClientRect();
      return { viewport, scrollWidth: document.documentElement.scrollWidth, nav, firstItemTop: firstItem.top };
    });
    check(`모바일 ${width}px: 가로 스크롤이 없다`, metrics.scrollWidth <= metrics.viewport + 1);
    check(`모바일 ${width}px: 주요 메뉴가 잘리거나 줄바꿈되지 않는다`, metrics.nav.every((item) => item.right <= metrics.viewport + 1 && !item.clipped && item.lines === 1), metrics.nav.map((item) => `${item.text}:${Math.round(item.right)}`).join(" "));
    check(`모바일 ${width}px: 즉시 필터 안내가 보이고 중복 검색 버튼은 없다`, await mobile.locator("#home-search-help").isVisible() && await mobile.locator(".global-search button").count() === 0);
    check(`모바일 ${width}px: 데이터 목록이 첫 화면(844px) 안에서 시작한다`, metrics.firstItemTop < 800, `top=${Math.round(metrics.firstItemTop)}px`);

    // 접힌 상세 필터에서도 적용된 조건을 확인하고 해제할 수 있어야 한다.
    const filterToggle = mobile.getByRole("button", { name: /상세 필터/ });
    const canToggleFilters = await filterToggle.count() === 1;
    check(`모바일 ${width}px: 상세 필터를 펼치는 버튼이 있다`, canToggleFilters);
    if (canToggleFilters) {
      const deliveryFilter = mobile.getByRole("combobox", { name: "데이터 유형", includeHidden: true });
      check(`모바일 ${width}px: 처음에는 추가 조건이 접혀 있다`, !(await deliveryFilter.isVisible()));
      await filterToggle.click();
      await deliveryFilter.selectOption("API");
      await filterToggle.click();
      check(`모바일 ${width}px: 접어도 API 조건과 결과가 유지된다`, !(await deliveryFilter.isVisible()) && (await mobile.locator(".dataset-list button").count()) < total && await mobile.getByRole("button", { name: "데이터 유형 API 해제", exact: true }).isVisible());
      await mobile.getByRole("button", { name: "데이터 유형 API 해제", exact: true }).click();
      check(`모바일 ${width}px: 조건 태그를 해제하면 전체 목록으로 돌아온다`, (await mobile.locator(".dataset-list button").count()) === total && await deliveryFilter.inputValue() === "전체");
    }

    await mobile.getByRole("radio", { name: "AI 질문 검색", exact: true }).check();
    const recommendButton = await mobile.getByRole("button", { name: "추천받기", exact: true }).boundingBox();
    check(`모바일 ${width}px: 질문 모드의 버튼·안내가 화면 안에 표시된다`, recommendButton.height >= 44 && recommendButton.x + recommendButton.width <= width && await mobile.locator(".home-question-notice").isVisible() && await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    await mobile.fill(".global-search input", "체육시설 안전 데이터");
    await mobile.press(".global-search input", "Enter");
    await mobile.waitForSelector(".ask-list .ask-item");
    check(`모바일 ${width}px: 질문 모드에서는 Enter로 추천을 받는다`, await mobile.inputValue("#ask-question") === "체육시설 안전 데이터" && await mobile.locator(".global-search input, #ask-question").count() === 1);
    await mobile.locator("button.brand").click();
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
