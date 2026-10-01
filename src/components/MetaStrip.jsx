// 데이터 상세 상단의 "데이터 정보": 포털 수정일, 이용허락범위, 관리부서·문의 (포털 상세 페이지에서 수집한 값)
export default function MetaStrip({ rows, portalName, fetchedAt }) {
  if (!rows.length) return null;
  return (
    <section className="meta-strip" aria-label="데이터 정보">
      <h2>
        데이터 정보
        <small>
          {portalName} 상세 페이지 기준{fetchedAt ? ` · ${fetchedAt} 확인` : ""}
        </small>
      </h2>
      <dl>
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
