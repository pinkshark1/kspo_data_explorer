// 공개 경로와 추적 파일에 비공개 파일·명백한 인증정보가 섞이지 않았는지 점검한다.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStaticServer } from "./lib/static-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blockedName = /(?:^|[\\/])(?:AGENTS\.md|\.env(?:\..*)?|\.npmrc$|\.netrc$|\.claude(?:[\\/]|$)|\.codex(?:[\\/]|$)|\.agents(?:[\\/]|$)|\.aws(?:[\\/]|$)|\.ssh(?:[\\/]|$)|.*\.(?:local(?:\.|$)|map$|bak$|backup$|orig$|rej$|pem$|key$|p12$|pfx$|crt$|cer$|der$|pptx$)|clips(?:[\\/]|$)|final(?:[\\/]|$)|references(?:[\\/]|$)|홍보용스크립트(?:[\\/]|$)|.*(?:credential|secret|password|token))/i;
const secretPatterns = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, "private-key"],
  [/(?:AKIA|ASIA)[A-Z0-9]{16}/g, "aws-access-key"],
  [/(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/g, "github-token"],
  [/AIza[0-9A-Za-z_-]{20,}/g, "google-api-key"],
  [/\bAQ\.[0-9A-Za-z_-]{40,}/g, "google-api-key"],
  [/sk-(?:ant-|proj-)[A-Za-z0-9_-]{30,}/g, "ai-api-key"],
  [/xox[baprs]-[A-Za-z0-9-]{20,}/g, "slack-token"],
  [/npm_[A-Za-z0-9]{30,}/g, "npm-token"],
  [/\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|service[_-]?key|password)["']?\s*[:=]\s*["'][^"'\r\n]{16,}["']/gi, "credential-assignment"],
];
const textExtensions = new Set([".js", ".mjs", ".cjs", ".jsx", ".tsx", ".ts", ".json", ".html", ".css", ".md", ".txt", ".yml", ".yaml", ".xml", ".csv", ".toml", ".ini", ".env"]);
const allowedMockMatches = new Set([
  "AIza" + "SyTestGeminiKey-1234567890",
]);
let failures = 0;
let skippedFiles = 0;
const inspectedFiles = new Set();

function fail(message) { console.error(`FAIL  ${message}`); failures += 1; }

function trackedFiles() {
  if (process.argv.includes("--tracked-stdin")) return fs.readFileSync(0, "utf8").split(/\0|\r?\n/).filter(Boolean);
  try {
    return execFileSync("git", ["-c", `safe.directory=${root}`, "ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  } catch (error) {
    throw new Error(`git 추적 파일 목록을 읽지 못했습니다. --tracked-stdin 으로 git ls-files 결과를 전달하세요. ${error.message}`);
  }
}

function contentFindings(text, label) {
  const findings = [];
  for (const [pattern, kind] of secretPatterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      const isAllowedMock = label.replaceAll("\\", "/") === "scripts/check-ai.mjs" && allowedMockMatches.has(value);
      if (isAllowedMock) continue;
      const line = text.slice(0, match.index).split("\n").length;
      findings.push({ line, kind });
    }
  }
  return findings;
}

function inspectContent(file, label) {
  const absolute = path.resolve(file);
  if (inspectedFiles.has(absolute)) return;
  inspectedFiles.add(absolute);
  let stat;
  try { stat = fs.statSync(file); } catch { return; }
  if (!stat.isFile()) return;
  const extension = path.extname(label).toLowerCase();
  const isText = textExtensions.has(extension) || path.basename(label).startsWith(".env") || path.basename(label) === ".gitignore";
  if (!isText) { skippedFiles += 1; return; }
  if (stat.size > 20 * 1024 * 1024) { fail(`${label}: 텍스트 파일이 검사 한도(20MB)를 초과했습니다`); return; }
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) { fail(`${label}: 텍스트 파일에 NUL이 있어 검사를 완료하지 못했습니다`); return; }
  for (const { line, kind } of contentFindings(buffer.toString("utf8"), label)) fail(`${label}:${line} ${kind}`);
}

const tracked = trackedFiles();
if (!tracked.length) fail("검사할 Git 파일 목록이 비어 있습니다");
for (const relative of tracked) {
  if (/(?:^|[\\/])(?:\.dev\.vars(?:\..*)?|\.wrangler)(?:[\\/]|$)/i.test(relative)) fail(`추적된 중계 서버 비공개 설정 ${relative}`);
  if (blockedName.test(relative) && path.basename(relative) !== ".env.example") fail(`추적된 비공개 경로 ${relative}`);
  inspectContent(path.join(root, relative), relative);
}
for (const top of ["assets", "data"]) {
  const folder = path.join(root, top);
  if (!fs.existsSync(folder)) continue;
  if (fs.lstatSync(folder).isSymbolicLink()) {
    fail(`공개 폴더 자체가 링크입니다: ${top}`);
    continue;
  }
  for (const entry of fs.readdirSync(folder, { recursive: true })) {
    const relative = path.relative(root, path.join(folder, entry));
    if (relative.split(/[\\/]/).some((segment) => segment.startsWith(".")) || blockedName.test(relative)) fail(`공개 폴더의 민감 파일 ${relative}`);
    if (fs.lstatSync(path.join(root, relative)).isSymbolicLink()) {
      fail(`공개 폴더의 링크 파일 ${relative}`);
      continue;
    }
    inspectContent(path.join(root, relative), relative);
  }
}

// 예외 문자열 뒤의 실제 후보·두 번째 후보·JSON 설정도 빠짐없이 검사하는지 확인한다.
const mockKey = [...allowedMockMatches][0];
const syntheticKey = "AIza" + "Q".repeat(35);
if (contentFindings(`${mockKey}\n${syntheticKey}\n${syntheticKey}`, "scripts/check-ai.mjs").length !== 2) fail("인증정보 탐지 회귀: mock 예외 이후의 후보 누락");
if (contentFindings(mockKey, "data/site.json").length !== 1) fail("인증정보 탐지 회귀: 테스트 파일 밖의 예외 허용");
if (contentFindings("AQ." + "q".repeat(48), "data/site.json").length !== 1) fail("인증정보 탐지 회귀: 새 Google 키 형식 누락");
if (!contentFindings(JSON.stringify({ apiKey: "q".repeat(24) }), "data/site.json").some((item) => item.kind === "credential-assignment")) fail("인증정보 탐지 회귀: JSON 설정값 누락");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "kspo-security-"));
const tempRoot = path.resolve(os.tmpdir());
const safeTemp = path.dirname(temp) === tempRoot && path.basename(temp).startsWith("kspo-security-");
let server;
try {
  const fixtureRoot = path.join(temp, "site");
  const fixtureData = path.join(fixtureRoot, "data");
  const fixtureAssets = path.join(fixtureRoot, "assets");
  const fixtureSource = path.join(fixtureRoot, "src");
  const alternateData = path.join(temp, "alternate-data");
  for (const folder of [fixtureData, fixtureAssets, fixtureSource, alternateData]) fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, "index.html"), "<html>fixture</html>");
  fs.writeFileSync(path.join(fixtureRoot, "AGENTS.md"), "private fixture");
  fs.writeFileSync(path.join(fixtureSource, "source.txt"), "private fixture");
  fs.writeFileSync(path.join(fixtureAssets, "app.js"), "console.log('fixture');");
  fs.writeFileSync(path.join(fixtureData, "empty.txt"), "");
  fs.writeFileSync(path.join(fixtureData, "explorer-data.json"), "{}");
  fs.writeFileSync(path.join(alternateData, "explorer-data.json"), '{"alternate":true}');
  fs.writeFileSync(path.join(fixtureData, ".env"), "SECRET=should-not-be-served");
  fs.writeFileSync(path.join(fixtureData, "foo.local.json"), "{}");
  fs.writeFileSync(path.join(fixtureData, "private.pem"), "-----BEGIN " + "PRIVATE KEY-----\nfixture\n");
  fs.writeFileSync(path.join(fixtureData, "source.secret.json"), "{}");
  const linkChecks = [];
  for (const [target, link, url, type] of [
    [path.join(fixtureRoot, "AGENTS.md"), path.join(fixtureAssets, "link-agents.txt"), "/assets/link-agents.txt", "file"],
    [path.join(fixtureData, ".env"), path.join(fixtureAssets, "link-env.txt"), "/assets/link-env.txt", "file"],
    [fixtureSource, path.join(fixtureAssets, "link-source"), "/assets/link-source/source.txt", "junction"],
    [alternateData, path.join(fixtureAssets, "link-outside"), "/assets/link-outside/explorer-data.json", "junction"],
  ]) {
    try {
      fs.symlinkSync(target, link, type);
      linkChecks.push([url, 404]);
    } catch (error) {
      if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
      console.log(`SKIP  링크 생성 권한이 없어 HTTP 검증 생략: ${url}`);
    }
  }

  server = createStaticServer(fixtureRoot);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  function request(rawPath, options = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request({ hostname: "127.0.0.1", port, path: rawPath, method: options.method ?? "GET", headers: options.headers, agent: false }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }));
      });
      request.on("error", reject);
      request.end();
    });
  }
  const checks = [
    ["/", 200], ["/assets/app.js", 200], ["/data/explorer-data.json", 200], ["/data/empty.txt", 200],
    ["/data/.env", 404], ["/data/foo.local.json", 404], ["/data/private.pem", 404], ["/data/source.secret.json", 404],
    ...linkChecks, ["/.env", 404], ["/assets/.env", 404],
    ["/../AGENTS.md", 404], ["/%2e%2e/AGENTS.md", 404], ["/data/%00.txt", 404], ["/data/foo%3Abar.txt", 404], ["/data/foo.txt%20", 404],
    ["/assets/%2e%2e/AGENTS.md", 404], ["/data/.env.", 404], ["/data/explorer-data.json%3A%3A%24DATA", 404],
  ];
  for (const [url, expected] of checks) {
    const result = await request(url);
    if (result.status !== expected) fail(`HTTP ${url} expected ${expected}, got ${result.status}`);
  }
  const range = await request("/assets/app.js", { headers: { Range: "bytes=0-9" } });
  if (range.status !== 206 || range.body.length !== 10) fail(`HTTP range (${range.status}, ${range.body.length})`);
  const head = await request("/assets/app.js", { method: "HEAD" });
  if (head.status !== 200 || head.body.length !== 0) fail(`HTTP HEAD (${head.status}, body=${head.body.length})`);
  const empty = await request("/data/empty.txt");
  if (empty.status !== 200 || empty.body.length !== 0) fail(`HTTP empty file (${empty.status}, body=${empty.body.length})`);
  const invalidRange = await request("/assets/app.js", { headers: { Range: "bytes=999-" } });
  if (invalidRange.status !== 416) fail("HTTP invalid range");
  await new Promise((resolve) => server.close(resolve));
  server = createStaticServer(fixtureRoot, { dataDir: alternateData });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const alternate = await request("/data/explorer-data.json");
  if (alternate.status !== 200 || alternate.body.toString() !== '{"alternate":true}') fail("대체 데이터 폴더 응답");
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (safeTemp && fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true });
}

console.log(`INFO  내용 검사 제외(텍스트 형식 아님): ${skippedFiles}건`);
console.log(failures ? `\n${failures} security check(s) failed` : "PASS  security checks");
process.exit(failures ? 1 : 0);
