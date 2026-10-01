// 샘플 행에 들어 있는 개인 식별 가능 값(작성자 ID·선수 이름·본문 속 실명 등)을 비식별화한다. 이미 마스킹된 값은 건드리지 않아 여러 번 실행해도 같다.
//
//   node scripts/mask-sample-data.mjs          # 변경 예정 건수만 보여준다 (파일은 그대로)
//   node scripts/mask-sample-data.mjs --write  # data/explorer-data.json 에 반영한다
//
// 마스킹 방식은 기존 샘플(예: 선수명 "한○○")과 같다: 한글은 첫 글자만, 영문·숫자 ID는 앞 2글자만 남기고 나머지를 ○ 로 바꾼다.
// 새 데이터를 추가할 때 개인정보가 있는 컬럼은 RULES(컬럼 단위), 자유서술 본문 속 실명·문장은 TEXT_RULES 에 추가한다.
// 데이터 추가 스크립트에서 `applyMasks(doc)` 를 불러 쓰면 마스킹되지 않은 값이 파일에 쓰이기 전에 처리할 수 있다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = path.join(root, "data", "explorer-data.json");

const MASK = "○";
const CONTENT_MASK = "[내용 마스킹]"; // 포털이 쓰는 "[민감정보 마스킹]" 표기와 같은 꼴

export function maskValue(value) {
  const text = String(value ?? "");
  if (!text || text.includes(MASK)) return text; // 비었거나 이미 마스킹됨
  const keep = /^[가-힣]/.test(text) ? 1 : 2;
  return text.slice(0, keep) + MASK.repeat(Math.max(1, text.length - keep));
}

// 컬럼 단위 규칙. payload: explorer-data.json 의 payloads 위치(2=문화빅데이터 CSV 샘플, 4=공공데이터 CSV 샘플, 5=공공데이터 OpenAPI 응답 샘플),
// no: 데이터 번호, column: 컬럼명, mode: "whole"(기본, 값 전체) | "beforeSlash"("홍길동/65" 처럼 '/' 앞의 이름만)
export const RULES = [
  { payload: 2, no: 8, column: "WRTER_NM", note: "경륜 명예심판 후기 작성자 ID" },
  { payload: 5, no: 150, column: "racer_nm", note: "경정 출주표(API) 선수명" },
  { payload: 5, no: 150, column: "mot_bf_racer_1_no", mode: "beforeSlash", note: "경정 출주표(API) 직전 모터 사용 선수 ‘이름/번호’의 이름" },
];

// 자유서술 본문 규칙(본문 속 실명·문장). 규칙 자체에 실명과 원문 문장이 들어가므로 공개 저장소에 두지 않고,
// git 에서 제외한 로컬 파일 scripts/mask-text-rules.local.json 에서 읽는다. (.gitignore 의 scripts/*.local.json)
//   [{ "payload": 2, "no": 8, "column": "DETAIL_DC_CN", "note": "설명",
//      "names": ["홍길동"],                                   // 성만 남기고 나머지를 ○ 로 바꿀 이름
//      "spans": [{ "pattern": "시작 문구[\\s\\S]*?끝 문구", "flags": "g" }] }]   // 문장 전체를 [내용 마스킹] 으로 바꿀 구간(정규식, 먼저 처리)
// 파일이 없으면 본문 규칙은 적용하지 않는다. (이미 마스킹된 data/explorer-data.json 은 그대로 둔다)
const TEXT_RULES_FILE = path.join(root, "scripts", "mask-text-rules.local.json");
export const TEXT_RULES_LOADED = fs.existsSync(TEXT_RULES_FILE);
export const TEXT_RULES = TEXT_RULES_LOADED
  ? JSON.parse(fs.readFileSync(TEXT_RULES_FILE, "utf8")).map((rule) => ({ ...rule, spans: (rule.spans ?? []).map((span) => new RegExp(span.pattern, span.flags ?? "g")) }))
  : [];

function entriesOf(doc, rule) {
  const entry = doc.payloads[rule.payload]?.[String(rule.no)];
  if (!entry) return null; // 이 데이터의 샘플이 아직 없다
  return (Array.isArray(entry) ? entry : [entry]).filter((item) => item.columns?.some((column) => (column.name ?? column) === rule.column));
}

function maskRule(rule, value) {
  if (rule.mode === "beforeSlash") {
    const text = String(value ?? "");
    const slash = text.indexOf("/");
    return slash < 0 ? maskValue(text) : `${maskValue(text.slice(0, slash))}${text.slice(slash)}`;
  }
  return maskValue(value);
}

function maskText(rule, value) {
  let text = String(value ?? "");
  for (const span of rule.spans ?? []) text = text.replace(span, CONTENT_MASK);
  for (const name of rule.names ?? []) text = text.split(name).join(name[0] + MASK.repeat(name.length - 1));
  return text;
}

// doc(explorer-data.json 내용)을 제자리에서 마스킹하고 규칙별 결과를 돌려준다.
export function applyMasks(doc) {
  const results = [];
  const runRule = (rule, transform, label) => {
    const entries = entriesOf(doc, rule);
    if (entries === null) {
      results.push({ label, changed: 0, skipped: true });
      return;
    }
    if (!entries.length) throw new Error(`컬럼 ${rule.column} 을(를) 찾지 못했습니다 (#${rule.no})`);
    let changed = 0;
    for (const entry of entries) {
      const columnIndex = entry.columns.findIndex((column) => (column.name ?? column) === rule.column);
      for (const row of entry.rows) {
        const masked = transform(rule, row[columnIndex]);
        if (masked !== row[columnIndex]) {
          row[columnIndex] = masked;
          changed += 1;
        }
      }
    }
    results.push({ label, changed, skipped: false });
  };
  for (const rule of RULES) runRule(rule, maskRule, `#${rule.no} ${rule.column} (${rule.note})`);
  for (const rule of TEXT_RULES) runRule(rule, maskText, `#${rule.no} ${rule.column} (${rule.note})`);
  return results;
}

// 명령줄에서 직접 실행했을 때만 파일을 읽고 쓴다. (다른 스크립트가 가져다 쓸 때는 실행하지 않음)
const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const write = process.argv.includes("--write");
  const doc = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const results = applyMasks(doc);
  if (!TEXT_RULES_LOADED) console.log("안내: scripts/mask-text-rules.local.json 이 없어 본문(자유서술) 규칙은 적용하지 않았습니다.");
  let changed = 0;
  for (const result of results) {
    changed += result.changed;
    console.log(`${result.label}: ${result.skipped ? "샘플 없음(건너뜀)" : `${result.changed}건 ${write ? "마스킹" : "마스킹 예정"}`}`);
  }
  if (write && changed) {
    fs.writeFileSync(dataFile, `${JSON.stringify(doc, null, 4)}\n`);
    console.log(`저장: data/explorer-data.json (${changed}건 변경)`);
  } else if (!changed) {
    console.log("변경할 값이 없습니다.");
  }
}
