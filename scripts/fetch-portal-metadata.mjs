// 공공데이터포털·문화빅데이터포털의 데이터 상세 페이지에서 "이용허락범위, 관리부서, 문의 전화, 수정일" 같은
// 공개 메타데이터를 읽어 data/portal-meta.json 으로 저장한다. (화면의 '데이터 정보' 영역에 표시)
//
//   npm run fetch:meta                # 전체 수집 (192건, 약 3~4분)
//   node scripts/fetch-portal-metadata.mjs 108 109   # 지정한 번호만 확인 (저장하지 않고 출력)
//
// - 각 포털 페이지를 1건씩 천천히(건당 0.4초 간격) GET 요청만 한다. 로그인·키·쿠키는 쓰지 않는다.
// - 포털 화면 구조가 바뀌면 값이 비어 나올 수 있으므로, 수집 후 `npm run check:data` 로 누락을 확인한다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCulturePublisher } from "./lib/culture-publisher.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// --data <폴더> 를 주면 그 폴더의 explorer-data.json 을 읽고 같은 폴더에 portal-meta.json 을 쓴다. (다른 기관 시험: examples/…/data)
const allArgs = process.argv.slice(2);
const dataArg = allArgs.indexOf("--data");
const dataDir = dataArg >= 0 ? path.resolve(root, allArgs[dataArg + 1] ?? "") : path.join(root, "data");
const dataFile = path.join(dataDir, "explorer-data.json");
const outFile = path.join(dataDir, "portal-meta.json");

// 그 밖의 인자는 데이터 번호(숫자)만 허용한다. (--help 같은 알 수 없는 옵션이 전체 수집·덮어쓰기로 이어지지 않게)
const args = dataArg >= 0 ? allArgs.filter((_, index) => index !== dataArg && index !== dataArg + 1) : allArgs;
const invalid = args.filter((arg) => !/^\d+$/.test(arg));
if (invalid.length || (dataArg >= 0 && !fs.existsSync(dataFile))) {
  console.error(`${invalid.length ? `알 수 없는 인자: ${invalid.join(" ")}` : `--data 폴더에 explorer-data.json 이 없습니다: ${dataDir}`}
사용법: npm run fetch:meta            (전체 수집 후 data/portal-meta.json 저장)
        node scripts/fetch-portal-metadata.mjs 108 109   (지정한 번호만 확인, 저장 안 함)
        node scripts/fetch-portal-metadata.mjs --data examples/korea-sports-council/data   (다른 데이터 폴더)`);
  process.exit(2);
}
const onlyNos = args.map(Number);
// 한국 시간 기준 날짜 (UTC 로 계산하면 오전 9시 이전에는 전날로 표시됨)
const todayKst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const MAX_FAILURE_RATE = 0.2;

const explorer = JSON.parse(fs.readFileSync(dataFile, "utf8"));
const [catalog, cultureColumns, , publicMeta] = explorer.payloads;

const textOf = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// 02-410-1674 / 031-123-4567 / 1566-0025 형태로 정리
function formatPhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (/^1\d{3}\d{4}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  const areaLength = digits.startsWith("02") ? 2 : 3;
  const area = digits.slice(0, areaLength);
  const rest = digits.slice(areaLength);
  if (rest.length < 7) return digits;
  const mid = rest.length - 4;
  return `${area}-${rest.slice(0, mid)}-${rest.slice(mid)}`;
}

// 공공데이터포털: <strong class="key">항목</strong><div class="value">값</div> 쌍. 같은 항목이 두 번 나오면 첫 번째가 해당 데이터의 값이다.
function parsePublicPortal(html) {
  const fields = {};
  const pairRe = /<strong class="key">([\s\S]*?)<\/strong>\s*<div class="value">([\s\S]*?)<\/div>\s*<\/li>/g;
  for (const match of html.matchAll(pairRe)) {
    const key = textOf(match[1]);
    if (key in fields) continue;
    let value = textOf(match[2]);
    if (key === "관리부서 전화번호") {
      // 파일 데이터는 telNo, OpenAPI 데이터는 apiTelNo 변수에 번호가 들어 있다.
      const script = /(?:telNo|apiTelNo)\s*=\s*"(\d*)"/.exec(match[2]);
      value = formatPhone(script ? script[1] : value);
    }
    fields[key] = value;
  }
  return {
    license: fields["이용허락범위"] || "",
    department: fields["관리부서명"] || "",
    phone: fields["관리부서 전화번호"] || "",
    modifiedAt: fields["수정일"] || "",
    registeredAt: fields["등록일"] || "",
    portalCycle: fields["업데이트 주기"] || "",
    nextRegistrationAt: fields["차기 등록 예정일"] || "",
    legalBasis: fields["보유근거"] || "",
    provision: fields["제공형태"] || "",
  };
}

