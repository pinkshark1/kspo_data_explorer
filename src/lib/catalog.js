// 데이터셋 목록을 다루는 순수 함수 모음. 화면(React)과 검증 스크립트가 함께 쓴다.

export const ALL = "전체";

// 개방 포털: 데이터셋의 채널(ch) 값이 "공공데이터포털(...)" 이면 공공데이터포털, 그 외는 문화빅데이터포털
export const portalOf = (dataset) => (dataset.ch.startsWith("공공데이터포털") ? "public" : "culture");

// 데이터 유형: 채널이 "(API)" 로 끝나면 API, 아니면 파일
export const deliveryOf = (dataset) => (dataset.ch.endsWith("(API)") ? "API" : "파일");

// "문화체육관광>체육" 처럼 상위분류가 붙은 분야는 마지막 항목만 보여준다.
export const shortField = (field) => (field.includes(">") ? (field.split(">").pop() || field) : field);

export const statusClass = (status) => (status === "개방" ? "open" : status.includes("한정") ? "limited" : "closed");

// 업데이트 주기: 포털마다 "Yearly"/"연간", "비주기"/"수시" 처럼 표기가 달라 같은 의미끼리 하나로 묶어 보여준다.
const CYCLE_GROUPS = [
  { label: "실시간", raw: ["실시간"] },
  { label: "일 1회", raw: ["Daily"] },
  { label: "월 1회", raw: ["Monthly"] },
  { label: "연 1회", raw: ["Yearly", "연간"] },
  { label: "수시", raw: ["비주기", "수시", "수시 (1회성 데이터)"] },
];
export const isKnownCycle = (cycle) => CYCLE_GROUPS.some((group) => group.raw.includes(cycle));
export const cycleLabel = (cycle) => CYCLE_GROUPS.find((group) => group.raw.includes(cycle))?.label ?? (cycle || "확인 필요");

// 필터에 보여줄 주기 목록: 위 순서대로, 그 밖의 값은 가나다순으로 뒤에 붙인다. (건수 포함)
export function cycleOptions(datasets) {
  const counts = new Map();
  datasets.forEach((dataset) => {
    const label = cycleLabel(dataset.cycle);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  const known = CYCLE_GROUPS.map((group) => group.label);
  const rank = (label) => (known.includes(label) ? known.indexOf(label) : known.length);
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label, "ko"));
}

// 설명문(desc)의 첫 의미 있는 줄만 뽑는다. ("o 데이터 소개", "o 활용분야" 같은 머리글은 건너뜀)
export function summaryLine(desc) {
  const line = desc
    .replaceAll("_x000D_", " ")
    .split("\n")
    .map((row) => row.replace(/^[-\s]+/, "").trim())
    .filter((row) => row && !/^o\s*(데이터 소개|활용분야)/i.test(row))[0];
  return line || "데이터에 대한 상세 설명을 준비하고 있습니다.";
}

// 값이 비어 있으면 "미분류" 로 묶어 가나다순 고유값 목록을 만든다.
export const uniqueValues = (datasets, key) =>
  [...new Set(datasets.map((dataset) => String(dataset[key] || "미분류")))].sort((a, b) => a.localeCompare(b, "ko"));

export function fieldOptions(datasets) {
  return uniqueValues(datasets, "field")
    .map((name) => ({ name, count: datasets.filter((dataset) => dataset.field === name).length }))
    .sort((a, b) => b.count - a.count);
}

export function filterDatasets(datasets, { query, field, portal, delivery, cycle, onlyNos = null }) {
  const needle = query.trim().toLocaleLowerCase("ko");
  return datasets.filter((dataset) => {
    const haystack = `${dataset.name} ${dataset.desc} ${dataset.kw || ""} ${dataset.sys} ${dataset.field}`.toLocaleLowerCase("ko");
    return (
      (!needle || haystack.includes(needle)) &&
      (field === ALL || dataset.field === field) &&
      (portal === ALL || portalOf(dataset) === portal) &&
      (delivery === ALL || deliveryOf(dataset) === delivery) &&
      (cycle === ALL || cycleLabel(dataset.cycle) === cycle) &&
      (!onlyNos || onlyNos.has(dataset.no))
    );
  });
}

// "함께 보면 좋은 데이터": 같은 출처 시스템이거나 같은 분야인 다른 데이터 최대 6건 (같은 시스템을 먼저, 그다음 같은 분야)
export const relatedDatasets = (datasets, selected) => {
  const matches = datasets.filter((dataset) => dataset.no !== selected.no && (dataset.sys === selected.sys || dataset.field === selected.field));
  return [...matches.filter((dataset) => dataset.sys === selected.sys), ...matches.filter((dataset) => dataset.sys !== selected.sys)].slice(0, 6);
};
