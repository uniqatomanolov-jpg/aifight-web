import { createClient } from "@supabase/supabase-js";

/**
 * The single Supabase client for the whole app.
 *
 * ON THESE TWO ENVIRONMENT VARIABLES
 * ----------------------------------
 * Both are `VITE_`-prefixed, which means Vite inlines them into the public
 * JavaScript bundle at build time. For these two that is correct and
 * intended: the project URL is not a secret, and the `anon` key is designed
 * to be published -- it is an identity ("an anonymous visitor"), not a
 * permission. What that identity may actually do is decided entirely by the
 * Row Level Security policies in supabase/schema.sql.
 *
 * The corollary is absolute: NEVER give a `VITE_` name to anything that is
 * genuinely secret. In particular the `service_role` key bypasses every RLS
 * policy, so putting it here would publish full read/write access to your
 * database inside a file anyone can open in DevTools.
 */

/**
 * Compiled-in production credentials.
 *
 * These exist so that NO configuration path can produce a dead site. A build
 * with no environment variables, a deploy with a stale or placeholder-filled
 * config.js, a fork someone cloned without the .env -- all of them now boot
 * against production instead of rendering a black page.
 *
 * Precedence, highest first:
 *   1. window.__AIFIGHT_CONFIG__ / window.APP_CONFIG  (runtime override, for
 *      pointing a built folder at a staging project without rebuilding)
 *   2. VITE_SUPABASE_* environment variables          (normal CI/Vercel path)
 *   3. these constants                                (last resort)
 *
 * Publishing them here is safe for exactly the reason described above: the
 * anon key is an identity, not a permission, and it is already visible in the
 * bundle of every deploy. The service_role key must never appear in this file.
 */
const BAKED_URL = "https://wwdekopvslvrmeupnsyx.supabase.co";
const BAKED_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3ZGVrb3B2c2x2cm1ldXBuc3l4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyNjgzODgsImV4cCI6MjEwMTg0NDM4OH0.YZIhv-NXP2N15lT8pONeY2UdXFfZvZfKNbEbYE4fJqc";

/**
 * A blank value, or one still holding a YOUR_* placeholder, counts as absent.
 * Treating placeholders as real values is precisely what used to reach
 * createClient and fail at runtime with an unreachable host.
 */
const real = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  if (trimmed.startsWith("YOUR_") || trimmed.includes("your-project")) return "";
  return trimmed;
};

const runtimeConfig =
  (typeof window !== "undefined" &&
    (window.__AIFIGHT_CONFIG__ || window.APP_CONFIG)) ||
  {};

const url =
  real(runtimeConfig.supabaseUrl) ||
  real(import.meta.env.VITE_SUPABASE_URL) ||
  BAKED_URL;

const anonKey =
  real(runtimeConfig.supabaseAnonKey) ||
  real(import.meta.env.VITE_SUPABASE_ANON_KEY) ||
  BAKED_ANON_KEY;

// Surfaced for the crash overlay, so a failure can report which project it
// was actually talking to rather than leaving you to guess.
if (typeof window !== "undefined") {
  window.__AIFIGHT_RESOLVED__ = {
    url,
    source: real(runtimeConfig.supabaseUrl)
      ? "runtime config"
      : real(import.meta.env.VITE_SUPABASE_URL)
        ? "environment variable"
        : "baked-in default",
  };
}

/**
 * Whether the app was built with credentials at all.
 *
 * Vercel builds do not fail on a missing environment variable -- they build
 * fine and the site then throws on first render, which reads as "the deploy
 * is broken" rather than "the variable is missing". Exporting this lets the
 * UI say the true thing instead.
 */
// Always true now -- the baked-in constants guarantee it. Kept so the
// existing call sites in Arena and AdminPanel continue to compile.
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(
    "[aifight] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. " +
      "Copy .env.example to .env.local and fill them in."
  );
}

export const supabase = createClient(
  url,
  anonKey,
  {
    auth: {
      // The operator stays signed in across reloads, and the token refreshes
      // itself. Supabase stores it in localStorage -- that is a session
      // token scoped by RLS, not a credential, and it expires.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    realtime: {
      // Ten messages a second is plenty for a betting board and keeps a
      // pathological update storm from locking the tab.
      params: { eventsPerSecond: 10 },
    },
  }
);

/** Human-readable text for a PostgREST error, including the useful hints. */
export function describeError(error) {
  if (!error) return "";
  const code = error.code ?? "";

  // The two failures that actually happen in this app, named properly.
  if (code === "23505") return "That exact bet is already logged for this fighter.";
  if (code === "23514") return "The database rejected those numbers as inconsistent.";
  if (code === "42501" || error.message?.includes("row-level security")) {
    return "Not signed in, or this account has no write permission.";
  }
  if (code === "PGRST301" || error.message?.includes("JWT")) {
    return "Your session expired. Sign in again.";
  }
  if (error.message?.includes("Failed to fetch")) {
    return "Could not reach Supabase. Check your connection and the project URL.";
  }
  return error.message || "Something went wrong.";
}
