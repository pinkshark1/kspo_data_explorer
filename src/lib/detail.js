// 선택한 데이터셋 하나를 화면에 보여주기 위해 필요한 메타데이터·샘플을 한곳에서 해석한다.
// (컬럼정의서가 있는지, 샘플이 CSV인지 API 응답인지 등에 따라 화면 문구가 달라진다.)

import { portalOf } from "./catalog.js";

const CULTURE_FILE = "문화빅데이터포털(파일)";
const PUBLIC_API = "공공데이터포털(API)";

export function resolveDetail(dataset, store, operationPath) {
  const key = String(dataset.no);
  const isCultureFile = dataset.ch === CULTURE_FILE;
  const isPublic = dataset.ch.startsWith("공공데이터포털");
  const isPublicApi = dataset.ch === PUBLIC_API;
  const isPortalData = isCultureFile || isPublic;

  const cultureColumns = store.cultureColumns[key];
  const publicMeta = store.publicMeta[key];
  const meta = cultureColumns ?? publicMeta;

  // 포털이 컬럼 정의를 주지 않으면 비워 둔다. (컬럼명을 임의로 만들지 않는다)
  const columns = isPortalData ? (meta?.columns ?? []) : [];
  const hasColumns = columns.length > 0;
  // 문화빅데이터포털의 컬럼정의서에는 타입·길이·PK·NOT NULL 이 함께 들어 있다.
  const hasDefinition = isCultureFile && columns.some((column) => column.type || column.length || column.pk || column.notNull);
  const operations = publicMeta?.operations ?? [];

  const cultureSample = store.cultureSamples[key];
  const csvSample = store.publicSamples[key] ?? cultureSample;
  const apiOperations = store.apiSamples[key] ?? [];
  const apiSample = apiOperations.find((operation) => operation.path === operationPath) ?? apiOperations[0];
  const sample = csvSample ?? apiSample;

  const tableColumns = apiSample?.columns ?? csvSample?.columns.map((name) => ({ name, label: name })) ?? columns;
  const rows = sample?.rows ?? [];

  return {
    portalName: store.site.portals[portalOf(dataset)].label,
    isCultureFile,
    isPublic,
    isPublicApi,
    isPortalData,
    sourceUrl: meta?.sourceUrl || dataset.url || "",
    columns,
    hasColumns,
    hasDefinition,
    operations,
    csvSample,
    isCultureSample: !!cultureSample,
    apiOperations,
    apiSample,
    tableColumns,
    rows,
    hasRows: rows.length > 0,
    totalRows: apiSample?.totalCount ?? csvSample?.totalRows,
  };
}
