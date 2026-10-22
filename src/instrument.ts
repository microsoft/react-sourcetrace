import path from "node:path";
import ts from "typescript";
import MagicString from "magic-string";
import type { SourceLocation } from "./types.js";

export interface SourceTraceOptions {
  enabled?: boolean;
  root: string;
}

export const runtimePackage = "react-sourcetrace";
export const runtimeModule = `${runtimePackage}/runtime`;
const marker = "@sourcetrace-instrumented";

export function isSourceFile(
  file: string,
  options: SourceTraceOptions,
): boolean {
  const relative = path.relative(options.root, file);
  return (
    options.enabled === true &&
    /\.[jt]sx$/.test(file) &&
    !relative.split(/[\\/]/).includes("node_modules") &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function locationOf(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  file: ts.SourceFile,
  root: string,
): SourceLocation {
  const position = file.getLineAndCharacterOfPosition(node.getStart(file));
  return {
    file: path.relative(root, file.fileName).split(path.sep).join("/"),
    line: position.line + 1,
    column: position.character + 1,
    name: node.tagName.getText(file),
  };
}

function isJsxChildContext(node: ts.Node): boolean {
  return (
    ts.isJsxElement(node.parent) ||
    ts.isJsxFragment(node.parent) ||
    ts.isJsxAttribute(node.parent)
  );
}

// Starting the call on an earlier line keeps the element's own line and column,
// which compilers copy into React's development source information.
function prefixPosition(
  node: ts.Node,
  file: ts.SourceFile,
  floor: number,
): number {
  const text = file.text;
  const start = node.getStart(file);
  let index = start;
  if (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) {
    // JSX text whitespace that touches a newline is not rendered, so it may
    // move into the expression container. Compilers disagree on whether other
    // whitespace characters (such as NBSP) are trimmed, so leave those alone.
    while (index > 0 && /[ \t\r\n]/.test(text[index - 1]!)) index--;
    if (index > 0 && /\s/.test(text[index - 1]!)) return start;
  } else if (
    /^[ \t\r\n]*$/.test(text.slice(node.pos, start)) &&
    // After these punctuators, no automatic semicolon can separate the call
    // from the preceding token (unlike after return, throw or yield).
    /[([{,;=?:&|>+\-*/%!~^<]/.test(text[node.pos - 1] ?? "")
  ) {
    index = node.pos;
  }
  // Never move before the runtime import, which precedes the first statement.
  return index >= floor && /[\r\n]/.test(text.slice(index, start))
    ? index
    : start;
}

export function instrumentSource(
  code: string,
  filename: string,
  options: SourceTraceOptions,
) {
  if (
    !isSourceFile(filename, options) ||
    /^(?:#![^\n]*\n)?\/\* @sourcetrace-instrumented \*\//.test(code)
  )
    return null;
  const file = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const output = new MagicString(code);
  let binding = "__sourcetrace";
  while (code.includes(binding)) binding += "_";
  const first = file.statements.find(
    (statement) =>
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression),
  );
  const importAt = first ? first.getStart(file) : file.end;
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const location = JSON.stringify(locationOf(opening, file, options.root));
      const container = isJsxChildContext(node);
      output.prependRight(
        prefixPosition(node, file, importAt),
        `${container ? "{" : ""}${binding}(`,
      );
      output.appendLeft(node.end, `, ${location})${container ? "}" : ""}`);
      count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (count === 0) return null;
  // Insert on existing lines so that every original line keeps its number.
  const offset = code.startsWith("#!") ? code.indexOf("\n") + 1 : 0;
  output.appendLeft(offset, `/* ${marker} */ `);
  output.appendLeft(
    importAt,
    `import { recordElement as ${binding} } from "${runtimeModule}";`,
  );
  return {
    code: output.toString(),
    map: output.generateMap({
      hires: true,
      source: filename,
      includeContent: true,
    }),
  };
}
