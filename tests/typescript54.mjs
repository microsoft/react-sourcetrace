// Runs the unit suite against the oldest supported TypeScript release.
import { register } from "node:module";

register(
  `data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
  return next(specifier === "typescript" ? "typescript54" : specifier, context);
}
`)}`,
);
