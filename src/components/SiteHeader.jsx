const NAV_ITEMS = [
  { id: "guide", label: "사용방법" },
  { id: "explorer", label: "데이터 탐색" },
  { id: "ask", label: "질문 검색" },
  { id: "map", label: "관계도" },
  { id: "ideas", label: "연계 아이디어" },
];

// 상단 안내띠 + 로고 + 주요 메뉴 + 전체 검색
export default function SiteHeader({ site, view, onChangeView, onGoHome, query, onChangeQuery, onSubmitSearch }) {
  // site.json 에 guide 가 없으면(사용방법을 만들지 않은 기관) 메뉴에서 뺀다.
  // 연계 아이디어가 없는 기관도 같은 방식으로 메뉴에서 뺀다.
  const navItems = NAV_ITEMS.filter((item) => item.id !== "guide" || site.guide)
    .filter((item) => item.id !== "ideas" || site.ideas?.length)
    .filter((item) => item.id !== "ask" || site.ai?.enabled)
    .map((item) => (item.id === "ask" ? { ...item, label: site.ai?.navLabel ?? item.label } : item));
  // 로고 글자: organization.mark 가 없으면 약칭의 첫 글자 (KSPO → K)
  const mark = site.organization.mark || site.organization.shortName.slice(0, 1);
  return (
    <>
      <a className="skip-link" href="#main-content">
        본문 바로가기
      </a>
      <div className="service-banner">
        <div>
          <span className="service-banner-mark" aria-hidden="true">
            {mark}
          </span>
          <p>{site.service.bannerText}</p>
        </div>
      </div>
      <header className="topbar">
        <button className="brand" onClick={onGoHome} aria-label="데이터 탐색 홈">
          <span className="brand-mark">{mark}</span>
          <span className="brand-copy">
            <small>{site.organization.name}</small>
            <strong>{site.service.name}</strong>
          </span>
        </button>
        <nav className="main-nav" aria-label="주요 메뉴">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => onChangeView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <form className="global-search" role="search" onSubmit={onSubmitSearch}>
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(event) => onChangeQuery(event.target.value)}
            placeholder="찾으시는 데이터가 있나요?"
            aria-label="전체 데이터 검색"
          />
          <button type="submit">검색</button>
        </form>
      </header>
    </>
  );
}
