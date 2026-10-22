import React, { useCallback, useState, type Ref } from "react";

function RefPropButton({ ref }: { ref: Ref<HTMLButtonElement> }) {
  return (
    <button id="ref-prop-button" ref={ref}>
      Ref as a prop
    </button>
  );
}

export function React19Features() {
  const [visible, setVisible] = useState(true);
  const ref = useCallback((node: HTMLButtonElement | null) => {
    if (!node) return;
    const documentData = document.documentElement.dataset;
    documentData.react19RefAttaches = String(
      Number(documentData.react19RefAttaches ?? 0) + 1,
    );
    return () => {
      documentData.react19RefCleanups = String(
        Number(documentData.react19RefCleanups ?? 0) + 1,
      );
    };
  }, []);
  return (
    <React.Fragment>
      <title id="traced-title">React 19 source tracing</title>
      <meta
        id="traced-meta"
        name="sourcetrace-test"
        content="React 19 metadata"
      />
      <button
        id="toggle-ref-prop"
        onClick={() => setVisible((value) => !value)}
      >
        Toggle ref-prop child
      </button>
      {visible && <RefPropButton ref={ref} />}
    </React.Fragment>
  );
}
