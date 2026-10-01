import { Component, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import App from "./App.jsx";
import { loadAppData } from "./lib/data.js";

const root = document.getElementById("root");

// 데이터 파일을 못 읽었거나 화면을 그리다 오류가 나면, 빈 화면 대신 무엇이 문제인지 알려준다.
function LoadError({ error }) {
  return (
    <main className="data-load-error" role="alert">
      <h1>데이터를 불러오지 못했습니다.</h1>
      <p>
        웹서버에서 <code>data/explorer-data.json</code>, <code>data/site.json</code> 경로와 JSON MIME 유형을 확인해 주세요.
      </p>
      {error?.message && <p>{error.message}</p>}
    </main>
  );
}

class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  render() {
    return this.state.error ? <LoadError error={this.state.error} /> : this.props.children;
  }
}

const reactRoot = createRoot(root);

loadAppData()
  .then((data) =>
    reactRoot.render(
      <StrictMode>
        <ErrorBoundary>
          <App data={data} />
        </ErrorBoundary>
      </StrictMode>,
    ),
  )
  .catch((error) => {
    console.error(error);
    reactRoot.render(<LoadError error={error} />);
  });
