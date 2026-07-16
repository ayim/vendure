import path from 'path';

/**
 * Name of the directory (under the consuming project's `node_modules/.cache`)
 * into which the VendureConfig is compiled for introspection during the
 * dashboard build.
 */
export const TEMP_COMPILATION_DIR_NAME = 'vendure-dashboard-temp';

/**
 * Resolves the default directory into which the VendureConfig is transpiled (to
 * CommonJS) and dynamically imported during the dashboard build.
 *
 * This deliberately does NOT live inside the `@vendure/dashboard` package. In
 * affected Windows/pnpm Vite builds, Node resolves the generated CommonJS file
 * against that package's `"type": "module"` scope despite the compiler-written
 * child package manifest, and loading it throws
 * `ReferenceError: exports is not defined in ES module scope`. See
 * https://github.com/vendurehq/vendure/issues/4979.
 *
 * Placing the output under the consuming project's `node_modules/.cache` keeps
 * module resolution intact (the compiled config can still resolve
 * `@vendure/core` and friends) while ensuring it is not inside a `type: module`
 * package. The location can still be overridden via the `tempCompilationDir`
 * plugin option.
 */
export function getDefaultTempCompilationDir(cwd: string = process.cwd()): string {
    return path.join(cwd, 'node_modules', '.cache', TEMP_COMPILATION_DIR_NAME);
}
