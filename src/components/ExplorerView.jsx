import { useEffect, useRef, useState } from "react";
import { ALL, portalOf, shortField } from "../lib/catalog.js";
import DatasetProfile from "./DatasetProfile.jsx";
import KeywordSearch from "./KeywordSearch.jsx";
import UiIcon from "./UiIcon.jsx";

// 첫 화면에서는 하나의 입력창을 키워드 검색과 AI 질문 검색에 함께 쓴다.
function HomeIntro({ intro, exampleQuestions, onAsk, query, onChangeQuery, onSubmitSearch }) {
  const [mode, setMode] = useState("live");
  const [question, setQuestion] = useState("");
  const isQuestion = mode === "question";
  return (
    <section className="home-intro" aria-labelledby="home-intro-title">
      <h2 id="home-intro-title">{intro?.title || "필요한 공공데이터를 찾아보세요"}</h2>
      {intro?.text && <p>{intro.text}</p>}
      <fieldset className="search-modes">
        <legend className="sr-only">데이터 찾는 방식</legend>
        <label>
          <input type="radio" name="home-search-mode" value="live" checked={!isQuestion} onChange={() => setMode("live")} />
          <span>키워드로 찾기</span>
        </label>
        <label>
          <input type="radio" name="home-search-mode" value="question" checked={isQuestion} onChange={() => { setMode("question"); if (!question) setQuestion(query); }} />
          <span>AI 질문 검색</span>
        </label>
      </fieldset>
      <div className="search-mode-help" id="home-search-help">
        {isQuestion
          ? <p>필요한 내용을 문장으로 적고 <b>추천받기</b>를 누르면, 관련 데이터와 추천 이유를 보여드립니다.</p>
          : <p>데이터명이나 주제어를 입력하면 <b>아래 목록이 바로 좁혀집니다.</b> Enter를 누르면 목록으로 이동합니다.</p>}
      </div>
      <KeywordSearch mode={mode} query={isQuestion ? question : query} onChangeQuery={isQuestion ? setQuestion : onChangeQuery} onSubmitSearch={onSubmitSearch} onAsk={onAsk} describedBy="home-search-help" />
      {isQuestion && <p className="home-question-notice">AI 추천 시 질문과 후보 데이터 요약이 외부 AI로 전송됩니다. 개인정보는 입력하지 마세요.</p>}
      {isQuestion && exampleQuestions.length > 0 && (
        <div className="home-examples">
          <span>이런 질문을 해 보세요</span>
          {exampleQuestions.slice(0, 3).map((question) => (
            <button type="button" key={question} onClick={() => onAsk(question)}>
              {question}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// "데이터 탐색" 화면: 조건(필터) 영역 + 데이터셋 목록 + 선택한 데이터 상세
export default function ExplorerView({
  intro,
  exampleQuestions,
  onAsk,
  query,
  onChangeQuery,
  onSubmitSearch,
  onClearQuery,
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
  orgCallName,
  infoRows,
  metaFetchedAt,
  onChangeTab,
  onSelectDataset,
  onChangeOperation,
}) {
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const activeFilters = [
    { key: "field", label: "분야", value: shortField(filters.field) },
    { key: "portal", label: "개방 포털", value: portals[filters.portal]?.label },
    { key: "delivery", label: "데이터 유형", value: filters.delivery },
    { key: "cycle", label: "업데이트 주기", value: filters.cycle },
  ].filter((item) => filters[item.key] !== ALL);
  const extraFilterCount = activeFilters.filter((item) => item.key !== "field").length;
  // 선택한 데이터가 목록 아래쪽에 있으면(예: 첫 화면의 대표 데이터) 목록 상자만 그 위치로 스크롤한다. (페이지는 움직이지 않음)
  const listRef = useRef(null);
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector("button.active");
    if (!list || !active) return;
    const top = active.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop; // 목록 상자 안에서의 위치
    if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - active.offsetHeight) list.scrollTop = top - 8;
  }, [selected?.no]);

  return (
    <div className="explorer-shell" id="main-content">
      <HomeIntro intro={ideaFilter ? null : intro} exampleQuestions={ideaFilter ? [] : exampleQuestions} onAsk={onAsk} query={query} onChangeQuery={onChangeQuery} onSubmitSearch={onSubmitSearch} />
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
      <section className={`explorer-controls${filtersExpanded ? " filters-expanded" : ""}`} aria-label="데이터 검색 조건">
        <div className="filter-title">
          <small>데이터 검색</small>
          <h2>조건으로 찾기</h2>
        </div>
        <div className="filter-fields">
          <label>
            <span>분야</span>
            <select value={filters.field} onChange={(event) => onChangeFilter("field", event.target.value)}>
              <option value={ALL}>전체 데이터 ({totalCount})</option>
              {categories.map((category) => (
                <option key={category.name} value={category.name}>
                  {shortField(category.name)} ({category.count})
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="filter-toggle" aria-expanded={filtersExpanded} aria-controls="extra-filters" onClick={() => setFiltersExpanded((expanded) => !expanded)}>
            <UiIcon name="filter" /> 상세 필터{extraFilterCount > 0 && <b>{extraFilterCount}</b>}<span aria-hidden="true">{filtersExpanded ? "−" : "+"}</span>
          </button>
          <div className="filter-extra" id="extra-filters">
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
        </div>
        <div className="filter-actions">
          {query.trim() && (
            <span className="query-chip">
              검색어 <b>{query.trim()}</b>
              <button type="button" onClick={onClearQuery} aria-label={`검색어 ${query.trim()} 지우기`}>
                ✕
              </button>
            </span>
          )}
          <span role="status" aria-live="polite" aria-atomic="true">
            <b>{results.length}</b>건 검색됨
          </span>
          <button type="button" onClick={() => { onResetFilters(); setFiltersExpanded(false); }}>
            조건 초기화
          </button>
        </div>
        {activeFilters.length > 0 && (
          <div className="filter-tags" aria-label="적용된 필터">
            {activeFilters.map((item) => (
              <button type="button" key={item.key} aria-label={`${item.label} ${item.value} 해제`} onClick={() => onChangeFilter(item.key, ALL)}>
                <span>{item.label}</span> {item.value} <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="workspace">
        <aside className="sidebar">
          <section className="dataset-section">
            <div className="side-heading">
              <h2 id="dataset-results-heading" tabIndex={-1}>데이터셋 목록</h2>
              <small>{results.length}건</small>
            </div>
            <div className="dataset-list" ref={listRef}>
              {results.length > 0 ? (
                results.map((dataset) => {
                  const portal = portalOf(dataset);
                  return (
                    <button key={dataset.no} className={selected?.no === dataset.no ? "active" : ""} aria-label={`${dataset.name}, ${shortField(dataset.field)}, ${dataset.ptype}, ${portals[portal].label}`} aria-current={selected?.no === dataset.no ? "true" : undefined} onClick={() => onSelectDataset(dataset)}>
                      <UiIcon name="table" className="table-icon" />
                      <span>
                        <b title={dataset.name}>{dataset.name}</b>
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
                <div className="empty-list">
                  <p>{query.trim() ? `‘${query.trim()}’에 맞는 데이터가 없습니다.` : "조건에 맞는 데이터가 없습니다."}</p>
                  <div>
                    {query.trim() && (
                      <button type="button" onClick={() => onAsk(query.trim())}>
                        AI 질문 검색
                      </button>
                    )}
                    <button type="button" onClick={onResetFilters}>
                      조건·검색어 지우기
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </aside>

        {selected ? (
          <DatasetProfile
            dataset={selected}
            detail={detail}
            related={related}
            tab={tab}
            portalInfo={portalInfo}
            orgCallName={orgCallName}
            infoRows={infoRows}
            metaFetchedAt={metaFetchedAt}
            onChangeTab={onChangeTab}
            onSelectDataset={onSelectDataset}
            onChangeOperation={onChangeOperation}
          />
        ) : (
          <section className="profile metadata-empty" aria-label="데이터 상세">
            <h2>조건에 맞는 데이터가 없습니다.</h2>
            <p>검색어나 조건을 바꾸면 해당 데이터의 상세 정보를 확인할 수 있습니다.</p>
          </section>
        )}
      </div>
    </div>
  );
}
