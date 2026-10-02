// 모든 화면 하단: 서비스 범위, 데이터 현황(비어 있는 항목 포함), 기준일, 원문 포털 안내, 오픈소스 고지
export default function SiteFooter({ site, coverage, generatedAt, metaFetchedAt }) {
  const { portals } = site;
  // 문장 속에서 기관을 부르는 말 (KSPO: "공단"). 없으면 기관 이름을 쓴다.
  const callName = site.organization.callName || site.organization.name;
  // 수록 데이터가 없는 포털은 건수·목록 바로가기에서 뺀다. (공공데이터포털에만 개방한 기관 등)
  const listed = [
    { key: "public", count: coverage.publicCount },
    { key: "culture", count: coverage.cultureCount },
  ].filter((portal) => portal.count > 0);
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <section aria-labelledby="footer-scope">
          <h2 id="footer-scope">데이터 안내</h2>
          <p>{site.service.scope}</p>
          <ul className="coverage-list">
            <li>
              수록 데이터 <b>{coverage.total}건</b> ({listed.map((portal) => `${portals[portal.key].label} ${portal.count}건`).join(" · ")})
            </li>
            <li>
              컬럼 정의 {coverage.withColumns}건 · 샘플 데이터 {coverage.withSample}건 · 원문 주소 {coverage.withSourceUrl}건 연결 (전체 {coverage.total}건 중)
            </li>
            <li>
              목록 기준일 <b>{generatedAt}</b>
              {metaFetchedAt && (
                <>
                  {" "}
                  · 포털 정보 확인일 <b>{metaFetchedAt}</b>
                </>
              )}
            </li>
          </ul>
        </section>

        <section aria-labelledby="footer-portals">
          <h2 id="footer-portals">원문 포털</h2>
          <ul>
            {listed.map(({ key }) => (
              <li key={key}>
                <a href={portals[key].listUrl} target="_blank" rel="noreferrer">
                  {portals[key].label}에서 {callName} 데이터 목록 보기 <span>(새 창)</span>
                </a>
              </li>
            ))}
          </ul>
          <p>이용허락범위·담당부서·문의처는 각 데이터의 ‘데이터 정보’와 원문 포털 페이지를 기준으로 합니다.</p>
        </section>

        <section aria-labelledby="footer-notice">
          <h2 id="footer-notice">고지</h2>
          <ul>
            <li>
              <a href="assets/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">
                오픈소스 라이선스 고지 <span>(새 창)</span>
              </a>
            </li>
          </ul>
          <p>{site.organization.name} · {site.service.fullName}</p>
        </section>
      </div>
    </footer>
  );
}
