# 질문 검색 (AI 데이터 추천)

“체육시설 안전과 연계할 수 있는 데이터가 뭐 있어?” 처럼 **문장으로 물으면 관련 공개 데이터를 이유와 함께 골라 주는** 기능입니다. 화면의 ‘질문 검색’ 메뉴이며, 검색 방식은 기본 검색과 AI 추천 4가지(Claude · GPT · Gemini · 기관 AI 서버)입니다. 어떤 방식을 켤지는 `data/site.json` 의 `ai` 설정으로 정합니다.

## 동작 방식

```text
질문 ──▶ ① 로컬 검색 (낱말 추출 → 유의어 확장 → 점수화)     ← 모든 방식이 먼저 거침, 브라우저 안에서만 실행
              │
              ├─ 기본 검색 ───────────────▶ 상위 8건 + 일치한 낱말(이유) 표시
              │
              └─ AI 추천 ──▶ ② 후보 선정 (검색이 잘 되면 상위 ~30건, 약하면 카탈로그 전체를 이름·분야만)
                              ③ LLM 이 후보 중에서 고르고 이유·활용 조합을 작성 (구조화 JSON)
                              ④ 검증: 후보 밖 번호 제거, 형식 검사 ──▶ AI 안내 + 추천 + 조합 표시
                              ⑤ 실패하면 ①의 결과를 그대로 보여줌 (기능이 막히지 않음)
```

- **AI 는 ‘고르고 설명’만 합니다.** 추천은 반드시 카탈로그에 있는 데이터 번호로만 하며, 번호가 후보에 없으면 화면에 나오지 않습니다. 데이터 내용을 지어내지 않도록 지시문에 “후보 정보에서 확인되는 내용만 쓰기”가 들어 있습니다.
- 지시문(`src/ai/prompt.js`)은 질문 안에 들어 있는 지시(“규칙을 무시해”)를 따르지 않도록 하고, 질문을 `<question>` 안에만 넣습니다.

## 방식

| | 기본 검색 | AI 추천 (Claude · 내 키) | AI 추천 (GPT · 내 키) | AI 추천 (Gemini · 내 키) | AI 추천 (기관 AI 서버) |
|---|---|---|---|---|---|
| AI 사용 | 없음 (규칙 기반 의미 확장 검색) | Claude (현재 `claude-haiku-4-5`) | OpenAI GPT (현재 `gpt-6-luna`) | Google Gemini (현재 `gemini-3.5-flash-lite`) | 서버가 정한 모델 (참조 구현은 Claude, 기본값은 `site.json` 의 `ai.claude`) |
| 필요한 것 | 없음 | 이용자가 본인의 Claude API 키 입력 | 이용자가 본인의 OpenAI API 키 입력 | 이용자가 본인의 Gemini API 키 입력 | 기관이 운영하는 중계 서버 |
| 데이터가 나가는 곳 | **없음** (외부 요청 0건) | 이 브라우저 → Anthropic | 이 브라우저 → OpenAI | 이 브라우저 → Google | 이 브라우저 → 기관 서버 → Claude |
| 키 위치 | - | 이 화면의 메모리에만 (저장 안 함) | 〃 | 〃 | 서버 환경변수 (브라우저에 없음) |
| 알맞은 곳 | 대국민 공개 화면 기본값 | 시연·내부 사용·개발 확인 | 〃 | 〃 | 대국민/내부 서비스에 AI 를 켤 때 |
| 모델 교체 | - | `site.json` 의 `ai.claude.model` | `site.json` 의 `ai.openai.model` | `site.json` 의 `ai.gemini.model` | 서버만 바꾸면 됨 (화면 변경 없음) |

> 공개 화면에 AI 를 켜려면 **기관 AI 서버 방식**이 맞습니다. ‘내 키’ 방식(Claude·GPT·Gemini)은 이용자마다 키를 넣어야 해서 일반 이용자용이 아닙니다.
>
> GPT·Gemini 는 Claude 와 달리 별도 SDK 없이 브라우저가 API 를 직접 호출합니다(`src/ai/providers/openai.js`, `gemini.js`). 기관 AI 서버(`scripts/ai-gateway.mjs`)는 Claude 만 중계합니다.

## 설정 — `data/site.json` 의 `ai`

현재 배포 설정은 **기본 검색 + Claude · GPT · Gemini(모두 이용자 본인 키)** 이며, 모델은 **`claude-haiku-4-5`**(2026-10-01 담당자 확정), **`gpt-6-luna`**, **`gemini-3.5-flash-lite`**(GPT·Gemini 는 같은 날 추가, 모델명은 각 서비스 공식 문서의 모델 목록에서 가장 작고 저렴한 것으로 정함) 입니다.

