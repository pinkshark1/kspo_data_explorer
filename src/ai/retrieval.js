// 질문(자연어)으로 데이터셋을 찾는 로컬 검색 엔진. AI 모델을 쓰지 않고 브라우저 안에서만 동작한다.
//
//  1) 질문에서 조사·질문 투의 말을 걷어내고 핵심 낱말을 뽑는다.
//  2) 유의어 사전(thesaurus.js)으로 낱말을 데이터 카탈로그의 표현으로 넓힌다.
//  3) 이름·분야·키워드·출처 시스템·컬럼·설명에서 일치 정도를 점수화한다. (흔한 낱말은 낮게, 드문 낱말은 높게)
//
// 결과에는 "왜 추천했는지"(일치한 낱말과 위치)가 함께 들어 있어, AI 모드에서 LLM에 넘길 후보를 좁히는 데도 같은 결과를 쓴다.
import { deliveryOf, shortField } from "../lib/catalog.js";
import { STOPWORDS, STOP_STEMS, SUFFIXES, THESAURUS, VERB_ENDINGS } from "./thesaurus.js";

const FIELD_WEIGHT = { name: 3, field: 2, kw: 1.6, sys: 1.2, ops: 1.1, columns: 0.9, desc: 0.8 };
// 이용자에게 보여 줄 일치 위치 이름
const FIELD_LABEL = { name: "데이터 이름", field: "분야", kw: "키워드", sys: "만든 업무시스템", ops: "API 기능", columns: "데이터 항목", desc: "설명" };
const FIELDS = Object.keys(FIELD_WEIGHT);
const EXPANDED_WEIGHT = 0.5;
const ORG_PREFIX = /^서울올림픽기념국민체육진흥공단\s*/;

