import { createElement } from "react";

// Models a dependency published as JavaScript without original JSX metadata.
export function OpaqueButton() {
  return createElement("button", { id: "opaque" }, "Uninstrumented dependency");
}
