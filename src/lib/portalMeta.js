// 데이터셋별 "데이터 정보"(포털 수정일, 이용허락범위, 관리부서·문의) 표시 항목을 만든다.
// 값은 data/portal-meta.json (scripts/fetch-portal-metadata.mjs 가 포털 상세 페이지에서 수집)에서 온다.
import { cycleLabel, portalOf } from "./catalog.js";

const clean = (value) => (value ? String(value).trim() : "");

export function portalInfoRows(dataset, portalMeta, site) {
  const meta = portalMeta[String(dataset.no)];
  if (!meta) return [];

  const rows = [];
  if (portalOf(dataset) === "public") {
    rows.push({ label: "포털 최종 수정일", value: clean(meta.modifiedAt) });
    rows.push({ label: "이용허락범위", value: clean(meta.license).replace(/^이용허락범위\s*/, "") });
    const contact = [clean(meta.department), clean(meta.phone)].filter(Boolean).join(" · ");
    rows.push({ label: "관리부서·문의", value: contact });
    rows.push({ label: "포털 갱신주기", value: meta.portalCycle ? cycleLabel(clean(meta.portalCycle)) : "" });
  } else {
    rows.push({ label: "포털 최종 수정일", value: clean(meta.modifiedAt) });
    rows.push({ label: "제공기관", value: site.organization.name });
    rows.push({ label: "이용 조건", value: [clean(meta.price), site.portals.culture.termsNote].filter(Boolean).join(" · ") });
    rows.push({ label: "포털 갱신주기", value: meta.portalCycle ? cycleLabel(clean(meta.portalCycle)) : "" });
  }
  return rows.filter((row) => row.value);
}
