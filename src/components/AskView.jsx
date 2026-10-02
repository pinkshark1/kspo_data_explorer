import { useEffect, useMemo, useRef, useState } from "react";
import { cycleLabel, deliveryOf, portalOf, shortField } from "../lib/catalog.js";
import { buildIndex } from "../ai/retrieval.js";
import { recommend } from "../ai/recommend.js";

const RELEVANCE_LABEL = { high: "관련도 높음", medium: "관련도 보통", low: "참고" };

// 이용자 본인의 API 키로 이 브라우저에서 직접 부르는 방식. 모델·안내 주소는 site.json 의 ai.<방식> 에 있다.
const KEY_MODES = {
  gemini: { name: "Gemini", target: "Google(Gemini)", host: "Google", keyLabel: "Gemini API 키", placeholder: "AIza..." },
};

// 방식 설정에서 고를 수 있는 모델 목록. ai.<방식>.models 가 없으면 기본 모델 하나뿐이다.
function modelsOf(config) {
  return config.models?.length ? config.models : [{ model: config.model, label: config.model }];
}

// 설정(site.json ai.modes)에서 켜진 방식만 보여준다. 기본 검색은 항상 있다.
function availableModes(ai) {
  const wanted = ai.modes ?? ["local"];
  const modes = [{ id: "local", label: "기본 검색", hint: "AI를 쓰지 않고 이 브라우저 안에서만 찾습니다." }];
  for (const [id, info] of Object.entries(KEY_MODES)) {
    if (wanted.includes(id) && ai[id]) {
      const list = modelsOf(ai[id]);
      const hint = list.length > 1 ? `내 ${info.keyLabel}로 ${list.map((entry) => entry.label).join(" · ")} 중 골라 물어봅니다.` : `내 ${info.keyLabel}로 ${list[0].model} 모델에 물어봅니다.`;
      modes.push({ id, label: `AI 추천 (${info.name})`, hint });
    }
  }
  if (wanted.includes("gateway") && ai.gateway?.url) {
    modes.push({ id: "gateway", label: `AI 추천 (${ai.gateway.label || "기관 AI 서버"})`, hint: "기관이 운영하는 AI 서버에 물어봅니다. 키는 필요 없습니다." });
  }
  return modes;
}

function DatasetMark({ dataset, portals }) {
  const portal = portalOf(dataset);
  return (
    <i className={`portal-mark ${portal}`} title={portals[portal].label}>
      <span aria-hidden="true">{portals[portal].mark}</span>
      {portals[portal].shortLabel}
    </i>
  );
}

function ResultItem({ item, rank, portals, onOpen }) {
  const { dataset } = item;
  return (
    <li className="ask-item">
      <span className="ask-rank" aria-hidden="true">
        {rank}
      </span>
      <div className="ask-body">
        <div className="ask-title">
          <b>{dataset.name}</b>
          <DatasetMark dataset={dataset} portals={portals} />
          {item.relevance && <span className={`ask-relevance ${item.relevance}`}>{RELEVANCE_LABEL[item.relevance]}</span>}
        </div>
        <p className="ask-meta">
          {shortField(dataset.field)} · {deliveryOf(dataset)} · 업데이트 {cycleLabel(dataset.cycle)}
        </p>
        {item.reason && <p className="ask-reason">{item.reason}</p>}
      </div>
      <button type="button" className="ask-open" onClick={() => onOpen(dataset)} aria-label={`${dataset.name} 상세 보기`}>
        상세 보기 ›
      </button>
    </li>
  );
}

