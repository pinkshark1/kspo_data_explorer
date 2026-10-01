// 기관이 운영하는 AI 중계 서버(scripts/ai-gateway.mjs 또는 같은 규격의 서버)를 호출한다.
// 키는 서버에만 있고 브라우저에는 없다. 서버가 어떤 모델을 쓰는지는 이 코드와 무관하다. (모델 교체 가능)
//
// 요청  POST <url>  { question, candidates:[{no,name,field,...}] }
// 응답  200 { summary, recommendations:[{no,relevance,reason}], combinations:[{title,nos,idea}] }
//       422 { error: "refusal" }  AI 가 답하지 못한 경우
import { AiError } from "../errors.js";

const TIMEOUT_MS = 60_000;

export async function askGateway({ url, question, candidates, signal }) {
  // 이용자가 취소했거나 시간이 지나면 요청을 끊는다. (AbortSignal.any 는 구형 브라우저에 없어 직접 연결)
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  const failure = (code, message) => (signal?.aborted ? new AiError("cancelled", "요청을 취소했습니다.") : timedOut ? new AiError("network", "AI 서버 응답이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요.") : new AiError(code, message));
  try {
    let response;
    try {
      response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, candidates }), signal: controller.signal, credentials: "omit" });
    } catch {
      throw failure("network", "AI 서버에 연결하지 못했습니다. 서버 주소와 네트워크·보안 설정을 확인해 주세요.");
    }
    if (response.status === 429) throw new AiError("rate", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
    if (response.status === 422) throw new AiError("refusal", "AI가 이 질문에는 답하지 못했습니다. 질문을 바꿔 보세요.");
    if (!response.ok) throw new AiError("server", `AI 서버가 오류를 돌려주었습니다. (${response.status})`);
    try {
      return await response.text();
    } catch {
      throw failure("format", "AI 서버 응답을 읽지 못했습니다.");
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
