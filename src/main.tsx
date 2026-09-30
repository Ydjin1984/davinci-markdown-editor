import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "katex/dist/katex.min.css";
import "./styles/global.css";
import "./styles/markdown.css";

import { App } from "./App";
import { ErrorBoundary } from "./app/ErrorBoundary";

const container = document.getElementById("root");
if (!container) {
  throw new Error("the root element is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
