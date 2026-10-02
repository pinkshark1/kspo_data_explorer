// 소스(src/)를 배포용 정적 파일(assets/app.js, assets/app.css)로 묶는다. (동적 import 가 생기면 assets/chunks/ 도 만들어진다)
// 배포 구조(index.html + assets/ + data/)는 그대로 두고, GitHub Pages/사내 웹서버에 그대로 올린다.
//
//   npm run build   : 한 번 빌드
//   npm run watch   : 파일 변경 시 자동 재빌드
import fs from "node:fs";
import { build, context } from "esbuild";
import { buildOptions } from "./build.options.mjs";

// 이전 빌드의 조각 파일(해시가 달라짐)이 남지 않게 지운다.
fs.rmSync("assets/chunks", { recursive: true, force: true });

if (process.argv.includes("--watch")) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log("watching src/ ... (Ctrl+C로 종료)");
} else {
  await build(buildOptions);
}
