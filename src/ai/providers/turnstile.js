import { AiError } from "../errors.js";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const VERIFY_ERROR = "공용 무료 AI 이용 확인을 완료하지 못했습니다. 잠시 후 다시 시도하거나 기본 검색을 이용해 주세요.";
let scriptPromise;

function loadTurnstile() {
  if (window.turnstile?.render && window.turnstile?.execute) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const finish = (ok) => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (ok && window.turnstile?.render && window.turnstile?.execute) resolve(window.turnstile);
      else {
        script.remove();
        reject(new AiError("shared_verification", VERIFY_ERROR));
      }
    };
    const timer = setTimeout(() => finish(false), 20_000);
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    document.head.appendChild(script);
  }).catch((error) => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}

// Turnstile 토큰은 발급 후 300초 동안 한 번만 쓸 수 있다. 미리 받은 토큰은 여유를 두고 이 시간 안에만 쓴다.
const PREPARED_MAX_AGE_MS = 240_000;
// 질문을 입력하는 동안 미리 받아 두는 토큰. 메모리에만 두고 다음 공용 요청 한 번에만 쓴다.
let prepared = null;

const cancelled = () => new AiError("cancelled", "요청을 취소했습니다.");

// 새 위젯으로 단일사용 토큰을 받는다. Turnstile 오류(error-callback)는 retryable 로 표시해 한 번 더 받을 수 있게 한다.
function issueToken({ siteKey, container, signal }) {
  if (signal?.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    let widgetId;
    let sdk;
    let settled = false;
    const removeWidget = () => {
      if (widgetId !== undefined && sdk) {
        try { sdk.remove(widgetId); } catch { /* 취소·화면 종료 후 이미 제거된 위젯 */ }
        widgetId = undefined;
      }
    };
    const finish = (error, token) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      removeWidget();
      if (error) reject(error);
      else resolve(token);
    };
    const failed = (retryable = false) => {
      const error = new AiError("shared_verification", VERIFY_ERROR);
      error.retryable = retryable;
      finish(error);
    };
    const onAbort = () => finish(cancelled());
    const timer = setTimeout(failed, 60_000);
    signal?.addEventListener("abort", onAbort, { once: true });
    loadTurnstile().then((loaded) => {
      if (settled) return;
      sdk = loaded;
      try {
        widgetId = sdk.render(container, {
          sitekey: siteKey.trim(),
          action: "shared-ai",
          execution: "execute",
          appearance: "interaction-only",
          size: "flexible",
          callback: (token) => typeof token === "string" && token.trim().length > 0 && token.length <= 2048 ? finish(null, token) : failed(),
          "error-callback": () => failed(true),
          "expired-callback": () => failed(),
          "timeout-callback": () => failed(),
        });
        if (settled) removeWidget();
        else sdk.execute(container);
      } catch {
        failed();
      }
    }).catch(() => failed(true));
  });
}

const usable = (siteKey, container) => typeof siteKey === "string" && !!siteKey.trim() && !!container;

// 이용자가 질문을 입력하기 시작하면 토큰을 미리 받아 둔다. 이용 확인에 걸리는 몇 초를 질문 입력 시간과 겹치게 해 응답을 빨리 받기 위함이다.
// 이미 받고 있거나 받아 둔 토큰(또는 실패 기록)이 있으면 아무것도 하지 않는다. 실패는 질문할 때 확인해 새로 받는다.
export function prepareSharedUsage({ siteKey, container }) {
  if (prepared || !usable(siteKey, container)) return;
  const entry = { controller: new AbortController(), issuedAt: 0 };
  entry.promise = issueToken({ siteKey, container, signal: entry.controller.signal }).then((token) => {
    entry.issuedAt = Date.now();
    return token;
  });
  entry.promise.catch(() => { /* 질문할 때 verifySharedUsage 가 확인한다 */ });
  prepared = entry;
}

// 미리 받던 토큰을 버린다. (방식 변경·개인 키 전환·화면 종료)
export function discardPreparedUsage() {
  prepared?.controller.abort();
  prepared = null;
}

// 공용 요청 한 번에 쓸 단일사용 토큰을 돌려준다. 미리 받아 둔 토큰이 있으면 그것을 쓰고(받는 중이면 기다림), 없거나 쓸 수 없으면 새로 받는다.
// Turnstile 오류는 간헐적으로 나므로(예: 300030) 한 번은 새 위젯으로 다시 받는다. 토큰은 저장하지 않고 해당 공용 요청에만 쓴다.
export async function verifySharedUsage({ siteKey, container, signal }) {
  if (signal?.aborted) throw cancelled();
  if (typeof siteKey !== "string" || !siteKey.trim()) throw new AiError("shared_config", "공용 무료 AI 이용 확인 설정이 준비되지 않았습니다. 기본 검색을 이용해 주세요.");
  if (!container) throw new AiError("shared_verification", VERIFY_ERROR);
  const entry = prepared;
  prepared = null;
  let retries = 1;
  if (entry) {
    const onAbort = () => entry.controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const token = await entry.promise;
      if (Date.now() - entry.issuedAt < PREPARED_MAX_AGE_MS) return token;
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      // 미리 받기가 이미 한 번 실패했으므로 아래에서는 다시 받기를 한 번만 한다.
      if (error?.retryable) retries = 0;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }
  for (;;) {
    try {
      return await issueToken({ siteKey, container, signal });
    } catch (error) {
      if (!error?.retryable || retries <= 0 || signal?.aborted) throw error;
      retries -= 1;
    }
  }
}