```jsonc
"ai": {
  "enabled": true,                  // false 면 메뉴 자체가 사라짐
  "navLabel": "질문 검색",
  "modes": ["local", "claude", "openai", "gemini"],   // 켤 방식: local | claude | openai | gemini | gateway  (local 은 항상 포함)
  "defaultMode": "local",
  "claude":  { "model": "claude-haiku-4-5", "maxTokens": 16000, "refusalFallback": false,
               "keyGuideUrl": "https://console.anthropic.com/settings/keys" },
  "openai":  { "model": "gpt-6-luna", "maxTokens": 16000, "keyGuideUrl": "https://platform.openai.com/api-keys" },
  "gemini":  { "model": "gemini-3.5-flash-lite", "maxTokens": 16000, "keyGuideUrl": "https://aistudio.google.com/apikey" },
  "gateway": { "url": "", "label": "기관 AI 서버" },   // url 이 비어 있으면 gateway 는 나타나지 않음
  "exampleQuestions": [ "..." ],    // 화면의 예시 질문 (모두 결과가 나오는지 npm run check:search 가 확인)
  "notice": "추천 결과는 참고용입니다. ..."
}
```

**Claude 모델 선택** (`ai.claude`)

| 모델 | 특징 | 설정 |
|---|---|---|
| `claude-haiku-4-5` **(현재)** | 가장 저렴·빠름. `effort` 를 받지 않으므로 **`effort` 항목을 두지 않고 `refusalFallback` 은 `false`** | `effort` 없음, `refusalFallback: false` |
| `claude-sonnet-5-5` | 더 정확한 추천이 필요할 때 | `effort: "low"`, `refusalFallback: false` |
| `claude-opus-5-5` | 가장 정확. 이 용도에서는 `effort: "low"` 로 충분할 것으로 보나 **실제 응답으로 검증하지는 못했습니다** | `effort: "low"`, `refusalFallback: true` |

- **Haiku 4.5 는 실제 키로 확인하지 못했습니다.** 구조화 출력(JSON 스키마)을 지원하는 모델로 문서에 나와 있고 요청 형식도 SDK 타입과 모의 서버로 확인했지만, 운영 전에 실제 키로 여러 질문을 해 보고 추천 품질을 확인한 뒤 더 정확한 모델이 필요하면 위 표처럼 바꾸세요.
- 모델·계정이 일부 옵션을 받지 않아 400 이 오면 **옵션을 하나씩 빼며 다시 시도**합니다: ① 거절 시 다른 모델로 이어 처리하는 폴백(`refusalFallback: true` 일 때만) → ② 구조화 출력(JSON 스키마) → 형식 지시문으로 대체. 화면 오류 없이 결과를 받기 위한 안전장치입니다.
- 호출 한 번의 크기는 지시문 약 700자 + 후보 정보입니다. 검색이 잘 된 질문은 전체 약 1만 자(후보 약 30건, 예시 질문 5개 측정 10,100~10,900자), 검색이 약해 카탈로그 전체를 보내는 경우 약 1만 3천7백 자(192건, 이름·분야·유형만)입니다. (2026-10-01 측정. 측정값은 문자 수이며, 토큰·비용은 모델과 요금표에 따라 다르므로 API 응답의 `usage` 로 확인하세요.)

**GPT · Gemini 호출 방식** (`ai.openai`, `ai.gemini`)

