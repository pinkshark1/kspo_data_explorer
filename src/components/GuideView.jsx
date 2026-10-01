import { useEffect, useRef, useState } from "react";

// "사용방법" 화면: 사이트 안에서 영상을 재생하고, 같은 내용을 글로도 안내한다.
// (영상이 16MB라 처음에는 썸네일만 불러오고, 재생을 누르면 영상을 받는다.)
export default function GuideView({ guide }) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef(null);
  const steps = guide.steps ?? [];

  // 재생 버튼이 영상으로 바뀌면 키보드 초점도 영상으로 옮긴다.
  useEffect(() => {
    if (playing) videoRef.current?.focus();
  }, [playing]);

  return (
    <section
      className="standalone-content guide-view"
      id="main-content"
      aria-labelledby="guide-title"
    >
      <div className="ideas-heading">
        <span>이용 안내</span>
        <h1 id="guide-title">{guide.title}</h1>
        <p>{guide.lead}</p>
      </div>

      <div className="guide-layout">
        {guide.video && (
          <div className="guide-media">
            {playing ? (
              <video
                ref={videoRef}
                tabIndex={-1}
                className="guide-player"
                controls
                autoPlay
                playsInline
                preload="metadata"
                poster={guide.poster}
                aria-label={`${guide.title} 영상`}
              >
                <source src={guide.video} type="video/mp4" />이 브라우저는
                동영상 재생을 지원하지 않습니다. 단계별 안내를 참고해 주세요.
              </video>
            ) : (
              <button
                type="button"
                className="guide-thumbnail"
                onClick={() => setPlaying(true)}
                aria-label={`${guide.title} 영상 재생`}
              >
                <img src={guide.poster} alt="" />
                <span className="guide-play" aria-hidden="true">
                  ▶
                </span>
              </button>
            )}
            <p className="guide-hint">
              {playing
                ? "영상이 재생되지 않으면 단계별 안내를 확인해 주세요."
                : "클릭하여 사용방법 영상 보기"}
            </p>
          </div>
        )}

        <ol className="guide-steps">
          {steps.map((step, index) => (
            <li key={step.title}>
              <span className="guide-step-no" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <b>{step.title}</b>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {guide.externalUrl && (
        <p className="guide-external">
          <a href={guide.externalUrl} target="_blank" rel="noreferrer">
            YouTube에서 보기 <span>(새 창 · 외부 사이트)</span>
          </a>
        </p>
      )}
    </section>
  );
}
