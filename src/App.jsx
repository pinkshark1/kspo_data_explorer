import { useMemo, useState } from "react";
import { ALL, cycleOptions as buildCycleOptions, fieldOptions, filterDatasets, portalOf, relatedDatasets } from "./lib/catalog.js";
import { summarizeCoverage } from "./lib/coverage.js";
import { resolveDetail } from "./lib/detail.js";
import { portalInfoRows } from "./lib/portalMeta.js";
import SiteHeader from "./components/SiteHeader.jsx";
import SiteFooter from "./components/SiteFooter.jsx";
import ExplorerView from "./components/ExplorerView.jsx";
import GuideView from "./components/GuideView.jsx";
import RelationshipGraph from "./components/RelationshipGraph.jsx";
import IdeasView from "./components/IdeasView.jsx";
import AskView from "./components/AskView.jsx";

const INITIAL_FILTERS = { field: ALL, portal: ALL, delivery: ALL, cycle: ALL };

// 목록·상세가 위아래로 쌓이는 좁은 화면(CSS 의 920px 구간과 같은 기준)
const isStackedLayout = () => window.matchMedia("(max-width: 920px)").matches;

export default function App({ data }) {
  const { site, datasets } = data;

  const [view, setView] = useState("explorer");
  const [tab, setTab] = useState("summary");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [ideaFilter, setIdeaFilter] = useState(null); // { title, nos:Set } - 연계 아이디어에서 넘어온 경우
  const [operationPath, setOperationPath] = useState("");
  const [askSaved, setAskSaved] = useState(null); // 질문 검색에서 마지막으로 물어본 질문·결과 (다른 화면에 다녀와도 유지, API 키는 제외)
  const [selected, setSelected] = useState(
    () => datasets.find((dataset) => data.cultureColumns[String(dataset.no)] || data.publicMeta[String(dataset.no)]) ?? datasets[0],
  );

  const categories = useMemo(() => fieldOptions(datasets), [datasets]);
  const cycleOptions = useMemo(() => buildCycleOptions(datasets), [datasets]);
  const coverage = useMemo(() => summarizeCoverage(data), [data]);
  const results = useMemo(
    () => filterDatasets(datasets, { query, ...filters, onlyNos: ideaFilter?.nos ?? null }),
    [datasets, query, filters, ideaFilter],
  );
  const related = useMemo(() => relatedDatasets(datasets, selected), [datasets, selected]);
  const detail = resolveDetail(selected, data, operationPath);
  const infoRows = portalInfoRows(selected, data.portalMeta, site);

  // 목록에서 데이터를 고르면 상세를 보여준다. 위아래로 쌓인 좁은 화면에서는 상세 위치로, 넓은 화면에서는 맨 위로 이동.
  const selectDataset = (dataset) => {
    // 관계도·연계 아이디어 등 다른 화면에서 열 때, 예전 검색어·필터 때문에 목록에 없는 데이터라면 조건을 풀어 목록과 상세가 맞게 한다.
    if (view !== "explorer" && !results.some((item) => item.no === dataset.no)) {
      setFilters(INITIAL_FILTERS);
      setQuery("");
      setIdeaFilter(null);
    }
    setSelected(dataset);
    setOperationPath("");
    setTab("summary");
    setView("explorer");
    requestAnimationFrame(() => {
      const profile = document.querySelector(".profile");
      if (isStackedLayout() && profile) profile.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const changeQuery = (value) => {
    setQuery(value);
    setView("explorer");
  };

  const submitSearch = (event) => {
    event.preventDefault();
    setView("explorer");
    if (query.trim() && results[0]) {
      setSelected(results[0]);
      setTab("summary");
    }
    requestAnimationFrame(() => {
      document.getElementById("main-content")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS);
    setIdeaFilter(null);
  };

  // 안내띠의 "전체 데이터 보기"를 누르면 그 버튼이 사라지므로, 키보드 초점을 조건 영역으로 옮긴다.
  const clearIdeaFilter = () => {
    setIdeaFilter(null);
    requestAnimationFrame(() => document.querySelector(".explorer-controls select")?.focus());
  };

  // 로고(데이터 탐색 홈)를 누르면 연계 아이디어 필터는 풀고 탐색 화면으로 돌아간다.
  const goHome = () => {
    setIdeaFilter(null);
    setView("explorer");
  };

  // 연계 아이디어의 "관련 데이터 모두 보기": 해당 아이디어의 데이터만 탐색 화면에 모아 보여준다.
  const showIdeaDatasets = (idea, linked) => {
    setFilters(INITIAL_FILTERS);
    setQuery("");
    setIdeaFilter({ title: idea.field, nos: new Set(linked.map((dataset) => dataset.no)) });
    setSelected(linked[0]);
    setOperationPath("");
    setTab("summary");
    setView("explorer");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="app-shell">
      <SiteHeader
        site={site}
        view={view}
        onChangeView={setView}
        onGoHome={goHome}
        query={query}
        onChangeQuery={changeQuery}
        onSubmitSearch={submitSearch}
      />

      {view === "guide" && <GuideView guide={site.guide} />}

      {view === "explorer" && (
        <ExplorerView
          totalCount={datasets.length}
          categories={categories}
          cycleOptions={cycleOptions}
          filters={filters}
          ideaFilter={ideaFilter}
          onChangeFilter={(name, value) => setFilters((current) => ({ ...current, [name]: value }))}
          onResetFilters={resetFilters}
          onClearIdeaFilter={clearIdeaFilter}
          results={results}
          selected={selected}
          detail={detail}
          related={related}
          tab={tab}
          portals={site.portals}
          portalInfo={site.portals[portalOf(selected)]}
          infoRows={infoRows}
          metaFetchedAt={data.portalMetaFetchedAt}
          onChangeTab={setTab}
          onSelectDataset={selectDataset}
          onChangeOperation={setOperationPath}
        />
      )}

      {view === "ask" && <AskView store={data} saved={askSaved} onSave={setAskSaved} onOpenDataset={selectDataset} />}

      {view === "map" && (
        <section className="standalone-content" id="main-content">
          <RelationshipGraph title={site.service.fullName} datasets={datasets} onOpenDataset={selectDataset} />
        </section>
      )}

      {view === "ideas" && (
        <IdeasView
          orgName={site.organization.shortName}
          ideas={site.ideas}
          notice={site.ideasNotice}
          datasets={datasets}
          onOpenDataset={selectDataset}
          onShowAll={showIdeaDatasets}
        />
      )}

      <SiteFooter site={site} coverage={coverage} generatedAt={data.generatedAt} metaFetchedAt={data.portalMetaFetchedAt} />
    </main>
  );
}
