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

// 매 요청 새 위젯으로 단일사용 토큰을 받는다. 토큰은 저장하지 않고 해당 공용 요청에만 쓴다.
export function verifySharedUsage({ siteKey, container, signal }) {
  if (signal?.aborted) return Promise.reject(new AiError("cancelled", "요청을 취소했습니다."));
  if (typeof siteKey !== "string" || !siteKey.trim()) return Promise.reject(new AiError("shared_config", "공용 무료 AI 이용 확인 설정이 준비되지 않았습니다. 기본 검색을 이용해 주세요."));
  if (!container) return Promise.reject(new AiError("shared_verification", VERIFY_ERROR));
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
    const failed = () => finish(new AiError("shared_verification", VERIFY_ERROR));
    const onAbort = () => finish(new AiError("cancelled", "요청을 취소했습니다."));
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
          "error-callback": failed,
          "expired-callback": failed,
          "timeout-callback": failed,
        });
        if (settled) removeWidget();
        else sdk.execute(container);
      } catch {
        failed();
      }
    }).catch(failed);
  });
}
