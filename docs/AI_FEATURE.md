# 질문 검색 (AI 데이터 추천)

“체육시설 안전과 연계할 수 있는 데이터가 뭐 있어?” 처럼 **문장으로 물으면 관련 공개 데이터를 이유와 함께 골라 주는** 기능입니다. 화면의 ‘질문 검색’ 메뉴이며, 검색 방식은 **기본 검색**과 **AI 추천** 두 가지입니다(공용 중계를 쓰면 ‘AI 추천 (Claude·Gemini)’으로 표시). 현재 운영 화면은 공용 중계에 연결되어 있어(2026-10-13) 키 없이 공용 무료 AI를 먼저 쓰고, 공용 한도에 도달했을 때 이용자 본인 키로 계속할 수 있습니다. 공용 중계 주소를 비우면 본인 키 방식이 됩니다. 사이트 자체(정적 파일)는 서버·DB·로그인 없이 동작하고, AI 추천만 공용 무료 중계 서버(Cloudflare Workers)를 거칩니다. 어떤 방식을 켤지는 `data/site.json`의 `ai` 설정으로 정합니다.

> **모델 선택 기준:** 결제를 연결하지 않은 Google 무료 프로젝트로 공용 무료 호출(`Gemini 3.5 Flash-Lite` 고정)을 운영할 수 있고, 한도에 도달하면 이용자가 무료로 발급받는 개인 키 하나로 `Gemini 3.5 Flash-Lite`와 오픈 모델 `Gemma 4 31B`를 골라 쓸 수 있는 Gemini API를 택했습니다. 모델이 한 종류에 묶이지 않는 구조이며, 두 모델 모두 실제 키로 동작을 확인했습니다(아래 ‘모델 선택’). 개발 중에는 Claude·GPT 개인 키 연결도 시험했으나 이용자에게 유료이거나 사용 한도 문제가 있어 화면에서 뺐습니다(이전 구현은 git 이력 커밋 `e5a578f`). 2026-10-15부터 공용 중계는 Claude 구독 플랜에 포함된 월 API 크레딧으로 `Claude Haiku 5.5`를 먼저 쓰고, 크레딧 소진·오류 때는 무료 Gemini로 넘깁니다(아래 ‘Claude 우선’). 이용자에게는 계속 무료입니다.

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

| | 기본 검색 | AI 추천 (공용 무료) | AI 추천 (내 키) |
|---|---|---|---|
| 현재 상태 | 선택 가능 | **기본값** | 공용 한도 도달 시 안내하며 직접 선택도 가능 |
| AI 사용 | 없음 (규칙 기반 의미 확장 검색) | `claude-haiku-5-5` 우선, 답하지 못하면 `gemini-3.5-flash-lite` | Gemini 또는 Gemma 4를 화면에서 선택 |
| 필요한 것 | 없음 | 이용 확인(Cloudflare Turnstile, 필요 시 간단한 상호작용) | 이용자 본인의 Gemini API 키 |
| 데이터가 나가는 곳 | **없음** (외부 요청 0건) | 브라우저 → 중계 서버 → Anthropic(실패 시 Google), 이용 확인은 Cloudflare | 브라우저 → Google |
| 키 위치 | - | 중계 서버 Secret | 이 화면의 메모리에만 (저장 안 함) |
| 한도·요금 | AI 사용 없음 | Claude는 운영 조직의 포함 크레딧 안에서만, Gemini는 결제를 연결하지 않은 공용 Free 프로젝트 한도 | 본인 프로젝트의 한도·요금 적용 |
| 모델 설정 | - | 서버의 고정 모델 | `site.json`의 `ai.gemini.models` |

> 공용 무료 AI는 `gemini.shared.url`로 연결합니다(현재 운영 화면은 연결됨). 이 주소를 비우면 본인 키 방식으로 동작합니다. 기존 `gateway`(기관 AI 서버 참조 구현)는 꺼진 상태로 유지하며, 공용 무료 AI를 위해 켤 필요가 없습니다. 공용 중계의 Claude 호출은 참조 구현과 같은 코드(`src/ai/providers/claude.js`)를 씁니다.

## 공용 무료 AI → 본인 키 전환

