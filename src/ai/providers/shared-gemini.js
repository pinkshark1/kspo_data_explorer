// 공용 무료 AI 서버에는 질문과 공개 데이터 후보만 보낸다. 개인 API 키는 받지 않는다.
import { AiError } from "../errors.js";

const TIMEOUT_MS = 60_000;
const SERVICE_ERROR = "공용 무료 AI 서비스에 연결하지 못했거나 정상 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.";
// 이용 확인을 통과하면 공용 서버가 주는 30분짜리 통행증. 이 페이지의 메모리에만 두며, 만료 1분 전부터는 쓰지 않는다.
const PASS_MARGIN_MS = 60_000;
let sharedPass = null;

export function hasSharedPass(now = Date.now()) {
  return !!sharedPass && sharedPass.expiresAt - PASS_MARGIN_MS > now;
}

export function clearSharedPass() {
  sharedPass = null;
}

function rememberPass(value) {
  const match = /^(\d{1,12})\.[A-Za-z0-9_-]{43}$/.exec(value ?? "");
  if (match) sharedPass = { value, expiresAt: Number(match[1]) * 1000 };
}

export function sharedGeminiUrl(config) {
  try {
    const url = new URL(config?.shared?.url ?? "");
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (url.protocol === "https:" || local) && !url.username && !url.password && !url.search && !url.hash ? url.href : "";
  } catch {
    return "";
  }
}

// 이용 확인 토큰이 있으면 그것을, 없으면 유효한 통행증을 보낸다. 둘 다 없으면 이용 확인 없이 묻는다.
// 공용 서버가 이상 징후로 보고 이용 확인을 요구하면(403 verification_required) needsVerification 오류를 던져 화면이 Turnstile을 받게 한다.
export async function askSharedGemini({ url, question, candidates, verificationToken, signal }) {
  if (signal?.aborted) throw new AiError("cancelled", "요청을 취소했습니다.");
  const pass = verificationToken === undefined && hasSharedPass() ? sharedPass.value : undefined;
  if (verificationToken !== undefined && (typeof verificationToken !== "string" || !verificationToken.trim() || verificationToken.length > 2048)) throw new AiError("shared_verification", "공용 무료 AI 이용 확인을 완료하지 못했습니다. 다시 시도해 주세요.");
  const proof = pass ? { pass } : verificationToken !== undefined ? { verificationToken } : {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, candidates, ...proof }),
      credentials: "omit",
      signal: controller.signal,
    });
    rememberPass(response.headers.get("x-ai-pass"));
    let data;
    try {
      data = await response.json();
    } catch {
      throw new AiError("shared_service", SERVICE_ERROR);
    }
    if (response.status === 429 && data?.error === "shared_quota" && ["daily", "minute", "unknown"].includes(data.quota)) {
      const detail = data.quota === "daily" ? " 공용 프로젝트의 하루 이용 한도에 도달했습니다." : data.quota === "minute" ? " 공용 프로젝트의 분당 이용 한도에 도달했습니다." : "";
      const error = new AiError("shared_quota", `공용 무료 AI 이용 한도에 도달했습니다. 잠시 후 다시 시도하거나 본인의 Gemini API 키로 계속 이용할 수 있습니다.${detail}`);
      error.quota = data.quota;
      if (Number.isFinite(data.retryAfterSeconds) && data.retryAfterSeconds > 0) error.retryAfterSeconds = Math.min(Math.ceil(data.retryAfterSeconds), 86400);
      throw error;
    }
    if ((response.status === 429 || response.status === 503) && data?.error === "busy") throw new AiError("shared_busy", "공용 무료 AI 서비스가 혼잡합니다. 잠시 후 다시 시도해 주세요.");
    if (response.status === 403 && ["verification_failed", "verification_required"].includes(data?.error)) {
      // 통행증을 거절당했거나(만료·IP 변경 등) 이용 확인을 요구받으면, 화면이 이용 확인을 새로 받아 다시 묻게 한다.
      if (pass) clearSharedPass();
      const error = new AiError("shared_verification", "공용 무료 AI 이용 확인이 유효하지 않거나 만료되었습니다. 다시 시도해 주세요.");
      error.needsVerification = verificationToken === undefined;
      throw error;
    }
    if (response.status !== 200 || typeof data?.summary !== "string" || !Array.isArray(data.recommendations) || !Array.isArray(data.combinations)) throw new AiError("shared_service", SERVICE_ERROR);
    return JSON.stringify(data);
  } catch (error) {
    if (signal?.aborted) throw new AiError("cancelled", "요청을 취소했습니다.");
    if (error instanceof AiError) throw error;
    throw new AiError("shared_service", SERVICE_ERROR);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
