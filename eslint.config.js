import globals from "globals";

/*
 * The narrow job of this config: catch identifiers that are used but never
 * imported.
 *
 * A missing import is invisible to the bundler -- Rollup treats an unresolved
 * name as a global, emits a clean build, and the page dies at runtime with
 * "X is not defined". That shipped once. `no-undef` is the check that would
 * have caught it before deploy, which is why `npm run lint` is wired into CI
 * alongside the tests.
 *
 * Style rules are deliberately absent. This is a correctness gate, not a
 * formatter, and a config that also argues about semicolons is a config people
 * start skipping.
 */
export default [
  {
    files: ["src/**/*.{js,jsx}", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "no-undef": "error",
      // An imported name that is never used usually means a refactor left a
      // call site behind -- the same family of bug seen from the other side.
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
    },
  },
];
