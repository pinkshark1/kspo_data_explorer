// 데이터 파일을 배포 전에 점검한다.   npm run check:data
//   - data/explorer-data.json : 구조, 번호 중복, 채널·주기 값, 컬럼·샘플·원문 주소 누락, 개인정보 의심 값
//   - data/site.json          : 아이디어에 연결된 데이터 번호가 실제로 있는지
//   - data/portal-meta.json   : 포털 메타데이터(이용허락범위 등) 수집 현황
//   --online 을 붙이면 포털에 등록된 공단 데이터 건수와 목록 건수를 비교한다. (문화빅데이터포털은 제공기관 계정별로 비교)
// 오류(ERROR)가 있으면 종료 코드 1, 경고(WARN)는 사람이 확인할 항목이다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isKnownCycle } from "../src/lib/catalog.js";
import { PAYLOAD } from "../src/lib/data.js";
import { parseCulturePublisher } from "./lib/culture-publisher.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// --data <폴더> 를 주면 그 폴더의 데이터 파일을 점검한다. (기본: data/, 다른 기관 시험: examples/…/data)
const dataArg = process.argv.indexOf("--data");
const dataDir = dataArg >= 0 ? path.resolve(root, process.argv[dataArg + 1] ?? "") : path.join(root, "data");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
if (dataArg >= 0) console.log(`점검 대상: ${path.relative(root, dataDir)}`);

const errors = [];
const warnings = [];
const info = [];

const explorer = readJson("explorer-data.json");
const site = readJson("site.json");
const portalMetaFile = path.join(dataDir, "portal-meta.json");
const portalMeta = fs.existsSync(portalMetaFile) ? readJson("portal-meta.json") : null;

// ---------- explorer-data.json ----------
const payloads = explorer.payloads;
if (!Array.isArray(payloads) || payloads.length !== Object.keys(PAYLOAD).length) {
  errors.push(`payloads 는 ${Object.keys(PAYLOAD).length}개 배열이어야 합니다.`);
}
const catalog = payloads?.[PAYLOAD.catalog] ?? [];
const KNOWN_CHANNELS = ["문화빅데이터포털(파일)", "공공데이터포털(파일)", "공공데이터포털(API)"];
const REQUIRED = ["no", "ch", "field", "name", "ptype", "status", "cycle", "desc", "sys"];
const seen = new Set();
for (const dataset of catalog) {
  for (const key of REQUIRED) {
    if (dataset[key] === undefined || dataset[key] === null) errors.push(`#${dataset.no} 필수 항목 ${key} 이(가) 없습니다.`);
    else if (["ch", "field", "name", "sys"].includes(key) && !String(dataset[key]).trim()) errors.push(`#${dataset.no} ${key} 이(가) 비어 있습니다.`);
  }
  if (seen.has(dataset.no)) errors.push(`데이터 번호 #${dataset.no} 이(가) 중복되었습니다.`);
  seen.add(dataset.no);
  if (!KNOWN_CHANNELS.includes(dataset.ch)) errors.push(`#${dataset.no} 알 수 없는 채널(ch): ${dataset.ch}`);
}
info.push(`데이터셋 ${catalog.length}건`);

// 문화빅데이터포털 데이터를 제공기관 계정별로 묶는다. (기관 ID 는 data/portal-meta.json 의 publisherId, 없으면 "")
const cultureGroups = new Map();
for (const dataset of catalog.filter((item) => item.ch.startsWith("문화"))) {
  const id = portalMeta?.items?.[dataset.no]?.publisherId ?? "";
  cultureGroups.set(id, [...(cultureGroups.get(id) ?? []), dataset.no]);
}

const rawCycles = [...new Set(catalog.map((dataset) => dataset.cycle))];
const unknownCycles = rawCycles.filter((cycle) => !isKnownCycle(cycle));
if (unknownCycles.length) warnings.push(`업데이트 주기 표기를 정리하지 못한 값: ${unknownCycles.join(", ")} (src/lib/catalog.js 의 CYCLE_GROUPS 에 추가)`);

