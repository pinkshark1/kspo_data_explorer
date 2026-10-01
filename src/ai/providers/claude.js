// Claude API 호출. 공식 SDK(@anthropic-ai/sdk)를 쓴다.
//  - 브라우저: 이용자가 직접 입력한 키로 호출한다. (askClaude - 키는 저장하지 않고 이 페이지의 메모리에서만 쓴다)
//  - 서버: scripts/ai-gateway.mjs 가 기관의 키로 호출한다. (runClaudeRequest 를 공유)
import { AiError } from "../errors.js";
import { AI_SCHEMA, FORMAT_HINT } from "../prompt.js";

// SDK 의 오류 종류를 이용자가 이해할 수 있는 문장으로 바꾼다.
export function toAiError(error, Anthropic) {
  if (error?.name === "AbortError" || error instanceof Anthropic.APIUserAbortError) return new AiError("cancelled", "요청을 취소했습니다.");
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return new AiError("key", "API 키가 올바르지 않거나 이 모델을 쓸 권한이 없습니다. 키를 확인해 주세요.");
  if (error instanceof Anthropic.RateLimitError) return new AiError("rate", "요청이 너무 많거나 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.");
  if (error instanceof Anthropic.BadRequestError) return new AiError("server", `요청이 거절되었습니다. (${error.message})`);
  if (error instanceof Anthropic.APIConnectionError) return new AiError("network", "Claude 서비스에 연결하지 못했습니다. 네트워크나 보안 설정(외부 접속 제한)을 확인해 주세요.");
  if (error instanceof Anthropic.APIError) return new AiError("server", `Claude 서비스 오류입니다. (${error.status ?? ""})`);
  return new AiError("server", "알 수 없는 오류가 발생했습니다.");
}

/**
 * 요청 한 번을 보내고 모델이 돌려준 글(JSON 문자열)을 꺼낸다. 오류는 AiError 로 바꿔 던진다.
 * @param {object} options
 * @param {object} options.Anthropic  SDK 기본 export (오류 클래스 판별용)
 * @param {object} options.client     SDK 클라이언트
 * @param {object} options.config     site.json 의 ai.claude (model, effort, maxTokens, refusalFallback)
 * @param {string} options.system     시스템 프롬프트
 * @param {string} options.userMessage 질문과 후보
 * @param {AbortSignal} [options.signal]
 */
export async function runClaudeRequest({ Anthropic, client, config, system, userMessage, signal }) {
  const buildRequest = (structured) => ({
    model: config.model,
    max_tokens: config.maxTokens,
    // 구조화 출력을 쓸 수 없을 때는 지시문으로 JSON 형식을 요구한다. (응답 해석은 parseAiResponse 가 글 속의 JSON 을 찾아낸다)
    system: structured ? system : `${system}\n\n${FORMAT_HINT}`,
    messages: [{ role: "user", content: userMessage }],
    output_config: { ...(structured ? { format: { type: "json_schema", schema: AI_SCHEMA } } : {}), ...(config.effort ? { effort: config.effort } : {}) },
  });

  // 계정·모델이 일부 옵션을 받지 않아 400 이 오면, 옵션을 하나씩 빼며 다시 시도한다.
  //   1) 거절 시 다른 모델로 이어 처리하는 폴백(베타)  2) 구조화 출력(JSON 스키마)
  const attempts = [];
  if (config.refusalFallback) attempts.push({ fallback: true, structured: true });
  attempts.push({ fallback: false, structured: true }, { fallback: false, structured: false });

  let response;
  let lastError;
  for (const attempt of attempts) {
    const request = buildRequest(attempt.structured);
    if (!Object.keys(request.output_config).length) delete request.output_config;
    try {
      response = attempt.fallback
        ? await client.beta.messages.create({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal })
        : await client.messages.create(request, { signal });
      break;
    } catch (error) {
      lastError = error;
      if (!(error instanceof Anthropic.BadRequestError)) throw toAiError(error, Anthropic);
    }
  }
  if (!response) throw toAiError(lastError, Anthropic);

  if (response.stop_reason === "refusal") throw new AiError("refusal", "AI가 이 질문에는 답하지 못했습니다. 질문을 바꿔 보세요.");
  if (response.stop_reason === "max_tokens") throw new AiError("format", "AI 응답이 도중에 끊겼습니다. 잠시 후 다시 시도해 주세요.");
  // 폴백이 일어났다면 거절한 모델이 쓰던 글이 앞에 남아 있을 수 있으므로, 마지막 fallback 블록 뒤의 마지막 글 블록을 쓴다.
  const lastFallback = response.content.map((block) => block.type).lastIndexOf("fallback");
  const textBlocks = response.content.slice(lastFallback + 1).filter((block) => block.type === "text");
  const textBlock = textBlocks.at(-1);
  if (!textBlock) throw new AiError("format", "AI 응답에서 내용을 찾지 못했습니다.");
  return textBlock.text;
}

/**
 * 브라우저에서 이용자의 키로 직접 호출한다. SDK 는 처음 쓸 때만 내려받는다(동적 import).
 * @param {object} options
 * @param {string} options.apiKey 이용자가 입력한 키 (메모리에서만 사용)
 */
export async function askClaude({ apiKey, config, system, userMessage, signal }) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // dangerouslyAllowBrowser: 브라우저에서 직접 호출하려면 필요하다. 키는 이용자 본인 것이며 서버로 보내거나 저장하지 않는다.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 90_000 });
  return runClaudeRequest({ Anthropic, client, config, system, userMessage, signal });
}
