// 공용 무료 AI 서버에는 질문과 공개 데이터 후보만 보낸다. 개인 API 키는 받지 않는다.
import { AiError } from "../errors.js";

const TIMEOUT_MS = 60_000;
const SERVICE_ERROR = "공용 무료 AI 서비스에 연결하지 못했거나 정상 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.";

export function sharedGeminiUrl(config) {
  try {
    const url = new URL(config?.shared?.url ?? "");
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (url.protocol === "https:" || local) && !url.username && !url.password && !url.search && !url.hash ? url.href : "";
  } catch {
    return "";
  }
}

export async function askSharedGemini({ url, question, candidates, verificationToken, signal }) {
  if (signal?.aborted) throw new AiError("cancelled", "요청을 취소했습니다.");
  if (typeof verificationToken !== "string" || !verificationToken.trim() || verificationToken.length > 2048) throw new AiError("shared_verification", "공용 무료 AI 이용 확인을 완료하지 못했습니다. 다시 시도해 주세요.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, candidates, verificationToken }),
      credentials: "omit",
      signal: controller.signal,
    });
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
    if (response.status === 429 && data?.error === "busy") throw new AiError("shared_busy", "공용 무료 AI 서비스가 혼잡합니다. 잠시 후 다시 시도해 주세요.");
    if (response.status === 403 && data?.error === "verification_failed") throw new AiError("shared_verification", "공용 무료 AI 이용 확인이 유효하지 않거나 만료되었습니다. 다시 시도해 주세요.");
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
