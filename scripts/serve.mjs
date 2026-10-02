// 로컬 확인용 정적 웹서버. app.js 가 data/*.json 을 fetch 하므로 file:// 로는 열리지 않는다.
//   npm start                                   -> http://localhost:4173
//   node scripts/serve.mjs 8080
//   npm start -- --data examples/korea-sports-council/data   (다른 기관 데이터 폴더로 같은 화면을 띄운다)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticServer } from "./lib/static-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dataIndex = args.indexOf("--data");
const dataDir = dataIndex >= 0 ? path.resolve(root, args[dataIndex + 1] ?? "") : undefined;
if (dataDir && !fs.existsSync(path.join(dataDir, "explorer-data.json"))) {
  console.error(`--data 폴더에 explorer-data.json 이 없습니다: ${dataDir}`);
  process.exit(2);
}
const portArg = args.find((arg, index) => /^\d+$/.test(arg) && args[index - 1] !== "--data");
const port = Number(portArg || process.env.PORT || 4173);

createStaticServer(root, { dataDir }).listen(port, "127.0.0.1", () => {
  console.log(`KSPO 데이터 지도: http://localhost:${port}/  (종료: Ctrl+C)${dataDir ? `  · 데이터: ${path.relative(root, dataDir)}` : ""}`);
});
