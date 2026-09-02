const GUIDE_THUMBNAIL = "./assets/kspo-data-map-guide.jpg";
const GUIDE_VIDEO = "./assets/kspo-data-map-guide.mp4";

function createGuideVideo() {
  const section = document.createElement("section");
  section.className = "guide-video";
  section.setAttribute("aria-labelledby", "guide-video-title");

  const heading = document.createElement("div");
  heading.className = "guide-video-heading";
  heading.innerHTML = `
    <h1 id="guide-video-title">KSPO 데이터 지도 사용방법</h1>
    <p>공공데이터를 쉽고 빠르게 찾는 방법을 영상으로 확인해보세요.</p>
  `;

  const media = document.createElement("div");
  media.className = "guide-video-media";

  const playButton = document.createElement("button");
  playButton.className = "guide-video-thumbnail";
  playButton.type = "button";
  playButton.setAttribute("aria-label", "KSPO 데이터 지도 사용방법 영상 재생");
  playButton.innerHTML = `
    <img src="${GUIDE_THUMBNAIL}" alt="KSPO 데이터 지도 사용방법 영상 썸네일" />
    <span class="guide-video-play" aria-hidden="true">▶</span>
  `;

  playButton.addEventListener("click", () => {
    const video = document.createElement("video");
    video.className = "guide-video-player";
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.setAttribute("aria-label", "KSPO 데이터 지도 사용방법 영상");

    const source = document.createElement("source");
    source.src = GUIDE_VIDEO;
    source.type = "video/mp4";
    video.append(source, document.createTextNode("이 브라우저는 동영상 재생을 지원하지 않습니다."));
    media.replaceChildren(video);
  });

  const hint = document.createElement("p");
  hint.className = "guide-video-hint";
  hint.textContent = "클릭하여 사용방법 영상 보기";

  media.append(playButton);
  section.append(heading, media, hint);
  return section;
}

function mountGuideVideo() {
  const explorerShell = document.querySelector(".explorer-shell#main-content");
  const controls = explorerShell?.querySelector(":scope > .explorer-controls");
  if (controls && !explorerShell.querySelector(":scope > .guide-video")) {
    controls.before(createGuideVideo());
  }
}

new MutationObserver(mountGuideVideo).observe(document.getElementById("root"), {
  childList: true,
  subtree: true,
});
mountGuideVideo();
