# KSPO 데이터 지도 분리형 배포 안내

KSPO 데이터 지도의 기본 탐색은 서버 프로그램·데이터베이스·로그인 없이 **정적 파일만으로** 동작합니다. 화면 코드(`src/`)를 빌드해 만든 파일과 데이터(JSON)를 그대로 웹 경로에 올리면 됩니다. 공용 무료 AI를 켜는 경우에만 키를 보관할 중계 서버를 별도로 연결합니다.

## 파일 구성

운영 서버에는 아래 공개 파일만 올립니다. 저장소 전체를 웹 루트로 복사하지 않습니다. `src/`, `server/`, `scripts/`, `docs/`, `node_modules/`, 환경 파일과 로컬 설정은 배포 대상에서 제외합니다.

```text
/
├─ index.html
├─ assets/
│  ├─ app.js                     화면 동작 (검색, 필터, 상세, 관계도 등)
│  ├─ app.css                    화면 스타일
│  ├─ app.js.LEGAL.txt           번들에 포함된 오픈소스 라이선스 주석
│  ├─ THIRD_PARTY_NOTICES.txt    오픈소스·글꼴 라이선스 고지 (화면 하단 링크)
│  ├─ favicon.svg
│  ├─ fonts/                     Pretendard 웹폰트 (.woff2) 와 라이선스
│  ├─ kspo-data-map-guide.jpg    사용방법 영상 썸네일
│  └─ kspo-data-map-guide.mp4    사용방법 영상 (약 16MB, 재생할 때만 내려받음)
└─ data/
   ├─ explorer-data.json         데이터셋 목록, 컬럼 정의, 마스킹된 샘플
   ├─ portal-meta.json           포털에서 수집한 이용허락범위·관리부서·수정일 (없어도 화면은 동작)
   └─ site.json                  서비스 이름, 안내 문구, 사용방법 단계, 연계 아이디어
```

`assets/app.js` 는 같은 출처의 `data/*.json` 을 읽으므로 파일을 직접 여는 `file://` 방식은 지원하지 않습니다. 개발·검수 환경에서도 반드시 HTTP 또는 HTTPS 웹서버를 사용해야 합니다. (`npm start` 로 간단히 확인할 수 있습니다.)

## 화면 소스를 고쳤을 때

`assets/app.js`, `assets/app.css` 는 `src/` 를 묶은 **빌드 결과물**입니다. 소스를 고친 뒤에는 반드시 다시 빌드해 결과물까지 함께 반영합니다.

```bash
npm install     # 처음 한 번 (Node.js 20 이상)
npm run build   # src/ → assets/app.js, assets/app.css
npm run check:data && npm run check:ui    # 반영 전 점검
npm run check:search && npm run check:ai  # 질문 검색·AI 경로(모의) 점검
npm run check:shared-ai                   # 공용 무료 AI 중계를 고친 경우
npm run check:security && npm run check:http    # 공개 범위·인증정보·HTTP 처리 점검
```

## 운영 서버 반영 방법

1. 위 파일과 디렉터리 구조를 유지한 채 동일한 웹 경로에 업로드합니다.
2. `index.html`을 공공데이터 관련 메뉴의 연결 주소로 등록합니다.
3. 브라우저에서 `https://www.kspo.or.kr/.../index.html` 형태로 접속하여 기능을 점검합니다.
4. 검증 완료 후 기존 메뉴에 노출합니다.

## 공용 무료 AI 연결

공용 무료 AI는 아래 절차로 별도 연결합니다. 정적 화면의 기존 배포 경로는 유지합니다.

