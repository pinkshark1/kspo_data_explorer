// 로컬 확인·화면 점검용 정적 웹서버. (scripts/serve.mjs, scripts/check-ui.mjs 가 함께 쓴다)
// 배포 대상 파일(index.html, assets/, data/)만 내보내며, 잘못된 요청에도 서버가 죽지 않게 처리한다.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// 내보낼 수 있는 최상위 경로 (소스·설정·.git 등은 제외)
const ALLOWED_TOP = new Set(["index.html", "assets", "data"]);

const BLOCKED_NAME = /^(?:AGENTS\.md|CLAUDE\.md|.*\.(?:local(?:\..*)?|map|bak|backup|orig|rej|pem|key|p12|pfx|crt|cer|der)|.*(?:credential|secret|password|token).*)$/i;

function isSafeSegment(segment) {
  return Boolean(segment) && segment !== "." && segment !== ".." && !segment.startsWith(".") && !/[\0:]/.test(segment) && !/[. ]$/.test(segment) && !BLOCKED_NAME.test(segment);
}

function isWithin(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolveFile(root, requestUrl, dataDir) {
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.split("?")[0]);
  } catch {
    return null; // 잘못된 % 인코딩
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const rawSegments = pathname.split(/[\\/]/).filter(Boolean);
  if (rawSegments.some((segment) => !isSafeSegment(segment))) return null;
  // Windows 에서는 normalize 결과의 구분자가 \ 이므로 / 와 \ 를 모두 처리한다.
  const relative = path.normalize(pathname).replace(/^[\\/]+/, "");
  if (!relative || path.isAbsolute(relative)) return null;
  const [top, ...rest] = relative.split(/[\\/]/);
  if (!ALLOWED_TOP.has(top)) return null;
  // dataDir 를 주면 data/ 아래 요청을 그 폴더에서 찾는다. (다른 기관 데이터로 시험할 때 - examples/)
  const base = top === "data" && dataDir ? dataDir : root;
  const file = top === "data" && dataDir ? path.join(dataDir, ...rest) : path.join(root, relative);
  if (!isWithin(path.resolve(base), path.resolve(file))) return null;
  let realBase;
  let realFile;
  try {
    realBase = fs.realpathSync(base);
    realFile = fs.realpathSync(file);
  } catch {
    return null;
  }
  if (!isWithin(realBase, realFile)) return null;
  const realSegments = path.relative(realBase, realFile).split(path.sep);
  // 공개 폴더의 링크로 src/나 루트의 설정 파일을 읽는 것도 막는다.
  if (!(top === "data" && dataDir) && !ALLOWED_TOP.has(realSegments[0])) return null;
  if (realSegments.some((segment) => !isSafeSegment(segment))) return null;
  try {
    if (!fs.statSync(realFile).isFile()) return null;
  } catch {
    return null;
  }
  return realFile;
}

export function createStaticServer(root, { dataDir } = {}) {
  return http.createServer((req, res) => {
    const file = resolveFile(root, req.url ?? "/", dataDir);
    if (!file) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const size = fs.statSync(file).size;
    const headers = { "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", "Accept-Ranges": "bytes" };

    let start = 0;
    let end = size - 1;
    if (size === 0) {
      headers["Content-Length"] = "0";
      res.writeHead(200, headers);
      res.end();
      return;
    }
    let status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && (range[1] || range[2])) {
      // 영상 탐색(seek)을 위한 Range 요청. 범위를 파일 크기 안으로 보정한다.
      if (range[1]) {
        start = Number(range[1]);
        end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      } else {
        start = Math.max(0, size - Number(range[2])); // bytes=-N : 마지막 N바이트
      }
      if (start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        res.end();
        return;
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    headers["Content-Length"] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = fs.createReadStream(file, { start, end });
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });
}
