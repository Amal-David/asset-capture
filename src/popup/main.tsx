import "@google/model-viewer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../sidepanel/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App compact />
  </StrictMode>
);
