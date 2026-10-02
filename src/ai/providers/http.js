// 브라우저에서 fetch 로 AI 서비스(현재 Gemini)를 부르는 공통 부분. SDK 없이 요청 한 번을 보내고, 취소·시간 초과·연결 실패·HTTP 오류를 AiError 로 바꾼다.
import { AiError } from "../errors.js";

const TIMEOUT_MS = 90_000;
// 서비스 쪽 일시 오류(내부 오류·과부하·중계 오류). 키·요청과 무관해 잠시 뒤 다시 보내면 되는 경우가 많다.
export const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);

// ms 만큼 기다린다. 기다리는 동안 이용자가 취소하면 바로 멈춘다.
export function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const cancelled = () => new AiError("cancelled", "요청을 취소했습니다.");
    if (signal?.aborted) return reject(cancelled());
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * JSON 을 POST 하고 { status, data } 를 돌려준다. data 는 응답 본문을 JSON 으로 읽은 값(읽지 못하면 null).
 * 취소·시간 초과·연결 실패는 AiError 로 던지고, HTTP 상태에 따른 판단(400 재시도 등)은 호출한 쪽이 한다.
 * @param {object} options
 * @param {string} options.service 이용자에게 보여줄 서비스 이름 (예: "Gemini")
 */
export async function postJson({ url, headers, body, signal, service }) {
  // 이용자가 취소했거나 시간이 지나면 요청을 끊는다. (AbortSignal.any 는 구형 브라우저에 없어 직접 연결)
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    let response;
    try {
      response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: controller.signal, credentials: "omit" });
    } catch {
      if (signal?.aborted) throw new AiError("cancelled", "요청을 취소했습니다.");
      if (timedOut) throw new AiError("network", `${service} 서비스 응답이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요.`);
      throw new AiError("network", `${service} 서비스에 연결하지 못했습니다. 네트워크나 보안 설정(외부 접속 제한)을 확인해 주세요.`);
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      // 본문이 JSON 이 아니면 null — 상태 코드로만 판단한다
    }
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// 400 이 아닌 HTTP 오류를 이용자가 이해할 수 있는 문장으로 바꾼다. (400 은 옵션을 빼고 다시 시도할지 호출한 쪽이 정한다)
export function httpError(status, { service, model }) {
  if (status === 401 || status === 403) return new AiError("key", "API 키가 올바르지 않거나 이 모델을 쓸 권한이 없습니다. 키를 확인해 주세요.");
  if (status === 429) return new AiError("rate", "요청이 너무 많거나 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.");
  if (status === 404) return new AiError("server", `${service} 서비스에서 설정된 모델(${model})을 찾지 못했습니다. 관리자에게 알려 주세요.`);
  if (TRANSIENT_STATUSES.has(status)) return new AiError("server", `${service} 서비스가 일시적으로 응답하지 못했습니다. (${status}) 잠시 후 다시 시도하거나 다른 모델을 골라 보세요.`);
  return new AiError("server", `${service} 서비스 오류입니다. (${status})`);
}

// 400 오류 본문에서 보여줄 만한 설명을 꺼낸다. 길이를 제한한다.
export function badRequestError(data, service) {
  const detail = String(data?.error?.message ?? "").replace(/\s+/g, " ").slice(0, 120);
  return new AiError("server", `${service} 서비스가 요청을 거절했습니다.${detail ? ` (${detail})` : ""}`);
}
