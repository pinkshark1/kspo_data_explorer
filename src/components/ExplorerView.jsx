import { ALL, portalOf, shortField } from "../lib/catalog.js";
import DatasetProfile from "./DatasetProfile.jsx";

// "데이터 탐색" 화면: 조건(필터) 영역 + 데이터셋 목록 + 선택한 데이터 상세
export default function ExplorerView({
  totalCount,
  categories,
  cycleOptions,
  filters,
  ideaFilter,
  onChangeFilter,
  onResetFilters,
  onClearIdeaFilter,
  results,
  selected,
  detail,
  related,
  tab,
  portals,
  portalInfo,
  infoRows,
  metaFetchedAt,
  onChangeTab,
  onSelectDataset,
  onChangeOperation,
}) {
  return (
    <div className="explorer-shell" id="main-content">
      {ideaFilter && (
        <div className="idea-filter-notice" role="status">
          <span>
            연계 아이디어 <b>“{ideaFilter.title}”</b>와 관련된 데이터만 표시 중입니다.
          </span>
          <button type="button" onClick={onClearIdeaFilter}>
            전체 데이터 보기
          </button>
        </div>
      )}
      <section className="explorer-controls" aria-label="데이터 검색 조건">
        <div className="filter-title">
          <small>데이터 검색</small>
          <h2>조건으로 찾기</h2>
        </div>
        <div className="filter-fields">
          <label>
            <span>카테고리</span>
            <select value={filters.field} onChange={(event) => onChangeFilter("field", event.target.value)}>
              <option value={ALL}>전체 데이터 ({totalCount})</option>
              {categories.map((category) => (
                <option key={category.name} value={category.name}>
                  {shortField(category.name)} ({category.count})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>개방 포털</span>
            <select value={filters.portal} onChange={(event) => onChangeFilter("portal", event.target.value)}>
              <option value={ALL}>전체</option>
              <option value="public">{portals.public.label}</option>
              <option value="culture">{portals.culture.label}</option>
            </select>
          </label>
          <label>
            <span>데이터 유형</span>
            <select value={filters.delivery} onChange={(event) => onChangeFilter("delivery", event.target.value)}>
              <option value={ALL}>전체</option>
              <option value="파일">파일</option>
              <option value="API">API</option>
            </select>
          </label>
          <label>
            <span>업데이트 주기</span>
            <select value={filters.cycle} onChange={(event) => onChangeFilter("cycle", event.target.value)}>
              <option value={ALL}>전체</option>
              {cycleOptions.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.label} ({option.count})
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="filter-actions">
          <span>
            <b>{results.length}</b>건 검색됨
          </span>
          <button type="button" onClick={onResetFilters}>
            조건 초기화
          </button>
        </div>
      </section>

      <div className="workspace">
        <aside className="sidebar">
          <section className="dataset-section">
            <div className="side-heading">
              <span>데이터셋 목록</span>
              <small>{results.length}건</small>
            </div>
            <div className="dataset-list">
              {results.length > 0 ? (
                results.map((dataset) => {
                  const portal = portalOf(dataset);
                  return (
                    <button key={dataset.no} className={selected.no === dataset.no ? "active" : ""} onClick={() => onSelectDataset(dataset)}>
                      <span className="table-icon">▦</span>
                      <span>
                        <b>{dataset.name}</b>
                        <small>
                          {shortField(dataset.field)} · {dataset.ptype}
                        </small>
                      </span>
                      <i className={`portal-mark ${portal}`} aria-label={`${portals[portal].label} 개방 데이터`} title={portals[portal].label}>
                        <span aria-hidden="true">{portals[portal].mark}</span>
                        {portals[portal].shortLabel}
                      </i>
                    </button>
                  );
                })
              ) : (
                <p className="empty-list">조건에 맞는 데이터가 없습니다.</p>
              )}
            </div>
          </section>
        </aside>

        <DatasetProfile
          dataset={selected}
          detail={detail}
          related={related}
          tab={tab}
          portalInfo={portalInfo}
          infoRows={infoRows}
          metaFetchedAt={metaFetchedAt}
          onChangeTab={onChangeTab}
          onSelectDataset={onSelectDataset}
          onChangeOperation={onChangeOperation}
        />
      </div>
    </div>
  );
}