| | GPT (OpenAI) | Gemini (Google) |
|---|---|---|
| 호출 | `POST https://api.openai.com/v1/responses` (Responses API) | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` |
| 키 전달 | `Authorization: Bearer` 헤더 | `x-goog-api-key` 헤더 (주소에 넣지 않음) |
| 응답 형식 | `text.format` 의 JSON 스키마(`strict`) | `responseMimeType: application/json` + `responseJsonSchema` |
| 옵션 거절(400) 시 | 스키마를 빼고 지시문으로 JSON 형식을 요구해 한 번 더 시도 | 〃 |
| 기타 | `store: false` (OpenAI 쪽에 응답을 저장하지 않음), `max_output_tokens` 에 `maxTokens` | `maxOutputTokens` 에 `maxTokens`, 생각 과정(`thought`) 조각은 답에서 뺌 |
| 거절·중단 | 응답의 `refusal`·`content_filter` → ‘답하지 못했습니다’, `max_output_tokens` 로 끊김 → ‘도중에 끊겼습니다’ | `promptFeedback.blockReason`·`SAFETY` 등 → ‘답하지 못했습니다’, `MAX_TOKENS` → ‘도중에 끊겼습니다’ |

- Gemini 는 잘못된 API 키에도 401 이 아니라 400(`API_KEY_INVALID`)을 돌려주므로, 이 경우 ‘키를 확인해 주세요’ 안내를 하고 다시 시도하지 않습니다.
- **키는 방식마다 따로 보관**합니다. Claude 키를 입력한 채 GPT 로 바꿔 질문해도 Claude 키는 OpenAI 로 나가지 않습니다.
- **모델명과 요청 형식은 실제 키로 확인하지 못했습니다.** 각 서비스의 공식 문서(2026-10-01 조회)에서 모델 목록과 요청·응답 형식을 확인하고 모의 서버로 점검했지만, 모델 이름이나 지원 옵션이 바뀌었을 수 있습니다. 운영 전에 실제 키로 여러 질문을 해 보고, 모델이 없다는 안내(‘설정된 모델을 찾지 못했습니다’)가 나오면 `site.json` 의 `model` 을 고치세요. 호출이 실패해도 기본 검색 결과가 대신 나오므로 화면이 막히지는 않습니다.

## 기관 AI 서버 (중계 서버) 운영

`scripts/ai-gateway.mjs` 는 키를 서버에만 두는 참조 구현입니다. (Node.js 20 이상, 추가 서버 프로그램 불필요)

```bash
ANTHROPIC_API_KEY=... \
AI_GATEWAY_ORIGINS=https://화면을-서비스하는-주소 \
AI_GATEWAY_HOST=0.0.0.0 \
npm run ai-gateway
```

| 환경변수 | 설명 | 기본값 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API 키 (소스·저장소에 넣지 않음) | (필수) |
| `AI_GATEWAY_ORIGINS` | 호출을 허용할 화면 주소, 쉼표 구분. 그 밖의 주소는 403 | `http://localhost:4173` |
| `AI_GATEWAY_ALLOW_NO_ORIGIN` | `true` 면 Origin 헤더 없는 요청(서버 간 호출)도 허용 | `false` |
| `AI_GATEWAY_MODEL` / `_EFFORT` / `_MAX_TOKENS` / `_REFUSAL_FALLBACK` | 모델 / effort(`none` 이면 미전송) / 응답 최대 토큰(상한 8000) / 거절 폴백 | `data/site.json` 의 `ai.claude` 값 |
| `AI_GATEWAY_RATE_PER_MIN` | IP 당 분당 요청 수 (거절된 요청은 세지 않음) | 20 |
| `AI_GATEWAY_DAILY_LIMIT` | 하루 전체 요청 수 상한, 한국 시간 기준 (0 이면 제한 없음) | 2000 |
| `AI_GATEWAY_MAX_CONCURRENT` | 동시에 처리하는 요청 수 상한 | 4 |
| `AI_GATEWAY_MAX_PROMPT_CHARS` | 후보 정보 전체 글자 수 상한 (비용 남용 방지) | 40000 |
| `AI_GATEWAY_TRUST_PROXY` | `true` 면 `X-Forwarded-For` 첫 주소를 이용자 IP 로 사용 (리버스 프록시 뒤에서만) | `false` |
| `AI_GATEWAY_PORT` / `AI_GATEWAY_HOST` | 포트 / 바인딩 주소 | 8787 / 127.0.0.1 |
| `AI_GATEWAY_ORG_NAME` / `_SERVICE_NAME` | 지시문에 쓰는 기관·서비스 이름 | 국민체육진흥공단 / KSPO 데이터 지도 |
| `ANTHROPIC_BASE_URL` | (시험용) Anthropic API 주소 바꾸기 | - |

- **허용 주소(Origin) 검사는 인증이 아닙니다.** 다른 사이트의 브라우저 화면을 막을 뿐, curl 같은 도구는 Origin 을 흉내 낼 수 있습니다. 공개 운영 시에는 HTTPS 리버스 프록시(또는 사내 API 게이트웨이·WAF) 뒤에 두고 앞단의 접근 제어를 함께 적용하고, 내장 **하루 한도·동시 처리 한도·후보 크기 상한**으로 비용 남용을 제한하세요. 내장 한도는 메모리 기반이라 서버를 여러 대 두면 합산되지 않습니다. 프록시 뒤에서는 `AI_GATEWAY_TRUST_PROXY=true` 를 켜야 이용자별 IP 로 호출 제한이 적용됩니다.
- 서버는 질문 내용을 **기록하지 않습니다**(시각·경로·상태·소요시간만 출력). 요청이 잘못되면 400(너무 크면 413), AI 가 거절하면 422, Claude 쪽 문제는 502 로만 알리고 외부 서비스의 오류 내용·종류는 응답에 담지 않습니다. 이용자가 연결을 끊으면 Claude 호출도 멈춥니다.
- **다른 모델/서비스로 바꾸려면** 같은 요청·응답 규격의 서버를 두면 됩니다. 화면 코드는 바꾸지 않습니다.

