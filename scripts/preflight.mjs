#!/usr/bin/env node
/**
 * Preflight. Runs before every build, locally and in CI.
 *
 * It exists because of one specific failure that cost a full day: a BUILT
 * index.html was committed over the source one, and a `dist/` folder was
 * committed as `assets/` at the repo root.
 *
 * That state is silently fatal. Vite's entry point IS index.html, so when
 * index.html points at `/assets/index-<hash>.js` instead of `/src/main.jsx`,
 * Vite dutifully re-bundles the OLD prebuilt bundle and never compiles `src/`
 * at all. The build goes green. Vercel deploys. The site serves code from
 * before the changes, and no amount of editing `src/` changes anything.
 *
 * There is no error message for this in Vite, so here is one.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const problems = [];

/* 1. index.html must be the SOURCE entry, not a build artefact. */
const htmlPath = resolve(root, "index.html");
if (!existsSync(htmlPath)) {
  problems.push("index.html is missing. Vite has no entry point without it.");
} else {
  const html = readFileSync(htmlPath, "utf8");
  if (!html.includes("/src/main.jsx")) {
    const built = html.match(/src="(\/assets\/[^"]+)"/);
    problems.push(
      "index.html is a BUILT file, not the source entry.\n" +
        `      It points at ${built ? built[1] : "a bundled asset"} instead of /src/main.jsx.\n` +
        "      Nothing in src/ will be compiled. Restore the source index.html."
    );
  }
}

/* 2. No committed build output at the repo root. */
const assetsDir = resolve(root, "assets");
if (existsSync(assetsDir)) {
  const hashed = readdirSync(assetsDir).filter((f) => /-[A-Za-z0-9_-]{8}\.(js|css)$/.test(f));
  if (hashed.length > 0) {
    problems.push(
      `assets/ at the repo root holds ${hashed.length} hash-named bundle file(s).\n` +
        "      That is build output. Delete the folder -- dist/ is generated, never committed."
    );
  }
}

/* 3. The entry module the HTML promises must actually exist. */
if (!existsSync(resolve(root, "src/main.jsx"))) {
  problems.push("src/main.jsx is missing.");
}

if (problems.length > 0) {
  console.error("\n\x1b[31m✖ PREFLIGHT FAILED\x1b[0m — this build would ship stale code.\n");
  for (const p of problems) console.error(`  \x1b[31m•\x1b[0m ${p}\n`);
  console.error("  Fix these, then build again.\n");
  process.exit(1);
}

console.log("\x1b[32m✓\x1b[0m preflight: source entry intact, no committed build output");