// saved: 이전에 물어본 질문·방식·결과 (다른 화면에 다녀와도 유지). API 키는 여기에 담기지 않는다.
export default function AskView({ store, saved, onSave, onOpenDataset }) {
  const { site } = store;
  const ai = site.ai ?? {};
  const modes = useMemo(() => availableModes(ai), [ai]);
  const index = useMemo(() => buildIndex(store), [store]);

  const defaultMode = modes.some((entry) => entry.id === ai.defaultMode) ? ai.defaultMode : "local";
  const [mode, setMode] = useState(modes.some((entry) => entry.id === saved?.mode) ? saved.mode : defaultMode);
  const [question, setQuestion] = useState(saved?.question ?? "");
  // 방식별 API 키. 이 화면의 메모리에만 있다. 저장하지 않고, 화면을 벗어나면 사라진다.
  // 방식마다 따로 두는 이유: 키가 필요한 방식이 늘어도 앞서 입력한 키가 엉뚱한 서비스로 나가지 않게 하려고.
  const [keys, setKeys] = useState({});
  const keyMode = KEY_MODES[mode]; // 키를 입력해야 하는 방식이면 그 정보, 아니면 undefined
  const apiKey = keys[mode] ?? "";
  // 방식별로 고른 모델. 고르지 않았으면 설정의 기본 모델. 키와 달리 비밀이 아니므로 화면에 있는 동안만 기억한다.
  const [pickedModels, setPickedModels] = useState({});
  const modelList = keyMode ? modelsOf(ai[mode]) : [];
  const model = pickedModels[mode] && modelList.some((entry) => entry.model === pickedModels[mode]) ? pickedModels[mode] : ai[mode]?.model;
  const [status, setStatus] = useState(saved?.result ? "done" : "idle"); // idle | loading | done
  const [result, setResult] = useState(saved?.result ?? null);
  const [formError, setFormError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const abortRef = useRef(null);
  const keyRef = useRef(null);
  const questionRef = useRef(null);
  const headingRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // 결과가 나오면 키보드·화면낭독 사용자가 결과를 바로 읽을 수 있게 초점을 결과 제목으로 옮긴다.
  useEffect(() => {
    if (status === "done" && result && !result.restored) headingRef.current?.focus();
  }, [status, result]);

  const ask = async (text) => {
    const trimmed = text.trim();
    setFormError("");
    if (trimmed.length < 2) {
      setFormError("궁금한 내용을 두 글자 이상 입력해 주세요.");
      questionRef.current?.focus();
      return;
    }
    if (keyMode && !apiKey.trim()) {
      setFormError(`AI 추천을 쓰려면 ${keyMode.keyLabel}를 입력해 주세요. 키 없이 쓰려면 ‘기본 검색’을 선택하세요.`);
      keyRef.current?.focus();
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setLiveMessage("질문을 분석하고 있습니다.");
    try {
      const next = await recommend({ question: trimmed, mode, store, index, apiKey: apiKey.trim(), model, signal: controller.signal });
      if (abortRef.current !== controller) return; // 그 사이 새 질문을 보냈거나 취소했다면 이 결과는 버린다
      setResult(next);
      setStatus("done");
      setLiveMessage(next.recommendations.length ? `추천 데이터 ${next.recommendations.length}건을 찾았습니다.` : "관련 데이터를 찾지 못했습니다.");
      onSave({ question: trimmed, mode, result: { ...next, restored: true } });
    } catch (error) {
      if (abortRef.current !== controller || error?.code === "cancelled") return;
      setFormError("검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      setStatus("idle");
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus(result ? "done" : "idle");
    setLiveMessage("질문을 취소했습니다.");
  };

  const submit = (event) => {
    event.preventDefault();
    ask(question);
  };

  const useExample = (text) => {
    setQuestion(text);
    ask(text);
  };

  const modeInfo = modes.find((entry) => entry.id === mode);
  const isAi = mode !== "local";
  const sendTarget = keyMode ? keyMode.target : ai.gateway?.label || "기관 AI 서버";
  const loading = status === "loading";

  return (
    <section className="standalone-content ask-view" id="main-content" aria-labelledby="ask-title">
      <div className="ideas-heading">
        <span>질문으로 찾기</span>
        <h1 id="ask-title">궁금한 점을 문장으로 물어보세요</h1>
        <p>예: “체육시설 안전과 연계할 수 있는 데이터가 뭐 있어?” 질문과 관련된 공개 데이터를 골라 이유와 함께 보여드립니다.</p>
      </div>

      <form className="ask-form" onSubmit={submit}>
        {modes.length > 1 && (
          <fieldset className="ask-modes">
            <legend>검색 방식</legend>
            {modes.map((entry) => (
              <label key={entry.id} className={mode === entry.id ? "active" : ""}>
                <input type="radio" name="ask-mode" value={entry.id} checked={mode === entry.id} onChange={() => setMode(entry.id)} />
                <span>
                  <b>{entry.label}</b>
                  <small>{entry.hint}</small>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {keyMode && (
          <div className="ask-key">
            <label htmlFor="ask-api-key">{keyMode.keyLabel}</label>
            <input
              id="ask-api-key"
              ref={keyRef}
              type="password"
              autoComplete="new-password"
              data-lpignore="true"
              data-1p-ignore="true"
              spellCheck={false}
              value={apiKey}
              onChange={(event) => setKeys((current) => ({ ...current, [mode]: event.target.value }))}
              placeholder={keyMode.placeholder}
              aria-describedby="ask-key-help"
            />
            <p id="ask-key-help">
              입력한 키는 이 브라우저의 메모리에서만 쓰이며 저장되지 않고, 이 화면을 벗어나면 사라집니다. 호출은 이 브라우저에서 {keyMode.host}로 직접 이루어집니다.
              {ai[mode]?.keyGuideUrl && (
                <>
                  {" "}
                  <a href={ai[mode].keyGuideUrl} target="_blank" rel="noreferrer">
                    API 키 발급 안내 <span>(새 창 · 외부 사이트)</span>
                  </a>
                </>
              )}
            </p>
          </div>
        )}

        {keyMode && modelList.length > 1 && (
          <div className="ask-model">
            <label htmlFor="ask-model">모델</label>
            <select id="ask-model" value={model} onChange={(event) => setPickedModels((current) => ({ ...current, [mode]: event.target.value }))}>
              {modelList.map((entry) => (
                <option key={entry.model} value={entry.model}>
                  {entry.label}
                </option>
              ))}
            </select>
            <p>같은 키로 모델을 바꿔 쓸 수 있습니다. 어느 모델이든 결과 화면과 형식은 같습니다.</p>
          </div>
        )}

        <div className="ask-input">
          <label htmlFor="ask-question" className="sr-only">
            질문
          </label>
          <textarea
            id="ask-question"
            ref={questionRef}
            rows={2}
            maxLength={300}
            value={question}
            aria-invalid={formError ? "true" : undefined}
            aria-describedby={formError ? "ask-form-error" : undefined}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit(event);
            }}
            placeholder="궁금한 내용을 입력하세요 (Ctrl+Enter로 질문)"
          />
          <button type="submit">{loading ? "다시 질문하기" : "질문하기"}</button>
        </div>

        {isAi && (
          <p className="ask-privacy">
            ※ 질문과 후보 데이터의 이름·분야·설명 요약이 <b>{sendTarget}</b>로 전송됩니다. 개인정보·비밀번호는 입력하지 마세요.
          </p>
        )}
        {formError && (
          <p className="ask-error" id="ask-form-error" role="alert">
            {formError}
          </p>
        )}

        {ai.exampleQuestions?.length > 0 && (
          <div className="ask-examples">
            <span>이런 질문을 해 보세요</span>
            {ai.exampleQuestions.map((text) => (
              <button type="button" key={text} onClick={() => useExample(text)}>
                {text}
              </button>
            ))}
          </div>
        )}
      </form>

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      <div className="ask-result">
        {loading && (
          <p className="ask-status">
            {isAi ? `${modeInfo?.label}로 질문을 분석하고 있습니다…` : "찾는 중입니다…"}{" "}
            <button type="button" className="ask-cancel" onClick={cancel}>
              취소
            </button>
          </p>
        )}

        {status !== "idle" && result && (
          <>
            {result.error && (
              <p className="ask-error" role="alert">
                {result.error} 기본 검색 결과를 대신 보여드립니다.
              </p>
            )}

            {result.usedAi && result.summary && (
              <div className="ask-summary">
                <span className="ask-badge">AI 안내</span>
                <p>{result.summary}</p>
              </div>
            )}

            {!result.usedAi && result.recommendations.length > 0 && (
              <p className={`ask-confidence ${result.confidence}`}>
                {result.confidence === "low"
                  ? "질문과 정확히 맞는 데이터는 찾지 못했습니다. 가장 가까운 후보를 보여드립니다."
                  : `‘${result.terms.join("’, ‘")}’ 낱말${result.expanded.length ? `과 관련어(${result.expanded.slice(0, 4).join(", ")} 등)` : ""}로 찾았습니다.`}
              </p>
            )}

            {result.recommendations.length > 0 ? (
              <>
                <h2 className="ask-heading" ref={headingRef} tabIndex={-1}>
                  {result.usedAi ? "AI가 고른 데이터" : "추천 데이터"} <small>{result.recommendations.length}건</small>
                </h2>
                <ol className="ask-list">
                  {result.recommendations.map((item, position) => (
                    <ResultItem key={item.dataset.no} item={item} rank={position + 1} portals={site.portals} onOpen={onOpenDataset} />
                  ))}
                </ol>
              </>
            ) : (
              <div className="metadata-empty" ref={headingRef} tabIndex={-1}>
                <b>관련 데이터를 찾지 못했습니다.</b>
                <p>다른 낱말로 바꿔 질문하거나, ‘데이터 탐색’에서 분야·포털 조건으로 직접 찾아 보세요.</p>
              </div>
            )}

            {result.combinations.length > 0 && (
              <section className="ask-combos" aria-label="함께 활용하면 좋은 조합">
                <h2 className="ask-heading">함께 활용하면 좋은 조합</h2>
                <div className="ask-combo-grid">
                  {result.combinations.map((combo, position) => (
                    <article key={`${position}-${combo.title}`}>
                      <h3>{combo.title}</h3>
                      <p>{combo.idea}</p>
                      <ul>
                        {combo.datasets.map((dataset) => (
                          <li key={dataset.no}>
                            <button type="button" onClick={() => onOpenDataset(dataset)}>
                              {dataset.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {result.usedAi && result.local.length > 0 && (
              <details className="ask-local">
                <summary>기본 검색 결과도 보기 ({result.local.length}건)</summary>
                <ol className="ask-list compact">
                  {result.local.map((item, position) => (
                    <ResultItem key={item.dataset.no} item={item} rank={position + 1} portals={site.portals} onOpen={onOpenDataset} />
                  ))}
                </ol>
              </details>
            )}

            {ai.notice && <p className="ask-notice">※ {ai.notice}</p>}
          </>
        )}
      </div>
    </section>
  );
}