for (const index of [PAYLOAD.cultureColumns, PAYLOAD.cultureSamples, PAYLOAD.publicMeta, PAYLOAD.publicSamples, PAYLOAD.apiSamples]) {
  const orphan = Object.keys(payloads[index]).filter((no) => !seen.has(Number(no)));
  // 다른 데이터에 통합했다고 기록된 정의서(integratedIntoRecordNo)는 의도된 것이라 경고하지 않는다.
  const merged = orphan.filter((no) => payloads[index][no]?.integratedIntoRecordNo);
  const stray = orphan.filter((no) => !merged.includes(no));
  if (stray.length) warnings.push(`payloads[${index}] 에 목록에 없는 번호가 있습니다: ${stray.join(", ")}`);
  if (merged.length) info.push(`payloads[${index}] 에서 다른 데이터에 통합된 번호 ${merged.length}건: ${merged.map((no) => `${no}→#${payloads[index][no].integratedIntoRecordNo}`).join(", ")}`);
}

// 누락 현황: 컬럼 정의 / 샘플 / 원문 주소
const missing = { columns: [], sample: [], url: [] };
const noPortalDefinition = []; // 포털에도 컬럼정의서가 없음을 확인해 두 문화 데이터
for (const dataset of catalog) {
  const key = String(dataset.no);
  const meta = payloads[PAYLOAD.cultureColumns][key] ?? payloads[PAYLOAD.publicMeta][key];
  // payloads[1] 에 원문 주소는 있고 columns 가 비어 있으면, 포털이 컬럼정의서를 제공하지 않는다고 확인한 데이터로 본다.
  if (!meta?.columns?.length) (payloads[PAYLOAD.cultureColumns][key]?.sourceUrl ? noPortalDefinition : missing.columns).push(dataset.no);
  const csv = payloads[PAYLOAD.publicSamples][key] ?? payloads[PAYLOAD.cultureSamples][key];
  const api = payloads[PAYLOAD.apiSamples][key] ?? [];
  if (!(csv?.rows?.length || api.some((operation) => operation.rows?.length))) missing.sample.push(dataset.no);
  if (!(meta?.sourceUrl || dataset.url)) missing.url.push(dataset.no);
}
for (const [label, list] of [["컬럼 정의 없음", missing.columns], ["샘플 없음", missing.sample], ["원문 주소 없음", missing.url]]) {
  if (list.length) warnings.push(`${label} ${list.length}건: #${list.join(", #")}`);
}
if (noPortalDefinition.length) info.push(`포털에도 컬럼정의서가 없어 ‘정의서 미제공’으로 표시하는 문화 데이터 ${noPortalDefinition.length}건: #${noPortalDefinition.join(", #")}`);

// 개인정보 의심 1) 사람 이름·작성자 컬럼에 마스킹(○, **)되지 않은 값이 있으면 오류
//             2) 자유서술 컬럼, 전화번호·이메일 모양의 값은 사람이 확인해야 하므로 경고
const PERSON_COLUMN = /(PLAYER_NM|WRTER_NM|NM_KOR|MBER_NM|USER_NM|CHRG_NM|RPRSNTV_NM|RPRSNT_NM|LCTRR_NM|RACER_NM|MOT_BF_RACER_\d+_NO|선수명|성명|작성자|대표자)/i;
// 소장품 작가·도서 저자처럼 공개된 저작물 정보의 이름은 오류가 아니라 사람이 확인할 경고로 둔다.
const AUTHOR_COLUMN = /(WRITR_NM|ARTIST|저자|작가)/i;
const FREE_TEXT_COLUMN = /(DETAIL_DC_CN|TRAING_STATE_CN|INTERVIEW|면담)/i;
const PHONE_LIKE = /\b0\d{1,2}-\d{3,4}-\d{4}\b/;
const EMAIL_LIKE = /[\w.+-]+@[\w-]+\.[\w.]+/;
// 휴대전화(01X) 번호는 개인 번호일 수 있다. 샘플에는 끝 4자리를 ○ 로 가려 두며, 가리지 않은 값이 있으면 경고한다.
const MOBILE_LIKE = /\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/;
const MASKED = /○|\*{2,}|마스킹/;
const freeText = [];
const authorNames = [];
const contactLike = [];
const mobileLike = [];
// 샘플은 세 곳에 있다: 문화 CSV(payloads[2]), 공공 CSV(payloads[4]), 공공 OpenAPI 응답(payloads[5], 상세 기능별 배열)
const sampleEntries = [];
for (const index of [PAYLOAD.cultureSamples, PAYLOAD.publicSamples]) {
  for (const [no, entry] of Object.entries(payloads[index])) sampleEntries.push({ no, entry, label: `#${no}` });
}
for (const [no, operations] of Object.entries(payloads[PAYLOAD.apiSamples])) {
  for (const entry of operations) sampleEntries.push({ no, entry, label: `#${no}(${entry.operationName})` });
}
for (const { entry, label } of sampleEntries) {
  (entry.columns ?? []).forEach((column, columnIndex) => {
    const name = column.name ?? column;
    const values = (entry.rows ?? []).map((row) => row[columnIndex]).filter((value) => String(value ?? "").trim());
    if (PERSON_COLUMN.test(name)) {
      const unmasked = values.filter((value) => !MASKED.test(String(value)));
      if (unmasked.length) errors.push(`${label} ${name}: 마스킹되지 않은 값 ${unmasked.length}건 (scripts/mask-sample-data.mjs 의 RULES 에 추가)`);
    } else if (AUTHOR_COLUMN.test(name) && values.length) {
      authorNames.push(`${label} ${name}`);
    } else if (FREE_TEXT_COLUMN.test(name) && values.length) {
      freeText.push(`${label} ${name}`);
    }
    if (values.some((value) => PHONE_LIKE.test(String(value)) || EMAIL_LIKE.test(String(value)))) contactLike.push(`${label} ${name}`);
    if (values.some((value) => MOBILE_LIKE.test(String(value)))) mobileLike.push(`${label} ${name}`);
  });
}
if (mobileLike.length) warnings.push(`가리지 않은 휴대전화(01X) 번호 모양의 값이 샘플에 있습니다. 개인 번호인지 확인하세요: ${[...new Set(mobileLike)].join(", ")}`);
// 자유서술 컬럼은 본문 속 실명·사생활 언급이 있는지 사람이 읽고 확인해야 한다. 아래는 담당자 검토를 마친 컬럼이다.
//  - #8 경륜 명예심판 후기: 직원·아나운서·선수 실명과 풍자·사생활 문장을 scripts/mask-sample-data.mjs 로 마스킹함 (본문 규칙은 실명이 들어가는 로컬 파일 mask-text-rules.local.json)
//  - #31 경정출주선수 면담: 포털 원본이 이미 ‘[민감정보 마스킹]’ 이거나 빈 값
//  - #44 소마미술관 교육프로그램: 공개된 행사 안내문(강사·작가 이름 포함)이라 그대로 둠
const REVIEWED_FREE_TEXT = new Set(["#8 DETAIL_DC_CN", "#31 TRAING_STATE_CN", "#44 DETAIL_DC_CN"]);
const freeTextPending = [...new Set(freeText)].filter((item) => !REVIEWED_FREE_TEXT.has(item));
const freeTextReviewed = [...new Set(freeText)].filter((item) => REVIEWED_FREE_TEXT.has(item));
if (freeTextPending.length) warnings.push(`자유서술 컬럼은 개인정보·실명 포함 여부를 사람이 확인해야 합니다: ${freeTextPending.join(", ")}`);
if (freeTextReviewed.length) info.push(`검토 완료(실명·풍자 문구 마스킹 또는 공개 안내문으로 유지) 자유서술 컬럼 ${freeTextReviewed.length}곳: ${freeTextReviewed.join(", ")}`);
// 담당자 검토 결과(2026-10-01): 소장품 작가·도서 저자명, 시설·업체 연락처는 포털에 이미 공개된 정보라 샘플에 그대로 둔다.
// 새 데이터가 이 범주에 들어오면 같은 안내가 나오므로, 공개 정보가 맞는지 다시 확인한다.
if (authorNames.length) info.push(`검토 완료(공개 저작물 정보로 유지) 저자·작가 이름 컬럼 ${new Set(authorNames).size}곳`);
if (contactLike.length) info.push(`검토 완료(공개된 시설·업체 연락처로 유지) 전화번호 모양 값이 있는 컬럼 ${new Set(contactLike).size}곳`);

// ---------- site.json ----------
for (const key of ["organization", "service", "portals", "ideas"]) {
  if (!site[key]) errors.push(`site.json 에 ${key} 항목이 없습니다.`);
}
// 사용방법(guide)은 선택 항목이다. 없으면 화면 메뉴에서 빠진다. (src/components/SiteHeader.jsx)
if (!site.guide) info.push("사용방법(guide) 없음 - ‘사용방법’ 메뉴를 보여주지 않습니다.");
(site.ideas ?? []).forEach((idea, index) => {
  const unknown = (idea.datasetNos ?? []).filter((no) => !seen.has(no));
  if (unknown.length) errors.push(`아이디어 ${index + 1}(${idea.field}): 목록에 없는 데이터 번호 ${unknown.join(", ")}`);
  if (!idea.datasetNos?.length) warnings.push(`아이디어 ${index + 1}(${idea.field}) 에 연결된 데이터(datasetNos)가 없습니다.`);
});
info.push(`연계 아이디어 ${site.ideas?.length ?? 0}건`);

// 질문 검색(site.ai) 설정
if (site.ai?.enabled) {
  const ai = site.ai;
  const modes = ai.modes ?? [];
  for (const mode of modes) if (!["local", "gemini", "gateway"].includes(mode)) errors.push(`site.json ai.modes 에 알 수 없는 방식이 있습니다: ${mode}`);
  if (modes.includes("gemini") && !(ai.gemini?.model && ai.gemini?.maxTokens)) errors.push("site.json ai.gemini 에 model, maxTokens 가 필요합니다.");
  if (ai.gemini?.models) {
    const list = ai.gemini.models;
    if (!Array.isArray(list) || !list.length || list.some((entry) => !entry?.model || !entry?.label)) errors.push("site.json ai.gemini.models 는 model 과 label 이 있는 항목의 목록이어야 합니다.");
    else {
      if (new Set(list.map((entry) => entry.model)).size !== list.length) errors.push("site.json ai.gemini.models 에 같은 model 이 두 번 있습니다.");
      if (!list.some((entry) => entry.model === ai.gemini.model)) errors.push(`site.json ai.gemini.model(${ai.gemini.model}) 이 ai.gemini.models 에 없습니다.`);
    }
  }
  if (modes.includes("gateway")) {
    if (!/^https:\/\//.test(ai.gateway?.url ?? "") && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(ai.gateway?.url ?? "")) {
      errors.push("site.json ai.gateway.url 은 https:// 주소여야 합니다(개발용 localhost 제외).");
    }
  }
  if (ai.defaultMode && !modes.concat("local").includes(ai.defaultMode)) errors.push(`site.json ai.defaultMode(${ai.defaultMode}) 가 ai.modes 에 없습니다.`);
  info.push(`질문 검색 방식: ${["local", ...modes.filter((mode) => mode !== "local")].join(", ")} (기본 ${ai.defaultMode ?? "local"})`);
  if (JSON.stringify(site).match(/sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}/)) errors.push("site.json 에 API 키로 보이는 값이 있습니다. 키는 소스·데이터 파일에 넣지 않습니다.");
}