// 문화빅데이터포털: 상세 상단의 유형·가격·갱신주기·업데이트 일자. (이용허락 항목은 없고 플랫폼 이용약관을 따른다)
function parseCulturePortal(html) {
  const visible = html.replace(/<!--[\s\S]*?-->/g, " ");
  const info = {};
  for (const match of visible.matchAll(/<dt>\s*<span>([\s\S]*?)<\/span>\s*<\/dt>\s*<dd>\s*<span>([\s\S]*?)<\/span>\s*<\/dd>/g)) {
    const key = textOf(match[1]);
    if (!(key in info)) info[key] = textOf(match[2]);
  }
  const updated = /<li class="update">\s*<span>\s*([\d.]+)\s*업데이트/.exec(visible);
  return {
    price: info["가격"] || "",
    portalCycle: info["데이터 갱신주기"] || "",
    modifiedAt: updated ? updated[1].replaceAll(".", "-") : "",
  };
}

async function fetchText(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KSPO-DataMap-metadata/1.0)", "Accept-Language": "ko-KR,ko;q=0.9" },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  return "";
}

const targets = catalog
  .filter((dataset) => !onlyNos.length || onlyNos.includes(dataset.no))
  .map((dataset) => {
    const key = String(dataset.no);
    const url = cultureColumns[key]?.sourceUrl || publicMeta[key]?.sourceUrl || dataset.url || "";
    const portal = dataset.ch.startsWith("공공데이터포털") ? "public" : "culture";
    return { dataset, url, portal };
  });

const items = {};
const failures = [];
const skipped = [];
const publishers = {}; // 문화빅데이터포털 제공기관 계정별 포털 보유 건수: { [기관 ID]: { name, portalCount } }
for (const [index, { dataset, url, portal }] of targets.entries()) {
  if (!url) {
    skipped.push(dataset.no);
    continue;
  }
  try {
    const html = await fetchText(url);
    const parsed = portal === "public" ? parsePublicPortal(html) : parseCulturePortal(html);
    const filled = Object.values(parsed).filter(Boolean).length;
    if (!filled) throw new Error("메타데이터 항목을 찾지 못했습니다(포털 화면 구조 변경 가능성)");
    items[dataset.no] = { portal, ...parsed };
    if (portal === "culture") {
      // 같은 서비스 데이터라도 다른 기관 계정으로 등록될 수 있어(예: 체육종합빅데이터센터) 기관별로 건수를 따로 센다.
      const publisher = parseCulturePublisher(html);
      if (publisher) {
        items[dataset.no].publisherId = publisher.id;
        publishers[publisher.id] = { name: publisher.name, portalCount: publisher.count };
      }
    }
    process.stdout.write(`\r[${index + 1}/${targets.length}] #${dataset.no} ok   `);
  } catch (error) {
    failures.push({ no: dataset.no, url, reason: String(error.message ?? error) });
    process.stdout.write(`\r[${index + 1}/${targets.length}] #${dataset.no} FAIL `);
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
}
console.log(`\n수집 ${Object.keys(items).length}건 / 실패 ${failures.length}건 / 원문 주소 없음 ${skipped.length}건`);
if (failures.length) console.log("실패:", failures.map((f) => `#${f.no} ${f.reason}`).join(" | "));

if (onlyNos.length) {
  console.log(JSON.stringify(items, null, 2));
} else {
  // 네트워크 오류 등으로 많이 실패했다면 기존 파일을 덮어쓰지 않는다.
  const attempted = targets.length - skipped.length;
  if (failures.length > attempted * MAX_FAILURE_RATE) {
    console.error(`실패가 ${failures.length}/${attempted}건(기준 ${MAX_FAILURE_RATE * 100}% 초과)이라 data/portal-meta.json 을 저장하지 않았습니다. 네트워크와 포털 화면 구조를 확인하세요.`);
    process.exit(1);
  }
  // 일부만 실패했다면 그 데이터는 이전에 수집한 값을 그대로 둔다.
  const previous = fs.existsSync(outFile) ? (JSON.parse(fs.readFileSync(outFile, "utf8")).items ?? {}) : {};
  const kept = [];
  for (const failure of failures) {
    if (previous[failure.no]) {
      items[failure.no] = previous[failure.no];
      kept.push(failure.no);
    }
  }
  if (kept.length) console.log(`실패한 ${kept.length}건은 이전 수집값을 유지했습니다: #${kept.join(", #")}`);
  // 이번에 한 번도 읽지 못한 제공기관은 이전 값을 유지한다.
  const previousPublishers = fs.existsSync(outFile) ? (JSON.parse(fs.readFileSync(outFile, "utf8")).culturePublishers ?? {}) : {};
  const document = {
    schemaVersion: 1,
    fetchedAt: todayKst(),
    note: "공공데이터포털·문화빅데이터포털 상세 페이지의 공개 정보를 수집한 값입니다. scripts/fetch-portal-metadata.mjs 로 갱신합니다.",
    culturePublishers: { ...previousPublishers, ...publishers },
    items,
    failures,
    withoutSourceUrl: skipped,
  };
  fs.writeFileSync(outFile, `${JSON.stringify(document, null, 1)}\n`);
  console.log(`저장: ${path.relative(root, outFile)}`);
}
