// 이식 시험: 공공데이터포털에 공개된 ‘대한체육회’ 데이터 목록으로 데이터 지도용 explorer-data.json 을 만든다.
//   node examples/korea-sports-council/collect.mjs
// 공공데이터포털의 데이터 목록 화면(제공기관 = 대한체육회)과 각 데이터 상세 페이지의 공개 정보만 읽는다.
//   목록: 제목·설명 요약·형식·수정일·키워드·원문 주소 / 상세: 분류체계·업데이트 주기·관리부서명·설명 전문·데이터 항목(컬럼) 정보
// 포털에 없는 값은 지어내지 않는다. 데이터 지도의 ‘출처 시스템(sys)’은 컬럼 정보의 ‘생성출처 - 정보시스템명’이 한 가지로 적혀 있으면
// 그 값을, 없으면 포털의 ‘관리부서명’으로 대신 묶는다. (이때 관계도의 ‘정보시스템’ 자리에 관리부서가 나온다. 실제로 이식할 때는 기관이 출처 시스템을 정해 넣는다)
// 샘플 행은 수집하지 않는다. 선수 성명 등 개인정보가 들어 있는 파일이 있어, 넣으려면 scripts/mask-sample-data.mjs 로 가린 뒤 담당자가 확인해야 한다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ORG = "대한체육회";
const BASE = "https://www.data.go.kr";
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

const decode = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

async function fetchList(dType, page) {
  const url = `${BASE}/tcs/dss/selectDataSetList.do?dType=${dType}&keyword=&orgNm=${encodeURIComponent(ORG)}&conditionType=search&perPage=40&currentPage=${page}`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (KSPO data map adapt test)" } });
  if (!response.ok) throw new Error(`목록을 불러오지 못했습니다 (${dType} ${page}쪽, HTTP ${response.status})`);
  return response.text();
}

function parseItems(html) {
  return html
    .split('<div class="apply-result-item">')
    .slice(1)
    .map((chunk) => {
      const link = chunk.match(/<a href="\/data\/(\d+)\/(fileData|openapi)\.do">([\s\S]*?)<\/a>/);
      if (!link) return null;
      const badges = [...chunk.matchAll(/<span class="krds-badge small bg-light-secondary">([^<]+)<\/span>/g)].map((m) => decode(m[1]));
      const formats = [...chunk.matchAll(/data-ext="([^"]+)"/g)].map((m) => m[1]);
      const li = (label) => decode(chunk.match(new RegExp(`<strong>${label}</strong>([\\s\\S]*?)</li>`))?.[1] ?? "");
      return {
        id: link[1],
        kind: link[2] === "openapi" ? "API" : "FILE",
        title: decode(link[3]),
        summary: decode(chunk.match(/<span class="apply-result-summary">([\s\S]*?)<\/span>/)?.[1] ?? ""),
        category: badges[0] ?? "",
        formats,
        provider: li("제공기관"),
        modifiedAt: li("수정일"),
        keywords: li("키워드"),
      };
    })
    .filter(Boolean);
}

const found = new Map();
for (const dType of ["FILE", "API"]) {
  for (let page = 1; page <= 10; page += 1) {
    // 마지막 쪽 판단은 거르기 전 건수로 한다 (다른 기관·유형이 섞인 쪽에서 일찍 멈추지 않게)
    const listed = parseItems(await fetchList(dType, page));
    const items = listed.filter((item) => item.kind === dType && item.provider === ORG);
    const fresh = items.filter((item) => !found.has(item.id));
    fresh.forEach((item) => found.set(item.id, item));
    if (listed.length < 40 || (items.length && !fresh.length)) break; // 마지막 쪽이거나 같은 쪽이 되풀이됨
  }
}
if (!found.size) throw new Error("데이터를 찾지 못했습니다. 포털 화면 구조가 바뀌었을 수 있습니다.");

// 상세 페이지의 ‘항목 = 값’ 쌍 (공공데이터포털: <th class="key">항목</th><td class="value">값</td> 형태)
async function fetchDetail(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (KSPO data map adapt test)" } });
  if (!response.ok) throw new Error(`상세 페이지를 불러오지 못했습니다 (HTTP ${response.status}): ${url}`);
  const html = await response.text();
  const fields = {};
  for (const m of html.matchAll(/<(?:th|strong)[^>]*class="[^"]*key[^"]*"[^>]*>\s*([^<]+?)\s*<\/(?:th|strong)>\s*<(?:td|div)[^>]*class="[^"]*value[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div)>/g)) {
    const key = decode(m[1]);
    if (!(key in fields)) fields[key] = decode(m[2].replace(/<script[\s\S]*?<\/script>/g, " "));
  }
  return { fields, columns: parseColumns(html) };
}

