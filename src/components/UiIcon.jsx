// 화면 안내용 선형 아이콘. 의미는 함께 표시하는 텍스트로 전달한다.
export default function UiIcon({ name, className = "" }) {
  return (
    <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {name === "search" && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>}
      {name === "table" && <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M10 10v10" /></>}
      {name === "filter" && <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" fill="white" /><circle cx="15" cy="17" r="2" fill="white" /></>}
    </svg>
  );
}
