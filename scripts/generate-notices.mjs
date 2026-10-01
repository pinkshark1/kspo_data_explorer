// 배포물에 실제로 포함된 오픈소스와 글꼴의 라이선스를 assets/THIRD_PARTY_NOTICES.txt 로 모은다.
//   npm run notices   (npm install 이후, 의존성이 바뀌었을 때만 다시 실행)
// 포함된 패키지 목록은 esbuild 가 실제로 묶은 파일(metafile)에서 읽으므로, 의존성이 늘어도 빠지지 않는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildOptions } from "../build.options.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n").trim();

// 파일을 쓰지 않는 모의 빌드로 어떤 node_modules 패키지가 들어가는지 확인
const { metafile } = await build({ ...buildOptions, write: false, metafile: true, logLevel: "silent" });
const names = new Set();
for (const input of Object.keys(metafile.inputs)) {
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input.replaceAll("\\", "/"));
  if (match) names.add(match[1]);
}

const packages = [...names].sort().map((name) => {
  const dir = path.join("node_modules", name);
  const meta = JSON.parse(read(path.join(dir, "package.json")));
  const licenseFile = fs.readdirSync(path.join(root, dir)).find((file) => /^licen[cs]e/i.test(file));
  return { name, version: meta.version, license: meta.license, text: licenseFile ? read(path.join(dir, licenseFile)) : "(라이선스 파일 없음 - package.json 의 license 항목 참고)" };
});

const parts = [
  "KSPO 데이터 지도 - 오픈소스 라이선스 고지",
  "",
  "이 서비스는 아래 오픈소스를 포함해 배포됩니다. 각 라이선스 전문은 해당 항목에 있습니다.",
  "(소스 주석 형태의 고지는 assets/*.LEGAL.txt 에도 있습니다.)",
  "",
];

for (const pkg of packages) {
  parts.push("=".repeat(72), `${pkg.name} ${pkg.version}  (${pkg.license})`, "=".repeat(72), pkg.text, "");
}

parts.push("=".repeat(72), "Pretendard 1.3.9 글꼴 (assets/fonts/*.woff2, SIL Open Font License 1.1)", "=".repeat(72), read("assets/fonts/PRETENDARD-LICENSE.txt"), "");

fs.writeFileSync(path.join(root, "assets", "THIRD_PARTY_NOTICES.txt"), `${parts.join("\n")}\n`);
console.log(`assets/THIRD_PARTY_NOTICES.txt 생성: ${packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")} + Pretendard`);
