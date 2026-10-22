import React, { Fragment, memo, useRef, useState } from "react";

const shared = [
  <button className="shared-fragment-child" key="child">
    Shared child
  </button>,
];

function Counter({ id }: { id: string }) {
  const [count, setCount] = useState(0);
  const renders = useRef(0);
  renders.current++;
  return (
    <button
      id={id}
      data-renders={renders.current}
      onClick={() => setCount((value) => value + 1)}
    >
      {count}
    </button>
  );
}

const MemoCounter = memo(Counter);
const ComparedCounter = memo(Counter, () => true);

function DirectMemo({ flipped }: { flipped: boolean }) {
  return flipped ? (
    <MemoCounter id="memo-direct" />
  ) : (
    <MemoCounter id="memo-direct" />
  );
}

export function ProvenanceFeatures() {
  const [flipped, setFlipped] = useState(false);
  // This element must never contribute ancestry to a committed fragment.
  void (<Fragment key="first">{shared}</Fragment>);
  const fragments = [
    <Fragment key="first">{shared}</Fragment>,
    <Fragment key="second">{shared}</Fragment>,
  ];
  return (
    <section id="provenance-features">
      <button
        id="flip-provenance"
        onClick={() => setFlipped((value) => !value)}
      >
        Flip provenance
      </button>
      <section id="shared-fragments">
        {flipped ? fragments.reverse() : fragments}
      </section>
      <section id="other-fragment">
        <Fragment key="first">{shared}</Fragment>
      </section>
      <section id="manual-fragment">
        {React.createElement(Fragment, { key: "first" }, shared)}
      </section>
      <section id="mapped-children">
        {React.Children.map(shared, (child) => child)}
      </section>
      <section id="memo-retained-parent">
        {flipped ? (
          <MemoCounter id="memo-retained" />
        ) : (
          <MemoCounter id="memo-retained" />
        )}
      </section>
      <section id="memo-compared-parent">
        {flipped ? (
          <ComparedCounter id="memo-compared" />
        ) : (
          <ComparedCounter id="memo-compared" />
        )}
      </section>
      <DirectMemo flipped={flipped} />
    </section>
  );
}
