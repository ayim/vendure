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
 * This deliberately does NOT live inside the `@vendure/dashboard` package. That
 * package is published as `"type": "module"`, so a CommonJS file emitted into it
 * is treated by Node as ESM and loading it throws
 * `ReferenceError: exports is not defined in ES module scope`. This surfaces
 * during `vite build` (where several build environments compile into the shared
 * temp dir) on Windows/pnpm — see https://github.com/vendurehq/vendure/issues.
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
