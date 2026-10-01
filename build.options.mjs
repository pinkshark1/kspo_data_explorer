// esbuild 설정. build.mjs(배포 파일 생성)와 scripts/generate-notices.mjs(포함된 오픈소스 목록 조회)가 함께 쓴다.
export const buildOptions = {
  entryPoints: { app: "src/main.jsx" },
  outdir: "assets",
  bundle: true,
  format: "esm",
  // AI 호출용 SDK 는 질문 검색에서 Claude 를 처음 쓸 때만 내려받도록 별도 파일(assets/chunks/)로 나눈다.
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  target: ["chrome90", "edge90", "firefox90", "safari15"],
  jsx: "automatic",
  minify: true,
  // 오픈소스의 라이선스 주석을 assets/*.LEGAL.txt 로 분리해 함께 배포한다.
  legalComments: "linked",
  // 글꼴 파일은 assets/fonts 에 이미 들어 있으므로 CSS 의 url() 을 그대로 둔다.
  external: ["*.woff2"],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
};
