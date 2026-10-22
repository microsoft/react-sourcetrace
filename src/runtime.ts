import { Fragment, isValidElement, version } from "react";
import type {
  SourceFrame,
  SourceLocation,
  SourceTrace,
  SourceTraceApi,
  SourceTraceStorage,
} from "./types.js";

export type {
  SourceFrame,
  SourceLocation,
  SourceTrace,
  SourceTraceApi,
  SourceTraceStorage,
} from "./types.js";

interface Fiber {
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
  alternate: Fiber | null;
  elementType: unknown;
  index: number;
  memoizedProps: unknown;
  memoizedState: unknown;
  stateNode: unknown;
  key: string | null;
  tag: number;
}

interface FiberRoot {
  current: Fiber;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiber(value: unknown): value is Fiber {
  return (
    isRecord(value) && typeof value.tag === "number" && "memoizedProps" in value
  );
}

function isFiberRoot(value: unknown): value is FiberRoot {
  return isRecord(value) && isFiber(value.current);
}

function isLocation(value: unknown): value is SourceLocation {
  return (
    isRecord(value) &&
    typeof value.file === "string" &&
    typeof value.line === "number" &&
    Number.isInteger(value.line) &&
    value.line > 0 &&
    typeof value.column === "number" &&
    Number.isInteger(value.column) &&
    value.column > 0 &&
    typeof value.name === "string"
  );
}

const enabled =
  typeof window !== "undefined" &&
  (window.__SOURCETRACE_ENABLED__ === true ||
    new URLSearchParams(window.location.search).get("sourcetrace") === "1");
const storage: SourceTraceStorage =
  typeof window === "undefined"
    ? "property"
    : (window.__SOURCETRACE_STORAGE__ ?? "property");
const locations = new WeakMap<object, SourceLocation[]>();
const propsLocations = new WeakMap<object, readonly SourceLocation[] | null>();
const traces = new Map<Element, SourceTrace>();
let scheduled = false;
let flushing = false;

// Build adapters wrap each JSX element as recordElement(<jsx />, location), so the
// application's own JSX factory creates the element and its props stay untouched.
export function recordElement<T>(element: T, source: SourceLocation): T {
  if (!isLocation(source)) {
    throw new Error("[react-sourcetrace] Invalid compiler source metadata.");
  }
  if (enabled && isRecord(element) && isRecord(element.props)) {
    let sources = locations.get(element);
    if (!sources) {
      sources = [];
      locations.set(element, sources);
    }
    if (
      !sources.some(
        (location) =>
          location.file === source.file &&
          location.line === source.line &&
          location.column === source.column &&
          location.name === source.name,
      )
    ) {
      sources.push(source);
    }
    const previous = propsLocations.get(element.props);
    propsLocations.set(
      element.props,
      previous === undefined || previous === sources ? sources : null,
    );
    schedule();
  }
  return element;
}

function childElement(parent: Fiber, child: Fiber): object | null {
  let children: unknown;
  // Only these parents directly retain their reconciled child slots.
  switch (parent.tag) {
    case 3:
      children = isRecord(parent.memoizedState)
        ? parent.memoizedState.element
        : undefined;
      break;
    case 4:
    case 7:
      children = parent.memoizedProps;
      break;
    case 5:
    case 8:
    case 10:
    case 12:
    case 26:
    case 27:
      children = isRecord(parent.memoizedProps)
        ? parent.memoizedProps.children
        : undefined;
      break;
    default:
      return null;
  }
  // Reconciliation unwraps one top-level, unkeyed fragment.
  if (
    isValidElement<{ children?: unknown; ref?: unknown }>(children) &&
    children.type === Fragment &&
    children.key === null &&
    children.props.ref === undefined
  ) {
    children = children.props.children;
  }
  const element = Array.isArray(children) ? children[child.index] : children;
  return isValidElement(element) &&
    element.key === child.key &&
    (child.tag === 7
      ? element.type === Fragment
      : element.type === child.elementType)
    ? element
    : null;
}

function locationsFor(
  fiber: Fiber,
  element: object | null,
  memoChild: boolean,
): readonly SourceLocation[] {
  if (memoChild) return [];
  if (element) {
    const sources = locations.get(element);
    if (sources) return sources;
    // Children.map replaces keys without replacing the authored props.
    return isValidElement(element) && isRecord(element.props)
      ? (propsLocations.get(element.props) ?? [])
      : [];
  }
  // Fragment children do not identify their wrapper. Updated simple-memo
  // fibers can discard new call-site props, even before a flush observes them.
  if (fiber.tag === 7 || (fiber.tag === 15 && fiber.alternate)) return [];
  return isRecord(fiber.memoizedProps)
    ? (propsLocations.get(fiber.memoizedProps) ?? [])
    : [];
}

function frameFor(fiber: Fiber, source: SourceLocation): SourceFrame {
  return fiber.key === null ? source : { ...source, key: fiber.key };
}

// Nearest frame first; shared tails keep traversal linear in tree size.
interface Ancestry {
  frame: SourceFrame;
  parent: Ancestry | null;
}

function isHostFiber(fiber: Fiber): boolean {
  // React 19 adds hoistable resources (26) and document singletons (27).
  return fiber.tag === 5 || fiber.tag === 26 || fiber.tag === 27;
}

function traceFor(
  fiber: Fiber,
  ancestors: Ancestry | null,
  sources: readonly SourceLocation[],
): SourceTrace | null {
  const source = sources[0] ?? null;
  const stack = sources.map((location) => frameFor(fiber, location));
  for (let entry = ancestors; entry; entry = entry.parent) {
    const { frame } = entry;
    const previous = stack.at(-1);
    if (
      !previous ||
      previous.file !== frame.file ||
      previous.line !== frame.line ||
      previous.column !== frame.column ||
      previous.key !== frame.key
    ) {
      stack.push(frame);
    }
  }
  return stack.length === 0
    ? null
    : { source, stack, coverage: source ? "exact" : "ancestor-only" };
}

function setAttribute(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function clearTrace(element: Element): void {
  if (!traces.has(element)) return;
  if (storage === "property") {
    delete element.__sourceTrace;
  } else {
    for (const name of [
      "data-sourcetrace-src",
      "data-sourcetrace-stack",
      "data-sourcetrace-coverage",
    ]) {
      element.removeAttribute(name);
    }
  }
  traces.delete(element);
}

function annotate(
  fiber: Fiber,
  ancestors: Ancestry | null,
  sources: readonly SourceLocation[],
): void {
  if (!(fiber.stateNode instanceof Element)) return;
  const element = fiber.stateNode;
  const trace = traceFor(fiber, ancestors, sources);
  if (!trace) {
    clearTrace(element);
    return;
  }
  if (storage === "property") {
    if (!traces.has(element) && Object.hasOwn(element, "__sourceTrace")) {
      throw new Error(
        "[react-sourcetrace] Element property __sourceTrace is reserved.",
      );
    }
    Object.defineProperty(element, "__sourceTrace", {
      value: trace,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  traces.set(element, trace);
  if (storage === "property") return;
  if (trace.source) {
    const { file, line, column } = trace.source;
    setAttribute(element, "data-sourcetrace-src", `${file}:${line}:${column}`);
  } else {
    element.removeAttribute("data-sourcetrace-src");
  }
  setAttribute(element, "data-sourcetrace-stack", JSON.stringify(trace.stack));
  setAttribute(element, "data-sourcetrace-coverage", trace.coverage);
}

function resolveRoot(fiber: Fiber, resolved: Map<Fiber, FiberRoot>): FiberRoot {
  const path: Fiber[] = [];
  let top = fiber;
  let root = resolved.get(top);
  while (!root) {
    path.push(top);
    if (!top.return) break;
    top = top.return;
    root = resolved.get(top);
  }
  if (!root) {
    if (!isFiberRoot(top.stateNode)) {
      throw new Error(
        "[react-sourcetrace] Cannot resolve the committed React root.",
      );
    }
    root = top.stateNode;
  }
  // Memoize the walked path so shared ancestors are visited once per pass.
  for (const visited of path) resolved.set(visited, root);
  return root;
}

function discoverRoots(): Set<FiberRoot> {
  const roots = new Set<FiberRoot>();
  const resolved = new Map<Fiber, FiberRoot>();
  for (const element of document.querySelectorAll("*")) {
    for (const key of Object.keys(element)) {
      if (
        !key.startsWith("__reactFiber$") &&
        !key.startsWith("__reactContainer$")
      ) {
        continue;
      }
      const candidate: unknown = Reflect.get(element, key);
      // React clears a container's key to null when its root unmounts.
      if (candidate === null || candidate === undefined) continue;
      if (!isFiber(candidate)) {
        throw new Error(
          "[react-sourcetrace] Unsupported React DOM Fiber shape.",
        );
      }
      roots.add(resolveRoot(candidate, resolved));
    }
  }
  return roots;
}

function flush(): void {
  if (!enabled || flushing) return;
  flushing = true;
  try {
    const remaining = new Set(traces.keys());
    for (const root of discoverRoots()) {
      // Reused children can retain stale .return links; carry committed ancestry downward.
      const pending: {
        fiber: Fiber;
        ancestors: Ancestry | null;
        element: object | null;
        memoChild: boolean;
      }[] = [
        {
          fiber: root.current,
          ancestors: null,
          element: null,
          memoChild: false,
        },
      ];
      while (pending.length) {
        const entry = pending.pop();
        if (!entry) break;
        const { fiber, ancestors, element, memoChild } = entry;
        const sources = locationsFor(fiber, element, memoChild);
        let descendants = ancestors;
        if (isHostFiber(fiber)) {
          if (fiber.stateNode instanceof Element)
            remaining.delete(fiber.stateNode);
          annotate(fiber, ancestors, sources);
        } else {
          for (let index = sources.length - 1; index >= 0; index--) {
            descendants = {
              frame: frameFor(fiber, sources[index]!),
              parent: descendants,
            };
          }
        }
        for (let child = fiber.child; child; child = child.sibling) {
          pending.push({
            fiber: child,
            ancestors: descendants,
            element: childElement(fiber, child),
            memoChild: fiber.tag === 14,
          });
        }
      }
    }
    for (const element of remaining) clearTrace(element);
  } finally {
    flushing = false;
  }
}

function schedule(): void {
  if (!enabled || scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    flush();
  });
}

if (enabled) {
  if (storage !== "attributes" && storage !== "property") {
    throw new Error(
      `[react-sourcetrace] Unsupported storage mode: ${String(storage)}. Use "attributes" or "property".`,
    );
  }
  if (!/^(?:18\.3\.\d+|19\.\d+\.\d+)$/.test(version)) {
    throw new Error(
      `[react-sourcetrace] React ${version} is not supported; this package requires React 18.3.x or 19.x.`,
    );
  }
  const api: SourceTraceApi = {
    flush,
    inspect(element) {
      flush();
      return traces.get(element) ?? null;
    },
  };
  window.__SOURCETRACE__ = api;
  const observer = new MutationObserver((mutations) => {
    if (
      mutations.some(
        (mutation) =>
          mutation.type === "childList" ||
          !mutation.attributeName?.startsWith("data-sourcetrace-"),
      )
    ) {
      schedule();
    }
  });
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
  });
  schedule();
}
