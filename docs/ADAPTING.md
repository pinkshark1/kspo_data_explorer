# 다른 기관에서 쓰려면 (기관명만 바꿔 적용하기)

이 프로젝트는 **서버 없이 정적 파일만으로** 동작하고, 기관 고유 내용이 코드 밖의 JSON 에 모여 있어 아래 순서대로 바꾸면 다른 기관의 ‘데이터 지도’로 쓸 수 있습니다. (Node.js 20 이상)

## 1. 받아서 실행해 보기

```bash
git clone <저장소 주소>
cd kspo_data_explorer
npm install
npm run build
npm start          # http://localhost:4173 에서 현재 화면 확인
```

## 2. 기관 이름·문구 바꾸기 — `data/site.json`

| 바꿀 곳 | 키 |
|---|---|
| 기관명, 서비스 이름 | `organization.name`, `service.name`, `service.fullName` |
| 맨 위 안내띠 | `service.bannerText` |
| 서비스 범위 문구 | `service.scope` |
| 포털 이름·목록 주소 | `portals.public`, `portals.culture` (기관이 쓰는 포털에 맞게 수정) |
| 사용방법 영상·단계 | `guide.video`, `guide.poster`, `guide.steps` (영상이 없으면 `video`를 지우고 단계 안내만 둬도 됨) |
| 연계 아이디어 | `ideas[]` (없으면 빈 배열 `[]`) |

기관명·서비스 이름·안내 문구·포털 이름은 이 파일에서 바꿉니다. 코드(`src/`)에 남아 있는 고정값은 아래와 같습니다.

- 상단 로고 글자 `K` (`src/components/SiteHeader.jsx`)와 색상 (`src/styles/app.css` 맨 위 `:root` 변수)
- **데이터 채널 값 3종** - `문화빅데이터포털(파일)`, `공공데이터포털(파일)`, `공공데이터포털(API)` (`src/lib/catalog.js`, `src/lib/detail.js`). 두 포털(공공/문화) 구조를 전제로 만들었으므로, 다른 포털을 쓰는 기관은 이 두 파일의 채널 판별 부분을 함께 고쳐야 합니다.
- 상단 메뉴 이름(사용방법·데이터 탐색·관계도·연계 아이디어)과 화면 곳곳의 안내 문장

## 3. 데이터 바꾸기 — `data/explorer-data.json`

구조는 [DATA_SCHEMA.md](DATA_SCHEMA.md)에 있습니다. 데이터셋 목록(`payloads[0]`)과, 각 데이터의 컬럼·샘플(`payloads[1~5]`)을 같은 데이터 번호(`no`)로 이어서 채웁니다.

1. 목록(`catalog`)을 먼저 채우고 `npm run check:data` 로 구조를 확인합니다.
2. 컬럼 정의·샘플이 없는 데이터는 비워 두면 화면이 ‘정의서 미제공’으로 안내합니다.
3. 샘플에 개인정보가 있으면 `scripts/mask-sample-data.mjs` 의 `RULES` 에 컬럼을 추가하고 `node scripts/mask-sample-data.mjs --write` 로 마스킹합니다. (`--write` 없이 실행하면 변경 예정 건수만 보여줍니다.)
4. 공공데이터포털·문화빅데이터포털에 올린 데이터라면 `npm run fetch:meta` 로 이용허락범위·관리부서·수정일을 자동으로 채웁니다. (`scripts/fetch-portal-metadata.mjs` 의 포털 주소 규칙 참고)

## 4. 연계 아이디어를 데이터와 이어 붙이기

`ideas[].datasetNos` 에 관련 데이터 번호를 적으면 아이디어 카드에서 해당 데이터로 바로 이동하고 ‘관련 데이터 모두 보기’ 필터가 동작합니다.

## 5. 배포

`npm run build` 로 `assets/app.js`·`assets/app.css` 를 만든 뒤, `index.html`, `assets/`, `data/` 를 그대로 웹 경로에 올립니다. (GitHub Pages, 사내 웹서버 모두 가능) 자세한 내용은 [DEPLOYMENT.md](../DEPLOYMENT.md)를 보세요.

## 참고: 외부에서 가져다 쓰는 것

- 오픈소스: React 19 (MIT), Pretendard 글꼴 (SIL OFL) — 라이선스 고지는 `assets/THIRD_PARTY_NOTICES.txt` 에 있으며 `npm run notices` 로 다시 만들 수 있습니다.
- 외부 서버 호출은 없습니다. 화면에서 포털로 이동하는 링크는 이용자가 눌렀을 때만 새 창으로 열립니다.
