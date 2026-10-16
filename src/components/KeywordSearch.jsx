import UiIcon from "./UiIcon.jsx";

export default function KeywordSearch({ query, onChangeQuery, onSubmitSearch, onAsk, mode = "submit", describedBy }) {
  const isQuestion = mode === "question";
  const submit = (event) => {
    if (!isQuestion) return onSubmitSearch(event);
    event.preventDefault();
    if (query.trim().length >= 2) onAsk(query.trim());
  };
  return (
    <form className={`global-search${mode !== "submit" ? " unified-search" : ""}${isQuestion ? " question-search" : ""}`} role="search" aria-label={isQuestion ? "AI 질문 검색" : "키워드로 찾기"} onSubmit={submit}>
      <UiIcon name="search" />
      <input
        value={query}
        onChange={(event) => onChangeQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}
        maxLength={300}
        placeholder={isQuestion ? "예: 체육시설 안전을 분석하려면 어떤 데이터가 필요할까요?" : "예: 체력, 체육시설, 스포츠강좌"}
        aria-label={isQuestion ? "추천받을 질문" : "전체 데이터 검색"}
        aria-describedby={describedBy}
      />
      {mode === "submit" && <button type="submit">결과 보기</button>}
      {isQuestion && <button className="search-ask" type="submit" disabled={query.trim().length < 2}>추천받기</button>}
    </form>
  );
}