// ---------- portal-meta.json ----------
if (!portalMeta) {
  warnings.push("data/portal-meta.json 이 없습니다. (npm run fetch:meta) 화면의 ‘데이터 정보’가 표시되지 않습니다.");
} else {
  const items = portalMeta.items ?? {};
  const noMeta = catalog.filter((dataset) => !items[dataset.no]).map((dataset) => dataset.no);
  const noLicense = catalog.filter((dataset) => dataset.ch.startsWith("공공데이터포털") && !items[dataset.no]?.license).map((dataset) => dataset.no);
  info.push(`포털 메타데이터 ${Object.keys(items).length}건 수집 (확인일 ${portalMeta.fetchedAt})`);
  if (noMeta.length) warnings.push(`포털 메타데이터가 없는 데이터 ${noMeta.length}건: #${noMeta.join(", #")}`);
  if (noLicense.length) warnings.push(`공공데이터포털 데이터 중 이용허락범위가 비어 있는 ${noLicense.length}건: #${noLicense.join(", #")}`);
  // 문화빅데이터포털은 제공기관 계정별로 보유 건수를 센다. 같은 서비스 데이터가 다른 기관 계정으로 등록될 수 있어(예: 체육종합빅데이터센터) 계정별로 비교한다.
  const publishers = portalMeta.culturePublishers ?? {};
  for (const [id, nos] of cultureGroups) {
    if (!id) warnings.push(`제공기관 계정을 확인하지 못한 문화 데이터 ${nos.length}건: #${nos.join(", #")} (npm run fetch:meta 로 다시 수집)`);
    else if (!publishers[id]) warnings.push(`문화빅데이터포털 제공기관 ${id} 의 보유 건수가 수집되지 않았습니다. (npm run fetch:meta)`);
    else if (publishers[id].portalCount !== nos.length) warnings.push(`문화빅데이터포털 ${publishers[id].name} 계정: 수집 시점 포털 ${publishers[id].portalCount}건 ≠ 목록 ${nos.length}건 -> 목록 갱신 필요 여부를 확인하세요.`);
    else info.push(`문화빅데이터포털 ${publishers[id].name} 계정 ${nos.length}건 = 수집 시점 포털 보유 건수`);
  }
}

