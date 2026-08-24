/**
 * AiFight mark.
 *
 * Two opposed chevrons closing on a central spark: the confrontation of the
 * name, with the spark reading as both a data point and an impact. Drawn on a
 * 32-unit grid with 2.5-unit strokes so it stays crisp at navbar size and
 * scales to a favicon without rasterising.
 *
 * The pulse is on the halo only — never on the mark itself. Animating the
 * glyph makes text beside it appear to wobble; animating a blurred circle
 * behind it reads as a heartbeat and composites on the GPU.
 *
 * `id` is required to be unique per instance because SVG gradient and filter
 * ids are document-global: two logos on one page with the same ids means the
 * second silently inherits the first's fills.
 */

let counter = 0;

export default function AifightLogo({
  size = 26,
  withWordmark = true,
  pulse = true,
  className = "",
}) {
  const uid = `aifight-logo-${(counter += 1)}`;
  const gradientId = `${uid}-grad`;
  const glowId = `${uid}-glow`;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        role="img"
        aria-label="AiFight"
        style={{ overflow: "visible" }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#00F2FE" />
            <stop offset="55%" stopColor="#38EF7D" />
            <stop offset="100%" stopColor="#FF007F" />
          </linearGradient>

          <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>

        {/* Halo. Behind everything, blurred, the only animated element. */}
        <circle
          cx="16"
          cy="16"
          r="7"
          fill={`url(#${gradientId})`}
          filter={`url(#${glowId})`}
          className={pulse ? "fx-logo-pulse" : ""}
          opacity="0.5"
        />

        {/* Opposed chevrons. */}
        <path
          d="M11 7 4 16l7 9"
          stroke={`url(#${gradientId})`}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M21 7l7 9-7 9"
          stroke={`url(#${gradientId})`}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Central spark: impact point and data point at once. */}
        <path
          d="M16 10.5l1.9 3.6 3.6 1.9-3.6 1.9-1.9 3.6-1.9-3.6-3.6-1.9 3.6-1.9z"
          fill={`url(#${gradientId})`}
        />
      </svg>

      {withWordmark && (
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-bold tracking-tight text-slate-100">
            Ai<span style={{ color: "#00F2FE" }}>Fight</span>
          </span>
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.28em] text-slate-600 sm:inline">
            €1,000,000 Challenge
          </span>
        </span>
      )}
    </span>
  );
}