1. `gemini.shared.url`과 공개용 `turnstileSiteKey`가 설정되면 AI 추천은 키 입력 없이 공용 무료 AI 중계를 호출합니다. 호출 전에 이용 확인을 거치며, 필요한 경우 화면에서 확인 절차를 진행합니다. 예시 버튼은 저장된 응답을 보여 주므로 이용 확인이나 무료 AI 호출 한도를 쓰지 않습니다.
2. Google의 한도 오류가 확인되면 분당·하루·종류 미확인 한도를 구분해 안내하고, **내 키로 계속하기**, **무료 AI 다시 시도**, **기본 검색으로 보기**를 제공합니다. 네트워크 장애·인증 오류·서버 혼잡은 한도 소진으로 표시하지 않습니다.
3. 이용자가 본인 키 사용을 선택하면 키·모델 입력이 나타납니다. 같은 질문을 그대로 다시 보낼 수 있으며, 개인 키는 브라우저에서 Google로만 전달합니다. 공용 서버나 브라우저 저장소에 저장하지 않고 화면을 벗어나면 지웁니다. 본인 프로젝트의 한도·요금 설정이 적용됩니다.

공용 서버 구현은 `server/shared-ai-worker.js`, Cloudflare 설정은 `server/wrangler.toml`입니다. 화면 배포 방식은 유지하고 이 중계만 별도로 배포합니다. 입력은 `{ question, candidates, verificationToken }`, 성공 응답은 기존 추천 JSON입니다. 서버는 매번 이용 확인 토큰을 검증하고 발급 호스트·작업명까지 확인한 뒤 Google을 호출합니다. 토큰은 한 번만 사용하며 Google에 보내지 않습니다. 한도 응답은 HTTP 429와 `{ error: "shared_quota", quota: "daily" | "minute" | "unknown", retryAfterSeconds?: number }`입니다. 한도가 0인 사용 불가 모델·프로젝트는 서비스 오류로 처리합니다.

Google이 일시 과부하로 500·503(`UNAVAILABLE`, “This model is currently experiencing high demand”)을 돌려주면 서버가 1초·2.5초 뒤 같은 요청을 최대 2번 더 보냅니다(이용 확인은 다시 하지 않음). 그래도 실패하면 HTTP 503과 `{ error: "busy" }`를 돌려주고, 화면은 한도 소진이 아닌 ‘혼잡’으로 안내하며 기본 검색 결과를 보여 줍니다. 한도 소진(429)은 다시 보내지 않습니다. 2026-10-13 공개 화면 점검에서 이 503이 한도와 무관하게 간헐적으로(약 0.3초 만에) 발생하는 것을 확인했습니다.

**Claude 우선 (2026-10-15~).** 중계 서버에 Secret `ANTHROPIC_API_KEY`와 확인값 `ANTHROPIC_CREDITS_ONLY_CONFIRMED=true`가 있으면 `claude-haiku-5-5`(effort `low`, 출력 상한 8,192토큰, 구조화 출력)를 먼저 부릅니다. 20초 안에 답하지 못하거나 크레딧 소진(`billing_error`)·한도·인증·서버 오류·형식 오류가 나면, 이용 확인을 다시 하지 않고 같은 질문을 Gemini에 묻습니다. Claude가 거절(`refusal`)한 질문은 Gemini로 우회하지 않습니다. 크레딧 소진·키 오류가 나면 같은 Worker 인스턴스에서 10분, 한도(429)는 1분 동안 Claude를 건너뜁니다. 어느 쪽이 답했는지는 응답 헤더 `X-AI-Provider`(`claude`·`gemini`)로 확인합니다(브라우저 개발자 도구). Gemini 설정이 없는 상태에서 크레딧이 소진되면 공용 한도 소진(`shared_quota`, `quota: "unknown"`)으로 알려, 화면이 본인 키 안내를 보여 줍니다. 두 값 중 하나라도 없으면 Claude를 부르지 않고 이전과 같이 Gemini만 씁니다.

Claude는 Claude 구독 플랜(Max·Team)에 포함되어 결제 주기마다 Anthropic Console 조직으로 들어오는 API 크레딧으로 호출합니다. 크레딧은 이월되지 않습니다. 조직에 구매한 크레딧이 없고 자동 충전이 꺼져 있으면, 크레딧이 바닥난 뒤 Anthropic이 요청을 거절하므로 크레딧을 넘어 과금되지 않습니다(영업팀 청구서로 결제하는 조직은 예외). `ANTHROPIC_CREDITS_ONLY_CONFIRMED=true`는 운영자가 이 상태를 확인했다는 표시이며, 결제 상태를 조회하거나 과금을 막는 기능은 아닙니다. 같은 조직의 모든 키가 같은 잔액을 쓰므로 다른 용도의 키를 만들면 크레딧을 나눠 쓰게 됩니다. [Anthropic 안내](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)

