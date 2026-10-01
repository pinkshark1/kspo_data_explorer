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

function resolveFile(root, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.split("?")[0]);
  } catch {
    return null; // 잘못된 % 인코딩
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  // Windows 에서는 normalize 결과의 구분자가 \ 이므로 / 와 \ 를 모두 처리한다.
  const relative = path.normalize(pathname).replace(/^[\\/]+/, "");
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (!ALLOWED_TOP.has(relative.split(/[\\/]/)[0])) return null;
  const file = path.join(root, relative);
  if (path.relative(root, file).startsWith("..")) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return file;
}

export function createStaticServer(root) {
  return http.createServer((req, res) => {
    const file = resolveFile(root, req.url ?? "/");
    if (!file) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const size = fs.statSync(file).size;
    const headers = { "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", "Accept-Ranges": "bytes" };

    let start = 0;
    let end = size - 1;
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
    const stream = fs.createReadStream(file, { start, end });
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });
}