// ‘데이터 항목(컬럼) 정보’ 표: 항목명 | 항목명(영문명) | 항목 설명 | 도메인분류 | 데이터타입 | 최대길이 | 표현방식 | 단위 | 정보시스템명 | DB명 | Table명 | 코드
// 화면의 컬럼 사전은 ‘컬럼명 / 한글명’이므로 영문명이 있으면 컬럼명, 항목명을 한글명으로 쓴다. (KSPO 공공데이터포털 데이터와 같은 형태)
function parseColumns(html) {
  const box = html.split('<div class="data-column-box">')[1]?.split("</table>")[0] ?? "";
  const body = box.split("<tbody>")[1] ?? "";
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((row) => [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decode(cell[1])))
    .filter((cells) => cells.length >= 9 && cells[0])
    .map((cells) => ({ name: cells[1] || cells[0], label: cells[0], system: cells[8] }));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const items = [...found.values()].sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title, "ko") : a.kind === "FILE" ? -1 : 1));
const catalog = [];
const publicMeta = {};
for (const [index, item] of items.entries()) {
  const no = index + 1;
  const sourceUrl = `${BASE}/data/${item.id}/${item.kind === "API" ? "openapi" : "fileData"}.do`;
  const { fields: detail, columns } = await fetchDetail(sourceUrl);
  const systems = [...new Set(columns.map((column) => column.system).filter((value) => value && value !== "-"))];
  await sleep(400); // 포털에 부담을 주지 않도록 천천히
  const [upper, lower] = String(detail["분류체계"] ?? "").split(/\s*-\s*/);
  catalog.push({
    no,
    ch: item.kind === "API" ? "공공데이터포털(API)" : "공공데이터포털(파일)",
    field: upper && lower ? `${upper}>${lower}` : upper || item.category || "미분류",
    name: item.title,
    ptype: item.kind === "API" ? "오픈API" : `파일데이터${item.formats.length ? `(${item.formats.join("·")})` : ""}`,
    status: "개방",
    cycle: detail["업데이트 주기"] || "비주기",
    desc: detail["설명"] || item.summary,
    kw: item.keywords,
    url: sourceUrl,
    sys: systems.length === 1 ? systems[0] : detail["관리부서명"] || "관리부서 미기재",
  });
  // 포털에 컬럼 정보가 없으면 비워 둔다(화면이 ‘미제공’으로 안내한다). 샘플은 수집하지 않는다(맨 위 설명).
  publicMeta[no] = {
    datasetName: item.title,
    sourceUrl,
    portalType: item.kind === "API" ? "API" : "파일",
    columns: columns.map(({ name, label }) => ({ name, label })),
    operations: [],
  };
}

const explorer = {
  schemaVersion: 1,
  generatedAt: todayKst(),
  source: `공공데이터포털 데이터 목록(제공기관: ${ORG}) - examples/korea-sports-council/collect.mjs 로 수집`,
  payloads: [catalog, {}, {}, publicMeta, {}, {}],
};
fs.mkdirSync(path.join(here, "data"), { recursive: true });
fs.writeFileSync(path.join(here, "data", "explorer-data.json"), `${JSON.stringify(explorer, null, 2)}\n`);
const files = catalog.filter((d) => d.ch.endsWith("(파일)")).length;
console.log(`${ORG}: ${catalog.length}건 (파일 ${files} · API ${catalog.length - files}) → examples/korea-sports-council/data/explorer-data.json`);
console.log(`분류: ${[...new Set(catalog.map((d) => d.field))].join(", ")}`);
console.log(`관리부서(출처 시스템 자리): ${[...new Set(catalog.map((d) => d.sys))].join(", ")}`);
console.log(`업데이트 주기: ${[...new Set(catalog.map((d) => d.cycle))].join(", ")}`);
const withColumns = Object.values(publicMeta).filter((meta) => meta.columns.length);
console.log(`컬럼 정보: ${withColumns.length}건 (컬럼 ${withColumns.reduce((sum, meta) => sum + meta.columns.length, 0)}개)`);
