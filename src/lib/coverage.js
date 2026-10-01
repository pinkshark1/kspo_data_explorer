// 화면 하단의 "데이터 현황"에 쓰는 집계. 값이 비어 있는 데이터가 얼마나 되는지 숨기지 않고 보여준다.
import { portalOf } from "./catalog.js";
import { resolveDetail } from "./detail.js";

export function summarizeCoverage(data) {
  const { datasets } = data;
  let publicCount = 0;
  let cultureCount = 0;
  let withColumns = 0;
  let withSample = 0;
  let withSourceUrl = 0;
  datasets.forEach((dataset) => {
    if (portalOf(dataset) === "public") publicCount += 1;
    else cultureCount += 1;
    const detail = resolveDetail(dataset, data, "");
    if (detail.hasColumns) withColumns += 1;
    if (detail.hasRows) withSample += 1;
    if (detail.sourceUrl) withSourceUrl += 1;
  });
  return { total: datasets.length, publicCount, cultureCount, withColumns, withSample, withSourceUrl };
}