// ---------- 포털 등록 건수와 비교 (선택: npm run check:data -- --online) ----------
// 포털에 새로 등록·삭제된 데이터가 있는지 건수로 확인한다. (건수가 다르면 목록 갱신이 필요하다는 뜻)
if (process.argv.includes("--online")) {
  const textOf = (html) => html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const get = async (url) => (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; KSPO-DataMap-check/1.0)" }, signal: AbortSignal.timeout(30000) })).text();
  const publicInCatalog = catalog.filter((dataset) => dataset.ch.startsWith("공공데이터포털")).length;
  try {
    const listing = textOf(await get(site.portals.public.listUrl));
    const publicOnPortal = Number(/현재\s*([\d,]+)\s*건의 데이터가 있습니다/.exec(listing)?.[1]?.replace(/,/g, ""));
    if (!publicOnPortal) warnings.push("공공데이터포털 등록 건수를 읽지 못했습니다(화면 구조 변경 가능성).");
    else if (publicOnPortal !== publicInCatalog) warnings.push(`공공데이터포털 등록 ${publicOnPortal}건 ≠ 목록 ${publicInCatalog}건 -> 목록 갱신 필요 여부를 확인하세요.`);
    else info.push(`공공데이터포털 등록 ${publicOnPortal}건 = 목록 ${publicInCatalog}건`);
  } catch (error) {
    warnings.push(`공공데이터포털 건수 확인 실패: ${error.message}`);
  }
  // 문화빅데이터포털: 제공기관 계정마다 한 건의 상세 페이지를 읽어 그 계정의 보유 건수와 목록의 해당 계정 건수를 비교한다.
  for (const [id, nos] of cultureGroups) {
    if (!id) continue; // 계정을 모르는 데이터는 위(포털 메타데이터)에서 이미 경고한다.
    try {
      const url = payloads[PAYLOAD.cultureColumns][String(nos[0])]?.sourceUrl;
      const publisher = url ? parseCulturePublisher(await get(url)) : null;
      if (!publisher) warnings.push(`문화빅데이터포털 제공기관 ${id} 의 등록 건수를 읽지 못했습니다(화면 구조 변경 가능성, 기준 데이터 #${nos[0]}).`);
      else if (publisher.count !== nos.length) warnings.push(`문화빅데이터포털 ${publisher.name} 계정: 등록 ${publisher.count}건 ≠ 목록 ${nos.length}건 -> 목록 갱신 필요 여부를 확인하세요.`);
      else info.push(`문화빅데이터포털 ${publisher.name} 계정: 등록 ${publisher.count}건 = 목록 ${nos.length}건`);
    } catch (error) {
      warnings.push(`문화빅데이터포털 제공기관 ${id} 건수 확인 실패: ${error.message}`);
    }
  }
}

// ---------- 결과 ----------
console.log(info.map((line) => `INFO  ${line}`).join("\n"));
warnings.forEach((line) => console.log(`WARN  ${line}`));
errors.forEach((line) => console.log(`ERROR ${line}`));
console.log(`\n오류 ${errors.length}건, 경고 ${warnings.length}건`);
process.exit(errors.length ? 1 : 0);
