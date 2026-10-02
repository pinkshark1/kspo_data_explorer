# 데이터 파일 구조

화면은 `data/` 아래 JSON 3개를 읽습니다. 코드를 고치지 않고 이 파일들만 바꿔도 내용이 바뀝니다. 파일을 바꾼 뒤에는 `npm run check:data` 로 점검하세요.

| 파일 | 만드는 방법 | 없으면 |
|---|---|---|
| `explorer-data.json` | 데이터셋 목록·컬럼·샘플 (직접 준비) | 화면이 열리지 않음(오류 안내 표시) |
| `site.json` | 서비스 이름·문구·사용방법·연계 아이디어 (직접 작성) | 화면이 열리지 않음 |
| `portal-meta.json` | `npm run fetch:meta` 로 포털에서 자동 수집 | ‘데이터 정보’ 영역만 표시되지 않음 |

## explorer-data.json

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-01",   // 화면 하단 ‘목록 기준일’로 표시됨. 목록에 데이터를 추가·수정한 날로 갱신
  "source": "...",               // 만든 곳 메모 (화면에는 표시 안 함)
  "payloads": [ /* 아래 6개, 순서 고정 */ ]
}
```

`payloads` 는 **순서가 정해진 6개 항목**입니다. (순서는 `src/lib/data.js` 의 `PAYLOAD` 표와 같습니다.) 데이터셋 번호(`no`)가 각 항목을 잇는 열쇠입니다.

| 위치 | 이름 | 형태 | 내용 |
|---|---|---|---|
| 0 | catalog | 배열 | 데이터셋 목록. 아래 ‘catalog 항목’ 참고 |
| 1 | cultureColumns | `{ [no]: … }` | 문화빅데이터포털 컬럼정의서: `sourceUrl`, `columns[{order,name,label,type,length,pk,notNull}]` |
| 2 | cultureSamples | `{ [no]: … }` | 문화빅데이터포털 CSV 샘플: `columns[컬럼명]`, `rows[[값…]]`, `sourceFile` |
| 3 | publicMeta | `{ [no]: … }` | 공공데이터포털 메타: `sourceUrl`, `portalType`, `columns[{name,label}]`, `operations[{name,path,columns}]`(API만) |
| 4 | publicSamples | `{ [no]: … }` | 공공데이터포털 파일 CSV 샘플: `columns`, `rows`, `totalRows` |
| 5 | apiSamples | `{ [no]: [ … ] }` | 공공데이터포털 OpenAPI 응답 샘플: 상세 기능별 `{operationName,path,columns,rows,totalCount}` |

### catalog 항목

```jsonc
{
  "no": 7,                          // 데이터 번호 (중복 불가). 다른 파일이 이 번호로 연결됨
  "ch": "문화빅데이터포털(파일)",     // 채널: 문화빅데이터포털(파일) | 공공데이터포털(파일) | 공공데이터포털(API)
  "field": "경륜",                  // 카테고리. "상위>하위" 형태면 하위만 화면에 보임
  "name": "경륜 등록 선수 데이터",
  "ptype": "파일데이터",            // 목록에 보이는 제공 형태
  "status": "개방",                 // "개방" 이외 값은 상세 제목 옆에 배지로 표시
  "cycle": "Yearly",                // 업데이트 주기. Yearly/연간→연 1회, Monthly→월 1회, 비주기/수시→수시, 실시간→실시간
  "desc": "o 데이터 소개\n- …",      // 설명. 첫 의미 있는 줄만 상단에 표시
  "kw": "",                         // 검색용 키워드(선택)
  "url": "",                        // 원문 주소(선택). payloads[1]·[3]의 sourceUrl 이 우선
  "sys": "경륜운영관리시스템"         // 출처 시스템 (관계도의 ‘정보시스템’ 노드)
}
```

- **채널이 화면을 결정**합니다: `ch` 로 개방 포털·데이터 유형(파일/API)이 정해지고, 어떤 payload 에서 컬럼·샘플을 찾을지가 정해집니다.
- 컬럼 정의나 샘플이 없는 데이터는 **빈 값으로 두면** 화면이 ‘정의서 미제공’ 등으로 안내합니다. 컬럼명을 임의로 채우지 마세요.
- 문화빅데이터포털 데이터에서 포털이 컬럼정의서를 제공하지 않으면(포털 응답 “컬럼정의서가 존재하지 않습니다”) `payloads[1]` 에 `{ datasetName, sourceUrl, columns: [] }` 만 넣습니다. 원문 주소는 연결되고 화면은 ‘정의서 미제공’으로 안내하며, `npm run check:data` 는 이를 ‘포털에도 정의서가 없는 데이터’로 구분해 알립니다. (`payloads[1]` 항목 자체가 없으면 ‘원문 주소 없음’·‘컬럼 정의 없음’ 경고)
- `payloads[1]` 에 `integratedIntoRecordNo` 가 있으면 그 정의서는 다른 데이터에 통합된 것으로, 목록에 번호가 없어도 경고하지 않습니다.
- **샘플에는 개인정보를 넣지 마세요.** 이름·작성자·연락처는 마스킹(`한○○`)합니다. `scripts/mask-sample-data.mjs` 의 `RULES`(컬럼 단위) 에 컬럼을 추가해 일괄 처리하고, 자유서술 본문 속 실명·문장은 로컬 파일 `scripts/mask-text-rules.local.json` 의 규칙으로 가립니다(실명은 ‘신○○’, 문장은 ‘[내용 마스킹]’). 이 규칙 파일에는 실명이 들어가므로 `.gitignore` 로 저장소에서 제외합니다. `npm run check:data` 가 마스킹되지 않은 이름 컬럼을 오류로, 검토하지 않은 자유서술 컬럼을 경고로 알려줍니다.

## site.json

| 키 | 설명 |
|---|---|
| `organization.name` | 기관명. 상단 로고 옆과 푸터에 표시 |
| `service.name` / `fullName` | 서비스 이름(로고 옆) / 전체 이름(푸터) |
| `service.bannerText` | 맨 위 안내띠 문구 |
| `service.scope` | 푸터의 ‘데이터 안내’ 첫 문장 (안내 범위를 밝히는 문구) |
| `portals.public` / `portals.culture` | 포털 설정(둘 다 필요). `label`(이름), `shortLabel`(목록의 짧은 표기), `mark`(배지 글자 1자), `listUrl`(공단 데이터 목록 주소 - 원문 주소가 없을 때의 대체 링크), `homeUrl`, `termsNote`(이용 조건 문구, 문화빅데이터포털) |
| `guide` | 사용방법 화면: `title`, `lead`, `video`, `poster`, `externalUrl`(선택), `steps[{title,text}]` |
| `ai` | 질문 검색(AI 추천) 설정: `enabled`, `navLabel`, `modes`(`local`·`gemini`·`gateway`), `defaultMode`, `gemini{model,maxTokens,keyGuideUrl}`, `gateway{url,label}`, `exampleQuestions`, `notice`. 자세한 설명은 [AI_FEATURE.md](AI_FEATURE.md). 키는 넣지 않는다 |
| `ideasNotice` | 연계 아이디어 화면 상단의 유의 문구 |
| `ideas[]` | 연계 아이디어: `field`(제목), `scenario`, `data`, `partner`, `priority`(`상`/`중`/`하`), `datasetNos`(관련 데이터 번호 배열) |

`ideas[].datasetNos` 의 번호는 모두 `catalog` 에 있어야 하며(점검 스크립트가 확인), 카드의 ‘데이터 지도에서 확인’ 링크와 ‘관련 데이터 모두 보기’ 필터에 쓰입니다.

## portal-meta.json

`npm run fetch:meta` 가 각 데이터의 포털 상세 페이지(공공데이터포털·문화빅데이터포털)를 읽어 만듭니다. 직접 고치지 않습니다.

```jsonc
{
  "fetchedAt": "2026-10-01",       // 화면의 ‘확인일’
  "culturePublishers": {           // 문화빅데이터포털 제공기관 계정별 포털 보유 건수 (수집 시점)
    "kspo_org":        { "name": "국민체육진흥공단", "portalCount": 95 },
    "kspo_center_org": { "name": "체육종합빅데이터센터", "portalCount": 2 }
  },
  "items": {
    "108": { "portal": "public", "license": "이용허락범위 제한 없음", "department": "디지털혁신팀",
             "phone": "02-410-1674", "modifiedAt": "2026-06-08", "portalCycle": "연간", … },
    "7":   { "portal": "culture", "price": "무료", "portalCycle": "Yearly", "modifiedAt": "2026-08-18", "publisherId": "kspo_org" }
  },
  "failures": [],                 // 수집에 실패한 번호
  "withoutSourceUrl": [2,3,4,5,6] // 원문 주소가 없어 건너뛴 번호
}
```

- 공공데이터포털: 이용허락범위, 관리부서명·전화번호, 수정일, 갱신주기 등을 화면에 보여줍니다. 전화번호는 포털이 공개한 관리부서 대표 번호이며 개인 연락처가 아닙니다.
- 문화빅데이터포털: 상세 페이지에 이용허락범위 항목이 없어 수정일·가격·갱신주기만 수집하고, 이용 조건은 `site.json` 의 `portals.culture.termsNote`(플랫폼 이용약관·저작권정책 적용)로 안내합니다.
- 문화빅데이터포털은 **제공기관 계정마다 보유 건수를 따로 셉니다.** 같은 서비스의 데이터라도 다른 기관 계정(예: 체육종합빅데이터센터)으로 등록되면 국민체육진흥공단 계정의 건수에 포함되지 않습니다. 그래서 `npm run check:data -- --online` 은 계정별로 ‘포털 보유 건수 = 목록의 해당 계정 건수’를 비교합니다.
- 포털 화면 구조가 바뀌면 값이 비어 나올 수 있습니다. 수집 후 `npm run check:data` 의 경고를 확인하세요.
