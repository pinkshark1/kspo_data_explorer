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

`data/` 를 덮어쓰기 전에 다른 폴더의 데이터로 먼저 띄워 볼 수 있습니다. 데이터 점검(`validate-data`)·포털 정보 수집도 같은 옵션을 받습니다. (화면·검색·AI 점검 `check:ui`·`check:search`·`check:ai` 는 `data/` 기준입니다. 사례 폴더의 화면 점검은 `examples/korea-sports-council/check.mjs`)

```bash
npm start -- --data examples/korea-sports-council/data
node scripts/validate-data.mjs --data examples/korea-sports-council/data
node scripts/fetch-portal-metadata.mjs --data examples/korea-sports-council/data
```

> **실제 적용 사례:** 대한체육회가 공공데이터포털에 개방한 데이터 23건으로 기관별 화면 코드 수정 없이(처음 이식할 때 KSPO 고정 문구를 설정값으로 정리) 띄워 본 기록이 [examples/korea-sports-council](../examples/korea-sports-council/README.md)에 있습니다. (필요한 데이터 항목, 바꾼 파일, 단계별 처리 시간, 화면, 갱신 절차, 한계)

## 2. 기관 이름·문구 바꾸기 — `data/site.json`

| 바꿀 곳 | 키 |
|---|---|
| 기관명, 서비스 이름 | `organization.name`, `organization.shortName`, `service.name`, `service.fullName` |
| 문장 속 기관 호칭·로고 글자 | `organization.callName`(예: `공단`, 없으면 기관명), `organization.mark`(없으면 약칭 첫 글자) |
| 맨 위 안내띠 | `service.bannerText` |
| 서비스 범위 문구 | `service.scope` |
| 첫 화면 소개·대표 데이터 (선택) | `service.intro`, `service.featuredDataset` |
| 포털 이름·목록 주소 | `portals.public`, `portals.culture` (기관이 쓰는 포털에 맞게 수정) |
| 사용방법 영상·단계 | `guide.video`, `guide.poster`, `guide.steps` (영상이 없으면 `video`를 지우고 단계 안내만 둬도 됨. `guide` 자체가 없으면 ‘사용방법’ 메뉴가 빠짐) |
| 연계 아이디어 | `ideas[]` (없으면 빈 배열 `[]` - ‘연계 아이디어’ 메뉴가 빠짐) |

기관명·서비스 이름·안내 문구·포털 이름은 이 파일에서 바꿉니다. 코드(`src/`)에 남아 있는 고정값은 아래와 같습니다.

- 색상 (`src/styles/app.css` 맨 위 `:root` 변수)
- 질문 검색의 관련어 사전 (`src/ai/thesaurus.js`) - KSPO 데이터에 맞춘 것이라, 기관 용어에 맞게 보완하면 질문 검색이 더 정확해집니다.
- **데이터 채널 값 3종** - `문화빅데이터포털(파일)`, `공공데이터포털(파일)`, `공공데이터포털(API)` (`src/lib/catalog.js`, `src/lib/detail.js`). 두 포털(공공/문화) 구조를 전제로 만들었으므로, 다른 포털을 쓰는 기관은 이 두 파일의 채널 판별 부분을 함께 고쳐야 합니다.
- 상단 메뉴 이름(사용방법·데이터 탐색·관계도·연계 아이디어)과 화면 곳곳의 안내 문장

## 3. 데이터 바꾸기 — `data/explorer-data.json`

구조는 [DATA_SCHEMA.md](DATA_SCHEMA.md)에 있습니다. 데이터셋 목록(`payloads[0]`)과, 각 데이터의 컬럼·샘플(`payloads[1~5]`)을 같은 데이터 번호(`no`)로 이어서 채웁니다.

1. 목록(`catalog`)을 먼저 채우고 `npm run check:data` 로 구조를 확인합니다. 관계도는 `field`(분야)와 `sys`(출처 시스템)로 묶이므로, 포털 분류체계가 모두 같다면 기관이 자체 분야·출처 시스템을 정해 넣어야 관계도가 쓸모 있어집니다. (출처 시스템을 모르면 추정하지 말고 관리부서 등 확인된 값으로 묶습니다)
2. 컬럼 정의·샘플이 없는 데이터는 비워 두면 화면이 ‘정의서 미제공’으로 안내합니다.
3. 샘플에 개인정보가 있으면 `scripts/mask-sample-data.mjs` 의 `RULES` 에 컬럼을 추가하고 `node scripts/mask-sample-data.mjs --write` 로 마스킹합니다. (`--write` 없이 실행하면 변경 예정 건수만 보여줍니다.)
4. 공공데이터포털·문화빅데이터포털에 올린 데이터라면 `npm run fetch:meta` 로 이용허락범위·관리부서·수정일을 자동으로 채웁니다. (`scripts/fetch-portal-metadata.mjs` 의 포털 주소 규칙 참고)

## 4. 연계 아이디어를 데이터와 이어 붙이기

`ideas[].datasetNos` 에 관련 데이터 번호를 적으면 아이디어 카드에서 해당 데이터로 바로 이동하고 ‘관련 데이터 모두 보기’ 필터가 동작합니다.

## 5. 배포

`npm run build` 로 `assets/app.js`·`assets/app.css` 를 만든 뒤, `index.html`, `assets/`, `data/` 를 그대로 웹 경로에 올립니다. (GitHub Pages, 사내 웹서버 모두 가능) 자세한 내용은 [DEPLOYMENT.md](../DEPLOYMENT.md)를 보세요.

## 참고: 외부에서 가져다 쓰는 것

- 오픈소스: React 19 (MIT), Pretendard 글꼴 (SIL OFL) — 라이선스 고지는 `assets/THIRD_PARTY_NOTICES.txt` 에 있으며 `npm run notices` 로 다시 만들 수 있습니다.
- 기본 탐색(검색·필터·상세·관계도·질문 검색의 기본 검색)은 브라우저에서 처리하며 외부 서버를 호출하지 않습니다. 질문 검색에서 **AI 추천을 고른 경우에만** 이용자가 넣은 키로 외부 모델 API(Google Gemini API)를 호출합니다. ([AI_FEATURE.md](AI_FEATURE.md)) AI 추천을 쓰지 않을 기관은 `site.json` 의 `ai.modes` 를 `["local"]` 로 둡니다.
- 화면에서 포털로 이동하는 링크는 이용자가 눌렀을 때만 새 창으로 열립니다.
