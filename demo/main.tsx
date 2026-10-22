import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ProvenanceFeatures } from "./ProvenanceFeatures.js";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

let probeRoot: ReturnType<typeof createRoot> | undefined;
function getProbeRoot() {
  if (!probeRoot) {
    const container = document.createElement("div");
    document.body.append(container);
    probeRoot = createRoot(container);
  }
  return probeRoot;
}
window.renderProvenanceFeatures = () => {
  getProbeRoot().render(<ProvenanceFeatures />);
};
window.renderProvenanceProbe = (instrumented) => {
  getProbeRoot().render(
    instrumented ? (
      <button id="provenance-probe">Traced probe</button>
    ) : (
      React.createElement(
        "button",
        { id: "provenance-probe" },
        "Untraced probe",
      )
    ),
  );
};
// The container stays in the document; React leaves its cleared root key behind.
window.unmountProvenanceProbe = () => {
  probeRoot?.unmount();
  probeRoot = undefined;
};

declare global {
  interface Window {
    renderProvenanceFeatures: () => void;
    renderProvenanceProbe: (instrumented: boolean) => void;
    unmountProvenanceProbe: () => void;
  }
}
