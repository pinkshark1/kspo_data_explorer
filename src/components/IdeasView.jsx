import { useMemo } from "react";

const PREVIEW_COUNT = 4;

// "연계 아이디어" 화면: data/site.json 의 ideas 를 카드로 보여주고, 각 아이디어와 관련된 카탈로그 데이터로 바로 이동할 수 있게 한다.
export default function IdeasView({ orgName, ideas, notice, datasets, onOpenDataset, onShowAll }) {
  const byNo = useMemo(() => new Map(datasets.map((dataset) => [dataset.no, dataset])), [datasets]);

  return (
    <section className="standalone-content" id="main-content">
      <div className="ideas-heading">
        <span>데이터 연계</span>
        <h1>타기관 연계·활용 아이디어</h1>
        <p>{orgName} 보유 데이터와 외부 공공데이터를 결합한 활용 후보입니다.</p>
        {notice && <p className="ideas-notice">※ {notice}</p>}
      </div>
      <div className="idea-grid">
        {ideas.map((idea, index) => {
          const linked = (idea.datasetNos ?? []).map((no) => byNo.get(no)).filter(Boolean);
          return (
            <article key={index}>
              <div className="idea-top">
                <span className={`priority p${idea.priority}`}>우선순위 {idea.priority}</span>
                <b>{String(index + 1).padStart(2, "0")}</b>
              </div>
              <h2>{idea.field}</h2>
              <p>{idea.scenario}</p>
              <dl>
                <dt>{orgName} 보유 데이터</dt>
                <dd>{idea.data}</dd>
                <dt>연계 대상기관</dt>
                <dd>{idea.partner}</dd>
              </dl>
              {linked.length > 0 && (
                <div className="idea-links">
                  <b>
                    데이터 지도에서 확인 <small>{linked.length}건</small>
                  </b>
                  <ul>
                    {linked.slice(0, PREVIEW_COUNT).map((dataset) => (
                      <li key={dataset.no}>
                        <button type="button" onClick={() => onOpenDataset(dataset)}>
                          {dataset.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="idea-show-all"
                    aria-label={`${idea.field} 관련 데이터 ${linked.length}건 모두 보기`}
                    onClick={() => onShowAll(idea, linked)}
                  >
                    관련 데이터 {linked.length}건 모두 보기 →
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
