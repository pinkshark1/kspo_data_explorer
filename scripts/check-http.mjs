// 브라우저·외부 API 없이 인증정보 비노출과 취소된 요청의 전송 방지를 점검한다.
import assert from "node:assert/strict";
import { postJson, badRequestError } from "../src/ai/providers/http.js";

const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async () => {
  calls += 1;
  return { status: 200, json: async () => ({ ok: true }) };
};

try {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(postJson({ url: "https://example.invalid", signal: controller.signal, service: "AI" }), { code: "cancelled" });
  assert.equal(calls, 0, "취소된 요청은 fetch를 호출하지 않아야 한다");
  const result = await postJson({ url: "https://example.invalid", body: {}, service: "AI" });
  assert.deepEqual(result, { status: 200, data: { ok: true } });
  assert.equal(calls, 1);

  const sensitive = "credential-echo-private-test-value";
  const error = badRequestError({ error: { message: sensitive } }, "Gemini");
  assert.equal(error.code, "server");
  assert.ok(!error.message.includes(sensitive));
  assert.match(error.message, /요청을 거절/);
  console.log("PASS HTTP: 취소 시 전송 0회, 정상 응답, 외부 오류 본문 비노출");
} finally {
  globalThis.fetch = originalFetch;
}
