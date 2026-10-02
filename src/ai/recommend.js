// 질문 -> 추천 데이터. 항상 로컬 검색을 먼저 하고, AI 모드이면 그 결과를 후보로 LLM 에 맡겨 고르게 한다.
// AI 호출이 실패하면 로컬 검색 결과를 그대로 보여주므로 기능이 완전히 막히지 않는다.
import { portalOf, summaryLine } from "../lib/catalog.js";
import { AiError } from "./errors.js";
import { LIMITS, buildSystemPrompt, buildUserMessage, parseAiResponse, summarizeCandidate } from "./prompt.js";
import { askGateway } from "./providers/gateway.js";
import { askGemini } from "./providers/gemini.js";
import { search } from "./retrieval.js";

// 이용자 본인의 API 키로 브라우저에서 직접 부르는 방식. 설정은 site.json 의 ai.<방식> 에 있다.
const KEY_PROVIDERS = { gemini: askGemini };

const CANDIDATE_LIMIT = 30; // 검색이 잘 될 때 LLM 에 보내는 후보 수
const FULL_CATALOG_COMPACT_FROM = 60; // 후보가 이보다 많으면 이름·분야만 보내 토큰을 아낀다

function candidateFor(dataset, store, compact) {
  const key = String(dataset.no);
  const meta = store.cultureColumns[key] ?? store.publicMeta[key];
  return summarizeCandidate(dataset, {
    compact,
    portalName: store.site.portals[portalOf(dataset)].label,
    columns: (meta?.columns ?? []).map((column) => column.label || column.name),
    summary: summaryLine(dataset.desc),
  });
}

// LLM 에 보낼 후보를 고른다. 검색이 약하면(관련 데이터를 못 찾았거나 신뢰도가 낮으면) 카탈로그 전체를 짧게 보내 놓치는 것을 막는다.
export function selectCandidates(index, store, question) {
  const found = search(index, question, { limit: CANDIDATE_LIMIT });
  const useCatalog = found.results.length < 10 || found.confidence === "low";
  const datasets = useCatalog ? index.docs.map((doc) => doc.dataset) : found.results.map((result) => result.dataset);
  const compact = datasets.length > FULL_CATALOG_COMPACT_FROM;
  return { candidates: datasets.map((dataset) => candidateFor(dataset, store, compact)), strategy: useCatalog ? "catalog" : "retrieved", found };
}

/**
 * @param {object} args
 * @param {string} args.question
 * @param {"local"|"gemini"|"gateway"} args.mode
 * @param {object} args.store   loadAppData() 결과
 * @param {object} args.index   buildIndex() 결과
 * @param {string} [args.apiKey] gemini 모드에서 이용자가 입력한 키
 * @param {AbortSignal} [args.signal]
 */
export async function recommend({ question, mode, store, index, apiKey, signal }) {
  const trimmed = question.trim().slice(0, LIMITS.questionChars);
  const aiConfig = store.site.ai ?? {};
  const found = search(index, trimmed, { limit: 12 });
  const localRecommendations = found.results.slice(0, LIMITS.recommendations).map((result) => ({
    dataset: result.dataset,
    reason: result.reason ? `일치: ${result.reason}` : "",
    relevance: null,
    source: "local",
  }));

  const result = {
    question: trimmed,
    mode,
    usedAi: false,
    confidence: found.confidence,
    terms: found.terms,
    expanded: found.expanded,
    local: localRecommendations,
    summary: "",
    recommendations: localRecommendations,
    combinations: [],
    candidateCount: 0,
    strategy: "local",
    error: null,
  };
  if (mode === "local" || !trimmed) return result;

  try {
    const { candidates, strategy } = selectCandidates(index, store, trimmed);
    result.candidateCount = candidates.length;
    result.strategy = strategy;

    let text;
    if (Object.hasOwn(KEY_PROVIDERS, mode) && aiConfig[mode]) {
      const system = buildSystemPrompt({ orgName: store.site.organization.name, serviceName: store.site.service.fullName });
      text = await KEY_PROVIDERS[mode]({ apiKey, config: aiConfig[mode], system, userMessage: buildUserMessage(trimmed, candidates), signal });
    } else if (mode === "gateway") {
      text = await askGateway({ url: aiConfig.gateway.url, question: trimmed, candidates, signal });
    } else {
      throw new AiError("server", "지원하지 않는 모드입니다.");
    }

    const parsed = parseAiResponse(text, candidates.map((candidate) => candidate.no));
    if (!parsed) throw new AiError("format", "AI 응답 형식이 올바르지 않습니다.");

    const byNo = new Map(store.datasets.map((dataset) => [dataset.no, dataset]));
    result.usedAi = true;
    result.summary = parsed.summary;
    result.recommendations = parsed.recommendations.map((item) => ({ dataset: byNo.get(item.no), reason: item.reason, relevance: item.relevance, source: "ai" }));
    result.combinations = parsed.combinations.map((item) => ({ title: item.title, idea: item.idea, datasets: item.nos.map((no) => byNo.get(no)).filter(Boolean) }));
    return result;
  } catch (error) {
    if (signal?.aborted || (error instanceof AiError && error.code === "cancelled")) throw new AiError("cancelled", "요청을 취소했습니다.");
    result.error = error instanceof AiError ? error.message : "AI 추천 중 오류가 발생했습니다.";
    return result; // 로컬 검색 결과(result.recommendations)를 그대로 보여준다
  }
}
