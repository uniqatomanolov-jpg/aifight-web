import { Component } from "react";

/**
 * Catches render-time crashes and shows them instead of unmounting the tree.
 *
 * IMPORTANT, and the reason index.html also carries a boot guard: an error
 * boundary can only catch errors thrown while React renders. A bad import, an
 * undefined export, or a chunk that fails to download all throw during module
 * evaluation -- before React exists -- and no boundary anywhere can see those.
 * Those are exactly the failures that produce a blank black page, so they are
 * handled by the window-level guard in index.html. The two together cover the
 * whole surface; either alone leaves a hole.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, componentStack: "" };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[aifight] render crash", error, info);
    this.setState({ componentStack: info?.componentStack ?? "" });
    // Hand off to the boot guard's overlay if it is present, so a render
    // crash and a startup crash look identical to the person reading them.
    if (typeof window !== "undefined" && typeof window.__aifightCrash === "function") {
      window.__aifightCrash(error, info?.componentStack);
    }
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    const target = typeof window !== "undefined" ? window.__AIFIGHT_RESOLVED__ : null;

    return (
      <div className="min-h-screen bg-[#150507] p-6 font-mono text-slate-100">
        <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-rose-500">
          <div className="bg-rose-500 px-4 py-2.5 text-sm font-bold uppercase tracking-[0.08em] text-[#1a0308]">
            Render error
          </div>
          <div className="p-4">
            <p className="mb-3 text-sm text-rose-200">{error.message || String(error)}</p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-rose-900 bg-[#0b0204] p-3 text-xs text-rose-300">
              {(error.stack || "") + componentStack}
            </pre>
            <p className="mt-4 text-xs text-slate-500">
              Supabase target: {target?.url ?? "not resolved"} ({target?.source ?? "unknown"})
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 min-h-[44px] rounded-lg border border-rose-400/50 px-4 text-sm font-bold text-rose-200 transition hover:bg-rose-400 hover:text-rose-950"
            >
              RELOAD
            </button>
          </div>
        </div>
      </div>
    );
  }
}