1. Google AI Studio에서 공용 키가 속한 프로젝트가 **Free 등급**이고 결제가 연결되지 않았는지 확인합니다. 키는 채팅·소스·`site.json`에 넣지 않습니다.
2. Cloudflare의 무료 Turnstile 위젯을 만들고 실제 화면의 호스트 이름을 등록합니다. 위젯 유형은 **Managed**, Pre-clearance는 끔으로 설정합니다. 공개 사이트 키는 화면 설정에, Secret 키는 Worker의 `TURNSTILE_SECRET_KEY`에 사용합니다. 두 키를 혼동하지 않습니다.
3. Cloudflare Workers 무료 요금제에서 `server/wrangler.toml`과 `server/shared-ai-worker.js`를 배포합니다. 런타임 Secret `GEMINI_API_KEY`에 공용 Gemini 키, `TURNSTILE_SECRET_KEY`에 이용 확인(Turnstile) Secret을 등록하고, `AI_ALLOWED_ORIGINS`에 실제 화면의 Origin(경로 없이)을 지정합니다. `GEMINI_FREE_TIER_CONFIRMED`는 Free 확인 후에만 `true`로 설정합니다. 이 값으로 Google의 결제 설정이 변경되는 것은 아닙니다.
4. Wrangler 4.36 이상을 사용하는 경우 `npx wrangler deploy --config server/wrangler.toml --var AI_ALLOWED_ORIGINS:https://실제-화면-도메인 --var GEMINI_FREE_TIER_CONFIRMED:true`로 배포합니다. `npx wrangler secret put GEMINI_API_KEY --config server/wrangler.toml`과 `npx wrangler secret put TURNSTILE_SECRET_KEY --config server/wrangler.toml`의 입력 프롬프트에서 각 Secret을 등록합니다. Secret을 명령줄 인자로 넣지 않습니다. 재배포 시에도 Origin·확인값을 지정해야 합니다. 미설정 상태에서는 서버가 외부 AI를 호출하지 않습니다.
5. 실제 `/healthz`를 확인한 뒤 검수용 화면의 `data/site.json`에서 `ai.gemini.shared.url`에 HTTPS `/recommend` 주소, `ai.gemini.shared.turnstileSiteKey`에 공개 사이트 키를 넣고 `ai.defaultMode`를 `gemini`로 변경합니다. 등록한 호스트에서 이용 확인과 실제 추천을 확인한 뒤 운영 설정에 반영합니다. url이 비어 있으면 공용 기능을 켜지 않습니다. CSP가 있다면 아래 안내에 따라 중계 주소와 Turnstile을 허용합니다. (현재 운영 화면은 2026-10-13에 이 절차로 연결했습니다.)
6. `npm run build`, `npm run check:data`, `npm run check:ui`, `npm run check:search`, `npm run check:ai`, `npm run check:shared-ai`, `npm run check:security`를 실행하고 화면을 반영합니다. 실제 무료 한도를 고의로 소진하지 말고 모의 429 응답으로 개인 키 전환을 검증합니다.
7. 이용 확인 없는 요청의 상한(같은 IP 분당 3회, 전체 분당 30회)은 `server/wrangler.toml`의 Durable Object `USAGE_GATE`(클래스 `UsageGate`, 무료 플랜의 SQLite 방식)가 셉니다. 이 설정 없이 배포하면 예전처럼 모든 요청에 이용 확인을 요구합니다. 통행증 서명에는 `TURNSTILE_SECRET_KEY`에서 파생한 키를 쓰므로 Secret을 새로 만들 필요가 없고, 이 Secret을 바꾸면 발급된 통행증은 모두 무효가 됩니다.
8. 같은 질문 저장은 Workers KV를 씁니다. 처음 한 번 `npx wrangler kv namespace create ANSWER_CACHE --config server/wrangler.toml`로 저장소를 만들고, 출력된 id를 `server/wrangler.toml`의 `[[kv_namespaces]]`에 넣습니다. 이 설정이 없으면 저장 없이 동작합니다. 무료 한도를 넘으면 요금 없이 저장만 실패합니다.
9. `server/shared-ai-worker.js`를 고친 경우(예: 503 재시도 추가) 화면 반영과 별도로 4단계의 `npx wrangler deploy` 명령(Origin·확인값 지정 포함)으로 Worker를 다시 배포하고 `/healthz`와 실제 질문 1건을 확인합니다. GitLab `main` 반영만으로는 Worker가 갱신되지 않습니다.
10. (선택) Claude 우선 사용: Claude 구독 플랜(Max·Team)의 월 API 크레딧을 받는 Anthropic Console 조직의 Billing 화면에서 구매한 크레딧이 없고 자동 충전이 꺼져 있는지 확인합니다. 그 조직에서 API 키를 발급해 `npx wrangler secret put ANTHROPIC_API_KEY --config server/wrangler.toml`의 입력 프롬프트로 등록하고, 4단계 배포 명령에 `--var ANTHROPIC_CREDITS_ONLY_CONFIRMED:true`를 더합니다(재배포 때마다 지정). 키를 PC의 전역 환경변수로 두지 않습니다. 같은 이름을 읽는 다른 개발 도구가 이 키를 쓰게 됩니다. 반영 후 실제 질문 1건의 응답 헤더 `X-AI-Provider`가 `claude`인지 브라우저 개발자 도구에서 확인합니다. 끌 때는 확인값을 `false`로 다시 배포하고, `data/site.json`의 `ai.gemini.shared.name`·`target`을 지워 화면 안내를 Gemini로 되돌립니다.