```text
요청  POST <url>   { "question": "...", "candidates": [ { "no": 80, "name": "...", "field": "...", "type": "파일", ... } ] }
응답  200          { "summary": "...", "recommendations": [ { "no": 80, "relevance": "high|medium|low", "reason": "..." } ],
                     "combinations": [ { "title": "...", "nos": [80, 86], "idea": "..." } ] }
```

보안 정책에 맞게 CSP `connect-src` 에 호출 대상(`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`, 기관 AI 서버 중 켠 것)을 추가해야 합니다. (`DEPLOYMENT.md` 참고)

## 개인정보·보안

- **보내는 정보**: 이용자가 입력한 질문 + 후보 데이터의 공개 정보(이름, 분야, 제공 형태, 설명 요약, 컬럼명). 데이터 샘플 값은 보내지 않습니다. 화면에 “개인정보·비밀번호를 입력하지 마세요” 안내가 있습니다.
- **API 키**: ‘내 키’ 방식(Claude·GPT·Gemini)에서는 입력란(암호 형식)에서 메모리로만 쓰이며 `localStorage`·쿠키·주소에 남지 않습니다. 화면을 벗어나면 사라집니다. 질문과 결과는 다른 화면에 다녀와도 유지되지만 키는 유지되지 않습니다. 키는 서비스별로 따로 보관해 다른 서비스로 보내지지 않습니다. (`npm run check:ai` 가 확인) 브라우저는 암호 입력란을 보고 ‘비밀번호 저장’을 물을 수 있으니 거절하세요.
- **브라우저 직접 호출**: Claude 는 Anthropic SDK 의 `dangerouslyAllowBrowser` 옵션을 쓰고, GPT·Gemini 는 SDK 없이 `fetch` 로 부릅니다. 모두 이용자 본인의 키를 본인 브라우저에서 쓰는 구조라서 사용하지만, 공용 PC에서는 키를 입력하지 않도록 안내하세요.
- **SDK 지연 로딩**: Claude SDK(약 220KB)는 ‘AI 추천 (Claude)’로 처음 질문할 때만 내려받습니다. GPT·Gemini 는 SDK 가 없습니다. 기본 검색만 쓰면 AI 관련 파일을 받지도 외부로 요청하지도 않습니다.

## 검토했으나 도입하지 않은 방식 — Sign in with ChatGPT (2026-10-01 검토)

OpenAI 가 2026-09-29 개발자 행사에서 ‘Sign in with ChatGPT’ 를 확장해, 이용자가 **본인의 ChatGPT 요금제 사용량**으로 외부 앱의 AI 기능을 쓰게 하는 방식을 발표했습니다. “이용자가 키 없이 로그인만 하면 되고 비용은 이용자 몫”이라는 점이 이 프로젝트의 ‘내 키’ 방식과 목적이 비슷해 도입 가능성을 확인했고, **현재는 도입하지 않기로 했습니다.** (공식 문서에서 확인한 내용만 적습니다.)

| 확인한 사실 | 이 프로젝트에 미치는 영향 |
|---|---|
| 웹사이트 연동은 OAuth 2.0 인증 코드 + PKCE + OpenID Connect 이며 **백엔드가 인증 코드 교환과 ID 토큰 검증을 맡아야 한다**고 안내함. 이 연동이 주는 것은 **로그인(이름·이메일·사진)** 뿐이고 요금제 사용량 공유는 별도 절차임 | 이 서비스는 정적 파일만 서빙하는 구조(백엔드 없음)라 그대로 붙일 수 없음. 붙이려면 기관 서버가 먼저 필요 |
| 요금제 사용량 공유(token sharing) 문서는 “**오픈소스·로컬에서 실행되는 앱**” 대상이며, 사용자·워크스페이스에 묶인 `client_id` 와 설치 환경(노트북·VM)별 호스트 ID 를 발급·보관하는 방식. 호출 대상은 Responses API | 불특정 다수가 접속하는 공공 웹 서비스가 아니라 개인 PC 에서 도는 개발 도구용 구조 |
| 상업용 앱은 “일부 선별된 파트너에게만” 제공되고 **관심 양식(대기 명단)** 으로 신청. 클라이언트 ID 는 신청해서 받아야 함. 요금제 사용량 공유는 오픈소스 파트너와 지정 고객에 한정 | 신청·승인 전에는 시험조차 할 수 없고, 승인 여부·시점·조건을 이 쪽에서 알 수 없음 |
| OpenAI 모델용 경로임 | 이 검토 당시에는 확정한 모델이 Claude 뿐이어서 담당자 확정이 필요했음. (이후 2026-10-01 담당자 요청으로 **이용자 본인의 OpenAI API 키로 GPT 를 호출하는 방식**이 추가되었다. ‘Sign in with ChatGPT’ 와는 다른 방식) |

