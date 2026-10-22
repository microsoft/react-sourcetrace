import assert from "node:assert/strict";
import path from "node:path";
import { SourceMap } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import { instrumentSource } from "../../src/instrument.js";
import { createSourceTraceTransformers } from "../../src/typescript.js";
import sourceTraceLoader from "../../src/loader.js";

const root = process.cwd();
const filename = path.join(root, "fixture.tsx");
const code =
  "export const view = (\n  <div><Button {...props} /><span>text</span></div>\n);";
const options = { root, enabled: true };
const runtimeImport =
  'import { recordElement as __sourcetrace } from "react-sourcetrace/runtime";';

function parse(text: string) {
  return ts.createSourceFile(
    filename,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function jsxPositions(text: string) {
  const file = parse(text);
  const positions: { name: string; line: number; column: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const { line, character } = file.getLineAndCharacterOfPosition(
        node.getStart(file),
      );
      positions.push({
        name: node.tagName.getText(file),
        line: line + 1,
        column: character + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return positions;
}

function debugLines(text: string, transformers: ts.CustomTransformers = {}) {
  const output = ts.transpileModule(text, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSXDev,
    },
    transformers,
  }).outputText;
  return [...output.matchAll(/lineNumber: (\d+)/g)]
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
}

function emit(
  text: string,
  compilerOptions: ts.CompilerOptions,
  traceOptions: Parameters<typeof createSourceTraceTransformers>[0] = options,
) {
  return ts.transpileModule(text, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions,
    transformers: createSourceTraceTransformers(traceOptions),
  });
}

test("wraps elements with original, one-based JSX opening coordinates", () => {
  const result = instrumentSource(code, filename, options);
  assert.ok(result);
  assert.ok(
    result.code.startsWith(`/* @sourcetrace-instrumented */ ${runtimeImport}`),
  );
  assert.match(result.code, /"line":2,"column":3,"name":"div"/);
  assert.match(result.code, /"line":2,"column":8,"name":"Button"/);
  assert.match(result.code, /\{__sourcetrace\(<Button \{\.\.\.props\} \/>, /);
  assert.doesNotMatch(result.code, /@jsx/);
  assert.equal(result.map.sourcesContent?.[0], code);
  assert.equal(instrumentSource(result.code, filename, options), null);
});

test("disabled instrumentation is a true no-op", () => {
  assert.equal(instrumentSource(code, filename, { root }), null);
  assert.equal(
    instrumentSource(code, filename, { ...options, enabled: false }),
    null,
  );
});

test("does not rewrite dependencies, outside-root files, plain TS, or JSX-free files", () => {
  for (const file of [
    path.join(root, "node_modules", "lib", "view.tsx"),
    path.join(root, "..", "outside.tsx"),
    path.join(root, "plain.ts"),
  ]) {
    assert.equal(instrumentSource(code, file, options), null);
  }
  assert.equal(
    instrumentSource("export const answer = 42;", filename, options),
    null,
  );
});

test("the runtime binding avoids existing identifiers", () => {
  const result = instrumentSource(
    `const __sourcetrace = 1;\n${code}`,
    filename,
    options,
  );
  assert.ok(result);
  assert.match(result.code, /import \{ recordElement as __sourcetrace_ \}/);
  assert.match(result.code, /__sourcetrace_\(\n {2}<div>/);
});

test("keeps the application's JSX pragmas, factories and props untouched", () => {
  for (const pragma of [
    "/** @jsxImportSource @fluentui/react-jsx-runtime */",
    "/** @jsxRuntime classic */\n/** @jsx h */",
    "// @jsxImportSource @emotion/react",
  ]) {
    const input = `${pragma}\n${code}`;
    const result = instrumentSource(input, filename, options);
    assert.ok(result, pragma);
    assert.ok(result.code.includes(pragma));
    assert.equal(
      result.code.match(/@jsx/g)?.length,
      pragma.match(/@jsx/g)?.length,
    );
    assert.match(result.code, /<Button \{\.\.\.props\} \/>/);
  }
  const fluent = instrumentSource(
    `/** @jsxImportSource @fluentui/react-jsx-runtime */\n${code}`,
    filename,
    options,
  );
  assert.ok(fluent);
  const output = ts.transpileModule(fluent.code, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  assert.match(output, /from "@fluentui\/react-jsx-runtime\/jsx-runtime"/);
  assert.match(output, /from "react-sourcetrace\/runtime"/);
});

test("handles fragments, multiline attributes, Unicode columns and JSX in attributes", () => {
  const result = instrumentSource(
    "export const x = <>😀<Panel\n child={<b />}\n slot=<i />\n {...props}\n /></>;",
    filename,
    options,
  );
  assert.ok(result);
  assert.match(result.code, /"column":22,"name":"Panel"/);
  assert.match(result.code, /"line":2,"column":9,"name":"b"/);
  assert.match(result.code, /slot=\{__sourcetrace\(<i \/>, /);
  const parsed = ts.transpileModule(result.code, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  });
  assert.deepEqual(parsed.diagnostics, []);
});

const layout = `"use client"
/** @jsxImportSource @fluentui/react-jsx-runtime */
import { Button } from "./button";
export function View(props: { on: boolean }) {
  if (props.on)
    return (
      <div
        id="a">
        text
        <Button {...props} />
        {props.on && <span />}
        <>
          <b>bold</b>
        </>
      </div>
    );
  const value =
    <i />;
  const items = [1, 2].map((item) =>
    <li key={item} />
  );
  render(
    <q />,
    props.on
      ? <u />
      : <s />,
  );
  return <Button slot=<em /> value={value} items={items} />;
}
`;

test("instrumentation keeps every JSX line, and the columns of elements that start a line", () => {
  const result = instrumentSource(layout, filename, options);
  assert.ok(result);
  assert.equal(result.code.split("\n").length, layout.split("\n").length);
  const before = jsxPositions(layout);
  const after = jsxPositions(result.code);
  assert.deepEqual(
    after.map(({ name, line }) => [name, line]),
    before.map(({ name, line }) => [name, line]),
  );
  const lines = layout.split("\n");
  let starting = 0;
  before.forEach((position, index) => {
    const lead = lines[position.line - 1]!.slice(0, position.column - 1);
    if (!/^\s*$/.test(lead)) return;
    assert.deepEqual(after[index], position);
    starting++;
  });
  assert.equal(starting, 6);
  if (Number(ts.versionMajorMinor.split(".")[0]) >= 6) {
    // TypeScript 5.x reports the line where an element's leading trivia begins.
    assert.deepEqual(debugLines(result.code), debugLines(layout));
  }
  assert.deepEqual(
    debugLines(layout, createSourceTraceTransformers(options)),
    debugLines(layout),
  );
  const parsed = parse(result.code);
  assert.equal(parsed.statements[0]?.getText(parsed), '"use client"');
  assert.equal(parsed.statements[1]?.getText(parsed), runtimeImport);
});

test("column preservation never changes JSX text or automatic semicolon insertion", () => {
  for (const space of ["\u00a0", "\v", "\f"]) {
    const input = `export const v = <p>Price${space}\n  <b>10</b>\n</p>;`;
    const result = instrumentSource(input, filename, options);
    assert.ok(result);
    assert.ok(result.code.includes(`Price${space}\n  {__sourcetrace(<b>`));
  }
  for (const keyword of ["return", "throw"]) {
    const input = `export function f() {\n  ${keyword}\n  <a />;\n}`;
    const result = instrumentSource(input, filename, options);
    assert.ok(result);
    assert.ok(result.code.includes(`${keyword}\n  __sourcetrace(<a />`));
  }
});

test("directive prologues and shebangs stay first in both adapters", () => {
  for (const input of [
    `"use client";\n${code}`,
    `'use client'\n'use strict'\n${code}`,
  ]) {
    const result = instrumentSource(input, filename, options);
    assert.ok(result);
    const parsed = parse(result.code);
    const directives = input.startsWith('"') ? 1 : 2;
    assert.ok(
      parsed.statements
        .slice(0, directives)
        .every(
          (statement) =>
            ts.isExpressionStatement(statement) &&
            ts.isStringLiteral(statement.expression),
        ),
    );
    assert.equal(parsed.statements[directives]?.getText(parsed), runtimeImport);
    const emitted = emit(input, {
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2022,
    });
    assert.ok(emitted.outputText.startsWith(input.slice(0, 12)));
  }
  const shebang = instrumentSource(
    `#!/usr/bin/env node\n${code}`,
    filename,
    options,
  );
  assert.ok(shebang);
  assert.ok(
    shebang.code.startsWith(
      "#!/usr/bin/env node\n/* @sourcetrace-instrumented */ ",
    ),
  );
  assert.equal(instrumentSource(shebang.code, filename, options), null);
});

test("a statement starting with JSX after a directive stays after the import", () => {
  for (const input of [
    '"use client";\n<div />;',
    '"use client";\n\n(\n  <App />\n);',
    '"use client";\n// note\n<div />;\nexport {};',
  ]) {
    const result = instrumentSource(input, filename, options);
    assert.ok(result);
    const parsed = parse(result.code);
    assert.deepEqual(
      ts.transpileModule(result.code, {
        fileName: filename,
        reportDiagnostics: true,
        compilerOptions: { jsx: ts.JsxEmit.Preserve },
      }).diagnostics,
      [],
      result.code,
    );
    assert.equal(parsed.statements[1]?.getText(parsed), runtimeImport);
    const lines = (text: string) =>
      jsxPositions(text).map(({ name, line }) => `${name}:${line}`);
    assert.deepEqual(lines(result.code), lines(input));
  }
});

test("source maps resolve emitted JSX tokens to original columns", () => {
  const result = instrumentSource(code, filename, options);
  assert.ok(result);
  const offset = result.code.indexOf("<Button");
  const prefix = result.code.slice(0, offset);
  const map = new SourceMap(JSON.parse(result.map.toString()));
  const entry = map.findEntry(
    prefix.split("\n").length - 1,
    offset - prefix.lastIndexOf("\n") - 1,
  );
  assert.ok("originalLine" in entry);
  assert.equal(entry.originalLine, 1);
  assert.equal(entry.originalColumn, 7);
});

test("strings and comments naming pragmas or the marker do not disable tracing", () => {
  assert.ok(
    instrumentSource(
      `const text = "@jsxImportSource other @sourcetrace-instrumented";\n${code}`,
      filename,
      options,
    ),
  );
});

test("pre-loader passes wrapped JSX and high-resolution maps to the next loader", () => {
  let called = false;
  sourceTraceLoader.call(
    {
      resourcePath: filename,
      rootContext: root,
      getOptions: () => ({ enabled: true }),
      callback(error, output, map) {
        assert.equal(error, null);
        assert.match(output ?? "", /__sourcetrace\(\n {2}<div>/);
        assert.ok(map);
        called = true;
      },
    },
    code,
  );
  assert.ok(called);
});

for (const [name, jsx, factory] of [
  [
    "classic",
    ts.JsxEmit.React,
    /React\.createElement\(Button, \{ \.\.\.props \}\)/,
  ],
  ["automatic", ts.JsxEmit.ReactJSX, /from "react\/jsx-runtime"/],
  [
    "automatic development",
    ts.JsxEmit.ReactJSXDev,
    /from "react\/jsx-dev-runtime"/,
  ],
  [
    "preserve",
    ts.JsxEmit.Preserve,
    /recordElement\(<Button \{\.\.\.props\}\/>/,
  ],
] as const) {
  test(`TypeScript ${name} emit records elements around the normal factory`, () => {
    const result = emit(code, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx,
      sourceMap: true,
    });
    assert.deepEqual(result.diagnostics, []);
    assert.match(result.outputText, factory);
    assert.match(
      result.outputText,
      /import \* as __sourcetrace_1 from "react-sourcetrace\/runtime";/,
    );
    assert.match(
      result.outputText,
      /__sourcetrace_1\.recordElement\([^]*\{ file: "fixture\.tsx", line: 2, column: 3, name: "div" \}\)/,
    );
    assert.doesNotMatch(result.outputText, /__sourcetrace: /);
    assert.ok(result.sourceMapText);
  });
}

test("TypeScript custom factories and namespaces receive unmodified props", () => {
  const input = 'export const view = <div id="x" />;';
  for (const [compilerOptions, call] of [
    [{ reactNamespace: "Preact" }, 'Preact.createElement("div", { id: "x" })'],
    [{ jsxFactory: "h" }, 'h("div", { id: "x" })'],
  ] as const) {
    const result = emit(input, {
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
      ...compilerOptions,
    });
    assert.ok(
      result.outputText.includes(
        `__sourcetrace_1.recordElement(${call}, { file: "fixture.tsx"`,
      ),
      result.outputText,
    );
  }
  const imported = emit(input, {
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: "@emotion/react",
  });
  assert.match(imported.outputText, /from "@emotion\/react\/jsx-runtime"/);
});

test("TypeScript adapter supports CommonJS output", () => {
  const input =
    'const Button = "button";\nexport const view = <div><Button id="a" />{[<span key="k" />]}</div>;';
  for (const esModuleInterop of [false, true]) {
    const output = emit(input, {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop,
    }).outputText;
    const recorded: string[] = [];
    const element = (type: string, props: object) => ({ type, props });
    const modules: Record<string, object> = {
      "react/jsx-runtime": { jsx: element, jsxs: element },
      "react-sourcetrace/runtime": {
        recordElement(value: { type: string }, source: { name: string }) {
          recorded.push(`${value.type}:${source.name}`);
          return value;
        },
      },
    };
    const exports: { view?: { type: string } } = {};
    new Function("require", "exports", output)(
      (id: string) => modules[id],
      exports,
    );
    assert.equal(exports.view?.type, "div");
    assert.deepEqual(recorded.sort(), [
      "button:Button",
      "div:div",
      "span:span",
    ]);
  }
});

test("TypeScript adapter keeps the compiler's comment output", () => {
  const input =
    "export function f() {\n  return (\n    // line\n    /* block */ <div>{/* inner */}<b /></div>\n  );\n}\nexport const h = () =>\n  // arrow\n  <p />;";
  for (const jsx of [ts.JsxEmit.React, ts.JsxEmit.ReactJSX]) {
    const comments = (text: string) => text.match(/\/\/ \w+|\/\* \w+ \*\//g);
    const plain = ts.transpileModule(input, {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.ESNext, jsx },
    }).outputText;
    const traced = emit(input, { module: ts.ModuleKind.ESNext, jsx });
    assert.deepEqual(comments(traced.outputText), comments(plain));
  }
});

test("TypeScript disabled adapter leaves output unchanged", () => {
  const plain = ts.transpileModule(code, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const result = emit(
    code,
    { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    { root },
  );
  assert.equal(result.outputText, plain);
});

test("program.emit instruments only after normal application typechecking, with default module settings", () => {
  const input =
    'export function Button(props: { label: string }) { return <button>{props.label}</button>; }\nexport const view = <Button label="ok" />;';
  for (const compilerOptions of [
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    {},
  ] as ts.CompilerOptions[]) {
    Object.assign(compilerOptions, {
      jsx: ts.JsxEmit.ReactJSX,
      skipLibCheck: true,
      strict: true,
      types: [],
    });
    const host = ts.createCompilerHost(compilerOptions);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (file, version, onError, shouldCreate) =>
      path.resolve(file) === filename
        ? ts.createSourceFile(
            file,
            input,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TSX,
          )
        : getSourceFile(file, version, onError, shouldCreate);
    const program = ts.createProgram([filename], compilerOptions, host);
    if (compilerOptions.module !== undefined) {
      assert.deepEqual(ts.getPreEmitDiagnostics(program), []);
    }
    let output = "";
    const emitted = program.emit(
      undefined,
      (file, text) => {
        if (file.endsWith(".js")) output = text;
      },
      undefined,
      false,
      createSourceTraceTransformers(options),
    );
    assert.equal(emitted.emitSkipped, false);
    assert.match(output, /react-sourcetrace\/runtime/);
    assert.match(output, /recordElement\(/);
  }
});

test("TypeScript adapter tolerates JSX synthesized by earlier transformers", () => {
  const input = 'export const view = <div>\n  <b id="a" />\n</div>;';
  // Replaces <b id="a" /> with an updated copy and wraps it in a new <i>.
  const earlier: ts.TransformerFactory<ts.SourceFile> = (context) => (file) => {
    const factory = context.factory;
    const visit: ts.Visitor = (node) => {
      if (ts.isJsxSelfClosingElement(node)) {
        const updated = factory.updateJsxSelfClosingElement(
          node,
          node.tagName,
          node.typeArguments,
          factory.createJsxAttributes([
            ...node.attributes.properties,
            factory.createJsxAttribute(
              factory.createIdentifier("title"),
              factory.createStringLiteral("t"),
            ),
          ]),
        );
        return factory.createJsxElement(
          factory.createJsxOpeningElement(
            factory.createIdentifier("i"),
            undefined,
            factory.createJsxAttributes([]),
          ),
          [updated],
          factory.createJsxClosingElement(factory.createIdentifier("i")),
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(file, visit, ts.isSourceFile)!;
  };
  for (const jsx of [ts.JsxEmit.Preserve, ts.JsxEmit.ReactJSX]) {
    const traced = createSourceTraceTransformers(options);
    const result = ts.transpileModule(input, {
      fileName: filename,
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.ESNext, jsx },
      transformers: { before: [earlier, ...(traced.before ?? [])] },
    });
    assert.deepEqual(result.diagnostics, []);
    const names = [
      ...result.outputText.matchAll(
        /line: (\d+), column: (\d+), name: "(\w+)"/g,
      ),
    ].map((match) => match.slice(1).join(":"));
    assert.deepEqual(names.sort(), ["1:21:div", "2:3:b"], result.outputText);
    if (jsx === ts.JsxEmit.Preserve) {
      assert.match(
        result.outputText,
        /<i>\{__sourcetrace_1\.recordElement\(<b /,
      );
    }
  }
});

test("TypeScript adapter rejects nodes from a different TypeScript instance", () => {
  const file = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  const transform = createSourceTraceTransformers(options).before?.[0];
  assert.ok(typeof transform === "function");
  const foreign = Object.assign(Object.create(file), {
    kind: ts.SyntaxKind.SourceFile + 1,
  });
  assert.throws(
    () =>
      (transform as ts.TransformerFactory<ts.SourceFile>)(
        {} as ts.TransformationContext,
      )(foreign),
    /differs from the compiler's TypeScript/,
  );
});
