// 문화빅데이터포털 데이터 상세 페이지의 '기관정보' 영역에서 제공기관과 그 기관의 보유 데이터셋 수를 읽는다.
//   <a href="/bigdata/user/data_market/agency/detail.do?id=kspo_org"> ... <h4>국민체육진흥공단</h4>
//   <span class="dataset_section_has">보유 데이터셋 <strong>95</strong> 개</span>
// 한 기관 계정이 보유한 건수만 나오므로, 같은 서비스의 데이터라도 다른 기관 계정(예: 체육종합빅데이터센터)으로 등록되면 따로 센다.
export function parseCulturePublisher(html) {
  const visible = String(html).replace(/<!--[\s\S]*?-->/g, " ");
  const section = /<div class="data_section_agency[^"]*">([\s\S]*?)<p class="dataset_section_desc"/.exec(visible)?.[1] ?? "";
  const id = /agency\/detail\.do\?id=([A-Za-z0-9_-]+)/.exec(section)?.[1] ?? "";
  const name = /<h4>\s*([^<]+?)\s*<\/h4>/.exec(section)?.[1] ?? "";
  const count = Number(/보유\s*데이터셋\s*<strong>\s*([\d,]+)\s*<\/strong>/.exec(section)?.[1]?.replace(/,/g, ""));
  return id && name && count ? { id, name, count } : null;
}
