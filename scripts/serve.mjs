// 로컬 확인용 정적 웹서버. app.js 가 data/*.json 을 fetch 하므로 file:// 로는 열리지 않는다.
//   npm start            -> http://localhost:4173
//   node scripts/serve.mjs 8080
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticServer } from "./lib/static-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || process.env.PORT || 4173);

createStaticServer(root).listen(port, "127.0.0.1", () => {
  console.log(`KSPO 데이터 지도: http://localhost:${port}/  (종료: Ctrl+C)`);
});
