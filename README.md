# react-sourcetrace

Find the original JSX source and component ancestry of a React DOM element.

`react-sourcetrace` instruments JSX at build time and follows committed React
instances at runtime. Two buttons rendered by the same component retain the same
implementation location but different instantiation paths. No component wrappers,
prop declarations, or application source annotations are required.

Supports React 18.3.x and 19.x, automatic and classic JSX (including custom JSX
runtimes such as Fluent or Emotion), Vite, the TypeScript compiler API, and
Webpack/Rspack loaders.

## Quick start

Install into an existing React application:

```sh
pnpm add -D react-sourcetrace
```

Build adapters parse JSX with the project's `typescript` package (peer range
`>=5.4 <7`); package managers install it if it is missing.

For Vite, put the tracing plugin before the React plugin:

```typescript
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sourceTrace } from "react-sourcetrace/vite";

export default defineConfig({
  plugins: [
    sourceTrace({
      root: fileURLToPath(new URL(".", import.meta.url)),
      enabled: process.env.SOURCETRACE_BUILD === "1",
    }),
    react(),
  ],
});
```

Set `SOURCETRACE_BUILD=1` in your build environment. Open the application with
`?sourcetrace=1`, or set `window.__SOURCETRACE_ENABLED__ = true` before application
modules load.

**Both opt-ins are required.** Build instrumentation defaults off. An
uninstrumented build contains no tracing runtime or source metadata. Disabling
only runtime tracing leaves source coordinates in the JavaScript bundle, but does
not expose traces or start observers.

## Reading a trace

By default, each traced `Element`, including SVG, receives a non-enumerable,
configurable `element.__sourceTrace` property containing the structured trace.
HTML is not modified. Use the browser API to read a current trace:

```javascript
const button = document.querySelector("button");
const trace = button ? window.__SOURCETRACE__?.inspect(button) : null;
```

A trace has this shape:

```json
{
  "source": {
    "file": "src/Button.tsx",
    "line": 8,
    "column": 3,
    "name": "button"
  },
  "stack": [
    { "file": "src/Button.tsx", "line": 8, "column": 3, "name": "button" },
    { "file": "src/Toolbar.tsx", "line": 12, "column": 5, "name": "Button" }
  ],
  "coverage": "exact"
}
```

Paths are relative to the configured root. Lines and columns are one-based;
columns use TypeScript's UTF-16 offsets and point to the opening `<`. Frames run
from the element toward the root and include React keys when available.

`inspect(element)` refreshes synchronously. `window.__SOURCETRACE__.flush()` refreshes
all discovered roots. An element without tracked ancestry returns `null`.

### Storage

The default `"property"` storage keeps tracing data out of HTML. Refreshes do not
modify HTML or generate DOM mutation records. Reused hosts receive updated
traces; their property is removed if tracked provenance disappears or the host
leaves the discovered committed trees. The property is private by convention, not
a security boundary. Its name is reserved in
property mode: conflicting application-owned properties cause an explicit error
rather than being overwritten.

To write DOM attributes instead, select attribute storage before application
modules load:

```javascript
window.__SOURCETRACE_ENABLED__ = true;
window.__SOURCETRACE_STORAGE__ = "attributes";
```

| Attribute                   | Value                                                    |
| --------------------------- | -------------------------------------------------------- |
| `data-sourcetrace-src`      | Original JSX location as `file:line:column`              |
| `data-sourcetrace-stack`    | JSON array of committed component/render ancestry frames |
| `data-sourcetrace-coverage` | `exact` or `ancestor-only`                               |

Attribute storage does not set `element.__sourceTrace`. Storage is selected once
at startup.

### Playwright

```typescript
import {
  enableSourceTrace,
  readSourceTrace,
} from "react-sourcetrace/playwright";

await enableSourceTrace(page);
await page.goto(appUrl);
const trace = await readSourceTrace(page.getByRole("button", { name: "Send" }));
```

Call the activation helper before navigation. Pass `{ storage: "attributes" }`
for attribute output; omitting `storage` preserves an already configured mode.
`readSourceTrace` works with either storage mode and
throws if tracing is unavailable or the element has no tracked ancestry.
Accessibility collectors can read `element.__sourceTrace` directly and serialize
the complete trace separately from their HTML snapshots.

## Other build adapters

### TypeScript compiler API and ts-loader

```typescript
import { createSourceTraceTransformers } from "react-sourcetrace/typescript";

const transformers = createSourceTraceTransformers({
  root: projectRoot,
  enabled: true,
});

program.emit(undefined, undefined, undefined, false, transformers);
```

Pass the same object through ts-loader's `getCustomTransformers` hook. Application
source typechecks normally; elements are wrapped during emit. Every `module`
setting (including CommonJS) and every JSX emit mode, factory, and import source
is supported. The adapter must load the same `typescript` copy as the compiler and
fails explicitly otherwise. Plain `tsc` does not load emit transformers from
`compilerOptions.plugins`.

