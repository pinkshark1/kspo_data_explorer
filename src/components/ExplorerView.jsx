import { useEffect, useRef, useState } from "react";
import { ALL, portalOf, shortField } from "../lib/catalog.js";
import DatasetProfile from "./DatasetProfile.jsx";

// 첫 화면 소개: 무엇을 하는 곳인지 한 줄로 알리고, 질문을 바로 입력할 수 있게 한다. (입력하면 ‘질문 검색’으로 넘어가 찾는다)
function HomeIntro({ intro, exampleQuestions, onAsk }) {
  const [text, setText] = useState("");
  const submit = (event) => {
    event.preventDefault();
    if (text.trim().length >= 2) onAsk(text.trim());
  };
  return (
    <section className="home-intro" aria-labelledby="home-intro-title">
      <h2 id="home-intro-title">{intro.title}</h2>
      {intro.text && <p>{intro.text}</p>}
      <form className="home-ask" onSubmit={submit} role="search" aria-label="질문으로 데이터 찾기">
        <label htmlFor="home-question" className="sr-only">
          궁금한 점
        </label>
        <input
          id="home-question"
          type="text"
          maxLength={300}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="궁금한 점을 문장으로 물어보세요"
        />
        <button type="submit">질문하기</button>
      </form>
      {exampleQuestions.length > 0 && (
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
  // 선택한 데이터가 목록 아래쪽에 있으면(예: 첫 화면의 대표 데이터) 목록 상자만 그 위치로 스크롤한다. (페이지는 움직이지 않음)
  const listRef = useRef(null);
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector("button.active");
    if (!list || !active) return;
    const top = active.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop; // 목록 상자 안에서의 위치
    if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - active.offsetHeight) list.scrollTop = top - 8;
  }, [selected.no]);

  return (
    <div className="explorer-shell" id="main-content">
      {intro?.title && !ideaFilter && <HomeIntro intro={intro} exampleQuestions={exampleQuestions} onAsk={onAsk} />}
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
          {query.trim() && (
            <span className="query-chip">
              검색어 <b>{query.trim()}</b>
              <button type="button" onClick={onClearQuery} aria-label={`검색어 ${query.trim()} 지우기`}>
                ✕
              </button>
            </span>
          )}
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
            <div className="dataset-list" ref={listRef}>
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
                <div className="empty-list">
                  <p>{query.trim() ? `‘${query.trim()}’에 맞는 데이터가 없습니다.` : "조건에 맞는 데이터가 없습니다."}</p>
                  <div>
                    {query.trim() && (
                      <button type="button" onClick={() => onAsk(query.trim())}>
                        질문 검색으로 물어보기
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
      </div>
    </div>
  );
}
