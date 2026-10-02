// OpenAI(GPT) API 호출. Responses API(POST /v1/responses)를 fetch 로 직접 부른다.
// 이용자가 입력한 키로 브라우저에서 호출하며, 키는 저장하지 않고 이 페이지의 메모리에서만 쓴다.
import { AiError } from "../errors.js";
import { AI_SCHEMA, FORMAT_HINT } from "../prompt.js";
import { badRequestError, httpError, postJson } from "./http.js";

const ENDPOINT = "https://api.openai.com/v1/responses";
const SERVICE = "OpenAI";

// 응답에서 모델이 쓴 글(JSON 문자열)을 꺼낸다. 거절·도중 끊김은 AiError 로 바꾼다.
export function readOpenAIText(data) {
  if (data?.status === "incomplete") {
    if (data.incomplete_details?.reason === "content_filter") throw new AiError("refusal", "AI가 이 질문에는 답하지 못했습니다. 질문을 바꿔 보세요.");
    throw new AiError("format", "AI 응답이 도중에 끊겼습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (data?.status === "failed") throw new AiError("server", `${SERVICE} 서비스 오류입니다.`);
  const contents = (data?.output ?? []).filter((item) => item?.type === "message").flatMap((item) => item.content ?? []);
  const text = contents.filter((content) => content?.type === "output_text" && typeof content.text === "string").at(-1)?.text;
  if (text) return text;
  if (contents.some((content) => content?.type === "refusal")) throw new AiError("refusal", "AI가 이 질문에는 답하지 못했습니다. 질문을 바꿔 보세요.");
  throw new AiError("format", "AI 응답에서 내용을 찾지 못했습니다.");
}

/**
 * @param {object} options
 * @param {string} options.apiKey  이용자가 입력한 키 (메모리에서만 사용)
 * @param {object} options.config  site.json 의 ai.openai (model, maxTokens)
 */
export async function askOpenAI({ apiKey, config, system, userMessage, signal }) {
  const buildRequest = (structured) => ({
    model: config.model,
    // 구조화 출력을 쓸 수 없을 때는 지시문으로 JSON 형식을 요구한다. (응답 해석은 parseAiResponse 가 글 속의 JSON 을 찾아낸다)
    instructions: structured ? system : `${system}\n\n${FORMAT_HINT}`,
    input: userMessage,
    max_output_tokens: config.maxTokens,
    store: false, // OpenAI 쪽에 응답을 저장하지 않는다
    ...(structured ? { text: { format: { type: "json_schema", name: "dataset_recommendation", strict: true, schema: AI_SCHEMA } } } : {}),
  });

  // 모델·계정이 구조화 출력(JSON 스키마)을 받지 않아 400 이 오면, 지시문으로 JSON 형식을 요구하는 방식으로 한 번 더 시도한다.
  let last;
  for (const structured of [true, false]) {
    last = await postJson({ url: ENDPOINT, headers: { Authorization: `Bearer ${apiKey}` }, body: buildRequest(structured), signal, service: SERVICE });
    if (last.status !== 400) break;
  }
  if (last.status === 400) throw badRequestError(last.data, SERVICE);
  if (last.status < 200 || last.status >= 300) throw httpError(last.status, { service: SERVICE, model: config.model });
  return readOpenAIText(last.data);
}
