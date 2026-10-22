import ts from "typescript";
import {
  isSourceFile,
  locationOf,
  runtimeModule,
  type SourceTraceOptions,
} from "./instrument.js";

export function createSourceTraceTransformers(
  options: SourceTraceOptions,
): ts.CustomTransformers {
  const before: ts.TransformerFactory<ts.SourceFile> = (context) => (file) => {
    if (file.kind !== ts.SyntaxKind.SourceFile) {
      // Syntax kinds are numbered per TypeScript release; a mixed instance misreads nodes.
      throw new Error(
        `[react-sourcetrace] The TypeScript emit adapter loaded typescript ${ts.version}, which differs from the compiler's TypeScript. Install a single typescript version.`,
      );
    }
    if (!isSourceFile(file.fileName, options)) return file;
    const factory = context.factory;
    const parsed = ts.getParseTreeNode(file, ts.isSourceFile) ?? file;
    const namespace = factory.createUniqueName("__sourcetrace");
    let count = 0;
    // Earlier transformers may synthesize nodes without parents, so track the
    // JSX child context while walking instead of reading node.parent.
    const visitChildren = <T extends ts.Node>(node: T): T =>
      ts.visitEachChild(
        node,
        ts.isJsxElement(node) ||
          ts.isJsxFragment(node) ||
          ts.isJsxAttribute(node)
          ? visitJsxChild
          : visit,
        context,
      );
    const wrap = (node: ts.Node, container: boolean): ts.Node => {
      if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) {
        return visitChildren(node);
      }
      const element = visitChildren(node);
      const original = ts.getParseTreeNode(node);
      if (
        !original ||
        original.getSourceFile() !== parsed ||
        (!ts.isJsxElement(original) && !ts.isJsxSelfClosingElement(original))
      ) {
        return element;
      }
      const opening = ts.isJsxElement(original)
        ? original.openingElement
        : original;
      const source = locationOf(opening, parsed, options.root);
      const call = ts.setSourceMapRange(
        factory.createCallExpression(
          factory.createPropertyAccessExpression(namespace, "recordElement"),
          undefined,
          [
            element,
            factory.createObjectLiteralExpression(
              Object.entries(source).map(([key, value]) =>
                factory.createPropertyAssignment(
                  key,
                  typeof value === "number"
                    ? factory.createNumericLiteral(value)
                    : factory.createStringLiteral(value),
                ),
              ),
            ),
          ],
        ),
        original,
      );
      count++;
      return container ? factory.createJsxExpression(undefined, call) : call;
    };
    const visit: ts.Visitor = (node) => wrap(node, false);
    const visitJsxChild: ts.Visitor = (node) => wrap(node, true);
    const result = ts.visitNode(file, visit, ts.isSourceFile);
    if (!result || count === 0) return file;
    const statements = [...result.statements];
    let index = 0;
    while (
      index < statements.length &&
      ts.isExpressionStatement(statements[index]!) &&
      ts.isStringLiteral(
        (statements[index] as ts.ExpressionStatement).expression,
      )
    )
      index++;
    // A namespace import keeps the reference valid when TypeScript emits CommonJS.
    statements.splice(
      index,
      0,
      factory.createImportDeclaration(
        undefined,
        factory.createImportClause(
          false,
          undefined,
          factory.createNamespaceImport(namespace),
        ),
        factory.createStringLiteral(runtimeModule),
      ),
    );
    return factory.updateSourceFile(result, statements);
  };
  return { before: [before] };
}
