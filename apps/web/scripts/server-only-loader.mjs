/**
 * The `server-only` package throws unconditionally when required outside a
 * webpack server-component build (that's its whole job) — Next.js swaps in
 * a no-op via a webpack alias, but running a loader function directly under
 * Node (as `perf-baseline-capture.ts` does) has no such alias. This hook
 * gives it one, scoped to that one script.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export default {};", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
