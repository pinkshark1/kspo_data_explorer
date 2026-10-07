# KSPO 데이터 지도 분리형 배포 안내

KSPO 데이터 지도는 서버 프로그램·데이터베이스·로그인 없이 **정적 파일만으로** 동작합니다. 화면 코드(`src/`)를 빌드해 만든 파일과 데이터(JSON)를 그대로 웹 경로에 올리면 됩니다.

## 파일 구성

운영 서버에는 아래 파일과 디렉터리 구조를 그대로 올립니다. (`src/`, `scripts/`, `docs/`, `node_modules/` 는 올리지 않아도 됩니다.)

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
```

## 운영 서버 반영 방법

1. 위 파일과 디렉터리 구조를 유지한 채 동일한 웹 경로에 업로드합니다.
2. `index.html`을 공공데이터 관련 메뉴의 연결 주소로 등록합니다.
3. 브라우저에서 `https://www.kspo.or.kr/.../index.html` 형태로 접속하여 기능을 점검합니다.
4. 검증 완료 후 기존 메뉴에 노출합니다.

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

- 실행 코드는 `assets/app.js` 하나이며 HTML 내부 인라인 JavaScript는 없습니다.
- 스타일은 `assets/app.css`로 분리되어 있으며 HTML 내부 인라인 스타일 블록은 없습니다.
- 데이터는 동일 출처의 정적 JSON만 읽습니다.
- 서버 쓰기, 파일 업로드, 쿠키, 로그인, `localStorage` 저장 기능은 없습니다. (화면의 ‘데이터 원문’·포털 링크는 사용자가 누를 때만 새 창으로 열립니다.)
- **외부 호출은 ‘질문 검색’의 AI 방식을 켠 경우에만, 이용자가 질문을 보낼 때** 일어납니다. 기본 검색(기본 설정)은 외부 요청이 없습니다. AI 방식은 `data/site.json` 의 `ai.modes` 로 켜고 끄며, 호출 대상은 `generativelanguage.googleapis.com`(Gemini, 이용자 본인 키) 또는 기관 AI 서버(꺼 둔 상태)입니다. 자세한 내용과 보안 특성은 [docs/AI_FEATURE.md](docs/AI_FEATURE.md).
- 글꼴·영상·이미지는 모두 `assets/` 의 자체 파일이며 외부 CDN을 쓰지 않습니다.
- API 키는 소스·데이터 파일·저장소에 두지 않습니다. 이용자가 입력한 키는 브라우저 메모리에서만 쓰이고, 서버 방식의 키는 중계 서버 환경변수에만 둡니다.
- 샘플 데이터는 개인정보가 마스킹된 값만 담습니다. 데이터를 추가할 때는 `npm run check:data` 로 마스킹되지 않은 이름·작성자 값이 없는지 확인합니다.

운영 환경의 보안정책에 맞춰 다음 CSP를 출발점으로 조정할 수 있습니다.

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'
```

질문 검색의 AI 방식을 켜면 `connect-src` 에 호출 대상을 추가합니다. (이용자 키 방식: `https://generativelanguage.googleapis.com`, 서버 방식: 기관 AI 서버 주소) 기본 검색만 쓰면 위 값 그대로 둡니다.

일부 화면 요소의 동적 위치·크기 표현을 위해 React가 요소의 `style` 속성을 사용하므로 `style-src 'unsafe-inline'`이 필요할 수 있습니다. 실제 운영 CSP는 홈페이지 운영·보안 담당자의 검토를 거쳐 확정합니다.

## 반영 전 점검표

- 초기 화면이 오류 없이 열리는지
- 검색어 입력과 카테고리·개방 포털·데이터 유형·업데이트 주기 필터가 동작하는지
- 데이터셋 상세정보, 컬럼 정의, 샘플 데이터, ‘데이터 정보’(포털 수정일·이용허락범위)가 표시되는지
- 관계도 노드 선택, 확대·축소(휠·버튼·두 손가락), 이동이 동작하는지
- ‘사용방법’ 화면에서 영상이 재생되는지
- ‘질문 검색’에서 예시 질문이 결과를 내는지, (AI 방식을 켠 경우) 실제 키·서버로 질문해 응답과 비용을 확인했는지
- 모바일(폭 360~390px)에서 상단 메뉴가 잘리지 않고 가로 스크롤이 생기지 않는지
- 개발자 도구에 404, JSON 파싱 오류, CSP 차단 오류가 없는지
- `data/explorer-data.json`이 외부에서 직접 조회 가능한 공개 데이터 범위인지, 관계도에 나오는 정보시스템 이름이 공개 범위에 맞는지
- Chrome 및 Edge 최신 사내 표준 버전에서 확인했는지

## 업데이트와 롤백

- 데이터만 갱신할 때는 `data/explorer-data.json` 을 교체하고 `npm run fetch:meta` 로 `data/portal-meta.json` 을 다시 수집합니다. 자세한 절차는 [docs/ADAPTING.md](docs/ADAPTING.md)(데이터 바꾸기)와 [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md)를 참고하세요.
- 화면 기능을 변경할 때는 `src/` 를 고치고 `npm run build` 로 `assets/app.js`·`assets/app.css` 를 다시 만듭니다.
- 운영 반영 전 기존 디렉터리를 버전별로 보관하면 장애 발생 시 이전 파일 세트로 즉시 롤백할 수 있습니다.
