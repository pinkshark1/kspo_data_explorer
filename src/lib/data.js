// data/explorer-data.json · data/site.json 을 읽어 앱에서 쓰는 형태로 만든다.
// 파일 구조는 docs/DATA_SCHEMA.md 에 설명되어 있다.

// explorer-data.json 의 payloads 배열 위치. (배열 순서를 바꾸면 이 표도 함께 바꾼다.)
export const PAYLOAD = {
  catalog: 0, // 데이터셋 목록 (배열)
  cultureColumns: 1, // 문화빅데이터포털 컬럼정의서   { [번호]: { columns, sourceUrl, ... } }
  cultureSamples: 2, // 문화빅데이터포털 CSV 샘플      { [번호]: { columns, rows, totalRows } }
  publicMeta: 3, // 공공데이터포털 컬럼·오퍼레이션       { [번호]: { columns, operations, sourceUrl, ... } }
  publicSamples: 4, // 공공데이터포털 파일 CSV 샘플      { [번호]: { columns, rows, totalRows } }
  apiSamples: 5, // 공공데이터포털 OpenAPI 응답 샘플     { [번호]: [ { path, operationName, columns, rows, totalCount } ] }
};
const PAYLOAD_COUNT = Object.keys(PAYLOAD).length;

async function fetchJson(relativePath, label) {
  const response = await fetch(new URL(relativePath, import.meta.url), {
    credentials: "same-origin",
    cache: "no-cache",
  });
  if (!response.ok) {
    throw new Error(`${label} 파일을 불러오지 못했습니다. (HTTP ${response.status})`);
  }
  return response.json();
}

// 포털 메타데이터(이용허락범위·담당부서 등)는 없어도 화면이 동작하도록 선택 항목으로 읽는다.
async function fetchOptionalJson(relativePath, label) {
  try {
    return await fetchJson(relativePath, label);
  } catch (error) {
    console.warn(error);
    return null;
  }
}

// site.json 에서 화면이 꼭 필요로 하는 항목이 빠졌으면, 빈 화면 대신 무엇이 빠졌는지 알려준다.
function assertSiteConfig(site) {
  const missing = [];
  const need = (path, value) => {
    if (!value) missing.push(path);
  };
  need("organization.name", site?.organization?.name);
  need("organization.shortName", site?.organization?.shortName);
  need("service.name", site?.service?.name);
  need("service.fullName", site?.service?.fullName);
  need("service.bannerText", site?.service?.bannerText);
  need("service.scope", site?.service?.scope);
  for (const key of ["public", "culture"]) {
    for (const field of ["label", "shortLabel", "mark", "listUrl"]) need(`portals.${key}.${field}`, site?.portals?.[key]?.[field]);
  }
  if (!Array.isArray(site?.ideas)) missing.push("ideas (배열)");
  if (site?.guide && !Array.isArray(site.guide.steps)) missing.push("guide.steps (배열)");
  if (missing.length) throw new Error(`data/site.json 에 필요한 항목이 없습니다: ${missing.join(", ")}`);
}

export async function loadAppData() {
  const [explorer, site, portalMeta] = await Promise.all([
    fetchJson("../data/explorer-data.json", "데이터"),
    fetchJson("../data/site.json", "설정"),
    fetchOptionalJson("../data/portal-meta.json", "포털 메타데이터"),
  ]);

  assertSiteConfig(site);

  // 저장된 AI 추천 예시(키 없이 보여 줄 실제 응답). site.json 의 ai.examplesFile 이 있을 때만 읽는다. (없거나 못 읽어도 화면은 동작)
  const aiExamples = site.ai?.examplesFile ? await fetchOptionalJson(`../data/${site.ai.examplesFile}`, "AI 추천 예시") : null;

  const payloads = explorer?.payloads;
  if (!Array.isArray(payloads) || payloads.length !== PAYLOAD_COUNT || !Array.isArray(payloads[PAYLOAD.catalog])) {
    throw new Error("데이터 파일 형식이 올바르지 않습니다.");
  }

  return {
    site,
    generatedAt: explorer.generatedAt ?? "",
    portalMeta: portalMeta?.items ?? {},
    portalMetaFetchedAt: portalMeta?.fetchedAt ?? "",
    datasets: payloads[PAYLOAD.catalog],
    cultureColumns: payloads[PAYLOAD.cultureColumns],
    cultureSamples: payloads[PAYLOAD.cultureSamples],
    publicMeta: payloads[PAYLOAD.publicMeta],
    publicSamples: payloads[PAYLOAD.publicSamples],
    apiSamples: payloads[PAYLOAD.apiSamples],
    aiExamples: Array.isArray(aiExamples?.examples) ? aiExamples : null,
  };
}
