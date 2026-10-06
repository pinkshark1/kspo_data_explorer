// 실제 키 점검 스크립트(probe:ai · compare:ai)가 Gemini 호출을 기록하고, 실패했을 때 다시 시도할지·얼마나 기다릴지 정한다.
// 기록하는 것: 상태 코드, Google 이 붙이는 오류 종류(UNAVAILABLE 등)·한도 이름(quotaId)·대기 안내(retryDelay), 시간 초과/연결 실패 구분.
// 기록하지 않는 것: 주소·헤더·키, 오류 문장(프로젝트 번호 등이 들어갈 수 있음).
import { TRANSIENT_STATUSES } from "../../src/ai/providers/http.js";

// Google 오류 본문에서 기록해도 되는 값만 꺼낸다.
function errorFacts(error) {
  const details = Array.isArray(error?.details) ? error.details : [];
  const typeOf = (detail) => String(detail?.["@type"] ?? "");
  const quotaIds = details
    .filter((detail) => typeOf(detail).endsWith("QuotaFailure"))
    .flatMap((detail) => (Array.isArray(detail.violations) ? detail.violations : []))
    .map((violation) => String(violation?.quotaId ?? ""))
    .filter((id) => /^[A-Za-z0-9-]{1,80}$/.test(id));
  const delay = String(details.find((detail) => typeOf(detail).endsWith("RetryInfo"))?.retryDelay ?? "");
  return {
    reason: /^[A-Z_]{1,40}$/.test(String(error?.status ?? "")) ? error.status : "",
    quotaIds: [...new Set(quotaIds)],
    retryAfterSec: /^\d+(\.\d+)?s$/.test(delay) ? Math.ceil(Number.parseFloat(delay)) : undefined,
  };
}

/**
 * fetch 를 감싸 호출마다 기록을 남긴다. 돌려준 객체의 calls 를 비우거나 바꿔 가며 쓴다.
 * 성공 응답은 걸러지기 전 모델의 답(text)도 남긴다(후보 밖 번호 세기용).
 */
export function installCallLog() {
  const realFetch = globalThis.fetch;
  const log = { calls: [] };
  globalThis.fetch = async (...args) => {
    const started = Date.now();
    let response;
    try {
      response = await realFetch(...args);
    } catch (error) {
      // 우리 쪽 시간 제한(화면 코드의 90초 등)으로 끊은 것과 실제 연결 실패를 나눈다
      const timedOut = Boolean(args[1]?.signal?.aborted) || error?.name === "AbortError" || error?.name === "TimeoutError";
      log.calls.push({ status: timedOut ? `시간 초과(${Math.round((Date.now() - started) / 1000)}초)` : "연결 실패", network: true, text: "" });
      throw error;
    }
    const entry = { status: response.status, text: "" };
    log.calls.push(entry);
    try {
      const data = await response.clone().json();
      if (response.ok) entry.text = (data?.candidates?.[0]?.content?.parts ?? []).filter((part) => !part.thought).map((part) => part.text ?? "").join("");
      else Object.assign(entry, errorFacts(data?.error));
    } catch {
      // 본문이 JSON 이 아니면 상태 코드만 남긴다
    }
    return response;
  };
  return log;
}

export const statusOf = (call) =>
  [String(call.status), call.reason, call.quotaIds?.join(","), call.retryAfterSec !== undefined ? `${call.retryAfterSec}초 뒤 재시도 안내` : ""].filter(Boolean).join(" ");
export const statusText = (calls) => calls.map(statusOf).join("→") || "-";

const MAX_RETRIES = 3; // 처음 시도 뒤 더 시도하는 최대 횟수
const SERVER_WAITS_SEC = [20, 60, 60]; // 5xx·시간 초과·연결 실패 뒤 기다리는 시간
const LONGEST_QUOTA_WAIT_SEC = 120; // 이보다 오래 기다리라는 한도는 기다리지 않는다

export const isDailyQuota = (call) => (call?.quotaIds ?? []).some((id) => /PerDay/i.test(id));

/**
 * 마지막 요청의 기록을 보고 다시 시도하기 전에 기다릴 초를 돌려준다. 다시 시도하지 않으면 null.
 * @param {object} call      마지막 요청 기록
 * @param {number} attempt   방금 끝난 시도가 몇 번째인지(1부터)
 */
export function retryWaitSec(call, attempt) {
  if (!call || attempt > MAX_RETRIES) return null;
  if (call.network || TRANSIENT_STATUSES.has(call.status)) return SERVER_WAITS_SEC[attempt - 1];
  if (call.status === 429 && !isDailyQuota(call)) {
    // 분당 한도: Google 이 알려 준 시간(없으면 60초)만큼 기다린다
    const wait = (call.retryAfterSec ?? 60) + 3;
    return wait <= LONGEST_QUOTA_WAIT_SEC ? Math.max(wait, 10) : null;
  }
  return null;
}

// 다시 시도할 때 화면에 보여 줄 까닭
export const retryCause = (call) => (call?.status === 429 ? "무료 사용 한도(분당)" : "Google 쪽 일시 오류·시간 초과");

// 끝내 실패한 호출들을 보고 무엇을 하면 되는지 한 줄로 알려 준다
export function failureAdvice(lastCalls) {
  const lines = [];
  if (lastCalls.some(isDailyQuota)) lines.push("하루 무료 한도(quotaId 에 PerDay)에 걸렸습니다. 다음 날 다시 실행하세요.");
  else if (lastCalls.some((call) => call?.status === 429)) lines.push("무료 사용 한도(429)에 걸렸습니다. 1~2분 뒤 다시 실행하세요. 한도는 키가 아니라 Google 프로젝트 단위입니다.");
  if (lastCalls.some((call) => call && (call.network || TRANSIENT_STATUSES.has(call.status)))) lines.push("500·503 같은 5xx·시간 초과는 Google 쪽 일시 오류(과부하)라 키 문제가 아닙니다. 몇 분 뒤 다시 실행하세요.");
  return lines;
}
