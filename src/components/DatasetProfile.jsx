import { cycleLabel, portalOf, shortField, statusClass, summaryLine } from "../lib/catalog.js";
import OverviewPanel from "./profile/OverviewPanel.jsx";
import TablesPanel from "./profile/TablesPanel.jsx";
import ColumnsPanel from "./profile/ColumnsPanel.jsx";
import SamplePanel from "./profile/SamplePanel.jsx";
import RelatedPanel from "./profile/RelatedPanel.jsx";
import MetaStrip from "./MetaStrip.jsx";

// "API 기능" 탭은 오픈API 데이터에만 있다. (파일 데이터는 보여줄 내용이 없어 탭을 두지 않는다)
const TABS = [
  { id: "summary", label: "한눈에 보기" },
  { id: "tables", label: "API 기능", apiOnly: true },
  { id: "columns", label: "항목(컬럼)" },
  { id: "sample", label: "샘플 데이터" },
  { id: "related", label: "연관 데이터" },
];

// 데이터셋 상세 화면: 제목·원문 링크, 요약 카드, 메타데이터 반영 상태, 탭별 내용
export default function DatasetProfile({
  dataset,
  detail,
  related,
  tab,
  portalInfo,
  orgCallName,
  infoRows,
  metaFetchedAt,
  onChangeTab,
  onSelectDataset,
  onChangeOperation,
}) {
  const portal = portalOf(dataset);

  const qualityMessage = detail.hasDefinition
    ? "항목마다 자료형·길이·고유 키·필수 값 여부까지 확인할 수 있습니다."
    : detail.apiSample
      ? `제공된 XML의 실제 API 응답 ${detail.rows.length}행도 함께 확인할 수 있습니다.`
      : detail.csvSample
        ? `제공된 CSV의 실제 데이터 ${detail.rows.length}행도 함께 확인할 수 있습니다.`
        : "현재는 컬럼명과 한글명을 제공합니다.";
  const qualityTag = detail.hasDefinition ? "공식 컬럼정의서" : detail.apiSample ? "원본 XML 샘플" : detail.csvSample ? "원본 CSV 샘플" : "공식 메타데이터";

  const tabs = TABS.filter((item) => !item.apiOnly || detail.isPublicApi);
  const activeTab = tabs.some((item) => item.id === tab) ? tab : "summary";
  const tabCount = {
    tables: detail.operations.length,
    columns: detail.columns.length,
    sample: detail.hasRows ? detail.rows.length : null,
    related: related.length,
  };

  return (
    <section className="profile">
      <div className="breadcrumbs">
        <span>홈</span>
        <i>›</i>
        <span>데이터 탐색</span>
        <i>›</i>
        <span>{shortField(dataset.field)}</span>
        <i>›</i>
        <b>{dataset.name}</b>
      </div>

      <header className="profile-header">
        <div>
          <div className="title-line">
            <h1>{dataset.name}</h1>
            <span className={`portal-badge ${portal}`}>
              <i aria-hidden="true">{portalInfo.mark}</i>
              {portalInfo.label}
            </span>
            {dataset.status !== "개방" && <span className={`status-badge ${statusClass(dataset.status)}`}>{dataset.status}</span>}
          </div>
          <p>{summaryLine(dataset.desc)}</p>
        </div>
        <div className="profile-actions">
          {detail.sourceUrl ? (
            <a
              className="request-button"
              href={detail.sourceUrl}
              target="_blank"
              rel="noreferrer"
              title={`새 창에서 ${portalInfo.label}의 해당 데이터 페이지로 이동합니다`}
            >
              ↗ 데이터 원문 <span className="request-target">{portalInfo.label}</span>
            </a>
          ) : (
            <>
              <a
                className="request-button secondary"
                href={portalInfo.listUrl}
                target="_blank"
                rel="noreferrer"
                title={`새 창에서 ${portalInfo.label}의 ${orgCallName} 데이터 목록으로 이동합니다`}
              >
                ↗ {portalInfo.label}에서 찾기
              </a>
              <p className="source-missing">이 데이터는 원문 페이지 주소가 아직 연결되지 않았습니다. 포털의 {orgCallName} 데이터 목록에서 같은 이름의 데이터를 찾을 수 있습니다.</p>
            </>
          )}
        </div>
      </header>

      <div className="profile-facts" aria-label="데이터 요약">
        <span>업데이트 <b>{cycleLabel(dataset.cycle)}</b></span>
        <span>항목 <b>{detail.hasColumns ? `${detail.columns.length}개` : "포털 설명 없음"}</b></span>
        <span>{dataset.ptype}</span>
      </div>

      <nav className="profile-tabs" aria-label="데이터 상세 메뉴">
        {tabs.map((item) => (
          <button key={item.id} className={activeTab === item.id ? "active" : ""} aria-current={activeTab === item.id ? "page" : undefined} onClick={() => onChangeTab(item.id)}>
            {item.label}
            {tabCount[item.id] != null && <small>{tabCount[item.id]}</small>}
          </button>
        ))}
      </nav>

      {activeTab === "summary" && (
        <>
          <OverviewPanel dataset={dataset} detail={detail} onOpenTab={onChangeTab} />
          <section className="profile-information" aria-label="출처와 이용 정보">
            <p className="source-system">만든 곳(업무시스템) <strong>{dataset.sys}</strong></p>
            <div className="quality-strip">
              <span>ⓘ</span>
              {detail.hasColumns ? (
                <>
                  <p>
                    <b>{detail.portalName} 공식 메타데이터를 반영했습니다.</b> {qualityMessage}
                  </p>
                  <em>{qualityTag}</em>
                </>
              ) : (
                <>
                  <p>
                    <b>포털에서 컬럼 정의서를 제공하지 않는 데이터입니다.</b> 확인되지 않은 컬럼명은 임의로 만들지 않았습니다.
                  </p>
                  <em>정의서 미제공</em>
                </>
              )}
            </div>

            <MetaStrip rows={infoRows} portalName={portalInfo.label} fetchedAt={metaFetchedAt} />
          </section>
        </>
      )}
      {activeTab === "tables" && <TablesPanel detail={detail} onOpenTab={onChangeTab} />}
      {activeTab === "columns" && <ColumnsPanel detail={detail} />}
      {activeTab === "sample" && <SamplePanel detail={detail} onChangeOperation={onChangeOperation} />}
      {activeTab === "related" && <RelatedPanel related={related} onSelect={onSelectDataset} />}
    </section>
  );
}
