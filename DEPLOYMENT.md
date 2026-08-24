# KSPO 데이터자산 탐색기 분리형 배포 안내

이 브랜치는 기존 단일 `index.html`에 포함되어 있던 화면 코드와 데이터를 정적 파일로 분리한 배포본입니다. 서버 측 프로그램, 데이터베이스, 로그인 기능은 사용하지 않습니다.

## 파일 구성

```text
/
├─ index.html
├─ assets/
│  ├─ app.css
│  └─ app.js
└─ data/
   └─ explorer-data.json
```

- `index.html`: 화면 진입점
- `assets/app.css`: 화면 스타일
- `assets/app.js`: 검색, 필터, 상세보기, 관계도 등 화면 동작
- `data/explorer-data.json`: 데이터셋 설명, 컬럼 정의, 마스킹된 샘플 데이터

## 운영 서버 반영 방법

1. 위 파일과 디렉터리 구조를 유지한 채 동일한 웹 경로에 업로드합니다.
2. `index.html`을 공공데이터 관련 메뉴의 연결 주소로 등록합니다.
3. 브라우저에서 `https://www.kspo.or.kr/.../index.html` 형태로 접속하여 기능을 점검합니다.
4. 검증 완료 후 기존 메뉴에 노출합니다.

`app.js`가 같은 출처의 `data/explorer-data.json`을 읽으므로 파일을 직접 여는 `file://` 방식은 지원하지 않습니다. 개발·검수 환경에서도 반드시 HTTP 또는 HTTPS 웹서버를 사용해야 합니다.

## 권장 MIME 유형

| 확장자 | Content-Type |
|---|---|
| `.html` | `text/html; charset=utf-8` |
| `.css` | `text/css; charset=utf-8` |
| `.js` | `text/javascript; charset=utf-8` 또는 `application/javascript` |
| `.json` | `application/json; charset=utf-8` |

HTML이 다운로드되지 않고 화면에 표시되도록 `Content-Disposition: attachment`는 설정하지 않습니다.

## 보안 특성

- 실행 코드는 `assets/app.js` 한 파일로 분리되어 있으며 HTML 내부 인라인 JavaScript는 없습니다.
- 스타일은 `assets/app.css`로 분리되어 있으며 HTML 내부 인라인 스타일 블록은 없습니다.
- 데이터는 동일 출처의 정적 JSON만 읽습니다.
- 외부 API 호출, 서버 쓰기, 파일 업로드, 쿠키, 로그인, `localStorage` 저장 기능은 없습니다.
- 원본 `main` 브랜치의 개인정보 마스킹 적용 데이터를 그대로 유지하며, 분리 과정에서 데이터 내용을 변경하지 않았습니다.

운영 환경의 보안정책에 맞춰 다음 CSP를 출발점으로 조정할 수 있습니다.

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'
```

일부 화면 요소의 동적 위치·크기 표현을 위해 React가 요소의 `style` 속성을 사용하므로 `style-src 'unsafe-inline'`이 필요할 수 있습니다. 실제 운영 CSP는 홈페이지 운영·보안 담당자의 검토를 거쳐 확정합니다.

## 반영 전 점검표

- 초기 화면이 오류 없이 열리는지
- 검색어 입력과 카테고리·제공유형·업데이트 주기 필터가 동작하는지
- 데이터셋 상세정보, 컬럼 정의, 샘플 데이터가 표시되는지
- 관계도 노드 선택, 확대·축소, 이동이 동작하는지
- 개발자 도구에 404, JSON 파싱 오류, CSP 차단 오류가 없는지
- `data/explorer-data.json`이 외부에서 직접 조회 가능한 공개 데이터 범위인지 최종 확인했는지
- Chrome 및 Edge 최신 사내 표준 버전에서 확인했는지

## 업데이트와 롤백

데이터만 갱신할 때는 `data/explorer-data.json`을 교체하고, 화면 기능을 변경할 때는 `assets/app.js` 또는 `assets/app.css`을 교체합니다. 운영 반영 전 기존 디렉터리를 버전별로 보관하면 장애 발생 시 이전 파일 세트로 즉시 롤백할 수 있습니다.
