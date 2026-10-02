// Google Gemini API 호출. generateContent(POST /v1beta/models/{model}:generateContent)를 fetch 로 직접 부른다.
// 이용자가 입력한 키로 브라우저에서 호출하며, 키는 저장하지 않고 이 페이지의 메모리에서만 쓴다. (키는 주소가 아니라 헤더로 보낸다)
import { AiError } from "../errors.js";
import { AI_SCHEMA, FORMAT_HINT } from "../prompt.js";
import { badRequestError, httpError, postJson } from "./http.js";

const SERVICE = "Gemini";
const endpointOf = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
// 안전·정책 때문에 답을 만들지 않은 경우의 finishReason
const BLOCKED_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY", "LANGUAGE"]);

const refusal = () => new AiError("refusal", "AI가 이 질문에는 답하지 못했습니다. 질문을 바꿔 보세요.");

// Gemini 는 잘못된 API 키에도 401 이 아니라 400(API_KEY_INVALID)을 돌려준다.
const isInvalidKey = (data) => /API_KEY_INVALID|API key not valid/i.test(JSON.stringify(data?.error ?? ""));

// 응답에서 모델이 쓴 글(JSON 문자열)을 꺼낸다. 거절·도중 끊김은 AiError 로 바꾼다.
export function readGeminiText(data) {
  if (data?.promptFeedback?.blockReason) throw refusal();
  const candidate = data?.candidates?.[0];
  if (!candidate) throw new AiError("format", "AI 응답에서 내용을 찾지 못했습니다.");
  const reason = candidate.finishReason;
  if (BLOCKED_REASONS.has(reason)) throw refusal();
  if (reason === "MAX_TOKENS") throw new AiError("format", "AI 응답이 도중에 끊겼습니다. 잠시 후 다시 시도해 주세요.");
  // 생각 과정(thought)은 답이 아니므로 뺀다. 한 답이 여러 조각으로 오면 이어 붙인다.
  const text = (candidate.content?.parts ?? [])
    .filter((part) => typeof part?.text === "string" && !part.thought)
    .map((part) => part.text)
    .join("");
  if (!text) throw new AiError("format", "AI 응답에서 내용을 찾지 못했습니다.");
  return text;
}

/**
 * @param {object} options
 * @param {string} options.apiKey  이용자가 입력한 키 (메모리에서만 사용)
 * @param {object} options.config  site.json 의 ai.gemini (model, maxTokens)
 */
export async function askGemini({ apiKey, config, system, userMessage, signal }) {
  const buildRequest = (structured) => ({
    systemInstruction: { parts: [{ text: structured ? system : `${system}\n\n${FORMAT_HINT}` }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    // JSON 으로 답하게 하되, 스키마를 받지 않는 모델이면 형식 지시문으로 대신한다. (응답 해석은 parseAiResponse 가 글 속의 JSON 을 찾아낸다)
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: config.maxTokens, ...(structured ? { responseJsonSchema: AI_SCHEMA } : {}) },
  });

  let last;
  for (const structured of [true, false]) {
    last = await postJson({ url: endpointOf(config.model), headers: { "x-goog-api-key": apiKey }, body: buildRequest(structured), signal, service: SERVICE });
    if (last.status !== 400) break;
    if (isInvalidKey(last.data)) throw httpError(401, { service: SERVICE, model: config.model });
  }
  if (last.status === 400) throw badRequestError(last.data, SERVICE);
  if (last.status < 200 || last.status >= 300) throw httpError(last.status, { service: SERVICE, model: config.model });
  return readGeminiText(last.data);
}
