import { useEffect, useMemo, useRef, useState } from "react";
import { cycleLabel, deliveryOf, portalOf, shortField } from "../lib/catalog.js";
import { buildIndex } from "../ai/retrieval.js";
import { recommend } from "../ai/recommend.js";
import { sharedGeminiUrl } from "../ai/providers/shared-gemini.js";
import { verifySharedUsage } from "../ai/providers/turnstile.js";

const RELEVANCE_LABEL = { high: "관련도 높음", medium: "관련도 보통", low: "참고" };

// 이용자 본인의 API 키로 이 브라우저에서 직접 부르는 방식. 모델·안내 주소는 site.json 의 ai.<방식> 에 있다.
const KEY_MODES = {
  gemini: { name: "Gemini", target: "Google(Gemini)", host: "Google", keyLabel: "Gemini API 키", placeholder: "API 키 붙여넣기" },
};

// 방식 설정에서 고를 수 있는 모델 목록. ai.<방식>.models 가 없으면 기본 모델 하나뿐이다.
function modelsOf(config) {
  return config.models?.length ? config.models : [{ model: config.model, label: config.model }];
}

// 설정(site.json ai.modes)에서 켜진 방식만 보여준다. 기본 검색은 항상 있다.
function availableModes(ai) {
  const wanted = ai.modes ?? ["local"];
  const modes = [{ id: "local", label: "기본 검색", hint: "AI 없이 이 브라우저 안에서 질문 속 낱말과 비슷한 말로 찾습니다(외부 요청 없음)." }];
  for (const [id, info] of Object.entries(KEY_MODES)) {
    if (wanted.includes(id) && ai[id]) {
      const shared = !!sharedGeminiUrl(ai[id]);
      const hint = shared
        ? "공용 무료 AI가 질문을 읽고 추천 이유와 데이터 조합을 알려 줍니다. 공용 이용 한도에 도달하면 본인의 Gemini API 키로 계속 이용할 수 있습니다."
        : `Google AI가 질문을 읽고 추천 이유와 함께 쓸 데이터 조합까지 알려 줍니다. 본인의 ${info.keyLabel}(무료 발급)가 필요합니다.`;
      // 공용 중계가 Claude를 먼저 쓰면 site.json 의 shared.name 으로 실제 쓰는 AI를 표시한다.
      modes.push({ id, label: `AI 추천 (${(shared && ai[id].shared.name) || info.name})`, hint });
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
// request: 첫 화면에서 넘어온 질문 { text, id }. 화면이 열리면 바로 찾고 onConsumeRequest 로 비운다.
export default function AskView({ store, saved, onSave, onOpenDataset, request, onConsumeRequest }) {
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
  const sharedEnabled = mode === "gemini" && !!sharedGeminiUrl(ai.gemini);
  const [usePersonalKey, setUsePersonalKey] = useState(false);
  const keyMode = KEY_MODES[mode]; // 키를 입력해야 하는 방식이면 그 정보, 아니면 undefined
  const needsKey = keyMode && (!sharedEnabled || usePersonalKey);
  const apiKey = keys[mode] ?? "";
  // 방식별로 고른 모델. 고르지 않았으면 설정의 기본 모델. 키와 달리 비밀이 아니므로 화면에 있는 동안만 기억한다.
  const [pickedModels, setPickedModels] = useState({});
  const modelList = keyMode ? modelsOf(ai[mode]) : [];
  const model = pickedModels[mode] && modelList.some((entry) => entry.model === pickedModels[mode]) ? pickedModels[mode] : ai[mode]?.model;
  const [status, setStatus] = useState(saved?.result ? "done" : "idle"); // idle | loading | done
  const [result, setResult] = useState(saved?.result ?? null);
  const [formError, setFormError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [verifying, setVerifying] = useState(false);
  const abortRef = useRef(null);
  const verificationRef = useRef(null);
  const keyRef = useRef(null);
  const questionRef = useRef(null);
  const headingRef = useRef(null);

  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // 저장된 AI 추천 예시: 실제 키로 받은 응답을 data/ai-examples.json 에 둔 것. 예시 질문이면 AI 호출 없이 보여 준다. (새로 AI 를 부르지 않음)
  const savedExamples = store.aiExamples;
  const exampleFor = (text) => savedExamples?.examples.find((entry) => entry.question === String(text ?? "").trim());
  const byNo = useMemo(() => new Map(store.datasets.map((dataset) => [dataset.no, dataset])), [store]);
  const showSavedExample = async (text) => {
    const example = exampleFor(text);
    if (!example) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setFormError("");
    setVerifying(false);
    const local = await recommend({ question: example.question, mode: "local", store, index, signal: controller.signal });
    if (abortRef.current !== controller) return;
    const next = {
      ...local,
      mode,
      usedAi: true,
      saved: { date: savedExamples.date, label: savedExamples.label },
      summary: example.summary,
      recommendations: example.recommendations
        .map((item) => ({ dataset: byNo.get(item.no), reason: item.reason, relevance: item.relevance, source: "ai" }))
        .filter((item) => item.dataset),
      combinations: example.combinations.map((combo) => ({ title: combo.title, idea: combo.idea, datasets: combo.nos.map((no) => byNo.get(no)).filter(Boolean) })),
      error: null,
    };
    setQuestion(example.question);
    setResult(next);
    setStatus("done");
    setLiveMessage(`저장된 AI 추천 예시 ${next.recommendations.length}건을 보여 줍니다.`);
    onSave({ question: example.question, mode, result: { ...next, restored: true } });
  };

  // 결과가 나오면 키보드·화면낭독 사용자가 결과를 바로 읽을 수 있게 초점을 결과 제목으로 옮긴다.
  useEffect(() => {
    if (status === "done" && result && !result.restored) headingRef.current?.focus();
  }, [status, result]);

  const ask = async (text, options = {}) => {
    const requestMode = options.mode ?? mode;
    const personal = options.usePersonalKey ?? usePersonalKey;
    const shared = requestMode === "gemini" && !!sharedGeminiUrl(ai.gemini) && !personal;
    const requestKeyMode = KEY_MODES[requestMode];
    const requestKey = (keys[requestMode] ?? "").trim();
    const trimmed = text.trim();
    abortRef.current?.abort();
    abortRef.current = null;
    setVerifying(false);
    setStatus(result ? "done" : "idle");
    setFormError("");
    if (trimmed.length < 2) {
      setFormError("궁금한 내용을 두 글자 이상 입력해 주세요.");
      questionRef.current?.focus();
      return;
    }
    if (requestKeyMode && !shared && !requestKey) {
      // 키가 없어도 예시 질문이면 저장된 실제 응답을 보여 준다
      if (exampleFor(trimmed)) {
        showSavedExample(trimmed);
        return;
      }
      setFormError(`AI 추천을 쓰려면 ${requestKeyMode.keyLabel}를 입력해 주세요. 키 없이 쓰려면 ‘기본 검색’을 선택하세요.`);
      keyRef.current?.focus();
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setLiveMessage("질문을 분석하고 있습니다.");
    try {
      let verificationToken;
      let next;
      if (shared) {
        setVerifying(true);
        setLiveMessage("공용 무료 AI 이용 확인 중입니다.");
        try {
          verificationToken = await verifySharedUsage({ siteKey: ai.gemini.shared.turnstileSiteKey, container: verificationRef.current, signal: controller.signal });
        } catch (error) {
          if (controller.signal.aborted || error?.code === "cancelled") throw error;
          const local = await recommend({ question: trimmed, mode: "local", store, index, signal: controller.signal });
          next = { ...local, mode: requestMode, aiSource: "shared", errorCode: error?.code === "shared_config" ? "shared_config" : "shared_verification", error: error?.code === "shared_config" ? "공용 무료 AI 이용 확인 설정이 준비되지 않았습니다. 기본 검색을 이용해 주세요." : "공용 무료 AI 이용 확인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요." };
        }
        if (abortRef.current !== controller) return;
        setVerifying(false);
        setLiveMessage("질문을 분석하고 있습니다.");
      }
      next ??= await recommend({ question: trimmed, mode: requestMode, store, index, apiKey: shared ? undefined : requestKey, model, usePersonalKey: personal, verificationToken, signal: controller.signal });
      if (abortRef.current !== controller) return; // 그 사이 새 질문을 보냈거나 취소했다면 이 결과는 버린다
      setResult(next);
      setStatus("done");
      setLiveMessage(next.recommendations.length ? `추천 데이터 ${next.recommendations.length}건을 찾았습니다.` : "관련 데이터를 찾지 못했습니다.");
      onSave({ question: trimmed, mode: requestMode, result: { ...next, restored: true } });
    } catch (error) {
      if (abortRef.current !== controller || error?.code === "cancelled") return;
      setFormError("검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      setStatus("idle");
    }
  };

  const handledRequest = useRef(null);
  useEffect(() => {
    if (!request || handledRequest.current === request.id) return;
    handledRequest.current = request.id;
    setQuestion(request.text);
    ask(request.text);
    onConsumeRequest?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setVerifying(false);
    setStatus(result ? "done" : "idle");
    setLiveMessage("질문을 취소했습니다.");
  };

  const submit = (event) => {
    event.preventDefault();
    ask(question);
  };

  const useExample = (text) => {
    setQuestion(text);
    if (sharedEnabled && exampleFor(text)) {
      showSavedExample(text);
      return;
    }
    ask(text);
  };

  const changeMode = (nextMode) => {
    cancel();
    setFormError("");
    setMode(nextMode);
    setUsePersonalKey(false);
  };

  const choosePersonalKey = () => {
    cancel();
    setFormError("");
    setUsePersonalKey(true);
  };

  useEffect(() => {
    if (sharedEnabled && usePersonalKey) keyRef.current?.focus();
  }, [sharedEnabled, usePersonalKey]);

  const retryShared = () => {
    setUsePersonalKey(false);
    ask(question, { usePersonalKey: false });
  };

  const useLocal = () => {
    changeMode("local");
    ask(question, { mode: "local", usePersonalKey: false });
  };

  const modeInfo = modes.find((entry) => entry.id === mode);
  const isAi = mode !== "local";
  const sendTarget = sharedEnabled && !usePersonalKey ? `공용 무료 AI 서버와 ${ai.gemini.shared.target || "Google(Gemini)"}` : keyMode ? keyMode.target : ai.gateway?.label || "기관 AI 서버";
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
                <input type="radio" name="ask-mode" value={entry.id} checked={mode === entry.id} onChange={() => changeMode(entry.id)} />
                <span>
                  <b>{entry.label}</b>
                  <small>{entry.hint}</small>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {sharedEnabled && (
          <div className="ask-shared-options">
            <span>{usePersonalKey ? "본인 키로 Google에 직접 요청합니다." : "공용 무료 AI를 이용합니다. 키를 입력할 필요가 없습니다."}</span>
            {usePersonalKey ? (
              <button type="button" onClick={retryShared}>공용 무료 AI로 전환</button>
            ) : (
              <button type="button" onClick={choosePersonalKey}>내 키 사용하기 (선택)</button>
            )}
          </div>
        )}

        {sharedEnabled && <div className="ask-verification" ref={verificationRef} aria-label="공용 무료 AI 이용 확인" />}

        {needsKey && (
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
              {sharedEnabled && " 본인 Google 프로젝트의 이용 한도가 적용됩니다. 유료 프로젝트에 연결된 키는 비용이 발생할 수 있습니다."}
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

        {needsKey && modelList.length > 1 && (
          <div className="ask-model">
            <label htmlFor="ask-model">모델</label>
            <select id="ask-model" value={model} onChange={(event) => {
              cancel();
              setPickedModels((current) => ({ ...current, [mode]: event.target.value }));
            }}>
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
            {sharedEnabled && !usePersonalKey && " 공용 AI 이용 확인에는 Cloudflare Turnstile을 사용합니다."}
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
            {savedExamples && <small className="ask-examples-note">예시 질문은 저장해 둔 실제 AI 응답을 바로 보여 줍니다(AI 호출 없음).</small>}
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
            {verifying ? "공용 무료 AI 이용 확인 중…" : isAi ? `${modeInfo?.label}로 질문을 분석하고 있습니다…` : "찾는 중입니다…"}{" "}
            <button type="button" className="ask-cancel" onClick={cancel}>
              취소
            </button>
          </p>
        )}

        {status !== "idle" && result && (
          <>
            <p className="ask-asked">
              <span>{formError ? "이전 질문의 결과" : "질문"}</span> “{result.question}”
            </p>
            {result.error && (
              <p className="ask-error" role="alert">
                {result.error} 기본 검색 결과를 대신 보여드립니다.
              </p>
            )}

            {sharedEnabled && result.aiSource === "shared" && result.error && (
              <div className="ask-shared-actions">
                {result.errorCode === "shared_quota" && !usePersonalKey && <button type="button" onClick={choosePersonalKey}>내 키로 계속하기</button>}
                <button type="button" onClick={retryShared}>무료 AI 다시 시도</button>
                <button type="button" onClick={useLocal}>기본 검색</button>
              </div>
            )}

            {result.usedAi && result.summary && (
              <div className={`ask-summary${result.saved ? " saved" : ""}`}>
                <span className="ask-badge">{result.saved ? "AI 추천 예시" : "AI 안내"}</span>
                <p>{result.summary}</p>
                {result.saved && (
                  <p className="ask-saved-note">
                    {result.saved.date}에 {result.saved.label}로 실제로 받은 응답을 저장해 둔 예시입니다. 다른 질문은 {sharedEnabled ? "공용 무료 AI 또는 본인 키" : "본인 키"}로 ‘AI 추천’을 쓰면 새로 받을 수 있습니다.
                  </p>
                )}
              </div>
            )}

            {!result.usedAi && exampleFor(result.question) && (
              <button type="button" className="ask-saved-open" onClick={() => showSavedExample(result.question)}>
                같은 질문의 AI 추천 예시 보기 <small>(AI 호출 없음 · 저장된 실제 응답)</small>
              </button>
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