Cloudflare의 무료 요청·CPU 한도에 들어가는지 확인하고, 무료 요금제를 유지합니다. Worker에서 원문 요청·API 키를 로그에 쓰지 않습니다. `.dev.vars*`와 `.wrangler/`는 로컬 설정으로 Git에서 제외합니다. 자세한 흐름과 한도 구분은 [질문 검색 안내](docs/AI_FEATURE.md#공용-무료-ai--본인-키-전환)를 참고하세요.

## 권장 MIME 유형

| 확장자 | Content-Type |
|---|---|
| `.html` | `text/html; charset=utf-8` |
| `.css` | `text/css; charset=utf-8` |
| `.js` | `text/javascript; charset=utf-8` 또는 `application/javascript` |
| `.json` | `application/json; charset=utf-8` |
| `.svg` | `image/svg+xml` |
| `.woff2` | `font/woff2` |
| `.mp4` | `video/mp4` (Range 요청 지원 권장 - 영상 탐색/이어보기) |
| `.txt` | `text/plain; charset=utf-8` |

HTML이 다운로드되지 않고 화면에 표시되도록 `Content-Disposition: attachment`는 설정하지 않습니다.

## 보안 특성

- 자체 실행 코드는 `assets/app.js`이며 HTML 내부 인라인 JavaScript는 없습니다. 공용 무료 AI 요청 중 중계 서버가 이상 징후로 이용 확인을 요구하면 Turnstile 스크립트와 프레임을 추가로 불러옵니다.
- 스타일은 `assets/app.css`로 분리되어 있으며 HTML 내부 인라인 스타일 블록은 없습니다.
- 데이터는 동일 출처의 정적 JSON만 읽습니다.
- 자체 화면에는 파일 업로드, 로그인, `localStorage` 저장 기능이 없습니다. Turnstile의 Pre-clearance는 사용하지 않습니다. (화면의 ‘데이터 원문’·포털 링크는 사용자가 누를 때만 새 창으로 열립니다.)
- **외부 호출은 ‘질문 검색’의 AI 방식에서 이용자가 질문을 보낼 때** 시작합니다. 기본 검색과 저장된 예시는 외부 요청이 없습니다. 호출 대상은 `ai.gemini.shared.url`의 공용 무료 중계 및 `challenges.cloudflare.com`(이용 확인), `generativelanguage.googleapis.com`(이용자 본인 키) 또는 별도로 설정한 기관 AI 서버입니다. 자세한 내용과 보안 특성은 [docs/AI_FEATURE.md](docs/AI_FEATURE.md).
- 글꼴·영상·이미지는 모두 `assets/` 의 자체 파일이며 외부 CDN을 쓰지 않습니다.
- API 키는 소스·데이터 파일·저장소에 두지 않습니다. 이용자가 입력한 키는 브라우저 메모리에서만 쓰이고, 서버 방식의 키는 중계 서버 환경변수에만 둡니다.
- `data/site.json`은 누구나 읽을 수 있는 화면 설정입니다. 환경변수 파일을 대신하는 비밀 저장소로 사용하지 않습니다.
- `npm run check:security`는 현재 Git 추적 파일과 `assets/`·`data/`의 비공개 파일 이름 및 알려진 인증정보 형식을 점검합니다. 발견한 값은 출력하지 않습니다. GitLab의 공개 미러 동기화도 이 검사가 통과해야 진행됩니다(러너에 Node.js 20 이상 필요).
- `.gitignore`는 이미 추적된 파일이나 과거 커밋을 지우지 않습니다. 보안 검사는 모든 형태의 비밀이나 문서·영상 속 개인정보를 식별하지 못하므로, 공개 파일의 내용 검토도 필요합니다.
- `npm start`의 로컬 서버는 환경 파일·로컬 설정·백업·소스맵과 공개 범위를 벗어나는 링크를 차단합니다. 운영 웹서버에도 공개 파일만 복사해야 하며, 로컬 서버의 차단 규칙이 운영 서버에 자동 적용되지는 않습니다.
- 샘플 데이터는 개인정보가 마스킹된 값만 담습니다. 데이터를 추가할 때는 `npm run check:data` 로 마스킹되지 않은 이름·작성자 값이 없는지 확인합니다.

운영 환경의 보안정책에 맞춰 다음 CSP를 출발점으로 조정할 수 있습니다.

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'
```

질문 검색의 AI 방식을 켜면 `connect-src`에 호출 대상을 추가합니다. 이용자 키 방식은 `https://generativelanguage.googleapis.com`, 공용 무료 방식은 공용 중계 Origin, 기관 서버 방식은 해당 서버 Origin입니다. 공용 무료 방식에서는 `script-src`에 `https://challenges.cloudflare.com`을 추가하고 `frame-src https://challenges.cloudflare.com`도 지정합니다. [Turnstile CSP 안내](https://developers.cloudflare.com/turnstile/reference/content-security-policy/)를 참고하세요. 기본 검색만 쓰면 위 값 그대로 둡니다.

일부 화면 요소의 동적 위치·크기 표현을 위해 React가 요소의 `style` 속성을 사용하므로 `style-src 'unsafe-inline'`이 필요할 수 있습니다. 실제 운영 CSP는 홈페이지 운영·보안 담당자의 검토를 거쳐 확정합니다.

## 반영 전 점검표

- 초기 화면이 오류 없이 열리는지
- 검색어 입력과 카테고리·개방 포털·데이터 유형·업데이트 주기 필터가 동작하는지
- 데이터셋 상세정보, 컬럼 정의, 샘플 데이터, ‘데이터 정보’(포털 수정일·이용허락범위)가 표시되는지
- 관계도 노드 선택, 확대·축소(휠·버튼·두 손가락), 이동이 동작하는지
- ‘사용방법’ 화면에서 영상이 재생되는지
- ‘질문 검색’에서 예시 질문이 결과를 내는지(저장된 AI 예시는 외부 요청 없이)
- (공용 무료 AI를 켠 경우) 키 없이 새 질문에 이용 확인이 통과하고 추천이 나오는지, Worker `/healthz`가 정상인지, 한도·혼잡 안내와 ‘내 키로 계속하기’·기본 검색 전환이 동작하는지(한도는 모의 응답으로 확인), 공용 키 프로젝트에 결제가 연결되지 않았는지, Claude를 켰다면 응답 헤더 `X-AI-Provider`가 `claude`이고 Console 조직에 구매 크레딧·자동 충전이 없는지
- 모바일(폭 360~390px)에서 상단 메뉴가 잘리지 않고 가로 스크롤이 생기지 않는지
- 개발자 도구에 404, JSON 파싱 오류, CSP 차단 오류가 없는지
- `data/explorer-data.json`이 외부에서 직접 조회 가능한 공개 데이터 범위인지, 관계도에 나오는 정보시스템 이름이 공개 범위에 맞는지
- Chrome 및 Edge 최신 사내 표준 버전에서 확인했는지

## 업데이트와 롤백

- 데이터만 갱신할 때는 `data/explorer-data.json` 을 교체하고 `npm run fetch:meta` 로 `data/portal-meta.json` 을 다시 수집합니다. 자세한 절차는 [docs/ADAPTING.md](docs/ADAPTING.md)(데이터 바꾸기)와 [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md)를 참고하세요.
- 화면 기능을 변경할 때는 `src/` 를 고치고 `npm run build` 로 `assets/app.js`·`assets/app.css` 를 다시 만듭니다.
- 운영 반영 전 기존 디렉터리를 버전별로 보관하면 장애 발생 시 이전 파일 세트로 즉시 롤백할 수 있습니다.
