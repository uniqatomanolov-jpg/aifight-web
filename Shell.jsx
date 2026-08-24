import { useEffect, useState, createContext, useContext, useCallback } from "react";
import { sfx, isMuted, toggleMute } from "../lib/sound.js";

/* ===========================================================================
   Minimal router.

   Five routes and no nested layouts, so a routing library would be a
   dependency, a bundle cost and a version to maintain in exchange for
   resolving a five-way switch. History API directly instead.

   The one thing that MUST accompany this: vercel.json has to rewrite unknown
   paths to /index.html, or a hard refresh on /hall returns a 404 from Vercel
   before React ever runs.
   =========================================================================== */

const RouterContext = createContext({ path: "/", navigate: () => {} });

export const useRouter = () => useContext(RouterContext);

export function RouterProvider({ children }) {
  const [path, setPath] = useState(() => normalise(window.location.pathname));

  useEffect(() => {
    const onPop = () => setPath(normalise(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to) => {
    const next = normalise(to);
    if (next === normalise(window.location.pathname)) return;
    window.history.pushState({}, "", next);
    setPath(next);
    // A pushState navigation does not reset scroll the way a real one does.
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }, []);

  return (
    <RouterContext.Provider value={{ path, navigate }}>{children}</RouterContext.Provider>
  );
}

export function normalise(pathname) {
  const trimmed = (pathname || "/").replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed.toLowerCase();
}

/** Anchor that navigates client-side but stays a real link for middle-click,
 *  cmd-click and crawlers. */
export function Link({ to, className = "", children, ...rest }) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        sfx.click();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

/* ===========================================================================
   Header
   =========================================================================== */

const NAV = [
  { to: "/", label: "Arena" },
  { to: "/hall", label: "Standings" },
  { to: "/head-to-head", label: "H2H" },
  { to: "/fighters", label: "Fighters" },
];

export function SiteHeader() {
  const { path } = useRouter();
  const [muted, setMuted] = useState(() => isMuted());

  return (
    <header className="fx-glass sticky top-0 z-40">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2.5" aria-label="AiFight home">
          <AifightMark />
          <span className="hidden flex-col leading-none sm:flex">
            <span className="af-word relative overflow-hidden text-base font-extrabold tracking-tight text-slate-50">
              A<span style={{ color: "#FF7A18" }}>I</span>FIGHT
              <span
                aria-hidden="true"
                className="af-shine pointer-events-none absolute inset-y-0 left-0"
                style={{
                  width: "2.5rem",
                  transform: "skewX(-12deg)",
                  background:
                    "linear-gradient(90deg,transparent,rgba(255,255,255,.75),rgba(155,253,255,.8),transparent)",
                }}
              />
            </span>
            <span className="mt-1 font-mono text-[8px] uppercase tracking-[0.28em] text-slate-500">
              Optimized LLM Duels
            </span>
          </span>
        </Link>

        <nav className="ml-auto flex items-center gap-1">
          {NAV.map((item) => {
            const active = normalise(path) === normalise(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onMouseEnter={() => sfx.tick()}
                className={`rounded-lg px-3 py-2 text-[13px] font-medium tracking-normal transition sm:text-sm ${
                  active
                    ? "bg-white/10 text-slate-100"
                    : "text-slate-500 hover:bg-white/[0.06] hover:text-slate-200"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            title="Toggle sound"
            aria-label="Toggle sound"
            onClick={() => {
              const next = toggleMute();
              setMuted(next);
              if (!next) sfx.click();
            }}
            className="ml-1 rounded-lg px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-600 transition hover:text-slate-300"
          >
            {muted ? "♪ off" : "♪ on"}
          </button>
        </nav>
      </div>
    </header>
  );
}

export function AifightMark({ height = 34 }) {
  return (
    <svg
      height={height}
      viewBox="0 0 44 44"
      fill="none"
      role="img"
      aria-label="AiFight"
      className="shrink-0"
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id="afc" x1="0" y1="6" x2="26" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9BFDFF" />
          <stop offset="50%" stopColor="#00E5FF" />
          <stop offset="100%" stopColor="#0079B8" />
        </linearGradient>
        <linearGradient id="afo" x1="14" y1="6" x2="42" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFD37A" />
          <stop offset="48%" stopColor="#FF7A18" />
          <stop offset="100%" stopColor="#D62F00" />
        </linearGradient>
        <radialGradient id="afk">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="35%" stopColor="#FFE9A8" />
          <stop offset="100%" stopColor="#FF7A18" stopOpacity="0" />
        </radialGradient>
        <filter id="afneon" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="afsoft" x="-90%" y="-90%" width="280%" height="280%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      <g filter="url(#afsoft)">
        <path className="af-halo" d="M17 6 L5 38 L11 38 L19 16 Z" fill="#00E5FF" opacity=".5" />
        <path className="af-halo" d="M25 6 L38 6 L34 13 L27 13 Z" fill="#FF7A18" opacity=".5" />
      </g>
      <g className="af-rays" opacity=".45">
        <path d="M24 9 L25 20 L24 31 L23 20 Z" fill="#FFE9A8" opacity=".65" />
        <path d="M13 20 L24 19 L35 20 L24 21 Z" fill="#9BFDFF" opacity=".5" />
      </g>
      <g filter="url(#afneon)">
        <path d="M17.5 5 L23.5 5 L23.5 39 L17 39 L19.5 32 L11.5 32 L8.5 39 L2 39 Z" fill="url(#afc)" />
      </g>
      <path d="M17.5 5 L20.5 5 L20.5 39 L17 39 L19.5 32 L15 32 Z" fill="#CFFEFF" opacity=".35" />
      <path d="M17.2 16 L20.2 23.5 L14 23.5 Z" fill="#050508" />
      <g filter="url(#afneon)">
        <path
          d="M24.5 5 L41 5 L37 12 L30.5 12 L30.5 18 L38.5 18 L35 24.5 L30.5 24.5 L30.5 39 L24.5 39 Z"
          fill="url(#afo)"
        />
      </g>
      <path d="M24.5 5 L27.5 5 L27.5 39 L24.5 39 Z" fill="#FFE2B8" opacity=".3" />
      <circle className="af-core" cx="24" cy="20" r="8" fill="url(#afk)" />
      <path
        className="af-core"
        d="M24 11 L25.5 18.5 L33 20 L25.5 21.5 L24 29 L22.5 21.5 L15 20 L22.5 18.5 Z"
        fill="#fff"
      />
      <circle className="af-spark" cx="24" cy="20" r=".8" fill="#9BFDFF" style={{ "--dx": "-13px", "--dy": "-11px" }} />
      <circle className="af-spark af-s2" cx="24" cy="20" r=".7" fill="#FFC24D" style={{ "--dx": "14px", "--dy": "-9px" }} />
      <circle className="af-spark af-s3" cx="24" cy="20" r=".6" fill="#fff" style={{ "--dx": "11px", "--dy": "12px" }} />
      <circle className="af-spark af-s4" cx="24" cy="20" r=".7" fill="#00E5FF" style={{ "--dx": "-12px", "--dy": "10px" }} />
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-white/[0.06] px-4 py-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-600">
        <span>AiFight</span>
        <span>Five models · €1,000 each · no stake cap</span>
        <span className="sm:ml-auto">Every stake and thesis published before the result</span>
      </div>
      <p className="mx-auto mt-4 max-w-7xl text-[11px] leading-relaxed text-slate-700">
        Published for research and entertainment. Nothing here is betting advice, and past
        performance of any model is not predictive of future results. 18+.
      </p>
    </footer>
  );
}
