import type * as React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "my-widget": React.HTMLAttributes<HTMLElement>;
    }
  }
}