### Webpack, Rspack, and SWC

Run the loader on original JSX before other source transforms:

```javascript
{
  test: /\.[jt]sx$/,
  exclude: /node_modules/,
  enforce: "pre",
  use: [{
    loader: require.resolve("react-sourcetrace/loader"),
    options: {
      root: projectRoot,
      enabled: true,
    },
  }],
}
```

The loader's output is still JSX, so the next loader keeps its own JSX settings.

Use either the loader or the TypeScript emit adapter, not both on the same source.
The loader rejects incoming source maps when enabled so that coordinates cannot
silently point into already transformed code.

Vite and Playwright are optional peers; install the integrations you use.

## How it works and limitations

The build adapter wraps each JSX element as `recordElement(<jsx />, location)`.
The project's own JSX transform, factory, and pragmas still create the element;
the runtime associates locations with elements and their props, without changing
either. The browser runtime reads committed React trees and carries
ancestry downward, including through reused children, portals, lazy boundaries,
and Suspense.

- React Fiber is a private API. Access is read-only and version-gated to stable
  React 18.3.x and 19.x; the browser matrix does not cover every patch or feature.
- The stack is committed component/render ancestry, **not** a JavaScript call
  stack or complete historical ownership. Ordinary helper calls are not frames.
- Only original `.tsx` and `.jsx` files under the configured root are instrumented.
  Precompiled dependencies and manual element creation do not acquire invented
  locations. When only ancestors are known, `source` is `null` and coverage is
  `ancestor-only`. `exact` describes the host location, not stack completeness.
  Elements re-created with `cloneElement` (for example `asChild` slot patterns)
  are likewise `ancestor-only`; their authored call site appears in the stack.
- Instrumentation adds no lines, so React's development source lines and owner
  stacks still point at application JSX. Elements that start a line keep their
  column unless a keyword such as `return` or a comment precedes them; other
  elements report shifted development columns (traces are unaffected).
  TypeScript 5.x development JSX derives positions from leading whitespace, so
  when it compiles loader output, a JSX child that starts a line may report the
  previous line.
- Properties and attributes refresh after DOM mutations and scheduled flushes. A
  commit that changes no DOM can leave them stale until the next flush;
  `inspect(element)` is always current.
- Fragment and memo call sites are read from retained committed JSX elements.
  React may optimize away fragments or discard new props during a memo bailout.
  If a current call site cannot be recovered (for example, an updated memo
  component returned directly from a function), its frame is omitted rather than
  inferred from shared children or stale props. Host sources remain independent
  of this ancestry limitation.
- Discovery covers the current document, not arbitrary shadow roots or other
  documents. Server HTML is not annotated; SSR/hydration is not currently covered
  by the browser matrix.
- Enabled passes scan the document and committed roots. This is diagnostic
  tooling, not a production performance guarantee. Source locations in shipped
  bundles remain inspectable even when runtime tracing is disabled.

## Development

Use Node.js 24 and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
npm run publish:check
```

The checks cover types, formatting, lint, unit tests on TypeScript 6 and 5.4
(the oldest supported release), React 18/19 browser tests,
both storage modes, supported build pipelines, and an isolated packed-package
consumer. Package checks use the `tar` command.

Set `SOURCETRACE_BUILD=1` and run `npm run dev` for the demo. `SOURCETRACE_JSX=classic`
selects classic JSX. Browser tests use five loopback ports starting at
48170; set `SOURCETRACE_TEST_PORT` to use another range.

## Publishing

| Target                          | Purpose                                             |
| ------------------------------- | --------------------------------------------------- |
| `npm run version:bump -- patch` | Bump the version without creating a commit or tag   |
| `npm run publish:check`         | Run all checks and validate the packed distribution |
| `npm run pack`                  | Build and create a local package tarball            |
| `npm run publish:dry-run`       | Validate the publish operation without uploading    |
| `npm run publish:npm`           | Validate and publish to the public npm registry     |

The version target also accepts `minor`, `major`, or `prerelease --preid=next`.
Packing always builds first; publishing always runs the release checks first.

CI checks pull requests and pushes to `main` on Linux and Windows. The publishing
action runs when a GitHub release is published, requires its tag to match
`v<package-version>`, and uses npm trusted publishing. Prereleases use the `next`
dist-tag; stable releases use `latest`.

Own the npm package and configure a trusted publisher for repository
`microsoft/react-sourcetrace`, workflow `publish.yml`, before using the publishing
action. Allow direct `npm publish` in that publisher's settings. Bootstrap the
first publication from an authenticated npm account with
`npm run publish:npm`. Version changes, commits, tags, and GitHub releases remain
explicit maintainer actions.

## License

MIT.
