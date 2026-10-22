import React, {
  Component,
  forwardRef,
  lazy,
  memo,
  StrictMode,
  Suspense,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button.js";
import { OpaqueButton } from "./OpaqueButton.js";
import { React19Features } from "./React19Features.js";
import { FluentFeatures } from "./FluentFeatures.js";

const MemoButton = memo(Button);
const ForwardButton = forwardRef<HTMLButtonElement, { id: string }>(
  function ForwardButton(props, ref) {
    return (
      <button {...props} ref={ref}>
        Forward ref
      </button>
    );
  },
);
class ClassButton extends Component {
  render() {
    return <button id="class-button">Class button</button>;
  }
}
function Slot({ children }: { children: ReactNode }) {
  return <section id="slot">{children}</section>;
}
function PropProbe(props: { label: string }) {
  return <output id="prop-keys">{Object.keys(props).join(",")}</output>;
}
const LazyButton = lazy(() => import("./LazyButton.js"));

export function App() {
  const [flipped, setFlipped] = useState(false);
  const [show, setShow] = useState(true);
  const [reverse, setReverse] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const keys = reverse ? ["b", "a"] : ["a", "b"];
  return (
    <StrictMode>
      <main data-react-version={React.version}>
        <h1>react-sourcetrace</h1>
        <span
          id="application-attributes"
          data-src={
            flipped ? "application-updated.png" : "application-image.png"
          }
          data-src-stack="application-stack"
          data-src-coverage="application-coverage"
        >
          Application-owned attributes
        </span>
        {React.version.startsWith("19.") && <React19Features />}
        <FluentFeatures />
        <Button id="first" />
        <Button id="second" />
        <MemoButton id="memo" />
        <ForwardButton id="forward" ref={ref} />
        <button id="focus-forward" onClick={() => ref.current?.focus()}>
          Focus forwarded ref
        </button>
        <ClassButton />
        <Slot>
          <Button id="slotted" />
        </Slot>
        <PropProbe label="clean" />
        <OpaqueButton />
        <button id="flip" onClick={() => setFlipped((value) => !value)}>
          Change call site
        </button>
        {flipped ? <Button id="changing" /> : <Button id="changing" />}
        <button id="toggle" onClick={() => setShow((value) => !value)}>
          Toggle child
        </button>
        {show && <Button id="conditional" />}
        <button id="reorder" onClick={() => setReverse((value) => !value)}>
          Reorder
        </button>
        {keys.map((key) => (
          <Button key={key} id={`key-${key}`} />
        ))}
        <Button {...{ id: "spread-key" }} key="spread-key" />
        <svg aria-label="vector">
          <circle id="circle" cx="10" cy="10" r="5" />
        </svg>
        <my-widget id="custom-element" />
        {createPortal(
          <Button id="portal" />,
          document.getElementById("portal-root")!,
        )}
        <Suspense fallback={<span id="loading">Loading</span>}>
          <LazyButton />
        </Suspense>
        <React.Fragment>
          <span id="explicit-fragment">Fragment child</span>
        </React.Fragment>
      </main>
    </StrictMode>
  );
}
