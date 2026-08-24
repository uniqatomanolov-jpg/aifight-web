/**
 * Headless smoke test for the patched AiFight build.
 *
 * Loads the real index.html into jsdom, runs the real boot guard, runs the
 * real bundle, and asserts the app actually paints. Network calls to Supabase
 * fail in here (no DNS), which is deliberate: it proves the app renders its
 * shell and degrades to an error message instead of a blank page when the
 * database is unreachable -- the exact production symptom being fixed.
 */

import fs from "node:fs";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const ROOT = path.resolve("/home/claude/repo/aifight-source/dist");
const failures = [];
const notes = [];

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? " -- " + detail : ""}`);
    failures.push(label);
  }
}

// --- 1. static assertions on the shipped files -------------------------------
const bundle = fs.readFileSync(
  path.join(ROOT, "assets", fs.readdirSync(path.join(ROOT,"assets")).find(f=>f.startsWith("index-")&&f.endsWith(".js"))),
  "utf8"
);
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

check(
  "Supabase URL compiled into bundle",
  bundle.includes("https://wwdekopvslvrmeupnsyx.supabase.co")
);
check(
  "anon key compiled into bundle",
  bundle.includes("YZIhv-NXP2N15lT8pONeY2UdXFfZvZfKNbEbYE4fJqc")
);
check("error boundary compiled into bundle", bundle.includes("Render error") && bundle.includes("RELOAD"));
check("boundary hands off to the overlay", /__aifightCrash/.test(bundle));
check("boot guard injected into index.html", html.includes("__aifightCrash"));
check(
  "boot guard runs before the module",
  html.indexOf("__aifightCrash") < html.indexOf('<script type="module"')
);

// --- 2. mount the real thing -------------------------------------------------
const virtualConsole = new VirtualConsole();
const consoleErrors = [];
virtualConsole.on("jsdomError", (e) => consoleErrors.push(e.message));
virtualConsole.on("error", (...args) => consoleErrors.push(args.join(" ")));

const dom = new JSDOM(html, {
  url: "https://aifight.vercel.app/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
  virtualConsole,
});

const { window } = dom;

// Run the inline boot guard exactly as the browser would.
const inline = [...window.document.querySelectorAll("script:not([src])")]
  .map((s) => s.textContent)
  .join("\n");
window.eval(inline);
check("boot guard installed window.__aifightCrash", typeof window.__aifightCrash === "function");

// Publish the DOM as globals so the ES module sees a browser.
const globals = [
  "window", "document", "navigator", "location", "history", "HTMLElement",
  "Element", "Node", "Event", "CustomEvent", "MessageChannel", "MutationObserver",
  "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
  "PopStateEvent", "WebSocket", "XMLHttpRequest", "self",
];
for (const key of globals) {
  if (window[key] === undefined) continue;
  // Node 22 defines some of these as getter-only on globalThis.
  try {
    globalThis[key] = window[key];
  } catch {
    Object.defineProperty(globalThis, key, {
      value: window[key],
      configurable: true,
      writable: true,
    });
  }
}
globalThis.window = window;
globalThis.self = window;

// No runtime config.js is loaded here ON PURPOSE: this is the missing-config
// scenario that used to hang. The baked-in constants must carry it.
check(
  "no runtime config present (worst case)",
  window.__AIFIGHT_CONFIG__ === undefined && window.APP_CONFIG === undefined
);

await import(path.join(ROOT, "assets", fs.readdirSync(path.join(ROOT,"assets")).find(f=>f.startsWith("index-")&&f.endsWith(".js"))));

// Let React flush and the (doomed) Supabase request settle.
await new Promise((r) => setTimeout(r, 1500));

const root = window.document.getElementById("root");
const text = root.textContent || "";

check("credentials resolved without config.js", !!window.__AIFIGHT_RESOLVED__);
check(
  "resolved to the baked-in project",
  window.__AIFIGHT_RESOLVED__?.url === "https://wwdekopvslvrmeupnsyx.supabase.co",
  window.__AIFIGHT_RESOLVED__?.url
);
check(
  "source reported as baked-in default",
  window.__AIFIGHT_RESOLVED__?.source === "baked-in default",
  window.__AIFIGHT_RESOLVED__?.source
);
check("app mounted (root not empty)", root.children.length > 0, `children=${root.children.length}`);
check("hero rendered", text.includes("Challenge"));
check("fighters rendered", ["Claude", "Grok", "ChatGPT", "Gemini", "Kimi"].every((m) => text.includes(m)));
check("board rendered", text.length > 200);

// --- every route mounts ---
for (const [route, expect] of [["/hall","Standings"],["/head-to-head","Head to head"],["/fighters","The fighters"],["/fighter/claude","Claude"]]) {
  const d2 = new JSDOM(html, { url: "https://aifight.vercel.app" + route, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const w2 = d2.window;
  w2.eval([...w2.document.querySelectorAll("script:not([src])")].map(s=>s.textContent).join("\n"));
  for (const k of ["window","document","navigator","location","history","HTMLElement","Element","Node","Event","CustomEvent","MessageChannel","MutationObserver","getComputedStyle","requestAnimationFrame","cancelAnimationFrame","PopStateEvent","WebSocket","XMLHttpRequest","self"]) {
    if (w2[k] === undefined) continue;
    try { globalThis[k] = w2[k]; } catch { Object.defineProperty(globalThis, k, { value: w2[k], configurable: true, writable: true }); }
  }
  globalThis.window = w2;
  const mod = path.join(ROOT, "assets", fs.readdirSync(path.join(ROOT,"assets")).find(f=>f.startsWith("index-")&&f.endsWith(".js")));
  await import(mod + "?route=" + encodeURIComponent(route));
  await new Promise(r => setTimeout(r, 900));
  const t2 = w2.document.getElementById("root").textContent || "";
  check(`route ${route} renders`, t2.includes(expect), `got "${t2.slice(0,70)}"`);
  check(`route ${route} has header nav`, t2.includes("AIFIGHT") || t2.includes("Arena"));
}
check(
  "NOT showing the not-configured screen",
  !text.includes("not connected to its database") &&
    !text.includes("Supabase is not configured")
);
check("crash overlay NOT triggered on a healthy boot", !text.includes("Startup error"));

if (text.includes("Could not reach Supabase") || text.includes("Failed to fetch")) {
  notes.push(
    "Supabase was unreachable from the sandbox (expected -- no DNS here). " +
      "The app rendered its shell and surfaced the error inline rather than going blank. " +
      "That is the correct degraded behaviour."
  );
}

// --- 3. prove the overlay actually paints ------------------------------------
window.__aifightCrash(
  Object.assign(new Error("synthetic failure"), { stack: "Error: synthetic failure\n  at test" }),
  "\n  in Arena"
);
const crashText = window.document.getElementById("root").textContent || "";
check("overlay paints on crash", crashText.includes("Render error"));
check("overlay shows the message", crashText.includes("synthetic failure"));
check("overlay names the Supabase target", crashText.includes("wwdekopvslvrmeupnsyx"));

console.log("");
for (const n of notes) console.log(`  NOTE  ${n}`);
if (consoleErrors.length) {
  console.log(`  NOTE  ${consoleErrors.length} console error(s) during boot (network, expected):`);
  console.log("        " + consoleErrors.slice(0, 3).map((e) => String(e).split("\n")[0]).join("\n        "));
}

console.log("");
console.log(failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