공용 Gemini 키에는 **결제가 연결되지 않은 Free 프로젝트**를 사용합니다. 유료 프로젝트의 API 키는 무료 호출량 이후에만 과금되는 키가 아닙니다. 키가 속한 프로젝트의 등급을 AI Studio에서 확인한 뒤 서버 설정을 켜야 합니다. `GEMINI_FREE_TIER_CONFIRMED=true`는 운영자의 확인 표시이며 Google 결제 상태를 자동 조회하거나 과금을 차단하는 기능은 아닙니다. 이후에도 해당 프로젝트에 결제를 연결하지 않습니다. [Google 결제 안내](https://ai.google.dev/gemini-api/docs/billing)

한도는 API 키별이 아니라 **프로젝트별 RPM·입력 TPM·RPD**로 적용합니다. 실제 수치는 [AI Studio 비율 제한](https://aistudio.google.com/rate-limit)에서 확인합니다. 일일 한도는 미국 태평양 시간 자정에 갱신되며 한국 시간으로 고정된 자정이 아닙니다. 한도 수치를 화면 코드에 고정하지 않고 실제 오류를 기준으로 안내합니다. [Google 한도 안내](https://ai.google.dev/gemini-api/docs/rate-limits)

서버는 모델을 `claude-haiku-5-5`와 `gemini-3.5-flash-lite`로 고정하고 출력 상한 8,192토큰, 요청·응답 크기 상한, 시간 제한을 적용합니다. Turnstile 검증 외에 CORS 허용 Origin, Cloudflare의 IP별 요청 제한(지역별 5회/분), Worker 인스턴스별 동시 처리 4건도 적용합니다. 본문을 읽기 전에 IP 제한을 적용하므로 잘못된 요청도 제한에 포함됩니다. 이 보호 장치가 자동 호출이나 한도 소진을 완전히 막는 것은 아니며, 전체 무료 한도는 Google 프로젝트가 적용합니다. 질문·키·이용 확인 토큰·외부 오류 본문을 로그에 쓰지 않습니다. IP별 요청 제한이나 동시 처리 상한에 걸리면 HTTP 429와 `{ error: "busy" }`(`Retry-After` 60초·5초)를 돌려주며, 화면은 이를 공용 한도 소진(`shared_quota`)과 구분해 ‘혼잡’으로 안내합니다.

`npm run check:shared-ai`(27개)는 중계 서버의 이용 확인 토큰 검증·허용 Origin·요청 제한·크기·시간 제한·한도 종류 구분·500/503 재시도와 Claude 우선 호출·Gemini 전환을, `npm run check:ai`(146개)는 무료 호출·개인 키 전환·혼잡·장애·취소·키 비저장·모바일 화면을 검사합니다. 모두 모의 응답을 사용합니다. 실제 배포 확인은 따로 했습니다. 2026-10-13 공개 화면에서 키 없이 실제 추천이 나오는 것을 확인했고, 재시도 보완 전 실패 중 1번이 Google 503으로 확인되어 재시도를 추가했습니다([기록](evidence/2026-10-13-shared-ai-live.md)). 2026-10-15에는 Claude를 켠 뒤 공개 화면에서 Claude가 실제로 추천하는 것(응답 헤더 `X-AI-Provider: claude`)을 확인했습니다([기록](evidence/2026-10-15-shared-ai-live.md)).

## 설정 — `data/site.json` 의 `ai`

현재 설정은 **공용 무료 AI를 먼저 사용하고 한도 도달 시 본인 키를 안내**합니다. 기본 검색도 선택할 수 있습니다. 공용 중계는 **`claude-haiku-5-5`**를 먼저, 답하지 못하면 **`gemini-3.5-flash-lite`**를 씁니다(모델은 서버에 고정). 본인 키로 전환하면 `gemini-3.5-flash-lite`와 **`gemma-4-31b-it`**를 고를 수 있습니다.

```jsonc
"ai": {
  "enabled": true,                  // false 면 메뉴 자체가 사라짐
  "navLabel": "질문 검색",
  "modes": ["local", "gemini"],     // 켤 방식: local | gemini | gateway  (local 은 항상 포함)
  "defaultMode": "gemini",
  "gemini":  {
    "model": "gemini-3.5-flash-lite",           // 기본 모델 (models 안에 있어야 함)
    "models": [                                  // 화면의 ‘모델’ 선택 목록. 하나뿐이면 선택 칸이 나오지 않음
      { "model": "gemini-3.5-flash-lite", "label": "Gemini 3.5 Flash-Lite" },
      { "model": "gemma-4-31b-it", "label": "Gemma 4 31B (오픈 모델)", "jsonMode": false }   // jsonMode:false = JSON 형식 지정을 받지 않는 모델
    ],
    "maxTokens": 16000,
    "shared": { "url": "https://ai.example.org/recommend", "turnstileSiteKey": "<공개 사이트 키>",   // 예시 값. 실제 중계 주소(…/recommend)와 공개 사이트 키로 교체. url을 비우면 본인 키 방식
                "name": "Claude·Gemini", "target": "Anthropic(Claude)·Google(Gemini)" },  // (선택) 검색 방식 이름과 전송 대상 안내. 중계가 Gemini만 쓰면 둘 다 지운다(기본: Gemini, Google(Gemini))
    "keyGuideUrl": "https://aistudio.google.com/apikey" },
  "gateway": { "url": "", "label": "기관 AI 서버" },   // url 이 비어 있으면 gateway 는 나타나지 않음
  "examplesFile": "ai-examples.json", // (선택) AI 호출 없이 보여 줄 저장된 AI 추천 예시 (npm run export:ai-examples 로 생성)
  "exampleQuestions": [ "..." ],    // 화면의 예시 질문 (모두 결과가 나오는지 npm run check:search 가 확인)
  "notice": "추천 결과는 참고용입니다. ..."
}
```

**Gemini 호출 방식** (`src/ai/providers/gemini.js`, 공통 부분은 `http.js`)

| 항목 | 내용 |
|---|---|
| 호출 | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` (SDK 없이 `fetch`) |
| 키 전달 | `x-goog-api-key` 헤더 (주소에 넣지 않음) |
| 응답 형식 | 1단계 `responseMimeType: application/json` + `responseJsonSchema` |
| 옵션 거절(400) 시 | 요구 수준을 단계적으로 낮춰 다시 시도: ② JSON 형식 지정 + 형식 지시문 → ③ 형식 지시문만 (화면 오류 없이 결과를 받기 위한 안전장치). `jsonMode: false` 인 모델은 처음부터 ③ |
| 기타 | `maxOutputTokens` 에 `maxTokens`, 생각 과정(`thought`) 조각은 답에서 뺌 |
| 거절·중단 | `promptFeedback.blockReason`·`SAFETY` 등 → ‘답하지 못했습니다’, `MAX_TOKENS` → ‘도중에 끊겼습니다’ |
| 한도·권한 | 429 → ‘요청이 너무 많거나 사용 한도에 도달했습니다’, 403 → 키 확인 안내, 404 → ‘설정된 모델을 찾지 못했습니다’ |
| 일시 오류 | 500·502·503·504(Google 쪽 내부 오류·과부하)가 20초 안에 오면 2초 뒤 같은 요청을 한 번 더 보냄. 그래도 실패하거나 오래 기다린 끝에 난 오류면 다시 보내지 않고 ‘일시적으로 응답하지 못했습니다… 다른 모델을 골라 보세요’ 안내 + 기본 검색 결과 |

**모델 선택** (`ai.gemini.models`, 화면의 ‘모델’ 칸)

| 모델 | 설명 | 상태 |
|---|---|---|
| `gemini-3.5-flash-lite` (기본) | Gemini 계열의 가볍고 빠른 모델. JSON 스키마 응답 사용 | **2026-10-02 담당자가 실제 키로 동작 확인** |
| `gemma-4-31b-it` | Gemma 계열의 오픈 모델(행정안전부 AI 공통기반이 지원하는 모델 계열). **같은 Gemini API 키**로 같은 주소에서 부르며, 공식 문서 기준 시스템 지시문은 지원하고 JSON 모드는 명시가 없어 형식 지시문만 쓴다 | **2026-10-02 담당자가 실제 키로 동작 확인** (요청 형식은 공식 문서와 모의 서버로도 점검). 가격표에는 무료(유료 없음)로 나옵니다 |

- 모델을 고르는 값은 화면에서 오지만 **설정에 있는 모델만** 쓰입니다. (`configFor`, `check:ai` 가 확인)
- Gemma 가 JSON 형식을 지키지 않으면 ‘AI 응답 형식이 올바르지 않습니다’ 안내와 함께 기본 검색 결과가 나옵니다. 그 경우 `jsonMode` 설정이나 형식 지시문(`src/ai/prompt.js` 의 `FORMAT_HINT`)을 손보거나, `ai.gemini.models` 에서 해당 모델을 빼면 됩니다.
- 다른 모델을 더하려면 `models` 에 `{ "model": "...", "label": "..." }` 를 추가하면 됩니다. (같은 Gemini API 로 부를 수 있는 모델만. 다른 서비스는 `src/ai/providers/` 에 같은 형태의 파일을 추가)

**저장된 AI 추천 예시(호출 없음)** — `npm run export:ai-examples [-- 모델]` (`scripts/export-ai-examples.mjs`)

가장 최근 비교 기록(`docs/evidence/*-ai-compare.json`)에서 기본 모델이 예시 질문에 실제로 준 응답을 `data/ai-examples.json` 으로 옮깁니다. 화면은 예시 질문에 대해 AI를 새로 부르지 않고 이 응답을 ‘AI 추천 예시’로 보여 주며, 받은 날짜·모델을 함께 적고 새로 AI 를 부르지 않습니다(`check:ai` 가 외부 요청이 없는지 확인). 응답 문장은 고치지 않습니다.

**실제 키로 모델 점검** — `npm run probe:ai [-- --save] [모델 ...]` (`scripts/probe-ai-models.mjs`)

화면 없이, 화면과 같은 코드로 `ai.gemini.models` 의 모델을 차례로 불러 ① 호출이 되는지(키·모델·한도) ② 응답이 형식에 맞아 읽히는지, 요청이 몇 번 어떤 상태로 갔는지(단계별 재시도)를 모델별로 출력합니다. 키는 환경변수 `GEMINI_API_KEY` 로만 받고 출력하지 않습니다. `--save` 를 붙이면 모든 모델이 됐을 때 같은 출력을 `docs/evidence/YYYY-MM-DD-ai-probe.txt` 로 저장합니다.

점검 도구의 재시도 규칙(`scripts/lib/ai-call-log.mjs`, `compare:ai` 도 같음): Google 쪽 일시 오류(5xx)·시간 초과·연결 실패는 20·60·60초 뒤, 분당 무료 한도(429)는 Google 이 알려 준 대기 시간 뒤 최대 3번 더 시도합니다. 하루 한도(429, 한도 이름에 `PerDay`)는 다시 시도하지 않습니다. 시도마다 상태 코드, Google 의 오류 종류(`UNAVAILABLE` 등), 한도 이름(`quotaId`), 대기 안내를 적고, 오류 문장(프로젝트 번호가 들어갈 수 있음)은 적지 않습니다. 시간 초과는 화면 코드의 응답 시간 제한(90초)에 걸린 것으로, 연결 실패와 따로 적습니다.

```powershell
$k = Read-Host "Gemini API 키" -AsSecureString
$env:GEMINI_API_KEY = [Net.NetworkCredential]::new('', $k).Password
npm run probe:ai                    # 설정의 모든 모델
npm run probe:ai gemma-4-31b-it     # 한 모델만
Remove-Item Env:GEMINI_API_KEY
```

**기본 검색 · AI 추천 · AI 실패 비교와 추천 이유 점검** — `npm run compare:ai [질문 ...]` (`scripts/compare-ai.mjs`)

같은 질문(기본: `ai.exampleQuestions`)을 화면과 같은 코드(`src/ai/recommend.js`)로 ① 기본 검색 ② AI 추천(설정의 모델별 실제 호출) ③ AI 실패(네트워크 없이 한도 초과·잘못된 키 응답을 흉내 냄)로 돌려 `docs/evidence/YYYY-MM-DD-ai-compare.md` 로 저장합니다. 키는 위와 같이 `GEMINI_API_KEY` 로만 받으며, 키가 없으면 ①·③만 기록합니다.

- **추천 이유 점검**: AI가 쓴 이유의 핵심 낱말을 그 데이터의 이름·분야·키워드·출처 시스템·설명 전문·컬럼 전체에서 찾아 ‘근거’(데이터에 있음)·‘질문 연결’(질문에만 있음)·‘확인 필요’(어디에도 없음)로 나눕니다. ‘확인 필요’는 바꿔 말한 표현일 수도 있어, 기록에 함께 넣은 데이터의 실제 설명·컬럼과 대조해 사람이 판단합니다.
- 모델이 후보 밖 번호를 냈다가 화면에서 걸러진 건수, 기본 검색 결과와 겹친 추천 수, 모델별 응답 시간도 함께 적습니다.

**다른 모델 계열을 쓰려면 (검토 결과, 2026-10-02 조회)** — 행정안전부 AI 공통기반이 지원한다고 안내된 모델 중, 이용자가 **브라우저에서 본인 키로** 바로 부를 수 있는지(서버 없이)를 확인했습니다. 구현은 하지 않았고, 필요해지면 ‘OpenAI 호환 서비스’용 호출 파일을 `src/ai/providers/` 에 추가하는 방식으로 붙입니다.

| 모델 | 부를 수 있는 서비스(예) | 브라우저 직접 호출(CORS) | 비용 |
|---|---|---|---|
| Gemma | 같은 Gemini API 키(이미 연결), OpenRouter(`google/gemma-4-31b-it:free`) | 가능 | 무료 |
| GPT-OSS | Groq(`openai/gpt-oss-120b`·`-20b`), OpenRouter | 가능 | Groq 무료 한도(분당 30회·하루 1,000회, 카드 불필요), OpenRouter 유료 |
| Llama | Groq(`llama-3.3-70b-versatile`), OpenRouter(`meta-llama/llama-3.3-70b-instruct`·`llama-4-*`) | 가능 | Groq 무료 한도, OpenRouter 유료 |
| 솔라(Solar) | Upstage 콘솔 API(`api.upstage.ai`), OpenRouter(`upstage/solar-pro-3`) | 가능 | Upstage 가입 시 체험 크레딧(10달러·3개월), 이후 유료 |
| 엑사원(EXAONE) | FriendliAI(OpenAI 호환) | **막힘**(사전 요청 400, 허용 헤더 없음) → 서버 중계 필요 | 유료(EXAONE-4.0.1-32B 입력 0.6달러/출력 1달러, 100만 토큰당) |
| 하이퍼클로바X | 네이버 CLOVA Studio | **막힘**(403, 허용 헤더 없음) → 서버 중계 필요 | 유료·NCP 계정 필요 |

- 위 표의 ‘가능’은 각 서비스 주소에 이 사이트 출처로 사전 요청(OPTIONS)을 보내 `Access-Control-Allow-Origin` 을 확인한 결과이며, 실제 키로 호출해 응답을 받아 본 것은 아닙니다. 서비스·무료 한도·모델 목록은 자주 바뀝니다.
- 엑사원·하이퍼클로바X 는 브라우저에서 직접 부를 수 없어, 쓰려면 기관 AI 서버(`gateway`)처럼 서버가 대신 호출해 주어야 합니다.

- Gemini 는 잘못된 API 키에도 401 이 아니라 400(`API_KEY_INVALID`)을 돌려주므로, 이 경우 ‘키를 확인해 주세요’ 안내를 하고 다시 시도하지 않습니다.
- 모델이 없다는 안내가 나오면 `site.json` 의 `ai.gemini.model` 을 고치세요. 호출이 실패해도 기본 검색 결과가 대신 나오므로 화면이 막히지는 않습니다.
- 호출 한 번의 크기는 지시문 약 700자 + 후보 정보입니다. 검색이 잘 된 질문은 전체 약 1만 자(후보 약 30건, 예시 질문 5개 측정 10,100~10,900자), 검색이 약해 카탈로그 전체를 보내는 경우 약 1만 3천7백 자(192건, 이름·분야·유형만)입니다. (2026-10-01 측정. 측정값은 문자 수이며, 토큰·비용은 모델과 요금표에 따라 다르므로 API 응답의 `usageMetadata` 로 확인하세요.)

## 기관 AI 서버 (중계 서버) 운영 — 지금은 쓰지 않음

`scripts/ai-gateway.mjs` 는 키를 서버에만 두는 참조 구현입니다. (Node.js 20 이상, 추가 서버 프로그램 불필요) 화면에서는 `ai.gateway.url` 을 채우고 `ai.modes` 에 `gateway` 를 넣으면 나타납니다. 참조 구현은 Claude 를 호출하며, 다른 모델을 쓰려면 같은 요청·응답 규격의 서버를 두면 됩니다.

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
| `AI_GATEWAY_MODEL` / `_EFFORT` / `_MAX_TOKENS` / `_REFUSAL_FALLBACK` | 모델 / effort(`none` 이면 미전송) / 응답 최대 토큰(상한 8000) / 거절 폴백 | `claude-haiku-4-5` (`site.json` 에 `ai.claude` 가 있으면 그 값) |
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
- 이 서버 스크립트만 `@anthropic-ai/sdk` 를 씁니다. 화면용 파일(`assets/app.js`)에는 들어가지 않습니다.

```text
요청  POST <url>   { "question": "...", "candidates": [ { "no": 80, "name": "...", "field": "...", "type": "파일", ... } ] }
응답  200          { "summary": "...", "recommendations": [ { "no": 80, "relevance": "high|medium|low", "reason": "..." } ],
                     "combinations": [ { "title": "...", "nos": [80, 86], "idea": "..." } ] }
```

보안 정책에 맞게 CSP `connect-src`에 호출 대상(공용 무료 중계 Origin, 본인 키 방식의 `generativelanguage.googleapis.com`, 기관 AI 서버를 켰다면 그 주소)을 추가하고, 공용 무료 방식은 `script-src`·`frame-src`에 `https://challenges.cloudflare.com`(Turnstile)도 허용해야 합니다. (`DEPLOYMENT.md` 참고)

## 개인정보·보안

- **보내는 정보**: 이용자가 입력한 질문 + 후보 데이터의 공개 정보(이름, 분야, 제공 형태, 설명 요약, 컬럼명). 데이터 샘플 값은 보내지 않습니다. 화면에 “개인정보·비밀번호를 입력하지 마세요” 안내가 있습니다.
- **공용 무료 AI**: 질문과 후보 정보는 브라우저 → 공용 중계 서버(Cloudflare Worker) → Anthropic(Claude)으로 가고, Claude가 답하지 못하면 Google(Gemini)로 갑니다. 화면의 전송 대상 안내에 두 곳을 모두 적습니다. 이용 확인을 위해 Cloudflare Turnstile 스크립트·프레임을 불러오며, 확인 토큰은 중계 서버가 검증에만 쓰고 Anthropic·Google에는 보내지 않습니다. 공용 키(Anthropic·Google)는 Worker Secret에만 있고 화면·저장소에는 없으며, 각 키는 해당 회사에만 보냅니다. 중계 서버는 질문·키·토큰을 로그에 쓰지 않습니다.
- **API 키**: ‘내 키’ 방식(Gemini)에서는 입력란(암호 형식)에서 메모리로만 쓰이며 `localStorage`·쿠키·주소에 남지 않습니다. 화면을 벗어나면 사라집니다. 질문과 결과는 다른 화면에 다녀와도 유지되지만 키는 유지되지 않습니다. (`npm run check:ai` 가 확인) 브라우저는 암호 입력란을 보고 ‘비밀번호 저장’을 물을 수 있으니 거절하세요.
- **브라우저 직접 호출(내 키)**: 이용자가 ‘내 키’ 방식을 고른 경우(공용 한도 도달 시 ‘내 키로 계속하기’ 포함) SDK 없이 `fetch`로 Google 서버를 직접 부릅니다. 개인 키는 공용 중계 서버로 보내지 않습니다. 공용 PC에서는 키를 입력하지 않도록 안내하세요. 기본 검색만 쓰면 AI 관련 파일을 받지도 외부로 요청하지도 않습니다.

## 검토했으나 도입하지 않은 방식 — Sign in with ChatGPT (2026-10-01 검토)

이용자가 본인의 ChatGPT 요금제로 외부 앱의 AI 기능을 쓰게 하는 방식입니다. 웹 연동에는 인증 코드 교환을 맡을 백엔드가 필요하고, 요금제 사용량 공유는 오픈소스·로컬 실행 앱이나 선별된 파트너 대상이라 서버 없는 정적 사이트인 이 서비스에는 맞지 않아 도입하지 않았습니다. 기관 AI 서버(`gateway`)를 운영하게 되면 다시 검토할 수 있습니다. (참고: <https://developers.openai.com/siwc/website>)

## 품질 점검과 한계

| 명령 | 내용 |
|---|---|
| `npm run check:search` | 기본 검색: 질문 39개(기대 데이터가 상위 5건에 있는지), 관계없는 질문 8개(자신 있게 추천하지 않는지), 예시 질문이 모두 결과를 내는지. 현재 적중률 100%, 재현율 97% |
| `npm run check:ai` | 모의 서버로 AI 경로 146개 점검(모델 선택·단계별 요청 형식 포함): 기관 AI 서버 참조 구현(요청 형식·허용 주소·입력 검사·호출/하루/동시 처리 한도·폴백·거절·형식 오류·연결 끊김), 화면의 검색 방식 구성(기본 검색·AI 추천, 본인 키는 Gemini 뿐), 공용 무료 AI(검색 방식 이름·전송 대상 안내·키 없이 호출·이용 확인·한도 종류별 안내·‘내 키로 계속하기’ 전환·혼잡·서버 오류와 한도 구분·기본 검색 전환), Gemini 직접 호출(주소·키 헤더·본문 형식, 구조화 출력 거절 시 재시도, 일시 오류(503) 1회 재시도, 저장된 AI 예시(AI 호출·외부 요청 없음), 오류별 안내, 키 비저장, 취소와 최신 질문 우선, 초점 이동, 상태 유지, 모바일 화면), 기관 AI 서버 호출(요청 본문·결과·거절) |
| `npm run check:shared-ai` | 공용 무료 AI 중계 서버(`server/shared-ai-worker.js`) 27개 점검(모의 Anthropic·Google·Turnstile): 이용 확인 토큰 검증·재사용 차단, 허용 Origin, IP별 요청 제한, 요청 크기·시간 제한, 한도(429) 종류 구분, 500·503 재시도 후 ‘혼잡’, 키를 다른 주소로 보내지 않음, Claude 우선 호출(고정 모델·설정, 확인값 없으면 미호출, 크레딧 소진·오류·시간 초과 시 Gemini 전환과 일시 건너뛰기, 거절은 우회하지 않음, 취소) |

**한계 (솔직하게)**
- 위 질문 세트와 유의어 사전은 같은 사람이 만들었습니다. 적중률 100% 는 **개발 중 확인용 수치**이지 이용자 전체에 대한 성능이 아닙니다. 실제 이용자 질문을 모아 `scripts/check-search.mjs` 의 `CASES` 에 추가해 가며 보강하세요.
- **`gemini-3.5-flash-lite` 와 `gemma-4-31b-it` 모두 담당자가 실제 키로 동작을 확인했지만(2026-10-02), 모델별 추천 품질과 비용(`usageMetadata`)은 측정하지 못했습니다.** `compare:ai` 기록에는 모델별 응답 시간·실패와 추천 이유의 낱말 대조(품질 측정은 아님)만 있습니다. 자동 점검(`check:ai`·`check:shared-ai`)은 모의 서버 기준입니다. 공용 무료 AI는 2026-10-13 공개 화면에서 키 없이 실제 추천이 나오는 것을 확인했고, 공용 한도 소진(429)은 실제로 만들지 않고 모의 응답으로만 검증했습니다. 공용 무료 한도는 Google 무료 등급 한도로 프로젝트 전체가 함께 쓰므로 동시 이용자가 많으면 일찍 소진될 수 있습니다. 기관 AI 서버(Claude 참조 구현)는 실제 키로 시험하지 못했습니다.
- **공용 중계의 Claude 우선 호출(`claude-haiku-5-5`)은 2026-10-15 공개 화면에서 실제로 확인했지만, Claude가 실패해 Gemini로 넘어가는 경우는 모의 응답으로만 검증했습니다.** 증빙용 질문 2번에 Claude가 답했고(`X-AI-Provider: claude`, 중계 응답 5.7·6.9초, 질문부터 결과 표시까지 9.5·21.3초), 같은 날 이용 확인 실패 원인을 찾으며 질문한 17번 중에도 9번 답했습니다. 요청당 토큰(크레딧 사용량)은 측정하지 못했습니다. Anthropic이 크레딧 소진을 어떤 오류로 알리는지(`billing_error` 또는 400)도 실제로 확인하지 않았으며, 어느 쪽이든 Gemini로 넘어가도록 만들었습니다. 같은 날 이용 확인(Cloudflare Turnstile)이 간헐적으로 실패해, 중계 서버를 부르기 전에 기본 검색으로 전환된 경우가 있었습니다. 원인은 확인하지 못했습니다([기록](evidence/2026-10-15-shared-ai-live.md)).
- **`gemma-4-31b-it` 는 실제 호출에서 응답이 Flash-Lite 보다 훨씬 느렸고(수십 초), Google 쪽 일시 오류(5xx)·응답 시간 초과(90초)와 무료 사용 한도(429, 키 오류가 아님)로 실패한 호출이 있었습니다(2026-10-02·06, 10-06 비교에서 평균 약 79초·5개 중 4개 응답).** 화면은 이때 기본 검색 결과를 보여 줍니다. Google 가격표(2026-10-01 기준)에 Gemma 4 는 무료만 있고 유료 요금제는 없으며, 사용 한도는 키가 아니라 Google 프로젝트 단위로 계산됩니다. 모델별 기록은 `docs/evidence/*-ai-compare.md` 에 있습니다.
- 기본 검색은 의미를 ‘이해’하는 것이 아니라 낱말·유의어 일치로 찾습니다. 사전에 없는 표현은 놓칠 수 있고(그때 AI 방식이 도움이 됨), 질문과 맞는 데이터가 없으면 “가까운 후보”라고 알립니다. 카탈로그에 없는 합성어(예: ‘채용공고’)는 결과 순서는 맞아도 ‘가까운 후보’ 안내가 보수적으로 나올 수 있습니다.
- 새 데이터가 추가되면 이름·분야 낱말이 사전에 없을 수 있으니 `src/ai/thesaurus.js` 를 함께 확인하세요.