추가로, 공공기관 서비스가 이용자 **개인 ChatGPT 계정**과 연결되면 개인정보 처리방침·정보보호 담당 확인 대상이 늘어납니다. 질문 내용이 OpenAI 로 가는 경로가 추가되는 점도 같습니다.

- **지금 구조가 이미 대안입니다.** ‘기본 검색(외부 요청 0건)’을 기본값으로 두고, AI 는 이용자 본인 키(Claude) 또는 기관 AI 서버(`gateway`)로 선택해서 씁니다.
- **다시 검토할 조건**: ① 기관이 관심 양식으로 신청해 클라이언트 ID 를 받음, ② 기관 AI 서버 운영(`gateway` 가 로그인 처리와 호출 중계를 맡는 자리), ③ (OpenAI 모델 추가는 위 ‘내 키’ 방식으로 이미 반영됨) ④ 정보보호 담당 확인. 이때도 화면 쪽은 `ai.modes` 에 방식을 하나 더하는 형태로 붙일 수 있게 `gateway` 의 요청·응답 규격을 유지해 두었습니다.
- 참고(2026-10-01 확인): <https://developers.openai.com/siwc/website> · <https://developers.openai.com/siwc/token-sharing-open-source> · <https://developers.openai.com/siwc/request-client-id> · <https://learn.chatgpt.com/docs/whats-new/devday-2026>. 정책·제공 범위는 계속 바뀔 수 있으니 도입을 다시 논의할 때 공식 문서로 재확인하세요.

## 품질 점검과 한계

| 명령 | 내용 |
|---|---|
| `npm run check:search` | 기본 검색: 질문 30개(기대 데이터가 상위 5건에 있는지), 관계없는 질문 8개(자신 있게 추천하지 않는지), 예시 질문이 모두 결과를 내는지. 현재 적중률 100%, 재현율 96% |
| `npm run check:ai` | 모의 서버로 AI 경로 102개 점검: 중계 서버(요청 형식·허용 주소·입력 검사·호출/하루/동시 처리 한도·폴백·거절·형식 오류·연결 끊김), 브라우저(헤더·본문·결과·오류별 안내·키 비저장·SDK 지연 로딩·취소와 최신 질문 우선·초점 이동·상태 유지), GPT·Gemini 직접 호출(주소·키 헤더·본문 형식, 구조화 출력 거절 시 재시도, 오류별 안내, 서비스별 키 분리) |

**한계 (솔직하게)**
- 위 질문 세트와 유의어 사전은 같은 사람이 만들었습니다. 적중률 100% 는 **개발 중 확인용 수치**이지 이용자 전체에 대한 성능이 아닙니다. 실제 이용자 질문을 모아 `scripts/check-search.mjs` 의 `CASES` 에 추가해 가며 보강하세요.
- **실제 Claude·GPT·Gemini 응답으로는 시험하지 못했습니다.** (개발 환경에 API 키가 없었음) 요청 형식은 공식 SDK 타입 정의(Claude)·공식 문서(GPT·Gemini)와 모의 서버로 확인했으며, 운영 전 실제 키로 `AI 추천` 을 몇 번 눌러 응답과 비용(`usage`)을 확인해야 합니다. 특히 GPT·Gemini 는 모델명이 문서 조회 시점 기준입니다.
- 기본 검색은 의미를 ‘이해’하는 것이 아니라 낱말·유의어 일치로 찾습니다. 사전에 없는 표현은 놓칠 수 있고(그때 AI 방식이 도움이 됨), 질문과 맞는 데이터가 없으면 “가까운 후보”라고 알립니다. 카탈로그에 없는 합성어(예: ‘채용공고’)는 결과 순서는 맞아도 ‘가까운 후보’ 안내가 보수적으로 나올 수 있습니다.
- 새 데이터가 추가되면 이름·분야 낱말이 사전에 없을 수 있으니 `src/ai/thesaurus.js` 를 함께 확인하세요.