export const normalize = (text) =>
  String(text ?? "")
    .normalize("NFC") // 맥(macOS)에서 입력한 자모 분리형 한글도 같은 글자로
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// 낱말 끝의 조사·어미를 한 번 떼어낸다. (남는 글자가 2자 이상일 때만)
export function stem(word) {
  if (!/[가-힣]/.test(word)) return word;
  for (const ending of VERB_ENDINGS) {
    // "연계할" -> "연계" (질문 투의 동사 어미를 뗀다). 떼고 남은 말이 불용어면 그대로 버려진다.
    if (word.length - ending.length >= 2 && word.endsWith(ending)) return word.slice(0, -ending.length);
  }
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= 2 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

const isStopWord = (word) => STOPWORDS.has(word) || STOP_STEMS.some((stemText) => word.startsWith(stemText));

// 질문 -> 핵심 낱말 목록 (중복 제거). term 은 조사·어미를 뗀 말, raw 는 질문에 쓴 그대로의 말
export function extractWords(question) {
  const words = [];
  for (const raw of normalize(question).split(" ")) {
    if (!raw) continue;
    const word = stem(raw);
    if (isStopWord(raw) || isStopWord(word)) continue;
    if (word.length < 2) continue; // 한 글자(한글·영문·숫자)는 의미를 알 수 없어 버린다
    if (!words.some((entry) => entry.term === word)) words.push({ term: word, raw });
  }
  return words;
}

export const extractTerms = (question) => extractWords(question).map((entry) => entry.term);

// 유의어 사전의 trigger 가 질문에 들어 있는지.
//  - 영문(ai 등): 낱말이 같거나 조사만 붙은 경우 ("AI를")
//  - 한글 2글자 이하(지도 등): 낱말이 같거나 조사만 붙은 경우. ("체육지도자"의 "지도"에는 걸리지 않게)
//  - 한글 3글자 이상: 질문 안에 들어 있으면
function triggerMatches(trigger, text, words) {
  if (/^[a-z0-9]+$/.test(trigger) || trigger.length <= 2) {
    return [...words].some((word) => word === trigger || (word.startsWith(trigger) && SUFFIXES.includes(word.slice(trigger.length))));
  }
  return text.includes(trigger);
}

// 질문 속 낱말에 걸리는 유의어 묶음의 확장어 목록
export function expandTerms(question, baseTerms) {
  const text = normalize(question);
  const words = new Set(text.split(" "));
  const expanded = new Map(); // term -> 어떤 낱말 때문에 붙었는지
  for (const group of THESAURUS) {
    const hit = group.triggers.find((trigger) => triggerMatches(trigger, text, words));
    if (!hit) continue;
    for (const term of group.expand) {
      if (!baseTerms.includes(term) && !expanded.has(term)) expanded.set(term, hit);
    }
  }
  return expanded;
}

function descriptionText(desc) {
  return String(desc ?? "")
    .replaceAll("_x000D_", " ")
    .split("\n")
    .map((row) => row.replace(/^[-\s]+/, "").trim())
    .filter((row) => row && !/^o\s*(데이터 소개|활용분야)/i.test(row))
    .slice(0, 3)
    .join(" ")
    .slice(0, 400);
}

// 카탈로그 -> 검색용 색인. store 는 loadAppData() 의 결과.
export function buildIndex(store) {
  const docs = store.datasets.map((dataset) => {
    const key = String(dataset.no);
    const meta = store.cultureColumns[key] ?? store.publicMeta[key];
    const columns = (meta?.columns ?? []).map((column) => column.label || column.name).join(" ").slice(0, 600);
    const operations = [
      ...(store.publicMeta[key]?.operations ?? []).map((operation) => operation.name),
      ...(store.apiSamples[key] ?? []).map((operation) => operation.operationName),
    ].join(" ");
    return {
      dataset,
      text: {
        name: normalize(dataset.name.replace(ORG_PREFIX, "")),
        field: normalize(shortField(dataset.field)),
        kw: normalize(dataset.kw),
        sys: normalize(dataset.sys),
        ops: normalize(operations),
        columns: normalize(columns),
        desc: normalize(descriptionText(dataset.desc)),
      },
    };
  });
  return { docs, total: docs.length, dfCache: new Map() };
}

function documentFrequency(index, term) {
  if (!index.dfCache.has(term)) {
    index.dfCache.set(term, index.docs.filter((doc) => FIELDS.some((field) => doc.text[field].includes(term))).length);
  }
  return index.dfCache.get(term);
}

const idf = (index, term) => Math.log(1 + index.total / (1 + documentFrequency(index, term)));

// 낱말의 글자 두 개짜리 조각 중 본문에 들어 있는 비율 ("체육시설안전" 처럼 붙여 쓴 말이 본문에 없을 때의 보조 일치)
function bigramCoverage(term, text) {
  const grams = [];
  for (let i = 0; i + 1 < term.length; i += 1) grams.push(term.slice(i, i + 2));
  return grams.length ? grams.filter((gram) => text.includes(gram)).length / grams.length : 0;
}

function scoreDocument(index, doc, baseTerms, expandedTerms, intent) {
  let total = 0;
  let baseMatched = 0;
  const matches = [];
  const all = [...baseTerms.map((term) => ({ term, weight: 1, via: null })), ...[...expandedTerms].map(([term, via]) => ({ term, weight: EXPANDED_WEIGHT, via }))];

  for (const { term, weight, via } of all) {
    let best = 0;
    let bestField = null;
    let others = 0;
    for (const field of FIELDS) {
      const text = doc.text[field];
      if (!text) continue;
      let score = 0;
      if (text.includes(term)) score = FIELD_WEIGHT[field];
      else if (term.length >= 3) {
        const coverage = bigramCoverage(term, text);
        if (coverage >= 0.67) score = FIELD_WEIGHT[field] * coverage * 0.45;
      }
      if (score > best) {
        others += best;
        best = score;
        bestField = field;
      } else {
        others += score;
      }
    }
    if (best <= 0) continue;
    total += (best + 0.2 * others) * idf(index, term) * weight;
    matches.push({ term, field: bestField, via });
    if (!via) baseMatched += 1;
  }

  // 질문의 낱말을 많이 만족할수록 가산 (여러 개념이 함께 걸린 질문에서 한 개념만 맞는 데이터를 아래로)
  const coverage = baseTerms.length ? baseMatched / baseTerms.length : 0;
  total *= 1 + 1.2 * coverage * coverage;
  const delivery = deliveryOf(doc.dataset);
  if (intent.api && delivery === "API") total *= 1.25;
  if (intent.file && delivery === "파일") total *= 1.15;
  return { total, matches, coverage };
}

// "데이터 이름에 ‘체육시설’·‘안전’ 낱말이 들어 있습니다(비슷한 말 ‘안전점검’ 포함)." 처럼 일치한 위치별로 한 문장씩 설명한다. (최대 2곳)
function describeMatches(matches) {
  const byField = new Map();
  for (const match of matches) {
    if (!byField.has(match.field)) byField.set(match.field, { base: [], related: [] });
    const entry = byField.get(match.field);
    (match.via ? entry.related : entry.base).push(match.term);
  }
  const quote = (terms) => terms.map((term) => `‘${term}’`).join("·");
  return FIELDS.filter((field) => byField.has(field))
    .slice(0, 2)
    .map((field) => {
      const { base, related } = byField.get(field);
      const similar = quote(related.slice(0, 2));
      if (!base.length) return `${FIELD_LABEL[field]}에 비슷한 말 ${similar} 낱말이 들어 있습니다.`;
      return `${FIELD_LABEL[field]}에 ${quote(base)} 낱말이 들어 있습니다${related.length ? `(비슷한 말 ${similar} 포함)` : ""}.`;
    })
    .join(" ");
}

// 붙여 쓴 말("채용공고")을 카탈로그에 있는 낱말("채용", "공고")로 나눈다.
// 왼쪽부터 가장 긴 조각을 골라 가며 나누고, 카탈로그에 있는 조각만 돌려준다. (없으면 빈 목록)
function splitWord(index, term) {
  const parts = [];
  let start = 0;
  while (start < term.length - 1) {
    let found = null;
    for (let end = term.length; end - start >= 2; end -= 1) {
      const piece = term.slice(start, end);
      if (documentFrequency(index, piece) > 0) {
        found = piece;
        break;
      }
    }
    if (found) {
      parts.push(found);
      start += found.length;
    } else {
      start += 1;
    }
  }
  return parts;
}

// 검색 결과를 얼마나 믿을 수 있는지: 질문과 거의 맞는 데이터가 없으면 'low' 로 알려, 화면에서 "가까운 후보"라고 안내한다.
// (기준값은 scripts/check-search.mjs 의 질문 세트로 확인한다. 데이터 수가 크게 달라지면 함께 조정)
export function confidenceOf(topScore, topCoverage) {
  if (topScore < 20 || (topCoverage < 0.34 && topScore < 35)) return "low";
  return topScore < 35 ? "medium" : "high";
}

// 질문으로 검색. 결과는 점수가 높은 순이며, 각 항목에 일치한 낱말(reason)이 들어 있다.
export function search(index, question, { limit = 10 } = {}) {
  // 카탈로그에 없는 낱말은 카탈로그의 낱말들로 나눠 찾고, 조사를 뗀 말도 그 안의 카탈로그 낱말을 함께 찾는다.
  const resolve = ({ term, raw }) => {
    const known = documentFrequency(index, term) > 0;
    const stripped = raw !== term;
    if (known && !stripped) return [term];
    const parts = raw.length >= 4 ? splitWord(index, raw) : [];
    if (known) return [...new Set([term, ...parts])]; // 조사를 뗀 말 + 그 안의 카탈로그 낱말 ("채용공" + "채용")
    return parts.length ? parts : [term];
  };
  const baseTerms = [...new Set(extractWords(question).flatMap(resolve))];
  const expandedTerms = expandTerms(question, baseTerms);
  const text = normalize(question);
  const intent = { api: /(^| )(open ?api|오픈 ?api|api)/.test(text), file: /파일|csv|다운로드/.test(text) };

  if (!baseTerms.length && !expandedTerms.size) return { terms: [], expanded: [], results: [], topScore: 0, topCoverage: 0, confidence: "none" };

  const results = index.docs
    .map((doc) => {
      const { total, matches, coverage } = scoreDocument(index, doc, baseTerms, expandedTerms, intent);
      return { dataset: doc.dataset, score: total, matches, coverage };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.dataset.no - b.dataset.no)
    .slice(0, limit)
    .map((result) => ({ dataset: result.dataset, score: result.score, coverage: result.coverage, reason: describeMatches(result.matches), matches: result.matches }));

  const topScore = results[0]?.score ?? 0;
  const topCoverage = results[0]?.coverage ?? 0;
  return { terms: baseTerms, expanded: [...expandedTerms.keys()], results, topScore, topCoverage, confidence: results.length ? confidenceOf(topScore, topCoverage) : "none" };
}
